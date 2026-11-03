---
name: pe-offline-registry
description: 需要改离线系统的注册表时用（删坏服务、改启动项、修登录、启用远程），含加载/卸载 hive 的完整流程。
---

# 离线注册表

PE 里的 regedit 改的是 PE 自己的注册表，要改目标系统必须**加载 hive**。

## 加载

~~~cmd
reg load HKLM\OFFLINE_SYSTEM X:\Windows\System32\config\SYSTEM
reg load HKLM\OFFLINE_SOFTWARE X:\Windows\System32\config\SOFTWARE
~~~

加载后挂在 `HKLM\OFFLINE_SYSTEM` 下，可以正常读写。

## 常见修复

**删掉导致蓝屏的服务**

~~~cmd
reg delete "HKLM\OFFLINE_SYSTEM\ControlSet001\Services\坏服务名" /f
~~~

先确认 `Start` 值是什么：
~~~cmd
reg query "HKLM\OFFLINE_SYSTEM\ControlSet001\Services\坏服务名" /v Start
~~~
0=引导 1=系统 2=自动 3=手动 4=禁用。蓝屏循环时改成 4。

**找当前 ControlSet**

~~~cmd
reg query HKLM\OFFLINE_SYSTEM\Select
~~~
看 `Current` 的值，一般是 1。

**改启动项 / 禁用自启**

~~~cmd
reg query "HKLM\OFFLINE_SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
~~~

## 卸载（必须做）

~~~cmd
reg unload HKLM\OFFLINE_SYSTEM
reg unload HKLM\OFFLINE_SOFTWARE
~~~

不卸载的话目标系统启动时会说「注册表文件被占用」。

## 红线

- 改之前先导出备份：`reg export "HKLM\OFFLINE_SYSTEM" X:\backup\system.reg`
- 不要删 `ControlSet001\Services` 下的系统核心服务（Disk、Ntfs、Volsnap 等）
- BitLocker 加密的盘加载不了，先解锁
