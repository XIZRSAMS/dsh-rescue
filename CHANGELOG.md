<div align="center">

# 📝 更新日志 / Changelog

</div>

## v1.0.0（2026-11-04）—— 当前版本

### ✨ 新功能

- **WinPE 成品包**：node 运行时 + 内核 + PowerShell 7 + Pale Moon 浏览器一体化，
  整个目录拷到 U 盘就能用，不写注册表、不装驱动。
- **六个救援技能**：分诊 / 引导修复 / 磁盘修复 / 数据抢救 / 离线注册表 / 密码重置，
  AI 按症状自动选用，每份都写明前置条件、命令与红线。
- **零依赖启动器**：`pe-boot.mjs` 全部用 node 实现——找运行时、注入 API Key、
  抓 token、拉起浏览器，不依赖任何 cmd 外部命令。
- **托盘启动器**：Windows 下双击 `dsh-rescue.exe`，托盘常驻 + 自动打开带 token 的地址。
- **环境自适应降级**：探测 shell / PTY / GPU / 浏览器 / 可写盘，缺什么关什么，并说明原因。
- **中英双语**：界面与文档双语，中文为主页语。
- **小屏适配**：1024×768 下按 85% 渲染、隐藏书签栏、窗口卡在任务栏上方。

### 🐛 修复

- 浏览器引擎太老报 `AbortSignal.any is not a function`：给客户端注入 polyfill
  （连带 `throwIfAborted` / `structuredClone` / `crypto.randomUUID`）。
- PE 里 `ping` / `ipconfig` / `timeout` 全被精简：启动器改为纯 node 实现。
- PE 里没有 PowerShell：随包携带 PowerShell 7.6.9 便携版（自包含，不需要 .NET）。
- `%TMP%` 不可写导致 `dsh-spill-local` 报 EPERM：钉到包内 `runtime/tmp`。
- `Get-CimInstance` 在 PE 里不可用：技能提供 `net start winmgmt` 与不用 CIM 的替代路径。
- 打包误带 API Key 与会话凭据：`pack-pure` 强制清空并写空模板。
- 浏览窗口超出 1024×768 屏幕：改为 1000×700 并隐藏两行工具栏。

### 🧩 更早

- **v0.1.0（2026-11-03）**：首个可用版本。
  `dsh-plugin-degraded` 插件（Host + Web Client 双半，零运行时依赖）、
  A 版便携运行时、验收流水线与四层配置解析。

### 🗺️ 路线图

- **Linux**（计划中）：Live USB 形态，复用现有内核与技能
- **macOS**（计划中）：受签名与 Apple Silicon 限制，优先级最低
- **Windows RE**（未来版本）：与 PE 同源，先解决 WinRE 的网卡驱动

---

<div align="center">

**任何时候的介入急救。**

🚀 还会持续更新的！

</div>
