#Requires -Version 5.1
<#
.SYNOPSIS
Why the Volt window has no taskbar button on this machine.

.DESCRIPTION
Windows gives a top-level window a taskbar button unless one of a short list of
things is true, and every one of them is readable from the live window. Run this
ON THE AFFECTED MACHINE while Volt is running and send the output back; it reads
state only and changes nothing.

What the answer looks like:

  WS_EX_TOOLWINDOW = True   -> the window asked to be hidden from the taskbar
  владелец <> 0             -> the window is owned; owned windows share the
                               owner's button and never get their own
  WS_EX_APPWINDOW = False
    вместе с WS_POPUP=True  -> a borderless popup without the override: Windows 10
                               refuses the button where Windows 11 still grants it
  всё в норме               -> the window is fine and the shell is the suspect:
                               see the taskbar settings printed at the end
                               (кнопки на разных мониторах), or an Explorer that
                               missed the window's creation

.EXAMPLE
pwsh -File dev-local/win-taskbar-probe.ps1
#>
[CmdletBinding()]
param([string]$ProcessName = 'Volt')

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class VoltProbe {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@

$process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $process) {
    Write-Host "Процесс $ProcessName с окном не найден. Запустите приложение и повторите." -ForegroundColor Yellow
    exit 1
}

$handle = $process.MainWindowHandle
$style = [int64][VoltProbe]::GetWindowLongPtr($handle, -16)
$exStyle = [int64][VoltProbe]::GetWindowLongPtr($handle, -20)
$owner = [int64][VoltProbe]::GetWindow($handle, 4)
$className = New-Object System.Text.StringBuilder 256
[void][VoltProbe]::GetClassName($handle, $className, $className.Capacity)

$flag = {
    param($value, $mask)
    ($value -band $mask) -ne 0
}

$os = Get-CimInstance Win32_OperatingSystem
Write-Host "— система —" -ForegroundColor Cyan
"{0}  сборка {1}" -f $os.Caption, $os.BuildNumber
"explorer запущен: {0}" -f [bool](Get-Process explorer -ErrorAction SilentlyContinue)

Write-Host "`n— окно —" -ForegroundColor Cyan
"процесс     : {0} (pid {1}), версия файла {2}" -f $process.ProcessName, $process.Id, $process.MainModule.FileVersionInfo.FileVersion
"заголовок   : {0}" -f $process.MainWindowTitle
"класс       : {0}" -f $className.ToString()
"hwnd        : 0x{0:X}" -f [int64]$handle
"видимо      : {0}" -f [VoltProbe]::IsWindowVisible($handle)
"style       : 0x{0:X8}" -f $style
"exstyle     : 0x{0:X8}" -f $exStyle
"владелец    : 0x{0:X}" -f $owner

Write-Host "`n— что решает судьбу кнопки —" -ForegroundColor Cyan
"WS_EX_TOOLWINDOW : {0}   (True = кнопки не будет)" -f (& $flag $exStyle 0x00000080L)
"WS_EX_APPWINDOW  : {0}   (False вместе с WS_POPUP=True — причина на Windows 10)" -f (& $flag $exStyle 0x00040000L)
"WS_POPUP         : {0}" -f (& $flag $style 0x80000000L)
"WS_CAPTION       : {0}" -f ((($style -band 0x00C00000L) -eq 0x00C00000L))
"WS_MINIMIZEBOX   : {0}" -f (& $flag $style 0x00020000L)
"владелец задан   : {0}   (True = окно делит кнопку с владельцем)" -f ($owner -ne 0)

Write-Host "`n— настройки панели задач у этого пользователя —" -ForegroundColor Cyan
$advanced = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
foreach ($name in 'MMTaskbarEnabled', 'MMTaskbarMode', 'TaskbarGlomLevel', 'TaskbarSmallIcons') {
    $value = (Get-ItemProperty -Path $advanced -Name $name -ErrorAction SilentlyContinue).$name
    "{0,-18}: {1}" -f $name, $(if ($null -eq $value) { '(не задано)' } else { $value })
}
Write-Host "MMTaskbarMode=1 означает «кнопки только на главной панели» — на втором мониторе их не будет." -ForegroundColor DarkGray
