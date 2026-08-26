import { readFile, stat } from "node:fs/promises";
import type { AccountContext, AccountProfile, AdapterManifest, CredentialField, LoginSession, LoginStatus, PlatformCapabilities, PublishArticleInput, PublishResult, PublishStatusResult, PublishVideoInput, ValidationResult } from "@publisher/domain";
import { OAuthManager, PlatformAdapterError, type OAuthPlatformConfig, type OAuthTokenSet, type PlatformAdapter } from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";

const API_ROOT = "https://www.googleapis.com";
const YOUTUBE_OAUTH_CONFIG: OAuthPlatformConfig = {
  platformKey: "youtube",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  refreshUrl: "https://oauth2.googleapis.com/token",
  clientIdKey: "clientId",
  clientSecretKey: "clientSecret",
  scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
  usePkce: true,
  tokenClientAuth: "body",
  extraAuthorizationParams: { access_type: "offline", prompt: "consent" }
};
type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface YouTubeVideoResponse {
  id?: unknown;
  status?: { uploadStatus?: unknown; privacyStatus?: unknown };
  processingDetails?: { processingStatus?: unknown; processingFailureReason?: unknown };
}

interface YouTubeListResponse { items?: unknown }

const credentials: CredentialField[] = [
  { key: "clientId", label: "Google OAuth Client ID", type: "oauth", required: true },
  { key: "clientSecret", label: "Google OAuth Client Secret", type: "secret", required: true },
  { key: "redirectUri", label: "Google Loopback Redirect URI（可选）", type: "text", required: false, helpText: "桌面 OAuth 默认使用 http://127.0.0.1:43171/oauth/callback；必须在 Google OAuth Client 中允许。" }
];

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }

function errorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as { error?: unknown; message?: unknown; errors?: unknown };
  if (typeof root.message === "string") return root.message;
  if (root.error && typeof root.error === "object") {
    const nested = root.error as { message?: unknown; errors?: unknown };
    if (typeof nested.message === "string") return nested.message;
    if (Array.isArray(nested.errors)) {
      const reason = nested.errors.find((item): item is { reason?: unknown } => Boolean(item) && typeof item === "object" && "reason" in item)?.reason;
      if (typeof reason === "string") return reason;
    }
  }
  return undefined;
}

function responseCode(status: number, payload: unknown): YouTubeAdapterError["code"] {
  const message = `${errorMessage(payload) ?? ""}`.toLowerCase();
  if (status === 401) return "LOGIN_EXPIRED";
  if (status === 403 && /quota|rate/iu.test(message)) return "RATE_LIMITED";
  if (status === 403) return "PERMISSION_DENIED";
  if (/invalid|metadata|title|description/iu.test(message)) return "CONTENT_REJECTED";
  return "NETWORK_ERROR";
}

function firstVideo(payload: unknown): YouTubeVideoResponse | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const items = (payload as YouTubeListResponse).items;
  if (!Array.isArray(items)) return undefined;
  const first = items[0];
  return first && typeof first === "object" ? first as YouTubeVideoResponse : undefined;
}

export class YouTubeAdapterError extends PlatformAdapterError {
  constructor(code: ConstructorParameters<typeof PlatformAdapterError>[0], message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "YouTubeAdapterError";
  }
}

export interface YouTubeAdapterOptions { credentialStore?: CredentialStore; fetchPort?: FetchPort; apiRoot?: string; oauthManager?: OAuthManager; }

export class YouTubeAdapter implements PlatformAdapter {
  readonly platformKey = "youtube";
  readonly manifest: AdapterManifest = {
    platformKey: "youtube",
    displayName: "YouTube",
    category: "视频",
    version: "0.4.0",
    adapterStatus: "ready",
    authStrategy: "OAuth2PKCE",
    callbackStrategy: "LoopbackCallback",
    status: "Developing",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: false,
    supportsVideo: true,
    officialWebsite: "https://www.youtube.com/",
    developerPortal: "https://developers.google.com/youtube/v3/docs/videos/insert",
    lastVerifiedAt: "2026-08-20",
    blockingReason: "需要 Google OAuth、项目审核/quota 和用户明确授权；未通过真实低量 dry-run 前不得标记稳定",
    credentialSchema: credentials,
    officialSources: [
      "https://developers.google.com/youtube/v3/docs/videos/insert",
      "https://developers.google.com/youtube/v3/guides/implementation/videos"
    ]
  };
  private readonly fetchPort: FetchPort;
  private readonly apiRoot: string;
  private readonly oauth: OAuthManager | undefined;

  constructor(options: YouTubeAdapterOptions = {}) {
    this.fetchPort = options.fetchPort ?? fetch;
    this.apiRoot = options.apiRoot ?? API_ROOT;
    this.oauth = options.oauthManager ?? (options.credentialStore ? new OAuthManager(options.credentialStore, this.fetchPort) : undefined);
  }

  getCapabilities(): PlatformCapabilities {
    return {
      article: false,
      imagePost: false,
      video: true,
      coverImage: true,
      tags: true,
      categories: true,
      scheduledPublish: false,
      draft: true,
      markdown: false,
      richText: false,
      maxTitleLength: 100,
      maxImageCount: 1,
      maxTagCount: 50,
      maxVideoSize: 256 * 1024 * 1024 * 1024,
      supportsVideoCover: true,
      supportsVideoTags: true,
      videoPublishAsync: true,
      videoFormats: ["video/*"]
    };
  }

  getCredentialSchema(): CredentialField[] { return credentials.map((field) => ({ ...field })); }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const token = this.oauth?.getToken(ctx.accountId, this.platformKey);
    if (token?.accessToken) return token.expiresAt && Date.parse(token.expiresAt) <= Date.now() ? "expired" : "logged_in";
    return this.accessToken(ctx) ? "logged_in" : "logged_out";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const sessionId = `youtube-oauth-${ctx.accountId}-${Date.now()}`;
    if (!this.oauth) return { sessionId, requiresUserAction: true, message: "YouTube OAuth 主进程安全存储未初始化，请重启应用后重试。" };
    const redirectUri = (typeof ctx.settings.oauthRedirectUri === "string" ? ctx.settings.oauthRedirectUri.trim() : "") || ctx.secrets?.redirectUri?.trim() || "http://127.0.0.1:43171/oauth/callback";
    try {
      const request = this.oauth.createAuthorization(ctx.accountId, YOUTUBE_OAUTH_CONFIG, ctx.secrets, redirectUri);
      return { sessionId: `youtube-oauth-${request.state}`, requiresUserAction: true, authorizationUrl: request.authorizationUrl, callbackUrl: request.callbackUrl, message: "请在 Google 官方 OAuth 页面完成 YouTube 授权；应用审核、quota、安全验证和账号选择由用户按官方流程完成。" };
    } catch (error) {
      return { sessionId, requiresUserAction: true, message: error instanceof Error ? error.message : "YouTube OAuth 授权准备失败。" };
    }
  }

  async completeLogin(ctx: AccountContext, code: string, state: string): Promise<OAuthTokenSet> {
    if (!this.oauth) throw new YouTubeAdapterError("AUTH_REQUIRED", "YouTube OAuth 主进程安全存储未初始化");
    return this.oauth.completeAuthorization(ctx.accountId, YOUTUBE_OAUTH_CONFIG, ctx.secrets, code, state);
  }

  async refreshLogin(ctx: AccountContext): Promise<OAuthTokenSet> {
    if (!this.oauth) throw new YouTubeAdapterError("AUTH_REQUIRED", "YouTube OAuth 主进程安全存储未初始化");
    return this.oauth.refresh(ctx.accountId, YOUTUBE_OAUTH_CONFIG, ctx.secrets);
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    let token = this.oauth?.getToken(ctx.accountId, this.platformKey);
    if (token?.expiresAt && Date.parse(token.expiresAt) <= Date.now() && token.refreshToken) token = await this.refreshLogin(ctx);
    const accessToken = token?.accessToken ?? this.accessToken(ctx);
    if (!accessToken) throw new YouTubeAdapterError("AUTH_REQUIRED", "YouTube OAuth access token 未配置");
    const response = await this.fetchPort(`${this.apiRoot}/youtube/v3/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await this.readJson(response, "YouTube 频道信息读取失败");
    if (!response.ok) throw new YouTubeAdapterError(responseCode(response.status, payload), `YouTube 频道信息读取失败：${errorMessage(payload) ?? `HTTP ${response.status}`}`);
    const candidateItems = payload && typeof payload === "object" ? (payload as YouTubeListResponse).items : undefined;
    const items: unknown[] = Array.isArray(candidateItems) ? candidateItems : [];
    const first = items[0] && typeof items[0] === "object" ? items[0] as { id?: unknown; snippet?: { title?: unknown } } : undefined;
    if (!first || !stringValue(first.id)) throw new YouTubeAdapterError("PERMISSION_DENIED", "Google OAuth 用户没有可读取的 YouTube 频道");
    return { accountId: stringValue(first.id), accountName: stringValue(first.snippet?.title), scopes: token?.scope ?? YOUTUBE_OAUTH_CONFIG.scopes, expiresAt: token?.expiresAt, authorizationStatus: "Authorized" };
  }

  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> {
    return { valid: false, errors: ["YouTube Adapter 只支持视频内容"], warnings: [] };
  }

  async validateVideo(video: PublishVideoInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!video.title.trim()) errors.push("YouTube 视频标题不能为空");
    if (video.title.length > 100) errors.push("YouTube 视频标题不能超过 100 个字符");
    if (!video.videoPath.trim()) errors.push("YouTube 视频文件不能为空");
    if (video.tags.some((tag) => tag.length > 30)) warnings.push("部分标签超过常见长度限制，请在真实上传前确认平台规则");
    if (video.tags.length > 50) errors.push("YouTube 标签数量不能超过 50 个");
    if (video.coverPath && !video.coverPath.trim()) errors.push("封面路径不能为空字符串");
    if (video.videoPath.trim()) {
      try {
        const info = await stat(video.videoPath);
        if (!info.isFile() || info.size === 0) errors.push("YouTube 视频文件不存在或为空");
      } catch { errors.push("YouTube 视频文件无法读取"); }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> {
    throw new YouTubeAdapterError("PERMISSION_DENIED", "YouTube Adapter 不支持文章发布");
  }

  async publishVideo(ctx: AccountContext, video: PublishVideoInput): Promise<PublishResult> {
    const validation = await this.validateVideo(video);
    if (!validation.valid) throw new YouTubeAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    if (ctx.settings.dryRun === true) {
      return { success: true, dryRun: true, prepared: true, response: { adapter: this.platformKey, stage: "validated", title: video.title } };
    }
    const accessToken = this.accessToken(ctx);
    if (!accessToken) throw new YouTubeAdapterError("AUTH_REQUIRED", "YouTube OAuth access token 未配置");
    const bytes = await readFile(video.videoPath);
    const uploadUrl = await this.startResumableUpload(accessToken, video, bytes.byteLength);
    let uploaded: Response;
    try {
      uploaded = await this.fetchPort(uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/octet-stream", "Content-Length": String(bytes.byteLength) },
        body: bytes
      });
    } catch { throw new YouTubeAdapterError("NETWORK_ERROR", "YouTube resumable upload 网络失败"); }
    const payload = await this.readJson(uploaded, "YouTube 视频上传失败");
    if (!uploaded.ok) throw new YouTubeAdapterError(responseCode(uploaded.status, payload), `YouTube 视频上传失败：${errorMessage(payload) ?? `HTTP ${uploaded.status}`}`);
    const externalId = stringValue((payload as YouTubeVideoResponse).id);
    if (!externalId) throw new YouTubeAdapterError("NETWORK_ERROR", "YouTube 上传响应缺少视频 ID");
    return { success: true, status: "publishing", externalId, response: { adapter: this.platformKey, stage: "uploaded", videoId: externalId } };
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    const accessToken = this.accessToken(ctx);
    if (!accessToken) throw new YouTubeAdapterError("AUTH_REQUIRED", "YouTube OAuth access token 未配置");
    if (!externalId.trim()) throw new YouTubeAdapterError("CONTENT_REJECTED", "YouTube 视频 ID 不能为空");
    let response: Response;
    try {
      response = await this.fetchPort(`${this.apiRoot}/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(externalId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch { throw new YouTubeAdapterError("NETWORK_ERROR", "YouTube 状态查询网络失败"); }
    const payload = await this.readJson(response, "YouTube 状态查询失败");
    if (!response.ok) throw new YouTubeAdapterError(responseCode(response.status, payload), `YouTube 状态查询失败：${errorMessage(payload) ?? `HTTP ${response.status}`}`);
    const item = firstVideo(payload);
    if (!item) return { status: "publishing", externalId, response: { adapter: this.platformKey, processingStatus: "pending" } };
    const processingStatus = stringValue(item.processingDetails?.processingStatus);
    if (processingStatus === "failed" || processingStatus === "terminated") {
      return { status: "failed", externalId, response: { adapter: this.platformKey, processingStatus, failureReason: item.processingDetails?.processingFailureReason }, errorCode: "CONTENT_REJECTED", errorMessage: "YouTube 视频处理失败" };
    }
    if (processingStatus === "succeeded" || item.status?.uploadStatus === "processed") return { status: "published", externalId, publishedUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(externalId)}`, response: { adapter: this.platformKey, processingStatus, uploadStatus: item.status?.uploadStatus } };
    return { status: "publishing", externalId, response: { adapter: this.platformKey, processingStatus, uploadStatus: item.status?.uploadStatus } };
  }

  private async startResumableUpload(accessToken: string, video: PublishVideoInput, byteLength: number): Promise<string> {
    const body = { snippet: { title: video.title, description: video.description ?? "", tags: video.tags }, status: { privacyStatus: "private" } };
    let response: Response;
    try {
      response = await this.fetchPort(`${this.apiRoot}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(byteLength), "X-Upload-Content-Type": "video/*" },
        body: JSON.stringify(body)
      });
    } catch { throw new YouTubeAdapterError("NETWORK_ERROR", "YouTube resumable upload 初始化网络失败"); }
    if (!response.ok) {
      const payload = await this.readJson(response, "YouTube resumable upload 初始化失败");
      throw new YouTubeAdapterError(responseCode(response.status, payload), `YouTube resumable upload 初始化失败：${errorMessage(payload) ?? `HTTP ${response.status}`}`);
    }
    const location = response.headers.get("location");
    if (!location) throw new YouTubeAdapterError("NETWORK_ERROR", "YouTube 初始化响应缺少 resumable upload 地址");
    return location;
  }

  private accessToken(ctx: AccountContext): string | undefined { return this.oauth?.getToken(ctx.accountId, this.platformKey)?.accessToken ?? ctx.secrets?.accessToken?.trim() ?? ctx.secrets?.oauthAccessToken?.trim(); }

  private async readJson(response: Response, fallback: string): Promise<unknown> {
    try { return await response.json(); } catch { throw new YouTubeAdapterError("NETWORK_ERROR", fallback); }
  }
}

export const YouTubeOfficialAdapter = YouTubeAdapter;
