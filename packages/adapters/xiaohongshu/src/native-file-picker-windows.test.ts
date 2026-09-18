import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { classifyNativeCancelFailure, NativePowerShellExecError, NATIVE_FILE_PICKER_HELPER_TIMEOUT_MS, windowsPickerCancelScript, windowsPickerScanScript } from "./native-file-picker-windows";

const profilePath = "C:\\public-export-fixtures\\userData\\browser-profiles\\xiaohongshu\\11111111-1111-4111-8111-111111111111";

describe("R62 Windows native picker bridge", () => {
  it("uses a bounded helper timeout that covers verified Win32 cancellation", () => {
    expect(NATIVE_FILE_PICKER_HELPER_TIMEOUT_MS).toBe(5_000);
  });

  it("classifies a timed out helper without mistaking Add-Type in the command for a compile error", () => {
    const diagnostics = classifyNativeCancelFailure(new NativePowerShellExecError("Command timed out", {
      configuredTimeoutMs: 2_000,
      nativeProcessElapsedMs: 2_001,
      nativeProcessExitCode: null,
      nativeProcessSignal: "SIGTERM",
      nativeProcessKilled: true,
      nativeProcessTimedOut: true,
      nativeExecErrorName: "Error",
      nativeExecErrorCode: null,
      nativeExecErrorMessageSafe: "Command failed: powershell.exe <command omitted>",
      stdoutLength: 0,
      stderrLength: 0,
      stderrSafe: null,
      stdoutSafeTail: null
    }));

    expect(diagnostics.underlyingFailureCode).toBe("CANCEL_HELPER_TIMEOUT");
    expect(diagnostics.nativeFailureStage).toBe("CANCEL_HELPER_PROCESS");
  });

  it("classifies only a real CS compiler diagnostic as a helper compile failure", () => {
    const diagnostics = classifyNativeCancelFailure(new NativePowerShellExecError("Command failed", {
      configuredTimeoutMs: 2_000,
      nativeProcessElapsedMs: 300,
      nativeProcessExitCode: 1,
      nativeProcessSignal: null,
      nativeProcessKilled: false,
      nativeProcessTimedOut: false,
      nativeExecErrorName: "Error",
      nativeExecErrorCode: 1,
      nativeExecErrorMessageSafe: "Command failed: powershell.exe <command omitted>",
      stdoutLength: 0,
      stderrLength: 74,
      stderrSafe: "Add-Type : error CS1002: ; expected",
      stdoutSafeTail: null
    }));

    expect(diagnostics.underlyingFailureCode).toBe("CANCEL_HELPER_COMPILE_FAILED");
    expect(diagnostics.nativeFailureStage).toBe("CANCEL_HELPER_ADD_TYPE");
  });

  it("classifies a non-zero helper exit without compiler diagnostics separately", () => {
    const diagnostics = classifyNativeCancelFailure(new NativePowerShellExecError("Command failed", {
      configuredTimeoutMs: 2_000,
      nativeProcessElapsedMs: 300,
      nativeProcessExitCode: 1,
      nativeProcessSignal: null,
      nativeProcessKilled: false,
      nativeProcessTimedOut: false,
      nativeExecErrorName: "Error",
      nativeExecErrorCode: 1,
      nativeExecErrorMessageSafe: "Command failed: powershell.exe <command omitted>",
      stdoutLength: 0,
      stderrLength: 21,
      stderrSafe: "native helper failed",
      stdoutSafeTail: null
    }));

    expect(diagnostics.underlyingFailureCode).toBe("CANCEL_HELPER_PROCESS_EXIT_FAILED");
  });

  it("classifies invalid JSON separately", () => {
    const diagnostics = classifyNativeCancelFailure(new NativePowerShellExecError("NATIVE_FILE_PICKER_INVALID_JSON", {
      configuredTimeoutMs: 2_000,
      nativeProcessElapsedMs: 300,
      nativeProcessExitCode: 0,
      nativeProcessSignal: null,
      nativeProcessKilled: false,
      nativeProcessTimedOut: false,
      nativeExecErrorName: "SyntaxError",
      nativeExecErrorCode: null,
      nativeExecErrorMessageSafe: "Unexpected token",
      stdoutLength: 7,
      stderrLength: 0,
      stderrSafe: null,
      stdoutSafeTail: "not-json"
    }, "JSON_PARSE"));

    expect(diagnostics.underlyingFailureCode).toBe("CANCEL_HELPER_JSON_PARSE_FAILED");
  });

  it("keeps established Cancel identity fields with process failure evidence", () => {
    const diagnostics = classifyNativeCancelFailure(new NativePowerShellExecError("Command failed", {
      configuredTimeoutMs: 2_000,
      nativeProcessElapsedMs: 300,
      nativeProcessExitCode: 1,
      nativeProcessSignal: null,
      nativeProcessKilled: false,
      nativeProcessTimedOut: false,
      nativeExecErrorName: "Error",
      nativeExecErrorCode: 1,
      nativeExecErrorMessageSafe: "Command failed: powershell.exe <command omitted>",
      stdoutLength: 0,
      stderrLength: 21,
      stderrSafe: "native helper failed",
      stdoutSafeTail: null
    }));

    expect(diagnostics).toMatchObject({
      configuredTimeoutMs: 2_000,
      nativeProcessExitCode: 1,
      stderrSafe: "native helper failed"
    });
  });

  it("uses Win32 EnumWindows as the top-level picker authority", () => {
    const script = windowsPickerScanScript(profilePath);

    expect(script).toContain("EnumWindows");
    expect(script).toContain("IsWindowVisible");
    expect(script).toContain("GetParent");
    expect(script).toContain("ParentProcessId");
    expect(script).toContain("FromHandle");
    expect(script).not.toContain("RootElement");
    expect(script).not.toContain("TreeScope]::Children");
  });

  it("inspects the native dialog from its HWND and accepts Pane/Button controls by class", () => {
    const scanScript = windowsPickerScanScript(profilePath);
    const cancelScript = windowsPickerCancelScript(profilePath, {
      windowId: "hwnd:1379786",
      processId: 13848,
      ownerWindowId: "hwnd:2098414",
      ownerProcessId: 25296,
      title: "打开",
      className: "#32770",
      cancelButtonCount: 1
    });

    expect(scanScript).toContain("AutomationElement]::FromHandle");
    expect(scanScript).toContain("AutomationId");
    expect(scanScript).toContain("@('取消','Cancel')");
    expect(scanScript).not.toContain("Current.ControlType -eq [System.Windows.Automation.ControlType]::Button");
    expect(cancelScript).toContain("AutomationElement]::FromHandle");
    expect(cancelScript).toContain("CANCEL_INVOKE_PATTERN_UNAVAILABLE");
    expect(cancelScript).not.toContain("mouse");
    expect(cancelScript).not.toContain("SendKeys");
  });

  it("requires the real Cancel identity and cross-checks Open without clicking", () => {
    const script = windowsPickerScanScript(profilePath);

    expect(script).toContain("ClassName");
    expect(script).toContain("AutomationId");
    expect(script).toContain("Enabled");
    expect(script).toContain("@('打开','打开(O)','Open')");
    expect(script).toContain("@('取消','Cancel')");
    expect(script).toContain("openButtonCount");
    expect(script).toContain("openControlVerified");
    expect(script).toContain("cancelButtonCount");
    expect(script).toContain("cancelControlUnique");
    expect(script).toContain("cancelName");
    expect(script).toContain("cancelClass");
    expect(script).toContain("cancelAutomationId");
    expect(script).toContain("cancelControlId");
    expect(script).toContain("cancelEnabled");
  });

  it("adds a guarded Win32 BM_CLICK fallback when InvokePattern is unavailable", () => {
    const script = windowsPickerCancelScript(profilePath, {
      windowId: "hwnd:3935410",
      processId: 15276,
      ownerWindowId: "hwnd:8391932",
      ownerProcessId: 8000,
      title: "打开",
      className: "#32770",
      cancelButtonCount: 1,
      cancelControlUnique: true,
      cancelControlType: "ControlType.Pane"
    });

    expect(script).toContain("SendMessageTimeout");
    expect(script).toContain("BM_CLICK");
    expect(script).toContain("SMTO_ABORTIFHUNG");
    expect(script).toContain("IsChild");
    expect(script).toContain("EnumChildWindows");
    expect(script).toContain("CountValidCancelChildren");
    expect(script).toContain("GetDlgCtrlID");
    expect(script).toContain("cancelMechanism");
    expect(script).toContain("DIALOG_CLOSE_STABLE_SAMPLE_COUNT");
    expect(script).toContain("effectVerified");
  });

  it("declares EnumChildWindows before the cancel helper calls it", () => {
    const script = windowsPickerCancelScript(profilePath, {
      windowId: "hwnd:8719212",
      processId: 19656,
      ownerWindowId: "hwnd:6425900",
      ownerProcessId: 29520,
      parentWindowId: "hwnd:6425900",
      title: "打开",
      className: "#32770",
      cancelButtonCount: 1,
      cancelWindowId: "hwnd:2690702"
    });

    const declaration = "private delegate bool EnumChildWindowsProc(IntPtr hWnd, IntPtr lParam);";
    const importDeclaration = "[DllImport(\"user32.dll\")] private static extern bool EnumChildWindows(IntPtr parent, EnumChildWindowsProc callback, IntPtr lParam);";
    expect(script).toContain(declaration);
    expect(script).toContain(importDeclaration);
    expect(script.indexOf(declaration)).toBeLessThan(script.indexOf("CountValidCancelChildren"));
  });

  it.skipIf(process.platform !== "win32")("compiles the cancel helper C# without executing an action", () => {
    const script = windowsPickerCancelScript(profilePath, {
      windowId: "hwnd:8719212",
      processId: 19656,
      ownerWindowId: "hwnd:6425900",
      ownerProcessId: 29520,
      parentWindowId: "hwnd:6425900",
      title: "打开",
      className: "#32770",
      cancelButtonCount: 1,
      cancelWindowId: "hwnd:2690702"
    });
    const start = script.indexOf("Add-Type @'\n") + "Add-Type @'\n".length;
    const end = script.indexOf("\n'@ }", start);
    expect(start).toBeGreaterThan("Add-Type @'\n".length - 1);
    expect(end).toBeGreaterThan(start);
    const powershell = `$ErrorActionPreference = 'Stop'\nAdd-Type @'\n${script.slice(start, end)}\n'@\n'compiled'`;
    expect(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershell], { encoding: "utf8" }).trim()).toBe("compiled");
  });

  it("emits safe cancellation diagnostics for action and effect failures", () => {
    const script = windowsPickerCancelScript(profilePath, {
      windowId: "hwnd:8719212",
      processId: 19656,
      ownerWindowId: "hwnd:6425900",
      ownerProcessId: 29520,
      parentWindowId: "hwnd:6425900",
      title: "打开",
      className: "#32770",
      cancelButtonCount: 1,
      cancelWindowId: "hwnd:2690702"
    });

    for (const field of ["dialogWindowId", "cancelWindowId", "cancelName", "cancelClass", "cancelAutomationId", "cancelControlId", "cancelEnabled", "invokePatternAvailable", "failureStage", "underlyingFailureCode", "nativeFailureStage", "nativeFailureMessageSafe"]) {
      expect(script).toContain(field);
    }
  });

  it("revalidates strict Cancel child identity before the fallback and never targets Open", () => {
    const script = windowsPickerCancelScript(profilePath, {
      windowId: "hwnd:3935410",
      processId: 15276,
      ownerWindowId: "hwnd:8391932",
      ownerProcessId: 8000,
      title: "打开",
      className: "#32770",
      cancelButtonCount: 1
    });

    expect(script).toContain("cancelControlCount");
    expect(script).toContain("GetWindowText");
    expect(script).toContain("ClassName");
    expect(script).toContain("NATIVE_FILE_PICKER_CANCEL_FAILED");
    expect(script).toContain("expectedCancelControlId");
    expect(script).not.toContain("$expectedOpenControlId");
  });
});
