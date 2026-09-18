import { readXiaohongshuUploadInputImmediately } from "../packages/adapters/xiaohongshu/src/upload-delivery-diagnostic";
import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, readFileSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase, runMigrations } from "@publisher/db";
import { AdapterRegistry, type BrowserPublishAttemptContext, type AutomationPrepareResult, type BrowserPublishReconciliationResult } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { PublisherService, PersistentScheduler } from "@publisher/publisher";
import { createConsoleLogger } from "@publisher/logger";
import { OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type OneShotPublicationAuthorization, type PlatformSelfTestRun, type XhsContextIdentityAttestation, type AccountContext, type PublishArticleInput, type PublishResult, type SubmissionReconciliationRequest, type SubmissionNegativeEvidence } from "@publisher/domain";
import { registerIpc } from "../apps/desktop/src/main/ipc";

const transport = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>() }));
vi.mock("electron", () => ({
  ipcMain: { removeHandler: (name: string) => transport.handlers.delete(name), handle: (name: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => transport.handlers.set(name, fn) },
  app: { getPath: () => { throw new Error("App paths forbidden in test"); }, getVersion: () => "fixture" },
  dialog: {}, shell: { openExternal: () => { throw new Error("External launch forbidden"); } }
}));
// Unrelated automatic AI recovery is disabled; publish handlers, Publisher and DB remain real.
vi.mock("../apps/desktop/src/main/ai-batch", async (original) => ({ ...await original<object>(), resumePersistentBatches: async () => undefined }));
vi.mock("../apps/desktop/src/main/content-studio", async (original) => ({ ...await original<object>(), resumeContentStudioTasks: async () => undefined }));

class LoopbackAdapter extends TestPlatformAdapter {
  readonly supportsBoundImageBuffers = true;
  uploads: string[] = [];
  beforeUpload?: () => void;
  afterUpload?: () => void;
  sendCalls = 0;
  calls = 0;
  reconcile?: () => Promise<BrowserPublishReconciliationResult>;
  inspectSubmission?: (ctx: AccountContext, request: SubmissionReconciliationRequest) => Promise<SubmissionNegativeEvidence | { status: "UNKNOWN" }>;
  constructor(readonly endpoint: string) { super(); }
  override async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    this.calls++;
    await this.uploadArticle(ctx, article);
    this.sendCalls++;
    const result = await this.send(ctx, article);
    return { ...result, response: { ...result.response, imageUploaded: (article.boundImages?.length ?? 0) > 0 } };
  }
  async uploadArticle(ctx: AccountContext, article: PublishArticleInput): Promise<void> {
    if (article.boundImages?.length) {
      ctx.assertContentSnapshotCurrent?.();
      let consumed: Array<{ name: string; mimeType: string; buffer: Buffer }> = [];
      const handle = {
        evaluate: async (fn: (element: object, verifyBytes?: boolean) => unknown, verifyBytes?: boolean) => fn({ tagName: "INPUT", type: "file", accept: "image/*", multiple: true, disabled: false, isConnected: true, className: "", files: consumed.map((i) => new File([Uint8Array.from(i.buffer)], i.name, { type: i.mimeType })) }, verifyBytes),
        setInputFiles: async (files: typeof consumed) => { consumed = files; this.uploads.push(...files.map((file) => createHash("sha256").update(file.buffer).digest("hex"))); }
      };
      const locator = { elementHandle: async () => { this.beforeUpload?.(); return handle; } } as unknown as Parameters<typeof readXiaohongshuUploadInputImmediately>[0];
      const evidence = await readXiaohongshuUploadInputImmediately(locator, article.images ?? [], undefined, undefined, article.boundImages);
      console.log("F02_UPLOAD", JSON.stringify({ actualConsumedHashes: this.uploads, evidence, snapshotId: article.contentSnapshotId }));
      if (evidence.status !== "PASS") throw new Error("Fixture upload readback failed");
      this.afterUpload?.();
      ctx.assertContentSnapshotCurrent?.();
    }
  }
  async send(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    return new Promise((resolve, reject) => {
      const req = request(this.endpoint, { method: "POST" }, (res) => { res.resume(); res.on("end", () => resolve({ success: true, externalId: "mock-receipt", publishedUrl: "http://127.0.0.1/mock", response: { mock: true } })); });
      req.on("error", reject);
      req.end(JSON.stringify({ intentId: ctx.settings.submissionOperationId, accountId: ctx.accountId, articleId: article.articleId, body: article.body }));
    });
  }
}
const fixtures: Awaited<ReturnType<typeof makeFixture>>[] = [];
async function fixture(legacy: boolean | "0026" = false) { const f = await makeFixture(legacy); fixtures.push(f); return f; }
async function makeFixture(legacy: boolean | "0026" = false) {
  const dir = mkdtempSync(join(tmpdir(), "f01-ipc-"));
  const databasePath = join(dir, "publisher.db");
  const migrations = join(process.cwd(), "packages/db/migrations");
  const legacyMigrations = join(dir, "migrations-through-0025");
  if (legacy) {
    mkdirSync(legacyMigrations);
    for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name < (legacy === "0026" ? "0027" : "0026"))) copyFileSync(join(migrations, name), join(legacyMigrations, name));
  }
  const database = openDatabase(databasePath, legacy ? legacyMigrations : migrations);
  const repository = database.repository;
  repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = repository.createBrand({ name: "Isolated", companyName: "Isolated" });
  const article = repository.createArticle({ brandId: brand.id, topic: "fixture", keyword: "fixture", city: "fixture", title: "Fixture", body: "Isolated mock article", summary: "", tags: [], seoKeywords: [], articleType: "fixture", aiProvider: "fixture", aiModel: "mock", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: randomUUID() });
  if (!article) throw new Error("Fixture article missing");
  const account = repository.createAccount({ platformKey: "test", name: "Isolated account", allowAutoPublish: true });
  repository.updateAccount(account.id, { loginStatus: "logged_in", minimumIntervalSeconds: 0 });
  const plan = repository.createPlan({ name: "Isolated", brandId: brand.id, enabled: true, strategy: "same_article", articlesPerDay: 1, accountIds: [account.id], publishTimes: [], reusePolicy: "always", minIntervalSeconds: 0, maxRetries: 3, consecutiveFailureThreshold: 3, startDate: "2026-01-01", endDate: null });
  const [job] = repository.createJobsForPlan(plan.id, new Date(Date.now() - 1000).toISOString());
  const receipts: unknown[] = [];
  let dropResponse = true;
  const closedOperations = new Map<string, SubmissionReconciliationRequest>();
  const server: Server = createServer((req, res) => {
    if (req.method === "GET") {
      const id = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("intentId") ?? "";
      const closed = closedOperations.get(id);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(closed ? { ...closed, status: "NOT_SUBMITTED", operationClosed: true, evidenceId: `mock-closed:${id}`, observedAt: new Date().toISOString() } : { status: "UNKNOWN" })); return;
    }
    let body = ""; req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => { const payload = JSON.parse(body) as { intentId?: string };
      if (payload.intentId && closedOperations.has(payload.intentId)) { res.writeHead(409); res.end("operation permanently closed"); return; }
      receipts.push(payload); writeFileSync(join(dir, "server-receipts.json"), JSON.stringify(receipts, null, 2)); if (dropResponse) req.socket.destroy(); else { res.writeHead(200); res.end("accepted"); } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback port missing");
  const adapter = new LoopbackAdapter(`http://127.0.0.1:${address.port}`);
  const registry = new AdapterRegistry(); registry.register(adapter);
  const logger = createConsoleLogger();
  const logs = vi.spyOn(logger, "info");
  const publisher = new PublisherService(repository, registry, logger);
  const credentials = { get: () => null, set: () => { throw new Error("No credentials may be written"); }, delete: () => { throw new Error("No credentials may be removed"); }, has: () => false };
  const scheduler = new PersistentScheduler(repository, publisher, logger);
  const start = vi.spyOn(scheduler, "start").mockImplementation(() => { throw new Error("Scheduler forbidden"); });
  registerIpc({ repository, publisher, scheduler, registry, resolveAccountSecrets: () => ({}), dataDirectory: dir, coverDir: dir, logger, credentials, aiCredentials: credentials, appLogPath: join(dir, "app.log"), databasePath });
  const handlers = new Map(transport.handlers);
  const invoke = (channel: string, payload: unknown = { id: job.id }) => { const handler = handlers.get(channel); if (!handler) throw new Error(`Missing handler ${channel}`); return handler({}, payload); };
  const snapshots: unknown[] = [];
  const snapshot = (label: string) => {
    const item = { label, adapterCalls: adapter.calls, serverReceives: receipts.length, sendFunctionCalls: adapter.sendCalls, uploadHashes: adapter.uploads, contentTables: Object.fromEntries(["content_snapshots","content_confirmations","content_snapshot_invalidations","publish_records","one_shot_publication_authorizations"].map((table) => [table, database.db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table) ? database.db.prepare(`SELECT * FROM ${table}`).all() : []])), job: repository.getJob(job.id), jobs: database.db.prepare("SELECT * FROM publish_jobs").all(), intents: database.db.prepare("SELECT * FROM submission_intents").all(), claims: database.db.prepare("SELECT 1 FROM sqlite_master WHERE name='submission_dispatch_claims'").get() ? database.db.prepare("SELECT * FROM submission_dispatch_claims").all() : [], databasePath };
    snapshots.push(item); console.log("F01_EVIDENCE", JSON.stringify(item)); return item;
  };
  const closeOperation = (input: SubmissionReconciliationRequest) => {
    if (receipts.some((row) => (row as { intentId?: string }).intentId === input.intentId)) throw new Error("Cannot prove non-submission of a received operation");
    closedOperations.set(input.intentId, input);
    adapter.inspectSubmission = async (_ctx, request) => {
      const response = await fetch(`${adapter.endpoint}/status?intentId=${encodeURIComponent(request.intentId)}`);
      return await response.json() as SubmissionNegativeEvidence | { status: "UNKNOWN" };
    };
  };
  const f = { logs, closeOperation, dir, databasePath, database, repository, article, account, job, adapter, registry, publisher, invoke, receipts, server, snapshots, snapshot, start, accept: () => { dropResponse = false; } };
  snapshot("initial-zero"); expect(receipts).toHaveLength(0); expect(adapter.calls).toBe(0);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    if (f.database.db.open) f.snapshot("final");
    expect(f.start).not.toHaveBeenCalled();
    const evidence = process.env.BATCH1_ISOLATION_ROOT;
    if (evidence) { const target = join(evidence, "integration-evidence"); mkdirSync(target, { recursive: true }); writeFileSync(join(target, `${f.dir.split(/[\\/]/u).at(-1)}.json`), JSON.stringify(f.snapshots, null, 2)); }
    if (f.database.db.open) f.database.db.close();
    await new Promise<void>((resolve, reject) => f.server.close((error) => error ? reject(error) : resolve()));
  }
  vi.restoreAllMocks();
});

it.each(["jobs:retry", "jobs:reconcile-not-submitted"])("holds an actually received unknown operation after %s", async (channel) => {
  const f = await fixture();
  await f.invoke("jobs:run");
  f.snapshot("first-received-response-lost");
  expect(f.receipts).toHaveLength(1);
  expect(f.repository.getJob(f.job.id)?.status).toBe("NeedsReconciliation");
  await f.invoke(channel);
  await f.invoke("jobs:run");
  f.snapshot("after-retry-entry");
  expect(f.receipts).toHaveLength(1);
  expect(f.adapter.calls).toBe(1);
  expect(f.repository.getSubmissionIntentByJob(f.job.id)?.state).toBe("Unknown");
});

function alternative(f: Awaited<ReturnType<typeof fixture>>, accountId = f.account.id): string {
  const id = randomUUID();
  f.database.db.prepare(`INSERT INTO publish_jobs(id,account_id,platform_account_id,platform_key,article_id,scheduled_at,status,dry_run,manual_confirmation_required,created_at,publish_payload_json)
    VALUES (?,?,?,'test',?,?,'Scheduled',0,0,?,?)`).run(id, accountId, accountId, f.article.id, new Date().toISOString(), new Date().toISOString(), JSON.stringify({ originPublicationId: randomUUID() }));
  return id;
}
function reboundIpc(f: Awaited<ReturnType<typeof fixture>>, database: ReturnType<typeof openDatabase>) {
  const logger = createConsoleLogger();
  const publisher = new PublisherService(database.repository, f.registry, logger);
  const credentials = { get: () => null, has: () => false, set: () => { throw new Error("No credentials"); }, delete: () => { throw new Error("No credentials"); } };
  registerIpc({ repository: database.repository, publisher, registry: f.registry, scheduler: new PersistentScheduler(database.repository, publisher, logger), logger, credentials, aiCredentials: credentials, resolveAccountSecrets: () => ({}), dataDirectory: f.dir, coverDir: f.dir, appLogPath: join(f.dir, "restarted.log"), databasePath: f.databasePath });
  const handlers = new Map(transport.handlers);
  return async (channel: string, id = f.job.id) => { const handler = handlers.get(channel); if (!handler) throw new Error("Missing IPC"); return handler({}, { id }); };
}
it("does not accept front-end flags or proof objects", async () => {
  const f = await fixture(); await f.invoke("jobs:run");
  for (const forged of [{ verified: true }, { notSubmitted: true }, { proof: { intentId: f.repository.getSubmissionIntentByJob(f.job.id)?.id, operationClosed: true } }]) {
    await expect(f.invoke("jobs:reconcile-not-submitted", { id: f.job.id, ...forged })).rejects.toThrow();
  }
  expect(await f.invoke("jobs:reconcile-not-submitted")).toMatchObject({ ok: false, code: "NEGATIVE_PROOF_UNAVAILABLE" });
  await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(1);
});
it.each(["response-lost", "claimed-before-send"] as const)("holds across a closed database and new IPC/Repository after %s", async (fault) => {
  const f = await fixture();
  if (fault === "claimed-before-send") {
    const claim = f.repository.claimSubmissionDispatch.bind(f.repository);
    vi.spyOn(f.repository, "claimSubmissionDispatch").mockImplementationOnce((id) => { claim(id); throw new Error("stop after claim"); });
  }
  await f.invoke("jobs:run"); f.snapshot("before-close"); f.database.db.close();
  const reopened = openDatabase(f.databasePath, join(process.cwd(), "packages/db/migrations"));
  try {
    const invoke = reboundIpc(f, reopened);
    await invoke("jobs:recover"); await invoke("jobs:retry"); await invoke("jobs:run");
    expect(reopened.repository.getJob(f.job.id)?.status).toBe("NeedsReconciliation");
    expect(f.receipts).toHaveLength(fault === "response-lost" ? 1 : 0);
    console.log("F01_RESTART", JSON.stringify({ databasePath: f.databasePath, adapterCalls: f.adapter.calls, serverReceives: f.receipts.length, intent: reopened.repository.getSubmissionIntentByJob(f.job.id) }));
  } finally { reopened.db.close(); }
});
it("blocks different Jobs and changed content/origin in the same scope", async () => {
  const f = await fixture(); await f.invoke("jobs:run");
  f.repository.updateArticle(f.article.id, { body: "Changed content does not resolve an old send" });
  const id = alternative(f);
  await f.invoke("jobs:run", { id, originPublicationId: "caller-changed" });
  expect(f.repository.getJob(id)?.status).toBe("NeedsReconciliation");
  expect(f.receipts).toHaveLength(1);
  f.repository.updateJobFailure(f.job.id, "Cancelled", "UNKNOWN", "cancel", null);
  expect(f.repository.getJob(f.job.id)?.status).toBe("NeedsReconciliation");
  expect(() => f.database.db.prepare("DELETE FROM publish_jobs WHERE id=?").run(f.job.id)).toThrow();
});
it("races two actual DB connections and separate IPC/Publisher instances", async () => {
  const f = await fixture(); const id = alternative(f);
  const second = openDatabase(f.databasePath, join(process.cwd(), "packages/db/migrations"));
  try {
    const invoke = reboundIpc(f, second);
    await Promise.all([f.invoke("jobs:run"), invoke("jobs:run", id), f.invoke("jobs:run")]);
    expect(f.receipts).toHaveLength(1); expect(f.adapter.calls).toBe(1);
    expect(second.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(1);
    expect(second.repository.getSubmissionBarrier(id)).not.toBeNull();
  } finally { second.db.close(); }
});
it.each(["resetSubmissionIntentForUserAction", "resetSubmissionIntentAfterPreviewOnly"] as const)("does not clear an occupied boundary via %s", async (method) => {
  const f = await fixture(); await f.invoke("jobs:run");
  const intent = f.repository.getSubmissionIntentByJob(f.job.id)!;
  f.repository[method](intent.id, "USER_ACTION_REQUIRED");
  f.repository.confirmJob(f.job.id, false);
  f.repository.markJobReconciledNotPublished(f.job.id, "not found");
  f.repository.markJobConfirmedNotPublished(f.job.id, "manual assertion");
  f.repository.updateJobFailure(f.job.id, "Retry", "UNKNOWN", "generic recovery", null);
  await f.invoke("jobs:run");
  expect(f.receipts).toHaveLength(1); expect(f.repository.getSubmissionIntentByJob(f.job.id)?.state).toBe("Unknown");
});
it.each(["before-claim", "after-claim", "before-accepted-write", "before-record-write"] as const)("preserves facts at the %s fault", async (point) => {
  const f = await fixture(); f.accept();
  if (point === "before-claim") vi.spyOn(f.repository, "claimSubmissionDispatch").mockImplementationOnce(() => { throw new Error("pre-claim fault"); });
  if (point === "after-claim") {
    const claim = f.repository.claimSubmissionDispatch.bind(f.repository);
    vi.spyOn(f.repository, "claimSubmissionDispatch").mockImplementationOnce((id) => { claim(id); throw new Error("post-claim pre-send fault"); });
  }
  if (point === "before-accepted-write") vi.spyOn(f.repository, "markSubmissionIntentSubmitted").mockImplementationOnce(() => { throw new Error("accepted write fault"); });
  if (point === "before-record-write") vi.spyOn(f.repository, "insertPublishRecord").mockImplementationOnce(() => { throw new Error("record write fault"); });
  await f.invoke("jobs:run"); f.snapshot(point);
  const before = point === "before-claim" || point === "after-claim";
  expect(f.receipts).toHaveLength(before ? 0 : 1);
  expect(f.adapter.calls).toBe(before ? 0 : 1);
  const result = await f.invoke("jobs:retry");
  expect(result).toMatchObject({ ok: point === "before-claim" });
  await f.invoke("jobs:run");
  expect(f.receipts).toHaveLength(point === "after-claim" ? 0 : 1);
  if (point === "after-claim" || point === "before-accepted-write") expect(f.repository.getSubmissionIntentByJob(f.job.id)?.state).toBe("Unknown");
});
it("allows first send after pre-boundary validation correction and isolates other accounts", async () => {
  const f = await fixture(); f.repository.updateArticle(f.article.id, { title: "" });
  await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(0); expect(f.adapter.calls).toBe(0);
  f.repository.updateArticle(f.article.id, { title: "Corrected" }); await f.invoke("jobs:retry"); await f.invoke("jobs:run");
  expect(f.receipts).toHaveLength(1);
  const account = f.repository.createAccount({ platformKey: "test", name: "Independent account", allowAutoPublish: true });
  const id = alternative(f, account.id); f.accept(); await f.invoke("jobs:run", { id });
  expect(f.receipts).toHaveLength(2); expect(f.repository.getJob(id)?.status).toBe("Success");
});
it("does not reset a completed operation through retry or generic failure", async () => {
  const f = await fixture(); f.accept(); await f.invoke("jobs:run");
  expect(f.repository.getJob(f.job.id)?.status).toBe("Success");
  expect(await f.invoke("jobs:retry")).toMatchObject({ ok: false });
  f.repository.updateJobFailure(f.job.id, "Retry", "UNKNOWN", "retry completed", null);
  await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(1);
});
it("accepts only the trusted terminal NOT_SUBMITTED contract for the exact unknown intent", async () => {
  const f = await fixture();
  const claim = f.repository.claimSubmissionDispatch.bind(f.repository);
  vi.spyOn(f.repository, "claimSubmissionDispatch").mockImplementationOnce((id) => { claim(id); throw new Error("crash before send"); });
  await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(0);
  const request = f.repository.getSubmissionReconciliationRequest(f.job.id)!;
  f.adapter.inspectSubmission = async () => ({ ...request, intentId: "another-intent", status: "NOT_SUBMITTED", operationClosed: true, evidenceId: "wrong", observedAt: new Date().toISOString() });
  expect(await f.invoke("jobs:reconcile-not-submitted")).toMatchObject({ ok: false, code: "NEGATIVE_PROOF_REJECTED" });
  // Mock contract is a closed operation, not an absence search or calls==0 proof.
  f.closeOperation(request);
  expect(await f.invoke("jobs:reconcile-not-submitted")).toMatchObject({ ok: true, code: "RETRY_READY" });
  f.accept(); await f.invoke("jobs:run");
  expect(f.receipts).toHaveLength(1); expect(f.repository.getJob(f.job.id)?.status).toBe("Success");
  expect(f.repository.getSubmissionIntentByJob(f.job.id)?.id).not.toBe(request.intentId);
});

it("creation entry points cannot replace an unknown job hidden behind a Failed status", async () => {
  const f = await fixture(); await f.invoke("jobs:run");
  // Fault injection bypasses API guards solely to test durable admission at every entry.
  f.database.db.prepare("UPDATE publish_jobs SET status='Failed' WHERE id=?").run(f.job.id);
  f.database.db.prepare("UPDATE content_quality_states SET status='Approved' WHERE content_type='article' AND content_id=?").run(f.article.id);
  const result = f.repository.createArticlePublishJob({ articleId: f.article.id, platformKey: "test", platformAccountId: f.account.platformAccountId! });
  expect(result.id).toBe(f.job.id);
  expect(f.repository.createJobsForPlan(f.job.planId!, new Date().toISOString())).toHaveLength(0);
  await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(1);
  expect(f.repository.getJob(f.job.id)?.status).toBe("NeedsReconciliation");
});

it("arbitrates simultaneous claims in separate Node processes sharing only SQLite", async () => {
  const f = await fixture(); const alternate = alternative(f);
  const intents = [f.repository.prepareSubmissionIntent(f.job.id).id, f.repository.prepareSubmissionIntent(alternate).id];
  const children = intents.map((id) => {
    const args = [f.databasePath, id, f.adapter.endpoint];
    const child = fork(join(process.cwd(), "tests/fixtures/submission-claim-worker.ts"), args, { execArgv: ["--import", "tsx"], silent: true });
    let stdout = ""; let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const ready = new Promise<void>((resolve, reject) => { child.once("message", () => resolve()); child.once("error", reject); child.once("exit", (code) => { if (code) reject(new Error(stderr)); }); });
    const exited = new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => child.once("exit", (exitCode) => resolve({ exitCode, stdout, stderr })));
    return { child, ready, exited };
  });
  await Promise.all(children.map((item) => item.ready));
  for (const item of children) item.child.send("claim");
  const results = await Promise.all(children.map((item) => item.exited));
  console.log("F01_PROCESS_RACE", JSON.stringify(results));
  for (const result of results) expect(result.exitCode, result.stderr).toBe(0);
  const observations = results.map((result) => JSON.parse(result.stdout.trim()) as { pid: number; claimed: boolean; directHttpCalls: number });
  expect(new Set(observations.map((item) => item.pid)).size).toBe(2);
  expect(observations.filter((item) => item.claimed)).toHaveLength(1);
  expect(observations.reduce((sum, item) => sum + item.directHttpCalls, 0)).toBe(1);
  expect(f.receipts).toHaveLength(1);
  expect(f.database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(1);
}, 20_000);

it("allows an independent source article on the same account while the first remains unknown", async () => {
  const f = await fixture(); await f.invoke("jobs:run");
  const article = f.repository.createArticle({ ...f.article, title: "Independent operation", body: "Different source article", contentHash: randomUUID() });
  if (!article) throw new Error("Independent fixture missing");
  const id = alternative(f);
  f.database.db.prepare("UPDATE publish_jobs SET article_id=? WHERE id=?").run(article.id, id);
  f.accept(); await f.invoke("jobs:run", { id });
  expect(f.receipts).toHaveLength(2);
  expect(f.repository.getJob(f.job.id)?.status).toBe("NeedsReconciliation");
  expect(f.repository.getJob(id)?.status).toBe("Success");
});


// R1/R2 use the registered production handlers; only transport and platform are fixtures.
async function legacyUnknowns() {
  const f = await fixture(true);
  const ids = [randomUUID(), randomUUID()];
  const time = "2026-01-01T00:00:00.000Z";
  for (const id of ids) f.database.db.prepare("INSERT INTO submission_intents(id,job_id,account_id,article_id,platform_key,attempt,state,created_at,updated_at) VALUES (?,?,?,?,'test',?,'Unknown',?,?)")
    .run(id, f.job.id, f.account.id, f.article.id, ids.indexOf(id) + 1, time, time);
  f.database.db.prepare("UPDATE publish_jobs SET attempt_count=2,submission_intent_id=?,status='NeedsReconciliation' WHERE id=?").run(ids[1], f.job.id);
  runMigrations(f.database.db, join(process.cwd(), "packages/db/migrations"));
  expect(f.database.db.prepare("SELECT state FROM submission_dispatch_claims").all()).toEqual([{ state: "Claimed" }, { state: "Claimed" }]);
  f.snapshot("R1-after-real-0025-upgrade");
  return { ...f, ids };
}
function proof(request: SubmissionReconciliationRequest): SubmissionNegativeEvidence {
  return { ...request, status: "NOT_SUBMITTED", operationClosed: true, evidenceId: randomUUID(), observedAt: new Date().toISOString() };
}
it("R1 reconciles two migrated legacy intents individually before the first actual receipt", async () => {
  const f = await legacyUnknowns();
  const first = f.repository.getSubmissionReconciliationRequest(f.job.id)!;
  f.closeOperation(first);
  expect(await f.invoke("jobs:reconcile-not-submitted")).toMatchObject({ ok: false, code: "SUBMISSION_RECONCILIATION_REQUIRED" });
  f.snapshot("R1-one-resolved-one-unknown");
  await f.invoke("jobs:retry"); await f.invoke("jobs:run");
  const otherJob = alternative(f); await f.invoke("jobs:run", { id: otherJob });
  expect(f.receipts).toHaveLength(0); expect(f.adapter.calls).toBe(0);
  const second = f.repository.getSubmissionReconciliationRequest(f.job.id);
  expect(second).not.toBeNull();
  expect(second!.intentId).not.toBe(first.intentId);
  f.closeOperation(second!);
  expect(await f.invoke("jobs:reconcile-not-submitted")).toMatchObject({ ok: true, code: "RETRY_READY" });
  expect(f.database.db.prepare("SELECT state FROM submission_intents WHERE id IN (?,?)").all(...f.ids)).toEqual([{ state: "NotSubmitted" }, { state: "NotSubmitted" }]);
  f.snapshot("R1-both-resolved-zero-receipts");
  f.accept(); await f.invoke("jobs:run"); await f.invoke("jobs:run", { id: otherJob });
  expect(f.receipts).toHaveLength(1); expect(f.adapter.calls).toBe(1);
});
it.each(["intent", "account", "article", "platform", "stale", "replay", "accepted"] as const)("R1 rejects %s proof through IPC without resolving another intent", async (fault) => {
  const f = await legacyUnknowns();
  const request = f.repository.getSubmissionReconciliationRequest(f.job.id)!;
  const evidence = proof(request);
  if (fault === "intent") evidence.intentId = f.ids.find((id) => id !== request.intentId)!;
  if (fault === "account") evidence.accountId = "different-account";
  if (fault === "article") evidence.articleId = "different-article";
  if (fault === "platform") evidence.platformKey = "different-platform";
  if (fault === "stale") evidence.observedAt = "2000-01-01T00:00:00.000Z";
  if (fault === "replay") {
    f.closeOperation(request); await f.invoke("jobs:reconcile-not-submitted");
  }
  f.adapter.inspectSubmission = async () => {
    if (fault === "accepted") {
      const second = openDatabase(f.databasePath, join(process.cwd(), "packages/db/migrations"));
      try { second.repository.markSubmissionIntentSubmitted(request.intentId, "accepted-during-query"); } finally { second.db.close(); }
    }
    return evidence;
  };
  expect(await f.invoke("jobs:reconcile-not-submitted")).toMatchObject({ ok: false, code: "NEGATIVE_PROOF_REJECTED" });
  expect(f.database.db.prepare("SELECT * FROM submission_intents WHERE state='Unknown'").all().length).toBe(fault === "replay" || fault === "accepted" ? 1 : 2);
  await f.invoke("jobs:retry"); await f.invoke("jobs:run");
  expect(f.receipts).toHaveLength(0); expect(f.repository.getSubmissionBarrier(f.job.id)).not.toBeNull();
});
const negativeSearch: BrowserPublishReconciliationResult = { status: "CONFIRMED_NOT_PUBLISHED", message: "mock list absence", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { searchOnly: true } };
it.each(["Unknown", "Submitted", "Publishing", "Success"] as const)("R2 negative search preserves concurrent %s facts and never claims closure", async (status) => {
  const f = await fixture();
  const claim = f.repository.claimSubmissionDispatch.bind(f.repository);
  vi.spyOn(f.repository, "claimSubmissionDispatch").mockImplementationOnce((id) => { claim(id); throw new Error("stop before mock send"); });
  await f.invoke("jobs:run");
  const intent = f.repository.getSubmissionIntentByJob(f.job.id)!;
  let searches = 0;
  f.adapter.reconcile = async () => {
    searches++;
    // The handler already admitted NeedsReconciliation before this async boundary.
    await Promise.resolve();
    if (status !== "Unknown") {
      const second = openDatabase(f.databasePath, join(process.cwd(), "packages/db/migrations"));
      try {
        second.repository.markSubmissionIntentSubmitted(intent.id, "accepted-during-search");
        if (status === "Success") second.repository.reconcileJobAsPublished(f.job.id, { externalId: "accepted-during-search", publishedUrl: "http://127.0.0.1/published", response: { fixture: true } });
        if (status === "Publishing") second.db.prepare("UPDATE publish_jobs SET status='Publishing' WHERE id=?").run(f.job.id);
      } finally { second.db.close(); }
    }
    return negativeSearch;
  };
  const result = await f.invoke("jobs:reconcile-browser") as { job: { status: string }; message: string; code?: string };
  f.snapshot(`R2-after-query-${status}`);
  console.log("R2_RESULT_LOGS", JSON.stringify({ result, logs: f.logs.mock.calls }));
  expect(result.job.status).toBe(status === "Unknown" ? "NeedsReconciliation" : status);
  expect(result.code).toBe("SUBMISSION_RECONCILIATION_REQUIRED");
  expect(result.message).not.toMatch(/CONFIRMED_NOT_PUBLISHED|已确认未发布|已收口/);
  expect(f.logs.mock.calls.some((args) => args[1] === "BROWSER_RECONCILIATION_NOT_PUBLISHED")).toBe(false);
  if (status === "Unknown") await f.invoke("jobs:reconcile-browser");
  else await expect(f.invoke("jobs:reconcile-browser")).rejects.toThrow("NeedsReconciliation");
  expect(searches).toBe(status === "Unknown" ? 2 : 1);
  expect(f.receipts).toHaveLength(0); expect(f.adapter.calls).toBe(0);
  expect(f.database.db.prepare("SELECT state FROM submission_dispatch_claims WHERE intent_id=?").get(intent.id)).toEqual({ state: status === "Unknown" ? "Claimed" : "Accepted" });
  if (status === "Success") expect(f.repository.getPublishRecordByJob(f.job.id)?.success).toBe(true);
});
it("R2 closes only unclaimed local preparation and rejects repeat browser entry", async () => {
  const f = await fixture();
  f.repository.updateJobFailure(f.job.id, "NeedsReconciliation", "LOCAL", "local preparation", null);
  f.adapter.reconcile = async () => negativeSearch;
  const result = await f.invoke("jobs:reconcile-browser");
  expect(result).toMatchObject({ job: { status: "ReconciledNotPublished" } });
  expect(f.logs.mock.calls.filter((args) => args[1] === "BROWSER_RECONCILIATION_NOT_PUBLISHED")).toHaveLength(1);
  await expect(f.invoke("jobs:reconcile-browser")).rejects.toThrow("NeedsReconciliation");
  expect(f.receipts).toHaveLength(0);
});


it("R1 rejects an in-flight stale state version without clearing either claim", async () => {
  const f = await legacyUnknowns();
  f.adapter.inspectSubmission = async (_ctx, request) => {
    const second = openDatabase(f.databasePath, join(process.cwd(), "packages/db/migrations"));
    try { second.db.prepare("UPDATE submission_intents SET updated_at=? WHERE id=?").run(new Date(Date.parse(request.intentUpdatedAt) + 1).toISOString(), request.intentId); } finally { second.db.close(); }
    return proof(request);
  };
  expect(await f.invoke("jobs:reconcile-not-submitted")).toMatchObject({ ok: false, code: "NEGATIVE_PROOF_REJECTED" });
  expect(f.database.db.prepare("SELECT state FROM submission_dispatch_claims").all()).toEqual([{ state: "Claimed" }, { state: "Claimed" }]);
  expect(f.receipts).toHaveLength(0);
});
it("R1 concurrent proofs resolve only their pinned intent once", async () => {
  const f = await legacyUnknowns();
  const request = f.repository.getSubmissionReconciliationRequest(f.job.id)!;
  f.closeOperation(request);
  const results = await Promise.all([f.invoke("jobs:reconcile-not-submitted"), f.invoke("jobs:reconcile-not-submitted")]);
  expect(results).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "SUBMISSION_RECONCILIATION_REQUIRED" }),
    expect.objectContaining({ code: "NEGATIVE_PROOF_REJECTED" })
  ]));
  expect(f.database.db.prepare("SELECT * FROM submission_dispatch_claims WHERE state='NotSubmitted'").all()).toHaveLength(1);
  expect(f.database.db.prepare("SELECT * FROM submission_dispatch_claims WHERE state='Claimed'").all()).toHaveLength(1);
  expect(f.repository.getSubmissionReconciliationRequest(f.job.id)?.intentId).not.toBe(request.intentId);
  expect(f.receipts).toHaveLength(0);
});
it("R2 does not downgrade a concurrently successful record even without a claim", async () => {
  const f = await fixture();
  f.repository.updateJobFailure(f.job.id, "NeedsReconciliation", "LOCAL", "local", null);
  f.adapter.reconcile = async () => {
    const second = openDatabase(f.databasePath, join(process.cwd(), "packages/db/migrations"));
    try { second.repository.reconcileJobAsPublished(f.job.id, { externalId: "concurrent", publishedUrl: "http://127.0.0.1/published", response: { fixture: true } }); } finally { second.db.close(); }
    return negativeSearch;
  };
  expect(await f.invoke("jobs:reconcile-browser")).toMatchObject({ job: { status: "Success" }, code: "RECONCILIATION_STATE_CHANGED" });
  expect(f.repository.getPublishRecordByJob(f.job.id)?.success).toBe(true);
  expect(f.logs.mock.calls.some((args) => args[1] === "BROWSER_RECONCILIATION_NOT_PUBLISHED")).toBe(false);
  expect(f.receipts).toHaveLength(0);
});


it("F02 invalidates ordinary confirmation when the article changes", async () => {
  const f = await fixture();
  await f.invoke("jobs:confirm", { id: f.job.id, dryRun: false });
  f.repository.updateArticle(f.article.id, { body: "B is not the confirmed A" });
  await f.invoke("jobs:run");
  expect(f.receipts).toHaveLength(0);
  expect(f.adapter.calls).toBe(0);
});
it("F02 rejects a client image digest that differs from actual registered bytes", async () => {
  const f = await fixture();
  const imagePath = join(f.dir, "content-a.png"); writeFileSync(imagePath, Buffer.from("actual-A"));
  const image = f.repository.createImageAsset({ brandId: f.article.brandId, name: "synthetic", filePath: imagePath, originalFileName: "content-a.png", mimeType: "image/png", size: 8 });
  const account = f.repository.createAccount({ platformKey: "xiaohongshu", name: "Synthetic XHS", allowAutoPublish: false });
  f.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", externalAccountId: "fixture-creator", browserSessionId: "fixture-only" });
  await expect(f.invoke("platform-self-test:request-one-shot-publish", { platformAccountId: account.id, payload: { platformKey: "xiaohongshu", accountId: account.id, creatorId: "fixture-creator", title: "A", body: "A", imageAssetId: image.id, imageSha256: "0".repeat(64) } })).rejects.toThrow("CONTENT_IMAGE_HASH_MISMATCH");
  expect(f.database.db.prepare("SELECT * FROM one_shot_content_bindings").all()).toHaveLength(0);
  expect(f.database.db.prepare("SELECT * FROM platform_self_test_runs").all()).toHaveLength(0);
  expect(f.receipts).toHaveLength(0);
});


function f02Image(f: Awaited<ReturnType<typeof fixture>>, name = "asset-a.png") {
  const path = join(f.dir, name); const bytes = Buffer.from(`synthetic-bytes:${name}`); writeFileSync(path, bytes);
  const image = f.repository.createImageAsset({ brandId: f.article.brandId, name, filePath: path, originalFileName: name, mimeType: "image/png", size: bytes.length });
  return { path, image, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
it("F02 consumes snapshotted upload bytes and permits exactly one confirmed dispatch", async () => {
  const f = await fixture(); const image = f02Image(f);
  f.database.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=?,manual_confirmation_required=1 WHERE id=?").run(image.image.id, f.job.id);
  await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(0); expect(f.adapter.uploads).toHaveLength(0);
  await Promise.all([f.invoke("jobs:confirm", { id: f.job.id, dryRun: false }), f.invoke("jobs:confirm", { id: f.job.id, dryRun: false })]);
  const job = f.repository.getJob(f.job.id)!; const snapshot = f.repository.contentSnapshots.get(job.contentBindingId!);
  expect(snapshot.images[0]?.sha256).toBe(image.sha256);
  expect(f.database.db.prepare("SELECT * FROM content_confirmations").all()).toHaveLength(1);
  f.accept(); await Promise.all([f.invoke("jobs:run"), f.invoke("jobs:run")]);
  expect(f.adapter.uploads).toEqual([image.sha256]); expect(f.receipts).toHaveLength(1);
  expect(f.repository.getPublishRecordByJob(f.job.id)?.contentBindingId).toBe(snapshot.id);
  expect(f.database.db.prepare("SELECT content_binding_id FROM submission_intents").get()).toEqual({ content_binding_id: snapshot.id });
});
it.each(["replace", "delete", "path", "object-corrupt", "object-delete"] as const)("F02 blocks %s after confirmation before upload", async (fault) => {
  const f = await fixture(); const image = f02Image(f);
  f.database.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=? WHERE id=?").run(image.image.id, f.job.id);
  await f.invoke("jobs:confirm", { id: f.job.id, dryRun: false });
  if (fault === "replace") writeFileSync(image.path, "replacement-B");
  if (fault === "delete") unlinkSync(image.path);
  if (fault === "path") f.database.db.prepare("UPDATE media_assets SET file_path=? WHERE id=?").run(f02Image(f, "other.png").path, image.image.id);
  // Fault injection deliberately bypasses immutable triggers, then verifies digest checks too.
  if (fault === "object-corrupt") { f.database.db.exec("DROP TRIGGER content_object_no_update"); f.database.db.prepare("UPDATE content_objects SET bytes=?").run(Buffer.from("B")); }
  if (fault === "object-delete") { f.database.db.exec("DROP TRIGGER content_object_no_delete"); f.database.db.exec("DELETE FROM content_objects"); }
  await f.invoke("jobs:run"); expect(f.adapter.uploads).toHaveLength(0); expect(f.receipts).toHaveLength(0); expect(f.adapter.calls).toBe(0);
});
it.each(["source", "object"] as const)("F02 retains stable upload bytes when %s changes in the async upload window and blocks sending", async (fault) => {
  const f = await fixture(); const image = f02Image(f);
  f.database.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=? WHERE id=?").run(image.image.id, f.job.id);
  await f.invoke("jobs:confirm", { id: f.job.id, dryRun: false });
  f.adapter.beforeUpload = () => {
    if (fault === "source") writeFileSync(image.path, "B-after-bytes-acquired");
    else { f.database.db.exec("DROP TRIGGER content_object_no_update"); f.database.db.prepare("UPDATE content_objects SET bytes=?").run(Buffer.from("B")); }
  };
  await f.invoke("jobs:run");
  expect(f.adapter.uploads).toEqual([image.sha256]); expect(f.receipts).toHaveLength(0);
  expect(f.repository.getJob(f.job.id)?.status).toBe("NeedsReconciliation");
  expect(f.repository.getSubmissionBarrier(f.job.id)).not.toBeNull();
  await f.invoke("jobs:retry"); await f.invoke("jobs:run"); expect(f.adapter.uploads).toHaveLength(1);
});
it("F02 keeps raw text and explicit newline-only canonicalization", async () => {
  const f = await fixture(); f.repository.updateArticle(f.article.id, { title: "Title\r\nraw", body: "A\r\nB\u00a0 C  " });
  await f.invoke("jobs:confirm", { id: f.job.id, dryRun: false });
  const snap = f.repository.contentSnapshots.get(f.repository.getJob(f.job.id)!.contentBindingId!);
  expect(snap.rawBody).toBe("A\r\nB\u00a0 C  "); expect(snap.canonicalBody).toBe("A\nB\u00a0 C  ");
  expect(snap.rawBodySha256).not.toBe(snap.canonicalBodySha256);
  expect(snap.normalizationReasons).toEqual(["TITLE_CRLF_OR_CR_TO_LF", "BODY_CRLF_OR_CR_TO_LF"]);
  expect(() => f.database.db.prepare("UPDATE content_snapshots SET payload_json='{}' WHERE id=?").run(snap.id)).toThrow("IMMUTABLE_CONTENT_SNAPSHOT");
});
it.each(["title", "body", "account", "image"] as const)("F02 invalidates %s changes without modifying the old snapshot", async (field) => {
  const f = await fixture(); await f.invoke("jobs:confirm", { id: f.job.id, dryRun: false });
  const id = f.repository.getJob(f.job.id)!.contentBindingId!; const before = f.repository.contentSnapshots.get(id);
  if (field === "title" || field === "body") f.repository.updateArticle(f.article.id, { [field]: "Changed B" });
  if (field === "account") f.database.db.prepare("UPDATE publish_jobs SET account_id=? WHERE id=?").run(f.repository.createAccount({ platformKey: "test", name: "other", allowAutoPublish: true }).id, f.job.id);
  if (field === "image") f.database.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=? WHERE id=?").run(f02Image(f).image.id, f.job.id);
  await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(0); expect(f.repository.contentSnapshots.get(id)).toEqual(before);
});
it.each(["content_objects", "content_snapshots", "content_confirmations", "publish_jobs"] as const)("F02 rolls back the confirmation stage when %s write fails", async (table) => {
  const f = await fixture(); const image = f02Image(f); f.database.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=? WHERE id=?").run(image.image.id, f.job.id);
  const operation = table === "publish_jobs" ? "UPDATE" : "INSERT";
  f.database.db.exec(`CREATE TRIGGER injected BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'F02_STAGE_FAULT'); END`);
  await expect(f.invoke("jobs:confirm", { id: f.job.id, dryRun: false })).rejects.toThrow("F02_STAGE_FAULT");
  expect(f.database.db.prepare("SELECT * FROM content_snapshots").all()).toHaveLength(0);
  expect(f.database.db.prepare("SELECT * FROM content_confirmations").all()).toHaveLength(0);
  expect(f.repository.getJob(f.job.id)?.contentBindingId).toBeNull();
  const reopened = openDatabase(f.databasePath, join(process.cwd(), "packages/db/migrations"));
  try { expect(reopened.db.prepare("SELECT * FROM content_snapshots").all()).toHaveLength(0); } finally { reopened.db.close(); }
  expect(f.receipts).toHaveLength(0);
});
it("F02 rejects a symlink even when its target is inside the trusted library", async () => {
  const f = await fixture(); const image = f02Image(f); const link = join(f.dir, "linked.png"); symlinkSync(image.path, link);
  f.database.db.prepare("UPDATE media_assets SET file_path=? WHERE id=?").run(link, image.image.id);
  f.database.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=? WHERE id=?").run(image.image.id, f.job.id);
  await expect(f.invoke("jobs:confirm", { id: f.job.id, dryRun: false })).rejects.toThrow("CONTENT_ASSET_UNREADABLE_OR_NOT_ALLOWED");
  expect(f.adapter.uploads).toHaveLength(0);
});

async function f02OneShot(f: Awaited<ReturnType<typeof fixture>>) {
  const image = f02Image(f); const account = f.repository.createAccount({ platformKey: "xiaohongshu", name: "Synthetic", allowAutoPublish: false });
  f.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", externalAccountId: "creator-fixture", browserSessionId: "mock-only" });
  const run = await f.invoke("platform-self-test:request-one-shot-publish", { platformAccountId: account.id, payload: { platformKey: "xiaohongshu", accountId: account.id, creatorId: "creator-fixture", title: "Synthetic", body: "Synthetic body", imageAssetId: image.image.id, imageSha256: image.sha256 } }) as PlatformSelfTestRun;
  const authorization: OneShotPublicationAuthorization = { authorization: OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, state: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId: account.id as OneShotPublicationAuthorization["accountId"], operationId: run.testRunId, contentBindingId: run.contentBindingId!, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, publicationTransactionCount: 0, publicationCommitActionCount: 0, finalSubmitAttemptCount: 0, finalSubmitRetryCount: 0, finalSubmitActionStarted: false, finalSubmitActionCompleted: false, consumedAt: null };
  f.repository.confirmPlatformSelfTestOneShotAtomically(run.testRunId, authorization);
  const job = f.repository.createPlatformSelfTestPublishJob({ testRunId: run.testRunId, title: "Synthetic", body: "Synthetic body", dryRun: false, selectedImageAssetId: image.image.id, contentBindingId: run.contentBindingId });
  const record = f.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformKey: "xiaohongshu", articleId: job.articleId, publishedUrl: null, publishedExternalId: null, success: false, response: { prepared: true, synthetic: true }, dryRun: false, status: "Prepared" });
  f.repository.confirmJob(job.id, false);
  const intent = f.repository.prepareSubmissionIntent(job.id);
  const subject: XhsContextIdentityAttestation = { accountId: account.id, platformKey: "xiaohongshu", expectedExternalCreatorId: "creator-fixture", observedExternalCreatorId: "creator-fixture", externalAccountId: "creator-fixture", browserSessionIdentity: "mock-session", browserContextIdentity: "mock-context", sourcePageIdentity: "mock-page", sourceOrigin: "https://creator.xiaohongshu.com", sourcePathname: "/publish/publish", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60_000).toISOString(), verified: true };
  return { image, account, run, authorization, job, record, intent, subject };
}
it("F02 reads back the same one-shot authorization binding and commits all final facts once", async () => {
  const f = await fixture(); const x = await f02OneShot(f);
  expect(f.repository.getOneShotPublicationAuthorization(x.run.testRunId)?.contentBindingId).toBe(x.run.contentBindingId);
  expect(f.database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(0);
  expect(f.repository.startOneShotFinalMousePress(x.run.testRunId,x.account.id,"xiaohongshu",x.intent.id,x.subject)).toBe(true);
  expect(f.repository.startOneShotFinalMousePress(x.run.testRunId,x.account.id,"xiaohongshu",x.intent.id,x.subject)).toBe(false);
  expect(f.database.db.prepare("SELECT consumed FROM content_confirmations").all()).toEqual([{ consumed: 1 }]);
  expect(f.repository.getOneShotPublicationAuthorization(x.run.testRunId)?.finalSubmitAttemptCount).toBe(1);
  expect(f.receipts).toHaveLength(0); // Boundary occupied is not a mock send.
});
it.each(["operation", "run-job", "run-record", "auth-binding", "intent-binding", "record-binding", "identity-missing", "identity-other", "identity-expired", "identity-invalid-date"] as const)("F02 blocks one-shot %s mismatch at the persisted boundary", async (fault) => {
  const f = await fixture(); const x = await f02OneShot(f); let subject: XhsContextIdentityAttestation | undefined = x.subject;
  if (fault === "run-job") f.database.db.prepare("UPDATE platform_self_test_runs SET publish_job_id=? WHERE test_run_id=?").run(f.job.id,x.run.testRunId);
  if (fault === "run-record") f.database.db.prepare("UPDATE platform_self_test_runs SET publish_record_id=NULL WHERE test_run_id=?").run(x.run.testRunId);
  if (fault === "auth-binding") f.database.db.prepare("UPDATE one_shot_publication_authorizations SET content_binding_id=NULL").run();
  if (fault === "intent-binding") f.database.db.prepare("UPDATE submission_intents SET content_binding_id=NULL WHERE id=?").run(x.intent.id);
  if (fault === "record-binding") f.database.db.prepare("UPDATE publish_records SET content_binding_id=NULL WHERE id=?").run(x.record.id);
  if (fault === "identity-missing") subject = undefined;
  if (fault === "identity-other") subject = { ...x.subject, observedExternalCreatorId: "other" };
  if (fault === "identity-expired") subject = { ...x.subject, expiresAt: "2000-01-01" };
  if (fault === "identity-invalid-date") subject = { ...x.subject, issuedAt: "invalid" };
  expect(f.repository.startOneShotFinalMousePress(fault === "operation" ? "other" : x.run.testRunId,x.account.id,"xiaohongshu",x.intent.id,subject)).toBe(false);
  expect(f.database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(0);
  expect(f.database.db.prepare("SELECT consumed FROM content_confirmations").all()).toEqual([{ consumed: 0 }]);
  expect(f.repository.getOneShotPublicationAuthorization(x.run.testRunId)?.state).toBe("AUTHORIZED_UNUSED");
});
it.each(["content_confirmations", "submission_dispatch_claims", "submission_intents", "one_shot_publication_authorizations"] as const)("F02 rolls back final-stage %s fault, including after reopen", async (table) => {
  const f = await fixture(); const x = await f02OneShot(f);
  f.database.db.exec(`CREATE TRIGGER f02_final_fault BEFORE ${table === "submission_dispatch_claims" ? "INSERT" : "UPDATE"} ON ${table} BEGIN SELECT RAISE(ABORT,'F02_FINAL_FAULT'); END`);
  expect(f.repository.startOneShotFinalMousePress(x.run.testRunId,x.account.id,"xiaohongshu",x.intent.id,x.subject)).toBe(false);
  const reopened = openDatabase(f.databasePath, join(process.cwd(), "packages/db/migrations"));
  try {
    expect(reopened.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toHaveLength(0);
    expect(reopened.db.prepare("SELECT consumed FROM content_confirmations").all()).toEqual([{ consumed: 0 }]);
    expect(reopened.repository.getOneShotPublicationAuthorization(x.run.testRunId)?.state).toBe("AUTHORIZED_UNUSED");
    expect(reopened.repository.getSubmissionIntentByJob(x.job.id)?.finalSubmitCount).toBe(0);
  } finally { reopened.db.close(); }
});
it("F02 requires fresh explicit confirmation on a replacement Job and preserves Unknown across new snapshots", async () => {
  const f = await fixture(); await f.invoke("jobs:confirm", { id: f.job.id, dryRun: false });
  const oldId = f.repository.getJob(f.job.id)!.contentBindingId!;
  f.repository.updateArticle(f.article.id, { body: "B needs its own confirmation" });
  await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(0);
  const id = alternative(f); f.database.db.prepare("UPDATE publish_jobs SET manual_confirmation_required=1 WHERE id=?").run(id);
  await f.invoke("jobs:run", { id }); expect(f.receipts).toHaveLength(0);
  await f.invoke("jobs:confirm", { id, dryRun: false });
  expect(f.repository.getJob(id)?.contentBindingId).not.toBe(oldId);
  await f.invoke("jobs:run", { id }); expect(f.receipts).toHaveLength(1);
  const blocked = alternative(f); await f.invoke("jobs:confirm", { id: blocked, dryRun: false }); await f.invoke("jobs:run", { id: blocked });
  expect(f.receipts).toHaveLength(1); expect(f.repository.getSubmissionBarrier(blocked)).not.toBeNull();
});

it("F02 never revives an old confirmation after editing then restoring raw text", async () => {
 const f = await fixture(); await f.invoke("jobs:confirm", { id: f.job.id, dryRun: false });
 f.repository.updateArticle(f.article.id, { body: "changed" }); f.repository.updateArticle(f.article.id, { body: f.article.body });
 await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(0);
});
it("F02 ordinary reprepare creates a new version without mutating the original Job snapshot", async () => {
 const f = await fixture(); await f.invoke("jobs:confirm", { id: f.job.id, dryRun: false });
 const old = f.repository.getJob(f.job.id)!; f.repository.updateArticle(f.article.id, { body: "new version" });
 const replacement = f.repository.createArticlePublishJob({ articleId: f.article.id, platformKey: "test", platformAccountId: f.account.platformAccountId!, finalPublishMode: "CONFIRM_BEFORE_PUBLISH" });
 expect(replacement.id).not.toBe(old.id); expect(replacement.manualConfirmationRequired).toBe(true);
 expect(f.repository.getJob(old.id)?.contentBindingId).toBe(old.contentBindingId);
});

function automationMock(f: Awaited<ReturnType<typeof fixture>>, platformKey = "test") {
 const adapter = Object.assign(f.adapter, {
  platformKey,
  manifest: { ...f.adapter.manifest, platformKey, transport: "browser" as const, integrationMode: "BrowserAutomation" as const },
  automationType: "BrowserAutomation" as const,
  getCapabilities: () => ({ ...f.adapter.getCapabilities(), imagePost: true, maxImageCount: 1 }),
  connectAccount: async () => ({ sessionId: "mock", requiresUserAction: false }),
  checkSession: async () => "logged_in" as const,
  preparePublish: async (ctx: AccountContext, input: PublishArticleInput): Promise<AutomationPrepareResult> => {
   await f.adapter.uploadArticle(ctx, input);
   return { prepared: true, requiresUserAction: true, message: "mock prepared", titleFilled: true, bodyFilled: true, editorOpenedAt: new Date().toISOString(), response: { stage: "editor_prepared", browserExecutionMode: "VISIBLE", headless: false, titleReadbackValue: input.title, bodyReadbackValue: input.body, imageUploaded: true, uploadedImageSha256: f.adapter.uploads.at(-1), events: ["IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_PASSED"], imageUploadEvidence: { verified: true, requestedCount: 1, previewCount: 1, previewVisible: true, uploadBusyCount: 0 } } };
  }
 });
 // Capture the capability source before assigning it; no recursive fixture getter.
 adapter.getCapabilities = () => ({ ...new TestPlatformAdapter().getCapabilities(), imagePost: true, maxImageCount: 1 });
 if (platformKey !== "test") f.registry.register(adapter);
 return adapter;
}
it("F02 real ordinary prepare IPC binds upload, then confirmation and Publisher consume the same snapshot", async () => {
 const f = await fixture(); const image = f02Image(f); automationMock(f);
 f.database.db.prepare("UPDATE publish_jobs SET status='Cancelled' WHERE id=?").run(f.job.id);
 const result = await f.invoke("articles:prepare-publish", { articleId: f.article.id, platformKey: "test", platformAccountId: f.account.id, finalPublishMode: "CONFIRM_BEFORE_PUBLISH", selectedImageAssetId: image.image.id, imageSelectionMode: "manual" }) as { job: { id: string }; record: { contentBindingId: string } };
 expect(f.receipts).toHaveLength(0); expect(f.adapter.uploads).toEqual([image.sha256]);
 const binding = f.repository.contentSnapshots.get(result.record.contentBindingId); expect(binding.purpose).toBe("PRODUCTION"); expect(binding.operationId).toBeNull();
 expect(f.database.db.prepare("SELECT * FROM platform_self_test_runs").all()).toHaveLength(0);
 await f.invoke("jobs:run", { id: result.job.id }); expect(f.receipts).toHaveLength(0);
 await f.invoke("jobs:confirm", { id: result.job.id, dryRun: false }); f.accept(); await f.invoke("jobs:run", { id: result.job.id });
 expect(f.receipts).toHaveLength(1); expect(f.adapter.sendCalls).toBe(1); expect(f.repository.getJob(result.job.id)?.status).toBe("Success"); expect(f.adapter.uploads.every((hash) => hash === image.sha256)).toBe(true);
});
it.each(["success", "changed-after-upload", "record-write-fault", "article-insert", "article-bind", "job-insert", "job-bind", "run-link", "record-bind", "confirmation-insert"] as const)("F02 complete one-shot Main IPC to Publisher uses actual snapshot bytes: %s", async (fault) => {
 const f = await fixture(); const image = f02Image(f); const account = f.repository.createAccount({ platformKey: "xiaohongshu", name: "Main mock" });
 f.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", externalAccountId: "creator-fixture", browserSessionId: "mock-session" });
 const adapter = automationMock(f, "xiaohongshu");
 const subject: XhsContextIdentityAttestation = { accountId: account.id, platformKey: "xiaohongshu", expectedExternalCreatorId: "creator-fixture", observedExternalCreatorId: "creator-fixture", externalAccountId: "creator-fixture", browserSessionIdentity: "mock-session", browserContextIdentity: "mock-context", sourcePageIdentity: "mock-page", sourceOrigin: "https://creator.xiaohongshu.com", sourcePathname: "/publish/publish", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString(), verified: true };
 Object.assign(adapter, {
  readCanonicalCreatorIdentity: async () => ({ proof: { externalCreatorId: "creator-fixture", displayName: null, profileUrl: null, source: "CREATOR_ACCOUNT_SURFACE", stable: true }, runtimeAuthState: "AUTHENTICATED", browserConnected: true, pageClosed: false, pageUrlConsistency: "PASS", routeClass: "CREATOR_HOME", canonicalContextId: "mock-context", canonicalPageId: "mock-page", canonicalPageUrl: "https://creator.xiaohongshu.com/new/home", domLocationHref: "https://creator.xiaohongshu.com/new/home" }),
  finalSubmit: async (ctx: AccountContext, input: PublishArticleInput, attempt: BrowserPublishAttemptContext) => {
   const guard = attempt.oneShotPublicationGuard!; const a = guard.authorization;
   return guard.startFinalSubmit({ authorization: a.authorization, authorizationState: "AUTHORIZED_UNUSED", platformKey: "xiaohongshu", accountId: a.accountId, operationId: a.operationId, mode: a.mode, authenticated: true, sameCanonicalContext: true, sameCanonicalPage: true, mutexOwned: true, editorPhase: "IMAGE_POST_POST_UPLOAD_EDITOR", safeFixtureUploaded: true, titleReadbackVerified: true, bodyReadbackVerified: true, requiredFieldsPass: true, loginPagePresent: false, securityVerificationPresent: false, finalSubmitControl: { status: "FOUND_UNIQUE", visible: true, enabled: true, hitTestValid: true } }, async () => {
    f.adapter.sendCalls++; const result = await f.adapter.send({ ...ctx, settings: { ...ctx.settings, submissionOperationId: attempt.submissionIntentId } }, input); return { ...result, response: { ...result.response, imageUploaded: true } };
   });
  },
  verifyPublished: async (_ctx: AccountContext, _input: PublishArticleInput, result: PublishResult) => ({ status: "published", externalId: result.externalId, publishedUrl: result.publishedUrl, response: { mockObserved: true } }),
  getPublishStatus: async () => ({ status: "published", response: { mock: true } })
 });
 const logger = createConsoleLogger(); const publisher = new PublisherService(f.repository, f.registry, logger, { resolveRuntimeIdentityAttestation: () => subject });
 const credentials = { get: () => null, has: () => false, set: () => { throw new Error("forbidden"); }, delete: () => { throw new Error("forbidden"); } };
 registerIpc({ repository: f.repository, publisher, scheduler: new PersistentScheduler(f.repository,publisher,logger), registry: f.registry, resolveAccountSecrets: () => ({}), dataDirectory: f.dir, coverDir: f.dir, logger, credentials, aiCredentials: credentials, appLogPath: join(f.dir,"mock.log"), databasePath: f.databasePath });
 const handlers = new Map(transport.handlers); const invoke = (name: string, payload: unknown) => handlers.get(name)!({},payload);
 const run = await invoke("platform-self-test:request-one-shot-publish", { platformAccountId: account.id, payload: { platformKey: "xiaohongshu", accountId: account.id, creatorId: "creator-fixture", title: "Main snapshot", body: "Raw main body", imageAssetId: image.image.id, imageSha256: image.sha256 } }) as PlatformSelfTestRun;
 expect(f.receipts).toHaveLength(0); expect(f.adapter.uploads).toHaveLength(0);
 if (fault === "changed-after-upload") f.adapter.afterUpload = () => writeFileSync(image.path, "changed after actual mock upload");
 if (fault === "record-write-fault") f.database.db.exec("CREATE TRIGGER f02_main_fault BEFORE INSERT ON publish_records BEGIN SELECT RAISE(ABORT,'F02_RECORD_FAULT'); END");
 const stageFaults: Record<string, [string, string, string]> = { "article-insert": ["articles","INSERT",""], "article-bind": ["articles","UPDATE","WHEN NEW.content_binding_id IS NOT OLD.content_binding_id"], "job-insert": ["publish_jobs","INSERT",""], "job-bind": ["publish_jobs","UPDATE","WHEN NEW.content_binding_id IS NOT OLD.content_binding_id"], "run-link": ["platform_self_test_runs","UPDATE","WHEN NEW.publish_job_id IS NOT OLD.publish_job_id"], "record-bind": ["publish_records","UPDATE","WHEN NEW.content_binding_id IS NOT OLD.content_binding_id"], "confirmation-insert": ["content_confirmations","INSERT",""] };
 if (stageFaults[fault]) { const [table,operation,condition] = stageFaults[fault]!; f.database.db.exec(`CREATE TRIGGER stage_fault BEFORE ${operation} ON ${table} ${condition} BEGIN SELECT RAISE(ABORT,'F02_STAGE_FAULT'); END`); }
 f.accept(); await Promise.allSettled([invoke("platform-self-test:confirm-one-shot-publish", { testRunId: run.testRunId }),invoke("platform-self-test:confirm-one-shot-publish", { testRunId: run.testRunId })]);
 if (fault === "changed-after-upload") expect(f.database.db.prepare("SELECT * FROM content_snapshot_invalidations WHERE snapshot_id=?").all(run.contentBindingId)).toHaveLength(1);
 const final = f.repository.getPlatformSelfTestRun(run.testRunId)!; console.log("F02_MAIN_RESULT",JSON.stringify({ fault, final, uploadHashes: f.adapter.uploads, sendCalls: f.adapter.sendCalls, received: f.receipts.length }));
 expect(f.adapter.uploads).toEqual([image.sha256]); expect(f.receipts).toHaveLength(fault === "success" ? 1 : 0);
 if (fault === "success") { expect(f.repository.getJob(final.publishJobId!)?.status).toBe("Success"); expect(f.repository.getOneShotPublicationAuthorization(run.testRunId)?.finalSubmitAttemptCount).toBe(1); }
 else { expect(final.publishJobId).toBeNull(); expect(f.database.db.prepare("SELECT * FROM publish_records").all()).toHaveLength(0); expect(f.repository.getOneShotPublicationAuthorization(run.testRunId)?.state).toBe("AUTHORIZED_UNUSED"); }
});

it.each(["one_shot_content_bindings", "platform_self_test_runs", "content_objects", "content_snapshots", "platform_self_test_steps"] as const)("F02 request-stage %s fault leaves no executable partial binding", async (table) => {
 const f = await fixture(); const image = f02Image(f); const account = f.repository.createAccount({ platformKey: "xiaohongshu", name: "request fault" });
 f.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", externalAccountId: "creator", browserSessionId: "mock" });
 f.database.db.exec(`CREATE TRIGGER request_fault BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'REQUEST_FAULT'); END`);
 await expect(f.invoke("platform-self-test:request-one-shot-publish", { platformAccountId: account.id, payload: { platformKey: "xiaohongshu", accountId: account.id, creatorId: "creator", title: "raw", body: "raw", imageAssetId: image.image.id } })).rejects.toThrow("REQUEST_FAULT");
 const reopened = openDatabase(f.databasePath,join(process.cwd(),"packages/db/migrations"));
 try { for (const name of ["one_shot_content_bindings","platform_self_test_runs","content_objects","content_snapshots","one_shot_publication_authorizations"]) expect(reopened.db.prepare(`SELECT * FROM ${name}`).all()).toHaveLength(0); } finally { reopened.db.close(); }
 expect(f.adapter.uploads).toHaveLength(0); expect(f.receipts).toHaveLength(0);
});
it("F02 snapshots the selected variant and invalidates its edits persistently", async () => {
 const f = await fixture(); const variant = f.repository.createArticleVariant({ articleId: f.article.id, platformKey: "test", title: "Variant", body: "Variant body", summary: "", coverAssetId: null, contentHash: "variant" });
 f.database.db.prepare("UPDATE publish_jobs SET article_variant_id=? WHERE id=?").run(variant.id,f.job.id);
 await f.invoke("jobs:confirm",{ id:f.job.id,dryRun:false }); const snap = f.repository.contentSnapshots.get(f.repository.getJob(f.job.id)!.contentBindingId!);
 expect(snap.rawBody).toBe(variant.body); expect(snap.sourceVariantId).toBe(variant.id);
 f.database.db.prepare("UPDATE article_variants SET body='changed' WHERE id=?").run(variant.id);
 await f.invoke("jobs:run"); expect(f.receipts).toHaveLength(0); expect(f.repository.contentSnapshots.get(snap.id)).toEqual(snap);
});
it("F02 rejects a registered asset outside the database library root", async () => {
 const f = await fixture(); const other = await fixture(); const image = f02Image(other);
 const registered = f.repository.createImageAsset({ brandId: null, name:"outside",filePath:image.path,originalFileName:"outside.png",mimeType:"image/png",size:1 });
 f.database.db.prepare("UPDATE publish_jobs SET selected_image_asset_id=? WHERE id=?").run(registered.id,f.job.id);
 await expect(f.invoke("jobs:confirm",{id:f.job.id,dryRun:false})).rejects.toThrow("CONTENT_ASSET_UNREADABLE_OR_NOT_ALLOWED"); expect(f.adapter.uploads).toHaveLength(0);
});
it.each(["upgrade", "rollback"] as const)("F02 real 0026 to 0027 migration %s keeps legacy claims and grants no implicit eligibility", async (mode) => {
 const f = await fixture("0026"); const intentId = randomUUID();
 f.database.db.prepare("INSERT INTO submission_intents(id,job_id,account_id,article_id,platform_key,attempt,state,created_at,updated_at) VALUES(?,?,?,?,?,0,'Unknown',?,?)").run(intentId,f.job.id,f.account.id,f.article.id,"test",new Date().toISOString(),new Date().toISOString());
 f.database.db.prepare("INSERT INTO submission_dispatch_claims(intent_id,job_id,account_id,article_id,platform_key,state,claimed_at) VALUES(?,?,?,?,?,'Claimed',?)").run(intentId,f.job.id,f.account.id,f.article.id,"test",new Date().toISOString());
 const claims = f.database.db.prepare("SELECT * FROM submission_dispatch_claims").all();
 const migrations = join(process.cwd(),"packages/db/migrations");
 if (mode === "rollback") {
  const bad = join(f.dir,"faulty-0027");mkdirSync(bad);writeFileSync(join(bad,"0027_immutable_content_snapshots.sql"), readFileSync(join(migrations,"0027_immutable_content_snapshots.sql"),"utf8")+";SELECT * FROM missing_fault_table;");
  expect(() => runMigrations(f.database.db,bad)).toThrow("missing_fault_table");
  expect(f.database.db.prepare("SELECT * FROM sqlite_master WHERE name='content_snapshots'").all()).toHaveLength(0);
 }
 runMigrations(f.database.db,migrations);runMigrations(f.database.db,migrations);
 expect(f.database.db.prepare("SELECT * FROM submission_dispatch_claims").all()).toEqual(claims);expect(f.repository.getSubmissionBarrier(f.job.id)).not.toBeNull();
 expect(f.database.db.prepare("SELECT * FROM content_snapshots").all()).toHaveLength(0);
 expect(f.repository.consumeOneShotPublicationAuthorization("legacy",f.account.id,"xiaohongshu")).toBe(false);
 expect(f.receipts).toHaveLength(0);
});

it("F02 explicitly rejects multi-image snapshots unsupported by current Job selection", async () => {
 const f = await fixture(); const a = f02Image(f,"first.png"), b = f02Image(f,"second.png");
 expect(() => f.repository.contentSnapshots.capture({ purpose:"PRODUCTION", platformKey:"test", accountId:f.account.id, articleId:f.article.id, title:"A",body:"B",imageIds:[a.image.id,b.image.id] })).toThrow("CONTENT_IMAGE_COUNT_NOT_SUPPORTED");
 expect(f.database.db.prepare("SELECT * FROM content_snapshots").all()).toHaveLength(0); expect(f.receipts).toHaveLength(0);
});
it("F02 helper consumes a private byte copy even if caller buffer changes during await", async () => {
 const f = await fixture(); const a = f02Image(f); const buffer = Buffer.from(a.bytes); let consumed: Buffer | undefined;
 const handle = { evaluate: async (fn: (element: object, verifyBytes?: boolean) => unknown, verifyBytes?: boolean) => fn({tagName:"INPUT",type:"file",accept:"image/*",multiple:true,disabled:false,isConnected:true,className:"",files:consumed?[new File([Uint8Array.from(consumed)],"first.png",{type:"image/png"})]:[]},verifyBytes), setInputFiles:async (files: Array<{buffer:Buffer}>) => { consumed=files[0]!.buffer; } };
 const locator = { elementHandle: async () => { buffer.fill(0); return handle; } } as unknown as Parameters<typeof readXiaohongshuUploadInputImmediately>[0];
 const evidence = await readXiaohongshuUploadInputImmediately(locator,[a.path],undefined,undefined,[{assetId:a.image.id,name:"first.png",mimeType:"image/png",sha256:a.sha256,buffer}]);
 expect(evidence.status).toBe("PASS");expect(createHash("sha256").update(consumed!).digest("hex")).toBe(a.sha256);expect(evidence.uploadedByteSha256).toEqual([a.sha256]);
});
