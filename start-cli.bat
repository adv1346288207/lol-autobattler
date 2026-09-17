@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   UUCard Game - CLI  (you vs 7 AI)
echo ============================================
echo.

if not exist "node_modules" (
    echo First run: installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

echo Commands:
echo   buy 0^|1^|2   buy shop slot
echo   sell ^<uid^>   sell a card
echo   refresh     refresh shop (1 gold)
echo   up          upgrade shop
echo   place ^<uid^> ^<1-6^>   place/swap a card on board
echo   end         finish shop phase
echo   help / quit
echo.
call npm run sim
pause
