import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG = "--xhs-task10s-controlled-upload-attempt3" as const;
export const RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3 = "RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3" as const;
export const XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG = "--xhs-task10s-attempt3-dispatch-dry-run" as const;
export const RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN = "RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN" as const;
export const TASK10S_CANONICAL_AUTHORIZATION_ID = "6cb27b65-b122-4430-b8c7-aa83c59c8cac" as const;
export const TASK10S_EXPECTED_CREATOR_ID = "960803317" as const;
export const TASK10S_SAFE_FIXTURE_NAME = "task10s-safe-test.png" as const;
export const TASK10S_SAFE_FIXTURE_SIZE = 19226 as const;
export const TASK10S_SAFE_FIXTURE_SHA256 = "15E13943897E9D5A781F781C674BCBA0F5DA5E6DF5C696B961CB4F0F3B38A646" as const;

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

export type Task10sAttempt3ReservationReason = "ACQUIRED" | "ATTEMPT_3_ALREADY_USED" | "GUARD_UNAVAILABLE";

export interface Task10sAttempt3State {
  schemaVersion: 1;
  action: typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3;
  status: "STARTED";
  locked: true;
  attemptCount: 1;
  createdAt: string;
  accountId: string;
  contextDebugId: string;
  pageDebugId: string;
}

export interface Task10sAttempt3Reservation {
  acquired: boolean;
  reason: Task10sAttempt3ReservationReason;
  state: Task10sAttempt3State | null;
}

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

function safeState(value: unknown): Task10sAttempt3State | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1
    || candidate.action !== RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3
    || candidate.status !== "STARTED"
    || candidate.locked !== true
    || candidate.attemptCount !== 1
    || typeof candidate.createdAt !== "string"
    || typeof candidate.accountId !== "string"
    || typeof candidate.contextDebugId !== "string"
    || typeof candidate.pageDebugId !== "string") return null;
  return {
    schemaVersion: 1,
    action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3,
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
 * Reserves the only Attempt 3 before the browser mutation. The wx create is
 * the replay boundary: a crash or an uncertain browser result leaves the
 * marker in place and the next invocation fails closed.
 */
export function reserveTask10sAttempt3(statePath: string, input: Pick<Task10sAttempt3State, "accountId" | "contextDebugId" | "pageDebugId">): Task10sAttempt3Reservation {
  const state: Task10sAttempt3State = {
    schemaVersion: 1,
    action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3,
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
      let existing: Task10sAttempt3State | null = null;
      try { existing = safeState(JSON.parse(readFileSync(statePath, "utf8")) as unknown); } catch { /* malformed marker still means used */ }
      return { acquired: false, reason: "ATTEMPT_3_ALREADY_USED", state: existing };
    }
    return { acquired: false, reason: "GUARD_UNAVAILABLE", state: null };
  }
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

export interface Task10sControlledUploadAttempt3Result {
  action: typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3;
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
  imageUploadAttemptCount: 2 | 3;
  titleFillCount: 0;
  bodyFillCount: 0;
  finalSubmitClickCount: 0;
  publicationTransactionCount: 0;
  authorizedRunStateAfter: "AUTHORIZED_UNUSED" | "NOT_VERIFIED";
  newAuthorizationCreated: 0;
  evidence: Record<string, unknown>;
}

export function emptyTask10sControlledUploadAttempt3Result(accountId: string): Task10sControlledUploadAttempt3Result {
  return {
    action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3,
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
    imageUploadAttemptCount: 2,
    titleFillCount: 0,
    bodyFillCount: 0,
    finalSubmitClickCount: 0,
    publicationTransactionCount: 0,
    authorizedRunStateAfter: "NOT_VERIFIED",
    newAuthorizationCreated: 0,
    evidence: {}
  };
}
