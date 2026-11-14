# 屏幕彼端 · 自建 QQ 桥启动脚本（研究原型，2026-11-15）
# 作用：把 debug shell + QQ 桥注入 F:\onebot\QQ-portable（QQ 9.9.37 便携副本，登录她的号），
#       在 QQ 主进程里起 127.0.0.1:3010 的 OneBot 11 子集 HTTP 服务。
# 前提：便携 QQ 已登录、Java（注入器要求）可用；重启 QQ 后需要重新跑本脚本。
# 用法：powershell -ExecutionPolicy Bypass -File start-bridge.ps1
param(
  [string]$QqDir = 'F:\onebot\QQ-portable',
  [string]$NextDir = 'F:\onebot\next',
  [string]$JdkBin = 'F:\onebot\next\zulu21.54.109-ca-jdk21.0.13.0.3-win_x64\bin',
  [string]$NodeExe = 'D:\新建文件夹 (3)\DeepSeek Harness.exe'
)
$ErrorActionPreference = 'Stop'
Write-Output '=== 1) 检查/启动便携 QQ ==='
$qq = Get-CimInstance Win32_Process -Filter "Name='QQPortable.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like "$QqDir*" }
if (-not $qq) {
  Start-Process -FilePath (Join-Path $QqDir 'QQPortable.exe') -WorkingDirectory $QqDir | Out-Null
  Write-Output '已启动便携 QQ，等待 20 秒（首次需要手动登录她的号）'
  Start-Sleep -Seconds 20
} else { Write-Output '便携 QQ 已在运行' }
Write-Output '=== 2) 注入 debug shell（会弹出几个调试确认框，脚本自动点掉）==='
$clicker = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $NextDir 'sbc-uia-ok.ps1'),'-Seconds','120' -WindowStyle Hidden -PassThru
Push-Location $NextDir
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  & (Join-Path $JdkBin 'java.exe') -cp 'ElectronInjector.jar;.' BridgeInjector QQPortable.exe 'F:/onebot/next/shell2.js'
} finally { Pop-Location }
Start-Sleep -Seconds 2
try { $ping = (& $NodeExe (Join-Path $NextDir 'sbc-eval.mjs') '@F:\onebot\next\e19.js') } catch {}
Write-Output '=== 3) 启动桥（端口 3010）==='
& $NodeExe (Join-Path $NextDir 'sbc-eval.mjs') '@F:\onebot\next\e19.js'
Start-Sleep -Seconds 1
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3010/get_login_info' -Method POST -Body '{}' -ContentType 'application/json' -TimeoutSec 5 -UseBasicParsing
  Write-Output ('桥状态: ' + $r.Content)
} catch {
  try {
    & $NodeExe (Join-Path $NextDir 'sbc-eval.mjs') "return globalThis.__sbcStartBridge({require:require,process:process,electron:require('electron'),fs:fs,path:path,http:require('http')})"
    Start-Sleep -Seconds 1
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3010/get_login_info' -Method POST -Body '{}' -ContentType 'application/json' -TimeoutSec 5 -UseBasicParsing
    Write-Output ('桥状态: ' + $r.Content)
  } catch { Write-Output ('桥启动失败: ' + $_.Exception.Message) }
}
Write-Output '完成。插件 设置→VM→聊天软件直连 填 http://127.0.0.1:3010（token 留空，对方 QQ 号 = aedo 的号）。'
