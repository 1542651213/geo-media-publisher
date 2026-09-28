export type DouyinBodyDiagnosticTarget = { binding: { accountId: string; articleId: string; jobId: string;
  creatorId: string; loginGeneration: number; sessionIdHash: string; operationId: string; imageSha256: string };
  expectedBody: string; imageAssetId: string; sourceContentHash: string };

/** Selects only the original pre-bound, unsubmitted image-post Job for Main's opt-in read-only diagnosis. */
export function selectDouyinBodyDiagnosticTarget(input: {
  enabled: boolean; configuredAccountId: string | null; configuredJobId: string | null; requestedAccountId: string;
  job: { id: string; accountId: string; articleId: string; platformKey: string; contentKind?: string | null;
    status: string; attemptCount: number; selectedImageAssetId?: string | null } | null;
  article: { id: string; title: string; body: string } | null;
  connection: { active: boolean; creatorId: string; loginGeneration: number; browserSessionIdHash: string } | null;
  payload: Record<string, unknown>; intentPresent: boolean; recordPresent: boolean;
}): DouyinBodyDiagnosticTarget | null {
  if (!input.enabled) return null;
  if (!input.configuredAccountId || !input.configuredJobId
    || input.requestedAccountId !== input.configuredAccountId)
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_ACCOUNT_NOT_ARMED");
  const job = input.job;
  if (!job || job.id !== input.configuredJobId || job.accountId !== input.configuredAccountId
    || job.platformKey !== "douyin" || job.contentKind !== "article"
    || job.status !== "AwaitingConfirmation" || job.attemptCount !== 0 || !job.selectedImageAssetId
    || !input.article || input.article.id !== job.articleId || !input.article.body)
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_JOB_MISMATCH");
  if (input.intentPresent || input.recordPresent)
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_FINAL_BOUNDARY_PRESENT");
  const connection = input.connection;
  if (!connection?.active || !connection.creatorId || !connection.browserSessionIdHash)
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_CREATOR_BINDING_MISSING");
  const settings = input.payload.douyinImageTextSettings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)
    || (settings as Record<string, unknown>).version !== 1
    || (settings as Record<string, unknown>).visibility !== "public"
    || (settings as Record<string, unknown>).timing !== "immediate")
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_SETTINGS_MISMATCH");
  const selection = input.payload.douyinImageSelection;
  if (!selection || typeof selection !== "object" || Array.isArray(selection))
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_SELECTION_CLAIM_MISSING");
  const s = selection as Record<string, unknown>;
  if (s.stage !== "FILE_SELECTION_DISPATCHED" || typeof s.operationId !== "string" || !s.operationId
    || s.accountId !== job.accountId || s.articleId !== job.articleId
    || typeof s.sessionIdHash !== "string" || !s.sessionIdHash
    || typeof s.imageSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(s.imageSha256)
    || typeof s.sourceContentHash !== "string" || !/^[a-f0-9]{64}$/u.test(s.sourceContentHash))
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_SELECTION_CLAIM_MISSING");
  if (s.loginGeneration !== connection.loginGeneration)
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_LOGIN_GENERATION_MISMATCH");
  if (s.sessionIdHash !== connection.browserSessionIdHash)
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_SESSION_BINDING_MISMATCH");
  return { binding: { accountId: job.accountId, articleId: job.articleId, jobId: job.id,
    creatorId: connection.creatorId, loginGeneration: connection.loginGeneration,
    sessionIdHash: s.sessionIdHash, operationId: s.operationId, imageSha256: s.imageSha256 },
    expectedBody: input.article.body, imageAssetId: job.selectedImageAssetId, sourceContentHash: s.sourceContentHash };
}
