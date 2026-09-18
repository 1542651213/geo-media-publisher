export const XHS_TASK10S_PREPARED_EDITOR_RECOVERY_FLAG = "--xhs-task10s-recover-prepared-editor" as const;
/** Explicit live route; the legacy flag remains diagnostics-only. */
export const XHS_TASK10S_PREPARED_EDITOR_RECOVERY_RUN_FLAG = "--xhs-task10s-recover-prepared-editor-run" as const;
export const RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY = "RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY" as const;

export interface Task10sPreparedEditorRecoveryResult {
  action: typeof RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY;
  status: "PASS" | "BLOCKED";
  failureCode: string | null;
  testRunId: string;
  accountId?: string | null;
  jobId?: string | null;
  publishRecordId?: string | null;
  articleId?: string | null;
  jobStatus?: string | null;
  operationId?: string | null;
  readyForFreshIdentityAttestation: boolean;
  evidence?: PreparedEditorRecoveryEvidence | null;
  exploration?: Record<string, unknown> | null;
  finalSubmitClickCount: 0;
  mousePressedCount: 0;
  mouseReleasedCount: 0;
  publicationTransactionCount: 0;
}

export interface PreparedEditorRecoveryTrustedState {
  expectedPlatformKey: "xiaohongshu";
  expectedAccountId: string;
  expectedPlatformAccountId?: string;
  expectedRunId: string;
  expectedCreatorId: string;
  account: {
    id: string;
    platformKey: string;
    platformAccountId?: string | null;
    externalAccountId?: string | null;
    enabled: boolean;
    archivedAt?: string | null;
  } | null;
  run: {
    testRunId: string;
    platformKey: string;
    platformAccountId: string;
    publishJobId: string | null;
  } | null;
  job: {
    id: string;
    accountId: string;
    platformAccountId: string;
    platformKey: string;
    articleId: string;
  } | null;
  preparedRecord: {
    id: string;
    jobId: string;
    accountId: string;
    platformAccountId: string;
    platformKey: string;
    articleId: string;
    status?: string;
  } | null;
  article: { id: string; title: string; body: string } | null;
  authorization: {
    state: string;
    platformKey: string;
    accountId: string;
    operationId: string;
    mode: string;
    publicationTransactionCount: number;
    finalSubmitAttemptCount: number;
    finalSubmitRetryCount: number;
    finalSubmitActionStarted: boolean;
    finalSubmitActionCompleted: boolean;
  } | null;
  publishJobCountForRun: number;
  preparedRecordCountForJob: number;
  identityVerified: boolean;
  actualCreatorId: string | null;
}

export interface PreparedEditorRecoveryValidationResult {
  status: "PASS" | "BLOCKED";
  failureCode: string | null;
}

export interface PreparedEditorRecoveryEvidence {
  editorRecreated: boolean;
  recoveryUsesJobBoundImageAsset: boolean;
  fixtureVerified: boolean;
  uploadAttempts: number;
  uploadMutationCount: number;
  uploadRetryCount: number;
  setInputFilesCount: number;
  postUploadState: "EDITOR_READY" | "PROCESSING" | "REJECTED" | "AMBIGUOUS";
  imageAssetRenderedCount: number;
  imageCounterValid: boolean;
  imageCounterText: string | null;
  titleControlPresent: boolean;
  bodyControlPresent: boolean;
  uploadErrorSignalPresent: boolean;
  busySignalPresent: boolean;
  trustedArticleTitle: string;
  trustedArticleBody: string;
  titleReadback: string | null;
  bodyReadback: string | null;
  closedShadowFinalSubmitSurface: "PASS" | "FAIL";
  finalSubmitClickCount: number;
  mousePressedCount: number;
  mouseReleasedCount: number;
  publicationTransactionCount: number;
  runPublishJobIdUnchanged: boolean;
  publishJobCountForRun: number;
  preparedRecordCountForJob: number;
  authorizationState: string;
  newJobCount: number;
  newRecordCount: number;
  newAuthorizationCount: number;
  articleMutationCount: number;
  historicalPageId?: string | null;
  currentPageId?: string | null;
}

function blocked(failureCode: string): PreparedEditorRecoveryValidationResult {
  return { status: "BLOCKED", failureCode };
}

export function validatePreparedEditorRecoveryTrustedState(input: PreparedEditorRecoveryTrustedState): PreparedEditorRecoveryValidationResult {
  const expectedPlatformAccountId = input.expectedPlatformAccountId ?? input.expectedAccountId;
  const account = input.account;
  if (!account || !account.enabled || account.archivedAt) return blocked("RECOVERY_ACCOUNT_UNAVAILABLE");
  if (account.id !== input.expectedAccountId || account.platformKey !== input.expectedPlatformKey || account.platformAccountId !== expectedPlatformAccountId) return blocked("RECOVERY_ACCOUNT_BINDING_MISMATCH");
  if (account.externalAccountId !== input.expectedCreatorId) return blocked("RECOVERY_IDENTITY_MISMATCH");
  if (!input.identityVerified || input.actualCreatorId !== input.expectedCreatorId) return blocked("RECOVERY_IDENTITY_MISMATCH");

  const run = input.run;
  if (!run || run.testRunId !== input.expectedRunId || run.platformKey !== input.expectedPlatformKey || run.platformAccountId !== expectedPlatformAccountId) return blocked("RECOVERY_RUN_BINDING_MISMATCH");
  if (!run.publishJobId) return blocked("RECOVERY_RUN_PUBLISH_JOB_MISSING");
  if (input.publishJobCountForRun !== 1) return blocked("RECOVERY_JOB_COUNT_MISMATCH");

  const job = input.job;
  if (!job) return blocked("RECOVERY_JOB_MISSING");
  if (job.id !== run.publishJobId) return blocked("RECOVERY_JOB_BINDING_MISMATCH");
  if (job.accountId !== account.id || job.platformAccountId !== expectedPlatformAccountId || job.platformKey !== input.expectedPlatformKey) return blocked("RECOVERY_JOB_BINDING_MISMATCH");

  const record = input.preparedRecord;
  if (!record) return blocked("RECOVERY_PREPARED_RECORD_MISSING");
  if (record.status !== "Prepared") return blocked("RECOVERY_RECORD_NOT_PREPARED");
  if (input.preparedRecordCountForJob !== 1) return blocked("RECOVERY_RECORD_COUNT_MISMATCH");
  if (record.jobId !== job.id || record.accountId !== account.id || record.platformAccountId !== expectedPlatformAccountId || record.platformKey !== input.expectedPlatformKey || record.articleId !== job.articleId) return blocked("RECOVERY_RECORD_BINDING_MISMATCH");

  const article = input.article;
  if (!article || !article.id || !article.title.trim() || !article.body.trim()) return blocked("RECOVERY_ARTICLE_MISSING");
  if (article.id !== job.articleId) return blocked("RECOVERY_ARTICLE_BINDING_MISMATCH");

  const authorization = input.authorization;
  if (!authorization
    || authorization.state !== "AUTHORIZED_UNUSED"
    || authorization.platformKey !== input.expectedPlatformKey
    || authorization.accountId !== account.id
    || authorization.operationId !== run.testRunId
    || authorization.mode !== "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE"
    || authorization.publicationTransactionCount !== 0
    || authorization.finalSubmitAttemptCount !== 0
    || authorization.finalSubmitRetryCount !== 0
    || authorization.finalSubmitActionStarted
    || authorization.finalSubmitActionCompleted) return blocked("RECOVERY_AUTHORIZATION_NOT_UNUSED");
  return { status: "PASS", failureCode: null };
}

export function countXhsPublishEditorPages(input: { pages: ReadonlyArray<{ urlOrigin: string | null; pathname: string | null; isClosed: boolean }> }): number {
  return input.pages.filter((page) => !page.isClosed && page.urlOrigin === "https://creator.xiaohongshu.com" && page.pathname === "/publish/publish").length;
}

export function evaluatePreparedEditorRecoveryEvidence(input: PreparedEditorRecoveryEvidence): PreparedEditorRecoveryValidationResult {
  if (!input.editorRecreated) return blocked("RECOVERY_EDITOR_NOT_RECREATED");
  if (!input.recoveryUsesJobBoundImageAsset) return blocked("RECOVERY_JOB_MEDIA_NOT_BOUND");
  if (!input.fixtureVerified) return blocked("RECOVERY_FIXTURE_INVALID");
  if (input.uploadAttempts !== 1 || input.uploadMutationCount !== 1 || input.setInputFilesCount !== 1) return blocked("RECOVERY_UPLOAD_COUNT_INVALID");
  if (input.uploadRetryCount !== 0) return blocked("RECOVERY_UPLOAD_RETRY_OBSERVED");
  if (input.postUploadState !== "EDITOR_READY") return blocked("RECOVERY_EDITOR_NOT_READY");
  if (input.imageAssetRenderedCount < 1 || !input.imageCounterValid || input.imageCounterText !== "1/18") return blocked("RECOVERY_IMAGE_NOT_READY");
  if (!input.titleControlPresent || !input.bodyControlPresent) return blocked("RECOVERY_CONTENT_CONTROLS_MISSING");
  if (input.uploadErrorSignalPresent || input.busySignalPresent) return blocked("RECOVERY_UPLOAD_NOT_TERMINAL");
  if (input.titleReadback !== input.trustedArticleTitle) return blocked("RECOVERY_TITLE_READBACK_MISMATCH");
  if (input.bodyReadback !== input.trustedArticleBody) return blocked("RECOVERY_BODY_READBACK_MISMATCH");
  if (input.closedShadowFinalSubmitSurface !== "PASS") return blocked("RECOVERY_CLOSED_SHADOW_NOT_READY");
  if (!input.runPublishJobIdUnchanged) return blocked("RECOVERY_RUN_LINK_CHANGED");
  if (input.publishJobCountForRun !== 1) return blocked("RECOVERY_JOB_COUNT_CHANGED");
  if (input.preparedRecordCountForJob !== 1) return blocked("RECOVERY_RECORD_COUNT_CHANGED");
  if (input.authorizationState !== "AUTHORIZED_UNUSED") return blocked("RECOVERY_AUTHORIZATION_CHANGED");
  if (input.newJobCount !== 0 || input.newRecordCount !== 0) return blocked("RECOVERY_NEW_PERSISTED_ROW_OBSERVED");
  if (input.newAuthorizationCount !== 0) return blocked("RECOVERY_NEW_AUTHORIZATION_OBSERVED");
  if (input.articleMutationCount !== 0) return blocked("RECOVERY_ARTICLE_MUTATED");
  if (input.finalSubmitClickCount !== 0 || input.mousePressedCount !== 0 || input.mouseReleasedCount !== 0) return blocked("RECOVERY_FINAL_SUBMIT_OBSERVED");
  if (input.publicationTransactionCount !== 0) return blocked("RECOVERY_PUBLICATION_TRANSACTION_OBSERVED");
  return { status: "PASS", failureCode: null };
}
