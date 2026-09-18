import type {
  AccountContext,
  AdapterManifest,
  CredentialField,
  LoginSession,
  LoginStatus,
  PlatformCapabilities,
  PublishArticleInput,
  PublishResult,
  PublishStatusResult,
  ValidationResult
} from "@publisher/domain";
import { PlatformAdapterError, type PlatformAdapter } from "@publisher/adapters-core";

export type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type BilibiliHttpMethod = "GET" | "POST";

/**
 * An endpoint is intentionally supplied by the integration owner. The matrix
 * proves the official article capability, but this workspace does not contain
 * a reviewed, stable route contract for the Bilibili article API.
 */
export interface BilibiliApiEndpoint {
  url: string;
  method?: BilibiliHttpMethod;
  idParameter?: string;
}

export interface BilibiliArticleApiConfig {
  draft?: BilibiliApiEndpoint;
  publish?: BilibiliApiEndpoint;
  status?: BilibiliApiEndpoint;
}

export interface BilibiliOAuthAuthorization {
  authorizationUrl: string;
  callbackUrl: string;
  state: string;
}

export interface BilibiliOAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  providerAccountId?: string;
}

/**
 * The adapter never stores or accepts a raw token. The application supplies
 * this boundary backed by its encrypted credential store and official OAuth
 * implementation.
 */
export interface BilibiliOAuthClient {
  createAuthorization(
    accountId: string,
    secrets: Record<string, string> | undefined,
    redirectUri: string
  ): BilibiliOAuthAuthorization;
  completeAuthorization(
    accountId: string,
    secrets: Record<string, string> | undefined,
    code: string,
    state: string
  ): Promise<BilibiliOAuthToken>;
  getToken(accountId: string): BilibiliOAuthToken | null;
  refresh(accountId: string, secrets: Record<string, string> | undefined): Promise<BilibiliOAuthToken>;
}

export interface BilibiliAdapterOptions {
  fetchPort?: FetchPort;
  apiRoot?: string;
  articleApi?: BilibiliArticleApiConfig;
  /** Alias kept for callers that name the object after its three endpoints. */
  articleEndpoints?: BilibiliArticleApiConfig;
  oauth?: BilibiliOAuthClient;
}

type JsonObject = Record<string, unknown>;

const API_ROOT = "https://api.bilibili.com";
const credentials: CredentialField[] = [
  { key: "clientId", label: "Bilibili OAuth Client ID", type: "oauth", required: true },
  { key: "clientSecret", label: "Bilibili OAuth Client Secret", type: "secret", required: true },
  { key: "redirectUri", label: "Bilibili OAuth Redirect URI", type: "text", required: true }
];

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function codeValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function messageValue(payload: JsonObject): string {
  const direct = [payload.message, payload.msg, payload.error_message, payload.detail]
    .map(stringValue)
    .find((value): value is string => Boolean(value));
  if (direct) return direct;
  const error = asObject(payload.error);
  return stringValue(error?.message) ?? stringValue(error?.msg) ?? "Bilibili API request failed";
}

function providerCode(payload: JsonObject): string | undefined {
  return codeValue(payload.code) ?? codeValue(payload.statusCode) ?? codeValue(payload.errorCode);
}

function isProviderFailure(payload: JsonObject): boolean {
  const code = providerCode(payload);
  if (code && code !== "0") return true;
  return payload.success === false;
}

function responseErrorCode(status: number, payload: JsonObject): ConstructorParameters<typeof PlatformAdapterError>[0] {
  const code = providerCode(payload);
  const message = messageValue(payload).toLowerCase();
  if (status === 401 || code === "-101") return "LOGIN_EXPIRED";
  if (status === 403 || code === "-403") return "PERMISSION_DENIED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 412 || code === "-412" || /captcha|human verification|security verification|验证码|安全验证|人机/iu.test(message)) return "USER_ACTION_REQUIRED";
  if (status === 400 || status === 422 || code === "-400" || /invalid|title|content|article|稿件|正文|标题/iu.test(message)) return "CONTENT_REJECTED";
  return "NETWORK_ERROR";
}

function findValue(payload: JsonObject, keys: string[]): unknown {
  const candidates: unknown[] = [payload, payload.data, payload.result];
  for (const candidate of candidates) {
    const object = asObject(candidate);
    if (!object) continue;
    for (const key of keys) {
      if (object[key] !== undefined) return object[key];
    }
  }
  return undefined;
}

function externalId(payload: JsonObject): string | undefined {
  return stringValue(findValue(payload, ["draft_id", "draftId", "article_id", "articleId", "submission_id", "submissionId", "id"]));
}

function publishedUrl(payload: JsonObject): string | undefined {
  return stringValue(findValue(payload, ["article_url", "articleUrl", "url", "published_url", "publishedUrl"]));
}

function normalizedStatus(value: unknown): PublishStatusResult["status"] | undefined {
  const status = stringValue(value)?.toLowerCase();
  if (!status) return undefined;
  if (["publishing", "processing", "pending", "auditing", "audit", "审核中", "待审核"].includes(status)) return "publishing";
  if (["published", "success", "completed", "approved", "passed", "public", "已发布", "审核通过"].includes(status)) return "published";
  if (["failed", "rejected", "error", "cancelled", "canceled", "驳回", "审核不通过"].includes(status)) return "failed";
  return undefined;
}

function statusValue(payload: JsonObject): unknown {
  return findValue(payload, ["publish_status", "publishStatus", "audit_status", "auditStatus", "status", "state"]);
}

export class BilibiliAdapterError extends PlatformAdapterError {
  constructor(code: ConstructorParameters<typeof PlatformAdapterError>[0], message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "BilibiliAdapterError";
  }
}

export class BilibiliAdapter implements PlatformAdapter {
  readonly platformKey = "bilibili";
  readonly manifest: AdapterManifest = {
    platformKey: "bilibili",
    displayName: "哔哩哔哩",
    category: "视频/专栏",
    version: "0.4.0",
    adapterStatus: "degraded",
    authStrategy: "OAuth2",
    callbackStrategy: "HttpsCallback",
    status: "Developing",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "https://www.bilibili.com/",
    developerPortal: "https://open.bilibili.com/doc",
    lastVerifiedAt: "2026-08-20",
    blockingReason: "需要 Bilibili 开发者审核、专栏发布权限、账号 OAuth 授权和真实低量 dry-run；视频稿件端点细节未确认，已关闭视频能力",
    credentialSchema: credentials,
    officialSources: ["https://open.bilibili.com/doc"]
  };

  private readonly fetchPort: FetchPort;
  private readonly apiRoot: string;
  private readonly articleApi: BilibiliArticleApiConfig;
  private readonly oauth: BilibiliOAuthClient | undefined;

  constructor(options: BilibiliAdapterOptions = {}) {
    this.fetchPort = options.fetchPort ?? fetch;
    this.apiRoot = options.apiRoot ?? API_ROOT;
    this.articleApi = options.articleApi ?? options.articleEndpoints ?? {};
    this.oauth = options.oauth;
  }

  getCapabilities(): PlatformCapabilities {
    return {
      article: true,
      imagePost: false,
      video: false,
      coverImage: false,
      tags: false,
      categories: false,
      scheduledPublish: false,
      draft: Boolean(this.articleApi.draft),
      markdown: false,
      richText: true,
      maxTitleLength: 0,
      maxImageCount: 0,
      videoFormats: [],
      supportsVideoCover: false,
      supportsVideoTags: false,
      videoPublishAsync: false
    };
  }

  getArticleApiReadiness(): { draft: boolean; publish: boolean; status: boolean } {
    return { draft: Boolean(this.articleApi.draft), publish: Boolean(this.articleApi.publish), status: Boolean(this.articleApi.status) };
  }

  getCredentialSchema(): CredentialField[] { return credentials.map((field) => ({ ...field })); }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const token = this.oauth?.getToken(ctx.accountId);
    if (!token?.accessToken.trim()) return "logged_out";
    if (token.expiresAt && Number.isFinite(Date.parse(token.expiresAt)) && Date.parse(token.expiresAt) <= Date.now()) return "expired";
    return "logged_in";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const redirectUri = this.settingString(ctx, "oauthRedirectUri") ?? this.settingString(ctx, "redirectUri") ?? ctx.secrets?.redirectUri;
    if (!this.oauth || !redirectUri) {
      return {
        sessionId: `bilibili-oauth-${Date.now()}`,
        requiresUserAction: true,
        message: "请通过哔哩哔哩官方开放平台完成 OAuth 授权；应用审核、scope、回调地址和安全验证均由用户/平台正常流程完成，系统不绕过验证码"
      };
    }
    const authorization = this.oauth.createAuthorization(ctx.accountId, ctx.secrets, redirectUri);
    return { sessionId: `bilibili-oauth-${Date.now()}`, requiresUserAction: true, authorizationUrl: authorization.authorizationUrl, callbackUrl: authorization.callbackUrl, message: "请在哔哩哔哩官方 OAuth 页面完成授权，完成验证码或安全验证后返回系统" };
  }

  async completeOAuthLogin(ctx: AccountContext, code: string, state: string): Promise<BilibiliOAuthToken> {
    if (!this.oauth) throw new BilibiliAdapterError("AUTH_REQUIRED", "Bilibili OAuth 安全边界尚未注入");
    if (!code.trim() || !state.trim()) throw new BilibiliAdapterError("PERMISSION_DENIED", "Bilibili OAuth 回调缺少 code 或 state");
    return this.oauth.completeAuthorization(ctx.accountId, ctx.secrets, code, state);
  }

  async completeLogin(ctx: AccountContext, code: string, state: string): Promise<BilibiliOAuthToken> {
    return this.completeOAuthLogin(ctx, code, state);
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!article.articleId.trim()) errors.push("Bilibili 专栏文章 ID 不能为空");
    if (!article.title.trim()) errors.push("Bilibili 专栏标题不能为空");
    if (!article.body.trim()) errors.push("Bilibili 专栏正文不能为空");
    if (article.coverPath) errors.push("Bilibili 专栏封面字段未在当前官方 API 契约中确认");
    if (article.images && article.images.length > 0) errors.push("Bilibili 专栏图片上传字段未在当前官方 API 契约中确认");
    if (article.tags.length > 0) warnings.push("Bilibili 专栏标签字段未在当前矩阵中确认，标签不会提交");
    if (article.summary.trim()) warnings.push("Bilibili 专栏摘要字段未在当前矩阵中确认，摘要不会提交");
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BilibiliAdapterError("CONTENT_REJECTED", validation.errors.join("；"));

    const dryRun = ctx.settings.dryRun === true;
    this.requireEndpoint("draft", this.articleApi.draft);
    if (!dryRun) {
      this.requireEndpoint("publish", this.articleApi.publish);
      this.requireEndpoint("status", this.articleApi.status);
    }
    const accessToken = await this.getAccessToken(ctx);
    const draftResponse = await this.request(this.articleApi.draft as BilibiliApiEndpoint, accessToken, {
      article_id: article.articleId,
      title: article.title,
      content: article.body
    });
    const draftId = externalId(draftResponse);
    if (!draftId) throw new BilibiliAdapterError("NETWORK_ERROR", "Bilibili 专栏草稿响应缺少可回查稿件 ID");
    if (dryRun) return { success: true, dryRun: true, prepared: true, externalId: draftId, response: { adapter: this.platformKey, stage: "draft", providerResponse: draftResponse, warnings: validation.warnings } };

    const publishedResponse = await this.request(this.articleApi.publish as BilibiliApiEndpoint, accessToken, { draft_id: draftId });
    const publishId = externalId(publishedResponse) ?? draftId;
    return { success: true, status: "publishing", dryRun: false, externalId: publishId, response: { adapter: this.platformKey, stage: "publishing", draftId, providerResponse: publishedResponse } };
  }

  async publishVideo(_ctx: AccountContext, _video: { title: string; description?: string; tags: string[]; videoPath: string; coverPath?: string }): Promise<PublishResult> {
    throw new BilibiliAdapterError("API_REVIEW_REQUIRED", "Bilibili 视频稿件 API 端点和权限细节尚未在当前矩阵中确认，视频 capability 已关闭");
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    this.requireEndpoint("status", this.articleApi.status);
    if (!externalId.trim()) throw new BilibiliAdapterError("CONTENT_REJECTED", "Bilibili 专栏稿件 ID 不能为空");
    const accessToken = await this.getAccessToken(ctx);
    const endpoint = this.articleApi.status as BilibiliApiEndpoint;
    const response = await this.request(endpoint, accessToken, undefined, { [endpoint.idParameter ?? "article_id"]: externalId });
    const status = normalizedStatus(statusValue(response));
    if (!status) throw new BilibiliAdapterError("API_REVIEW_REQUIRED", "Bilibili 专栏状态响应字段未通过官方契约确认");
    return {
      status,
      externalId,
      ...(publishedUrl(response) ? { publishedUrl: publishedUrl(response) } : {}),
      response: { adapter: this.platformKey, stage: "status", providerResponse: response },
      ...(status === "failed" ? { errorCode: "CONTENT_REJECTED", errorMessage: messageValue(response) } : {})
    };
  }

  private settingString(ctx: AccountContext, key: string): string | undefined {
    const value = ctx.settings[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private requireEndpoint(name: "draft" | "publish" | "status", endpoint: BilibiliApiEndpoint | undefined): void {
    if (!endpoint?.url.trim()) throw new BilibiliAdapterError("API_REVIEW_REQUIRED", `Bilibili 专栏 ${name} 端点尚未完成官方 API 审核，拒绝猜测或调用未确认接口`);
  }

  private async getAccessToken(ctx: AccountContext): Promise<string> {
    if (!this.oauth) throw new BilibiliAdapterError("AUTH_REQUIRED", "Bilibili OAuth 安全边界尚未配置");
    const current = this.oauth.getToken(ctx.accountId);
    if (current?.accessToken.trim() && (!current.expiresAt || !Number.isFinite(Date.parse(current.expiresAt)) || Date.parse(current.expiresAt) > Date.now())) return current.accessToken;
    if (!current) throw new BilibiliAdapterError("AUTH_REQUIRED", "Bilibili 账号尚未完成 OAuth 授权");
    try {
      const refreshed = await this.oauth.refresh(ctx.accountId, ctx.secrets);
      if (!refreshed.accessToken.trim()) throw new BilibiliAdapterError("LOGIN_EXPIRED", "Bilibili OAuth 刷新响应缺少 access token");
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof PlatformAdapterError) throw error;
      throw new BilibiliAdapterError("LOGIN_EXPIRED", "Bilibili OAuth 已过期且刷新失败，请重新授权");
    }
  }

  private endpointUrl(endpoint: BilibiliApiEndpoint): string {
    try { return new URL(endpoint.url, this.apiRoot).toString(); }
    catch { throw new BilibiliAdapterError("API_REVIEW_REQUIRED", "Bilibili API 端点 URL 无效，拒绝调用"); }
  }

  private async request(endpoint: BilibiliApiEndpoint, accessToken: string, body?: Record<string, string | string[]>, query?: Record<string, string>): Promise<JsonObject> {
    const method = endpoint.method ?? "POST";
    const url = new URL(this.endpointUrl(endpoint));
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${accessToken}` };
    const init: RequestInit = { method, headers };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      if (body) init.body = JSON.stringify(body);
    }
    let response: Response;
    try { response = await this.fetchPort(url.toString(), init); }
    catch { throw new BilibiliAdapterError("NETWORK_ERROR", "Bilibili 官方 API 网络请求失败"); }
    const payload = await this.readJson(response);
    if (!response.ok || isProviderFailure(payload)) {
      const code = responseErrorCode(response.status, payload);
      throw new BilibiliAdapterError(code, `Bilibili 官方 API 请求失败：${messageValue(payload)}`, providerCode(payload));
    }
    return payload;
  }

  private async readJson(response: Response): Promise<JsonObject> {
    try {
      const value: unknown = await response.json();
      return asObject(value) ?? {};
    } catch {
      if (response.status === 204) return {};
      throw new BilibiliAdapterError("NETWORK_ERROR", "Bilibili 官方 API 返回了无效 JSON");
    }
  }
}

export const BilibiliOfficialAdapter = BilibiliAdapter;
