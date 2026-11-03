# 架构

## 分层

```
┌─────────────────────────────────────────────────────────────┐
│ Web Client（browser）                                       │
│   设置页「救援模式」 · 降级提示条                            │
│   fetch /api/dsh-rescue/capabilities                        │
└───────────────▲─────────────────────────────────────────────┘
                │ HTTP（同源，loopback / allowRemote）
┌───────────────┴─────────────────────────────────────────────┐
│ Host 进程：dsh-plugin-degraded                              │
│   index.js  副作用：provide / section / command / route /   │
│             agent/created → ctx.tools.restrict(deny)        │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│   │ lib/probe.js │→ │ lib/policy.js│→ │ lib/report.js│      │
│   │ 纯：事实     │  │ 纯：决策     │  │ 纯：脱敏渲染 │      │
│   └──────────────┘  └──────────────┘  └──────────────┘      │
└───────────────▲─────────────────────────────────────────────┘
                │ bundle patch → profile patch → --patch overlay
┌───────────────┴─────────────────────────────────────────────┐
│ Cordis Loader（DSH 内核，未修改）                            │
│   dsh-base → dsh-web-app → dsh-plugin-degraded              │
└─────────────────────────────────────────────────────────────┘
```

**探测与决策分离**是硬约束：`probe.js` 只接收注入的事实（`platform/env/pathExists/
canWrite/terminalBackends`），`policy.js` 只做三态合并，`index.js` 是唯一产生副作用的
地方。因此 `scripts/doctor.mjs`、`setup.mjs` 与运行时用的是同一份逻辑，不可能互相说法不一。

## 公共契约

```ts
type Tri = 'auto' | 'on' | 'off'

interface Capabilities {
  shell:    { mode: 'pwsh'|'powershell'|'cmd'|'none'; executable: string; name: string; tried: string[]; reason: string }
  terminal: { conpty: boolean; backends: string[]; reason: string }
  ui:       { presetSource: 'probe'; gpu: boolean; decorationAllowed: boolean; reason: string }
  image:    { preview: boolean; mediaTypes: string[]; reason: string }
  env:      { isPE: boolean; dshHome: string; dshHomeWritable: boolean; platform: string
              arch: string; node: string; reasons: string[] }
}

interface Policy {
  uiPreset: 'minimal' | 'full'
  effective: { shell: boolean; terminal: boolean; ui: boolean; image: boolean }
  disabledTools: string[]
  disabledFeatures: string[]           // minimal 时的装饰旗标
  reasons: Record<'shell'|'terminal'|'ui'|'image', string>
  notes: string[]
}
```

Host 侧通过 `ctx.provide('rescue', { capabilities, policy, report(), json(), refresh() })`
暴露快照；两条 HTTP 路由返回同一份 `renderJson()` 脱敏结果：
`/api/dsh-rescue/capabilities`（走 `/api` 的 cookie 信任边界，供浏览器半边）与
`/dsh-rescue/capabilities.json`（仅 loopback，供 `verify --boot` 与诊断）。
A 版 launcher 的 `src/probe.mjs` 必须与 `Capabilities` 同名同义，`ui.preset` 两侧一致。

### terminal 为什么是三态

`terminal.available` 可以是 `true` / `false` / `null`：

- `true`：`ctx.terminals` 存在或有后端。
- `null`：**Host 层看不到**这个服务。会话 preset 会在自己的隔离域
  （`isolate: { terminals: true }`）注册 PTY 后端，Host 侧看不到并不代表不可用。
- `false`：明确没有后端也没有服务（例如插件在无终端服务的 profile 里直接探测）。

`null` 时策略**不降级**——宁可让工具在真正不可用时自己报错，也不误关一个能用的终端。
需要强制关闭时用 `terminal: off`。

## 关键取舍

| 决定 | 理由 |
|---|---|
| 工具降级用 `ctx.tools.restrict({deny})`，不改 preset 声明 | preset 的 `config.plugins` 是整段替换的，跟进上游会导致每次升级都改一遍；restrict 只影响该 agent 的可见性，dispose 即恢复 |
| `restrict` 的列表先与可见工具求交集 | `restrict` 对未知名字直接抛错；交集保证只在真有该工具时禁用 |
| UI 开关写**静态** `disabled: true`，不用 `!!js` 表达式 | 表达式求值时机与 service 就绪顺序相关；静态布尔最可预测，full 由 overlay 覆盖 |
| 浏览器数据走 `ctx.webServer.register(...)`，不用 `tapIndex` | Electron 桌面壳的 index.html 是静态 dist，`tapIndex` 不生效；route 两种形态都工作 |
| 客户端半手写 ModuleLoader bundle，不引入构建链 | 与生态一致（`dsh-feature-toggles` 同形态）；救援环境不该再依赖构建产物 |
| 插件零运行时依赖，不声明 schemastery `Config` | WinPE 里可能没有可写的包存储；`lib/config.js` 手写默认值与校验 |
| 报告只输出脱敏布尔与 basename | 报告会进会话日志、模型上下文和浏览器，任何路径/用户名泄漏都是永久性的 |

## 插件生命周期

```
apply(ctx, config)
  ├─ normalizeConfig          默认值 + 枚举校验 + warnings
  ├─ probeCapabilities        同步探测；PTY 可能尚未注册 → 记 0
  ├─ decide                   首次决策
  ├─ ctx.provide('rescue')    patch 的 !!js 与浏览器侧都可读
  ├─ ctx.effect(systemPrompt.section)   order 900，模型开局可见
  ├─ ctx.effect(commands.register)      /rescue
  ├─ ctx.effect(webServer.register)     GET /api/dsh-rescue/capabilities
  └─ ctx.effect(on agent/created)       refresh() → restrict(deny)
       └─ on agent/disposed             释放该 agent 的 restriction
```

`agent/created` 里会再探测一次：`terminals` 后端在插件 apply 时可能还没注册，
而 agent 创建时一定已就绪。这也是 `terminal` 能力不会误判为不可用的原因。

## 层叠与优先级

```
bundle patches（dsh.profile.bundles 顺序）
  → profiles/<name>/cordis.patch.yml（setup 渲染：本项目覆盖 + minimal/full 层）
    → $DSH_HOME/cordis.patch.yml
      → --patch <full.patch.yml>（start.cmd --ui full 追加）
```

配置四层优先级：`命令行 / 环境变量` > `config.json` > `config 默认值` > `探测结论`。
`ui.preset` 的特殊之处是「渲染期决定」：`setup.mjs --ui` 写进 profile 层，
`start.cmd --ui full` 用 overlay 覆盖，两条路径结果等价。

## 失败模式

- 未知行 id：Loader 只 warn。`verify.mjs --compose` 只对官方行严格要求。
- 重复 `ctx.shell`：Cordis 一个 context 只允许一个实现。本项目**不**在运行时替换
  shell；无 PowerShell 时由 patch 层切换 `dsh-shell-cmd`（互斥 `disabled`）。
- route 被 LAN 访问：默认 403；只返回脱敏数据，放开需显式 `server.allowRemote`。
- 探测写探针失败（只读盘）：记为不可写并在报告里提示，不阻断启动。
