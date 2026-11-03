# 上游兼容性

单一版本源：[dsh-version.json](../dsh-version.json)。升级只改它，然后
`node scripts/upgrade.mjs --to <version>`。

## 已验证

| 内核版本 | 验证日期 | 结论 |
|---|---|---|
| `0.2.0-rc.2` | 2026-11-03 | 可组合、可启动；下列假设全部成立 |

验证方式：`--dump-config` 组合成功 + `verify.mjs --boot` 拿到
`/api/dsh-rescue/capabilities` + `/rescue` 在会话里可见。

## 本项目依赖的上游行为假设

| # | 假设 | 依据（0.2.0-rc.2） | 破坏后的表现 |
|---|---|---|---|
| 1 | `dsh --profile <name> --patch <file>` 的层叠顺序为 bundle → profile → home → overlay | `@deepseek-ai/dsh` README「Profiles」 | full overlay 不生效，minimal 关不掉装饰 |
| 2 | web profile 由 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` 组成 | 两者 `package.json` / bundle patch | profile 渲染的 bundles 不完整 |
| 3 | 官方行 id `ui-sidebar-documentpreview` / `ui-sidebar-browser` 存在 | `dsh-web-app/cordis.patch.yml` | 只会产生 warn，不影响启动 |
| 4 | patch 覆盖会**整体替换** `config` | README + `cordis-composition-reference` skill | 覆盖 `rescue-degraded` 时漏字段会被默认值顶掉 |
| 5 | `disabled` 接受布尔值 | `cordis-plugin-development` skill / web-app patch | minimal 层失效 |
| 6 | `ctx.provide(name, value)` 可注册普通 service | `dsh-web-app/lib/startup.js` 提供 `webStartup` | `!!js ctx.get('rescue')` 读不到 |
| 7 | `ctx.tools.restrict({deny})` 在 agent 作用域生效；未知名字抛错 | `dsh-tools` 类型 + skill `practices.md` | 降级不生效或插件报错（已用交集规避） |
| 8 | `agent/created` 为 serial 事件，payload 带 `agent` | `cordis_inspect_query` Event 目录 | per-agent 注册不执行 |
| 8b | `ctx.inject(deps, cb)` 在依赖就绪后执行回调 | `@deepseek-ai/cordis` 的 `registry.d.ts` | 服务注册不生效（实测：`webServer` 晚于插件挂载，直接 `ctx.get` 拿到 undefined，路由 404） |
| 8c | 会话 preset 的 PTY 后端注册在隔离域（`isolate: { terminals: true }`），Host 侧 `listBackends()` 可能为空 | `presets/standard.patch.yml` 的 `persistent-shell` group | 用后端列表判定会把可用的终端误判为不可用；已改为三态 |
| 9 | `ctx.commands.register` 的 handler 返回 `{kind:'success', text}` | `dsh-commands` 类型 | `/rescue` 无输出 |
| 10 | `ctx.webServer.register({kind:'exact',path,handler})` 对桌面端同样有效 | 生态中大量第三方插件（`dsh-file-changes` 等） | 设置页显示「不可用」，按 minimal 处理 |
| 10b | `/api/*` 受浏览器信任边界保护，裸 fetch 返回 401 | 实测：启动后无 cookie 请求 `/api/dsh-rescue/capabilities` → 401 | `verify --boot` 改用 loopback 专用路由 `/dsh-rescue/capabilities.json` |
| 11 | `ctx.systemPrompt.section({name,order,text})` 支持函数式 text | `dsh-system-prompt` 类型 | prompt 段落不出现 |
| 12 | `dsh plugin --profile <name> add <path>` 转发 pnpm | `dsh/lib/bin.js`（`runPlugin`） | 回退到 `pnpm/npm install --dir` |
| 13 | `--host 0.0.0.0` 被内核拒绝 | `dsh-web-app/lib/startup.js` | 局域网参数报错，需改用内网 IP |
| 14 | Web 前端 `#root` 在会话建立后挂载 | 实测（`test/shoot.mjs` 探针） | 截图脚本等待超时 |

## 升版检查清单

1. `node scripts/upgrade.mjs --to <new>` —— 自动备份、改版本、重跑 setup、组合校验。
2. `node scripts/verify.mjs --compose` —— 渲染结果仍符合预期。
3. `start.cmd` 起服务：`verify.mjs --boot` 通过。
4. 会话里 `/rescue` 有报告；`/rescue tools` 与实际不符时检查假设 #7。
5. 若上游改动了官方行 id：只改 `profiles/minimal.patch.yml` 与 `profiles/full.patch.yml`。
6. 把结论补进上表，并更新 `dsh-version.json` 的 `verifiedAt`。

## 已知坑

- **桌面端 `tapIndex` 无效**：Electron 的 `index.html` 是静态 dist，`webServer.tapIndex`
  不会被调用；`collectIndexInjections()` 是桌面端唯一通道。本项目只用 route。
- **`!!js` 求值时机**：表达式在 Loader 每次 mount 决策时求值，依赖异步 service 会
  产生顺序问题。因此 UI 层用静态布尔。
- **profile patch 覆盖会丢字段**：任何 `- id: xxx` 且带 `config` 的覆盖都要重述整份
  config，`profiles/full.patch.yml` 里因此把四个开关全写了一遍。
- **未知行 id 只 warn**：装饰插件没装时不会失败，但 `verify` 仍需人工确认官方行。
