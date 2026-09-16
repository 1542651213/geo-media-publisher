import type { Brand } from "./types";

export interface PromptInput {
  brand: Brand;
  city: string;
  keyword: string;
  articleType: string;
  minWords: number;
  maxWords: number;
  includeFaq: boolean;
  includeSummary: boolean;
  includeTags: boolean;
  includeSeoKeywords: boolean;
  platformKey?: string;
}

export interface PromptSection {
  name: string;
  content: string;
}

export function buildPromptSections(input: PromptInput): PromptSection[] {
  const forbidden = input.brand.aiForbiddenClaims.length > 0 ? input.brand.aiForbiddenClaims.join("；") : "无";
  return [
    { name: "System Context", content: "你是企业内容编辑。只能依据已提供资料写作；不得补写、推断或夸大不存在的资质、客户、数据、排名和效果。" },
    { name: "Brand Context", content: [`品牌：${input.brand.name}`, `公司：${input.brand.companyName}`, `介绍：${input.brand.description || "未提供"}`, `主营业务：${input.brand.mainBusiness || "未提供"}`, `服务区域：${input.brand.serviceRegions.join("、") || "未提供"}`, `企业优势：${input.brand.advantages.join("、") || "未提供"}`, `服务流程：${input.brand.serviceProcess || "未提供"}`, `售后边界：${input.brand.afterSales || "未提供"}`, `FAQ：${input.brand.faq || "未提供"}`, `证书：${input.brand.certificates || "未提供"}`, `专利：${input.brand.patents || "未提供"}`, `案例：${input.brand.cases || "未提供"}`].join("\n") },
    { name: "Task Context", content: [`城市：${input.city}`, `关键词：${input.keyword}`, `文章类型：${input.articleType}`, `字数范围：${input.minWords}-${input.maxWords}`, `平台：${input.platformKey ?? "通用文章库"}`].join("\n") },
    { name: "SEO Context", content: `摘要：${input.includeSummary ? "需要" : "不需要"}；标签：${input.includeTags ? "需要" : "不需要"}；SEO关键词：${input.includeSeoKeywords ? "需要" : "不需要"}` },
    { name: "Platform Context", content: "保持事实边界，使用短段落和清晰小标题；不要输出平台内部 selector、登录提示或任何绕过验证的建议。" },
    { name: "Safety / Factual Constraints", content: `禁止编造项：${forbidden}。不能把“选择收件人/选择发布账号”表述为交付保证；没有证据的数字、排名、承诺必须删除或改为待确认。` },
    { name: "Output Schema", content: '{"title":"string","body":"string","summary":"string","tags":["string"],"seoKeywords":["string"],"suggestedCoverPrompt":"string"}' }
  ];
}

export function buildArticlePrompt(input: PromptInput): string {
  return buildPromptSections(input).map((section) => `## ${section.name}\n${section.content}`).join("\n\n");
}
