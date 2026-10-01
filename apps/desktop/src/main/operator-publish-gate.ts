import type { Account, Platform } from "@publisher/domain";
import { operatorPublishBlockReason, productPlatform } from "../shared/product-platform-policy";

type JobPlatform = { platformKey: string; contentKind?: string | null };
export function assertProductDeveloperOperation(channel: string, enabled: boolean, platformKey?: string, level?: unknown): void {
  const diagnosticWrite = channel.startsWith("toutiao:") || ["jobs:prepare-existing-douyin", "b01:request-authorization", "b01:request-final-approval", "b01:retire-preboundary", "platform-self-test:run-safe", "platform-self-test:run-post-upload-discovery", "platform-self-test:run-level", "platform-self-test:continue", "platform-self-test:request-publish", "platform-self-test:confirm-publish", "platform-self-test:confirm-delete"].includes(channel);
  if (diagnosticWrite && !enabled) throw new Error("此诊断操作需要 Developer Mode；普通发布仍受 Main 门禁约束");
  const maySubmit = ["platform-self-test:request-publish", "platform-self-test:confirm-publish", "platform-self-test:continue"].includes(channel)
    || channel === "platform-self-test:run-level" && !["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT"].includes(String(level));
  if (maySubmit && (!platformKey || !productPlatform(platformKey)?.ordinaryPublishEnabled)) throw new Error("平台尚未开放普通发布，Developer Mode 不能绕过门禁");
}

export function assertOperatorPublishIpcRequest(
  channel: string,
  payload: unknown,
  findPlatform: (platformKey: string) => Platform | undefined,
  findJob: (jobId: string) => JobPlatform | null | undefined,
  allowOneShot?: (channel: string, payload: unknown) => boolean
): void {
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (channel === "jobs:create-video" && data.platformKey === "toutiao") throw new Error("TOUTIAO_ORDINARY_ARTICLE_ONLY");
  let platformKey: string | null = null;
  if (channel === "articles:prepare-publish") {
    platformKey = typeof data.platformKey === "string" ? data.platformKey : "";
  } else if (["jobs:run", "jobs:confirm", "jobs:retry"].includes(channel)) {
    const job = typeof data.id === "string" ? findJob(data.id) : null;
    if (job?.platformKey === "toutiao" && (job.contentKind ?? "article") !== "article") throw new Error("TOUTIAO_ORDINARY_ARTICLE_ONLY");
    platformKey = job?.platformKey ?? "";
  }
  if (platformKey === null) return;
  const reason = operatorPublishBlockReason(platformKey, findPlatform(platformKey));
  if (reason && !allowOneShot?.(channel, payload)) throw new Error(`普通运营发布已阻止：${reason}`);
}

export function assertOperatorBatchPlanAllowed(
  plan: { accountIds: string[] } | null | undefined,
  accounts: readonly Account[],
  platforms: readonly Platform[]
): void {
  if (!plan || plan.accountIds.length === 0) throw new Error("普通运营批量发布已阻止：发布计划没有可用账号");
  for (const accountId of plan.accountIds) {
    const account = accounts.find((item) => item.id === accountId);
    const platform = account && platforms.find((item) => item.platformKey === account.platformKey);
    const policy = account && productPlatform(account.platformKey);
    const reason = account && operatorPublishBlockReason(account.platformKey, platform);
    if (!account || !policy?.batchPublishEnabled || reason) throw new Error(`普通运营批量发布已阻止：${reason ?? "账号或批量能力不可用"}`);
  }
}
