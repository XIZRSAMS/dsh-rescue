# WinPE 部署手册（dsh-pure）

把 DeepSeek Harness 做成一个能插进 WinPE 直接用的救援盘。本文是从零复现的完整步骤。

产物结构：

~~~
G:\dsh-pure\
  start-dsh.cmd        双击启动
  pe-boot.mjs          启动逻辑（纯 node）
  pe-probe.cmd         环境探针（可选）
  apikey.txt           API Key（明文，自己写）
  runtime\node\        node 运行时
  runtime\node_modules\ 内核依赖
  runtime\home\       DSH_HOME（含 skills、profile）
  pwsh\                PowerShell 7
  browser\             Pale Moon 便携版
~~~

## 你需要的三样外部组件

仓库不提交二进制，这三样要自己下：

| 组件 | 下载地址 | 放哪 |
|---|---|---|
| Pale Moon 便携版 | https://www.palemoon.org/download.php?mirror=eu&bits=64&type=portable | 解压到 dist/palemoon-official/，里面要直接有 Palemoon-Portable.exe |
| PowerShell 7 | https://github.com/PowerShell/PowerShell/releases/download/v7.6.9/PowerShell-7.6.9-win-x64.zip | 解压到 dist/pwsh7/，里面要直接有 pwsh.exe |
| 内核依赖 | 由 provision 从 npm 装 | 自动 |

两份 zip 解压后别再套一层目录，脚本按固定路径找。

## 生成

~~~sh
node scripts/setup.mjs           # 渲染 profile
node scripts/a/provision.mjs     # 装内核到 runtime/
node scripts/pack-pure.mjs       # 组装 dist/pure
~~~

## 部署到 U 盘

~~~powershell
robocopy dist\pure G:\dsh-pure /E
~~~

## 写 API Key

编辑 G:\dsh-pure\apikey.txt：

~~~
DEEPSEEK_API_KEY=sk-你的key
~~~

启动器会读这个文件并注入环境变量。明文，别外借 U 盘。

## 在 WinPE 里启动

1. 进 PE，打开 cmd
2. 双击或执行 G:\dsh-pure\start-dsh.cmd
3. 看到三行即成功：

~~~
[dsh] credentials: loaded from G:\dsh-pure\apikey.txt
[dsh] pwsh: G:\dsh-pure\pwsh\pwsh.exe
[dsh] url: http://127.0.0.1:3080/?token=...
~~~

浏览器会自动打开。

## 已知限制

| 现象 | 原因 | 处理 |
|---|---|---|
| Get-CimInstance 报错 | PE 里 WMI 没启动 | net start winmgmt；起不来就用 Get-Partition/Get-Volume |
| 界面显示不全 | PE 默认 1024x768 | 已按 85% 渲染；可 F11 全屏或调高分辨率 |
| AbortSignal.any is not a function | 浏览器引擎太老 | pack-pure 会自动打 polyfill；仍报错就换更新的浏览器 |
| 没有网络 | PE 缺网卡驱动 | 装驱动或插网线；net-check.cmd 可诊断 |
| 命令里 Get-ChildItem 之类不认 | 用了 cmd 垫片而非真 pwsh | 确保 pwsh/ 目录存在且在 PATH 上 |

## 六个救援技能

随包发布在 runtime/home/skills/，AI 会按症状自动选用：

- pe-triage · 分诊
- pe-boot-repair · 引导修复
- pe-disk-repair · 磁盘修复
- pe-data-rescue · 数据抢救
- pe-offline-registry · 离线注册表
- pe-password-reset · 本机密码重置

## 自定义

要加自己的技能，在 runtime/home/skills/ 下建目录，放 SKILL.md，frontmatter 写 name 和 description 即可，不需要改配置。
