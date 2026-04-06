"""
VELQOR BRIDGE LAUNCHER v1.0
Lancia un bridge.py per ogni conto configurato su questa VPS.
Monitora i processi e li rilancia se crashano.

Setup:
  1. Configura mt5_terminal_path e vps_name su ogni conto in Supabase
  2. Copia config_local.py con la SUPABASE_SERVICE_KEY
  3. Lancia: python launcher.py --vps VPS1

  Oppure lancia manuale per percorsi specifici:
  python launcher.py --paths "C:\\MT5_10K\\terminal64.exe" "C:\\MT5_80K\\terminal64.exe"
"""

import sys
import os
import time
import subprocess
import logging
import argparse
import signal
from datetime import datetime
from pathlib import Path

import requests

# Config
try:
    from config_local import *
except ImportError:
    from config import *

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
    log.info("VELQOR BRIDGE LAUNCHER v1.0")
    log.info("=" * 50)

    # Determina i percorsi MT5
    if args.paths:
        mt5_paths = args.paths
        log.info(f"Modalità manuale: {len(mt5_paths)} percorsi")
    else:
        log.info(f"Modalità VPS: carico conti per '{args.vps}' da Supabase...")
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
            log.warning(f"⚠️ Non trovato: {p}")

    if not valid_paths:
        log.error("Nessun percorso MT5 valido trovato!")
        return

    log.info(f"\nLancio {len(valid_paths)} bridge:")
    for p in valid_paths:
        log.info(f"  → {p}")
    log.info("")

    # Lancia i processi
    processes = {}  # path -> (proc, last_start)

    for p in valid_paths:
        proc = launch_bridge(p, args.interval)
        processes[p] = (proc, datetime.now())
        folder = Path(p).parent.name
        log.info(f"✅ Avviato bridge [{folder}] PID={proc.pid}")
        time.sleep(2)  # Pausa tra avvii per non sovraccaricare

    # Monitor loop — controlla ogni 10 secondi
    log.info(f"\nMonitoring attivo. {len(processes)} bridge in esecuzione.")
    log.info("Premi Ctrl+C per fermare tutto.\n")

    try:
        while True:
            time.sleep(10)

            for path, (proc, last_start) in list(processes.items()):
                ret = proc.poll()
                if ret is not None:
                    folder = Path(path).parent.name
                    log.warning(f"⚠️ Bridge [{folder}] terminato (exit={ret}). Rilancio tra {args.restart_delay}s...")
                    time.sleep(args.restart_delay)

                    new_proc = launch_bridge(path, args.interval)
                    processes[path] = (new_proc, datetime.now())
                    log.info(f"🔄 Riavviato bridge [{folder}] PID={new_proc.pid}")

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
