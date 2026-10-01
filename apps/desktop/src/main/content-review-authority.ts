import type { AppRepository } from "@publisher/db";
import type { PublishJob } from "@publisher/domain";

/** Read-only authority: legacy review settings cannot approve current content. */
export function assertCurrentContentApproved(repository: AppRepository, articleId: string): void {
  const article = repository.getArticle(articleId), state = repository.getContentQualityState("article", articleId);
  if (!article || article.status === "archived" || state?.status !== "Approved" || state.contentHash !== article.contentHash)
    throw new Error("内容尚未人工审核通过，请先进入内容审核");
}

export function assertJobCurrentCompany(repository: AppRepository, job: Pick<PublishJob, "articleId" | "accountId">): void {
  const brands = repository.listBrands(), saved = repository.getSettings().operationsWorkspaceCompanyId;
  const current = brands.find(brand => brand.id === saved)?.id ?? brands[0]?.id;
  const binding = repository.db.prepare("SELECT company_id FROM operations_account_company_bindings WHERE account_id=?").get(job.accountId) as { company_id: string } | undefined;
  if (!current || repository.getArticle(job.articleId)?.brandId !== current || binding?.company_id !== current) throw new Error("企业工作区已切换，请重新选择当前企业的内容和账号");
}
