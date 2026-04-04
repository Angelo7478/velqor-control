@echo off
echo ============================================
echo  VELQOR MT5 BRIDGE - Installazione
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRORE: Python non trovato. Installalo da python.org
    pause
    exit /b 1
)

:: Install dependencies
echo Installazione dipendenze...
pip install -r requirements.txt
echo.

:: Create config_local.py if not exists
if not exist config_local.py (
    echo Creazione config_local.py...
    copy config.py config_local.py
    echo.
    echo IMPORTANTE: Modifica config_local.py con la tua SUPABASE_SERVICE_KEY
    echo La trovi in: Supabase Dashboard ^> Settings ^> API ^> service_role
    echo.
)

echo ============================================
echo  Installazione completata!
echo ============================================
echo.
echo Prossimi passi:
echo 1. Modifica config_local.py con la service_role key
echo 2. Configura login e server MT5 nei conti su control.velqor.it
echo 3. Esegui: python bridge.py once    (test singolo)
echo 4. Esegui: python bridge.py loop    (monitoraggio continuo)
echo.
pause
