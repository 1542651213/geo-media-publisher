import { basename, extname } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type {
  AccountContext,
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

export const TOUTIAO_CONTENT_API_ROOT = "https://open.douyin.com";
export const TOUTIAO_OAUTH_API_ROOT = "https://open.snssdk.com";
export const TOUTIAO_MAX_VIDEO_BYTES = 128 * 1024 * 1024;

export const TOUTIAO_ENDPOINTS = {
  authorization: `${TOUTIAO_OAUTH_API_ROOT}/oauth/authorize/`,
  accessToken: `${TOUTIAO_OAUTH_API_ROOT}/oauth/access_token/`,
  refreshToken: `${TOUTIAO_OAUTH_API_ROOT}/oauth/refresh_token/`,
  videoUpload: `${TOUTIAO_CONTENT_API_ROOT}/toutiao/video/upload/`,
  videoCreate: `${TOUTIAO_CONTENT_API_ROOT}/toutiao/video/create/`,
  videoList: `${TOUTIAO_CONTENT_API_ROOT}/toutiao/video/list/`
} as const;

const TOUTIAO_OAUTH_CONFIG: OAuthPlatformConfig = {
  platformKey: "toutiao",
  authorizationUrl: TOUTIAO_ENDPOINTS.authorization,
  tokenUrl: TOUTIAO_ENDPOINTS.accessToken,
  refreshUrl: TOUTIAO_ENDPOINTS.refreshToken,
  clientIdKey: "clientKey",
  clientSecretKey: "clientSecret",
  scopes: ["toutiao.video.create", "toutiao.video.data"],
  usePkce: false,
  tokenClientAuth: "body"
};

const credentials: CredentialField[] = [
  { key: "clientKey", label: "抖音开放平台 Client Key", type: "oauth", required: true },
  { key: "clientSecret", label: "抖音开放平台 Client Secret", type: "secret", required: true },
  { key: "redirectUri", label: "今日头条 OAuth 回调地址", type: "text", required: true, helpText: "必须与开放平台应用配置完全一致。" }
];

const SUPPORTED_VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);

export type ToutiaoFetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ToutiaoFileStat {
  isFile(): boolean;
  size: number;
}

export interface ToutiaoAdapterOptions {
  credentialStore: CredentialStore;
  fetchPort?: ToutiaoFetchPort;
  readFilePort?: (path: string) => Promise<Uint8Array>;
  statPort?: (path: string) => Promise<ToutiaoFileStat>;
  oauthManager?: OAuthManager;
  now?: () => Date;
}

type JsonObject = Record<string, unknown>;

interface ToutiaoEnvelope {
  data?: unknown;
  extra?: unknown;
  error_code?: unknown;
  description?: unknown;
  message?: unknown;
}

interface ToutiaoVideoItem {
  item_id?: unknown;
  share_url?: unknown;
  status?: unknown;
  audit_status?: unknown;
  is_reviewed?: unknown;
  video_status?: unknown;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return Number(value);
  return undefined;
}

function nestedData(envelope: ToutiaoEnvelope): JsonObject {
  return objectValue(envelope.data) ?? {};
}

function providerErrorCode(envelope: ToutiaoEnvelope): number | undefined {
  const data = nestedData(envelope);
  const extra = objectValue(envelope.extra);
  return numberValue(data.error_code) ?? numberValue(envelope.error_code) ?? numberValue(extra?.error_code);
}

function providerMessage(envelope: ToutiaoEnvelope): string {
  const data = nestedData(envelope);
  const extra = objectValue(envelope.extra);
  return stringValue(data.description)
    ?? stringValue(envelope.description)
    ?? stringValue(envelope.message)
    ?? stringValue(extra?.description)
    ?? "今日头条官方 API 请求失败";
}

export function mapToutiaoError(errorCode: number | undefined, httpStatus: number | undefined, message = ""): ErrorCode {
  if (httpStatus === 401 || [10007, 10008, 10010, 2190002, 2190008, 2190015].includes(errorCode ?? -1)) return "LOGIN_EXPIRED";
  if (httpStatus === 403 || [10003, 10004, 2100007, 2190003, 2190004, 2190016].includes(errorCode ?? -1)) return "PERMISSION_DENIED";
  if (httpStatus === 429 || [2190001, 2114007].includes(errorCode ?? -1)) return "RATE_LIMITED";
  if (httpStatus === 412 || /captcha|human verification|security verification|验证码|安全验证|人机/iu.test(message)) return "USER_ACTION_REQUIRED";
  if ([10012].includes(errorCode ?? -1)) return "API_REVIEW_REQUIRED";
  if ([2100005, 2190005, 2190006, 2190007, 2114005].includes(errorCode ?? -1) || httpStatus === 400 || httpStatus === 422) return "CONTENT_REJECTED";
  if (errorCode === 2100004 || httpStatus === 408 || (httpStatus !== undefined && httpStatus >= 500)) return "NETWORK_ERROR";
  return "UPLOAD_FAILED";
}

export class ToutiaoAdapterError extends PlatformAdapterError {
  constructor(code: ErrorCode, message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "ToutiaoAdapterError";
  }
}

export class ToutiaoAdapter implements PlatformAdapter {
  readonly platformKey = "toutiao";
  readonly manifest: AdapterManifest = {
    platformKey: "toutiao",
    displayName: "头条号",
    category: "视频",
    version: "0.4.0",
    adapterStatus: "ready",
    authStrategy: "OAuth2",
    callbackStrategy: "HttpsCallback",
    status: "WaitingForUser",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: false,
    supportsVideo: true,
    officialWebsite: "https://mp.toutiao.com/",
    developerPortal: "https://open.douyin.com/platform/resource/docs/ability/content-management/toutiao-publish-solution",
    lastVerifiedAt: "2026-08-20",
    blockingReason: "需要开放平台应用审核、toutiao.video.create/toutiao.video.data 权限、账号 OAuth 授权和真实低量发布验证；当前明确不支持文章或微头条发布。",
    credentialSchema: credentials,
    officialSources: [
      "https://open.douyin.com/platform/resource/docs/ability/content-management/toutiao-publish-solution",
      "https://open.douyin.com/platform/resource/docs/openapi/video-management/toutiao/create-video/upload-video",
      "https://open.douyin.com/platform/resource/docs/openapi/video-management/toutiao/create-video/publish-video",
      "https://open.douyin.com/platform/resource/docs/openapi/video-management/toutiao/search-video/account-video-list/",
      "https://open.douyin.com/platform/resource/docs/openapi/account-permission/toutiao-get-permission-code"
    ]
  };

  private readonly fetchPort: ToutiaoFetchPort;
  private readonly readFilePort: (path: string) => Promise<Uint8Array>;
  private readonly statPort: (path: string) => Promise<ToutiaoFileStat>;
  private readonly oauth: OAuthManager;
  private readonly now: () => Date;

  constructor(options: ToutiaoAdapterOptions) {
    this.fetchPort = options.fetchPort ?? fetch;
    this.readFilePort = options.readFilePort ?? (async (path) => readFile(path));
    this.statPort = options.statPort ?? (async (path) => stat(path));
    this.oauth = options.oauthManager ?? new OAuthManager(options.credentialStore, this.oauthFetch);
    this.now = options.now ?? (() => new Date());
  }

  getCapabilities(): PlatformCapabilities {
    return {
      article: false,
      imagePost: false,
      video: true,
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
      maxVideoSize: TOUTIAO_MAX_VIDEO_BYTES,
      maxVideoDuration: 60,
      videoFormats: ["video/mp4", "video/webm"],
      supportsVideoCover: false,
      supportsVideoTags: false,
      videoPublishAsync: true
    };
  }

  getCredentialSchema(): CredentialField[] {
    return credentials.map((field) => ({ ...field }));
  }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const token = this.oauth.getToken(ctx.accountId, this.platformKey);
    if (!token?.accessToken.trim()) return "logged_out";
    if (this.expired(token)) return "expired";
    return "logged_in";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const redirectUri = ctx.secrets?.redirectUri?.trim() || this.settingString(ctx, "redirectUri") || this.settingString(ctx, "oauthRedirectUri");
    const sessionId = `toutiao-oauth-${ctx.accountId}-${Date.now()}`;
    if (!redirectUri) return { sessionId, requiresUserAction: true, message: "请先配置今日头条 OAuth 回调地址。" };
    try {
      const request = this.oauth.createAuthorization(ctx.accountId, TOUTIAO_OAUTH_CONFIG, ctx.secrets, redirectUri);
      const authorizationUrl = new URL(request.authorizationUrl);
      const clientId = authorizationUrl.searchParams.get("client_id");
      if (clientId) {
        authorizationUrl.searchParams.delete("client_id");
        authorizationUrl.searchParams.set("client_key", clientId);
      }
      const scope = authorizationUrl.searchParams.get("scope");
      if (scope) authorizationUrl.searchParams.set("scope", scope.split(/\s+/u).filter(Boolean).join(","));
      return {
        sessionId: `toutiao-oauth-${request.state}`,
        requiresUserAction: true,
        authorizationUrl: authorizationUrl.toString(),
        callbackUrl: request.callbackUrl,
        message: "请在今日头条官方授权页完成账号授权；验证码、安全验证和权限审核必须由用户按平台正常流程完成。"
      };
    } catch (error) {
      if (error instanceof PlatformAdapterError) return { sessionId, requiresUserAction: true, message: error.message };
      return { sessionId, requiresUserAction: true, message: "今日头条 OAuth 授权准备失败。" };
    }
  }

  async completeLogin(ctx: AccountContext, code: string, state: string): Promise<OAuthTokenSet> {
    if (!code.trim() || !state.trim()) throw new ToutiaoAdapterError("AUTH_REQUIRED", "OAuth code/state 不能为空");
    return this.oauth.completeAuthorization(ctx.accountId, TOUTIAO_OAUTH_CONFIG, ctx.secrets, code, state);
  }

  async refreshLogin(ctx: AccountContext): Promise<OAuthTokenSet> {
    return this.oauth.refresh(ctx.accountId, TOUTIAO_OAUTH_CONFIG, ctx.secrets);
  }

  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> {
    return { valid: false, errors: ["今日头条官方发布 Adapter 当前只支持视频，不支持头条文章或微头条"], warnings: [] };
  }

  async validateVideo(video: PublishVideoInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!video.title.trim()) errors.push("今日头条视频标题不能为空");
    if (!video.videoPath.trim()) errors.push("今日头条视频文件不能为空");
    else if (!SUPPORTED_VIDEO_EXTENSIONS.has(extname(video.videoPath).toLowerCase())) errors.push("今日头条单文件上传仅支持 MP4 或 WebM");
    if (video.coverPath) errors.push("当前官方今日头条视频 Adapter 未确认自定义封面字段");
    if (video.tags.length > 0) warnings.push("当前官方今日头条视频 Adapter 未确认独立标签字段，标签不会提交");
    if (video.videoPath.trim() && SUPPORTED_VIDEO_EXTENSIONS.has(extname(video.videoPath).toLowerCase())) {
      try {
        const info = await this.statPort(video.videoPath);
        if (!info.isFile() || info.size <= 0) errors.push("今日头条视频文件不存在或为空");
        else if (info.size > TOUTIAO_MAX_VIDEO_BYTES) errors.push("今日头条单文件上传严格限制为 128MB；当前 Adapter 不启用大文件分片上传");
      } catch {
        errors.push("今日头条视频文件不存在或不可读取");
      }
    }
    warnings.push("官方要求视频时长不超过 1 分钟；当前输入模型没有可信时长元数据，真实发布前必须人工确认");
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> {
    throw new ToutiaoAdapterError("PERMISSION_DENIED", "今日头条官方发布 Adapter 不支持文章或微头条发布");
  }

  async publishVideo(ctx: AccountContext, video: PublishVideoInput): Promise<PublishResult> {
    const validation = await this.validateVideo(video);
    if (!validation.valid) throw new ToutiaoAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    if (ctx.settings.dryRun === true) {
      return {
        success: true,
        dryRun: true,
        prepared: true,
        response: {
          adapter: this.platformKey,
          stage: "validated",
          networkCalls: 0,
          maxVideoBytes: TOUTIAO_MAX_VIDEO_BYTES,
          warnings: validation.warnings
        }
      };
    }

    const token = await this.getAccessToken(ctx);
    const bytes = await this.readFilePort(video.videoPath);
    const form = new FormData();
    const mimeType = extname(video.videoPath).toLowerCase() === ".webm" ? "video/webm" : "video/mp4";
    form.append("video", new Blob([bytes as unknown as BlobPart], { type: mimeType }), basename(video.videoPath));
    const upload = await this.request(TOUTIAO_ENDPOINTS.videoUpload, token.accessToken, { method: "POST", body: form }, "upload");
    const uploadData = nestedData(upload);
    const videoObject = objectValue(uploadData.video);
    const videoId = stringValue(videoObject?.video_id);
    if (!videoId) throw new ToutiaoAdapterError("UPLOAD_FAILED", "今日头条上传响应缺少 video_id");

    const create = await this.request(TOUTIAO_ENDPOINTS.videoCreate, token.accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, text: this.publishText(video) })
    }, "publish");
    const createData = nestedData(create);
    const itemId = stringValue(createData.item_id);
    if (!itemId) throw new ToutiaoAdapterError("UPLOAD_FAILED", "今日头条发布响应缺少 item_id");
    return {
      success: true,
      status: "publishing",
      externalId: itemId,
      response: { adapter: this.platformKey, stage: "reviewing", itemId, videoId }
    };
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    if (!externalId.trim()) throw new ToutiaoAdapterError("CONTENT_REJECTED", "今日头条 item_id 不能为空");
    const token = await this.getAccessToken(ctx);
    const list = await this.request(TOUTIAO_ENDPOINTS.videoList, token.accessToken, { method: "GET", headers: { "Content-Type": "application/json" } }, "status");
    const data = nestedData(list);
    const items = Array.isArray(data.list) ? data.list : [];
    const item = items.map(objectValue).find((candidate) => stringValue(candidate?.item_id) === externalId) as ToutiaoVideoItem | undefined;
    if (!item) {
      return { status: "publishing", externalId, response: { adapter: this.platformKey, source: "video.list", found: false, needsReconciliation: true } };
    }
    const statusText = stringValue(item.status ?? item.audit_status)?.toLowerCase();
    if (["failed", "rejected", "reject", "denied"].includes(statusText ?? "")) {
      return { status: "failed", externalId, errorCode: "CONTENT_REJECTED", errorMessage: "今日头条视频审核未通过", response: { adapter: this.platformKey, source: "video.list", status: statusText } };
    }
    const publishedUrl = stringValue(item.share_url);
    if (publishedUrl || item.is_reviewed === true || ["published", "approved", "success", "passed"].includes(statusText ?? "")) {
      return { status: "published", externalId, ...(publishedUrl ? { publishedUrl } : {}), response: { adapter: this.platformKey, source: "video.list", status: statusText, reviewed: item.is_reviewed === true } };
    }
    return {
      status: "publishing",
      externalId,
      response: { adapter: this.platformKey, source: "video.list", found: true, status: statusText, videoStatus: item.video_status, needsReconciliation: true }
    };
  }

  private readonly oauthFetch: ToutiaoFetchPort = async (input, init) => {
    if (typeof init?.body !== "string" && !(init?.body instanceof URLSearchParams)) return this.fetchPort(input, init);
    const body = new URLSearchParams(init.body);
    const clientId = body.get("client_id");
    if (clientId) {
      body.delete("client_id");
      body.set("client_key", clientId);
    }
    return this.fetchPort(input, { ...init, body });
  };

  private async getAccessToken(ctx: AccountContext): Promise<OAuthTokenSet> {
    const current = this.oauth.getToken(ctx.accountId, this.platformKey);
    if (!current) throw new ToutiaoAdapterError("AUTH_REQUIRED", "今日头条账号尚未完成 OAuth 授权");
    if (!this.expired(current)) return current;
    if (!current.refreshToken) throw new ToutiaoAdapterError("LOGIN_EXPIRED", "今日头条 OAuth 已过期且没有 refresh token，请重新授权");
    try {
      return await this.refreshLogin(ctx);
    } catch (error) {
      if (error instanceof PlatformAdapterError) throw error;
      throw new ToutiaoAdapterError("LOGIN_EXPIRED", "今日头条 OAuth 刷新失败，请重新授权");
    }
  }

  private expired(token: OAuthTokenSet): boolean {
    if (!token.expiresAt) return false;
    const expiresAt = new Date(token.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= this.now().getTime() + 30_000;
  }

  private async request(url: string, accessToken: string, init: RequestInit, operation: "upload" | "publish" | "status"): Promise<ToutiaoEnvelope> {
    let response: Response;
    try {
      response = await this.fetchPort(url, { ...init, headers: { Accept: "application/json", "access-token": accessToken, ...(init.headers ?? {}) } });
    } catch {
      throw new ToutiaoAdapterError("NETWORK_ERROR", `今日头条 ${operation} 请求网络失败`);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ToutiaoAdapterError("NETWORK_ERROR", `今日头条 ${operation} 响应不是有效 JSON`);
    }
    const envelope = objectValue(value) as ToutiaoEnvelope | undefined;
    if (!envelope) throw new ToutiaoAdapterError("NETWORK_ERROR", `今日头条 ${operation} 响应格式无效`);
    const errorCode = providerErrorCode(envelope);
    if (!response.ok || (errorCode !== undefined && errorCode !== 0)) {
      const message = providerMessage(envelope);
      throw new ToutiaoAdapterError(mapToutiaoError(errorCode, response.status, message), message, errorCode === undefined ? undefined : String(errorCode));
    }
    return envelope;
  }

  private settingString(ctx: AccountContext, key: string): string | undefined {
    const value = ctx.settings[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private publishText(video: PublishVideoInput): string {
    return [video.title.trim(), video.description?.trim()].filter((value): value is string => Boolean(value)).join("\n");
  }
}

export const ToutiaoOfficialAdapter = ToutiaoAdapter;
export { ToutiaoArticleBrowserAdapter } from "./browser";
export default ToutiaoAdapter;
