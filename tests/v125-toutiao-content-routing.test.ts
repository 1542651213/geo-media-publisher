import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type PlatformAdapter } from "@publisher/adapters-core";
import { openDatabase, type AppRepository } from "@publisher/db";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, PublishVideoInput, ValidationResult } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "@publisher/publisher";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close(): void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function adapter(kind: "article" | "video"): PlatformAdapter & { preparePublish: ReturnType<typeof vi.fn>; publishVideo: ReturnType<typeof vi.fn> } {
  const article = kind === "article";
  const manifest: AdapterManifest = {
    platformKey: "toutiao",
    displayName: article ? "Toutiao article fixture" : "Toutiao video fixture",
    category: article ? "article" : "video",
    version: "v125-test",
    adapterStatus: "ready",
    authStrategy: article ? "ManualSession" : "AppCredential",
    callbackStrategy: article ? "ManualCodeCallback" : "HttpsCallback",
    status: "WaitingForUser",
    researchStatus: "partial",
    transport: article ? "browser" : "official_api",
    integrationMode: article ? "BrowserAutomation" : "API",
    supportsArticle: article,
    supportsVideo: !article,
    officialWebsite: "https://example.com",
    credentialSchema: [],
    officialSources: ["https://example.com/source"]
  };
  const preparePublish = vi.fn(async () => ({ prepared: true, requiresUserAction: true, message: "prepared", response: { imageUploadRequired: false } }));
  const publishVideo = vi.fn(async (ctx: AccountContext, _video: PublishVideoInput): Promise<PublishResult> => ({ success: true, dryRun: ctx.settings.dryRun === true, prepared: true, response: { adapter: "toutiao-video-fixture" } }));
  return {
    platformKey: "toutiao",
    manifest,
    automationType: article ? "BrowserAutomation" : undefined,
    getCapabilities: () => article ? { ...defaultCapabilities } : { ...defaultCapabilities, article: false, video: true, imagePost: false, coverImage: false, draft: false, richText: false, maxTitleLength: 0, maxImageCount: 0, tags: false, categories: false, maxTagCount: 0, maxVideoSize: 1024, videoFormats: ["video/mp4"], videoPublishAsync: false },
    getCredentialSchema: () => [],
    checkLogin: vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => "logged_in"),
    checkSession: vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => "logged_in"),
    connectAccount: vi.fn(async (_ctx: AccountContext): Promise<LoginSession> => ({ sessionId: randomUUID(), requiresUserAction: true })),
    beginLogin: async (_ctx: AccountContext): Promise<LoginSession> => ({ sessionId: randomUUID(), requiresUserAction: true }),
    validateArticle: async (_article: PublishArticleInput): Promise<ValidationResult> => ({ valid: true, errors: [], warnings: [] }),
    validateVideo: async (_video: PublishVideoInput): Promise<ValidationResult> => ({ valid: true, errors: [], warnings: [] }),
    preparePublish,
    publishArticle: vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> => ({ success: true, response: { adapter: "toutiao-article-fixture" } })),
    publishVideo,
    releaseOperationSession: vi.fn(async (_ctx: AccountContext): Promise<void> => undefined)
  } as PlatformAdapter & { preparePublish: ReturnType<typeof vi.fn>; publishVideo: ReturnType<typeof vi.fn> };
}

function article(repository: AppRepository, brandId: string, suffix: string) {
  const created = repository.createArticle({
    brandId,
    topic: `Toutiao routing ${suffix}`,
    keyword: "routing",
    city: "Nanjing",
    title: `Toutiao routing ${suffix}`,
    body: "This is a sufficiently long fixture body for the content-aware publisher routing test. ".repeat(8),
    summary: "",
    tags: [],
    seoKeywords: [],
    articleType: "科普",
    aiProvider: "fixture",
    aiModel: "fixture",
    generatedAt: new Date().toISOString(),
    reusePolicy: "once",
    contentHash: `v125-${suffix}-${randomUUID()}`,
    qualityStatus: "passed",
    qualityWarnings: [],
    source: "production"
  });
  if (!created) throw new Error("article fixture was not created");
  return created;
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "publisher-v125-routing-"));
  tempDirs.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  opened.repository.setSetting("contentReviewMode", "Off");
  const brand = opened.repository.createBrand({ name: "Toutiao routing brand", companyName: "Toutiao routing company" });
  const account = opened.repository.createAccount({ platformKey: "toutiao", name: "Toutiao routing account" });
  opened.repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in" });
  return { ...opened, brand, account };
}

describe("V1.2.5 Toutiao content-aware runtime routing", () => {
  it("routes article preparation to the article adapter and video execution to the video adapter", async () => {
    const { repository, brand, account } = fixture();
    const articleAdapter = adapter("article");
    const videoAdapter = adapter("video");
    const registry = new AdapterRegistry();
    registry.register(videoAdapter);
    registry.register(articleAdapter);
    const publisher = new PublisherService(repository, registry, createConsoleLogger(), { resolveSecrets: () => ({}) });

    const articleJob = repository.createArticlePublishJob({ articleId: article(repository, brand.id, "article").id, platformKey: "toutiao", platformAccountId: account.id, publishMode: "ASSISTED" });
    await publisher.prepareArticle(articleJob.id, { userActionId: randomUUID(), triggerSource: "START_PUBLISH" });
    expect(articleAdapter.preparePublish).toHaveBeenCalledTimes(1);
    expect(videoAdapter.preparePublish).not.toHaveBeenCalled();

    const videoArticle = article(repository, brand.id, "video");
    const videoAsset = repository.createVideoAsset({ localPath: join(tempDirs[0]!, "fixture.mp4"), fileName: "fixture.mp4", mimeType: "video/mp4", size: 1, durationMs: 1_000, width: 1, height: 1 });
    const videoJob = repository.createVideoPublishJob({ accountId: account.id, platformAccountId: account.id, platformKey: "toutiao", articleId: videoArticle.id, videoAssetId: videoAsset.id, title: videoArticle.title, scheduledAt: new Date().toISOString(), dryRun: true, manualConfirmationRequired: true });
    await publisher.executeJob(videoJob.id, { userActionId: randomUUID(), triggerSource: "START_PUBLISH" });
    expect(videoAdapter.publishVideo).toHaveBeenCalledTimes(1);
    expect(articleAdapter.publishVideo).not.toHaveBeenCalled();
  });
});
