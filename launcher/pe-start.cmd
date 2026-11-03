@echo off
rem dsh-pure · PE launcher shell. All real work happens in pe-boot.mjs.
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%runtime\tmp" mkdir "%ROOT%runtime\tmp" 2>nul
set "TMP=%ROOT%runtime\tmp"
set "TEMP=%ROOT%runtime\tmp"
set "NODE=%ROOT%runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%ROOT%pe-boot.mjs"
echo.
echo [dsh] stopped.
pause