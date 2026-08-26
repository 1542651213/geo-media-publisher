import type { AccountContext, AdapterManifest, CredentialField, LoginSession, LoginStatus, PlatformCapabilities, PublishArticleInput, PublishResult, ValidationResult } from "@publisher/domain";
import { PlatformAdapterError, type PlatformAdapter } from "@publisher/adapters-core";

export interface SemiAutoAdapterDefinition {
  platformKey: string;
  displayName: string;
  category: string;
  officialWebsite: string;
  officialSources: string[];
  capabilities: PlatformCapabilities;
  blockingReason: string;
}

/** Preparation-only adapter: it never claims that a final human click happened. */
export class SemiAutoAdapter implements PlatformAdapter {
  readonly platformKey: string;
  readonly manifest: AdapterManifest;
  constructor(private readonly definition: SemiAutoAdapterDefinition) {
    this.platformKey = definition.platformKey;
    this.manifest = {
      platformKey: definition.platformKey,
      displayName: definition.displayName,
      category: definition.category,
      version: "1.0.0",
      adapterStatus: "ready",
      authStrategy: "ManualOnly",
      callbackStrategy: "ManualCodeCallback",
      status: "WaitingForUser",
      researchStatus: "partial",
      transport: "semi_auto",
      integrationMode: "SemiAuto",
      supportsArticle: definition.capabilities.article,
      supportsVideo: definition.capabilities.video,
      officialWebsite: definition.officialWebsite,
      blockingReason: definition.blockingReason,
      credentialSchema: [],
      officialSources: [...definition.officialSources]
    };
  }
  getCapabilities(): PlatformCapabilities { return { ...this.definition.capabilities }; }
  getCredentialSchema(): CredentialField[] { return []; }
  async checkLogin(_ctx: AccountContext): Promise<LoginStatus> { return "needs_user_action"; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: `semi-auto-${this.platformKey}-${Date.now()}`, requiresUserAction: true, message: `${this.definition.displayName}需要用户在官方页面完成登录和最终确认。` }; }
  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> { return { valid: Boolean(article.title.trim() && article.body.trim()), errors: article.title.trim() && article.body.trim() ? [] : ["标题和正文不能为空"], warnings: [] }; }
  async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new PlatformAdapterError("CONTENT_REJECTED", validation.errors.join("；"));
    if (ctx.settings.dryRun === true) return { success: true, dryRun: true, prepared: true, response: { adapter: this.platformKey, stage: "prepared", finalSubmit: "user_action_required" } };
    throw new PlatformAdapterError("USER_ACTION_REQUIRED", `${this.definition.displayName}等待用户在官方页面完成最终提交`);
  }
}
