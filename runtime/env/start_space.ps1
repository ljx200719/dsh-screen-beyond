$ErrorActionPreference = 'Continue'
# Start the AI's own environment: VirtualBox Linux desktop + Android phone emulator.

$vbm = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$vm = 'DSH-Space'

Write-Host '== Linux desktop VM =='
$state = (& $vbm showvminfo $vm --machinereadable 2>$null) | Select-String 'VMState='
if ($state -match 'running') { Write-Host 'VM already running' } else {
  & $vbm startvm $vm --type headless
}

Write-Host '== Android phone emulator =='
$sdk = $env:DSH_COMPANION_ANDROID_SDK
if (-not $sdk) { $sdk = 'D:\dsh-env\android-sdk' }
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_HOME = $sdk
$emu = Join-Path $sdk 'emulator\emulator.exe'
$running = Get-Process emulator -ErrorAction SilentlyContinue
if ($running) { Write-Host 'emulator already running' } else {
  Start-Process -FilePath $emu -ArgumentList '-avd', 'DSH_Phone', '-no-snapshot', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-no-metrics' -WorkingDirectory (Join-Path $sdk 'emulator')
}

Write-Host '== waiting for adb =='
$adb = Join-Path $sdk 'platform-tools\adb.exe'
for ($i = 0; $i -lt 60; $i++) {
  $out = (& $adb devices 2>$null) -join "`n"
  if ($out -match 'emulator-5554\s+device') { Write-Host 'phone ready'; break }
  Start-Sleep -Seconds 3
}

Write-Host ''
Write-Host 'Linux screen: http://127.0.0.1:6081/vnc.html'
Write-Host 'SSH: ssh -p 2222 dsh@127.0.0.1  (password DshSpace2026)'
Write-Host ('ADB: ' + $adb + ' devices')
