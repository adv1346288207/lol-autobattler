@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   UUCard Game - AI Batch Simulation
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

echo Running 100 all-AI games (stats: avg time / avg rounds / win distribution)...
echo.
call npm run sim -- --batch 100
echo.
pause
