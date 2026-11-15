param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Voice = '',
  [int]$Rate = 0
)

# 屏幕彼端 · SAPI 离线合成（0.8.3）
# 中文文本走命令行参数会被引号/编码搞坏，所以文本先落到 UTF-8 临时文件，这里按 UTF-8 读。
# 注意：本文件必须是 UTF-8 **带 BOM**（Windows PowerShell 5.1 会按 ANSI 读无 BOM 脚本，中文注释会直接语法错误）。

try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

  if ($Voice -and $Voice.Trim()) {
    try { $synth.SelectVoice($Voice.Trim()) } catch { }
  } else {
    $zh = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1
    if ($zh) { try { $synth.SelectVoice($zh.VoiceInfo.Name) } catch { } }
  }

  if ($Rate -lt -10) { $Rate = -10 }
  if ($Rate -gt 10) { $Rate = 10 }
  $synth.Rate = $Rate

  $body = [IO.File]::ReadAllText($Text, [Text.Encoding]::UTF8)
  if (-not $body -or -not $body.Trim()) { throw 'empty text' }

  $synth.SetOutputToWaveFile($Out)
  $synth.Speak($body)
  $synth.Dispose()
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
