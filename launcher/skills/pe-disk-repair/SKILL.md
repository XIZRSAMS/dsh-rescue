---
name: pe-disk-repair
description: 文件系统损坏、磁盘只读、分区表异常、chkdsk 报错时使用。强调先判断哪种毛病，再决定要不要跑长时间扫描。
---

# 磁盘修复

## 先分清三类问题

1. **文件系统逻辑错误**：能读、偶发报错、chkdsk 能修
2. **磁盘只读**：写完读不回来，通常是固件保护或分区表标记
3. **物理坏道**：读写卡死、异响、SMART 报错 —— chkdsk 会加重损伤，先抢救数据

## 只读磁盘

~~~cmd
diskpart
list disk
select disk 0
attributes disk clear readonly
exit
~~~

清不掉就是固件级写保护（U 盘常见，SSD 也有），软件无解。

## 文件系统检查

~~~cmd
chkdsk X: /f
~~~

- **先跑不带 /r 的**，几分钟能出结果。
- `/r` 会扫全盘坏道，1TB 硬盘可能几小时，只在怀疑坏道时用。
- 对系统盘操作前，提醒用户：可能改动文件，重要数据先备份。

## 分区表

~~~cmd
diskpart
list disk
select disk 0
detail disk
list partition
~~~

- 分区表显示正常但盘符丢了：`assign letter=Y`
- 显示 RAW：不要 format，转 pe-data-rescue

## SMART 健康

~~~powershell
Get-PhysicalDisk | Select-Object FriendlyName,HealthStatus,OperationalStatus
Get-StorageReliabilityCounter -PhysicalDisk (Get-PhysicalDisk) -ErrorAction SilentlyContinue |
  Select-Object DeviceId,Wear,ReadErrorsTotal,WriteErrorsTotal,PowerOnHours
~~~

HealthStatus 不是 Healthy、或者读写错误数很大 → 先抢救数据，别修。

## 红线

- `format`、`clean`、`create partition` 一律先问用户，且确认数据已备份。
- 坏道盘上跑 `/r` 可能让盘彻底挂掉。
