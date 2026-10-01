import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type BrowserPublishAttemptContext, type BrowserPublishReconciliationResult, type PlatformAdapter } from "@publisher/adapters-core";
import type { AccountContext, AdapterManifest, PlatformCapabilities, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import { openDatabase } from "@publisher/db";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "@publisher/publisher";

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
const creatorId = "123456789";
type RemoteState = "PUBLISHED" | "REVIEWING" | "REJECTED" | "DRAFT" | "SCHEDULED" | "NOT_FOUND" | "UNKNOWN" | "AMBIGUOUS";

class Fixture implements PlatformAdapter {
  readonly platformKey = "toutiao";
  readonly automationType = "BrowserAutomation" as const;
  readonly manifest: AdapterManifest = { platformKey: "toutiao", displayName: "Toutiao fixture", category: "article", version: "fixture", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "WaitingForUser", researchStatus: "partial", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://mp.toutiao.com/", credentialSchema: [], officialSources: ["https://mp.toutiao.com/"] };
  remoteState: RemoteState = "REVIEWING";
  accepted = true;
  verified = true;
  matched = true;
  readonly publishArticle = vi.fn(async (): Promise<PublishResult> => { throw new Error("Legacy transport must never run"); });
  readonly checkLogin = vi.fn(async () => "logged_in" as const);
  readonly preparePublish = vi.fn(async (_ctx: AccountContext, _input: PublishArticleInput) => ({ prepared: true, requiresUserAction: true, message: "prepared", response: { titleReadback: true, bodyReadback: true, imageUploaded: true } }));
  readonly releaseOperationSession = vi.fn(async (_ctx: AccountContext) => undefined);
  readonly finalSubmit = vi.fn(async (_ctx: AccountContext, _input: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> => {
    attempt.markSubmissionSideEffect?.();
    if (!this.accepted) throw Object.assign(new Error("Uncertain browser result"), { code: "SUBMISSION_UNCERTAIN" });
    return { success: true, status: "publishing", response: { submissionAccepted: true, remoteState: "REVIEWING" } };
  });
  readonly reconcile = vi.fn(async (): Promise<BrowserPublishReconciliationResult> => ({ status: this.remoteState === "PUBLISHED" ? "FOUND_PUBLISHED" : "STILL_UNCERTAIN", remoteState: this.remoteState,
    ...(this.remoteState === "PUBLISHED" ? { externalId: "9001", publishedUrl: "https://www.toutiao.com/article/9001/" } : {}),
    titleMatch: this.matched, accountMatch: this.matched, timeWindowMatch: this.matched, response: { readOnly: true, matchedTargetRow: this.matched, matchedRowCount: this.matched ? 1 : 0 }, message: "sanitized target row state" }));
  readonly verifyPublished = vi.fn(async (_ctx: AccountContext, _input: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> => ({ status: this.verified ? "published" : "failed", ...result, response: { urlReachable: this.verified, titleMatch: this.verified, bodyMatch: this.verified } }));
  getCapabilities(): PlatformCapabilities { return { ...defaultCapabilities, contentTransport: "ARTICLE_BROWSER", browserManagementReconciliation: true }; }
  getCredentialSchema() { return []; }
  async beginLogin() { return { sessionId: "fixture", requiresUserAction: false }; }
  async connectAccount() { return this.beginLogin(); }
  async checkSession() { return "logged_in" as const; }
  async validateArticle() { return { valid: true, errors: [], warnings: [] }; }
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "toutiao-production-publisher-")); roots.push(directory);
  const opened = openDatabase(join(directory, "fixture.db"), join(process.cwd(), "packages/db/migrations")); databases.push(opened.db);
  const repo = opened.repository; repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv")); repo.setSetting("contentReviewMode", "Off");
  const brand = repo.createBrand({ name: "Fixture", companyName: "Fixture" });
  const created = repo.createAccount({ platformKey: "toutiao", name: "Fixture Owner" });
  const account = repo.syncBrowserPlatformAccount({ accountId: created.id, platformKey: "toutiao", browserSessionId: "fixture-session", externalAccountId: creatorId });
  const article = repo.createArticle({ brandId: brand.id, title: "唯一测试文章", body: "无敏感信息的离线测试正文。", summary: "", tags: [], seoKeywords: [], topic: "fixture", keyword: "fixture", city: "", articleType: "科普", aiProvider: "system", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: randomUUID(), qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("Fixture article unavailable");
  const job = repo.createArticlePublishJob({ articleId: article.id, platformKey: "toutiao", platformAccountId: account.id });
  const adapter = new Fixture(); const registry = new AdapterRegistry(); registry.register(adapter);
  const publisher = new PublisherService(repo, registry, createConsoleLogger());
  return { ...opened, repo, account, article, job, adapter, publisher, registry };
}

async function prepared() {
  const scope = setup();
  await scope.publisher.prepareArticle(scope.job.id);
  scope.repo.confirmJob(scope.job.id, false);
  return scope;
}

afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Toutiao BrowserNative production publisher", () => {
  it("uses the explicitly selected same-brand image through preparation and final submission when an Article also has an older cover", async () => {
    const scope = setup();
    const otherBrand = scope.repo.createBrand({ name: "other", companyName: "other" });
    const legacy = scope.repo.createMediaAsset({ brandId: otherBrand.id, type: "legacy_cover", title: "older cover", filePath: "older-cover.png" });
    scope.db.prepare("UPDATE articles SET cover_asset_id=? WHERE id=?").run(legacy, scope.article.id);
    const image = scope.repo.createImageAsset({ brandId: scope.article.brandId, name: "selected", filePath: "selected-cover.png", originalFileName: "selected-cover.png", mimeType: "image/png", size: 100 });
    scope.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=?,image_selection_mode='manual' WHERE id=?").run(image.id, scope.job.id);
    await scope.publisher.prepareArticle(scope.job.id);
    const preparedInput = scope.adapter.preparePublish.mock.calls[0]?.[1] as PublishArticleInput | undefined;
    expect(preparedInput).toMatchObject({ images: [image.filePath] });
    expect(preparedInput?.coverPath).toBeUndefined();
    scope.repo.confirmJob(scope.job.id, false);
    await scope.publisher.executeJob(scope.job.id);
    const finalInput = scope.adapter.finalSubmit.mock.calls[0]?.[1];
    expect(finalInput).toMatchObject({ images: [image.filePath] });
    expect(finalInput?.coverPath).toBeUndefined();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
  });
  it("rechecks temporary authorization after asynchronous preflight and before the durable final claim", async () => {
    const scope = setup();
    await scope.publisher.prepareArticle(scope.job.id); scope.repo.confirmJob(scope.job.id, false);
    const publisher = new PublisherService(scope.repo, scope.registry, createConsoleLogger(), {
      assertFinalAuthorization: () => { throw Object.assign(new Error("Temporary authorization expired"), { code: "USER_ACTION_REQUIRED" }); }
    });
    await publisher.executeJob(scope.job.id);
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount ?? 0).toBe(0);
    expect(scope.repo.getJob(scope.job.id)?.status).toBe("NeedsUserAction");
  });
  it("retains the visible prepared session even when background automation previously passed", async () => {
    const scope = setup();
    scope.repo.setSetting("browserPublishMode", "background");
    scope.repo.updatePlatformBackgroundAutomation("toutiao", "PASSED");
    await scope.publisher.prepareArticle(scope.job.id, undefined, "BACKGROUND");
    expect(scope.adapter.preparePublish).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ browserExecutionMode: "VISIBLE" }) }), expect.anything());
    expect(scope.adapter.releaseOperationSession).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ browserExecutionMode: "VISIBLE" }) }));
    scope.repo.confirmJob(scope.job.id, false);
    await scope.publisher.executeJob(scope.job.id, undefined, "BACKGROUND");
    expect(scope.adapter.finalSubmit).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ browserExecutionMode: "VISIBLE" }) }), expect.anything(), expect.anything());
  });

  it("freezes prepared transport, content and expected identity before a durable single final submit", async () => {
    const scope = await prepared();
    const expectedHash = createHash("sha256").update(JSON.stringify({ articleId: scope.article.id, title: scope.article.title, body: scope.article.body, summary: "", tags: [] })).digest("hex");
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.response).toMatchObject({ contentTransport: "ARTICLE_BROWSER", preparedInputHash: expectedHash, expectedCreatorId: creatorId });
    const result = await scope.publisher.executeJob(scope.job.id);
    expect(result.job.status).toBe("Publishing");
    expect(scope.adapter.finalSubmit).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ expectedCreatorId: creatorId }) }), expect.anything(), expect.anything());
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "SUBMIT_ACCEPTED" });
    expect(scope.repo.getPublishRecordByJob(scope.job.id)).toMatchObject({ status: "Publishing", success: false });
    await scope.publisher.executeJob(scope.job.id);
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
    expect(scope.adapter.publishArticle).not.toHaveBeenCalled();
  });

  it("rejects missing stable account identity before opening the editor", async () => {
    const scope = setup(); scope.db.prepare("UPDATE accounts SET external_account_id=NULL WHERE id=?").run(scope.account.id);
    await expect(scope.publisher.prepareArticle(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(scope.adapter.preparePublish).not.toHaveBeenCalled();
  });

  it("refuses a changed prepared article before creating the final boundary", async () => {
    const scope = await prepared(); scope.repo.updateArticle(scope.article.id, { title: "不同内容" });
    await scope.publisher.executeJob(scope.job.id);
    expect(scope.adapter.finalSubmit).not.toHaveBeenCalled();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount ?? 0).toBe(0);
  });

  it("refuses account identity replacement after preparation", async () => {
    const scope = await prepared(); scope.db.prepare("UPDATE accounts SET external_account_id='other' WHERE id=?").run(scope.account.id);
    await scope.publisher.executeJob(scope.job.id);
    expect(scope.adapter.finalSubmit).not.toHaveBeenCalled();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount ?? 0).toBe(0);
  });

  it("requires a prepared record and never falls back to publishArticle", async () => {
    const scope = setup(); scope.repo.confirmJob(scope.job.id, false);
    const result = await scope.publisher.executeJob(scope.job.id);
    expect(result.job.status).toBe("NeedsUserAction");
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toBeNull();
    expect(scope.adapter.finalSubmit).not.toHaveBeenCalled();
    expect(scope.adapter.publishArticle).not.toHaveBeenCalled();
  });

  it("allows explicit preparation recovery with the same frozen Job and Record before the boundary", async () => {
    const scope = await prepared(); const record = scope.repo.getPublishRecordByJob(scope.job.id)!;
    scope.repo.updateJobFailure(scope.job.id, "NeedsUserAction", "USER_ACTION_REQUIRED", "Browser runtime restarted", null);
    const restored = await scope.publisher.prepareArticle(scope.job.id);
    expect(restored.job.status).toBe("AwaitingConfirmation");
    expect(scope.adapter.preparePublish).toHaveBeenCalledTimes(2);
    expect(restored.record?.id).toBe(record.id);
    expect(scope.repo.getPublishRecords(scope.article.id)).toHaveLength(1);
    expect(restored.record?.response.preparedInputHash).toBe(record.response.preparedInputHash);
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toBeNull();
    scope.repo.confirmJob(scope.job.id, false);
    expect((await scope.publisher.executeJob(scope.job.id)).job.status).toBe("Publishing");
  });

  it("cannot recover preparation by silently replacing frozen content", async () => {
    const scope = await prepared(); scope.repo.updateJobFailure(scope.job.id, "NeedsUserAction", "USER_ACTION_REQUIRED", "Browser restarted", null);
    scope.repo.updateArticle(scope.article.id, { body: "Changed content" });
    await expect(scope.publisher.prepareArticle(scope.job.id)).rejects.toMatchObject({ code: "CONTENT_REJECTED" });
    expect(scope.adapter.preparePublish).toHaveBeenCalledTimes(1);
  });
  it("cannot restore a confirmed action after the durable final boundary", async () => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id);
    const record = scope.repo.getPublishRecordByJob(scope.job.id)!;
    scope.repo.updateJobFailure(scope.job.id, "NeedsUserAction", "USER_ACTION_REQUIRED", "stale caller", null);
    expect(() => scope.repo.restoreToutiaoPreparedJob(scope.job.id, record.id)).toThrow();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
    expect(scope.adapter.finalSubmit).toHaveBeenCalledOnce();
  });

  it("never reopens or refills an editor after a claimed final boundary", async () => {
    const scope = await prepared(); scope.adapter.accepted = false; await scope.publisher.executeJob(scope.job.id);
    await expect(scope.publisher.prepareArticle(scope.job.id)).rejects.toMatchObject({ code: "FINAL_SUBMIT_ALREADY_USED" });
    expect(scope.adapter.preparePublish).toHaveBeenCalledTimes(1);
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
  });

  it("retains the frozen browser transport and content binding after accepted submission", async () => {
    const scope = await prepared(); const preparedEvidence = scope.repo.getPublishRecordByJob(scope.job.id)!.response;
    await scope.publisher.executeJob(scope.job.id);
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.response).toMatchObject({ contentTransport: "ARTICLE_BROWSER",
      preparedInputHash: preparedEvidence.preparedInputHash, expectedCreatorId: creatorId });
    expect(scope.repo.getFrozenContentTransport(scope.job.id)).toBe("ARTICLE_BROWSER");
  });

  it("does not allow the prepared browser transport to change to an API adapter", async () => {
    const scope = await prepared();
    vi.spyOn(scope.adapter, "getCapabilities").mockReturnValue({ ...defaultCapabilities, contentTransport: "ARTICLE_WEB_API", browserManagementReconciliation: false });
    const result = await scope.publisher.executeJob(scope.job.id);
    expect(result.job.lastErrorCode).toBe("TRANSPORT_FALLBACK_FORBIDDEN");
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toBeNull();
    expect(scope.adapter.finalSubmit).not.toHaveBeenCalled();
    expect(scope.adapter.publishArticle).not.toHaveBeenCalled();
  });

  it("does not reopen an API-bound Job in the native editor", async () => {
    const scope = setup(); vi.spyOn(scope.repo, "getFrozenContentTransport").mockReturnValue("ARTICLE_WEB_API");
    await expect(scope.publisher.prepareArticle(scope.job.id)).rejects.toMatchObject({ code: "TRANSPORT_FALLBACK_FORBIDDEN" });
    expect(scope.adapter.preparePublish).not.toHaveBeenCalled();
  });

  it("keeps an old uncertain Job locked while allowing a separate new authorized article through the idle global slot", async () => {
    const scope = await prepared(); scope.adapter.accepted = false;
    expect((await scope.publisher.executeJob(scope.job.id)).job.status).toBe("NeedsReconciliation");
    const nextArticle = scope.repo.createArticle({ ...scope.article, title: "另一篇明确授权的离线测试", contentHash: randomUUID() });
    if (!nextArticle) throw new Error("New fixture article failed");
    const nextJob = scope.repo.createArticlePublishJob({ articleId: nextArticle.id, platformKey: "toutiao", platformAccountId: scope.account.id });
    scope.adapter.accepted = true;
    await scope.publisher.prepareArticle(nextJob.id); scope.repo.confirmJob(nextJob.id, false);
    expect((await scope.publisher.executeJob(nextJob.id)).job.status).toBe("Publishing");
    await scope.publisher.executeJob(scope.job.id);
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "UNCERTAIN" });
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(2);
  });

  it.each(["REVIEWING", "SCHEDULED"] as const)("reconciles %s without public URL or another submit", async (remoteState) => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id); scope.adapter.remoteState = remoteState;
    const result = await scope.publisher.pollPublishingJob(scope.job.id);
    expect(["Submitted", "Publishing"]).toContain(result.job.status);
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: remoteState === "SCHEDULED" ? "SCHEDULED_ACCEPTED" : "SUBMIT_ACCEPTED" });
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
    expect(scope.adapter.reconcile).toHaveBeenCalledTimes(1);
  });

  it("uses the durable submit time for a bounded title-match window", async () => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id);
    const boundary = Date.parse(scope.repo.getSubmissionIntentByJob(scope.job.id)!.submitBoundaryEnteredAt!);
    await scope.publisher.pollPublishingJob(scope.job.id);
    expect(scope.adapter.reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      submittedAt: new Date(boundary).toISOString(), windowStart: new Date(boundary - 15 * 60_000).toISOString(), windowEnd: new Date(boundary + 15 * 60_000).toISOString()
    }));
  });

  it("prioritizes a trusted remote ID over a missing row title/time while requiring the owned account", async () => {
    const scope = await prepared();
    scope.adapter.finalSubmit.mockImplementation(async (_ctx, _input, attempt) => { attempt.markSubmissionSideEffect?.(); return { success: true, status: "publishing", externalId: "9001", response: { submissionAccepted: true } }; });
    await scope.publisher.executeJob(scope.job.id);
    scope.adapter.reconcile.mockResolvedValue({ status: "STILL_UNCERTAIN", remoteState: "REVIEWING", externalId: "9001", titleMatch: false, accountMatch: true, timeWindowMatch: false, response: { matchedBy: "REMOTE_ID", readOnly: true }, message: "trusted id" });
    expect((await scope.publisher.pollPublishingJob(scope.job.id)).job.status).toBe("Submitted");
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
    scope.adapter.reconcile.mockResolvedValue({ status: "STILL_UNCERTAIN", remoteState: "REVIEWING", externalId: "different", titleMatch: false, accountMatch: true, timeWindowMatch: false, response: { matchedBy: "REMOTE_ID", readOnly: true }, message: "wrong id" });
    expect((await scope.publisher.pollPublishingJob(scope.job.id)).job.status).toBe("NeedsReconciliation");
  });

  it.each(["NOT_FOUND", "DRAFT", "UNKNOWN", "AMBIGUOUS"] as const)("keeps %s uncertain without reopening submission", async (remoteState) => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id); scope.adapter.remoteState = remoteState;
    const result = await scope.publisher.pollPublishingJob(scope.job.id);
    expect(result.job.status).toBe("NeedsReconciliation");
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "UNCERTAIN" });
    await scope.publisher.executeJob(scope.job.id); expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
  });

  it("confirms unique management publication even when the public page cannot be read", async () => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id); scope.adapter.remoteState = "PUBLISHED";
    scope.adapter.verified = false;
    expect((await scope.publisher.pollPublishingJob(scope.job.id)).job.status).toBe("Success");
    expect(scope.repo.getPublishRecordByJob(scope.job.id)).toMatchObject({ success: true, status: "Published", publishedExternalId: "9001", response: { publicContentVerified: "LIMITED" } });
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.remoteStatus).toBe("PUBLISHED_CONFIRMED");
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps unique management Published success independent from failed content fidelity, with sanitized evidence", async () => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id); scope.adapter.remoteState = "PUBLISHED";
    scope.adapter.verifyPublished.mockResolvedValue({ status: "publishing", externalId: "9001", publishedUrl: "https://www.toutiao.com/article/9001/",
      response: { verified: false, urlReachable: true, titleMatch: true, bodyMatch: false, verificationStatus: "reconciliation_uncertain",
        cookie: "fixture-private-cookie", token: "fixture-private-token", diagnosticText: "unreviewed arbitrary content" },
      errorCode: "RECONCILIATION_UNCERTAIN" });
    expect((await scope.publisher.pollPublishingJob(scope.job.id)).job.status).toBe("Success");
    const record = scope.repo.getPublishRecordByJob(scope.job.id)!;
    expect(record).toMatchObject({ status: "Published", success: true,
      publishedExternalId: "9001", publishedUrl: "https://www.toutiao.com/article/9001/" });
    expect(record.response).toMatchObject({ managementState: "PUBLISHED", publicContentVerified: "FAIL",
      verification: { status: "publishing", verified: false, urlReachable: true, titleMatch: true, bodyMatch: false,
        errorCode: "RECONCILIATION_UNCERTAIN" } });
    expect(JSON.stringify(record.response)).not.toContain("fixture-private");
    expect(JSON.stringify(record.response)).not.toContain("unreviewed arbitrary content");
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "PUBLISHED_CONFIRMED" });
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
  });

  it("confirms a unique trusted-ID management match and records fidelity mismatch without another submit", async () => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id); scope.adapter.remoteState = "PUBLISHED";
    const record = scope.repo.getPublishRecordByJob(scope.job.id)!;
    scope.repo.updatePublishRecord(record.id, { status: "Publishing", success: false, response: record.response,
      publishedExternalId: "9001", publishedUrl: "https://www.toutiao.com/article/9001/" });
    scope.adapter.reconcile.mockResolvedValue({ status: "FOUND_PUBLISHED", remoteState: "PUBLISHED", externalId: "9001",
      publishedUrl: "https://www.toutiao.com/article/9001/", titleMatch: false, accountMatch: true, timeWindowMatch: false,
      response: { matchedBy: "REMOTE_ID", readOnly: true, matchedRowCount: 1 }, message: "trusted observed id" });
    scope.adapter.verifyPublished.mockResolvedValue({ status: "published", externalId: "9001", publishedUrl: "https://www.toutiao.com/article/9001/",
      response: { urlReachable: true, titleMatch: true, bodyMatch: false } });
    expect((await scope.publisher.reconcileBrowserJob(scope.job.id)).job.status).toBe("Success");
    expect(scope.adapter.reconcile).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ expectedExternalId: "9001",
      expectedPublishedUrl: "https://www.toutiao.com/article/9001/" }));
    expect(scope.repo.getPublishRecordByJob(scope.job.id)).toMatchObject({ success: true, response: { publicContentVerified: "FAIL" } });
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not retain a published ID from an unmatched management row", async () => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id); scope.adapter.remoteState = "PUBLISHED"; scope.adapter.matched = false;
    expect((await scope.publisher.pollPublishingJob(scope.job.id)).job.status).toBe("NeedsReconciliation");
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.publishedExternalId).toBeNull();
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.publishedUrl).toBeNull();
    expect(scope.adapter.verifyPublished).not.toHaveBeenCalled();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
  });

  it("requires a matched target row before classifying rejection", async () => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id); scope.adapter.remoteState = "REJECTED"; scope.adapter.matched = false;
    expect((await scope.publisher.pollPublishingJob(scope.job.id)).job.status).toBe("NeedsReconciliation");
    scope.adapter.matched = true;
    expect((await scope.publisher.reconcileBrowserJob(scope.job.id)).job.status).toBe("Failed");
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "FAILED_CONFIRMED" });
    await expect(scope.publisher.executeJob(scope.job.id)).rejects.toMatchObject({ code: "FINAL_SUBMIT_ALREADY_USED" });
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps reconciliation network errors uncertain without another submit", async () => {
    const scope = await prepared(); await scope.publisher.executeJob(scope.job.id);
    scope.adapter.reconcile.mockRejectedValue(new Error("Read-only network failure"));
    expect((await scope.publisher.pollPublishingJob(scope.job.id)).job.status).toBe("NeedsReconciliation");
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
  });
});
