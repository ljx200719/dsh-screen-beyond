param([int]$Seconds = 180)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$desc = $auto::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$end = (Get-Date).AddSeconds($Seconds)
$clicked = 0
while ((Get-Date) -lt $end) {
  $all = $auto::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $all) {
    try {
      $cls = $w.Current.ClassName
      if ($cls -ne '#32770') { continue }
      $name = $w.Current.Name
      if ($name -match '线程数量|APC|V8|注入|Injector') {
        $btnCond = New-Object System.Windows.Automation.PropertyCondition($auto::NameProperty, '确定')
        $btn = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
        if ($btn -ne $null) {
          $p = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          if ($p -ne $null) { $p.Invoke(); $clicked++; Write-Output ("clicked " + $name + " at " + (Get-Date -Format 'HH:mm:ss')) }
        }
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 300
}
Write-Output ("done clicked=" + $clicked)
