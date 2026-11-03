@echo off
rem dsh-pure · PE probe. Read-only: writes only under logs\ and runtime\tmp.
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%logs" mkdir "%ROOT%logs" 2>nul
if not exist "%ROOT%runtime\tmp" mkdir "%ROOT%runtime\tmp" 2>nul
set "LOG=%ROOT%logs\pe-probe.txt"
set "NODE=%ROOT%runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
set "TMP=%ROOT%runtime\tmp"
set "TEMP=%ROOT%runtime\tmp"

echo === dsh PE probe === > "%LOG%"
echo date: %DATE% %TIME% >> "%LOG%"
echo windir: %WINDIR% >> "%LOG%"
echo tmp: %TMP% >> "%LOG%"
echo. >> "%LOG%"

echo --- node -v >> "%LOG%"
"%NODE%" -v >> "%LOG%" 2>&1

echo --- modules >> "%LOG%"
"%NODE%" -e "console.log('arith',1+1);console.log('os',require('os').platform(),require('os').release());require('fs');require('net');require('http');require('crypto');console.log('modules ok')" >> "%LOG%" 2>&1

echo --- crypto rng >> "%LOG%"
"%NODE%" -e "console.log('rng',require('crypto').randomBytes(8).toString('hex'))" >> "%LOG%" 2>&1

echo --- http listen >> "%LOG%"
"%NODE%" -e "const s=require('http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>{console.log('listen',s.address().port);s.close()})" >> "%LOG%" 2>&1

echo --- fs write >> "%LOG%"
"%NODE%" -e "require('fs').writeFileSync(process.env.TMP+'\\probe.txt','x');console.log('fs write ok')" >> "%LOG%" 2>&1

echo --- network >> "%LOG%"
"%NODE%" -e "const n=require('os').networkInterfaces();for(const k in n){for(const i of n[k]){if(i.family==='IPv4' && i.internal===false){console.log('ip',k,i.address)}}}" >> "%LOG%" 2>&1

type "%LOG%"
echo.
echo saved: %LOG%
pause