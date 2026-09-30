import type { Account, Platform } from "@publisher/domain";
import { operatorPublishBlockReason, productPlatform } from "../shared/product-platform-policy";

type JobPlatform = { platformKey: string };

export function assertOperatorPublishIpcRequest(
  channel: string,
  payload: unknown,
  findPlatform: (platformKey: string) => Platform | undefined,
  findJob: (jobId: string) => JobPlatform | null | undefined
): void {
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  let platformKey: string | null = null;
  if (channel === "articles:prepare-publish") {
    platformKey = typeof data.platformKey === "string" ? data.platformKey : "";
  } else if (["jobs:run", "jobs:confirm", "jobs:retry"].includes(channel)) {
    const job = typeof data.id === "string" ? findJob(data.id) : null;
    platformKey = job?.platformKey ?? "";
  }
  if (platformKey === null) return;
  const reason = operatorPublishBlockReason(platformKey, findPlatform(platformKey));
  if (reason) throw new Error(`普通运营发布已阻止：${reason}`);
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
