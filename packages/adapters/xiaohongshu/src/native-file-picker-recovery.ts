/**
 * A deliberately narrow hook for recovering an OS file picker which may have
 * remained open after the single upload mutation. The adapter never selects a
 * file here and the hook is invoked at most once for a discovery attempt.
 */
export interface NativeFilePickerRecoveryProbe {
  isOpen(): boolean | Promise<boolean>;
  cancel(): void | Promise<void>;
}

export type NativeFilePickerRecoveryStatus = "NOT_DETECTED" | "CANCELLED" | "BLOCKED";

export interface NativeFilePickerRecoveryResult {
  status: NativeFilePickerRecoveryStatus;
  detected: boolean;
  cancelled: boolean;
  failureCode: "NATIVE_FILE_PICKER_CANCEL_FAILED" | null;
}

export interface NativeFilePickerPage {
  url(): string;
  keyboard?: { press(key: string): Promise<void> };
  isNativeFilePickerOpen?: () => boolean | Promise<boolean>;
  cancelNativeFilePicker?: () => void | Promise<void>;
}

/**
 * Recover only when the host supplies an explicit open-state signal. The
 * `openFilePicker=true` route marker is the browser-side signal used by the
 * XHS flow; a host-native probe can be supplied when the runtime exposes one.
 */
export function createXhsNativeFilePickerRecovery(page: NativeFilePickerPage): NativeFilePickerRecoveryProbe {
  let cancellationAttempted = false;
  return {
    isOpen: async () => {
      if (cancellationAttempted) return false;
      if (typeof page.isNativeFilePickerOpen === "function") return page.isNativeFilePickerOpen();
      try {
        return new URL(page.url()).searchParams.get("openFilePicker") === "true";
      } catch {
        return false;
      }
    },
    cancel: async () => {
      if (cancellationAttempted) return;
      if (typeof page.cancelNativeFilePicker === "function") {
        await page.cancelNativeFilePicker();
        cancellationAttempted = true;
        return;
      }
      if (page.keyboard && typeof page.keyboard.press === "function") {
        await page.keyboard.press("Escape");
        cancellationAttempted = true;
        return;
      }
      throw new Error("NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE");
    }
  };
}

export async function recoverNativeFilePicker(probe?: NativeFilePickerRecoveryProbe): Promise<NativeFilePickerRecoveryResult> {
  if (!probe) return { status: "NOT_DETECTED", detected: false, cancelled: false, failureCode: null };
  let detected = false;
  try {
    detected = await probe.isOpen();
  } catch {
    return { status: "BLOCKED", detected: false, cancelled: false, failureCode: "NATIVE_FILE_PICKER_CANCEL_FAILED" };
  }
  if (!detected) return { status: "NOT_DETECTED", detected: false, cancelled: false, failureCode: null };
  try {
    await probe.cancel();
    return { status: "CANCELLED", detected: true, cancelled: true, failureCode: null };
  } catch {
    return { status: "BLOCKED", detected: true, cancelled: false, failureCode: "NATIVE_FILE_PICKER_CANCEL_FAILED" };
  }
}
