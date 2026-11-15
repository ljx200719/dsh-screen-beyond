# 屏幕彼端 · 自建 QQ 桥守护脚本（可选）
# 作用：每 20 秒检查一次 127.0.0.1:3010；掉了就调 start-bridge.ps1 重新注入并拉起。
# 注意：QQ 未登录时守护无能为力（需要你手动在便携 QQ 里登录一次）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File bridge-supervisor.ps1            # 常驻守护
#   powershell -ExecutionPolicy Bypass -File bridge-supervisor.ps1 -Once      # 只检查/修复一次
#   powershell -ExecutionPolicy Bypass -File bridge-supervisor.ps1 -IntervalSec 30
param(
  [string]$NextDir = 'F:\onebot\next',
  [string]$QqDir = 'F:\onebot\QQ-portable',
  [int]$IntervalSec = 20,
  [switch]$Once
)
$ErrorActionPreference = 'Continue'
$logFile = Join-Path $NextDir 'bridge-supervisor.log'
function Log([string]$m) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m
  Write-Output $line
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}
function Test-Bridge {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3010/ping' -TimeoutSec 3 -UseBasicParsing
    return [bool]($r -and $r.ok)
  } catch { return $false }
}
function Test-BridgeStatus {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3010/get_status' -TimeoutSec 3 -Method POST -Body '{}' -ContentType 'application/json' -UseBasicParsing
    if ($r -and $r.data) { Log ('桥自检: ' + ($r.data | ConvertTo-Json -Compress -Depth 3)) }
  } catch {}
}
Log '=== supervisor start ==='
while ($true) {
  if (Test-Bridge) {
    Log 'bridge ok'
    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSec
    continue
  }
  Log 'bridge DOWN -> 检查便携 QQ'
  $qq = Get-CimInstance Win32_Process -Filter "Name='QQPortable.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -like "$QqDir*" } | Select-Object -First 1
  if (-not $qq) {
    Log '便携 QQ 不在运行 -> 启动（首次需要手动登录她的号）'
    try { Start-Process -FilePath (Join-Path $QqDir 'QQPortable.exe') -WorkingDirectory $QqDir | Out-Null } catch { Log ('启动 QQ 失败: ' + $_.Exception.Message) }
    Start-Sleep -Seconds 25
  }
  Log '重新注入 + 启动桥（start-bridge.ps1）'
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $NextDir 'start-bridge.ps1') *>> $logFile
  } catch { Log ('start-bridge 失败: ' + $_.Exception.Message) }
  Start-Sleep -Seconds 8
  if (Test-Bridge) { Log 'bridge recovered'; Test-BridgeStatus }
  else { Log 'bridge still down（QQ 未登录 / 注入被拦 / 端口被占）' }
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSec
}
Log '=== supervisor exit ==='
