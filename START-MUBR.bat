@echo off
REM ============================================================
REM   MUBR Claim-check  -  one-click launcher
REM   Backend  (FastAPI/uvicorn) : http://127.0.0.1:8090
REM   Frontend (Vite)            : http://127.0.0.1:5173
REM   Login: admin / admin1234
REM   NOTE: ports 8000/8001 belong to the health-checkup system - do NOT use them.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   MUBR Claim-check - starting servers...
echo   Backend : http://127.0.0.1:8090
echo   Frontend: http://127.0.0.1:5173
echo ============================================================
echo.

REM --- Backend (own window, uses project venv) ---
start "MUBR Backend (8090)" /D "%~dp0backend" cmd /k venv\Scripts\python.exe -m uvicorn main:app --port 8090 --host 127.0.0.1

REM --- Frontend (own window; vite proxy defaults to 8090) ---
start "MUBR Frontend (5173)" /D "%~dp0frontend" cmd /k npm run dev -- --port 5173 --host 127.0.0.1

echo Waiting ~10s for servers to warm up, then opening the browser...
timeout /t 10 /nobreak >nul
start "" http://127.0.0.1:5173

echo.
echo Done. Browser opened at http://127.0.0.1:5173  (login: admin / admin1234)
echo Two server windows are now running. To STOP: close them, or run STOP-MUBR.bat
echo.
timeout /t 6 >nul
