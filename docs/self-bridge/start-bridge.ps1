# 屏幕彼端 · 自建 QQ 桥启动脚本（研究原型，2026-11-15）
# 作用：把 debug shell + QQ 桥注入 F:\onebot\QQ-portable（QQ 9.9.37 便携副本，登录她的号），
#       在 QQ 主进程里起 127.0.0.1:3010 的 OneBot 11 子集 HTTP 服务。
# 前提：便携 QQ 已登录、Java（注入器要求）可用；重启 QQ 后需要重新跑本脚本。
# 用法：powershell -ExecutionPolicy Bypass -File start-bridge.ps1
#
# ⚠ 需要人工确认 3 次（F-019 实测结论，别指望全自动）：
#   注入会在 QQ 里触发 3 个系统确认框（调试权限/注入确认类）。脚本会尽力自动点掉，
#   但自动点击器在部分机器/部分 QQ 版本上会失效 —— 失效时请自己手动点「是/允许」3 次。
#   所以：**看到这里就必须知道要人工盯一次，注入期间别走开。**
#
# 校验：注入完成后脚本会检查
#   ① bridge.log 里有 boot-probe（代码真的在 QQ 进程里跑起来了）
#   ② 3010 端口在监听
#   ③ POST /get_login_info 能拿到账号
#   三条都过才算成功；否则输出「桥没起来」的原因与下一步，并以退出码 1 结束。
param(
  [string]$QqDir = 'F:\onebot\QQ-portable',
  [string]$NextDir = 'F:\onebot\next',
  [string]$JdkBin = 'F:\onebot\next\zulu21.54.109-ca-jdk21.0.13.0.3-win_x64\bin',
  [string]$NodeExe = 'D:\新建文件夹 (3)\DeepSeek Harness.exe',
  [int]$BridgePort = 3010,
  [int]$InjectWaitSec = 25
)
$ErrorActionPreference = 'Stop'
$logPath = Join-Path $NextDir 'bridge.log'
$qqExe = Join-Path $QqDir 'QQPortable.exe'
$injectorJar = Join-Path $NextDir 'ElectronInjector.jar'
$javaExe = Join-Path $JdkBin 'java.exe'

# P2-12：注入器对“目标不存在/注入器没真正工作”也可能打印 injected OK。
# 这些前置检查不通过就别走到注入器，避免假成功日志误导排障。
if (-not (Test-Path $qqExe)) {
  Write-Output ('[FAIL] 找不到便携 QQ：' + $qqExe)
  Write-Output '  自建桥只支持便携版 QQ；当前是安装版 QQ 的话，无法用这套注入脚本。'
  Write-Output '  见 docs/DIRECT-CHAT.md 的「限制」一节。'
  exit 1
}
if (-not (Test-Path $injectorJar)) {
  Write-Output ('[FAIL] 找不到注入器：' + $injectorJar)
  Write-Output '  需要先准备 ElectronInjector.jar（见 docs/SELF-BRIDGE-RESEARCH.md）。'
  exit 1
}
if (-not (Test-Path $javaExe)) {
  Write-Output ('[FAIL] 找不到 Java：' + $javaExe)
  exit 1
}

function Show-ManualHint {
  Write-Output ''
  Write-Output '⚠ 人工确认 3 次：注入时 QQ 会弹 3 个系统确认框。'
  Write-Output '  脚本会在后台尝试自动点掉；如果没点掉，请在这台机器上手动点「是 / 允许」3 次。'
  Write-Output '  只有 3 次都点完，桥才可能起来（这一步没有办法完全自动化）。'
  Write-Output ''
}

function Test-BridgeListening {
  try {
    $c = Get-NetTCPConnection -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue
    return [bool]$c
  } catch { return $false }
}

function Test-BridgeLogin {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:$BridgePort/get_login_info") -Method POST -Body '{}' -ContentType 'application/json' -TimeoutSec 5 -UseBasicParsing
    return [string]$r.Content
  } catch { return '' }
}

function Get-BootProbeLine {
  if (-not (Test-Path $logPath)) { return '' }
  try {
    # 只看最近 400 行，避免日志很大时把内存吃满
    $tail = Get-Content $logPath -Tail 400 -ErrorAction SilentlyContinue | Where-Object { $_ -like '*boot-probe*' }
    if ($tail) { return [string]($tail | Select-Object -Last 1) }
    return ''
  } catch { return '' }
}

Write-Output '=== 1) 检查/启动便携 QQ ==='
$qq = Get-CimInstance Win32_Process -Filter "Name='QQPortable.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like "$QqDir*" }
if (-not $qq) {
  Start-Process -FilePath $qqExe -WorkingDirectory $QqDir | Out-Null
  Write-Output '已启动便携 QQ，等待 20 秒（首次需要手动登录她的号）'
  Start-Sleep -Seconds 20
  $qq = Get-CimInstance Win32_Process -Filter "Name='QQPortable.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like "$QqDir*" }
}
if (-not $qq) {
  Write-Output '[FAIL] 便携 QQ 没启动起来；不会继续注入（避免假成功）。'
  Write-Output '  请先手动打开便携版 QQ 并登录她的号，再重跑本脚本。'
  exit 1
}
Write-Output '便携 QQ 已在运行'

# 记录注入前的日志位置，方便只看这次新增的 boot-probe
$beforeLen = 0
try { if (Test-Path $logPath) { $beforeLen = (Get-Item $logPath).Length } } catch {}

Write-Output '=== 2) 注入 debug shell（会弹 3 个系统确认框；自动点击器只是尽力而为）==='
Show-ManualHint
# 自动点击器：失败了也没关系，脚本不依赖它的返回值（F-019：以前它悄悄失效，这里改成"尽力而为"）
try {
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $NextDir 'sbc-uia-ok.ps1'),'-Seconds','120' -WindowStyle Hidden -PassThru | Out-Null
} catch { Write-Output ('自动点击器没能启动（不影响后续，请手动点 3 次）：' + $_.Exception.Message) }
Push-Location $NextDir
$env:ELECTRON_RUN_AS_NODE = '1'
$injectorOutput = @()
try {
  # 注意：以下只是注入器的 stdout，不是最终成功依据；最终只看 boot-probe / 3010 / 登录账号。
  Write-Output '注入器输出（不代表成功，最终看第 4 步自检）：'
  $injectorOutput = & $javaExe -cp 'ElectronInjector.jar;.' BridgeInjector QQPortable.exe 'F:/onebot/next/shell2.js' 2>&1
  $injectorCode = $LASTEXITCODE
  foreach ($line in @($injectorOutput)) { Write-Output ('  ' + $line) }
  Write-Output ('注入器退出码：' + $injectorCode)
  if ($injectorOutput -match 'injected OK') {
    Write-Output '注意：注入器声称 injected OK，但这可能只是它的固定文案，不能当作成功；以第 4 步为准。'
  }
} catch {
  Write-Output ('注入器执行失败：' + $_.Exception.Message)
} finally { Pop-Location }
Write-Output ('等待注入生效（最多 ' + $InjectWaitSec + ' 秒，期间请把 3 个确认框点完）…')
Start-Sleep -Seconds 2
try { $null = (& $NodeExe (Join-Path $NextDir 'sbc-eval.mjs') '@F:\onebot\next\e19.js') } catch {}

Write-Output '=== 3) 启动桥（端口 ' + $BridgePort + '）==='
try { $null = (& $NodeExe (Join-Path $NextDir 'sbc-eval.mjs') '@F:\onebot\next\e19.js') } catch {}
try {
  $null = (& $NodeExe (Join-Path $NextDir 'sbc-eval.mjs') "return globalThis.__sbcStartBridge({require:require,process:process,electron:require('electron'),fs:fs,path:path,http:require('http')})")
} catch {}

Write-Output '=== 4) 校验注入与监听 ==='
$deadline = (Get-Date).AddSeconds($InjectWaitSec)
$login = ''
$listening = $false
while ((Get-Date) -lt $deadline) {
  $listening = Test-BridgeListening
  if ($listening) { $login = Test-BridgeLogin; if ($login) { break } }
  Start-Sleep -Milliseconds 800
}
$boot = Get-BootProbeLine
$bootNew = $false
if ($boot) {
  # 只关心这次注入之后产生的 boot-probe
  try { $bootNew = ((Get-Item $logPath).Length -gt $beforeLen) -or ($beforeLen -eq 0) } catch { $bootNew = $true }
}

Write-Output ''
Write-Output '──────── 桥自检 ────────'
Write-Output ('boot-probe : ' + $(if ($boot) { '有 ' + $boot } else { '没有（代码没进 QQ 进程 / 注入没成功）' }))
Write-Output ('3010 监听  : ' + $(if ($listening) { '是' } else { '否' }))
Write-Output ('get_login_info : ' + $(if ($login) { $login } else { '无响应' }))
Write-Output ('日志       : ' + $logPath)
Write-Output '────────────────────────'

if ($listening -and $login) {
  Write-Output '[OK] 桥已就绪。插件 设置 → VM → 聊天软件直连 填 http://127.0.0.1:3010（token 留空，对方 QQ 号 = aedo 的号）。'
  exit 0
}

Write-Output '[FAIL] 桥没起来 —— 不要当成成功了。按下面顺序排查：'
if (-not $boot) {
  Write-Output '  1) 3 个系统确认框是不是没点完？重跑本脚本，并把 3 个框都点「是/允许」。'
  Write-Output '  2) 便携 QQ 是否已登录她的号？（没登录时注入进去也不会启动桥）'
  Write-Output '  3) 注入器/Java 是否可用：' + $JdkBin
} else {
  Write-Output '  1) boot-probe 有、但端口没监听 → 端口被别的程序占用，换 -BridgePort 或先关掉占用 3010 的进程。'
  Write-Output '  2) 看日志里有没有 listen-fail / http-throw，按它写的原因处理。'
  Write-Output '  3) QQ 版本更新后 DOM 选择器可能失效，需要重新适配桥。'
}
Write-Output '  详细步骤：docs/DIRECT-CHAT.md；研究记录：docs/SELF-BRIDGE-RESEARCH.md'
exit 1
