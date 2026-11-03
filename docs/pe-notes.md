# WinPE 笔记

目标：在一台只能进 WinPE（或系统已经坏到只能进安全模式）的机器上，
把 DSH 的 **Web + CLI** 跑起来，用手机浏览器操作。

Electron 桌面端不做适配：PE 缺 DWM / DirectX / COM，桌面壳没有意义。

## 三道坎

### 1. 没有 PowerShell

PE 默认没有 PowerShell。两条路：

- 用 `WinPE-PowerShell` 组件做一个带 PowerShell 的 PE（`powershell.exe` 5.1）。
  此时 `dsh-pwsh-local` 自己会回退到它，插件报告 `shell.mode = 'powershell'`。
- 完全不加组件。此时探测结果为 `cmd` 或 `none`：
  - `cmd` 存在时，`pwsh`/`bash` 工具会被隐藏（`ctx.tools.restrict`），需要命令时用
    `packages/dsh-shell-cmd` 提供的 Shell 实现（由 patch 层互斥切换）。
  - `none` 时插件只保留 read/write/edit/glob/grep 这类纯文件工具。

> 注意：Cordis 的 `ctx.shell` 一个 context 只能有一个实现。所以 shell 的切换发生在
> profile patch 层（静态、可逆），不是运行时替换。

### 2. 没有浏览器

PE 里没有可用浏览器（IE 内核已死，Edge 通常不在 PE 里）。推荐：

```sh
start.cmd --host <本机内网 IP>
# 手机浏览器打开 http://<本机内网 IP>:3080/
```

- 内核拒绝 `--host 0.0.0.0`（安全设计），必须写具体 IP。
- 手机与机器要在同一网段；PE 下网络驱动可能只带有限网卡，先 `ipconfig` 确认。
- 需要额外信任来源时用 `--trusted-host <ip:port>`。

### 3. `X:` 是 512MB 内存盘

PE 的系统盘 `X:` 是内存盘，重启即丢、空间很小。因此：

- 内核与 `DSH_HOME` 都放 U 盘（例如 `E:\dsh-rescue\runtime\home`）。
- `setup.mjs --home E:\dsh-rescue\runtime\home --force`。
- `X:` 上只留必要的临时文件；大文件（会话日志、附件）自然落在 `DSH_HOME`。
- 内存紧张时把 `minimal` 保持默认：装饰层、文档预览、图片预览全部关掉。

## 运行库？

已核实：`node.exe` 与 DSH 的 `node-pty` / `sharp` / `koffi` 等原生模块都是**静态 CRT**
（没有 `vcruntime140` / `api-ms-win-crt-*` 导入），外部 DLL 随包自带。
**PE 不需要安装 VC++ 运行库。**

复核方法（离线可做）：用 PE 导入表解析脚本检查二进制，而不是靠安装器报错猜。

## 启动一次的最短路径

```sh
# 在有网的机器上准备好（一次）
node scripts/setup.mjs --kernel vendor --vendor-dir D:\kernels\0.2.0-rc.2

# 复制整个 dsh-rescue 目录（含 runtime/as 与 node 运行时）到 U 盘
# 在 PE 里：
E:\dsh-rescue\start.cmd --host 192.168.1.20
```

`start.cmd` 会优先使用 `runtime\node\node.exe`（如果存在），否则用 PATH 上的 `node`。
PE 里通常没有 `node`，所以把 `node.exe` 放到 `runtime\node\`。

## 已知限制

- 桌面 Electron 端不参与：安全模式只提示 `--disable-gpu`，不做功能适配。
- 终端（PTY）在 PE 里通常不可用。注意探测策略是「Host 看不到就不降级」，所以 PE 里
  建议显式 `--terminal off`（或 config 里 `terminal: off`）再启动，避免模型调用
  `terminal_*` 才拿到报错。
- 图片预览依赖 GPU 渲染管线，PE 下默认关闭；会话里仍可读文本与文件。
- 反作弊 / 安全软件（360、迅游、NEAC 等）会拦进程创建与端口绑定，测试前先退出或加白。
