/** Exact opt-in target for a read-only Main diagnostic. No boundary may have been claimed. */
export function selectDouyinMusicDiagnosticTarget(input: {
  configuredAccountId: string | null; configuredJobId: string | null; requestedAccountId: string;
  job: { id: string; accountId: string; articleId: string; platformKey: string;
    contentKind?: string | null; status: string } | null;
  connection: { active: boolean; creatorId: string; loginGeneration: number;
    browserSessionIdHash: string } | null;
  intent: { state: string; finalSubmitCount: number; submitBoundaryEnteredAt: string | null } | null;
  record: { status?: string; response: Record<string, unknown> } | null;
}): { accountId: string; articleId: string; jobId: string; creatorId: string;
  loginGeneration: number; sessionIdHash: string } {
  const { job, connection, intent, record } = input;
  if (!input.configuredAccountId || !input.configuredJobId
    || input.requestedAccountId !== input.configuredAccountId
    || !job || job.id !== input.configuredJobId || job.accountId !== input.configuredAccountId
    || job.platformKey !== "douyin" || job.contentKind !== "article" || job.status !== "NeedsUserAction"
    || !connection?.active || !connection.creatorId || !connection.browserSessionIdHash
    || !intent || intent.state !== "Prepared" || intent.finalSubmitCount !== 0 || intent.submitBoundaryEnteredAt
    || !record || record.status !== "Prepared" || record.response.contentTransport !== "DOUYIN_IMAGE_TEXT_BROWSER")
    throw new Error("DOUYIN_MUSIC_DIAGNOSTIC_EXACT_PREBOUNDARY_JOB_REQUIRED");
  return { accountId: job.accountId, articleId: job.articleId, jobId: job.id,
    creatorId: connection.creatorId, loginGeneration: connection.loginGeneration,
    sessionIdHash: connection.browserSessionIdHash };
}
