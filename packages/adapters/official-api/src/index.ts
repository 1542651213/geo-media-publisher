import { z } from "zod";
import { PlatformAdapterError, type PlatformAdapter } from "@publisher/adapters-core";
import type { AccountContext, AdapterManifest, CredentialField, LoginStatus, PublishArticleInput, ValidationResult } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import { ClientError, CmsV2Client, type Capabilities, type ClientConfig } from "../../../cms-v2-client/src";

export type WebsiteEnvironment = "staging" | "production";
export const KANGYI_SITE_CONFIG = { siteId: "kangyi", brand: "江苏康一环保科技有限公司",
  origins: { staging: "https://staging.kangyihb.com", production: "https://xn--4gq502b.com" } } as const;

const credentialSchema = z.strictObject({ origin: z.string().max(200), siteId: z.literal("kangyi"),
  environment: z.enum(["staging", "production"]), keyId: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/u), secret: z.string().min(1).max(8192) });
export type OfficialApiCredential = z.infer<typeof credentialSchema>;

/** Main-only input; no secret value is returned through the application bridge. */
export function parseOfficialApiCredential(raw: string, expectedEnvironment: WebsiteEnvironment): OfficialApiCredential {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("WEBSITE_CREDENTIAL_FILE_INVALID"); }
  const parsed = credentialSchema.safeParse(value);
  if (!parsed.success) throw new Error("WEBSITE_CREDENTIAL_FILE_INVALID");
  const config = parsed.data;
  if (config.environment !== expectedEnvironment || config.origin !== KANGYI_SITE_CONFIG.origins[expectedEnvironment])
    throw new Error("WEBSITE_ENVIRONMENT_OR_ORIGIN_MISMATCH");
  if (Buffer.byteLength(config.secret, "utf8") < 32) throw new Error("WEBSITE_CREDENTIAL_FILE_INVALID");
  return config;
}

const capabilitySchema = z.object({ siteId: z.string(), environment: z.enum(["local", "staging", "production"]),
  protocolVersion: z.literal("2"), contentKinds: z.array(z.enum(["article", "case"])), writesEnabled: z.boolean(),
  limits: z.object({ jsonBytes: z.number().int().positive().max(1048576), mediaBytes: z.number().int().positive().max(8388608),
    imagePixels: z.number().int().positive().max(40000000), imageDimension: z.number().int().positive().max(10000) }) });
export function assertOfficialApiCapabilities(config: Pick<OfficialApiCredential, "siteId" | "environment">, value: unknown): Capabilities {
  const remote = capabilitySchema.safeParse(value);
  if (!remote.success) throw new Error("WEBSITE_CAPABILITY_MISMATCH");
  if (remote.data.siteId !== config.siteId) throw new Error("WEBSITE_SITE_MISMATCH");
  if (remote.data.environment !== config.environment) throw new Error("WEBSITE_ENVIRONMENT_MISMATCH");
  if (!remote.data.contentKinds.includes("article") || !remote.data.contentKinds.includes("case")) throw new Error("WEBSITE_CONTENT_KIND_MISMATCH");
  return remote.data;
}

export const officialApiCredentialFields: CredentialField[] = [
  { key: "origin", label: "官网地址", type: "text", required: true },
  { key: "siteId", label: "站点标识", type: "text", required: true },
  { key: "environment", label: "环境", type: "text", required: true },
  { key: "keyId", label: "签名凭据编号", type: "text", required: true },
  { key: "secret", label: "签名密钥", type: "secret", required: true }
];
export function officialApiCredentialRef(accountId: string, field: string): string { return `account:${accountId}:website:${field}`; }
export function readOfficialApiCredential(credentials: CredentialStore, accountId: string): OfficialApiCredential {
  const values = Object.fromEntries(officialApiCredentialFields.map(field => [field.key, credentials.get(officialApiCredentialRef(accountId, field.key))]));
  if (officialApiCredentialFields.some(field => !values[field.key])) throw new Error("WEBSITE_CREDENTIAL_MISSING");
  const environment = values.environment;
  if (environment !== "staging" && environment !== "production") throw new Error("WEBSITE_ENVIRONMENT_MISMATCH");
  return parseOfficialApiCredential(JSON.stringify(values), environment);
}

/** Reuses the archived CMS V2 connection contract; publishing stays closed until live acceptance. */
export class OfficialApiAdapter implements PlatformAdapter {
  readonly platformKey = "website";
  readonly manifest: AdapterManifest = { platformKey: "website", displayName: "官网", category: "企业官网图文", version: "2.0.0",
    adapterStatus: "ready", authStrategy: "AppCredential", callbackStrategy: "ManualCodeCallback", status: "WaitingForUser",
    researchStatus: "verified", transport: "official_api", integrationMode: "API", supportsArticle: true, supportsVideo: false,
    officialWebsite: KANGYI_SITE_CONFIG.origins.production, developerPortal: `${KANGYI_SITE_CONFIG.origins.staging}/_publish-api/v2/capabilities`,
    lastVerifiedAt: "2026-09-30", blockingReason: "官网 OfficialAPI 尚待 staging、production 和普通 UI 验收。",
    credentialSchema: officialApiCredentialFields, officialSources: ["https://staging.kangyihb.com/_publish-api/v2/health", "https://xn--4gq502b.com/_publish-api/v2/health"] };
  constructor(private readonly credentials?: CredentialStore,
    private readonly clientFactory: (config: ClientConfig) => Pick<CmsV2Client, "health" | "capabilities"> = config => new CmsV2Client({ ...config, maxRetries: 0 })) {}
  getCapabilities() { return { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: true,
    scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 200, maxImageCount: 20, maxTagCount: 20 }; }
  getCredentialSchema() { return officialApiCredentialFields.map(field => ({ ...field })); }
  async inspect(config: OfficialApiCredential) {
    const client = this.clientFactory({ ...config, maxRetries: 0 });
    const health = await client.health();
    if (health.httpStatus !== 200 || health.data.status !== "ok" || health.data.protocolVersion !== "2") throw new Error("WEBSITE_HEALTH_FAILED");
    const remote = await client.capabilities();
    if (remote.httpStatus !== 200) throw new Error("WEBSITE_CAPABILITY_MISMATCH");
    return assertOfficialApiCapabilities(config, remote.data);
  }
  async readRemoteCapabilities(ctx: AccountContext) {
    if (ctx.platformKey !== "website" || !this.credentials) throw new Error("WEBSITE_ACCOUNT_SCOPE_REQUIRED");
    return this.inspect(readOfficialApiCredential(this.credentials, ctx.accountId));
  }
  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    try { await this.readRemoteCapabilities(ctx); return "logged_in"; }
    catch (error) { return error instanceof ClientError && [401, 403].includes(error.status) ? "expired" : "unknown"; }
  }
  async beginLogin(ctx: AccountContext) {
    const status = await this.checkLogin(ctx);
    return { sessionId: `website-capability-${ctx.accountId}`, requiresUserAction: status !== "logged_in", opened: false,
      authStrategy: "AppCredential" as const, callbackStrategy: "ManualCodeCallback" as const,
      message: status === "logged_in" ? "官网 API 连接正常；发布能力仍待独立验收。" : "请在账号中心安全导入官网凭据文件。" };
  }
  async getAccountProfile(ctx: AccountContext) {
    const remote = await this.readRemoteCapabilities(ctx);
    return { accountId: `${remote.siteId}:${remote.environment}`, accountName: `康一官网 · ${remote.environment} · OfficialAPI`,
      scopes: remote.writesEnabled ? ["read", "write"] : ["read"], authorizationStatus: remote.writesEnabled ? "Authorized" as const : "Partial" as const };
  }
  async validateArticle(input: PublishArticleInput): Promise<ValidationResult> {
    const errors = [];
    if (!input.title.trim() || input.title.length > 200) errors.push("官网标题须为1至200字符");
    if (!input.body.trim()) errors.push("官网正文不能为空");
    return { valid: errors.length === 0, errors, warnings: [] };
  }
  assertFormalSubmitAvailable(): never { throw new PlatformAdapterError("API_REVIEW_REQUIRED", "WEBSITE_ACCEPTANCE_REQUIRED"); }
  async publishArticle(_ctx: AccountContext, _input: PublishArticleInput): Promise<never> { return this.assertFormalSubmitAvailable(); }
}
