import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { conservativePlatformContentRules, evaluateContentQuality, textSimilarity } from "@publisher/domain";
import { BENCHMARK_ID, BENCHMARK_PLATFORMS, BENCHMARK_TOPICS, DATASET_VERSION, assertFrozenBenchmarkDataset } from "../scripts/v092-benchmark-dataset";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function openTestRepository() {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v092-benchmark-"));
  dirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  return opened;
}

function testBrand() {
  return { id: "brand", name: "康一环保测试", companyName: "康一环保测试公司", description: "提供甲醛治理与消杀服务", mainBusiness: "甲醛治理、定期消杀、灭四害、白蚁防治、病媒生物防制", serviceRegions: ["江苏", "苏州", "木渎"], advantages: [], contact: {}, establishedAt: "", address: "", serviceProcess: "需求沟通、现场评估、方案确认、服务实施、结果复核", afterSales: "以双方确认内容为准", faq: "", certificates: "", patents: "", equipment: "", cases: "", aiForbiddenClaims: ["国家级认证", "行业第一", "100%清除甲醛", "永久", "保证"], createdAt: "", updatedAt: "" };
}

describe("V0.9.2 DeepSeek quality benchmark", () => {
  it("freezes the same 20 topics and six existing platforms", () => {
    assertFrozenBenchmarkDataset();
    expect(BENCHMARK_TOPICS).toHaveLength(20);
    expect(BENCHMARK_PLATFORMS).toHaveLength(6);
    expect(new Set(BENCHMARK_PLATFORMS).size).toBe(6);
    expect(BENCHMARK_ID).toBe("V091_BRAND_QUALITY_001");
    expect(DATASET_VERSION).toMatch(/^V0\.9\.2-/u);
  });

  it("recovers running benchmark items and never claims a successful item again", () => {
    const { db, repository } = openTestRepository();
    repository.createQualityBenchmarkRun({ benchmarkRunId: "recovery-run", benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, runType: "DEEPSEEK_REAL", provider: "deepseek", model: "deepseek-chat", promptVersion: "test" });
    const items = repository.seedQualityBenchmarkItems([
      { benchmarkRunId: "recovery-run", benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, promptVersion: "test", topicIndex: 0, topic: "topic-0", city: "江苏", keyword: "江苏服务", business: "甲醛治理", platformKey: "wechat_official", provider: "deepseek", model: "deepseek-chat" },
      { benchmarkRunId: "recovery-run", benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, promptVersion: "test", topicIndex: 0, topic: "topic-0", city: "江苏", keyword: "江苏服务", business: "甲醛治理", platformKey: "zhihu", provider: "deepseek", model: "deepseek-chat" }
    ]);
    expect(repository.seedQualityBenchmarkItems(items.map((item) => ({ id: item.id, benchmarkRunId: item.benchmarkRunId, benchmarkId: item.benchmarkId, datasetVersion: item.datasetVersion, promptVersion: item.promptVersion, topicIndex: item.topicIndex, topic: item.topic, city: item.city, keyword: item.keyword, business: item.business, platformKey: item.platformKey, provider: item.provider, model: item.model })))).toHaveLength(2);
    const first = repository.claimQualityBenchmarkItem(items[0]?.id ?? "");
    expect(first?.status).toBe("Running");
    repository.updateQualityBenchmarkItem(first?.id ?? "", { status: "Success", contentTypeId: "variant-success" });
    expect(repository.claimQualityBenchmarkItem(first?.id ?? "")).toBeNull();
    const second = repository.claimQualityBenchmarkItem(items[1]?.id ?? "");
    expect(second?.status).toBe("Running");
    expect(repository.recoverQualityBenchmarkItems("recovery-run")).toBe(1);
    expect(repository.getQualityBenchmarkItem(second?.id ?? "")?.status).toBe("RetryableFailure");
    repository.setQualityBenchmarkControl("recovery-run", "PAUSED");
    expect(repository.claimQualityBenchmarkItem(second?.id ?? "")).toBeNull();
    repository.setQualityBenchmarkControl("recovery-run", "RUNNING");
    expect(repository.claimQualityBenchmarkItem(second?.id ?? "")?.status).toBe("Running");
    repository.updateQualityBenchmarkItem(second?.id ?? "", { status: "Failed", errorCode: "AI_INVALID_OUTPUT" });
    expect(repository.claimQualityBenchmarkItem(second?.id ?? "")).toBeNull();
    expect(repository.claimQualityBenchmarkItem(second?.id ?? "", true)?.status).toBe("Running");
    repository.recordQualityBenchmarkItemAttempt({ benchmarkItemId: second?.id ?? "", attemptNumber: 1, status: "RetryableFailure", failureCategory: "OUTPUT_TRUNCATED", finishReason: "length", responseLength: 120, requestDurationMs: 10, tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } });
    repository.recordQualityBenchmarkItemAttempt({ benchmarkItemId: second?.id ?? "", attemptNumber: 2, status: "Success", failureCategory: "NORMALIZATION_APPLIED", diagnostics: [{ category: "NORMALIZATION_APPLIED", appliedFields: ["tags=string-list"] }], responseLength: 130, requestDurationMs: 20, tokenUsage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 } });
    repository.recordQualityBenchmarkItemAttempt({ benchmarkItemId: second?.id ?? "", attemptNumber: 2, status: "Success", failureCategory: "NORMALIZATION_APPLIED", diagnostics: [{ category: "NORMALIZATION_APPLIED", appliedFields: ["tags=string-list"] }], responseLength: 130, requestDurationMs: 20, tokenUsage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 } });
    const attempts = repository.listQualityBenchmarkItemAttempts(second?.id ?? "");
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((attempt) => attempt.attemptNumber)).size).toBe(2);
    expect(attempts[0]?.failureCategory).toBe("OUTPUT_TRUNCATED");
    expect(attempts[1]?.status).toBe("Success");
    db.close();
  });

  it("keeps Mock and DeepSeek run records isolated and counts revisions separately", () => {
    const { db, repository } = openTestRepository();
    const brand = repository.createBrand({ name: "Benchmark Brand", companyName: "Benchmark Company", description: "甲醛治理服务", mainBusiness: "甲醛治理", serviceRegions: ["江苏"] });
    const mockRun = repository.createQualityBenchmarkRun({ benchmarkRunId: "mock-run", benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, runType: "MOCK_BASELINE", provider: "mock", model: "mock-editor-v0.1", promptVersion: "test" });
    const deepseekRun = repository.createQualityBenchmarkRun({ benchmarkRunId: "deepseek-run", benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, runType: "DEEPSEEK_REAL", provider: "deepseek", model: "deepseek-v4-flash", promptVersion: "test" });
    expect(mockRun.benchmarkRunId).not.toBe(deepseekRun.benchmarkRunId);
    repository.saveContentQualityReview({ contentType: "article_variant", contentId: "variant-1", brandId: brand.id, platformKey: "wechat_official", contentHash: "hash-1", trigger: "generation", provider: "mock", model: "mock-editor-v0.1", result: { status: "Needs_Review", score: 60, checks: [], issues: [{ code: "content_duplicate", severity: "warning", message: "duplicate" }] }, snapshot: {} });
    repository.recordQualityBenchmarkContent({ benchmarkRunId: mockRun.benchmarkRunId, benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, topicIndex: 0, topic: "topic", city: "江苏", keyword: "江苏甲醛治理", platformKey: "wechat_official", contentType: "article", contentTypeId: "variant-1", provider: "mock", model: "mock-editor-v0.1", contentHash: "hash-1", qualityStatus: "Needs_Review", riskCount: 1 });
    repository.decideContentQuality("article_variant", "variant-1", "Approved", "human-review", "manual", "test approval");
    repository.recordQualityBenchmarkContent({ benchmarkRunId: mockRun.benchmarkRunId, benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, topicIndex: 0, topic: "topic", city: "江苏", keyword: "江苏甲醛治理", platformKey: "wechat_official", contentType: "article", contentTypeId: "variant-1", provider: "mock", model: "mock-editor-v0.1", contentHash: "hash-2", qualityStatus: "Approved", riskCount: 0, revisionNumber: 1 });
    const metrics = repository.getQualityBenchmarkMetrics(mockRun.benchmarkRunId);
    expect(metrics.generatedVariantCount).toBe(1);
    expect(metrics.currentUniqueContentCount).toBe(1);
    expect(metrics.currentStatusCount.Approved).toBe(1);
    expect(metrics.reviewEventCount).toBe(2);
    expect(metrics.revisionCount).toBe(1);
    expect(metrics.approvedUniqueContentCount).toBe(1);
    expect(repository.listQualityBenchmarkContents(deepseekRun.benchmarkRunId)).toHaveLength(0);
    expect(repository.listContentQualityAudits("article_variant", "variant-1").every((audit) => audit.contentHash.length > 0)).toBe(true);
    db.close();
  });

  it("routes malicious claims and city conflict to rejection, while city-only replacement needs review", () => {
    const brand = testBrand();
    const malicious = evaluateContentQuality({ brand, city: "木渎", keyword: "木渎甲醛治理", content: { title: "木渎甲醛治理行业第一", body: "国家级认证，100%清除甲醛，永不反弹，一次治理永久有效；拥有不存在的专利。", summary: "木渎甲醛治理" }, knownCities: brand.serviceRegions, platformRules: conservativePlatformContentRules("wechat_official") });
    expect(malicious.status).toBe("Rejected");
    expect(malicious.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["unsupported_credentials", "false_promises", "absolute_marketing"]));
    const cityConflict = evaluateContentQuality({ brand, city: "木渎", keyword: "木渎白蚁防治", content: { title: "木渎白蚁防治服务", body: "康一环保在南京提供木渎白蚁防治服务，具体范围以双方确认资料为准，服务流程包括需求沟通、现场评估、方案确认和结果复核。" }, knownCities: brand.serviceRegions, platformRules: conservativePlatformContentRules("zhihu") });
    expect(cityConflict.status).toBe("Rejected");
    expect(cityConflict.issues.some((item) => item.code === "city_consistency")).toBe(true);
    const cityReplacement = evaluateContentQuality({ brand, city: "江苏", keyword: "江苏甲醛治理", content: { title: "江苏甲醛治理服务判断", body: "康一环保在江苏提供甲醛治理服务，先确认现场情况、服务流程、交付边界和复核安排，具体以双方确认资料为准。" }, knownCities: brand.serviceRegions, similarTexts: ["康一环保在苏州提供甲醛治理服务，先确认现场情况、服务流程、交付边界和复核安排，具体以双方确认资料为准。"], platformRules: conservativePlatformContentRules("toutiao") });
    expect(cityReplacement.status).toBe("Needs_Review");
    expect(cityReplacement.issues.some((item) => item.code === "content_duplicate")).toBe(true);
    expect(textSimilarity("江苏甲醛治理现场评估流程", "苏州甲醛治理现场评估流程")).toBeGreaterThan(0.5);
  });

  it("supports Needs_Review to Approved and Needs_Review to Rejected with persisted audit data", () => {
    const { db, repository } = openTestRepository();
    const brand = repository.createBrand({ name: "State Brand", companyName: "State Company", description: "甲醛治理服务", mainBusiness: "甲醛治理", serviceRegions: ["江苏"] });
    const save = (id: string): void => { repository.saveContentQualityReview({ contentType: "article_variant", contentId: id, brandId: brand.id, platformKey: "wechat_official", contentHash: `${id}-hash`, trigger: "generation", provider: "mock", model: "mock-editor-v0.1", result: { status: "Needs_Review", score: 60, checks: [], issues: [] }, snapshot: {} }); };
    save("approved-variant");
    repository.decideContentQuality("article_variant", "approved-variant", "Approved", "human-review", "manual", "approved after inspection");
    save("rejected-variant");
    repository.decideContentQuality("article_variant", "rejected-variant", "Rejected", "human-review", "manual", "rejected after inspection");
    expect(repository.getContentQualityState("article_variant", "approved-variant")?.status).toBe("Approved");
    expect(repository.getContentQualityState("article_variant", "rejected-variant")?.status).toBe("Rejected");
    expect(repository.listContentQualityAudits("article_variant", "approved-variant").some((audit) => audit.previousStatus === "Needs_Review" && audit.newStatus === "Approved" && audit.reason === "approved after inspection")).toBe(true);
    expect(repository.listContentQualityAudits("article_variant", "rejected-variant").some((audit) => audit.previousStatus === "Needs_Review" && audit.newStatus === "Rejected" && audit.reason === "rejected after inspection")).toBe(true);
    db.close();
  });
});
