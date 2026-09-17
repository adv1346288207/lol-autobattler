@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   UUCard Game - Web Launcher  (you vs 7 AI)
echo ============================================
echo.

rem 1) Ensure dependencies are installed
if not exist "node_modules" (
    echo [1/3] First run: installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Check Node.js and network.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies OK.
)

rem 2) If a server is already listening on 5173, just open the browser
netstat -ano | findstr /c:":5173" | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [2/3] Server already running. Opening browser...
    start "" "http://localhost:5173"
    exit /b 0
)

rem 3) Start the Vite dev server in its own window
echo [2/3] Starting Vite dev server in a new window...
start "uucard-web-server" cmd /k "npm run web"

rem 4) Wait for the server to bind, then open the page
echo [3/3] Opening http://localhost:5173 ...
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo Done. To stop the game, close the "uucard-web-server" window.
exit /b 0
