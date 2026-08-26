import { execFile } from "node:child_process";
import type { AccountContext, AdapterManifest, CredentialField, ErrorCode, LoginSession, LoginStatus, PlatformCapabilities, PublishArticleInput, PublishResult, PublishStatusResult, ValidationResult } from "@publisher/domain";
import { PlatformAdapterError, type PlatformAdapter } from "@publisher/adapters-core";

export interface WeiboCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WeiboCliRunner {
  run(file: string, args: string[]): Promise<WeiboCliResult>;
}

export interface WeiboPublishedValue {
  externalId: string;
  publishedUrl?: string;
}

export interface WeiboStatusValue {
  status: PublishStatusResult["status"];
  publishedUrl?: string;
  errorMessage?: string;
}

/**
 * The official Weibo CLI documents authentication and capability areas, but
 * does not publish a stable command-line argument contract in the public page.
 * Callers must inject the reviewed command contract before real publishing.
 */
export interface WeiboCliContract {
  authArgs: string[];
  publishArticleArgs(input: PublishArticleInput): string[];
  parsePublish(result: WeiboCliResult): WeiboPublishedValue | null;
  statusArgs(externalId: string): string[];
  parseStatus(result: WeiboCliResult): WeiboStatusValue | null;
}

export interface WeiboAdapterOptions {
  cliPath?: string;
  runner?: WeiboCliRunner;
  contract?: WeiboCliContract;
}

const credentials: CredentialField[] = [
  { key: "cliPath", label: "微博官方 CLI 路径", type: "text", required: false, helpText: "默认使用 PATH 中的 weibo 命令" },
  { key: "profile", label: "微博 CLI profile", type: "text", required: false }
];

const capabilities: PlatformCapabilities = {
  article: true,
  imagePost: true,
  video: false,
  coverImage: true,
  tags: true,
  categories: false,
  scheduledPublish: false,
  draft: false,
  markdown: false,
  richText: true,
  maxTitleLength: 200,
  maxImageCount: 9,
  maxTagCount: 10,
  supportsVideoCover: false,
  supportsVideoTags: false,
  videoPublishAsync: false
};

export function mapWeiboError(message: string, exitCode?: number): ErrorCode {
  const normalized = message.toLowerCase();
  if (/login|auth|token|未登录|授权/u.test(normalized)) return "LOGIN_EXPIRED";
  if (/permission|forbidden|scope|权限|资质/u.test(normalized)) return "PERMISSION_DENIED";
  if (/rate|quota|限流|配额/u.test(normalized)) return "RATE_LIMITED";
  if (/captcha|human verification|security verification|验证码|人机|安全验证/u.test(normalized)) return "USER_ACTION_REQUIRED";
  if (/title|content|image|正文|标题|图片/u.test(normalized)) return "CONTENT_REJECTED";
  if (exitCode !== undefined && exitCode !== 0) return "NETWORK_ERROR";
  return "API_REVIEW_REQUIRED";
}

export class WeiboAdapterError extends PlatformAdapterError {
  constructor(code: ErrorCode, message: string, providerCode?: string) {
    super(code, message, providerCode);
    this.name = "WeiboAdapterError";
  }
}

const defaultRunner: WeiboCliRunner = {
  run(file, args) {
    return new Promise((resolve) => {
      execFile(file, args, { windowsHide: true, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        resolve({ exitCode: code, stdout, stderr });
      });
    });
  }
};

export class WeiboAdapter implements PlatformAdapter {
  readonly platformKey = "weibo";
  readonly manifest: AdapterManifest = {
    platformKey: "weibo",
    displayName: "新浪微博",
    category: "内容/社交",
    version: "0.5.1",
    adapterStatus: "degraded",
    authStrategy: "ManualOnly",
    callbackStrategy: "ManualCodeCallback",
    status: "WaitingForUser",
    researchStatus: "verified",
    transport: "official_sdk",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "https://weibo.com/",
    developerPortal: "https://open.weibo.com/cli",
    lastVerifiedAt: "2026-08-20",
    blockingReason: "官方 CLI 已公开发布能力，但公开页面没有稳定的发布/状态命令参数合同；需用户安装、登录并注入已审阅 CLI contract",
    credentialSchema: credentials,
    officialSources: ["https://open.weibo.com/cli"]
  };

  private readonly cliPath: string;
  private readonly runner: WeiboCliRunner;
  private readonly contract: WeiboCliContract | undefined;

  constructor(options: WeiboAdapterOptions = {}) {
    this.cliPath = options.cliPath ?? "weibo";
    this.runner = options.runner ?? defaultRunner;
    this.contract = options.contract;
  }

  getCapabilities(): PlatformCapabilities { return { ...capabilities }; }
  getCredentialSchema(): CredentialField[] { return credentials.map((field) => ({ ...field })); }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    if (ctx.settings.dryRun === true) return "logged_in";
    const contract = this.contract;
    if (!contract) return "needs_user_action";
    const result = await this.runner.run(this.cliPath, contract.authArgs);
    if (result.exitCode === 0) return "logged_in";
    if (mapWeiboError(`${result.stderr}\n${result.stdout}`, result.exitCode) === "LOGIN_EXPIRED") return "expired";
    return "needs_user_action";
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    return {
      sessionId: `weibo-cli-${ctx.accountId}-${Date.now()}`,
      requiresUserAction: true,
      message: "请按微博官方 CLI 页面完成安装和登录；验证码、安全验证和授权必须由用户在官方流程完成。完成后再由管理员注入已审阅的命令 contract。"
    };
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!article.title.trim()) errors.push("微博标题不能为空");
    if (!article.body.trim()) errors.push("微博正文不能为空");
    if (article.title.length > capabilities.maxTitleLength) errors.push("微博标题不能超过 200 个字符");
    if ((article.images?.length ?? 0) > capabilities.maxImageCount) errors.push("微博图片数量不能超过 9 张");
    if (article.tags.length > (capabilities.maxTagCount ?? 10)) errors.push("微博话题数量不能超过 10 个");
    if (article.coverPath && (article.images?.length ?? 0) === 0) warnings.push("微博图文发布需要把封面作为图片素材传给 CLI contract");
    return { valid: errors.length === 0, errors, warnings };
  }

  async validateVideo(_video: Parameters<NonNullable<PlatformAdapter["publishVideo"]>>[1]): Promise<ValidationResult> {
    return { valid: false, errors: ["微博 Adapter 当前只实现官方 CLI 图文/长博文能力，未确认视频发布合同"], warnings: [] };
  }

  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new WeiboAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    if (ctx.settings.dryRun === true) return { success: true, dryRun: true, prepared: true, response: { adapter: this.platformKey, stage: "validated", networkCalls: 0, officialCli: true } };
    if (!this.contract) throw new WeiboAdapterError("API_REVIEW_REQUIRED", "微博官方 CLI 发布命令 contract 尚未完成复核，拒绝猜测命令或执行不可审计发布");
    const result = await this.runner.run(this.cliPath, this.contract.publishArticleArgs(article));
    if (result.exitCode !== 0) throw new WeiboAdapterError(mapWeiboError(`${result.stderr}\n${result.stdout}`, result.exitCode), result.stderr || "微博 CLI 发布失败", String(result.exitCode));
    const published = this.contract.parsePublish(result);
    if (!published?.externalId) throw new WeiboAdapterError("API_REVIEW_REQUIRED", "微博 CLI 发布响应缺少可审计的 external ID");
    return { success: true, status: "published", externalId: published.externalId, ...(published.publishedUrl ? { publishedUrl: published.publishedUrl } : {}), response: { adapter: this.platformKey, transport: "official_cli", exitCode: result.exitCode } };
  }

  async getPublishStatus(_ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    if (!externalId.trim()) throw new WeiboAdapterError("CONTENT_REJECTED", "微博 external ID 不能为空");
    if (!this.contract) throw new WeiboAdapterError("API_REVIEW_REQUIRED", "微博官方 CLI 状态回查命令 contract 尚未完成复核");
    const result = await this.runner.run(this.cliPath, this.contract.statusArgs(externalId));
    if (result.exitCode !== 0) throw new WeiboAdapterError(mapWeiboError(`${result.stderr}\n${result.stdout}`, result.exitCode), result.stderr || "微博 CLI 状态回查失败", String(result.exitCode));
    const status = this.contract.parseStatus(result);
    if (!status) throw new WeiboAdapterError("API_REVIEW_REQUIRED", "微博 CLI 状态响应缺少可审计的状态字段");
    return { status: status.status, externalId, ...(status.publishedUrl ? { publishedUrl: status.publishedUrl } : {}), ...(status.errorMessage ? { errorMessage: status.errorMessage, errorCode: "CONTENT_REJECTED" } : {}), response: { adapter: this.platformKey, transport: "official_cli", exitCode: result.exitCode } };
  }
}

export const WeiboOfficialAdapter = WeiboAdapter;
export default WeiboAdapter;
