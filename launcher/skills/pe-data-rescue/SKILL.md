---
name: pe-data-rescue
description: 盘还能读但系统进不去、或者文件系统报错时的数据抢救流程。核心原则是先只读拷贝，再考虑修复。
---

# 数据抢救

**第一原则：先拷出来，再修盘。修盘永远排在数据安全之后。**

## 1. 确认还能读

~~~powershell
Get-ChildItem X:\Users -ErrorAction SilentlyContinue | Select-Object -First 10 Name
~~~

能列出目录就继续；直接报「参数错误」「无法访问」说明文件系统坏了，改用数据恢复工具（PE 里的 DiskGenius 之类），不要硬拷。

## 2. 目标盘要有空间

~~~powershell
Get-Volume | Select-Object DriveLetter,FileSystemLabel,Size,SizeRemaining
~~~

目标盘剩余空间要大于源数据量。**不要往同一块盘拷。**

## 3. 用 robocopy 拷贝

~~~cmd
robocopy X:\Users\* E:\backup\Users /E /COPY:DAT /R:1 /W:1 /XJ /NFL /NDL /LOG:E:\backup\copy.log
~~~

参数解释（每个都不是随便写的）：
- `/E` 含空目录
- `/COPY:DAT` 只拷数据/属性/时间，不拷 ACL（PE 里 ACL 常报错）
- `/R:1 /W:1` 失败只重试 1 次、等 1 秒 —— **默认是重试 100 万次，坏道盘会卡死**
- `/XJ` 跳过 junction，避免无限递归
- `/LOG:` 留证据，方便判断哪些文件没拷出来

**绝对不要加 `/MIR`**：它会删除目标端多出来的文件。

## 4. 读不出来的文件

robocopy 日志里会列失败项。对单个重要文件：

~~~cmd
copy /b "X:\path\file" "E:\backup\file"
~~~

还不行就是物理坏道，交给专业恢复工具，别反复试（每次重试都在磨损）。

## 5. 抢救完再考虑修

数据都出来了，才允许对源盘跑 chkdsk /f 或重装系统。

## 输出

给用户一份清单：拷了什么、多大、哪些没拷出来、日志在哪。
