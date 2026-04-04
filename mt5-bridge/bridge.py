"""
VELQOR MT5 BRIDGE v1.0
Connette MT5 via investor password (read-only) e pusha dati su Supabase.
Progettato per girare su VPS Windows con MT5 installato.
"""

import sys
import time
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import MetaTrader5 as mt5
except ImportError:
    print("ERRORE: MetaTrader5 non installato. Esegui: pip install MetaTrader5")
    sys.exit(1)

import requests

# Config
try:
    from config_local import *
except ImportError:
    from config import *

# Logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("mt5_bridge")

# Supabase REST helpers
HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}
API = f"{SUPABASE_URL}/rest/v1"


def sb_get(table, params=None):
    r = requests.get(f"{API}/{table}", headers={**HEADERS, "Prefer": "return=representation"}, params=params or {})
    r.raise_for_status()
    return r.json()


def sb_patch(table, match_col, match_val, data):
    r = requests.patch(
        f"{API}/{table}?{match_col}=eq.{match_val}",
        headers=HEADERS, json=data
    )
    r.raise_for_status()
    return r


def sb_upsert(table, data, on_conflict=None):
    h = {**HEADERS}
    if on_conflict:
        h["Prefer"] = "return=minimal,resolution=merge-duplicates"
    r = requests.post(f"{API}/{table}", headers=h, json=data)
    if r.status_code not in (200, 201, 204):
        log.error(f"Upsert {table} failed: {r.status_code} {r.text}")
    return r


def sb_insert(table, data):
    h = {**HEADERS, "Prefer": "return=minimal"}
    r = requests.post(f"{API}/{table}", headers=h, json=data if isinstance(data, list) else [data])
    if r.status_code not in (200, 201, 204):
        log.error(f"Insert {table} failed: {r.status_code} {r.text}")
    return r


# ============================================
# MT5 CONNECTION
# ============================================

def init_mt5():
    kwargs = {}
    if MT5_PATH:
        kwargs["path"] = MT5_PATH
    if not mt5.initialize(**kwargs):
        log.error(f"MT5 initialize failed: {mt5.last_error()}")
        return False
    log.info(f"MT5 initialized: {mt5.terminal_info().name} v{mt5.version()}")
    return True


def connect_account(login, password, server):
    login_int = int(login)
    if not mt5.login(login_int, password=password, server=server):
        log.error(f"MT5 login failed for {login}: {mt5.last_error()}")
        return False
    return True


# ============================================
# DATA COLLECTION
# ============================================

def get_account_info():
    info = mt5.account_info()
    if info is None:
        return None
    return {
        "balance": float(info.balance),
        "equity": float(info.equity),
        "floating_pl": float(info.profit),
        "margin_used": float(info.margin),
    }


def get_open_positions():
    positions = mt5.positions_get()
    if positions is None:
        return []
    result = []
    for p in positions:
        result.append({
            "ticket": int(p.ticket),
            "magic": int(p.magic),
            "symbol": p.symbol,
            "direction": "buy" if p.type == 0 else "sell",
            "lots": float(p.volume),
            "open_price": float(p.price_open),
            "sl": float(p.sl) if p.sl > 0 else None,
            "tp": float(p.tp) if p.tp > 0 else None,
            "open_time": datetime.fromtimestamp(p.time, tz=timezone.utc).isoformat(),
            "profit": float(p.profit),
            "swap": float(p.swap),
            "commission": float(p.commission) if hasattr(p, 'commission') else 0,
            "is_open": True,
        })
    return result


def get_closed_deals(since_date):
    """Get closed deals since a given date."""
    date_from = since_date
    date_to = datetime.now(tz=timezone.utc)
    deals = mt5.history_deals_get(date_from, date_to)
    if deals is None or len(deals) == 0:
        return []

    # Group deals by position ticket (entry + exit)
    trades = {}
    for d in deals:
        if d.entry == 0:  # DEAL_ENTRY_IN
            trades[d.position_id] = {
                "ticket": int(d.position_id),
                "magic": int(d.magic),
                "symbol": d.symbol,
                "direction": "buy" if d.type == 0 else "sell",
                "lots": float(d.volume),
                "open_price": float(d.price),
                "open_time": datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat(),
                "swap": 0.0,
                "commission": float(d.commission) if hasattr(d, 'commission') else 0,
                "profit": 0.0,
                "is_open": False,
            }
        elif d.entry == 1:  # DEAL_ENTRY_OUT
            pos_id = d.position_id
            if pos_id in trades:
                trades[pos_id]["close_price"] = float(d.price)
                trades[pos_id]["close_time"] = datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat()
                trades[pos_id]["profit"] = float(d.profit)
                trades[pos_id]["swap"] = float(d.swap)
                trades[pos_id]["commission"] = trades[pos_id].get("commission", 0) + (float(d.commission) if hasattr(d, 'commission') else 0)
                trades[pos_id]["is_open"] = False
                # Calculate net profit and duration
                net = float(d.profit) + float(d.swap) + trades[pos_id]["commission"]
                trades[pos_id]["net_profit"] = net
                try:
                    open_dt = datetime.fromisoformat(trades[pos_id]["open_time"])
                    close_dt = datetime.fromtimestamp(d.time, tz=timezone.utc)
                    trades[pos_id]["duration_seconds"] = int((close_dt - open_dt).total_seconds())
                except:
                    pass
            else:
                # Exit without matching entry (trade opened before our window)
                trades[pos_id] = {
                    "ticket": int(pos_id),
                    "magic": int(d.magic),
                    "symbol": d.symbol,
                    "direction": "sell" if d.type == 0 else "buy",  # reverse for exit
                    "lots": float(d.volume),
                    "open_price": 0,
                    "close_price": float(d.price),
                    "open_time": datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat(),
                    "close_time": datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat(),
                    "profit": float(d.profit),
                    "swap": float(d.swap),
                    "commission": float(d.commission) if hasattr(d, 'commission') else 0,
                    "net_profit": float(d.profit) + float(d.swap) + (float(d.commission) if hasattr(d, 'commission') else 0),
                    "is_open": False,
                }

    return list(trades.values())


# ============================================
# DRAWDOWN CALCULATION
# ============================================

def calc_dd(account_size, balance, equity):
    current_value = min(balance, equity)
    total_dd = max(0, (account_size - current_value) / account_size * 100)
    return round(total_dd, 2)


# ============================================
# STRATEGY MATCHING
# ============================================

def load_strategy_map():
    """Load magic -> strategy_id mapping from Supabase."""
    strategies = sb_get("qel_strategies", {"select": "id,magic", "org_id": f"eq.{ORG_ID}"})
    return {s["magic"]: s["id"] for s in strategies}


# ============================================
# SYNC LOGIC
# ============================================

def sync_account(account, strategy_map):
    acc_id = account["id"]
    login = account.get("login")
    password = account.get("investor_password")
    server = account.get("server")
    acc_size = float(account.get("account_size", 100000))

    if not login or not password or not server:
        log.warning(f"  Skipping {account['name']}: login/password/server non configurati")
        return False

    log.info(f"  Connessione a {account['name']} (login: {login}, server: {server})...")

    if not connect_account(login, password, server):
        return False

    # 1. Account info
    info = get_account_info()
    if not info:
        log.error(f"  Impossibile leggere account info per {login}")
        return False

    total_dd = calc_dd(acc_size, info["balance"], info["equity"])

    # Update account
    now = datetime.now(tz=timezone.utc).isoformat()
    sb_patch("qel_accounts", "id", acc_id, {
        "balance": info["balance"],
        "equity": info["equity"],
        "floating_pl": info["floating_pl"],
        "margin_used": info["margin_used"],
        "total_dd_pct": total_dd,
        "last_sync_at": now,
    })
    log.info(f"  Account: balance=${info['balance']:.2f} equity=${info['equity']:.2f} floating=${info['floating_pl']:.2f} DD={total_dd:.1f}%")

    # 2. Snapshot
    sb_insert("qel_account_snapshots", {
        "account_id": acc_id,
        "balance": info["balance"],
        "equity": info["equity"],
        "floating_pl": info["floating_pl"],
        "margin_used": info["margin_used"],
        "total_dd_pct": total_dd,
        "open_trades": len(get_open_positions()),
    })

    # 3. Open positions -> update trades
    positions = get_open_positions()
    log.info(f"  Posizioni aperte: {len(positions)}")

    for pos in positions:
        pos["account_id"] = acc_id
        if pos["magic"] in strategy_map:
            pos["strategy_id"] = strategy_map[pos["magic"]]
        sb_upsert("qel_trades", pos, on_conflict="account_id,ticket")

    # 4. Closed trades since last sync (or last 30 days)
    last_sync = account.get("last_sync_at")
    if last_sync:
        try:
            since = datetime.fromisoformat(last_sync.replace("Z", "+00:00"))
            since = since - timedelta(hours=1)  # overlap per sicurezza
        except:
            since = datetime.now(tz=timezone.utc) - timedelta(days=30)
    else:
        since = datetime.now(tz=timezone.utc) - timedelta(days=90)

    closed = get_closed_deals(since)
    log.info(f"  Trade chiusi (da {since.strftime('%Y-%m-%d')}): {len(closed)}")

    for trade in closed:
        trade["account_id"] = acc_id
        if trade["magic"] in strategy_map:
            trade["strategy_id"] = strategy_map[trade["magic"]]
        sb_upsert("qel_trades", trade, on_conflict="account_id,ticket")

    return True


def update_strategy_real_metrics(strategy_map):
    """Ricalcola metriche real per ogni strategia basandosi sui trade chiusi."""
    for magic, strat_id in strategy_map.items():
        trades = sb_get("qel_trades", {
            "select": "profit,net_profit,swap,commission,duration_seconds",
            "strategy_id": f"eq.{strat_id}",
            "is_open": "eq.false",
            "close_time": "not.is.null",
            "order": "close_time.asc"
        })

        if not trades:
            continue

        n = len(trades)
        profits = [float(t.get("net_profit") or t.get("profit") or 0) for t in trades]
        wins = [p for p in profits if p > 0]
        losses = [p for p in profits if p < 0]

        total_pl = sum(profits)
        win_pct = (len(wins) / n * 100) if n > 0 else 0
        avg_win = sum(wins) / len(wins) if wins else 0
        avg_loss = abs(sum(losses) / len(losses)) if losses else 0
        payoff = (avg_win / avg_loss) if avg_loss > 0 else 0
        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 0
        expectancy = total_pl / n if n > 0 else 0

        # Max drawdown
        peak = 0
        max_dd = 0
        equity_curve = 0
        for p in profits:
            equity_curve += p
            if equity_curve > peak:
                peak = equity_curve
            dd = peak - equity_curve
            if dd > max_dd:
                max_dd = dd

        ret_dd = (total_pl / max_dd) if max_dd > 0 else 0
        recovery = (total_pl / max_dd) if max_dd > 0 else 0

        # Avg duration
        durations = [float(t["duration_seconds"]) for t in trades if t.get("duration_seconds")]
        avg_dur_hours = (sum(durations) / len(durations) / 3600) if durations else None

        sb_patch("qel_strategies", "id", strat_id, {
            "real_trades": n,
            "real_pl": round(total_pl, 2),
            "real_max_dd": round(max_dd, 2),
            "real_win_pct": round(win_pct, 2),
            "real_payoff": round(payoff, 2),
            "real_expectancy": round(expectancy, 2),
            "real_profit_factor": round(profit_factor, 2),
            "real_recovery_factor": round(recovery, 2),
            "real_ret_dd": round(ret_dd, 2),
            "real_avg_duration_hours": round(avg_dur_hours, 2) if avg_dur_hours else None,
        })
        log.info(f"  Strategy {magic}: {n} trades, P/L=${total_pl:.2f}, Win={win_pct:.1f}%, R/DD={ret_dd:.2f}")


# ============================================
# MAIN LOOP
# ============================================

def run_sync():
    log.info("=" * 50)
    log.info("SYNC START")

    if not init_mt5():
        return

    try:
        # Load accounts
        accounts = sb_get("qel_accounts", {
            "select": "*",
            "org_id": f"eq.{ORG_ID}",
            "status": "eq.active"
        })
        log.info(f"Conti attivi trovati: {len(accounts)}")

        # Load strategy map
        strategy_map = load_strategy_map()
        log.info(f"Strategie caricate: {len(strategy_map)}")

        # Sync each account
        synced = 0
        for acc in accounts:
            try:
                if sync_account(acc, strategy_map):
                    synced += 1
            except Exception as e:
                log.error(f"  Errore sync {acc['name']}: {e}")

        # Update real metrics
        if synced > 0:
            log.info("Aggiornamento metriche real strategie...")
            try:
                update_strategy_real_metrics(strategy_map)
            except Exception as e:
                log.error(f"Errore aggiornamento metriche: {e}")

        log.info(f"SYNC COMPLETATO: {synced}/{len(accounts)} conti sincronizzati")

    finally:
        mt5.shutdown()


def main():
    if not SUPABASE_SERVICE_KEY:
        print("ERRORE: SUPABASE_SERVICE_KEY non configurata.")
        print("1. Vai su Supabase Dashboard > Settings > API")
        print("2. Copia 'service_role' key (NON anon key)")
        print("3. Incollala in config_local.py")
        sys.exit(1)

    mode = sys.argv[1] if len(sys.argv) > 1 else "loop"

    if mode == "once":
        log.info("Modalita: singola esecuzione")
        run_sync()
    elif mode == "loop":
        log.info(f"Modalita: loop continuo (ogni {SYNC_INTERVAL}s)")
        while True:
            try:
                run_sync()
            except Exception as e:
                log.error(f"Errore ciclo sync: {e}")
            log.info(f"Prossimo sync tra {SYNC_INTERVAL}s...")
            time.sleep(SYNC_INTERVAL)
    else:
        print(f"Uso: python bridge.py [once|loop]")
        print(f"  once  - Esegue un singolo sync")
        print(f"  loop  - Loop continuo (default, ogni {SYNC_INTERVAL}s)")


if __name__ == "__main__":
    main()
