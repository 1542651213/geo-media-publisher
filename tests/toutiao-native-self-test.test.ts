import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry, defaultCapabilities, type AutomationAdapter, type BrowserPublishAttemptContext } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import type { AccountContext, AdapterManifest, PublishArticleInput, PublishResult } from "@publisher/domain";
import { PublisherService } from "@publisher/publisher";
import type { Logger } from "@publisher/logger";
import { PlatformSelfTestService, transparentSelfTestContent } from "../apps/desktop/src/main/platform-self-test";

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const directories: string[] = [];
const databases: Array<{ close(): void }> = [];
const originalBatch = process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED;

class NativeTestAdapter implements AutomationAdapter {
  readonly platformKey = "toutiao";
  readonly automationType = "BrowserAutomation" as const;
  readonly manifest: AdapterManifest = { platformKey: "toutiao", displayName: "Toutiao", category: "article", version: "test",
    adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "CodeComplete",
    researchStatus: "partial", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true,
    supportsVideo: false, officialWebsite: "https://mp.toutiao.com", credentialSchema: [], officialSources: ["https://mp.toutiao.com/"] };
  readonly preparedInputs: PublishArticleInput[] = [];
  readonly prepareIdentities: unknown[] = [];
  finalClicks = 0;
  reconciliationReads = 0;
  getCapabilities() { return { ...defaultCapabilities, article: true, imagePost: true, coverImage: true, maxImageCount: 1,
    contentTransport: "ARTICLE_BROWSER" as const, browserManagementReconciliation: true }; }
  getCredentialSchema() { return []; }
  async connectAccount() { return { sessionId: "fixture", requiresUserAction: true }; }
  isConnectionPending() { return false; }
  async completeConnection() { return "logged_in" as const; }
  async checkSession() { return "logged_in" as const; }
  async checkLogin() { return "logged_in" as const; }
  async beginLogin() { return { sessionId: "fixture", requiresUserAction: true }; }
  async openBackend() { return { opened: true, backendUrl: "https://mp.toutiao.com/", sessionIdHash: "safe-hash" }; }
  async preparePublish(ctx: AccountContext, input: PublishArticleInput) {
    this.preparedInputs.push(input); this.prepareIdentities.push(ctx.settings.expectedCreatorId);
    return { prepared: true, requiresUserAction: true, message: "prepared", titleFilled: true, bodyFilled: true,
      response: { titleReadback: true, bodyReadback: true, requiredFieldsVerified: true, imageUploaded: true,
        imageRequirement: "cover_uploaded", coverInputVerified: true, coverUploadMethod: "file_input" } };
  }
  async validateArticle() { return { valid: true, errors: [], warnings: [] }; }
  async publishArticle(): Promise<PublishResult> { throw new Error("UNEXPECTED_GENERIC_PUBLISH"); }
  async finalSubmit(_ctx: AccountContext, _input: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    attempt.markSubmissionSideEffect?.(); this.finalClicks += 1;
    throw Object.assign(new Error("Fixture response was lost"), { code: "SUBMISSION_UNCERTAIN" });
  }
  async reconcile() {
    this.reconciliationReads += 1;
    return { status: "STILL_UNCERTAIN" as const, titleMatch: false, accountMatch: true, timeWindowMatch: false,
      response: { readOnly: true }, message: "Target absent in fixture scope" };
  }
  async verifyPublish() { return { status: "publishing" as const, response: {} }; }
  async logout() {}
}

function fixture(image: "universal" | "unmarked_universal" | "other_brand" | "none" = "universal", identity = "123456", acceptanceScope = false) {
  process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED = "1";
  const directory = mkdtempSync(join(tmpdir(), "toutiao-native-selftest-")); directories.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), join(process.cwd(), "packages/db/migrations"));
  databases.push(opened.db); opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = opened.repository.createBrand({ name: "Owner test brand", companyName: "GMP" });
  const account = opened.repository.createAccount({ platformKey: "toutiao", name: "Owner test account" });
  opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "toutiao", browserSessionId: "fixture",
    ...(identity ? { externalAccountId: identity } : {}) });
  if (image !== "none") {
    const filePath = join(directory, "test.png"); writeFileSync(filePath, "test-fixture-only");
    const other = image === "other_brand" ? opened.repository.createBrand({ name: "Unrelated brand", companyName: "Other" }) : null;
    const targetBrand = opened.repository.listBrands()[0]!;
    const unrelatedId = targetBrand.id === brand.id ? other?.id : brand.id;
    opened.repository.createImageAsset({ brandId: image === "other_brand" ? unrelatedId! : brand.id, name: "test",
      filePath, originalFileName: "test.png", mimeType: "image/png", size: 17, usage: image === "unmarked_universal" ? [] : ["测试"], universal: image !== "other_brand" });
  }
  const adapter = new NativeTestAdapter(); const registry = new AdapterRegistry(); registry.register(adapter);
  const publisher = new PublisherService(opened.repository, registry, logger, { reconciliationWaitMs: 0 });
  const service = new PlatformSelfTestService({ repository: opened.repository, registry, publisher, resolveAccountSecrets: () => ({}), logger,
    ...(acceptanceScope ? { toutiaoNativeAcceptanceAccountId: account.id } : {}) });
  return { ...opened, adapter, publisher, service, account };
}

afterEach(() => {
  if (originalBatch === undefined) delete process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED;
  else process.env.REAL_PUBLISH_TEST_BATCH_CONFIRMED = originalBatch;
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Toutiao native owner-approved self-test binding", () => {
  it("rejects a different account at request, confirmation and continue in scoped acceptance mode", async () => {
    const { service, repository, adapter } = fixture("universal", "123456", true);
    const other = repository.createAccount({ platformKey: "toutiao", name: "Different fixture account" });
    expect(() => service.requestPublish(other.id)).toThrow("TOUTIAO_NATIVE_ACCEPTANCE_ACCOUNT_MISMATCH");
    expect(repository.listPlatformSelfTestRuns()).toHaveLength(0);
    const existing = repository.createPlatformSelfTestRun({ platformAccountId: other.id, requestedLevel: "L5_PUBLISH" });
    repository.finishPlatformSelfTestRun(existing.testRunId, "WAITING_FOR_USER");
    await expect(service.confirmPublish(existing.testRunId)).rejects.toThrow("TOUTIAO_NATIVE_ACCEPTANCE_ACCOUNT_MISMATCH");
    await expect(service.continue(existing.testRunId)).rejects.toThrow("TOUTIAO_NATIVE_ACCEPTANCE_ACCOUNT_MISMATCH");
    expect(repository.getPlatformSelfTestRun(existing.testRunId)?.publishConfirmedAt).toBeNull();
    expect(repository.listJobs()).toHaveLength(0);
    expect(adapter.preparedInputs).toHaveLength(0);
  });

  it("does not create content, prepare an editor or submit before the Owner confirmation entry", () => {
    const { service, account, repository, adapter } = fixture();
    const run = service.requestPublish(account.id);
    expect(run.publishConfirmedAt).toBeNull();
    expect(repository.listJobs()).toHaveLength(0);
    expect(repository.listArticles({ source: "test" })).toHaveLength(0);
    expect(adapter.preparedInputs).toHaveLength(0);
  });

  it("prepares the persisted transparent article and binds the same input used by Publisher", async () => {
    const { service, account, repository, adapter } = fixture();
    const request = service.requestPublish(account.id);
    const run = await service.confirmPublish(request.testRunId);
    const job = repository.getJob(run.publishJobId!);
    const article = repository.getArticle(job!.articleId)!;
    const record = repository.getPublishRecordByJob(job!.id)!;
    const input = adapter.preparedInputs[0]!;
    expect(input).toMatchObject({ articleId: article.id, title: article.title, body: article.body, summary: article.summary, tags: article.tags });
    expect(article.source).toBe("test");
    expect(article.tags).toEqual([]);
    expect(adapter.prepareIdentities).toEqual(["123456"]);
    const expectedHash = createHash("sha256").update(JSON.stringify({ articleId: article.id, title: article.title,
      body: article.body, summary: article.summary, tags: article.tags, images: input.images })).digest("hex");
    expect(record.response).toMatchObject({ contentTransport: "ARTICLE_BROWSER", preparedInputHash: expectedHash, expectedCreatorId: "123456" });
    expect(adapter.finalClicks).toBe(1);
    expect(repository.getSubmissionIntentByJob(job!.id)?.finalSubmitCount).toBe(1);
    expect(run.overallResult).toBe("WAITING_FOR_USER");
  });

  it.each(["none", "other_brand", "unmarked_universal"] as const)("refuses %s cover provenance before creating a Job or opening the editor", async (image) => {
    const { service, account, repository, adapter } = fixture(image);
    const request = service.requestPublish(account.id);
    const run = await service.confirmPublish(request.testRunId);
    expect(run.overallResult).toBe("WAITING_FOR_USER");
    expect(repository.listJobs()).toHaveLength(0);
    expect(adapter.preparedInputs).toHaveLength(0);
    expect(adapter.finalClicks).toBe(0);
  });

  it("rejects concurrent confirmation before a second editor prepare can begin", async () => {
    const { service, account, repository, adapter } = fixture();
    const request = service.requestPublish(account.id);
    await Promise.allSettled([service.confirmPublish(request.testRunId), service.confirmPublish(request.testRunId)]);
    expect(adapter.preparedInputs).toHaveLength(1);
    expect(adapter.finalClicks).toBe(1);
    expect(repository.listJobs()).toHaveLength(1);
  });

  it("keeps unknown post-submit outcomes read-only on continue and repeated confirmation", async () => {
    const { service, account, repository, adapter } = fixture();
    const request = service.requestPublish(account.id);
    const first = await service.confirmPublish(request.testRunId);
    const firstReads = adapter.reconciliationReads;
    const second = await service.continue(first.testRunId);
    await service.confirmPublish(second.testRunId);
    expect(adapter.finalClicks).toBe(1);
    expect(adapter.preparedInputs).toHaveLength(1);
    expect(adapter.reconciliationReads).toBeGreaterThan(firstReads);
    expect(repository.listJobs()).toHaveLength(1);
    expect(repository.getSubmissionIntentByJob(first.publishJobId!)?.finalSubmitCount).toBe(1);
  });

  it("uses time-specific Toutiao titles instead of the fixed generic title", () => {
    const a = transparentSelfTestContent("toutiao", "Toutiao", new Date("2026-09-26T01:02:03Z"));
    const b = transparentSelfTestContent("toutiao", "Toutiao", new Date("2026-09-26T01:02:04Z"));
    expect(a.title).not.toBe(b.title);
    expect(a.title).toContain("头条");
  });
});
