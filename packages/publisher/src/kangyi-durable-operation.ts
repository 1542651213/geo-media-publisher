import { createHash } from "node:crypto";
import type { AppRepository, KangyiMediaOperationPreparation, KangyiOperationBindingInput } from "@publisher/db";
import type { KangyiWebsiteOperationMetadataV1 } from "@publisher/domain";
import { assertKangyiContentIdentity, assertKangyiJobIdentity, assertKangyiPublishIdentity, assertKangyiPublicVerification, assertKangyiValidationIdentity } from "@publisher/domain";

export interface KangyiMediaTransportResult {
  mediaId: string;
  sha256: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  bytes: number;
}

export interface KangyiContentTransportResult {
  contentId: string;
  revisionId: string;
  rowVersion: number;
  contentHash: string;
}

export interface KangyiValidationTransportResult {
  valid: boolean;
  revisionId: string;
  contentHash: string;
}

export interface KangyiJobTransportResult {
  jobId: string;
  status: "queued" | "processing" | "verifying" | "succeeded" | "failed" | "needs_attention";
  publicUrl: string | null;
  verification: Record<string, unknown> | null;
}

/** Structural transport boundary. A real Phase 2 implementation adapts CmsV2Client.request here. */
export interface KangyiDurableOperationTransport {
  uploadMedia(input: { bytes: Uint8Array; mime: "image/jpeg" | "image/png" | "image/webp"; idempotencyKey: string }): Promise<KangyiMediaTransportResult>;
  createContent(input: { exactRequestBody: string; idempotencyKey: string }): Promise<KangyiContentTransportResult>;
  saveDraft(input: { contentId: string; exactRequestBody: string; idempotencyKey: string }): Promise<KangyiContentTransportResult>;
  validate(input: { contentId: string; exactRequestBody: string; idempotencyKey: string }): Promise<KangyiValidationTransportResult>;
  publish(input: { contentId: string; exactRequestBody: string; idempotencyKey: string }): Promise<{ httpStatus: number; jobId: string; contentId: string; revisionId: string; rowVersion: number; contentHash: string }>;
  getJob(jobId: string): Promise<KangyiJobTransportResult>;
  verifyPublic(input: { contentId: string; revisionId: string; contentHash: string; publicUrl: string; media: Array<{ mediaId: string; sha256: string }> }): Promise<{ ok: boolean; contentId: string; publicUrl: string; response: Record<string, unknown> }>;
}

export interface KangyiDurableMediaInput {
  assetId: string;
  idempotencyKey: string;
}

export interface KangyiDurableJsonInput {
  idempotencyKey: string;
  exactRequestBody: string;
  requestBodySha256: string;
}

export interface KangyiDurableOperationInput {
  binding: KangyiOperationBindingInput;
  media?: KangyiDurableMediaInput[];
  create?: KangyiDurableJsonInput;
  draft?: KangyiDurableJsonInput;
  validate?: KangyiDurableJsonInput;
  publish?: KangyiDurableJsonInput;
}

export type KangyiDurableContinuationInput = Omit<KangyiDurableOperationInput, "binding">;

export type KangyiDurableRunStatus = "awaiting_input" | "complete" | "polling" | "failed" | "needs_reconciliation";

export interface KangyiDurableRunResult {
  status: KangyiDurableRunStatus;
  metadata: KangyiWebsiteOperationMetadataV1;
  recordId: string | null;
}

function sha256Bytes(bytes: Uint8Array): string { return createHash("sha256").update(Buffer.from(bytes)).digest("hex"); }
function isKnownRejectedWrite(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; code?: unknown };
  return value.status === 401 || value.status === 403 || value.status === 409 || ["AUTH_REQUIRED", "UNAUTHORIZED", "BAD_SIGNATURE", "SCOPE_DENIED", "WRONG_SITE", "WRONG_ENVIRONMENT", "WRITE_DISABLED", "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"].includes(String(value.code));
}
function recordRequestFailure(repository: AppRepository, intentId: string, operation: "media" | "create" | "draft" | "validate" | "publish", error: unknown): never {
  const code = error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN";
  if (isKnownRejectedWrite(error)) repository.failKangyiOperation(intentId, operation, error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : code);
  else repository.markKangyiOperationOutcomeUnknown(intentId, operation, code);
  throw error;
}
function stringIdentity(metadata: KangyiWebsiteOperationMetadataV1, operation: "create" | "publish", key: string): string {
  const step = operation === "create" ? metadata.create : metadata.publish;
  const value = step?.responseIdentity?.[key];
  if (typeof value !== "string" || !value) throw new Error(`KANGYI_${operation.toUpperCase()}_IDENTITY_MISSING_${key.toUpperCase()}`);
  return value;
}

export class KangyiDurableOperationRunner {
  constructor(private readonly repository: AppRepository, private readonly transport: KangyiDurableOperationTransport) {}

  /** Reconstructs the next request exclusively from persisted metadata and the immutable snapshot. */
  async resume(intentId: string, continuation?: KangyiDurableContinuationInput): Promise<KangyiDurableRunResult> {
    const metadata = this.repository.getKangyiOperationMetadata(intentId);
    if (!metadata) throw new Error("KANGYI_OPERATION_NOT_INITIALIZED");
    const create = metadata.create ?? continuation?.create;
    const validate = metadata.validate ?? continuation?.validate;
    const publish = metadata.publish ?? continuation?.publish;
    return this.run({
      binding: { intentId: metadata.intentId, accountId: metadata.accountId, siteId: metadata.siteId, environment: metadata.environment, snapshotId: metadata.snapshotId, contentBindingId: metadata.contentBindingId, ...(metadata.pilotAuthorizationId ? { pilotAuthorizationId: metadata.pilotAuthorizationId } : {}) },
      media: metadata.media.map((item) => ({ assetId: item.assetId, idempotencyKey: item.idempotencyKey })),
      ...(create ? { create } : {}),
      ...(metadata.draft ? { draft: metadata.draft } : continuation?.draft ? { draft: continuation.draft } : {}),
      ...(validate ? { validate } : {}),
      ...(publish ? { publish } : {})
    });
  }

  async run(input: KangyiDurableOperationInput): Promise<KangyiDurableRunResult> {
    let metadata = this.repository.initializeKangyiOperation(input.binding);
    if (metadata.phase === "COMPLETE" && metadata.publishRecordId) return { status: "complete", metadata, recordId: metadata.publishRecordId };
    if (metadata.phase === "FAILED") return { status: "failed", metadata, recordId: metadata.publishRecordId };

    const boundJob = this.repository.getJob(metadata.jobId);
    const snapshot = this.repository.contentSnapshots.get(metadata.snapshotId);
    if (!boundJob) throw new Error("KANGYI_OPERATION_JOB_MISSING");
    if (metadata.accountId !== boundJob.accountId || boundJob.platformKey !== `${metadata.siteId}_website` || !["kangyi", "huiquan", "shupai"].includes(metadata.siteId) || metadata.environment !== "staging") throw new Error("KANGYI_ACCOUNT_SCOPE_MISMATCH");
    if (input.binding.accountId !== metadata.accountId || input.binding.siteId !== metadata.siteId || input.binding.environment !== metadata.environment || input.binding.contentBindingId !== metadata.contentBindingId || input.binding.snapshotId !== metadata.snapshotId) throw new Error("KANGYI_RECOVERY_BINDING_MISMATCH");
    const immutableInput = this.repository.contentSnapshots.historicalInput(snapshot, boundJob.articleId);
    for (const media of input.media ?? []) {
      const snapshotImage = snapshot.images.find((item) => item.assetId === media.assetId);
      const immutableImage = immutableInput.boundImages?.find((item) => item.assetId === media.assetId);
      if (!snapshotImage || !immutableImage) throw new Error("KANGYI_SNAPSHOT_IMAGE_NOT_FOUND");
      if (!["image/jpeg", "image/png", "image/webp"].includes(immutableImage.mimeType) || immutableImage.buffer.byteLength < 1 || immutableImage.buffer.byteLength > 8 * 1024 * 1024) throw new Error("KANGYI_UNSUPPORTED_MEDIA");
      const actualSha256 = sha256Bytes(immutableImage.buffer);
      if (actualSha256 !== snapshotImage.sha256) throw new Error("KANGYI_MEDIA_SNAPSHOT_HASH_MISMATCH");
      const prepared: KangyiMediaOperationPreparation = { assetId: media.assetId, snapshotSha256: snapshotImage.sha256, mime: immutableImage.mimeType as KangyiMediaOperationPreparation["mime"], bytes: immutableImage.buffer.byteLength, idempotencyKey: media.idempotencyKey };
      metadata = this.repository.prepareKangyiMediaOperation(input.binding.intentId, prepared);
      const current = metadata.media.find((item) => item.assetId === media.assetId);
      if (!current) throw new Error("KANGYI_MEDIA_OPERATION_NOT_PREPARED");
      if (current.state !== "SUCCEEDED") {
        let result: KangyiMediaTransportResult;
        try {
          result = await this.transport.uploadMedia({ bytes: immutableImage.buffer, mime: current.mime, idempotencyKey: current.idempotencyKey });
        } catch (error) { recordRequestFailure(this.repository, input.binding.intentId, "media", error); }
        if (!result.mediaId.trim() || result.sha256 !== current.snapshotSha256 || result.mime !== current.mime || result.bytes !== current.bytes || !Number.isSafeInteger(result.width) || result.width < 1 || !Number.isSafeInteger(result.height) || result.height < 1) {
          this.repository.failKangyiOperation(input.binding.intentId, "media", "KANGYI_MEDIA_RESPONSE_MISMATCH");
          throw new Error("KANGYI_MEDIA_RESPONSE_MISMATCH");
        }
        metadata = this.repository.recordKangyiMediaResult(input.binding.intentId, { assetId: media.assetId, ...result });
      }
    }

    const create = metadata.create ?? input.create;
    if (!create) return { status: "awaiting_input", metadata, recordId: null };
    metadata = this.repository.prepareKangyiJsonOperation(input.binding.intentId, "create", create);
    if (metadata.create?.state !== "SUCCEEDED") {
      let result: KangyiContentTransportResult;
      try {
        result = await this.transport.createContent({ exactRequestBody: metadata.create!.exactRequestBody, idempotencyKey: metadata.create!.idempotencyKey });
      } catch (error) { recordRequestFailure(this.repository, input.binding.intentId, "create", error); }
      try { assertKangyiContentIdentity(result); }
      catch { this.repository.failKangyiOperation(input.binding.intentId, "create", "KANGYI_CONTENT_IDENTITY_MISSING"); throw new Error("KANGYI_CONTENT_IDENTITY_MISSING"); }
      metadata = this.repository.recordKangyiJsonOperationResult(input.binding.intentId, "create", { contentId: result.contentId, revisionId: result.revisionId, rowVersion: result.rowVersion, contentHash: result.contentHash });
    }

    const draft = metadata.draft ?? input.draft;
    if (draft) {
      metadata = this.repository.prepareKangyiJsonOperation(input.binding.intentId, "draft", draft);
      if (metadata.draft?.state !== "SUCCEEDED") {
        let result: KangyiContentTransportResult;
        try {
          result = await this.transport.saveDraft({ contentId: stringIdentity(metadata, "create", "contentId"), exactRequestBody: metadata.draft!.exactRequestBody, idempotencyKey: metadata.draft!.idempotencyKey });
        } catch (error) { recordRequestFailure(this.repository, input.binding.intentId, "draft", error); }
        try {
          assertKangyiContentIdentity(result);
          if (result.contentId !== stringIdentity(metadata, "create", "contentId")) throw new Error("KANGYI_DRAFT_CONTENT_ID_MISMATCH");
          const previousRowVersion = Number(metadata.create?.responseIdentity?.rowVersion ?? 0);
          if (result.rowVersion <= previousRowVersion) throw new Error("KANGYI_STALE_ROW_VERSION");
        } catch (error) {
          const code = error instanceof Error ? error.message : "KANGYI_DRAFT_RESPONSE_INVALID";
          this.repository.failKangyiOperation(input.binding.intentId, "draft", code);
          throw error;
        }
        metadata = this.repository.recordKangyiJsonOperationResult(input.binding.intentId, "draft", { contentId: result.contentId, revisionId: result.revisionId, rowVersion: result.rowVersion, contentHash: result.contentHash });
      }
    }

    const validate = metadata.validate ?? input.validate;
    if (!validate) return { status: "awaiting_input", metadata, recordId: null };
    metadata = this.repository.prepareKangyiJsonOperation(input.binding.intentId, "validate", validate);
    if (metadata.validate?.state !== "SUCCEEDED") {
      let result: KangyiValidationTransportResult;
      try {
        result = await this.transport.validate({ contentId: stringIdentity(metadata, "create", "contentId"), exactRequestBody: metadata.validate!.exactRequestBody, idempotencyKey: metadata.validate!.idempotencyKey });
      } catch (error) { recordRequestFailure(this.repository, input.binding.intentId, "validate", error); }
      const validatedRevision = metadata.draft?.responseIdentity?.revisionId ?? metadata.create?.responseIdentity?.revisionId;
      const validatedHash = metadata.draft?.responseIdentity?.contentHash ?? metadata.create?.responseIdentity?.contentHash;
      try {
        if (typeof validatedRevision !== "string" || typeof validatedHash !== "string") throw new Error("KANGYI_CONTENT_IDENTITY_MISSING");
        assertKangyiValidationIdentity(result, { revisionId: validatedRevision, contentHash: validatedHash });
      } catch (error) {
        const code = error instanceof Error ? error.message : "KANGYI_VALIDATION_FAILED";
        this.repository.failKangyiOperation(input.binding.intentId, "validate", code);
        throw error;
      }
      metadata = this.repository.recordKangyiJsonOperationResult(input.binding.intentId, "validate", { valid: result.valid, revisionId: result.revisionId, contentHash: result.contentHash });
    }

    const publish = metadata.publish ?? input.publish;
    if (!publish) return { status: "awaiting_input", metadata, recordId: null };
    metadata = this.repository.prepareKangyiJsonOperation(input.binding.intentId, "publish", publish);
    if (!metadata.publish?.cmsJobId) {
      const claim = this.repository.claimKangyiPublishDispatch(input.binding.intentId);
      let result: Awaited<ReturnType<KangyiDurableOperationTransport["publish"]>>;
      try {
        result = await this.transport.publish({ contentId: stringIdentity(metadata, "create", "contentId"), exactRequestBody: metadata.publish!.exactRequestBody, idempotencyKey: metadata.publish!.idempotencyKey });
      } catch (error) {
        if (isKnownRejectedWrite(error)) recordRequestFailure(this.repository, input.binding.intentId, "publish", error);
        this.repository.markKangyiOperationOutcomeUnknown(input.binding.intentId, "publish", error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN");
        this.repository.markSubmissionIntentUncertain(input.binding.intentId, error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN");
        throw Object.assign(error instanceof Error ? error : new Error("KANGYI_PUBLISH_TRANSPORT_UNCERTAIN"), { claimReused: claim.reused });
      }
      const expectedRevision = metadata.draft?.responseIdentity?.revisionId ?? metadata.create?.responseIdentity?.revisionId;
      const expectedHash = metadata.draft?.responseIdentity?.contentHash ?? metadata.create?.responseIdentity?.contentHash;
      const expectedRowVersion = metadata.draft?.responseIdentity?.rowVersion ?? metadata.create?.responseIdentity?.rowVersion;
      try {
        if (typeof expectedRevision !== "string" || typeof expectedHash !== "string" || typeof expectedRowVersion !== "number") throw new Error("KANGYI_CONTENT_IDENTITY_MISSING");
        assertKangyiPublishIdentity(result, { contentId: stringIdentity(metadata, "create", "contentId"), revisionId: expectedRevision, rowVersion: expectedRowVersion, contentHash: expectedHash });
      } catch (error) {
        const code = error instanceof Error ? error.message : "KANGYI_PUBLISH_RESPONSE_INVALID";
        this.repository.failKangyiOperation(input.binding.intentId, "publish", code);
        throw error;
      }
      metadata = this.repository.recordKangyiPublishAccepted(input.binding.intentId, { cmsJobId: result.jobId, contentId: result.contentId, revisionId: result.revisionId, rowVersion: result.rowVersion, contentHash: result.contentHash });
    }

    const cmsJobId = metadata.publish?.cmsJobId;
    if (!cmsJobId) throw new Error("KANGYI_CMS_JOB_ID_MISSING");
    const cmsJob = await this.transport.getJob(cmsJobId);
    try { assertKangyiJobIdentity(cmsJob, cmsJobId); }
    catch {
      this.repository.failKangyiOperation(input.binding.intentId, "publish", "KANGYI_CMS_JOB_ID_MISMATCH");
      throw new Error("KANGYI_CMS_JOB_ID_MISMATCH");
    }
    metadata = this.repository.recordKangyiCmsJobStatus(input.binding.intentId, { cmsJobId, status: cmsJob.status, publicUrl: cmsJob.publicUrl, verification: cmsJob.verification });
    if (cmsJob.status === "failed") return { status: "failed", metadata, recordId: metadata.publishRecordId };
    if (cmsJob.status === "needs_attention") return { status: "needs_reconciliation", metadata, recordId: metadata.publishRecordId };
    if (cmsJob.status !== "succeeded") return { status: "polling", metadata, recordId: metadata.publishRecordId };
    if (!cmsJob.publicUrl) throw new Error("KANGYI_PUBLIC_URL_REQUIRED");
    const expectedRevisionId = metadata.draft?.responseIdentity?.revisionId ?? metadata.create?.responseIdentity?.revisionId;
    const expectedContentHash = metadata.draft?.responseIdentity?.contentHash ?? metadata.create?.responseIdentity?.contentHash;
    if (typeof expectedRevisionId !== "string" || typeof expectedContentHash !== "string") throw new Error("KANGYI_PUBLIC_IDENTITY_MISSING");
    const verification = await this.transport.verifyPublic({ contentId: stringIdentity(metadata, "create", "contentId"), revisionId: expectedRevisionId, contentHash: expectedContentHash, publicUrl: cmsJob.publicUrl, media: metadata.media.map((item) => {
      if (!item.mediaId || !item.serverSha256) throw new Error("KANGYI_PUBLIC_MEDIA_IDENTITY_MISSING");
      return { mediaId: item.mediaId, sha256: item.serverSha256 };
    }) });
    try { assertKangyiPublicVerification(verification, { contentId: stringIdentity(metadata, "create", "contentId"), publicUrl: cmsJob.publicUrl }); }
    catch {
      this.repository.markKangyiOperationOutcomeUnknown(input.binding.intentId, "publish", "PUBLIC_READBACK_MISMATCH");
      this.repository.markSubmissionIntentUncertain(input.binding.intentId, "PUBLIC_READBACK_MISMATCH");
      throw new Error("PUBLIC_READBACK_MISMATCH");
    }
    const closed = this.repository.closeKangyiPublished(input.binding.intentId, { contentId: stringIdentity(metadata, "create", "contentId"), publicUrl: cmsJob.publicUrl, response: { job: cmsJob.verification ?? {}, publicReadback: verification.response } });
    return { status: "complete", metadata: this.repository.getKangyiOperationMetadata(input.binding.intentId) as KangyiWebsiteOperationMetadataV1, recordId: closed.record.id };
  }
}
