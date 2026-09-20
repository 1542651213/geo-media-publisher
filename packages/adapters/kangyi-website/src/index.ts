import { ClientError, CmsV2Client, type Capabilities, type ClientConfig, type DeployEnvironment, type Success } from "@publisher/cms-v2-client";
import { PlatformAdapterError, type PlatformAdapter } from "@publisher/adapters-core";
import type { AccountContext, AccountProfile, AdapterManifest, CredentialField, LoginSession, LoginStatus, PlatformCapabilities, PublishArticleInput, PublishResult, ValidationResult } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";

export interface KangyiCapabilitiesClient { capabilities(): Promise<Success<Capabilities>> }
export interface KangyiWebsiteAdapterOptions { credentialStore?: CredentialStore; clientFactory?: (config: ClientConfig) => KangyiCapabilitiesClient }

const credentialSchema: CredentialField[] = [
  { key: "origin", label: "康一 Publishing API Origin", type: "text", required: true, helpText: "例如 https://staging.kangyihb.com；只填写 scheme、host 和可选端口" },
  { key: "siteId", label: "Site ID", type: "text", required: true, helpText: "首期固定使用 kangyi" },
  { key: "environment", label: "Environment", type: "text", required: true, helpText: "staging 或 production；Phase 1 只允许 capabilities 读取" },
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
  readonly platformKey = "kangyi_website";
  readonly manifest: AdapterManifest = {
    platformKey: this.platformKey,
    displayName: "江苏康一环保科技官网",
    category: "企业官网图文",
    version: "1.0.0",
    adapterStatus: "ready",
    authStrategy: "AppCredential",
    callbackStrategy: "ManualCodeCallback",
    status: "Stable",
    researchStatus: "verified",
    transport: "official_api",
    integrationMode: "API",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "https://www.kangyihb.com/",
    developerPortal: "https://staging.kangyihb.com/_publish-api/v2/capabilities",
    lastVerifiedAt: "2026-09-20",
    blockingReason: "Phase 1 只允许 signed capabilities GET；media、create、draft、validate、publish 在 Phase 2 前 fail-closed。",
    credentialSchema,
    officialSources: ["https://staging.kangyihb.com/_publish-api/v2/capabilities"]
  };
  private readonly credentialStore?: CredentialStore;
  private readonly clientFactory: (config: ClientConfig) => KangyiCapabilitiesClient;

  constructor(options: KangyiWebsiteAdapterOptions = {}) {
    this.credentialStore = options.credentialStore;
    this.clientFactory = options.clientFactory ?? ((config) => new CmsV2Client(config));
  }

  getCapabilities(): PlatformCapabilities { return { ...capabilities }; }
  getCredentialSchema(): CredentialField[] { return credentialSchema.map((field) => ({ ...field })); }

  async readRemoteCapabilities(ctx: AccountContext): Promise<Capabilities> {
    const config = this.readClientConfig(ctx);
    const response = await this.clientFactory(config).capabilities();
    const remote = response.data;
    if (remote.siteId !== config.siteId) throw new PlatformAdapterError("PERMISSION_DENIED", "Kangyi capabilities returned a different site", "WRONG_SITE");
    if (remote.environment !== config.environment) throw new PlatformAdapterError("PERMISSION_DENIED", "Kangyi capabilities returned a different environment", "WRONG_ENVIRONMENT");
    if (remote.protocolVersion !== "2") throw new PlatformAdapterError("API_REVIEW_REQUIRED", "Kangyi Publishing API protocol version is not supported", "PROTOCOL_MISMATCH");
    if (!remote.contentKinds.includes("article") || !remote.contentKinds.includes("case")) throw new PlatformAdapterError("API_REVIEW_REQUIRED", "Kangyi capabilities do not declare article and case content kinds", "CONTENT_KIND_MISMATCH");
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
    return { sessionId: `kangyi-capabilities-${ctx.accountId}-${Date.now()}`, requiresUserAction: status !== "logged_in", opened: false, authStrategy: "AppCredential", callbackStrategy: "ManualCodeCallback", message: status === "logged_in" ? "康一官网 Publishing API capabilities 验证通过" : "请检查康一官网 HMAC credential、siteId 和 environment" };
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const remote = await this.readRemoteCapabilities(ctx);
    const config = this.readClientConfig(ctx);
    const scopes = remote.writesEnabled ? ["read", "write"] : ["read"];
    return { accountId: remote.siteId, accountName: `Kangyi website (${remote.environment}; ${config.keyId})`, scopes, authorizationStatus: remote.writesEnabled ? "Authorized" : "Partial" };
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!article.title.trim()) errors.push("康一官网标题不能为空");
    if (!article.body.trim()) errors.push("康一官网正文不能为空");
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> {
    throw new PlatformAdapterError("API_REVIEW_REQUIRED", "康一官网写入在 Phase 1 被显式禁用；需要 Phase 2 授权", "PHASE1_PUBLISH_DISABLED");
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
    if (!origin || !siteId || !isEnvironment(environment) || !keyId || !secret) throw new PlatformAdapterError("AUTH_REQUIRED", "康一官网 credential 尚未完整配置");
    return { origin, siteId, environment, keyId, secret };
  }
}

export default KangyiWebsiteAdapter;
