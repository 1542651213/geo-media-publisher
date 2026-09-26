export interface DouyinAcceptanceTarget { accountId: string; articleId: string }
export interface AcceptanceJobRef { id: string; accountId: string; articleId: string; platformKey: string; contentKind: string | null }

/** The diagnostic process may prepare/run only its exact new image-post Job. */
export function assertDouyinAcceptanceChannel(channel: string, payload: unknown, target: DouyinAcceptanceTarget,
  findJob: (id: string) => AcceptanceJobRef | null): void {
  const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (channel === "articles:prepare-publish") {
    if (data.articleId === target.articleId && data.platformKey === "douyin" && data.platformAccountId === target.accountId
      && ["PREPARE_ONLY", "CONFIRM_BEFORE_PUBLISH"].includes(String(data.finalPublishMode))
      && data.imageSelectionMode === "manual") return;
    throw new Error("DOUYIN_ACCEPTANCE_EXACT_CANDIDATE_REQUIRED");
  }
  if (channel === "jobs:confirm" || channel === "jobs:run") {
    const job = typeof data.id === "string" ? findJob(data.id) : null;
    if (job && job.accountId === target.accountId && job.articleId === target.articleId
      && job.platformKey === "douyin" && job.contentKind !== "video"
      && (channel !== "jobs:confirm" || data.dryRun !== true)) return;
    throw new Error("DOUYIN_ACCEPTANCE_JOB_MISMATCH");
  }
  throw new Error("DOUYIN_ACCEPTANCE_OTHER_PUBLISH_PATHS_PAUSED");
}
