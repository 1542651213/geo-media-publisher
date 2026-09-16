import { basename } from "node:path";
import { readFile } from "node:fs/promises";
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
import type { CredentialStore } from "@publisher/security";
import type { PlatformAdapter } from "@publisher/adapters-core";

const API_ROOT = "https://api.weixin.qq.com/cgi-bin";
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const TOKEN_KEY_PREFIX = "wechat:official:";

export type WeChatFetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type WeChatReadFilePort = (path: string) => Promise<Uint8Array>;

export interface WeChatAdapterOptions {
  credentialStore?: CredentialStore;
  fetchPort?: WeChatFetchPort;
  readFilePort?: WeChatReadFilePort;
  now?: () => number;
}

interface WeChatResponse {
  errcode?: unknown;
  errmsg?: unknown;
  access_token?: unknown;
  expires_in?: unknown;
  media_id?: unknown;
  publish_id?: unknown;
  publish_status?: unknown;
  article_id?: unknown;
  article_url?: unknown;
  fail_reason?: unknown;
  article_detail?: unknown;
}

interface AccessTokenRecord {
  accessToken: string;
  expiresAt: number;
}

type WeChatErrorCode = "AUTH_REQUIRED" | "LOGIN_EXPIRED" | "UPLOAD_FAILED" | "CONTENT_REJECTED" | "NETWORK_ERROR" | "RATE_LIMITED" | "PLATFORM_CHANGED";

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value.trim())) return Number(value);
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeHtml(value: string): string {
  return value.split(/\r?\n\r?\n/u).map((paragraph) => `<p>${paragraph.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br />")}</p>`).join("");
}

export class WeChatAdapterError extends Error {
  readonly code: WeChatErrorCode;

  constructor(code: WeChatErrorCode, message: string, readonly providerCode?: string) {
    super(message);
    this.name = "WeChatAdapterError";
    this.code = code;
  }
}

const CREDENTIAL_SCHEMA: CredentialField[] = [
  { key: "appId", label: "AppID", type: "text", required: true },
  { key: "appSecret", label: "AppSecret", type: "secret", required: true }
];

export class WeChatOfficialAdapter implements PlatformAdapter {
  readonly platformKey = "wechat_official";
  readonly manifest: AdapterManifest = {
    platformKey: "wechat_official",
    displayName: "微信公众号",
    category: "图文",
    version: "0.4.0",
    adapterStatus: "ready",
    authStrategy: "AppCredential",
    callbackStrategy: "ManualCodeCallback",
    status: "WaitingForUser",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "https://mp.weixin.qq.com/",
    developerPortal: "https://developers.weixin.qq.com/doc/service/",
    lastVerifiedAt: "2026-08-20",
    blockingReason: "AppID/AppSecret、access_token、封面素材、图文草稿、publish_id 发布与状态回查流程已完成；真实 Dry Run/PublishPassed 仍需账号所有者提供有效权限并完成低量验收。",
    credentialSchema: CREDENTIAL_SCHEMA,
    officialSources: [
      "https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Get_access_token.html",
      "https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanagement/api_draft_add.html",
      "https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_submit.html",
      "https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_get.html"
    ]
  };

  private readonly credentialStore?: CredentialStore;
  private readonly fetchPort: WeChatFetchPort;
  private readonly readFilePort: WeChatReadFilePort;
  private readonly now: () => number;
  private readonly tokens = new Map<string, AccessTokenRecord>();

  constructor(options: WeChatAdapterOptions = {}) {
    this.credentialStore = options.credentialStore;
    this.fetchPort = options.fetchPort ?? fetch;
    this.readFilePort = options.readFilePort ?? readFile;
    this.now = options.now ?? Date.now;
  }

  getCapabilities(): PlatformCapabilities {
    return {
      article: true,
      imagePost: false,
      video: false,
      coverImage: true,
      tags: false,
      categories: false,
      scheduledPublish: false,
      draft: true,
      markdown: false,
      richText: true,
      maxTitleLength: 64,
      maxImageCount: 1
    };
  }

  getCredentialSchema(): CredentialField[] {
    return CREDENTIAL_SCHEMA.map((field) => ({ ...field }));
  }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    try {
      await this.getAccessToken(ctx);
      return "logged_in";
    } catch (error) {
      if (error instanceof WeChatAdapterError && error.code === "AUTH_REQUIRED") return "logged_out";
      if (error instanceof WeChatAdapterError && error.code === "LOGIN_EXPIRED") return "expired";
      return "unknown";
    }
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const sessionId = `wechat-manual-${ctx.accountId}-${Date.now()}`;
    const missing = ["appId", "appSecret"].filter((key) => !this.secret(ctx, key));
    if (missing.length > 0) {
      return {
        sessionId,
        requiresUserAction: true,
        message: `请先在账号设置中配置微信公众号 ${missing.join("、")}；系统只使用官方接口，不绕过验证码或安全验证。`
      };
    }
    return {
      sessionId,
      requiresUserAction: true,
      message: "请确认该公众号已开通草稿与群发接口权限；AppID/AppSecret 将由主进程安全存储并用于官方 access_token 流程。"
    };
  }

  async refreshLogin(ctx: AccountContext): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken(ctx, true);
    const record = this.tokens.get(ctx.accountId);
    return {
      refreshed: true,
      configured: Boolean(token),
      ...(record ? { expiresAt: new Date(record.expiresAt).toISOString() } : {})
    };
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!article.title.trim()) errors.push("标题不能为空");
    if (article.title.length > 64) errors.push("微信公众号标题不能超过 64 个字符");
    if (!article.body.trim()) errors.push("正文不能为空");
    if (article.summary.length > 120) errors.push("微信公众号摘要不能超过 120 个字符");
    if (!article.coverPath?.trim()) errors.push("微信公众号图文发布需要封面图片");
    if ((article.images?.length ?? 0) > 0) errors.push("微信公众号当前 Adapter 不接受正文图片附件，请将图片放入正文内容或单独处理");
    if (article.tags.length > 0) warnings.push("微信公众号草稿接口不会单独提交 tags 字段");
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new WeChatAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    const coverPath = article.coverPath?.trim();
    if (!coverPath) throw new WeChatAdapterError("UPLOAD_FAILED", "微信公众号需要封面图片");

    const coverMediaId = await this.uploadCover(ctx, coverPath);
    const draft = await this.request(ctx, "draft/add", {
      articles: [{
        title: article.title.trim(),
        author: ctx.accountName,
        digest: article.summary.trim(),
        content: safeHtml(article.body),
        thumb_media_id: coverMediaId,
        show_cover_pic: 1,
        content_source_url: ""
      }]
    });
    const draftId = stringValue(draft.media_id);
    if (!draftId) throw new WeChatAdapterError("UPLOAD_FAILED", "微信公众号草稿接口未返回 media_id");

    if (ctx.settings.dryRun === true) {
      return {
        success: true,
        dryRun: true,
        prepared: true,
        externalId: draftId,
        response: {
          adapter: this.platformKey,
          stage: "draft",
          mediaId: draftId,
          externalIdType: "draft_media_id",
          publishSubmitted: false,
          warnings: validation.warnings
        }
      };
    }

    const published = await this.request(ctx, "freepublish/submit", { media_id: draftId });
    const publishId = stringValue(published.publish_id);
    if (!publishId) throw new WeChatAdapterError("UPLOAD_FAILED", "微信公众号发布接口未返回 publish_id");
    return {
      success: true,
      status: "publishing",
      dryRun: false,
      externalId: publishId,
      response: {
        adapter: this.platformKey,
        stage: "publishing",
        publishId,
        externalIdType: "publish_id",
        draftId,
        publishSubmitted: true
      }
    };
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    const normalizedId = externalId.trim();
    if (!normalizedId) throw new WeChatAdapterError("CONTENT_REJECTED", "微信公众号 publish_id 不能为空");
    const response = await this.request(ctx, "freepublish/get", { publish_id: normalizedId });
    const status = numberValue(response.publish_status);
    if (status === 1) return { status: "publishing", externalId: normalizedId, response: { adapter: this.platformKey, publishStatus: status } };
    if (status === 0) {
      const publishedUrl = publishedArticleUrl(response);
      return {
        status: "published",
        externalId: normalizedId,
        ...(publishedUrl ? { publishedUrl } : {}),
        response: { adapter: this.platformKey, publishStatus: status, articleId: response.article_id }
      };
    }
    return {
      status: "failed",
      externalId: normalizedId,
      response: { adapter: this.platformKey, publishStatus: status ?? null, failReason: stringValue(response.fail_reason) || undefined },
      errorCode: status === undefined ? "PLATFORM_CHANGED" : "CONTENT_REJECTED",
      errorMessage: stringValue(response.fail_reason) || (status === undefined ? "微信公众号发布状态响应缺少 publish_status" : "微信公众号发布审核未通过")
    };
  }

  private async uploadCover(ctx: AccountContext, coverPath: string): Promise<string> {
    await this.getAccessToken(ctx);
    let bytes: Uint8Array;
    try {
      bytes = await this.readFilePort(coverPath);
    } catch {
      throw new WeChatAdapterError("UPLOAD_FAILED", "微信公众号封面文件读取失败");
    }
    return this.withTokenRetry(ctx, async (accessToken) => {
      const form = new FormData();
      const stableBytes = new Uint8Array(bytes.byteLength);
      stableBytes.set(bytes);
      form.append("media", new Blob([stableBytes.buffer]), basename(coverPath));
      const url = this.apiUrl("material/add_material", accessToken, { type: "image" });
      let response: Response;
      try {
        response = await this.fetchPort(url, { method: "POST", body: form });
      } catch {
        throw new WeChatAdapterError("NETWORK_ERROR", "微信公众号封面上传网络失败");
      }
      const payload = await this.readJson(response, "微信公众号封面上传失败", "api");
      const mediaId = stringValue(payload.media_id);
      if (!mediaId) throw new WeChatAdapterError("UPLOAD_FAILED", "微信公众号封面素材响应缺少 media_id");
      return mediaId;
    });
  }

  private async getAccessToken(ctx: AccountContext, forceRefresh = false): Promise<string> {
    const appId = this.secret(ctx, "appId");
    const appSecret = this.secret(ctx, "appSecret");
    if (!appId || !appSecret) throw new WeChatAdapterError("AUTH_REQUIRED", "未配置微信公众号 AppID/AppSecret");
    const cached = forceRefresh ? undefined : this.readToken(ctx.accountId);
    if (cached && cached.expiresAt > this.now() + TOKEN_EXPIRY_SKEW_MS) return cached.accessToken;

    const url = new URL(`${API_ROOT}/token`);
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", appId);
    url.searchParams.set("secret", appSecret);
    let response: Response;
    try {
      response = await this.fetchPort(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
    } catch {
      throw new WeChatAdapterError("NETWORK_ERROR", "微信公众号身份接口网络失败");
    }
    const payload = await this.readJson(response, "微信公众号身份校验失败", "token");
    const token = stringValue(payload.access_token);
    const expiresIn = numberValue(payload.expires_in) ?? 7200;
    if (!token) throw new WeChatAdapterError("LOGIN_EXPIRED", "微信公众号未返回 access_token");
    const record: AccessTokenRecord = {
      accessToken: token,
      expiresAt: this.now() + Math.max(60, expiresIn - 120) * 1000
    };
    this.tokens.set(ctx.accountId, record);
    this.persistToken(ctx.accountId, record);
    return token;
  }

  private async request(ctx: AccountContext, path: string, body: Record<string, unknown>): Promise<WeChatResponse> {
    return this.withTokenRetry(ctx, async (accessToken) => {
      let response: Response;
      try {
        response = await this.fetchPort(this.apiUrl(path, accessToken), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
      } catch {
        throw new WeChatAdapterError("NETWORK_ERROR", `微信公众号 ${path} 网络失败`);
      }
      return this.readJson(response, `微信公众号 ${path} 失败`, "api");
    });
  }

  private async withTokenRetry<T>(ctx: AccountContext, operation: (accessToken: string) => Promise<T>): Promise<T> {
    let accessToken = await this.getAccessToken(ctx);
    try {
      return await operation(accessToken);
    } catch (error) {
      if (!(error instanceof WeChatAdapterError) || error.code !== "LOGIN_EXPIRED") throw error;
      this.clearToken(ctx.accountId, accessToken);
      accessToken = await this.getAccessToken(ctx, true);
      return operation(accessToken);
    }
  }

  private async readJson(response: Response, fallback: string, operation: "token" | "api"): Promise<WeChatResponse> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WeChatAdapterError("NETWORK_ERROR", fallback);
    }
    const parsed = this.parseResponse(payload, fallback, operation);
    if (!response.ok) throw new WeChatAdapterError("NETWORK_ERROR", `${fallback}（HTTP ${response.status}）`);
    return parsed;
  }

  private parseResponse(value: unknown, fallback: string, operation: "token" | "api"): WeChatResponse {
    const payload = objectValue(value) as WeChatResponse | undefined;
    if (!payload) throw new WeChatAdapterError("NETWORK_ERROR", fallback);
    const errcode = numberValue(payload.errcode) ?? 0;
    if (errcode !== 0) {
      const message = stringValue(payload.errmsg) || fallback;
      const providerCode = String(errcode);
      if (errcode === 40001 || errcode === 40014 || errcode === 42001) throw new WeChatAdapterError("LOGIN_EXPIRED", message, providerCode);
      if ([40013, 40125, 40164, 48001, 48002].includes(errcode)) throw new WeChatAdapterError("AUTH_REQUIRED", message, providerCode);
      if ([45009, 45011].includes(errcode)) throw new WeChatAdapterError("RATE_LIMITED", message, providerCode);
      throw new WeChatAdapterError(operation === "token" ? "AUTH_REQUIRED" : "UPLOAD_FAILED", message, providerCode);
    }
    return payload;
  }

  private apiUrl(path: string, accessToken: string, params: Record<string, string> = {}): string {
    const url = new URL(`${API_ROOT}/${path}`);
    url.searchParams.set("access_token", accessToken);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  private secret(ctx: AccountContext, key: string): string {
    return stringValue(ctx.secrets?.[key]);
  }

  private tokenKey(accountId: string): string {
    return `${TOKEN_KEY_PREFIX}${accountId}:access-token`;
  }

  private readToken(accountId: string): AccessTokenRecord | null {
    const memory = this.tokens.get(accountId);
    if (memory) return memory;
    const stored = this.credentialStore?.get(this.tokenKey(accountId));
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as Partial<AccessTokenRecord>;
      const accessToken = stringValue(parsed.accessToken);
      const expiresAt = numberValue(parsed.expiresAt);
      if (!accessToken || expiresAt === undefined) return null;
      const record = { accessToken, expiresAt };
      this.tokens.set(accountId, record);
      return record;
    } catch {
      return null;
    }
  }

  private persistToken(accountId: string, record: AccessTokenRecord): void {
    if (!this.credentialStore) return;
    try {
      this.credentialStore.set(this.tokenKey(accountId), JSON.stringify(record));
    } catch {
      throw new WeChatAdapterError("AUTH_REQUIRED", "微信公众号 access_token 无法写入安全存储");
    }
  }

  private clearToken(accountId: string, accessToken: string): void {
    const current = this.tokens.get(accountId);
    if (current?.accessToken !== accessToken) return;
    this.tokens.delete(accountId);
    this.credentialStore?.delete(this.tokenKey(accountId));
  }
}

function publishedArticleUrl(response: WeChatResponse): string | undefined {
  if (!response.article_detail || typeof response.article_detail !== "object") return stringValue(response.article_url) || undefined;
  const items = (response.article_detail as { item?: unknown }).item;
  if (!Array.isArray(items)) return stringValue(response.article_url) || undefined;
  for (const item of items) {
    if (item && typeof item === "object") {
      const url = stringValue((item as { article_url?: unknown }).article_url);
      if (url) return url;
    }
  }
  return stringValue(response.article_url) || undefined;
}
