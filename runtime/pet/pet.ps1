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

function Load-Manifest() {
  $m = ApiGet '/api/pet/manifest'
  if ($m -and $m.pet) { $script:pet = $m.pet } else {
    $script:pet = [pscustomobject]@{
      image = 'avatar'; size = 180; opacity = 1; statusText = $true; alwaysOnTop = $true
      gestures = @(
        [pscustomobject]@{ id='pat'; label='摸摸头'; hit=[pscustomobject]@{x=0.15;y=0.08;w=0.7;h=0.42}; prompt='（你摸了摸她的头）'; bubble='唔…' },
        [pscustomobject]@{ id='poke'; label='戳一下'; hit=[pscustomobject]@{x=0.3;y=0.5;w=0.4;h=0.32}; prompt='（你戳了戳她的脸）'; bubble='干嘛啦' }
      )
      buttons = @(
        [pscustomobject]@{ id='chat'; label=''; action='chat'; title='和她说话'; icon='chat-line' },
        [pscustomobject]@{ id='look'; label=''; action='look'; title='看看我的屏幕'; icon='eye-line' }
      )
    }
  }
}
function Resolve-ImagePath() {
  $spec = [string]$script:pet.image
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
function Update-Image() {
  $path = Resolve-ImagePath
  if (-not $path) { return }
  $bmp = Make-Bitmap $path
  if (-not $bmp) { return }
  $size = [double]$script:pet.size; if ($size -le 0 -or $size -gt 600) { $size = 180 }
  $ratio = $bmp.PixelWidth / [double]$bmp.PixelHeight; if ($ratio -le 0) { $ratio = 0.8 }
  $script:img.Source = $bmp
  $script:img.Height = $size
  $script:img.Width = [math]::Round($size * $ratio)
  try {
    $clip = New-Object System.Windows.Media.RectangleGeometry
    $clip.Rect = New-Object System.Windows.Rect(0, 0, $script:img.Width, $script:img.Height)
    $clip.RadiusX = 16; $clip.RadiusY = 16
    $script:img.Clip = $clip
  } catch {}
  $script:img.ToolTip = [string]$script:pet.label
}
function Show-Bubble([string]$text, [int]$ms = 6000) {
  if (-not $script:statusText) { return }
  $script:statusText.Text = $text
  $script:bubbleUntil = (Get-Date).AddMilliseconds($ms)
}
function Gesture-At([double]$nx, [double]$ny) {
  foreach ($g in @($script:pet.gestures)) {
    if (-not $g.hit) { continue }
    $h = $g.hit
    if ($nx -ge [double]$h.x -and $nx -le ([double]$h.x + [double]$h.w) -and $ny -ge [double]$h.y -and $ny -le ([double]$h.y + [double]$h.h)) { return $g }
  }
  return $null
}
function Send-Act($action, $gestureId, $prompt) {
  $body = @{ action = $action }
  if ($gestureId) { $body.gestureId = $gestureId }
  if ($prompt) { $body.prompt = $prompt }
  $r = ApiPost '/api/pet/act' $body
  if ($r -and $r.ok) {
    if ($action -eq 'look') { Show-Bubble '她正在看你的屏幕…' 12000 }
    elseif ($action -eq 'gesture') { }
    else { Show-Bubble '（她收到了）' 2500 }
  } elseif ($r -and $r.error) { Show-Bubble ('她：' + $r.error) 4000 }
  else { Show-Bubble '连不上她…' 4000 }
}
function Append-Chat($who, $text) {
  if (-not $script:chatStack -or -not $text) { return }
  $item = New-Object System.Windows.Controls.TextBlock
  $item.Text = ($(if ($who -eq 'her') { '她：' } else { '你：' }) + $text)
  $item.TextWrapping = 'Wrap'
  $item.Width = 232
  $item.Margin = [System.Windows.Thickness]::new(4, 4, 4, 4)
  $item.Foreground = Brush $(if ($who -eq 'her') { '#CFE6FF' } else { '#8FB9FF' })
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
  if ($st.character -and $st.character.avatar -and $st.character.avatar -ne $script:lastAvatarUrl) {
    $script:lastAvatarUrl = $st.character.avatar
    Update-Image
  }
  if ($st.tokens) {
    $t = $st.tokens
    $script:tokenText.Text = '余 ' + (Fmt-Tok $t.remainingTokens) + ' · 今日 ' + (Fmt-Tok $t.dailyUsed)
    $script:tokenText.ToolTip = ('剩余 token：{0:N0}{1}今日已用：{2:N0}{3}预算：{4:N0}' -f [double]$t.remainingTokens, [Environment]::NewLine, [double]$t.dailyUsed, [Environment]::NewLine, [double]$t.tokenBudget)
  }
  if ($script:bubbleUntil -gt (Get-Date)) { return }
  $loc = ''; if ($st.place) { $loc = [string]$st.place.icon + ' ' + [string]$st.place.name }
  $act = if ($st.activity) { [string]$st.activity } elseif ($st.state -eq 'traveling') { '在路上' } elseif ($st.state -eq 'intercity') { '出远门' } else { '待着' }
  $en = if ($st.energy) { [string]$st.energy } else { '' }
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
function Build-Button($b) {
  $border = New-Object System.Windows.Controls.Border
  $border.Width = 40; $border.Height = 30
  $border.CornerRadius = [System.Windows.CornerRadius]::new(15)
  $border.Background = Brush '#D91E3A5F'
  $border.BorderBrush = Brush '#55A8CFFF'
  $border.BorderThickness = [System.Windows.Thickness]::new(1)
  $border.Margin = [System.Windows.Thickness]::new(4, 2, 4, 2)
  $border.Cursor = [System.Windows.Input.Cursors]::Hand
  if ([string]$b.icon -eq 'chat-line') {
    $grid = New-Object System.Windows.Controls.Grid
    $bubble = New-Object System.Windows.Shapes.Path
    $bubble.Data = [System.Windows.Media.Geometry]::Parse('M4.5,6 C4.5,4.6 5.6,3.5 7,3.5 L17,3.5 C18.4,3.5 19.5,4.6 19.5,6 L19.5,13 C19.5,14.4 18.4,15.5 17,15.5 L10.2,15.5 L6.5,18.7 L6.5,15.5 C5.3,15.5 4.5,14.7 4.5,13.5 Z')
    $bubble.Stroke = Brush '#CFE6FF'
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
      $d.Fill = Brush '#CFE6FF'
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
    $eye.Stroke = Brush '#CFE6FF'
    $eye.StrokeThickness = 1.5
    $eye.StrokeStartLineCap = 'Round'; $eye.StrokeEndLineCap = 'Round'
    $eye.Stretch = 'Uniform'
    $eye.Width = 19; $eye.Height = 16
    $eye.HorizontalAlignment = 'Center'; $eye.VerticalAlignment = 'Center'
    $pupil = New-Object System.Windows.Shapes.Ellipse
    $pupil.Width = 4.8; $pupil.Height = 4.8
    $pupil.Fill = Brush '#CFE6FF'
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
  $border.Add_MouseEnter({ param($s,$e) $s.Background = Brush '#F22E5A86' })
  $border.Add_MouseLeave({ param($s,$e) $s.Background = Brush '#D91E3A5F' })
  $border.Add_MouseLeftButtonUp({
    param($s, $e)
    $script:isDragging = $false
    $tag = $s.Tag
    switch ([string]$tag.action) {
      'chat' { Toggle-Chat }
      'look' { Send-Act 'look' $null $null }
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
$win.WindowStyle = 'None'
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.Topmost = $true
$win.ShowInTaskbar = $false
$win.ResizeMode = 'NoResize'
$win.SizeToContent = 'WidthAndHeight'
$script:win = $win
if ($script:pet.alwaysOnTop -eq $false) { $win.Topmost = $false }
try { $op = [double]$script:pet.opacity; if ($op -gt 0 -and $op -le 1) { $win.Opacity = $op } } catch {}

$outer = New-Object System.Windows.Controls.StackPanel
$outer.HorizontalAlignment = 'Center'
$win.Content = $outer

# 聊天气泡面板（默认收起）
$chatBorder = New-Object System.Windows.Controls.Border
$chatBorder.Width = 260
$chatBorder.CornerRadius = [System.Windows.CornerRadius]::new(16)
$chatBorder.Background = Brush '#E60F1B2B'
$chatBorder.BorderBrush = Brush '#66A8CFFF'
$chatBorder.BorderThickness = [System.Windows.Thickness]::new(1)
$chatBorder.Padding = [System.Windows.Thickness]::new(10)
$chatBorder.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
$chatBorder.Visibility = 'Collapsed'
$script:chatPanel = $chatBorder
$chatInner = New-Object System.Windows.Controls.StackPanel

$chatHead = New-Object System.Windows.Controls.StackPanel
$chatHead.Orientation = 'Horizontal'
$chatTitle = New-Object System.Windows.Controls.TextBlock
$chatTitle.Text = '和她说说话'
$chatTitle.FontSize = 12
$chatTitle.Foreground = Brush '#BFE0FF'
$chatTitle.VerticalAlignment = 'Center'
$chatHead.Children.Add($chatTitle) | Out-Null
$closeBtn = New-Object System.Windows.Controls.Button
$closeBtn.Content = '✕'
$closeBtn.Width = 22; $closeBtn.Height = 22
$closeBtn.Margin = [System.Windows.Thickness]::new(142, 0, 0, 0)
$closeBtn.Background = [System.Windows.Media.Brushes]::Transparent
$closeBtn.Foreground = Brush '#8FB9FF'
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
$script:chatBox.Background = Brush '#16263A'
$script:chatBox.Foreground = Brush '#E8F2FF'
$script:chatBox.BorderThickness = [System.Windows.Thickness]::new(0)
$chatSend = New-Object System.Windows.Controls.Button
$chatSend.Content = '发送'; $chatSend.Width = 44; $chatSend.Height = 38
$chatSend.Margin = [System.Windows.Thickness]::new(6, 0, 0, 0)
$chatSend.Add_Click({ Send-Chat })
$script:chatBox.Add_KeyDown({ param($s, $e) if ($e.Key -eq 'Enter') { Send-Chat } })
$inputRow.Children.Add($script:chatBox) | Out-Null
$inputRow.Children.Add($chatSend) | Out-Null
$chatInner.Children.Add($inputRow) | Out-Null
$chatBorder.Child = $chatInner
$outer.Children.Add($chatBorder) | Out-Null

# 形象
$script:img = New-Object System.Windows.Controls.Image
$script:img.Stretch = 'Uniform'
$script:img.Cursor = [System.Windows.Input.Cursors]::Hand
$script:img.Margin = [System.Windows.Thickness]::new(0, 0, 0, 4)
$outer.Children.Add($script:img) | Out-Null

# 状态气泡
$statusBorder = New-Object System.Windows.Controls.Border
$statusBorder.CornerRadius = [System.Windows.CornerRadius]::new(12)
$statusBorder.Background = Brush '#D90B1526'
$statusBorder.BorderBrush = Brush '#33A8CFFF'
$statusBorder.BorderThickness = [System.Windows.Thickness]::new(1)
$statusBorder.Padding = [System.Windows.Thickness]::new(10, 5, 10, 5)
$statusBorder.HorizontalAlignment = 'Center'
$script:statusText = New-Object System.Windows.Controls.TextBlock
$script:statusText.Foreground = Brush '#CFE6FF'
$script:statusText.FontSize = 12
$script:statusText.MaxWidth = 280
$script:statusText.TextWrapping = 'Wrap'
$script:statusText.Text = '正在连接她…'
$statusBorder.Child = $script:statusText
$outer.Children.Add($statusBorder) | Out-Null
if ($script:pet.statusText -eq $false) { $statusBorder.Visibility = 'Collapsed' }

# token 行
$script:tokenText = New-Object System.Windows.Controls.TextBlock
$script:tokenText.FontSize = 11
$script:tokenText.Foreground = Brush '#8FB9FF'
$script:tokenText.Opacity = 0.9
$script:tokenText.HorizontalAlignment = 'Center'
$script:tokenText.Margin = [System.Windows.Thickness]::new(0, 4, 0, 2)
$script:tokenText.Text = '余 — · 今日 —'
$outer.Children.Add($script:tokenText) | Out-Null

# 按钮
$btnPanel = New-Object System.Windows.Controls.StackPanel
$btnPanel.Orientation = 'Horizontal'
$btnPanel.HorizontalAlignment = 'Center'
$btnPanel.Margin = [System.Windows.Thickness]::new(0, 3, 0, 0)
foreach ($b in @($script:pet.buttons)) { $btnPanel.Children.Add((Build-Button $b)) | Out-Null }
$outer.Children.Add($btnPanel) | Out-Null

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
$script:img.Add_MouseLeftButtonDown({ param($s, $e) $script:downPoint = $e.GetPosition($script:win); $script:isDragging = $false })
$script:img.Add_MouseMove({
  param($s, $e)
  if ($e.LeftButton -eq 'Pressed' -and $script:downPoint) {
    $p = $e.GetPosition($script:win)
    if (([math]::Abs($p.X - $script:downPoint.X) + [math]::Abs($p.Y - $script:downPoint.Y)) -gt 6) {
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
  if ($g) { if ($g.bubble) { Show-Bubble ([string]$g.bubble) 3500 }; Send-Act 'gesture' ([string]$g.id) ([string]$g.prompt) }
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

$win.Add_Loaded({
  Update-Image
  Refresh-Status
  $script:mainTimer.Start()
  $script:clampTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:clampTimer.Interval = [TimeSpan]::FromMilliseconds(250)
  $script:clampTimer.Add_Tick({ $script:clampTimer.Stop(); Clamp-Window })
  $script:clampTimer.Start()
})
$win.Add_Closed({ try { $script:mainTimer.Stop() } catch {}; try { $script:chatTimer.Stop() } catch {} })

Log 'pet starting'
$win.ShowDialog() | Out-Null
Log 'pet closed'
