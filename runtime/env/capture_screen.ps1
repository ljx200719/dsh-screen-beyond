# Fallback: capture host desktop to a PNG (used by /api/screen/pc when the desktop kernel is unavailable)
param([string]$OutFile)
$ErrorActionPreference = 'Stop'
if (-not $OutFile) { $OutFile = Join-Path $env:TEMP ('dsh-screen-' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds() + '.png') }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$dir = [System.IO.Path]::GetDirectoryName($OutFile)
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output ('saved ' + $OutFile)
