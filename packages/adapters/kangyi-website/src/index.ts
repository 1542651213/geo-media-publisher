import { ClientError, CmsV2Client, type Capabilities, type ClientConfig, type DeployEnvironment, type Success } from "@publisher/cms-v2-client";
import { PlatformAdapterError, type PlatformAdapter } from "@publisher/adapters-core";
import type { AccountContext, AccountProfile, AdapterManifest, CredentialField, LoginSession, LoginStatus, PlatformCapabilities, PublishArticleInput, PublishResult, ValidationResult } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import { buildKangyiCmsDraft, prepareKangyiWebsiteContent, type KangyiImageFact, type KangyiPreparedContent } from "./mapping";

export * from "./mapping";

export interface KangyiCapabilitiesClient { capabilities(): Promise<Success<Capabilities>> }
export type CmsWebsiteSiteId = "kangyi" | "huiquan" | "shupai";
export interface KangyiWebsiteAdapterOptions { credentialStore?: CredentialStore; clientFactory?: (config: ClientConfig) => KangyiCapabilitiesClient; siteId?: CmsWebsiteSiteId }

const siteProfiles = {
  kangyi: { platformKey: "kangyi_website", displayName: "江苏康一环保科技官网", label: "康一", officialWebsite: "https://www.kangyihb.com/", developerPortal: "https://staging.kangyihb.com/_publish-api/v2/capabilities", verifiedAt: "2026-09-20" },
  huiquan: { platformKey: "huiquan_website", displayName: "苏州汇泉环保科技官网", label: "汇泉", officialWebsite: "", developerPortal: "", verifiedAt: "2026-09-26" },
  shupai: { platformKey: "shupai_website", displayName: "苏州树派环保科技官网", label: "树派", officialWebsite: "", developerPortal: "", verifiedAt: "2026-09-26" }
} as const;

export interface KangyiWebsitePrepareInput {
  article: Parameters<typeof prepareKangyiWebsiteContent>[0]["article"];
  snapshot: Parameters<typeof prepareKangyiWebsiteContent>[0]["snapshot"];
  account: Parameters<typeof prepareKangyiWebsiteContent>[0]["account"];
  kind?: Parameters<typeof prepareKangyiWebsiteContent>[0]["kind"];
  approvedSlug?: string | null;
  imageFacts?: KangyiImageFact[];
}

const credentialSchema: CredentialField[] = [
  { key: "origin", label: "Publishing API Origin", type: "text", required: true, helpText: "填写 HTTPS origin；只填写 scheme、host 和可选端口" },
  { key: "siteId", label: "Site ID", type: "text", required: true, helpText: "必须与当前官网账户的站点身份一致" },
  { key: "environment", label: "Environment", type: "text", required: true, helpText: "当前官网 Adapter 写入仍需通过持久化操作门禁" },
  { key: "keyId", label: "HMAC Key ID", type: "text", required: true, helpText: "例如 staging-editor；secret 只在主进程中使用" },
  { key: "secret", label: "HMAC Secret", type: "secret", required: true, helpText: "通过 GEO SafeStorage 保存，不回显、不进入文章或发布记录" }
];

const capabilities: PlatformCapabilities = { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 200, maxImageCount: 9, maxTagCount: 20, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false };

function textValue(value: string | undefined): string { return typeof value === "string" ? value.trim() : ""; }
function isEnvironment(value: string): value is DeployEnvironment { return value === "local" || value === "staging" || value === "production"; }

export function mapKangyiClientError(error: ClientError): LoginStatus {
  if (["BAD_SIGNATURE", "UNAUTHORIZED", "AUTH_REQUIRED", "REPLAY"].includes(error.code) || error.status === 401) return "expired";
  if (["SCOPE_DENIED", "WRONG_SITE", "WRONG_ENVIRONMENT", "WRITE_DISABLED", "TIMESTAMP_SKEW"].includes(error.code) || error.status === 403) return "needs_user_action";
  if (error.status === 429 || error.code === "RATE_LIMIT") return "needs_user_action";
  if (error.code === "TRANSPORT_ERROR" || error.code === "TRANSPORT_UNCERTAIN") return "unknown";
  return "unknown";
}

export class KangyiWebsiteAdapter implements PlatformAdapter {
  readonly platformKey: string;
  readonly manifest: AdapterManifest;
  readonly siteId: CmsWebsiteSiteId;
  private readonly siteProfile: (typeof siteProfiles)[CmsWebsiteSiteId];
  private readonly credentialStore?: CredentialStore;
  private readonly clientFactory: (config: ClientConfig) => KangyiCapabilitiesClient;

  constructor(options: KangyiWebsiteAdapterOptions = {}) {
    this.siteId = options.siteId ?? "kangyi";
    this.siteProfile = siteProfiles[this.siteId];
    this.platformKey = this.siteProfile.platformKey;
    this.manifest = {
    platformKey: this.platformKey,
    displayName: this.siteProfile.displayName,
    category: "企业官网图文",
    version: "1.0.0",
    adapterStatus: "ready",
    authStrategy: "AppCredential",
    callbackStrategy: "ManualCodeCallback",
    status: "WaitingForUser",
    researchStatus: "verified",
    transport: "official_api",
    integrationMode: "API",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: this.siteProfile.officialWebsite,
    developerPortal: this.siteProfile.developerPortal,
    lastVerifiedAt: this.siteProfile.verifiedAt,
    blockingReason: "官网写入仅允许通过持久化操作门禁；普通 publishArticle 调用保持禁用。",
    credentialSchema,
    officialSources: this.siteProfile.developerPortal ? [this.siteProfile.developerPortal] : ["{origin}/_publish-api/v2/capabilities"]
    };
    this.credentialStore = options.credentialStore;
    this.clientFactory = options.clientFactory ?? ((config) => new CmsV2Client(config));
  }

  getCapabilities(): PlatformCapabilities { return { ...capabilities }; }
  getCredentialSchema(): CredentialField[] { return credentialSchema.map((field) => field.key === "origin" ? { ...field, label: `${this.siteProfile.label} Publishing API Origin` } : { ...field }); }

  prepareContent(input: KangyiWebsitePrepareInput): KangyiPreparedContent {
    if (input.account.siteId !== this.siteId || input.snapshot.platformKey !== this.platformKey) throw new PlatformAdapterError("PERMISSION_DENIED", "官网内容与站点配置不一致", "WRONG_SITE");
    return prepareKangyiWebsiteContent(input);
  }

  bindPreparedMedia(prepared: KangyiPreparedContent, mediaIds?: Record<string, string>) {
    return buildKangyiCmsDraft(prepared, mediaIds);
  }

  async readRemoteCapabilities(ctx: AccountContext): Promise<Capabilities> {
    const config = this.readClientConfig(ctx);
    if (ctx.platformKey !== this.platformKey || config.siteId !== this.siteId) throw new PlatformAdapterError("PERMISSION_DENIED", "官网账户与站点配置不一致", "WRONG_SITE");
    const response = await this.clientFactory(config).capabilities();
    const remote = response.data;
    if (remote.siteId !== config.siteId) throw new PlatformAdapterError("PERMISSION_DENIED", "Publishing API 返回了其它站点", "WRONG_SITE");
    if (remote.environment !== config.environment) throw new PlatformAdapterError("PERMISSION_DENIED", "Publishing API 返回了其它环境", "WRONG_ENVIRONMENT");
    if (remote.protocolVersion !== "2") throw new PlatformAdapterError("API_REVIEW_REQUIRED", "Publishing API 版本不受支持", "PROTOCOL_MISMATCH");
    if (!remote.contentKinds.includes("article") || !remote.contentKinds.includes("case")) throw new PlatformAdapterError("API_REVIEW_REQUIRED", "Publishing API 未声明文章和案例内容类型", "CONTENT_KIND_MISMATCH");
    return remote;
  }

  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    try {
      await this.readRemoteCapabilities(ctx);
      return "logged_in";
    } catch (error) {
      if (error instanceof ClientError) return mapKangyiClientError(error);
      if (error instanceof PlatformAdapterError) return error.code === "AUTH_REQUIRED" ? "logged_out" : "needs_user_action";
      return "unknown";
    }
  }

  async beginLogin(ctx: AccountContext): Promise<LoginSession> {
    const status = await this.checkLogin(ctx);
    return { sessionId: `${this.siteId}-capabilities-${ctx.accountId}-${Date.now()}`, requiresUserAction: status !== "logged_in", opened: false, authStrategy: "AppCredential", callbackStrategy: "ManualCodeCallback", message: status === "logged_in" ? `${this.siteProfile.label}官网 Publishing API capabilities 验证通过` : `请检查${this.siteProfile.label}官网 HMAC credential、siteId 和 environment` };
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const remote = await this.readRemoteCapabilities(ctx);
    const config = this.readClientConfig(ctx);
    const scopes = remote.writesEnabled ? ["read", "write"] : ["read"];
    return { accountId: remote.siteId, accountName: `${this.siteId === "kangyi" ? "Kangyi" : this.siteId === "huiquan" ? "Huiquan" : "Shupai"} website (${remote.environment}; ${config.keyId})`, scopes, authorizationStatus: remote.writesEnabled ? "Authorized" : "Partial" };
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!article.title.trim()) errors.push(`${this.siteProfile.label}官网标题不能为空`);
    if (!article.body.trim()) errors.push(`${this.siteProfile.label}官网正文不能为空`);
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> {
    throw new PlatformAdapterError("API_REVIEW_REQUIRED", `${this.siteProfile.label}官网写入必须经过持久化操作门禁`, "PHASE1_PUBLISH_DISABLED");
  }

  private readClientConfig(ctx: AccountContext): ClientConfig {
    const value = (key: string): string => {
      const contextValue = ctx.secrets?.[key];
      if (typeof contextValue === "string" && contextValue.length > 0) return contextValue;
      try { return this.credentialStore?.get(`account:${ctx.accountId}:${this.platformKey}:${key}`) ?? ""; } catch { return ""; }
    };
    const origin = textValue(value("origin"));
    const siteId = textValue(value("siteId"));
    const environment = textValue(value("environment"));
    const keyId = textValue(value("keyId"));
    const secret = value("secret");
    if (!origin || !siteId || !isEnvironment(environment) || !keyId || !secret) throw new PlatformAdapterError("AUTH_REQUIRED", `${this.siteProfile.label}官网 credential 尚未完整配置`);
    return { origin, siteId, environment, keyId, secret };
  }
}

export default KangyiWebsiteAdapter;
export { KangyiWebsiteAdapter as CmsWebsiteAdapter };
