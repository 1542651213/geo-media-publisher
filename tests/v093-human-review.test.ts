import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type HumanReviewDatasetItemView, type HumanReviewSubmitInput } from "@publisher/db";
import type { ContentQualityIssue } from "@publisher/domain";

const dirs: string[] = [];
const platforms = ["wechat_official", "zhihu", "toutiao", "weibo", "douyin", "bilibili"];
const runId = "deepseek_real-v093-test-run";
const hash = (title: string, body: string, platformKey: string): string => createHash("sha256").update(`${title}\n${body}\n${platformKey}`).digest("hex");
const issue = (code: ContentQualityIssue["code"], severity: ContentQualityIssue["severity"] = "warning"): ContentQualityIssue => ({ code, severity, message: `测试风险 ${code}`, evidence: "测试证据", suggestion: "测试建议", location: "正文" });

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v093-human-review-")); dirs.push(dir);
  const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  const brand = repository.createBrand({ name: "测试品牌", companyName: "测试公司", mainBusiness: "环保服务" });
  repository.createQualityBenchmarkRun({ benchmarkRunId: runId, benchmarkId: "V091_BRAND_QUALITY_001", datasetVersion: "V0.9.2-1.0.0", runType: "DEEPSEEK_REAL", provider: "deepseek", model: "deepseek-v4-flash", promptVersion: "v0.9.2-deepseek-quality-benchmark-v1", status: "COMPLETED" });
  repository.seedQualityBenchmarkItems(Array.from({ length: 20 }, (_, topicIndex) => platforms.map((platformKey) => ({ benchmarkRunId: runId, benchmarkId: "V091_BRAND_QUALITY_001", datasetVersion: "V0.9.2-1.0.0", promptVersion: "v0.9.2-deepseek-quality-benchmark-v1", topicIndex, topic: `测试主题 ${topicIndex}`, city: topicIndex % 2 === 0 ? "南京" : "苏州", keyword: "甲醛治理", business: ["甲醛治理", "定期消杀", "灭四害", "白蚁防治", "病媒生物防制"][topicIndex % 5], platformKey, provider: "deepseek", model: "deepseek-v4-flash" }))).flat());
  for (let topicIndex = 0; topicIndex < 20; topicIndex += 1) {
    const article = repository.createArticle({ brandId: brand.id, topic: `测试主题 ${topicIndex}`, keyword: "甲醛治理", city: topicIndex % 2 === 0 ? "南京" : "苏州", title: `测试标题 ${topicIndex}`, body: `测试正文 ${topicIndex}，用于固定人工审核数据集验证。`, summary: "测试摘要", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "deepseek", aiModel: "deepseek-v4-flash", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: `article-${topicIndex}` });
    if (!article) throw new Error("测试文章创建失败");
    for (const [platformIndex, platformKey] of platforms.entries()) {
      const title = `测试内容 ${topicIndex}-${platformIndex}`;
      const body = `南京甲醛治理平台测试正文 ${topicIndex}-${platformIndex}`;
      const variant = repository.createArticleVariant({ articleId: article.id, platformKey, title, body, summary: "测试摘要", coverAssetId: null, contentHash: hash(title, body, platformKey) });
      const status = topicIndex === 0 && platformIndex < 3 ? "Approved" : topicIndex === 1 || topicIndex === 2 && platformIndex === 0 ? "Needs_Review" : "Rejected";
      const issues = status === "Approved" ? [issue("seo_quality"), issue("content_duplicate")] : status === "Needs_Review" ? [issue("brand_fact_consistency")] : [issue(platformIndex % 2 === 0 ? "false_promises" : "absolute_marketing", "error")];
      repository.saveContentQualityReview({ contentType: "article_variant", contentId: variant.id, brandId: brand.id, platformKey, contentHash: variant.contentHash, trigger: "generation", provider: "deepseek", model: "deepseek-v4-flash", result: { status, score: status === "Approved" ? 95 : status === "Needs_Review" ? 70 : 0, checks: [], issues }, snapshot: { title, body, summary: "测试摘要" }, benchmarkRunId: runId });
      repository.recordQualityBenchmarkContent({ benchmarkRunId: runId, benchmarkId: "V091_BRAND_QUALITY_001", datasetVersion: "V0.9.2-1.0.0", topicIndex, topic: `测试主题 ${topicIndex}`, city: topicIndex % 2 === 0 ? "南京" : "苏州", keyword: "甲醛治理", platformKey, contentType: "article", contentTypeId: variant.id, provider: "deepseek", model: "deepseek-v4-flash", contentHash: variant.contentHash, qualityStatus: status, riskCount: issues.length });
    }
  }
  return { db, repository };
}

function submitInput(item: HumanReviewDatasetItemView, finalStatus: HumanReviewSubmitInput["finalStatus"] = "Needs_Review", edit = false): HumanReviewSubmitInput {
  const finalContent = { ...item.originalContent, ...(edit ? { title: `${item.originalContent.title}（人工编辑）` } : {}) };
  finalContent.contentHash = hash(finalContent.title, finalContent.body, finalContent.platformKey ?? "");
  const issueDecisions: HumanReviewSubmitInput["issueDecisions"] = item.issues.map((machineIssue, index) => ({ ruleId: machineIssue.ruleId, issueIndex: index, machineDecision: "Detected", humanDecision: index % 2 === 0 ? "TruePositive" : "FalsePositive", reason: `测试人工判断 ${index}`, issue: machineIssue.issue }));
  issueDecisions.push({ ruleId: "city_consistency", issueIndex: item.issues.length, machineDecision: "NotDetected", humanDecision: "MissedIssue", reason: "测试漏检", issue: null });
  return { datasetItemId: item.id, finalStatus, reviewDurationMs: 1234, editCount: edit ? 1 : 0, originalContentHash: item.originalContentHash, finalContentHash: finalContent.contentHash, originalContent: item.originalContent, finalContent, issueDecisions, reason: "测试人工校准" };
}

describe("V0.9.3 Human Review Calibration", () => {
  it("creates one deterministic fixed sample with the requested quotas and six-platform coverage", () => {
    const { db, repository } = createFixture();
    try {
      const first = repository.ensureHumanReviewDataset("V093_HUMAN_REVIEW_001", runId);
      const second = repository.ensureHumanReviewDataset("V093_HUMAN_REVIEW_001", runId);
      expect(first.items).toHaveLength(20);
      expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
      expect(first.composition).toMatchObject({ Approved: 3, Needs_Review: 7, Rejected: 10 });
      expect(first.platforms).toEqual(platforms.slice().sort());
      expect(new Set(first.items.map((item) => item.contentId)).size).toBe(20);
      expect(first.items.every((item) => item.reviewStatus === "Pending")).toBe(true);
    } finally { db.close(); }
  });

  it("persists human TP/FP/MissedIssue, hashes, duration and edited snapshot without overwriting machine state", () => {
    const { db, repository } = createFixture();
    try {
      const dataset = repository.ensureHumanReviewDataset("V093_HUMAN_REVIEW_001", runId);
      const item = dataset.items.find((candidate) => candidate.issues.length >= 2) as HumanReviewDatasetItemView;
      expect(item).toBeDefined();
      const liveBefore = repository.getArticleVariant(item.contentId);
      const review = repository.submitHumanReview(submitInput(item, "Approved", true));
      expect(review.reviewerType).toBe("human");
      expect(review.reviewDurationMs).toBe(1234);
      expect(review.editCount).toBe(1);
      expect(review.originalContentHash).toBe(item.originalContentHash);
      expect(review.finalContent.title).toContain("人工编辑");
      expect(review.issueDecisions.map((decision) => decision.humanDecision)).toEqual(expect.arrayContaining(["TruePositive", "FalsePositive", "MissedIssue"]));
      expect(repository.getContentQualityState(item.contentType, item.contentId)?.status).toBe(item.originalStatus);
      expect(repository.getArticleVariant(item.contentId)).toMatchObject({ title: liveBefore?.title, body: liveBefore?.body, contentHash: liveBefore?.contentHash });
      expect(repository.getHumanReviewDataset("V093_HUMAN_REVIEW_001")?.status).toBe("WAITING_FOR_HUMAN_REVIEW");
      expect(repository.listJobs()).toHaveLength(0);
    } finally { db.close(); }
  });

  it("does not pollute the remaining 100 and only completes after all fixed items are reviewed", () => {
    const { db, repository } = createFixture();
    try {
      const dataset = repository.ensureHumanReviewDataset("V093_HUMAN_REVIEW_001", runId);
      const selectedIds = new Set(dataset.items.map((item) => item.contentId));
      const allContents = repository.listQualityBenchmarkContents(runId, true);
      expect(allContents.filter((content) => !selectedIds.has(content.contentTypeId))).toHaveLength(100);
      for (const item of dataset.items) repository.submitHumanReview(submitInput(item));
      expect(repository.getHumanReviewDataset("V093_HUMAN_REVIEW_001")?.status).toBe("HUMAN_REVIEW_COMPLETED");
      expect(repository.getHumanReviewDataset("V093_HUMAN_REVIEW_001")?.completedCount).toBe(20);
      expect(repository.listJobs()).toHaveLength(0);
      expect(repository.listQualityBenchmarkContents(runId, true)).toHaveLength(120);
    } finally { db.close(); }
  });
});
