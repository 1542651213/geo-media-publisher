import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAICenterStore, type AppRepository, type GenerationHistory } from "@publisher/db";
import type { ExcelArticleRowInput, ExcelImportPreview } from "@publisher/domain";
import { STUDIO_PURPOSES, STUDIO_TARGETS, validateStudioDraft } from "@publisher/domain";
import type { ProductProviderProfile, StudioOutput } from "./ai-product-center";
import {
  OPERATIONS_REVIEW_ACTIONS,
  type ContentPlanItem,
  type DuplicateWarningResult,
  type OperationsAccountBinding,
  type OperationsDashboard,
  type OperationsFact,
  type OperationsGenerationItem,
  type OperationsGenerationQueue,
  type OperationsImportMapping,
  type OperationsImportPreview,
  type OperationsImportResult,
  type OperationsOwnerAction,
  type OperationsPlanGenerationSeed,
  type OperationsReviewItem,
  type OperationsSnapshot,
  type OperationsStudioDefaults,
  type OperationsUsageRange,
  type OperationsUsageRow,
  type OperationsUnboundAccount,
  type OperationsRuntimeHealth
} from "../shared/content-operations";

type Row = Record<string, unknown>;

export interface ContentOperationsAIPort {
  profiles(): ProductProviderProfile[];
  generate(payload: unknown): Promise<StudioOutput[]>;
  saveDraft(id: string, title: string, body: string): { articleId: string; variantId: string | null };
  history(companyId?: string): GenerationHistory[];
}

const idSchema = z.string().trim().min(1).max(200);
const companyRequestSchema = z.strictObject({ companyId: idSchema, accountId: idSchema });
const queueIdentitySchema = z.strictObject({ companyId: idSchema, queueId: idSchema });
const recoverableDecisionSchema = z.strictObject({ companyId: idSchema, queueId: idSchema, itemId: idSchema, decision: z.enum(["retry", "cancel"]) });
const validationDecisionSchema = z.strictObject({ companyId: idSchema, queueId: idSchema, itemId: idSchema, decision: z.enum(["regenerate", "cancel"]) });
const reviewSchema = z.strictObject({ companyId: idSchema, articleId: idSchema, action: z.enum(OPERATIONS_REVIEW_ACTIONS), expectedContentHash: z.string().min(1).max(256), reason: z.string().trim().max(1000).optional() });
const planItemSchema = z.strictObject({ companyId: idSchema, date: z.iso.date(), topic: z.string().trim().min(1).max(500), contentType: z.string().trim().min(1).max(100), targetPlatforms: z.array(idSchema).min(1).max(20) });
const planGenerateSchema = z.strictObject({ companyId: idSchema, days: z.union([z.literal(7), z.literal(30)]), startDate: z.iso.date(), targetPlatforms: z.array(idSchema).min(1).max(20) });
const planDraftSchema = z.strictObject({ companyId: idSchema, planId: idSchema, title: z.string().trim().min(1).max(2000), body: z.string().trim().min(1).max(100000) });
const planGenerationSchema = z.strictObject({ companyId: idSchema, planId: idSchema });
const factSourceSchema = z.enum(["Manual", "Company Profile", "Internal Document", "Published Website", "Verified Case"]);
const nullableDateTime = z.iso.datetime({ offset: true }).nullable();
const factSchema = z.strictObject({ id: idSchema.optional(), companyId: idSchema, category: z.string().trim().min(1).max(100), statement: z.string().trim().min(1).max(10000), source: factSourceSchema, sourceDate: z.iso.date().nullable(), verifiedAt: nullableDateTime, expiresAt: nullableDateTime, approvedForAI: z.boolean(), notes: z.string().max(5000) });
const studioDefaultsSchema = z.strictObject({ companyId: idSchema, profileId: idSchema.nullable(), model: z.string().trim().min(1).max(200).nullable(), templateId: idSchema.nullable(), templateVersion: z.number().int().positive().nullable(), purpose: z.enum(STUDIO_PURPOSES), targetPlatforms: z.array(z.enum(STUDIO_TARGETS)).min(1).max(6) });
const duplicateSchema = z.strictObject({ companyId: idSchema, title: z.string().max(2000), body: z.string().max(100000) });
const queueCreateSchema = z.strictObject({ companyId: idSchema, topic: z.string().trim().min(1).max(10000), requestedCount: z.number().int().min(1).max(20), targetPlatforms: z.array(z.enum(STUDIO_TARGETS)).min(1).max(6), profileId: idSchema, model: z.string().trim().min(1).max(200), templateId: idSchema, templateVersion: z.number().int().positive(), concurrency: z.number().int().min(1).max(4).optional() });
const usageSchema = z.strictObject({ companyId: idSchema, days: z.union([z.literal(1), z.literal(7), z.literal(30)]) });
const importMappingSchema = z.strictObject({ title: idSchema, body: idSchema, summary: idSchema.optional(), company: idSchema.optional(), business: idSchema.optional(), city: idSchema.optional(), keywords: idSchema.optional(), tags: idSchema.optional(), targetPlatforms: idSchema.optional(), contentType: idSchema.optional(), promotionStrength: idSchema.optional(), sourceNote: idSchema.optional(), templateVersion: idSchema.optional() });
const importPreviewSchema = z.strictObject({ companyId: idSchema, fileName: z.string().trim().min(1).max(255), rows: z.array(z.record(z.string(), z.string().max(200000))).max(5000), mapping: importMappingSchema });

const now = (): string => new Date().toISOString();
const text = (value: unknown): string => typeof value === "string" ? value : "";
const integer = (value: unknown): number => typeof value === "number" ? value : Number(value ?? 0);
const parseArray = (value: unknown): string[] => {
  try { const parsed = JSON.parse(text(value)) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
};
const unique = (values: string[]): string[] => [...new Set(values)];
const normalizedText = (value: string): string => value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
const operationsError = (code: string, message: string): Error => Object.assign(new Error(message), { code });

const planTopics = ["行业科普", "FAQ", "现场案例", "公司介绍", "GEO/SEO", "服务流程", "避坑", "季节性内容"] as const;

export class ContentOperations {
  private readonly importPreviews = new Map<string, { companyId: string; preview: ExcelImportPreview }>();
  private readonly runningQueues = new Set<string>();
  private readonly runningCompanies = new Set<string>();

  constructor(private readonly repository: AppRepository, private readonly aiCenter: ContentOperationsAIPort, private readonly runtimeHealth?: (accountId: string) => OperationsRuntimeHealth | null) {
    const timestamp = now();
    const interruptedQueueIds = (this.repository.db.prepare("SELECT id FROM operations_generation_queues WHERE status='Running'").all() as Row[]).map((row) => text(row.id));
    this.repository.db.transaction(() => {
      this.initializeSafeLegacyAccountBindings(timestamp);
      const interrupted = this.repository.db.prepare("SELECT * FROM operations_generation_items WHERE status='Running' ORDER BY queue_id,source_index,CASE item_kind WHEN 'Source' THEN 0 ELSE 1 END").all() as Row[];
      for (const item of interrupted) this.reconcileInterruptedItem(item, timestamp);
      this.repository.db.prepare("UPDATE operations_generation_queues SET status='Failed',updated_at=? WHERE status='Running'").run(timestamp);
      this.refreshAllQueueCounts(timestamp);
    })();
    for (const queueId of interruptedQueueIds) this.finishQueue(queueId);
  }

  private reconcileInterruptedItem(item: Row, timestamp: string): void {
    const generationId = typeof item.generation_id === "string" ? item.generation_id : null;
    if (!generationId) {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='INTERRUPTED_RESULT_UNKNOWN',updated_at=? WHERE id=? AND status='Running'").run(timestamp, item.id);
      return;
    }
    const history = this.repository.db.prepare("SELECT company_id,source_article_id,target_platform,status,error_code,output_article_id FROM ai_generation_history WHERE generation_id=?").get(generationId) as Row | undefined;
    if (!history || history.company_id !== item.company_id || history.target_platform !== item.target_platform) {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='GENERATION_LINKAGE_UNVERIFIED',updated_at=? WHERE id=? AND status='Running'").run(timestamp, item.id);
      return;
    }
    const expectedSourceId = item.item_kind === "Variant" ? this.sourceDraftId(text(item.queue_id), integer(item.source_index)) : null;
    if ((typeof history.source_article_id === "string" ? history.source_article_id : null) !== expectedSourceId) {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='GENERATION_SOURCE_MISMATCH',updated_at=? WHERE id=? AND status='Running'").run(timestamp, item.id);
      return;
    }
    if (history.status === "Saved" && typeof history.output_article_id === "string") {
      const sourceDraftId = item.item_kind === "Source" ? history.output_article_id : expectedSourceId;
      const article = this.repository.getArticle(history.output_article_id);
      if (article?.brandId === item.company_id && sourceDraftId) {
        this.repository.db.prepare("UPDATE operations_generation_items SET status='Completed',source_draft_id=?,output_article_id=?,error_code=NULL,available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(sourceDraftId, history.output_article_id, timestamp, item.id);
        return;
      }
    }
    if (history.status === "NeedsUserAction" && this.generationDraft(generationId)) {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Blocked',error_code='CONTENT_VALIDATION_REQUIRED',available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(timestamp, item.id);
      return;
    }
    if (history.status === "Generated" && this.generationDraft(generationId)) {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Pending',error_code=NULL,available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(timestamp, item.id);
      return;
    }
    if (history.status === "Failed") {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Failed',error_code=?,available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(text(history.error_code) || "GENERATION_FAILED", timestamp, item.id);
      return;
    }
    this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='INTERRUPTED_RESULT_UNKNOWN',updated_at=? WHERE id=? AND status='Running'").run(timestamp, item.id);
  }

  /**
   * Legacy E accounts had no company column. Preserve exact historical
   * ownership where Jobs point to one Article company. With no history, the
   * only safe fallback is a database containing exactly one company. Ambiguous
   * accounts remain unassigned for Owner review.
   */
  initializeSafeLegacyAccountBindings(timestamp = now()): number {
    const companies = (this.repository.db.prepare("SELECT id FROM brands ORDER BY id").all() as Row[]).map((row) => text(row.id));
    const insert = this.repository.db.prepare("INSERT OR IGNORE INTO operations_account_company_bindings(account_id,company_id,bound_at,updated_at) VALUES(?,?,?,?)");
    let bound = 0;
    for (const account of this.repository.listAccounts()) {
      if (this.accountCompany(account.id)) continue;
      const historical = (this.repository.db.prepare("SELECT DISTINCT a.brand_id FROM publish_jobs j INNER JOIN articles a ON a.id=j.article_id WHERE j.account_id=?").all(account.id) as Row[]).map((row) => text(row.brand_id)).filter(Boolean);
      const companyId = historical.length === 1 ? historical[0] : historical.length === 0 && companies.length === 1 ? companies[0] : undefined;
      if (companyId) bound += insert.run(account.id, companyId, timestamp, timestamp).changes;
    }
    return bound;
  }

  private ensureCompany(companyId: string): void {
    if (!this.repository.getBrand(companyId)) throw operationsError("COMPANY_NOT_FOUND", "企业不存在");
  }

  private assertArticleCompany(companyId: string, articleId: string) {
    this.ensureCompany(companyId);
    const article = this.repository.getArticle(articleId);
    if (!article) throw operationsError("ARTICLE_NOT_FOUND", "文章不存在");
    if (article.brandId !== companyId) throw operationsError("COMPANY_CONTEXT_MISMATCH", "文章与当前企业不匹配");
    return article;
  }

  accountCompany(accountId: string): string | null {
    const input = idSchema.parse(accountId);
    const row = this.repository.db.prepare("SELECT company_id FROM operations_account_company_bindings WHERE account_id=?").get(input) as Row | undefined;
    return row ? text(row.company_id) : null;
  }

  listUnboundAccounts(): OperationsUnboundAccount[] {
    return this.repository.listAccounts().filter((account) => this.accountCompany(account.id) === null).map((account) => ({ accountId: account.id, platformKey: account.platformKey, accountName: account.accountName ?? account.accountAlias }));
  }

  bindAccount(payload: unknown): OperationsAccountBinding {
    const input = companyRequestSchema.parse(payload);
    this.ensureCompany(input.companyId);
    const account = this.repository.getAccountById(input.accountId);
    if (!account || account.archivedAt) throw operationsError("ACCOUNT_NOT_FOUND", "账号不存在或已归档");
    const existing = this.accountCompany(account.id);
    if (existing && existing !== input.companyId) throw operationsError("ACCOUNT_ALREADY_BOUND", "账号已绑定到其他企业；请先由 Owner 核对后解除绑定");
    const timestamp = now();
    this.repository.db.prepare("INSERT INTO operations_account_company_bindings(account_id,company_id,bound_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET updated_at=excluded.updated_at WHERE company_id=excluded.company_id").run(account.id, input.companyId, timestamp, timestamp);
    return this.accounts(input.companyId).find((item) => item.accountId === account.id)!;
  }

  private accounts(companyId: string): OperationsAccountBinding[] {
    const rows = this.repository.db.prepare(`SELECT b.*,a.platform_key,a.account_alias,a.platform_account_name,a.enabled,a.login_status
      FROM operations_account_company_bindings b INNER JOIN accounts a ON a.id=b.account_id
      WHERE b.company_id=? AND a.archived_at IS NULL ORDER BY a.platform_key,a.account_alias`).all(companyId) as Row[];
    return rows.map((row) => ({ accountId: text(row.account_id), companyId: text(row.company_id), platformKey: text(row.platform_key), accountAlias: text(row.account_alias), accountName: typeof row.platform_account_name === "string" ? row.platform_account_name : null, enabled: integer(row.enabled) === 1, loginStatus: text(row.login_status), boundAt: text(row.bound_at), updatedAt: text(row.updated_at) }));
  }

  approvedForPublish(companyId: string, articleId: string): boolean {
    const article = this.assertArticleCompany(idSchema.parse(companyId), idSchema.parse(articleId));
    return article.status !== "archived" && this.repository.isContentApproved("article", article.id, article.contentHash);
  }

  reviewArticle(payload: unknown): OperationsReviewItem {
    const input = reviewSchema.parse(payload);
    const article = this.assertArticleCompany(input.companyId, input.articleId);
    if (article.contentHash !== input.expectedContentHash) throw operationsError("ARTICLE_CONTENT_CHANGED", "内容已变更，请重新审核当前版本");
    if (input.action === "approve") {
      const state = this.repository.getContentQualityState("article", article.id);
      if (!state || state.contentHash !== article.contentHash) throw operationsError("QUALITY_STATE_REQUIRED", "当前内容缺少有效质量检查");
      if (state.status === "Draft") {
        const saved = createAICenterStore(this.repository).context(input.companyId);
        const context = { ...saved, approvedClaims: [...new Set([...saved.approvedClaims, ...this.activeFacts(input.companyId).map(fact => fact.statement)])] };
        const otherBrands = this.repository.listBrands().filter(brand => brand.id !== input.companyId);
        const validations = (article.targetPlatforms?.length ? article.targetPlatforms : ["website"]).map(platformKey => validateStudioDraft({
          context, platformKey, title: article.title, body: article.body, contentType: article.articleType === "case" ? "case" : "article",
          otherCompanies: otherBrands.map(brand => brand.companyName).filter(Boolean), otherBrands: otherBrands.map(brand => brand.name),
          recent: this.repository.listArticles({ brandId: input.companyId }).filter(row => row.id !== article.id).map(({ title, body }) => ({ title, body }))
        }));
        if (validations.some(result => result.errors.length)) throw operationsError("CONTENT_VALIDATION_REQUIRED", "内容未通过确定性校验，请编辑后重新审核");
        this.repository.saveContentQualityReview({ contentType: "article", contentId: article.id, brandId: input.companyId, platformKey: null,
          contentHash: article.contentHash, trigger: "manual_review", provider: "deterministic", model: "operations-policy",
          result: { status: "Needs_Review", score: 100, checks: [], issues: [] }, snapshot: { validator: "deterministic", validations },
          operatorType: "human", previousStatus: "Draft", reason: "人工审核前的本机确定性校验；未调用 AI Provider" });
      }
      this.repository.decideContentQuality("article", article.id, "Approved", "human-review", "manual", input.reason ?? "运营审核通过");
    } else if (input.action === "return_to_draft") {
      this.repository.updateArticle(article.id, { title: article.title, body: article.body });
    } else {
      this.repository.archiveArticle(article.id);
    }
    return this.reviewItems(input.companyId).find((item) => item.articleId === article.id)!;
  }

  private reviewItems(companyId: string): OperationsReviewItem[] {
    return this.repository.listContentQualityItems(companyId).filter((item) => item.contentType === "article").map((item) => {
      const article = this.repository.getArticle(item.articleId)!;
      return { articleId: article.id, companyId, title: article.title, source: article.source ?? "production", aiGenerated: article.source === "content_studio" || !["manual", "excel_import"].includes(article.aiProvider), targetPlatforms: article.targetPlatforms ?? [], articleStatus: article.status, reviewStatus: item.status, contentHash: article.contentHash, validationWarnings: article.qualityWarnings ?? [], createdAt: article.createdAt, updatedAt: item.updatedAt };
    });
  }

  generatePlan(payload: unknown): ContentPlanItem[] {
    const input = planGenerateSchema.parse(payload);
    this.ensureCompany(input.companyId);
    const start = new Date(`${input.startDate}T00:00:00.000Z`);
    const timestamp = now(), source = input.days === 7 ? "Generated7" : "Generated30";
    const insert = this.repository.db.prepare("INSERT INTO operations_content_plans(id,company_id,plan_date,topic,content_type,target_platforms_json,status,source,article_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'Planned',?,NULL,?,?)");
    const ids: string[] = [];
    this.repository.db.transaction(() => {
      for (let index = 0; index < input.days; index += 1) {
        const date = new Date(start); date.setUTCDate(start.getUTCDate() + index);
        const id = randomUUID(), type = planTopics[index % planTopics.length]!;
        insert.run(id, input.companyId, date.toISOString().slice(0, 10), `${type}：第 ${index + 1} 天内容`, type, JSON.stringify(unique(input.targetPlatforms)), source, timestamp, timestamp);
        ids.push(id);
      }
    })();
    const created = new Set(ids);
    return this.plans(input.companyId).filter((item) => created.has(item.id));
  }

  createPlanItem(payload: unknown): ContentPlanItem {
    const input = planItemSchema.parse(payload);
    this.ensureCompany(input.companyId);
    const id = randomUUID(), timestamp = now();
    this.repository.db.prepare("INSERT INTO operations_content_plans(id,company_id,plan_date,topic,content_type,target_platforms_json,status,source,article_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'Planned','Manual',NULL,?,?)").run(id, input.companyId, input.date, input.topic, input.contentType, JSON.stringify(unique(input.targetPlatforms)), timestamp, timestamp);
    return this.plan(input.companyId, id);
  }

  createDraftFromPlan(payload: unknown): { articleId: string; plan: ContentPlanItem } {
    const input = planDraftSchema.parse(payload);
    const plan = this.plan(input.companyId, input.planId);
    const hash = createHash("sha256").update(`${input.companyId}\n${input.title.trim()}\n${input.body.trim()}`).digest("hex");
    const company = this.repository.getBrand(input.companyId)!;
    const article = this.repository.createArticle({ brandId: input.companyId, topic: plan.topic, keyword: "", city: "", title: input.title, body: input.body, summary: "", tags: [], seoKeywords: [], articleType: plan.contentType, aiProvider: "manual", aiModel: "operations-plan", generatedAt: now(), reusePolicy: "once", contentHash: hash, source: "production", company: company.companyName, targetPlatforms: plan.targetPlatforms });
    if (!article) throw new Error("相同草稿已存在");
    this.repository.updateArticle(article.id, { status: "draft" });
    const timestamp = now();
    this.repository.db.prepare("UPDATE operations_content_plans SET status='DraftCreated',article_id=?,updated_at=? WHERE id=? AND company_id=?").run(article.id, timestamp, plan.id, input.companyId);
    return { articleId: article.id, plan: this.plan(input.companyId, plan.id) };
  }

  preparePlanGeneration(payload: unknown): OperationsPlanGenerationSeed {
    const input = planGenerationSchema.parse(payload);
    return this.repository.db.transaction(() => {
      let plan = this.plan(input.companyId, input.planId);
      let articleId = plan.articleId;
      if (articleId) {
        const article = this.assertArticleCompany(input.companyId, articleId);
        if (article.status === "archived") throw operationsError("QUEUE_STATE_INVALID", "计划源草稿已归档，请先恢复或新建计划项");
      } else {
        const body = `内容计划：${plan.topic}\n内容类型：${plan.contentType}\n请在 AI Content Studio 中基于已批准企业事实生成正文。`;
        const created = this.createDraftFromPlan({ companyId: input.companyId, planId: input.planId, title: plan.topic, body });
        articleId = created.articleId;
        plan = created.plan;
      }
      this.repository.setSetting(`operationsPendingAIPlanSource:${input.companyId}`, articleId);
      return { articleId, topic: plan.topic, targetPlatforms: plan.targetPlatforms };
    })();
  }

  consumePlanGenerationSeed(companyId: string): OperationsPlanGenerationSeed | null {
    const inputCompanyId = idSchema.parse(companyId);
    this.ensureCompany(inputCompanyId);
    return this.repository.db.transaction(() => {
      const key = `operationsPendingAIPlanSource:${inputCompanyId}`;
      const setting = this.repository.db.prepare("SELECT value_json FROM app_settings WHERE key=?").get(key) as Row | undefined;
      if (!setting) return null;
      let articleId: string;
      try { articleId = z.string().min(1).parse(JSON.parse(text(setting.value_json))); }
      catch { throw operationsError("COMPANY_CONTEXT_MISMATCH", "待生成计划来源设置无效，请重新从内容计划进入"); }
      this.assertArticleCompany(inputCompanyId, articleId);
      const planRow = this.repository.db.prepare("SELECT * FROM operations_content_plans WHERE company_id=? AND article_id=? AND status='DraftCreated' ORDER BY updated_at DESC LIMIT 1").get(inputCompanyId, articleId) as Row | undefined;
      if (!planRow) throw operationsError("COMPANY_CONTEXT_MISMATCH", "待生成来源未关联当前企业内容计划");
      this.repository.db.prepare("DELETE FROM app_settings WHERE key=?").run(key);
      const plan = this.planFromRow(planRow);
      return { articleId, topic: plan.topic, targetPlatforms: plan.targetPlatforms };
    })();
  }

  private plan(companyId: string, planId: string): ContentPlanItem {
    this.ensureCompany(companyId);
    const row = this.repository.db.prepare("SELECT * FROM operations_content_plans WHERE id=?").get(planId) as Row | undefined;
    if (!row) throw operationsError("PLAN_NOT_FOUND", "内容计划不存在");
    if (row.company_id !== companyId) throw operationsError("COMPANY_CONTEXT_MISMATCH", "内容计划与当前企业不匹配");
    return this.planFromRow(row);
  }

  private plans(companyId: string): ContentPlanItem[] {
    return (this.repository.db.prepare("SELECT * FROM operations_content_plans WHERE company_id=? ORDER BY plan_date,created_at").all(companyId) as Row[]).map((row) => this.planFromRow(row));
  }

  private planFromRow(row: Row): ContentPlanItem {
    return { id: text(row.id), companyId: text(row.company_id), date: text(row.plan_date), topic: text(row.topic), contentType: text(row.content_type), targetPlatforms: parseArray(row.target_platforms_json), status: row.status as ContentPlanItem["status"], source: row.source as ContentPlanItem["source"], articleId: typeof row.article_id === "string" ? row.article_id : null, createdAt: text(row.created_at), updatedAt: text(row.updated_at) };
  }

  saveFact(payload: unknown): OperationsFact {
    const input = factSchema.parse(payload);
    this.ensureCompany(input.companyId);
    const id = input.id ?? randomUUID(), timestamp = now();
    if (input.id) {
      const old = this.repository.db.prepare("SELECT company_id FROM operations_facts WHERE id=?").get(input.id) as Row | undefined;
      if (!old) throw operationsError("FACT_NOT_FOUND", "企业事实不存在");
      if (old.company_id !== input.companyId) throw operationsError("COMPANY_CONTEXT_MISMATCH", "企业事实与当前企业不匹配");
    }
    this.repository.db.prepare(`INSERT INTO operations_facts(id,company_id,category,statement,source,source_date,verified_at,expires_at,approved_for_ai,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category=excluded.category,statement=excluded.statement,source=excluded.source,source_date=excluded.source_date,verified_at=excluded.verified_at,expires_at=excluded.expires_at,approved_for_ai=excluded.approved_for_ai,notes=excluded.notes,updated_at=excluded.updated_at`).run(id, input.companyId, input.category, input.statement, input.source, input.sourceDate, input.verifiedAt, input.expiresAt, input.approvedForAI ? 1 : 0, input.notes, timestamp, timestamp);
    return this.facts(input.companyId).find((item) => item.id === id)!;
  }

  activeFacts(companyId: string, at: Date = new Date()): OperationsFact[] {
    this.ensureCompany(idSchema.parse(companyId));
    const cutoff = at.toISOString();
    return this.facts(companyId).filter((fact) => fact.approvedForAI && (!fact.expiresAt || fact.expiresAt > cutoff));
  }

  private facts(companyId: string): OperationsFact[] {
    return (this.repository.db.prepare("SELECT * FROM operations_facts WHERE company_id=? ORDER BY category,updated_at DESC").all(companyId) as Row[]).map((row) => ({ id: text(row.id), companyId: text(row.company_id), category: text(row.category), statement: text(row.statement), source: row.source as OperationsFact["source"], sourceDate: typeof row.source_date === "string" ? row.source_date : null, verifiedAt: typeof row.verified_at === "string" ? row.verified_at : null, expiresAt: typeof row.expires_at === "string" ? row.expires_at : null, approvedForAI: integer(row.approved_for_ai) === 1, notes: text(row.notes), createdAt: text(row.created_at), updatedAt: text(row.updated_at) }));
  }

  getStudioDefaults(companyId: string): OperationsStudioDefaults {
    this.ensureCompany(idSchema.parse(companyId));
    const row = this.repository.db.prepare("SELECT * FROM operations_studio_defaults WHERE company_id=?").get(companyId) as Row | undefined;
    if (row) return this.studioDefaultsFromRow(row);
    const profiles = this.aiCenter.profiles();
    const configuredDefaultId = this.repository.getSettings().productDefaultAIProfileId;
    const profile = profiles.find((item) => item.id === configuredDefaultId) ?? profiles.find((item) => item.isDefault) ?? profiles.find((item) => item.configured) ?? profiles[0] ?? null;
    const templates = (this.repository.db.prepare("SELECT template_json FROM ai_prompt_templates ORDER BY template_id,version DESC").all() as Row[]).flatMap((entry) => {
      try { return [JSON.parse(text(entry.template_json)) as { templateId: string; version: number; targetPlatform: string | null; enabled: boolean }]; }
      catch { return []; }
    }).filter((template) => template.enabled);
    const template = templates.find((item) => item.targetPlatform === null) ?? templates[0] ?? null;
    const targetPlatforms: OperationsStudioDefaults["targetPlatforms"] = template?.targetPlatform && STUDIO_TARGETS.includes(template.targetPlatform as typeof STUDIO_TARGETS[number]) ? [template.targetPlatform as typeof STUDIO_TARGETS[number]] : ["douyin"];
    return { companyId, profileId: profile?.id ?? null, model: profile?.defaultModel ?? null, templateId: template?.templateId ?? null, templateVersion: template?.version ?? null, purpose: "生成文章", targetPlatforms, updatedAt: null };
  }

  saveStudioDefaults(payload: unknown): OperationsStudioDefaults {
    const input = studioDefaultsSchema.parse(payload);
    this.ensureCompany(input.companyId);
    if ((input.profileId === null) !== (input.model === null)) throw new Error("服务商与模型默认值必须同时设置或同时清除");
    if ((input.templateId === null) !== (input.templateVersion === null)) throw new Error("模板与版本默认值必须同时设置或同时清除");
    if (input.profileId && !this.aiCenter.profiles().some((item) => item.id === input.profileId)) throw new Error("Studio 默认服务商不存在");
    if (input.templateId && input.templateVersion) {
      const row = this.repository.db.prepare("SELECT template_json FROM ai_prompt_templates WHERE template_id=? AND version=?").get(input.templateId, input.templateVersion) as Row | undefined;
      if (!row) throw new Error("Studio 默认模板不存在");
      const template = JSON.parse(text(row.template_json)) as { enabled?: boolean; targetPlatform?: string | null };
      if (template.enabled !== true) throw new Error("Studio 默认模板已停用");
      if (template.targetPlatform && (input.targetPlatforms.length !== 1 || input.targetPlatforms[0] !== template.targetPlatform)) throw new Error("平台专用模板只能绑定对应目标平台");
    }
    const targets = unique(input.targetPlatforms), timestamp = now();
    this.repository.db.prepare(`INSERT INTO operations_studio_defaults(company_id,profile_id,model,template_id,template_version,purpose,target_platforms_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET profile_id=excluded.profile_id,model=excluded.model,template_id=excluded.template_id,template_version=excluded.template_version,purpose=excluded.purpose,target_platforms_json=excluded.target_platforms_json,updated_at=excluded.updated_at`).run(input.companyId, input.profileId, input.model, input.templateId, input.templateVersion, input.purpose, JSON.stringify(targets), timestamp);
    return this.getStudioDefaults(input.companyId);
  }

  private studioDefaultsFromRow(row: Row): OperationsStudioDefaults {
    const targetPlatforms = parseArray(row.target_platforms_json).filter((value): value is typeof STUDIO_TARGETS[number] => STUDIO_TARGETS.includes(value as typeof STUDIO_TARGETS[number]));
    return { companyId: text(row.company_id), profileId: typeof row.profile_id === "string" ? row.profile_id : null, model: typeof row.model === "string" ? row.model : null, templateId: typeof row.template_id === "string" ? row.template_id : null, templateVersion: row.template_version === null || row.template_version === undefined ? null : integer(row.template_version), purpose: STUDIO_PURPOSES.includes(row.purpose as typeof STUDIO_PURPOSES[number]) ? row.purpose as OperationsStudioDefaults["purpose"] : "生成文章", targetPlatforms, updatedAt: typeof row.updated_at === "string" ? row.updated_at : null };
  }

  duplicateWarnings(payload: unknown): DuplicateWarningResult {
    const input = duplicateSchema.parse(payload);
    this.ensureCompany(input.companyId);
    const title = normalizedText(input.title), body = normalizedText(input.body);
    const rows = this.repository.db.prepare("SELECT id,title,body FROM articles WHERE brand_id=? AND status<>'archived'").all(input.companyId) as Row[];
    const titleMatches = title ? rows.filter((row) => normalizedText(text(row.title)) === title) : [];
    const bodyMatches = body ? rows.filter((row) => normalizedText(text(row.body)) === body) : [];
    const exactTitleCount = titleMatches.length, exactBodyCount = bodyMatches.length;
    return { companyId: input.companyId, exactTitleCount, exactBodyCount, matchedArticleIds: unique([...titleMatches, ...bodyMatches].map((row) => text(row.id))), warnings: [...(exactTitleCount ? [`同企业已有 ${exactTitleCount} 篇标准化标题相同`] : []), ...(exactBodyCount ? [`同企业已有 ${exactBodyCount} 篇标准化正文相同`] : [])] };
  }

  usage(payload: unknown): OperationsUsageRow[] {
    const input = usageSchema.parse(payload);
    this.ensureCompany(input.companyId);
    const since = new Date(Date.now() - (input.days - 1) * 86400000).toISOString().slice(0, 10);
    const rows = this.repository.db.prepare("SELECT provider,model,status,token_usage_json FROM ai_generation_history WHERE company_id=? AND created_at>=?").all(input.companyId, since) as Row[];
    const groups = new Map<string, OperationsUsageRow>();
    for (const row of rows) {
      const provider = text(row.provider), model = text(row.model), key = `${provider}\u0000${model}`;
      const current = groups.get(key) ?? { provider, model, requestCount: 0, successCount: 0, failedCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: null, currency: null };
      let tokenUsage: { input?: number; output?: number } = {};
      try { tokenUsage = row.token_usage_json ? JSON.parse(text(row.token_usage_json)) as typeof tokenUsage : {}; } catch { tokenUsage = {}; }
      current.requestCount += 1;
      if (["Generated", "NeedsUserAction", "Saved"].includes(text(row.status))) current.successCount += 1;
      else if (["Failed", "Unknown"].includes(text(row.status))) current.failedCount += 1;
      current.inputTokens += Number(tokenUsage.input ?? 0); current.outputTokens += Number(tokenUsage.output ?? 0); current.totalTokens = current.inputTokens + current.outputTokens;
      groups.set(key, current);
    }
    return [...groups.values()].sort((left, right) => right.requestCount - left.requestCount || left.provider.localeCompare(right.provider));
  }

  createGenerationQueue(payload: unknown): OperationsGenerationQueue {
    const input = queueCreateSchema.parse(payload);
    this.ensureCompany(input.companyId);
    const profile = this.aiCenter.profiles().find((item) => item.id === input.profileId);
    if (!profile) throw new Error("AI 服务商配置不存在");
    const id = randomUUID(), timestamp = now(), targets = unique(input.targetPlatforms);
    const insertItem = this.repository.db.prepare("INSERT INTO operations_generation_items(id,queue_id,company_id,source_index,item_kind,target_platform,status,attempt_count,generation_id,source_draft_id,output_article_id,error_code,available_after,created_at,updated_at) VALUES(?,?,?,?,?,?,'Pending',0,NULL,NULL,NULL,NULL,NULL,?,?)");
    this.repository.db.transaction(() => {
      // AIProductCenter rejects concurrent requests for one company. Persist the
      // effective lane count truthfully until a lower-level global lane manager exists.
      this.repository.db.prepare("INSERT INTO operations_generation_queues(id,company_id,provider,model,profile_id,template_id,template_version,topic,requested_count,target_platforms_json,completed_count,failed_count,status,concurrency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,'Pending',1,?,?)").run(id, input.companyId, profile.provider, input.model, input.profileId, input.templateId, input.templateVersion, input.topic, input.requestedCount, JSON.stringify(targets), timestamp, timestamp);
      for (let sourceIndex = 0; sourceIndex < input.requestedCount; sourceIndex += 1) {
        insertItem.run(randomUUID(), id, input.companyId, sourceIndex, "Source", targets[0], timestamp, timestamp);
        for (const target of targets) insertItem.run(randomUUID(), id, input.companyId, sourceIndex, "Variant", target, timestamp, timestamp);
      }
    })();
    return this.generationQueue({ companyId: input.companyId, queueId: id });
  }

  generationQueue(payload: unknown): OperationsGenerationQueue {
    const input = queueIdentitySchema.parse(payload);
    this.ensureCompany(input.companyId);
    const row = this.repository.db.prepare("SELECT * FROM operations_generation_queues WHERE id=?").get(input.queueId) as Row | undefined;
    if (!row) throw operationsError("QUEUE_NOT_FOUND", "生成队列不存在");
    if (row.company_id !== input.companyId) throw operationsError("COMPANY_CONTEXT_MISMATCH", "生成队列与当前企业不匹配");
    return this.queueFromRow(row);
  }

  async runGenerationQueue(payload: unknown): Promise<OperationsGenerationQueue> {
    const input = queueIdentitySchema.parse(payload);
    let queue = this.generationQueue(input);
    if (["Completed", "Cancelled"].includes(queue.status)) return queue;
    if (queue.status === "Paused") throw operationsError("QUEUE_STATE_INVALID", "生成队列已暂停");
    if (this.runningQueues.has(queue.id) || this.runningCompanies.has(queue.companyId)) return queue;
    this.runningQueues.add(queue.id); this.runningCompanies.add(queue.companyId);
    try {
      this.repository.db.prepare("UPDATE operations_generation_queues SET status='Running',updated_at=? WHERE id=? AND company_id=? AND status IN ('Pending','Failed')").run(now(), queue.id, queue.companyId);
      while (true) {
        queue = this.generationQueue(input);
        if (queue.status !== "Running") break;
        const row = this.repository.db.prepare("SELECT * FROM operations_generation_items WHERE queue_id=? AND status='Pending' ORDER BY source_index,CASE item_kind WHEN 'Source' THEN 0 ELSE 1 END,target_platform LIMIT 1").get(queue.id) as Row | undefined;
        if (!row) break;
        const claimed = this.repository.db.prepare("UPDATE operations_generation_items SET status='Running',attempt_count=attempt_count+1,error_code=NULL,updated_at=? WHERE id=? AND status='Pending'").run(now(), row.id);
        if (claimed.changes !== 1) continue;
        await this.processGenerationItem(queue, this.itemFromRow({ ...row, status: "Running", attempt_count: integer(row.attempt_count) + 1 }));
      }
    } finally {
      this.finishQueue(queue.id);
      this.runningQueues.delete(queue.id); this.runningCompanies.delete(queue.companyId);
    }
    return this.generationQueue({ companyId: input.companyId, queueId: input.queueId });
  }

  private async processGenerationItem(queue: OperationsGenerationQueue, item: OperationsGenerationItem): Promise<void> {
    const timestamp = now();
    if (item.itemKind === "Variant") {
      const source = this.repository.db.prepare("SELECT source_draft_id,status FROM operations_generation_items WHERE queue_id=? AND source_index=? AND item_kind='Source'").get(queue.id, item.sourceIndex) as Row | undefined;
      if (!source || source.status !== "Completed" || typeof source.source_draft_id !== "string") {
        this.repository.db.prepare("UPDATE operations_generation_items SET status='Blocked',error_code='SOURCE_DRAFT_NOT_AVAILABLE',updated_at=? WHERE id=? AND status='Running'").run(timestamp, item.id);
        return;
      }
    }
    if (item.generationId) {
      try { if (this.resumeKnownGeneration(queue, item)) return; }
      catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
        this.repository.db.prepare("UPDATE operations_generation_items SET status=?,error_code=?,updated_at=? WHERE id=? AND status='Running'").run(code === "CONTENT_VALIDATION_REQUIRED" || message.includes("校验未通过") ? "Blocked" : "Failed", code === "CONTENT_VALIDATION_REQUIRED" || message.includes("校验未通过") ? "CONTENT_VALIDATION_REQUIRED" : code || "GENERATION_FAILED", now(), item.id);
        return;
      }
    }
    const profile = this.aiCenter.profiles().find((candidate) => candidate.id === queue.profileId);
    if (!profile?.configured) {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Blocked',error_code='BLOCKED_PROVIDER_NOT_CONFIGURED',updated_at=? WHERE id=? AND status='Running'").run(timestamp, item.id);
      return;
    }
    for (let rateAttempt = 0; rateAttempt < 3; rateAttempt += 1) {
      try {
        const sourceRow = item.itemKind === "Variant" ? this.repository.db.prepare("SELECT source_draft_id FROM operations_generation_items WHERE queue_id=? AND source_index=? AND item_kind='Source'").get(queue.id, item.sourceIndex) as Row : undefined;
        const sourceArticleId = sourceRow && typeof sourceRow.source_draft_id === "string" ? sourceRow.source_draft_id : null;
        const outputs = await this.aiCenter.generate({ companyId: queue.companyId, sourceArticleId, sourceText: `${queue.topic}\n稿件序号：${item.sourceIndex + 1}`, purpose: item.itemKind === "Source" ? "生成文章" : "平台适配", targetPlatforms: [item.targetPlatform], profileId: queue.profileId, model: queue.model, templateId: queue.templateId, templateVersion: queue.templateVersion });
        const output = outputs[0];
        if (!output) throw Object.assign(new Error("生成服务未返回草稿"), { code: "OUTPUT_MISSING" });
        this.repository.db.prepare("UPDATE operations_generation_items SET generation_id=?,updated_at=? WHERE id=? AND generation_id IS NULL").run(output.generationId, now(), item.id);
        const history = this.repository.db.prepare("SELECT company_id,source_article_id,target_platform,error_code FROM ai_generation_history WHERE generation_id=?").get(output.generationId) as Row | undefined;
        if (!history || history.company_id !== queue.companyId || history.target_platform !== item.targetPlatform || (typeof history.source_article_id === "string" ? history.source_article_id : null) !== sourceArticleId) {
          this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='GENERATION_LINKAGE_UNVERIFIED',available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(now(), item.id);
          return;
        }
        if (output.status === "NeedsUserAction") {
          this.repository.db.prepare("UPDATE operations_generation_items SET status='Blocked',error_code='CONTENT_VALIDATION_REQUIRED',available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(now(), item.id);
          return;
        }
        if (output.status === "Unknown" || history.error_code === "TRANSPORT_UNKNOWN") {
          this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',generation_id=?,error_code='TRANSPORT_UNKNOWN',available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(output.generationId, now(), item.id);
          return;
        }
        if (output.status === "Failed") {
          const code = text(history.error_code) || "GENERATION_FAILED";
          if (code === "RATE_LIMITED" && rateAttempt < 2) {
            if (!await this.waitForRateLimitRetry(queue.id, item.id, rateAttempt)) return;
            continue;
          }
          this.repository.db.prepare("UPDATE operations_generation_items SET status='Failed',generation_id=?,error_code=?,available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(output.generationId, code, now(), item.id);
          return;
        }
        const liveQueue = this.repository.db.prepare("SELECT status FROM operations_generation_queues WHERE id=?").get(queue.id) as Row | undefined;
        const liveItem = this.repository.db.prepare("SELECT status FROM operations_generation_items WHERE id=?").get(item.id) as Row | undefined;
        if (liveQueue?.status === "Cancelled" || liveItem?.status === "Cancelled") return;
        this.saveAndCompleteItem(queue, item, output.generationId, output.title, output.body);
        return;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "GENERATION_FAILED";
        if (code === "RATE_LIMITED" && rateAttempt < 2) {
          if (!await this.waitForRateLimitRetry(queue.id, item.id, rateAttempt)) return;
          continue;
        }
        const message = error instanceof Error ? error.message : "";
        const validationRequired = code === "CONTENT_VALIDATION_REQUIRED" || message.includes("校验未通过");
        const status = validationRequired ? "Blocked" : code === "TRANSPORT_UNKNOWN" ? "Recoverable" : "Failed";
        this.repository.db.prepare("UPDATE operations_generation_items SET status=?,error_code=?,available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(status, validationRequired ? "CONTENT_VALIDATION_REQUIRED" : code, now(), item.id);
        return;
      }
    }
  }

  private generationDraft(generationId: string): { title: string; body: string } | null {
    const row = this.repository.db.prepare("SELECT title,body FROM ai_local_drafts WHERE generation_id=?").get(generationId) as Row | undefined;
    return row ? { title: text(row.title), body: text(row.body) } : null;
  }

  private sourceDraftId(queueId: string, sourceIndex: number): string | null {
    const row = this.repository.db.prepare("SELECT source_draft_id FROM operations_generation_items WHERE queue_id=? AND source_index=? AND item_kind='Source'").get(queueId, sourceIndex) as Row | undefined;
    return row && typeof row.source_draft_id === "string" ? row.source_draft_id : null;
  }

  private resumeKnownGeneration(queue: OperationsGenerationQueue, item: OperationsGenerationItem): boolean {
    const generationId = item.generationId;
    if (!generationId) return false;
    const history = this.repository.db.prepare("SELECT company_id,source_article_id,target_platform,status,error_code,output_article_id FROM ai_generation_history WHERE generation_id=?").get(generationId) as Row | undefined;
    if (!history || history.company_id !== queue.companyId || history.target_platform !== item.targetPlatform) {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='GENERATION_LINKAGE_UNVERIFIED',updated_at=? WHERE id=? AND status='Running'").run(now(), item.id);
      return true;
    }
    const expectedSourceId = item.itemKind === "Variant" ? this.sourceDraftId(queue.id, item.sourceIndex) : null;
    if ((typeof history.source_article_id === "string" ? history.source_article_id : null) !== expectedSourceId) {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='GENERATION_SOURCE_MISMATCH',updated_at=? WHERE id=? AND status='Running'").run(now(), item.id);
      return true;
    }
    if (history.status === "Saved" && typeof history.output_article_id === "string") {
      const article = this.repository.getArticle(history.output_article_id);
      if (!article || article.brandId !== queue.companyId) {
        this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='SAVED_OUTPUT_MISSING',updated_at=? WHERE id=? AND status='Running'").run(now(), item.id);
        return true;
      }
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Completed',source_draft_id=?,output_article_id=?,error_code=NULL,available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(item.itemKind === "Source" ? article.id : expectedSourceId, article.id, now(), item.id);
      return true;
    }
    if (history.status === "NeedsUserAction") {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Blocked',error_code='CONTENT_VALIDATION_REQUIRED',updated_at=? WHERE id=? AND status='Running'").run(now(), item.id);
      return true;
    }
    if (history.status === "Generated") {
      const draft = this.generationDraft(generationId);
      if (!draft) {
        this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='GENERATED_DRAFT_MISSING',updated_at=? WHERE id=? AND status='Running'").run(now(), item.id);
        return true;
      }
      this.saveAndCompleteItem(queue, item, generationId, draft.title, draft.body);
      return true;
    }
    if (history.status === "Failed") {
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Failed',error_code=?,updated_at=? WHERE id=? AND status='Running'").run(text(history.error_code) || "GENERATION_FAILED", now(), item.id);
      return true;
    }
    this.repository.db.prepare("UPDATE operations_generation_items SET status='Recoverable',error_code='INTERRUPTED_RESULT_UNKNOWN',updated_at=? WHERE id=? AND status='Running'").run(now(), item.id);
    return true;
  }

  private saveAndCompleteItem(queue: OperationsGenerationQueue, item: OperationsGenerationItem, generationId: string, title: string, body: string): void {
    this.repository.db.transaction(() => {
      const liveQueue = this.repository.db.prepare("SELECT status FROM operations_generation_queues WHERE id=?").get(queue.id) as Row | undefined;
      const liveItem = this.repository.db.prepare("SELECT status FROM operations_generation_items WHERE id=?").get(item.id) as Row | undefined;
      if (liveQueue?.status !== "Running" || liveItem?.status !== "Running") return;
      const saved = this.aiCenter.saveDraft(generationId, title, body);
      const sourceDraftId = item.itemKind === "Source" ? saved.articleId : this.sourceDraftId(queue.id, item.sourceIndex);
      if (!sourceDraftId) throw Object.assign(new Error("源草稿不存在"), { code: "SOURCE_DRAFT_NOT_AVAILABLE" });
      const article = this.repository.getArticle(saved.articleId);
      if (!article || article.brandId !== queue.companyId) throw Object.assign(new Error("生成结果与队列企业不匹配"), { code: "GENERATION_LINKAGE_UNVERIFIED" });
      const completed = this.repository.db.prepare("UPDATE operations_generation_items SET status='Completed',generation_id=?,source_draft_id=?,output_article_id=?,error_code=NULL,available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(generationId, sourceDraftId, saved.articleId, now(), item.id);
      if (completed.changes !== 1) throw Object.assign(new Error("生成项状态已变化"), { code: "QUEUE_STATE_INVALID" });
    })();
  }

  private async waitForRateLimitRetry(queueId: string, itemId: string, rateAttempt: number): Promise<boolean> {
    const delayMs = 250 * (2 ** rateAttempt), availableAfter = new Date(Date.now() + delayMs).toISOString();
    this.repository.db.prepare("UPDATE operations_generation_items SET attempt_count=attempt_count+1,error_code='RATE_LIMITED',available_after=?,updated_at=? WHERE id=?").run(availableAfter, now(), itemId);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    const queue = this.repository.db.prepare("SELECT status FROM operations_generation_queues WHERE id=?").get(queueId) as Row | undefined;
    if (queue?.status === "Running") return true;
    if (queue?.status === "Paused") this.repository.db.prepare("UPDATE operations_generation_items SET status='Pending',available_after=NULL,updated_at=? WHERE id=? AND status='Running'").run(now(), itemId);
    return false;
  }

  pauseGenerationQueue(payload: unknown): OperationsGenerationQueue {
    const input = queueIdentitySchema.parse(payload), queue = this.generationQueue(input);
    if (!["Pending", "Running"].includes(queue.status)) throw operationsError("QUEUE_STATE_INVALID", "当前队列不能暂停");
    this.repository.db.prepare("UPDATE operations_generation_queues SET status='Paused',updated_at=? WHERE id=?").run(now(), queue.id);
    return this.generationQueue(input);
  }

  resumeGenerationQueue(payload: unknown): OperationsGenerationQueue {
    const input = queueIdentitySchema.parse(payload), queue = this.generationQueue(input);
    if (queue.status !== "Paused") throw operationsError("QUEUE_STATE_INVALID", "只有已暂停队列可以恢复");
    this.repository.db.prepare("UPDATE operations_generation_queues SET status='Pending',updated_at=? WHERE id=?").run(now(), queue.id);
    return this.generationQueue(input);
  }

  cancelGenerationQueue(payload: unknown): OperationsGenerationQueue {
    const input = queueIdentitySchema.parse(payload), queue = this.generationQueue(input);
    if (["Completed", "Cancelled"].includes(queue.status)) return queue;
    const timestamp = now();
    this.repository.db.transaction(() => {
      this.repository.db.prepare("UPDATE operations_generation_queues SET status='Cancelled',updated_at=? WHERE id=?").run(timestamp, queue.id);
      this.repository.db.prepare("UPDATE operations_generation_items SET status='Cancelled',updated_at=? WHERE queue_id=? AND status<>'Completed'").run(timestamp, queue.id);
    })();
    return this.generationQueue(input);
  }

  retryFailedGeneration(payload: unknown): OperationsGenerationQueue {
    const input = queueIdentitySchema.parse(payload), queue = this.generationQueue(input), timestamp = now();
    if (queue.status === "Cancelled") throw operationsError("QUEUE_STATE_INVALID", "已取消队列不能重试");
    const failedSources = (this.repository.db.prepare("SELECT source_index FROM operations_generation_items WHERE queue_id=? AND item_kind='Source' AND status='Failed'").all(queue.id) as Row[]).map((row) => integer(row.source_index));
    let changed = this.repository.db.prepare(`UPDATE operations_generation_items SET status='Pending',
      generation_id=CASE WHEN generation_id IN (SELECT generation_id FROM ai_generation_history WHERE status IN ('Generated','NeedsUserAction','Saved')) THEN generation_id ELSE NULL END,
      error_code=NULL,available_after=NULL,updated_at=? WHERE queue_id=? AND (status='Failed' OR (status='Blocked' AND error_code='BLOCKED_PROVIDER_NOT_CONFIGURED'))`).run(timestamp, queue.id).changes;
    const releaseDependent = this.repository.db.prepare("UPDATE operations_generation_items SET status='Pending',error_code=NULL,updated_at=? WHERE queue_id=? AND source_index=? AND item_kind='Variant' AND status='Blocked' AND error_code='SOURCE_DRAFT_NOT_AVAILABLE'");
    for (const sourceIndex of failedSources) changed += releaseDependent.run(timestamp, queue.id, sourceIndex).changes;
    if (!changed) throw operationsError("QUEUE_STATE_INVALID", "没有可重试的失败项");
    this.repository.db.prepare("UPDATE operations_generation_queues SET status='Pending',updated_at=? WHERE id=?").run(timestamp, queue.id);
    this.refreshQueueCounts(queue.id, timestamp);
    return this.generationQueue(input);
  }

  reconcileGenerationQueue(payload: unknown): OperationsGenerationQueue {
    const input = queueIdentitySchema.parse(payload), queue = this.generationQueue(input), timestamp = now();
    const blocked = this.repository.db.prepare("SELECT * FROM operations_generation_items WHERE queue_id=? AND status='Blocked' AND error_code='CONTENT_VALIDATION_REQUIRED' ORDER BY source_index,CASE item_kind WHEN 'Source' THEN 0 ELSE 1 END").all(queue.id) as Row[];
    this.repository.db.transaction(() => {
      for (const row of blocked) {
        const item = this.itemFromRow(row), generationId = item.generationId;
        if (!generationId) continue;
        const history = this.repository.db.prepare("SELECT company_id,source_article_id,target_platform,status,output_article_id FROM ai_generation_history WHERE generation_id=?").get(generationId) as Row | undefined;
        const expectedSourceId = item.itemKind === "Variant" ? this.sourceDraftId(queue.id, item.sourceIndex) : null;
        if (!history || history.status !== "Saved" || typeof history.output_article_id !== "string" || history.company_id !== queue.companyId || history.target_platform !== item.targetPlatform || (typeof history.source_article_id === "string" ? history.source_article_id : null) !== expectedSourceId) continue;
        const article = this.repository.getArticle(history.output_article_id);
        if (!article || article.brandId !== queue.companyId) continue;
        const completed = this.repository.db.prepare("UPDATE operations_generation_items SET status='Completed',source_draft_id=?,output_article_id=?,error_code=NULL,available_after=NULL,updated_at=? WHERE id=? AND status='Blocked' AND error_code='CONTENT_VALIDATION_REQUIRED'").run(item.itemKind === "Source" ? article.id : expectedSourceId, article.id, timestamp, item.id);
        if (completed.changes === 1 && item.itemKind === "Source") this.repository.db.prepare("UPDATE operations_generation_items SET status='Pending',error_code=NULL,updated_at=? WHERE queue_id=? AND source_index=? AND item_kind='Variant' AND status='Blocked' AND error_code='SOURCE_DRAFT_NOT_AVAILABLE'").run(timestamp, queue.id, item.sourceIndex);
      }
    })();
    this.finishQueue(queue.id);
    return this.generationQueue(input);
  }

  resolveValidationGeneration(payload: unknown): OperationsGenerationQueue {
    const input = validationDecisionSchema.parse(payload), queue = this.generationQueue(input);
    const item = this.repository.db.prepare("SELECT * FROM operations_generation_items WHERE id=? AND queue_id=? AND company_id=?").get(input.itemId, queue.id, input.companyId) as Row | undefined;
    if (!item || item.status !== "Blocked" || item.error_code !== "CONTENT_VALIDATION_REQUIRED") throw operationsError("QUEUE_STATE_INVALID", "该生成项不是待人工处理的内容校验红项");
    const timestamp = now();
    this.repository.db.transaction(() => {
      this.repository.db.prepare("UPDATE operations_generation_items SET status=?,generation_id=?,error_code=NULL,available_after=NULL,updated_at=? WHERE id=? AND status='Blocked' AND error_code='CONTENT_VALIDATION_REQUIRED'").run(input.decision === "regenerate" ? "Pending" : "Cancelled", input.decision === "regenerate" ? null : item.generation_id, timestamp, input.itemId);
      if (item.item_kind === "Source") this.repository.db.prepare("UPDATE operations_generation_items SET status=?,error_code=NULL,updated_at=? WHERE queue_id=? AND source_index=? AND item_kind='Variant' AND status='Blocked' AND error_code='SOURCE_DRAFT_NOT_AVAILABLE'").run(input.decision === "regenerate" ? "Pending" : "Cancelled", timestamp, queue.id, item.source_index);
      if (input.decision === "regenerate") this.repository.db.prepare("UPDATE operations_generation_queues SET status='Pending',updated_at=? WHERE id=?").run(timestamp, queue.id);
    })();
    this.finishQueue(queue.id);
    return this.generationQueue(input);
  }

  resolveRecoverableGeneration(payload: unknown): OperationsGenerationQueue {
    const input = recoverableDecisionSchema.parse(payload), queue = this.generationQueue(input);
    const item = this.repository.db.prepare("SELECT * FROM operations_generation_items WHERE id=? AND queue_id=? AND company_id=?").get(input.itemId, queue.id, input.companyId) as Row | undefined;
    if (!item || item.status !== "Recoverable") throw operationsError("QUEUE_STATE_INVALID", "该生成项不是待人工决定的未知结果");
    const timestamp = now();
    this.repository.db.transaction(() => {
      this.repository.db.prepare("UPDATE operations_generation_items SET status=?,error_code=NULL,available_after=NULL,updated_at=? WHERE id=? AND status='Recoverable'").run(input.decision === "retry" ? "Pending" : "Cancelled", timestamp, input.itemId);
      if (item.item_kind === "Source") this.repository.db.prepare("UPDATE operations_generation_items SET status=?,error_code=NULL,updated_at=? WHERE queue_id=? AND source_index=? AND item_kind='Variant' AND status='Blocked' AND error_code='SOURCE_DRAFT_NOT_AVAILABLE'").run(input.decision === "retry" ? "Pending" : "Cancelled", timestamp, queue.id, item.source_index);
      this.repository.db.prepare("UPDATE operations_generation_queues SET status='Pending',updated_at=? WHERE id=? AND status='Failed'").run(timestamp, queue.id);
    })();
    this.refreshQueueCounts(queue.id, timestamp);
    return this.generationQueue({ companyId: input.companyId, queueId: input.queueId });
  }

  private finishQueue(queueId: string): void {
    const timestamp = now(); this.refreshQueueCounts(queueId, timestamp);
    const counts = this.repository.db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN status IN ('Failed','Recoverable','Blocked') THEN 1 ELSE 0 END) failed,SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) pending FROM operations_generation_items WHERE queue_id=?").get(queueId) as Row;
    const current = this.repository.db.prepare("SELECT status FROM operations_generation_queues WHERE id=?").get(queueId) as Row | undefined;
    if (!current || current.status === "Paused" || current.status === "Cancelled") return;
    const status = integer(counts.pending) > 0 ? "Pending" : integer(counts.completed) === integer(counts.total) ? "Completed" : "Failed";
    this.repository.db.prepare("UPDATE operations_generation_queues SET status=?,updated_at=? WHERE id=?").run(status, timestamp, queueId);
  }

  private refreshQueueCounts(queueId: string, timestamp = now()): void {
    this.repository.db.prepare(`UPDATE operations_generation_queues SET
      completed_count=(SELECT COUNT(*) FROM operations_generation_items WHERE queue_id=? AND status='Completed'),
      failed_count=(SELECT COUNT(*) FROM operations_generation_items WHERE queue_id=? AND status IN ('Failed','Recoverable','Blocked')),
      updated_at=? WHERE id=?`).run(queueId, queueId, timestamp, queueId);
  }

  private refreshAllQueueCounts(timestamp = now()): void {
    const rows = this.repository.db.prepare("SELECT id FROM operations_generation_queues").all() as Row[];
    for (const row of rows) this.refreshQueueCounts(text(row.id), timestamp);
  }

  private queues(companyId: string): OperationsGenerationQueue[] {
    return (this.repository.db.prepare("SELECT * FROM operations_generation_queues WHERE company_id=? ORDER BY created_at DESC").all(companyId) as Row[]).map((row) => this.queueFromRow(row));
  }

  private queueFromRow(row: Row): OperationsGenerationQueue {
    return { id: text(row.id), companyId: text(row.company_id), provider: text(row.provider), model: text(row.model), profileId: text(row.profile_id), templateId: text(row.template_id), templateVersion: integer(row.template_version), topic: text(row.topic), requestedCount: integer(row.requested_count), targetPlatforms: parseArray(row.target_platforms_json), completedCount: integer(row.completed_count), failedCount: integer(row.failed_count), status: row.status as OperationsGenerationQueue["status"], concurrency: integer(row.concurrency), executionPolicy: "SerialPerCompany", createdAt: text(row.created_at), updatedAt: text(row.updated_at) };
  }

  private generationItems(companyId: string): OperationsGenerationItem[] {
    return (this.repository.db.prepare("SELECT * FROM operations_generation_items WHERE company_id=? ORDER BY created_at,source_index,target_platform").all(companyId) as Row[]).map((row) => this.itemFromRow(row));
  }

  private itemFromRow(row: Row): OperationsGenerationItem {
    return { id: text(row.id), queueId: text(row.queue_id), companyId: text(row.company_id), sourceIndex: integer(row.source_index), itemKind: row.item_kind === "Source" ? "Source" : "Variant", targetPlatform: text(row.target_platform), status: row.status as OperationsGenerationItem["status"], attemptCount: integer(row.attempt_count), generationId: typeof row.generation_id === "string" ? row.generation_id : null, sourceDraftId: typeof row.source_draft_id === "string" ? row.source_draft_id : null, outputArticleId: typeof row.output_article_id === "string" ? row.output_article_id : null, errorCode: typeof row.error_code === "string" ? row.error_code : null, availableAfter: typeof row.available_after === "string" ? row.available_after : null, createdAt: text(row.created_at), updatedAt: text(row.updated_at) };
  }

  previewImport(payload: unknown): OperationsImportPreview {
    const input = importPreviewSchema.parse(payload);
    this.ensureCompany(input.companyId);
    const brand = this.repository.getBrand(input.companyId)!;
    const value = (row: Record<string, string>, column?: string): string => column ? row[column] ?? "" : "";
    const mapped: ExcelArticleRowInput[] = input.rows.map((row, index) => ({ rowNumber: index + 2, templateVersion: value(row, input.mapping.templateVersion) || "1.0", title: value(row, input.mapping.title), body: value(row, input.mapping.body), summary: value(row, input.mapping.summary), company: brand.companyName, business: value(row, input.mapping.business), city: value(row, input.mapping.city), keywords: value(row, input.mapping.keywords), tags: value(row, input.mapping.tags), targetPlatforms: value(row, input.mapping.targetPlatforms), contentType: value(row, input.mapping.contentType), promotionStrength: value(row, input.mapping.promotionStrength), sourceNote: value(row, input.mapping.sourceNote) }));
    const preview = this.repository.previewExcelArticleImport({ fileName: input.fileName, rows: mapped, defaultBrandId: input.companyId });
    const previewId = randomUUID(); this.importPreviews.set(previewId, { companyId: input.companyId, preview });
    return { previewId, companyId: input.companyId, fileName: preview.fileName, mapping: input.mapping, totalRows: preview.totalRows, validRows: preview.validRows, duplicateRows: preview.duplicateRows, rows: preview.rows.map((row) => ({ rowNumber: row.rowNumber, title: row.title, body: row.body, status: row.status, duplicate: row.status === "DUPLICATE", errors: row.diagnosticCodes.map((code) => ({ row: row.rowNumber, column: code.includes("TITLE") ? input.mapping.title : code.includes("CONTENT") ? input.mapping.body : "", reason: row.errorReason })) })) };
  }

  commitImport(payload: unknown): OperationsImportResult {
    const input = z.strictObject({ companyId: idSchema, previewId: idSchema, duplicateRowNumbers: z.array(z.number().int().positive()).max(5000).optional() }).parse(payload);
    this.ensureCompany(input.companyId);
    const cached = this.importPreviews.get(input.previewId);
    if (!cached) throw operationsError("IMPORT_PREVIEW_INVALID", "导入预览不存在或应用已重启，请重新预览");
    if (cached.companyId !== input.companyId) throw operationsError("COMPANY_CONTEXT_MISMATCH", "导入预览与当前企业不匹配");
    const result = this.repository.confirmExcelArticleImport({ preview: cached.preview, duplicateRowNumbers: input.duplicateRowNumbers });
    for (const articleId of result.articleIds) {
      const article = this.assertArticleCompany(input.companyId, articleId);
      this.repository.updateArticle(article.id, { status: "draft" });
    }
    this.importPreviews.delete(input.previewId);
    return result;
  }

  snapshot(companyId: string): OperationsSnapshot {
    this.ensureCompany(idSchema.parse(companyId));
    const accounts = this.accounts(companyId), review = this.reviewItems(companyId), plans = this.plans(companyId), generationQueues = this.queues(companyId), generationItems = this.generationItems(companyId), facts = this.facts(companyId), usage = this.usage({ companyId, days: 30 }), studioDefaults = this.getStudioDefaults(companyId);
    const ownerActions: OperationsOwnerAction[] = accounts.flatMap((account) => {
      const health = this.runtimeHealth?.(account.accountId) ?? { state: "UNVERIFIED" as const, checkedAt: null };
      const base = { id: `account:${account.accountId}`, what: `${account.platformKey} ${account.accountAlias}`, lastCheckedAt: health.checkedAt };
      if (health.state === "NEEDS_LOGIN") return [{ ...base, why: "账号实时会话已失效", action: "请 Owner 正常登录该平台" }];
      if (health.state === "CREDENTIAL_INVALID") return [{ ...base, why: "账号凭据已失效", action: "请 Owner 安全更新凭据" }];
      if (health.state === "IDENTITY_MISMATCH") return [{ ...base, why: "当前远端身份与绑定账号不一致", action: "请 Owner 核对并修正账号绑定" }];
      if (health.state === "NETWORK_UNAVAILABLE") return [{ ...base, why: "网络暂时不可用，无法完成实时验证", action: "网络恢复后稍后重试验证" }];
      if (health.state === "UNVERIFIED") return [{ ...base, why: "账号尚未完成实时身份验证", action: "请刷新账号验证状态" }];
      if (health.state === "DISABLED") return [{ ...base, why: "账号已停用", action: "需要使用时由 Owner 启用账号" }];
      return [];
    });
    for (const profile of this.aiCenter.profiles().filter((item) => !item.configured)) ownerActions.push({ id: `provider:${profile.id}`, what: `${profile.displayName} 未配置`, why: "AI 生成队列无法调用该服务商", action: "请 Owner 在 AI Provider Center 安全配置凭据", lastCheckedAt: profile.lastVerifiedAt });
    const today = new Date().toISOString().slice(0, 10);
    const published = this.repository.db.prepare(`SELECT COUNT(*) count FROM publish_records r INNER JOIN publish_jobs j ON j.id=r.job_id INNER JOIN articles a ON a.id=j.article_id WHERE a.brand_id=? AND r.status='Published' AND r.published_at>=?`).get(companyId, today) as Row;
    const dashboard: OperationsDashboard = { pendingReview: review.filter((item) => ["Draft", "AI_Checked", "Needs_Review"].includes(item.reviewStatus) && item.articleStatus !== "archived").length, approved: review.filter((item) => item.reviewStatus === "Approved" && item.articleStatus !== "archived").length, draftPlansToday: plans.filter((item) => item.date === today && item.status === "Planned").length, generating: generationItems.filter((item) => item.status === "Running" || item.status === "Pending").length, failed: generationItems.filter((item) => ["Failed", "Recoverable", "Blocked"].includes(item.status)).length, needsOwnerAction: ownerActions.length, todayPublished: integer(published.count) };
    return { companyId, accounts, review, plans, generationQueues, generationItems, facts, usage, studioDefaults, dashboard, ownerActions };
  }
}

export type ContentOperationsApi = Pick<ContentOperations,
  "snapshot" | "accountCompany" | "listUnboundAccounts" | "bindAccount" | "approvedForPublish" | "reviewArticle" | "generatePlan" | "createPlanItem" | "createDraftFromPlan" | "preparePlanGeneration" | "consumePlanGenerationSeed" | "saveFact" | "activeFacts" | "getStudioDefaults" | "saveStudioDefaults" | "duplicateWarnings" | "usage" | "createGenerationQueue" | "generationQueue" | "runGenerationQueue" | "pauseGenerationQueue" | "resumeGenerationQueue" | "cancelGenerationQueue" | "retryFailedGeneration" | "reconcileGenerationQueue" | "resolveValidationGeneration" | "resolveRecoverableGeneration" | "previewImport" | "commitImport">;

export type { OperationsImportMapping, OperationsUsageRange };
