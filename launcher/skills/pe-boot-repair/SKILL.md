---
name: pe-boot-repair
description: Windows 起不来（黑屏光标、无限「正在修复」、找不到操作系统、蓝屏 0xc000000f/0xc0000225）时的引导修复流程，含 UEFI 与 Legacy 两套。
---

# 引导修复

前提：已经用 pe-triage 找到系统盘 X:，并确认引导文件在。

## Legacy（MBR / BIOS）

~~~cmd
bootrec /fixmbr
bootrec /fixboot
bootrec /scanos
bootrec /rebuildbcd
~~~

- `/fixboot` 报「拒绝访问」是常态，可以跳过，直接 `/rebuildbcd`。
- `/rebuildbcd` 如果提示「未找到 Windows 安装」，不要慌，用下面的 bcdboot。

## UEFI（GPT / EFI）

先给 EFI 分区分配盘符：

~~~cmd
diskpart
list disk
select disk 0
list partition
select partition 1
assign letter=S
exit
~~~

然后重建：

~~~cmd
bcdboot X:\Windows /s S: /f UEFI
~~~

- `/f UEFI` 不能省，否则写出来的是 Legacy 引导。
- 如果 EFI 分区被格式化过、里面空了，这条命令能重建整套。

## 验证

~~~cmd
bcdedit /enum {default}
~~~

能看到 `device`、`osdevice` 指向 X:\Windows 就算成功。

## 常见错

| 现象 | 原因 | 处理 |
|---|---|---|
| 0xc000000f | BCD 丢失/损坏 | bcdboot 重建 |
| 0xc0000225 | 引导设备不对 | 检查 BIOS 启动顺序、Secure Boot |
| 无限「正在修复」 | 引导在、系统坏了 | 转 pe-offline-registry 或系统还原 |
| 找不到系统 | 磁盘控制器驱动变了 | BIOS 里改回 AHCI/RAID 原设置 |

## 红线

- 不要对 EFI 分区做 `format`，除非你确定要整套重建。
- `diskpart clean` 会清空分区表，绝对不要碰。
