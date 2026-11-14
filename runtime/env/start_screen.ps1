$ErrorActionPreference = 'Continue'
# Start ONLY the companion Linux screen VM (does not touch the phone emulator).
$vbm = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$vm = 'DSH-Space'

function Get-VmState {
  $line = (& $vbm showvminfo $vm --machinereadable 2>$null) | Select-String 'VMState='
  if (-not $line) { return '' }
  return ([string]$line) -replace '.*VMState="?([^"]+)"?.*', '$1'
}

# 关机/休眠过程中（saving / restoring）不能直接 startvm：先等它落盘完。
# 实测：saveState 后立刻点「启动」会 startvm 失败、界面一直显示启动中。
for ($i = 0; $i -lt 60; $i++) {
  $st = (Get-VmState).Trim()
  if ($st -ne 'saving' -and $st -ne 'restoring') { break }
  Write-Host "waiting VM state settle: $st"
  Start-Sleep -Seconds 1
}

$started = $false
for ($try = 0; $try -lt 5; $try++) {
  $st = (Get-VmState).Trim()
  if ($st -eq 'running') { Write-Host 'VM already running'; $started = $true; break }
  Write-Host "startvm (state=$st, try $($try + 1))"
  & $vbm startvm $vm --type headless
  Start-Sleep -Seconds 2
  if ((Get-VmState).Trim() -eq 'running') { $started = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $started) { Write-Host "WARN: VM did not reach running state (state=$((Get-VmState).Trim()))" }

for ($i = 0; $i -lt 90; $i++) {
  $ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 6081 -WarningAction SilentlyContinue
  if ($ok.TcpTestSucceeded) { Write-Host 'screen ready'; break }
  Start-Sleep -Seconds 2
}
Write-Host 'Linux screen: http://127.0.0.1:6081/vnc.html'
