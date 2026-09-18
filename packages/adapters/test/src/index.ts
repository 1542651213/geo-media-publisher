import { randomUUID } from "node:crypto";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, ValidationResult } from "@publisher/domain";
import { defaultCapabilities, type PlatformAdapter } from "@publisher/adapters-core";

export type TestAdapterMode = "success" | "network_error" | "login_expired" | "user_action" | "permanent_failure";

export class TestPlatformAdapter implements PlatformAdapter {
  readonly platformKey = "test";
  readonly manifest: AdapterManifest = {
    platformKey: "test",
    displayName: "TestPlatform",
    category: "测试",
    version: "0.4.0",
    adapterStatus: "ready",
    authStrategy: "AppCredential",
    callbackStrategy: "ManualCodeCallback",
    status: "Stable",
    researchStatus: "verified",
    transport: "manual",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "test://platform",
    lastVerifiedAt: "2026-08-20",
    credentialSchema: [],
    officialSources: ["test://platform"]
  };
  private mode: TestAdapterMode;

  constructor(mode: TestAdapterMode = "success") {
    this.mode = mode;
  }

  setMode(mode: TestAdapterMode): void {
    this.mode = mode;
  }

  getCapabilities() {
    return { ...defaultCapabilities, scheduledPublish: true };
  }

  getCredentialSchema() { return [...this.manifest.credentialSchema]; }

  async checkLogin(_ctx: AccountContext): Promise<LoginStatus> {
    if (this.mode === "login_expired") return "expired";
    if (this.mode === "user_action") return "needs_user_action";
    return "logged_in";
  }

  async beginLogin(_ctx: AccountContext): Promise<LoginSession> {
    return { sessionId: randomUUID(), requiresUserAction: true, message: "请在测试平台窗口完成正常登录验证" };
  }

  async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors = article.title.trim() ? [] : ["标题不能为空"];
    return { valid: errors.length === 0, errors, warnings: article.body.length < 80 ? ["正文较短"] : [] };
  }

  async publishArticle(_ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    if (this.mode === "network_error") throw new AdapterError("NETWORK_ERROR", "模拟网络异常");
    if (this.mode === "login_expired") throw new AdapterError("LOGIN_EXPIRED", "模拟登录失效");
    if (this.mode === "user_action") throw new AdapterError("USER_ACTION_REQUIRED", "模拟需要用户完成安全验证");
    if (this.mode === "permanent_failure") throw new AdapterError("CONTENT_REJECTED", "模拟内容被平台拒绝");
    return {
      success: true,
      externalId: `test-${randomUUID()}`,
      publishedUrl: `test://published/${article.articleId}`,
      response: { adapter: this.platformKey, simulated: true }
    };
  }
}

export class AdapterError extends Error {
  readonly code;

  constructor(code: "NETWORK_ERROR" | "LOGIN_EXPIRED" | "USER_ACTION_REQUIRED" | "CONTENT_REJECTED", message: string) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
  }
}
