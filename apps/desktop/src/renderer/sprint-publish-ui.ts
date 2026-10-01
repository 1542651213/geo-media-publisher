import type { SprintAcceptanceSelection } from "../main/sprint-acceptance";
export function sprintUiSelection(grants: readonly SprintAcceptanceSelection[], platformKey: string,
  article: { id: string; contentHash: string } | null | undefined, accountId?: string): SprintAcceptanceSelection | null {
  if (!article) return null;
  return grants.find(grant => grant.platformKey === platformKey && grant.articleId === article.id
    && grant.contentHash === article.contentHash && (!accountId || grant.accountId === accountId)
    && Date.parse(grant.expiresAt) > Date.now()) ?? null;
}
