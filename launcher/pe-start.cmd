@echo off
rem dsh-pure · start the kernel, then open a browser (bundled or system default).
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
if not exist "%ROOT%runtime\tmp" mkdir "%ROOT%runtime\tmp" 2>nul
if not exist "%ROOT%runtime\logs" mkdir "%ROOT%runtime\logs" 2>nul
set "TMP=%ROOT%runtime\tmp"
set "TEMP=%ROOT%runtime\tmp"
set "DSH_HOME=%ROOT%runtime\home"
set "NODE=%ROOT%runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
set "LOG=%ROOT%runtime\logs\web.log"

echo [dsh] node=%NODE%
echo [dsh] home=%DSH_HOME%
echo [dsh] starting kernel...
start "dsh-kernel" /min "%NODE%" "%ROOT%runtime\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --host 127.0.0.1 --port 3080 --no-open > "%LOG%" 2>&1

set "TOKEN="
for /l %%i in (1,1,90) do (
  if not defined TOKEN (
    for /f "tokens=2 delims==" %%t in ('findstr /c:"token=" "%LOG%" 2^>nul') do set "TOKEN=%%t"
    if not defined TOKEN ping -n 2 127.0.0.1 >nul
  )
)

if not defined TOKEN (
  echo.
  echo [dsh] WARNING: kernel did not report a token in 90s.
  echo [dsh] ---- kernel log ----
  type "%LOG%"
  echo [dsh] --------------------
  echo.
  echo [dsh] copy the log above and send it back.
  pause
  exit /b 1
)

set "URL=http://127.0.0.1:3080/?token=%TOKEN%"
echo [dsh] url: %URL%

if exist "%ROOT%browser\Palemoon-Portable.exe" (
  echo [dsh] opening bundled browser...
  start "" "%ROOT%browser\Palemoon-Portable.exe" "%URL%"
) else (
  echo [dsh] opening default browser...
  start "" "%URL%"
)

echo.
echo [dsh] keep this window open. close it to stop.
pause