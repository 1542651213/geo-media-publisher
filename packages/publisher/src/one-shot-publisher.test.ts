import { boundOneShot } from "../../../tests/fixtures/bound-one-shot";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry, defaultCapabilities, type AutomationPrepareResult, type BrowserPublishAttemptContext, type PlatformAdapter } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { type AccountContext, type AdapterManifest, type LoginSession, type LoginStatus, type PublishArticleInput, type PublishResult, type PublishStatusResult, type ValidationResult, type OneShotPublicationAuthorization } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

class GuardCaptureAdapter implements PlatformAdapter {
  readonly platformKey = "xiaohongshu";
  readonly manifest: AdapterManifest = { platformKey: this.platformKey, displayName: "小红书 Task10S fixture", category: "图文", version: "10S", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "Stable", researchStatus: "verified", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://creator.xiaohongshu.com/", credentialSchema: [], officialSources: ["https://creator.xiaohongshu.com/"] };
  guardSeen: BrowserPublishAttemptContext["oneShotPublicationGuard"];

  getCapabilities() { return { ...defaultCapabilities, imagePost: true, coverImage: false }; }
  getCredentialSchema() { return []; }
  readonly automationType = "BrowserAutomation" as const;
  async connectAccount(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "fixture", requiresUserAction: false }; }
  isConnectionPending(_ctx: AccountContext): boolean { return false; }
  async completeConnection(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async checkSession(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async openBackend(_ctx: AccountContext): Promise<{ opened: boolean; backendUrl: string; sessionIdHash: string }> { return { opened: true, backendUrl: "https://creator.xiaohongshu.com/", sessionIdHash: "fixture" }; }
  async preparePublish(_ctx: AccountContext, _article: PublishArticleInput): Promise<AutomationPrepareResult> { return { prepared: true, requiresUserAction: true, message: "fixture", response: { browserExecutionMode: "VISIBLE", headless: false } }; }
  async verifyPublish(_ctx: AccountContext, _externalId?: string): Promise<PublishStatusResult> { return { status: "published", response: {} }; }
  async logout(_ctx: AccountContext): Promise<void> { return undefined; }
  async checkLogin(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "fixture", requiresUserAction: false }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> { throw new Error("fixture requires finalSubmit"); }
  async finalSubmit(_ctx: AccountContext, _article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    this.guardSeen = attempt.oneShotPublicationGuard;
    attempt.markSubmissionSideEffect?.();
    if (!this.guardSeen) throw Object.assign(new Error("missing one-shot guard"), { code: "FINAL_SUBMIT_PREFLIGHT_FAILED" });
    return { success: true, status: "published", externalId: "note-task10s", publishedUrl: "https://www.xiaohongshu.com/explore/note-task10s", response: { finalSubmitCount: 1, verificationStatus: "Verified" } };
  }
  async verifyPublished(_ctx: AccountContext, _article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> { return { status: "published", externalId: result.externalId, publishedUrl: result.publishedUrl, response: { publicPageVerified: true } }; }
}

function fixture(): { database: ReturnType<typeof openDatabase>; publisher: PublisherService; adapter: GuardCaptureAdapter; jobId: string; authorization: OneShotPublicationAuthorization } {
  const directory = mkdtempSync(join(tmpdir(), "task10s-publisher-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  database.repository.createBrand({ name: "Task10S 企业", companyName: "Task10S 企业" });
  const { job, authorization, subject } = boundOneShot(database.repository);
  const adapter = new GuardCaptureAdapter();
  const registry = new AdapterRegistry(); registry.register(adapter);
  const publisher = new PublisherService(database.repository, registry, createConsoleLogger(), { resolveSecrets: () => ({}), resolveRuntimeIdentityAttestation: () => subject });
  return { database, publisher, adapter, jobId: job.id, authorization };
}

afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("Task10S PublisherService boundary", () => {
  it("rejects adapter-reported success when the explicit one-shot guard was not consumed", async () => {
    const { database, publisher, adapter, jobId, authorization } = fixture();
    const result = await publisher.executeJob(jobId, { userActionId: "task10s-action", triggerSource: "RUN_SELF_TEST" }, "VISIBLE", authorization);
    expect(result.job.status).toBe("NeedsReconciliation");
    expect(adapter.guardSeen?.authorization.state).toBe("AUTHORIZED_UNUSED");
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)?.state).toBe("AUTHORIZED_UNUSED");
    expect(database.repository.getSubmissionIntentByJob(jobId)?.finalSubmitCount).toBe(0);
  });
});
