@echo off
echo ============================================
echo  VELQOR MT5 BRIDGE - Setup come servizio
echo  Avvio automatico con Windows
echo ============================================
echo.

:: Crea cartella per lo script VBS
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SCRIPT_DIR=%~dp0

:: Crea VBS wrapper per avvio silenzioso
echo Set WshShell = CreateObject("WScript.Shell") > "%STARTUP%\velqor_bridge.vbs"
echo WshShell.Run "cmd /c cd /d %SCRIPT_DIR% && python bridge.py loop", 0 >> "%STARTUP%\velqor_bridge.vbs"

echo Servizio installato!
echo Il bridge si avviera automaticamente al login di Windows.
echo.
echo Per rimuoverlo, cancella: %STARTUP%\velqor_bridge.vbs
echo.
pause
