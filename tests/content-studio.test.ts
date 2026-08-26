import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockAIProvider } from "@publisher/ai";
import { openDatabase } from "@publisher/db";
import { CONTENT_STUDIO_PLATFORM_KEYS } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { runContentStudioTask } from "../apps/desktop/src/main/content-studio";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("V0.8 AI Content Studio", () => {
  it("expands city keywords and skips duplicates in the existing keyword library", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-studio-keywords-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    const brand = repository.createBrand({ name: "Studio Brand", companyName: "Studio Company" });
    const first = repository.expandContentStudioKeywords({ brandId: brand.id, cities: ["南京", "苏州"], keywords: ["旧房翻新"], industry: "家装" });
    const second = repository.expandContentStudioKeywords({ brandId: brand.id, cities: ["南京"], keywords: ["旧房翻新"], industry: "家装" });
    expect(first.items).toHaveLength(2);
    expect(first.items.map((item) => item.keyword)).toEqual(["南京家装旧房翻新", "苏州家装旧房翻新"]);
    expect(second.items).toHaveLength(0);
    expect(second.duplicates).toBe(1);
    db.close();
  });

  it("persists six platform versions, article variants and a new version on regeneration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-studio-task-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "Studio Brand", companyName: "Studio Company", mainBusiness: "家装服务", description: "提供本地家装咨询", serviceProcess: "咨询、评估、确认" });
    const provider = new MockAIProvider();
    const payload = { brandId: brand.id, industry: "家装", cities: ["南京"], keywords: ["旧房翻新"], targetPlatforms: [...CONTENT_STUDIO_PLATFORM_KEYS], mediaAssetIds: [], videoAssetIds: [], concurrency: 3, business: "旧房翻新" };
    const taskId = repository.createContentStudioTask({ brandId: brand.id, type: "multi_platform_content", provider: provider.providerKey, model: provider.model, totalCount: payload.targetPlatforms.length, payload });
    await runContentStudioTask(repository, createConsoleLogger(), { createAiProvider: () => provider }, taskId);

    const task = repository.getContentStudioTask(taskId);
    expect(task).toMatchObject({ status: "completed", total: 6, completed: 6, success: 6, failed: 0 });
    const versions = repository.listContentStudioVersions(taskId);
    expect(versions).toHaveLength(6);
    expect(new Set(versions.map((version) => version.title)).size).toBe(6);
    expect(new Set(versions.map((version) => version.contentType))).toEqual(new Set(["article", "video_script"]));
    expect(task?.sourceArticleId).toBeTruthy();
    expect(repository.listArticleVariants(task?.sourceArticleId ?? "")).toHaveLength(6);
    expect(repository.getArticle(task?.sourceArticleId ?? "")).toMatchObject({ business: "旧房翻新", city: "南京", targetPlatforms: [...CONTENT_STUDIO_PLATFORM_KEYS] });

    const regeneratePayload = { ...payload, targetPlatforms: ["zhihu" as const] };
    const regenerateId = repository.createContentStudioTask({ brandId: brand.id, type: "regenerate_platform", provider: provider.providerKey, model: provider.model, totalCount: 1, parentTaskId: taskId, payload: regeneratePayload });
    await runContentStudioTask(repository, createConsoleLogger(), { createAiProvider: () => provider }, regenerateId);
    const zhihuVersions = repository.listContentStudioVersions(taskId, "zhihu");
    expect(zhihuVersions).toHaveLength(2);
    expect(zhihuVersions.filter((version) => version.isCurrent)).toHaveLength(1);
    expect(zhihuVersions[0]?.versionNumber).toBe(2);
    expect(repository.getContentStudioTask(regenerateId)?.sourceArticleId).toBe(task?.sourceArticleId);
    db.close();
  });
});
