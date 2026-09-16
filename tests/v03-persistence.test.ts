import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupDatabase, openDatabase, validateDatabaseBackup } from "@publisher/db";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("V0.3 persistence", () => {
  it("supports provider profiles, malformed JSON fallback and paginated articles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v03-db-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "分页品牌", companyName: "分页公司" });
    for (let index = 0; index < 3; index += 1) repository.createArticle({ brandId: brand.id, topic: "topic", keyword: `keyword-${index}`, city: "南京", title: `标题-${index}`, body: "正文".repeat(50), summary: "摘要", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: `hash-${index}` });
    const page = repository.listArticlesPage({ brandId: brand.id, page: 2, pageSize: 2 });
    expect(page.items).toHaveLength(1);
    const profile = repository.upsertAiProviderProfile({ name: "默认 AI", provider: "mock", baseUrl: "https://example.test/v1", model: "mock", credentialRef: "ai:apiKey", temperature: 0.7, maxOutputTokens: 1000, timeoutMs: 5000, retryCount: 1, concurrency: 3, enabled: true, isDefault: true, isFallback: false });
    expect(repository.getAiProviderProfile(profile.id)?.concurrency).toBe(3);
    repository.db.prepare("UPDATE brands SET service_regions_json=? WHERE id=?").run("not-json", brand.id);
    expect(repository.getBrand(brand.id)?.serviceRegions).toEqual([]);
    db.close();
  });

  it("uses SQLite backup and validates the backup before restore", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v03-backup-")); dirs.push(dir);
    const { db } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    const backupPath = join(dir, "backups", "publisher.db");
    await backupDatabase(db, backupPath);
    expect(validateDatabaseBackup(backupPath)).toEqual({ valid: true, message: "SQLite integrity_check 通过" });
    db.close();
  });
});
