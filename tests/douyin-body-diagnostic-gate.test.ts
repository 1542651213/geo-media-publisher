import { describe, expect, it } from "vitest";
import { selectDouyinBodyDiagnosticTarget } from "../apps/desktop/src/main/douyin-body-diagnostic-gate";

const accountId = "owner-account";
const jobId = "job-0926b";
const articleId = "article-0926b";
const base = { enabled: true, configuredAccountId: accountId, configuredJobId: jobId, requestedAccountId: accountId,
  job: { id: jobId, accountId, articleId, platformKey: "douyin", contentKind: "article",
    status: "AwaitingConfirmation", attemptCount: 0, selectedImageAssetId: "image-1" },
  article: { id: articleId, title: "测试标题", body: "测试正文" },
  connection: { active: true, creatorId: "72388977613", loginGeneration: 1, browserSessionIdHash: "session-1" },
  payload: { douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" },
    douyinImageSelection: { operationId: "selection-1", stage: "FILE_SELECTION_DISPATCHED",
      accountId, articleId, loginGeneration: 1, sessionIdHash: "session-1",
      imageSha256: "a".repeat(64), sourceContentHash: "b".repeat(64) } },
  intentPresent: false, recordPresent: false };

describe("Main-only Douyin body diagnostic target gate", () => {
  it("is off by default and never reads an ordinary account", () => {
    expect(selectDouyinBodyDiagnosticTarget({ ...base, enabled: false })).toBeNull();
    expect(() => selectDouyinBodyDiagnosticTarget({ ...base, requestedAccountId: "other" }))
      .toThrow("DOUYIN_BODY_DIAGNOSTIC_ACCOUNT_NOT_ARMED");
  });

  it("binds the existing one-selection Job and approved persisted body", () => {
    expect(selectDouyinBodyDiagnosticTarget(base)).toMatchObject({
      binding: { accountId, articleId, jobId, creatorId: "72388977613", operationId: "selection-1",
        sessionIdHash: "session-1", imageSha256: "a".repeat(64) },
      expectedBody: "测试正文", imageAssetId: "image-1", sourceContentHash: "b".repeat(64) });
  });

  it("rejects wrong Job, changed login generation, missing claim and any final boundary", () => {
    expect(() => selectDouyinBodyDiagnosticTarget({ ...base, job: { ...base.job, id: "old-job" } }))
      .toThrow("DOUYIN_BODY_DIAGNOSTIC_JOB_MISMATCH");
    expect(() => selectDouyinBodyDiagnosticTarget({ ...base, connection: { ...base.connection, loginGeneration: 2 } }))
      .toThrow("DOUYIN_BODY_DIAGNOSTIC_LOGIN_GENERATION_MISMATCH");
    expect(() => selectDouyinBodyDiagnosticTarget({ ...base, payload: { douyinImageTextSettings: base.payload.douyinImageTextSettings } }))
      .toThrow("DOUYIN_BODY_DIAGNOSTIC_SELECTION_CLAIM_MISSING");
    expect(() => selectDouyinBodyDiagnosticTarget({ ...base, intentPresent: true }))
      .toThrow("DOUYIN_BODY_DIAGNOSTIC_FINAL_BOUNDARY_PRESENT");
    expect(() => selectDouyinBodyDiagnosticTarget({ ...base, recordPresent: true }))
      .toThrow("DOUYIN_BODY_DIAGNOSTIC_FINAL_BOUNDARY_PRESENT");
  });
});
