---
name: pe-password-reset
description: 用户忘记 Windows 本地账户密码、进不去桌面时使用。含 utilman 替换法的完整步骤和恢复方法。
---

# 本地密码重置

适用：本地账户。**微软账户、域账户不适用**，BitLocker 加密盘要先解锁。

## utilman 替换法

思路：把「轻松使用」按钮换成 cmd，在登录界面点它就能开命令行。

**1. 备份原文件**

~~~cmd
copy X:\Windows\System32\utilman.exe X:\Windows\System32\utilman.exe.bak
~~~

**2. 替换**

~~~cmd
copy X:\Windows\System32\cmd.exe X:\Windows\System32\utilman.exe /y
~~~

**3. 让用户重启进系统**，在登录界面点右下角「轻松使用」图标 → 弹出 cmd。

**4. 在 cmd 里改密码**

~~~cmd
net user 用户名 新密码
~~~

忘了用户名就先 `net user` 看列表。

**5. 回来把文件恢复**

~~~cmd
copy X:\Windows\System32\utilman.exe.bak X:\Windows\System32\utilman.exe /y
del X:\Windows\System32\utilman.exe.bak
~~~

**不恢复的话系统留着一个后门，必须提醒用户。**

## 恢复模式

如果系统能进恢复环境（Shift+重启），也可以直接用「重置密码」向导，比改文件干净。

## 红线

- 只对用户本人的机器做，先确认所有权（这是常识，不是多此一举）
- 域账户/微软账户改不了，别浪费时间
- 有 BitLocker 先 `manage-bde -status` 看状态
