# VELQOR MT5 Bridge — Guida Setup VPS

## Prerequisiti
- VPS Windows con accesso RDP
- MT5 installato e loggato con investor password
- Conti FTMO gia inseriti nella Control Room (control.velqor.it > Quant > Conti)

---

## STEP 1: Installa Python

Apri **PowerShell** (tasto destro Start > Windows PowerShell) e incolla:

```powershell
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe" -OutFile "$env:TEMP\python.exe"
```

Poi installa (con PATH automatico):

```powershell
Start-Process "$env:TEMP\python.exe" -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait
```

**Chiudi e riapri PowerShell**, poi verifica:

```powershell
python --version
```

Deve mostrare `Python 3.12.9`.

---

## STEP 2: Installa librerie

```powershell
pip install MetaTrader5 requests
```

---

## STEP 3: Crea cartella bridge

```powershell
New-Item -ItemType Directory -Force -Path "C:\velqor-bridge"
```

---

## STEP 4: Scarica i file del bridge

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Angelo7478/velqor-control/main/mt5-bridge/bridge.py" -OutFile "C:\velqor-bridge\bridge.py"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Angelo7478/velqor-control/main/mt5-bridge/config.py" -OutFile "C:\velqor-bridge\config.py"
```

Se `Invoke-WebRequest` non funziona, usa Chrome:
1. Vai a: https://raw.githubusercontent.com/Angelo7478/velqor-control/main/mt5-bridge/bridge.py
2. Ctrl+S > salva in `C:\velqor-bridge\bridge.py`
3. Ripeti per config.py: https://raw.githubusercontent.com/Angelo7478/velqor-control/main/mt5-bridge/config.py

---

## STEP 5: Crea config_local.py

Questo file contiene la chiave segreta e NON va su GitHub.

```powershell
notepad C:\velqor-bridge\config_local.py
```

Incolla questo contenuto:

```python
SUPABASE_URL = "https://gotbfzdgasuvfskzeycm.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvdGJmemRnYXN1dmZza3pleWNtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzcyNywiZXhwIjoyMDg4MjI5NzI3fQ.WAUWrMjOxZEnRTZUWwKcdpNl2ja2CPYT2lwliDF2n5g"
ORG_ID = "a0000000-0000-0000-0000-000000000001"
MT5_PATH = ""
SYNC_INTERVAL = 300
HISTORY_DAYS = 1095
FORCE_FULL_IMPORT = False
LOG_FILE = "mt5_bridge.log"
LOG_LEVEL = "INFO"
```

Salva e chiudi.

---

## STEP 6: Configura MT5

1. Apri MetaTrader 5
2. Per OGNI conto FTMO su questa VPS:
   - File > Login to Trade Account
   - Inserisci login + investor password + server
   - Vai alla tab **History** in basso
   - Tasto destro > **All History** (per caricare tutto lo storico)

**Nota:** Puoi avere piu conti sulla stessa VPS. Il bridge si connette a ognuno in sequenza.

---

## STEP 7: Test singolo

```powershell
cd C:\velqor-bridge
python bridge.py once
```

Deve mostrare:
```
SYNC START
MT5 initialized: FTMO Global Markets...
Conti attivi trovati: 2    (o quanti ne hai su questa VPS)
  Connessione a FTMO 100K #1...
  Account: balance=$107375.63 equity=$107375.63...
  FULL IMPORT: 0 trade in DB, scarico storico da 2023-...
  Trade chiusi (da 2023-...): 384
SYNC COMPLETATO: 2/2 conti sincronizzati
```

---

## STEP 8: Avvio continuo (loop ogni 5 min)

```powershell
cd C:\velqor-bridge
python bridge.py loop
```

Oppure crea un collegamento sul Desktop:
1. Tasto destro Desktop > Nuovo > Collegamento
2. Percorso: `python C:\velqor-bridge\bridge.py loop`
3. Nome: `VELQOR Bridge`

---

## STEP 9: Auto-avvio al boot (opzionale)

```powershell
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\VelqorBridge.lnk")
$Shortcut.TargetPath = "python"
$Shortcut.Arguments = "C:\velqor-bridge\bridge.py loop"
$Shortcut.WorkingDirectory = "C:\velqor-bridge"
$Shortcut.Save()
```

---

## Comandi utili

| Comando | Cosa fa |
|---------|---------|
| `python bridge.py once` | Sync singolo (test) |
| `python bridge.py loop` | Loop continuo ogni 5 min |
| `python bridge.py enrich` | Aggiorna magic number sui trade importati da CSV |
| `type mt5_bridge.log` | Vedi log |
| `del mt5_bridge.log` | Pulisci log |

---

## Aggiornare il Bridge

Quando viene rilasciata una nuova versione del bridge, aggiorna così:

### 1. Ferma il bridge
Chiudi la finestra PowerShell dove gira `python bridge.py loop` (oppure Ctrl+C).

### 2. Scarica i file aggiornati

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Angelo7478/velqor-control/main/mt5-bridge/bridge.py" -OutFile "C:\velqor-bridge\bridge.py"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Angelo7478/velqor-control/main/mt5-bridge/config.py" -OutFile "C:\velqor-bridge\config.py"
```

**Nota:** `config_local.py` NON va riscaricato — contiene le tue chiavi locali e non è su GitHub.

### 3. Verifica con un test

```powershell
cd C:\velqor-bridge
python bridge.py once
```

### 4. Riavvia il loop

```powershell
python bridge.py loop
```

### Comando rapido (tutto in una riga)

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Angelo7478/velqor-control/main/mt5-bridge/bridge.py" -OutFile "C:\velqor-bridge\bridge.py"; Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Angelo7478/velqor-control/main/mt5-bridge/config.py" -OutFile "C:\velqor-bridge\config.py"; cd C:\velqor-bridge; python bridge.py once
```

---

## Troubleshooting

**"Conti attivi trovati: 0"**
- I conti devono avere status "active" nella Control Room
- Verifica che i conti siano inseriti su control.velqor.it > Quant > Gestisci conti

**"MT5 login failed"**
- Verifica investor password nella Control Room
- Verifica che MT5 sia aperto e connesso
- Verifica il nome server (es. FTMO-Server, FTMO-Server4)

**"MT5 initialize failed"**
- MT5 deve essere aperto
- Se hai piu terminali, specifica il path in config_local.py:
  `MT5_PATH = "C:\\Program Files\\FTMO Global Markets MT5 Terminal\\terminal64.exe"`

**Solo pochi trade importati (es. 76 invece di 384)**
- In MT5 > tab History > tasto destro > "All History"
- Rilancia il bridge

**"python non trovato"**
- Chiudi e riapri PowerShell dopo l'installazione
- Oppure usa il path completo: `C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe`

---

## Note

- Il bridge legge TUTTI i conti dalla Control Room, non solo quelli di questa VPS
- Ogni VPS sincronizza solo i conti per cui ha MT5 loggato
- Se un conto non ha MT5 loggato su questa VPS, il bridge lo salta
- I dati sono read-only: il bridge non esegue trade, solo lettura
- Puoi avere 1, 2, 5 conti sulla stessa VPS — non cambia nulla
