import type { AppRepository } from "@publisher/db";

/** Main owns the current workspace. A stale Renderer company never overrides it. */
export class CompanyWorkspace {
  constructor(private readonly repository: AppRepository, private readonly accountCompany: (id: string) => string | null) {}
  current(): string | null {
    const brands = this.repository.listBrands();
    const saved = this.repository.getSettings().operationsWorkspaceCompanyId;
    return brands.find(item => item.id === saved)?.id ?? brands[0]?.id ?? null;
  }
  select(companyId: string): { companyId: string } {
    if (!this.repository.getBrand(companyId)) throw new Error("企业工作区不存在");
    this.repository.setSetting("operationsWorkspaceCompanyId", companyId);
    return { companyId };
  }
  assertCompany(companyId: string | null | undefined): void {
    if (!companyId || companyId !== this.current()) throw new Error("企业工作区已切换，请重新选择当前企业的内容");
  }
  scoped<T extends Record<string, unknown>>(filters: T): T & { brandId: string } {
    const companyId = this.current();
    if (!companyId) throw new Error("请先创建并选择企业工作区");
    if (typeof filters.brandId === "string" && filters.brandId) this.assertCompany(filters.brandId);
    return { ...filters, brandId: companyId };
  }
  accountAllowed(accountId: string): boolean { return this.accountCompany(accountId) === this.current() && this.current() !== null; }
  assertAccount(accountId: string): void { if (!this.accountAllowed(accountId)) throw new Error("账号未绑定当前企业，请先在账号中心确认企业归属"); }
  prepare(channel: string, payload: unknown): unknown {
    const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (channel.startsWith("workspace:")) return payload;
    if (typeof input.companyId === "string") this.assertCompany(input.companyId);
    if (typeof input.brandId === "string" && input.brandId) this.assertCompany(input.brandId);
    if (["articles:list", "articles:page", "image-assets:list", "video-assets:list", "quality:items", "content-studio:tasks", "ai:tasks"].includes(channel)) return this.scoped(input);
    const ownedTables: Record<string, string> = { "brands:update": "brands", "brand-knowledge:update": "brand_knowledge_entries", "brand-knowledge:delete": "brand_knowledge_entries", "keywords:update-template": "keyword_templates", "keywords:delete-template": "keyword_templates", "video-assets:update": "video_assets", "video-assets:preflight": "video_assets", "content-studio:task": "content_studio_tasks", "content-studio:versions": "content_studio_tasks", "content-studio:regenerate": "content_studio_tasks", "content-studio:version-update": "content_studio_versions", "ai:task": "ai_tasks", "ai:cancel": "ai_tasks", "plans:generate-jobs": "publish_plans" };
    const ownedTable = ownedTables[channel], ownedId = typeof input.rootTaskId === "string" ? input.rootTaskId : typeof input.id === "string" ? input.id : null;
    if (ownedTable && ownedId) {
      if (ownedTable === "video_assets") this.assertCompany(this.repository.getManagedVideoAsset(ownedId)?.brandId);
      else {
        const row = this.repository.db.prepare(`SELECT ${ownedTable === "brands" ? "id" : "brand_id"} AS company_id FROM ${ownedTable} WHERE id=?`).get(ownedId) as { company_id: string } | undefined;
        this.assertCompany(row?.company_id);
      }
    }
    if (channel === "plans:create" && Array.isArray(input.accountIds)) for (const id of input.accountIds) if (typeof id === "string") this.assertAccount(id);
    if (channel === "articles:excel-pick" && typeof input.defaultBrandId === "string") this.assertCompany(input.defaultBrandId);
    if (channel === "articles:excel-confirm") {
      const preview = input.preview as { rows?: Array<{ matchedBrandId?: string | null }> } | undefined;
      if (!Array.isArray(preview?.rows)) throw new Error("导入预览无效，请重新预览");
      for (const row of preview.rows) if (row.matchedBrandId) this.assertCompany(row.matchedBrandId);
    }
    if (channel === "ai-center:history") return { ...input, companyId: this.current() ?? undefined };
    let articleId = typeof input.articleId === "string" ? input.articleId : null;
    if (channel.startsWith("articles:") && typeof input.id === "string") {
      articleId = channel.includes("variant") ? this.repository.getArticleVariant(input.id)?.articleId ?? null : input.id;
    }
    if (channel.startsWith("quality:") && typeof input.contentId === "string") articleId = input.contentType === "article_variant" ? this.repository.getArticleVariant(input.contentId)?.articleId ?? null : input.contentId;
    if (articleId) this.assertCompany(this.repository.getArticle(articleId)?.brandId);
    if (channel.startsWith("image-assets:") && typeof input.id === "string") this.assertCompany(this.repository.getImageAsset(input.id)?.brandId);
    const jobId = typeof input.jobId === "string" ? input.jobId : channel.startsWith("jobs:") && typeof input.id === "string" ? input.id : null;
    if (jobId) {
      const job = this.repository.getJob(jobId);
      if (job) this.assertCompany(this.repository.getArticle(job.articleId)?.brandId);
    }
    if (channel.startsWith("ai-center:") && ["draft", "save-draft", "validate-draft"].some(suffix => channel === `ai-center:${suffix}`) && typeof input.id === "string") {
      const row = this.repository.db.prepare("SELECT company_id FROM ai_generation_history WHERE generation_id=?").get(input.id) as { company_id: string } | undefined;
      this.assertCompany(row?.company_id);
    }
    if (!channel.startsWith("operations:")) {
      const accountRef = channel.startsWith("accounts:") && typeof input.id === "string" ? input.id : typeof input.accountId === "string" ? input.accountId : typeof input.platformAccountId === "string" ? input.platformAccountId : null;
      if (accountRef) {
        const account = this.repository.listAccounts().find(item => item.id === accountRef || item.platformAccountId === accountRef);
        this.assertAccount(account?.id ?? accountRef);
      }
    }
    return payload;
  }
}
