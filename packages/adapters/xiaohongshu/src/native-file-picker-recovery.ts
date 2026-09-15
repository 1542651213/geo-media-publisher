import { createWindowsNativeFilePickerBridge, NativeFilePickerCancelError, type NativeFilePickerCancelResult, type NativeFilePickerCancelDiagnostics, type NativeFilePickerFailureCode, type NativeFilePickerInspection, type NativeFilePickerSystemBridge, type NativeFilePickerWindowIdentity } from "./native-file-picker-windows";

const nativeFilePickerFailureCodes: readonly NativeFilePickerFailureCode[] = [
  "NATIVE_FILE_PICKER_CANCEL_FAILED",
  "NATIVE_FILE_PICKER_STATE_UNVERIFIED",
  "NATIVE_FILE_PICKER_AMBIGUOUS",
  "NATIVE_FILE_PICKER_OWNER_NOT_VERIFIED",
  "NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE",
  "NATIVE_FILE_PICKER_IDENTITY_MISMATCH",
  "CANCEL_INVOKE_PATTERN_UNAVAILABLE",
  "CANCEL_IDENTITY_NOT_ESTABLISHED",
  "CANCEL_ACTION_UNAVAILABLE",
  "CANCEL_HELPER_COMPILE_FAILED",
  "CANCEL_HELPER_TIMEOUT",
  "CANCEL_HELPER_PROCESS_EXIT_FAILED",
  "CANCEL_HELPER_STDERR_FAILURE",
  "CANCEL_HELPER_JSON_PARSE_FAILED",
  "UNKNOWN_NATIVE_HELPER_FAILURE",
  "CANCEL_ACTION_FAILED",
  "CANCEL_EFFECT_NOT_VERIFIED"
];

function failureCodeFrom(error: unknown, fallback: NativeFilePickerFailureCode): NativeFilePickerFailureCode {
  const message = error instanceof Error ? error.message : "";
  return (nativeFilePickerFailureCodes as readonly string[]).includes(message)
    ? message as NativeFilePickerFailureCode
    : fallback;
}

/**
 * A deliberately narrow hook for recovering an OS file picker which may have
 * remained open after the single upload mutation. The adapter never selects a
 * file here and the hook is invoked at most once for a discovery attempt.
 */
export interface NativeFilePickerRecoveryProbe {
  isOpen(): boolean | Promise<boolean>;
  cancel(): void | Promise<void> | Promise<NativeFilePickerCancelResult | void>;
  /** Native probes must expose a second, identity-aware state read after cancel. */
  inspect?(): NativeFilePickerInspection | Promise<NativeFilePickerInspection>;
}

export type NativeFilePickerRecoveryStatus = "NOT_DETECTED" | "CANCELLED" | "BLOCKED";

export interface NativeFilePickerRecoveryResult {
  status: NativeFilePickerRecoveryStatus;
  detected: boolean;
  cancelled: boolean;
  failureCode: NativeFilePickerFailureCode | null;
  pickerWindowIdBefore?: string | null;
  pickerWindowIdAfter?: string | null;
  pickerOpenBefore?: boolean;
  pickerOpenAfter?: boolean | null;
  cancelActionSent?: boolean;
  cancelEffectVerified?: boolean;
  cancelMechanism?: NativeFilePickerCancelResult["mechanism"] | null;
  dialogCloseStableSampleCount?: number | null;
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
  configuredTimeoutMs?: number | null;
  nativeProcessElapsedMs?: number | null;
  nativeProcessExitCode?: number | string | null;
  nativeProcessSignal?: string | null;
  nativeProcessKilled?: boolean | null;
  nativeProcessTimedOut?: boolean | null;
  nativeExecErrorName?: string | null;
  nativeExecErrorCode?: number | string | null;
  nativeExecErrorMessageSafe?: string | null;
  stdoutLength?: number;
  stderrLength?: number;
  stderrSafe?: string | null;
  stdoutSafeTail?: string | null;
}

function identityEvidence(identity: NativeFilePickerWindowIdentity | null): NativeFilePickerCancelDiagnostics {
  return identity
    ? {
        dialogWindowId: identity.windowId,
        cancelWindowId: identity.cancelWindowId ?? null,
        cancelName: identity.cancelName ?? null,
        cancelClass: identity.cancelClass ?? null,
        cancelAutomationId: identity.cancelAutomationId ?? null,
        cancelControlId: identity.cancelControlId ?? null,
        cancelEnabled: identity.cancelEnabled ?? null
      }
    : {};
}

function cancelErrorEvidence(error: unknown): NativeFilePickerCancelDiagnostics {
  if (error instanceof NativeFilePickerCancelError) return error.diagnostics;
  return {
    failureStage: "CANCEL_ACTION",
    underlyingFailureCode: "CANCEL_ACTION_FAILED",
    nativeFailureStage: "CANCEL_ACTION",
    nativeFailureMessageSafe: "CANCEL_ACTION_FAILED"
  };
}

export interface NativeFilePickerPage {
  url(): string;
  keyboard?: { press(key: string): Promise<void> };
  isNativeFilePickerOpen?: () => boolean | Promise<boolean>;
  cancelNativeFilePicker?: () => void | Promise<void>;
}

export interface CreateXhsNativeFilePickerRecoveryOptions {
  profilePath?: string | null;
  browserChannel?: "chrome" | "msedge" | null;
  systemBridge?: NativeFilePickerSystemBridge;
}

/**
 * Recover only when the host supplies an explicit open-state signal. The
 * `openFilePicker=true` route marker is the browser-side signal used by the
 * XHS flow; a host-native probe can be supplied when the runtime exposes one.
 */
export function createXhsNativeFilePickerRecovery(page: NativeFilePickerPage, options: CreateXhsNativeFilePickerRecoveryOptions = {}): NativeFilePickerRecoveryProbe {
  let cancellationAttempted = false;
  const systemBridge = options.systemBridge ?? (options.profilePath?.trim() ? createWindowsNativeFilePickerBridge({ profilePath: options.profilePath, browserChannel: options.browserChannel ?? null }) : undefined);
  let lastInspection: NativeFilePickerInspection | null = null;
  const inspect = async (): Promise<NativeFilePickerInspection> => {
    if (systemBridge) {
      const result = await systemBridge.inspect();
      lastInspection = result;
      return result;
    }
    try {
      const open = typeof page.isNativeFilePickerOpen === "function"
        ? await page.isNativeFilePickerOpen()
        : new URL(page.url()).searchParams.get("openFilePicker") === "true";
      const result: NativeFilePickerInspection = { open, verified: true, identity: null, failureCode: null };
      lastInspection = result;
      return result;
    } catch {
      const result: NativeFilePickerInspection = { open: false, verified: false, identity: null, failureCode: "NATIVE_FILE_PICKER_STATE_UNVERIFIED" };
      lastInspection = result;
      return result;
    }
  };
  const probe: NativeFilePickerRecoveryProbe = {
    isOpen: async () => (await inspect()).open,
    cancel: async () => {
      if (cancellationAttempted) return;
      if (systemBridge) {
        if (!lastInspection?.open || !lastInspection.identity) throw new Error("NATIVE_FILE_PICKER_IDENTITY_UNAVAILABLE");
        const result = await systemBridge.cancel(lastInspection.identity);
        if (!result.actionSent) {
          throw new NativeFilePickerCancelError(result.failureCode ?? "NATIVE_FILE_PICKER_CANCEL_FAILED", {
            ...identityEvidence(lastInspection.identity),
            ...result
          });
        }
        cancellationAttempted = true;
        return result;
      }
      if (typeof page.cancelNativeFilePicker === "function") {
        await page.cancelNativeFilePicker();
        cancellationAttempted = true;
        return;
      }
      throw new Error("NATIVE_FILE_PICKER_CANCEL_UNAVAILABLE");
    }
  };
  if (systemBridge) probe.inspect = inspect;
  return probe;
}

export async function recoverNativeFilePicker(probe?: NativeFilePickerRecoveryProbe): Promise<NativeFilePickerRecoveryResult> {
  const empty = (status: NativeFilePickerRecoveryStatus, detected: boolean, failureCode: NativeFilePickerFailureCode | null, values: Partial<NativeFilePickerRecoveryResult> = {}): NativeFilePickerRecoveryResult => ({
    status,
    detected,
    cancelled: status === "CANCELLED",
    failureCode,
    pickerWindowIdBefore: null,
    pickerWindowIdAfter: null,
    pickerOpenBefore: false,
    pickerOpenAfter: null,
    cancelActionSent: false,
    cancelEffectVerified: false,
    cancelMechanism: null,
    dialogCloseStableSampleCount: null,
    dialogWindowId: null,
    cancelWindowId: null,
    cancelName: null,
    cancelClass: null,
    cancelAutomationId: null,
    cancelControlId: null,
    cancelEnabled: null,
    invokePatternAvailable: null,
    failureStage: null,
    underlyingFailureCode: null,
    nativeFailureStage: null,
    nativeFailureMessageSafe: null,
    configuredTimeoutMs: null,
    nativeProcessElapsedMs: null,
    nativeProcessExitCode: null,
    nativeProcessSignal: null,
    nativeProcessKilled: null,
    nativeProcessTimedOut: null,
    nativeExecErrorName: null,
    nativeExecErrorCode: null,
    nativeExecErrorMessageSafe: null,
    stdoutLength: 0,
    stderrLength: 0,
    stderrSafe: null,
    stdoutSafeTail: null,
    ...values
  });
  if (!probe) return empty("NOT_DETECTED", false, null, { pickerOpenAfter: false });
  const inspect = probe.inspect;
  if (typeof inspect === "function") {
    let before: NativeFilePickerInspection;
    try { before = await inspect(); } catch { return empty("BLOCKED", false, "NATIVE_FILE_PICKER_STATE_UNVERIFIED"); }
    const beforeWindowId = before.identity?.windowId ?? null;
    const beforeEvidence = identityEvidence(before.identity);
    if (!before.verified) return empty("BLOCKED", before.open, before.failureCode ?? "NATIVE_FILE_PICKER_STATE_UNVERIFIED", { ...beforeEvidence, pickerWindowIdBefore: beforeWindowId, pickerOpenBefore: before.open, failureStage: "PRE_ACTION_INSPECTION", underlyingFailureCode: "CANCEL_IDENTITY_NOT_ESTABLISHED", nativeFailureStage: "PICKER_INSPECTION", nativeFailureMessageSafe: "CANCEL_IDENTITY_NOT_ESTABLISHED" });
    if (!before.open) return empty("NOT_DETECTED", false, null, { ...beforeEvidence, pickerWindowIdBefore: beforeWindowId, pickerOpenBefore: false, pickerOpenAfter: false });
    if (!before.identity) return empty("BLOCKED", true, "NATIVE_FILE_PICKER_STATE_UNVERIFIED", { dialogWindowId: beforeWindowId, pickerOpenBefore: true, failureStage: "PRE_ACTION_INSPECTION", underlyingFailureCode: "CANCEL_IDENTITY_NOT_ESTABLISHED", nativeFailureStage: "PICKER_INSPECTION", nativeFailureMessageSafe: "CANCEL_IDENTITY_NOT_ESTABLISHED" });
    let cancelActionSent = false;
    let cancelResult: NativeFilePickerCancelResult | void;
    try {
      cancelResult = await probe.cancel();
      cancelActionSent = cancelResult && typeof cancelResult.actionSent === "boolean" ? cancelResult.actionSent : true;
    } catch (error) {
      return empty("BLOCKED", true, failureCodeFrom(error, "NATIVE_FILE_PICKER_CANCEL_FAILED"), { ...beforeEvidence, ...cancelErrorEvidence(error), pickerWindowIdBefore: beforeWindowId, pickerOpenBefore: true, cancelActionSent: false });
    }
    let after: NativeFilePickerInspection;
    if (cancelResult && typeof cancelResult.actionSent === "boolean" && !cancelResult.actionSent) {
      return empty("BLOCKED", true, cancelResult.failureCode ?? "NATIVE_FILE_PICKER_CANCEL_FAILED", { ...beforeEvidence, ...cancelResult, pickerWindowIdBefore: beforeWindowId, pickerOpenBefore: true, cancelActionSent: false, cancelEffectVerified: false, failureStage: cancelResult.failureStage ?? "CANCEL_ACTION", underlyingFailureCode: cancelResult.underlyingFailureCode ?? "CANCEL_ACTION_FAILED", nativeFailureStage: cancelResult.nativeFailureStage ?? "CANCEL_ACTION", nativeFailureMessageSafe: cancelResult.nativeFailureMessageSafe ?? "CANCEL_ACTION_FAILED" });
    }
    try { after = await inspect(); } catch { return empty("BLOCKED", true, "NATIVE_FILE_PICKER_STATE_UNVERIFIED", { ...beforeEvidence, pickerWindowIdBefore: beforeWindowId, pickerOpenBefore: true, cancelActionSent, cancelEffectVerified: false, failureStage: "POST_ACTION_INSPECTION", underlyingFailureCode: "CANCEL_EFFECT_NOT_VERIFIED", nativeFailureStage: "PICKER_INSPECTION", nativeFailureMessageSafe: "CANCEL_EFFECT_NOT_VERIFIED" }); }
    const afterWindowId = after.identity?.windowId ?? null;
    const closeVerified = cancelResult?.effectVerified !== false && after.verified && !after.open && afterWindowId === null;
    const cancelEvidence = { cancelMechanism: cancelResult?.mechanism ?? null, dialogCloseStableSampleCount: cancelResult?.closeStableSampleCount ?? null };
    const afterEvidence = identityEvidence(after.identity);
    if (!closeVerified) return empty("BLOCKED", true, after.failureCode ?? "NATIVE_FILE_PICKER_CANCEL_FAILED", { ...beforeEvidence, ...afterEvidence, pickerWindowIdBefore: beforeWindowId, pickerWindowIdAfter: afterWindowId, pickerOpenBefore: true, pickerOpenAfter: after.open, cancelActionSent, cancelEffectVerified: false, failureStage: "POST_ACTION_VERIFY", underlyingFailureCode: "CANCEL_EFFECT_NOT_VERIFIED", nativeFailureStage: "DIALOG_CLOSE_CHECK", nativeFailureMessageSafe: "CANCEL_EFFECT_NOT_VERIFIED", ...cancelEvidence });
    return empty("CANCELLED", true, null, { ...beforeEvidence, ...afterEvidence, pickerWindowIdBefore: beforeWindowId, pickerWindowIdAfter: null, pickerOpenBefore: true, pickerOpenAfter: false, cancelActionSent, cancelEffectVerified: true, ...cancelEvidence });
  }

  let detected = false;
  try {
    detected = await probe.isOpen();
  } catch {
    return empty("BLOCKED", false, "NATIVE_FILE_PICKER_STATE_UNVERIFIED");
  }
  if (!detected) return empty("NOT_DETECTED", false, null, { pickerOpenAfter: false });
  try {
    await probe.cancel();
    const openAfter = await probe.isOpen();
    if (openAfter) return empty("BLOCKED", true, "NATIVE_FILE_PICKER_CANCEL_FAILED", { pickerOpenBefore: true, pickerOpenAfter: true, cancelActionSent: true });
    return empty("CANCELLED", true, null, { pickerOpenBefore: true, pickerOpenAfter: false, cancelActionSent: true, cancelEffectVerified: true });
  } catch {
    return empty("BLOCKED", true, "NATIVE_FILE_PICKER_CANCEL_FAILED", { pickerOpenBefore: true, cancelActionSent: false });
  }
}
