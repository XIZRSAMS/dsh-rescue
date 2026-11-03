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

"%NODE_EXE%" "%RESCUE_ROOT%scripts\entry.mjs" %*
exit /b %ERRORLEVEL%
