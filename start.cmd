@echo off
rem dsh-rescue · static launcher (hand-written, no machine-specific path).
rem Machine-specific values are generated into runtime\start.cmd by setup.mjs.
setlocal
set "RESCUE_ROOT=%~dp0"
if not defined DSH_HOME set "DSH_HOME=%RESCUE_ROOT%runtime\home"
if not defined DSH_RESCUE_PROFILE set "DSH_RESCUE_PROFILE=rescue"
if not defined DSH_RESCUE_UI set "DSH_RESCUE_UI=minimal"

set "NODE_EXE=node"
if exist "%RESCUE_ROOT%runtime\node\node.exe" set "NODE_EXE=%RESCUE_ROOT%runtime\node\node.exe"

rem PE / 受限环境里 %TMP% 常常不可写：把临时目录钉在包内
if not exist "%RESCUE_ROOT%runtime\tmp" mkdir "%RESCUE_ROOT%runtime\tmp" 2>nul
set "TMP=%RESCUE_ROOT%runtime\tmp"
set "TEMP=%RESCUE_ROOT%runtime\tmp"

"%NODE_EXE%" "%RESCUE_ROOT%scripts\entry.mjs" %*
exit /b %ERRORLEVEL%
