export interface KangyiPhase2Authorization {
  enabled: boolean;
  authorizationId: string;
  accountId: string;
  siteId: string;
  environment: "local" | "staging" | "production";
  writesEnabled: boolean;
  capabilitiesHttpStatus: number;
  protocolVersion: string;
  contentKinds: string[];
}

export interface KangyiPilotBudgetInput {
  articleCount: number;
  imageCount: number;
  logicalCreateCount: number;
  logicalDraftCount: number;
  logicalValidateCount: number;
  logicalPublishCount: number;
}

export type KangyiStopCondition =
  | "ACCOUNT_SCOPE_MISMATCH"
  | "AUTH_FAILURE"
  | "WRITES_DISABLED"
  | "IMMUTABLE_BINDING_MISMATCH"
  | "MEDIA_HASH_MISMATCH"
  | "UNSUPPORTED_MEDIA"
  | "PAYLOAD_CHANGED"
  | "SAME_KEY_PAYLOAD_CONFLICT"
  | "CONTENT_IDENTITY_MISSING"
  | "STALE_ROW_VERSION"
  | "VALIDATION_FAILED"
  | "PUBLISH_STATUS_UNEXPECTED"
  | "DISPATCH_CLAIM_MISMATCH"
  | "CMS_JOB_ID_MISSING"
  | "CMS_JOB_FAILED"
  | "CMS_JOB_NEEDS_ATTENTION"
  | "PUBLIC_URL_MISSING"
  | "PUBLIC_READBACK_MISMATCH"
  | "RECOVERY_BINDING_MISMATCH"
  | "SECOND_LOGICAL_PUBLISH";

export function assertKangyiPhase2Authorization(input: KangyiPhase2Authorization, expectedSiteId = "kangyi"): void {
  if (input.enabled !== true || !input.authorizationId.trim()) throw new Error("KANGYI_PHASE2_OWNER_AUTH_REQUIRED");
  if (!input.accountId.trim()) throw new Error("KANGYI_PHASE2_ACCOUNT_MISMATCH");
  if (!["kangyi", "huiquan", "shupai"].includes(expectedSiteId) || input.siteId !== expectedSiteId || input.environment !== "staging") throw new Error("KANGYI_PHASE2_SCOPE_MISMATCH");
  if (input.capabilitiesHttpStatus !== 200 || input.protocolVersion !== "2" || !input.contentKinds.includes("article") || !input.contentKinds.includes("case")) throw new Error("KANGYI_PHASE2_CAPABILITIES_NOT_VERIFIED");
  if (input.writesEnabled !== true) throw new Error("KANGYI_PHASE2_WRITES_DISABLED");
}

export function assertKangyiAccountScope(input: { accountId: string; expectedAccountId: string; siteId: string; environment: string; writesEnabled: boolean }, expectedSiteId = "kangyi"): void {
  if (!input.accountId || input.accountId !== input.expectedAccountId || !["kangyi", "huiquan", "shupai"].includes(expectedSiteId) || input.siteId !== expectedSiteId || input.environment !== "staging") throw new Error("KANGYI_ACCOUNT_SCOPE_MISMATCH");
  if (input.writesEnabled !== true) throw new Error("KANGYI_PHASE2_WRITES_DISABLED");
}

export function assertKangyiPilotBudget(input: KangyiPilotBudgetInput): void {
  if (![input.articleCount, input.imageCount, input.logicalCreateCount, input.logicalDraftCount, input.logicalValidateCount, input.logicalPublishCount].every((count) => Number.isSafeInteger(count) && count >= 0)) throw new Error("KANGYI_PILOT_BUDGET_INVALID");
  if (input.articleCount !== 1) throw new Error("KANGYI_PILOT_ARTICLE_LIMIT");
  if (input.imageCount < 0 || input.imageCount > 1) throw new Error("KANGYI_PILOT_IMAGE_LIMIT");
  if (input.logicalCreateCount !== 1) throw new Error("KANGYI_PILOT_CREATE_LIMIT");
  if (input.logicalDraftCount < 0 || input.logicalDraftCount > 1) throw new Error("KANGYI_PILOT_DRAFT_LIMIT");
  if (input.logicalValidateCount !== 1) throw new Error("KANGYI_PILOT_VALIDATE_LIMIT");
  if (input.logicalPublishCount !== 1) throw new Error("KANGYI_PILOT_PUBLISH_LIMIT");
}

export function assertKangyiPublishAccepted(httpStatus: number): void {
  if (httpStatus !== 202) throw new Error("KANGYI_PUBLISH_MUST_RETURN_202");
}

export interface KangyiContentIdentity { contentId: string; revisionId: string; rowVersion: number; contentHash: string; }

export function assertKangyiContentIdentity(value: KangyiContentIdentity): void {
  if (!value.contentId.trim() || !value.revisionId.trim() || !value.contentHash.trim() || !Number.isSafeInteger(value.rowVersion) || value.rowVersion < 1) throw new Error("KANGYI_CONTENT_IDENTITY_MISSING");
}

export function assertKangyiValidationIdentity(value: { valid: boolean; revisionId: string; contentHash: string }, expected: { revisionId: string; contentHash: string }): void {
  if (value.valid !== true) throw new Error("KANGYI_VALIDATION_FAILED");
  if (value.revisionId !== expected.revisionId || value.contentHash !== expected.contentHash) throw new Error("KANGYI_VALIDATION_IDENTITY_MISMATCH");
}

export function assertKangyiPublishIdentity(value: { httpStatus: number; jobId: string; contentId: string; revisionId: string; rowVersion: number; contentHash: string }, expected: KangyiContentIdentity): void {
  assertKangyiPublishAccepted(value.httpStatus);
  if (!value.jobId.trim() || value.contentId !== expected.contentId || value.revisionId !== expected.revisionId || value.rowVersion !== expected.rowVersion || value.contentHash !== expected.contentHash) throw new Error("KANGYI_PUBLISH_IDENTITY_MISMATCH");
}

export function assertKangyiJobIdentity(value: { jobId: string }, expectedJobId: string): void {
  if (!value.jobId || value.jobId !== expectedJobId) throw new Error("KANGYI_CMS_JOB_ID_MISMATCH");
}

export function assertKangyiPublicVerification(value: { ok: boolean; contentId: string; publicUrl: string }, expected: { contentId: string; publicUrl: string }): void {
  if (value.ok !== true || value.contentId !== expected.contentId || value.publicUrl !== expected.publicUrl) throw new Error("PUBLIC_READBACK_MISMATCH");
}

export function assertKangyiStopCondition(condition: KangyiStopCondition, alreadyReconciled: boolean): void {
  if (!alreadyReconciled) throw new Error(`KANGYI_STOP_${condition}`);
}
