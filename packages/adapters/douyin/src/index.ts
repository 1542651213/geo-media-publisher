import { basename, extname } from "node:path";
import { readFile, stat } from "node:fs/promises";
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
  PublishVideoInput,
  ValidationResult
} from "@publisher/domain";
import {
  OAuthManager,
  PlatformAdapterError,
  type OAuthPlatformConfig,
  type OAuthTokenSet,
  type PlatformAdapter
} from "@publisher/adapters-core";
import type { CredentialStore } from "@publisher/security";

export const DOUYIN_API_ROOT = "https://open.douyin.com";

export const DOUYIN_ENDPOINTS = {
  authorization: `${DOUYIN_API_ROOT}/platform/oauth/connect/`,
  accessToken: `${DOUYIN_API_ROOT}/oauth/access_token/`,
  refreshToken: `${DOUYIN_API_ROOT}/oauth/refresh_token/`,
  userInfo: `${DOUYIN_API_ROOT}/oauth/userinfo/`,
  videoCreate: `${DOUYIN_API_ROOT}/2/video/create/`,
  videoQuery: `${DOUYIN_API_ROOT}/2/video/query/`
} as const;

const DOUYIN_OAUTH_CONFIG: OAuthPlatformConfig = {
  platformKey: "douyin",
  authorizationUrl: DOUYIN_ENDPOINTS.authorization,
  tokenUrl: DOUYIN_ENDPOINTS.accessToken,
  refreshUrl: DOUYIN_ENDPOINTS.refreshToken,
  clientIdKey: "clientKey",
  clientSecretKey: "clientSecret",
  scopes: ["video.create"],
  usePkce: false,
  tokenClientAuth: "body"
};

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface DouyinFileStat {
  isFile(): boolean;
  size: number;
}

export interface DouyinTransport {
  fetch?: FetchPort;
  readFile?: (path: string) => Promise<Uint8Array>;
  stat?: (path: string) => Promise<DouyinFileStat>;
}

export interface DouyinAdapterOptions {
  credentialStore: CredentialStore;
  fetch?: FetchPort;
  transport?: DouyinTransport;
  stat?: (path: string) => Promise<DouyinFileStat>;
  oauthManager?: OAuthManager;
}

interface DouyinEnvelope {
  data?: unknown;
  extra?: unknown;
  error_code?: unknown;
  message?: unknown;
  description?: unknown;
}

interface DouyinData {
  item_id?: unknown;
  video_id?: unknown;
  publish_id?: unknown;
  upload_url?: unknown;
  status?: unknown;
  publish_status?: unknown;
  audit_status?: unknown;
  share_url?: unknown;
  item_url?: unknown;
  error_code?: unknown;
  message?: unknown;
  open_id?: unknown;
  union_id?: unknown;
  nickname?: unknown;
}

const SUPPORTED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);
const SUPPORTED_COVER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && /^-?\d+$/u.test(value)
      ? Number(value)
      : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function dataValue(envelope: DouyinEnvelope): DouyinData {
  return objectValue(envelope.data) as DouyinData ?? {};
}

function settingString(ctx: AccountContext, key: string): string | undefined {
  const value = ctx.settings[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function responseRecord(endpoint: string, envelope: DouyinEnvelope, data: DouyinData): Record<string, unknown> {
  return {
    adapter: "douyin",
    endpoint,
    ...(data.item_id !== undefined ? { itemId: data.item_id } : {}),
    ...(data.video_id !== undefined ? { videoId: data.video_id } : {}),
    ...(data.publish_id !== undefined ? { publishId: data.publish_id } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.publish_status !== undefined ? { publishStatus: data.publish_status } : {}),
    ...(data.audit_status !== undefined ? { auditStatus: data.audit_status } : {}),
    ...(envelope.extra !== undefined ? { extra: envelope.extra } : {})
  };
}

export function mapDouyinError(errorCode: number | undefined, httpStatus: number | undefined, message: string): ErrorCode {
  if (httpStatus === 401 || [10003, 10004, 10005, 40100, 40101].includes(errorCode ?? -1)) return "LOGIN_EXPIRED";
  if (httpStatus === 403 || [10007, 10008, 2190008].includes(errorCode ?? -1)) return "PERMISSION_DENIED";
  if (httpStatus === 429 || [10009, 10016, 2190002].includes(errorCode ?? -1)) return "RATE_LIMITED";
  if ([2190003, 2190004, 2190005, 2190010].includes(errorCode ?? -1)) return "CONTENT_REJECTED";
  if (/permission|scope|not authorized|无权限|权限/iu.test(message)) return "PERMISSION_DENIED";
  if (/token|授权|登录|access.?token/iu.test(message)) return "LOGIN_EXPIRED";
  if (httpStatus !== undefined && httpStatus >= 500) return "NETWORK_ERROR";
  return "UPLOAD_FAILED";
}

export class DouyinAdapterError extends PlatformAdapterError {
  constructor(code: ErrorCode, message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "DouyinAdapterError";
  }
}

export class DouyinOfficialAdapter implements PlatformAdapter {
  readonly platformKey = "douyin";
  readonly manifest: AdapterManifest = {
    platformKey: "douyin",
    displayName: "抖音",
    category: "短视频",
    version: "0.1.0",
    adapterStatus: "ready",
    authStrategy: "OAuth2",
    callbackStrategy: "HttpsCallback",
    status: "WaitingForUser",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: false,
    supportsVideo: true,
    officialWebsite: "https://www.douyin.com/",
    developerPortal: "https://open.douyin.com/",
    lastVerifiedAt: "2026-08-20",
    blockingReason: "需要抖音开放平台 OAuth、video.create 权限及账号完成平台审核；Dry Run 不会访问平台。",
    credentialSchema: [
      { key: "clientKey", label: "Client Key", type: "text", required: true },
      { key: "clientSecret", label: "Client Secret", type: "secret", required: true },
      { key: "redirectUri", label: "OAuth 回调地址", type: "text", required: true }
    ],
    officialSources: [
      "https://open.douyin.com/platform/resource/docs/ability/content-management/douyin-publish-solution/",
      "https://open.douyin.com/platform/resource/docs/accession-guide/type-and-permission"
    ]
  };

  private readonly fetchPort: FetchPort;
  private readonly readFilePort: (path: string) => Promise<Uint8Array>;
  private readonly statPort: (path: string) => Promise<DouyinFileStat>;
  private readonly oauth: OAuthManager;

  constructor(options: DouyinAdapterOptions) {
    const transport = options.transport ?? {};
    this.fetchPort = transport.fetch ?? options.fetch ?? fetch;
    this.readFilePort = transport.readFile ?? (async (path) => readFile(path));
    this.statPort = transport.stat ?? options.stat ?? (async (path) => stat(path));
    this.oauth = options.oauthManager ?? new OAuthManager(options.credentialStore, this.oauthFetch);
  }

  getCapabilities(): PlatformCapabilities {
    return {
      article: false,
      imagePost: false,
      video: true,
      coverImage: true,
      tags: true,
      categories: false,
      scheduledPublish: false,
      draft: false,
      markdown: false,
      richText: false,
      maxTitleLength: 30,
      maxImageCount: 0,
      maxTagCount: 5,
      videoFormats: ["video/mp4", "video/quicktime"],
      supportsVideoCover: true,
      supportsVideoTags: true,
      videoPublishAsync: true
    };
  }

  getCredentialSchema(): CredentialField[] {
    return [...this.manifest.credentialSchema];
  }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    try {
      const token = await this.getAccessToken(ctx);
      await this.request(DOUYIN_ENDPOINTS.userInfo, token, { method: "GET" });
      return "logged_in";
    } catch (error) {
      if (error instanceof PlatformAdapterError && error.code === "AUTH_REQUIRED") return "logged_out";
      if (error instanceof PlatformAdapterError && error.code === "LOGIN_EXPIRED") return "expired";
      return "unknown";
    }
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const missing = ["clientKey", "clientSecret"].filter((key) => !ctx.secrets?.[key]?.trim());
    if (missing.length > 0) {
      return { sessionId: `douyin-oauth-${ctx.accountId}-${Date.now()}`, requiresUserAction: true, message: "请先配置抖音开放平台应用的 Client Key 和 Client Secret。" };
    }
    const redirectUri = settingString(ctx, "oauthRedirectUri") ?? ctx.secrets?.redirectUri?.trim();
    if (!redirectUri) {
      return {
        sessionId: `douyin-oauth-${ctx.accountId}-${Date.now()}`,
        requiresUserAction: true,
        message: "请先配置 OAuth 回调地址；系统只使用官方 OAuth，不执行浏览器登录或验证码绕过。"
      };
    }
    const request = this.oauth.createAuthorization(ctx.accountId, DOUYIN_OAUTH_CONFIG, ctx.secrets, redirectUri);
    const authorizationUrl = new URL(request.authorizationUrl);
    const clientId = authorizationUrl.searchParams.get("client_id");
    authorizationUrl.searchParams.delete("client_id");
    if (clientId) authorizationUrl.searchParams.set("client_key", clientId);
    return {
      sessionId: `douyin-oauth-${ctx.accountId}-${request.state}`,
      requiresUserAction: true,
      message: "请在抖音开放平台完成官方 OAuth 授权；遇到验证码或安全验证时请由用户在平台正常完成。",
      authorizationUrl: authorizationUrl.toString(),
      callbackUrl: request.callbackUrl
    };
  }

  async completeLogin(ctx: AccountContext, code: string, state: string): Promise<OAuthTokenSet> {
    if (!code.trim() || !state.trim()) throw new DouyinAdapterError("AUTH_REQUIRED", "OAuth code/state 不能为空");
    return this.oauth.completeAuthorization(ctx.accountId, DOUYIN_OAUTH_CONFIG, ctx.secrets, code, state);
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const tokenSet = this.oauth.getToken(ctx.accountId, this.platformKey);
    const accessToken = await this.getAccessToken(ctx);
    const profile = dataValue(await this.request(DOUYIN_ENDPOINTS.userInfo, accessToken, { method: "GET" }));
    const accountId = stringValue(profile.open_id) ?? tokenSet?.providerAccountId;
    const scopes = tokenSet?.scope ?? DOUYIN_OAUTH_CONFIG.scopes;
    return { accountId, accountName: stringValue(profile.nickname), scopes, expiresAt: tokenSet?.expiresAt, authorizationStatus: scopes.includes("video.create") ? "Authorized" : "Partial" };
  }

  async refreshLogin(ctx: AccountContext): Promise<OAuthTokenSet> {
    return this.oauth.refresh(ctx.accountId, DOUYIN_OAUTH_CONFIG, ctx.secrets);
  }

  async validateVideo(video: PublishVideoInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!video.title.trim()) errors.push("抖音视频标题不能为空");
    if (video.title.length > 30) errors.push("抖音视频标题不能超过 30 个字符");
    if (video.description && video.description.length > 1000) errors.push("抖音视频描述不能超过 1000 个字符");
    if (video.tags.length > 5) errors.push("抖音视频话题不能超过 5 个");
    if (video.tags.some((tag) => !tag.trim())) errors.push("抖音视频话题不能包含空值");
    await this.validateFile(video.videoPath, SUPPORTED_VIDEO_EXTENSIONS, "视频", errors);
    if (video.coverPath) await this.validateFile(video.coverPath, SUPPORTED_COVER_EXTENSIONS, "封面", errors);
    if (!video.description?.trim() && video.tags.length === 0) warnings.push("未提供描述或话题，平台审核与检索表现可能受影响");
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> {
    throw new DouyinAdapterError("PERMISSION_DENIED", "抖音 Adapter 只支持官方视频发布能力");
  }

  async publishVideo(ctx: AccountContext, video: PublishVideoInput): Promise<PublishResult> {
    const validation = await this.validateVideo(video);
    if (!validation.valid) throw new DouyinAdapterError("CONTENT_REJECTED", validation.errors.join("；"));

    // Dry Run is deliberately before token lookup, file reads and every network call.
    if (ctx.settings.dryRun === true) {
      return {
        success: true,
        dryRun: true,
        prepared: true,
        response: {
          adapter: this.platformKey,
          stage: "validated",
          networkCalls: 0,
          videoPath: video.videoPath,
          hasCover: Boolean(video.coverPath),
          warningCount: validation.warnings.length
        }
      };
    }

    const accessToken = await this.getAccessToken(ctx);
    const bytes = await this.readFilePort(video.videoPath);
    const form = new FormData();
    form.append("video", new Blob([bytes as unknown as BlobPart], { type: "video/mp4" }), basename(video.videoPath));
    form.append("title", video.title.trim());
    if (video.description?.trim()) form.append("description", video.description.trim());
    if (video.tags.length > 0) form.append("text", video.tags.map((tag) => `#${tag.trim()}`).join(" "));
    if (video.coverPath) {
      const coverBytes = await this.readFilePort(video.coverPath);
      form.append("cover_image", new Blob([coverBytes as unknown as BlobPart]), basename(video.coverPath));
    }

    const envelope = await this.request(DOUYIN_ENDPOINTS.videoCreate, accessToken, { method: "POST", body: form });
    const data = dataValue(envelope);
    const externalId = stringValue(data.publish_id) ?? stringValue(data.item_id) ?? stringValue(data.video_id);
    if (!externalId) throw new DouyinAdapterError("UPLOAD_FAILED", "抖音 video.create 未返回作品或发布 ID");

    const uploadUrl = stringValue(data.upload_url);
    if (uploadUrl) {
      const uploadResponse = await this.fetchPort(uploadUrl, { method: "PUT", body: new Blob([bytes as unknown as BlobPart], { type: "video/mp4" }) });
      if (!uploadResponse.ok) throw new DouyinAdapterError(mapDouyinError(undefined, uploadResponse.status, "视频上传失败"), `抖音视频上传失败（HTTP ${uploadResponse.status}）`);
    }
    return {
      success: true,
      status: "publishing",
      dryRun: false,
      externalId,
      response: responseRecord(DOUYIN_ENDPOINTS.videoCreate, envelope, data)
    };
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    if (!externalId.trim()) throw new DouyinAdapterError("CONTENT_REJECTED", "抖音作品 ID 不能为空");
    const accessToken = await this.getAccessToken(ctx);
    const envelope = await this.request(DOUYIN_ENDPOINTS.videoQuery, accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: externalId })
    });
    const data = dataValue(envelope);
    const status = normalizeStatus(data.status ?? data.publish_status ?? data.audit_status);
    const response = responseRecord(DOUYIN_ENDPOINTS.videoQuery, envelope, data);
    const result: PublishStatusResult = { status, externalId, response };
    const publishedUrl = stringValue(data.share_url) ?? stringValue(data.item_url);
    if (publishedUrl) result.publishedUrl = publishedUrl;
    if (status === "failed") {
      result.errorCode = mapDouyinError(numberValue(data.error_code) ?? numberValue(envelope.error_code), undefined, stringValue(data.message) ?? stringValue(envelope.message) ?? "抖音作品审核未通过");
      result.errorMessage = stringValue(data.message) ?? stringValue(envelope.message) ?? "抖音作品审核未通过";
    }
    return result;
  }

  private readonly oauthFetch: FetchPort = async (input, init) => {
    if (typeof init?.body !== "string" && !(init?.body instanceof URLSearchParams)) return this.fetchPort(input, init);
    const body = new URLSearchParams(init.body);
    const clientId = body.get("client_id");
    if (clientId) {
      body.delete("client_id");
      body.set("client_key", clientId);
    }
    return this.fetchPort(input, { ...init, body });
  };

  private async getAccessToken(ctx: AccountContext): Promise<string> {
    const current = this.oauth.getToken(ctx.accountId, this.platformKey);
    if (!current) throw new DouyinAdapterError("AUTH_REQUIRED", "抖音账号尚未完成 OAuth 授权");
    if (current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()) {
      const refreshed = await this.refreshLogin(ctx);
      return refreshed.accessToken;
    }
    return current.accessToken;
  }

  private async request(url: string, accessToken: string, init: RequestInit): Promise<DouyinEnvelope> {
    let response: Response;
    try {
      response = await this.fetchPort(url, {
        ...init,
        headers: { "Accept": "application/json", "access-token": accessToken, ...(init.headers ?? {}) }
      });
    } catch {
      throw new DouyinAdapterError("NETWORK_ERROR", `抖音接口网络失败：${url}`);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new DouyinAdapterError("NETWORK_ERROR", `抖音接口返回了无效 JSON：${url}`);
    }
    const envelope = objectValue(parsed) as DouyinEnvelope | undefined;
    if (!envelope) throw new DouyinAdapterError("NETWORK_ERROR", `抖音接口返回格式无效：${url}`);
    const errorCode = numberValue(envelope.error_code) ?? numberValue(dataValue(envelope).error_code);
    const message = stringValue(envelope.message) ?? stringValue(envelope.description) ?? stringValue(dataValue(envelope).message) ?? "抖音接口请求失败";
    if (!response.ok || (errorCode !== undefined && errorCode !== 0)) {
      throw new DouyinAdapterError(mapDouyinError(errorCode, response.status, message), message, errorCode === undefined ? undefined : String(errorCode));
    }
    return envelope;
  }

  private async validateFile(path: string, allowedExtensions: Set<string>, label: string, errors: string[]): Promise<void> {
    if (!path.trim()) {
      errors.push(`${label}文件不能为空`);
      return;
    }
    if (!allowedExtensions.has(extname(path).toLowerCase())) {
      errors.push(`${label}文件格式不受官方 API-only Adapter 支持`);
      return;
    }
    try {
      const file = await this.statPort(path);
      if (!file.isFile()) errors.push(`${label}文件不是普通文件`);
      else if (file.size <= 0) errors.push(`${label}文件不能为空`);
    } catch {
      errors.push(`${label}文件不存在或不可读取`);
    }
  }
}

function normalizeStatus(value: unknown): PublishStatusResult["status"] {
  if (typeof value === "number") {
    if (value === 1 || value === 2) return "published";
    if (value < 0 || value === 3 || value === 4) return "failed";
    return "publishing";
  }
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (["success", "succeeded", "published", "approved", "pass", "passed", "2"].includes(normalized)) return "published";
  if (["failed", "fail", "rejected", "reject", "denied", "3", "4"].includes(normalized)) return "failed";
  return "publishing";
}

export default DouyinOfficialAdapter;
