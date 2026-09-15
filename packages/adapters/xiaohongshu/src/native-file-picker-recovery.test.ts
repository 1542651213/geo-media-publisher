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
  it("continues directly when no picker is detected", async () => {
    const picker = probe({ open: false });

    await expect(recoverNativeFilePicker(picker)).resolves.toEqual({
      status: "NOT_DETECTED",
      detected: false,
      cancelled: false,
      failureCode: null
    });
    expect(picker.cancel).not.toHaveBeenCalled();
  });

  it("cancels a detected picker exactly once", async () => {
    const picker = probe({ open: true });

    await expect(recoverNativeFilePicker(picker)).resolves.toEqual({
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

  it("uses the explicit XHS picker marker and presses Escape without selecting a file", async () => {
    const press = vi.fn(async (_key: string) => undefined);
    const page = {
      url: () => "https://creator.xiaohongshu.com/publish/publish?openFilePicker=true",
      keyboard: { press }
    };

    const picker = createXhsNativeFilePickerRecovery(page);
    await expect(recoverNativeFilePicker(picker)).resolves.toMatchObject({ status: "CANCELLED", detected: true, cancelled: true });
    expect(press).toHaveBeenCalledWith("Escape");
  });
});
