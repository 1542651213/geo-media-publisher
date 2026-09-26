import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), "douyin-image-connection-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"), join(process.cwd(), "packages/db/migrations"));
  databases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  return opened.repository;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Douyin image/text Creator binding", () => {
  it("keeps the existing video OAuth account fields and increments login generation", () => {
    const repo = setup();
    const account = repo.createAccount({ platformKey: "douyin", name: "Owner" });
    repo.updateAccount(account.id, { loginStatus: "expired" });
    expect(repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "72388977613", browserSessionIdHash: "hash-1" })).toEqual({ loginGeneration: 1 });
    expect(repo.getDouyinImageTextConnection(account.id)).toMatchObject({ creatorId: "72388977613", active: true, loginGeneration: 1 });
    expect(repo.getAccountById(account.id, "douyin")).toMatchObject({ loginStatus: "expired", externalAccountId: null });
    expect(repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "72388977613", browserSessionIdHash: "hash-2" })).toEqual({ loginGeneration: 2 });
    repo.disconnectDouyinImageTextConnection(account.id);
    expect(repo.getDouyinImageTextConnection(account.id)).toMatchObject({ active: false, loginGeneration: 3 });
  });

  it("rejects a second active binding to the same stable Creator identity", () => {
    const repo = setup();
    const first = repo.createAccount({ platformKey: "douyin", name: "First" });
    const second = repo.createAccount({ platformKey: "douyin", name: "Second" });
    repo.saveDouyinImageTextConnection({ accountId: first.id, creatorId: "72388977613", browserSessionIdHash: "hash-1" });
    expect(() => repo.saveDouyinImageTextConnection({ accountId: second.id, creatorId: "72388977613", browserSessionIdHash: "hash-2" })).toThrow("already bound");
  });

  it("requires a dedicated Creator binding and manually selected image for an article Job", () => {
    const repo = setup();
    repo.setSetting("contentReviewMode", "Off");
    const brand = repo.createBrand({ name: "Test", companyName: "Test" });
    const account = repo.createAccount({ platformKey: "douyin", name: "Owner" });
    const article = repo.createArticle({ brandId: brand.id, title: "Test", body: "Test body", summary: "", tags: [],
      seoKeywords: [], topic: "test", keyword: "test", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
      generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "f".repeat(64), qualityStatus: "passed",
      qualityWarnings: [], source: "production" });
    if (!article) throw new Error("fixture Article unavailable");
    const image = repo.createImageAsset({ brandId: brand.id, name: "Owner test image", filePath: "C:/owner/test.png",
      originalFileName: "test.png", mimeType: "image/png", size: 10 });
    const create = () => repo.createArticlePublishJob({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
      imageSelectionMode: "manual", selectedImageAssetId: image.id });
    expect(create).toThrow("Creator");
    repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "72388977613", browserSessionIdHash: "hash-1" });
    expect(() => repo.createArticlePublishJob({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id })).toThrow("手动选择");
    expect(create().status).toBe("AwaitingConfirmation");
  });
});
