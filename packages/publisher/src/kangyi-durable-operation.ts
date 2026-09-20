import { createHash } from "node:crypto";
import type { AppRepository, KangyiMediaOperationPreparation, KangyiOperationBindingInput } from "@publisher/db";
import type { KangyiWebsiteOperationMetadataV1 } from "@publisher/domain";

export interface KangyiMediaTransportResult {
  mediaId: string;
  sha256: string;
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
  publish(input: { contentId: string; exactRequestBody: string; idempotencyKey: string }): Promise<{ jobId: string; contentId: string; revisionId: string; rowVersion: number; contentHash: string }>;
  getJob(jobId: string): Promise<KangyiJobTransportResult>;
  verifyPublic(input: { contentId: string; publicUrl: string }): Promise<{ ok: boolean; response: Record<string, unknown> }>;
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
  create: KangyiDurableJsonInput;
  draft?: KangyiDurableJsonInput;
  validate: KangyiDurableJsonInput;
  publish: KangyiDurableJsonInput;
}

export type KangyiDurableContinuationInput = Omit<KangyiDurableOperationInput, "binding">;

export type KangyiDurableRunStatus = "complete" | "polling" | "failed" | "needs_reconciliation";

export interface KangyiDurableRunResult {
  status: KangyiDurableRunStatus;
  metadata: KangyiWebsiteOperationMetadataV1;
  recordId: string | null;
}

function sha256Bytes(bytes: Uint8Array): string { return createHash("sha256").update(Buffer.from(bytes)).digest("hex"); }
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
    if (!create || !validate || !publish) throw new Error("KANGYI_OPERATION_METADATA_INCOMPLETE");
    return this.run({
      binding: { intentId: metadata.intentId, siteId: metadata.siteId, environment: metadata.environment, snapshotId: metadata.snapshotId, contentBindingId: metadata.contentBindingId },
      media: metadata.media.map((item) => ({ assetId: item.assetId, idempotencyKey: item.idempotencyKey })),
      create,
      ...(metadata.draft ? { draft: metadata.draft } : continuation?.draft ? { draft: continuation.draft } : {}),
      validate,
      publish
    });
  }

  async run(input: KangyiDurableOperationInput): Promise<KangyiDurableRunResult> {
    let metadata = this.repository.initializeKangyiOperation(input.binding);
    if (metadata.phase === "COMPLETE" && metadata.publishRecordId) return { status: "complete", metadata, recordId: metadata.publishRecordId };

    const boundJob = this.repository.getJob(metadata.jobId);
    const snapshot = this.repository.contentSnapshots.get(metadata.snapshotId);
    if (!boundJob) throw new Error("KANGYI_OPERATION_JOB_MISSING");
    const immutableInput = this.repository.contentSnapshots.historicalInput(snapshot, boundJob.articleId);
    for (const media of input.media ?? []) {
      const snapshotImage = snapshot.images.find((item) => item.assetId === media.assetId);
      const immutableImage = immutableInput.boundImages?.find((item) => item.assetId === media.assetId);
      if (!snapshotImage || !immutableImage) throw new Error("KANGYI_SNAPSHOT_IMAGE_NOT_FOUND");
      const actualSha256 = sha256Bytes(immutableImage.buffer);
      if (actualSha256 !== snapshotImage.sha256) throw new Error("KANGYI_MEDIA_SNAPSHOT_HASH_MISMATCH");
      const prepared: KangyiMediaOperationPreparation = { assetId: media.assetId, snapshotSha256: snapshotImage.sha256, mime: immutableImage.mimeType as KangyiMediaOperationPreparation["mime"], bytes: immutableImage.buffer.byteLength, idempotencyKey: media.idempotencyKey };
      metadata = this.repository.prepareKangyiMediaOperation(input.binding.intentId, prepared);
      const current = metadata.media.find((item) => item.assetId === media.assetId);
      if (!current) throw new Error("KANGYI_MEDIA_OPERATION_NOT_PREPARED");
      if (current.state !== "SUCCEEDED") {
        try {
          const result = await this.transport.uploadMedia({ bytes: immutableImage.buffer, mime: current.mime, idempotencyKey: current.idempotencyKey });
          metadata = this.repository.recordKangyiMediaResult(input.binding.intentId, { assetId: media.assetId, ...result });
        } catch (error) {
          this.repository.markKangyiOperationOutcomeUnknown(input.binding.intentId, "media", error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN");
          throw error;
        }
      }
    }

    metadata = this.repository.prepareKangyiJsonOperation(input.binding.intentId, "create", input.create);
    if (metadata.create?.state !== "SUCCEEDED") {
      try {
        const result = await this.transport.createContent({ exactRequestBody: metadata.create!.exactRequestBody, idempotencyKey: metadata.create!.idempotencyKey });
        metadata = this.repository.recordKangyiJsonOperationResult(input.binding.intentId, "create", { contentId: result.contentId, revisionId: result.revisionId, rowVersion: result.rowVersion, contentHash: result.contentHash });
      } catch (error) {
        this.repository.markKangyiOperationOutcomeUnknown(input.binding.intentId, "create", error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN");
        throw error;
      }
    }

    if (input.draft) {
      metadata = this.repository.prepareKangyiJsonOperation(input.binding.intentId, "draft", input.draft);
      if (metadata.draft?.state !== "SUCCEEDED") {
        try {
          const result = await this.transport.saveDraft({ contentId: stringIdentity(metadata, "create", "contentId"), exactRequestBody: metadata.draft!.exactRequestBody, idempotencyKey: metadata.draft!.idempotencyKey });
          metadata = this.repository.recordKangyiJsonOperationResult(input.binding.intentId, "draft", { contentId: result.contentId, revisionId: result.revisionId, rowVersion: result.rowVersion, contentHash: result.contentHash });
        } catch (error) {
          this.repository.markKangyiOperationOutcomeUnknown(input.binding.intentId, "draft", error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN");
          throw error;
        }
      }
    }

    metadata = this.repository.prepareKangyiJsonOperation(input.binding.intentId, "validate", input.validate);
    if (metadata.validate?.state !== "SUCCEEDED") {
      try {
        const result = await this.transport.validate({ contentId: stringIdentity(metadata, "create", "contentId"), exactRequestBody: metadata.validate!.exactRequestBody, idempotencyKey: metadata.validate!.idempotencyKey });
        if (!result.valid) throw new Error("KANGYI_VALIDATION_FAILED");
        metadata = this.repository.recordKangyiJsonOperationResult(input.binding.intentId, "validate", { valid: result.valid, revisionId: result.revisionId, contentHash: result.contentHash });
      } catch (error) {
        this.repository.markKangyiOperationOutcomeUnknown(input.binding.intentId, "validate", error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN");
        throw error;
      }
    }

    metadata = this.repository.prepareKangyiJsonOperation(input.binding.intentId, "publish", input.publish);
    if (!metadata.publish?.cmsJobId) {
      const claim = this.repository.claimKangyiPublishDispatch(input.binding.intentId);
      try {
        const result = await this.transport.publish({ contentId: stringIdentity(metadata, "create", "contentId"), exactRequestBody: metadata.publish!.exactRequestBody, idempotencyKey: metadata.publish!.idempotencyKey });
        metadata = this.repository.recordKangyiPublishAccepted(input.binding.intentId, { cmsJobId: result.jobId, contentId: result.contentId, revisionId: result.revisionId, rowVersion: result.rowVersion, contentHash: result.contentHash });
      } catch (error) {
        this.repository.markKangyiOperationOutcomeUnknown(input.binding.intentId, "publish", error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN");
        this.repository.markSubmissionIntentUncertain(input.binding.intentId, error instanceof Error ? error.name : "TRANSPORT_UNCERTAIN");
        throw Object.assign(error instanceof Error ? error : new Error("KANGYI_PUBLISH_TRANSPORT_UNCERTAIN"), { claimReused: claim.reused });
      }
    }

    const cmsJobId = metadata.publish?.cmsJobId;
    if (!cmsJobId) throw new Error("KANGYI_CMS_JOB_ID_MISSING");
    const cmsJob = await this.transport.getJob(cmsJobId);
    metadata = this.repository.recordKangyiCmsJobStatus(input.binding.intentId, { cmsJobId, status: cmsJob.status, publicUrl: cmsJob.publicUrl, verification: cmsJob.verification });
    if (cmsJob.status === "failed") return { status: "failed", metadata, recordId: metadata.publishRecordId };
    if (cmsJob.status === "needs_attention") return { status: "needs_reconciliation", metadata, recordId: metadata.publishRecordId };
    if (cmsJob.status !== "succeeded") return { status: "polling", metadata, recordId: metadata.publishRecordId };
    if (!cmsJob.publicUrl) throw new Error("KANGYI_PUBLIC_URL_REQUIRED");
    const verification = await this.transport.verifyPublic({ contentId: stringIdentity(metadata, "create", "contentId"), publicUrl: cmsJob.publicUrl });
    if (!verification.ok) {
      this.repository.markKangyiOperationOutcomeUnknown(input.binding.intentId, "publish", "PUBLIC_READBACK_MISMATCH");
      this.repository.markSubmissionIntentUncertain(input.binding.intentId, "PUBLIC_READBACK_MISMATCH");
      throw new Error("PUBLIC_READBACK_MISMATCH");
    }
    const closed = this.repository.closeKangyiPublished(input.binding.intentId, { contentId: stringIdentity(metadata, "create", "contentId"), publicUrl: cmsJob.publicUrl, response: { job: cmsJob.verification ?? {}, publicReadback: verification.response } });
    return { status: "complete", metadata: this.repository.getKangyiOperationMetadata(input.binding.intentId) as KangyiWebsiteOperationMetadataV1, recordId: closed.record.id };
  }
}
