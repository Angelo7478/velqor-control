"""
VELQOR BRIDGE LAUNCHER v2.0
Lancia un bridge.py per ogni conto configurato su questa VPS.
Monitora i processi, controlla heartbeat, forza restart se stale, invia alert Telegram.

v2.0: Heartbeat health check + Telegram alerts + force restart zombie bridges

Setup:
  1. Configura mt5_terminal_path e vps_name su ogni conto in Supabase
  2. Copia config_local.py con la SUPABASE_SERVICE_KEY e TELEGRAM_TOKEN
  3. Lancia: python launcher.py --vps VPS1

  Oppure lancia manuale per percorsi specifici:
  python launcher.py --paths "C:\\MT5_10K\\terminal64.exe" "C:\\MT5_80K\\terminal64.exe"
"""

import sys
import os
import time
import json
import subprocess
import logging
import argparse
import signal
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import requests

# Config
try:
    from config_local import *
except ImportError:
    from config import *

# Defaults for new config keys (backward-compat if config_local.py doesn't have them)
HEARTBEAT_DIR = getattr(sys.modules[__name__], 'HEARTBEAT_DIR', None) or os.path.join(os.path.dirname(os.path.abspath(__file__)), "heartbeats")
HEARTBEAT_STALE_SECONDS = getattr(sys.modules[__name__], 'HEARTBEAT_STALE_SECONDS', 720)
TELEGRAM_TOKEN = getattr(sys.modules[__name__], 'TELEGRAM_TOKEN', "")
TELEGRAM_CHAT_ID = getattr(sys.modules[__name__], 'TELEGRAM_CHAT_ID', "503784582")
TELEGRAM_ALERT_COOLDOWN = getattr(sys.modules[__name__], 'TELEGRAM_ALERT_COOLDOWN', 600)

# Args
parser = argparse.ArgumentParser(description="Velqor Bridge Launcher")
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument("--vps", help="Nome VPS — legge i conti configurati da Supabase")
group.add_argument("--paths", nargs="+", help="Percorsi terminal64.exe da lanciare")
parser.add_argument("--interval", type=int, default=300, help="Sync interval per bridge (default 300s)")
parser.add_argument("--restart-delay", type=int, default=30, help="Secondi prima di rilanciare un bridge crashato")
args = parser.parse_args()

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [LAUNCHER] %(message)s",
    handlers=[
        logging.FileHandler("launcher.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("launcher")

# Supabase
HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}
API = f"{SUPABASE_URL}/rest/v1"


def get_mt5_paths_from_supabase(vps_name):
    """Legge i percorsi MT5 dai conti configurati per questa VPS."""
    r = requests.get(
        f"{API}/qel_accounts",
        headers=HEADERS,
        params={
            "select": "id,name,login,mt5_terminal_path,vps_name",
            "vps_name": f"eq.{vps_name}",
            "status": "eq.active",
            "mt5_terminal_path": "not.is.null",
        }
    )
    r.raise_for_status()
    accounts = r.json()

    paths = []
    for acc in accounts:
        p = acc.get("mt5_terminal_path")
        if p:
            paths.append(p)
            log.info(f"  Trovato: {acc['name']} → {p}")

    return paths


def scan_mt5_installations():
    """Cerca installazioni MT5 comuni su Windows."""
    common_paths = [
        r"C:\Program Files\MetaTrader 5\terminal64.exe",
        r"C:\Program Files (x86)\MetaTrader 5\terminal64.exe",
    ]
    # Cerca cartelle MT5_* in C:\
    try:
        for item in Path("C:\\").iterdir():
            if item.is_dir() and "mt5" in item.name.lower():
                t = item / "terminal64.exe"
                if t.exists():
                    common_paths.append(str(t))
    except:
        pass

    found = [p for p in common_paths if Path(p).exists()]
    return found


# ============================================
# TELEGRAM ALERTS
# ============================================

_last_alert_time = {}  # path -> timestamp


def send_telegram(message):
    """Send Telegram alert. Fire-and-forget, never crashes the launcher."""
    if not TELEGRAM_TOKEN:
        log.warning("TELEGRAM_TOKEN non configurato — alert non inviato")
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        data = json.dumps({
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "Markdown"
        }).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        log.info(f"Telegram alert inviato")
    except Exception as e:
        log.error(f"Telegram alert fallito: {e}")


def should_alert(path):
    """Throttle: max 1 alert per bridge ogni TELEGRAM_ALERT_COOLDOWN secondi."""
    last = _last_alert_time.get(path, 0)
    if time.time() - last > TELEGRAM_ALERT_COOLDOWN:
        _last_alert_time[path] = time.time()
        return True
    return False


# ============================================
# HEARTBEAT HEALTH CHECK
# ============================================

def check_heartbeat(mt5_path):
    """Read heartbeat file for a bridge. Returns (is_healthy, heartbeat_data_or_None)."""
    # Find heartbeat file by matching mt5_path
    try:
        if not os.path.isdir(HEARTBEAT_DIR):
            return True, None  # no heartbeat dir yet = just started
        for fname in os.listdir(HEARTBEAT_DIR):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(HEARTBEAT_DIR, fname)
            try:
                with open(fpath, "r") as f:
                    data = json.load(f)
            except Exception:
                continue
            if data.get("mt5_path") != mt5_path:
                continue
            # Found matching heartbeat
            ts_str = data.get("timestamp", "")
            try:
                ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                age = (datetime.now(tz=timezone.utc) - ts).total_seconds()
            except Exception:
                age = 99999
            if age > HEARTBEAT_STALE_SECONDS:
                return False, {"reason": "stale", "age_seconds": int(age), **data}
            if data.get("consecutive_failures", 0) >= 2:
                return False, {"reason": "failing", **data}
            return True, data
    except Exception as e:
        log.error(f"Heartbeat check error: {e}")
    return True, None  # default healthy if can't read


# ============================================
# BRIDGE PROCESS MANAGEMENT
# ============================================

def launch_bridge(mt5_path, interval):
    """Lancia un processo bridge.py per un terminale MT5."""
    cmd = [
        sys.executable, "bridge.py",
        "--mt5-path", mt5_path,
        "--interval", str(interval),
        "loop"
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
        universal_newlines=True,
        cwd=os.path.dirname(os.path.abspath(__file__))
    )
    return proc


def main():
    log.info("=" * 50)
    log.info("VELQOR BRIDGE LAUNCHER v2.0")
    log.info("=" * 50)

    # Determina i percorsi MT5
    if args.paths:
        mt5_paths = args.paths
        log.info(f"Modalita' manuale: {len(mt5_paths)} percorsi")
    else:
        log.info(f"Modalita' VPS: carico conti per '{args.vps}' da Supabase...")
        mt5_paths = get_mt5_paths_from_supabase(args.vps)
        if not mt5_paths:
            log.warning(f"Nessun conto configurato per VPS '{args.vps}'")
            log.info("Scansione installazioni MT5 locali...")
            mt5_paths = scan_mt5_installations()
            if mt5_paths:
                log.info(f"Trovate {len(mt5_paths)} installazioni: {mt5_paths}")
                log.info("Configura mt5_terminal_path e vps_name sui conti in Supabase")
            else:
                log.error("Nessuna MT5 trovata. Usa --paths per specificare i percorsi.")
            return

    # Verifica che i percorsi esistano
    valid_paths = []
    for p in mt5_paths:
        if Path(p).exists():
            valid_paths.append(p)
        else:
            log.warning(f"Non trovato: {p}")

    if not valid_paths:
        log.error("Nessun percorso MT5 valido trovato!")
        return

    log.info(f"\nLancio {len(valid_paths)} bridge:")
    for p in valid_paths:
        log.info(f"  -> {p}")
    log.info("")

    # Lancia i processi
    processes = {}       # path -> (proc, launch_time)
    restart_count = {}   # path -> number of restarts
    was_alerting = {}    # path -> True if we sent an alert (for recovery msg)

    GRACE_PERIOD = args.interval * 2  # don't check heartbeat for first 2 cycles

    for p in valid_paths:
        proc = launch_bridge(p, args.interval)
        processes[p] = (proc, time.time())
        restart_count[p] = 0
        was_alerting[p] = False
        folder = Path(p).parent.name
        log.info(f"Avviato bridge [{folder}] PID={proc.pid}")
        time.sleep(2)

    # Monitor loop — controlla ogni 10 secondi
    log.info(f"\nMonitoring attivo. {len(processes)} bridge in esecuzione.")
    log.info(f"Heartbeat check: stale > {HEARTBEAT_STALE_SECONDS}s | Grace period: {GRACE_PERIOD}s")
    log.info(f"Telegram alerts: {'configurato' if TELEGRAM_TOKEN else 'NON configurato (compilare TELEGRAM_TOKEN in config_local.py)'}")
    log.info("Premi Ctrl+C per fermare tutto.\n")

    try:
        while True:
            time.sleep(10)

            for path, (proc, launch_ts) in list(processes.items()):
                folder = Path(path).parent.name
                ret = proc.poll()

                # Case 1: Process died
                if ret is not None:
                    restart_count[path] = restart_count.get(path, 0) + 1
                    log.warning(f"Bridge [{folder}] terminato (exit={ret}, restart #{restart_count[path]}). Rilancio tra {args.restart_delay}s...")

                    if should_alert(path):
                        send_telegram(f"*BRIDGE CRASH* [{folder}]\nExit code: {ret}\nRestart #{restart_count[path]} in corso...")
                        was_alerting[path] = True

                    time.sleep(args.restart_delay)
                    new_proc = launch_bridge(path, args.interval)
                    processes[path] = (new_proc, time.time())
                    log.info(f"Riavviato bridge [{folder}] PID={new_proc.pid}")
                    continue

                # Case 2: Process alive — check heartbeat (after grace period)
                age_since_launch = time.time() - launch_ts
                if age_since_launch < GRACE_PERIOD:
                    continue  # still in grace period, skip heartbeat check

                healthy, hb_data = check_heartbeat(path)

                if healthy:
                    # If we were alerting before, send recovery
                    if was_alerting.get(path, False):
                        send_telegram(f"*BRIDGE OK* [{folder}]\nRiconnesso e funzionante.")
                        was_alerting[path] = False
                    continue

                # Unhealthy bridge — force restart
                reason = hb_data.get("reason", "unknown") if hb_data else "no_heartbeat"
                age = hb_data.get("age_seconds", "?") if hb_data else "?"
                failures = hb_data.get("consecutive_failures", "?") if hb_data else "?"
                restart_count[path] = restart_count.get(path, 0) + 1

                log.warning(f"Bridge [{folder}] unhealthy (reason={reason}, age={age}s, failures={failures}). Force kill + restart #{restart_count[path]}...")

                if should_alert(path):
                    send_telegram(f"*BRIDGE RESTART* [{folder}]\nMotivo: {reason}\nHeartbeat age: {age}s\nFailure consecutive: {failures}\nRestart #{restart_count[path]}")
                    was_alerting[path] = True

                try:
                    proc.kill()
                    proc.wait(timeout=5)
                except Exception:
                    pass

                time.sleep(args.restart_delay)
                new_proc = launch_bridge(path, args.interval)
                processes[path] = (new_proc, time.time())
                log.info(f"Riavviato bridge [{folder}] PID={new_proc.pid}")

    except KeyboardInterrupt:
        log.info("\nShutdown richiesto...")
        for path, (proc, _) in processes.items():
            folder = Path(path).parent.name
            log.info(f"  Fermando [{folder}] PID={proc.pid}...")
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        log.info("Tutti i bridge fermati. Bye!")


if __name__ == "__main__":
    main()
