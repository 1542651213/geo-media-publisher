import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, lstatSync, openSync, closeSync, fstatSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import type { ContentSnapshot, PublishArticleInput, XhsContextIdentityAttestation } from "@publisher/domain";

type Row = Record<string, unknown>;
const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const fail = (message: string): never => { throw Object.assign(new Error(message), { code: "USER_ACTION_REQUIRED" }); };
const text = (value: unknown): string => typeof value === "string" ? value : "";

/** Trusted DB registered assets only. No arbitrary path from Renderer; no symlink traversal. */
export class ContentSnapshots {
  constructor(private readonly db: Database.Database) {}
  private row(table: "publish_jobs" | "articles" | "article_variants" | "accounts" | "media_assets", id: string): Row {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Row | undefined;
    return row ?? fail("CONTENT_SOURCE_MISSING");
  }
  private readAsset(id: string): { asset: Row; bytes: Buffer; path: string } {
    const asset = this.row("media_assets", id);
    const path = text(asset.file_path);
    const metadata = JSON.parse(text(asset.metadata_json) || "{}") as Row;
    if (asset.type !== "image" || metadata.enabled === false || !isAbsolute(path)) fail("CONTENT_ASSET_NOT_ALLOWED");
    try {
      const root = dirname(resolve(this.db.name));
      const rel = relative(root, resolve(path));
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail("CONTENT_ASSET_OUTSIDE_LIBRARY");
      const before = lstatSync(path);
      if (realpathSync(path).toLowerCase() !== resolve(path).toLowerCase() || !before.isFile() || before.nlink !== 1 || before.size > 32 * 1024 * 1024) fail("CONTENT_ASSET_LINK_OR_SIZE_REJECTED");
      const fd = openSync(path, "r");
      try {
        const opened = fstatSync(fd); const after = lstatSync(path);
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.dev !== after.dev || opened.ino !== after.ino || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) fail("CONTENT_ASSET_CHANGED_DURING_OPEN");
        const bytes = readFileSync(fd); const finished = fstatSync(fd); const current = lstatSync(path);
        if (finished.size !== opened.size || finished.mtimeMs !== opened.mtimeMs || finished.ino !== current.ino || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) fail("CONTENT_ASSET_CHANGED_DURING_READ");
        return { asset: { ...asset, original_file_name: metadata.originalFileName, mime_type: metadata.mimeType }, bytes, path: resolve(path) };
      } finally { closeSync(fd); }
    } catch { return fail("CONTENT_ASSET_UNREADABLE_OR_NOT_ALLOWED"); }
  }
  capture(input: { id?: string; purpose: ContentSnapshot["purpose"]; platformKey: string; accountId: string; creatorId?: string | null; articleId?: string | null; variantId?: string | null; operationId?: string | null; title: string; body: string; summary?: string; tags?: string[]; imageIds: string[]; expectedImageSha256?: string | null }): { snapshot: ContentSnapshot; objects: Array<{ sha256: string; bytes: Buffer }> } {
    if (input.imageIds.length > 1) fail("CONTENT_IMAGE_COUNT_NOT_SUPPORTED");
    const images = input.imageIds.map((id) => this.readAsset(id));
    const objects = images.map((image) => ({ sha256: digest(image.bytes), bytes: image.bytes }));
    if (input.expectedImageSha256 && input.expectedImageSha256.toLowerCase() !== objects[0]?.sha256) fail("CONTENT_IMAGE_HASH_MISMATCH");
    const canonicalTitle = input.title.replace(/\r\n?/gu, "\n");
    const canonicalBody = input.body.replace(/\r\n?/gu, "\n");
    return { objects, snapshot: {
      id: input.id ?? randomUUID(), purpose: input.purpose, platformKey: input.platformKey, contentType: "article", accountId: input.accountId,
      creatorId: input.creatorId ?? null, subjectEvidence: "DATABASE_ONLY_NOT_RUNTIME_VERIFIED", sourceArticleId: input.articleId ?? null, sourceVariantId: input.variantId ?? null, operationId: input.operationId ?? null,
      rawTitle: input.title, rawBody: input.body, rawTitleSha256: digest(input.title), rawBodySha256: digest(input.body), canonicalTitle, canonicalBody,
      canonicalTitleSha256: digest(canonicalTitle), canonicalBodySha256: digest(canonicalBody), normalizationVersion: "line-endings-v1",
      normalizationReasons: [...(canonicalTitle !== input.title ? ["TITLE_CRLF_OR_CR_TO_LF"] : []), ...(canonicalBody !== input.body ? ["BODY_CRLF_OR_CR_TO_LF"] : [])], summary: input.summary ?? "", tags: input.tags ?? [],
      images: images.map((image, index) => ({ assetId: input.imageIds[index]!, sourcePath: image.path, sha256: objects[index]!.sha256, name: text(image.asset.original_file_name), mimeType: text(image.asset.mime_type) }))
    } };
  }
  save(captured: ReturnType<ContentSnapshots["capture"]>): ContentSnapshot {
    return this.db.transaction(() => {
      for (const object of captured.objects) {
        this.db.prepare("INSERT OR IGNORE INTO content_objects VALUES (?,?,?)").run(object.sha256, object.bytes, new Date().toISOString());
        const stored = this.db.prepare("SELECT bytes FROM content_objects WHERE sha256=?").get(object.sha256) as { bytes: Buffer };
        if (digest(stored.bytes) !== object.sha256) fail("CONTENT_OBJECT_HASH_MISMATCH");
      }
      const encoded = JSON.stringify(captured.snapshot);
      this.db.prepare("INSERT INTO content_snapshots VALUES (?,?,?,?,?)").run(captured.snapshot.id, captured.snapshot.purpose, encoded, digest(encoded), new Date().toISOString());
      return captured.snapshot;
    }).immediate();
  }
  get(id: string): ContentSnapshot {
    const row = this.db.prepare("SELECT * FROM content_snapshots WHERE id=?").get(id) as Row | undefined;
    if (!row || digest(text(row.payload_json)) !== row.payload_sha256) return fail("CONTENT_SNAPSHOT_MISSING_OR_CORRUPT");
    const snapshot = JSON.parse(text(row.payload_json)) as ContentSnapshot;
    if (snapshot.id !== id || snapshot.purpose !== row.purpose) fail("CONTENT_SNAPSHOT_RELATION_MISMATCH");
    return snapshot;
  }
  private jobSource(id: string) {
    const job = this.row("publish_jobs", id); const article = this.row("articles", text(job.article_id));
    const variant = job.article_variant_id ? this.row("article_variants", text(job.article_variant_id)) : null;
    if (variant && (variant.article_id !== article.id || variant.platform_key !== job.platform_key)) fail("CONTENT_VARIANT_SOURCE_MISMATCH");
    const account = this.row("accounts", text(job.account_id));
    return { job, article, variant, account };
  }
  ensureJob(id: string): ContentSnapshot {
    const { job, article, variant, account } = this.jobSource(id);
    if (job.content_binding_id) { this.assertCurrent(id); return this.get(text(job.content_binding_id)); }
    if (job.content_kind === "video") return fail("CONTENT_SNAPSHOT_VIDEO_NOT_SUPPORTED");
    if (job.platform_key === "xiaohongshu" && JSON.parse(text(job.publish_payload_json) || "{}").selfTestRunId) return fail("LEGACY_TEST_CONTENT_BINDING_NOT_AUTHORIZED");
    if (variant?.cover_asset_id || article.cover_asset_id) fail("CONTENT_COVER_SNAPSHOT_NOT_SUPPORTED");
    const captured = this.capture({ purpose: "PRODUCTION", platformKey: text(job.platform_key), accountId: text(job.account_id), creatorId: text(account.external_account_id) || null, articleId: text(job.article_id), variantId: text(job.article_variant_id) || null, title: text(variant?.title ?? article.title), body: text(variant?.body ?? article.body), summary: text(variant?.summary ?? article.summary), tags: JSON.parse(text(article.tags_json) || "[]") as string[], imageIds: job.selected_image_asset_id ? [text(job.selected_image_asset_id)] : [] });
    return this.db.transaction(() => {
      const current = this.row("publish_jobs", id);
      if (current.content_binding_id) return this.assertCurrent(id);
      this.save(captured);
      this.db.prepare("UPDATE publish_jobs SET content_binding_id=? WHERE id=?").run(captured.snapshot.id, id);
      return this.assertCurrent(id);
    }).immediate();
  }
  invalidate(jobId: string, reason: string): void {
    const job = this.row("publish_jobs", jobId);
    this.db.prepare("INSERT OR IGNORE INTO content_snapshot_invalidations SELECT id,?,? FROM content_snapshots WHERE id=?").run(reason, new Date().toISOString(), job.content_binding_id ?? null);
  }
  assertCurrent(jobId: string): ContentSnapshot {
    const { job, article, variant, account } = this.jobSource(jobId);
    const snapshot = this.get(text(job.content_binding_id));
    if (this.db.prepare("SELECT 1 FROM content_snapshot_invalidations WHERE snapshot_id=?").get(snapshot.id)) fail("CONTENT_CHANGED_PREPARE_AGAIN");
    if (account.platform_key !== job.platform_key || snapshot.accountId !== job.account_id || snapshot.platformKey !== job.platform_key || snapshot.creatorId !== (text(account.external_account_id) || null)) fail("CONTENT_SUBJECT_CHANGED");
    if (snapshot.purpose === "ONE_SHOT_ACCEPTANCE" && article.content_binding_id !== snapshot.id) fail("CONTENT_ARTICLE_BINDING_MISMATCH");
    if (snapshot.purpose === "PRODUCTION" && (snapshot.sourceArticleId !== job.article_id || snapshot.sourceVariantId !== (job.article_variant_id ?? null))) fail("CONTENT_SOURCE_CHANGED");
    if (snapshot.rawTitle !== text(variant?.title ?? article.title) || snapshot.rawBody !== text(variant?.body ?? article.body) || snapshot.summary !== text(variant?.summary ?? article.summary) || JSON.stringify(snapshot.tags) !== (text(article.tags_json) || "[]")) fail("CONTENT_CHANGED_CONFIRM_AGAIN");
    if (JSON.stringify(snapshot.images.map((image) => image.assetId)) !== JSON.stringify(job.selected_image_asset_id ? [job.selected_image_asset_id] : [])) fail("CONTENT_IMAGE_SELECTION_CHANGED");
    this.assertAssets(snapshot);
    return snapshot;
  }
  assertAssets(snapshot: ContentSnapshot): void {
    if (this.db.prepare("SELECT 1 FROM content_snapshot_invalidations WHERE snapshot_id=?").get(snapshot.id)) fail("CONTENT_CHANGED_PREPARE_AGAIN");
    try {
    for (const image of snapshot.images) {
      const actual = this.readAsset(image.assetId);
      if (actual.path !== image.sourcePath || digest(actual.bytes) !== image.sha256) fail("CONTENT_SOURCE_BYTES_CHANGED");
      const stored = this.db.prepare("SELECT bytes FROM content_objects WHERE sha256=?").get(image.sha256) as { bytes: Buffer } | undefined;
      if (!stored || digest(stored.bytes) !== image.sha256) fail("CONTENT_OBJECT_HASH_MISMATCH");
    }
    } catch (error) {
      // Outside a business transaction, persist observed invalidation even before a Job exists.
      // Inside a final-claim transaction Publisher persists it after rollback, preserving F01.
      if (!this.db.inTransaction) this.db.prepare("INSERT OR IGNORE INTO content_snapshot_invalidations SELECT id,?,? FROM content_snapshots WHERE id=?").run(error instanceof Error ? error.message : "CONTENT_ASSET_INVALID",new Date().toISOString(),snapshot.id);
      throw error;
    }
  }
  input(snapshot: ContentSnapshot, articleId: string): PublishArticleInput {
    this.assertAssets(snapshot);
    return this.historicalInput(snapshot, articleId);
  }
  /** Read-only reconciliation uses the immutable submitted bytes, never the edited source path. */
  historicalInput(snapshot: ContentSnapshot, articleId: string): PublishArticleInput {
    return { articleId, title: snapshot.rawTitle, body: snapshot.rawBody, summary: snapshot.summary, tags: [...snapshot.tags], contentSnapshotId: snapshot.id,
      images: snapshot.images.map((i) => i.sourcePath), boundImages: snapshot.images.map((i) => {
        const object = this.db.prepare("SELECT bytes FROM content_objects WHERE sha256=?").get(i.sha256) as { bytes: Buffer };
        const bytes = Buffer.from(object.bytes); if (digest(bytes) !== i.sha256) fail("CONTENT_OBJECT_HASH_MISMATCH");
        return { assetId: i.assetId, name: i.name, mimeType: i.mimeType, sha256: i.sha256, buffer: bytes };
      }) };
  }
  confirm(jobId: string): void {
    const snapshot = this.ensureJob(jobId);
    this.db.prepare("INSERT OR IGNORE INTO content_confirmations(id,job_id,snapshot_id,confirmed_at) VALUES (?,?,?,?)").run(randomUUID(), jobId, snapshot.id, new Date().toISOString());
  }
  renewAfterClosedIntent(intentId: string): void {
    const prior = this.db.prepare("SELECT c.* FROM content_confirmations c JOIN submission_dispatch_claims d ON d.intent_id=c.intent_id WHERE c.intent_id=? AND c.consumed=1 AND d.state='NotSubmitted'").get(intentId) as Row | undefined;
    if (prior && this.get(text(prior.snapshot_id)).purpose === "PRODUCTION") this.db.prepare("INSERT OR IGNORE INTO content_confirmations(id,job_id,snapshot_id,confirmed_at) VALUES (?,?,?,?)").run(randomUUID(), prior.job_id, prior.snapshot_id, new Date().toISOString());
  }
  claim(jobId: string, intentId: string, subject?: XhsContextIdentityAttestation): void {
    const snapshot = this.assertCurrent(jobId);
    const job = this.row("publish_jobs", jobId);
    if (snapshot.platformKey === "xiaohongshu" && (!subject || subject.verified !== true || subject.accountId !== snapshot.accountId || subject.platformKey !== snapshot.platformKey || subject.expectedExternalCreatorId !== snapshot.creatorId || subject.observedExternalCreatorId !== snapshot.creatorId || subject.externalAccountId !== snapshot.creatorId || !subject.browserContextIdentity || !subject.browserSessionIdentity || !subject.sourcePageIdentity || subject.sourceOrigin !== "https://creator.xiaohongshu.com" || !Number.isFinite(Date.parse(subject.expiresAt)) || Date.parse(subject.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(subject.issuedAt)) || Date.parse(subject.issuedAt) > Date.now())) fail("CONTENT_RUNTIME_IDENTITY_REQUIRED");
    const intent = this.db.prepare("SELECT * FROM submission_intents WHERE id=?").get(intentId) as Row | undefined;
    if (!intent || intent.job_id !== jobId || intent.article_id !== job.article_id || intent.content_binding_id !== snapshot.id || intent.account_id !== snapshot.accountId || intent.platform_key !== snapshot.platformKey) fail("CONTENT_INTENT_MISMATCH");
    if (snapshot.purpose === "ONE_SHOT_ACCEPTANCE") {
      const run = this.db.prepare("SELECT * FROM platform_self_test_runs WHERE test_run_id=?").get(snapshot.operationId) as Row | undefined;
      const auth = this.db.prepare("SELECT * FROM one_shot_publication_authorizations WHERE operation_id=?").get(snapshot.operationId) as Row | undefined;
      if (!run || !auth || run.publish_job_id !== jobId || run.test_article_id !== job.article_id || run.platform_account_id !== snapshot.accountId || run.platform_key !== snapshot.platformKey || !run.publish_confirmed_at || run.content_binding_id !== snapshot.id || auth.content_binding_id !== snapshot.id || auth.account_id !== snapshot.accountId || auth.platform_key !== snapshot.platformKey || auth.state !== "AUTHORIZED_UNUSED" || auth.mode !== "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE") fail("CONTENT_AUTH_RELATION_MISMATCH");
    } else if (snapshot.operationId !== null) fail("CONTENT_PURPOSE_MISMATCH");
    const records = this.db.prepare("SELECT * FROM publish_records WHERE job_id=? AND dry_run=0").all(jobId) as Row[];
    if (records.some((r) => r.content_binding_id !== snapshot.id || r.account_id !== snapshot.accountId || r.platform_key !== snapshot.platformKey || r.article_id !== job.article_id)) fail("CONTENT_RECORD_MISMATCH");
    if (snapshot.purpose === "ONE_SHOT_ACCEPTANCE") {
      const run = this.db.prepare("SELECT publish_record_id FROM platform_self_test_runs WHERE test_run_id=?").get(snapshot.operationId) as Row;
      if (records.length !== 1 || records[0]?.id !== run.publish_record_id) fail("CONTENT_RUN_RECORD_MISMATCH");
    }
    const result = this.db.prepare("UPDATE content_confirmations SET consumed=1,intent_id=?,runtime_identity_json=? WHERE job_id=? AND snapshot_id=? AND consumed=0").run(intentId, subject ? JSON.stringify(subject) : null, jobId, snapshot.id);
    if (result.changes !== 1) fail("CONTENT_CONFIRMATION_REQUIRED_OR_CONSUMED");
  }
}
