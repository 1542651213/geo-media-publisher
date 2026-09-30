param(
  [Parameter(Mandatory=$true)][string]$CandidatePath,
  [Parameter(Mandatory=$true)][string]$SmokeToken
)

Add-Type -AssemblyName UIAutomationClient
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
for ($attempt = 0; $attempt -lt 150; $attempt++) {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($focused -and $focused.Current.Name -eq '取消') {
    $processId = $focused.Current.ProcessId
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
    $parent = $walker.GetParent($focused)
    $next = $walker.GetNextSibling($focused)
    $exactProcess = $process -and $process.ExecutablePath -eq $CandidatePath -and
      $process.CommandLine.Contains("--b01-isolated-smoke=$SmokeToken")
    $exactDialog = $parent -and $parent.Current.Name -eq 'B01 单次产品验收授权' -and
      $next -and $next.Current.Name -eq '确认创建一次验收授权'
    if ($exactProcess -and $exactDialog) {
      $pattern = $next.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $pattern.Invoke()
      Write-Output 'ISOLATED_B01_MAIN_DIALOG_CONFIRMED=YES'
      exit 0
    }
  }
  Start-Sleep -Milliseconds 200
}
throw 'Exact isolated B01 authorization dialog not found'
