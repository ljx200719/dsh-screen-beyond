param([string]$Mode)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$stdin = [Console]::OpenStandardInput()
$ms = New-Object System.IO.MemoryStream
$stdin.CopyTo($ms)
$in = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
if ($Mode -eq 'encrypt') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($in)
  $enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write('DPAPI1:' + [Convert]::ToBase64String($enc))
} else {
  $s = $in.Trim()
  if ($s.StartsWith('DPAPI1:')) { $s = $s.Substring(7) }
  $bytes = [Convert]::FromBase64String($s)
  $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($dec))
}
