import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry, type PlatformAdapter } from "@publisher/adapters-core";
import { openDatabase, runMigrations } from "@publisher/db";
import type { AccountContext, AdapterManifest, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService, type PublisherOptions } from "@publisher/publisher";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const temporaryDirectories: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>["db"]> = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

class DeferredApiAdapter implements PlatformAdapter {
  readonly platformKey = "test";
  readonly manifest: AdapterManifest = { platformKey: "test", displayName: "Fixture", category: "测试", version: "1", adapterStatus: "ready", authStrategy: "AppCredential", callbackStrategy: "ManualCodeCallback", status: "Stable", researchStatus: "verified", transport: "official_api", supportsArticle: true, supportsVideo: false, officialWebsite: "test://fixture", credentialSchema: [], officialSources: ["test://fixture"] };
  readonly releases: Array<ReturnType<typeof deferred<PublishResult>>> = [];
  active = 0;
  maximumActive = 0;
  calls = 0;
  statusError = false;
  getCapabilities() { return { article: true, imagePost: false, video: false, coverImage: false, tags: false, categories: false, scheduledPublish: true, draft: false, markdown: false, richText: false, maxTitleLength: 100, maxImageCount: 0 }; }
  getCredentialSchema() { return []; }
  async checkLogin() { return "logged_in" as const; }
  async beginLogin() { return { sessionId: randomUUID(), requiresUserAction: false }; }
  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> {
    this.calls += 1;
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    const release = deferred<PublishResult>();
    this.releases.push(release);
    try { return await release.promise; } finally { this.active -= 1; }
  }
  async getPublishStatus(_ctx: AccountContext, externalId: string): Promise<PublishStatusResult> { if (this.statusError) throw Object.assign(new Error("status timeout"), { code: "TIMEOUT" }); return { status: "publishing", externalId, response: {} }; }
}

function fixture(options: PublisherOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "publisher-r1a-")); temporaryDirectories.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(opened.db);
  const { repository } = opened;
  repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  repository.setSetting("defaultPublishMode", "auto");
  const brand = repository.createBrand({ name: "Gate fixture", companyName: "Fixture" });
  repository.createArticle({ brandId: brand.id, topic: "one", keyword: "one", city: "南京", title: "第一篇", body: "正文".repeat(80), summary: "摘要", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: randomUUID() });
  const accounts = [repository.createAccount({ platformKey: "test", name: "account-a", allowAutoPublish: true }), repository.createAccount({ platformKey: "test", name: "account-b", allowAutoPublish: true })];
  const plan = repository.createPlan({ name: "Gate plan", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: accounts.map((account) => account.id), publishTimes: [], reusePolicy: "always", minIntervalSeconds: 0, maxRetries: 3, consecutiveFailureThreshold: 3, startDate: "2026-01-01", endDate: null });
  const jobs = repository.createJobsForPlan(plan.id, new Date(Date.now() - 1000).toISOString());
  const adapter = new DeferredApiAdapter();
  const registry = new AdapterRegistry(); registry.register(adapter);
  const publisher = new PublisherService(repository, registry, createConsoleLogger(), options);
  return { ...opened, repository, jobs, adapter, publisher };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 2)); }
  throw new Error("Timed out waiting for fixture condition");
}

describe("R1-A global formal publish gate", () => {
  it("serializes concurrent direct executeJob calls and persists the holder", async () => {
    const scope = fixture();
    const first = scope.publisher.executeJob(scope.jobs[0]!.id);
    await until(() => scope.adapter.calls === 1);
    const second = scope.publisher.executeJob(scope.jobs[1]!.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scope.adapter.calls).toBe(1);
    expect(scope.repository.getGlobalFormalPublishExecution()?.jobId).toBe(scope.jobs[0]!.id);
    scope.adapter.releases[0]!.resolve({ success: true, status: "publishing", externalId: "first", response: {} });
    await first;
    await until(() => scope.adapter.calls === 2);
    scope.adapter.releases[1]!.resolve({ success: true, status: "publishing", externalId: "second", response: {} });
    await second;
    expect(scope.adapter.maximumActive).toBe(1);
    expect(scope.repository.getGlobalFormalPublishExecution()).toBeNull();
    scope.db.close();
  });

  it("serializes scheduler and direct execution through the same gate", async () => {
    const scope = fixture();
    const scheduler = new PersistentScheduler(scope.repository, scope.publisher, createConsoleLogger());
    const scheduled = scheduler.runDueJobs();
    await until(() => scope.adapter.calls === 1);
    const other = scope.jobs.find((job) => job.id !== scope.repository.getGlobalFormalPublishExecution()?.jobId)!;
    const direct = scope.publisher.executeJob(other.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scope.adapter.calls).toBe(1);
    scope.adapter.releases[0]!.resolve({ success: true, status: "publishing", externalId: "first", response: {} });
    await until(() => scope.adapter.calls === 2);
    scope.adapter.releases[1]!.resolve({ success: true, status: "publishing", externalId: "second", response: {} });
    await Promise.all([scheduled, direct]);
    expect(scope.adapter.maximumActive).toBe(1);
    scope.db.close();
  });

  it("upgrades a prior database once without rewriting a successful record", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-r1a-migration-")); temporaryDirectories.push(directory);
    const priorMigrations = join(directory, "prior-migrations"); mkdirSync(priorMigrations);
    for (const file of readdirSync(migrationDir).filter((name) => name.endsWith(".sql") && name < "0023_r1a_global_formal_publish.sql")) copyFileSync(join(migrationDir, file), join(priorMigrations, file));
    const opened = openDatabase(join(directory, "prior.db"), priorMigrations); databases.push(opened.db);
    const { db, repository } = opened;
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = repository.createBrand({ name: "Prior brand", companyName: "Fixture" });
    const account = repository.createAccount({ platformKey: "test", name: "prior account" });
    const article = repository.createArticle({ brandId: brand.id, topic: "prior", keyword: "prior", city: "南京", title: "Old success", body: "Body", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: randomUUID() })!;
    const plan = repository.createPlan({ name: "Prior plan", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: [], reusePolicy: "always", minIntervalSeconds: 0, maxRetries: 1, consecutiveFailureThreshold: 1, startDate: "2026-01-01", endDate: null });
    const job = repository.createJobsForPlan(plan.id, new Date().toISOString())[0]!;
    const recordId = randomUUID();
    db.prepare("INSERT INTO publish_records (id,job_id,account_id,platform_key,article_id,published_url,published_external_id,success,response_json,published_at,dry_run,status) VALUES (?,?,?,?,?,?,?,?,?,?,0,'Published')").run(recordId, job.id, account.id, "test", article.id, "test://published/old", "old-id", 1, "{}", new Date().toISOString());
    runMigrations(db, migrationDir);
    runMigrations(db, migrationDir);
    const applied = db.prepare("SELECT COUNT(*) AS count FROM migrations WHERE id='0023_r1a_global_formal_publish.sql'").get() as { count: number };
    const record = db.prepare("SELECT status,success,published_url,published_external_id,submission_attempt_id,remote_status FROM publish_records WHERE id=?").get(recordId);
    expect(applied.count).toBe(1);
    expect(record).toEqual({ status: "Published", success: 1, published_url: "test://published/old", published_external_id: "old-id", submission_attempt_id: null, remote_status: null });
    db.close();
  });

  it("retries a proven pre-submit failure without creating a submission attempt", async () => {
    const scope = fixture();
    scope.adapter.checkLogin = async () => { throw Object.assign(new Error("pre-submit network failure"), { code: "NETWORK_ERROR" }); };
    const result = await scope.publisher.executeJob(scope.jobs[0]!.id);
    expect(result.job.status).toBe("Retry");
    expect(scope.repository.getSubmissionIntentByJob(result.job.id)).toBeNull();
    expect(scope.adapter.calls).toBe(0);
    scope.db.close();
  });

  it("persists one attempt before adapter submit and keeps a lost response uncertain", async () => {
    const scope = fixture();
    const execution = scope.publisher.executeJob(scope.jobs[0]!.id);
    await until(() => scope.adapter.calls === 1);
    const before = scope.repository.getSubmissionIntentByJob(scope.jobs[0]!.id)!;
    expect(before.finalSubmitCount).toBe(1);
    expect(before.submissionAttemptId).toBeTruthy();
    expect(before.submitBoundaryEnteredAt).toBeTruthy();
    scope.adapter.releases[0]!.reject(Object.assign(new Error("response lost"), { code: "TIMEOUT" }));
    const result = await execution;
    expect(result.job.status).toBe("NeedsReconciliation");
    expect(scope.repository.getSubmissionIntentByJob(result.job.id)?.submissionAttemptId).toBe(before.submissionAttemptId);
    const repeated = await scope.publisher.executeJob(result.job.id);
    expect(repeated.job.status).toBe("NeedsReconciliation");
    expect(scope.adapter.calls).toBe(1);
    scope.db.close();
  });

  it("recovers a pre-boundary crash as retry but a boundary crash as reconciliation", () => {
    const scope = fixture();
    scope.repository.claimJob(scope.jobs[0]!.id);
    scope.repository.prepareSubmissionIntent(scope.jobs[0]!.id);
    scope.repository.claimJob(scope.jobs[1]!.id);
    const secondIntent = scope.repository.prepareSubmissionIntent(scope.jobs[1]!.id);
    scope.repository.claimFinalSubmitAttempt(secondIntent.id);
    scope.repository.acquireGlobalFormalPublishExecution(scope.jobs[1]!.id);
    scope.db.prepare("UPDATE global_formal_publish_execution SET owner_pid=-1 WHERE singleton_id=1").run();
    scope.repository.recoverRunningJobs();
    expect(scope.repository.getJob(scope.jobs[0]!.id)?.status).toBe("Retry");
    expect(scope.repository.getJob(scope.jobs[1]!.id)?.status).toBe("NeedsReconciliation");
    expect(scope.repository.getGlobalFormalPublishExecution()).toBeNull();
    scope.db.close();
  });

  it("keeps remotely scheduled acceptance distinct from publication across restart", async () => {
    const scope = fixture();
    const execution = scope.publisher.executeJob(scope.jobs[0]!.id);
    await until(() => scope.adapter.calls === 1);
    scope.adapter.releases[0]!.resolve({ success: true, status: "scheduled", externalId: "scheduled-id", response: {} });
    const result = await execution;
    expect(result.job.status).toBe("Publishing");
    expect(scope.repository.getSubmissionIntentByJob(result.job.id)?.remoteStatus).toBe("SCHEDULED_ACCEPTED");
    expect(scope.repository.getPublishRecordByJob(result.job.id)?.success).toBe(false);
    scope.repository.recoverRunningJobs();
    expect(scope.repository.getJob(result.job.id)?.status).toBe("Publishing");
    expect(scope.adapter.calls).toBe(1);
    scope.db.close();
  });

  it("never converts confirmation polling timeout into a new submit", async () => {
    const scope = fixture();
    const execution = scope.publisher.executeJob(scope.jobs[0]!.id);
    await until(() => scope.adapter.calls === 1);
    scope.adapter.releases[0]!.resolve({ success: true, status: "publishing", externalId: "accepted-id", response: {} });
    const submitted = await execution;
    scope.adapter.statusError = true;
    const confirmed = await scope.publisher.pollPublishingJob(submitted.job.id);
    expect(["Publishing", "NeedsReconciliation"]).toContain(confirmed.job.status);
    expect(scope.adapter.calls).toBe(1);
    expect(scope.repository.getSubmissionIntentByJob(submitted.job.id)?.finalSubmitCount).toBe(1);
    scope.db.close();
  });

  it("does not mark a status response published without a public URL", async () => {
    const scope = fixture();
    const execution = scope.publisher.executeJob(scope.jobs[0]!.id);
    await until(() => scope.adapter.calls === 1);
    scope.adapter.releases[0]!.resolve({ success: true, status: "publishing", externalId: "accepted-id", response: {} });
    const submitted = await execution;
    scope.adapter.getPublishStatus = async (_ctx, externalId) => ({ status: "published", externalId, response: {} });
    const confirmed = await scope.publisher.pollPublishingJob(submitted.job.id);
    expect(confirmed.job.status).toBe("Publishing");
    expect(scope.repository.getSubmissionIntentByJob(submitted.job.id)?.remoteStatus).toBe("UNCERTAIN");
    expect(scope.repository.getPublishRecordByJob(submitted.job.id)?.success).toBe(false);
    expect(scope.adapter.calls).toBe(1);
    scope.db.close();
  });

  it("rejects manual retry and preflight reset after final_submit_count reaches one", () => {
    const scope = fixture();
    scope.repository.claimJob(scope.jobs[0]!.id);
    const intent = scope.repository.prepareSubmissionIntent(scope.jobs[0]!.id);
    scope.repository.claimFinalSubmitAttempt(intent.id);
    scope.repository.markSubmissionIntentUncertain(intent.id, "TIMEOUT");
    expect(() => scope.repository.updateJobFailure(scope.jobs[0]!.id, "Retry", "UNKNOWN", "manual retry", new Date().toISOString())).toThrow(/reconciliation|submit/i);
    expect(() => scope.repository.markJobReconciledNotSubmitted(scope.jobs[0]!.id)).toThrow(/proof|submit/i);
    expect(() => scope.repository.resetSubmissionIntentForUserAction(intent.id, "USER_ACTION_REQUIRED")).toThrow(/submit/i);
    expect(scope.repository.getSubmissionIntentByJob(scope.jobs[0]!.id)?.finalSubmitCount).toBe(1);
    scope.db.close();
  });

  it("keeps an unproven browser submit uncertain even if the callback was never reached", () => {
    const scope = fixture();
    scope.repository.claimJob(scope.jobs[0]!.id);
    const intent = scope.repository.prepareSubmissionIntent(scope.jobs[0]!.id);
    scope.repository.reserveSubmissionAttempt(intent.id);
    scope.repository.markSubmissionIntentUncertain(intent.id, "RECONCILIATION_UNCERTAIN");
    expect(scope.repository.getSubmissionIntentByJob(scope.jobs[0]!.id)?.finalSubmitCount).toBe(0);
    expect(() => scope.repository.markJobReconciledNotSubmitted(scope.jobs[0]!.id)).toThrow(/proof/);
    expect(() => scope.repository.updateJobFailure(scope.jobs[0]!.id, "Retry", "UNKNOWN", "manual retry", new Date().toISOString())).toThrow(/reconciliation/);
    expect(scope.repository.getJob(scope.jobs[0]!.id)?.status).toBe("NeedsReconciliation");
    scope.db.close();
  });

  it("does not release the live formal slot when an adapter call times out unresolved", async () => {
    const scope = fixture({ operationTimeoutMs: 10 });
    const result = await scope.publisher.executeJob(scope.jobs[0]!.id);
    expect(result.job.status).toBe("NeedsReconciliation");
    expect(scope.repository.getGlobalFormalPublishExecution()?.jobId).toBe(scope.jobs[0]!.id);
    await expect(scope.publisher.executeJob(scope.jobs[1]!.id)).rejects.toMatchObject({ code: "GLOBAL_PUBLISH_UNCERTAIN" });
    expect(scope.adapter.calls).toBe(1);
    scope.db.close();
  });
});
