import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { conservativePlatformContentRules, evaluateContentQuality } from "@publisher/domain";
import { runQualityGateForArticle } from "../apps/desktop/src/main/quality-gate";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("V0.9 AI Quality Gate", () => {
  it("detects unsupported claims, absolute marketing and missing keyword coverage", () => {
    const brand = { id: "brand", name: "Acme", companyName: "Acme Co", description: "", mainBusiness: "", serviceRegions: [], advantages: [], contact: {}, establishedAt: "", address: "", serviceProcess: "", afterSales: "", faq: "", certificates: "", patents: "", equipment: "", cases: "", aiForbiddenClaims: [], createdAt: "", updatedAt: "" };
    const result = evaluateContentQuality({ brand, city: "南京", keyword: "旧房翻新", content: { title: "全国第一的服务", body: "Acme 提供保证结果的方案，并声称拥有国家级资质，100%清除甲醛，永不反弹。" } });
    expect(result.status).toBe("Rejected");
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["unsupported_credentials", "false_promises", "absolute_marketing", "city_keyword_coverage"]));
  });

  it("records automatic checks, manual rechecks and approval history", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-quality-history-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    const brand = repository.createBrand({ name: "Quality Brand", companyName: "Quality Company", description: "提供南京旧房翻新服务" });
    const article = repository.createArticle({ brandId: brand.id, topic: "旧房翻新", keyword: "旧房翻新", city: "南京", title: "南京旧房翻新服务说明", body: "Quality Brand 提供南京旧房翻新服务。本文说明需求沟通、现场评估、方案确认、施工流程和交付边界，具体内容以双方确认记录为准。用户可以根据实际房屋情况整理问题清单，并在沟通时逐项确认材料、时间和交付范围。文章同时说明双方如何记录修改意见、确认节点和售后边界，帮助用户在做决定前获得清晰、完整、可核对的信息。", summary: "南京旧房翻新服务说明", tags: ["南京"], seoKeywords: ["南京旧房翻新"], articleType: "科普", aiProvider: "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "quality-article" });
    if (!article) throw new Error("article not created");
    const first = runQualityGateForArticle(repository, article.id);
    expect(first.status).toBe("AI_Checked");
    expect(repository.getContentQualityState("article", article.id)?.status).toBe("AI_Checked");
    repository.decideContentQuality("article", article.id, "Approved");
    expect(repository.getContentQualityState("article", article.id)?.status).toBe("Approved");
    repository.updateArticle(article.id, { body: `${article.body} 补充人工修改内容。` });
    expect(repository.getContentQualityState("article", article.id)?.status).toBe("Draft");
    const second = runQualityGateForArticle(repository, article.id, "manual_recheck");
    expect(second.status).toBe("AI_Checked");
    expect(repository.listContentQualityReviews("article", article.id)).toHaveLength(3);
    expect(repository.listContentQualityAudits("article", article.id).some((audit) => audit.operatorType === "human" && audit.newStatus === "Draft")).toBe(true);
    db.close();
  });

  it("supports Needs_Review approval, rejection, manual edit recheck, and queue blocking for every non-approved state", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-quality-state-machine-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "State Brand", companyName: "State Company", description: "Nanjing service" });
    const article = repository.createArticle({ brandId: brand.id, topic: "service", keyword: "service", city: "Nanjing", title: "Nanjing service guide", body: "State Brand provides a documented service process including intake, site assessment, scope confirmation, execution, delivery and after-sales boundaries. The final scope follows both parties' written confirmation.", summary: "Nanjing service guide", tags: [], seoKeywords: ["service"], articleType: "guide", aiProvider: "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "state-article" });
    if (!article) throw new Error("article not created");
    const account = repository.createAccount({ platformKey: "test", name: "State Account" });
    const plan = repository.createPlan({ name: "State Plan", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: ["09:00"], reusePolicy: "once", minIntervalSeconds: 60, maxRetries: 3, consecutiveFailureThreshold: 3, startDate: "2026-08-20", endDate: null });
    expect(repository.validatePlanContentQuality(plan.id)).toHaveLength(1);
    const saveState = (status: "AI_Checked" | "Needs_Review" | "Rejected"): void => { repository.saveContentQualityReview({ contentType: "article", contentId: article.id, brandId: brand.id, platformKey: null, contentHash: article.contentHash, trigger: "manual_recheck", provider: "test", model: "test", result: { status, score: status === "AI_Checked" ? 100 : 60, checks: [], issues: [] }, snapshot: { title: article.title } }); };
    saveState("AI_Checked");
    expect(repository.validatePlanContentQuality(plan.id)).toHaveLength(1);
    saveState("Needs_Review");
    expect(repository.validatePlanContentQuality(plan.id)).toHaveLength(1);
    repository.decideContentQuality("article", article.id, "Approved", "human-review", "manual", "test approval");
    expect(repository.validatePlanContentQuality(plan.id)).toEqual([]);
    repository.updateArticle(article.id, { body: `${article.body} Manual edit.` });
    expect(repository.getContentQualityState("article", article.id)?.status).toBe("Draft");
    runQualityGateForArticle(repository, article.id, "manual_recheck");
    saveState("Rejected");
    expect(repository.validatePlanContentQuality(plan.id)).toHaveLength(1);
    expect(repository.listContentQualityAudits("article", article.id).some((audit) => audit.reason === "test approval")).toBe(true);
    db.close();
  });

  it("reads PlatformContentRules and returns an unverified conservative fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-platform-rules-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    expect(repository.getPlatformContentRules()).toHaveLength(6);
    expect(repository.getPlatformContentRule("wechat_official")).toMatchObject({ verificationStatus: "unverified", source: null, lastVerifiedAt: null });
    expect(repository.getPlatformContentRule("future-platform")).toEqual(conservativePlatformContentRules("future-platform"));
    db.close();
  });

  it("detects brand forbidden claims and city conflicts for 木渎 content", () => {
    const brand = { id: "brand", name: "Local Brand", companyName: "Local Company", description: "Provides documented service process", mainBusiness: "service", serviceRegions: ["江苏", "苏州", "木渎"], advantages: [], contact: {}, establishedAt: "", address: "", serviceProcess: "scope confirmation", afterSales: "written confirmation", faq: "", certificates: "", patents: "", equipment: "", cases: "", aiForbiddenClaims: ["国家级认证"], createdAt: "", updatedAt: "" };
    const result = evaluateContentQuality({ brand, city: "木渎", keyword: "甲醛治理", content: { title: "木渎甲醛治理服务说明", body: "Local Brand 在木渎提供甲醛治理服务，并宣称获得国家级认证。本文也出现南京内容作为冲突测试证据。服务范围以现场沟通和双方确认内容为准。" } });
    expect(result.status).toBe("Rejected");
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["brand_fact_consistency", "city_consistency"]));
  });

  it("blocks publish-plan candidates until their current hash is Approved", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-quality-queue-")); dirs.push(dir);
    const { db, repository } = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "Queue Brand", companyName: "Queue Company", description: "南京服务" });
    const article = repository.createArticle({ brandId: brand.id, topic: "服务", keyword: "服务", city: "南京", title: "南京服务说明", body: "Queue Brand 提供南京服务，本文说明沟通、评估、方案确认、交付和售后边界，具体内容以双方确认记录为准。", summary: "南京服务说明", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "deepseek", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "queue-article" });
    if (!article) throw new Error("article not created");
    const account = repository.createAccount({ platformKey: "test", name: "Quality Account" });
    const plan = repository.createPlan({ name: "Quality Plan", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: ["09:00"], reusePolicy: "once", minIntervalSeconds: 60, maxRetries: 3, consecutiveFailureThreshold: 3, startDate: "2026-08-20", endDate: null });
    expect(repository.validatePlanContentQuality(plan.id)).toHaveLength(1);
    runQualityGateForArticle(repository, article.id);
    repository.decideContentQuality("article", article.id, "Approved");
    expect(repository.validatePlanContentQuality(plan.id)).toEqual([]);
    db.close();
  });
});
