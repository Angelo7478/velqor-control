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

# History: quanti giorni di storico importare al primo sync
HISTORY_DAYS = 1095  # 3 anni — copre tutto lo storico FTMO

# Forza re-import completo (metti True, lancia bridge, poi rimetti False)
FORCE_FULL_IMPORT = False

# Logging
LOG_FILE = "mt5_bridge.log"
LOG_LEVEL = "INFO"  # DEBUG per piu' dettagli

# ============================================
# RECONNECTION & HEARTBEAT (v2.2)
# ============================================

# MT5 reconnect: tentativi con backoff esponenziale
MT5_RECONNECT_MAX_ATTEMPTS = 5
MT5_RECONNECT_INITIAL_DELAY = 5   # secondi
MT5_RECONNECT_MAX_DELAY = 60      # cap backoff a 60s

# Consecutive failures: dopo N sync falliti il bridge esce (launcher lo rilancia)
MAX_CONSECUTIVE_FAILURES = 3      # 3 * 300s = 15 min di failure -> exit

# Heartbeat: file scritto dopo ogni ciclo, letto dal launcher
# Directory: mt5-bridge/heartbeats/{login}.json
HEARTBEAT_STALE_SECONDS = 720     # 12 min (2 cicli + buffer) — usato dal launcher

# ============================================
# TELEGRAM ALERTS (usato dal launcher)
# ============================================
TELEGRAM_TOKEN = ""               # Compilare in config_local.py
TELEGRAM_CHAT_ID = "503784582"
TELEGRAM_ALERT_COOLDOWN = 600     # 10 min tra alert per stesso account
