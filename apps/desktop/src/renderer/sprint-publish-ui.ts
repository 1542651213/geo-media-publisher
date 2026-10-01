import type { SprintAcceptanceSelection } from "../main/sprint-acceptance";
export function sprintUiSelection(grants: readonly SprintAcceptanceSelection[], platformKey: string,
  article: { id: string; contentHash: string } | null | undefined, accountId?: string): SprintAcceptanceSelection | null {
  if (!article) return null;
  return grants.find(grant => grant.platformKey === platformKey && grant.articleId === article.id
    && grant.contentHash === article.contentHash && (!accountId || grant.accountId === accountId)
    && Date.parse(grant.expiresAt) > Date.now()) ?? null;
}
export function confirmedProductActionAvailable(ordinaryEnabled: boolean, grants: readonly SprintAcceptanceSelection[],
  job: { platformKey: string; accountId: string; articleId: string; selectedImageAssetId?: string | null; status: string; finalPublishMode?: string },
  article: { id: string; contentHash: string } | null | undefined): boolean {
  if (!["weibo", "toutiao", "sohu_media", "cnblogs"].includes(job.platformKey)
    || !["AwaitingConfirmation", "DryRunPassed"].includes(job.status) || job.finalPublishMode !== "CONFIRM_BEFORE_PUBLISH") return false;
  const selection = sprintUiSelection(grants, job.platformKey, article, job.accountId);
  return ordinaryEnabled || Boolean(selection && selection.imageAssetId === (job.selectedImageAssetId ?? null));
}
