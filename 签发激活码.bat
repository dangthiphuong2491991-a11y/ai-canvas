@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo        AI 画布  -  签发激活码工具
echo ============================================
echo.
set /p MID=请粘贴客户的机器码：
set /p NAME=客户备注名（可留空）：
set /p DAYS=有效天数（留空=永久）：
echo.
echo --------------------------------------------
node scripts\keygen.mjs "%MID%" "%NAME%" "%DAYS%"
echo --------------------------------------------
echo.
echo 把上面「激活码」整段复制发给客户即可。
echo.
pause
