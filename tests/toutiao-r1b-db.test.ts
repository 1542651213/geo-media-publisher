import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "@publisher/db";
import { prepareToutiaoArticlePayload } from "@publisher/adapters-toutiao/article-api";
import type { ToutiaoArticleSettingsSnapshot } from "@publisher/domain";

const migrations = join(process.cwd(), "packages", "db", "migrations");
const dirs: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>["db"]> = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const settings: ToutiaoArticleSettingsSnapshot = { version: 1, coverMode: "none", coverImages: [], articleAdType: "none", remoteScheduledAt: "2026-09-25T15:30:00+08:00" };

describe("Toutiao article settings and payload persistence", () => {
  it("freezes settings with a Job and binds an immutable prepared hash to its Intent", () => {
    const dir = mkdtempSync(join(tmpdir(), "toutiao-r1b-db-")); dirs.push(dir);
    const opened = openDatabase(join(dir, "app.db"), migrations); databases.push(opened.db);
    const repo = opened.repository;
    repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repo.createBrand({ name: "R1B", companyName: "R1B" });
    const account = repo.syncBrowserPlatformAccount({ accountId: repo.createAccount({ platformKey: "toutiao", name: "R1B account" }).id, platformKey: "toutiao", browserSessionId: "offline-fixture" });
    const article = repo.createArticle({ brandId: brand.id, topic: "topic", keyword: "word", city: "南京", title: "Title", body: "<p>Body</p>", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: "a".repeat(64), qualityStatus: "passed", qualityWarnings: [], source: "production" })!;
    const job = repo.createToutiaoArticlePublishJob({ articleId: article.id, platformAccountId: account.platformAccountId!, settings });
    expect(repo.getToutiaoArticleSettingsSnapshot(job.id)?.remoteScheduledAt).toBe("2026-09-25T07:30:00.000Z");
    expect(repo.getJob(job.id)?.scheduledAt).not.toBe("2026-09-25T07:30:00.000Z");
    expect(() => repo.freezeToutiaoArticleSettings(job.id, { ...settings, coverMode: "auto" })).toThrow();
    const prepared = prepareToutiaoArticlePayload({ jobId: job.id, articleId: article.id, accountId: account.id, brandId: brand.id,
      title: article.title, html: article.body, settings, resolveAsset: () => null, now: new Date("2026-09-24T00:00:00.000Z") });
    const canonicalJson = prepared.canonicalJson;
    const payloadHash = "c".repeat(64);
    expect(() => repo.saveToutiaoArticlePreparedPayload(job.id, canonicalJson, payloadHash)).toThrow();
    const validHash = createHash("sha256").update(canonicalJson).digest("hex");
    repo.saveToutiaoArticlePreparedPayload(job.id, canonicalJson, validHash);
    expect(() => repo.saveToutiaoArticlePreparedPayload(job.id, canonicalJson.replace(account.id, "different-account"), validHash)).toThrow();
    const intent = repo.prepareSubmissionIntent(job.id);
    repo.bindToutiaoArticlePreparationToIntent(job.id, intent.id);
    expect(repo.getToutiaoArticlePreparation(job.id)).toMatchObject({ intentId: intent.id, payloadHash: validHash, contentBindingHash: prepared.contentBindingHash, settingsVersion: 1 });
    expect(repo.getSubmissionIntentByJob(job.id)?.payloadHash).toBe(prepared.contentBindingHash);
    runMigrations(opened.db, migrations);
    expect((opened.db.prepare("SELECT COUNT(*) AS count FROM migrations WHERE id='0024_toutiao_article_preparation.sql'").get() as { count: number }).count).toBe(1);
  });

  it("upgrades from 0023 without changing existing Published records", () => {
    const dir = mkdtempSync(join(tmpdir(), "toutiao-r1b-upgrade-")); dirs.push(dir);
    const prior = join(dir, "prior"); mkdirSync(prior);
    for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name < "0024_toutiao_article_preparation.sql")) copyFileSync(join(migrations, file), join(prior, file));
    const opened = openDatabase(join(dir, "prior.db"), prior); databases.push(opened.db);
    const repo = opened.repository;
    repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repo.createBrand({ name: "Historical", companyName: "Historical" });
    const account = repo.syncBrowserPlatformAccount({ accountId: repo.createAccount({ platformKey: "toutiao", name: "Historical account" }).id, platformKey: "toutiao", browserSessionId: "historical-fixture" });
    const article = repo.createArticle({ brandId: brand.id, topic: "historical", keyword: "history", city: "南京", title: "Historical title", body: "Historical body", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: "b".repeat(64), qualityStatus: "passed", qualityWarnings: [], source: "production" })!;
    const job = repo.createArticlePublishJob({ articleId: article.id, platformKey: "toutiao", platformAccountId: account.platformAccountId!, articleTransport: "browser" });
    const record = repo.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId!, platformKey: "toutiao", articleId: article.id, publishedUrl: "https://example.invalid/historical", publishedExternalId: "historical-id", success: true, response: { fixture: true }, status: "Published" });
    const before = opened.db.prepare("SELECT id,status,success,published_url,published_external_id FROM publish_records WHERE id=?").get(record.id);
    runMigrations(opened.db, migrations);
    runMigrations(opened.db, migrations);
    expect(opened.db.prepare("SELECT id,status,success,published_url,published_external_id FROM publish_records WHERE id=?").get(record.id)).toEqual(before);
    expect((opened.db.prepare("SELECT COUNT(*) AS count FROM migrations WHERE id='0024_toutiao_article_preparation.sql'").get() as { count: number }).count).toBe(1);
  });

  it("derives and freezes a default cover snapshot without consulting platform-level integrationMode", () => {
    const dir = mkdtempSync(join(tmpdir(), "toutiao-r1b-default-")); dirs.push(dir);
    const opened = openDatabase(join(dir, "app.db"), migrations); databases.push(opened.db);
    const repo = opened.repository;
    repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repo.createBrand({ name: "Routing", companyName: "Routing" });
    const account = repo.syncBrowserPlatformAccount({ accountId: repo.createAccount({ platformKey: "toutiao", name: "Routing account" }).id, platformKey: "toutiao", browserSessionId: "routing-fixture" });
    const article = repo.createArticle({ brandId: brand.id, topic: "routing", keyword: "routing", city: "南京", title: "Routing title", body: "Routing body", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: "d".repeat(64), qualityStatus: "passed", qualityWarnings: [], source: "production" })!;
    const browserJob = repo.createArticlePublishJob({ articleId: article.id, platformKey: "toutiao", platformAccountId: account.platformAccountId!, finalPublishMode: "AUTO_PUBLISH" });
    expect(browserJob.status).toBe("AwaitingConfirmation");
    repo.db.prepare("UPDATE publish_jobs SET status='Cancelled' WHERE id=?").run(browserJob.id);
    const apiJob = repo.createToutiaoArticlePublishJob({ articleId: article.id, platformAccountId: account.platformAccountId!, finalPublishMode: "AUTO_PUBLISH" });
    expect(apiJob.status).toBe("Scheduled");
    expect(repo.getToutiaoArticleSettingsSnapshot(apiJob.id)).toEqual({ version: 1, coverMode: "none", coverImages: [], articleAdType: "none", remoteScheduledAt: null });
    expect(repo.getFrozenContentTransport(apiJob.id)).toBe("ARTICLE_WEB_API");
  });
});
