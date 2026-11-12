param(
  [string]$Base = 'http://127.0.0.1:8900',
  [string]$Root = ''
)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not $Root) { $Root = Join-Path $env:USERPROFILE '.dsh-companion' }
$DataDir = Join-Path $Root 'data'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$UiFile = Join-Path $DataDir 'pet-ui.json'
$LogFile = Join-Path $DataDir 'pet.log'
$script:mutex = New-Object System.Threading.Mutex($false, 'Local\DshCompanionPet')
if (-not $script:mutex.WaitOne(0)) { try { exit } catch {} }

function Log($m) { try { Add-Content $LogFile ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) } catch {} }
function ApiGet($path) { try { return Invoke-RestMethod -Uri ($Base + $path) -TimeoutSec 8 -UseBasicParsing } catch { return $null } }
function ApiPost($path, $obj) {
  try {
    $json = $obj | ConvertTo-Json -Depth 12 -Compress
    return Invoke-RestMethod -Uri ($Base + $path) -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 30 -UseBasicParsing
  } catch { Log ("POST " + $path + " err: " + $_.Exception.Message); return $null }
}
function Fmt-Tok($n) {
  $v = [double]$n
  if ($v -ge 100000000) { return ('{0:N1}亿' -f ($v / 100000000)) }
  if ($v -ge 10000) { return ('{0:N1}万' -f ($v / 10000)) }
  if ($v -ge 1000) { return ('{0:N1}k' -f ($v / 1000)) }
  return [string][int]$v
}
function Brush($hex) { return [System.Windows.Media.BrushConverter]::new().ConvertFromString($hex) }
function SoftShadow($blur=16,$op=0.18) {
  $e = New-Object System.Windows.Media.Effects.DropShadowEffect
  $e.Color = [System.Windows.Media.Color]::FromRgb(87, 70, 52); $e.BlurRadius = $blur; $e.ShadowDepth = 3; $e.Opacity = $op; $e.Direction = 270
  return $e
}

$script:pet = $null
$script:status = $null
$script:lastMsgId = 0
$script:lastBubbleId = 0
$script:statusText = $null
$script:tokenText = $null
$script:img = $null
$script:win = $null
$script:chatPanel = $null
$script:chatStack = $null
$script:chatScroll = $null
$script:chatBox = $null
$script:chatTimer = $null
$script:mainTimer = $null
$script:downPoint = $null
$script:isDragging = $false
$script:bubbleUntil = [DateTime]::MinValue
$script:lastAvatarUrl = ''
$script:chatDelta = 318
$script:suppressSave = $false

function Pulse-Ui($elem, [double]$dy = -4, [int]$ms = 260) {
  if (-not $elem) { return }
  try {
    $a = New-Object System.Windows.Media.Animation.DoubleAnimation
    $a.From = 0.32; $a.To = 1.0; $a.Duration = [TimeSpan]::FromMilliseconds([int]($ms * 1.7))
    $elem.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $a)
  } catch {}
}
function Start-UiIdle($elem) {
  if (-not $elem) { return }
  try {
    $t = New-Object System.Windows.Media.TranslateTransform
    $elem.RenderTransform = $t
    $a = New-Object System.Windows.Media.Animation.DoubleAnimation
    $a.From = 0; $a.To = -4.5; $a.Duration = [TimeSpan]::FromMilliseconds(2600)
    $a.AutoReverse = $true; $a.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
    $t.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $a)
  } catch {}
}
function Pulse-PetUi() {
  Pulse-Ui $script:btnPanel -4 280
  Pulse-Ui $script:tokenPill -3 240
  Pulse-Ui $script:statusBorder -2 220
}
function Fade-AttrPanel([bool]$show) {
  if (-not $script:attrPanel) { return }
  try {
    if ($show) { $script:attrPanel.Visibility = 'Visible'; $script:attrPanel.Opacity = 1 }
    $a = New-Object System.Windows.Media.Animation.DoubleAnimation
    $a.To = if ($show) { 1 } else { 0 }
    $a.Duration = [TimeSpan]::FromMilliseconds(140)
    if (-not $script:attrPanel.RenderTransform) { $script:attrPanel.RenderTransform = New-Object System.Windows.Media.TranslateTransform }
    $t = $script:attrPanel.RenderTransform
    if ($show) {
      $slide = New-Object System.Windows.Media.Animation.DoubleAnimation
      $slide.From = -6; $slide.To = 0; $slide.Duration = [TimeSpan]::FromMilliseconds(150)
      $t.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $slide)
    }
    $a.Add_Completed({ if (-not $script:attrPanel -or $script:attrPanel.Opacity -le 0.02) { $script:attrPanel.Visibility = 'Collapsed' } })
    $script:attrPanel.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $a)
  } catch {}
}
function Update-PetLayout() {
  if (-not $script:img -or -not $script:btnPanel -or -not $script:tokenPill) { return }
  try {
    $imgW = [double]$script:img.Width
    $size = [double]$script:img.Height
    if ($imgW -le 1) { return }
    $imgLeft = 140
    $imgTop = 12
    $attrTop = 80
    $btnTop = 100
    $tokenTop = $imgTop + $size + 10
    # 固定窗口尺寸，缩放时只移动 UI，避免窗口 resize 造成的延迟
    [System.Windows.Controls.Canvas]::SetLeft($script:img, $imgLeft)
    [System.Windows.Controls.Canvas]::SetTop($script:img, $imgTop)
    [System.Windows.Controls.Canvas]::SetLeft($script:attrPanel, 12)
    [System.Windows.Controls.Canvas]::SetTop($script:attrPanel, $attrTop)
    [System.Windows.Controls.Canvas]::SetLeft($script:btnPanel, $imgLeft + $imgW + 16)
    [System.Windows.Controls.Canvas]::SetTop($script:btnPanel, $btnTop)
    [System.Windows.Controls.Canvas]::SetLeft($script:tokenPill, [math]::Round($imgLeft + ($imgW - 190) / 2))
    [System.Windows.Controls.Canvas]::SetTop($script:tokenPill, $tokenTop)
    $script:animBase = @{ img = $imgTop; btn = $btnTop; token = $tokenTop; attr = $attrTop }
  } catch {}
}

function Load-Manifest() {
  $m = $null
  for ($i = 0; $i -lt 5; $i++) {
    $m = ApiGet '/api/pet/manifest'
    if ($m -and $m.pet) { break }
    Start-Sleep -Milliseconds 500
  }
  $script:petCharId = ''
$script:bubbleTimer = $null
  if ($m -and $m.status -and $m.status.character -and $m.status.character.id) { $script:petCharId = [string]$m.status.character.id }
  if ($m -and $m.pet) { $script:pet = $m.pet } else {
    $script:pet = [pscustomobject]@{
      image = '/pet-sprite/idle.png'; size = 300; opacity = 1; statusText = $true; alwaysOnTop = $true
      expressions = [pscustomobject]@{ idle='/pet-sprite/idle.png'; pat='/pet-sprite/pat.png'; rub='/pet-sprite/rub.png'; look='/pet-sprite/look.png' }
      gestures = @(
        [pscustomobject]@{ id='pat'; label='摸摸头'; hit=[pscustomobject]@{x=0.12;y=0.04;w=0.76;h=0.22}; prompt='（你摸了摸她的头）'; bubble='唔…' },
        [pscustomobject]@{ id='rub'; label='搓一搓'; hit=[pscustomobject]@{x=0.2;y=0.26;w=0.6;h=0.24}; prompt='（你轻轻搓了搓她的脸颊）'; bubble='唔哇…' },
        [pscustomobject]@{ id='poke'; label='戳一下'; hit=[pscustomobject]@{x=0.28;y=0.50;w=0.44;h=0.32}; prompt='（你戳了戳她的脸）'; bubble='干嘛啦' }
      )
      buttons = @(
        [pscustomobject]@{ id='chat'; label=''; action='chat'; title='和她说话'; icon='chat-line' },
        [pscustomobject]@{ id='look'; label=''; action='look'; title='看看我的屏幕'; icon='eye-line' }
      )
    }
  }
  Clean-PetCache
  if (-not $script:pet.expressions) { try { $script:pet.expressions = [pscustomobject]@{ idle='/pet-sprite/idle.png'; pat='/pet-sprite/pat.png'; rub='/pet-sprite/rub.png'; look='/pet-sprite/look.png' } } catch {} }
}
function Clean-PetCache() {
  try {
    $cutoff = (Get-Date).AddDays(-7)
    Get-ChildItem $DataDir -Filter 'sprite-*.png' -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff } |
      ForEach-Object { try { Remove-Item $_.FullName -Force } catch {} }
    Get-ChildItem $DataDir -Filter 'pet-custom-*.png' -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff } |
      ForEach-Object { try { Remove-Item $_.FullName -Force } catch {} }
  } catch {}
}
function Resolve-ImagePath([string]$spec = '') {
  if (-not $spec) { $spec = [string]$script:pet.image }
  if (-not $spec -or $spec -eq 'avatar') {
    $dest = Join-Path $DataDir 'pet-avatar.png'
    try {
      $resp = Invoke-WebRequest -Uri ($Base + '/api/pet/avatar') -TimeoutSec 15 -UseBasicParsing
      $bytes = $resp.Content
      if ($bytes -is [byte[]]) { [IO.File]::WriteAllBytes($dest, $bytes) }
      else { [IO.File]::WriteAllBytes($dest, [Text.Encoding]::UTF8.GetBytes([string]$bytes)) }
      return $dest
    } catch { Log 'avatar download failed'; return (Join-Path $PSScriptRoot 'default-avatar.png') }
  }
  if ($spec -match '^/pet-sprite/') {
    $leaf = [IO.Path]::GetFileName($spec)
    $cacheName = if ($script:petCharId) { 'sprite-' + $script:petCharId + '-' + $leaf } else { 'sprite-' + $leaf }
    $dest = Join-Path $DataDir $cacheName
    for ($i = 0; $i -lt 4; $i++) {
      try { Invoke-WebRequest -Uri ($Base + $spec) -OutFile $dest -TimeoutSec 15 -UseBasicParsing; return $dest }
      catch { Start-Sleep -Milliseconds 400 }
    }
    # 服务启动瞬间可能还没就绪：优先用同角色缓存，再退回旧缓存，至少不要变成空桌宠
    if (Test-Path $dest) { Log ('sprite download retry fallback: ' + $cacheName); return $dest }
    $legacy = Join-Path $DataDir ('sprite-' + $leaf)
    if (Test-Path $legacy) { Log ('sprite download legacy fallback: ' + $leaf); return $legacy }
    Log ('sprite download failed: ' + $spec); return $null
  }
  if ($spec -match '^https?://') {
    $dest = Join-Path $DataDir 'pet-custom.png'
    try { Invoke-WebRequest -Uri $spec -OutFile $dest -TimeoutSec 20 -UseBasicParsing; return $dest } catch { Log 'custom image download failed'; return $null }
  }
  if (-not [IO.Path]::IsPathRooted($spec)) {
    $relative = Join-Path $Root $spec
    if (Test-Path $relative) { return (Resolve-Path $relative).Path }
  }
  if (Test-Path $spec) { return (Resolve-Path $spec).Path }
  return $null
}

function Make-Bitmap([string]$path) {
  try {
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit()
    $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bmp.UriSource = New-Object System.Uri($path)
    $bmp.EndInit(); $bmp.Freeze()
    return $bmp
  } catch { Log ('bitmap err: ' + $_.Exception.Message); return $null }
}
function Update-Image([string]$expression = 'idle') {
  $spec = [string]$script:pet.image
  try {
    if ($expression -and $script:pet.expressions -and $script:pet.expressions.$expression) { $spec = [string]$script:pet.expressions.$expression }
  } catch {}
  $path = Resolve-ImagePath $spec
  if (-not $path) { return }
  $bmp = Make-Bitmap $path
  if (-not $bmp) { return }
  $size = [double]$script:pet.size; if ($size -le 0 -or $size -gt 600) { $size = 300 }
  $ratio = $bmp.PixelWidth / [double]$bmp.PixelHeight; if ($ratio -le 0) { $ratio = 0.75 }
  $script:img.Source = $bmp
  $script:img.Height = $size
  $script:img.Width = [math]::Round($size * $ratio)
  try { Update-PetLayout } catch {}
  try {
    $eff = New-Object System.Windows.Media.Effects.DropShadowEffect
    $eff.Color = [System.Windows.Media.Color]::FromRgb(80, 67, 52)
    $eff.BlurRadius = 18; $eff.ShadowDepth = 4; $eff.Opacity = 0.24; $eff.Direction = 270
    $script:img.Effect = $eff
  } catch {}
  $script:img.ToolTip = '摸摸头 · 搓一搓 · 戳一下 · 看屏幕'
}

$script:expressionTimer = $null
function Set-PetExpression([string]$name = 'idle', [int]$holdMs = 2600) {
  Log ('expr ' + $name)
  $script:reactionUntil = (Get-Date).AddMilliseconds(600)
  try { Update-Image $name; Pulse-PetUi } catch { Log ('expr err ' + $_.Exception.Message) }
  if ($holdMs -le 0) { return }
  try {
    if ($script:expressionTimer) { $script:expressionTimer.Stop() }
    $t = New-Object System.Windows.Threading.DispatcherTimer
    $t.Interval = [TimeSpan]::FromMilliseconds($holdMs)
    $t.Add_Tick({ try { $script:expressionTimer.Stop(); Update-Image 'idle' } catch {} })
    $script:expressionTimer = $t
    $t.Start()
  } catch {}
}

function Show-Bubble([string]$text, [int]$ms = 6000) {
  if (-not $script:statusText) { return }
  $script:statusText.Text = $text
  $script:bubbleUntil = (Get-Date).AddMilliseconds($ms)
  try { if ($script:statusBorder) { $script:statusBorder.Visibility = 'Visible' } } catch {}
  try {
    if ($script:bubbleTimer) { $script:bubbleTimer.Stop() }
    $script:bubbleTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:bubbleTimer.Interval = [TimeSpan]::FromMilliseconds([math]::Max(400, $ms))
    $script:bubbleTimer.Add_Tick({
      try { $script:bubbleTimer.Stop() } catch {}
      try { if ($script:statusBorder) { $script:statusBorder.Visibility = 'Collapsed' } } catch {}
    })
    $script:bubbleTimer.Start()
  } catch {}
}
function Gesture-At([double]$nx, [double]$ny) {
  foreach ($g in @($script:pet.gestures)) {
    if (-not $g.hit) { continue }
    $h = $g.hit
    if ($nx -ge [double]$h.x -and $nx -le ([double]$h.x + [double]$h.w) -and $ny -ge [double]$h.y -and $ny -le ([double]$h.y + [double]$h.h)) { return $g }
  }
  return $null
}
$script:lastActAt = [DateTime]::MinValue
function Send-Act($action, $gestureId, $prompt) {
  $now = Get-Date
  if (($now - $script:lastActAt).TotalMilliseconds -lt 1200) { return }
  $script:lastActAt = $now
  $body = @{ action = $action }
  if ($gestureId) { $body.gestureId = $gestureId }
  if ($prompt) { $body.prompt = $prompt }
  $r = ApiPost '/api/pet/act' $body
  if ($r -and $r.ok) {
    if ($action -eq 'look') { Show-Bubble '她正在看你的屏幕…' 8000 }
    elseif ($action -eq 'gesture') { }
    else { Show-Bubble '（她收到了）' 2000 }
  } elseif ($r -and $r.error -and ($r.error -match '429|Too Many|还在说话')) { Show-Bubble '她还在说话，等一下…' 1800 }
  elseif ($r -and $r.error) { Show-Bubble ('她：' + $r.error) 2500 }
  else { Show-Bubble '她暂时没回，可能还在忙…' 2500 }
}
function Append-Chat($who, $text) {
  if (-not $script:chatStack -or -not $text) { return }
  $item = New-Object System.Windows.Controls.TextBlock
  $item.Text = ($(if ($who -eq 'her') { '她：' } else { '你：' }) + $text)
  $item.TextWrapping = 'Wrap'
  $item.Width = 232
  $item.Margin = [System.Windows.Thickness]::new(4, 4, 4, 4)
  $item.Foreground = Brush $(if ($who -eq 'her') { '#4E6172' } else { '#6C89AA' })
  $script:chatStack.Children.Add($item) | Out-Null
  $script:chatScroll.ScrollToEnd()
}
function Load-ChatHistory() {
  $history = ApiGet '/api/events?since=0'
  if (-not ($history -and $history.messages)) { return }
  $recent = @($history.messages) | Select-Object -Last 8
  $script:lastMsgId = 0
  foreach ($m in $recent) {
    if ($m.id -gt $script:lastMsgId) { $script:lastMsgId = $m.id }
    if ($m.role -eq 'her' -or $m.role -eq 'user') { Append-Chat $m.role $m.text }
  }
}
function Send-Chat() {
  $text = $script:chatBox.Text.Trim()
  if (-not $text) { return }
  $script:chatBox.Text = ''
  Append-Chat 'user' $text
  $r = ApiPost '/api/chat' @{ text = $text }
  if ($r -and -not $r.ok) { Append-Chat 'her' ('（' + $r.error + '）') }
}
function Clamp-Window() {
  try {
    $wa = [System.Windows.SystemParameters]::WorkArea
    $w = [math]::Max(160, $script:win.ActualWidth)
    $h = [math]::Max(120, $script:win.ActualHeight)
    if ($script:win.Left -lt $wa.Left + 8) { $script:win.Left = $wa.Left + 8 }
    if ($script:win.Top -lt $wa.Top + 8) { $script:win.Top = $wa.Top + 8 }
    if ($script:win.Left + $w -gt $wa.Right - 8) { $script:win.Left = $wa.Right - $w - 8 }
    if ($script:win.Top + $h -gt $wa.Bottom - 8) { $script:win.Top = $wa.Bottom - $h - 8 }
  } catch {}
}
function Toggle-Chat() {
  if (-not $script:chatPanel) { return }
  $script:suppressSave = $true
  $visible = $script:chatPanel.Visibility -eq 'Visible'
  if ($visible) {
    $h0 = $script:win.ActualHeight
    $script:chatPanel.Visibility = 'Collapsed'
    $script:chatTimer.Stop()
    $script:win.UpdateLayout()
    $script:win.Top = $script:win.Top + [math]::Max(0, ($h0 - $script:win.ActualHeight))
  } else {
    $h0 = $script:win.ActualHeight
    $script:chatPanel.Visibility = 'Visible'
    $script:chatTimer.Start()
    $script:win.UpdateLayout()
    $script:win.Top = $script:win.Top - [math]::Max(0, ($script:win.ActualHeight - $h0))
    Load-ChatHistory
    $script:chatBox.Focus() | Out-Null
  }
  Clamp-Window
  $script:win.UpdateLayout()
  $script:suppressSave = $false
}
function Refresh-Status() {
  $st = ApiGet '/api/pet/status'
  if (-not $st -or -not $st.ok) {
    if ($script:statusText) { $script:statusText.Text = '连不上她…' }
    return
  }
  $script:status = $st
  # 切角色兜底：char-watch 计时器偶尔漏拍时，状态轮询也能触发换形象
  try {
    if ($st.character -and $st.character.id -and ([string]$st.character.id -ne [string]$script:petCharId)) {
      $script:petCharId = [string]$st.character.id
      $script:bubbleUntil = [DateTime]::MinValue
      $script:lastBubbleId = 0
      Load-Manifest
      Update-Image 'idle'
    }
  } catch {}
  if ($st.character -and $st.character.avatar -and $st.character.avatar -ne $script:lastAvatarUrl) {
    $script:lastAvatarUrl = $st.character.avatar
    Update-Image
  }
  if ($st.tokens) {
    $t = $st.tokens
    $bal = $t.deepseekBalance
    if ($bal -and $bal.ok) {
      $cur = if ([string]$bal.currency -eq 'CNY') { '¥' } else { [string]$bal.currency }
      $todayRmb = if ($null -ne $bal.todayRmb) { [double]$bal.todayRmb } else { 0 }
      $script:tokenText.Text = '余额 ' + $cur + [string]$bal.total + ' · 今日 ¥' + ('{0:0.00}' -f $todayRmb)
      $script:tokenText.ToolTip = ('DeepSeek 真实余额：{0}{1}{2}今日消耗：{0}{3:0.00}{4}今日 token：{5:N0}' -f $cur, [string]$bal.total, [Environment]::NewLine, $todayRmb, [Environment]::NewLine, [double]$t.dailyUsed)
    } else {
      $script:tokenText.Text = '余额读取失败 · 今日 ' + (Fmt-Tok $t.dailyUsed)
      $script:tokenText.ToolTip = '暂时读不到 DeepSeek 真实余额；不会用虚拟货币代替'
    }
  }
  $loc = ''; if ($st.place) { $loc = [string]$st.place.icon + ' ' + [string]$st.place.name }
  $act = if ($st.state -eq 'traveling' -or $st.state -eq 'intercity') { if ($st.transport) { $tr = [string]$st.transport; if ($tr -eq '步行' -or $tr -eq '骑车' -or $tr -eq '自驾') { '正在' + $tr } else { '正在坐' + $tr } } elseif ($st.state -eq 'traveling') { '在路上' } else { '出远门' } } elseif ($st.activity) { [string]$st.activity } else { '待着' }
  $en = if ($st.energy) { [string]$st.energy } else { '' }
  # 名字/地点/状态/精力必须随当前角色立即更新，不能被气泡计时挡住
  try {
    $nm = [string]($st.character.name)
    if ($script:attrName) { $script:attrName.Text = $nm }
    if ($script:attrPlace) { $script:attrPlace.Text = $loc }
    if ($script:attrAct) { $script:attrAct.Text = $act }
    if ($script:attrEnergy) { $script:attrEnergy.Text = $en }
    if ($script:chatTitle) { $script:chatTitle.Text = '和' + $nm + '说说话' }
  } catch {}
  if ($script:bubbleUntil -gt (Get-Date)) { return }
  if ($st.state -eq 'traveling') {
    $txt = ([string]$st.character.name) + ' · 在路上'
  } else {
    $txt = ([string]$st.character.name) + ' · ' + $loc + ' · ' + $act
  }
  if ($en) { $txt += ' · ' + $en }
  $script:statusText.Text = $txt
  if ($st.lastHer -and $st.lastHer.id -gt $script:lastBubbleId) {
    $script:lastBubbleId = [int]$st.lastHer.id
    $line = [string]$st.lastHer.text
    if ($line.Length -gt 60) { $line = $line.Substring(0, 60) + '…' }
    Show-Bubble ('她：' + $line) 9000
    if ($script:chatPanel -and $script:chatPanel.Visibility -eq 'Visible') { }
  }
}
function Cycle-PetSize() {
  $sizes = @(240, 300, 360)
  $cur = [double]$script:pet.size
  $next = $sizes[0]
  foreach ($s in $sizes) { if ($s -gt $cur) { $next = $s; break } }
  if ($cur -ge $sizes[-1]) { $next = $sizes[0] }
  $script:pet.size = $next
  Update-Image
  try { ApiPost '/api/pet' @{ size = $next } | Out-Null; Show-Bubble ('桌宠大小：' + $next) 1400 } catch {}
}
function Build-Button($b) {
  $border = New-Object System.Windows.Controls.Border
  $border.Width = 54; $border.Height = 38
  $border.CornerRadius = [System.Windows.CornerRadius]::new(19)
  $border.Background = Brush '#F2FFFCF7'
  $border.BorderBrush = Brush '#E4D6C4'
  $border.BorderThickness = [System.Windows.Thickness]::new(1)
  $border.Effect = SoftShadow 12 0.12
  $border.Margin = [System.Windows.Thickness]::new(2, 8, 2, 8)
  $border.Cursor = [System.Windows.Input.Cursors]::Hand
  if ([string]$b.icon -eq 'chat-line') {
    $grid = New-Object System.Windows.Controls.Grid
    $bubble = New-Object System.Windows.Shapes.Path
    $bubble.Data = [System.Windows.Media.Geometry]::Parse('M4.5,6 C4.5,4.6 5.6,3.5 7,3.5 L17,3.5 C18.4,3.5 19.5,4.6 19.5,6 L19.5,13 C19.5,14.4 18.4,15.5 17,15.5 L10.2,15.5 L6.5,18.7 L6.5,15.5 C5.3,15.5 4.5,14.7 4.5,13.5 Z')
    $bubble.Stroke = Brush '#5E7895'
    $bubble.StrokeThickness = 1.5
    $bubble.StrokeStartLineCap = 'Round'; $bubble.StrokeEndLineCap = 'Round'; $bubble.StrokeLineJoin = 'Round'
    $bubble.Stretch = 'Uniform'
    $bubble.Width = 19; $bubble.Height = 17
    $bubble.HorizontalAlignment = 'Center'; $bubble.VerticalAlignment = 'Center'
    $dots = New-Object System.Windows.Controls.StackPanel
    $dots.Orientation = 'Horizontal'
    $dots.HorizontalAlignment = 'Center'; $dots.VerticalAlignment = 'Center'
    $dots.Margin = [System.Windows.Thickness]::new(0, 0, 0, 1)
    foreach ($i in 1..3) {
      $d = New-Object System.Windows.Shapes.Ellipse
      $d.Width = 2.2; $d.Height = 2.2
      $d.Fill = Brush '#5E7895'
      $d.Margin = [System.Windows.Thickness]::new(1.1, 0, 1.1, 0)
      $dots.Children.Add($d) | Out-Null
    }
    $grid.Children.Add($bubble) | Out-Null
    $grid.Children.Add($dots) | Out-Null
    $border.Child = $grid
  } elseif ([string]$b.icon -eq 'eye-line') {
    $grid = New-Object System.Windows.Controls.Grid
    $eye = New-Object System.Windows.Shapes.Path
    $eye.Data = [System.Windows.Media.Geometry]::Parse('M2.5,12 C5.5,7.5 9,6 12,6 C15,6 18.5,7.5 21.5,12 C18.5,16.5 15,18 12,18 C9,18 5.5,16.5 2.5,12 Z')
    $eye.Stroke = Brush '#5E7895'
    $eye.StrokeThickness = 1.5
    $eye.StrokeStartLineCap = 'Round'; $eye.StrokeEndLineCap = 'Round'
    $eye.Stretch = 'Uniform'
    $eye.Width = 19; $eye.Height = 16
    $eye.HorizontalAlignment = 'Center'; $eye.VerticalAlignment = 'Center'
    $pupil = New-Object System.Windows.Shapes.Ellipse
    $pupil.Width = 4.8; $pupil.Height = 4.8
    $pupil.Fill = Brush '#5E7895'
    $pupil.HorizontalAlignment = 'Center'; $pupil.VerticalAlignment = 'Center'
    $grid.Children.Add($eye) | Out-Null
    $grid.Children.Add($pupil) | Out-Null
    $border.Child = $grid
  } else {
    $tb = New-Object System.Windows.Controls.TextBlock
    $tb.Text = [string]$b.label
    $tb.FontSize = 15
    $tb.HorizontalAlignment = 'Center'; $tb.VerticalAlignment = 'Center'
    $border.Child = $tb
  }
  $border.ToolTip = if ($b.title) { [string]$b.title } else { [string]$b.label }
  $border.Tag = [pscustomobject]@{ action = [string]$b.action; prompt = [string]$b.prompt; id = [string]$b.id }
  $border.Add_MouseEnter({ param($s,$e) $s.Background = Brush '#FFFFFFFF' })
  $border.Add_MouseLeave({ param($s,$e) $s.Background = Brush '#F2FFFCF7' })
  $border.Add_MouseLeftButtonUp({
    param($s, $e)
    $script:isDragging = $false
    $tag = $s.Tag
    switch ([string]$tag.action) {
      'chat' { Toggle-Chat }
      'look' { Set-PetExpression 'look' 600; Send-Act 'look' $null $null }
      'size' { Cycle-PetSize }
      'prompt' { if ($tag.prompt) { Send-Act 'gesture' $null ([string]$tag.prompt) } }
      default {
        if ($tag.prompt) { Send-Act 'gesture' $null ([string]$tag.prompt) }
        else { Send-Act 'gesture' ([string]$tag.id) $null }
      }
    }
  })
  return $border
}

Load-Manifest
$win = New-Object System.Windows.Window
$win.Title = '屏幕彼端 · 桌宠'
$win.FontFamily = 'Microsoft YaHei UI'
$win.WindowStyle = 'None'
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.Topmost = $true
$win.ShowInTaskbar = $false
$win.ResizeMode = 'NoResize'
$win.SizeToContent = 'Manual'
$win.Width = 480
$win.Height = 440
$script:win = $win
if ($script:pet.alwaysOnTop -eq $false) { $win.Topmost = $false }
try { $op = [double]$script:pet.opacity; if ($op -gt 0 -and $op -le 1) { $win.Opacity = $op } } catch {}

$outer = New-Object System.Windows.Controls.Canvas
$outer.Width = 480
$outer.Height = 440
$win.Content = $outer

# 聊天气泡面板（默认收起）
$chatBorder = New-Object System.Windows.Controls.Border
$chatBorder.Width = 280
$chatBorder.CornerRadius = [System.Windows.CornerRadius]::new(16)
$chatBorder.Background = Brush '#F6FFFCF7'
$chatBorder.BorderBrush = Brush '#E6D9C8'
$chatBorder.BorderThickness = [System.Windows.Thickness]::new(1)
$chatBorder.Padding = [System.Windows.Thickness]::new(12)
$chatBorder.Effect = SoftShadow 20 0.18
$chatBorder.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
$chatBorder.Visibility = 'Collapsed'
$script:chatPanel = $chatBorder
$chatInner = New-Object System.Windows.Controls.StackPanel

$chatHead = New-Object System.Windows.Controls.StackPanel
$chatHead.Orientation = 'Horizontal'
$chatTitle = New-Object System.Windows.Controls.TextBlock
$chatTitle.Text = '和她说说话'
$chatTitle.FontSize = 13
$chatTitle.Foreground = Brush '#655343'
$chatTitle.VerticalAlignment = 'Center'
$chatHead.Children.Add($chatTitle) | Out-Null
$script:chatTitle = $chatTitle
$closeBtn = New-Object System.Windows.Controls.Button
$closeBtn.Content = '✕'
$closeBtn.Width = 22; $closeBtn.Height = 22
$closeBtn.Margin = [System.Windows.Thickness]::new(142, 0, 0, 0)
$closeBtn.Background = [System.Windows.Media.Brushes]::Transparent
$closeBtn.Foreground = Brush '#A08B74'
$closeBtn.BorderThickness = [System.Windows.Thickness]::new(0)
$closeBtn.Cursor = [System.Windows.Input.Cursors]::Hand
$closeBtn.Add_Click({ Toggle-Chat })
$chatHead.Children.Add($closeBtn) | Out-Null
$chatInner.Children.Add($chatHead) | Out-Null

$script:chatScroll = New-Object System.Windows.Controls.ScrollViewer
$script:chatScroll.Height = 200
$script:chatScroll.VerticalScrollBarVisibility = 'Auto'
$script:chatScroll.HorizontalScrollBarVisibility = 'Disabled'
$script:chatScroll.Margin = [System.Windows.Thickness]::new(0, 6, 0, 6)
$script:chatStack = New-Object System.Windows.Controls.StackPanel
$script:chatScroll.Content = $script:chatStack
$chatInner.Children.Add($script:chatScroll) | Out-Null

$inputRow = New-Object System.Windows.Controls.StackPanel
$inputRow.Orientation = 'Horizontal'
$script:chatBox = New-Object System.Windows.Controls.TextBox
$script:chatBox.Width = 188; $script:chatBox.Height = 38
$script:chatBox.FontSize = 13; $script:chatBox.TextWrapping = 'Wrap'
$script:chatBox.Background = Brush '#FFFDF9'
$script:chatBox.Foreground = Brush '#4A4540'
$script:chatBox.BorderBrush = Brush '#E7DCCB'
$script:chatBox.BorderThickness = [System.Windows.Thickness]::new(1)
$script:chatBox.Padding = [System.Windows.Thickness]::new(8, 6, 8, 6)
$script:chatBox.CaretBrush = Brush '#6E87A6'
$chatSend = New-Object System.Windows.Controls.Button
$chatSend.Content = '发送'; $chatSend.Width = 48; $chatSend.Height = 38
$chatSend.Background = Brush '#7FA6CF'; $chatSend.Foreground = [System.Windows.Media.Brushes]::White
$chatSend.BorderThickness = [System.Windows.Thickness]::new(0); $chatSend.Cursor = [System.Windows.Input.Cursors]::Hand
$chatSend.Margin = [System.Windows.Thickness]::new(6, 0, 0, 0)
$chatSend.Add_Click({ Send-Chat })
$script:chatBox.Add_KeyDown({ param($s, $e) if ($e.Key -eq 'Enter') { Send-Chat } })
$inputRow.Children.Add($script:chatBox) | Out-Null
$inputRow.Children.Add($chatSend) | Out-Null
$chatInner.Children.Add($inputRow) | Out-Null
$chatBorder.Child = $chatInner
$outer.Children.Add($chatBorder) | Out-Null
[System.Windows.Controls.Canvas]::SetLeft($chatBorder, 15)
[System.Windows.Controls.Canvas]::SetTop($chatBorder, 12)
[System.Windows.Controls.Panel]::SetZIndex($chatBorder, 30)

# 形象
$script:img = New-Object System.Windows.Controls.Image
$script:img.Stretch = 'Uniform'
$script:img.Cursor = [System.Windows.Input.Cursors]::Hand
$script:img.Margin = [System.Windows.Thickness]::new(0, 0, 0, 4)
$outer.Children.Add($script:img) | Out-Null
[System.Windows.Controls.Panel]::SetZIndex($script:img, 5)

# 状态气泡
$statusBorder = New-Object System.Windows.Controls.Border
$statusBorder.CornerRadius = [System.Windows.CornerRadius]::new(18)
$statusBorder.Background = Brush '#F6FFFCF7'
$statusBorder.BorderBrush = Brush '#E7D8C6'
$statusBorder.BorderThickness = [System.Windows.Thickness]::new(1)
$statusBorder.Padding = [System.Windows.Thickness]::new(10, 6, 10, 6)
$statusBorder.Effect = SoftShadow 14 0.14
$statusBorder.HorizontalAlignment = 'Center'
$script:statusText = New-Object System.Windows.Controls.TextBlock
$script:statusText.Foreground = Brush '#5A4B3D'
$script:statusText.FontSize = 12
$script:statusText.MaxWidth = 150
$script:statusText.TextWrapping = 'Wrap'
$script:statusText.TextAlignment = 'Center'
$script:statusText.HorizontalAlignment = 'Center'
$script:statusText.Text = '正在连接她…'
$statusBorder.Child = $script:statusText
$outer.Children.Add($statusBorder) | Out-Null
$statusBorder.Width = 170
[System.Windows.Controls.Canvas]::SetLeft($statusBorder, 8)
[System.Windows.Controls.Canvas]::SetTop($statusBorder, 10)
[System.Windows.Controls.Panel]::SetZIndex($statusBorder, 20)
$statusBorder.Visibility = 'Collapsed'

# 左侧四个属性框 + 连接线（悬浮显示）


$script:attrPanel = New-Object System.Windows.Controls.StackPanel
$script:attrPanel.Width = 116
$script:attrPanel.Visibility = 'Collapsed'
$outer.Children.Add($script:attrPanel) | Out-Null
[System.Windows.Controls.Canvas]::SetLeft($script:attrPanel, 8)
[System.Windows.Controls.Canvas]::SetTop($script:attrPanel, 92)
[System.Windows.Controls.Panel]::SetZIndex($script:attrPanel, 20)

function New-AttrBox([string]$text, [string]$accent) {
  $b = New-Object System.Windows.Controls.Border
  $b.Width = 112; $b.Height = 28
  $b.CornerRadius = [System.Windows.CornerRadius]::new(12)
  $b.Background = Brush '#F2FFFCF7'
  $b.BorderBrush = Brush '#E0D1BD'
  $b.BorderThickness = [System.Windows.Thickness]::new(1)
  $b.Margin = [System.Windows.Thickness]::new(0, 3, 0, 3)
  $b.Effect = SoftShadow 10 0.10
  $t = New-Object System.Windows.Controls.TextBlock
  $t.Text = $text; $t.FontSize = 11.5; $t.FontWeight = 'SemiBold'
  $t.Foreground = Brush $accent; $t.TextAlignment = 'Center'; $t.VerticalAlignment = 'Center'
  $b.Child = $t
  $script:attrPanel.Children.Add($b) | Out-Null
  return $t
}
$script:attrName = New-AttrBox '小鲸' '#5A4B3D'
$script:attrPlace = New-AttrBox '🏠 家' '#5E7895'
$script:attrAct = New-AttrBox '待着' '#8A6A4E'
$script:attrEnergy = New-AttrBox '精力很足' '#5C8A70'

# balance 行：贴着脚，做成一枚更明显的小胶囊
$script:tokenText = New-Object System.Windows.Controls.TextBlock
$script:tokenText.FontSize = 12
$script:tokenText.FontWeight = 'SemiBold'
$script:tokenText.Foreground = Brush '#6B5747'
$script:tokenText.Opacity = 1
$script:tokenText.HorizontalAlignment = 'Center'
$script:tokenText.TextAlignment = 'Center'
$script:tokenText.Text = '余 — · 今日 —'
$tokenPill = New-Object System.Windows.Controls.Border
$tokenPill.Width = 190
$tokenPill.CornerRadius = [System.Windows.CornerRadius]::new(13)
$tokenPill.Background = Brush '#F2FFFCF7'
$tokenPill.BorderBrush = Brush '#E7D8C6'
$tokenPill.BorderThickness = [System.Windows.Thickness]::new(1)
$tokenPill.Padding = [System.Windows.Thickness]::new(9, 4, 9, 4)
$tokenPill.Child = $script:tokenText
$tokenPill.HorizontalAlignment = 'Center'
$script:tokenPill = $tokenPill
$outer.Children.Add($tokenPill) | Out-Null
[System.Windows.Controls.Canvas]::SetLeft($tokenPill, 135)
[System.Windows.Controls.Canvas]::SetTop($tokenPill, 320)
[System.Windows.Controls.Panel]::SetZIndex($tokenPill, 10)

# 按钮
$btnPanel = New-Object System.Windows.Controls.StackPanel
$btnPanel.Orientation = 'Vertical'
$btnPanel.HorizontalAlignment = 'Center'
$script:btnPanel = $btnPanel
$btnPanel.Margin = [System.Windows.Thickness]::new(0, 0, 0, 0)
foreach ($b in @($script:pet.buttons)) { $btnPanel.Children.Add((Build-Button $b)) | Out-Null }
$outer.Children.Add($btnPanel) | Out-Null
[System.Windows.Controls.Canvas]::SetLeft($btnPanel, 350)
[System.Windows.Controls.Canvas]::SetTop($btnPanel, 108)
[System.Windows.Controls.Panel]::SetZIndex($btnPanel, 10)

# 位置
$x = 1200; $y = 760
try {
  if (Test-Path $UiFile) { $ui = Get-Content $UiFile -Raw | ConvertFrom-Json; $x = [double]$ui.x; $y = [double]$ui.y }
  else {
    $wa = [System.Windows.SystemParameters]::WorkArea
    $x = $wa.Right - 380; $y = $wa.Bottom - 400
  }
} catch {}
$win.Left = $x; $win.Top = $y

$win.Add_LocationChanged({ if ($script:suppressSave) { return }; try { @{ x = [math]::Round($script:win.Left); y = [math]::Round($script:win.Top) } | ConvertTo-Json -Compress | Set-Content $UiFile -Encoding UTF8 } catch {} })

# 拖动 + 点击手势

$script:img.Add_MouseEnter({ Fade-AttrPanel $true })
$script:img.Add_MouseLeave({ Fade-AttrPanel $false })
$script:img.Add_MouseLeftButtonDown({ param($s, $e) $script:downPoint = $e.GetPosition($script:win); $script:isDragging = $false; Fade-AttrPanel $true })
$script:img.Add_MouseMove({
  param($s, $e)
  if ($e.LeftButton -eq 'Pressed' -and $script:downPoint) {
    $p = $e.GetPosition($script:win)
    if (([math]::Abs($p.X - $script:downPoint.X) + [math]::Abs($p.Y - $script:downPoint.Y)) -gt 18) {
      $script:isDragging = $true
      try { $script:win.DragMove() } catch {}
    }
  }
})
$script:img.Add_MouseLeftButtonUp({
  param($s, $e)
  if ($script:isDragging) { $script:isDragging = $false; return }
  $p = $e.GetPosition($script:img)
  $nx = $p.X / [math]::Max(1, $script:img.ActualWidth)
  $ny = $p.Y / [math]::Max(1, $script:img.ActualHeight)
  $g = Gesture-At $nx $ny
  if ($g) {
    if ($g.bubble) { Show-Bubble ([string]$g.bubble) 3500 }
    Log ('gesture ' + [string]$g.id)
    $expr = switch ([string]$g.id) { 'pat' { 'pat' } 'rub' { 'rub' } 'poke' { 'rub' } default { 'idle' } }
    Set-PetExpression $expr 600
    Send-Act 'gesture' ([string]$g.id) ([string]$g.prompt)
  }
})

# 右键菜单
$cm = New-Object System.Windows.Controls.ContextMenu
foreach ($item in @(
  @{ h = '和她说话'; a = { Toggle-Chat } },
  @{ h = '看看我的屏幕'; a = { Send-Act 'look' $null $null } },
  @{ h = '刷新状态'; a = { Refresh-Status } },
  @{ h = '重新加载桌宠'; a = { Load-Manifest; Update-Image; Refresh-Status } },
  @{ h = '退出桌宠'; a = { $script:win.Close() } }
)) {
  $mi = New-Object System.Windows.Controls.MenuItem
  $mi.Header = $item.h
  $mi.Add_Click($item.a)
  $cm.Items.Add($mi) | Out-Null
}
$outer.ContextMenu = $cm
$script:img.ContextMenu = $cm
$statusBorder.ContextMenu = $cm
$script:tokenText.ContextMenu = $cm

$script:chatTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:chatTimer.Interval = [TimeSpan]::FromSeconds(1)
$script:chatTimer.Add_Tick({
  if (-not $script:chatPanel -or $script:chatPanel.Visibility -ne 'Visible') { return }
  $ev = ApiGet ('/api/events?since=' + $script:lastMsgId)
  if ($ev -and $ev.messages) {
    foreach ($m in @($ev.messages)) {
      if ($m.id -le $script:lastMsgId) { continue }
      $script:lastMsgId = $m.id
      if ($m.role -eq 'her') { Append-Chat 'her' $m.text }
    }
  }
})
$script:mainTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:mainTimer.Interval = [TimeSpan]::FromSeconds(5)
$script:mainTimer.Add_Tick({ Refresh-Status })

$script:reactionUntil = [DateTime]::MinValue
$script:animPhase = 0.0
$script:animBase = @{ img = 12.0; btn = 108.0; token = 320.0; attr = 92.0 }
$script:uiAnimTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:uiAnimTimer.Interval = [TimeSpan]::FromMilliseconds(33)
$script:uiAnimTimer.Add_Tick({
  try {
    $script:animPhase += 0.11
    $off = [math]::Round([math]::Sin($script:animPhase) * 1.6, 1)
    $jump = 0.0
    $now = Get-Date
    if ($now -lt $script:reactionUntil) {
      $p = 1.0 - (($script:reactionUntil - $now).TotalMilliseconds / 600.0)
      if ($p -lt 0) { $p = 0 }; if ($p -gt 1) { $p = 1 }
      $jump = -[math]::Round([math]::Sin($p * [math]::PI) * 4.0, 1)
    }
    if ($script:img) { [System.Windows.Controls.Canvas]::SetTop($script:img, $script:animBase.img + $off + $jump) }
    if ($script:btnPanel) { [System.Windows.Controls.Canvas]::SetTop($script:btnPanel, $script:animBase.btn + $off + $jump) }
    if ($script:tokenPill) { [System.Windows.Controls.Canvas]::SetTop($script:tokenPill, $script:animBase.token + $off + $jump) }
    if ($script:attrPanel) { [System.Windows.Controls.Canvas]::SetTop($script:attrPanel, $script:animBase.attr + $off + $jump) }
  } catch {}
})
$script:charWatchTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:charWatchTimer.Interval = [TimeSpan]::FromMilliseconds(300)
$script:charWatchTimer.Add_Tick({
  try {
    $st = ApiGet '/api/pet/status'
    if ($st -and $st.character -and $st.character.id -and ([string]$st.character.id -ne $script:petCharId)) {
      $script:petCharId = [string]$st.character.id
      $script:bubbleUntil = [DateTime]::MinValue
      $script:lastBubbleId = 0
      try { if ($script:statusBorder) { $script:statusBorder.Visibility = 'Collapsed' } } catch {}
      Load-Manifest
      Update-Image 'idle'
      Refresh-Status
    }
  } catch {}
})
$win.Add_Loaded({
  Update-Image
  $script:uiAnimTimer.Start()
  $script:charWatchTimer.Start()
  Refresh-Status
  $script:mainTimer.Start()
  $script:clampTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:clampTimer.Interval = [TimeSpan]::FromMilliseconds(250)
  $script:clampTimer.Add_Tick({ $script:clampTimer.Stop(); Clamp-Window })
  $script:clampTimer.Start()
})
$win.Add_Closed({ try { $script:mainTimer.Stop() } catch {}; try { $script:chatTimer.Stop() } catch {}; try { $script:uiAnimTimer.Stop() } catch {}; try { $script:charWatchTimer.Stop() } catch {} })

Log 'pet starting'
$win.ShowDialog() | Out-Null
Log 'pet closed'
