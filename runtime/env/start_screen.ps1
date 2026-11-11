$ErrorActionPreference = 'Continue'
# Start ONLY the companion Linux screen VM (does not touch the phone emulator).
$vbm = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$vm = 'DSH-Space'
$state = (& $vbm showvminfo $vm --machinereadable 2>$null) | Select-String 'VMState='
if ($state -match 'running') {
  Write-Host 'VM already running'
} else {
  & $vbm startvm $vm --type headless
}
for ($i = 0; $i -lt 90; $i++) {
  $ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 6081 -WarningAction SilentlyContinue
  if ($ok.TcpTestSucceeded) { Write-Host 'screen ready'; break }
  Start-Sleep -Seconds 2
}
Write-Host 'Linux screen: http://127.0.0.1:6081/vnc.html'
