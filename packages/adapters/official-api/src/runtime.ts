import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { BrowserPublishAttemptContext, BrowserPublishPreflightResult } from "@publisher/adapters-core";
import type { AccountContext, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import {
  ClientError,
  type Capabilities,
  type CmsRecord,
  type ContentList,
  type Job,
  type Media,
  type Success,
  type Validation
} from "../../../cms-v2-client/src";
import { recoverAppliedPublishResponse } from "../../../cms-v2-client/src/publish-recovery";
import { buildOfficialApiDraft, type OfficialApiPreparedContent } from "./mapping";

export type OfficialApiOperationPhase =
  | "PREPARING"
  | "PREPARED"
  | "PUBLISH_DISPATCHING"
  | "PUBLISH_ACCEPTED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "NEEDS_RECONCILIATION";
export type OfficialApiStepState = "PLANNED" | "DISPATCHING" | "SUCCEEDED" | "FAILED" | "OUTCOME_UNKNOWN";

export interface OfficialApiContentIdentity {
  contentId: string;
  revisionId: string;
  contentHash: string;
  rowVersion: number;
}

export interface OfficialApiJsonStep<TResponse = Record<string, unknown>> {
  state: OfficialApiStepState;
  idempotencyKey: string;
  exactJson: string;
  bodySha256: string;
  response?: TResponse;
  errorCode?: string;
}

export interface OfficialApiMediaStep {
  assetId: string;
  state: OfficialApiStepState;
  idempotencyKey: string;
  sha256: string;
  mime: Media["mime"];
  bytes: number;
  width: number;
  height: number;
  remote?: Media;
  errorCode?: string;
}

export type OfficialApiRemoteJob = Pick<Job, "jobId" | "status"> & { publicUrl?: string | null };

export interface OfficialApiMaintenanceStep {
  maintenanceId: string;
  operation: "unpublish" | "delete" | "restore" | "purge";
  state: OfficialApiStepState;
  idempotencyKey: string;
  exactJson: string;
  bodySha256: string;
  sourceRowVersion: number;
  /** Exact maintenance-job response binding. Optional only for legacy journals. */
  jobBinding?: Pick<Job, "revisionId" | "contentHash">;
  remoteJob?: OfficialApiRemoteJob;
  errorCode?: string;
}

export interface OfficialApiOperation {
  version: 1;
  revision: number;
  jobId: string;
  accountId: string;
  articleId: string;
  siteId: "kangyi";
  environment: "staging" | "production";
  keyId: string;
  sourceHash: string;
  contentBindingId: string;
  externalId: string;
  phase: OfficialApiOperationPhase;
  prepared: OfficialApiPreparedContent;
  media: OfficialApiMediaStep[];
  create?: OfficialApiJsonStep<OfficialApiContentIdentity>;
  draft?: OfficialApiJsonStep<OfficialApiContentIdentity>;
  validate?: OfficialApiJsonStep<{ valid: boolean; revisionId: string; contentHash: string }>;
  publish?: OfficialApiJsonStep<OfficialApiContentIdentity & { jobId: string }>;
  remoteContent?: OfficialApiContentIdentity;
  remoteJob?: OfficialApiRemoteJob;
  fidelity?: { ok: boolean; warning?: string; evidence: Record<string, unknown> };
  maintenance: OfficialApiMaintenanceStep[];
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OfficialApiOperationStore {
  insert(operation: OfficialApiOperation): OfficialApiOperation;
  getByJobId(jobId: string): OfficialApiOperation | null;
  findBySource(accountId: string, articleId: string): OfficialApiOperation | null;
  compareAndSwap(jobId: string, expectedRevision: number, next: OfficialApiOperation): OfficialApiOperation;
}

export interface OfficialApiRuntimeClient {
  health(): Promise<Success<{ status: string; protocolVersion: string }> & { httpStatus: number }>;
  capabilities(): Promise<Success<Capabilities> & { httpStatus: number }>;
  uploadMedia(bytes: Uint8Array, mime: Media["mime"], idempotencyKey: string): Promise<Success<Media> & { httpStatus: number }>;
  verifyPrivateMedia(expected: Media): Promise<{ httpStatus: 200; mediaId: string; sha256: string; bytes: number; mime: string; width: number; height: number }>;
  request<T>(method: "GET" | "POST" | "PUT", path: string, options: { exactJson?: string; idempotencyKey?: string }): Promise<Success<T> & { httpStatus: number }>;
  listContents(filters: { kind?: "article" | "case"; externalId?: string; status?: "active" | "published" | "deleted"; page?: number; pageSize?: number }): Promise<Success<ContentList> & { httpStatus: number }>;
  getContent(id: string): Promise<Success<CmsRecord> & { httpStatus: number }>;
  validate(id: string, revisionId: string, idempotencyKey: string): Promise<Success<Validation> & { httpStatus: number }>;
  getJob(id: string): Promise<Success<Job> & { httpStatus: number }>;
}

export interface OfficialApiFormalBinding { accountId: string; articleId: string; contentBindingId: string }
export interface OfficialApiRuntimeOptions {
  operationStore: OfficialApiOperationStore;
  clientFactory: (ctx: AccountContext, scope: OfficialApiPreparedContent["scope"]) => OfficialApiRuntimeClient;
  formalExecution: { available: boolean; allowedBindings?: OfficialApiFormalBinding[]; authorizationValid?: () => boolean };
  readMediaBytes?: (filePath: string) => Promise<Uint8Array>;
  publicVerifier?: (input: { operation: OfficialApiOperation; publicUrl: string }) => Promise<{ ok: boolean; warning?: string; evidence: Record<string, unknown> }>;
}

export interface OfficialApiRunResult {
  status: "prepared" | "publishing" | "published" | "maintained" | "failed" | "needs_reconciliation";
  operation: OfficialApiOperation;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const hex64 = /^[a-f0-9]{64}$/u;
const origins = { staging: "https://staging.kangyihb.com", production: "https://xn--4gq502b.com" } as const;
const timestamp = (): string => new Date().toISOString();
const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => JSON.stringify(value);
const semanticJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(item => semanticJsonValue(item) ?? null);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .flatMap(key => {
      const normalized = semanticJsonValue((value as Record<string, unknown>)[key]);
      return normalized === undefined ? [] : [[key, normalized]];
    }));
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
};
const safeErrorCode = (error: unknown): string => {
  if (error instanceof ClientError && /^[A-Z0-9_]{1,64}$/u.test(error.code)) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]{1,64}$/u.test(error.message)) return error.message;
  return "OFFICIAL_API_OPERATION_FAILED";
};
const isUnknownWrite = (error: unknown): boolean => error instanceof ClientError && (error.outcomeUnknown || error.status === 0 || error.status >= 500);
const operationKey = (operation: OfficialApiOperation, kind: string, identity: string): string =>
  `official_v2_${sha256([operation.jobId, operation.accountId, operation.articleId, operation.contentBindingId,
    operation.siteId, operation.environment, operation.keyId, kind, identity].join("\n"))}`;
const exactStep = <T = Record<string, unknown>>(operation: OfficialApiOperation, kind: string, identity: string, body: unknown): OfficialApiJsonStep<T> => {
  const exactJson = canonical(body);
  return { state: "PLANNED", idempotencyKey: operationKey(operation, kind, identity), exactJson, bodySha256: sha256(exactJson) };
};
const sameJson = (left: unknown, right: unknown): boolean => canonical(semanticJsonValue(left)) === canonical(semanticJsonValue(right));

function assertRemoteContent(operation: OfficialApiOperation, record: CmsRecord, expectedDraft?: CmsRecord["draft"], allowDeleted = false): OfficialApiContentIdentity {
  if (!uuid.test(record.id) || record.contentId !== record.id || !uuid.test(record.revisionId) || !hex64.test(record.contentHash)
    || !Number.isSafeInteger(record.rowVersion) || record.rowVersion < 1 || record.siteId !== operation.siteId
    || record.environment !== operation.environment || record.principalId !== operation.keyId
    || record.externalId !== operation.externalId || record.kind !== operation.prepared.settings.kind || !allowDeleted && record.deletedAt !== null
    || (expectedDraft !== undefined && !sameJson(record.draft, expectedDraft))) throw new Error("WEBSITE_CONTENT_RESPONSE_MISMATCH");
  return { contentId: record.id, revisionId: record.revisionId, contentHash: record.contentHash, rowVersion: record.rowVersion };
}

function assertContext(ctx: AccountContext, operation: OfficialApiOperation, article?: PublishArticleInput): void {
  if (ctx.platformKey !== "website" || ctx.accountId !== operation.accountId || ctx.settings.publishJobId !== operation.jobId
    || article && article.articleId !== operation.articleId) throw new Error("WEBSITE_JOB_SCOPE_MISMATCH");
}

function trustedPublicUrl(operation: OfficialApiOperation, value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    const prefix = operation.prepared.settings.kind === "case" ? "/cases/" : "/news/";
    const expectedPath = `${prefix}${operation.prepared.slug}`;
    return !url.username && !url.password && url.origin === origins[operation.environment]
      && (url.pathname === expectedPath || url.pathname === `${expectedPath}/`) && !url.search && !url.hash;
  } catch { return false; }
}

export class OfficialApiDurableRuntime {
  private readonly readMediaBytes: (filePath: string) => Promise<Uint8Array>;
  private readonly activeJobs = new Set<string>();

  constructor(private readonly options: OfficialApiRuntimeOptions) {
    this.readMediaBytes = options.readMediaBytes ?? (async filePath => new Uint8Array(await readFile(filePath)));
  }

  assertFormalSubmitAvailable(): void {
    if (!this.options.formalExecution.available) throw new Error("WEBSITE_FORMAL_EXECUTION_UNAVAILABLE");
    if (this.options.formalExecution.authorizationValid && !this.options.formalExecution.authorizationValid())
      throw new Error("WEBSITE_ACCEPTANCE_EXPIRED");
  }

  async prepare(ctx: AccountContext, prepared: OfficialApiPreparedContent, jobId: string): Promise<OfficialApiRunResult> {
    return this.exclusive(jobId, () => this.prepareUnlocked(ctx, prepared, jobId));
  }

  private async prepareUnlocked(ctx: AccountContext, prepared: OfficialApiPreparedContent, jobId: string): Promise<OfficialApiRunResult> {
    this.assertFormalBinding(prepared);
    if (ctx.platformKey !== "website" || ctx.accountId !== prepared.scope.accountId || ctx.settings.publishJobId !== jobId)
      throw new Error("WEBSITE_JOB_SCOPE_MISMATCH");
    let operation = this.initialize(jobId, prepared);
    assertContext(ctx, operation);
    const client = this.options.clientFactory(ctx, prepared.scope);

    for (let index = 0; index < operation.media.length; index += 1) {
      let step = operation.media[index]!;
      if (step.state === "SUCCEEDED") {
        if (!step.remote) throw new Error("WEBSITE_MEDIA_IDENTITY_MISSING");
        const verified = await client.verifyPrivateMedia(step.remote);
        if (verified.httpStatus !== 200 || !this.sameMedia(step.remote, verified)) throw new Error("WEBSITE_PRIVATE_MEDIA_MISMATCH");
        continue;
      }
      if (step.state === "DISPATCHING" || step.state === "OUTCOME_UNKNOWN") return this.needsReconciliation(operation, "WEBSITE_MEDIA_OUTCOME_UNKNOWN");
      if (step.state === "FAILED") return { status: "failed", operation };
      const image = prepared.images.find(item => item.assetId === step.assetId);
      if (!image) throw new Error("WEBSITE_MEDIA_BINDING_REQUIRED");
      const bytes = await this.readMediaBytes(image.filePath);
      if (bytes.byteLength !== image.bytes || sha256(bytes) !== image.sha256) throw new Error("WEBSITE_MEDIA_FILE_CHANGED");
      this.assertFormalBinding(prepared);
      operation = this.replaceMedia(operation, index, { ...step, state: "DISPATCHING" });
      step = operation.media[index]!;
      let responseReceived = false;
      try {
        const response = await client.uploadMedia(bytes, step.mime, step.idempotencyKey);
        responseReceived = true;
        if (response.httpStatus !== 201 || !this.sameMedia(step, response.data)) throw new Error("WEBSITE_MEDIA_RESPONSE_MISMATCH");
        operation = this.replaceMedia(operation, index, { ...step, state: "DISPATCHING", remote: response.data, errorCode: undefined });
        step = operation.media[index]!;
        const verified = await client.verifyPrivateMedia(response.data);
        if (verified.httpStatus !== 200 || !this.sameMedia(response.data, verified)) throw new Error("WEBSITE_PRIVATE_MEDIA_MISMATCH");
        operation = this.replaceMedia(operation, index, { ...step, state: "SUCCEEDED", remote: response.data });
      } catch (error) {
        const outcomeUnknown = responseReceived || isUnknownWrite(error);
        step = operation.media[index]!;
        operation = this.replaceMedia(operation, index, { ...step, state: outcomeUnknown ? "OUTCOME_UNKNOWN" : "FAILED", errorCode: safeErrorCode(error) },
          outcomeUnknown ? "NEEDS_RECONCILIATION" : "FAILED", safeErrorCode(error));
        throw error;
      }
    }

    const remoteMedia = Object.fromEntries(operation.media.map(item => {
      if (!item.remote) throw new Error("WEBSITE_MEDIA_IDENTITY_MISSING");
      return [item.assetId, item.remote];
    }));
    const draft = buildOfficialApiDraft(prepared, remoteMedia);
    if (!operation.create) operation = this.update(operation, { create: exactStep<OfficialApiContentIdentity>(operation, "create", operation.externalId,
      { externalId: operation.externalId, draft }) });
    if (operation.create!.state === "DISPATCHING" || operation.create!.state === "OUTCOME_UNKNOWN") return this.needsReconciliation(operation, "WEBSITE_CREATE_OUTCOME_UNKNOWN");
    if (operation.create!.state === "FAILED") return { status: "failed", operation };
    if (operation.create!.state !== "SUCCEEDED") {
      this.assertFormalBinding(prepared);
      operation = this.update(operation, { create: { ...operation.create!, state: "DISPATCHING" } });
      let responseReceived = false;
      try {
        const response = await client.request<CmsRecord>("POST", "/contents", {
          exactJson: operation.create!.exactJson, idempotencyKey: operation.create!.idempotencyKey
        });
        responseReceived = true;
        if (response.httpStatus !== 201) throw new Error("WEBSITE_CREATE_STATUS_UNEXPECTED");
        const identity = assertRemoteContent(operation, response.data, draft);
        operation = this.update(operation, { create: { ...operation.create!, state: "SUCCEEDED", response: identity }, remoteContent: identity });
      } catch (error) {
        const outcomeUnknown = responseReceived || isUnknownWrite(error);
        operation = this.update(operation, { phase: outcomeUnknown ? "NEEDS_RECONCILIATION" : "FAILED", errorCode: safeErrorCode(error),
          create: { ...operation.create!, state: outcomeUnknown ? "OUTCOME_UNKNOWN" : "FAILED", errorCode: safeErrorCode(error) } });
        throw error;
      }
    }

    if (!operation.remoteContent) throw new Error("WEBSITE_CONTENT_IDENTITY_MISSING");
    if (!operation.draft) operation = this.update(operation, { draft: exactStep<OfficialApiContentIdentity>(operation, "draft",
      `${operation.remoteContent.revisionId}:${operation.remoteContent.rowVersion}`, { rowVersion: operation.remoteContent.rowVersion, draft }) });
    if (operation.draft!.state === "DISPATCHING" || operation.draft!.state === "OUTCOME_UNKNOWN")
      return this.needsReconciliation(operation, "WEBSITE_DRAFT_OUTCOME_UNKNOWN");
    if (operation.draft!.state === "FAILED") return { status: "failed", operation };
    if (operation.draft!.state !== "SUCCEEDED") {
      const beforeDraft = operation.remoteContent;
      if (!beforeDraft) throw new Error("WEBSITE_CONTENT_IDENTITY_MISSING");
      this.assertFormalBinding(prepared);
      operation = this.update(operation, { draft: { ...operation.draft!, state: "DISPATCHING" } });
      let responseReceived = false;
      try {
        const response = await client.request<CmsRecord>("PUT", `/contents/${encodeURIComponent(beforeDraft.contentId)}/draft`, {
          exactJson: operation.draft!.exactJson, idempotencyKey: operation.draft!.idempotencyKey
        });
        responseReceived = true;
        if (response.httpStatus !== 200) throw new Error("WEBSITE_DRAFT_STATUS_UNEXPECTED");
        const identity = assertRemoteContent(operation, response.data, draft);
        if (identity.contentId !== beforeDraft.contentId || identity.rowVersion < beforeDraft.rowVersion)
          throw new Error("WEBSITE_DRAFT_RESPONSE_MISMATCH");
        operation = this.update(operation, { draft: { ...operation.draft!, state: "SUCCEEDED", response: identity }, remoteContent: identity });
      } catch (error) {
        const outcomeUnknown = responseReceived || isUnknownWrite(error);
        operation = this.update(operation, { phase: outcomeUnknown ? "NEEDS_RECONCILIATION" : "FAILED", errorCode: safeErrorCode(error),
          draft: { ...operation.draft!, state: outcomeUnknown ? "OUTCOME_UNKNOWN" : "FAILED", errorCode: safeErrorCode(error) } });
        throw error;
      }
    }

    const preparedContent = operation.remoteContent;
    if (!preparedContent) throw new Error("WEBSITE_CONTENT_IDENTITY_MISSING");
    const latest = (await client.getContent(preparedContent.contentId)).data;
    const latestIdentity = assertRemoteContent(operation, latest, draft);
    if (!sameJson(latestIdentity, operation.remoteContent)) throw new Error("WEBSITE_DRAFT_READBACK_MISMATCH");
    if (!operation.validate) operation = this.update(operation, { validate: exactStep(operation, "validate", preparedContent.revisionId,
      { revisionId: preparedContent.revisionId }) });
    if (operation.validate!.state === "DISPATCHING" || operation.validate!.state === "OUTCOME_UNKNOWN") return this.needsReconciliation(operation, "WEBSITE_VALIDATE_OUTCOME_UNKNOWN");
    if (operation.validate!.state === "FAILED") return { status: "failed", operation };
    if (operation.validate!.state !== "SUCCEEDED") {
      this.assertFormalBinding(prepared);
      operation = this.update(operation, { validate: { ...operation.validate!, state: "DISPATCHING" } });
      let responseReceived = false;
      try {
        const remoteContent = operation.remoteContent;
        if (!remoteContent) throw new Error("WEBSITE_CONTENT_IDENTITY_MISSING");
        const response = await client.request<Validation>("POST", `/contents/${encodeURIComponent(remoteContent.contentId)}/validate`, {
          exactJson: operation.validate!.exactJson, idempotencyKey: operation.validate!.idempotencyKey
        });
        responseReceived = true;
        const data = response.data;
        if (response.httpStatus !== 200 || !data.valid || data.contentId !== remoteContent.contentId
          || data.revisionId !== remoteContent.revisionId || data.contentHash !== remoteContent.contentHash)
          throw new Error("WEBSITE_VALIDATION_RESPONSE_MISMATCH");
        operation = this.update(operation, { phase: "PREPARED", errorCode: undefined,
          validate: { ...operation.validate!, state: "SUCCEEDED", response: { valid: true, revisionId: data.revisionId, contentHash: data.contentHash } } });
      } catch (error) {
        const outcomeUnknown = responseReceived || isUnknownWrite(error);
        operation = this.update(operation, { phase: outcomeUnknown ? "NEEDS_RECONCILIATION" : "FAILED", errorCode: safeErrorCode(error),
          validate: { ...operation.validate!, state: outcomeUnknown ? "OUTCOME_UNKNOWN" : "FAILED", errorCode: safeErrorCode(error) } });
        throw error;
      }
    }
    return { status: "prepared", operation };
  }

  getPreparedArticleInput(ctx: AccountContext): PublishArticleInput {
    const operation = this.requireContextOperation(ctx);
    const byId = (assetId: string) => {
      const image = operation.prepared.images.find(item => item.assetId === assetId);
      if (!image) throw new Error("WEBSITE_MEDIA_BINDING_REQUIRED");
      return image.filePath;
    };
    const coverPath = operation.prepared.settings.coverAssetId ? byId(operation.prepared.settings.coverAssetId) : undefined;
    const imageIds = [...new Set([...operation.prepared.settings.bodyImageAssetIds, ...operation.prepared.settings.galleryAssetIds])];
    return { articleId: operation.articleId, title: operation.prepared.source.title, body: operation.prepared.source.body,
      summary: operation.prepared.source.summary, tags: [...operation.prepared.source.tags],
      ...(coverPath ? { coverPath } : {}), ...(imageIds.length ? { images: imageIds.map(byId) } : {}),
      category: operation.prepared.settings.category ?? operation.prepared.source.articleType,
      location: operation.prepared.settings.location ?? operation.prepared.source.city };
  }

  async prepareFinalSubmit(ctx: AccountContext, article: PublishArticleInput): Promise<BrowserPublishPreflightResult> {
    const operation = this.requireContextOperation(ctx, article);
    this.assertFormalBinding(operation.prepared);
    this.assertFrozenArticleInput(article, this.getPreparedArticleInput(ctx));
    if (operation.phase !== "PREPARED") throw new Error("WEBSITE_OPERATION_NOT_PREPARED");
    return { response: { adapter: "website", stage: "official_api_prepared", jobId: operation.jobId,
      contentBindingId: operation.contentBindingId, finalSubmit: "platform_specific_once" } };
  }

  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    return this.exclusive(attempt.jobId, () => this.finalSubmitUnlocked(ctx, article, attempt));
  }

  private async finalSubmitUnlocked(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    let operation = this.requireContextOperation(ctx, article);
    this.assertFormalBinding(operation.prepared);
    this.assertFrozenArticleInput(article, this.getPreparedArticleInput(ctx));
    if (attempt.jobId !== operation.jobId) throw new Error("WEBSITE_JOB_SCOPE_MISMATCH");
    if (!attempt.markSubmissionSideEffect) throw new Error("WEBSITE_FINAL_SUBMIT_CLAIM_REQUIRED");
    const client = this.options.clientFactory(ctx, operation.prepared.scope);
    if (operation.remoteJob) return this.collect(ctx, article, operation, client);
    if (operation.phase === "PUBLISH_DISPATCHING" || operation.publish?.state === "OUTCOME_UNKNOWN") {
      const recovered = await this.recoverOriginalOperationUnlocked(ctx, operation.jobId);
      if (recovered.operation.remoteJob) return this.collect(ctx, article, recovered.operation, client);
      return this.needsReconciliationResult(recovered.operation);
    }
    if (operation.phase !== "PREPARED" || !operation.remoteContent || operation.validate?.state !== "SUCCEEDED")
      throw new Error("WEBSITE_OPERATION_NOT_PREPARED");
    await this.finalPreflight(operation, client);
    this.assertFormalBinding(operation.prepared);
    const remoteContent = operation.remoteContent;
    if (!remoteContent) throw new Error("WEBSITE_CONTENT_IDENTITY_MISSING");
    if (!operation.publish) operation = this.update(operation, { publish: exactStep<OfficialApiContentIdentity & { jobId: string }>(operation, "publish", remoteContent.revisionId, {
      revisionId: remoteContent.revisionId, contentHash: remoteContent.contentHash, rowVersion: remoteContent.rowVersion
    }) });
    operation = this.update(operation, { phase: "PUBLISH_DISPATCHING", publish: { ...operation.publish!, state: "DISPATCHING" } });
    try {
      attempt.markSubmissionSideEffect();
    } catch (error) {
      operation = this.update(operation, { phase: "NEEDS_RECONCILIATION", errorCode: safeErrorCode(error),
        publish: { ...operation.publish!, state: "OUTCOME_UNKNOWN", errorCode: safeErrorCode(error) } });
      throw error;
    }
    let responseReceived = false;
    try {
      const response = await client.request<Job>("POST", `/contents/${encodeURIComponent(remoteContent.contentId)}/publish`, {
        exactJson: operation.publish!.exactJson, idempotencyKey: operation.publish!.idempotencyKey
      });
      responseReceived = true;
      const job = response.data;
      if (response.httpStatus !== 202 || !uuid.test(job.jobId) || job.operation !== "publish" || job.siteId !== operation.siteId
        || job.environment !== operation.environment || job.contentId !== remoteContent.contentId
        || job.revisionId !== remoteContent.revisionId || job.contentHash !== remoteContent.contentHash)
        throw new Error("WEBSITE_PUBLISH_RESPONSE_MISMATCH");
      const publishResponse = { ...remoteContent, jobId: job.jobId };
      operation = this.update(operation, { phase: "PUBLISH_ACCEPTED", errorCode: undefined,
        publish: { ...operation.publish!, state: "SUCCEEDED", response: publishResponse },
        remoteJob: { jobId: job.jobId, status: job.status, publicUrl: job.publicUrl } });
      return { success: true, status: "publishing", externalId: remoteContent.contentId,
        response: this.publishResponse(operation, "publish_accepted", { submissionIntentId: attempt.submissionIntentId }) };
    } catch (error) {
      const outcomeUnknown = responseReceived || isUnknownWrite(error);
      operation = this.update(operation, { phase: outcomeUnknown ? "NEEDS_RECONCILIATION" : "FAILED", errorCode: safeErrorCode(error),
        publish: { ...operation.publish!, state: outcomeUnknown ? "OUTCOME_UNKNOWN" : "FAILED", errorCode: safeErrorCode(error) } });
      throw error;
    }
  }

  async collectPublishResult(ctx: AccountContext, article: PublishArticleInput, _attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const jobId = this.jobIdFromContext(ctx);
    return this.exclusive(jobId, async () => {
      const operation = this.requireContextOperation(ctx, article);
      const client = this.options.clientFactory(ctx, operation.prepared.scope);
      return this.collect(ctx, article, operation, client);
    });
  }

  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, _result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const jobId = this.jobIdFromContext(ctx);
    return this.exclusive(jobId, async () => {
      const operation = this.requireContextOperation(ctx, article);
      const collected = await this.collect(ctx, article, operation, this.options.clientFactory(ctx, operation.prepared.scope));
      return { status: collected.status ?? "failed", externalId: collected.externalId, publishedUrl: collected.publishedUrl,
        response: collected.response };
    });
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    const jobId = this.jobIdFromContext(ctx);
    return this.exclusive(jobId, async () => {
      let operation = this.requireContextOperation(ctx);
      if (!operation.remoteContent || operation.remoteContent.contentId !== externalId)
        throw new Error("WEBSITE_CONTENT_ID_MISMATCH");
      if (!operation.remoteJob) {
        const recovered = await this.recoverOriginalOperationUnlocked(ctx, jobId);
        operation = recovered.operation;
      }
      if (!operation.remoteJob) throw new ClientError("REMOTE_STATUS_UNKNOWN", "原发布任务尚无可查询的远端任务编号", 0,
        undefined, undefined, undefined, true);
      const frozen = this.getPreparedArticleInput(ctx);
      const collected = await this.collect(ctx, frozen, operation, this.options.clientFactory(ctx, operation.prepared.scope));
      return { status: collected.status ?? "failed", externalId: collected.externalId, publishedUrl: collected.publishedUrl,
        response: collected.response };
    });
  }

  async recoverOriginalOperation(ctx: AccountContext, jobId: string): Promise<OfficialApiRunResult> {
    return this.exclusive(jobId, () => this.recoverOriginalOperationUnlocked(ctx, jobId));
  }

  private async recoverOriginalOperationUnlocked(ctx: AccountContext, jobId: string): Promise<OfficialApiRunResult> {
    let operation = this.options.operationStore.getByJobId(jobId);
    if (!operation) throw new Error("WEBSITE_OPERATION_NOT_FOUND");
    assertContext(ctx, operation);
    const client = this.options.clientFactory(ctx, operation.prepared.scope);
    for (let index = 0; index < operation.media.length; index += 1) {
      const item = operation.media[index]!;
      if (item.state !== "DISPATCHING" && item.state !== "OUTCOME_UNKNOWN") continue;
      if (!item.remote) return this.needsReconciliation(operation, "WEBSITE_MEDIA_OUTCOME_UNKNOWN");
      try {
        const verified = await client.verifyPrivateMedia(item.remote);
        if (verified.httpStatus !== 200 || !this.sameMedia(item.remote, verified))
          return this.needsReconciliation(operation, "WEBSITE_PRIVATE_MEDIA_MISMATCH");
        operation = this.replaceMedia(operation, index, { ...item, state: "SUCCEEDED", errorCode: undefined }, "PREPARING");
      } catch {
        return this.needsReconciliation(operation, "WEBSITE_PRIVATE_MEDIA_READ_UNKNOWN");
      }
    }
    if (!operation.create && operation.media.every(item => item.state === "SUCCEEDED" && item.remote))
      return this.prepareUnlocked(ctx, operation.prepared, jobId);
    if (operation.create?.state === "DISPATCHING" || operation.create?.state === "OUTCOME_UNKNOWN") {
      const draft = buildOfficialApiDraft(operation.prepared, Object.fromEntries(operation.media.map(item => {
        if (!item.remote) throw new Error("WEBSITE_MEDIA_IDENTITY_MISSING");
        return [item.assetId, item.remote];
      })));
      const listed = await client.listContents({ kind: operation.prepared.settings.kind, externalId: operation.externalId, page: 1, pageSize: 20 });
      const matches = listed.data.items.filter(item => {
        try { assertRemoteContent(operation!, item, draft); return true; } catch { return false; }
      });
      if (listed.data.total !== 1 || matches.length !== 1) return this.needsReconciliation(operation, "WEBSITE_CREATE_IDENTITY_NOT_UNIQUE");
      const identity = assertRemoteContent(operation, matches[0]!, draft);
      operation = this.update(operation, { phase: "PREPARING", errorCode: undefined,
        create: { ...operation.create, state: "SUCCEEDED", response: identity, errorCode: undefined }, remoteContent: identity });
      return this.prepareUnlocked(ctx, operation.prepared, jobId);
    }
    if (operation.draft?.state === "DISPATCHING" || operation.draft?.state === "OUTCOME_UNKNOWN") {
      const before = operation.create?.response;
      if (!before || !operation.remoteContent) return this.needsReconciliation(operation, "WEBSITE_DRAFT_IDENTITY_MISSING");
      const remote = (await client.getContent(operation.remoteContent.contentId)).data;
      const draft = buildOfficialApiDraft(operation.prepared, Object.fromEntries(operation.media.map(item => {
        if (!item.remote) throw new Error("WEBSITE_MEDIA_IDENTITY_MISSING");
        return [item.assetId, item.remote];
      })));
      let identity: OfficialApiContentIdentity;
      try { identity = assertRemoteContent(operation, remote, draft); }
      catch { return this.needsReconciliation(operation, "WEBSITE_DRAFT_OUTCOME_UNKNOWN"); }
      if (identity.contentId !== before.contentId || identity.rowVersion <= before.rowVersion)
        return this.needsReconciliation(operation, "WEBSITE_DRAFT_OUTCOME_UNKNOWN");
      operation = this.update(operation, { phase: "PREPARING", errorCode: undefined, remoteContent: identity,
        draft: { ...operation.draft, state: "SUCCEEDED", response: identity, errorCode: undefined } });
      return this.prepareUnlocked(ctx, operation.prepared, jobId);
    }
    if (operation.publish?.state === "DISPATCHING" || operation.publish?.state === "OUTCOME_UNKNOWN") {
      if (operation.remoteJob) return this.readKnownJob(operation, client);
      if (!operation.remoteContent) return this.needsReconciliation(operation, "WEBSITE_PUBLISH_IDENTITY_MISSING");
      try {
        const recovered = await recoverAppliedPublishResponse(client, {
          siteId: operation.siteId, environment: operation.environment, principalId: operation.keyId,
          externalId: operation.externalId, contentId: operation.remoteContent.contentId, kind: operation.prepared.settings.kind,
          revisionId: operation.remoteContent.revisionId, contentHash: operation.remoteContent.contentHash,
          rowVersion: operation.remoteContent.rowVersion, exactJson: operation.publish.exactJson,
          idempotencyKey: operation.publish.idempotencyKey
        });
        const job = recovered.data;
        operation = this.update(operation, { phase: "PUBLISH_ACCEPTED", errorCode: undefined,
          publish: { ...operation.publish, state: "SUCCEEDED", errorCode: undefined,
            response: { ...operation.remoteContent, jobId: job.jobId } },
          remoteJob: { jobId: job.jobId, status: job.status, publicUrl: job.publicUrl } });
        return this.readKnownJob(operation, client);
      } catch {
        return this.needsReconciliation(operation, "WEBSITE_PUBLISH_OUTCOME_UNKNOWN");
      }
    }
    const pendingMaintenanceIndex = operation.maintenance.map(item => item.state === "PLANNED" || item.state === "DISPATCHING" || item.state === "OUTCOME_UNKNOWN"
      || Boolean(item.remoteJob && !["succeeded", "failed", "needs_attention"].includes(item.remoteJob.status))).lastIndexOf(true);
    if (pendingMaintenanceIndex >= 0) {
      if (!operation.maintenance[pendingMaintenanceIndex]!.remoteJob)
        return this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_OUTCOME_UNKNOWN");
      return this.pollMaintenance(operation, pendingMaintenanceIndex, client);
    }
    const terminalMaintenance = operation.maintenance.at(-1);
    if (terminalMaintenance?.state === "SUCCEEDED" && terminalMaintenance.remoteJob?.status === "succeeded")
      return { status: "maintained", operation };
    if (terminalMaintenance?.state === "FAILED" || terminalMaintenance?.remoteJob?.status === "failed")
      return { status: "failed", operation };
    if (terminalMaintenance?.remoteJob?.status === "needs_attention")
      return this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_NEEDS_ATTENTION");
    if (operation.remoteJob) return this.readKnownJob(operation, client);
    return operation.phase === "PREPARED" ? { status: "prepared", operation }
      : operation.phase === "FAILED" ? { status: "failed", operation }
        : this.needsReconciliation(operation, operation.errorCode ?? "WEBSITE_RECOVERY_NOT_PROVABLE");
  }

  async maintainOwnContent(ctx: AccountContext, input: { jobId: string; operation: "unpublish" | "delete" | "restore" | "purge";
    mainAuthorization?: { acceptanceRunId: string; explicitPermission: true } }): Promise<OfficialApiRunResult> {
    return this.exclusive(input.jobId, () => this.maintainOwnContentUnlocked(ctx, input));
  }

  private async maintainOwnContentUnlocked(ctx: AccountContext, input: { jobId: string; operation: "unpublish" | "delete" | "restore" | "purge";
    mainAuthorization?: { acceptanceRunId: string; explicitPermission: true } }): Promise<OfficialApiRunResult> {
    let operation = this.options.operationStore.getByJobId(input.jobId);
    if (!operation || !operation.remoteContent) throw new Error("WEBSITE_OPERATION_NOT_FOUND");
    assertContext(ctx, operation);
    const client = this.options.clientFactory(ctx, operation.prepared.scope);
    if (operation.publish?.state === "DISPATCHING" || operation.publish?.state === "OUTCOME_UNKNOWN")
      return this.recoverOriginalOperationUnlocked(ctx, input.jobId);
    if (operation.publish?.state !== "SUCCEEDED" || !operation.remoteJob)
      throw new Error("WEBSITE_ORIGINAL_PUBLISH_REQUIRED");
    if (operation.remoteJob.status !== "succeeded" && operation.remoteJob.status !== "failed")
      return this.readKnownJob(operation, client);
    const pendingIndex = operation.maintenance.map(item => item.state === "PLANNED" || item.state === "DISPATCHING" || item.state === "OUTCOME_UNKNOWN" || item.remoteJob
        && !["succeeded", "failed", "needs_attention"].includes(item.remoteJob.status)).lastIndexOf(true);
    if (pendingIndex >= 0) {
      const pending = operation.maintenance[pendingIndex]!;
      if (!pending.remoteJob) return this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_OUTCOME_UNKNOWN");
      return this.pollMaintenance(operation, pendingIndex, client);
    }
    const current = (await client.getContent(operation.remoteContent.contentId)).data;
    assertRemoteContent(operation, current, undefined, true);
    if (current.id !== operation.remoteContent.contentId) throw new Error("WEBSITE_MAINTENANCE_OWNERSHIP_MISMATCH");
    if (input.operation === "purge" && operation.remoteJob?.status !== "succeeded")
      throw new Error("WEBSITE_PURGE_ORIGINAL_PUBLISH_REQUIRED");
    if (input.operation === "purge" && (!input.mainAuthorization?.explicitPermission || !input.mainAuthorization.acceptanceRunId || current.deletedAt === null))
      throw new Error("WEBSITE_PURGE_MAIN_AUTHORIZATION_REQUIRED");
    const body = input.operation === "unpublish" || input.operation === "delete"
      ? { rowVersion: current.rowVersion, expectedPublishedRevisionId: current.publishedRevisionId,
          ...(input.operation === "delete" ? { reason: "GEO owner-requested maintenance" } : {}) }
      : input.operation === "restore" ? { rowVersion: current.rowVersion }
        : { rowVersion: current.rowVersion, acceptanceRunId: input.mainAuthorization!.acceptanceRunId };
    const maintenanceId = `${input.operation}:${current.rowVersion}`;
    const existing = operation.maintenance.find(item => item.maintenanceId === maintenanceId);
    if (existing) {
      if (existing.state === "SUCCEEDED" && existing.remoteJob?.status === "succeeded") return { status: "maintained", operation };
      if (existing.state === "FAILED" || existing.remoteJob?.status === "failed") return { status: "failed", operation };
      return existing.remoteJob ? this.pollMaintenance(operation, operation.maintenance.indexOf(existing), client)
        : this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_ALREADY_DISPATCHED");
    }
    const step: OfficialApiMaintenanceStep = { maintenanceId, operation: input.operation, state: "PLANNED",
      idempotencyKey: operationKey(operation, input.operation, maintenanceId), exactJson: canonical(body), bodySha256: sha256(canonical(body)),
      sourceRowVersion: current.rowVersion, jobBinding: { revisionId: null, contentHash: null } };
    operation = this.update(operation, { maintenance: [...operation.maintenance, step] });
    const index = operation.maintenance.length - 1;
    operation = this.update(operation, { maintenance: operation.maintenance.map((item, itemIndex) => itemIndex === index ? { ...item, state: "DISPATCHING" } : item) });
    let responseReceived = false;
    try {
      const response = await client.request<Job>("POST", `/contents/${encodeURIComponent(current.id)}/${input.operation}`, {
        exactJson: step.exactJson, idempotencyKey: step.idempotencyKey
      });
      responseReceived = true;
      const job = response.data;
      if (response.httpStatus !== 202 || !uuid.test(job.jobId) || job.operation !== input.operation || job.siteId !== operation.siteId
        || job.environment !== operation.environment || job.contentId !== current.id
        || job.revisionId !== step.jobBinding!.revisionId || job.contentHash !== step.jobBinding!.contentHash)
        throw new Error("WEBSITE_MAINTENANCE_RESPONSE_MISMATCH");
      operation = this.update(operation, { maintenance: operation.maintenance.map((item, itemIndex) => itemIndex === index
        ? { ...item, state: "DISPATCHING", remoteJob: { jobId: job.jobId, status: job.status, publicUrl: job.publicUrl } } : item) });
      return { status: "publishing", operation };
    } catch (error) {
      const outcomeUnknown = responseReceived || isUnknownWrite(error);
      operation = this.update(operation, { phase: outcomeUnknown ? "NEEDS_RECONCILIATION" : operation.phase,
        maintenance: operation.maintenance.map((item, itemIndex) => itemIndex === index
          ? { ...item, state: outcomeUnknown ? "OUTCOME_UNKNOWN" : "FAILED", errorCode: safeErrorCode(error) } : item) });
      throw error;
    }
  }

  private initialize(jobId: string, prepared: OfficialApiPreparedContent): OfficialApiOperation {
    const bySource = this.options.operationStore.findBySource(prepared.scope.accountId, prepared.source.articleId);
    if (bySource && bySource.jobId !== jobId) throw new Error("OFFICIAL_API_SOURCE_ALREADY_BOUND");
    const existing = this.options.operationStore.getByJobId(jobId);
    if (existing) {
      if (existing.accountId !== prepared.scope.accountId || existing.articleId !== prepared.source.articleId
        || existing.contentBindingId !== prepared.contentBindingId || existing.sourceHash !== prepared.sourceHash
        || !sameJson(existing.prepared, prepared)) throw new Error("WEBSITE_FROZEN_BINDING_MISMATCH");
      return existing;
    }
    const now = timestamp();
    const seed: OfficialApiOperation = { version: 1, revision: 0, jobId, accountId: prepared.scope.accountId,
      articleId: prepared.source.articleId, siteId: "kangyi", environment: prepared.scope.environment,
      keyId: prepared.scope.keyId, sourceHash: prepared.sourceHash, contentBindingId: prepared.contentBindingId,
      externalId: `geo-${prepared.settings.kind}-${prepared.contentBindingId.slice(0, 48)}`,
      phase: "PREPARING", prepared: structuredClone(prepared), media: [], maintenance: [], createdAt: now, updatedAt: now };
    seed.media = prepared.images.map(image => ({ assetId: image.assetId, state: "PLANNED" as const,
      idempotencyKey: operationKey(seed, "media", image.assetId), sha256: image.sha256, mime: image.mimeType as Media["mime"],
      bytes: image.bytes, width: image.width, height: image.height }));
    return this.options.operationStore.insert(seed);
  }

  private jobIdFromContext(ctx: AccountContext): string {
    const jobId = ctx.settings.publishJobId;
    if (typeof jobId !== "string" || !jobId) throw new Error("WEBSITE_PUBLISH_JOB_REQUIRED");
    return jobId;
  }

  private async exclusive<T>(jobId: string, action: () => Promise<T>): Promise<T> {
    if (this.activeJobs.has(jobId)) throw new Error("OFFICIAL_API_OPERATION_BUSY");
    this.activeJobs.add(jobId);
    try { return await action(); }
    finally { this.activeJobs.delete(jobId); }
  }

  private assertFormalBinding(prepared: OfficialApiPreparedContent): void {
    this.assertFormalSubmitAvailable();
    const allowed = this.options.formalExecution.allowedBindings;
    if (allowed !== undefined && !allowed.some(binding => binding.accountId === prepared.scope.accountId
      && binding.articleId === prepared.source.articleId && binding.contentBindingId === prepared.contentBindingId))
      throw new Error("WEBSITE_BINDING_NOT_AUTHORIZED");
  }

  private requireContextOperation(ctx: AccountContext, article?: PublishArticleInput): OfficialApiOperation {
    const jobId = ctx.settings.publishJobId;
    if (typeof jobId !== "string" || !jobId) throw new Error("WEBSITE_PUBLISH_JOB_REQUIRED");
    const operation = this.options.operationStore.getByJobId(jobId);
    if (!operation) throw new Error("WEBSITE_OPERATION_NOT_FOUND");
    assertContext(ctx, operation, article);
    return operation;
  }

  private assertFrozenArticleInput(actual: PublishArticleInput, frozen: PublishArticleInput): void {
    if (actual.articleId !== frozen.articleId || actual.title !== frozen.title || actual.body !== frozen.body
      || actual.summary !== frozen.summary || !sameJson(actual.tags, frozen.tags)
      || actual.coverPath !== frozen.coverPath || !sameJson(actual.images ?? [], frozen.images ?? [])
      || actual.category !== frozen.category || actual.location !== frozen.location)
      throw new Error("WEBSITE_FROZEN_ARTICLE_INPUT_MISMATCH");
  }

  private update(operation: OfficialApiOperation, fields: Partial<OfficialApiOperation>): OfficialApiOperation {
    const next = { ...operation, ...fields, revision: operation.revision, updatedAt: timestamp() };
    return this.options.operationStore.compareAndSwap(operation.jobId, operation.revision, next);
  }

  private replaceMedia(operation: OfficialApiOperation, index: number, step: OfficialApiMediaStep,
    phase?: OfficialApiOperationPhase, errorCode?: string): OfficialApiOperation {
    return this.update(operation, { ...(phase ? { phase } : {}), ...(errorCode ? { errorCode } : {}),
      media: operation.media.map((item, itemIndex) => itemIndex === index ? step : item) });
  }

  private sameMedia(expected: Pick<Media, "sha256" | "mime" | "width" | "height" | "bytes"> & { mediaId?: string },
    actual: { mediaId: string; sha256: string; mime: string; width: number; height: number; bytes: number }): boolean {
    return uuid.test(actual.mediaId) && (expected.mediaId === undefined || actual.mediaId === expected.mediaId) && actual.sha256 === expected.sha256
      && actual.mime === expected.mime && actual.width === expected.width && actual.height === expected.height && actual.bytes === expected.bytes;
  }

  private needsReconciliation(operation: OfficialApiOperation, errorCode: string): OfficialApiRunResult {
    const updated = operation.phase === "NEEDS_RECONCILIATION" && operation.errorCode === errorCode
      ? operation : this.update(operation, { phase: "NEEDS_RECONCILIATION", errorCode });
    return { status: "needs_reconciliation", operation: updated };
  }

  private needsReconciliationResult(operation: OfficialApiOperation): PublishResult {
    return { success: false, status: "failed", externalId: operation.remoteContent?.contentId,
      response: this.publishResponse(operation, "needs_reconciliation", { code: operation.errorCode ?? "REMOTE_STATUS_UNKNOWN" }) };
  }

  private async pollMaintenance(operation: OfficialApiOperation, index: number,
    client: OfficialApiRuntimeClient): Promise<OfficialApiRunResult> {
    const step = operation.maintenance[index];
    if (!step?.remoteJob || !operation.remoteContent) return this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_JOB_MISSING");
    if (!step.jobBinding || !("revisionId" in step.jobBinding) || !("contentHash" in step.jobBinding))
      return this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_JOB_BINDING_MISSING");
    const remoteContent = operation.remoteContent;
    const job = (await client.getJob(step.remoteJob.jobId)).data;
    if (job.jobId !== step.remoteJob.jobId || job.operation !== step.operation || job.siteId !== operation.siteId
      || job.environment !== operation.environment || job.contentId !== operation.remoteContent.contentId
      || job.revisionId !== step.jobBinding.revisionId || job.contentHash !== step.jobBinding.contentHash)
      return this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_JOB_MISMATCH");
    operation = this.update(operation, { maintenance: operation.maintenance.map((item, itemIndex) => itemIndex === index
      ? { ...item, remoteJob: { jobId: job.jobId, status: job.status, publicUrl: job.publicUrl } } : item) });
    if (job.status === "failed") {
      operation = this.update(operation, { maintenance: operation.maintenance.map((item, itemIndex) => itemIndex === index
        ? { ...item, state: "FAILED", errorCode: job.error?.code ?? "WEBSITE_MAINTENANCE_FAILED" } : item) });
      return { status: "failed", operation };
    }
    if (job.status === "needs_attention") return this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_NEEDS_ATTENTION");
    if (job.status !== "succeeded") return { status: "publishing", operation };

    if (step.operation === "purge") {
      let absent = false;
      try { await client.getContent(remoteContent.contentId); }
      catch (error) { absent = error instanceof ClientError && error.status === 404; }
      if (!absent) return this.needsReconciliation(operation, "WEBSITE_PURGE_TOMBSTONE_NOT_CONFIRMED");
    } else {
      const remote = (await client.getContent(remoteContent.contentId)).data;
      if (remote.id !== remoteContent.contentId || remote.contentId !== remoteContent.contentId
        || remote.siteId !== operation.siteId || remote.environment !== operation.environment || remote.principalId !== operation.keyId
        || remote.externalId !== operation.externalId || remote.kind !== operation.prepared.settings.kind
        || !Number.isSafeInteger(remote.rowVersion) || remote.rowVersion <= step.sourceRowVersion
        || step.operation === "unpublish" && remote.publishedRevisionId !== null
        || step.operation === "delete" && remote.deletedAt === null
        || step.operation === "restore" && remote.deletedAt !== null)
        return this.needsReconciliation(operation, "WEBSITE_MAINTENANCE_READBACK_MISMATCH");
      operation = this.update(operation, { remoteContent: { contentId: remote.id, revisionId: remote.revisionId,
        contentHash: remote.contentHash, rowVersion: remote.rowVersion } });
    }
    operation = this.update(operation, { maintenance: operation.maintenance.map((item, itemIndex) => itemIndex === index
      ? { ...item, state: "SUCCEEDED", errorCode: undefined,
          remoteJob: { jobId: job.jobId, status: "succeeded", publicUrl: job.publicUrl } } : item) });
    return { status: "maintained", operation };
  }

  private async readKnownJob(operation: OfficialApiOperation, client: OfficialApiRuntimeClient): Promise<OfficialApiRunResult> {
    if (!operation.remoteJob) return this.needsReconciliation(operation, "WEBSITE_REMOTE_JOB_MISSING");
    const job = (await client.getJob(operation.remoteJob.jobId)).data;
    let updated = this.assertAndRecordJob(operation, job);
    if (job.status === "succeeded") {
      updated = await this.verifyFidelityIfNeeded(updated, job);
      return { status: "published", operation: updated };
    }
    if (job.status === "failed") return { status: "failed", operation: updated };
    if (job.status === "needs_attention") return this.needsReconciliation(updated, "WEBSITE_JOB_NEEDS_ATTENTION");
    return { status: "publishing", operation: updated };
  }

  private async collect(ctx: AccountContext, article: PublishArticleInput, operation: OfficialApiOperation,
    client: OfficialApiRuntimeClient): Promise<PublishResult> {
    assertContext(ctx, operation, article);
    if (!operation.remoteJob || !operation.remoteContent) return this.needsReconciliationResult(operation);
    const remoteContent = operation.remoteContent;
    const job = (await client.getJob(operation.remoteJob.jobId)).data;
    operation = this.assertAndRecordJob(operation, job);
    if (job.status === "failed") return { success: false, status: "failed", externalId: remoteContent.contentId,
      response: this.publishResponse(operation, "publish_failed") };
    if (job.status === "needs_attention") return this.needsReconciliationResult(this.needsReconciliation(operation, "WEBSITE_JOB_NEEDS_ATTENTION").operation);
    if (job.status !== "succeeded") return { success: true, status: "publishing", externalId: remoteContent.contentId,
      response: this.publishResponse(operation, job.status) };
    operation = await this.verifyFidelityIfNeeded(operation, job);
    const fidelity = operation.fidelity;
    return { success: true, status: "published", externalId: remoteContent.contentId, publishedUrl: job.publicUrl ?? undefined,
      response: this.publishResponse(operation, "published", {
        publicFidelity: fidelity?.ok === false ? "WARNING" : fidelity?.ok ? "PASS" : "NOT_CHECKED",
        ...(fidelity?.warning ? { publicFidelityWarning: fidelity.warning } : {}) }) };
  }

  private async verifyFidelityIfNeeded(operation: OfficialApiOperation, job: Job): Promise<OfficialApiOperation> {
    if (operation.fidelity || !this.options.publicVerifier || !job.publicUrl) return operation;
    let fidelity: OfficialApiOperation["fidelity"];
    try { fidelity = await this.options.publicVerifier({ operation, publicUrl: job.publicUrl }); }
    catch { fidelity = { ok: false, warning: "PUBLIC_FIDELITY_CHECK_FAILED", evidence: {} }; }
    return this.update(operation, { fidelity });
  }

  private async finalPreflight(operation: OfficialApiOperation, client: OfficialApiRuntimeClient): Promise<void> {
    if (!operation.remoteContent) throw new Error("WEBSITE_CONTENT_IDENTITY_MISSING");
    const health = await client.health();
    if (health.httpStatus !== 200 || health.data.status !== "ok" || health.data.protocolVersion !== "2")
      throw new Error("WEBSITE_HEALTH_FAILED");
    const capabilities = await client.capabilities();
    if (capabilities.httpStatus !== 200 || capabilities.data.siteId !== operation.siteId
      || capabilities.data.environment !== operation.environment || capabilities.data.protocolVersion !== "2"
      || !capabilities.data.contentKinds.includes(operation.prepared.settings.kind)) throw new Error("WEBSITE_CAPABILITY_MISMATCH");
    if (!capabilities.data.writesEnabled) throw new Error("WEBSITE_WRITES_DISABLED");
    const remote = (await client.getContent(operation.remoteContent.contentId)).data;
    const identity = assertRemoteContent(operation, remote, buildOfficialApiDraft(operation.prepared,
      Object.fromEntries(operation.media.map(item => {
        if (!item.remote) throw new Error("WEBSITE_MEDIA_IDENTITY_MISSING");
        return [item.assetId, item.remote];
      }))));
    if (!sameJson(identity, operation.remoteContent)) throw new Error("WEBSITE_FINAL_CONTENT_CHANGED");
    for (const item of operation.media) {
      if (!item.remote) throw new Error("WEBSITE_MEDIA_IDENTITY_MISSING");
      const verified = await client.verifyPrivateMedia(item.remote);
      if (verified.httpStatus !== 200 || !this.sameMedia(item.remote, verified)) throw new Error("WEBSITE_PRIVATE_MEDIA_MISMATCH");
    }
  }

  private publishResponse(operation: OfficialApiOperation, stage: string,
    extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { adapter: "website", stage, contentId: operation.remoteContent?.contentId ?? null,
      revisionId: operation.remoteContent?.revisionId ?? null, contentHash: operation.remoteContent?.contentHash ?? null,
      rowVersion: operation.remoteContent?.rowVersion ?? null, remoteJobId: operation.remoteJob?.jobId ?? null,
      ...extra };
  }

  private assertAndRecordJob(operation: OfficialApiOperation, job: Job): OfficialApiOperation {
    if (!operation.remoteContent || !operation.remoteJob || job.jobId !== operation.remoteJob.jobId || job.operation !== "publish"
      || job.siteId !== operation.siteId || job.environment !== operation.environment || job.contentId !== operation.remoteContent.contentId
      || job.revisionId !== operation.remoteContent.revisionId || job.contentHash !== operation.remoteContent.contentHash)
      throw new Error("WEBSITE_JOB_RESPONSE_MISMATCH");
    if (job.status === "succeeded" && !trustedPublicUrl(operation, job.publicUrl)) throw new Error("WEBSITE_PUBLIC_URL_UNTRUSTED");
    const phase: OfficialApiOperationPhase = job.status === "succeeded" ? "PUBLISHED" : job.status === "failed" ? "FAILED"
      : job.status === "needs_attention" ? "NEEDS_RECONCILIATION" : "PUBLISHING";
    return this.update(operation, { phase, remoteJob: { jobId: job.jobId, status: job.status, publicUrl: job.publicUrl },
      ...(job.status === "failed" ? { errorCode: job.error?.code ?? "WEBSITE_PUBLISH_FAILED" } : {}) });
  }
}
