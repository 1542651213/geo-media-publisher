import type { Task10sFinalSurfaceResolution } from "./task10s-final-surface";
import { parseXiaohongshuImageCounterText } from "./post-upload-reconciliation-diagnostic";
import { normalizeXiaohongshuEditorText } from "./editor-text-normalization";

export type Task10sRetainedEditorPostUploadState = "EDITOR_READY" | "PROCESSING" | "REJECTED" | "AMBIGUOUS";

export interface Task10sRetainedEditorGateInput {
  uploadAttemptCount: number;
  setInputFilesCallCount: number;
  postUploadState: Task10sRetainedEditorPostUploadState;
  imageAssetRenderedCount: number;
  imageCounterTextSafe: string | null;
  titleControlPresent: boolean;
  bodyControlPresent: boolean;
  noExplicitUploadError: boolean;
  initialPublishSurface: Task10sFinalSurfaceResolution;
  /** Exact content persisted on the current Prepared Job's bound Article. */
  trustedArticleTitle: string;
  trustedArticleBody: string;
  titleReadback: string;
  bodyReadback: string;
  requiredFieldsPass: boolean;
  finalPublishSurface: Task10sFinalSurfaceResolution;
  contextIdentityAttestationPass: boolean;
  sameContext: boolean;
  /** Retained-editor Page identity is intentionally not required to match the source Page. */
  samePage?: boolean;
  authorizationState: string;
  finalSubmitClickCount: number;
}

export interface Task10sRetainedEditorGateResult {
  status: "READY_TO_SUBMIT" | "BLOCKED";
  currentDraftImageProof: boolean;
  titleReadbackExact: boolean;
  bodyReadbackExact: boolean;
  finalSubmitPresent: boolean;
  finalSubmitEnabled: boolean;
  failureCode: string | null;
}

const blocked = (failureCode: string): Task10sRetainedEditorGateResult => ({
  status: "BLOCKED",
  currentDraftImageProof: false,
  titleReadbackExact: false,
  bodyReadbackExact: false,
  finalSubmitPresent: false,
  finalSubmitEnabled: false,
  failureCode
});

/**
 * Fail-closed gate for the fixed Task10S completion action. It contains no
 * browser or upload operation; all mutations remain in the adapter/Main path.
 */
export function evaluateTask10sRetainedEditorGate(input: Task10sRetainedEditorGateInput): Task10sRetainedEditorGateResult {
  if (input.setInputFilesCallCount !== 0) return blocked("UPLOAD_CALL_OBSERVED");
  if (input.postUploadState !== "EDITOR_READY") return blocked("POST_UPLOAD_EDITOR_NOT_READY");
  if (input.imageAssetRenderedCount < 1) return blocked("IMAGE_ASSET_NOT_PROVEN");
  if (!parseXiaohongshuImageCounterText(input.imageCounterTextSafe)) return blocked("IMAGE_COUNTER_NOT_VALID");
  if (!input.titleControlPresent) return blocked("TITLE_CONTROL_NOT_FOUND");
  if (!input.bodyControlPresent) return blocked("BODY_CONTROL_NOT_FOUND");
  if (!input.noExplicitUploadError) return blocked("EXPLICIT_UPLOAD_ERROR");
  if (!input.initialPublishSurface.present) return blocked("INITIAL_FINAL_SURFACE_NOT_PRESENT");
  if (!input.trustedArticleTitle.trim() || !input.trustedArticleBody.trim()) return blocked("PREPARED_ARTICLE_CONTENT_NOT_AVAILABLE");
  if (normalizeXiaohongshuEditorText(input.titleReadback) !== normalizeXiaohongshuEditorText(input.trustedArticleTitle)) return blocked("TITLE_READBACK_NOT_EXACT");
  if (input.bodyReadback !== input.trustedArticleBody) return blocked("BODY_READBACK_NOT_EXACT");
  if (!input.requiredFieldsPass) return blocked("REQUIRED_FIELDS_NOT_VERIFIED");
  if (!input.contextIdentityAttestationPass) return blocked("CONTEXT_IDENTITY_ATTESTATION_INVALID");
  if (!input.sameContext) return blocked("SAME_CONTEXT_REQUIRED");
  if (input.authorizationState !== "AUTHORIZED_UNUSED") return blocked("AUTHORIZATION_NOT_UNUSED");
  if (input.finalSubmitClickCount !== 0) return blocked("FINAL_SUBMIT_ALREADY_CLICKED");
  if (!input.finalPublishSurface.present) return blocked("FINAL_SURFACE_NOT_PRESENT");
  if (!input.finalPublishSurface.enabled) return blocked("FINAL_SURFACE_NOT_ENABLED");
  return {
    status: "READY_TO_SUBMIT",
    currentDraftImageProof: true,
    titleReadbackExact: true,
    bodyReadbackExact: true,
    finalSubmitPresent: true,
    finalSubmitEnabled: true,
    failureCode: null
  };
}
