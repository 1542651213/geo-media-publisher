import { describe, expect, it, vi } from "vitest";
import { createXhsNativeFilePickerRecovery, recoverNativeFilePicker, type NativeFilePickerRecoveryProbe } from "./native-file-picker-recovery";
import { NativeFilePickerCancelError, type NativeFilePickerCancelResult, type NativeFilePickerWindowIdentity } from "./native-file-picker-windows";

function probe(input: { open: boolean; cancel?: () => Promise<void> }): NativeFilePickerRecoveryProbe {
  return {
    isOpen: async () => input.open,
    cancel: vi.fn(async () => {
      if (input.cancel) await input.cancel();
      input.open = false;
    })
  };
}

describe("XHS native file picker recovery", () => {
  it("fails closed when cancel is acknowledged but the same native dialog remains open", async () => {
    const inspect = vi.fn()
      .mockResolvedValueOnce({ open: true, verified: true, identity: { windowId: "hwnd:123", processId: 10, ownerWindowId: "hwnd:99", ownerProcessId: 10, title: "打开", className: "#32770", cancelButtonCount: 1 }, failureCode: null })
      .mockResolvedValueOnce({ open: true, verified: true, identity: { windowId: "hwnd:123", processId: 10, ownerWindowId: "hwnd:99", ownerProcessId: 10, title: "打开", className: "#32770", cancelButtonCount: 1 }, failureCode: null });
    const picker = {
      isOpen: vi.fn(async () => true),
      cancel: vi.fn(async () => undefined),
      inspect
    } as unknown as NativeFilePickerRecoveryProbe;

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "BLOCKED",
      detected: true,
      cancelled: false,
      failureCode: "NATIVE_FILE_PICKER_CANCEL_FAILED",
      pickerWindowIdBefore: "hwnd:123",
      pickerWindowIdAfter: "hwnd:123",
      pickerOpenBefore: true,
      pickerOpenAfter: true,
      cancelActionSent: true,
      cancelEffectVerified: false
    });
    expect(picker.cancel).toHaveBeenCalledTimes(1);
  });

  it("reports cancellation only after the same native dialog disappears", async () => {
    const inspect = vi.fn()
      .mockResolvedValueOnce({ open: true, verified: true, identity: { windowId: "hwnd:456", processId: 10, ownerWindowId: "hwnd:99", ownerProcessId: 10, title: "打开", className: "#32770", cancelButtonCount: 1 }, failureCode: null })
      .mockResolvedValueOnce({ open: false, verified: true, identity: null, failureCode: null });
    const picker = {
      isOpen: vi.fn(async () => true),
      cancel: vi.fn(async () => undefined),
      inspect
    } as unknown as NativeFilePickerRecoveryProbe;

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "CANCELLED",
      detected: true,
      cancelled: true,
      pickerWindowIdBefore: "hwnd:456",
      pickerWindowIdAfter: null,
      pickerOpenBefore: true,
      pickerOpenAfter: false,
      cancelActionSent: true,
      cancelEffectVerified: true
    });
  });

  it("does not cancel an ambiguous or foreign dialog", async () => {
    const inspect = vi.fn().mockResolvedValue({ open: false, verified: false, identity: null, failureCode: "NATIVE_FILE_PICKER_AMBIGUOUS" });
    const cancel = vi.fn(async () => undefined);
    const picker = { isOpen: vi.fn(async () => true), cancel, inspect } as unknown as NativeFilePickerRecoveryProbe;

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "BLOCKED",
      detected: false,
      cancelled: false,
      failureCode: "NATIVE_FILE_PICKER_AMBIGUOUS",
      cancelActionSent: false
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("continues directly when no picker is detected", async () => {
    const picker = probe({ open: false });

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "NOT_DETECTED",
      detected: false,
      cancelled: false,
      failureCode: null
    });
    expect(picker.cancel).not.toHaveBeenCalled();
  });

  it("cancels a detected picker exactly once", async () => {
    const picker = probe({ open: true });

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "CANCELLED",
      detected: true,
      cancelled: true,
      failureCode: null
    });
    expect(picker.cancel).toHaveBeenCalledTimes(1);
  });

  it("fails closed when picker cancellation cannot complete", async () => {
    const picker = probe({ open: true, cancel: async () => { throw new Error("picker unavailable"); } });

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "BLOCKED",
      detected: true,
      cancelled: false,
      failureCode: "NATIVE_FILE_PICKER_CANCEL_FAILED"
    });
    expect(picker.cancel).toHaveBeenCalledTimes(1);
  });

  it("preserves InvokePattern-unavailable as a fail-closed diagnostic", async () => {
    const identity = { windowId: "hwnd:789", processId: 10, ownerWindowId: "hwnd:99", ownerProcessId: 10, title: "打开", className: "#32770", cancelButtonCount: 1 };
    const systemBridge = {
      inspect: vi.fn(async () => ({ open: true, verified: true, identity, failureCode: null })),
      cancel: vi.fn(async () => ({ actionSent: false, failureCode: "CANCEL_INVOKE_PATTERN_UNAVAILABLE" as const }))
    };
    const picker = createXhsNativeFilePickerRecovery({ url: () => "https://creator.xiaohongshu.com/publish/publish" }, { systemBridge });

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "BLOCKED",
      detected: true,
      cancelled: false,
      failureCode: "CANCEL_INVOKE_PATTERN_UNAVAILABLE",
      cancelActionSent: false
    });
  });

  it("preserves Cancel identity and the underlying helper failure", async () => {
    const identity: NativeFilePickerWindowIdentity = {
      windowId: "hwnd:456",
      processId: 10,
      ownerWindowId: "hwnd:99",
      ownerProcessId: 10,
      parentWindowId: "hwnd:99",
      title: "打开",
      className: "#32770",
      cancelButtonCount: 1,
      cancelWindowId: "hwnd:789",
      cancelName: "取消",
      cancelClass: "Button",
      cancelAutomationId: "2",
      cancelControlId: 2,
      cancelEnabled: true
    };
    const cancelResult: NativeFilePickerCancelResult = {
      actionSent: false,
      failureCode: "NATIVE_FILE_PICKER_CANCEL_FAILED",
      dialogWindowId: "hwnd:456",
      cancelWindowId: "hwnd:789",
      cancelName: "取消",
      cancelClass: "Button",
      cancelAutomationId: "2",
      cancelControlId: 2,
      cancelEnabled: true,
      invokePatternAvailable: false,
      failureStage: "CANCEL_HELPER",
      underlyingFailureCode: "CANCEL_HELPER_COMPILE_FAILED",
      nativeFailureStage: "ADD_TYPE",
      nativeFailureMessageSafe: "CANCEL_HELPER_COMPILE_FAILED"
    };
    const systemBridge = {
      inspect: vi.fn(async () => ({ open: true, verified: true, identity, failureCode: null })),
      cancel: vi.fn(async () => cancelResult)
    };
    const picker = createXhsNativeFilePickerRecovery({ url: () => "https://creator.xiaohongshu.com/publish/publish" }, { systemBridge });

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "BLOCKED",
      cancelActionSent: false,
      dialogWindowId: "hwnd:456",
      cancelWindowId: "hwnd:789",
      cancelName: "取消",
      cancelClass: "Button",
      cancelAutomationId: "2",
      cancelControlId: 2,
      cancelEnabled: true,
      invokePatternAvailable: false,
      underlyingFailureCode: "CANCEL_HELPER_COMPILE_FAILED",
      nativeFailureStage: "ADD_TYPE",
      nativeFailureMessageSafe: "CANCEL_HELPER_COMPILE_FAILED"
    });
  });

  it("preserves typed helper compile failure diagnostics from the Windows bridge", async () => {
    const identity: NativeFilePickerWindowIdentity = {
      windowId: "hwnd:457",
      processId: 10,
      ownerWindowId: "hwnd:99",
      ownerProcessId: 10,
      title: "打开",
      className: "#32770",
      cancelButtonCount: 1,
      cancelWindowId: "hwnd:790",
      cancelName: "取消",
      cancelClass: "Button",
      cancelAutomationId: "2",
      cancelControlId: 2,
      cancelEnabled: true
    };
    const picker = createXhsNativeFilePickerRecovery({ url: () => "https://creator.xiaohongshu.com/publish/publish" }, {
      systemBridge: {
        inspect: vi.fn(async () => ({ open: true, verified: true, identity, failureCode: null })),
        cancel: vi.fn(async () => {
          throw new NativeFilePickerCancelError("NATIVE_FILE_PICKER_CANCEL_FAILED", {
            dialogWindowId: "hwnd:457",
            cancelWindowId: "hwnd:790",
            cancelName: "取消",
            cancelClass: "Button",
            cancelAutomationId: "2",
            cancelControlId: 2,
            cancelEnabled: true,
            invokePatternAvailable: false,
            failureStage: "CANCEL_HELPER",
            underlyingFailureCode: "CANCEL_HELPER_COMPILE_FAILED",
            nativeFailureStage: "CANCEL_HELPER_ADD_TYPE",
            nativeFailureMessageSafe: "CANCEL_HELPER_COMPILE_FAILED",
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
          });
        })
      }
    });

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "BLOCKED",
      underlyingFailureCode: "CANCEL_HELPER_COMPILE_FAILED",
      nativeFailureStage: "CANCEL_HELPER_ADD_TYPE",
      nativeFailureMessageSafe: "CANCEL_HELPER_COMPILE_FAILED",
      cancelName: "取消",
      cancelControlId: 2,
      configuredTimeoutMs: 2_000,
      nativeProcessElapsedMs: 2_001,
      nativeProcessTimedOut: true
    });
  });

  it("reports a verified Win32 BM_CLICK cancellation and stable close samples", async () => {
    const identity = { windowId: "hwnd:3935410", processId: 15276, ownerWindowId: "hwnd:8391932", ownerProcessId: 8000, title: "打开", className: "#32770", cancelButtonCount: 1 };
    let inspectCount = 0;
    const systemBridge = {
      inspect: vi.fn(async () => {
        inspectCount += 1;
        return inspectCount === 1
          ? { open: true, verified: true, identity, failureCode: null }
          : { open: false, verified: true, identity: null, failureCode: null };
      }),
      cancel: vi.fn(async () => ({ actionSent: true, mechanism: "WIN32_BM_CLICK" as const, effectVerified: true, closeStableSampleCount: 3 }))
    };
    const picker = createXhsNativeFilePickerRecovery({ url: () => "https://creator.xiaohongshu.com/publish/publish" }, { systemBridge });

    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({
      status: "CANCELLED",
      cancelActionSent: true,
      cancelEffectVerified: true,
      cancelMechanism: "WIN32_BM_CLICK",
      dialogCloseStableSampleCount: 3
    });
  });

  it("fails closed when only the URL marker and keyboard are available", async () => {
    const press = vi.fn(async (_key: string) => undefined);
    const page = {
      url: () => "https://creator.xiaohongshu.com/publish/publish?openFilePicker=true",
      keyboard: { press }
    };

    const picker = createXhsNativeFilePickerRecovery(page);
    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({ status: "BLOCKED", detected: true, cancelled: false, failureCode: "NATIVE_FILE_PICKER_CANCEL_FAILED", cancelActionSent: false, cancelEffectVerified: false, pickerOpenBefore: true });
    expect(press).not.toHaveBeenCalled();
  });
});
