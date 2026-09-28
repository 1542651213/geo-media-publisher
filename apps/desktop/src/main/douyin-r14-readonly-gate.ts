/** The R1.14 runtime exposes only exact-job reconciliation and account-owned read-only inspection. */
const allowed = new Set([
  "dashboard:get", "platforms:list", "accounts:list", "accounts:overview", "articles:get", "jobs:list",
  "accounts:activate-douyin-image-text", "accounts:readiness-douyin-image-text",
  "accounts:inspect-douyin-management", "accounts:inspect-douyin-management-topology",
  "jobs:reconcile-browser", "logs:list", "settings:get"
]);

const accountScoped = new Set([
  "accounts:activate-douyin-image-text", "accounts:readiness-douyin-image-text",
  "accounts:inspect-douyin-management", "accounts:inspect-douyin-management-topology"
]);

export function assertDouyinR14ReadOnlyChannel(channel: string, payload: unknown,
  binding: { jobId: string; accountId: string; articleId: string; nativeSubmitEnabled: boolean }): void {
  if (!binding.jobId || !binding.accountId || !binding.articleId || binding.nativeSubmitEnabled)
    throw new Error("DOUYIN_R14_READONLY_RUNTIME_BINDING_INVALID");
  if (!allowed.has(channel)) throw new Error("DOUYIN_R14_READONLY_CHANNEL_ONLY");
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (accountScoped.has(channel) && input.accountId !== binding.accountId)
    throw new Error("DOUYIN_R14_READONLY_ACCOUNT_MISMATCH");
  if (channel === "accounts:inspect-douyin-management-topology"
    && input.jobId !== binding.jobId)
    throw new Error("DOUYIN_R14_READONLY_JOB_MISMATCH");
  if (channel === "jobs:reconcile-browser" && input.id !== binding.jobId)
    throw new Error("DOUYIN_R14_READONLY_JOB_MISMATCH");
  if (channel === "articles:get" && input.id !== binding.articleId)
    throw new Error("DOUYIN_R14_READONLY_ARTICLE_MISMATCH");
}
