import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG = "--xhs-task10s-controlled-upload-attempt3" as const;
export const RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3 = "RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3" as const;
export const XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4_FLAG = "--xhs-task10s-controlled-upload-attempt4" as const;
export const RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4 = "RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4" as const;
export const XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5_FLAG = "--xhs-task10s-controlled-upload-attempt5" as const;
export const RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5 = "RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5" as const;
export const XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG = "--xhs-task10s-attempt3-dispatch-dry-run" as const;
export const RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN = "RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN" as const;
export const XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG = "--xhs-task10s-complete-retained-editor" as const;
/** Explicit live route; the legacy flag remains diagnostics-only. */
export const XHS_TASK10S_COMPLETE_RETAINED_EDITOR_RUN_FLAG = "--xhs-task10s-complete-retained-editor-run" as const;
export const RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR = "RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR" as const;
export const TASK10S_CANONICAL_AUTHORIZATION_ID = "6cb27b65-b122-4430-b8c7-aa83c59c8cac" as const;
export const TASK10S_SAFE_FIXTURE_NAME = "task10s-safe-test.png" as const;
export const TASK10S_SAFE_FIXTURE_SIZE = 19226 as const;
export const TASK10S_SAFE_FIXTURE_SHA256 = "15E13943897E9D5A781F781C674BCBA0F5DA5E6DF5C696B961CB4F0F3B38A646" as const;

export type Task10sControlledUploadAttemptId = "ATTEMPT_3" | "ATTEMPT_4" | "ATTEMPT_5";
export type Task10sControlledUploadAction = typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3 | typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4 | typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5;

export interface Task10sControlledUploadAttemptSpec {
  attemptId: Task10sControlledUploadAttemptId;
  action: Task10sControlledUploadAction;
  attemptNumber: 3 | 4 | 5;
  stateFileName: string;
  baseImageUploadAttemptCount: 2 | 3 | 4;
  imageUploadAttemptCount: 3 | 4 | 5;
}

export const TASK10S_ATTEMPT_3: Task10sControlledUploadAttemptSpec = {
  attemptId: "ATTEMPT_3",
  action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3,
  attemptNumber: 3,
  stateFileName: "xiaohongshu-task10s-controlled-upload-attempt3-state.json",
  baseImageUploadAttemptCount: 2,
  imageUploadAttemptCount: 3
};

export const TASK10S_ATTEMPT_4: Task10sControlledUploadAttemptSpec = {
  attemptId: "ATTEMPT_4",
  action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4,
  attemptNumber: 4,
  stateFileName: "xiaohongshu-task10s-controlled-upload-attempt4-state.json",
  baseImageUploadAttemptCount: 3,
  imageUploadAttemptCount: 4
};

export const TASK10S_ATTEMPT_5: Task10sControlledUploadAttemptSpec = {
  attemptId: "ATTEMPT_5",
  action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5,
  attemptNumber: 5,
  stateFileName: "xiaohongshu-task10s-controlled-upload-attempt5-state.json",
  baseImageUploadAttemptCount: 4,
  imageUploadAttemptCount: 5
};

export interface Task10sAttempt3DispatchDryRunResult {
  status: "PASS";
  sideEffectCounts: {
    pageCreated: number;
    contextCreated: number;
    imagePostEntryClick: number;
    uploadImages: number;
    setInputFiles: number;
    titleFill: number;
    bodyFill: number;
    finalSubmit: number;
    publicationTransaction: number;
    newAuthorization: number;
  };
}

export interface Task10sRetainedEditorCompletionResult {
  action: typeof RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR;
  status: "PASS" | "BLOCKED";
  failureCode: string | null;
  uploadCallCount: 0;
  finalSubmitClickCount: 0 | 1;
  [key: string]: unknown;
}

export type Task10sAttemptReservationReason = "ACQUIRED" | "ATTEMPT_3_ALREADY_USED" | "ATTEMPT_4_ALREADY_USED" | "ATTEMPT_5_ALREADY_USED" | "GUARD_UNAVAILABLE";
export type Task10sAttempt3ReservationReason = Task10sAttemptReservationReason;

export interface Task10sAttemptState {
  schemaVersion: 1;
  action: Task10sControlledUploadAction;
  attemptId: Task10sControlledUploadAttemptId;
  status: "STARTED";
  locked: true;
  attemptCount: 1;
  createdAt: string;
  accountId: string;
  contextDebugId: string;
  pageDebugId: string;
}

export type Task10sAttempt3State = Task10sAttemptState;

export interface Task10sAttemptReservation {
  acquired: boolean;
  reason: Task10sAttemptReservationReason;
  state: Task10sAttemptState | null;
}

export type Task10sAttempt3Reservation = Task10sAttemptReservation;

export interface Task10sSafeFixtureValidation {
  path: string;
  exists: boolean;
  fileName: string;
  sizeBytes: number | null;
  sha256: string | null;
  expectedName: typeof TASK10S_SAFE_FIXTURE_NAME;
  expectedSizeBytes: typeof TASK10S_SAFE_FIXTURE_SIZE;
  expectedSha256: typeof TASK10S_SAFE_FIXTURE_SHA256;
  valid: boolean;
  failureCode: "FIXTURE_NOT_FOUND" | "FIXTURE_METADATA_MISMATCH" | "FIXTURE_READ_FAILED" | null;
}

function safeState(value: unknown, spec: Task10sControlledUploadAttemptSpec): Task10sAttemptState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1
    || candidate.action !== spec.action
    || (candidate.attemptId !== undefined && candidate.attemptId !== spec.attemptId)
    || candidate.status !== "STARTED"
    || candidate.locked !== true
    || candidate.attemptCount !== 1
    || typeof candidate.createdAt !== "string"
    || typeof candidate.accountId !== "string"
    || typeof candidate.contextDebugId !== "string"
    || typeof candidate.pageDebugId !== "string") return null;
  return {
    schemaVersion: 1,
    action: spec.action,
    attemptId: spec.attemptId,
    status: "STARTED",
    locked: true,
    attemptCount: 1,
    createdAt: candidate.createdAt,
    accountId: candidate.accountId,
    contextDebugId: candidate.contextDebugId,
    pageDebugId: candidate.pageDebugId
  };
}

/**
 * Reserves one typed controlled-upload attempt at the mutation boundary. The
 * wx create is the replay boundary: a crash or uncertain browser result
 * leaves the marker in place and the next invocation fails closed.
 */
export function reserveTask10sAttempt(spec: Task10sControlledUploadAttemptSpec, statePath: string, input: Pick<Task10sAttemptState, "accountId" | "contextDebugId" | "pageDebugId">): Task10sAttemptReservation {
  const state: Task10sAttemptState = {
    schemaVersion: 1,
    action: spec.action,
    attemptId: spec.attemptId,
    status: "STARTED",
    locked: true,
    attemptCount: 1,
    createdAt: new Date().toISOString(),
    accountId: input.accountId,
    contextDebugId: input.contextDebugId,
    pageDebugId: input.pageDebugId
  };
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    const fd = openSync(statePath, "wx");
    try { writeFileSync(fd, JSON.stringify(state), "utf8"); }
    finally { closeSync(fd); }
    return { acquired: true, reason: "ACQUIRED", state };
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST") {
      let existing: Task10sAttemptState | null = null;
      try { existing = safeState(JSON.parse(readFileSync(statePath, "utf8")) as unknown, spec); } catch { /* malformed marker still means used */ }
      const reason = spec.attemptId === "ATTEMPT_3"
        ? "ATTEMPT_3_ALREADY_USED"
        : spec.attemptId === "ATTEMPT_4"
          ? "ATTEMPT_4_ALREADY_USED"
          : "ATTEMPT_5_ALREADY_USED";
      return { acquired: false, reason, state: existing };
    }
    return { acquired: false, reason: "GUARD_UNAVAILABLE", state: null };
  }
}

export function reserveTask10sAttempt3(statePath: string, input: Pick<Task10sAttemptState, "accountId" | "contextDebugId" | "pageDebugId">): Task10sAttempt3Reservation {
  return reserveTask10sAttempt(TASK10S_ATTEMPT_3, statePath, input);
}

export function reserveTask10sAttempt4(statePath: string, input: Pick<Task10sAttemptState, "accountId" | "contextDebugId" | "pageDebugId">): Task10sAttemptReservation {
  return reserveTask10sAttempt(TASK10S_ATTEMPT_4, statePath, input);
}

export function reserveTask10sAttempt5(statePath: string, input: Pick<Task10sAttemptState, "accountId" | "contextDebugId" | "pageDebugId">): Task10sAttemptReservation {
  return reserveTask10sAttempt(TASK10S_ATTEMPT_5, statePath, input);
}

export function task10sSafeFixturePath(): string {
  return join(tmpdir(), "geo-media-publisher-safe-fixtures", TASK10S_SAFE_FIXTURE_NAME);
}

export function validateTask10sSafeFixture(): Task10sSafeFixtureValidation {
  const path = task10sSafeFixturePath();
  const base = {
    path,
    exists: false,
    fileName: TASK10S_SAFE_FIXTURE_NAME,
    sizeBytes: null,
    sha256: null,
    expectedName: TASK10S_SAFE_FIXTURE_NAME,
    expectedSizeBytes: TASK10S_SAFE_FIXTURE_SIZE,
    expectedSha256: TASK10S_SAFE_FIXTURE_SHA256
  } as const;
  if (!existsSync(path)) return { ...base, valid: false, failureCode: "FIXTURE_NOT_FOUND" };
  try {
    const stat = statSync(path);
    const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
    const valid = stat.isFile() && stat.size === TASK10S_SAFE_FIXTURE_SIZE && sha256 === TASK10S_SAFE_FIXTURE_SHA256;
    return { ...base, exists: true, sizeBytes: stat.size, sha256, valid, failureCode: valid ? null : "FIXTURE_METADATA_MISMATCH" };
  } catch {
    return { ...base, exists: true, valid: false, failureCode: "FIXTURE_READ_FAILED" };
  }
}

export interface Task10sAttempt3FileInputReadback {
  filesLength: number | null;
  fileName: string | null;
  fileSize: number | null;
  fileType: string | null;
  fileLastModified: number | null;
  status: "PASS" | "FAIL" | "NOT_OBSERVED";
  expectedFixtureMatch: "YES" | "NO" | "NOT_OBSERVED";
}

export interface Task10sControlledUploadAttemptResult {
  action: Task10sControlledUploadAction;
  attemptId: Task10sControlledUploadAttemptId;
  timestamp: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  failureCode: string | null;
  accountId: string;
  contextDebugId: string | null;
  pageDebugId: string | null;
  sameContext: "YES" | "NO" | "NOT_RUN";
  sameCanonicalPage: "YES" | "NO" | "NOT_RUN";
  imagePostEntry: "PASS" | "FAIL" | "NOT_RUN";
  imagePostRouteReadback: "PASS" | "FAIL" | "NOT_RUN";
  observedTarget: string | null;
  preUploadPhaseResult: "PASS" | "FAIL" | "NOT_RUN";
  uploadTargetFileInputFingerprint: Record<string, unknown> | null;
  fileInputImmediateReadback: Task10sAttempt3FileInputReadback;
  browserFileInputReceivedFixture: "YES" | "NO" | "NOT_RUN";
  uploadLayer1: "PASS" | "FAIL" | "NOT_RUN";
  uploadLayer2: "PASS" | "FAIL" | "NOT_RUN";
  uploadLayer3: "PASS" | "FAIL" | "NOT_RUN";
  uploadLayer4: "PASS" | "FAIL" | "NOT_RUN";
  uploadProcessingSignal: boolean | null;
  uploadErrorSignal: boolean | null;
  uploadRetrySignal: boolean | null;
  currentPreviewDetectionRule: string | null;
  currentImageAssetDetectionRule: string | null;
  editorScopedImagePreviewCount: number | null;
  editorScopedImageAssetCount: number | null;
  titleControlPresent: boolean;
  bodyControlPresent: boolean;
  finalSubmitControlPresent: boolean;
  imageUpload: "PASS" | "NOT_VERIFIED" | "NOT_RUN";
  controlledUploadAttempt3Count: 0 | 1;
  controlledUploadAttempt4Count: 0 | 1;
  controlledUploadAttempt5Count: 0 | 1;
  imageUploadAttemptCount: 2 | 3 | 4 | 5;
  titleFillCount: 0;
  bodyFillCount: 0;
  finalSubmitClickCount: 0;
  publicationTransactionCount: 0;
  authorizedRunStateAfter: "AUTHORIZED_UNUSED" | "NOT_VERIFIED";
  newAuthorizationCreated: 0;
  evidence: Record<string, unknown>;
}

export type Task10sControlledUploadAttempt3Result = Task10sControlledUploadAttemptResult;
export type Task10sControlledUploadAttempt4Result = Task10sControlledUploadAttemptResult;
export type Task10sControlledUploadAttempt5Result = Task10sControlledUploadAttemptResult;

export function emptyTask10sControlledUploadAttemptResult(attempt: Task10sControlledUploadAttemptSpec, accountId: string): Task10sControlledUploadAttemptResult {
  return {
    action: attempt.action,
    attemptId: attempt.attemptId,
    timestamp: new Date().toISOString(),
    status: "BLOCKED",
    failureCode: null,
    accountId,
    contextDebugId: null,
    pageDebugId: null,
    sameContext: "NOT_RUN",
    sameCanonicalPage: "NOT_RUN",
    imagePostEntry: "NOT_RUN",
    imagePostRouteReadback: "NOT_RUN",
    observedTarget: null,
    preUploadPhaseResult: "NOT_RUN",
    uploadTargetFileInputFingerprint: null,
    fileInputImmediateReadback: { filesLength: null, fileName: null, fileSize: null, fileType: null, fileLastModified: null, status: "NOT_OBSERVED", expectedFixtureMatch: "NOT_OBSERVED" },
    browserFileInputReceivedFixture: "NOT_RUN",
    uploadLayer1: "NOT_RUN",
    uploadLayer2: "NOT_RUN",
    uploadLayer3: "NOT_RUN",
    uploadLayer4: "NOT_RUN",
    uploadProcessingSignal: null,
    uploadErrorSignal: null,
    uploadRetrySignal: null,
    currentPreviewDetectionRule: null,
    currentImageAssetDetectionRule: null,
    editorScopedImagePreviewCount: null,
    editorScopedImageAssetCount: null,
    titleControlPresent: false,
    bodyControlPresent: false,
    finalSubmitControlPresent: false,
    imageUpload: "NOT_RUN",
    controlledUploadAttempt3Count: 0,
    controlledUploadAttempt4Count: 0,
    controlledUploadAttempt5Count: 0,
    imageUploadAttemptCount: attempt.baseImageUploadAttemptCount,
    titleFillCount: 0,
    bodyFillCount: 0,
    finalSubmitClickCount: 0,
    publicationTransactionCount: 0,
    authorizedRunStateAfter: "NOT_VERIFIED",
    newAuthorizationCreated: 0,
    evidence: {}
  };
}

export function emptyTask10sControlledUploadAttempt3Result(accountId: string): Task10sControlledUploadAttempt3Result {
  return emptyTask10sControlledUploadAttemptResult(TASK10S_ATTEMPT_3, accountId);
}

export function emptyTask10sControlledUploadAttempt4Result(accountId: string): Task10sControlledUploadAttempt4Result {
  return emptyTask10sControlledUploadAttemptResult(TASK10S_ATTEMPT_4, accountId);
}

export function emptyTask10sControlledUploadAttempt5Result(accountId: string): Task10sControlledUploadAttempt5Result {
  return emptyTask10sControlledUploadAttemptResult(TASK10S_ATTEMPT_5, accountId);
}
