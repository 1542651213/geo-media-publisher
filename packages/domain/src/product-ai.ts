import type { Brand } from "./types";
import { platformContentPolicy } from "./product-content-policy";

export interface EnterpriseAIContext {
  companyId: string; companyName: string; brandNames: string[]; serviceAreas: string[]; coreServices: string[];
  contactInfo: Record<string, string>; verifiedSellingPoints: string[]; approvedClaims: string[]; forbiddenClaims: string[];
  seoKeywords: string[]; geoKeywords: string[]; tone: string; officialWebsite: string;
}
export function defaultEnterpriseAIContext(brand: Brand): EnterpriseAIContext {
  return { companyId: brand.id, companyName: brand.companyName || brand.name, brandNames: [brand.name], serviceAreas: brand.serviceRegions, coreServices: [brand.mainBusiness].filter(Boolean), contactInfo: brand.contact, verifiedSellingPoints: brand.advantages, approvedClaims: [], forbiddenClaims: brand.aiForbiddenClaims, seoKeywords: [], geoKeywords: [], tone: "专业、清晰、克制", officialWebsite: brand.officialWebsite ?? "" };
}
export const STUDIO_TARGETS = ["douyin", "toutiao", "weibo", "sohu_media", "website", "cnblogs"] as const;
export const STUDIO_PURPOSES = ["生成文章", "生成标题", "改写", "缩写", "扩写", "语气调整", "SEO/GEO 改写", "平台适配", "多平台草稿"] as const;
export interface PromptTemplate {
  templateId: string; name: string; version: number; targetPlatform: string | null; contentType: "article" | "case";
  systemPrompt: string; userPromptTemplate: string; enabled: boolean;
}
const systemPrompt = "你是企业内容编辑。仅使用所提供企业和源稿事实；不得推断认证、排名、CMA、客户满意、客户案例、合作品牌、检测结果或数值。不得使用其它企业事实。输出 JSON 对象 {title,body}，正文为纯文本。遵守平台约束。";
export const DEFAULT_PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  ["industry", "行业科普", null, "article", "解释行业概念、适用场景和判断步骤，区分通用知识与本企业已核实事实。"],
  ["field-case", "现场案例", null, "case", "按源稿中的现场问题、处理过程和有依据的结果组织案例。未提供案例时不得编造项目或客户。"],
  ["company", "公司介绍", null, "article", "介绍当前企业的已确认服务、地区和特点，不补充规模、资质或合作方。"],
  ["faq", "FAQ", null, "article", "围绕源稿组织常见问题与简明回答，未知问题明确保留为待人工补充。"],
  ["geo-seo", "GEO/SEO", null, "article", "自然使用企业提供的 SEO/GEO 关键词，以清晰定义、问答和依据组织内容，避免关键词堆砌。"],
  ["douyin", "抖音图文", "douyin", "article", "用简短标题和易读的分段正文适配抖音图文，标题严格遵守共享平台限制，不静默截断。"],
  ["weibo", "微博短文", "weibo", "article", "将源稿要点组织为简洁的微博短文；平台未确认的长度限制不自行假定。"],
  ["toutiao", "今日头条文章", "toutiao", "article", "为头条读者组织清晰的导语、要点与段落，仅输出纯文本正文，不使用 HTML 或 Markdown 标记。"],
  ["sohu", "搜狐文章", "sohu_media", "article", "组织适合搜狐文章的背景、正文和有依据的结论，标题不夸大事实。"],
  ["website-article", "官网 ARTICLE", "website", "article", "撰写正式官网文章，清晰介绍已确认知识或服务，不编造认证、排名和检测数据。"],
  ["website-case", "官网 CASE", "website", "case", "整理官网案例的实际背景、服务过程与有证据的结果；缺少现场资料时不补造客户案例。"],
  ["cnblogs", "博客园文章", "cnblogs", "article", "以技术说明的结构整理原稿中的方法、步骤和事实，不编造实现细节、测试数据或代码。"]
].map(([id, name, target, type, instruction]) => ({ templateId: id!, name: name!, version: 1, targetPlatform: target, contentType: type as "article" | "case", systemPrompt: `${systemPrompt}\n${instruction}`, userPromptTemplate: "用途：{{purpose}}\n企业资料：{{context}}\n源稿：{{source}}\n平台：{{platform}}\n约束：{{policy}}", enabled: true }));

export interface StudioValidation { errors: string[]; warnings: string[] }
export function validateStudioDraft(input: { context: EnterpriseAIContext; platformKey: string; title: string; body: string; otherCompanies: string[]; otherBrands: string[]; recent: Array<{ title: string; body: string }>; contentType?: string; sourceFacts?: string }): StudioValidation {
  const errors: string[] = [], warnings: string[] = [];
  const text = `${input.title}\n${input.body}`;
  const policy = platformContentPolicy(input.platformKey);
  if (!input.title.trim()) errors.push("TITLE_EMPTY");
  if (!input.body.trim()) errors.push("BODY_EMPTY");
  if (policy.maxTitleLength !== null && input.title.length > policy.maxTitleLength) errors.push("TITLE_TOO_LONG");
  if (policy.minBodyLength !== null && input.body.length < policy.minBodyLength || policy.maxBodyLength !== null && input.body.length > policy.maxBodyLength) errors.push("BODY_POLICY_MISMATCH");
  if (input.contentType && policy.supportedContentTypes && !policy.supportedContentTypes.includes(input.contentType)) errors.push("CONTENT_TYPE_MISMATCH");
  if (input.otherCompanies.some((value) => value && value !== input.context.companyName && text.includes(value))) errors.push("COMPANY_MISMATCH");
  if (input.otherBrands.some((value) => value && !input.context.brandNames.includes(value) && text.includes(value))) errors.push("BRAND_MISMATCH");
  const knownContacts = Object.values(input.context.contactInfo).filter(Boolean);
  const phones = text.match(/(?<!\d)(?:1[3-9]\d{9}|0\d{2,3}[-－ ]?\d{7,8}|400[-－ ]?\d{3}[-－ ]?\d{4})(?!\d)/gu) ?? [];
  const mails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? [];
  const contactValue = (value: string) => value.replace(/[-－\s]/gu, "").toLowerCase();
  const websites = [...text.matchAll(/(?:官网|官方网站)[：:\s]*((?:https?:\/\/|www\.)[^\s，。；]+)/gu)].map(match => match[1]!);
  if ([...phones, ...mails].some((value) => !knownContacts.some((known) => contactValue(known).includes(contactValue(value))))
    || websites.some(value => value.replace(/^https?:\/\//u, "").replace(/\/+$/u, "") !== input.context.officialWebsite.replace(/^https?:\/\//u, "").replace(/\/+$/u, ""))) errors.push("CONTACT_MISMATCH");
  if (input.context.forbiddenClaims.some((claim) => claim && text.includes(claim))) errors.push("FORBIDDEN_CLAIM");
  const unsupported = text.match(/国家认证|(?:全国|行业|官方|排名)第一|CMA(?:认证|已通过|通过)|客户(?:满意|一致好评)|(?:合作(?:品牌|客户)|客户案例|成功案例|检测(?:结果|数值))[：:]?[^。\n]+|\d+(?:\.\d+)?\s*(?:%|％|万元|亿元|mg\/m³|ppm|倍)|(?:累计|服务|完成|检测|处理|覆盖)[^。\n\d]{0,12}\d+(?:\.\d+)?\s*(?:家|个|次|吨|平方米|项目)/giu) ?? [];
  if (unsupported.some((claim) => !input.context.approvedClaims.some((approved) => approved.includes(claim)) && !input.sourceFacts?.includes(claim))) errors.push("UNAPPROVED_CLAIM");
  const normalize = (value: string) => value.replace(/\s+/gu, "").toLowerCase();
  if (input.recent.some((item) => normalize(item.title) === normalize(input.title))) warnings.push("DUPLICATE_TITLE");
  if (input.recent.some((item) => normalize(item.body) === normalize(input.body))) warnings.push("DUPLICATE_BODY");
  return { errors, warnings };
}
