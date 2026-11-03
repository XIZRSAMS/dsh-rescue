# dsh-shell-cmd（预留）

`cmd.exe` 的 `ctx.shell` 实现，用于 **既没有 pwsh 也没有 powershell.exe** 的机器。

当前状态：**未实现**。0.1.0 的降级策略是隐藏 `bash`/`pwsh` 工具（`ctx.tools.restrict`），
让 agent 只用 `read`/`write`/`edit`/`glob`/`grep` 这类纯文件工具。

为什么要预留：

- Cordis 的一个 context 只允许一个 `ctx.shell` 实现，加载第二个会抛错。
  所以 cmd 后端不能"覆盖" pwsh 后端，只能由 profile patch 层互斥切换。
- 切换路径：`profiles/web-desktop.patch.yml` 里对
  `@deepseek-ai/dsh-pwsh-local` 的行 `disabled: true`，同时启用本包的行；
  探测结论来自 `dsh-plugin-degraded` 的 `capabilities.shell.mode`。

实现提示：

1. 继承 `@deepseek-ai/dsh-shell` 的 `ShellExecutor`（参考 `dsh-pwsh-local` 的
   `PwshLocalExecutor`）。
2. 命令用 `cmd.exe /d /s /c "<command>"` 执行；输出编码用 `chcp 65001` 前置，
   否则中文在 GBK 代码页下会乱码。
3. `resolve()` 里做超时上限裁剪，`execute()` 走 `ctx.subprocess.spawn`。
4. 落地前先补 `test/`：命令注入、超时、大输出 spill、退出码分类。

在它实现之前，`docs/compat.md` 与 README 的降级矩阵都是准确的：无 shell 时**隐藏**工具，
而不是假装能用。
