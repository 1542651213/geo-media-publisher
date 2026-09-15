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
  | "CANCEL_INVOKE_PATTERN_UNAVAILABLE"
  | "CANCEL_IDENTITY_NOT_ESTABLISHED"
  | "CANCEL_ACTION_UNAVAILABLE"
  | "CANCEL_HELPER_COMPILE_FAILED"
  | "CANCEL_ACTION_FAILED"
  | "CANCEL_EFFECT_NOT_VERIFIED";

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
  cancelWindowId?: string | null;
  cancelName?: string | null;
  cancelClass?: string | null;
  cancelAutomationId?: string | null;
  cancelControlId?: number | null;
  cancelEnabled?: boolean | null;
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
  mechanism?: "UIA_INVOKE" | "WIN32_BM_CLICK";
  targetWindowId?: string | null;
  sendMessageTimeoutResult?: number | null;
  effectVerified?: boolean;
  closeStableSampleCount?: number;
  dialogWindowId?: string | null;
  cancelWindowId?: string | null;
  cancelName?: string | null;
  cancelClass?: string | null;
  cancelAutomationId?: string | null;
  cancelControlId?: number | null;
  cancelEnabled?: boolean | null;
  invokePatternAvailable?: boolean | null;
  failureStage?: string | null;
  underlyingFailureCode?: NativeFilePickerFailureCode | string | null;
  nativeFailureStage?: string | null;
  nativeFailureMessageSafe?: string | null;
}

export type NativeFilePickerCancelDiagnostics = Pick<NativeFilePickerCancelResult,
  | "dialogWindowId"
  | "cancelWindowId"
  | "cancelName"
  | "cancelClass"
  | "cancelAutomationId"
  | "cancelControlId"
  | "cancelEnabled"
  | "invokePatternAvailable"
  | "failureStage"
  | "underlyingFailureCode"
  | "nativeFailureStage"
  | "nativeFailureMessageSafe">;

export class NativeFilePickerCancelError extends Error {
  readonly failureCode: NativeFilePickerFailureCode;
  readonly diagnostics: NativeFilePickerCancelDiagnostics;

  constructor(failureCode: NativeFilePickerFailureCode, diagnostics: NativeFilePickerCancelDiagnostics = {}) {
    super(failureCode);
    this.name = "NativeFilePickerCancelError";
    this.failureCode = failureCode;
    this.diagnostics = diagnostics;
  }
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

function identityDiagnostics(identity: NativeFilePickerWindowIdentity): NativeFilePickerCancelDiagnostics {
  return {
    dialogWindowId: identity.windowId,
    cancelWindowId: identity.cancelWindowId ?? null,
    cancelName: identity.cancelName ?? null,
    cancelClass: identity.cancelClass ?? null,
    cancelAutomationId: identity.cancelAutomationId ?? null,
    cancelControlId: identity.cancelControlId ?? null,
    cancelEnabled: identity.cancelEnabled ?? null
  };
}

function nativeFailureText(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { stderr?: unknown };
    return [details.message, typeof details.stderr === "string" ? details.stderr : ""].filter(Boolean).join(" ");
  }
  return "";
}

function classifyNativeCancelFailure(error: unknown): NativeFilePickerCancelDiagnostics {
  const text = nativeFailureText(error).toLowerCase();
  if (text.includes("enumchildwindows") || text.includes("add-type") || text.includes("compilation")) {
    return {
      failureStage: "CANCEL_HELPER",
      underlyingFailureCode: "CANCEL_HELPER_COMPILE_FAILED",
      nativeFailureStage: "CANCEL_HELPER_ADD_TYPE",
      nativeFailureMessageSafe: "CANCEL_HELPER_COMPILE_FAILED"
    };
  }
  if (text.includes("identity_mismatch") || text.includes("identity_unavailable") || text.includes("identity_not_established")) {
    return {
      failureStage: "CANCEL_IDENTITY",
      underlyingFailureCode: "CANCEL_IDENTITY_NOT_ESTABLISHED",
      nativeFailureStage: "CANCEL_IDENTITY",
      nativeFailureMessageSafe: "CANCEL_IDENTITY_NOT_ESTABLISHED"
    };
  }
  if (text.includes("cancel_unavailable")) {
    return {
      failureStage: "CANCEL_IDENTITY",
      underlyingFailureCode: "CANCEL_ACTION_UNAVAILABLE",
      nativeFailureStage: "CANCEL_IDENTITY",
      nativeFailureMessageSafe: "CANCEL_ACTION_UNAVAILABLE"
    };
  }
  return {
    failureStage: "CANCEL_ACTION",
    underlyingFailureCode: "CANCEL_ACTION_FAILED",
    nativeFailureStage: "CANCEL_ACTION",
    nativeFailureMessageSafe: "CANCEL_ACTION_FAILED"
  };
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
    "  private delegate bool EnumChildWindowsProc(IntPtr hWnd, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] private static extern bool EnumChildWindows(IntPtr parent, EnumChildWindowsProc callback, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] public static extern int GetDlgCtrlID(IntPtr hWnd);",
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
    "    $cancelCurrent = if ($cancelControls.Count -eq 1) { $cancelControls[0].Current } else { $null }",
    "    $cancelType = if ($null -ne $cancelCurrent) { [string]$cancelCurrent.ControlType.ProgrammaticName } else { $null }",
    "    $cancelHwnd = if ($null -ne $cancelCurrent -and [int64]$cancelCurrent.NativeWindowHandle -gt 0) { [int]$cancelCurrent.NativeWindowHandle } else { 0 }",
    "    $cancelWindowId = if ($cancelHwnd -gt 0) { 'hwnd:' + $cancelHwnd } else { $null }",
    "    $candidates += [pscustomobject]@{ windowId = ('hwnd:' + $row.Hwnd); processId = [int]$row.ProcessId; ownerWindowId = if ($row.OwnerHwnd -eq 0) { $null } else { 'hwnd:' + $row.OwnerHwnd }; ownerProcessId = if ($row.OwnerProcessId -eq 0) { $null } else { [int]$row.OwnerProcessId }; parentWindowId = if ($row.ParentHwnd -eq 0) { $null } else { 'hwnd:' + $row.ParentHwnd }; title = [string]$row.Title; className = [string]$row.ClassName; dialogVisible = [bool]$row.Visible; dialogEnabled = [bool]$row.Enabled; cancelButtonCount = $cancelControls.Count; cancelControlUnique = ($cancelControls.Count -eq 1); openButtonCount = $openControls.Count; openControlVerified = ($openControls.Count -eq 1); cancelControlType = $cancelType; cancelWindowId = $cancelWindowId; cancelName = if ($null -ne $cancelCurrent) { [string]$cancelCurrent.Name } else { $null }; cancelClass = if ($null -ne $cancelCurrent) { [string]$cancelCurrent.ClassName } else { $null }; cancelAutomationId = if ($null -ne $cancelCurrent) { [string]$cancelCurrent.AutomationId } else { $null }; cancelControlId = if ($cancelHwnd -gt 0) { [GmpNativePickerWindow]::GetDlgCtrlID([IntPtr]$cancelHwnd) } else { $null }; cancelEnabled = if ($null -ne $cancelCurrent) { [bool]$cancelCurrent.IsEnabled } else { $null } }",
    "  } catch { }",
    "}",
    "if ($candidates.Count -gt 1) { [pscustomobject]@{ open = $false; verified = $false; identity = $null; failureCode = 'NATIVE_FILE_PICKER_AMBIGUOUS' } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "if ($candidates.Count -eq 0) { [pscustomobject]@{ open = $false; verified = $true; identity = $null; failureCode = $null } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "$candidate = $candidates[0]",
    "if ($candidate.cancelButtonCount -ne 1) { [pscustomobject]@{ open = $true; verified = $false; identity = $candidate; failureCode = 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' } | ConvertTo-Json -Compress -Depth 8; exit 0 }",
    "[pscustomobject]@{ open = $true; verified = $true; identity = $candidate; failureCode = $null } | ConvertTo-Json -Compress -Depth 8"
  ].join("\n");
}

/**
 * Revalidates the native dialog immediately before cancellation. UIA Invoke is
 * preferred; the Win32 BM_CLICK path is used only for a uniquely verified
 * Cancel child when InvokePattern is unavailable. Every action reports a
 * bounded, stable close verification so callers can fail closed.
 */
export function windowsPickerCancelScript(profilePath: string, identity: NativeFilePickerWindowIdentity): string {
  const profile = powershellLiteral(profilePath);
  const windowId = Number(identity.windowId.replace(/^hwnd:/u, ""));
  const ownerWindowId = identity.ownerWindowId ? Number(identity.ownerWindowId.replace(/^hwnd:/u, "")) : 0;
  const cancelWindowId = identity.cancelWindowId ? Number(identity.cancelWindowId.replace(/^hwnd:/u, "")) : 0;
  const expectedProcessId = Number.isFinite(identity.processId) ? identity.processId : 0;
  const expectedOwnerProcessId = identity.ownerProcessId && Number.isFinite(identity.ownerProcessId) ? identity.ownerProcessId : 0;
  const expectedParentWindowId = identity.parentWindowId ? Number(identity.parentWindowId.replace(/^hwnd:/u, "")) : 0;
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
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindowEnabled(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsChild(IntPtr parent, IntPtr child);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetParent(IntPtr hWnd);",
    "  private delegate bool EnumChildWindowsProc(IntPtr hWnd, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] private static extern bool EnumChildWindows(IntPtr parent, EnumChildWindowsProc callback, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] public static extern int GetDlgCtrlID(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder className, int maxCount);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder title, int maxCount);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);",
    "  public static int OwnerProcessId(int hwnd) { var owner = GetWindow((IntPtr)hwnd, 4); if (owner == IntPtr.Zero) return 0; uint pid; GetWindowThreadProcessId(owner, out pid); return (int)pid; }",
    "  public static int ProcessId(int hwnd) { uint pid; GetWindowThreadProcessId((IntPtr)hwnd, out pid); return (int)pid; }",
    "  public static string Title(int hwnd) { var value = new System.Text.StringBuilder(512); GetWindowText((IntPtr)hwnd, value, value.Capacity); return value.ToString(); }",
    "  public static string ClassName(int hwnd) { var value = new System.Text.StringBuilder(256); GetClassName((IntPtr)hwnd, value, value.Capacity); return value.ToString(); }",
    "  public static string Text(int hwnd) { return Title(hwnd); }",
    "  public static bool IsSameDialog(int hwnd, int expectedPid, int expectedOwnerPid, int expectedOwnerHwnd, int expectedParentHwnd) { if (!IsWindow((IntPtr)hwnd) || !IsWindowVisible((IntPtr)hwnd)) return false; if (ClassName(hwnd) != \"#32770\") return false; var title = Title(hwnd); if (!(title.Contains(\"打开\") || title.Contains(\"Open\"))) return false; if (expectedPid != 0 && ProcessId(hwnd) != expectedPid) return false; if (expectedOwnerPid != 0 && OwnerProcessId(hwnd) != expectedOwnerPid) return false; var owner = (int)GetWindow((IntPtr)hwnd, 4).ToInt64(); var parent = (int)GetParent((IntPtr)hwnd).ToInt64(); if (expectedOwnerHwnd != 0 && owner != expectedOwnerHwnd) return false; if (expectedParentHwnd != 0 && parent != expectedParentHwnd) return false; return true; }",
    "  public static bool IsValidCancelChild(int dialogHwnd, int cancelHwnd, int expectedCancelControlId) { if (cancelHwnd == 0 || !IsWindow((IntPtr)cancelHwnd) || !IsWindowVisible((IntPtr)cancelHwnd) || !IsWindowEnabled((IntPtr)cancelHwnd)) return false; if (!IsChild((IntPtr)dialogHwnd, (IntPtr)cancelHwnd)) return false; if (ClassName(cancelHwnd) != \"Button\") return false; if (GetDlgCtrlID((IntPtr)cancelHwnd) != expectedCancelControlId) return false; var text = Text(cancelHwnd); return text == \"取消\" || text == \"Cancel\"; }",
    "  public static int CountValidCancelChildren(int dialogHwnd, int expectedCancelControlId) { var count = 0; EnumChildWindows((IntPtr)dialogHwnd, (child, _) => { var childHwnd = (int)child.ToInt64(); if (IsValidCancelChild(dialogHwnd, childHwnd, expectedCancelControlId)) count++; return true; }, IntPtr.Zero); return count; }",
    "  public static bool IsValidOpenChild(int dialogHwnd, int childHwnd) { if (childHwnd == 0 || !IsWindow((IntPtr)childHwnd) || !IsWindowVisible((IntPtr)childHwnd)) return false; if (!IsChild((IntPtr)dialogHwnd, (IntPtr)childHwnd)) return false; if (ClassName(childHwnd) != \"Button\" || GetDlgCtrlID((IntPtr)childHwnd) != 1) return false; var text = Text(childHwnd); return text == \"打开\" || text == \"打开(O)\" || text == \"打开(&O)\" || text == \"Open\"; }",
    "  public static bool SendBmClick(int hwnd, uint timeout, uint flags, out long messageResult) { IntPtr result; var completed = SendMessageTimeout((IntPtr)hwnd, 0x00F5, IntPtr.Zero, IntPtr.Zero, flags, timeout, out result); messageResult = result.ToInt64(); return completed != IntPtr.Zero; }",
    "}",
    "'@ }",
    `$profilePath = ${profile}`,
    `$expectedHwnd = ${windowId}`,
    `$expectedOwnerHwnd = ${ownerWindowId}`,
    `$expectedProcessId = ${expectedProcessId}`,
    `$expectedOwnerProcessId = ${expectedOwnerProcessId}`,
    `$expectedParentHwnd = ${expectedParentWindowId}`,
    `$expectedCancelHwnd = ${cancelWindowId}`,
    `$expectedCancelControlId = 2`,
    "$SMTO_ABORTIFHUNG = 0x0002",
    "$invokeUnavailableFailureCode = 'CANCEL_INVOKE_PATTERN_UNAVAILABLE'",
    "$allProcesses = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)",
    "$browserRoots = @($allProcesses | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 })",
    "$browserPids = @{}",
    "foreach ($rootProcess in $browserRoots) { $browserPids[[int]$rootProcess.ProcessId] = $true }",
    "$changed = $true",
    "while ($changed) { $changed = $false; foreach ($childProcess in $allProcesses) { $childPid = [int]$childProcess.ProcessId; $parentPid = [int]$childProcess.ParentProcessId; if ($browserPids.ContainsKey($parentPid) -and -not $browserPids.ContainsKey($childPid)) { $browserPids[$childPid] = $true; $changed = $true } } }",
    "if ($browserPids.Count -eq 0 -or -not [GmpNativePickerWindow]::IsSameDialog($expectedHwnd, $expectedProcessId, $expectedOwnerProcessId, $expectedOwnerHwnd, $expectedParentHwnd)) { throw 'NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED' }",
    "$dialogPid = [GmpNativePickerWindow]::ProcessId($expectedHwnd)",
    "$ownerPid = [GmpNativePickerWindow]::OwnerProcessId($expectedHwnd)",
    "if (-not $browserPids.ContainsKey($dialogPid) -and -not $browserPids.ContainsKey($ownerPid)) { throw 'NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED' }",
    "$actualOwnerHwnd = [int][GmpNativePickerWindow]::GetWindow([IntPtr]$expectedHwnd, 4).ToInt64()",
    "if ($expectedOwnerHwnd -ne 0 -and $actualOwnerHwnd -ne $expectedOwnerHwnd) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "$actualParentHwnd = [int][GmpNativePickerWindow]::GetParent([IntPtr]$expectedHwnd).ToInt64()",
    "if ($expectedParentHwnd -ne 0 -and $actualParentHwnd -ne $expectedParentHwnd) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "if ($expectedCancelHwnd -eq 0) { throw 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' }",
    "$dialog = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$expectedHwnd)",
    "if ($null -eq $dialog) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "$controls = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))",
    "$cancelControls = @($controls | Where-Object { $current = $_.Current; (@('取消','Cancel') -contains [string]$current.Name) -and [string]$current.ClassName -eq 'Button' -and [string]$current.AutomationId -eq '2' -and [bool]$current.IsEnabled })",
    "$cancelControlCount = $cancelControls.Count",
    "if ($cancelControlCount -ne 1) { throw 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' }",
    "$uiaCancelHwnd = [int]$cancelControls[0].Current.NativeWindowHandle",
    "$cancelName = [string]$cancelControls[0].Current.Name",
    "$cancelClass = [string]$cancelControls[0].Current.ClassName",
    "$cancelAutomationId = [string]$cancelControls[0].Current.AutomationId",
    "$cancelControlId = [GmpNativePickerWindow]::GetDlgCtrlID([IntPtr]$expectedCancelHwnd)",
    "$cancelEnabled = [bool]$cancelControls[0].Current.IsEnabled",
    "if ($uiaCancelHwnd -ne $expectedCancelHwnd -or -not [GmpNativePickerWindow]::IsValidCancelChild($expectedHwnd, $expectedCancelHwnd, $expectedCancelControlId)) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "$win32CancelControlCount = [GmpNativePickerWindow]::CountValidCancelChildren($expectedHwnd, $expectedCancelControlId)",
    "if ($win32CancelControlCount -ne 1) { throw 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' }",
    "$openControls = @($controls | Where-Object { $current = $_.Current; (@('打开','打开(O)','Open') -contains [string]$current.Name) -and [string]$current.ClassName -eq 'Button' -and [string]$current.AutomationId -eq '1' })",
    "if ($openControls.Count -ne 1) { throw 'NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE' }",
    "$openHwnd = [int]$openControls[0].Current.NativeWindowHandle",
    "if (-not [GmpNativePickerWindow]::IsValidOpenChild($expectedHwnd, $openHwnd)) { throw 'NATIVE_FILE_PICKER_IDENTITY_MISMATCH' }",
    "$mechanism = $null; $actionSent = $false; $messageResult = $null",
    "$invokePatternAvailable = $false; try { $invoke = $cancelControls[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $invokePatternAvailable = $null -ne $invoke } catch { $invoke = $null; $invokePatternAvailable = $false }",
    "if ($null -ne $invoke) { try { $invoke.Invoke(); $mechanism = 'UIA_INVOKE'; $actionSent = $true } catch { [pscustomobject]@{ actionSent = $false; failureCode = 'NATIVE_FILE_PICKER_CANCEL_FAILED'; mechanism = 'UIA_INVOKE'; dialogWindowId = ('hwnd:' + $expectedHwnd); cancelWindowId = ('hwnd:' + $expectedCancelHwnd); cancelName = $cancelName; cancelClass = $cancelClass; cancelAutomationId = $cancelAutomationId; cancelControlId = $cancelControlId; cancelEnabled = $cancelEnabled; invokePatternAvailable = $invokePatternAvailable; failureStage = 'CANCEL_ACTION'; underlyingFailureCode = 'CANCEL_ACTION_FAILED'; nativeFailureStage = 'UIA_INVOKE'; nativeFailureMessageSafe = 'CANCEL_ACTION_FAILED' } | ConvertTo-Json -Compress; exit 0 } }",
    "if (-not $actionSent) { $completed = [GmpNativePickerWindow]::SendBmClick($expectedCancelHwnd, 750, $SMTO_ABORTIFHUNG, [ref]$messageResult); if (-not $completed) { [pscustomobject]@{ actionSent = $false; failureCode = 'NATIVE_FILE_PICKER_CANCEL_FAILED'; mechanism = 'WIN32_BM_CLICK'; targetWindowId = ('hwnd:' + $expectedCancelHwnd); sendMessageTimeoutResult = $messageResult; dialogWindowId = ('hwnd:' + $expectedHwnd); cancelWindowId = ('hwnd:' + $expectedCancelHwnd); cancelName = $cancelName; cancelClass = $cancelClass; cancelAutomationId = $cancelAutomationId; cancelControlId = $cancelControlId; cancelEnabled = $cancelEnabled; invokePatternAvailable = $invokePatternAvailable; failureStage = 'CANCEL_ACTION'; underlyingFailureCode = 'CANCEL_ACTION_FAILED'; nativeFailureStage = 'WIN32_BM_CLICK'; nativeFailureMessageSafe = 'CANCEL_ACTION_FAILED' } | ConvertTo-Json -Compress; exit 0 }; $mechanism = 'WIN32_BM_CLICK'; $actionSent = $true }",
    "$stableSamples = 0",
    "for ($i = 0; $i -lt 5; $i++) { Start-Sleep -Milliseconds 100; if (-not [GmpNativePickerWindow]::IsSameDialog($expectedHwnd, $expectedProcessId, $expectedOwnerProcessId, $expectedOwnerHwnd, $expectedParentHwnd)) { $stableSamples++ } else { $stableSamples = 0 } }",
    "$afterOpen = [GmpNativePickerWindow]::IsSameDialog($expectedHwnd, $expectedProcessId, $expectedOwnerProcessId, $expectedOwnerHwnd, $expectedParentHwnd)",
    "$effectVerified = $stableSamples -eq 5 -and -not $afterOpen",
    "[pscustomobject]@{ actionSent = $actionSent; mechanism = $mechanism; cancelMechanism = $mechanism; targetWindowId = if ($mechanism -eq 'WIN32_BM_CLICK') { 'hwnd:' + $expectedCancelHwnd } else { $null }; sendMessageTimeoutResult = $messageResult; effectVerified = $effectVerified; closeStableSampleCount = $stableSamples; DIALOG_CLOSE_STABLE_SAMPLE_COUNT = $stableSamples; verifiedCancelChildCount = $win32CancelControlCount; pickerWindowIdAfter = if ($afterOpen) { 'hwnd:' + $expectedHwnd } else { $null }; pickerOpenAfter = $afterOpen; dialogWindowId = ('hwnd:' + $expectedHwnd); cancelWindowId = ('hwnd:' + $expectedCancelHwnd); cancelName = $cancelName; cancelClass = $cancelClass; cancelAutomationId = $cancelAutomationId; cancelControlId = $cancelControlId; cancelEnabled = $cancelEnabled; invokePatternAvailable = $invokePatternAvailable; failureStage = if ($effectVerified) { $null } else { 'POST_ACTION_VERIFY' }; underlyingFailureCode = if ($effectVerified) { $null } else { 'CANCEL_EFFECT_NOT_VERIFIED' }; nativeFailureStage = if ($effectVerified) { $null } else { 'DIALOG_CLOSE_CHECK' }; nativeFailureMessageSafe = if ($effectVerified) { $null } else { 'CANCEL_EFFECT_NOT_VERIFIED' }; failureCode = if ($effectVerified) { $null } else { 'NATIVE_FILE_PICKER_CANCEL_FAILED' } } | ConvertTo-Json -Compress -Depth 8"
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
      } catch (error) {
        throw new NativeFilePickerCancelError("NATIVE_FILE_PICKER_CANCEL_FAILED", {
          ...identityDiagnostics(identity),
          ...classifyNativeCancelFailure(error)
        });
      }
    }
  };
}
