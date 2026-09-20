import { describe, expect, it } from "vitest";
import {
  countXhsPublishEditorPages,
  evaluatePreparedEditorRecoveryEvidence,
  validatePreparedEditorRecoveryTrustedState,
  type PreparedEditorRecoveryEvidence,
  type PreparedEditorRecoveryTrustedState
} from "../apps/desktop/src/main/task10s-prepared-editor-recovery";
import { parseDiagnosticAction, XHS_TASK10S_PREPARED_EDITOR_RECOVERY_FLAG } from "../apps/desktop/src/main/diagnostic-trigger";
import { RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY } from "../apps/desktop/src/main/task10s-prepared-editor-recovery";
import { PlatformSelfTestService } from "../apps/desktop/src/main/platform-self-test";

const account = {
  id: "account-xhs",
  platformKey: "xiaohongshu",
  platformAccountId: "account-xhs",
  externalAccountId: "960803317",
  enabled: true,
  archivedAt: null
} as const;

const article = { id: "article-1", title: "可信标题", body: "可信正文" } as const;

function trusted(overrides: Partial<PreparedEditorRecoveryTrustedState> = {}): PreparedEditorRecoveryTrustedState {
  return {
    expectedPlatformKey: "xiaohongshu",
    expectedAccountId: account.id,
    expectedRunId: "run-1",
    expectedCreatorId: "960803317",
    account,
    run: { testRunId: "run-1", platformKey: "xiaohongshu", platformAccountId: account.platformAccountId, publishJobId: "job-1" },
    job: { id: "job-1", accountId: account.id, platformAccountId: account.platformAccountId, platformKey: "xiaohongshu", articleId: article.id },
    preparedRecord: { id: "record-1", jobId: "job-1", accountId: account.id, platformAccountId: account.platformAccountId, platformKey: "xiaohongshu", articleId: article.id, status: "Prepared" },
    article,
    authorization: { state: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId: account.id, operationId: "run-1", mode: "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE", publicationTransactionCount: 0, finalSubmitAttemptCount: 0, finalSubmitRetryCount: 0, finalSubmitActionStarted: false, finalSubmitActionCompleted: false },
    publishJobCountForRun: 1,
    preparedRecordCountForJob: 1,
    identityVerified: true,
    actualCreatorId: "960803317",
    ...overrides
  };
}

function evidence(overrides: Partial<PreparedEditorRecoveryEvidence> = {}): PreparedEditorRecoveryEvidence {
  return {
    editorRecreated: true,
    recoveryUsesJobBoundImageAsset: true,
    fixtureVerified: true,
    uploadAttempts: 1,
    uploadMutationCount: 1,
    uploadRetryCount: 0,
    setInputFilesCount: 1,
    postUploadState: "EDITOR_READY",
    imageAssetRenderedCount: 1,
    imageCounterValid: true,
    imageCounterText: "1/18",
    titleControlPresent: true,
    bodyControlPresent: true,
    uploadErrorSignalPresent: false,
    busySignalPresent: false,
    trustedArticleTitle: article.title,
    trustedArticleBody: article.body,
    titleReadback: article.title,
    bodyReadback: article.body,
    closedShadowFinalSubmitSurface: "PASS",
    finalSubmitClickCount: 0,
    mousePressedCount: 0,
    mouseReleasedCount: 0,
    publicationTransactionCount: 0,
    runPublishJobIdUnchanged: true,
    publishJobCountForRun: 1,
    preparedRecordCountForJob: 1,
    authorizationState: "AUTHORIZED_UNUSED",
    newJobCount: 0,
    newRecordCount: 0,
    newAuthorizationCount: 0,
    articleMutationCount: 0,
    ...overrides
  };
}

describe("Task10S Prepared Job editor recovery contract", () => {
  it("exposes a fixed Main recovery action", () => {
    expect(parseDiagnosticAction(["electron", XHS_TASK10S_PREPARED_EDITOR_RECOVERY_FLAG])).toBe(RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY);
    expect(typeof (PlatformSelfTestService.prototype as unknown as { recoverTask10sPreparedEditor?: unknown }).recoverTask10sPreparedEditor).toBe("function");
  });
  it("accepts the complete trusted state", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted())).toMatchObject({ status: "PASS" });
  });

  it("fails closed when run.publishJobId is missing", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ run: { ...trusted().run!, publishJobId: null } }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_RUN_PUBLISH_JOB_MISSING" });
  });

  it("fails closed when the Job is missing", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ job: null }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_JOB_MISSING" });
  });

  it("fails closed when the Prepared PublishRecord is missing", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ preparedRecord: null }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_PREPARED_RECORD_MISSING" });
  });

  it("fails closed when PublishRecord is not Prepared", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ preparedRecord: { ...trusted().preparedRecord!, status: "Failed" } }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_RECORD_NOT_PREPARED" });
  });

  it("fails closed when the bound Article is missing", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ article: null }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_ARTICLE_MISSING" });
  });

  it("fails closed when authorization is not unused", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ authorization: { ...trusted().authorization!, state: "CONSUMED" } }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_AUTHORIZATION_NOT_UNUSED" });
  });

  it("fails closed on account or creator identity mismatch", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ expectedAccountId: "other-account" }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_ACCOUNT_BINDING_MISMATCH" });
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ actualCreatorId: "other-creator" }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_IDENTITY_MISMATCH" });
  });

  it("fails closed when Job or Prepared Record counts are not unique", () => {
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ publishJobCountForRun: 2 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_JOB_COUNT_MISMATCH" });
    expect(validatePreparedEditorRecoveryTrustedState(trusted({ preparedRecordCountForJob: 2 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_RECORD_COUNT_MISMATCH" });
  });

  it("counts an existing live XHS publish editor", () => {
    expect(countXhsPublishEditorPages({ pages: [{ urlOrigin: "https://creator.xiaohongshu.com", pathname: "/publish/publish", isClosed: false }] })).toBe(1);
    expect(countXhsPublishEditorPages({ pages: [{ urlOrigin: "https://creator.xiaohongshu.com", pathname: "/new/home", isClosed: false }] })).toBe(0);
  });

  it("accepts the complete recovery browser evidence", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence())).toMatchObject({ status: "PASS" });
  });

  it("requires recovery to use the Prepared Job ImageAsset binding", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ recoveryUsesJobBoundImageAsset: false }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_JOB_MEDIA_NOT_BOUND" });
  });

  it("rejects an invalid fixture before upload can be accepted", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ fixtureVerified: false }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_FIXTURE_INVALID" });
  });

  it("requires exactly one upload and no retry", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ uploadAttempts: 2 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_UPLOAD_COUNT_INVALID" });
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ uploadRetryCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_UPLOAD_RETRY_OBSERVED" });
  });

  it("does not accept fill evidence before terminal editor readiness", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ postUploadState: "PROCESSING" }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_EDITOR_NOT_READY" });
  });

  it("requires exact Article title and body readback", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ titleReadback: "wrong" }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_TITLE_READBACK_MISMATCH" });
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ bodyReadback: "wrong" }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_BODY_READBACK_MISMATCH" });
  });

  it("requires a passing closed-shadow preflight", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ closedShadowFinalSubmitSurface: "FAIL" }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_CLOSED_SHADOW_NOT_READY" });
  });

  it("accepts a reconstructed Page without historical Page identity", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ historicalPageId: "old-page", currentPageId: "new-page" }))).toMatchObject({ status: "PASS" });
  });

  it("preserves one Job and one Prepared Record", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ publishJobCountForRun: 2 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_JOB_COUNT_CHANGED" });
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ preparedRecordCountForJob: 2 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_RECORD_COUNT_CHANGED" });
  });

  it("keeps authorization unused and never creates a second authorization", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ authorizationState: "CONSUMED" }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_AUTHORIZATION_CHANGED" });
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ newAuthorizationCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_NEW_AUTHORIZATION_OBSERVED" });
  });

  it("keeps run linkage and Article immutable", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ runPublishJobIdUnchanged: false }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_RUN_LINK_CHANGED" });
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ articleMutationCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_ARTICLE_MUTATED" });
  });

  it("keeps all final-submit and publication counters at zero", () => {
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ finalSubmitClickCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_FINAL_SUBMIT_OBSERVED" });
    expect(evaluatePreparedEditorRecoveryEvidence(evidence({ publicationTransactionCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "RECOVERY_PUBLICATION_TRANSACTION_OBSERVED" });
  });
});
