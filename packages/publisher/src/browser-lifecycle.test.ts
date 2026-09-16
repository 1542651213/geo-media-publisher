import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type AutomationPrepareResult, type PlatformAdapter } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, PublishStatusResult, ValidationResult } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { PublisherService } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close(): void }> = [];

class ScopedBrowserAdapter implements PlatformAdapter {
  readonly platformKey = "zhihu";
  readonly manifest: AdapterManifest = { platformKey: this.platformKey, displayName: "Publisher browser lifecycle fixture", category: "test", version: "r69", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "Stable", researchStatus: "verified", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://example.test", credentialSchema: [], officialSources: ["https://example.test"] };
  readonly automationType = "BrowserAutomation" as const;
  readonly events: string[] = [];
  prepareError: Error | null = null;
  beforeScopeEnd: (() => void) | null = null;
  readonly releaseOperationSession = vi.fn(async (_ctx: AccountContext) => undefined);
  readonly checkLogin = vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => { this.events.push("check-login"); return "logged_in"; });
  readonly validateArticle = vi.fn(async (_article: PublishArticleInput): Promise<ValidationResult> => { this.events.push("validate"); return { valid: true, errors: [], warnings: [] }; });
  readonly preparePublish = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput): Promise<AutomationPrepareResult> => {
    this.events.push("prepare");
    if (this.prepareError) throw this.prepareError;
    return { prepared: true, requiresUserAction: true, message: "prepared", response: {} };
  });
  readonly publishArticle = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> => {
    this.events.push("publish");
    return { success: true, status: "published", externalId: "fixture", publishedUrl: "https://example.test/fixture", response: {} };
  });
  readonly runWithBrowserSession = vi.fn(async <T>(_ctx: AccountContext, operation: string, task: () => Promise<T>, options?: { retainSession?: boolean }): Promise<T> => {
    this.events.push(`scope-start:${operation}`);
    try { return await task(); }
    finally {
      this.beforeScopeEnd?.();
      if (options?.retainSession === true) this.events.push(`scope-retained:${operation}`);
      this.events.push(`scope-end:${operation}`);
    }
  });

  getCapabilities() { return { ...defaultCapabilities, imagePost: false, coverImage: false }; }
  getCredentialSchema() { return []; }
  async connectAccount(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "fixture", requiresUserAction: false }; }
  isConnectionPending(_ctx: AccountContext): boolean { return false; }
  async completeConnection(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async checkSession(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async openBackend(_ctx: AccountContext): Promise<{ opened: boolean; backendUrl: string; sessionIdHash: string }> { return { opened: true, backendUrl: "https://example.test", sessionIdHash: "fixture" }; }
  async verifyPublish(_ctx: AccountContext, _externalId?: string): Promise<PublishStatusResult> { return { status: "published", response: {} }; }
  async logout(_ctx: AccountContext): Promise<void> { return undefined; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "fixture", requiresUserAction: false }; }
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "publisher-browser-lifecycle-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  database.repository.setSetting("contentReviewMode", "Off");
  const brand = database.repository.createBrand({ name: "Lifecycle brand", companyName: "Lifecycle company" });
  const account = database.repository.createAccount({ platformKey: "zhihu", name: "Lifecycle account", allowAutoPublish: true });
  database.repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in" });
  const article = database.repository.createArticle({ brandId: brand.id, topic: "lifecycle", keyword: "lifecycle", city: "Nanjing", title: "Valid title", body: "Valid body", summary: "", tags: [], seoKeywords: [], articleType: "article", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: randomUUID(), qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("fixture article was not created");
  const job = database.repository.createArticlePublishJob({ articleId: article.id, platformKey: account.platformKey, platformAccountId: account.id, publishMode: "ASSISTED", finalPublishMode: "CONFIRM_BEFORE_PUBLISH" });
  const adapter = new ScopedBrowserAdapter();
  const registry = new AdapterRegistry();
  registry.register(adapter);
  const logs: Array<{ code: string; context?: Record<string, unknown> }> = [];
  const logger: Logger = {
    info: (_module, code, _message, context) => logs.push({ code, context }),
    warn: (_module, code, _message, context) => logs.push({ code, context }),
    error: (_module, code, _message, context) => logs.push({ code, context })
  };
  return { database, publisher: new PublisherService(database.repository, registry, logger), adapter, job, logs };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("PublisherService scoped browser lifecycle", () => {
  it("runs assisted preparation inside one adapter-owned browser scope without double release", async () => {
    const { database, publisher, adapter, job } = fixture();
    adapter.beforeScopeEnd = () => expect(database.repository.getPublishRecordByJob(job.id)).toBeNull();

    await expect(publisher.prepareArticle(job.id)).resolves.toMatchObject({ message: "prepared" });

    expect(adapter.runWithBrowserSession).toHaveBeenCalledTimes(1);
    expect(adapter.runWithBrowserSession).toHaveBeenCalledWith(expect.anything(), "PublisherService.prepareArticle", expect.any(Function), { retainSession: true });
    expect(adapter.releaseOperationSession).not.toHaveBeenCalled();
    expect(adapter.events).toEqual([
      "scope-start:PublisherService.prepareArticle",
      "check-login",
      "validate",
      "prepare",
      "scope-retained:PublisherService.prepareArticle",
      "scope-end:PublisherService.prepareArticle"
    ]);
    expect(database.repository.getPublishRecordByJob(job.id)?.status).toBe("Prepared");
  });

  it("preserves the original operation error and logs sanitized lifecycle diagnostics", async () => {
    const { publisher, adapter, job, logs } = fixture();
    const failure = Object.assign(new Error("browser crashed with private details"), { code: "USER_ACTION_REQUIRED" });
    adapter.prepareError = failure;

    await expect(publisher.prepareArticle(job.id)).rejects.toBe(failure);

    expect(adapter.events.at(-1)).toBe("scope-end:PublisherService.prepareArticle");
    expect(logs).toContainEqual(expect.objectContaining({
      code: "BROWSER_SESSION_OPERATION_FAILED",
      context: expect.objectContaining({ operation: "PublisherService.prepareArticle", errorCode: "USER_ACTION_REQUIRED" })
    }));
    expect(JSON.stringify(logs)).not.toContain("private details");
  });

  it("surfaces fallback cleanup failure after a successful operation and logs sanitized diagnostics", async () => {
    const { publisher, adapter, job, logs } = fixture();
    Object.defineProperty(adapter, "runWithBrowserSession", { value: undefined });
    const cleanupFailure = Object.assign(new Error("cleanup leaked private path"), { code: "PLATFORM_CHANGED" });
    adapter.releaseOperationSession.mockRejectedValueOnce(cleanupFailure);

    await expect(publisher.prepareArticle(job.id)).rejects.toBe(cleanupFailure);

    expect(logs).toContainEqual(expect.objectContaining({
      code: "BROWSER_SESSION_CLEANUP_FAILED",
      context: expect.objectContaining({ operation: "PublisherService.prepareArticle", errorCode: "PLATFORM_CHANGED" })
    }));
    expect(JSON.stringify(logs)).not.toContain("private path");
  });

  it("preserves an operation error when fallback cleanup also rejects", async () => {
    const { publisher, adapter, job, logs } = fixture();
    Object.defineProperty(adapter, "runWithBrowserSession", { value: undefined });
    const operationFailure = Object.assign(new Error("operation private details"), { code: "CONTENT_REJECTED" });
    adapter.prepareError = operationFailure;
    adapter.releaseOperationSession.mockRejectedValueOnce(Object.assign(new Error("cleanup private details"), { code: "PLATFORM_CHANGED" }));

    await expect(publisher.prepareArticle(job.id)).rejects.toBe(operationFailure);

    expect(logs.map(({ code }) => code)).toEqual(expect.arrayContaining(["BROWSER_SESSION_OPERATION_FAILED", "BROWSER_SESSION_CLEANUP_FAILED"]));
    expect(JSON.stringify(logs)).not.toContain("private details");
  });

  it("runs an ordinary article publish in one adapter-owned browser scope", async () => {
    const { database, publisher, adapter, job } = fixture();
    database.repository.confirmJob(job.id, false);

    const result = await publisher.executeJob(job.id);

    expect(result.job.status).toBe("Success");
    expect(adapter.runWithBrowserSession).toHaveBeenCalledTimes(1);
    expect(adapter.runWithBrowserSession).toHaveBeenCalledWith(expect.anything(), "PublisherService.executeJob", expect.any(Function));
    expect(adapter.releaseOperationSession).not.toHaveBeenCalled();
    expect(adapter.events).toEqual([
      "scope-start:PublisherService.executeJob",
      "check-login",
      "validate",
      "publish",
      "scope-end:PublisherService.executeJob"
    ]);
  });
});
