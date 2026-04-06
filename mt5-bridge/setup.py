"""
VELQOR BRIDGE SETUP
Configura una VPS in 2 minuti:
  1. Rileva le MT5 installate
  2. Si connette a ognuna e legge il login
  3. Associa i conti a Supabase
  4. Salva mt5_terminal_path e vps_name nel DB
  5. Crea il file di avvio automatico

Uso: python setup.py
"""

import sys
import os
import socket
from pathlib import Path
from datetime import datetime, timezone

try:
    import MetaTrader5 as mt5
except ImportError:
    print("ERRORE: pip install MetaTrader5")
    sys.exit(1)

import requests

try:
    from config_local import *
except ImportError:
    from config import *

HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}
API = f"{SUPABASE_URL}/rest/v1"

def find_mt5_terminals():
    """Cerca tutte le installazioni MT5 sul sistema."""
    terminals = []

    # Cerca in percorsi comuni
    search_roots = [Path("C:\\")]

    for root in search_roots:
        try:
            for item in root.iterdir():
                if item.is_dir():
                    t = item / "terminal64.exe"
                    if t.exists():
                        terminals.append(str(t))
                    # Cerca anche in sottocartelle Program Files
                    if "program" in item.name.lower():
                        try:
                            for sub in item.iterdir():
                                if sub.is_dir() and "metatrader" in sub.name.lower():
                                    t = sub / "terminal64.exe"
                                    if t.exists():
                                        terminals.append(str(t))
                        except PermissionError:
                            pass
        except PermissionError:
            pass

    return list(set(terminals))


def probe_terminal(path):
    """Connette a un terminale MT5 e legge login/server."""
    if not mt5.initialize(path=path):
        return None
    info = mt5.account_info()
    if info is None:
        mt5.shutdown()
        return None
    result = {
        "login": str(info.login),
        "server": info.server,
        "balance": float(info.balance),
        "name": info.name,
    }
    mt5.shutdown()
    return result


def main():
    print("\n" + "=" * 50)
    print("  VELQOR BRIDGE SETUP")
    print("=" * 50)

    if not SUPABASE_SERVICE_KEY:
        print("\n⚠️  SUPABASE_SERVICE_KEY non configurata!")
        print("   Crea config_local.py con la chiave.")
        sys.exit(1)

    # 1. Rileva VPS name
    vps_name = input(f"\nNome per questa VPS [{socket.gethostname()}]: ").strip()
    if not vps_name:
        vps_name = socket.gethostname()
    print(f"  VPS: {vps_name}")

    # 2. Cerca MT5
    print("\n🔍 Ricerca installazioni MT5...")
    terminals = find_mt5_terminals()

    if not terminals:
        print("  Nessuna MT5 trovata automaticamente.")
        print("  Inserisci i percorsi manualmente (uno per riga, riga vuota per finire):")
        while True:
            p = input("  Percorso: ").strip()
            if not p:
                break
            if Path(p).exists():
                terminals.append(p)
            else:
                print(f"    ⚠️ Non trovato: {p}")

    if not terminals:
        print("Nessun terminale MT5 configurato. Uscita.")
        sys.exit(1)

    print(f"\n📋 Trovati {len(terminals)} terminali:")
    for t in terminals:
        print(f"  → {t}")

    # 3. Probe ogni terminale
    print("\n🔌 Connessione ai terminali...")
    mappings = []  # (path, login, server, balance, supabase_account)

    for path in terminals:
        folder = Path(path).parent.name
        print(f"\n  [{folder}] {path}")

        info = probe_terminal(path)
        if not info:
            print(f"    ❌ Non connesso o nessun conto loggato")
            continue

        print(f"    ✅ Login: {info['login']} @ {info['server']} | Balance: ${info['balance']:.2f}")

        # Cerca in Supabase
        r = requests.get(
            f"{API}/qel_accounts",
            headers={**HEADERS, "Prefer": "return=representation"},
            params={"login": f"eq.{info['login']}", "org_id": f"eq.{ORG_ID}"}
        )
        accounts = r.json() if r.status_code == 200 else []

        if accounts:
            acc = accounts[0]
            print(f"    📦 Supabase: {acc['name']} ({acc['id'][:8]}...)")
            mappings.append((path, info['login'], info['server'], info['balance'], acc))
        else:
            print(f"    ⚠️ Login {info['login']} NON trovato in Supabase!")
            print(f"       Registra prima il conto nel dashboard.")

    if not mappings:
        print("\n❌ Nessun conto da configurare.")
        sys.exit(1)

    # 4. Salva su Supabase
    print(f"\n💾 Salvataggio configurazione su Supabase...")
    for path, login, server, balance, acc in mappings:
        r = requests.patch(
            f"{API}/qel_accounts?id=eq.{acc['id']}",
            headers={**HEADERS, "Prefer": "return=minimal"},
            json={
                "mt5_terminal_path": path,
                "vps_name": vps_name,
            }
        )
        if r.status_code in (200, 204):
            print(f"  ✅ {acc['name']} → {Path(path).parent.name} @ {vps_name}")
        else:
            print(f"  ❌ Errore: {r.status_code} {r.text}")

    # 5. Crea script di avvio
    bat_content = f'@echo off\ntitle Velqor Bridge Launcher - {vps_name}\ncd /d "%~dp0"\npython launcher.py --vps {vps_name}\npause\n'

    bat_file = Path(__file__).parent / f"start_{vps_name}.bat"
    bat_file.write_text(bat_content)
    print(f"\n📝 Creato: {bat_file.name}")

    # 6. Crea shortcut per startup
    startup_bat = Path(__file__).parent / f"start_{vps_name}_startup.bat"
    startup_content = f'@echo off\ncd /d "{Path(__file__).parent}"\nstart "Velqor Launcher" python launcher.py --vps {vps_name}\n'
    startup_bat.write_text(startup_content)
    print(f"📝 Creato: {startup_bat.name}")
    print(f"   → Copia in shell:startup per avvio automatico al boot")

    # Riepilogo
    print(f"\n{'=' * 50}")
    print(f"  SETUP COMPLETATO!")
    print(f"{'=' * 50}")
    print(f"  VPS:       {vps_name}")
    print(f"  Conti:     {len(mappings)}")
    for path, login, _, _, acc in mappings:
        print(f"  • {acc['name']} → {Path(path).parent.name}")
    print(f"\n  Per avviare: python launcher.py --vps {vps_name}")
    print(f"  Oppure:     {bat_file.name}")
    print()


if __name__ == "__main__":
    main()
