# dsh-plugin-degraded

救援/降级模式插件。探测本机能力 → 决定关掉什么 → 隐藏对应的工具 → 报告原因。

- **零运行时依赖**：不 import `@deepseek-ai/schemastery`、不读 `package.json`，
  在 WinPE 这种没有可写包存储的环境里也能加载。
- **探测与决策分离**：`lib/probe.js` / `lib/policy.js` / `lib/report.js` 都是纯函数，
  `index.js` 是唯一产生副作用的地方。
- **全部可逆**：每个开关都能被 config 强制覆盖；`restrict` 的 disposer 随 agent 释放。

## 安装

作为 bundle 安装（推荐）：

```sh
dsh plugin --profile <profile> add <本包路径>
```

或让 `scripts/setup.mjs` 处理（本仓库的标准路径）。

## 配置

```yaml
- insert:
    - id: rescue-degraded
      name: 'dsh-plugin-degraded'
      config:
        shell: auto          # auto | on | off
        ui: auto             # auto | minimal | full
        terminal: auto       # auto | on | off
        image: auto          # auto | on | off
        report:
          promptSection: true    # 往 system prompt 加环境段落
          command: true          # 注册 /rescue
        server:
          allowRemote: false     # 允许非 loopback 读 capabilities
        client:
          statusBar: true        # 降级时显示右下角提示条
```

> patch 覆盖会**整段替换** `config`，覆盖时必须重述所有字段。

## 使用

```
/rescue            环境报告（进会话日志，模型与人都能看到）
/rescue json       原始 JSON
/rescue refresh    重新探测（装好 shell / PTY 之后）
/rescue tools      当前被禁用的工具
```

设置页「救援模式」显示同一份报告；只有真的降级时才出现右下角提示条。

## 对外接口

- Service：`ctx.get('rescue')` → `{ capabilities, policy, report(), json(), refresh() }`
- HTTP：`GET /api/dsh-rescue/capabilities`（脱敏 JSON，默认仅 loopback）
- 命令：`/rescue`
- Prompt：section `rescue-environment`（order 900）

## 工具降级怎么做

`agent/created` 时取该 agent 可见的工具名，与策略里的候选 deny 列表求交集，
再在 `agent.ctx` 上 `ctx.tools.restrict({ deny })`。

交集是必须的：`restrict` 对未知工具名直接抛错，而不同 profile 挂的工具并不一样。
