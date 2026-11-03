# Changelog

本项目的所有重要改动都会记录在这里。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- A 版便携运行时与验证流水线：`src/launch.mjs`（接管 entry：四层配置解析、
  kernel 定位、`--patch` overlay、进程与信号转发）、`scripts/a/provision.mjs`
  （拷 node、装 kernel、调 setup、实体化插件 junction、写 manifest）、
  P1 `probe` / P4 `boot` / P5 `matrix` / `portable-check` / P6 `pe-build` /
  `run` 总编排，日志统一落 `runtime/logs`。
- `scripts/a/test`：启动参数、kernel 候选顺序（与 fallback 同步）、probe 记录校验、
  矩阵分类的纯逻辑测试。
- README / docs/pe-notes / docs/architecture 补齐 A 版说明；CI 增加 A 版测试步骤。

### Fixed

- 冷启动不再自动打开浏览器：向内核转发 `--no-open`（0.2.0-rc.2 默认会开）。
- 子进程的 `TEMP`/`TMP` 指向 `runtime/tmp`，宿主临时目录不可写时不再出现
  `dsh-spill-local` 的 EPERM 警告。

## [0.1.0] - 2026-11-03

首个可用版本，目标内核 `@deepseek-ai/dsh@0.2.0-rc.2`。

### Added

- `packages/dsh-plugin-degraded`：Host + Web Client 双半插件，零运行时依赖。
  - 纯函数层：`lib/probe.js`（能力探测）、`lib/policy.js`（三态决策）、
    `lib/report.js`（脱敏报告）、`lib/config.js`（手写 schema）。
  - Host 半：`ctx.provide('rescue')`、`/rescue` 命令、system prompt 环境段落、
    `GET /api/dsh-rescue/capabilities`、`agent/created` 上的 `ctx.tools.restrict`。
  - Client 半：设置页「救援模式」+ 降级提示条（仅在真的降级时出现）。
- `profiles/`：可复现 profile 清单 + `minimal` / `full` 两个覆盖层。
- `scripts/setup.mjs`：幂等渲染 `runtime/home`、安装插件、生成启动器、组合校验、
  写环境报告；拒绝写入正在使用的 `DSH_HOME`。
- `scripts/upgrade.mjs`：只改 `dsh-version.json`，失败自动回滚。
- `scripts/verify.mjs`：`--compose` / `--privacy` / `--boot`。
- `scripts/doctor.mjs`：与插件同源的探测与决策输出。
- `scripts/privacy-scan.mjs`：二进制、API Key、个人路径门禁（`--strict` 供 CI）。
- `start.cmd` / `start.sh` + `scripts/entry.mjs` / `scripts/fallback-launch.mjs`：
  参数解析集中在 Node，`.cmd` 只是转发。
- `test/`：插件纯逻辑单测、模板与 setup 集成测试、隐私测试、无头 CDP 截图与性能探针。
- `docs/`：架构、上游兼容性假设表、WinPE 笔记。

### Known limitations

- Electron 桌面端不做 PE 适配（只提示 `--disable-gpu`）。
- `packages/dsh-shell-cmd` 目前是预留目录：无 PowerShell 时先用工具隐藏降级，
  cmd 后端实现留待后续版本。
- `test/perf.test.mjs` 需要手动起服务；没有 Edge 或服务时自动 skip。
