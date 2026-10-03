import type { Article, Brand } from "@publisher/domain";

export type QualityStatusByArticle = Record<string, string>;

export const productionSources = new Set(["production", "content_studio", "excel_import"]);
export const businessTagDefaults = ["甲醛治理", "定期消杀", "灭四害", "白蚁防治", "病媒生物防制", "企业通用"];
export const cityTagDefaults = ["江苏", "苏州", "木渎", "吴中", "通用"];
export const usageTagDefaults = ["治理现场", "检测设备", "消杀现场", "白蚁现场", "办公环境", "企业形象", "团队", "门店", "资质证书", "营业资料", "通用"];
export const imageCategories = ["全部", ...usageTagDefaults];

export type BrowserLoginResultClassification = "SUCCESS" | "NEEDS_USER_ACTION" | "CONTRACT_MISMATCH";

export function classifyBrowserLoginResult(result: { accountStatus?: unknown }): BrowserLoginResultClassification {
  if (result.accountStatus === "Connected") return "SUCCESS";
  if (result.accountStatus === "NeedsLogin") return "NEEDS_USER_ACTION";
  return "CONTRACT_MISMATCH";
}

export function isProductionArticle(article: Article): boolean {
  return productionSources.has(article.source ?? "production");
}

export function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  return new Date(value).toDateString() === new Date().toDateString();
}

export function splitEnterpriseList(value: string): string[] { return [...new Set(value.split(/[、,，;；|\n]+/u).map((item) => item.trim()).filter(Boolean))]; }
export function latestEnterpriseUpdate(brand: Brand): string { return [brand.updatedAt, ...(brand.knowledgeEntries ?? []).map((entry) => entry.updatedAt)].sort().at(-1) ?? brand.updatedAt; }
export function formatWorkspaceDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "暂无" : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
export function splitLabels(value: string): string[] { return [...new Set(value.split(/[、,，;；\s]+/u).map((item) => item.trim()).filter(Boolean))]; }
