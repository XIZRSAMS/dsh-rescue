# 项目介绍文案（可直接复制到其他平台）

## 一、论坛 / 社区完整版（约 400 字）

**dsh-rescue：给 AI 做一张急救启动盘**

电脑开不了机的时候，我们通常只能靠 PE 里的 DiskGenius、bootrec、chkdsk 硬啃。
如果这时候能有个懂行的助手在身边，很多问题会快得多。

dsh-rescue 就是干这个的：把 DeepSeek Harness 塞进一个 U 盘，
插进任何一台机器，进 WinPE 就能开口问诊、动手修。

它自带 node 运行时、PowerShell 7.6.9、Pale Moon 浏览器，
以及六个救援技能（分诊 / 引导修复 / 磁盘修复 / 数据抢救 / 离线注册表 / 密码重置），
AI 会按症状自己挑对应的流程，先做只读检查再动手。

**不用装系统、不用装浏览器、不用装 PowerShell，也不用手机。**
解压到 U 盘 → 在 apikey.txt 填上 API Key → 进 PE 双击 start-dsh.cmd，
浏览器会自动打开，界面就在里面。

实测环境：优启通 / 微PE / 魔术师（其他 PE 数据较少，欢迎反馈）。

三条技术上有意思的地方：
- node 官方构建是静态 CRT，不依赖 VC 运行库，PE 里直接能跑
- Pale Moon 缺 AbortSignal.any，给它注入了 polyfill 才连得上后端
- PE 里没有 PowerShell，随包带了 PowerShell 7 便携版

下载：https://github.com/XIZRSAMS/dsh-rescue/releases
源码：https://github.com/XIZRSAMS/dsh-rescue

---

## 二、群聊 / 朋友圈短版（约 100 字）

给 AI 做了张急救启动盘：**dsh-rescue**

系统起不来、蓝屏、找不到盘、密码忘了——进 PE 就能问 AI，它能直接跑命令动手修。
自带 node、PowerShell、浏览器和六个救援技能，解压到 U 盘填个 Key 就能用，不用装任何东西，也不用手机。

实测优启通 / 微PE / 魔术师。
https://github.com/XIZRSAMS/dsh-rescue

---

## 三、一句话版

把 AI 塞进一张 U 盘：进 PE 就能问诊、能动手修——dsh-rescue。
https://github.com/XIZRSAMS/dsh-rescue

---

## 四、技术社区版（V2EX / 掘金风格，侧重实现）

**用 node 给 WinPE 做了个 AI 救援盘**

WinPE 里没有 PowerShell、没有浏览器、没有 VC 运行库，DSH 这种现代 Node 应用默认跑不起来。
dsh-rescue 把这几个坑一个个填了：

1. **运行时**：DSH 官方 node 构建是静态 CRT，只依赖系统 DLL，PE 里可直接运行
2. **界面**：内置 Pale Moon 便携版；它缺 `AbortSignal.any` / `throwIfAborted`，
   于是给 client bundle 注入 polyfill——不然界面永远停在「重新连接中」
3. **Shell**：PE 里连 `ping` / `ipconfig` 都被精简了，启动器改成纯 node 实现；
   再用 PowerShell 7 便携包补上命令执行能力
4. **凭据**：DSH 从环境变量读 API Key，启动器改为从 `apikey.txt` 注入
5. **技能**：六份 SKILL.md 放在 `$DSH_HOME/skills`，provider 自动发现

整个包解压即用，362MB，含 node + 内核 + PowerShell + 浏览器。

https://github.com/XIZRSAMS/dsh-rescue
