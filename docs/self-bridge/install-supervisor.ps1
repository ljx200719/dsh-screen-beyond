# 把自建桥守护脚本注册成「登录时自动运行」的计划任务（可选，不推荐给不熟悉的人）
# 只创建当前用户的登录任务，不装服务、不写系统目录。
# 卸载：schtasks /Delete /TN "SBCBridgeSupervisor" /F
param(
  [string]$NextDir = 'F:\onebot\next',
  [string]$TaskName = 'SBCBridgeSupervisor'
)
$ErrorActionPreference = 'Stop'
$ps = Join-Path $NextDir 'bridge-supervisor.ps1'
if (-not (Test-Path $ps)) { throw "找不到 $ps" }
$cmd = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ps + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ps + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description '屏幕彼端 自建QQ桥守护' -Force | Out-Null
Write-Output ('已注册计划任务：' + $TaskName + '（登录后自动运行）')
Write-Output '卸载：schtasks /Delete /TN "SBCBridgeSupervisor" /F'
