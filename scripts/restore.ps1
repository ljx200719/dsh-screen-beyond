# 从备份恢复（会覆盖当前插件与角色数据）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -BackupDir "备份目录"
param(
  [string]$BackupDir,
  [string]$PluginDir,
  [string]$DataRoot,
  [int]$Port = 8900
)
$ErrorActionPreference = 'Stop'
if (-not $BackupDir -or -not (Test-Path $BackupDir)) { throw "备份目录不存在：$BackupDir" }
if (-not (Test-Path (Join-Path $BackupDir 'manifest.json'))) { throw "这个目录不像备份（没有 manifest.json）" }
if (-not $PluginDir) { $PluginDir = Split-Path $PSScriptRoot -Parent }
if (-not $DataRoot) {
  if ($env:LINZHI_ROOT) { $DataRoot = $env:LINZHI_ROOT }
  else { $DataRoot = Join-Path $env:USERPROFILE '.dsh-companion' }
}

Write-Host "=== 1) 停止运行时 ==="
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Host "=== 2) 恢复插件 ==="
$plugin = Join-Path $BackupDir 'plugin'
if (Test-Path $plugin) {
  foreach ($n in @('lib', 'runtime', 'scripts', 'examples')) {
    $p = Join-Path $plugin $n
    if (Test-Path $p) { Copy-Item $p $PluginDir -Recurse -Force }
  }
  foreach ($f in @('package.json', 'cordis.patch.yml', 'README.md', 'LICENSE')) {
    $p = Join-Path $plugin $f
    if (Test-Path $p) { Copy-Item $p $PluginDir -Force }
  }
  Write-Host "plugin restored"
}

Write-Host "=== 3) 恢复数据 ==="
$data = Join-Path $BackupDir 'data'
if (Test-Path $data) {
  New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
  if (Test-Path (Join-Path $data 'config.json')) { Copy-Item (Join-Path $data 'config.json') $DataRoot -Force }
  if (Test-Path (Join-Path $data 'characters')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'data') | Out-Null
    Copy-Item (Join-Path $data 'characters') (Join-Path $DataRoot 'data') -Recurse -Force
  }
  if (Test-Path (Join-Path $data 'models')) { Copy-Item (Join-Path $data 'models') $DataRoot -Recurse -Force }
  if (Test-Path (Join-Path $data 'messages.json.legacy')) { Copy-Item (Join-Path $data 'messages.json.legacy') (Join-Path $DataRoot 'data\messages.json') -Force }
  Write-Host "data restored"
}

Write-Host "恢复完成。重启 DSH（或重新打开插件）即可。"
