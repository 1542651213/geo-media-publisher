import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type BrowserPublishAttemptContext, type BrowserPublishReconciliationResult, type PlatformAdapter } from "@publisher/adapters-core";
import type { AccountContext, AdapterManifest, PlatformCapabilities, PublishArticleInput, PublishResult } from "@publisher/domain";
import { freezeDouyinImageText } from "@publisher/domain/douyin-image-text";
import { openDatabase } from "@publisher/db";
import { createConsoleLogger } from "@publisher/logger";
import { hashPreparedBrowserArticleInput, PublisherService } from "./index";

const directories: string[] = [];
const databases: Array<{ close(): void }> = [];
const creatorId = "72388977613";
const sessionHash = "synthetic-owned-session";
const remoteId = "7690435917298928942";

class ReadOnlyDouyinAdapter implements PlatformAdapter {
  readonly platformKey = "douyin";
  readonly automationType = "BrowserAutomation" as const;
  readonly manifest: AdapterManifest = { platformKey: "douyin", displayName: "Douyin fixture", category: "article",
    version: "fixture", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback",
    status: "WaitingForUser", researchStatus: "partial", transport: "browser", integrationMode: "BrowserAutomation",
    supportsArticle: true, supportsVideo: false, officialWebsite: "https://creator.douyin.com/",
    credentialSchema: [], officialSources: ["https://creator.douyin.com/"] };
  readonly reconcile = vi.fn(async (): Promise<BrowserPublishReconciliationResult> => ({ status: "STILL_UNCERTAIN",
    remoteState: "REVIEWING", externalId: remoteId, titleMatch: true, accountMatch: true, timeWindowMatch: true,
    response: { readOnly: true, matchedBy: "REMOTE_ID" }, message: "Synthetic reviewing row" }));
  readonly finalSubmit = vi.fn(async (_ctx: AccountContext, _input: PublishArticleInput,
    attempt: BrowserPublishAttemptContext): Promise<PublishResult> => {
    attempt.markSubmissionSideEffect?.();
    return { success: true, status: "publishing", externalId: remoteId,
      response: { imageUploaded: true, submissionAccepted: true } };
  });
  readonly publishArticle = vi.fn(async (): Promise<PublishResult> => { throw new Error("Publish must not run in reconciliation fixture"); });
  getCapabilities(): PlatformCapabilities { return { ...defaultCapabilities, article: true,
    contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER", browserManagementReconciliation: true }; }
  getCredentialSchema() { return []; }
  async beginLogin() { return { sessionId: "fixture", requiresUserAction: false }; }
  async connectAccount() { return this.beginLogin(); }
  async checkSession() { return "logged_in" as const; }
  async checkLogin() { return "logged_in" as const; }
  async validateArticle() { return { valid: true, errors: [], warnings: [] }; }
}

async function submittedFixture(expectedLoginGeneration?: number | null, prepareForFinal = false) {
  const directory = mkdtempSync(join(tmpdir(), "douyin-reconcile-generation-"));
  directories.push(directory);
  const opened = openDatabase(join(directory, "fixture.db"), join(process.cwd(), "packages/db/migrations"));
  databases.push(opened.db);
  const repo = opened.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  repo.setSetting("contentReviewMode", "Off");
  const brand = repo.createBrand({ name: "Synthetic", companyName: "Synthetic" });
  const account = repo.createAccount({ platformKey: "douyin", name: "Synthetic Owner" });
  repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId, browserSessionIdHash: sessionHash });
  const article = repo.createArticle({ brandId: brand.id, title: "离线唯一标题", body: "离线合成正文。", summary: "",
    tags: [], seoKeywords: [], topic: "fixture", keyword: "fixture", city: "", articleType: "科普",
    aiProvider: "system", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once",
    contentHash: randomUUID(), qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("Synthetic Article unavailable");
  const imagePath = join(directory, "synthetic.png");
  writeFileSync(imagePath, Buffer.from("89504e470d0a1a0a0000", "hex"));
  const image = repo.createImageAsset({ brandId: brand.id, name: "Synthetic image", filePath: imagePath,
    originalFileName: "synthetic.png", mimeType: "image/png", size: 11 });
  const job = repo.createArticlePublishJob({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
    imageSelectionMode: "manual", selectedImageAssetId: image.id,
    douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate", musicMode: "NONE" } });
  const frozen = await freezeDouyinImageText({ articleId: article.id, accountId: account.id, creatorId,
    title: article.title, body: article.body, imagePaths: [imagePath], topics: [], visibility: "public", scheduledAt: null });
  repo.claimDouyinImageTextFileSelection({ jobId: job.id, accountId: account.id, articleId: article.id,
    loginGeneration: 1, sessionIdHash: sessionHash, imageSha256: frozen.imageHashes[0]!,
    sourceContentHash: frozen.sourceContentHash });
  const preparedFrozen = await freezeDouyinImageText({ ...frozen, musicBinding: { mode: "NONE" } });
  const response = { contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER", expectedCreatorId: creatorId,
    preparedInputHash: hashPreparedBrowserArticleInput({ articleId: article.id, title: article.title,
      body: article.body, summary: article.summary, tags: article.tags, images: [imagePath] }),
    ...(prepareForFinal ? { sourceContentHash: preparedFrozen.sourceContentHash,
      contentBindingHash: preparedFrozen.contentBindingHash, imageHashes: preparedFrozen.imageHashes,
      musicBinding: { mode: "NONE" } } : {}),
    ...(expectedLoginGeneration === undefined ? {} : { expectedLoginGeneration }) };
  const record = repo.insertPublishRecord({ jobId: job.id, accountId: account.id, articleId: article.id,
    platformKey: "douyin", publishedUrl: null, publishedExternalId: null, success: false,
    status: "Prepared", response, browserSessionIdHash: sessionHash, selectedImageAssetId: image.id,
    imageSelectionMode: "manual" });
  repo.confirmJob(job.id, false);
  if (!prepareForFinal) {
    const intent = repo.prepareSubmissionIntent(job.id);
    repo.claimFinalSubmitAttempt(intent.id);
    repo.markSubmissionIntentSubmitted(intent.id, remoteId);
    repo.updatePublishRecord(record.id, { status: "Publishing", success: false, publishedExternalId: remoteId, response });
    repo.markJobPublishing(job.id, record.id);
  }
  const adapter = new ReadOnlyDouyinAdapter();
  const registry = new AdapterRegistry();
  registry.register(adapter);
  const publisher = new PublisherService(repo, registry, createConsoleLogger());
  return { db: opened.db, repo, account, article, image, job, adapter, publisher };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Douyin accepted submission read-only generation binding", () => {
  it("confirms management publication with LIMITED public fidelity when public verification is unavailable", async () => {
    const scope = await submittedFixture(1);
    scope.adapter.reconcile.mockResolvedValue({ status: "FOUND_PUBLISHED", remoteState: "PUBLISHED", externalId: remoteId,
      titleMatch: true, accountMatch: true, timeWindowMatch: true,
      response: { readOnly: true, matchedBy: "REMOTE_ID", exactRemoteIdMatch: true, managementCardCount: 1 }, message: "Published fixture" });
    expect((await scope.publisher.reconcileBrowserJob(scope.job.id)).job.status).toBe("Success");
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.response).toMatchObject({ publishResult: "PUBLISHED_CONFIRMED", publicContentVerified: "LIMITED" });
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
    expect(scope.adapter.finalSubmit).not.toHaveBeenCalled();
  });
  it("never replaces a claimed article, and cannot confirm without unique management evidence", async () => {
    const scope = await submittedFixture(1);
    expect(() => scope.repo.createArticlePublishJob({ articleId: scope.article.id, platformKey: "douyin", platformAccountId: scope.account.id,
      selectedImageAssetId: scope.image.id, imageSelectionMode: "manual", douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } }))
      .toThrow("NO_REPLACEMENT");
    scope.adapter.reconcile.mockResolvedValue({ status: "FOUND_PUBLISHED", remoteState: "PUBLISHED", externalId: remoteId,
      titleMatch: true, accountMatch: true, timeWindowMatch: true,
      response: { readOnly: true, matchedBy: "REMOTE_ID", exactRemoteIdMatch: true, managementCardCount: 2 }, message: "Duplicate fixture" });
    const before = scope.repo.getSubmissionIntentByJob(scope.job.id);
    expect((await scope.publisher.reconcileBrowserJob(scope.job.id)).job.status).toBe("NeedsReconciliation");
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(before?.finalSubmitCount);
    expect(scope.adapter.finalSubmit).not.toHaveBeenCalled();
    expect(scope.repo.listJobs()).toHaveLength(1);
  });
  it("confirms a uniquely published remote work independently of a failing public body fidelity check", async () => {
    const scope = await submittedFixture(1);
    scope.adapter.reconcile.mockResolvedValue({ status: "FOUND_PUBLISHED", remoteState: "PUBLISHED", externalId: remoteId,
      publishedUrl: `https://www.douyin.com/note/${remoteId}`, titleMatch: true, accountMatch: true, timeWindowMatch: true,
      response: { readOnly: true, matchedBy: "REMOTE_ID", exactRemoteIdMatch: true, managementCardCount: 1 }, message: "Published fixture" });
    Object.assign(scope.adapter, { verifyPublished: vi.fn(async () => ({ status: "published", externalId: remoteId,
      publishedUrl: `https://www.douyin.com/note/${remoteId}`, response: { urlReachable: true, titleMatch: true, bodyMatch: false,
        imageMatch: true, publicContentVerified: "FAIL", contentFidelityWarning: "BODY_LINEBREAK_RENDERED_AS_LITERAL_ASTERISK" } })) });
    const result = await scope.publisher.reconcileBrowserJob(scope.job.id);
    expect(result.job.status).toBe("Success");
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.response).toMatchObject({ publishResult: "PUBLISHED_CONFIRMED",
      managementPageVerified: "PASS", publicContentVerified: "FAIL", contentFidelityWarning: "BODY_LINEBREAK_RENDERED_AS_LITERAL_ASTERISK" });
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
    expect(scope.adapter.finalSubmit).not.toHaveBeenCalled();
    expect(scope.adapter.publishArticle).not.toHaveBeenCalled();
    await scope.publisher.executeJob(scope.job.id);
    expect(scope.adapter.finalSubmit).not.toHaveBeenCalled();
  });
  it("retains the prepared login generation in future accepted final results", async () => {
    const scope = await submittedFixture(1, true);
    const result = await scope.publisher.executeJob(scope.job.id);
    expect(result.job.status).toBe("Publishing");
    expect(scope.adapter.finalSubmit).toHaveBeenCalledTimes(1);
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.response.expectedLoginGeneration).toBe(1);
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toMatchObject({ finalSubmitCount: 1,
      state: "Submitted", externalId: remoteId });
    expect(scope.adapter.publishArticle).not.toHaveBeenCalled();
  });

  it("uses a complete durable one-selection binding when an old accepted response lost its generation", async () => {
    const scope = await submittedFixture();
    const before = scope.repo.getSubmissionIntentByJob(scope.job.id);
    expect(before).toMatchObject({ state: "Submitted", finalSubmitCount: 1, externalId: remoteId });
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.response.expectedLoginGeneration).toBeUndefined();

    const result = await scope.publisher.reconcileBrowserJob(scope.job.id);

    expect(result.job.status).toBe("Submitted");
    expect(scope.adapter.reconcile).toHaveBeenCalledTimes(1);
    expect(scope.adapter.reconcile).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({
      expectedCreatorId: creatorId, expectedLoginGeneration: 1 }) }), expect.objectContaining({
      jobId: scope.job.id, articleId: scope.article.id, expectedExternalId: remoteId, finalSubmitCount: 1 }));
    expect(scope.adapter.publishArticle).not.toHaveBeenCalled();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toMatchObject({ finalSubmitCount: 1, externalId: remoteId });
  });

  it("uses the recorded generation directly when it matches the current connection", async () => {
    const scope = await submittedFixture(1);
    const result = await scope.publisher.reconcileBrowserJob(scope.job.id);
    expect(result.job.status).toBe("Submitted");
    expect(scope.adapter.reconcile).toHaveBeenCalledTimes(1);
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
  });

  it("rejects a changed current login generation before any remote read", async () => {
    const scope = await submittedFixture();
    scope.repo.saveDouyinImageTextConnection({ accountId: scope.account.id, creatorId,
      browserSessionIdHash: "replacement-owned-session" });
    await expect(scope.publisher.reconcileBrowserJob(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(scope.adapter.reconcile).not.toHaveBeenCalled();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
  });

  it.each([2, null])("rejects an explicitly wrong recorded generation (%s) despite a matching claim", async (generation) => {
    const scope = await submittedFixture(generation);
    await expect(scope.publisher.reconcileBrowserJob(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(scope.adapter.reconcile).not.toHaveBeenCalled();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
  });

  it.each([
    ["accountId", "other-account"], ["articleId", "other-article"], ["loginGeneration", 2],
    ["sessionIdHash", "other-session"], ["imageSha256", "0".repeat(64)],
    ["sourceContentHash", "1".repeat(64)], ["operationId", ""], ["stage", "UNKNOWN"]
  ])("refuses legacy fallback when durable selection %s was changed", async (key, value) => {
    const scope = await submittedFixture();
    const payload = scope.repo.getPublishPayload(scope.job.id);
    const selection = payload.douyinImageSelection as Record<string, unknown>;
    selection[key] = value;
    scope.db.prepare("UPDATE publish_jobs SET publish_payload_json=? WHERE id=?").run(JSON.stringify(payload), scope.job.id);

    await expect(scope.publisher.reconcileBrowserJob(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(scope.adapter.reconcile).not.toHaveBeenCalled();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)?.finalSubmitCount).toBe(1);
  });

  it("refuses fallback if the Record session or prepared content binding changed", async () => {
    const scope = await submittedFixture();
    scope.db.prepare("UPDATE publish_records SET browser_session_id_hash=? WHERE job_id=?")
      .run("other-session", scope.job.id);
    await expect(scope.publisher.reconcileBrowserJob(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(scope.adapter.reconcile).not.toHaveBeenCalled();
  });
});
