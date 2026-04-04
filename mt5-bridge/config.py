# ============================================
# VELQOR MT5 BRIDGE — Configurazione
# ============================================
# Copia questo file come config_local.py e compila i valori
# config_local.py e' nel .gitignore

# Supabase
SUPABASE_URL = "https://gotbfzdgasuvfskzeycm.supabase.co"
SUPABASE_SERVICE_KEY = ""  # Service Role Key da Supabase Dashboard > Settings > API

# MT5 Terminal path (opzionale, auto-detect se vuoto)
MT5_PATH = ""  # es. "C:\\Program Files\\MetaTrader 5\\terminal64.exe"

# Intervallo sync in secondi (300 = 5 min)
SYNC_INTERVAL = 300

# Org ID Velqor
ORG_ID = "a0000000-0000-0000-0000-000000000001"

# Logging
LOG_FILE = "mt5_bridge.log"
LOG_LEVEL = "INFO"  # DEBUG per piu' dettagli
