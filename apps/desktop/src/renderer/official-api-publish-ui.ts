import type { Article } from "@publisher/domain";
import type {
  OfficialApiAccountView,
  OfficialApiAvailability,
  OfficialApiContentSettings,
  OfficialApiImageChoice,
  OfficialApiJobView,
  OfficialApiMaintenanceOperation
} from "../shared/official-api";
import type { PublisherApi } from "../shared/api";

export interface WebsitePublishEligibility {
  eligible: boolean;
  reason: string | null;
  connection: OfficialApiAccountView | null;
}

const candidateBound = (articleId: string, accountId: string, kind: "article" | "case", availability: OfficialApiAvailability): boolean =>
  availability.candidateSelections.some(candidate => candidate.articleId === articleId && candidate.accountId === accountId && candidate.kind === kind);

export async function refreshWebsiteConnections(connections: readonly OfficialApiAccountView[], verify: (accountId: string) => Promise<OfficialApiAccountView>): Promise<OfficialApiAccountView[]> {
  return Promise.all(connections.map(async view => view.configured ? verify(view.accountId).catch(() => view) : view));
}

export function websitePublishEligibility(
  articleId: string,
  accountId: string,
  kind: OfficialApiContentSettings["kind"],
  availability: OfficialApiAvailability,
  connections: readonly OfficialApiAccountView[]
): WebsitePublishEligibility {
  const connection = connections.find(view => view.accountId === accountId) ?? null;
  if (!availability.ordinaryEnabled && !candidateBound(articleId, accountId, kind, availability)) return { eligible: false, reason: "当前账号、文章与内容类型不在本次官网候选范围", connection };
  if (!connection) return { eligible: false, reason: "找不到已验证的官网 OfficialAPI 连接", connection: null };
  if (!connection.configured) return { eligible: false, reason: "官网凭据尚未安全配置", connection };
  if (connection.status !== "CONNECTED" || !connection.writesEnabled) return { eligible: false, reason: "官网连接为只读或尚未通过写入验证", connection };
  if (connection.siteId !== "kangyi") return { eligible: false, reason: "官网站点与本次候选范围不匹配", connection };
  if (connection.environment !== "staging" && connection.environment !== "production") return { eligible: false, reason: "官网环境尚未验证", connection };
  if (connection.apiVersion !== "2") return { eligible: false, reason: "官网 API 版本不是已验收的 V2", connection };
  if (!connection.contentTypes.includes(kind)) return { eligible: false, reason: `当前连接不支持${kind === "case" ? "现场案例" : "行业科普"}`, connection };
  return { eligible: true, reason: null, connection };
}

export function preferredWebsiteCandidate(
  articleId: string,
  availability: OfficialApiAvailability,
  connections: readonly OfficialApiAccountView[],
  kind: OfficialApiContentSettings["kind"]
): OfficialApiAccountView | null {
  return connections
    .filter(view => websitePublishEligibility(articleId, view.accountId, kind, availability, connections).eligible)
    .sort((left, right) => Number(right.environment === "production") - Number(left.environment === "production"))[0] ?? null;
}

export function controlledWebsiteAssets<T extends OfficialApiImageChoice>(article: Pick<Article, "brandId">, assets: readonly T[]): T[] {
  return assets.filter(asset => asset.enabled && (asset.brandId === article.brandId || asset.universal));
}

export function defaultOfficialApiSettings(article: Pick<Article, "tags" | "seoKeywords" | "coverAssetId">): OfficialApiContentSettings {
  const keywords = [...new Set([...article.seoKeywords, ...article.tags].map(value => value.trim()).filter(Boolean))];
  return {
    version: 1,
    kind: "article",
    ...(keywords.length ? { keywords } : {}),
    coverAssetId: article.coverAssetId,
    bodyImageAssetIds: [],
    galleryAssetIds: []
  };
}

export function buildWebsitePrepareInput(articleId: string, accountId: string, websiteSettings: OfficialApiContentSettings): Parameters<PublisherApi["articles"]["preparePublish"]>[0] {
  return {
    articleId,
    platformKey: "website",
    platformAccountId: accountId,
    publishMode: "ASSISTED",
    finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
    selectedImageAssetId: null,
    imageSelectionMode: "none",
    websiteSettings
  };
}

export function splitOfficialApiList(value: string): string[] {
  return [...new Set(value.split(/[\n,，]/u).map(item => item.trim()).filter(Boolean))];
}

export function validateOfficialApiSettings(settings: OfficialApiContentSettings, controlledAssetIds: ReadonlySet<string>): string | null {
  if (settings.kind === "article" && settings.galleryAssetIds.length > 0) return "行业科普不能选择案例图库";
  if (settings.kind === "case" && settings.galleryAssetIds.length < 2) return "现场案例至少 2 张图库图片";
  if (settings.kind === "case" && !settings.serviceFocus?.length) return "现场案例请填写服务重点";
  if (settings.keywords && settings.keywords.length === 0) return "关键词为空时请保留未填写状态";
  if (settings.takeaways && settings.takeaways.length === 0) return "核心要点为空时请保留未填写状态";
  const selectedAssetIds = [
    ...(settings.coverAssetId ? [settings.coverAssetId] : []),
    ...settings.bodyImageAssetIds,
    ...settings.galleryAssetIds
  ];
  if (new Set(selectedAssetIds).size > 20) return "官网一次最多选择 20 张图片";
  if (selectedAssetIds.some(assetId => !controlledAssetIds.has(assetId))) return "所选图片不在当前文章素材库的受控范围内";
  if (settings.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(settings.slug)) return "Slug 只能使用小写字母、数字和连字符";
  return null;
}

export type OfficialApiJobAction = "recover" | OfficialApiMaintenanceOperation;

export function websiteJobActions(view: OfficialApiJobView): OfficialApiJobAction[] {
  if (view.phase === "NEEDS_RECONCILIATION" || view.phase === "PUBLISH_ACCEPTED" || view.phase.startsWith("MAINTENANCE_")) return ["recover"];
  if (!view.contentId || !view.remoteJobId) return [];
  if (view.phase === "PUBLISHED") return ["unpublish", "delete"];
  if (view.phase === "UNPUBLISHED" || view.phase === "RESTORED") return ["delete"];
  if (view.phase === "DELETED") return ["restore", ...(view.canPurge ? ["purge" as const] : [])];
  return [];
}

export function websiteOperationFeedback(operation: OfficialApiJobAction, view: OfficialApiJobView): string {
  if (websiteJobActions(view).includes("recover")) return "官网操作已接收，仍需查询原任务状态。";
  if (view.phase === "FAILED") return "官网操作已返回失败状态，请查看错误代码。";
  if (operation === "recover") return "已按原操作恢复官网任务状态。";
  if (["PUBLISHED", "UNPUBLISHED", "DELETED", "RESTORED", "CLEANED"].includes(view.phase)) return "官网操作已完成并回读最新状态。";
  return "官网操作已返回最新状态，请继续查看任务阶段。";
}
