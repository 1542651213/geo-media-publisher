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

class ContentGateAdapter implements PlatformAdapter {
  readonly platformKey = "zhihu";
  readonly manifest: AdapterManifest = { platformKey: this.platformKey, displayName: "Content gate fixture", category: "test", version: "r69", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "Stable", researchStatus: "verified", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://example.test", credentialSchema: [], officialSources: ["https://example.test"] };
  readonly automationType = "BrowserAutomation" as const;
  readonly checkLogin = vi.fn(async (_ctx: AccountContext): Promise<LoginStatus> => "logged_in");
  readonly validateArticle = vi.fn(async (_article: PublishArticleInput): Promise<ValidationResult> => ({ valid: true, errors: [], warnings: [] }));
  readonly preparePublish = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput): Promise<AutomationPrepareResult> => ({ prepared: true, requiresUserAction: true, message: "prepared", response: {} }));
  readonly publishArticle = vi.fn(async (_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> => ({ success: true, externalId: "fixture", publishedUrl: "https://example.test/fixture", response: {} }));

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

function fixture(input: { title: string; body: string }) {
  const directory = mkdtempSync(join(tmpdir(), "publisher-content-gate-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  database.repository.setSetting("contentReviewMode", "Off");
  const brand = database.repository.createBrand({ name: "Content gate brand", companyName: "Content gate company" });
  const account = database.repository.createAccount({ platformKey: "zhihu", name: "Content gate account", allowAutoPublish: true });
  database.repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in" });
  const article = database.repository.createArticle({ brandId: brand.id, topic: "content gate", keyword: "gate", city: "Nanjing", title: input.title, body: input.body, summary: "", tags: [], seoKeywords: [], articleType: "article", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: randomUUID(), qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("fixture article was not created");
  const job = database.repository.createArticlePublishJob({ articleId: article.id, platformKey: account.platformKey, platformAccountId: account.id, publishMode: "ASSISTED", finalPublishMode: "CONFIRM_BEFORE_PUBLISH" });
  const adapter = new ContentGateAdapter();
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

describe("PublisherService content quality gate", () => {
  it("rejects prepareArticle before browser or adapter work and logs the full gate result", async () => {
    const { publisher, adapter, job, logs } = fixture({ title: "", body: "valid body" });

    await expect(publisher.prepareArticle(job.id)).rejects.toMatchObject({ code: "CONTENT_REJECTED", contentGate: { passed: false, failureCodes: ["TITLE_LENGTH_INVALID"] } });

    expect(adapter.checkLogin).not.toHaveBeenCalled();
    expect(adapter.validateArticle).not.toHaveBeenCalled();
    expect(adapter.preparePublish).not.toHaveBeenCalled();
    expect(logs).toContainEqual(expect.objectContaining({ code: "CONTENT_GATE_FAILED", context: expect.objectContaining({ contentGate: expect.objectContaining({ passed: false, failureCodes: ["TITLE_LENGTH_INVALID"] }) }) }));
  });

  it("allows prepareArticle to preserve its existing adapter behavior when content passes", async () => {
    const { publisher, adapter, job } = fixture({ title: "Valid title", body: "Valid body" });

    await expect(publisher.prepareArticle(job.id)).resolves.toMatchObject({ message: "prepared" });

    expect(adapter.checkLogin).toHaveBeenCalledTimes(1);
    expect(adapter.validateArticle).toHaveBeenCalledTimes(1);
    expect(adapter.preparePublish).toHaveBeenCalledTimes(1);
  });

  it("rejects ordinary executeJob before submission or final-submit work", async () => {
    const { database, publisher, adapter, job } = fixture({ title: "", body: "valid body" });
    database.repository.confirmJob(job.id, true);

    const result = await publisher.executeJob(job.id);

    expect(result.job.status).toBe("Failed");
    expect(result.job.lastErrorCode).toBe("CONTENT_REJECTED");
    expect(adapter.checkLogin).not.toHaveBeenCalled();
    expect(adapter.validateArticle).not.toHaveBeenCalled();
    expect(adapter.publishArticle).not.toHaveBeenCalled();
    expect(database.repository.getSubmissionIntentByJob(job.id)).toBeNull();
  });
});
