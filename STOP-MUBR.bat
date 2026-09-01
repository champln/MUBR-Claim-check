@echo off
REM ============================================================
REM   MUBR Claim-check  -  stop servers
REM   Stops ONLY MUBR's own ports (8090 backend, 5173 frontend).
REM   Does NOT touch ports 8000/8001 (health-checkup system).
REM ============================================================
echo Stopping MUBR servers (ports 8090 and 5173)...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8090 " ^| findstr LISTENING') do (
    echo   backend  PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " ^| findstr LISTENING') do (
    echo   frontend PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo Done.
timeout /t 3 >nul
