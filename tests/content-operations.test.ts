import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type AppRepository, type GenerationHistory } from "@publisher/db";
import type Database from "better-sqlite3";
import { ContentOperations, type ContentOperationsAIPort } from "../apps/desktop/src/main/content-operations";
import { AIProductCenter, type StudioOutput } from "../apps/desktop/src/main/ai-product-center";
import type { OperationsRuntimeHealth } from "../apps/desktop/src/shared/content-operations";
import type { CredentialStore } from "@publisher/security";

const roots: Array<{ root: string; db: Database.Database }> = [];

function fixture(ai?: ContentOperationsAIPort): { repository: AppRepository; operations: ContentOperations } {
  const root = mkdtempSync(join(tmpdir(), "geo-content-operations-"));
  const { repository, db } = openDatabase(join(root, "publisher.db"), resolve("packages/db/migrations"));
  roots.push({ root, db });
  repository.seedDevelopment(resolve("PLATFORMS.csv"));
  repository.upsertAiProviderProfile({ id: "profile", name: "Fixture", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "fixture", credentialRef: "ai:provider:profile", temperature: 0.7, maxOutputTokens: 1000, timeoutMs: 1000, retryCount: 0, concurrency: 2, enabled: true, isDefault: true, isFallback: false });
  repository.db.prepare("INSERT OR IGNORE INTO ai_prompt_templates(template_id,version,template_json) VALUES('industry',1,?)").run(JSON.stringify({ templateId: "industry", name: "行业科普", version: 1, targetPlatform: null, contentType: "article", systemPrompt: "fixture", userPromptTemplate: "{{source}}", enabled: true }));
  if (ai instanceof FakeAI) ai.repository = repository;
  return { repository, operations: new ContentOperations(repository, ai ?? new FakeAI()) };
}

function createBrand(repository: AppRepository, name: string) {
  return repository.createBrand({ name, companyName: `${name}有限公司` });
}

function createArticle(repository: AppRepository, companyId: string, title: string, body: string, source: "production" | "content_studio" | "excel_import" = "production") {
  const article = repository.createArticle({ brandId: companyId, topic: "运营", keyword: "运营", city: "南京", title, body, summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: source === "content_studio" ? "fixture" : "manual", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: `${companyId}-${title}-${body}`, source });
  if (!article) throw new Error("article fixture required");
  return article;
}

class FakeAI implements ContentOperationsAIPort {
  repository: AppRepository | null = null;
  private readonly generationCompanies = new Map<string, string>();
  configured = true;
  calls = 0;
  failureCodes: string[] = [];
  saveCalls = 0;
  crashAfterNextSave = false;
  readonly requests: Array<{ generationId: string; companyId: string; sourceArticleId: string | null; targetPlatforms: string[] }> = [];
  readonly histories: GenerationHistory[] = [];
  profiles() { return [{ id: "profile", provider: "openai" as const, displayName: "Fixture", baseUrl: "https://api.openai.com/v1", defaultModel: "fixture", configured: this.configured, isDefault: true, lastVerifiedAt: null, verificationStatus: "NotVerified" }]; }
  async generate(payload: unknown): Promise<StudioOutput[]> {
    this.calls += 1;
    const input = payload as { companyId: string; sourceArticleId: string | null; targetPlatforms: string[] };
    return input.targetPlatforms.map((platformKey, index) => {
      const generationId = `generation-${this.calls}-${index}`;
      this.generationCompanies.set(generationId, input.companyId);
      this.requests.push({ generationId, companyId: input.companyId, sourceArticleId: input.sourceArticleId, targetPlatforms: input.targetPlatforms });
      const errorCode = this.failureCodes.shift() ?? null;
      const status = errorCode === "TRANSPORT_UNKNOWN" ? "Unknown" : errorCode ? "Failed" : "Generated";
      const history: GenerationHistory = { generationId, companyId: input.companyId, sourceArticleId: null, provider: "openai", model: "fixture", templateId: "industry", templateVersion: 1, targetPlatform: platformKey, createdAt: new Date().toISOString(), status, errorCode, outputArticleId: null, variantId: null };
      this.histories.push(history);
      this.repository?.db.prepare("INSERT INTO ai_generation_history(generation_id,company_id,source_article_id,provider,model,template_id,template_version,target_platform,created_at,status,error_code,output_article_id,variant_id) VALUES(?,?,?,'openai','fixture','industry',1,?,?,?,?,NULL,NULL)").run(generationId, input.companyId, input.sourceArticleId, platformKey, history.createdAt, status, errorCode);
      const title = errorCode ? "" : `生成标题 ${this.calls}`, body = errorCode ? "" : `生成正文 ${this.calls}`;
      if (!errorCode) this.repository?.db.prepare("INSERT INTO ai_local_drafts(generation_id,title,body,validation_json,content_type) VALUES(?,?,?,?,?)").run(generationId, title, body, JSON.stringify({ errors: [], warnings: [] }), "article");
      return { generationId, title, body, validation: { errors: errorCode ? [errorCode] : [], warnings: [] }, contentType: "article", status, platformKey };
    });
  }
  saveDraft(id: string): { articleId: string; variantId: string | null } {
    if (!this.repository) throw new Error("repository fixture missing");
    this.saveCalls += 1;
    const generation = id.split("-")[1] ?? "0";
    const companyId = this.generationCompanies.get(id);
    if (!companyId) throw new Error("generation company missing");
    const article = createArticle(this.repository, companyId, `生成标题 ${generation} ${id}`, `生成正文 ${generation}`, "content_studio");
    const request = this.requests.find((item) => item.generationId === id);
    const variant = request?.sourceArticleId ? this.repository.createArticleVariant({ articleId: request.sourceArticleId, platformKey: request.targetPlatforms[0]!, title: article.title, body: article.body, summary: "", coverAssetId: null, contentHash: `${id}-variant` }) : null;
    this.repository.db.prepare("UPDATE ai_generation_history SET status='Saved',output_article_id=?,variant_id=? WHERE generation_id=?").run(article.id, variant?.id ?? null, id);
    if (this.crashAfterNextSave) { this.crashAfterNextSave = false; throw Object.assign(new Error("simulated process interruption after save"), { code: "SIMULATED_PROCESS_CRASH" }); }
    return { articleId: article.id, variantId: variant?.id ?? null };
  }
  history(companyId?: string): GenerationHistory[] { return companyId ? this.histories.filter((item) => item.companyId === companyId) : this.histories; }
}

afterEach(() => {
  while (roots.length) {
    const entry = roots.pop()!;
    entry.db.close();
    rmSync(entry.root, { recursive: true, force: true });
  }
});

describe("company-scoped operations", () => {
  it("initializes legacy bindings only from a sole company and leaves later ambiguous accounts unassigned", () => {
    const ai = new FakeAI();
    const { repository, operations } = fixture(ai);
    const sole = repository.listBrands()[0]!;
    expect(repository.listAccounts().every((account) => operations.accountCompany(account.id) === sole.id)).toBe(true);
    createBrand(repository, "第二企业");
    const ambiguous = repository.createAccount({ platformKey: "test", name: "无历史归属账号" });
    const restarted = new ContentOperations(repository, ai);
    expect(restarted.accountCompany(ambiguous.id)).toBeNull();
    expect(restarted.snapshot(sole.id).ownerActions.some((item) => item.id === `account-binding:${ambiguous.id}`)).toBe(false);
  });

  it("keeps unassigned accounts out of every company and rejects cross-company rebinding", () => {
    const { repository, operations } = fixture();
    const a = createBrand(repository, "甲"), b = createBrand(repository, "乙");
    const account = repository.createAccount({ platformKey: "test", name: "账号" });

    expect(operations.accountCompany(account.id)).toBeNull();
    expect(operations.listUnboundAccounts()).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: account.id, platformKey: "test" })]));
    expect(operations.snapshot(a.id).accounts).toEqual([]);
    operations.bindAccount({ companyId: a.id, accountId: account.id });
    expect(operations.accountCompany(account.id)).toBe(a.id);
    expect(operations.snapshot(a.id).accounts.map((item) => item.accountId)).toEqual([account.id]);
    expect(operations.snapshot(b.id).accounts).toEqual([]);
    expect(() => operations.bindAccount({ companyId: b.id, accountId: account.id })).toThrow("已绑定");
  });

  it("derives Owner actions from runtime health for exact current-company accounts", () => {
    const ai = new FakeAI();
    const { repository, operations } = fixture(ai);
    const a = createBrand(repository, "运行态甲"), b = createBrand(repository, "运行态乙");
    const accountA = repository.createAccount({ platformKey: "test", name: "甲账号" });
    const accountB = repository.createAccount({ platformKey: "test", name: "乙账号" });
    operations.bindAccount({ companyId: a.id, accountId: accountA.id });
    operations.bindAccount({ companyId: b.id, accountId: accountB.id });
    repository.updateAccount(accountA.id, { loginStatus: "logged_in" });
    expect(operations.snapshot(a.id).ownerActions[0]).toMatchObject({ id: `account:${accountA.id}`, action: expect.stringContaining("刷新账号验证状态"), lastCheckedAt: null });
    const runtime = new Map<string, OperationsRuntimeHealth>([[accountA.id, { state: "NETWORK_UNAVAILABLE", checkedAt: "2026-10-01T01:00:00.000Z" }], [accountB.id, { state: "NEEDS_LOGIN", checkedAt: "2026-10-01T01:01:00.000Z" }]]);
    const runtimeOperations = new ContentOperations(repository, ai, accountId => runtime.get(accountId) ?? null);

    expect(runtimeOperations.snapshot(a.id).ownerActions).toEqual([expect.objectContaining({ id: `account:${accountA.id}`, action: expect.stringContaining("稍后重试"), lastCheckedAt: "2026-10-01T01:00:00.000Z" })]);
    expect(runtimeOperations.snapshot(a.id).ownerActions.some((item) => item.id === `account:${accountB.id}`)).toBe(false);
    runtime.set(accountA.id, { state: "CHECKING", checkedAt: "2026-10-01T01:02:00.000Z" });
    expect(runtimeOperations.snapshot(a.id).ownerActions).toEqual([]);
    runtime.set(accountA.id, { state: "NEEDS_LOGIN", checkedAt: "2026-10-01T01:03:00.000Z" });
    expect(runtimeOperations.snapshot(a.id).ownerActions[0]).toMatchObject({ action: expect.stringContaining("正常登录") });
    runtime.set(accountA.id, { state: "CREDENTIAL_INVALID", checkedAt: "2026-10-01T01:04:00.000Z" });
    expect(runtimeOperations.snapshot(a.id).ownerActions[0]).toMatchObject({ action: expect.stringContaining("更新凭据") });
    runtime.set(accountA.id, { state: "IDENTITY_MISMATCH", checkedAt: "2026-10-01T01:05:00.000Z" });
    expect(runtimeOperations.snapshot(a.id).ownerActions[0]).toMatchObject({ action: expect.stringContaining("修正账号绑定") });
  });

  it("persists validated Studio defaults independently for each company", () => {
    const { repository, operations } = fixture();
    const a = createBrand(repository, "默认甲"), b = createBrand(repository, "默认乙");
    const saved = operations.saveStudioDefaults({ companyId: a.id, profileId: "profile", model: "fixture-model", templateId: "industry", templateVersion: 1, purpose: "生成文章", targetPlatforms: ["douyin", "website"] });
    expect(saved).toMatchObject({ companyId: a.id, profileId: "profile", purpose: "生成文章", targetPlatforms: ["douyin", "website"] });
    expect(operations.getStudioDefaults(a.id)).toEqual(saved);
    expect(operations.getStudioDefaults(b.id).companyId).toBe(b.id);
    expect(operations.getStudioDefaults(b.id).targetPlatforms).not.toEqual(saved.targetPlatforms);
    expect(() => operations.saveStudioDefaults({ companyId: a.id, profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1, purpose: "生成文章", targetPlatforms: ["not-a-platform"] })).toThrow();
    const columns = repository.db.prepare("PRAGMA table_info(operations_studio_defaults)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining(["prompt", "api_key", "credential"]));
  });

  it("approves only the current article hash and reuses the existing quality state", () => {
    const { repository, operations } = fixture();
    const company = createBrand(repository, "审核企业");
    const article = createArticle(repository, company.id, "待审核", "第一版", "content_studio");
    repository.saveContentQualityReview({ contentType: "article", contentId: article.id, brandId: company.id, platformKey: null, contentHash: article.contentHash, trigger: "manual_review", provider: "fixture", model: "fixture", result: { status: "Needs_Review", score: 70, checks: [], issues: [] }, snapshot: {} });

    operations.reviewArticle({ companyId: company.id, articleId: article.id, action: "approve", expectedContentHash: article.contentHash, reason: "人工确认" });
    expect(repository.getContentQualityState("article", article.id)?.status).toBe("Approved");
    expect(operations.approvedForPublish(company.id, article.id)).toBe(true);
    const changed = repository.updateArticle(article.id, { body: "第二版" });
    expect(repository.getContentQualityState("article", article.id)?.status).toBe("Draft");
    expect(operations.approvedForPublish(company.id, article.id)).toBe(false);
    expect(() => operations.reviewArticle({ companyId: company.id, articleId: article.id, action: "approve", expectedContentHash: article.contentHash })).toThrow("内容已变更");
    expect(changed.contentHash).not.toBe(article.contentHash);
  });

  it("creates deterministic 7/30 day plans and manual draft articles without scheduler jobs", () => {
    const { repository, operations } = fixture();
    const company = createBrand(repository, "计划企业");

    expect(operations.generatePlan({ companyId: company.id, days: 7, startDate: "2026-10-01", targetPlatforms: ["douyin"] })).toHaveLength(7);
    expect(operations.generatePlan({ companyId: company.id, days: 30, startDate: "2026-11-01", targetPlatforms: ["website"] })).toHaveLength(30);
    const manual = operations.createPlanItem({ companyId: company.id, date: "2026-12-01", topic: "人工主题", contentType: "FAQ", targetPlatforms: ["website"] });
    const draft = operations.createDraftFromPlan({ companyId: company.id, planId: manual.id, title: "人工主题草稿", body: "仅创建草稿。" });
    const other = createBrand(repository, "计划乙");
    const otherPlan = operations.createPlanItem({ companyId: other.id, date: "2026-12-01", topic: "人工主题", contentType: "FAQ", targetPlatforms: ["website"] });
    const otherDraft = operations.createDraftFromPlan({ companyId: other.id, planId: otherPlan.id, title: "人工主题草稿", body: "仅创建草稿。" });

    expect(repository.getArticle(draft.articleId)).toMatchObject({ brandId: company.id, status: "draft" });
    expect(repository.getArticle(otherDraft.articleId)).toMatchObject({ brandId: other.id, status: "draft" });
    expect(repository.getArticle(otherDraft.articleId)?.contentHash).not.toBe(repository.getArticle(draft.articleId)?.contentHash);
    expect(repository.listJobs()).toEqual([]);
  });

  it("prepares and consumes a company-scoped AI plan seed exactly once while reusing the linked source draft", () => {
    const { repository, operations } = fixture();
    const a = createBrand(repository, "AI 计划甲"), b = createBrand(repository, "AI 计划乙");
    const plan = operations.createPlanItem({ companyId: a.id, date: "2026-12-02", topic: "甲醛治理常见问题", contentType: "FAQ", targetPlatforms: ["douyin", "website"] });

    const first = operations.preparePlanGeneration({ companyId: a.id, planId: plan.id });
    const again = operations.preparePlanGeneration({ companyId: a.id, planId: plan.id });
    expect(again).toEqual(first);
    expect(repository.getArticle(first.articleId)).toMatchObject({ brandId: a.id, title: plan.topic, body: "内容计划：甲醛治理常见问题\n内容类型：FAQ\n请在 AI Content Studio 中基于已批准企业事实生成正文。", status: "draft" });
    expect(operations.snapshot(a.id).plans.find((item) => item.id === plan.id)).toMatchObject({ status: "DraftCreated", articleId: first.articleId });
    expect(repository.getSettings()[`operationsPendingAIPlanSource:${a.id}`]).toBe(first.articleId);
    expect(operations.consumePlanGenerationSeed(b.id)).toBeNull();
    expect(() => operations.preparePlanGeneration({ companyId: b.id, planId: plan.id })).toThrow("企业不匹配");
    expect(operations.consumePlanGenerationSeed(a.id)).toEqual({ articleId: first.articleId, topic: plan.topic, targetPlatforms: ["douyin", "website"] });
    expect(operations.consumePlanGenerationSeed(a.id)).toBeNull();
    expect(repository.getSettings()).not.toHaveProperty(`operationsPendingAIPlanSource:${a.id}`);
    expect((repository.db.prepare("SELECT COUNT(*) count FROM articles WHERE brand_id=? AND topic=?").get(a.id, plan.topic) as { count: number }).count).toBe(1);
    expect(repository.listJobs()).toEqual([]);
  });

  it("returns reviewed content to Draft and archives only the current hash", () => {
    const { repository, operations } = fixture();
    const company = createBrand(repository, "退回企业");
    const article = createArticle(repository, company.id, "退回审核", "正文", "content_studio");
    repository.saveContentQualityReview({ contentType: "article", contentId: article.id, brandId: company.id, platformKey: null, contentHash: article.contentHash, trigger: "manual_review", provider: "fixture", model: "fixture", result: { status: "Needs_Review", score: 60, checks: [], issues: [] }, snapshot: {} });
    expect(operations.reviewArticle({ companyId: company.id, articleId: article.id, action: "return_to_draft", expectedContentHash: article.contentHash }).reviewStatus).toBe("Draft");
    const current = repository.getArticle(article.id)!;
    repository.saveContentQualityReview({ contentType: "article", contentId: current.id, brandId: company.id, platformKey: null, contentHash: current.contentHash, trigger: "manual_review", provider: "fixture", model: "fixture", result: { status: "Needs_Review", score: 60, checks: [], issues: [] }, snapshot: {} });
    operations.reviewArticle({ companyId: company.id, articleId: current.id, action: "approve", expectedContentHash: current.contentHash });
    expect(operations.approvedForPublish(company.id, current.id)).toBe(true);
    expect(operations.reviewArticle({ companyId: company.id, articleId: article.id, action: "archive", expectedContentHash: current.contentHash }).articleStatus).toBe("archived");
    expect(operations.approvedForPublish(company.id, article.id)).toBe(false);
  });

  it("injects only approved unexpired facts from the exact company", () => {
    const { repository, operations } = fixture();
    const a = createBrand(repository, "事实甲"), b = createBrand(repository, "事实乙");
    operations.saveFact({ companyId: a.id, category: "主营业务", statement: "甲公司提供已确认服务", source: "Manual", sourceDate: "2026-09-01", verifiedAt: "2026-09-02T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", approvedForAI: true, notes: "" });
    operations.saveFact({ companyId: a.id, category: "价格规则", statement: "过期事实", source: "Manual", sourceDate: "2025-01-01", verifiedAt: "2025-01-02T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z", approvedForAI: true, notes: "" });
    operations.saveFact({ companyId: b.id, category: "主营业务", statement: "乙公司事实", source: "Manual", sourceDate: "2026-09-01", verifiedAt: "2026-09-02T00:00:00.000Z", expiresAt: null, approvedForAI: true, notes: "" });

    expect(operations.activeFacts(a.id, new Date("2026-10-01T00:00:00.000Z"))).toEqual([expect.objectContaining({ statement: "甲公司提供已确认服务" })]);
  });

  it("warns about normalized duplicates only inside the same company", () => {
    const { repository, operations } = fixture();
    const a = createBrand(repository, "去重甲"), b = createBrand(repository, "去重乙");
    createArticle(repository, a.id, "空气 治理！", "正文 A。\n流程");
    createArticle(repository, b.id, "空气治理", "正文A流程");

    expect(operations.duplicateWarnings({ companyId: a.id, title: " 空气治理 ", body: "正文A流程" })).toMatchObject({ exactTitleCount: 1, exactBodyCount: 1 });
    expect(operations.duplicateWarnings({ companyId: b.id, title: "不存在", body: "不存在" })).toMatchObject({ exactTitleCount: 0, exactBodyCount: 0 });
  });

  it("persists bounded draft queues, blocks unconfigured providers and never creates publish jobs", async () => {
    const ai = new FakeAI();
    const { repository, operations } = fixture(ai);
    const a = createBrand(repository, "队列甲"), b = createBrand(repository, "队列乙");
    const queue = operations.createGenerationQueue({ companyId: a.id, topic: "甲醛治理", requestedCount: 2, targetPlatforms: ["douyin", "website"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1, concurrency: 2 });
    expect(() => operations.generationQueue({ companyId: b.id, queueId: queue.id })).toThrow("企业不匹配");
    await operations.runGenerationQueue({ companyId: a.id, queueId: queue.id });

    expect(operations.generationQueue({ companyId: a.id, queueId: queue.id })).toMatchObject({ status: "Completed", completedCount: 6, failedCount: 0, concurrency: 1, executionPolicy: "SerialPerCompany" });
    expect(ai.calls).toBe(6);
    expect(ai.requests.filter((item) => item.sourceArticleId === null)).toHaveLength(2);
    expect(ai.requests.filter((item) => item.sourceArticleId !== null)).toHaveLength(4);
    expect(repository.listJobs()).toEqual([]);

    ai.configured = false;
    const blocked = operations.createGenerationQueue({ companyId: a.id, topic: "未配置", requestedCount: 1, targetPlatforms: ["douyin"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 });
    await operations.runGenerationQueue({ companyId: a.id, queueId: blocked.id });
    expect(operations.generationQueue({ companyId: a.id, queueId: blocked.id })).toMatchObject({ status: "Failed", failedCount: 2 });
    expect(operations.snapshot(a.id).generationItems.find((item) => item.queueId === blocked.id)).toMatchObject({ status: "Blocked", errorCode: "BLOCKED_PROVIDER_NOT_CONFIGURED" });
  });

  it("blocks a real AI validation-red draft until an explicit human save is reconciled without replay", async () => {
    const { repository } = fixture();
    const credentials = new Map<string, string>();
    const store: CredentialStore = { get: key => credentials.get(key) ?? null, has: key => credentials.has(key), set: (key, value) => { credentials.set(key, value); }, delete: key => { credentials.delete(key); } };
    let requests = 0;
    const ai = new AIProductCenter(repository, store, async () => {
      requests += 1;
      if (requests === 2) throw new Error("request outcome unknown");
      const title = requests === 1 ? "甲".repeat(21) : "流程说明";
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title, body: "甲企业流程资料" }) } }] }));
    });
    const profile = ai.saveProfile({ provider: "custom", displayName: "真实端口夹具", baseUrl: "http://127.0.0.1:19081/v1", defaultModel: "fixture-model", isDefault: true });
    ai.setCredential(profile.id, "non-production-fixture");
    const operations = new ContentOperations(repository, ai), company = createBrand(repository, "验证红项企业");
    const queue = operations.createGenerationQueue({ companyId: company.id, topic: "验证红项", requestedCount: 1, targetPlatforms: ["douyin"], profileId: profile.id, model: "fixture-model", templateId: "industry", templateVersion: 1 });

    await operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    const source = operations.snapshot(company.id).generationItems.find((item) => item.queueId === queue.id && item.itemKind === "Source")!;
    expect(source).toMatchObject({ status: "Blocked", errorCode: "CONTENT_VALIDATION_REQUIRED" });
    expect(() => operations.retryFailedGeneration({ companyId: company.id, queueId: queue.id })).toThrow("没有可重试");
    expect(requests).toBe(2);

    ai.saveDraft(source.generationId!, "流程说明", "甲企业流程资料");
    expect(operations.reconcileGenerationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Pending");
    await operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    expect(requests).toBe(3);
    expect(ai.history(company.id).filter((entry) => entry.sourceArticleId === null)).toHaveLength(1);
    expect(operations.snapshot(company.id).generationItems.find((item) => item.id === source.id)).toMatchObject({ status: "Completed", generationId: source.generationId });
    expect(repository.listJobs()).toEqual([]);
  });

  it("recovers interrupted generation as explicit recoverable work without replay", () => {
    const ai = new FakeAI();
    const { repository, operations } = fixture(ai);
    const company = createBrand(repository, "恢复企业");
    const queue = operations.createGenerationQueue({ companyId: company.id, topic: "恢复", requestedCount: 1, targetPlatforms: ["douyin"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 });
    repository.db.prepare("UPDATE operations_generation_queues SET status='Running' WHERE id=?").run(queue.id);
    repository.db.prepare("UPDATE operations_generation_items SET status='Running' WHERE queue_id=?").run(queue.id);

    const restarted = new ContentOperations(repository, ai);
    expect(restarted.generationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Failed");
    expect(restarted.snapshot(company.id).generationItems[0]).toMatchObject({ status: "Recoverable", errorCode: "INTERRUPTED_RESULT_UNKNOWN" });
    expect(ai.calls).toBe(0);
  });

  it("reconciles an exactly linked Saved generation on restart without replaying its source request", async () => {
    const ai = new FakeAI();
    const { repository, operations } = fixture(ai);
    const company = createBrand(repository, "已保存恢复企业");
    const queue = operations.createGenerationQueue({ companyId: company.id, topic: "已保存恢复", requestedCount: 1, targetPlatforms: ["douyin"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 });
    const sourceItem = operations.snapshot(company.id).generationItems.find((item) => item.queueId === queue.id && item.itemKind === "Source")!;
    const savedArticle = createArticle(repository, company.id, "已保存稿", "已保存正文", "content_studio");
    repository.db.prepare("INSERT INTO ai_generation_history(generation_id,company_id,source_article_id,provider,model,template_id,template_version,target_platform,created_at,status,error_code,output_article_id,variant_id) VALUES('saved-before-restart',?,NULL,'openai','fixture','industry',1,'douyin',?,'Saved',NULL,?,NULL)").run(company.id, new Date().toISOString(), savedArticle.id);
    repository.db.prepare("UPDATE operations_generation_queues SET status='Running' WHERE id=?").run(queue.id);
    repository.db.prepare("UPDATE operations_generation_items SET status='Running',generation_id='saved-before-restart' WHERE id=?").run(sourceItem.id);

    const restarted = new ContentOperations(repository, ai);
    expect(restarted.snapshot(company.id).generationItems.find((item) => item.id === sourceItem.id)).toMatchObject({ status: "Completed", generationId: "saved-before-restart", outputArticleId: savedArticle.id, sourceDraftId: savedArticle.id });
    await restarted.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    expect(ai.requests.filter((request) => request.sourceArticleId === null)).toHaveLength(0);
    expect(ai.requests.filter((request) => request.sourceArticleId === savedArticle.id)).toHaveLength(1);
    expect(restarted.generationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Completed");
  });

  it("durably links a known generation before save and resumes it after an interrupted save without a second source request", async () => {
    const ai = new FakeAI();
    ai.crashAfterNextSave = true;
    const { repository, operations } = fixture(ai);
    const company = createBrand(repository, "保存中断企业");
    const queue = operations.createGenerationQueue({ companyId: company.id, topic: "保存中断", requestedCount: 1, targetPlatforms: ["douyin"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 });

    await operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    const interruptedSource = operations.snapshot(company.id).generationItems.find((item) => item.queueId === queue.id && item.itemKind === "Source")!;
    expect(interruptedSource).toMatchObject({ status: "Failed", generationId: "generation-1-0" });
    expect((repository.db.prepare("SELECT COUNT(*) count FROM articles WHERE brand_id=? AND source='content_studio'").get(company.id) as { count: number }).count).toBe(0);

    const restarted = new ContentOperations(repository, ai);
    restarted.retryFailedGeneration({ companyId: company.id, queueId: queue.id });
    await restarted.runGenerationQueue({ companyId: company.id, queueId: queue.id });

    expect(ai.requests.filter((request) => request.sourceArticleId === null)).toHaveLength(1);
    expect(restarted.generationQueue({ companyId: company.id, queueId: queue.id })).toMatchObject({ status: "Completed", completedCount: 2 });
    expect((repository.db.prepare("SELECT COUNT(*) count FROM articles WHERE brand_id=? AND source='content_studio'").get(company.id) as { count: number }).count).toBe(2);
  });

  it("backs off and retries an explicit provider 429 but never replays an unknown transport result", async () => {
    const ai = new FakeAI();
    ai.failureCodes.push("RATE_LIMITED");
    const { repository, operations } = fixture(ai);
    const company = createBrand(repository, "限流企业");
    const queue = operations.createGenerationQueue({ companyId: company.id, topic: "限流", requestedCount: 1, targetPlatforms: ["douyin"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 });
    await operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    expect(ai.calls).toBe(3);
    expect(operations.generationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Completed");

    ai.failureCodes.push("TRANSPORT_UNKNOWN");
    const unknown = operations.createGenerationQueue({ companyId: company.id, topic: "未知结果", requestedCount: 1, targetPlatforms: ["website"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 });
    await operations.runGenerationQueue({ companyId: company.id, queueId: unknown.id });
    expect(ai.calls).toBe(4);
    expect(operations.snapshot(company.id).generationItems.find((item) => item.queueId === unknown.id)).toMatchObject({ status: "Recoverable", errorCode: "TRANSPORT_UNKNOWN" });
    expect(() => operations.retryFailedGeneration({ companyId: company.id, queueId: unknown.id })).toThrow("没有可重试");
  });

  it("uses one atomic runner and cancellation during provider await never saves a post-cancel article", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class SlowAI extends FakeAI {
      override async generate(payload: unknown): Promise<StudioOutput[]> { await gate; return super.generate(payload); }
    }
    const ai = new SlowAI();
    const { repository, operations } = fixture(ai);
    const company = createBrand(repository, "取消企业");
    const queue = operations.createGenerationQueue({ companyId: company.id, topic: "取消", requestedCount: 1, targetPlatforms: ["douyin"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1, concurrency: 4 });
    const first = operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const second = operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    operations.cancelGenerationQueue({ companyId: company.id, queueId: queue.id });
    release();
    await Promise.all([first, second]);

    expect(ai.calls).toBe(1);
    expect(ai.saveCalls).toBe(0);
    expect(operations.generationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Cancelled");
    expect(repository.listArticles({ brandId: company.id })).toEqual([]);
  });

  it("rejects unsupported generation targets at the Main boundary", () => {
    const { repository, operations } = fixture();
    const company = createBrand(repository, "平台边界企业");
    expect(() => operations.createGenerationQueue({ companyId: company.id, topic: "边界", requestedCount: 1, targetPlatforms: ["unknown-platform"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 })).toThrow();
  });

  it("pauses and resumes without generating until an explicit run", async () => {
    const ai = new FakeAI();
    const { repository, operations } = fixture(ai);
    const company = createBrand(repository, "暂停企业");
    const queue = operations.createGenerationQueue({ companyId: company.id, topic: "暂停", requestedCount: 1, targetPlatforms: ["douyin"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 });
    expect(operations.pauseGenerationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Paused");
    expect(ai.calls).toBe(0);
    expect(operations.resumeGenerationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Pending");
    expect(ai.calls).toBe(0);
    await operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    expect(operations.generationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Completed");
  });

  it("retries a failed source and then releases its source-linked variants", async () => {
    const ai = new FakeAI(); ai.failureCodes.push("AUTH_INVALID");
    const { repository, operations } = fixture(ai);
    const company = createBrand(repository, "失败重试企业");
    const queue = operations.createGenerationQueue({ companyId: company.id, topic: "失败后重试", requestedCount: 1, targetPlatforms: ["douyin"], profileId: "profile", model: "fixture", templateId: "industry", templateVersion: 1 });
    await operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    expect(operations.generationQueue({ companyId: company.id, queueId: queue.id }).status).toBe("Failed");
    operations.retryFailedGeneration({ companyId: company.id, queueId: queue.id });
    await operations.runGenerationQueue({ companyId: company.id, queueId: queue.id });
    expect(operations.generationQueue({ companyId: company.id, queueId: queue.id })).toMatchObject({ status: "Completed", completedCount: 2 });
  });

  it("maps import rows into company-bound Draft articles and reports E usage without guessed cost", () => {
    const { repository, operations } = fixture();
    const company = createBrand(repository, "导入企业");
    const preview = operations.previewImport({ companyId: company.id, fileName: "drafts.csv", rows: [{ 标题: "导入标题", 正文: "导入正文", 平台: "douyin" }, { 标题: "", 正文: "缺少标题" }], mapping: { title: "标题", body: "正文", targetPlatforms: "平台" } });
    expect(preview.rows[1]?.errors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 3, column: "标题" })]));
    const imported = operations.commitImport({ companyId: company.id, previewId: preview.previewId });
    expect(imported.imported).toBe(1);
    expect(repository.getArticle(imported.articleIds[0]!)?.status).toBe("draft");
    expect(repository.listJobs()).toEqual([]);

    repository.db.prepare("INSERT INTO ai_generation_history(generation_id,company_id,source_article_id,provider,model,template_id,template_version,target_platform,created_at,status,token_usage_json,error_code,output_article_id,variant_id) VALUES('usage-1',?,NULL,'openai','fixture','industry',1,'douyin',?,'Saved',?,NULL,NULL,NULL)").run(company.id, new Date().toISOString(), JSON.stringify({ input: 12, output: 7 }));
    expect(operations.usage({ companyId: company.id, days: 7 })).toEqual([expect.objectContaining({ provider: "openai", requestCount: 1, successCount: 1, inputTokens: 12, outputTokens: 7, totalTokens: 19, cost: null })]);
  });
});
