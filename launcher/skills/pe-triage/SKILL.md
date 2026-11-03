---
name: pe-triage
description: 用户说「电脑开不了机 / 蓝屏 / 黑屏 / 一直修复 / 找不到硬盘」时先读这个。用只读命令把现场摸清楚，再决定进哪条修复流程。
---

# PE 分诊

**规矩：先只读、后动手。没搞清楚系统盘和引导模式之前，不要跑 chkdsk、不要重建引导、不要分区。**

## 1. 硬盘识别情况

~~~powershell
Get-Disk | Select-Object Number,FriendlyName,OperationalStatus,PartitionStyle,Size
Get-Volume | Select-Object DriveLetter,FileSystemLabel,FileSystem,DriveType,Size,SizeRemaining
Get-Partition | Select-Object DiskNumber,PartitionNumber,DriveLetter,Type,Size,IsActive
~~~

判读：
- 完全没有 Disk → 硬盘没被认出来：先查线/接口，或进 BIOS 看是否识别。**软件修不了，别浪费时间。**
- 有 Disk 但没盘符 → `Get-Volume` 里看是否 RAW；RAW 走 pe-data-rescue，不要直接格式化。
- `OperationalStatus` 不是 Online → `diskpart` 里 `select disk N` 加 `online disk`。

## 2. 哪块盘是系统盘

~~~powershell
Get-ChildItem C:\Windows\System32\config\SYSTEM -ErrorAction SilentlyContinue
Get-ChildItem D:\Windows\System32\config\SYSTEM -ErrorAction SilentlyContinue
~~~

逐个盘试，找到为止。记下盘符（下文用 X: 代指）。

## 3. 引导模式

~~~powershell
Test-Path 'X:\EFI\Microsoft\Boot\bootmgfw.efi'   # UEFI
Test-Path 'X:\boot\bcd'                            # Legacy
~~~

两个都看，有的机器两种引导文件都在。

## 3.5 PE 里 WMI 常常没启动

`Get-CimInstance` 报 `Microsoft.Management.Infrastructure.Native 初始化失败` 时，先试着启动服务：

~~~cmd
net start winmgmt
~~~

起不来的话别硬扛，用这些**不走 WMI** 的路径：

~~~powershell
Get-Partition / Get-Volume / Get-Disk        # Storage 模块，独立于 WMI
Get-PhysicalDisk -ErrorAction SilentlyContinue
reg query "HKLM\HARDWARE\DEVICEMAP\Scsi"
reg query "HKLM\SYSTEM\CurrentControlSet\Enum\IDE"
diskpart /s list.txt                          # 脚本方式列盘
~~~

拿不到的信息（电池、温度、显卡详细型号）就先跳过，不要为了凑信息反复折腾。

## 4. 系统版本

~~~powershell
Get-Content 'X:\Windows\System32\ntoskrnl.exe' -TotalCount 1 -ErrorAction SilentlyContinue
(Get-Item 'X:\Windows\System32\ntoskrnl.exe').VersionInfo.ProductVersion
~~~

## 5. 最近一次正常是什么时候

问用户三件事，比任何命令都有用：
1. 出问题前装了什么、卸了什么、装了什么驱动
2. 是不是改了 BIOS（安全启动、启动顺序、RAID/AHCI）
3. 有没有重要数据没备份

## 产物

给用户一句话结论 + 下一步走哪个技能：
- 系统盘在、引导文件在 → pe-boot-repair
- 系统盘在、文件系统异常 → pe-disk-repair
- 盘在但 RAW / 读取报错 → pe-data-rescue
- 盘都没了 → 硬件问题，先别用软件折腾
