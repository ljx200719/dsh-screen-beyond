# 备份插件 + 运行时 + 角色数据（改动前跑一次）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1 -DataRoot "D:\你的数据目录"
param(
  [string]$OutRoot,
  [string]$PluginDir,
  [string]$DataRoot,
  [int]$Keep = 10
)
$ErrorActionPreference = 'Stop'
if (-not $PluginDir) { $PluginDir = Split-Path $PSScriptRoot -Parent }
if (-not $DataRoot) {
  if ($env:LINZHI_ROOT) { $DataRoot = $env:LINZHI_ROOT }
  else { $DataRoot = Join-Path $env:USERPROFILE '.dsh-companion' }
}
if (-not $OutRoot) { $OutRoot = Join-Path $DataRoot 'backups' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dst = Join-Path $OutRoot ("backup-" + $stamp)
New-Item -ItemType Directory -Force -Path $dst | Out-Null

function Copy-Block($src, $name) {
  if (-not (Test-Path $src)) { return }
  $target = Join-Path $dst $name
  if ((Get-Item $src).PSIsContainer) {
    Copy-Item $src $target -Recurse -Force
  } else {
    $parent = Split-Path $target -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Copy-Item $src $target -Force
  }
  Write-Host "captured: $name"
}

# 1) 插件本体
foreach ($n in @('lib', 'runtime', 'scripts', 'examples')) { Copy-Block (Join-Path $PluginDir $n) (Join-Path 'plugin' $n) }
foreach ($f in @('package.json', 'cordis.patch.yml', 'README.md', 'LICENSE')) { Copy-Block (Join-Path $PluginDir $f) (Join-Path 'plugin' $f) }

# 2) 角色数据 + 用户配置 + 导入素材
Copy-Block (Join-Path $DataRoot 'config.json') 'data\config.json'
Copy-Block (Join-Path $DataRoot 'sync') 'data\sync'
Copy-Block (Join-Path $DataRoot 'data\characters') 'data\characters'
Copy-Block (Join-Path $DataRoot 'models') 'data\models'
Copy-Block (Join-Path $DataRoot 'data\messages.json') 'data\messages.json.legacy'

# 3) 清单
$manifest = Get-ChildItem $dst -Recurse -File | ForEach-Object {
  [pscustomobject]@{
    path = $_.FullName.Substring($dst.Length + 1)
    size = $_.Length
    md5  = (Get-FileHash $_.FullName -Algorithm MD5).Hash
  }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $dst 'manifest.json') -Encoding UTF8
$total = ($manifest | Measure-Object -Property size -Sum).Sum
$count = ($manifest | Measure-Object).Count
Write-Host ("backup done: {0}  files={1}  size={2:N1} MB" -f $dst, $count, ($total / 1MB))

# 4) 压缩一份
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null
$zip = Join-Path $OutRoot ("backup-" + $stamp + ".zip")
Compress-Archive -Path (Join-Path $dst '*') -DestinationPath $zip -Force
Write-Host ("zip: {0}  ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))

# 6) 只保留最近 Keep 份（目录 + zip 一起清）
if ($Keep -gt 0) {
  $all = @(Get-ChildItem $OutRoot -Filter 'backup-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
  $keepNames = @{}
  foreach ($item in $all) {
    $name = $item.Name -replace '\.zip$', ''
    if ($keepNames.Count -lt $Keep) { $keepNames[$name] = $true }
  }
  foreach ($item in $all) {
    $name = $item.Name -replace '\.zip$', ''
    if (-not $keepNames.ContainsKey($name)) {
      try { Remove-Item $item.FullName -Recurse -Force; Write-Host "pruned: $($item.Name)" } catch {}
    }
  }
}
