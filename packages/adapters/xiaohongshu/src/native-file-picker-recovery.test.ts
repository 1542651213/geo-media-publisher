import { describe, expect, it, vi } from "vitest";
import { createXhsNativeFilePickerRecovery, recoverNativeFilePicker, type NativeFilePickerRecoveryProbe } from "./native-file-picker-recovery";

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
