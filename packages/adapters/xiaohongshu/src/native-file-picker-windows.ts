import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type NativeFilePickerFailureCode =
  | "NATIVE_FILE_PICKER_CANCEL_FAILED"
  | "NATIVE_FILE_PICKER_STATE_UNVERIFIED"
  | "NATIVE_FILE_PICKER_AMBIGUOUS"
  | "NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED"
  | "NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE"
  | "NATIVE_FILE_PICKER_IDENTITY_MISMATCH"
  | "CANCEL_INVOKE_PATTERN_UNAVAILABLE";

export interface NativeFilePickerWindowIdentity {
  windowId: string;
  processId: number;
  ownerWindowId: string | null;
  ownerProcessId: number | null;
  parentWindowId?: string | null;
  title: string;
  className: string;
  cancelButtonCount: number;
  openButtonCount?: number;
  openControlVerified?: boolean;
  cancelControlUnique?: boolean;
  cancelControlType?: string | null;
  dialogVisible?: boolean;
  dialogEnabled?: boolean;
}

export interface NativeFilePickerInspection {
  open: boolean;
  verified: boolean;
  identity: NativeFilePickerWindowIdentity | null;
  failureCode: NativeFilePickerFailureCode | null;
}

export interface NativeFilePickerCancelResult {
  actionSent: boolean;
  failureCode?: NativeFilePickerFailureCode;
}

export interface NativeFilePickerSystemBridge {
  inspect(): Promise<NativeFilePickerInspection>;
  cancel(identity: NativeFilePickerWindowIdentity): Promise<NativeFilePickerCancelResult>;
}

export interface WindowsNativeFilePickerBridgeOptions {
  profilePath: string;
  browserChannel?: "chrome" | "msedge" | null;
  timeoutMs?: number;
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function emptyInspection(failureCode: NativeFilePickerFailureCode): NativeFilePickerInspection {
  return { open: false, verified: false, identity: null, failureCode };
}

async function runPowerShellJson<T>(command: string, timeoutMs: number): Promise<T> {
  if (process.platform !== "win32") throw new Error("NATIVE_FILE_PICKER_WINDOWS_ONLY");
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: timeoutMs, maxBuffer: 1_000_000 });
  const output = result.stdout.trim();
  if (!output) throw new Error("NATIVE_FILE_PICKER_EMPTY_RESPONSE");
  return JSON.parse(output) as T;
}

/** Win32 enumerates top-level windows; UIA is only used after a HWND is known. */
export function windowsPickerScanScript(profilePath: string): string {
  const profile = powershellLiteral(profilePath);
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "if (-not ('GmpNativePickerWindow' -as [type])) { Add-Type @'",
    "using System;",
    "using System.Collections.Generic;",
    "using System.Runtime.InteropServices;",
    "public static class GmpNativePickerWindow {",
    "  public sealed class WindowInfo { public int Hwnd; public string Title = \"\"; public string ClassName = \"\"; public int ProcessId; public int OwnerHwnd; public int OwnerProcessId; public int ParentHwnd; public bool Visible; public bool Enabled; }",
    "  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindowEnabled(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetParent(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder className, int maxCount);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder title, int maxCount);",
    "  public static WindowInfo[] EnumerateTopLevel() { var rows = new List<WindowInfo>(); EnumWindows((hWnd, _) => { if (!IsWindow(hWnd)) return true; uint pid; GetWindowThreadProcessId(hWnd, out pid); var owner = GetWindow(hWnd, 4); uint ownerPid; GetWindowThreadProcessId(owner, out ownerPid); var parent = GetParent(hWnd); var title = new System.Text.StringBuilder(512); var className = new System.Text.StringBuilder(256); GetWindowText(hWnd, title, title.Capacity); GetClassName(hWnd, className, className.Capacity); rows.Add(new WindowInfo { Hwnd = (int)hWnd.ToInt64(), Title = title.ToString(), ClassName = className.ToString(), ProcessId = (int)pid, OwnerHwnd = (int)owner.ToInt64(), OwnerProcessId = owner == IntPtr.Zero ? 0 : (int)ownerPid, ParentHwnd = (int)parent.ToInt64(), Visible = IsWindowVisible(hWnd), Enabled = IsWindowEnabled(hWnd) }); return true; }, IntPtr.Zero); return rows.ToArray(); }",
    "}",
    "'@ }",
    `$profilePath = ${profile}`,
    "$allProcesses = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)",
    "$browserRoots = @($allProcesses | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 })",
    "if ($browserRoots.Count -eq 0) { [pscustomobject]@{ open = $false; verified = $false; identity = $null; failureCode = 'NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED' } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "$browserPids = @{}",
    "foreach ($rootProcess in $browserRoots) { $browserPids[[int]$rootProcess.ProcessId] = $true }",
    "$changed = $true",
    "while ($changed) { $changed = $false; foreach ($childProcess in $allProcesses) { $childPid = [int]$childProcess.ProcessId; $parentPid = [int]$childProcess.ParentProcessId; if ($browserPids.ContainsKey($parentPid) -and -not $browserPids.ContainsKey($childPid)) { $browserPids[$childPid] = $true; $changed = $true } } }",
    "$windows = @([GmpNativePickerWindow]::EnumerateTopLevel())",
    "$candidates = @()",
    "foreach ($row in $windows) {",
    "  try {",
    "    if (-not $row.Visible -or $row.ClassName -ne '#32770' -or -not ($row.Title -like '*打开*' -or $row.Title -like '*Open*')) { continue }",
    "    if (-not $browserPids.ContainsKey([int]$row.ProcessId) -and -not $browserPids.ContainsKey([int]$row.OwnerProcessId)) { continue }",
    "    $dialog = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$row.Hwnd)",
    "    if ($null -eq $dialog) { continue }",
    "    $controls = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))",
    "    $cancelControls = @($controls | Where-Object { $current = $_.Current; (@('取消','Cancel') -contains [string]$current.Name) -and [string]$current.ClassName -eq 'Button' -and [string]$current.AutomationId -eq '2' -and [bool]$current.IsEnabled })",
    "    $openControls = @($controls | Where-Object { $current = $_.Current; (@('打开','打开(O)','Open') -contains [string]$current.Name) -and [string]$current.ClassName -eq 'Button' -and [string]$current.AutomationId -eq '1' })",
    "    $cancelType = if ($cancelControls.Count -eq 1) { [string]$cancelControls[0].Current.ControlType.ProgrammaticName } else { $null }",
    "    $candidates += [pscustomobject]@{ windowId = ('hwnd:' + $row.Hwnd); processId = [int]$row.ProcessId; ownerWindowId = if ($row.OwnerHwnd -eq 0) { $null } else { 'hwnd:' + $row.OwnerHwnd }; ownerProcessId = if ($row.OwnerProcessId -eq 0) { $null } else { [int]$row.OwnerProcessId }; parentWindowId = if ($row.ParentHwnd -eq 0) { $null } else { 'hwnd:' + $row.ParentHwnd }; title = [string]$row.Title; className = [string]$row.ClassName; dialogVisible = [bool]$row.Visible; dialogEnabled = [bool]$row.Enabled; cancelButtonCount = $cancelControls.Count; cancelControlUnique = ($cancelControls.Count -eq 1); openButtonCount = $openControls.Count; openControlVerified = ($openControls.Count -eq 1); cancelControlType = $cancelType }",
    "  } catch { }",
    "}",
    "if ($candidates.Count -gt 1) { [pscustomobject]@{ open = $false; verified = $false; identity = $null; failureCode = 'NATIVE_FILE_PICKER_AMBIGUOUS' } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "if ($candidates.Count -eq 0) { [pscustomobject]@{ open = $false; verified = $true; identity = $null; failureCode = $null } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "$candidate = $candidates[0]",
    "if ($candidate.cancelButtonCount -ne 1) { [pscustomobject]@{ open = $true; verified = $false; identity = $candidate; failureCode = 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "[pscustomobject]@{ open = $true; verified = $true; identity = $candidate; failureCode = $null } | ConvertTo-Json -Compress -Depth 8"
  ].join("\n");
}

/** InvokePattern is the only cancellation mechanism; HWND disappearance is verified by recovery. */
export function windowsPickerCancelScript(profilePath: string, identity: NativeFilePickerWindowIdentity): string {
  const profile = powershellLiteral(profilePath);
  const windowId = Number(identity.windowId.replace(/^hwnd:/u, ""));
  const ownerWindowId = identity.ownerWindowId ? Number(identity.ownerWindowId.replace(/^hwnd:/u, "")) : 0;
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "if (-not ('GmpNativePickerWindow' -as [type])) { Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class GmpNativePickerWindow {",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder className, int maxCount);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder title, int maxCount);",
    "  public static int OwnerProcessId(int hwnd) { var owner = GetWindow((IntPtr)hwnd, 4); if (owner == IntPtr.Zero) return 0; uint pid; GetWindowThreadProcessId(owner, out pid); return (int)pid; }",
    "  public static int ProcessId(int hwnd) { uint pid; GetWindowThreadProcessId((IntPtr)hwnd, out pid); return (int)pid; }",
    "  public static string Title(int hwnd) { var value = new System.Text.StringBuilder(512); GetWindowText((IntPtr)hwnd, value, value.Capacity); return value.ToString(); }",
    "  public static string ClassName(int hwnd) { var value = new System.Text.StringBuilder(256); GetClassName((IntPtr)hwnd, value, value.Capacity); return value.ToString(); }",
    "}",
    "'@ }",
    `$profilePath = ${profile}`,
    `$expectedHwnd = ${windowId}`,
    `$expectedOwnerHwnd = ${ownerWindowId}`,
    "$allProcesses = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)",
    "$browserRoots = @($allProcesses | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 })",
    "$browserPids = @{}",
    "foreach ($rootProcess in $browserRoots) { $browserPids[[int]$rootProcess.ProcessId] = $true }",
    "$changed = $true",
    "while ($changed) { $changed = $false; foreach ($childProcess in $allProcesses) { $childPid = [int]$childProcess.ProcessId; $parentPid = [int]$childProcess.ParentProcessId; if ($browserPids.ContainsKey($parentPid) -and -not $browserPids.ContainsKey($childPid)) { $browserPids[$childPid] = $true; $changed = $true } } }",
    "if ($browserPids.Count -eq 0 -or -not [GmpNativePickerWindow]::IsWindow([IntPtr]$expectedHwnd) -or -not [GmpNativePickerWindow]::IsWindowVisible([IntPtr]$expectedHwnd)) { throw 'NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED' }",
    "$dialogPid = [GmpNativePickerWindow]::ProcessId($expectedHwnd)",
    "$ownerPid = [GmpNativePickerWindow]::OwnerProcessId($expectedHwnd)",
    "if (-not $browserPids.ContainsKey($dialogPid) -and -not $browserPids.ContainsKey($ownerPid)) { throw 'NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED' }",
    "$actualOwnerHwnd = [int][GmpNativePickerWindow]::GetWindow([IntPtr]$expectedHwnd, 4).ToInt64()",
    "if ($expectedOwnerHwnd -ne 0 -and $actualOwnerHwnd -ne $expectedOwnerHwnd) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "$dialogTitle = [GmpNativePickerWindow]::Title($expectedHwnd)",
    "if ([GmpNativePickerWindow]::ClassName($expectedHwnd) -ne '#32770' -or -not ($dialogTitle -like '*打开*' -or $dialogTitle -like '*Open*')) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "$dialog = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$expectedHwnd)",
    "if ($null -eq $dialog) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "$controls = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))",
    "$cancelControls = @($controls | Where-Object { $current = $_.Current; (@('取消','Cancel') -contains [string]$current.Name) -and [string]$current.ClassName -eq 'Button' -and [string]$current.AutomationId -eq '2' -and [bool]$current.IsEnabled })",
    "if ($cancelControls.Count -ne 1) { throw 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' }",
    "try { $invoke = $cancelControls[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch { [pscustomobject]@{ actionSent = $false; failureCode = 'CANCEL_INVOKE_PATTERN_UNAVAILABLE' } | ConvertTo-Json -Compress; exit 0 }",
    "if ($null -eq $invoke) { [pscustomobject]@{ actionSent = $false; failureCode = 'CANCEL_INVOKE_PATTERN_UNAVAILABLE' } | ConvertTo-Json -Compress; exit 0 }",
    "try { $invoke.Invoke() } catch { [pscustomobject]@{ actionSent = $false; failureCode = 'NATIVE_FILE_PICKER_CANCEL_FAILED' } | ConvertTo-Json -Compress; exit 0 }",
    "[pscustomobject]@{ actionSent = $true } | ConvertTo-Json -Compress"
  ].join("\n");
}

export function createWindowsNativeFilePickerBridge(options: WindowsNativeFilePickerBridgeOptions): NativeFilePickerSystemBridge {
  const timeoutMs = Math.max(500, options.timeoutMs ?? 2_000);
  return {
    inspect: async () => {
      try {
        return await runPowerShellJson<NativeFilePickerInspection>(windowsPickerScanScript(options.profilePath), timeoutMs);
      } catch {
        return emptyInspection("NATIVE_FILE_PICKER_STATE_UNVERIFIED");
      }
    },
    cancel: async (identity) => {
      try {
        return await runPowerShellJson<NativeFilePickerCancelResult>(windowsPickerCancelScript(options.profilePath, identity), timeoutMs);
      } catch {
        throw new Error("NATIVE_FILE_PICKER_CANCEL_FAILED");
      }
    }
  };
}
