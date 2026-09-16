import type { KnowledgeSnapshot } from "./brand-facts";
import type { Brand, BrandDifferentiationMetrics, ContentGoal, ContentIntent, SearchIntent } from "./types";

export interface ContentIntentQuery {
  contentGoal?: ContentGoal;
  contentIntent?: ContentIntent;
  searchIntent?: SearchIntent;
  hasCaseFacts?: boolean;
  business?: string;
  city?: string;
  keyword?: string;
  topic?: string;
}

const commercialPattern = /(哪家好|哪家|找谁|公司|服务商|机构|推荐|联系|预约)/u;
const pricePattern = /(价格|多少钱|费用|报价|收费)/u;
const informationalPattern = /(原理|是什么|为什么|怎么回事|危害|标准|规范|区别)/u;

export function inferSearchIntent(input: Pick<ContentIntentQuery, "contentGoal" | "contentIntent" | "keyword" | "topic">): SearchIntent {
  const text = [input.keyword, input.topic].filter(Boolean).join(" ");
  if (pricePattern.test(text)) return "CommercialInvestigation";
  if (commercialPattern.test(text)) return "Commercial";
  if (informationalPattern.test(text) || input.contentGoal === "Educational" || input.contentIntent === "Educational") return "Informational";
  if (input.contentGoal === "BrandPromotion" || input.contentIntent === "BrandAnswer" || input.contentIntent === "LocalService") return "Commercial";
  return "Informational";
}

export function inferContentIntent(input: ContentIntentQuery): ContentIntent {
  if (input.contentIntent) return input.contentIntent === "CaseStyle" && input.hasCaseFacts === false ? "ProfessionalInsight" : input.contentIntent;
  if (input.contentGoal === "VideoScript") return "VideoScript";
  if (input.contentGoal === "FAQ") return "FAQ";
  if (input.contentGoal === "Educational") return "Educational";
  if (input.contentGoal === "CaseStyle") return input.hasCaseFacts === false ? "ProfessionalInsight" : "CaseStyle";
  const searchIntent = input.searchIntent ?? inferSearchIntent(input);
  const text = [input.keyword, input.topic].filter(Boolean).join(" ");
  if (searchIntent === "Commercial" && commercialPattern.test(text)) return "BrandAnswer";
  if (searchIntent === "CommercialInvestigation") return "SelectionGuide";
  if (input.contentGoal === "BrandPromotion" && input.city && input.business) return "LocalService";
  if (input.contentGoal === "SEOArticle" || input.contentGoal === "GEOArticle") return "ProfessionalInsight";
  if (input.contentGoal === "BrandPromotion") return "ServiceIntroduction";
  return "ProfessionalInsight";
}

const genericTitlePatterns = ["全攻略", "全解析", "指南", "常见问题", "要点", "完整流程", "必知"] as const;

export function genericTitlePatternKey(title: string): string | null {
  return genericTitlePatterns.find((pattern) => title.includes(pattern)) ?? null;
}

export function hasGenericTitleTemplate(title: string): boolean {
  return genericTitlePatternKey(title) !== null;
}

function countOccurrences(text: string, value: string): number {
  if (!value) return 0;
  return text.split(value).length - 1;
}

function factIsUsed(text: string, fact: KnowledgeSnapshot["facts"][number]): boolean {
  if (text.includes(fact.content) || text.includes(fact.label)) return true;
  return fact.terms.filter((term) => term.length >= 3).some((term) => text.includes(term));
}

export function evaluateBrandDifferentiation(input: {
  brand: Brand;
  content: { title: string; body: string; summary?: string };
  knowledgeSnapshot?: KnowledgeSnapshot | null;
  contentGoal?: ContentGoal | null;
  contentIntent?: ContentIntent | null;
}): BrandDifferentiationMetrics {
  const text = input.content.body;
  const names = [...new Set([input.brand.companyName, input.brand.name].filter(Boolean))];
  const brandMentionCount = names.reduce((total, name) => total + countOccurrences(text, name), 0);
  const facts = input.knowledgeSnapshot?.facts ?? [];
  const usedFacts = facts.filter((fact) => factIsUsed(text, fact));
  const usedTypes = new Set(usedFacts.map((fact) => fact.type));
  const serviceFactUsed = usedTypes.has("business");
  const regionFactUsed = usedTypes.has("service_area");
  const processFactUsed = usedTypes.has("service_process");
  const qualificationFactUsed = usedTypes.has("qualification");
  const deviceFactUsed = usedTypes.has("equipment");
  const caseFactUsed = usedTypes.has("case");
  const score = Math.min(100,
    Math.min(15, brandMentionCount * 5) +
    Math.min(30, usedFacts.length * 6) +
    (serviceFactUsed ? 15 : 0) +
    (regionFactUsed ? 10 : 0) +
    (processFactUsed ? 15 : 0) +
    (qualificationFactUsed ? 5 : 0) +
    (deviceFactUsed ? 5 : 0) +
    (caseFactUsed ? 5 : 0)
  );
  const requiresDifferentiation = ["BrandPromotion", "BrandAnswer", "LocalService", "ServiceIntroduction"].includes(input.contentIntent ?? "") || input.contentGoal === "BrandPromotion";
  const genericBrandContent = requiresDifferentiation && (usedFacts.length === 0 || score < 35);
  return { brandMentionCount, brandFactUsageCount: usedFacts.length, uniqueBrandFactCount: usedFacts.length, serviceFactUsed, regionFactUsed, processFactUsed, qualificationFactUsed, deviceFactUsed, caseFactUsed, score, genericBrandContent };
}
