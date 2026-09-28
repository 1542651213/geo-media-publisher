import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry, defaultCapabilities, type PlatformAdapter } from "@publisher/adapters-core";
import type { AccountContext, AdapterManifest, PlatformCapabilities, PublishArticleInput, PublishResult } from "@publisher/domain";
import { freezeDouyinImageText } from "@publisher/domain/douyin-image-text";
import { openDatabase } from "@publisher/db";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "./index";

const directories: string[] = [];
const databases: Array<{ close(): void }> = [];
const creatorId = "72388977613";
const sessionHash = "fixture-session";
const imageBytes = Buffer.from("89504e470d0a1a0a0000", "hex");

class FailingArticleAdapter implements PlatformAdapter {
  readonly automationType = "BrowserAutomation" as const;
  readonly manifest: AdapterManifest;
  onPrepare: (ctx: AccountContext, article: PublishArticleInput) => Promise<void> = async () => undefined;

  constructor(readonly platformKey: "douyin" | "toutiao") {
    this.manifest = { platformKey, displayName: `${platformKey} fixture`, category: "article", version: "fixture",
      adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback",
      status: "WaitingForUser", researchStatus: "partial", transport: "browser",
      integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false,
      officialWebsite: "https://example.test/", credentialSchema: [], officialSources: ["https://example.test/"] };
  }

  getCapabilities(): PlatformCapabilities {
    return { ...defaultCapabilities, article: true, video: false,
      contentTransport: this.platformKey === "douyin" ? "DOUYIN_IMAGE_TEXT_BROWSER" : "ARTICLE_BROWSER",
      browserManagementReconciliation: true };
  }
  getCredentialSchema() { return []; }
  async beginLogin() { return { sessionId: "fixture", requiresUserAction: false }; }
  async connectAccount() { return this.beginLogin(); }
  async checkSession() { return "logged_in" as const; }
  async checkLogin() { return "logged_in" as const; }
  async validateArticle() { return { valid: true, errors: [], warnings: [] }; }
  async preparePublish(ctx: AccountContext, article: PublishArticleInput) {
    await this.onPrepare(ctx, article);
    throw Object.assign(new Error("PRE_MUSIC_UNEXPECTED_TRACK"), { code: "USER_ACTION_REQUIRED" });
  }
  async releaseOperationSession() { /* The fixture owns no browser resources. */ }
  async publishArticle(): Promise<PublishResult> { throw new Error("Legacy transport must not run"); }
}

async function setup(platformKey: "douyin" | "toutiao") {
  const directory = mkdtempSync(join(tmpdir(), "douyin-prepare-failure-"));
  directories.push(directory);
  const opened = openDatabase(join(directory, "fixture.db"), join(process.cwd(), "packages/db/migrations"));
  databases.push(opened.db);
  const repo = opened.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  repo.setSetting("contentReviewMode", "Off");
  const brand = repo.createBrand({ name: "Fixture", companyName: "Fixture" });
  const created = repo.createAccount({ platformKey, name: "Fixture Owner" });
  const account = platformKey === "douyin"
    ? created
    : repo.syncBrowserPlatformAccount({ accountId: created.id, platformKey, browserSessionId: sessionHash,
      externalAccountId: creatorId });
  if (platformKey === "douyin") repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId,
    browserSessionIdHash: sessionHash });
  const article = repo.createArticle({ brandId: brand.id, title: "离线测试标题", body: "离线测试正文。", summary: "", tags: [],
    seoKeywords: [], topic: "fixture", keyword: "fixture", city: "", articleType: "科普", aiProvider: "system",
    aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: randomUUID(),
    qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("Fixture Article unavailable");
  const imagePath = join(directory, "fixture.png");
  writeFileSync(imagePath, imageBytes);
  const image = repo.createImageAsset({ brandId: brand.id, name: "Fixture image", filePath: imagePath,
    originalFileName: "fixture.png", mimeType: "image/png", size: imageBytes.length });
  const job = repo.createArticlePublishJob({ articleId: article.id, platformKey, platformAccountId: account.platformAccountId ?? account.id,
    imageSelectionMode: "manual", selectedImageAssetId: image.id,
    ...(platformKey === "douyin" ? { douyinImageTextSettings: { version: 1 as const,
      visibility: "public" as const, timing: "immediate" as const, musicMode: "AUTO_RECOMMENDED" as const } } : {}) });
  const adapter = new FailingArticleAdapter(platformKey);
  const registry = new AdapterRegistry();
  registry.register(adapter);
  const publisher = new PublisherService(repo, registry, createConsoleLogger());
  const claimUpload = async () => {
    const frozen = await freezeDouyinImageText({ articleId: article.id, accountId: account.id, creatorId,
      title: article.title, body: article.body, imagePaths: [imagePath], topics: [], visibility: "public", scheduledAt: null });
    return repo.claimDouyinImageTextFileSelection({ jobId: job.id, accountId: account.id, articleId: article.id,
      loginGeneration: 1, sessionIdHash: sessionHash, imageSha256: frozen.imageHashes[0]!,
      sourceContentHash: frozen.sourceContentHash });
  };
  return { repo, account, article, image, job, adapter, publisher, claimUpload };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Douyin image-text preparation failure before a durable final boundary", () => {
  it("moves a claimed upload with failed preparation to NeedsUserAction without a Record or Intent", async () => {
    const scope = await setup("douyin");
    scope.adapter.onPrepare = async () => { await scope.claimUpload(); };

    await expect(scope.publisher.prepareArticle(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });

    expect(scope.repo.getJob(scope.job.id)).toMatchObject({ status: "NeedsUserAction",
      lastErrorCode: "USER_ACTION_REQUIRED" });
    expect(scope.repo.getPublishPayload(scope.job.id).douyinImageSelection).toMatchObject({
      stage: "FILE_SELECTION_DISPATCHED", articleId: scope.article.id, accountId: scope.account.id });
    expect(scope.repo.getPublishRecordByJob(scope.job.id)).toBeNull();
    expect(scope.repo.getSubmissionIntentByJob(scope.job.id)).toBeNull();
  });

  it("leaves a pre-upload failure in AwaitingConfirmation", async () => {
    const scope = await setup("douyin");
    await expect(scope.publisher.prepareArticle(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(scope.repo.getJob(scope.job.id)?.status).toBe("AwaitingConfirmation");
    expect(scope.repo.getPublishPayload(scope.job.id).douyinImageSelection).toBeUndefined();
  });

  it("does not change another platform's preparation failure state", async () => {
    const scope = await setup("toutiao");
    await expect(scope.publisher.prepareArticle(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(scope.repo.getJob(scope.job.id)?.status).toBe("AwaitingConfirmation");
  });

  it("does not override a prepared Record written before the Adapter failure", async () => {
    const scope = await setup("douyin");
    scope.adapter.onPrepare = async () => {
      await scope.claimUpload();
      scope.repo.insertPublishRecord({ jobId: scope.job.id, accountId: scope.account.id,
        platformKey: "douyin", articleId: scope.article.id, publishedUrl: null, publishedExternalId: null,
        success: false, status: "Prepared", response: { contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER" } });
    };
    await expect(scope.publisher.prepareArticle(scope.job.id)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(scope.repo.getJob(scope.job.id)?.status).toBe("AwaitingConfirmation");
    expect(scope.repo.getPublishRecordByJob(scope.job.id)?.status).toBe("Prepared");
  });
});
