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
import { PlatformAdapterError, type PlatformAdapter } from "@publisher/adapters-core";

export interface ManualAdapterDefinition {
  platformKey: string;
  displayName: string;
  category: string;
  officialWebsite: string;
  developerPortal?: string;
  officialSources: string[];
  blockingReason: string;
  researchStatus: AdapterManifest["researchStatus"];
  status: AdapterManifest["status"];
  transport?: AdapterManifest["transport"];
  supportsArticle: boolean;
  supportsVideo: boolean;
  credentials: CredentialField[];
  capabilities: PlatformCapabilities;
  manualInstructions: string;
}

export class ManualAdapterError extends PlatformAdapterError {
  constructor(code: ErrorCode, message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "ManualAdapterError";
  }
}

export function mapManualError(message: string, httpStatus?: number): ErrorCode {
  const normalized = message.toLowerCase();
  if (httpStatus === 401 || /login|logged out|token|auth|登录|授权/u.test(normalized)) return "LOGIN_EXPIRED";
  if (httpStatus === 403 || /permission|forbidden|权限|资质/u.test(normalized)) return "PERMISSION_DENIED";
  if (httpStatus === 429 || /rate|频繁|限流/u.test(normalized)) return "RATE_LIMITED";
  if (/captcha|human verification|security verification|验证码|人机|安全验证/u.test(normalized)) return "USER_ACTION_REQUIRED";
  if (/title|content|body|image|video|标题|正文|图片|视频/u.test(normalized)) return "CONTENT_REJECTED";
  return "USER_ACTION_REQUIRED";
}

function validateArticleInput(article: PublishArticleInput, capabilities: PlatformCapabilities, displayName: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!article.title.trim()) errors.push(`${displayName}标题不能为空`);
  if (!article.body.trim()) errors.push(`${displayName}正文不能为空`);
  if (capabilities.maxTitleLength > 0 && article.title.length > capabilities.maxTitleLength) errors.push(`${displayName}标题不能超过 ${capabilities.maxTitleLength} 个字符`);
  if (!capabilities.coverImage && article.coverPath) errors.push(`${displayName}当前不支持封面上传`);
  if ((article.images?.length ?? 0) > capabilities.maxImageCount) errors.push(`${displayName}图片数量不能超过 ${capabilities.maxImageCount}`);
  if (!capabilities.tags && article.tags.length > 0) warnings.push(`${displayName}当前不会提交标签`);
  if (capabilities.maxTagCount !== undefined && article.tags.length > capabilities.maxTagCount) errors.push(`${displayName}标签数量不能超过 ${capabilities.maxTagCount}`);
  return { valid: errors.length === 0, errors, warnings };
}

function validateVideoInput(video: PublishVideoInput, capabilities: PlatformCapabilities, displayName: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!video.title.trim()) errors.push(`${displayName}视频标题不能为空`);
  if (!video.videoPath.trim()) errors.push(`${displayName}视频文件不能为空`);
  if (!capabilities.coverImage && video.coverPath) errors.push(`${displayName}当前不支持视频封面上传`);
  if (!capabilities.tags && video.tags.length > 0) warnings.push(`${displayName}当前不会提交视频标签`);
  if (capabilities.maxTagCount !== undefined && video.tags.length > capabilities.maxTagCount) errors.push(`${displayName}视频标签数量不能超过 ${capabilities.maxTagCount}`);
  return { valid: errors.length === 0, errors, warnings };
}

export class ManualOnlyAdapter implements PlatformAdapter {
  readonly platformKey: string;
  readonly manifest: AdapterManifest;

  constructor(private readonly definition: ManualAdapterDefinition) {
    this.platformKey = definition.platformKey;
    this.manifest = {
      platformKey: definition.platformKey,
      displayName: definition.displayName,
      category: definition.category,
      version: "0.5.1",
      adapterStatus: "degraded",
      authStrategy: "ManualOnly",
      callbackStrategy: "ManualCodeCallback",
      status: definition.status,
      researchStatus: definition.researchStatus,
      transport: definition.transport ?? "manual",
      supportsArticle: definition.supportsArticle,
      supportsVideo: definition.supportsVideo,
      officialWebsite: definition.officialWebsite,
      ...(definition.developerPortal ? { developerPortal: definition.developerPortal } : {}),
      lastVerifiedAt: "2026-08-20",
      blockingReason: definition.blockingReason,
      credentialSchema: definition.credentials.map((field) => ({ ...field })),
      officialSources: [...definition.officialSources]
    };
  }

  getCapabilities(): PlatformCapabilities { return { ...this.definition.capabilities }; }
  getCredentialSchema(): CredentialField[] { return this.definition.credentials.map((field) => ({ ...field })); }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    return ctx.settings.dryRun === true ? "logged_in" : "needs_user_action";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    return {
      sessionId: `manual-${this.platformKey}-${ctx.accountId}-${Date.now()}`,
      requiresUserAction: true,
      message: `${this.definition.displayName}只能在官方页面完成登录、验证和投稿：${this.definition.manualInstructions}`
    };
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    if (!this.definition.supportsArticle) return { valid: false, errors: [`${this.definition.displayName}当前没有图文发布能力`], warnings: [] };
    return validateArticleInput(article, this.definition.capabilities, this.definition.displayName);
  }

  async validateVideo(video: PublishVideoInput): Promise<ValidationResult> {
    if (!this.definition.supportsVideo) return { valid: false, errors: [`${this.definition.displayName}当前没有视频发布能力`], warnings: [] };
    return validateVideoInput(video, this.definition.capabilities, this.definition.displayName);
  }

  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new ManualAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    if (ctx.settings.dryRun === true) return this.dryRunResult(validation, "article");
    throw new ManualAdapterError("USER_ACTION_REQUIRED", `${this.definition.displayName}未开放可由本系统调用的官方写入 API，请在官方页面人工完成投稿`);
  }

  async publishVideo(ctx: AccountContext, video: PublishVideoInput): Promise<PublishResult> {
    const validation = await this.validateVideo(video);
    if (!validation.valid) throw new ManualAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    if (ctx.settings.dryRun === true) return this.dryRunResult(validation, "video");
    throw new ManualAdapterError("USER_ACTION_REQUIRED", `${this.definition.displayName}未开放可由本系统调用的官方写入 API，请在官方页面人工完成投稿`);
  }

  async getPublishStatus(_ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    if (!externalId.trim()) throw new ManualAdapterError("CONTENT_REJECTED", `${this.definition.displayName}外部作品 ID 不能为空`);
    throw new ManualAdapterError("USER_ACTION_REQUIRED", `${this.definition.displayName}不提供本系统可调用的公开状态回查 API，请人工确认结果`);
  }

  private dryRunResult(validation: ValidationResult, contentKind: "article" | "video"): PublishResult {
    return {
      success: true,
      dryRun: true,
      prepared: true,
      response: { adapter: this.platformKey, manualOnly: true, stage: "validated", contentKind, networkCalls: 0, warnings: validation.warnings }
    };
  }
}
