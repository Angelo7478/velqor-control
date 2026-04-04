@echo off
color 0A
echo.
echo  ========================================
echo   VELQOR MT5 BRIDGE - Setup Automatico
echo  ========================================
echo.

:: Installa pacchetti Python
echo [1/3] Installazione pacchetti...
pip install MetaTrader5 requests python-dateutil >nul 2>&1

:: Copia in C:\velqor-bridge
echo [2/3] Installazione bridge...
if not exist "C:\velqor-bridge" mkdir "C:\velqor-bridge"
copy /Y "%~dp0bridge.py" "C:\velqor-bridge\" >nul
copy /Y "%~dp0config.py" "C:\velqor-bridge\" >nul
copy /Y "%~dp0config_local.py" "C:\velqor-bridge\" >nul

:: Crea script avvio rapido sul Desktop
echo [3/3] Creazione collegamenti...
echo @echo off > "%USERPROFILE%\Desktop\VELQOR_TEST.bat"
echo cd /d C:\velqor-bridge >> "%USERPROFILE%\Desktop\VELQOR_TEST.bat"
echo python bridge.py once >> "%USERPROFILE%\Desktop\VELQOR_TEST.bat"
echo pause >> "%USERPROFILE%\Desktop\VELQOR_TEST.bat"

echo @echo off > "%USERPROFILE%\Desktop\VELQOR_START.bat"
echo cd /d C:\velqor-bridge >> "%USERPROFILE%\Desktop\VELQOR_START.bat"
echo python bridge.py loop >> "%USERPROFILE%\Desktop\VELQOR_START.bat"

:: Auto-start con Windows
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
echo Set WshShell = CreateObject("WScript.Shell") > "%STARTUP%\velqor_bridge.vbs"
echo WshShell.Run "cmd /c cd /d C:\velqor-bridge && python bridge.py loop", 0 >> "%STARTUP%\velqor_bridge.vbs"

echo.
echo  ========================================
echo   SETUP COMPLETATO!
echo  ========================================
echo.
echo  Sul Desktop trovi:
echo    VELQOR_TEST.bat  = test singolo
echo    VELQOR_START.bat = avvio continuo
echo.
echo  Il bridge si avvia automaticamente
echo  al riavvio di Windows.
echo.
echo  PROSSIMO PASSO:
echo  1. Apri MetaTrader 5
echo  2. Doppio click su VELQOR_TEST.bat
echo.
pause
