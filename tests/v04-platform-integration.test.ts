import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { TikTokAdapter } from "@publisher/adapters-tiktok";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("V0.4 platform integration", () => {
  it("applies migration 0004 and creates its schema objects", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v04-migration-")); dirs.push(dir);
    const { db } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    try {
      const applied = db.prepare("SELECT id FROM migrations ORDER BY id").all() as Array<{ id: string }>;
      expect(applied.at(-1)?.id).toBe("0024_v151_platform_account_identity_binding.sql");
      expect(applied.map((migration) => migration.id)).toEqual(expect.arrayContaining([
        "0023_v150_one_shot_publication_authorization.sql",
        "0024_v151_platform_account_identity_binding.sql"
      ]));

      const publishJobColumns = db.prepare("PRAGMA table_info(publish_jobs)").all() as Array<{ name: string }>;
      expect(publishJobColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["content_kind", "video_asset_id", "publish_payload_json"]));
      const platformColumns = db.prepare("PRAGMA table_info(platforms)").all() as Array<{ name: string }>;
      expect(platformColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["background_automation_status", "background_automation_last_tested_at", "background_automation_reason"]));
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining(["video_assets", "account_authorizations", "content_studio_tasks", "content_studio_versions", "content_quality_states", "content_quality_reviews", "platform_content_rules", "content_quality_audits", "human_review_datasets", "human_review_dataset_items", "human_review_item_reviews", "human_review_issue_decisions", "platform_self_test_runs", "platform_self_test_steps"]));
    } finally {
      db.close();
    }
  });

  it("persists video metadata through media_assets and derives lifecycle status from video jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-video-assets-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    try {
      repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
      const brand = repository.createBrand({ name: "视频品牌", companyName: "视频公司" });
      const account = repository.createAccount({ platformKey: "test", name: "视频账号" });
      const article = repository.createArticle({ brandId: brand.id, topic: "视频主题", keyword: "视频关键词", city: "南京", title: "关联文章", body: "这是一段用于关联视频发布任务的文章正文。", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "mock", aiModel: "mock", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: `video-${Date.now()}` });
      if (!article) throw new Error("关联文章创建失败");
      const videoPath = join(dir, "demo.mp4"); writeFileSync(videoPath, "video");
      const video = repository.createVideoAsset({ localPath: videoPath, fileName: "demo.mp4", mimeType: "video/mp4", size: 5, durationMs: 12_000, width: 1080, height: 1920 });
      const coverId = repository.createMediaAsset({ brandId: brand.id, type: "video_cover", title: "视频封面", filePath: join(dir, "cover.png") });
      repository.createMediaAsset({ id: video.id, brandId: brand.id, type: "video", title: "首条视频", filePath: videoPath, metadata: { description: "视频描述", tags: ["环保", "南京"], coverPath: join(dir, "cover.png"), coverAssetId: coverId, platformFields: { douyin: { visibility: "public" } }, status: "Draft" } });
      expect(repository.getManagedVideoAsset(video.id)).toMatchObject({ title: "首条视频", description: "视频描述", tags: ["环保", "南京"], coverAssetId: coverId, status: "Draft" });
      repository.updateVideoAsset(video.id, { title: "更新后视频", tags: ["装修"], platformFields: { douyin: { visibility: "friends" } } });
      expect(repository.getManagedVideoAsset(video.id)).toMatchObject({ title: "更新后视频", tags: ["装修"], coverAssetId: coverId });
      const job = repository.createVideoPublishJob({ accountId: account.id, platformKey: "test", articleId: article.id, videoAssetId: video.id, title: "更新后视频", scheduledAt: new Date().toISOString() });
      expect(repository.getManagedVideoAsset(video.id)?.status).toBe("Ready");
      repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformKey: "test", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: true, response: { networkCalls: 0 }, dryRun: true, status: "DryRun" });
      expect(repository.listVideoAssets(brand.id).find((asset) => asset.id === video.id)?.status).toBe("DryRun");
    } finally {
      db.close();
    }
  });

  it("preserves truthful lifecycle states for platforms without adapters", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v04-status-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    try {
      repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
      expect(repository.listPlatforms().find((platform) => platform.platformKey === "other")).toMatchObject({
        adapterStatus: "not_implemented",
        verificationStatus: "NotImplemented"
      });
      expect(repository.listPlatforms().find((platform) => platform.platformKey === "zhihu")).toMatchObject({
        adapterStatus: "not_implemented",
        verificationStatus: "WaitingForUser",
        transport: "browser",
        integrationMode: "BrowserAutomation"
      });
    } finally {
      db.close();
    }
  });

  it("seeds all external platforms without TestPlatform in the production catalog", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v04-production-catalog-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    try {
      repository.seedPlatformCatalog(join(process.cwd(), "PLATFORMS.csv"));
      const platforms = repository.listPlatforms();
      expect(platforms).toHaveLength(41);
      expect(platforms.some((platform) => platform.platformKey === "test")).toBe(false);
      const lifecycleCounts = platforms.reduce<Record<string, number>>((counts, platform) => {
        counts[platform.verificationStatus] = (counts[platform.verificationStatus] ?? 0) + 1;
        return counts;
      }, {});
      expect(lifecycleCounts).toEqual({
        WaitingForUser: 14,
        Developing: 2,
        ManualOnly: 21,
        Blocked: 1,
        NotImplemented: 3
      });
    } finally {
      db.close();
    }
  });

  it("syncs registered adapter manifests into platform and profile records", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v04-manifest-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    try {
      const registry = new AdapterRegistry();
      registry.register(new TestPlatformAdapter());
      registry.register(new TikTokAdapter());
      repository.syncAdapterManifests(registry.list().map((adapter) => ({ manifest: adapter.manifest, capabilities: adapter.getCapabilities() })));

      expect(repository.getPlatformProfile("tiktok")?.supportsTags).toBe(true);
      expect(repository.listPlatforms().find((platform) => platform.platformKey === "tiktok")).toMatchObject({
        adapterStatus: "ready",
        transport: "official_api",
        researchStatus: "verified"
      });
    } finally {
      db.close();
    }
  });

  it("downgrades stale adapters that are absent from the current runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v04-stale-adapter-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    try {
      const registry = new AdapterRegistry();
      registry.register(new TikTokAdapter());
      repository.syncAdapterManifests(registry.list().map((adapter) => ({ manifest: adapter.manifest, capabilities: adapter.getCapabilities() })));
      expect(repository.reconcileAdapterRegistrations([])).toBe(1);
      expect(repository.listPlatforms().find((platform) => platform.platformKey === "tiktok")).toMatchObject({ adapterStatus: "not_implemented", verificationStatus: "NotImplemented" });
    } finally {
      db.close();
    }
  });
});
