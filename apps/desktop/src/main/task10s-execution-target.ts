import type { AppRepository } from "@publisher/db";

/** The immutable IDs used by every live Task10S phase. */
export interface Task10sExecutionTarget {
  testRunId: string;
  publishJobId: string;
  publishRecordId: string;
  authorizationId: string;
  accountId: string;
}

export const TASK10S_EXECUTION_TARGET_FAILURE_CODES = [
  "RUN_NOT_FOUND",
  "RUN_HAS_NO_BOUND_JOB",
  "JOB_NOT_FOUND",
  "RECORD_NOT_FOUND",
  "AUTHORIZATION_NOT_FOUND",
  "ACCOUNT_BINDING_MISMATCH",
  "JOB_RUN_BINDING_MISMATCH",
  "RECORD_JOB_BINDING_MISMATCH",
  "AUTHORIZATION_RUN_BINDING_MISMATCH",
  "AUTHORIZATION_ACCOUNT_MISMATCH"
] as const;

export type Task10sExecutionTargetFailureCode = typeof TASK10S_EXECUTION_TARGET_FAILURE_CODES[number];

export type Task10sExecutionTargetResolution =
  | { status: "PASS"; target: Task10sExecutionTarget }
  | { status: "BLOCKED"; target: null; failureCode: Task10sExecutionTargetFailureCode };

type AuthorizationRow = { id?: unknown };

function blocked(failureCode: Task10sExecutionTargetFailureCode): Task10sExecutionTargetResolution {
  return { status: "BLOCKED", target: null, failureCode };
}

function countPreparedRecords(repository: AppRepository, jobId: string): number {
  const row = repository.db.prepare("SELECT COUNT(*) AS count FROM publish_records WHERE job_id=? AND status='Prepared'").get(jobId) as { count?: unknown } | undefined;
  return typeof row?.count === "number" ? row.count : Number(row?.count ?? 0);
}

/**
 * Resolves one explicit Task10S run into its complete execution target.
 * Every lookup is scoped to the supplied run or the IDs it owns; no latest,
 * canonical, or account-global fallback is permitted.
 */
export function resolveTask10sExecutionTarget(repository: AppRepository, testRunId: string): Task10sExecutionTargetResolution {
  if (!testRunId.trim()) return blocked("RUN_NOT_FOUND");

  const run = repository.getPlatformSelfTestRun(testRunId);
  if (!run || run.platformKey !== "xiaohongshu") return blocked("RUN_NOT_FOUND");
  if (!run.publishJobId) return blocked("RUN_HAS_NO_BOUND_JOB");

  const job = repository.getJob(run.publishJobId);
  if (!job) return blocked("JOB_NOT_FOUND");
  const jobWithRun = job as typeof job & { testRunId?: string | null };
  if (jobWithRun.testRunId && jobWithRun.testRunId !== run.testRunId) return blocked("JOB_RUN_BINDING_MISMATCH");
  if (run.accountId !== job.accountId || run.platformAccountId !== job.platformAccountId || job.platformKey !== run.platformKey) return blocked("ACCOUNT_BINDING_MISMATCH");

  const record = repository.getPublishRecordByJob(job.id);
  if (!record || record.status !== "Prepared") return blocked("RECORD_NOT_FOUND");
  if (countPreparedRecords(repository, job.id) !== 1) return blocked("RECORD_NOT_FOUND");
  if (record.jobId !== job.id) return blocked("RECORD_JOB_BINDING_MISMATCH");
  if (record.accountId !== job.accountId || (record.platformAccountId ?? job.platformAccountId) !== job.platformAccountId || record.platformKey !== job.platformKey || record.articleId !== job.articleId) return blocked("RECORD_JOB_BINDING_MISMATCH");
  if (run.publishRecordId && run.publishRecordId !== record.id) return blocked("RECORD_JOB_BINDING_MISMATCH");

  const authorization = repository.getOneShotPublicationAuthorization(testRunId);
  if (!authorization
    || authorization.authorization !== "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH"
    || authorization.platformKey !== "xiaohongshu"
    || authorization.mode !== "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE"
    || authorization.state !== "AUTHORIZED_UNUSED"
    || authorization.publicationTransactionCount !== 0
    || authorization.publicationCommitActionCount !== 0
    || authorization.finalSubmitAttemptCount !== 0
    || authorization.finalSubmitRetryCount !== 0
    || authorization.finalSubmitActionStarted
    || authorization.finalSubmitActionCompleted) return blocked("AUTHORIZATION_NOT_FOUND");
  if (authorization.operationId !== run.testRunId) return blocked("AUTHORIZATION_RUN_BINDING_MISMATCH");
  if (authorization.accountId !== run.accountId) return blocked("AUTHORIZATION_ACCOUNT_MISMATCH");

  const authorizationRow = repository.db.prepare("SELECT id FROM one_shot_publication_authorizations WHERE operation_id=?").get(testRunId) as AuthorizationRow | undefined;
  const authorizationId = typeof authorizationRow?.id === "string" ? authorizationRow.id : "";
  if (!authorizationId) return blocked("AUTHORIZATION_NOT_FOUND");

  return {
    status: "PASS",
    target: {
      testRunId: run.testRunId,
      publishJobId: job.id,
      publishRecordId: record.id,
      authorizationId,
      accountId: run.accountId
    }
  };
}
