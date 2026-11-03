# push-github.ps1 — 一条命令推送到 GitHub（自带 Clash 代理）
#
# 用法（在仓库根目录）：
#   powershell -ExecutionPolicy Bypass -File tools\push-github.ps1
#
# 前提：GitHub 上已经有 XIZRSAMS/dsh-rescue 这个空仓库。
# 某一步会弹一次授权窗口，点「Sign in with browser」即可。

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/XIZRSAMS/dsh-rescue.git'
$proxy = 'http://127.0.0.1:26187'

Write-Host '[1/4] 检查代理…'
$probe = & curl.exe -x $proxy -s -o NUL -w '%{http_code}' --max-time 10 https://github.com 2>$null
if ($probe -ne '200') {
  Write-Warning "代理 $proxy 不通（返回 $probe）。请先启动 Clash Verge。"
  exit 1
}
Write-Host "     代理可用"

Write-Host '[2/4] 检查远程仓库…'
$env:HTTPS_PROXY = $proxy
$env:HTTP_PROXY = $proxy
$ls = & git -c http.proxy=$proxy ls-remote $repo 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Warning '远程仓库不存在或无权访问。请先在 GitHub 网页上创建空的 dsh-rescue 仓库（不要勾选 README）。'
  exit 2
}
Write-Host '     远程可访问'

Write-Host '[3/4] 配置 remote…'
$existing = & git remote 2>$null
if ($existing -contains 'origin') { & git remote set-url origin $repo } else { & git remote add origin $repo }
Write-Host ("     origin -> " + $repo)

Write-Host '[4/4] 推送（可能会弹一次授权窗口）…'
& git -c http.proxy=$proxy -c http.sslVerify=true push -u origin main 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host '推送完成：' + $repo
} else {
  Write-Warning '推送失败。若是认证问题，运行 git credential-manager configure 后重试。'
  exit 3
}
