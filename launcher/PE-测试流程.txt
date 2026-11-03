@echo off
rem dsh-pure · network check. Tells you whether the PE has a working route out.
setlocal
set "ROOT=%~dp0"
set "NODE=%ROOT%runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
set "TMP=%ROOT%runtime\tmp"
set "TEMP=%ROOT%runtime\tmp"

echo === network check ===

echo [1] interfaces
"%NODE%" -e "const os=require('os');const n=os.networkInterfaces();let any=false;for(const k in n){for(const i of n[k]){if(i.family==='IPv4'){console.log(k,i.address,i.internal?'loopback':'LAN');any=true}}}if(!any)console.log('(none) => no NIC driver in this PE')"

echo [2] dns
"%NODE%" -e "require('dns').lookup('api.deepseek.com',function(e,a){console.log(e?('DNS FAIL '+e.code):('DNS OK '+a))})"

echo [3] https
"%NODE%" -e "const ac=new AbortController();setTimeout(function(){ac.abort()},8000);fetch('https://api.deepseek.com/',{method:'HEAD',signal:ac.signal}).then(function(r){console.log('HTTPS reachable '+r.status)}).catch(function(e){console.log('HTTPS FAIL '+(e&&e.message||e))})"

echo.
echo [4] clock (TLS needs a sane date)
"%NODE%" -e "console.log(new Date().toString())"

pause