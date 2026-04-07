@echo off
REM === Velqor Bridge — Sync giornaliero VPS 80K ===
REM Mettere in Windows Task Scheduler: 1 volta al giorno (es. ore 23:00)
REM Azione: Avvia programma -> questo file .bat

cd /d C:\mt5-bridge
python bridge.py --mt5-path "C:\Program Files\FTMO MetaTrader 5\terminal64.exe" once

if %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] ERRORE sync 80K >> C:\mt5-bridge\sync_log.txt
) else (
    echo [%date% %time%] Sync 80K OK >> C:\mt5-bridge\sync_log.txt
)
