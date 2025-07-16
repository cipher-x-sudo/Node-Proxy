@echo off
set PORT=3000

REM Find the PID using the port
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%PORT% ^| findstr LISTENING') do (
    set PID=%%a
)

REM Kill the process if PID is set
if defined PID (
    echo Killing process on port %PORT% (PID: %PID%)
    taskkill /PID %PID% /F
) else (
    echo No process found on port %PORT%
)

REM Start the proxy server
cd /d "%~dp0node\src"
node proxy.js
pause 