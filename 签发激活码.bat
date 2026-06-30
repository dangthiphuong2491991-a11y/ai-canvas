@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo    AI Canvas  -  Activation Keygen
echo ============================================
echo.
echo Paste the customer's machine code, then press Enter.
echo.
set /p MID=Machine code:
set /p NAME=Customer name (optional):
set /p DAYS=Valid days (blank = forever):
echo.
echo --------------------------------------------
node scripts\keygen.mjs "%MID%" "%NAME%" "%DAYS%"
echo --------------------------------------------
echo.
echo Done. Copy the activation code above and send it to the customer.
echo.
pause
