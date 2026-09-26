import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AdapterRegistry } from "@publisher/adapters-core";
import { CmsWebsiteAdapter, imageFactsFromSnapshot } from "@publisher/adapters-kangyi-website";
import { CmsV2Client } from "@publisher/cms-v2-client";
import { openDatabase } from "@publisher/db";
import { kangyiSha256Utf8 } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { CmsV2OperationTransport, PublisherService } from "@publisher/publisher";

const siteId = process.env.GEO_PILOT_SITE_ID;
const origin = process.env.GEO_PILOT_ORIGIN;
const keyId = process.env.GEO_PILOT_KEY_ID;
const secretFile = process.env.GEO_PILOT_SECRET_FILE;
const privateDir = process.env.GEO_PILOT_PRIVATE_DIR;
if (!siteId || !["huiquan", "shupai"].includes(siteId) || !origin || !keyId || !secretFile || !privateDir) throw new Error("GEO staging pilot configuration incomplete");
if (!origin.startsWith("https://")) throw new Error("GEO staging pilot requires HTTPS");
const runId = randomUUID();
const directory = resolve(privateDir, `${siteId}-${runId}`);
mkdirSync(directory, { recursive: true });
const receiptPath = join(directory, "receipt.json");
const receipt: Record<string, unknown> = { siteId, origin, runId, startedAt: new Date().toISOString(), stages: [], result: "RUNNING" };
const save = (stage: string, details: Record<string, unknown> = {}) => {
  (receipt.stages as Array<Record<string, unknown>>).push({ stage, at: new Date().toISOString(), ...details });
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  process.stdout.write(`${siteId} ${stage}=PASS\n`);
};

function png(): Buffer {
  const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const name = Buffer.from(type, "ascii");
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0); header.writeUInt32BE(20, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(32 * 3, 120)]);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 20 }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

const secret = readFileSync(secretFile, "utf8").trim();
const config = { origin, siteId, environment: "staging" as const, keyId, secret, maxRetries: 0, timeoutMs: 30_000 };
const client = new CmsV2Client(config);
const transport = new CmsV2OperationTransport(config);
const database = openDatabase(join(directory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
const repository = database.repository;
let contentId: string | null = null;
let publicUrl: string | null = null;
let mediaId: string | null = null;
let primaryError: unknown = null;
let cleanupError: unknown = null;

async function pollJob(jobId: string): Promise<void> {
  const result = await client.waitForJob(jobId, { maxPolls: 90, intervalMs: 1000 });
  if (result.data.status !== "succeeded") throw new Error(`CMS cleanup job ${jobId} ended ${result.data.status}`);
}

async function cleanupPublishedFixture(): Promise<void> {
  if (!contentId) {
    const found = await client.listContents({ kind: "article", status: "active", externalId: `geo-${runId}` });
    if (found.data.total > 1) throw new Error("GEO_PILOT_CREATE_RECONCILIATION_AMBIGUOUS");
    if (found.data.total === 1) contentId = found.data.items[0]?.id ?? null;
  }
  if (!contentId) return;
  let current = (await client.getContent(contentId)).data;
  if (current.publishedRevisionId) {
    const unpublish = await client.unpublish(contentId, { rowVersion: current.rowVersion, expectedPublishedRevisionId: current.publishedRevisionId }, `geo_${randomUUID()}`);
    if (unpublish.httpStatus !== 202) throw new Error("GEO_PILOT_UNPUBLISH_NOT_QUEUED");
    await pollJob(unpublish.data.jobId);
    save("unpublish", { jobId: unpublish.data.jobId });
    current = (await client.getContent(contentId)).data;
  }
  if (!current.deletedAt) {
    const deletion = await client.deleteContent(contentId, { rowVersion: current.rowVersion, expectedPublishedRevisionId: current.publishedRevisionId, reason: "GEO staging 系统验收结束后清理临时内容" }, `geo_${randomUUID()}`);
    if (deletion.httpStatus !== 202) throw new Error("GEO_PILOT_DELETE_NOT_QUEUED");
    await pollJob(deletion.data.jobId);
    save("soft_delete", { jobId: deletion.data.jobId });
  }
  if (publicUrl && (await fetch(publicUrl)).status !== 404) throw new Error("GEO_PILOT_PUBLIC_RESIDUE");
  const active = await client.listContents({ kind: "article", status: "active", externalId: `geo-${runId}` });
  if (active.data.total !== 0) throw new Error("GEO_PILOT_ACTIVE_RESIDUE");
  save("cleanup_verified", { activeCount: active.data.total });
}

try {
  const capability = await client.capabilities();
  if (capability.httpStatus !== 200 || capability.data.siteId !== siteId || capability.data.environment !== "staging" || capability.data.protocolVersion !== "2" || !capability.data.writesEnabled) throw new Error("CMS_CAPABILITIES_SCOPE_MISMATCH");
  save("capabilities");
  repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = repository.createBrand({ name: `${siteId} GEO 系统验收`, companyName: `${siteId} GEO 系统验收` });
  const account = repository.createAccount({ platformKey: `${siteId}_website`, name: `${siteId} staging pilot` });
  database.db.prepare("UPDATE accounts SET login_status='logged_in',connection_mode='OfficialAPI',authorization_status='Authorized',external_account_id=?,publish_mode='manual',allow_auto_publish=0 WHERE id=?").run(siteId, account.id);
  const title = `[系统验收] GEO ${siteId} staging`;
  const body = "这是一条临时接口验收内容，不是企业文章或实际客户案例。验收完成后将撤稿并软删除。";
  const article = repository.createArticle({ brandId: brand.id, topic: "系统验收", keyword: "系统验收", city: "苏州", title, body, summary: "GEO 官网适配器 staging 临时验收内容，验收后撤稿并软删除。", tags: ["系统验收"], seoKeywords: ["系统验收"], articleType: "系统验收", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), contentHash: createHash("sha256").update(body).digest("hex"), reusePolicy: "once", qualityStatus: "passed", qualityWarnings: [], source: "production" });
  if (!article) throw new Error("GEO_PILOT_ARTICLE_MISSING");
  const imagePath = join(directory, "fixture.png");
  const imageBytes = png();
  writeFileSync(imagePath, imageBytes);
  const image = repository.createImageAsset({ brandId: brand.id, name: "系统验收场景示意图", filePath: imagePath, originalFileName: "fixture.png", mimeType: "image/png", size: imageBytes.length });
  const jobId = randomUUID();
  const timestamp = new Date().toISOString();
  database.db.prepare("INSERT INTO publish_jobs (id,plan_id,account_id,platform_account_id,platform_key,article_id,article_variant_id,scheduled_at,status,max_attempts,created_at,dry_run,manual_confirmation_required,selected_image_asset_id,image_selection_mode,final_publish_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(jobId, null, account.id, account.id, `${siteId}_website`, article.id, null, timestamp, "Scheduled", 3, timestamp, 0, 1, image.id, "manual", "CONFIRM_BEFORE_PUBLISH");
  repository.confirmJob(jobId);
  repository.claimJob(jobId);
  const intent = repository.prepareSubmissionIntent(jobId);
  const contentBindingId = repository.getJob(jobId)?.contentBindingId;
  if (!contentBindingId) throw new Error("GEO_PILOT_SNAPSHOT_MISSING");
  const snapshot = repository.contentSnapshots.get(contentBindingId);
  const immutable = repository.contentSnapshots.historicalInput(snapshot, article.id);
  const adapter = new CmsWebsiteAdapter({ siteId: siteId as "huiquan" | "shupai" });
  const slug = `geo-system-acceptance-${siteId}-${Date.now()}`;
  const prepared = adapter.prepareContent({ article, snapshot, account: { id: account.id, siteId, environment: "staging" }, approvedSlug: slug, imageFacts: imageFactsFromSnapshot(snapshot, immutable.boundImages ?? [], article.brandId) });
  const phase2Authorization = { enabled: true, authorizationId: `geo-${runId}`, accountId: account.id, siteId, environment: "staging" as const, writesEnabled: capability.data.writesEnabled, capabilitiesHttpStatus: capability.httpStatus, protocolVersion: capability.data.protocolVersion, contentKinds: capability.data.contentKinds };
  const service = new PublisherService(repository, new AdapterRegistry(), createConsoleLogger());
  const binding = { intentId: intent.id, accountId: account.id, siteId, environment: "staging" as const, snapshotId: contentBindingId, contentBindingId };
  const operation = (value: unknown) => { const exactRequestBody = JSON.stringify(value); return { exactRequestBody, requestBodySha256: kangyiSha256Utf8(exactRequestBody), idempotencyKey: `geo_${randomUUID()}` }; };
  const uploaded = await service.executeWebsiteDurableOperation({ binding, media: [{ assetId: image.id, idempotencyKey: `geo_${randomUUID()}` }], phase2Authorization }, transport);
  if (uploaded.status !== "awaiting_input" || uploaded.metadata.media.length !== 1 || !uploaded.metadata.media[0]?.mediaId) throw new Error("GEO_PILOT_MEDIA_STAGE_INVALID");
  mediaId = uploaded.metadata.media[0].mediaId;
  save("media_upload", { mediaId, sha256: uploaded.metadata.media[0].serverSha256, idempotencyKey: uploaded.metadata.media[0].idempotencyKey });
  const draft = adapter.bindPreparedMedia(prepared, { [image.id]: mediaId });
  const created = await service.resumeWebsiteDurableOperation(intent.id, transport, phase2Authorization, { create: operation({ externalId: `geo-${runId}`, draft }) });
  contentId = String(created.metadata.create?.responseIdentity?.contentId ?? "");
  if (created.status !== "awaiting_input" || !contentId) throw new Error("GEO_PILOT_CREATE_STAGE_INVALID");
  save("create", { contentId, revisionId: created.metadata.create?.responseIdentity?.revisionId, contentHash: created.metadata.create?.responseIdentity?.contentHash, rowVersion: created.metadata.create?.responseIdentity?.rowVersion, idempotencyKey: created.metadata.create?.idempotencyKey });
  const saved = await service.resumeWebsiteDurableOperation(intent.id, transport, phase2Authorization, { draft: operation({ rowVersion: created.metadata.create!.responseIdentity!.rowVersion, draft }) });
  if (saved.status !== "awaiting_input" || !saved.metadata.draft?.responseIdentity) throw new Error("GEO_PILOT_SAVE_STAGE_INVALID");
  save("save_draft", { revisionId: saved.metadata.draft.responseIdentity.revisionId, contentHash: saved.metadata.draft.responseIdentity.contentHash, rowVersion: saved.metadata.draft.responseIdentity.rowVersion, idempotencyKey: saved.metadata.draft.idempotencyKey });
  const validated = await service.resumeWebsiteDurableOperation(intent.id, transport, phase2Authorization, { validate: operation({ revisionId: saved.metadata.draft.responseIdentity.revisionId }) });
  if (validated.status !== "awaiting_input" || validated.metadata.validate?.responseIdentity?.valid !== true) throw new Error("GEO_PILOT_VALIDATE_STAGE_INVALID");
  save("validate", { revisionId: validated.metadata.validate.responseIdentity.revisionId, contentHash: validated.metadata.validate.responseIdentity.contentHash, idempotencyKey: validated.metadata.validate.idempotencyKey });
  const published = await service.resumeWebsiteDurableOperation(intent.id, transport, phase2Authorization, { publish: operation({ revisionId: saved.metadata.draft.responseIdentity.revisionId, contentHash: saved.metadata.draft.responseIdentity.contentHash, rowVersion: saved.metadata.draft.responseIdentity.rowVersion }) });
  if (published.status !== "polling" || !published.metadata.publish?.cmsJobId) throw new Error("GEO_PILOT_PUBLISH_NOT_QUEUED");
  save("publish_queued", { jobId: published.metadata.publish.cmsJobId, idempotencyKey: published.metadata.publish.idempotencyKey });
  let final = published;
  for (let index = 0; index < 90 && final.status === "polling"; index += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    final = await service.resumeWebsiteDurableOperation(intent.id, transport, phase2Authorization);
  }
  if (final.status !== "complete" || !final.metadata.poll?.publicUrl || !final.recordId) throw new Error(`GEO_PILOT_NOT_VERIFIED_${final.status}`);
  publicUrl = final.metadata.poll.publicUrl;
  save("public_verifier", { publicUrl, recordId: final.recordId, jobId: final.metadata.publish?.cmsJobId, contentId, revisionId: final.metadata.publish?.responseIdentity?.revisionId, contentHash: final.metadata.publish?.responseIdentity?.contentHash, rowVersion: final.metadata.publish?.responseIdentity?.rowVersion });
  receipt.result = "PASS_BEFORE_CLEANUP";
} catch (error) {
  primaryError = error;
  receipt.result = "FAIL";
  receipt.error = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
} finally {
  try { await cleanupPublishedFixture(); }
  catch (error) {
    cleanupError = error;
    receipt.cleanupError = error instanceof Error ? `${error.name}: ${error.message}` : "unknown cleanup error";
  }
  database.db.close();
  receipt.finishedAt = new Date().toISOString();
  if (!primaryError && !cleanupError && receipt.result === "PASS_BEFORE_CLEANUP") receipt.result = "PASS";
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ siteId, result: receipt.result, runId, contentId, mediaId, publicUrl, receiptPath, cleanup: cleanupError ? "FAIL" : "PASS" }) + "\n");
}
if (primaryError || cleanupError) process.exitCode = 1;
