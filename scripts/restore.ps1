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
foreach ($c in $conns) {
  $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue
  if ($proc -and ([string]$proc.CommandLine) -match 'server\.mjs|dsh-screen-beyond') {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host ("警告：端口 {0} 被非本插件进程占用（pid {1} {2}），未结束" -f $Port, $c.OwningProcess, $proc.Name)
  }
}
Start-Sleep -Seconds 2

Write-Host "=== 2) 恢复插件 ==="
function Merge-Dir([string]$Src, [string]$Dst) {
  # Copy-Item 直接把目录复制进已存在的同名目录会生成 嵌套目录（lib\lib）；
  # 这里复制目录内容来合并覆盖。
  if (-not $Src -or -not (Test-Path $Src)) { return }
  New-Item -ItemType Directory -Force -Path $Dst | Out-Null
  Copy-Item -Path (Join-Path $Src '*') -Destination $Dst -Recurse -Force
}
$plugin = Join-Path $BackupDir 'plugin'
if (Test-Path $plugin) {
  foreach ($n in @('lib', 'runtime', 'scripts', 'examples')) {
    Merge-Dir (Join-Path $plugin $n) (Join-Path $PluginDir $n)
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
  if (Test-Path (Join-Path $data 'sync')) { Merge-Dir (Join-Path $data 'sync') (Join-Path $DataRoot 'sync') }
  if (Test-Path (Join-Path $data 'characters')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'data') | Out-Null
    Merge-Dir (Join-Path $data 'characters') (Join-Path $DataRoot 'data\characters')
  }
  if (Test-Path (Join-Path $data 'images')) { Merge-Dir (Join-Path $data 'images') (Join-Path $DataRoot 'data\images') }
  if (Test-Path (Join-Path $data 'models')) { Merge-Dir (Join-Path $data 'models') (Join-Path $DataRoot 'models') }
  if (Test-Path (Join-Path $data 'messages.json.legacy')) { Copy-Item (Join-Path $data 'messages.json.legacy') (Join-Path $DataRoot 'data\messages.json') -Force }
  Write-Host "data restored"
}

Write-Host "恢复完成。重启 DSH（或重新打开插件）即可。"
