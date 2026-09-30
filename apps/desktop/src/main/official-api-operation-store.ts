import type { AppRepository } from "@publisher/db";
import type { OfficialApiOperation, OfficialApiOperationStore } from "../../../../packages/adapters/official-api/src/runtime";

type Row = Record<string, unknown>;
const parse = (row: Row | undefined): OfficialApiOperation | null => {
  if (!row || typeof row.journal_json !== "string") return null;
  const value = JSON.parse(row.journal_json) as OfficialApiOperation;
  if (value.version !== 1 || value.jobId !== row.job_id || value.revision !== row.revision) throw new Error("OFFICIAL_API_JOURNAL_CORRUPT");
  return value;
};

export class SqliteOfficialApiOperationStore implements OfficialApiOperationStore {
  constructor(private readonly repository: Pick<AppRepository, "db">) {}

  insert(operation: OfficialApiOperation): OfficialApiOperation {
    if (operation.version !== 1 || operation.revision !== 0 || operation.jobId.length === 0) throw new Error("OFFICIAL_API_OPERATION_INVALID");
    const existing = this.findBySource(operation.accountId, operation.articleId);
    if (existing) throw new Error("OFFICIAL_API_SOURCE_ALREADY_BOUND");
    const job = this.repository.db.prepare("SELECT account_id,article_id,platform_key FROM publish_jobs WHERE id=?").get(operation.jobId) as Row | undefined;
    if (!job || job.account_id !== operation.accountId || job.article_id !== operation.articleId || job.platform_key !== "website")
      throw new Error("OFFICIAL_API_JOB_BINDING_MISMATCH");
    try {
      this.repository.db.prepare(`INSERT INTO official_api_operations (
        job_id,account_id,source_article_id,site_id,environment,key_id,source_hash,content_binding_id,phase,revision,
        remote_content_id,remote_revision_id,remote_content_hash,remote_row_version,remote_job_id,public_url,journal_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        operation.jobId, operation.accountId, operation.articleId, operation.siteId, operation.environment, operation.keyId,
        operation.sourceHash, operation.contentBindingId, operation.phase, operation.revision,
        operation.remoteContent?.contentId ?? null, operation.remoteContent?.revisionId ?? null,
        operation.remoteContent?.contentHash ?? null, operation.remoteContent?.rowVersion ?? null,
        operation.remoteJob?.jobId ?? null, operation.remoteJob?.publicUrl ?? null, JSON.stringify(operation), operation.createdAt, operation.updatedAt
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("official_api_operations.account_id, official_api_operations.source_article_id"))
        throw new Error("OFFICIAL_API_SOURCE_ALREADY_BOUND");
      throw error;
    }
    return this.getByJobId(operation.jobId) as OfficialApiOperation;
  }

  getByJobId(jobId: string): OfficialApiOperation | null {
    return parse(this.repository.db.prepare("SELECT job_id,revision,journal_json FROM official_api_operations WHERE job_id=?").get(jobId) as Row | undefined);
  }

  findBySource(accountId: string, articleId: string): OfficialApiOperation | null {
    return parse(this.repository.db.prepare("SELECT job_id,revision,journal_json FROM official_api_operations WHERE account_id=? AND source_article_id=?")
      .get(accountId, articleId) as Row | undefined);
  }

  compareAndSwap(jobId: string, expectedRevision: number, next: OfficialApiOperation): OfficialApiOperation {
    const current = this.getByJobId(jobId);
    if (!current || current.revision !== expectedRevision) throw new Error("OFFICIAL_API_OPERATION_CONCURRENT_UPDATE");
    if (next.jobId !== current.jobId || next.accountId !== current.accountId || next.articleId !== current.articleId
      || next.siteId !== current.siteId || next.environment !== current.environment || next.keyId !== current.keyId
      || next.sourceHash !== current.sourceHash || next.contentBindingId !== current.contentBindingId
      || next.externalId !== current.externalId || JSON.stringify(next.prepared) !== JSON.stringify(current.prepared))
      throw new Error("OFFICIAL_API_IMMUTABLE_BINDING_CHANGED");
    const stored: OfficialApiOperation = { ...next, revision: expectedRevision + 1 };
    const updated = this.repository.db.prepare(`UPDATE official_api_operations SET phase=?,revision=?,remote_content_id=?,remote_revision_id=?,
      remote_content_hash=?,remote_row_version=?,remote_job_id=?,public_url=?,journal_json=?,updated_at=? WHERE job_id=? AND revision=?`).run(
      stored.phase, stored.revision, stored.remoteContent?.contentId ?? null, stored.remoteContent?.revisionId ?? null,
      stored.remoteContent?.contentHash ?? null, stored.remoteContent?.rowVersion ?? null, stored.remoteJob?.jobId ?? null,
      stored.remoteJob?.publicUrl ?? null, JSON.stringify(stored), stored.updatedAt, jobId, expectedRevision
    );
    if (updated.changes !== 1) throw new Error("OFFICIAL_API_OPERATION_CONCURRENT_UPDATE");
    return this.getByJobId(jobId) as OfficialApiOperation;
  }
}
