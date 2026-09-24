import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "@publisher/adapters-core";
import { preflightToutiaoArticleJob, prepareToutiaoArticleJob, ToutiaoArticleApiAdapter } from "@publisher/adapters-toutiao/article-api";
import { openDatabase } from "@publisher/db";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "@publisher/publisher";
import type { CredentialStore } from "@publisher/security";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";

class EmptyCredentialStore implements CredentialStore {
  get(): string | null { return null; }
  set(): void { /* offline fixture */ }
  delete(): void { /* offline fixture */ }
  has(): boolean { return false; }
}

const dirs: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>["db"]> = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "toutiao-r1b-integration-")); dirs.push(dir);
  const db = openDatabase(join(dir, "app.db"), join(process.cwd(), "packages", "db", "migrations")); databases.push(db.db);
  const repo = db.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = repo.createBrand({ name: "R1B brand", companyName: "R1B" });
  const other = repo.createBrand({ name: "Other brand", companyName: "Other" });
  const account = repo.syncBrowserPlatformAccount({ accountId: repo.createAccount({ platformKey: "toutiao", name: "R1B account" }).id, platformKey: "toutiao", browserSessionId: "fixture-session" });
  const imagePath = join(dir, "cover.png"); writeFileSync(imagePath, "picture bytes");
  const image = repo.createImageAsset({ brandId: brand.id, name: "cover", filePath: imagePath, originalFileName: "cover.png", mimeType: "image/png", size: 13 });
  const otherImage = repo.createImageAsset({ brandId: other.id, name: "wrong", filePath: imagePath, originalFileName: "wrong.png", mimeType: "image/png", size: 13 });
  const article = repo.createArticle({ brandId: brand.id, topic: "topic", keyword: "word", city: "南京", title: "图文标题", body: `<p>正文<img src="asset://${image.id}"></p>`, summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: "a".repeat(64), qualityStatus: "passed", qualityWarnings: [], source: "production" })!;
  const settings = { version: 1 as const, coverMode: "single" as const, coverImages: [image.id], articleAdType: "none" as const, remoteScheduledAt: null };
  const job = repo.createToutiaoArticlePublishJob({ articleId: article.id, platformAccountId: account.platformAccountId!, settings });
  return { repo, job, article, image, otherImage, imagePath, settings };
}

describe("Toutiao R1-B offline Job preparation", () => {
  it("prepares and persists one frozen payload from the Job settings snapshot", () => {
    const { repo, job, article, image } = fixture();
    const first = prepareToutiaoArticleJob(repo, job.id, new Date("2026-09-24T00:00:00.000Z"));
    expect(first.payload.assetSnapshots[0]?.assetId).toBe(image.id);
    expect(first.payload.bodyImageUploadKeys[0]).toBe(first.payload.coverUploadKeys[0]);
    expect(repo.getToutiaoArticlePreparation(job.id)?.payloadHash).toBe(first.payloadHash);
    repo.db.prepare("UPDATE articles SET title=?,body=? WHERE id=?").run("changed title", "changed body", article.id);
    const second = prepareToutiaoArticleJob(repo, job.id, new Date("2026-09-25T00:00:00.000Z"));
    expect(second.payloadHash).toBe(first.payloadHash);
    expect(second.payload.title).toBe("图文标题");
  });

  it("detects asset byte mutation after preparation", () => {
    const { repo, job, image, imagePath } = fixture();
    const prepared = prepareToutiaoArticleJob(repo, job.id, new Date("2026-09-24T00:00:00.000Z"));
    writeFileSync(imagePath, "changed bytes");
    expect(() => prepareToutiaoArticleJob(repo, job.id, new Date("2026-09-25T00:00:00.000Z"))).toThrowError(expect.objectContaining({ code: "ASSET_HASH_MISMATCH" }));
    expect(prepared.payload.assetSnapshots[0]?.assetId).toBe(image.id);
  });

  it("rejects a cross-brand body image and a cross-brand cover during preflight", () => {
    const body = fixture();
    body.repo.db.prepare("UPDATE articles SET body=? WHERE id=?").run(`<img src="asset://${body.otherImage.id}">`, body.article.id);
    expect(() => preflightToutiaoArticleJob(body.repo, body.job.id, new Date("2026-09-24T00:00:00.000Z"))).toThrowError(expect.objectContaining({ code: "ASSET_BRAND_MISMATCH" }));

    const cover = fixture();
    cover.repo.db.prepare("UPDATE toutiao_article_job_preparations SET settings_json=? WHERE job_id=?").run(JSON.stringify({ ...cover.settings, coverImages: [cover.otherImage.id] }), cover.job.id);
    expect(() => preflightToutiaoArticleJob(cover.repo, cover.job.id, new Date("2026-09-24T00:00:00.000Z"))).toThrowError(expect.objectContaining({ code: "ASSET_BRAND_MISMATCH" }));
  });

  it("fails formal execution before an R1-A Intent or final submit attempt", async () => {
    const { repo, job } = fixture();
    repo.confirmJob(job.id, false);
    const registry = new AdapterRegistry(); registry.register(new ToutiaoArticleApiAdapter());
    const result = await new PublisherService(repo, registry, createConsoleLogger()).executeJob(job.id);
    expect(result.job.status).toBe("Failed");
    expect(result.job.lastErrorCode).toBe("ARTICLE_API_SUBMIT_NOT_IMPLEMENTED");
    expect(repo.getSubmissionIntentByJob(job.id)).toBeNull();
    expect(repo.getGlobalFormalPublishExecution()).toBeNull();
  });

  it("forbids automatic Browser fallback for a frozen Article Web API Job", async () => {
    const { repo, job } = fixture();
    repo.confirmJob(job.id, false);
    const registry = createRuntimeAdapterRegistry(new EmptyCredentialStore(), false, undefined, undefined, undefined, { toutiaoArticleApiPublisherEnabled: false });
    const result = await new PublisherService(repo, registry, createConsoleLogger()).executeJob(job.id);
    expect(result.job.lastErrorCode).toBe("TRANSPORT_FALLBACK_FORBIDDEN");
    expect(repo.getSubmissionIntentByJob(job.id)).toBeNull();
  });
});
