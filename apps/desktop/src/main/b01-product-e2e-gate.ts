type B01GateRepository = {
  listAccounts(): Array<{ id: string; platformKey: string; platformAccountId?: string }>;
  b01Eligibility(input: { accountId: string; articleId: string; imageAssetId: string }): { eligible: boolean };
  assertB01Job(jobId: string, stage: "final"): unknown;
};

/** Exception to the A01 product gate, limited to a Main-owned exact B01 grant. */
export function assertB01OperatorIpcException(channel: string, payload: unknown, repository: B01GateRepository): boolean {
  const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (channel === "articles:prepare-publish") {
    if (data.platformKey !== "douyin" || data.finalPublishMode !== "CONFIRM_BEFORE_PUBLISH"
      || data.imageSelectionMode !== "manual" || typeof data.selectedImageAssetId !== "string"
      || typeof data.articleId !== "string" || typeof data.platformAccountId !== "string") return false;
    const account = repository.listAccounts().find((item) => item.platformKey === "douyin" && (item.platformAccountId ?? item.id) === data.platformAccountId);
    return Boolean(account && repository.b01Eligibility({ accountId: account.id, articleId: data.articleId,
      imageAssetId: data.selectedImageAssetId }).eligible);
  }
  if (channel === "jobs:confirm" || channel === "jobs:run") {
    if (typeof data.id !== "string" || channel === "jobs:confirm" && data.dryRun !== false) return false;
    try { repository.assertB01Job(data.id, "final"); return true; }
    catch { return false; }
  }
  return false;
}

const unsafeDiagnosticChannels = new Set([
  "jobs:prepare-existing-douyin",
  "platform-self-test:run-post-upload-discovery", "platform-self-test:continue", "platform-self-test:run-level",
  "platform-self-test:request-publish", "platform-self-test:confirm-publish"
]);

/** Candidate and ordinary builds do not expose alternate real-submit paths. */
export function assertNoProductE2EDiagnosticSubmit(channel: string): void {
  if (unsafeDiagnosticChannels.has(channel)) throw new Error("B01_DIAGNOSTIC_SUBMIT_DISABLED");
}
