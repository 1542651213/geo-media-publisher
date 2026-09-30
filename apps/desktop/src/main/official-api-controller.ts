import type { AppRepository } from "@publisher/db";
import type { AccountContext, PublishJob } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import { readOfficialApiCredential, KANGYI_SITE_CONFIG, type OfficialApiCredential } from "../../../../packages/adapters/official-api/src";
import type { OfficialApiOperation, OfficialApiOperationStore, OfficialApiRunResult } from "../../../../packages/adapters/official-api/src/runtime";
import type { OfficialApiPreparedContent } from "../../../../packages/adapters/official-api/src/mapping";
import type { OfficialApiJobView, OfficialApiMaintenanceOperation } from "../shared/official-api";
import { candidateBindingAllowed, type OfficialApiAcceptanceSelection } from "./official-api-candidate";
import { freezeOfficialApiSelection } from "./official-api-selection";
import { verifyOfficialApiConnection } from "./official-api-account";

interface MainAdapter {
  inspect(config: OfficialApiCredential): Promise<unknown>;
  prepare(ctx: AccountContext, content: OfficialApiPreparedContent, jobId: string): Promise<OfficialApiRunResult>;
  recoverOriginalOperation(ctx: AccountContext, jobId: string): Promise<OfficialApiRunResult>;
  maintainOwnContent(ctx: AccountContext, input: { jobId: string; operation: OfficialApiMaintenanceOperation;
    mainAuthorization?: { acceptanceRunId: string; explicitPermission: true } }): Promise<OfficialApiRunResult>;
}
interface Dependencies { repository: AppRepository; credentials: CredentialStore; store: OfficialApiOperationStore;
  adapter: MainAdapter; ordinaryEnabled: boolean; grants: OfficialApiAcceptanceSelection[] }
interface PrepareInput { articleId: string; platformAccountId: string; websiteSettings: unknown }
const code = (error: unknown): string => error instanceof Error && /^[A-Z0-9_]{1,100}$/u.test(error.message) ? error.message : "WEBSITE_OPERATION_FAILED";

/** Owns the ordinary UI preparation and task-scoped maintenance. No arbitrary remote IDs are accepted. */
export class OfficialApiController {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly deps: Dependencies) {}

  availability() { return { ordinaryEnabled: this.deps.ordinaryEnabled,
    candidateSelections: this.deps.grants.map(({ accountId, articleId, kind }) => ({ accountId, articleId, kind })) }; }

  assertCredentialReconfiguration(accountId: string, next: OfficialApiCredential): void {
    const current = readOfficialApiCredential(this.deps.credentials, accountId);
    if (["origin", "siteId", "environment", "keyId", "secret"].every(field => current[field as keyof OfficialApiCredential] === next[field as keyof OfficialApiCredential])) return;
    for (const job of this.deps.repository.listJobs().filter(value => value.platformKey === "website" && value.accountId === accountId)) {
      const operation = this.deps.store.getByJobId(job.id);
      if (!operation) {
        const row = this.deps.repository.db.prepare("SELECT publish_payload_json FROM publish_jobs WHERE id=?").get(job.id) as { publish_payload_json?: string } | undefined;
        if (row?.publish_payload_json?.includes("officialApiFrozenScope")) throw new Error("WEBSITE_ORIGINAL_CREDENTIAL_STILL_REQUIRED");
        continue;
      }
      const last = operation.maintenance.at(-1);
      if (last?.remoteJob?.status !== "succeeded" || last.operation !== "purge") throw new Error("WEBSITE_ORIGINAL_CREDENTIAL_STILL_REQUIRED");
    }
  }

  allowsCandidateRequest(channel: string, payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const value = payload as Record<string, unknown>;
    try {
      if (channel === "articles:prepare-publish" && value.platformKey === "website"
        && typeof value.articleId === "string" && typeof value.platformAccountId === "string"
        && value.finalPublishMode !== "AUTO_PUBLISH") {
        const selected = this.selection({ articleId: value.articleId, platformAccountId: value.platformAccountId, websiteSettings: value.websiteSettings });
        return this.deps.ordinaryEnabled || this.authorizedCandidate(selected.prepared);
      }
      if (["jobs:confirm", "jobs:run"].includes(channel) && typeof value.id === "string") {
        if (channel === "jobs:confirm" && value.dryRun !== false) return false;
        const operation = this.deps.store.getByJobId(value.id);
        const job = this.deps.repository.getJob(value.id);
        return Boolean(operation && (this.deps.ordinaryEnabled || this.authorizedCandidate(operation.prepared))
          && job?.status === (channel === "jobs:confirm" ? "AwaitingConfirmation" : "Scheduled")
          && operation.phase === "PREPARED" && (this.deps.repository.getSubmissionIntentByJob(value.id)?.finalSubmitCount ?? 0) === 0);
      }
    } catch { return false; }
    return false;
  }

  async prepare(input: PrepareInput) {
    const selected = this.selection(input);
    return this.exclusive(`prepare:${selected.account.id}:${input.articleId}`, async () => {
      const verified = await verifyOfficialApiConnection({ repository: this.deps.repository, credentials: this.deps.credentials,
        verify: config => this.deps.adapter.inspect(config) }, selected.account.id);
      if (!verified.writesEnabled) throw new Error("WEBSITE_WRITES_DISABLED");
      const { account, prepared } = this.selection(input);
      if (!this.deps.ordinaryEnabled && !this.authorizedCandidate(prepared)) throw new Error("WEBSITE_CANDIDATE_BINDING_NOT_AUTHORIZED");
      const existing = this.deps.store.findBySource(account.id, input.articleId);
      if (existing && existing.contentBindingId !== prepared.contentBindingId) throw new Error("WEBSITE_FROZEN_BINDING_CHANGED");
      const job = existing ? this.deps.repository.getJob(existing.jobId) : this.deps.repository.createArticlePublishJob({
        articleId: input.articleId, platformKey: "website", platformAccountId: account.platformAccountId ?? account.id,
        finalPublishMode: "CONFIRM_BEFORE_PUBLISH", articleTransport: "api", imageSelectionMode: "none", selectedImageAssetId: null });
      if (!job || job.platformKey !== "website" || job.accountId !== account.id) throw new Error("WEBSITE_JOB_BINDING_MISMATCH");
      if (this.deps.repository.getSubmissionIntentByJob(job.id)?.finalSubmitCount) throw new Error("WEBSITE_ORIGINAL_SUBMISSION_REQUIRES_RECOVERY");
      this.deps.repository.db.prepare("UPDATE publish_jobs SET max_attempts=1,publish_payload_json=? WHERE id=? AND platform_key='website'")
        .run(JSON.stringify({ officialApiFrozenScope: prepared.scope, contentBindingId: prepared.contentBindingId }), job.id);
      if (existing?.phase === "PREPARED") return this.preparedResult(job, existing);
      try {
        const result = await this.deps.adapter.prepare(this.context(job.id), prepared, job.id);
        if (result.status !== "prepared") throw new Error("WEBSITE_ORIGINAL_OPERATION_REQUIRES_RECOVERY");
        return this.preparedResult(job, result.operation);
      } catch (error) {
        const current = this.deps.store.getByJobId(job.id);
        this.deps.repository.updateJobFailure(job.id, current?.phase === "NEEDS_RECONCILIATION" ? "NeedsReconciliation" : "NeedsUserAction",
          code(error), "官网准备未完成；请检查原任务，不会创建替代内容。", null);
        throw new Error(code(error));
      }
    });
  }

  jobState(jobId: string): OfficialApiJobView | null {
    const operation = this.deps.store.getByJobId(jobId);
    if (!operation) return null;
    const last = operation.maintenance.at(-1);
    const grant = this.deps.grants.find(value => candidateBindingAllowed([value], this.binding(operation.prepared)));
    return { jobId, phase: last?.remoteJob?.status === "succeeded" ? ({ unpublish: "UNPUBLISHED", delete: "DELETED", restore: "RESTORED", purge: "CLEANED" })[last.operation] : last && ["queued", "processing", "verifying"].includes(last.remoteJob?.status ?? "") ? `MAINTENANCE_${last.operation.toUpperCase()}` : operation.phase,
      contentId: operation.remoteContent?.contentId ?? null, revisionId: operation.remoteContent?.revisionId ?? null,
      contentHash: operation.remoteContent?.contentHash ?? null, rowVersion: operation.remoteContent?.rowVersion ?? null,
      remoteJobId: last?.remoteJob?.jobId ?? operation.remoteJob?.jobId ?? null, publicUrl: operation.remoteJob?.publicUrl ?? null,
      kind: operation.prepared.settings.kind, siteId: operation.siteId, environment: operation.environment,
      publicContentVerified: operation.fidelity?.ok ?? null, fidelityWarning: operation.fidelity?.warning ?? null,
      errorCode: operation.errorCode ?? null, canPurge: Boolean(operation.environment === "staging" && grant?.acceptanceRunId) };
  }

  async recover(jobId: string): Promise<OfficialApiJobView> {
    return this.exclusive(`operation:${jobId}`, async () => {
      const result = await this.deps.adapter.recoverOriginalOperation(this.context(jobId), jobId);
      const job = this.deps.repository.getJob(jobId);
      if (!job) throw new Error("WEBSITE_JOB_NOT_FOUND");
      const maintenance = result.operation.maintenance.at(-1);
      if (!maintenance && result.status === "prepared") this.preparedResult(job, result.operation);
      if (!maintenance && result.status === "published" && result.operation.remoteContent && result.operation.remoteJob?.publicUrl
        && !["Success", "Published"].includes(job.status)) {
        const intent = this.deps.repository.getSubmissionIntentByJob(jobId);
        if (intent?.finalSubmitCount !== 1) throw new Error("WEBSITE_DURABLE_FINAL_CLAIM_REQUIRED");
        if (!["NeedsReconciliation", "Submitted", "Publishing"].includes(job.status))
          this.deps.repository.updateJobFailure(jobId, "NeedsReconciliation", "RECONCILIATION_UNCERTAIN", "恢复原始官网提交结果", null);
        this.deps.repository.reconcileJobAsPublished(jobId, { externalId: result.operation.remoteContent.contentId,
          publishedUrl: result.operation.remoteJob.publicUrl, response: this.metadata(result.operation) });
      }
      return this.jobState(jobId)!;
    });
  }

  async maintain(input: { jobId: string; operation: OfficialApiMaintenanceOperation }): Promise<OfficialApiJobView> {
    return this.exclusive(`operation:${input.jobId}`, async () => {
      const operation = this.deps.store.getByJobId(input.jobId);
      if (!operation) throw new Error("WEBSITE_OPERATION_NOT_FOUND");
      const grant = this.deps.grants.find(value => candidateBindingAllowed([value], this.binding(operation.prepared)));
      if (input.operation === "purge" && (!grant?.acceptanceRunId || operation.environment !== "staging")) throw new Error("WEBSITE_TEST_PURGE_AUTHORITY_REQUIRED");
      await this.deps.adapter.maintainOwnContent(this.context(input.jobId), { ...input,
        ...(input.operation === "purge" ? { mainAuthorization: { acceptanceRunId: grant!.acceptanceRunId!, explicitPermission: true as const } } : {}) });
      return this.jobState(input.jobId)!;
    });
  }

  private selection(input: PrepareInput) {
    const account = this.deps.repository.listAccounts().find(value => value.platformKey === "website"
      && (value.id === input.platformAccountId || value.platformAccountId === input.platformAccountId));
    if (!account?.enabled || account.archivedAt || account.loginStatus !== "logged_in") throw new Error("WEBSITE_ACCOUNT_NOT_CONNECTED");
    const article = this.deps.repository.getArticle(input.articleId);
    if (!article || this.deps.repository.getBrand(article.brandId)?.companyName !== KANGYI_SITE_CONFIG.brand) throw new Error("WEBSITE_KANGYI_BRAND_REQUIRED");
    const credential = readOfficialApiCredential(this.deps.credentials, account.id);
    if (account.externalAccountId !== `${credential.siteId}:${credential.environment}`) throw new Error("WEBSITE_ACCOUNT_SCOPE_MISMATCH");
    const prepared = freezeOfficialApiSelection(this.deps.repository, input.articleId, { accountId: account.id,
      siteId: credential.siteId, environment: credential.environment, keyId: credential.keyId }, input.websiteSettings);
    return { account, prepared };
  }
  private binding(prepared: OfficialApiPreparedContent) { return { ...prepared.scope, articleId: prepared.source.articleId,
    kind: prepared.settings.kind, contentBindingId: prepared.contentBindingId }; }
  private authorizedCandidate(prepared: OfficialApiPreparedContent) { return candidateBindingAllowed(this.deps.grants, this.binding(prepared)); }
  private context(jobId: string): AccountContext {
    const job = this.deps.repository.getJob(jobId);
    const account = job && this.deps.repository.getAccountById(job.accountId, "website");
    if (!job || job.platformKey !== "website" || !account?.enabled || account.archivedAt) throw new Error("WEBSITE_JOB_ACCOUNT_UNAVAILABLE");
    const operation = this.deps.store.getByJobId(jobId);
    if (operation) {
      const credential = readOfficialApiCredential(this.deps.credentials, account.id);
      if (credential.siteId !== operation.siteId || credential.environment !== operation.environment || credential.keyId !== operation.keyId)
        throw new Error("WEBSITE_ORIGINAL_CREDENTIAL_SCOPE_REQUIRED");
    }
    return { accountId: account.id, accountName: account.name, platformKey: "website", settings: { publishJobId: jobId, dryRun: false, manualConfirmationRequired: true } };
  }
  private metadata(operation: OfficialApiOperation): Record<string, unknown> { return { adapter: "website", siteId: operation.siteId,
    environment: operation.environment, kind: operation.prepared.settings.kind, contentBindingId: operation.contentBindingId,
    contentId: operation.remoteContent?.contentId ?? null, revisionId: operation.remoteContent?.revisionId ?? null,
    contentHash: operation.remoteContent?.contentHash ?? null, rowVersion: operation.remoteContent?.rowVersion ?? null,
    remoteJobId: operation.remoteJob?.jobId ?? null, publicUrl: operation.remoteJob?.publicUrl ?? null,
    publicContentVerified: operation.fidelity?.ok ?? null, fidelityWarning: operation.fidelity?.warning ?? null }; }
  private preparedResult(job: PublishJob, operation: OfficialApiOperation) {
    if (operation.phase !== "PREPARED" || this.deps.repository.getSubmissionIntentByJob(job.id)?.finalSubmitCount) throw new Error("WEBSITE_PREPARED_ORIGINAL_JOB_REQUIRED");
    this.deps.repository.db.prepare("UPDATE publish_jobs SET status='AwaitingConfirmation',next_retry_at=NULL,last_error_code=NULL,last_error_message=NULL WHERE id=? AND platform_key='website' AND status IN ('Pending','Retry','NeedsUserAction','NeedsReconciliation','AwaitingConfirmation')").run(job.id);
    const old = this.deps.repository.getPublishRecordByJob(job.id);
    const record = old ? this.deps.repository.updatePublishRecord(old.id, { status: "Prepared", success: false, response: this.metadata(operation), verificationStatus: "WaitingUser" }) : this.deps.repository.insertPublishRecord({ jobId: job.id, accountId: job.accountId,
      platformAccountId: job.platformAccountId, platformKey: "website", articleId: job.articleId,
      publishedUrl: null, publishedExternalId: null, success: false, status: "Prepared", automationType: "API",
      response: this.metadata(operation), verificationStatus: "WaitingUser" });
    return { job: this.deps.repository.getJob(job.id)!, record, message: "官网图片、草稿与版本验证已完成；请确认原任务最终发布。" };
  }
  private async exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    const running = this.pending.get(key);
    if (running) return running as Promise<T>;
    const result = action(); this.pending.set(key, result);
    try { return await result; } finally { if (this.pending.get(key) === result) this.pending.delete(key); }
  }
}
