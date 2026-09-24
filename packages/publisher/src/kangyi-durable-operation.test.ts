import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { openDatabase } from "@publisher/db";
import { kangyiSha256Utf8 } from "@publisher/domain";
import { imageFactsFromSnapshot, KangyiWebsiteAdapter } from "@publisher/adapters-kangyi-website";
import { KangyiDurableOperationRunner, type KangyiDurableOperationInput, type KangyiDurableOperationTransport, type KangyiMediaTransportResult } from "./kangyi-durable-operation";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const directories: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(withMedia = false): { repository: ReturnType<typeof openDatabase>["repository"]; intentId: string; jobId: string; article: NonNullable<ReturnType<ReturnType<typeof openDatabase>["repository"]["getArticle"]>>; input: KangyiDurableOperationInput } {
  const directory = mkdtempSync(join(tmpdir(), "kangyi-durable-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = database.repository.createBrand({ name: "康一 fixture", companyName: "康一 fixture" });
  const account = database.repository.createAccount({ platformKey: "kangyi_website", name: "康一 staging" });
  database.db.prepare("UPDATE accounts SET login_status='logged_in',connection_mode='OfficialAPI',authorization_status='Authorized',external_account_id='kangyi',publish_mode='manual',allow_auto_publish=0 WHERE id=?").run(account.id);
  const article = database.repository.createArticle({ brandId: brand.id, topic: "fixture", keyword: "fixture", city: "", title: "Durable title", body: "Durable body", summary: "Durable summary", tags: ["fixture"], seoKeywords: ["fixture"], articleType: "科普", aiProvider: "test", aiModel: "test", generatedAt: "2026-09-20T00:00:00.000Z", contentHash: "fixture-content-hash", reusePolicy: "once", qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("fixture article missing");
  database.db.prepare("UPDATE articles SET source='production' WHERE id=?").run(article.id);
  const imagePath = join(directory, "image.png");
  if (withMedia) writeFileSync(imagePath, Buffer.from([1, 2, 3]));
  const image = withMedia ? database.repository.createImageAsset({ brandId: brand.id, name: "fixture.png", filePath: imagePath, originalFileName: "fixture.png", mimeType: "image/png", size: 3 }) : null;
  const jobId = randomUUID();
  const timestamp = "2026-09-20T00:00:00.000Z";
  database.db.prepare("INSERT INTO publish_jobs (id,plan_id,account_id,platform_account_id,platform_key,article_id,article_variant_id,scheduled_at,status,max_attempts,created_at,dry_run,manual_confirmation_required,selected_image_asset_id,image_selection_mode,final_publish_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(jobId, null, account.id, account.id, "kangyi_website", article.id, null, timestamp, "Scheduled", 3, timestamp, 0, 1, image?.id ?? null, image ? "manual" : "none", "CONFIRM_BEFORE_PUBLISH");
  const job = database.repository.getJob(jobId);
  if (!job) throw new Error("fixture job missing");
  database.repository.confirmJob(job.id);
  database.repository.claimJob(job.id);
  const intent = database.repository.prepareSubmissionIntent(job.id);
  const contentBindingId = database.repository.getJob(job.id)?.contentBindingId;
  if (!contentBindingId) throw new Error("fixture content binding missing");
  const jsonBody = (value: unknown): { exactRequestBody: string; requestBodySha256: string } => { const exactRequestBody = JSON.stringify(value); return { exactRequestBody, requestBodySha256: kangyiSha256Utf8(exactRequestBody) }; };
  const input: KangyiDurableOperationInput = {
    binding: { intentId: intent.id, accountId: account.id, siteId: "kangyi", environment: "staging", snapshotId: contentBindingId, contentBindingId },
    ...(image ? { media: [{ assetId: image.id, idempotencyKey: "kangyi_media_fixture" }] } : {}),
    create: { ...jsonBody({ draft: { kind: "article", slug: "durable-title", title: "Durable title", blocks: [{ type: "paragraph", text: "Durable body" }] } }), idempotencyKey: "kangyi_create_fixture" },
    validate: { ...jsonBody({ revisionId: "revision-1" }), idempotencyKey: "kangyi_validate_fixture" },
    publish: { ...jsonBody({ revisionId: "revision-1", contentHash: "cms-content-hash", rowVersion: 1 }), idempotencyKey: "kangyi_publish_fixture" }
  };
  return { repository: database.repository, intentId: intent.id, jobId, article, input };
}

class FakeTransport implements KangyiDurableOperationTransport {
  readonly calls: Array<{ operation: string; key: string; body?: string }> = [];
  readonly uploadedBytes: Uint8Array[] = [];
  readonly storedContent = { contentId: "content-1", revisionId: "revision-1", rowVersion: 1, contentHash: "cms-content-hash" };
  readonly storedJob = { jobId: "cms-job-1", contentId: "content-1", revisionId: "revision-1", rowVersion: 1, contentHash: "cms-content-hash" };
  failOnce: "media" | "create" | "draft" | "validate" | "publish" | null = null;
  rejectedOnce: { operation: "media" | "create" | "draft" | "validate" | "publish"; status: number; code: string } | null = null;
  sideEffectBeforeFailure = false;
  jobStatuses: Array<"queued" | "processing" | "verifying" | "succeeded" | "failed" | "needs_attention"> = ["processing", "succeeded"];
  mediaResponseOverride: Partial<KangyiMediaTransportResult> = {};
  createResponseOverride: Partial<{ contentId: string; revisionId: string; rowVersion: number; contentHash: string }> = {};
  validationOverride: Partial<{ valid: boolean; revisionId: string; contentHash: string }> = {};
  publishResponseOverride: Partial<{ httpStatus: number; jobId: string; contentId: string; revisionId: string; rowVersion: number; contentHash: string }> = {};
  returnedJobId: string | null = null;
  publicReadbackMismatch = false;

  private maybeFail(operation: "media" | "create" | "draft" | "validate" | "publish"): void {
    if (this.rejectedOnce?.operation === operation) {
      const rejection = this.rejectedOnce;
      this.rejectedOnce = null;
      throw Object.assign(new Error(`rejected-${operation}`), { status: rejection.status, code: rejection.code });
    }
    if (this.failOnce !== operation) return;
    this.failOnce = null;
    throw new Error(`simulated-${operation}-transport-uncertain`);
  }
  async uploadMedia(input: Parameters<KangyiDurableOperationTransport["uploadMedia"]>[0]): Promise<Awaited<ReturnType<KangyiDurableOperationTransport["uploadMedia"]>>> {
    this.calls.push({ operation: "media", key: input.idempotencyKey });
    this.uploadedBytes.push(new Uint8Array(input.bytes));
    this.maybeFail("media");
    return { mediaId: "media-1", sha256: createHash("sha256").update(Buffer.from(input.bytes)).digest("hex"), mime: input.mime, width: 3, height: 1, bytes: input.bytes.byteLength, ...this.mediaResponseOverride };
  }
  async createContent(input: Parameters<KangyiDurableOperationTransport["createContent"]>[0]): Promise<Awaited<ReturnType<KangyiDurableOperationTransport["createContent"]>>> { this.calls.push({ operation: "create", key: input.idempotencyKey, body: input.exactRequestBody }); this.maybeFail("create"); return { ...this.storedContent, ...this.createResponseOverride }; }
  async saveDraft(input: Parameters<KangyiDurableOperationTransport["saveDraft"]>[0]): Promise<Awaited<ReturnType<KangyiDurableOperationTransport["saveDraft"]>>> { this.calls.push({ operation: "draft", key: input.idempotencyKey, body: input.exactRequestBody }); this.maybeFail("draft"); return { ...this.storedContent, revisionId: "revision-2", rowVersion: 2, contentHash: "cms-content-hash-draft" }; }
  async validate(input: Parameters<KangyiDurableOperationTransport["validate"]>[0]): Promise<Awaited<ReturnType<KangyiDurableOperationTransport["validate"]>>> { this.calls.push({ operation: "validate", key: input.idempotencyKey, body: input.exactRequestBody }); this.maybeFail("validate"); const draftWasSaved = this.calls.some((call) => call.operation === "draft"); return { valid: true, revisionId: draftWasSaved ? "revision-2" : "revision-1", contentHash: draftWasSaved ? "cms-content-hash-draft" : "cms-content-hash", ...this.validationOverride }; }
  async publish(input: Parameters<KangyiDurableOperationTransport["publish"]>[0]): Promise<Awaited<ReturnType<KangyiDurableOperationTransport["publish"]>>> { this.calls.push({ operation: "publish", key: input.idempotencyKey, body: input.exactRequestBody }); this.maybeFail("publish"); const draftWasSaved = this.calls.some((call) => call.operation === "draft"); return { httpStatus: 202, ...this.storedJob, ...(draftWasSaved ? { revisionId: "revision-2", rowVersion: 2, contentHash: "cms-content-hash-draft" } : {}), ...this.publishResponseOverride }; }
  async getJob(jobId: string): Promise<Awaited<ReturnType<KangyiDurableOperationTransport["getJob"]>>> { const status = this.jobStatuses.shift() ?? "succeeded"; return { jobId: this.returnedJobId ?? jobId, status, publicUrl: status === "succeeded" ? "https://www.kangyihb.com/articles/content-1" : null, verification: { fake: true } }; }
  async verifyPublic(input: { contentId: string; publicUrl: string }): Promise<{ ok: boolean; contentId: string; publicUrl: string; response: Record<string, unknown> }> { const contentId = this.publicReadbackMismatch ? "other-content" : input.contentId; return { ok: true, contentId, publicUrl: input.publicUrl, response: { exactContent: true, contentId, publicUrl: input.publicUrl } }; }
}

describe("Kangyi durable operation recovery", () => {
  it("uses immutable snapshot bytes, not a later source-path mutation, for media replay", async () => {
    const { repository, input } = fixture(true);
    const transport = new FakeTransport();
    transport.failOnce = "media";
    const runner = new KangyiDurableOperationRunner(repository, transport);
    const image = repository.contentSnapshots.get(input.binding.snapshotId).images[0];
    await expect(runner.run(input)).rejects.toThrow("simulated-media-transport-uncertain");
    writeFileSync(image.sourcePath, Buffer.from([9, 9, 9]));
    await expect(runner.run(input)).rejects.toThrow("CONTENT_SOURCE_BYTES_CHANGED");
    expect(Buffer.from(transport.uploadedBytes[0])).toEqual(Buffer.from([1, 2, 3]));
    expect(Buffer.from(transport.uploadedBytes[1])).toEqual(Buffer.from([1, 2, 3]));
    expect(transport.calls.filter((call) => call.operation === "media")).toHaveLength(2);
  });

  it("replays media/create with the same key and exact body after a response loss", async () => {
    const { repository, intentId, input } = fixture();
    const transport = new FakeTransport();
    transport.failOnce = "create";
    const runner = new KangyiDurableOperationRunner(repository, transport);
    await expect(runner.run(input)).rejects.toThrow("simulated-create-transport-uncertain");
    const beforeRestart = repository.getKangyiOperationMetadata(intentId);
    expect(beforeRestart?.create?.state).toBe("OUTCOME_UNKNOWN");
    const restartedRunner = new KangyiDurableOperationRunner(repository, transport);
    await expect(restartedRunner.resume(intentId, input)).resolves.toMatchObject({ status: "polling" });
    const createCalls = transport.calls.filter((call) => call.operation === "create");
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]).toEqual(createCalls[1]);
    expect(repository.getKangyiOperationMetadata(intentId)?.create?.exactRequestBody).toBe(input.create.exactRequestBody);
  });

  it("persists and replays the optional draft and validate payloads independently", async () => {
    const { repository, intentId, input } = fixture();
    const draftBody = JSON.stringify({ rowVersion: 1, draft: { kind: "article", slug: "durable-title", title: "Durable title", blocks: [{ type: "paragraph", text: "Durable body" }] } });
    const withDraft: KangyiDurableOperationInput = { ...input, draft: { idempotencyKey: "kangyi_draft_fixture", exactRequestBody: draftBody, requestBodySha256: kangyiSha256Utf8(draftBody) } };
    const transport = new FakeTransport();
    transport.failOnce = "validate";
    const runner = new KangyiDurableOperationRunner(repository, transport);
    await expect(runner.run(withDraft)).rejects.toThrow("simulated-validate-transport-uncertain");
    expect(repository.getKangyiOperationMetadata(intentId)?.validate?.state).toBe("OUTCOME_UNKNOWN");
    const restartedRunner = new KangyiDurableOperationRunner(repository, transport);
    await expect(restartedRunner.resume(intentId, withDraft)).resolves.toMatchObject({ status: "polling" });
    expect(transport.calls.filter((call) => call.operation === "draft")).toHaveLength(1);
    expect(transport.calls.filter((call) => call.operation === "validate")).toHaveLength(2);
    expect(transport.calls.filter((call) => call.operation === "validate")[0]).toEqual(transport.calls.filter((call) => call.operation === "validate")[1]);
    expect(repository.getKangyiOperationMetadata(intentId)?.draft?.exactRequestBody).toBe(draftBody);
  });

  it("claims only at publish, reuses the claim and key after publish transport uncertainty, and closes once", async () => {
    const { repository, intentId, input } = fixture();
    const transport = new FakeTransport();
    transport.failOnce = "publish";
    const runner = new KangyiDurableOperationRunner(repository, transport);
    await expect(runner.run(input)).rejects.toThrow("simulated-publish-transport-uncertain");
    const jobId = repository.getKangyiOperationMetadata(intentId)!.jobId;
    expect(repository.getSubmissionBarrier(jobId)?.intentId).toBe(intentId);
    const firstPublish = transport.calls.find((call) => call.operation === "publish");
    const restartedRunner = new KangyiDurableOperationRunner(repository, transport);
    await expect(restartedRunner.resume(intentId)).resolves.toMatchObject({ status: "polling" });
    const publishCalls = transport.calls.filter((call) => call.operation === "publish");
    expect(publishCalls).toHaveLength(2);
    expect(publishCalls[0]).toEqual(publishCalls[1]);
    expect(firstPublish).toBeDefined();
    await expect(restartedRunner.resume(intentId)).resolves.toMatchObject({ status: "complete" });
    expect(repository.getPublishRecordByJob(jobId)).toMatchObject({ status: "Published", publishedUrl: "https://www.kangyihb.com/articles/content-1" });
    expect(repository.db.prepare("SELECT COUNT(*) AS count FROM publish_records WHERE job_id=?").get(jobId)).toEqual({ count: 1 });
  });

  it("rejects replacing a persisted exact payload after the source article changes", async () => {
    const { repository, intentId, input } = fixture();
    repository.initializeKangyiOperation(input.binding);
    repository.prepareKangyiJsonOperation(intentId, "create", input.create);
    const changed = { ...input.create, exactRequestBody: JSON.stringify({ changed: true }), requestBodySha256: kangyiSha256Utf8(JSON.stringify({ changed: true })) };
    expect(() => repository.prepareKangyiJsonOperation(intentId, "create", changed)).toThrow("KANGYI_OPERATION_PAYLOAD_IMMUTABLE");
  });

  it("durably binds the one-article pilot slot to one intent even if another authorization ID is supplied", () => {
    const { repository, input, intentId } = fixture();
    repository.initializeKangyiOperation({ ...input.binding, pilotAuthorizationId: "single-owner-pilot" });
    const timestamp = new Date().toISOString();
    const secondIntentId = randomUUID();
    repository.db.prepare("INSERT INTO submission_intents (id,job_id,account_id,article_id,platform_key,attempt,state,created_at,updated_at,final_submit_count,content_binding_id) SELECT ?,job_id,account_id,article_id,platform_key,attempt+1,'Prepared',?,?,0,content_binding_id FROM submission_intents WHERE id=?").run(secondIntentId, timestamp, timestamp, intentId);
    expect(() => repository.initializeKangyiOperation({ ...input.binding, intentId: secondIntentId, pilotAuthorizationId: "single-owner-pilot" })).toThrow("KANGYI_PILOT_AUTHORIZATION_ALREADY_BOUND");
    expect(() => repository.initializeKangyiOperation({ ...input.binding, intentId: secondIntentId, pilotAuthorizationId: "different-owner-pilot" })).toThrow("KANGYI_PILOT_SLOT_ALREADY_CLAIMED");
    expect(repository.getKangyiOperationMetadata(intentId)?.pilotAuthorizationId).toBe("single-owner-pilot");
  });

  it("persists immutable prepared mapping on the existing PublishJob without source-path or live-Article dependency", () => {
    const { repository, article, input } = fixture(true);
    const sourceSnapshot = repository.contentSnapshots.get(input.binding.snapshotId);
    const preparedJobId = randomUUID();
    const timestamp = new Date().toISOString();
    repository.db.prepare("INSERT INTO publish_jobs (id,plan_id,account_id,platform_account_id,platform_key,article_id,article_variant_id,scheduled_at,status,max_attempts,created_at,dry_run,manual_confirmation_required,selected_image_asset_id,image_selection_mode,final_publish_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(preparedJobId, null, input.binding.accountId, input.binding.accountId, "kangyi_website", article.id, null, timestamp, "AwaitingConfirmation", 3, timestamp, 0, 1, sourceSnapshot.images[0]?.assetId ?? null, "manual", "PREPARE_ONLY");
    const preparedJob = repository.getJob(preparedJobId);
    if (!preparedJob) throw new Error("prepared job fixture missing");
    const snapshot = repository.contentSnapshots.ensureJob(preparedJob.id);
    const immutable = repository.contentSnapshots.historicalInput(snapshot, article.id);
    const adapter = new KangyiWebsiteAdapter();
    const prepared = adapter.prepareContent({ article, snapshot, account: { id: preparedJob.accountId, siteId: "kangyi", environment: "staging" }, kind: "article", imageFacts: imageFactsFromSnapshot(snapshot, immutable.boundImages ?? [], article.brandId) });
    const persisted = repository.saveKangyiPreparedContent(preparedJob.id, prepared);
    expect(repository.getKangyiPreparedContent(preparedJob.id)).toEqual(persisted);
    expect(persisted.prepared.imageBindings[0]).toMatchObject({ assetId: snapshot.images[0]?.assetId, snapshotSha256: snapshot.images[0]?.sha256, mediaId: null });
    expect(() => repository.saveKangyiPreparedContent(preparedJob.id, { ...prepared, draftPreview: { ...prepared.draftPreview, title: "changed after prepare" } })).toThrow("KANGYI_PREPARED_CONTENT_IMMUTABLE");
    repository.updateArticle(article.id, { title: "Article mutated after prepare" });
    expect(repository.getKangyiPreparedContent(preparedJob.id)?.prepared.draftPreview.title).toBe(prepared.draftPreview.title);
  });

  it("stops on CMS media hash mismatch before content creation", async () => {
    const { repository, intentId, input } = fixture(true);
    const transport = new FakeTransport();
    transport.mediaResponseOverride = { sha256: "wrong-hash" };
    await expect(new KangyiDurableOperationRunner(repository, transport).run(input)).rejects.toThrow("KANGYI_MEDIA_RESPONSE_MISMATCH");
    expect(transport.calls.some((call) => call.operation === "create")).toBe(false);
    expect(repository.getKangyiOperationMetadata(intentId)?.phase).toBe("FAILED");
  });

  it("stops permanently on validation=false and never reaches publish", async () => {
    const { repository, intentId, input } = fixture();
    const transport = new FakeTransport();
    transport.validationOverride = { valid: false };
    const runner = new KangyiDurableOperationRunner(repository, transport);
    await expect(runner.run(input)).rejects.toThrow("KANGYI_VALIDATION_FAILED");
    await expect(runner.run(input)).resolves.toMatchObject({ status: "failed" });
    expect(transport.calls.some((call) => call.operation === "publish")).toBe(false);
    expect(repository.getKangyiOperationMetadata(intentId)?.phase).toBe("FAILED");
  });

  it("stops on unexpected publish status without polling or resending", async () => {
    const { repository, input } = fixture();
    const transport = new FakeTransport();
    transport.publishResponseOverride = { httpStatus: 200 };
    const runner = new KangyiDurableOperationRunner(repository, transport);
    await expect(runner.run(input)).rejects.toThrow("KANGYI_PUBLISH_MUST_RETURN_202");
    await expect(runner.run(input)).resolves.toMatchObject({ status: "failed" });
    expect(transport.calls.filter((call) => call.operation === "publish")).toHaveLength(1);
  });

  it("fails closed on server authentication rejection instead of treating it as uncertain transport", async () => {
    const { repository, intentId, input } = fixture();
    const transport = new FakeTransport();
    transport.rejectedOnce = { operation: "create", status: 403, code: "SCOPE_DENIED" };
    const runner = new KangyiDurableOperationRunner(repository, transport);
    await expect(runner.run(input)).rejects.toMatchObject({ status: 403, code: "SCOPE_DENIED" });
    await expect(runner.run(input)).resolves.toMatchObject({ status: "failed" });
    expect(transport.calls.filter((call) => call.operation === "create")).toHaveLength(1);
    expect(repository.getKangyiOperationMetadata(intentId)?.phase).toBe("FAILED");
  });

  it("stops on CMS job identity and public readback mismatch", async () => {
    const first = fixture();
    const firstTransport = new FakeTransport();
    firstTransport.returnedJobId = "different-cms-job";
    await expect(new KangyiDurableOperationRunner(first.repository, firstTransport).run(first.input)).rejects.toThrow("KANGYI_CMS_JOB_ID_MISMATCH");
    expect(first.repository.getKangyiOperationMetadata(first.intentId)?.phase).toBe("FAILED");

    const second = fixture();
    const secondTransport = new FakeTransport();
    secondTransport.jobStatuses = ["succeeded"];
    secondTransport.publicReadbackMismatch = true;
    await expect(new KangyiDurableOperationRunner(second.repository, secondTransport).run(second.input)).rejects.toThrow("PUBLIC_READBACK_MISMATCH");
    expect(second.repository.getPublishRecordByJob(second.repository.getKangyiOperationMetadata(second.intentId)!.jobId)).toBeNull();
  });
});
