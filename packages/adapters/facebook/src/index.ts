import type {
  AccountContext,
  AccountProfile,
  AdapterManifest,
  CredentialField,
  ErrorCode,
  LoginSession,
  LoginStatus,
  PlatformCapabilities,
  PublishArticleInput,
  PublishResult,
  PublishStatusResult,
  ValidationResult
} from "@publisher/domain";
import {
  OAuthManager,
  PlatformAdapterError,
  type OAuthPlatformConfig,
  type PlatformAdapter
} from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";

/** Highest Graph API version verified against Meta's official service on 2026-08-20. */
export const FACEBOOK_GRAPH_API_VERSION = "v26.0";
const GRAPH_ROOT = `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}`;
const REQUIRED_SCOPES = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"] as const;
const CONTENT_TASKS = new Set(["CREATE_CONTENT", "MANAGE", "PROFILE_PLUS_CREATE_CONTENT"]);
const MAX_PAGE_LIST_REQUESTS = 10;

export const FACEBOOK_ENDPOINTS = {
  authorization: `https://www.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/dialog/oauth`,
  accessToken: `${GRAPH_ROOT}/oauth/access_token`,
  permissions: `${GRAPH_ROOT}/me/permissions`,
  pages: `${GRAPH_ROOT}/me/accounts`,
  pageFeed: (pageId: string): string => `${GRAPH_ROOT}/${encodeURIComponent(pageId)}/feed`,
  post: (postId: string): string => `${GRAPH_ROOT}/${encodeURIComponent(postId)}`
} as const;

const FACEBOOK_OAUTH_CONFIG: OAuthPlatformConfig = {
  platformKey: "facebook",
  authorizationUrl: FACEBOOK_ENDPOINTS.authorization,
  tokenUrl: FACEBOOK_ENDPOINTS.accessToken,
  clientIdKey: "clientId",
  clientSecretKey: "clientSecret",
  scopes: [...REQUIRED_SCOPES],
  usePkce: false,
  tokenClientAuth: "body",
  extraAuthorizationParams: { auth_type: "rerequest" }
};

const credentials: CredentialField[] = [
  { key: "clientId", label: "Meta App ID", type: "oauth", required: true },
  { key: "clientSecret", label: "Meta App Secret", type: "secret", required: true },
  { key: "redirectUri", label: "Meta OAuth 回调地址", type: "text", required: true, helpText: "必须与 Meta App 中配置的有效 OAuth 重定向 URI 完全一致。" },
  { key: "pageId", label: "Facebook Page ID", type: "text", required: true, helpText: "仅支持由当前用户管理且授予内容创建任务的 Facebook Page；不支持个人主页。" }
];

export type FacebookFetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface FacebookPagePostInput extends PublishArticleInput {
  /** Optional per-post Page link. The shared V0.4 article model does not expose this field yet. */
  link?: string;
}

export interface FacebookAdapterOptions {
  credentialStore: CredentialStore;
  fetchPort?: FacebookFetchPort;
  oauthManager?: OAuthManager;
  now?: () => Date;
  /** Per-request Graph API timeout. Defaults to 30 seconds. */
  timeoutMs?: number;
}

interface MetaGraphError {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  is_transient?: unknown;
  error_user_title?: unknown;
  error_user_msg?: unknown;
}

interface MetaGraphEnvelope extends Record<string, unknown> {
  error?: MetaGraphError;
}

interface PageTokenRecord {
  pageId: string;
  pageName: string;
  accessToken: string;
  scopes: string[];
  tasks: string[];
  authorizedAt: string;
  expiresAt?: string;
}

interface PageAccount {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return Number(value);
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function graphErrorMessage(error: MetaGraphError | undefined): string {
  return stringValue(error?.error_user_msg) ?? stringValue(error?.message) ?? "Meta Graph API 请求失败";
}

export function mapFacebookError(code: number | undefined, subcode: number | undefined, httpStatus: number | undefined, message = ""): ErrorCode {
  const normalized = message.toLowerCase();
  if (/checkpoint|captcha|two[- ]factor|security (?:check|verification)|identity verification|confirm your identity|验证码|安全验证|身份验证/iu.test(normalized)) return "USER_ACTION_REQUIRED";
  if (code === 190 || [458, 459, 460, 463, 464, 467].includes(subcode ?? -1) || httpStatus === 401) return "LOGIN_EXPIRED";
  if (/app review|advanced access|not (?:approved|authorized) for|requires review/iu.test(normalized)) return "API_REVIEW_REQUIRED";
  if ([10, 200, 294].includes(code ?? -1) || httpStatus === 403) return "PERMISSION_DENIED";
  if ([4, 17, 32, 613].includes(code ?? -1) || httpStatus === 429) return "RATE_LIMITED";
  if (code === 368 || code === 100 || httpStatus === 400 || httpStatus === 422) return "CONTENT_REJECTED";
  if (httpStatus === 408) return "TIMEOUT";
  if (httpStatus !== undefined && httpStatus >= 500) return "NETWORK_ERROR";
  return "NETWORK_ERROR";
}

export class FacebookAdapterError extends PlatformAdapterError {
  constructor(code: ErrorCode, message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "FacebookAdapterError";
  }
}

export class FacebookPagesAdapter implements PlatformAdapter {
  readonly platformKey = "facebook";
  readonly manifest: AdapterManifest = {
    platformKey: "facebook",
    displayName: "Facebook Pages",
    category: "海外图文",
    version: "0.4.0",
    adapterStatus: "ready",
    authStrategy: "OAuth2",
    callbackStrategy: "HttpsCallback",
    status: "WaitingForUser",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "https://www.facebook.com/pages/",
    developerPortal: "https://developers.facebook.com/docs/pages-api/",
    lastVerifiedAt: "2026-08-20",
    blockingReason: "Facebook Page OAuth、Page access token、权限预检、文本/链接 Feed、external ID 与状态回查代码已完成；真实 Dry Run 仍需账号所有者完成 Meta 官方 OAuth、App Review/Advanced Access、Page 权限确认及人工低风险验收。不支持个人主页或本地图片附件。",
    credentialSchema: credentials,
    officialSources: [
      "https://developers.facebook.com/docs/pages-api/getting-started/",
      "https://developers.facebook.com/docs/pages-api/posts/",
      "https://developers.facebook.com/docs/facebook-login/guides/access-tokens/",
      "https://developers.facebook.com/docs/graph-api/reference/page/feed/",
      "https://developers.facebook.com/docs/graph-api/reference/post/"
    ]
  };

  private readonly store: CredentialStore;
  private readonly fetchPort: FacebookFetchPort;
  private readonly oauth: OAuthManager;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: FacebookAdapterOptions) {
    this.store = options.credentialStore;
    this.fetchPort = options.fetchPort ?? fetch;
    this.oauth = options.oauthManager ?? new OAuthManager(options.credentialStore, this.fetchPort);
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 30_000);
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
      draft: false,
      markdown: false,
      richText: false,
      maxTitleLength: 0,
      maxImageCount: 0,
      maxTagCount: 0,
      videoFormats: [],
      supportsVideoCover: false,
      supportsVideoTags: false,
      videoPublishAsync: false
    };
  }

  getCredentialSchema(): CredentialField[] {
    return credentials.map((field) => ({ ...field }));
  }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const pageId = this.pageId(ctx);
    const record = this.readPageToken(ctx.accountId);
    if (!pageId || !record || record.pageId !== pageId || !record.accessToken) return "logged_out";
    if (this.expired(record.expiresAt)) return "expired";
    if (!this.hasRequiredScopes(record.scopes) || !this.canCreateContent(record.tasks)) return "needs_user_action";
    return "logged_in";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const sessionId = `facebook-oauth-${ctx.accountId}-${Date.now()}`;
    const redirectUri = this.secretOrSetting(ctx, "redirectUri") ?? this.secretOrSetting(ctx, "oauthRedirectUri");
    if (!this.pageId(ctx)) return { sessionId, requiresUserAction: true, message: "请先配置要授权的 Facebook Page ID；个人主页不受支持。" };
    if (!redirectUri) return { sessionId, requiresUserAction: true, message: "请先配置 Meta OAuth 回调地址。" };
    try {
      const request = this.oauth.createAuthorization(ctx.accountId, FACEBOOK_OAUTH_CONFIG, ctx.secrets, redirectUri);
      const authorizationUrl = new URL(request.authorizationUrl);
      const scope = authorizationUrl.searchParams.get("scope");
      if (scope) authorizationUrl.searchParams.set("scope", scope.split(/\s+/u).filter(Boolean).join(","));
      return {
        sessionId: `facebook-oauth-${request.state}`,
        requiresUserAction: true,
        authorizationUrl: authorizationUrl.toString(),
        callbackUrl: request.callbackUrl,
        message: "请在 Meta 官方登录页授权 Page 发帖权限。App Review、双重验证、安全检查与 Page 权限确认必须由用户按官方流程完成。"
      };
    } catch (error) {
      if (error instanceof PlatformAdapterError) return { sessionId, requiresUserAction: true, message: error.message };
      return { sessionId, requiresUserAction: true, message: "Meta OAuth 授权准备失败。" };
    }
  }

  async completeLogin(ctx: AccountContext, code: string, state: string): Promise<Record<string, unknown>> {
    if (!code.trim() || !state.trim()) throw new FacebookAdapterError("AUTH_REQUIRED", "OAuth code/state 不能为空");
    const configuredPageId = this.requirePageId(ctx);
    const userToken = await this.oauth.completeAuthorization(ctx.accountId, FACEBOOK_OAUTH_CONFIG, ctx.secrets, code, state);
    const scopes = await this.readGrantedScopes(userToken.accessToken);
    if (!this.hasRequiredScopes(scopes)) {
      const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
      throw new FacebookAdapterError("PERMISSION_DENIED", `Meta OAuth 未授予必需权限：${missing.join(", ")}`);
    }
    const page = await this.findPage(configuredPageId, userToken.accessToken);
    if (!page) throw new FacebookAdapterError("PERMISSION_DENIED", "当前 OAuth 用户无法访问配置的 Facebook Page，或未返回 Page access token");
    if (!this.canCreateContent(page.tasks)) throw new FacebookAdapterError("PERMISSION_DENIED", "当前用户在该 Facebook Page 上没有内容创建任务权限");

    const record: PageTokenRecord = {
      pageId: page.id,
      pageName: page.name,
      accessToken: page.accessToken,
      scopes,
      tasks: page.tasks,
      authorizedAt: this.now().toISOString(),
      ...(userToken.expiresAt ? { expiresAt: userToken.expiresAt } : {})
    };
    this.store.set(this.pageTokenKey(ctx.accountId), JSON.stringify(record));
    return {
      configured: true,
      pageId: record.pageId,
      pageName: record.pageName,
      scopes: record.scopes,
      tasks: record.tasks,
      ...(record.expiresAt ? { expiresAt: record.expiresAt } : {})
    };
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const record = this.readPageToken(ctx.accountId);
    if (!record) throw new FacebookAdapterError("AUTH_REQUIRED", "Facebook Page 尚未完成 OAuth 授权");
    return { accountId: record.pageId, accountName: record.pageName, scopes: record.scopes, expiresAt: record.expiresAt, authorizationStatus: this.canCreateContent(record.tasks) ? "Authorized" : "Partial" };
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let link: string | undefined;
    try {
      link = this.link(article);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Facebook Page 链接格式无效");
    }
    if (!this.message(article) && !link) errors.push("Facebook Page Feed 帖子必须包含文本或 HTTPS/HTTP 链接");
    if (article.coverPath?.trim()) errors.push("当前 Facebook Pages Adapter 不支持本地封面附件");
    if ((article.images?.length ?? 0) > 0) errors.push("当前 Facebook Pages Adapter 不支持本地图片附件");
    if (article.tags.length > 0) warnings.push("Facebook Page Feed 没有独立 tags 字段，标签不会提交");
    if (article.summary.trim()) warnings.push("Facebook Page Feed 没有独立 summary 字段，摘要不会提交");
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new FacebookAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    const message = this.message(article);
    const link = this.link(article);
    if (ctx.settings.dryRun === true) {
      return {
        success: true,
        dryRun: true,
        prepared: true,
        response: {
          adapter: this.platformKey,
          graphApiVersion: FACEBOOK_GRAPH_API_VERSION,
          target: "facebook_page_feed",
          messageLength: message.length,
          linkPresent: Boolean(link),
          networkCalls: 0,
          warnings: validation.warnings
        }
      };
    }

    const page = this.requirePageToken(ctx);
    await this.verifyPageForPublish(page);
    const body = new URLSearchParams();
    if (message) body.set("message", message);
    if (link) body.set("link", link);
    const response = await this.request(FACEBOOK_ENDPOINTS.pageFeed(page.pageId), page.accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }, "publish");
    const externalId = stringValue(response.id);
    if (!externalId) throw new FacebookAdapterError("UPLOAD_FAILED", "Meta Page Feed 发帖响应缺少 post id");
    return {
      success: true,
      status: "publishing",
      externalId,
      response: {
        adapter: this.platformKey,
        graphApiVersion: FACEBOOK_GRAPH_API_VERSION,
        target: "facebook_page_feed",
        pageId: page.pageId,
        externalId,
        needsReconciliation: true
      }
    };
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    if (!externalId.trim()) throw new FacebookAdapterError("CONTENT_REJECTED", "Facebook Page post id 不能为空");
    const page = this.requirePageToken(ctx);
    const url = new URL(FACEBOOK_ENDPOINTS.post(externalId.trim()));
    url.searchParams.set("fields", "id,permalink_url,is_published,status_type,created_time");
    let response: MetaGraphEnvelope;
    try {
      response = await this.request(url.toString(), page.accessToken, { method: "GET" }, "status");
    } catch (error) {
      if (error instanceof FacebookAdapterError && error.providerCode?.split("/")[0] === "100") {
        return {
          status: "failed",
          externalId: externalId.trim(),
          errorCode: "CONTENT_REJECTED",
          errorMessage: "Meta 未找到该 Facebook Page 帖子，可能已被删除或不可访问",
          response: { adapter: this.platformKey, source: "post", providerCode: error.providerCode }
        };
      }
      throw error;
    }
    const id = stringValue(response.id) ?? externalId.trim();
    const publishedUrl = stringValue(response.permalink_url);
    if (typeof response.is_published !== "boolean") {
      return {
        status: "failed",
        externalId: id,
        ...(publishedUrl ? { publishedUrl } : {}),
        errorCode: "PLATFORM_CHANGED",
        errorMessage: "Meta Post 状态响应缺少 is_published 字段",
        response: { adapter: this.platformKey, source: "post", needsReconciliation: false }
      };
    }
    if (response.is_published === true) {
      return {
        status: "published",
        externalId: id,
        ...(publishedUrl ? { publishedUrl } : {}),
        response: { adapter: this.platformKey, source: "post", isPublished: true, statusType: response.status_type }
      };
    }
    return {
      status: "publishing",
      externalId: id,
      ...(publishedUrl ? { publishedUrl } : {}),
      response: { adapter: this.platformKey, source: "post", isPublished: response.is_published, statusType: response.status_type, needsReconciliation: true }
    };
  }

  private async readGrantedScopes(userAccessToken: string): Promise<string[]> {
    const envelope = await this.request(FACEBOOK_ENDPOINTS.permissions, userAccessToken, { method: "GET" }, "permissions");
    const rows = Array.isArray(envelope.data) ? envelope.data : [];
    return rows.flatMap((row) => {
      const item = objectValue(row);
      return stringValue(item?.status)?.toLowerCase() === "granted" && stringValue(item?.permission) ? [stringValue(item?.permission) as string] : [];
    });
  }

  private async findPage(pageId: string, userAccessToken: string): Promise<PageAccount | null> {
    const first = new URL(FACEBOOK_ENDPOINTS.pages);
    first.searchParams.set("fields", "id,name,access_token,tasks");
    first.searchParams.set("limit", "100");
    let next: string | undefined = first.toString();
    for (let requestCount = 0; next && requestCount < MAX_PAGE_LIST_REQUESTS; requestCount += 1) {
      const envelope = await this.request(next, userAccessToken, { method: "GET" }, "pages");
      const rows = Array.isArray(envelope.data) ? envelope.data : [];
      for (const row of rows) {
        const item = objectValue(row);
        if (stringValue(item?.id) !== pageId) continue;
        const accessToken = stringValue(item?.access_token);
        if (!accessToken) return null;
        return { id: pageId, name: stringValue(item?.name) ?? pageId, accessToken, tasks: stringArray(item?.tasks) };
      }
      next = this.safeNextPageUrl(envelope.paging);
    }
    return null;
  }

  private async verifyPageForPublish(page: PageTokenRecord): Promise<void> {
    const url = new URL(`${GRAPH_ROOT}/${encodeURIComponent(page.pageId)}`);
    url.searchParams.set("fields", "id,name,tasks");
    const envelope = await this.request(url.toString(), page.accessToken, { method: "GET" }, "page");
    if (stringValue(envelope.id) !== page.pageId) {
      throw new FacebookAdapterError("PLATFORM_CHANGED", "Meta Page 权限预检返回了错误的 Page ID");
    }
    if (!Array.isArray(envelope.tasks)) {
      throw new FacebookAdapterError("PLATFORM_CHANGED", "Meta Page 权限预检响应缺少 tasks 字段");
    }
    const tasks = stringArray(envelope.tasks);
    if (!this.canCreateContent(tasks)) {
      throw new FacebookAdapterError("PERMISSION_DENIED", "当前用户已无法在该 Facebook Page 上执行内容创建任务");
    }
  }

  private safeNextPageUrl(paging: unknown): string | undefined {
    const next = stringValue(objectValue(paging)?.next);
    if (!next) return undefined;
    let url: URL;
    try {
      url = new URL(next);
    } catch {
      throw new FacebookAdapterError("PLATFORM_CHANGED", "Meta Page 列表分页地址格式无效");
    }
    if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") {
      throw new FacebookAdapterError("PLATFORM_CHANGED", "Meta Page 列表返回了非官方分页地址");
    }
    return url.toString();
  }

  private async request(url: string, accessToken: string, init: RequestInit, operation: "permissions" | "pages" | "page" | "publish" | "status"): Promise<MetaGraphEnvelope> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const forwardExternalAbort = (): void => controller.abort(externalSignal?.reason);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(new FacebookAdapterError(timedOut ? "TIMEOUT" : "UNKNOWN", timedOut ? `Meta Graph API ${operation} 请求超时` : `Meta Graph API ${operation} 请求已取消`));
      }, { once: true });
    });
    if (externalSignal?.aborted) forwardExternalAbort();
    else externalSignal?.addEventListener("abort", forwardExternalAbort, { once: true });
    if (!controller.signal.aborted) {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("Meta Graph API request timeout"));
      }, this.timeoutMs);
    }
    let response: Response;
    try {
      response = await Promise.race([
        this.fetchPort(url, {
          ...init,
          signal: controller.signal,
          headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) }
        }),
        aborted
      ]);
    } catch (error) {
      if (error instanceof FacebookAdapterError) throw error;
      if (timedOut) throw new FacebookAdapterError("TIMEOUT", `Meta Graph API ${operation} 请求超时`);
      if (externalSignal?.aborted) throw new FacebookAdapterError("UNKNOWN", `Meta Graph API ${operation} 请求已取消`);
      throw new FacebookAdapterError("NETWORK_ERROR", `Meta Graph API ${operation} 网络请求失败`);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", forwardExternalAbort);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new FacebookAdapterError("NETWORK_ERROR", `Meta Graph API ${operation} 响应不是有效 JSON`);
    }
    const envelope = objectValue(value) as MetaGraphEnvelope | undefined;
    if (!envelope) throw new FacebookAdapterError("NETWORK_ERROR", `Meta Graph API ${operation} 响应格式无效`);
    if (!response.ok || envelope.error) {
      const code = numberValue(envelope.error?.code);
      const subcode = numberValue(envelope.error?.error_subcode);
      const message = graphErrorMessage(envelope.error);
      const providerCode = code === undefined ? undefined : subcode === undefined ? String(code) : `${code}/${subcode}`;
      throw new FacebookAdapterError(mapFacebookError(code, subcode, response.status, message), message, providerCode);
    }
    return envelope;
  }

  private requirePageToken(ctx: AccountContext): PageTokenRecord {
    const pageId = this.requirePageId(ctx);
    const record = this.readPageToken(ctx.accountId);
    if (!record || record.pageId !== pageId || !record.accessToken) throw new FacebookAdapterError("AUTH_REQUIRED", "Facebook Page 尚未完成 OAuth 和 Page access token 配置");
    if (this.expired(record.expiresAt)) throw new FacebookAdapterError("LOGIN_EXPIRED", "Facebook Page 授权已过期，请重新执行 OAuth");
    if (!this.hasRequiredScopes(record.scopes)) throw new FacebookAdapterError("PERMISSION_DENIED", "Facebook Page access token 缺少必需权限");
    if (!this.canCreateContent(record.tasks)) throw new FacebookAdapterError("PERMISSION_DENIED", "当前用户没有 Facebook Page 内容创建任务权限");
    return record;
  }

  private readPageToken(accountId: string): PageTokenRecord | null {
    const stored = this.store.get(this.pageTokenKey(accountId));
    if (!stored) return null;
    try {
      const value = JSON.parse(stored) as Partial<PageTokenRecord>;
      if (!stringValue(value.pageId) || !stringValue(value.pageName) || !stringValue(value.accessToken)) return null;
      return {
        pageId: value.pageId as string,
        pageName: value.pageName as string,
        accessToken: value.accessToken as string,
        scopes: stringArray(value.scopes),
        tasks: stringArray(value.tasks),
        authorizedAt: stringValue(value.authorizedAt) ?? "",
        ...(stringValue(value.expiresAt) ? { expiresAt: value.expiresAt as string } : {})
      };
    } catch {
      return null;
    }
  }

  private pageTokenKey(accountId: string): string {
    return `facebook:page:${accountId}:token`;
  }

  private pageId(ctx: AccountContext): string | undefined {
    const value = this.secretOrSetting(ctx, "pageId");
    return value && /^\d{1,32}$/u.test(value) ? value : undefined;
  }

  private requirePageId(ctx: AccountContext): string {
    const pageId = this.pageId(ctx);
    if (!pageId) throw new FacebookAdapterError("AUTH_REQUIRED", "必须配置有效的数字 Facebook Page ID；个人主页不受支持");
    return pageId;
  }

  private secretOrSetting(ctx: AccountContext, key: string): string | undefined {
    const secret = ctx.secrets?.[key];
    if (typeof secret === "string" && secret.trim()) return secret.trim();
    const setting = ctx.settings[key];
    return typeof setting === "string" && setting.trim() ? setting.trim() : undefined;
  }

  private hasRequiredScopes(scopes: string[]): boolean {
    return REQUIRED_SCOPES.every((scope) => scopes.includes(scope));
  }

  private canCreateContent(tasks: string[]): boolean {
    return tasks.some((task) => CONTENT_TASKS.has(task));
  }

  private expired(expiresAt: string | undefined): boolean {
    if (!expiresAt) return false;
    const value = new Date(expiresAt).getTime();
    return Number.isFinite(value) && value <= this.now().getTime() + 30_000;
  }

  private message(article: PublishArticleInput): string {
    const title = article.title.trim();
    const body = article.body.trim();
    return title && body && title !== body ? `${title}\n\n${body}` : title || body;
  }

  private link(article: PublishArticleInput): string | undefined {
    const raw = (article as FacebookPagePostInput).link;
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw !== "string") throw new FacebookAdapterError("CONTENT_REJECTED", "Facebook Page 链接必须是字符串");
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new FacebookAdapterError("CONTENT_REJECTED", "Facebook Page 链接必须是有效的 HTTPS/HTTP URL");
    }
    if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password) {
      throw new FacebookAdapterError("CONTENT_REJECTED", "Facebook Page 链接必须是无内嵌凭据的 HTTPS/HTTP URL");
    }
    return url.toString();
  }
}

export const FacebookOfficialAdapter = FacebookPagesAdapter;
export default FacebookPagesAdapter;
