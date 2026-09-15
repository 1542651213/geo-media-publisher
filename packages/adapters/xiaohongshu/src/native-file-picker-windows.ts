import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type NativeFilePickerFailureCode =
  | "NATIVE_FILE_PICKER_CANCEL_FAILED"
  | "NATIVE_FILE_PICKER_STATE_UNVERIFIED"
  | "NATIVE_FILE_PICKER_AMBIGUOUS"
  | "NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED"
  | "NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE";

export interface NativeFilePickerWindowIdentity {
  windowId: string;
  processId: number;
  ownerWindowId: string | null;
  ownerProcessId: number | null;
  title: string;
  className: string;
  cancelButtonCount: number;
}

export interface NativeFilePickerInspection {
  open: boolean;
  verified: boolean;
  identity: NativeFilePickerWindowIdentity | null;
  failureCode: NativeFilePickerFailureCode | null;
}

export interface NativeFilePickerSystemBridge {
  inspect(): Promise<NativeFilePickerInspection>;
  cancel(identity: NativeFilePickerWindowIdentity): Promise<{ actionSent: boolean }>;
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

function windowsPickerScanScript(profilePath: string): string {
  const profile = powershellLiteral(profilePath);
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "if (-not ('GmpNativeWindow' -as [type])) { Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class GmpNativeWindow {",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "  public static int OwnerWindowId(int hwnd) { return (int)GetWindow((IntPtr)hwnd, 4).ToInt64(); }",
    "  public static int OwnerProcessId(int hwnd) { var owner = GetWindow((IntPtr)hwnd, 4); if (owner == IntPtr.Zero) return 0; uint pid; GetWindowThreadProcessId(owner, out pid); return (int)pid; }",
    "}",
    "'@ }",
    `$profilePath = ${profile}`,
    "$browserProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 })",
    "if ($browserProcesses.Count -eq 0) { [pscustomobject]@{ open = $false; verified = $false; identity = $null; failureCode = 'NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED' } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "$browserPids = @($browserProcesses | ForEach-Object { [int]$_.ProcessId })",
    "$root = [System.Windows.Automation.AutomationElement]::RootElement",
    "$windows = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))",
    "$candidates = @()",
    "foreach ($window in $windows) {",
    "  try {",
    "    $current = $window.Current",
    "    $title = [string]$current.Name",
    "    $className = [string]$current.ClassName",
    "    $hwnd = [int]$current.NativeWindowHandle",
    "    if ($hwnd -eq 0 -or @('打开','Open') -notcontains $title -or $className -ne '#32770') { continue }",
    "    $windowProcessId = [int]$current.ProcessId",
    "    $ownerWindowId = [int][GmpNativeWindow]::OwnerWindowId($hwnd)",
    "    $ownerProcessId = [int][GmpNativeWindow]::OwnerProcessId($hwnd)",
    "    if ($browserPids -notcontains $ownerProcessId) { continue }",
    "    $buttons = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and @('取消','Cancel') -contains [string]$_.Current.Name })",
    "    $candidates += [pscustomobject]@{ windowId = ('hwnd:' + $hwnd); processId = $windowProcessId; ownerWindowId = if ($ownerWindowId -eq 0) { $null } else { 'hwnd:' + $ownerWindowId }; ownerProcessId = if ($ownerProcessId -eq 0) { $null } else { $ownerProcessId }; title = $title; className = $className; cancelButtonCount = $buttons.Count }",
    "  } catch { }",
    "}",
    "if ($candidates.Count -gt 1) { [pscustomobject]@{ open = $false; verified = $false; identity = $null; failureCode = 'NATIVE_FILE_PICKER_AMBIGUOUS' } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "if ($candidates.Count -eq 0) { [pscustomobject]@{ open = $false; verified = $true; identity = $null; failureCode = $null } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "$candidate = $candidates[0]",
    "if ($candidate.cancelButtonCount -ne 1) { [pscustomobject]@{ open = $true; verified = $false; identity = $candidate; failureCode = 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "[pscustomobject]@{ open = $true; verified = $true; identity = $candidate; failureCode = $null } | ConvertTo-Json -Compress -Depth 8"
  ].join("\n");
}

function windowsPickerCancelScript(profilePath: string, identity: NativeFilePickerWindowIdentity): string {
  const profile = powershellLiteral(profilePath);
  const windowId = Number(identity.windowId.replace(/^hwnd:/u, ""));
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "if (-not ('GmpNativeWindow' -as [type])) { Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class GmpNativeWindow {",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr hWnd);",
    "  public static int OwnerProcessId(int hwnd) { var owner = GetWindow((IntPtr)hwnd, 4); if (owner == IntPtr.Zero) return 0; uint pid; GetWindowThreadProcessId(owner, out pid); return (int)pid; }",
    "}",
    "'@ }",
    `$profilePath = ${profile}`,
    `$expectedHwnd = ${windowId}`,
    "$browserProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 })",
    "$browserPids = @($browserProcesses | ForEach-Object { [int]$_.ProcessId })",
    "if ($browserPids.Count -eq 0 -or -not [GmpNativeWindow]::IsWindow([IntPtr]$expectedHwnd)) { throw 'NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED' }",
    "$dialog = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$expectedHwnd)",
    "$current = $dialog.Current",
    "if (@('打开','Open') -notcontains [string]$current.Name -or [string]$current.ClassName -ne '#32770' -or $browserPids -notcontains ([int][GmpNativeWindow]::OwnerProcessId($expectedHwnd))) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "$buttons = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and @('取消','Cancel') -contains [string]$_.Current.Name })",
    "if ($buttons.Count -ne 1) { throw 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' }",
    "$invoke = $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)",
    "$invoke.Invoke()",
    "[pscustomobject]@{ actionSent = $true } | ConvertTo-Json -Compress"
  ].join("\n");
}

export function createWindowsNativeFilePickerBridge(options: WindowsNativeFilePickerBridgeOptions): NativeFilePickerSystemBridge {
  const timeoutMs = Math.max(500, options.timeoutMs ?? 2_000);
  return {
    inspect: async () => {
      try {
        const result = await runPowerShellJson<NativeFilePickerInspection>(windowsPickerScanScript(options.profilePath), timeoutMs);
        return result;
      } catch {
        return emptyInspection("NATIVE_FILE_PICKER_STATE_UNVERIFIED");
      }
    },
    cancel: async (identity) => {
      try {
        return await runPowerShellJson<{ actionSent: boolean }>(windowsPickerCancelScript(options.profilePath, identity), timeoutMs);
      } catch {
        throw new Error("NATIVE_FILE_PICKER_CANCEL_FAILED");
      }
    }
  };
}
