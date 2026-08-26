import { basename } from "node:path";
import { open, stat } from "node:fs/promises";
import type { CredentialStore } from "@publisher/security";
import type {
  AccountContext,
  AdapterManifest,
  LoginSession,
  LoginStatus,
  PlatformCapabilities,
  PublishResult,
  PublishStatusResult,
  PublishArticleInput,
  PublishVideoInput,
  ValidationResult,
  ErrorCode
} from "@publisher/domain";
import {
  OAuthManager,
  PlatformAdapterError,
  type OAuthAuthorizationRequest,
  type OAuthPlatformConfig,
  type OAuthTokenSet,
  type PlatformAdapter
} from "@publisher/adapters-core";

export type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Scalar = string | number | boolean | null;

export interface KuaishouUploadChunkRequest {
  accessToken: string;
  videoPath: string;
  chunk: Uint8Array;
  chunkIndex: number;
  totalChunks: number;
  totalBytes: number;
  uploadId?: string;
}

export interface KuaishouUploadedVideo {
  photoId: string;
  uploadId?: string;
}

export interface KuaishouPublishRequest {
  accessToken: string;
  video: PublishVideoInput;
  upload: KuaishouUploadedVideo;
}

export interface KuaishouStatusRequest {
  accessToken: string;
  externalId: string;
}

export interface KuaishouApiContract {
  /** Must be true only after the official request shape has been reviewed. */
  reviewed: boolean;
  accessTokenPlacement: "bearer" | "query";
  upload: {
    url: string;
    fileField: string;
    chunkIndexField: string;
    totalChunksField: string;
    uploadIdField?: string;
    contentRangeHeader?: string;
    photoIdPath: string;
    uploadIdPath?: string;
  };
  publish: {
    url: string;
    method: "POST";
    body: (request: KuaishouPublishRequest) => Record<string, Scalar>;
    externalIdPath: string;
  };
  status: {
    url: (externalId: string) => string;
    method: "GET" | "POST";
    body?: (request: KuaishouStatusRequest) => Record<string, Scalar>;
    statusPath: string;
    publishingValues: string[];
    publishedValues: string[];
    failedValues: string[];
    publishedUrlPath?: string;
    errorMessagePath?: string;
  };
  /** Provider-specific error fields must be supplied by the reviewed contract. */
  errorCodePaths?: string[];
  errorMessagePaths?: string[];
  errorCodeMap?: Record<string, ErrorCode>;
}

export interface KuaishouAdapterOptions {
  fetchPort?: FetchPort;
  credentialStore?: CredentialStore;
  oauth?: Omit<OAuthPlatformConfig, "platformKey">;
  apiContract?: KuaishouApiContract;
  chunkSizeBytes?: number;
  now?: () => Date;
}

class EphemeralCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

export class KuaishouAdapterError extends PlatformAdapterError {
  constructor(code: ErrorCode, message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "KuaishouAdapterError";
  }
}

/**
 * Official-API-only Kuaishou video adapter.
 *
 * The matrix confirms the product capability and required OAuth scope, but it
 * does not contain enough official request-shape detail to safely hard-code an
 * upload protocol. A reviewed contract is therefore mandatory for network
 * publishing. No browser session, selector or private endpoint is used.
 */
export class KuaishouAdapter implements PlatformAdapter {
  readonly platformKey = "kuaishou";
  readonly manifest: AdapterManifest = {
    platformKey: "kuaishou",
    displayName: "快手",
    category: "视频",
    version: "0.1.0",
    adapterStatus: "degraded",
    authStrategy: "OAuth2",
    callbackStrategy: "HttpsCallback",
    status: "Blocked",
    researchStatus: "verified",
    transport: "official_api",
    supportsArticle: false,
    supportsVideo: true,
    officialWebsite: "https://www.kuaishou.com/",
    developerPortal: "https://open.kuaishou.com/",
    lastVerifiedAt: "2026-08-19",
    blockingReason: "官方开放平台当前文档标注相关接入暂停；即使注入测试合同，生产接入仍需平台客服/审核恢复后才能进行。",
    credentialSchema: [
      { key: "clientId", label: "快手开放平台 Client ID", type: "text", required: true },
      { key: "clientSecret", label: "快手开放平台 Client Secret", type: "secret", required: true },
      { key: "redirectUri", label: "OAuth Redirect URI", type: "text", required: true, helpText: "须与快手开放平台应用配置一致。OAuth scope 需要 user_video_publish。" }
    ],
    officialSources: [
      "https://open.kuaishou.com/platform/openApi?menu=20",
      "https://open.kuaishou.com/platform/openApi?menu=12"
    ]
  };

  private readonly fetchPort: FetchPort;
  private readonly oauthManager: OAuthManager;
  private readonly oauthConfig?: OAuthPlatformConfig;
  private readonly apiContract?: KuaishouApiContract;
  private readonly chunkSizeBytes: number;
  private readonly now: () => Date;

  constructor(options: KuaishouAdapterOptions = {}) {
    this.fetchPort = options.fetchPort ?? fetch;
    this.oauthManager = new OAuthManager(options.credentialStore ?? new EphemeralCredentialStore(), this.fetchPort);
    this.oauthConfig = options.oauth ? { ...options.oauth, platformKey: this.platformKey } : undefined;
    this.apiContract = options.apiContract;
    const configuredChunkSize = options.chunkSizeBytes;
    this.chunkSizeBytes = configuredChunkSize && Number.isInteger(configuredChunkSize) && configuredChunkSize > 0 ? configuredChunkSize : 8 * 1024 * 1024;
    this.now = options.now ?? (() => new Date());
  }

  getCapabilities(): PlatformCapabilities {
    return {
      article: false,
      imagePost: false,
      video: true,
      coverImage: true,
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
      supportsVideoCover: true,
      supportsVideoTags: false,
      videoPublishAsync: true
    };
  }

  getCredentialSchema() { return [...this.manifest.credentialSchema]; }

  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> {
    throw new KuaishouAdapterError("PERMISSION_DENIED", "快手 Adapter 只支持官方 API 视频发布");
  }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const token = this.oauthManager.getToken(ctx.accountId, this.platformKey);
    if (!token) return "logged_out";
    if (token.expiresAt && this.expired(token)) return token.refreshToken ? "expired" : "expired";
    return "logged_in";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const sessionId = `kuaishou-oauth-${Date.now()}`;
    if (!this.oauthConfig) {
      return {
        sessionId,
        requiresUserAction: true,
        message: "快手 OAuth 端点尚未通过官方请求审核；已停止登录流程并记录 API_REVIEW_REQUIRED。"
      };
    }
    const redirectUri = ctx.secrets?.redirectUri?.trim();
    if (!redirectUri) {
      return { sessionId, requiresUserAction: true, message: "请先配置快手 OAuth Redirect URI。" };
    }
    try {
      const authorization = this.oauthManager.createAuthorization(ctx.accountId, this.oauthConfig, ctx.secrets, redirectUri);
      return this.loginSession(authorization);
    } catch (error) {
      if (error instanceof PlatformAdapterError) return { sessionId, requiresUserAction: true, message: error.message };
      return { sessionId, requiresUserAction: true, message: "快手 OAuth 登录准备失败。" };
    }
  }

  async completeLogin(ctx: AccountContext, code: string, state: string): Promise<OAuthTokenSet> {
    if (!this.oauthConfig) throw new KuaishouAdapterError("API_REVIEW_REQUIRED", "快手 OAuth 端点尚未通过官方请求审核");
    if (!code.trim() || !state.trim()) throw new KuaishouAdapterError("PERMISSION_DENIED", "OAuth code/state 不能为空");
    const redirectUri = ctx.secrets?.redirectUri?.trim();
    if (!redirectUri) throw new KuaishouAdapterError("AUTH_REQUIRED", "未配置快手 OAuth Redirect URI");
    return this.oauthManager.completeAuthorization(ctx.accountId, this.oauthConfig, ctx.secrets, code, state);
  }

  async validateVideo(video: PublishVideoInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!video.title.trim()) errors.push("快手视频标题/说明不能为空");
    await this.validateFile(video.videoPath, "视频", errors);
    if (video.coverPath) await this.validateFile(video.coverPath, "封面", errors);
    if (video.tags.length > 0) warnings.push("矩阵只确认 caption；标签字段未在本 Adapter 中自动发送");
    warnings.push("未在本地推断快手视频格式、时长或大小限制，需由官方 contract/平台响应确认");
    return { valid: errors.length === 0, errors, warnings };
  }

  async publishVideo(ctx: AccountContext, video: PublishVideoInput): Promise<PublishResult> {
    const validation = await this.validateVideo(video);
    if (!validation.valid) throw new KuaishouAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    if (ctx.settings.dryRun === true) {
      return {
        success: true,
        dryRun: true,
        prepared: true,
        response: { adapter: this.platformKey, stage: "validated", apiReviewRequired: !this.apiContract?.reviewed }
      };
    }
    const contract = this.requireReviewedContract();
    const token = await this.getAccessToken(ctx);
    const upload = await this.uploadVideo(token, video, contract);
    const payload = await this.requestJson(contract.publish.url, token, contract, {
      method: contract.publish.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contract.publish.body({ accessToken: token.accessToken, video, upload }))
    }, "publish");
    const externalId = stringAtPath(payload, contract.publish.externalIdPath);
    if (!externalId) throw new KuaishouAdapterError("UPLOAD_FAILED", "快手发布响应缺少可回查的 externalId");
    return {
      success: true,
      status: "publishing",
      dryRun: false,
      externalId,
      response: { adapter: this.platformKey, stage: "publishing", externalId, providerResponse: recordValue(payload) }
    };
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    if (!externalId.trim()) throw new KuaishouAdapterError("CONTENT_REJECTED", "externalId 不能为空");
    const contract = this.requireReviewedContract();
    const token = await this.getAccessToken(ctx);
    const request: RequestInit = { method: contract.status.method };
    if (contract.status.method === "POST") {
      request.headers = { "Content-Type": "application/json" };
      request.body = JSON.stringify(contract.status.body?.({ accessToken: token.accessToken, externalId }) ?? {});
    }
    const payload = await this.requestJson(contract.status.url(externalId), token, contract, request, "status");
    const providerStatus = stringAtPath(payload, contract.status.statusPath);
    if (!providerStatus) throw new KuaishouAdapterError("NETWORK_ERROR", "快手状态响应缺少状态字段");
    const normalized = providerStatus.toLowerCase();
    if (contract.status.publishedValues.map((value) => value.toLowerCase()).includes(normalized)) {
      const publishedUrl = contract.status.publishedUrlPath ? stringAtPath(payload, contract.status.publishedUrlPath) : undefined;
      return { status: "published", externalId, ...(publishedUrl ? { publishedUrl } : {}), response: { adapter: this.platformKey, providerStatus } };
    }
    if (contract.status.publishingValues.map((value) => value.toLowerCase()).includes(normalized)) {
      return { status: "publishing", externalId, response: { adapter: this.platformKey, providerStatus } };
    }
    if (contract.status.failedValues.map((value) => value.toLowerCase()).includes(normalized)) {
      const errorMessage = contract.status.errorMessagePath ? stringAtPath(payload, contract.status.errorMessagePath) : undefined;
      return { status: "failed", externalId, errorCode: "CONTENT_REJECTED", ...(errorMessage ? { errorMessage } : {}), response: { adapter: this.platformKey, providerStatus } };
    }
    return { status: "failed", externalId, errorCode: "UNKNOWN", errorMessage: `快手返回了未识别的发布状态：${providerStatus}`, response: { adapter: this.platformKey, providerStatus } };
  }

  private async uploadVideo(token: OAuthTokenSet, video: PublishVideoInput, contract: KuaishouApiContract): Promise<KuaishouUploadedVideo> {
    const fileInfo = await stat(video.videoPath);
    const totalChunks = Math.ceil(fileInfo.size / this.chunkSizeBytes);
    const file = await open(video.videoPath, "r");
    let uploadId: string | undefined;
    let photoId: string | undefined;
    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * this.chunkSizeBytes;
        const length = Math.min(this.chunkSizeBytes, fileInfo.size - start);
        const buffer = Buffer.alloc(length);
        const read = await file.read(buffer, 0, length, start);
        if (read.bytesRead !== length) throw new KuaishouAdapterError("UPLOAD_FAILED", "视频分片读取不完整");
        const form = new FormData();
        form.append(contract.upload.fileField, new Blob([buffer as unknown as BlobPart]), basename(video.videoPath));
        form.append(contract.upload.chunkIndexField, String(chunkIndex));
        form.append(contract.upload.totalChunksField, String(totalChunks));
        if (contract.upload.uploadIdField && uploadId) form.append(contract.upload.uploadIdField, uploadId);
        const headers: Record<string, string> = {};
        if (contract.upload.contentRangeHeader) headers[contract.upload.contentRangeHeader] = `bytes ${start}-${start + length - 1}/${fileInfo.size}`;
        const payload = await this.requestJson(contract.upload.url, token, contract, { method: "POST", headers, body: form }, "upload");
        const nextUploadId = contract.upload.uploadIdPath ? stringAtPath(payload, contract.upload.uploadIdPath) : undefined;
        if (nextUploadId) uploadId = nextUploadId;
        const nextPhotoId = stringAtPath(payload, contract.upload.photoIdPath);
        if (nextPhotoId) photoId = nextPhotoId;
        if (contract.upload.uploadIdField && chunkIndex < totalChunks - 1 && !uploadId) {
          throw new KuaishouAdapterError("UPLOAD_FAILED", "快手分片响应未返回后续分片所需的 uploadId");
        }
      }
    } finally {
      await file.close();
    }
    if (!photoId) throw new KuaishouAdapterError("UPLOAD_FAILED", "快手分片上传响应未返回 photoId");
    return { photoId, ...(uploadId ? { uploadId } : {}) };
  }

  private async getAccessToken(ctx: AccountContext): Promise<OAuthTokenSet> {
    if (!this.oauthConfig) throw new KuaishouAdapterError("API_REVIEW_REQUIRED", "快手 OAuth 端点尚未通过官方请求审核");
    const current: OAuthTokenSet | null = this.oauthManager.getToken(ctx.accountId, this.platformKey);
    if (current === null) throw new KuaishouAdapterError("AUTH_REQUIRED", "快手账号尚未完成 OAuth 授权");
    if (!this.expired(current)) return current;
    if (current.refreshToken) return this.oauthManager.refresh(ctx.accountId, this.oauthConfig, ctx.secrets);
    throw new KuaishouAdapterError("AUTH_REQUIRED", "快手账号尚未完成 OAuth 授权");
  }

  private expired(token: OAuthTokenSet): boolean {
    const expiresAt = token.expiresAt;
    if (!expiresAt) return false;
    const timestamp = new Date(expiresAt).getTime();
    return Number.isFinite(timestamp) && timestamp <= this.now().getTime() + 30_000;
  }

  private requireReviewedContract(): KuaishouApiContract {
    const contract = this.apiContract;
    if (!contract || !contract.reviewed) {
      throw new KuaishouAdapterError("API_REVIEW_REQUIRED", "快手分片上传、发布和状态接口的官方请求字段尚未审核");
    }
    return contract;
  }

  private async requestJson(url: string, token: OAuthTokenSet, contract: KuaishouApiContract, init: RequestInit, operation: "upload" | "publish" | "status"): Promise<unknown> {
    const requestUrl = new URL(url);
    const headers = new Headers(init.headers);
    if (contract.accessTokenPlacement === "query") requestUrl.searchParams.set("access_token", token.accessToken);
    else headers.set("Authorization", `${token.tokenType || "Bearer"} ${token.accessToken}`);
    let response: Response;
    try {
      response = await this.fetchPort(requestUrl, { ...init, headers });
    } catch {
      throw new KuaishouAdapterError("NETWORK_ERROR", `快手 ${operation} 请求网络失败`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new KuaishouAdapterError("NETWORK_ERROR", `快手 ${operation} 响应不是有效 JSON`);
    }
    const providerCode = this.providerErrorCode(payload, contract);
    if (!response.ok || providerCode) {
      throw new KuaishouAdapterError(this.mapErrorCode(response.status, providerCode, operation, contract), this.providerErrorMessage(payload, contract) ?? `快手 ${operation} 请求失败（HTTP ${response.status}）`, providerCode);
    }
    return payload;
  }

  private providerErrorCode(payload: unknown, contract: KuaishouApiContract): string | undefined {
    for (const path of contract.errorCodePaths ?? []) {
      const value = stringAtPath(payload, path);
      if (value && value !== "0") return value;
    }
    return undefined;
  }

  private providerErrorMessage(payload: unknown, contract: KuaishouApiContract): string | undefined {
    for (const path of contract.errorMessagePaths ?? []) {
      const value = stringAtPath(payload, path);
      if (value) return value;
    }
    return undefined;
  }

  private mapErrorCode(status: number, providerCode: string | undefined, operation: "upload" | "publish" | "status", contract: KuaishouApiContract): ErrorCode {
    const mapped = providerCode ? contract.errorCodeMap?.[providerCode] : undefined;
    if (mapped) return mapped;
    if (status === 401) return "LOGIN_EXPIRED";
    if (status === 403) return "PERMISSION_DENIED";
    if (status === 429) return "RATE_LIMITED";
    if (status === 408 || status >= 500) return "NETWORK_ERROR";
    if (status === 400 || status === 422) return "CONTENT_REJECTED";
    return operation === "status" ? "UNKNOWN" : "UPLOAD_FAILED";
  }

  private async validateFile(path: string, label: string, errors: string[]): Promise<void> {
    if (!path.trim()) {
      errors.push(`${label}路径不能为空`);
      return;
    }
    try {
      const info = await stat(path);
      if (!info.isFile()) errors.push(`${label}必须是文件`);
      else if (info.size <= 0) errors.push(`${label}不能为空文件`);
    } catch {
      errors.push(`${label}文件不存在或不可读`);
    }
  }

  private loginSession(authorization: OAuthAuthorizationRequest): LoginSession {
    return {
      sessionId: `kuaishou-oauth-${authorization.state}`,
      requiresUserAction: true,
      authorizationUrl: authorization.authorizationUrl,
      callbackUrl: authorization.callbackUrl,
      message: "请在快手官方授权页完成 OAuth；遇验证码或安全验证时暂停并由用户完成。"
    };
  }
}

function stringAtPath(value: unknown, path: string): string | undefined {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === "string" && current.length > 0) return current;
  if (typeof current === "number" && Number.isFinite(current)) return String(current);
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value };
}
