import { parseXiaohongshuImageCounterText, type XiaohongshuPostUploadReconciliationState } from "./post-upload-reconciliation-diagnostic";

export type XiaohongshuPostUploadTerminalReadinessBlocker =
  | "IMAGE_ASSET_MISSING"
  | "IMAGE_COUNTER_INVALID"
  | "TITLE_CONTROL_MISSING"
  | "BODY_CONTROL_MISSING"
  | "UPLOAD_ERROR_PRESENT"
  | "BUSY_SIGNAL_PRESENT";

export interface XiaohongshuPostUploadTerminalReadinessInput {
  originalPostUploadState: XiaohongshuPostUploadReconciliationState;
  editorScopedImageAssetCount: number;
  imageCounterTextSafe: string | null;
  titleControlPresent: boolean;
  bodyControlPresent: boolean;
  uploadErrorSignalPresent: boolean;
  busySignalPresent: boolean;
}

export interface XiaohongshuPostUploadTerminalReadiness extends XiaohongshuPostUploadTerminalReadinessInput {
  imageCounterValid: boolean;
  postUploadState: XiaohongshuPostUploadReconciliationState;
  ready: boolean;
  blockerCodes: readonly XiaohongshuPostUploadTerminalReadinessBlocker[];
}

export function classifyXiaohongshuPostUploadTerminalReadiness(
  input: XiaohongshuPostUploadTerminalReadinessInput
): XiaohongshuPostUploadTerminalReadiness {
  const imageCounterValid = parseXiaohongshuImageCounterText(input.imageCounterTextSafe) !== null;
  const blockerCodes: XiaohongshuPostUploadTerminalReadinessBlocker[] = [];
  if (!(input.editorScopedImageAssetCount > 0)) blockerCodes.push("IMAGE_ASSET_MISSING");
  if (!imageCounterValid) blockerCodes.push("IMAGE_COUNTER_INVALID");
  if (!input.titleControlPresent) blockerCodes.push("TITLE_CONTROL_MISSING");
  if (!input.bodyControlPresent) blockerCodes.push("BODY_CONTROL_MISSING");
  if (input.uploadErrorSignalPresent) blockerCodes.push("UPLOAD_ERROR_PRESENT");
  if (input.busySignalPresent) blockerCodes.push("BUSY_SIGNAL_PRESENT");
  const ready = blockerCodes.length === 0;
  return {
    ...input,
    imageCounterValid,
    postUploadState: ready ? "EDITOR_READY" : input.originalPostUploadState,
    ready,
    blockerCodes
  };
}
