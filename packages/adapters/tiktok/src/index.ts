import type { AccountContext, AdapterManifest, CredentialField, LoginSession, LoginStatus, PlatformCapabilities, PublishArticleInput, PublishResult, PublishStatusResult, PublishVideoInput, ValidationResult } from "@publisher/domain";
import { OAuthManager, PlatformAdapterError, type OAuthPlatformConfig, type OAuthTokenSet, type PlatformAdapter } from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";

const API_ROOT = "https://open.tiktokapis.com";
const PUBLISH_INIT = `${API_ROOT}/v2/post/publish/video/init/`;
const PUBLISH_STATUS = `${API_ROOT}/v2/post/publish/status/fetch/`;
type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface TikTokEnvelope { data?: unknown; error?: unknown }
interface TikTokError { code?: unknown; message?: unknown; log_id?: unknown }

const oauthConfig: OAuthPlatformConfig = {
  platformKey: "tiktok",
  authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/",
  tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
  scopes: ["video.publish", "video.upload"],
  clientIdKey: "clientKey",
  clientSecretKey: "clientSecret",
  tokenClientAuth: "body",
  usePkce: true
};

const credentials: CredentialField[] = [
  { key: "clientKey", label: "TikTok Client Key", type: "oauth", required: true },
  { key: "clientSecret", label: "TikTok Client Secret", type: "secret", required: true },
  { key: "redirectUri", label: "OAuth 回调地址", type: "text", required: true },
  { key: "accessToken", label: "OAuth Access Token", type: "secret", required: false }
];

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isPublicHttpUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
}

function errorDetail(payload: unknown): { code?: string; message?: string; logId?: string } {
  const root = objectValue(payload);
  const error = objectValue(root?.error) as TikTokError | undefined;
  return {
    code: stringValue(error?.code),
    message: stringValue(error?.message),
    logId: stringValue(error?.log_id)
  };
}

function mapError(status: number, detail: { code?: string; message?: string }): ConstructorParameters<typeof PlatformAdapterError>[0] {
  if (status === 401 || detail.code === "invalid_token") return "LOGIN_EXPIRED";
  if (status === 403 || detail.code === "scope_not_authorized") return "PERMISSION_DENIED";
  if (status === 429 || detail.code === "rate_limit_exceeded") return "RATE_LIMITED";
  if (detail.code === "invalid_params" || detail.code === "invalid_video" || status === 400) return "CONTENT_REJECTED";
  return "NETWORK_ERROR";
}

export class TikTokAdapterError extends PlatformAdapterError {
  constructor(code: ConstructorParameters<typeof PlatformAdapterError>[0], message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "TikTokAdapterError";
  }
}

export interface TikTokAdapterOptions { credentialStore?: CredentialStore; fetchPort?: FetchPort; oauthManager?: OAuthManager; }

export class TikTokAdapter implements PlatformAdapter {
  readonly platformKey = "tiktok";
  readonly manifest: AdapterManifest = {
    platformKey: "tiktok",
    displayName: "TikTok",
    category: "视频",
    version: "0.4.0",
    adapterStatus: "ready",
    authStrategy: "OAuth2PKCE",
    callbackStrategy: "HttpsCallback",
    status: "Developing",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: false,
    supportsVideo: true,
    officialWebsite: "https://www.tiktok.com/",
    developerPortal: "https://developers.tiktok.com/products/content-posting-api/",
    lastVerifiedAt: "2026-08-20",
    blockingReason: "需要 TikTok 应用审核、video.publish/video.upload scope 和公网媒体 URL；未经审核的客户端可能只能发布为 private",
    credentialSchema: credentials,
    officialSources: [
      "https://developers.tiktok.com/products/content-posting-api/",
      "https://developers.tiktok.com/doc/content-posting-api-get-started"
    ]
  };
  private readonly fetchPort: FetchPort;
  private readonly oauth: OAuthManager;

  constructor(options: TikTokAdapterOptions = {}) {
    this.fetchPort = options.fetchPort ?? fetch;
    this.oauth = options.oauthManager ?? new OAuthManager(options.credentialStore ?? new MemoryCredentialStore(), this.fetchPort);
  }

  getCapabilities(): PlatformCapabilities {
    return {
      article: false,
      imagePost: false,
      video: true,
      coverImage: false,
      tags: true,
      categories: false,
      scheduledPublish: false,
      draft: true,
      markdown: false,
      richText: false,
      maxTitleLength: 2200,
      maxImageCount: 0,
      maxTagCount: 50,
      supportsVideoCover: false,
      supportsVideoTags: true,
      videoPublishAsync: true,
      videoFormats: ["video/*"]
    };
  }

  getCredentialSchema(): CredentialField[] { return credentials.map((field) => ({ ...field })); }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    if (ctx.secrets?.accessToken?.trim()) return "logged_in";
    return this.oauth.getToken(ctx.accountId, this.platformKey) ? "logged_in" : "logged_out";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const redirectUri = ctx.secrets?.redirectUri?.trim() || (typeof ctx.settings.redirectUri === "string" ? ctx.settings.redirectUri.trim() : "");
    if (!redirectUri) return { sessionId: `tiktok-oauth-${Date.now()}`, requiresUserAction: true, message: "请先配置 TikTok OAuth 回调地址；系统只使用平台正常授权流程，不绕过验证码或安全验证。" };
    try {
      const auth = this.oauth.createAuthorization(ctx.accountId, oauthConfig, ctx.secrets, redirectUri);
      return { sessionId: `tiktok-oauth-${auth.state}`, requiresUserAction: true, authorizationUrl: auth.authorizationUrl, callbackUrl: auth.callbackUrl, message: "请在 TikTok 官方授权页完成应用授权和必要的人工验证。" };
    } catch (error) {
      if (error instanceof PlatformAdapterError) return { sessionId: `tiktok-oauth-${Date.now()}`, requiresUserAction: true, message: error.message };
      return { sessionId: `tiktok-oauth-${Date.now()}`, requiresUserAction: true, message: "TikTok OAuth 授权准备失败。" };
    }
  }

  async completeLogin(ctx: AccountContext, code: string, state: string): Promise<OAuthTokenSet> {
    return this.oauth.completeAuthorization(ctx.accountId, oauthConfig, ctx.secrets, code, state);
  }

  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: false, errors: ["TikTok Adapter 只支持视频内容"], warnings: [] }; }

  async validateVideo(video: PublishVideoInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!video.title.trim()) warnings.push("TikTok Direct Post 标题字段按 caption 发送，当前为空");
    if (!isPublicHttpUrl(video.videoPath)) errors.push("TikTok Content Posting API 需要可访问的公网视频 URL，不能直接上传本地路径");
    if (video.coverPath) errors.push("TikTok 图片/视频封面字段未在当前 Adapter 契约中确认");
    if (video.tags.length > 50) errors.push("TikTok hashtags 数量不能超过 50 个");
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> { throw new TikTokAdapterError("PERMISSION_DENIED", "TikTok Adapter 不支持文章发布"); }

  async publishVideo(ctx: AccountContext, video: PublishVideoInput): Promise<PublishResult> {
    const validation = await this.validateVideo(video);
    if (!validation.valid) throw new TikTokAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    if (ctx.settings.dryRun === true) return { success: true, dryRun: true, prepared: true, response: { adapter: this.platformKey, stage: "validated", source: "PULL_FROM_URL", warnings: validation.warnings } };
    const token = this.accessToken(ctx);
    if (!token) throw new TikTokAdapterError("AUTH_REQUIRED", "TikTok OAuth access token 未配置");
    const payload = await this.request(PUBLISH_INIT, token, { post_info: { title: video.title, privacy_level: "SELF_ONLY", disable_duet: false, disable_comment: false, disable_stitch: false }, source_info: { source: "PULL_FROM_URL", video_url: video.videoPath } });
    const data = objectValue((payload as TikTokEnvelope).data);
    const publishId = stringValue(data?.publish_id);
    if (!publishId) throw new TikTokAdapterError("UPLOAD_FAILED", "TikTok 发布初始化响应缺少 publish_id");
    return { success: true, status: "publishing", externalId: publishId, response: { adapter: this.platformKey, stage: "publishing", publishId } };
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    const token = this.accessToken(ctx);
    if (!token) throw new TikTokAdapterError("AUTH_REQUIRED", "TikTok OAuth access token 未配置");
    if (!externalId.trim()) throw new TikTokAdapterError("CONTENT_REJECTED", "TikTok publish_id 不能为空");
    const payload = await this.request(PUBLISH_STATUS, token, { publish_id: externalId });
    const data = objectValue((payload as TikTokEnvelope).data);
    const status = stringValue(data?.status)?.toUpperCase();
    if (["PUBLISH_COMPLETE", "PUBLISHED"].includes(status ?? "")) return { status: "published", externalId, response: { adapter: this.platformKey, status } };
    if (["FAILED", "PUBLISH_FAILED"].includes(status ?? "")) return { status: "failed", externalId, response: { adapter: this.platformKey, status }, errorCode: "CONTENT_REJECTED", errorMessage: stringValue(data?.fail_reason) ?? "TikTok 发布失败" };
    return { status: "publishing", externalId, response: { adapter: this.platformKey, status: status ?? "PROCESSING" } };
  }

  private accessToken(ctx: AccountContext): string | undefined { return ctx.secrets?.accessToken?.trim() || this.oauth.getToken(ctx.accountId, this.platformKey)?.accessToken; }

  private async request(url: string, token: string, body: Record<string, unknown>): Promise<TikTokEnvelope> {
    let response: Response;
    try { response = await this.fetchPort(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw new TikTokAdapterError("NETWORK_ERROR", "TikTok 官方 API 网络失败"); }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new TikTokAdapterError("NETWORK_ERROR", "TikTok 官方 API 返回了无效 JSON"); }
    const detail = errorDetail(payload);
    if (!response.ok || detail.code && detail.code !== "ok") throw new TikTokAdapterError(mapError(response.status, detail), detail.message ?? `TikTok API 请求失败（HTTP ${response.status}）`, detail.code ?? detail.logId);
    return objectValue(payload) as TikTokEnvelope ?? {};
  }
}

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

export const TikTokOfficialAdapter = TikTokAdapter;
