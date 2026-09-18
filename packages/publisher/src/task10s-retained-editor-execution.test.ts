import { boundOneShot } from "../../../tests/fixtures/bound-one-shot";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type AutomationPrepareResult, type BrowserPublishAttemptContext, type PlatformAdapter } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { type AccountContext, type AdapterManifest, type LoginSession, type LoginStatus, type OneShotPublicationAuthorization, type PublishArticleInput, type PublishResult, type PublishStatusResult, type ValidationResult } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { PublisherService } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];

class RetainedEditorAdapter implements PlatformAdapter {
  readonly supportsBoundImageBuffers = true;
  readonly platformKey = "xiaohongshu";
  readonly manifest: AdapterManifest = { platformKey: this.platformKey, displayName: "小红书 Task10S retained-editor fixture", category: "图文", version: "10S", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "Stable", researchStatus: "verified", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://creator.xiaohongshu.com/", credentialSchema: [], officialSources: ["https://creator.xiaohongshu.com/"] };
  guardSeen: BrowserPublishAttemptContext["oneShotPublicationGuard"];
  retainedEditorMarkerSeen: boolean | undefined;
  finalSubmitCount = 0;
  readonly runWithBrowserSession = vi.fn(async <T>(_ctx: AccountContext, _operation: string, task: () => Promise<T>): Promise<T> => task());

  getCapabilities() { return { ...defaultCapabilities, imagePost: true, coverImage: false }; }
  getCredentialSchema() { return []; }
  readonly automationType = "BrowserAutomation" as const;
  async connectAccount(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "fixture", requiresUserAction: false }; }
  isConnectionPending(_ctx: AccountContext): boolean { return false; }
  async completeConnection(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async checkSession(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async openBackend(_ctx: AccountContext): Promise<{ opened: boolean; backendUrl: string; sessionIdHash: string }> { return { opened: true, backendUrl: "https://creator.xiaohongshu.com/", sessionIdHash: "fixture" }; }
  async preparePublish(_ctx: AccountContext, _article: PublishArticleInput): Promise<AutomationPrepareResult> { return { prepared: true, requiresUserAction: true, message: "fixture", response: { browserExecutionMode: "VISIBLE" } }; }
  async verifyPublish(_ctx: AccountContext, _externalId?: string): Promise<PublishStatusResult> { return { status: "published", response: {} }; }
  async logout(_ctx: AccountContext): Promise<void> { return undefined; }
  async checkLogin(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async beginLogin(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "fixture", requiresUserAction: false }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> { throw new Error("fixture requires finalSubmit"); }
  async finalSubmit(_ctx: AccountContext, _article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    this.guardSeen = attempt.oneShotPublicationGuard;
    this.retainedEditorMarkerSeen = attempt.task10sRetainedEditor;
    const guard = this.guardSeen;
    if (!guard) throw new Error("missing one-shot guard");
    const authorization = guard.authorization;
    return guard.startFinalSubmit({ authorization: authorization.authorization, authorizationState: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId: authorization.accountId, operationId: authorization.operationId, mode: authorization.mode, authenticated: true, sameCanonicalContext: true, sameCanonicalPage: true, mutexOwned: true, editorPhase: "IMAGE_POST_POST_UPLOAD_EDITOR", safeFixtureUploaded: true, titleReadbackVerified: true, bodyReadbackVerified: true, requiredFieldsPass: true, loginPagePresent: false, securityVerificationPresent: false, finalSubmitControl: { status: "FOUND_UNIQUE", visible: true, enabled: true, hitTestValid: true } }, async () => {
      if (attempt.task10sRetainedEditor) await guard.beginFinalMousePress();
      this.finalSubmitCount++;
      attempt.markSubmissionSideEffect?.();
      return { success: true, status: "published", externalId: "mock-note", publishedUrl: "https://www.xiaohongshu.com/explore/mock-note", response: { imageUploaded: true, verificationStatus: "Verified" } };
    }, { deferDispatchLock: attempt.task10sRetainedEditor === true });
  }
  async verifyPublished(_ctx: AccountContext, _article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> { return { status: "published", externalId: result.externalId, publishedUrl: result.publishedUrl, response: { publicPageVerified: true } }; }
}

function fixture(): { database: ReturnType<typeof openDatabase>; publisher: PublisherService; adapter: RetainedEditorAdapter; jobId: string; authorization: OneShotPublicationAuthorization } {
  const directory = mkdtempSync(join(tmpdir(), "task10s-retained-editor-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  database.repository.createBrand({ name: "Task10S 企业", companyName: "Task10S 企业" });
  const { job, authorization, subject } = boundOneShot(database.repository);
  const adapter = new RetainedEditorAdapter();
  const registry = new AdapterRegistry(); registry.register(adapter);
  const publisher = new PublisherService(database.repository, registry, createConsoleLogger(), { resolveSecrets: () => ({}), resolveRuntimeIdentityAttestation: () => subject });
  return { database, publisher, adapter, jobId: job.id, authorization };
}

afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("Task10S retained-editor transaction mode", () => {
  it("forwards the internal retained-editor marker through the existing one-shot transaction", async () => {
    const { database, publisher, adapter, jobId, authorization } = fixture();
    const result = await publisher.executeTask10sRetainedEditor(jobId, { userActionId: "task10s-retained-editor", triggerSource: "RUN_SELF_TEST" }, "VISIBLE", authorization);
    expect(result.job.status).toBe("Success");
    expect(adapter.retainedEditorMarkerSeen).toBe(true);
    expect(adapter.guardSeen?.authorization.finalSubmitAttemptCount).toBe(1);
    expect(adapter.finalSubmitCount).toBe(1);
    expect(adapter.runWithBrowserSession).not.toHaveBeenCalled();
    expect(database.repository.getSubmissionIntentByJob(jobId)?.finalSubmitCount).toBe(1);
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)?.state).toBe("COMPLETED");
  });

  it("does not mark the ordinary generic executeJob path", async () => {
    const { publisher, adapter, jobId, authorization } = fixture();
    const result = await publisher.executeJob(jobId, { userActionId: "task10s-generic", triggerSource: "RUN_SELF_TEST" }, "VISIBLE", authorization);
    expect(result.job.status).toBe("Success");
    expect(adapter.retainedEditorMarkerSeen).toBeUndefined();
  });

  it("keeps the retained-editor one-shot path independent from the ordinary content gate", async () => {
    const { publisher, adapter, jobId, authorization } = fixture();
    const contentGate = vi.spyOn(publisher as unknown as { assertContentQualityGate: (...args: unknown[]) => void }, "assertContentQualityGate");

    const result = await publisher.executeTask10sRetainedEditor(jobId, { userActionId: "task10s-retained-editor-content-gate", triggerSource: "RUN_SELF_TEST" }, "VISIBLE", authorization);

    expect(result.job.status).toBe("Success");
    expect(contentGate).not.toHaveBeenCalled();
    expect(adapter.retainedEditorMarkerSeen).toBe(true);
    expect(adapter.finalSubmitCount).toBe(1);
  });
});

it.each(["STANDARD", "RETAINED"] as const)("F02 atomically occupies %s authorization and claim at the guard and preserves F01 afterwards", async (mode) => {
  const { database, publisher, adapter, jobId, authorization } = fixture();
  let simulatedDispatches = 0;
  const invoke = () => mode === "RETAINED"
    ? publisher.executeTask10sRetainedEditor(jobId, { userActionId: "isolated", triggerSource: "RUN_SELF_TEST" }, "VISIBLE", authorization)
    : publisher.executeJob(jobId, { userActionId: "isolated", triggerSource: "RUN_SELF_TEST" }, "VISIBLE", authorization);
  const contract: PlatformAdapter = adapter;
  contract.prepareFinalSubmit = async () => {
    expect(database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(0);
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)?.finalSubmitAttemptCount).toBe(0);
    return { response: {} };
  };
  vi.spyOn(adapter, "finalSubmit").mockImplementation(async (_ctx, _article, attempt) => {
    expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)?.state).toBe("AUTHORIZED_UNUSED");
    expect(database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(0);
    const guard = attempt.oneShotPublicationGuard;
    if (!guard) throw new Error("Guard missing");
    return guard.startFinalSubmit({ authorization: authorization.authorization, authorizationState: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId: authorization.accountId, operationId: authorization.operationId, mode: authorization.mode, authenticated: true, sameCanonicalContext: true, sameCanonicalPage: true, mutexOwned: true, editorPhase: "IMAGE_POST_POST_UPLOAD_EDITOR", safeFixtureUploaded: true, titleReadbackVerified: true, bodyReadbackVerified: true, requiredFieldsPass: true, loginPagePresent: false, securityVerificationPresent: false, finalSubmitControl: { status: "FOUND_UNIQUE", visible: true, enabled: true, hitTestValid: true } }, async () => {
      if (mode === "RETAINED") await guard.beginFinalMousePress();
      expect(database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(1);
      expect(database.repository.getSubmissionIntentByJob(jobId)?.finalSubmitCount).toBe(1);
      expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)?.finalSubmitAttemptCount).toBe(1);
      simulatedDispatches++;
      // Deliberately omit the volatile side-effect callback. Its absence cannot unlock a claim.
      throw Object.assign(new Error("post-claim fixture error"), { code: "USER_ACTION_REQUIRED" });
    }, { deferDispatchLock: mode === "RETAINED" });
  });
  expect(simulatedDispatches).toBe(0);
  expect((await invoke()).job.status).toBe("NeedsReconciliation");
  database.repository.resetSubmissionIntentForUserAction(database.repository.getSubmissionIntentByJob(jobId)!.id, "USER_ACTION_REQUIRED");
  expect(database.repository.requestJobRetry(jobId).ok).toBe(false);
  await invoke();
  expect(simulatedDispatches).toBe(1);
  expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)?.finalSubmitAttemptCount).toBe(1);
});

it.each(["missing", "other-operation", "other-binding", "production-purpose"] as const)("F02 rejects %s authorization before retained adapter dispatch", async (fault) => {
 const { database, publisher, adapter, jobId, authorization } = fixture();
 let supplied = fault === "missing" ? undefined : { ...authorization };
 if (fault === "other-operation") supplied = { ...authorization, operationId: "different" };
 if (fault === "other-binding") supplied = { ...authorization, contentBindingId: "different" };
 if (fault === "production-purpose") {
  const job = database.repository.getJob(jobId)!; const old = database.repository.contentSnapshots.get(job.contentBindingId!);
  const replacement = database.repository.contentSnapshots.capture({ purpose: "PRODUCTION", platformKey: "xiaohongshu", accountId: old.accountId, creatorId: old.creatorId, articleId: job.articleId, title: old.rawTitle, body: old.rawBody, imageIds: old.images.map(i=>i.assetId) });
  database.repository.contentSnapshots.save(replacement); database.db.prepare("UPDATE publish_jobs SET content_binding_id=? WHERE id=?").run(replacement.snapshot.id,jobId);
 }
 const result = await publisher.executeTask10sRetainedEditor(jobId, { userActionId: "scope-fixture", triggerSource: "RUN_SELF_TEST" }, "VISIBLE", supplied);
 expect(result.job.status).toBe("NeedsUserAction"); expect(adapter.finalSubmitCount).toBe(0);
 expect(database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(0);
 expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)?.state).toBe("AUTHORIZED_UNUSED");
});

it("F02 standard authorization write failure rolls back the paired claim and confirmation", async () => {
 const { database, publisher, adapter, jobId, authorization } = fixture();
 database.db.exec("CREATE TRIGGER auth_write_fault BEFORE UPDATE ON one_shot_publication_authorizations WHEN NEW.state='CONSUMED' BEGIN SELECT RAISE(ABORT,'AUTH_WRITE_FAULT'); END");
 await publisher.executeJob(jobId, { userActionId:"atomic-fault",triggerSource:"RUN_SELF_TEST" }, "VISIBLE", authorization);
 expect(adapter.finalSubmitCount).toBe(0); expect(database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(0);
 expect(database.db.prepare("SELECT consumed FROM content_confirmations").all()).toEqual([{consumed:0}]);
 expect(database.repository.getOneShotPublicationAuthorization(authorization.operationId)?.state).toBe("AUTHORIZED_UNUSED");
});
