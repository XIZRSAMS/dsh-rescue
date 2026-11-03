# 贡献指南

## 开发循环

```sh
node --test packages/dsh-plugin-degraded/test/*.test.mjs
node --test test/*.test.mjs
node scripts/setup.mjs --no-install
node scripts/verify.mjs --all
```

改动插件后，装进救援 profile 再刷新页面即可看到：

```sh
node scripts/setup.mjs --no-install        # 重新渲染（插件用 file: 依赖，源码改动已生效）
start.cmd
```

## 加一条降级开关

1. `packages/dsh-plugin-degraded/lib/probe.js`：加探测字段（纯函数，走 `deps` 注入）。
2. `lib/policy.js`：在 `decide()` 里加三态合并 + 写进 `effective` / `disabledTools`。
3. `lib/report.js`：补标签与 JSON 字段（保持脱敏：不输出路径/用户名）。
4. `lib/config.js`：加默认值与枚举校验。
5. 测试：`test/probe.test.mjs`、`test/policy.test.mjs`、`test/report.test.mjs` 各加一例。
6. `docs/architecture.md` 的契约里补类型。

## 加一个要被 minimal 关掉的插件行

1. 确认它的 Loader 行 id（bundle patch 或 `--dump-config` 里能看到）。
2. 在 `profiles/minimal.patch.yml` 加 `- id: <row-id>` + `disabled: true`。
3. 在 `profiles/full.patch.yml` 加同名行 + `disabled: false`。
4. `test/profile.test.mjs`：官方行必须有断言；第三方行只检查出现在列表里。
5. `node scripts/setup.mjs --no-install && node scripts/verify.mjs --compose`。

## 改 profile 层

`profiles/web-desktop.patch.yml` 里对 `rescue-degraded` 的覆盖**必须重述整份 config**——
patch 是整段替换，不是深合并。`scripts/setup.mjs` 会把 `ui: auto` 占位替换成实际预设。

## 发布前

```sh
node scripts/privacy-scan.mjs --strict     # 二进制 / Key / 个人路径 / 本地 config
node --test packages/dsh-plugin-degraded/test/*.test.mjs
node --test test/*.test.mjs
node scripts/setup.mjs --no-install
node scripts/verify.mjs --all
```

`--strict` 在干净 clone 上必须通过（本地开发时 `config.json` 存在会被 skip，这是预期）。

## 提交规范

- 一个提交只做一件事：探测、决策、UI、脚本分开。
- 禁止把 `runtime/`、`config.json`、`.credentials.yaml`、任何二进制带进提交。
- 改上游假设时同步更新 `docs/compat.md` 与 `dsh-version.json` 的 `verifiedAt`。
