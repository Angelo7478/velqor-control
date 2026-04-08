"""
VELQOR MT5 BRIDGE v2.2
Un processo per terminale MT5. Non fa login — legge il conto già loggato.
Lanciato dal launcher.py o manualmente con --mt5-path.

v2.2: Auto-reconnect MT5, heartbeat file, consecutive failure self-exit

Uso:
  python bridge.py --mt5-path "C:\\MT5_10K\\terminal64.exe"
  python bridge.py --mt5-path "C:\\MT5_10K\\terminal64.exe" once
  python bridge.py --mt5-path "C:\\MT5_10K\\terminal64.exe" enrich
  python bridge.py --mt5-path "C:\\MT5_10K\\terminal64.exe" status
"""

import sys
import os
import time
import json
import logging
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import MetaTrader5 as mt5
except ImportError:
    print("ERRORE: pip install MetaTrader5")
    sys.exit(1)

import requests

# ============================================
# CONFIG
# ============================================

# Defaults — sovrascritti da config_local.py se esiste
SUPABASE_URL = "https://gotbfzdgasuvfskzeycm.supabase.co"
SUPABASE_SERVICE_KEY = ""
ORG_ID = "a0000000-0000-0000-0000-000000000001"
SYNC_INTERVAL = 300
HISTORY_DAYS = 1095
FORCE_FULL_IMPORT = False
LOG_LEVEL = "INFO"

# Reconnection
MT5_RECONNECT_MAX_ATTEMPTS = 5
MT5_RECONNECT_INITIAL_DELAY = 5   # seconds
MT5_RECONNECT_MAX_DELAY = 60      # seconds
MAX_CONSECUTIVE_FAILURES = 3      # exit after N failed sync cycles

# Heartbeat
HEARTBEAT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "heartbeats")

try:
    from config_local import *
except ImportError:
    try:
        from config import *
    except ImportError:
        pass

# ============================================
# ARGS
# ============================================

parser = argparse.ArgumentParser(description="Velqor MT5 Bridge v2.1")
parser.add_argument("mode", nargs="?", default="loop", choices=["loop", "once", "enrich", "status", "resync"])
parser.add_argument("--mt5-path", required=True, help="Percorso terminal64.exe")
parser.add_argument("--interval", type=int, default=None, help="Override sync interval (secondi)")
parser.add_argument("--log-file", default=None, help="Override log file path")
args = parser.parse_args()

MT5_PATH = args.mt5_path
if args.interval:
    SYNC_INTERVAL = args.interval

# Log file — auto-genera dal nome cartella MT5
if args.log_file:
    log_file = args.log_file
else:
    mt5_folder = Path(MT5_PATH).parent.name
    log_file = f"bridge_{mt5_folder}.log"

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format=f"%(asctime)s [{mt5_folder if not args.log_file else 'BRIDGE'}] [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(log_file, encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("mt5_bridge")

# Supabase REST
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
    r = requests.patch(f"{API}/{table}?{match_col}=eq.{match_val}", headers=HEADERS, json=data)
    r.raise_for_status()
    return r


def sb_upsert(table, data, on_conflict=None):
    h = {**HEADERS}
    url = f"{API}/{table}"
    if on_conflict:
        h["Prefer"] = "return=minimal,resolution=merge-duplicates"
        url += f"?on_conflict={on_conflict}"
    r = requests.post(url, headers=h, json=data)
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
# MT5 — NO LOGIN, SOLO READ + AUTO-RECONNECT
# ============================================

# Module-level state
_consecutive_failures = 0
_account_login = None  # set once after first successful connection


def init_mt5():
    if not mt5.initialize(path=MT5_PATH):
        log.error(f"MT5 init failed ({MT5_PATH}): {mt5.last_error()}")
        return False
    info = mt5.account_info()
    if info is None:
        log.error(f"MT5 connesso ma nessun conto loggato su {MT5_PATH}")
        mt5.shutdown()
        return False
    log.info(f"MT5 OK → {info.login}@{info.server} Balance=${info.balance:.2f}")
    global _account_login
    _account_login = str(info.login)
    return True


def ensure_mt5_connection():
    """Test MT5 connection; reconnect with exponential backoff if dead.
    Returns True if MT5 is usable, False if all retries failed.
    NEVER calls mt5.login() — terminal is already logged in via investor password."""
    info = mt5.account_info()
    if info is not None:
        return True  # connection alive

    log.warning("MT5 disconnesso — tentativo di riconnessione...")
    delay = MT5_RECONNECT_INITIAL_DELAY

    for attempt in range(1, MT5_RECONNECT_MAX_ATTEMPTS + 1):
        log.info(f"  Reconnect {attempt}/{MT5_RECONNECT_MAX_ATTEMPTS} (attesa {delay}s)...")
        try:
            mt5.shutdown()
        except Exception:
            pass
        time.sleep(delay)

        if mt5.initialize(path=MT5_PATH):
            info = mt5.account_info()
            if info is not None:
                log.info(f"  Riconnesso! → {info.login}@{info.server}")
                return True
            else:
                log.warning(f"  MT5 inizializzato ma nessun conto loggato")
        else:
            log.warning(f"  mt5.initialize() fallito: {mt5.last_error()}")

        delay = min(delay * 2, MT5_RECONNECT_MAX_DELAY)

    log.error(f"MT5 riconnessione fallita dopo {MT5_RECONNECT_MAX_ATTEMPTS} tentativi")
    return False


def write_heartbeat(status, extra=None):
    """Write heartbeat file for launcher health monitoring."""
    try:
        os.makedirs(HEARTBEAT_DIR, exist_ok=True)
        login = _account_login or "unknown"
        data = {
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "status": status,
            "pid": os.getpid(),
            "mt5_path": MT5_PATH,
            "consecutive_failures": _consecutive_failures,
        }
        if extra:
            data.update(extra)
        path = os.path.join(HEARTBEAT_DIR, f"{login}.json")
        with open(path, "w") as f:
            json.dump(data, f)
    except Exception as e:
        log.error(f"Heartbeat write failed: {e}")


def get_mt5_login():
    info = mt5.account_info()
    return str(info.login) if info else None


def find_account_by_login(login_str):
    accounts = sb_get("qel_accounts", {
        "select": "*",
        "login": f"eq.{login_str}",
        "org_id": f"eq.{ORG_ID}",
    })
    return accounts[0] if accounts else None


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


def warmup_history():
    """Pre-load MT5 deal history to ensure all data is available.
    MT5 may not return complete history on the first call if the terminal
    hasn't loaded it yet. We call history_deals_total repeatedly until
    the count stabilizes."""
    date_from = datetime.now(tz=timezone.utc) - timedelta(days=HISTORY_DAYS)
    date_to = datetime.now(tz=timezone.utc)
    prev_count = -1
    for attempt in range(5):
        total = mt5.history_deals_total(date_from, date_to)
        if total is None:
            total = 0
        log.info(f"  History warmup attempt {attempt+1}: {total} deals")
        if total == prev_count and total > 0:
            return total
        prev_count = total
        if attempt < 4:
            time.sleep(2)
    return prev_count


def _apply_close_data(trade, d):
    """Apply close deal data to an existing trade record."""
    trade["close_price"] = float(d.price)
    trade["close_time"] = datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat()
    trade["profit"] = float(d.profit)
    trade["swap"] = float(d.swap)
    trade["commission"] = trade.get("commission", 0) + (float(d.commission) if hasattr(d, 'commission') else 0)
    trade["is_open"] = False
    trade["net_profit"] = float(d.profit) + float(d.swap) + trade["commission"]
    try:
        open_dt = datetime.fromisoformat(trade["open_time"])
        close_dt = datetime.fromtimestamp(d.time, tz=timezone.utc)
        trade["duration_seconds"] = int((close_dt - open_dt).total_seconds())
    except:
        pass


def get_closed_deals(since_date):
    date_to = datetime.now(tz=timezone.utc)
    deals = mt5.history_deals_get(since_date, date_to)
    if deals is None or len(deals) == 0:
        return []

    trades = {}
    for d in deals:
        # Skip balance/credit/correction deals (type >= 2)
        if d.type >= 2:
            continue

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
                _apply_close_data(trades[pos_id], d)
            else:
                # OUT without matching IN (trade opened before since_date)
                trades[pos_id] = {
                    "ticket": int(pos_id),
                    "magic": int(d.magic),
                    "symbol": d.symbol,
                    "direction": "sell" if d.type == 0 else "buy",
                    "lots": float(d.volume),
                    "close_price": float(d.price),
                    "close_time": datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat(),
                    "profit": float(d.profit),
                    "swap": float(d.swap),
                    "commission": float(d.commission) if hasattr(d, 'commission') else 0,
                    "net_profit": float(d.profit) + float(d.swap) + (float(d.commission) if hasattr(d, 'commission') else 0),
                    "is_open": False,
                    "_partial": True,  # flag: missing open data
                }
        elif d.entry == 2:  # DEAL_ENTRY_INOUT (position reversal)
            pos_id = d.position_id
            if pos_id in trades:
                _apply_close_data(trades[pos_id], d)
            else:
                trades[pos_id] = {
                    "ticket": int(pos_id),
                    "magic": int(d.magic),
                    "symbol": d.symbol,
                    "direction": "sell" if d.type == 0 else "buy",
                    "lots": float(d.volume),
                    "close_price": float(d.price),
                    "close_time": datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat(),
                    "profit": float(d.profit),
                    "swap": float(d.swap),
                    "commission": float(d.commission) if hasattr(d, 'commission') else 0,
                    "net_profit": float(d.profit) + float(d.swap) + (float(d.commission) if hasattr(d, 'commission') else 0),
                    "is_open": False,
                }

    # Filter: only return completed trades (have close_time)
    result = []
    for t in trades.values():
        if "close_time" in t:
            t.pop("_partial", None)
            result.append(t)
    return result


# ============================================
# DRAWDOWN
# ============================================

def calc_dd(account_size, balance, equity):
    current_value = min(balance, equity)
    total_dd = max(0, (account_size - current_value) / account_size * 100)
    return round(total_dd, 2)


def calc_historical_dd(acc_id, acc_size):
    trades = sb_get("qel_trades", {
        "select": "close_time,net_profit,profit",
        "account_id": f"eq.{acc_id}",
        "is_open": "eq.false",
        "close_time": "not.is.null",
        "order": "close_time.asc"
    })
    if not trades:
        return 0, 0, acc_size

    cum_pl = 0
    peak = acc_size
    max_dd = 0
    equity_peak = acc_size
    for t in trades:
        pl = float(t.get("net_profit") or t.get("profit") or 0)
        cum_pl += pl
        eq = acc_size + cum_pl
        if eq > peak:
            peak = eq
        dd = peak - eq
        if dd > max_dd:
            max_dd = dd
        if eq > equity_peak:
            equity_peak = eq

    max_total_dd_pct = round((max_dd / peak) * 100, 2) if peak > 0 else 0

    from collections import defaultdict
    daily = defaultdict(float)
    for t in trades:
        ct = t.get("close_time", "")
        day = ct[:10] if ct else ""
        if day:
            pl = float(t.get("net_profit") or t.get("profit") or 0)
            daily[day] += pl

    worst_day = min(daily.values()) if daily else 0
    max_daily_dd_pct = round(abs(worst_day) / acc_size * 100, 2) if worst_day < 0 else 0

    return max_total_dd_pct, max_daily_dd_pct, equity_peak


# ============================================
# STRATEGY MAP
# ============================================

def normalize_magic(raw_magic):
    """SQX encodes magic as strategy_magic * 1000 + variant.
    Try raw first (for CSV-imported trades with simple magic),
    then floor(magic/1000) for SQX-encoded 4+ digit magic numbers."""
    return int(raw_magic)


def load_strategy_map():
    strategies = sb_get("qel_strategies", {"select": "id,magic", "org_id": f"eq.{ORG_ID}"})
    base_map = {s["magic"]: s["id"] for s in strategies}
    return base_map


def resolve_strategy(raw_magic, strategy_map):
    """Resolve raw MT5 magic to strategy_id. Tries exact match first,
    then SQX-decoded magic (floor(magic/1000))."""
    m = int(raw_magic)
    if m in strategy_map:
        return m, strategy_map[m]
    # SQX encoding: strategy_magic * 1000 + variant
    if m >= 1000:
        decoded = m // 1000
        if decoded in strategy_map:
            return decoded, strategy_map[decoded]
    return m, None


# ============================================
# SYNC — SINGOLO CONTO
# ============================================

def sync_current_account(account, strategy_map):
    acc_id = account["id"]
    acc_size = float(account.get("account_size", 100000))

    info = get_account_info()
    if not info:
        log.error("Impossibile leggere account info")
        return False

    total_dd = calc_dd(acc_size, info["balance"], info["equity"])
    max_total_dd, max_daily_dd, eq_peak = calc_historical_dd(acc_id, acc_size)

    now = datetime.now(tz=timezone.utc).isoformat()
    sb_patch("qel_accounts", "id", acc_id, {
        "balance": info["balance"],
        "equity": info["equity"],
        "floating_pl": info["floating_pl"],
        "margin_used": info["margin_used"],
        "total_dd_pct": total_dd,
        "equity_peak": eq_peak,
        "max_total_dd_pct": max_total_dd,
        "max_daily_dd_pct": max_daily_dd,
        "last_sync_at": now,
    })
    log.info(f"  Bal=${info['balance']:.2f} Eq=${info['equity']:.2f} Float=${info['floating_pl']:.2f} DD={total_dd:.1f}%")

    sb_insert("qel_account_snapshots", {
        "account_id": acc_id,
        "balance": info["balance"],
        "equity": info["equity"],
        "floating_pl": info["floating_pl"],
        "margin_used": info["margin_used"],
        "total_dd_pct": total_dd,
        "open_trades": len(get_open_positions()),
    })

    positions = get_open_positions()
    log.info(f"  Posizioni aperte: {len(positions)}")
    for pos in positions:
        pos["account_id"] = acc_id
        norm_magic, strat_id = resolve_strategy(pos["magic"], strategy_map)
        pos["magic"] = norm_magic
        if strat_id:
            pos["strategy_id"] = strat_id
        sb_upsert("qel_trades", pos, on_conflict="account_id,ticket")

    # Closed trades
    force_full = FORCE_FULL_IMPORT
    last_sync = account.get("last_sync_at")

    existing_trades = sb_get("qel_trades", {
        "select": "id",
        "account_id": f"eq.{acc_id}",
        "is_open": "eq.false",
    })
    trade_count = len(existing_trades) if existing_trades else 0

    is_full_import = force_full or not last_sync or trade_count < 10
    if is_full_import:
        warmup_history()
        since = datetime.now(tz=timezone.utc) - timedelta(days=HISTORY_DAYS)
        log.info(f"  FULL IMPORT: {trade_count} trade in DB")
    else:
        try:
            since = datetime.fromisoformat(last_sync.replace("Z", "+00:00"))
            since = since - timedelta(hours=1)
        except:
            since = datetime.now(tz=timezone.utc) - timedelta(days=HISTORY_DAYS)

    closed = get_closed_deals(since)
    log.info(f"  Trade chiusi: {len(closed)}")
    for trade in closed:
        trade["account_id"] = acc_id
        norm_magic, strat_id = resolve_strategy(trade["magic"], strategy_map)
        trade["magic"] = norm_magic
        if strat_id:
            trade["strategy_id"] = strat_id
        # Don't overwrite good data with partial records (missing open_price)
        if not is_full_import and trade.get("open_price") in (None, 0):
            existing = sb_get("qel_trades", {
                "select": "open_price",
                "account_id": f"eq.{acc_id}",
                "ticket": f"eq.{trade['ticket']}",
            })
            if existing and existing[0].get("open_price") and float(existing[0]["open_price"]) > 0:
                trade.pop("open_price", None)
                trade.pop("open_time", None)
        sb_upsert("qel_trades", trade, on_conflict="account_id,ticket")

    return True


def update_strategy_real_metrics(strategy_map):
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
            "real_recovery_factor": round(ret_dd, 2),
            "real_ret_dd": round(ret_dd, 2),
            "real_avg_duration_hours": round(avg_dur_hours, 2) if avg_dur_hours else None,
        })
        log.info(f"  M{magic}: {n}t ${total_pl:.2f} Win={win_pct:.1f}%")


# ============================================
# ENRICH
# ============================================

def run_enrich():
    log.info("=" * 50)
    log.info("ENRICH START")

    if not init_mt5():
        return

    try:
        login = get_mt5_login()
        account = find_account_by_login(login)
        if not account:
            log.error(f"Login {login} non trovato in Supabase")
            return

        acc_id = account["id"]
        strategy_map = load_strategy_map()
        log.info(f"Enrich: {account['name']} ({login})")

        date_from = datetime.now(tz=timezone.utc) - timedelta(days=HISTORY_DAYS)
        deals = mt5.history_deals_get(date_from, datetime.now(tz=timezone.utc))
        if not deals:
            log.warning("Nessun deal")
            return

        magic_by_ticket = {}
        magic_by_match = {}
        for d in deals:
            m = int(d.magic)
            if m > 0:
                magic_by_ticket[int(d.position_id)] = m
                if d.entry == 1:
                    key = f"{d.symbol}|{d.time}|{round(float(d.profit), 2)}"
                    magic_by_match[key] = m

        trades_no_magic = sb_get("qel_trades", {
            "select": "id,ticket,symbol,close_time,profit",
            "account_id": f"eq.{acc_id}",
            "or": "(magic.is.null,magic.eq.0)",
        })

        updated = 0
        for t in trades_no_magic:
            ticket = int(t["ticket"])
            magic = magic_by_ticket.get(ticket)
            if not magic and t.get("close_time") and t.get("profit"):
                try:
                    ct = datetime.fromisoformat(t["close_time"].replace("Z", "+00:00"))
                    ct_unix = int(ct.timestamp())
                    profit_r = round(float(t["profit"]), 2)
                    for offset in [0, -1, 1, -2, 2]:
                        key = f"{t['symbol']}|{ct_unix + offset}|{profit_r}"
                        if key in magic_by_match:
                            magic = magic_by_match[key]
                            break
                except:
                    pass
            if magic:
                norm_magic, strat_id = resolve_strategy(magic, strategy_map)
                patch_data = {"magic": norm_magic}
                if strat_id:
                    patch_data["strategy_id"] = strat_id
                sb_patch("qel_trades", "id", t["id"], patch_data)
                updated += 1

        log.info(f"ENRICH: {updated}/{len(trades_no_magic)} aggiornati")
    finally:
        mt5.shutdown()


# ============================================
# MAIN
# ============================================

def run_sync():
    """Single sync cycle. Returns True if successful, False otherwise."""
    log.info("=" * 40)
    if not init_mt5():
        return False

    try:
        login = get_mt5_login()
        account = find_account_by_login(login)
        if not account:
            log.error(f"Login {login} non trovato in Supabase")
            return False

        log.info(f"SYNC: {account['name']} ({login})")
        strategy_map = load_strategy_map()

        if sync_current_account(account, strategy_map):
            try:
                update_strategy_real_metrics(strategy_map)
            except Exception as e:
                log.error(f"Errore metriche: {e}")
            log.info("SYNC OK")
            return True
        else:
            log.error("SYNC FALLITO")
            return False
    finally:
        mt5.shutdown()


if args.mode == "status":
    if not init_mt5():
        sys.exit(1)
    login = get_mt5_login()
    info = get_account_info()
    account = find_account_by_login(login) if login else None
    print(f"\n  MT5 Path:  {MT5_PATH}")
    print(f"  Login:     {login}")
    print(f"  Balance:   ${info['balance']:.2f}" if info else "  No info")
    print(f"  Equity:    ${info['equity']:.2f}" if info else "")
    print(f"  Supabase:  {account['name']}" if account else "  NON TROVATO in Supabase!")
    print()
    mt5.shutdown()
elif args.mode == "once":
    run_sync()
elif args.mode == "resync":
    log.info("=" * 50)
    log.info("RESYNC: forced full reimport with history warmup")
    FORCE_FULL_IMPORT = True
    run_sync()
    log.info("RESYNC DONE")
elif args.mode == "enrich":
    run_enrich()
elif args.mode == "loop":
    log.info(f"Loop: ogni {SYNC_INTERVAL}s | MT5: {MT5_PATH}")
    # Initial connection to set _account_login for heartbeat
    if init_mt5():
        mt5.shutdown()

    while True:
        try:
            # Step 1: Ensure MT5 is connected (reconnect if needed)
            if not ensure_mt5_connection():
                _consecutive_failures += 1
                log.error(f"MT5 offline ({_consecutive_failures}/{MAX_CONSECUTIVE_FAILURES})")
                write_heartbeat("mt5_disconnected")

                if _consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    log.critical(f"Troppe failure consecutive ({_consecutive_failures}). Exit per restart dal launcher.")
                    write_heartbeat("exit_max_failures")
                    try:
                        mt5.shutdown()
                    except Exception:
                        pass
                    sys.exit(1)

                time.sleep(SYNC_INTERVAL)
                continue

            # Step 2: MT5 is alive, shutdown before run_sync (which does its own init)
            try:
                mt5.shutdown()
            except Exception:
                pass

            # Step 3: Run the sync
            success = run_sync()

            if success:
                _consecutive_failures = 0
                write_heartbeat("ok")
            else:
                _consecutive_failures += 1
                log.warning(f"Sync fallito ({_consecutive_failures}/{MAX_CONSECUTIVE_FAILURES})")
                write_heartbeat("sync_error")

                if _consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    log.critical(f"Troppe failure consecutive ({_consecutive_failures}). Exit per restart dal launcher.")
                    write_heartbeat("exit_max_failures")
                    sys.exit(1)

        except Exception as e:
            _consecutive_failures += 1
            log.error(f"Errore loop: {e} ({_consecutive_failures}/{MAX_CONSECUTIVE_FAILURES})")
            write_heartbeat("error", {"error": str(e)})

            if _consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                log.critical(f"Troppe failure consecutive ({_consecutive_failures}). Exit per restart dal launcher.")
                write_heartbeat("exit_max_failures")
                sys.exit(1)

        time.sleep(SYNC_INTERVAL)
