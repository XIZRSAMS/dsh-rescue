@echo off
rem dsh-pure · start the kernel, then open a browser (bundled or system default).
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
if not exist "%ROOT%runtime\tmp" mkdir "%ROOT%runtime\tmp" 2>nul
set "TMP=%ROOT%runtime\tmp"
set "TEMP=%ROOT%runtime\tmp"
set "DSH_HOME=%ROOT%runtime\home"
set "NODE=%ROOT%runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
if not exist "%ROOT%runtime\logs" mkdir "%ROOT%runtime\logs"
set "LOG=%ROOT%runtime\logs\web.log"

set "HOST=127.0.0.1"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do if "%HOST%"=="127.0.0.1" set "HOST=%%a"
set "HOST=%HOST: =%"

echo [dsh] starting kernel...
start "dsh-kernel" /min "%NODE%" "%ROOT%runtime\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --host %HOST% --port 3080 --no-open > "%LOG%" 2>&1

set "TOKEN="
for /l %%i in (1,1,90) do (
  if not defined TOKEN (
    for /f "tokens=2 delims==" %%t in ('findstr /c:"token=" "%LOG%" 2^>nul') do set "TOKEN=%%t"
    if not defined TOKEN ping -n 2 127.0.0.1 >nul
  )
)

set "URL=http://127.0.0.1:3080/"
if defined TOKEN set "URL=http://127.0.0.1:3080/?token=%TOKEN%"
echo [dsh] local: %URL%
echo [dsh] LAN:   http://%HOST%:3080/?token=%TOKEN%

if exist "%ROOT%browser\Palemoon-Portable.exe" (
  echo [dsh] opening bundled Palemoon...
  start "" "%ROOT%browser\Palemoon-Portable.exe" "%URL%"
) else (
  echo [dsh] opening default browser...
  start "" "%URL%"
)

echo.
echo [dsh] keep this window open; close it to stop the kernel.
pause