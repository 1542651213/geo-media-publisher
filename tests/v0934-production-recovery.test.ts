import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError, MockAIProvider } from "@publisher/ai";
import { openDatabase, type ContentStudioTaskPayload } from "@publisher/db";
import type { ContentStudioTopicPlan } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { runContentStudioTask } from "../apps/desktop/src/main/content-studio";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function makePayload(brandId: string): ContentStudioTaskPayload {
  return {
    brandId,
    industry: "环保服务",
    cities: ["苏州"],
    city: "苏州",
    keywords: ["苏州甲醛治理"],
    keyword: "苏州甲醛治理",
    business: "甲醛治理",
    topic: "苏州甲醛治理怎么选",
    targetPlatforms: ["zhihu"],
    mediaAssetIds: [],
    videoAssetIds: [],
    concurrency: 1,
    contentGoal: "BrandPromotion",
    contentIntent: "BrandAnswer",
    searchIntent: "Commercial",
    promotionStrength: "Balanced"
  };
}

describe("V0.9.3.4 DeepSeek production recovery", () => {
  it("resets an existing source-less task with a prebuilt plan without creating a task", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v0934-reset-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    const brand = repository.createBrand({ name: "Recovery Brand", companyName: "Recovery Company" });
    const payload = makePayload(brand.id);
    const taskId = repository.createContentStudioTask({ brandId: brand.id, type: "production_intent_sample", provider: "deepseek", model: "deepseek-v4-flash", totalCount: 1, payload });
    repository.updateContentStudioTask(taskId, { completed: 1, success: 0, failed: 1, status: "failed", errorMessage: "HTTP 402" });
    const plan: ContentStudioTopicPlan = { summary: "苏州甲醛治理怎么选", topics: [{ title: "苏州甲醛治理怎么选", angle: "围绕用户问题", audience: "本地用户", keyPoints: ["服务边界"], recommendedPlatforms: ["zhihu"] }] };
    const reset = repository.resetContentStudioTaskForRecovery(taskId, { ...payload, topicPlan: plan });
    expect(repository.listContentStudioTasks()).toHaveLength(1);
    expect(reset).toMatchObject({ status: "running", completed: 0, success: 0, failed: 0, output: { topicPlan: plan } });
    db.close();
  });

  it("persists safe provider diagnostics when the provider returns a balance error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v0934-diagnostic-")); tempDirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), migrationDir);
    const brand = repository.createBrand({ name: "Recovery Brand", companyName: "Recovery Company", mainBusiness: "环保服务" });
    const provider = new MockAIProvider();
    Object.defineProperty(provider, "providerKey", { value: "deepseek" });
    Object.defineProperty(provider, "model", { value: "deepseek-v4-flash" });
    vi.spyOn(provider, "generateTopicPlan").mockRejectedValue(new AIProviderError("AI_BALANCE", "DeepSeek 账户余额不足", { provider: "deepseek", httpStatus: 402, requestId: "req-safe-1", bodySummary: '{"error":{"message":"Insufficient Balance"}}' }));
    const payload = makePayload(brand.id);
    const taskId = repository.createContentStudioTask({ brandId: brand.id, type: "production_intent_sample", provider: "deepseek", model: "deepseek-v4-flash", totalCount: 1, payload });
    await runContentStudioTask(repository, createConsoleLogger(), { createAiProvider: () => provider }, taskId);
    const task = repository.getContentStudioTask(taskId);
    db.close();
    expect(task).toMatchObject({ status: "failed", output: { providerDiagnostics: { provider: "deepseek", model: "deepseek-v4-flash", errorCode: "AI_BALANCE", httpStatus: 402, requestId: "req-safe-1", responseBodySummary: '{"error":{"message":"Insufficient Balance"}}' } } });
  });
});
