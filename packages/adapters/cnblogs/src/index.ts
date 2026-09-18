import type { AccountContext, AccountProfile, AdapterManifest, CredentialField, ErrorCode, LoginSession, LoginStatus, PlatformCapabilities, PublishArticleInput, PublishResult, PublishStatusResult, ValidationResult } from "@publisher/domain";
import { PlatformAdapterError, type PlatformAdapter } from "@publisher/adapters-core";

export const CNBLOGS_CREATE_POST_ENDPOINT = "https://i.cnblogs.com/openapi/v1/posts";
export const CNBLOGS_REVIEW_STATUS_ENDPOINT = "https://i.cnblogs.com/openapi/v1/posts/reviewStatus:check";
export const CNBLOGS_CORP_INFO_ENDPOINT = "https://i.cnblogs.com/openapi/v1/corp/info";
export const CNBLOGS_OFFICIAL_DOCUMENTATION = "https://www.cnblogs.com/cmt/articles/19246558";

export interface CnblogsHttpResponse { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>; }
export interface CnblogsHttpClient { request(url: string, init: RequestInit): Promise<CnblogsHttpResponse>; }
export interface CnblogsAdapterOptions { httpClient?: CnblogsHttpClient; }

const credentials: CredentialField[] = [
  { key: "blogUrl", label: "博客地址", type: "text", required: false, helpText: "例如 https://www.cnblogs.com/your-blog/" },
  { key: "blogApp", label: "Blog App", type: "text", required: false, helpText: "仅在你的博客后台明确要求时填写" },
  { key: "pat", label: "Personal Access Token", type: "secret", required: true, helpText: "仅在主进程中使用 safeStorage 加密保存，保存后不再回显" }
];

const capabilities: PlatformCapabilities = { article: true, imagePost: false, video: false, coverImage: false, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: true, richText: true, maxTitleLength: 200, maxImageCount: 0, maxTagCount: 20, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: true };

export function mapCnblogsError(status: number, message: string): ErrorCode {
  if (status === 401) return "LOGIN_EXPIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500 || status === 0) return "NETWORK_ERROR";
  if (/token|auth|认证|凭据/iu.test(message)) return "AUTH_REQUIRED";
  return "CONTENT_REJECTED";
}

function normalizePlainTextForMarkdown(body: string): string {
  return body.replace(/\r\n?/gu, "\n").trim().replace(/\n{3,}/gu, "\n\n").split("\n").map((line) => line.trimEnd()).join("  \n");
}

function readJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export class CnblogsOfficialApiAdapter implements PlatformAdapter {
  readonly platformKey = "cnblogs";
  readonly manifest: AdapterManifest = {
    platformKey: "cnblogs", displayName: "博客园", category: "图文/技术", version: "1.1.2", adapterStatus: "ready",
    authStrategy: "AppCredential", callbackStrategy: "ManualCodeCallback", status: "WaitingForUser", researchStatus: "verified",
    transport: "official_api", integrationMode: "API", supportsArticle: true, supportsVideo: false,
    officialWebsite: "https://www.cnblogs.com/", developerPortal: CNBLOGS_OFFICIAL_DOCUMENTATION, lastVerifiedAt: "2026-08-22",
    blockingReason: "需要用户配置 Personal Access Token；连接通过不等于真实发布通过，默认先创建未发布草稿。",
    credentialSchema: credentials, officialSources: [CNBLOGS_OFFICIAL_DOCUMENTATION]
  };
  private readonly http: CnblogsHttpClient;

  constructor(options: CnblogsAdapterOptions = {}) {
    this.http = options.httpClient ?? { request: async (url, init) => fetch(url, init) };
  }

  getCapabilities(): PlatformCapabilities { return { ...capabilities }; }
  getCredentialSchema(): CredentialField[] { return credentials.map((field) => ({ ...field })); }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const token = ctx.secrets?.pat?.trim();
    if (!token) return "logged_out";
    const info = await this.request(CNBLOGS_CORP_INFO_ENDPOINT, token, { method: "GET" });
    if (info.status === 401 || info.status === 403) return "expired";
    if (info.status === 429) return "needs_user_action";
    if (info.ok) return "logged_in";
    const probe = await this.request(CNBLOGS_REVIEW_STATUS_ENDPOINT, token, { method: "POST", body: JSON.stringify({ PostId: 0 }) });
    if (probe.status === 401 || probe.status === 403) return "expired";
    if (probe.status === 429) return "needs_user_action";
    return probe.ok ? "logged_in" : "unknown";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const loginStatus = await this.checkLogin(ctx);
    return { sessionId: `cnblogs-pat-${ctx.accountId}-${Date.now()}`, requiresUserAction: loginStatus !== "logged_in", opened: false, authStrategy: "AppCredential", callbackStrategy: "ManualCodeCallback", message: loginStatus === "logged_in" ? "博客园 PAT 连接验证通过" : "请配置有效的博客园 Personal Access Token 后重新验证" };
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    return { ...(ctx.secrets?.blogApp ? { accountId: ctx.secrets.blogApp, accountName: ctx.secrets.blogApp } : {}), authorizationStatus: "Authorized" };
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!article.title.trim()) errors.push("博客园标题不能为空");
    if (!article.body.trim()) errors.push("博客园正文不能为空");
    if (article.title.length > capabilities.maxTitleLength) errors.push("博客园标题不能超过 200 个字符");
    if (article.coverPath || (article.images?.length ?? 0) > 0) warnings.push("博客园当前官方发布文档未声明图片上传端点，首版忽略图片且只发送标题和正文");
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new PlatformAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    const token = ctx.secrets?.pat?.trim();
    if (!token) throw new PlatformAdapterError("AUTH_REQUIRED", "博客园 PAT 尚未配置");
    const isDraft = ctx.settings.dryRun === true;
    if (!isDraft && ctx.settings.manualConfirmationRequired !== false) throw new PlatformAdapterError("USER_ACTION_REQUIRED", "博客园直接发布前必须由用户明确确认");
    const payload = { Title: article.title.trim(), Body: normalizePlainTextForMarkdown(article.body), PostType: 1, Description: article.summary.trim(), PostFormat: "Markdown", IsPublished: !isDraft, IsAllowComments: true, IsAigc: true, Categories: article.category ? [article.category] : [], Tags: article.tags };
    const response = await this.request(CNBLOGS_CREATE_POST_ENDPOINT, token, { method: "POST", body: JSON.stringify(payload) });
    const json = readJsonObject(await response.json().catch(() => ({})));
    const value = readJsonObject(json.value);
    if (!response.ok || json.success === false) throw new PlatformAdapterError(mapCnblogsError(response.status, String(json.message ?? "")), "博客园官方发布接口请求失败", String(response.status));
    const externalId = String(value.postId ?? value.PostId ?? "").trim();
    const publishedUrl = String(value.postUrl ?? value.PostUrl ?? "").trim();
    if (!externalId) throw new PlatformAdapterError("API_REVIEW_REQUIRED", "博客园响应缺少 postId，未声明发布成功");
    return { success: true, status: isDraft ? "publishing" : "published", dryRun: isDraft, prepared: isDraft, externalId, ...(publishedUrl ? { publishedUrl } : {}), response: { adapter: this.platformKey, transport: "official_api", endpoint: CNBLOGS_CREATE_POST_ENDPOINT, postId: externalId, isDraft, postFormat: "Markdown" } };
  }

  async createDraft(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    return this.publishArticle({ ...ctx, settings: { ...ctx.settings, dryRun: true, manualConfirmationRequired: true } }, article);
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    const token = ctx.secrets?.pat?.trim();
    if (!token) throw new PlatformAdapterError("AUTH_REQUIRED", "博客园 PAT 尚未配置");
    const postId = Number(externalId);
    if (!Number.isSafeInteger(postId) || postId <= 0) throw new PlatformAdapterError("CONTENT_REJECTED", "博客园 postId 无效");
    const response = await this.request(CNBLOGS_REVIEW_STATUS_ENDPOINT, token, { method: "POST", body: JSON.stringify({ PostId: postId }) });
    const json = readJsonObject(await response.json().catch(() => ({})));
    const value = readJsonObject(json.value);
    if (!response.ok || json.success === false) throw new PlatformAdapterError(mapCnblogsError(response.status, String(json.message ?? "")), "博客园审核状态查询失败", String(response.status));
    const reviewStatus = Number(value.reviewStatus ?? value.ReviewStatus);
    const status = reviewStatus === 1 ? "published" : reviewStatus === 2 ? "failed" : "publishing";
    return { status, externalId, ...(typeof value.url === "string" ? { publishedUrl: value.url } : {}), ...(status === "failed" ? { errorCode: "CONTENT_REJECTED" as const, errorMessage: String(value.description ?? json.message ?? "博客园审核未通过") } : {}), response: { adapter: this.platformKey, endpoint: CNBLOGS_REVIEW_STATUS_ENDPOINT, reviewStatus } };
  }

  private request(url: string, token: string, init: RequestInit): Promise<CnblogsHttpResponse> {
    return this.http.request(url, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Authorization-Type": "pat", ...(init.headers ?? {}) } });
  }
}

export default CnblogsOfficialApiAdapter;
