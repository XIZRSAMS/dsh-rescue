# dsh-rescue · 中文说明

[English](README.md)

给 **DeepSeek Harness** 用的「救援 / 降级模式」插件与可复现 profile。

DSH 默认假设这是一台完整桌面：有 PowerShell、有 PTY、有 GPU、有现代浏览器。
`dsh-rescue` 把这些假设逐项探测一遍，缺什么就关什么，并告诉你原因——所以在
WinPE、精简系统、维修 U 盘、或者 shell 已经坏掉的机器上，Web + CLI 仍然能用。

只做两件事：

1. **`dsh-plugin-degraded`**：正经的 DSH 插件（Host + Web Client 双半），零运行时依赖。
2. **可复现 profile + 脚本**：`scripts/setup.mjs` 渲染 `runtime/home` 下的 profile、
   装插件、生成启动器、校验组合结果；`scripts/upgrade.mjs` 只改一个文件就换内核版本。

不 fork、不改内核源码：全部走 bundle patch、profile patch、`--patch` overlay。

---

## 快速开始

```sh
git clone <本仓库> dsh-rescue
cd dsh-rescue
node scripts/setup.mjs        # 渲染 profile + 安装插件（需要 dsh 在 PATH 上）
start.cmd                     # 或：sh start.sh
```

`setup.mjs` 会生成：

```
runtime/home/profiles/rescue/{package.json,cordis.yml,cordis.patch.yml,pnpm-workspace.yaml}
runtime/start.cmd   runtime/start.sh   runtime/capabilities.json
```

**它拒绝写入当前正在使用的 DSH_HOME**，只能写仓库内的 `runtime/`；
确实要装到 U 盘等外部路径时，显式加 `--home <dir> --force`。

### 参数

| 参数 | 含义 |
|---|---|
| `--ui minimal\|full\|auto` | 渲染进 profile 层的 UI 预设（默认 `minimal`） |
| `--home <dir>` | 救援用的 `DSH_HOME`（默认 `<repo>/runtime/home`） |
| `--profile <name>` | profile 名（默认 `rescue`） |
| `--kernel npm\|vendor\|existing` | 内核来源 |
| `--vendor-dir <dir>` | 内核 tgz 目录（离线安装） |
| `--no-install` | 只渲染文件，不安装 |
| `--dry-run` | 只打印将要写入的内容 |
| `--force` | 允许把 `--home` 指到仓库外 |
| `--no-write-config` | 不改仓库根的 `config.json`（测试用） |

### 内核来源

```sh
# 1. npm（需要网络；真正安装内核的是 provision，不是 setup）
node scripts/a/provision.mjs --kernel npm

# 2. 离线 tgz（PE / 无网环境）
node scripts/a/provision.mjs --kernel vendor --vendor-dir D:\kernels\0.2.0-rc.2

# 3. 复用已装好的 dsh
node scripts/a/provision.mjs --kernel existing --existing "C:\path\to\dsh\node_modules\@deepseek-ai\dsh"
```

> `setup.mjs --kernel` 只解析来源与查找 `dsh`，不会安装。安装由
> `scripts/a/provision.mjs` 负责（见下一节）。

内核 tgz 一律不进 git（`.gitignore` 里有 `*.tgz`）。

### 便携运行时（A 版）

A 版把 node 与内核真正搬进 `runtime/`，并把每一步验证写成可重复执行的程序：

```sh
node scripts/a/provision.mjs        # 拷 node.exe、装 kernel、渲染 profile、实体化插件
node scripts/a/probe.mjs            # → runtime/logs/probe.json（能力 + 端口 + 磁盘 + kernel 来源）
node scripts/a/boot.mjs             # → runtime/logs/boot.json（冷启动 readyMs）
node scripts/a/matrix.mjs           # → runtime/logs/matrix.json（降级矩阵）
node scripts/a/portable-check.mjs   # PATH 里没有 node 时仍能用 start.cmd 起
node scripts/a/pe-build.mjs         # PE 流水线（没有 ADK 时写 skipped）
node scripts/a/run.mjs --all        # 以上串联 + runtime/logs/summary.{json,md}
```

- 规范落点：`runtime/node/node.exe`（两个 start.cmd 都认这个路径）与
  `runtime/node_modules/@deepseek-ai/dsh`；`runtime/node.exe` 是同一 inode 的硬链接，
  兼容任务书的字面路径。
- 插件目录会被实体化（junction → 真目录），否则整个目录拷到 U 盘换盘符后会断。
- `runtime/start.cmd` 由 `setup.mjs` 生成，用 `%~dp0node\node.exe` 与
  `%~dp0..\scripts\entry.mjs`（`%~dp0` 本身已指向 `runtime\`，入口要上跳一级）。
  两个 `start.cmd` 都能独立启动，不需要再绕开。
- 冷启动只探测 loopback 的 `GET /dsh-rescue/capabilities.json`，不碰 `/api/*`
  （那里有浏览器信任边界，裸 fetch 是 401）。

### 启动

```sh
start.cmd                                  # 只听 127.0.0.1
start.cmd --host 192.168.1.20              # 手机同局域网可打开
start.cmd --host 192.168.1.20 --port 3080 --ui full
start.cmd --ui full --open                 # 顺便打开浏览器
```

`start.cmd` / `start.sh` 只是转发壳，所有解析都在 `scripts/entry.mjs`。
`0.0.0.0` 会被内核主动拒绝，用本机内网 IP。

### 启动器与打包

```sh
node scripts/build-launcher.mjs   # csc 编译 dist/dsh-rescue.exe（托盘 + 自动开浏览器 + 抓 token）
node scripts/pack-portable.mjs    # 组装 dist/portable（可整包拷 U 盘，约 624MB）
```

`dist/dsh-rescue.exe` 是 GUI 子系统程序：双击后自己找 `runtime\node\node.exe`、挑空闲端口、
把 `TMP`/`TEMP` 钉到 `runtime\tmp`（PE 里 %TMP% 常不可写）、轮询
`/dsh-rescue/capabilities.json`，拿到 200 后从 stdout 抓 `?token=` 再打开浏览器。
托盘菜单有「打开界面 / 复制地址 / 打开日志目录 / 退出」。

`dist/portable` 是可直接拷到 U 盘的目录：内置 node + kernel + 已渲染的 rescue profile + 插件，
不依赖任何本机路径；`runtime/home` 里的凭据和会话不会被复制进去。
WinPE 没有 .NET，启动器用不了，改用同目录的 `start.cmd`（纯 cmd + node）。

---

## 会被降级的能力

| 能力 | 探测方式 | 降级行为 |
|---|---|---|
| `shell` | `pwsh.exe` → `powershell.exe` → `cmd.exe` | 都不在时隐藏 `bash` / `pwsh` 工具 |
| `terminal` | 终端服务是否存在；Host 侧后端列表只作诊断 | 明确判定服务缺失时才隐藏 `terminal_*`（`available: null` = 未知 → 不降级） |
| `ui` | WinPE / GPU / 预设 | 关掉装饰插件行，默认 `minimal` |
| `image` | WinPE / GPU | 隐藏 `read_image`，关掉预览行 |

四个开关都支持 `auto` / `on` / `off`：`on` / `off` 永远压过探测结论，并在报告里
标成「config 强制开启/关闭」。随时查：

```
/rescue            环境报告（会话里可见）
/rescue json       原始 payload
/rescue refresh    重新探测（装好 shell 或 PTY 之后）
/rescue tools      当前被禁用的工具
```

设置页「救援模式」显示同一份报告；只有真的降级时才在右下角出现一行提示。

同一份脱敏数据有两条 HTTP 路由：

- `GET /api/dsh-rescue/capabilities`：浏览器半边用，走 `/api` 的会话 cookie 信任边界。
- `GET /dsh-rescue/capabilities.json`：仅 loopback，给 `verify.mjs --boot` 和 curl
  诊断用（它们没有会话 cookie）。

---

## minimal 与 full

`minimal` 是默认，且 **fail-closed**：

- `profiles/minimal.patch.yml` 用静态 `disabled: true` 关掉官方重型行
  （`ui-sidebar-documentpreview`、`ui-sidebar-browser`）与常见装饰插件
  （皮肤、壁纸引擎、宠物、余额挂件、动效、看图）。
- `profiles/full.patch.yml` 是 `--patch` overlay，把同名行打开，并把插件的
  `ui` 固定成 `full`。

不重装即可切换：

```sh
node scripts/setup.mjs --ui full     # 持久：重写 profile 层
start.cmd --ui full                   # 单次：叠加 full overlay
```

`minimal` 的性能预算（`test/perf.test.mjs` 对运行中的服务测量）：
首屏 < 2s、常驻 JS 堆 < 400MB、无持续动画（3 秒采样 < 30 帧）。

性能测量步骤：

```sh
start.cmd --port 3080                 # 另起一个终端
node test/shoot.mjs --home runtime/home --no-shot --eval-file test/perf.js
node --test test/perf.test.mjs        # 带阈值断言
```

---

## 目录结构

```
packages/dsh-plugin-degraded/   插件本体（index.js / client.js / lib/* / test）
packages/dsh-shell-cmd/         可选：cmd.exe 的 Shell 实现（预留）
profiles/                       profile 清单 + minimal/full 两个覆盖层
src/launch.mjs                  A 版启动器（entry.mjs 优先用它，缺失时回退 fallback）
scripts/                        setup / upgrade / verify / doctor / privacy-scan / entry
scripts/a/                      便携运行时（provision）与 P1–P6 验证程序 + 纯逻辑测试
test/                           node:test 套件 + 无头 CDP 截图与性能探针
docs/                           架构、版本兼容、WinPE 笔记
```

---

## 验证

```sh
node --test packages/dsh-plugin-degraded/test/*.test.mjs   # 纯逻辑
node --test test/*.test.mjs                                 # 模板 + setup + 隐私
node --test scripts/a/test/*.test.mjs                       # A 版启动器与判定逻辑
node scripts/setup.mjs --no-install
node scripts/verify.mjs --all                              # 组合 + 隐私
node scripts/verify.mjs --boot                             # 起服务探活（需要内核）
node scripts/doctor.mjs                                    # 这台机器会发生什么
node scripts/a/run.mjs --all                               # 便携运行时 + P1–P5 + 便携启动
```

`verify.mjs --boot` 会起服务、等 `/api/dsh-rescue/capabilities` 就绪、断言字段、
然后关掉。没装内核时它 **skip 而不是 fail**；CI 里要变硬失败就加 `--require-boot`。

---

## PE 成品包（dsh-pure）

上面是插件线；仓库还能直接产出一个插进 WinPE 就能用的成品包：

```sh
node scripts/pack-pure.mjs
```

产物是 `dist/pure`：内置 node 运行时、内核依赖、PowerShell 7、Pale Moon 便携浏览器、
以及六个救援技能（分诊 / 引导修复 / 磁盘修复 / 数据抢救 / 离线注册表 / 密码重置）。

外部组件（两个 zip）不提交进仓库，下载地址与完整部署步骤见
[docs/pe-runbook.md](docs/pe-runbook.md)。

启动器 `pe-boot.mjs` 负责：找运行时、注入 API Key、启动内核、抓 token、开浏览器，
全部用 node 实现——因为这个 PE 里没有 ping / ipconfig / timeout。

---

## WinPE 笔记

详见 [docs/pe-notes.md](docs/pe-notes.md)。摘要：Node 与所有 `@deepseek-ai/*`
原生模块都是静态 CRT，**不需要 VC++ 运行库**；真正的三个坎是无 PowerShell 组件、
无浏览器（用手机连）、`X:` 只有 512MB 内存盘（把内核和 `DSH_HOME` 放 U 盘）。

---

## 版本与升级

内核版本、已验证的假设与坑都在 [docs/compat.md](docs/compat.md)。唯一版本源是
[dsh-version.json](dsh-version.json)：

```sh
node scripts/upgrade.mjs --to 0.2.0-rc.3
```

它会先备份生成物、改版本、重跑 setup；组合校验失败就自动回滚。

---

## 安全边界

- `setup.mjs` 只写 `<repo>/runtime`（或显式 `--force` 的路径），并拒绝当前
  会话的 `DSH_HOME`——正在用的 Harness 不会被它弄坏。
- `/api/dsh-rescue/capabilities` 只返回脱敏布尔值（没有路径、没有用户名），
  默认仅 loopback 可读；`server.allowRemote` 才放开。
- `scripts/privacy-scan.mjs --strict` 是发布门禁：禁止二进制、镜像、API Key、
  个人绝对路径。
- 真机测试前先退出或加白 360 / 加速器 / 反作弊服务——它们会拦进程创建和端口。

---

## 许可

MIT，见 [LICENSE](LICENSE)。
