$ErrorActionPreference = 'Continue'
# Stop ONLY the companion Linux screen VM (does not touch the phone emulator).
$vbm = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$state = (& $vbm showvminfo DSH-Space --machinereadable 2>$null) | Select-String 'VMState='
if ($state -match 'running') {
  & $vbm controlvm DSH-Space savestate
  Write-Host 'VM saved state'
} else {
  Write-Host 'VM not running'
}
