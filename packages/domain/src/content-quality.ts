import type { Brand, ContentGoal, ContentIntent, PlatformProfile, SearchIntent } from "./types";
import type { PlatformContentRules } from "./platform-content-rules";
import { textSimilarity } from "./similarity";
import type { KnowledgeSnapshot } from "./brand-facts";
import { evaluateBrandDifferentiation } from "./brand-content-intent";

export const CONTENT_QUALITY_STATUSES = ["Draft", "AI_Checked", "Needs_Review", "Approved", "Rejected"] as const;
export type ContentQualityStatus = (typeof CONTENT_QUALITY_STATUSES)[number];

export const CONTENT_QUALITY_TYPES = ["article", "article_variant"] as const;
export type ContentQualityContentType = (typeof CONTENT_QUALITY_TYPES)[number];

export const CONTENT_QUALITY_TRIGGERS = ["generation", "manual_edit", "manual_recheck", "manual_review"] as const;
export type ContentQualityTrigger = (typeof CONTENT_QUALITY_TRIGGERS)[number];

export const CONTENT_QUALITY_CHECK_CODES = [
  "brand_fact_consistency",
  "brand_missing",
  "brand_differentiation",
  "unsupported_credentials",
  "false_promises",
  "absolute_marketing",
  "city_keyword_coverage",
  "city_consistency",
  "platform_length",
  "seo_quality",
  "content_duplicate"
] as const;
export type ContentQualityCheckCode = (typeof CONTENT_QUALITY_CHECK_CODES)[number];

export type ContentQualityIssueSeverity = "error" | "warning";

export interface ContentQualityIssue {
  code: ContentQualityCheckCode;
  severity: ContentQualityIssueSeverity;
  message: string;
  evidence?: string;
  suggestion?: string;
  location?: string;
}

export interface ContentQualityCheckResult {
  code: ContentQualityCheckCode;
  passed: boolean;
  score: number;
  issues: ContentQualityIssue[];
}

export interface ContentQualityContentInput {
  title: string;
  body: string;
  summary?: string;
  tags?: string[];
  seoKeywords?: string[];
  imageCount?: number;
  contentGoal?: ContentGoal;
  contentIntent?: ContentIntent;
  searchIntent?: SearchIntent;
  knowledgeSnapshot?: KnowledgeSnapshot | null;
}

export interface ContentQualityEvaluationInput {
  content: ContentQualityContentInput;
  brand: Brand;
  city: string;
  keyword: string;
  platformKey?: string;
  platformProfile?: PlatformProfile | null;
  platformRules?: PlatformContentRules | null;
  knownCities?: string[];
  similarTexts?: string[];
  duplicateThreshold?: number;
  contentGoal?: ContentGoal;
  contentIntent?: ContentIntent;
  searchIntent?: SearchIntent;
  knowledgeSnapshot?: KnowledgeSnapshot | null;
}

export interface ContentQualityEvaluationResult {
  status: Exclude<ContentQualityStatus, "Draft" | "Approved">;
  score: number;
  checks: ContentQualityCheckResult[];
  issues: ContentQualityIssue[];
}

const textOf = (content: ContentQualityContentInput): string => [content.title, content.body, content.summary ?? "", ...(content.tags ?? []), ...(content.seoKeywords ?? [])].join("\n");
const issue = (code: ContentQualityCheckCode, severity: ContentQualityIssueSeverity, message: string, evidence?: string, suggestion?: string, location?: string): ContentQualityIssue => ({ code, severity, message, ...(evidence ? { evidence } : {}), ...(suggestion ? { suggestion } : {}), ...(location ? { location } : {}) });
const check = (code: ContentQualityCheckCode, issues: ContentQualityIssue[]): ContentQualityCheckResult => ({ code, passed: issues.length === 0, score: issues.length === 0 ? 100 : issues.some((item) => item.severity === "error") ? 0 : 60, issues });

function evaluateBrandFacts(input: ContentQualityEvaluationInput, text: string): ContentQualityIssue[] {
  const issues: ContentQualityIssue[] = [];
  const facts = [input.brand.name, input.brand.companyName].filter(Boolean);
  if (facts.length > 0 && !facts.some((fact) => text.includes(fact))) {
    if (input.contentGoal === "BrandPromotion") issues.push(issue("brand_missing", "error", "BRAND_MISSING：BrandPromotion 正文未出现目标品牌", undefined, "自然加入目标企业名称，但不得机械堆砌"));
    else issues.push(issue("brand_fact_consistency", "warning", "正文没有明确出现品牌名称，需人工确认品牌归属与事实边界", undefined, "补充品牌名称或确认该平台版本是否允许弱品牌表达"));
  }
  const sensitiveClaims = /(客户|合作方|案例|销量|排名|数据|证书|资质|认证|专利|权威|官方)/u;
  if (sensitiveClaims.test(text) && !input.brand.description && !input.brand.mainBusiness && !input.brand.cases && !input.brand.certificates && !input.brand.patents) {
    issues.push(issue("brand_fact_consistency", "error", "内容包含需要企业资料支撑的事实性表述，但品牌资料没有可核验依据", text.match(sensitiveClaims)?.[0], "补充品牌资料，或删除未经证实的事实表述"));
  }
  for (const forbiddenClaim of input.brand.aiForbiddenClaims.map((value) => value.trim()).filter(Boolean)) {
    const claimIndex = text.indexOf(forbiddenClaim);
    if (claimIndex >= 0 && !isNegated(text, claimIndex)) issues.push(issue("brand_fact_consistency", "error", "命中品牌明确禁止使用的表述", forbiddenClaim, "删除该表述后重新审核", "标题或正文"));
  }
  return issues;
}

function evaluateBrandContentDifferentiation(input: ContentQualityEvaluationInput): ContentQualityIssue[] {
  const metrics = evaluateBrandDifferentiation({ brand: input.brand, content: input.content, knowledgeSnapshot: input.knowledgeSnapshot, contentGoal: input.contentGoal, contentIntent: input.contentIntent });
  if (!metrics.genericBrandContent) return [];
  return [issue("brand_differentiation", "warning", "GENERIC_BRAND_CONTENT：品牌推广内容缺少参与论证的企业事实，替换品牌名后仍可用于其他企业", `score=${metrics.score}; brandFactUsageCount=${metrics.brandFactUsageCount}`, "补充与当前业务、城市和流程直接相关的企业事实；这不是事实违规，但不满足当前内容目标", "正文")];
}

function evaluateUnsupportedCredentials(input: ContentQualityEvaluationInput, text: string): ContentQualityIssue[] {
  const issues: ContentQualityIssue[] = [];
  const credentialPattern = /(国家级|行业级|权威|官方|认证|资质|证书|专利|著名品牌|指定服务商)/gu;
  const matches = [...text.matchAll(credentialPattern)].filter((match) => !isNegated(text, match.index ?? 0));
  const match = matches.map((item) => item[0]);
  const hasEvidence = Boolean(input.brand.certificates.trim() || input.brand.patents.trim());
  if (match.length > 0 && !hasEvidence) issues.push(issue("unsupported_credentials", "error", "检测到可能编造的资质、认证、专利或权威背书", [...new Set(match)].join("、"), "仅保留品牌资料中可核验的资质，或改为待确认表述", "正文"));
  return issues;
}

function isNegated(text: string, index: number): boolean {
  const context = text.slice(Math.max(0, index - 12), index);
  return /(不|未|无|禁止|避免|不要|不得|不会|不作|不做|不含|待确认|尚未|理解成|当作|不代表|不能|不应)/u.test(context);
}

function evaluateFalsePromises(text: string): ContentQualityIssue[] {
  const pattern = /(保证|承诺|确保|必然|绝不出错|零风险|无条件退款|不满意全额退款|100%|百分之百|永不反弹)/gu;
  const matches = [...text.matchAll(pattern)].filter((match) => !isNegated(text, match.index ?? 0)).map((match) => match[0]);
  return matches.length > 0 ? [issue("false_promises", "error", "检测到可能构成虚假承诺或结果保证的表述", [...new Set(matches)].join("、"), "改为说明服务流程、适用条件和需双方确认的边界", "正文") ] : [];
}

function evaluateAbsoluteMarketing(text: string): ContentQualityIssue[] {
  const pattern = /(全国第一|全网第一|行业第一|第一品牌|第一(?!步|章|项|次|个|问|种|阶段|条)|顶级|最好|最专业|唯一|首家|领先品牌|绝对|永久|全城最低|史上最低)/gu;
  const matches = [...text.matchAll(pattern)].filter((match) => !isNegated(text, match.index ?? 0)).map((match) => match[0]);
  return matches.length > 0 ? [issue("absolute_marketing", "error", "检测到绝对化营销用语", [...new Set(matches)].join("、"), "改为可核验、有限定条件的描述", "标题或正文")] : [];
}

function evaluateCityKeyword(input: ContentQualityEvaluationInput, text: string): ContentQualityIssue[] {
  const issues: ContentQualityIssue[] = [];
  if (input.city.trim() && !text.includes(input.city.trim())) issues.push(issue("city_keyword_coverage", "error", "城市关键词未覆盖", input.city, "在标题或正文中自然加入目标城市"));
  if (input.keyword.trim() && !text.includes(input.keyword.trim())) issues.push(issue("city_keyword_coverage", "error", "主关键词未覆盖", input.keyword, "在标题、首段或结尾自然加入主关键词"));
  const brandNames = [input.brand.name, input.brand.companyName].filter((value) => value.trim());
  const locationText = brandNames.reduce((value, brandName) => value.split(brandName).join(""), text);
  const targetCity = input.city.trim();
  const cities = [...new Set([...(input.knownCities ?? []), "南京", "苏州", "木渎", "吴中", "无锡", "常州", "扬州", "镇江", "南通", "徐州", "盐城", "淮安", "连云港", "宿迁", "上海", "杭州"])]
    .filter((city) => city && locationText.includes(city) && city !== targetCity);
  const allowed = targetCity === "江苏" ? cities.filter((city) => !["上海", "杭州"].includes(city)) : targetCity === "苏州" || targetCity === "木渎" ? ["江苏", "苏州", "木渎", "吴中"] : [];
  const conflicts = cities.filter((city) => !allowed.includes(city));
  if (conflicts.length > 0) issues.push(issue("city_consistency", "error", "内容出现与目标城市明显冲突的地点", [...new Set(conflicts)].join("、"), "删除冲突城市，或重新确认目标城市与服务范围", "标题或正文"));
  return issues;
}

function evaluatePlatformLength(input: ContentQualityEvaluationInput): ContentQualityIssue[] {
  if (!input.platformKey) return [];
  const rules = input.platformRules;
  if (rules) {
    const issues: ContentQualityIssue[] = [];
    const titleLength = [...input.content.title].length;
    const bodyLength = [...input.content.body].length;
    const summaryLength = [...(input.content.summary ?? "")].length;
    if (titleLength < rules.titleMinLength || titleLength > rules.titleMaxLength) issues.push(issue("platform_length", "error", `标题长度不在平台规则范围 ${rules.titleMinLength}-${rules.titleMaxLength} 字符`, String(titleLength), "调整标题长度并保留城市与主关键词", "标题"));
    if (bodyLength < rules.bodyMinLength || bodyLength > rules.bodyMaxLength) issues.push(issue("platform_length", "error", `正文长度不在平台规则范围 ${rules.bodyMinLength}-${rules.bodyMaxLength} 字符`, String(bodyLength), "调整正文长度并保留必要结构", "正文"));
    if (summaryLength > rules.summaryMaxLength) issues.push(issue("platform_length", "error", `摘要超过平台规则上限 ${rules.summaryMaxLength} 字符`, String(summaryLength), "压缩摘要并保留主关键词", "摘要"));
    if ((input.content.tags?.length ?? 0) > rules.maxTags) issues.push(issue("platform_length", "error", `标签数量超过平台规则上限 ${rules.maxTags}`, String(input.content.tags?.length ?? 0), "减少标签数量", "标签"));
    if ((input.content.imageCount ?? 0) > rules.maxImages) issues.push(issue("platform_length", "error", `图片数量超过平台规则上限 ${rules.maxImages}`, String(input.content.imageCount ?? 0), "减少图片数量", "图片"));
    return issues;
  }
  const profile = input.platformProfile;
  if (!profile) return [issue("platform_length", "warning", "未找到平台长度配置，无法完成精确的平台长度校验", input.platformKey, "补齐平台资料后重新审核")];
  const issues: ContentQualityIssue[] = [];
  const titleLength = [...input.content.title].length;
  const bodyLength = [...input.content.body].length;
  if (profile.titleLimit > 0 && titleLength > profile.titleLimit) issues.push(issue("platform_length", "error", `标题超过平台限制 ${profile.titleLimit} 字符`, String(titleLength), "压缩标题并保留城市与主关键词"));
  const minBodyLength = profile.minBodyLength && profile.minBodyLength > 0 ? profile.minBodyLength : profile.preferredMinWords;
  const maxBodyLength = profile.maxBodyLength && profile.maxBodyLength > 0 ? profile.maxBodyLength : profile.preferredMaxWords;
  if (minBodyLength > 0 && bodyLength < minBodyLength) issues.push(issue("platform_length", "error", `正文少于平台建议下限 ${minBodyLength} 字符`, String(bodyLength), "补充必要结构、事实边界和行动建议"));
  if (maxBodyLength > 0 && bodyLength > maxBodyLength) issues.push(issue("platform_length", "error", `正文超过平台建议上限 ${maxBodyLength} 字符`, String(bodyLength), "拆分段落或压缩重复表达"));
  return issues;
}

function evaluateSeo(input: ContentQualityEvaluationInput): ContentQualityIssue[] {
  const issues: ContentQualityIssue[] = [];
  const keyword = input.keyword.trim();
  const title = input.content.title.trim();
  const summary = input.content.summary?.trim() ?? "";
  const seoKeywords = input.content.seoKeywords ?? [];
  if (!title) issues.push(issue("seo_quality", "error", "标题为空", undefined, "补充清晰、可检索的标题"));
  if (keyword && !title.includes(keyword)) issues.push(issue("seo_quality", "warning", "标题没有包含主关键词", keyword, "将主关键词自然放入标题"));
  if (keyword && summary && !summary.includes(keyword)) issues.push(issue("seo_quality", "warning", "摘要没有包含主关键词", keyword, "在摘要中自然覆盖主关键词"));
  if (keyword && seoKeywords.length > 0 && !seoKeywords.some((value) => value.includes(keyword))) issues.push(issue("seo_quality", "warning", "SEO关键词列表没有覆盖主关键词", keyword, "补充主关键词或等价长尾词"));
  if (input.content.body.trim().length > 0 && input.content.body.trim().length < 80) issues.push(issue("seo_quality", "warning", "正文信息量较少，搜索意图覆盖不足", String(input.content.body.trim().length), "补充问题、步骤、边界和结论"));
  return issues;
}

function evaluateDuplicate(input: ContentQualityEvaluationInput, text: string): ContentQualityIssue[] {
  const threshold = input.duplicateThreshold ?? 0.72;
  const duplicate = (input.similarTexts ?? []).map((candidate) => textSimilarity(text, candidate)).find((score) => score >= threshold);
  return duplicate === undefined ? [] : [issue("content_duplicate", "warning", "与已有内容重复度较高", duplicate.toFixed(2), "调整观点、案例边界和段落结构后重新审核")];
}

export function evaluateContentQuality(input: ContentQualityEvaluationInput): ContentQualityEvaluationResult {
  const text = textOf(input.content);
  const checks = [
    check("brand_fact_consistency", evaluateBrandFacts(input, text)),
    check("brand_differentiation", evaluateBrandContentDifferentiation(input)),
    check("unsupported_credentials", evaluateUnsupportedCredentials(input, text)),
    check("false_promises", evaluateFalsePromises(text)),
    check("absolute_marketing", evaluateAbsoluteMarketing(text)),
    check("city_keyword_coverage", evaluateCityKeyword(input, text)),
    check("platform_length", evaluatePlatformLength(input)),
    check("seo_quality", evaluateSeo(input)),
    check("content_duplicate", evaluateDuplicate(input, text))
  ];
  const issues = checks.flatMap((item) => item.issues);
  const score = Math.max(0, Math.round(checks.reduce((total, item) => total + item.score, 0) / checks.length));
  const status: ContentQualityEvaluationResult["status"] = issues.some((item) => item.severity === "error") ? "Rejected" : issues.length > 0 ? "Needs_Review" : "AI_Checked";
  return { status, score, checks, issues };
}
