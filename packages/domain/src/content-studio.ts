import type { Brand } from "./types";
import type { ContentGoal, ContentIntent, PromotionStrength, SearchIntent } from "./types";
import type { KnowledgeSnapshot } from "./brand-facts";
import { inferContentIntent, inferSearchIntent } from "./brand-content-intent";

export const CONTENT_STUDIO_PLATFORM_KEYS = [
  "wechat_official",
  "zhihu",
  "toutiao",
  "weibo",
  "douyin",
  "bilibili"
] as const;

export type ContentStudioPlatformKey = (typeof CONTENT_STUDIO_PLATFORM_KEYS)[number];
export type ContentStudioContentType = "article" | "video_script";

export interface ContentStudioPlatformDefinition {
  key: ContentStudioPlatformKey;
  displayName: string;
  contentType: ContentStudioContentType;
  tone: string;
  structure: string;
  keywordLayout: string;
}

export const CONTENT_STUDIO_PLATFORMS: readonly ContentStudioPlatformDefinition[] = [
  { key: "wechat_official", displayName: "微信公众号", contentType: "article", tone: "专业、可信、信息密度适中", structure: "导语-小标题分段-服务边界-行动建议", keywordLayout: "首段自然出现主关键词，小标题和结尾各出现一次，避免堆砌" },
  { key: "zhihu", displayName: "知乎", contentType: "article", tone: "理性、解释型、先结论后论据", structure: "问题切入-结论-判断依据-常见误区-总结", keywordLayout: "标题围绕问题，首段出现主关键词，正文用相关词解释搜索意图" },
  { key: "toutiao", displayName: "头条", contentType: "article", tone: "清晰、实用、带有场景感", structure: "场景钩子-核心信息-步骤清单-提醒-互动结尾", keywordLayout: "标题包含城市和主题，正文前半段完成主关键词覆盖" },
  { key: "weibo", displayName: "微博", contentType: "article", tone: "简洁、口语化、适合快速阅读", structure: "一句话观点-要点列表-话题标签-互动引导", keywordLayout: "主关键词放在首句和话题标签，控制自然频次" },
  { key: "douyin", displayName: "抖音脚本", contentType: "video_script", tone: "口语化、节奏快、画面明确", structure: "前三秒钩子-分镜-口播-字幕提示-结尾行动", keywordLayout: "主关键词在前三秒口播和结尾各出现一次" },
  { key: "bilibili", displayName: "B站视频脚本", contentType: "video_script", tone: "有解释深度、陪伴感、适合长视频", structure: "开场承诺-章节大纲-旁白-画面建议-评论区问题", keywordLayout: "主关键词进入标题、开场和章节名，相关词分布在解释段落" }
];

export interface ContentStudioTopic {
  title: string;
  angle: string;
  audience: string;
  keyPoints: string[];
  recommendedPlatforms: ContentStudioPlatformKey[];
}

export interface ContentStudioTopicPlan {
  summary: string;
  topics: ContentStudioTopic[];
}

export interface ContentStudioAssetContext {
  id: string;
  title: string;
  type: string;
  description?: string;
  tags?: string[];
}

export interface ContentStudioVideoContext extends ContentStudioAssetContext {
  fileName: string;
  durationMs?: number;
  width?: number;
  height?: number;
}

export interface ContentStudioInput {
  brand: Brand;
  industry: string;
  cities: string[];
  keywords: string[];
  targetPlatforms: ContentStudioPlatformKey[];
  topicPlan?: ContentStudioTopicPlan | null;
  mediaAssets?: ContentStudioAssetContext[];
  videoAssets?: ContentStudioVideoContext[];
  business?: string;
  city?: string;
  keyword?: string;
  topic?: string;
  contentGoal?: ContentGoal;
  promotionStrength?: PromotionStrength;
  contentIntent?: ContentIntent;
  searchIntent?: SearchIntent;
  knowledgeSnapshot?: KnowledgeSnapshot;
  promptVersion?: string;
}

export interface ContentStudioPlatformInput extends ContentStudioInput {
  platformKey: ContentStudioPlatformKey;
}

export interface ContentStudioContent {
  platformKey: ContentStudioPlatformKey;
  contentType: ContentStudioContentType;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  seoKeywords: string[];
  tone: string;
  structure: string[];
  keywordLayout: { primary: string; secondary: string[]; placements: string[] };
}

export function getContentStudioPlatform(key: ContentStudioPlatformKey): ContentStudioPlatformDefinition {
  const platform = CONTENT_STUDIO_PLATFORMS.find((item) => item.key === key);
  if (!platform) throw new Error(`Unsupported Content Studio platform: ${key}`);
  return platform;
}

export function buildContentStudioPlanPrompt(input: ContentStudioInput): string {
  return [
    "请为企业内容生产中心规划 3 个可执行的内容主题。只依据提供的企业资料和关键词，不得编造资质、客户、数据、排名或效果承诺。",
    `品牌：${input.brand.name}`,
    `公司：${input.brand.companyName}`,
    `行业：${input.industry}`,
    `城市：${input.cities.join("、")}`,
    `关键词：${input.keywords.join("、")}`,
    `内容目的：${input.contentGoal ?? "BrandPromotion"}`,
    `推广程度：${input.promotionStrength ?? "Balanced"}`,
    `内容意图：${input.contentIntent ?? inferContentIntent(input)}`,
    `搜索意图：${input.searchIntent ?? inferSearchIntent(input)}`,
    `主营业务：${input.business || input.brand.mainBusiness || "未提供"}`,
    `企业知识库事实：${formatKnowledgeSnapshot(input.knowledgeSnapshot)}`,
    `目标平台：${input.targetPlatforms.join("、")}`,
    "输出字段：summary(string), topics(array)。每个 topic 必须包含 title、angle、audience、keyPoints(string[])、recommendedPlatforms(string[])。"
  ].join("\n");
}

export function buildContentStudioPlatformPrompt(input: ContentStudioPlatformInput): string {
  const platform = getContentStudioPlatform(input.platformKey);
  const primaryKeyword = input.keyword || input.keywords[0] || "企业服务";
  const contentGoal = input.contentGoal ?? "BrandPromotion";
  const promotionStrength = input.promotionStrength ?? "Balanced";
  const city = input.city || input.cities[0] || "本地";
  const topic = input.topicPlan?.topics[0];
  const contentIntent = input.contentIntent ?? inferContentIntent({ ...input, contentGoal, city, keyword: primaryKeyword });
  const searchIntent = input.searchIntent ?? inferSearchIntent({ ...input, contentGoal, contentIntent, keyword: primaryKeyword });
  const intentInstruction = getIntentInstruction(contentIntent, searchIntent, input.brand.companyName || input.brand.name);
  return [
    "你是企业内容生产中心的资深平台编辑。请生成一个平台独立版本，只能使用企业知识库快照中的事实，严禁补写未提供的证书、案例、数据、排名、客户和效果。",
    `品牌：${input.brand.name}`,
    `公司：${input.brand.companyName}`,
    `行业：${input.industry}`,
    `城市：${city}`,
    `关键词：${input.keywords.join("、")}`,
    `主关键词：${primaryKeyword}`,
    `业务焦点：${input.business || primaryKeyword}`,
    `内容目的：${contentGoal}`,
    `推广程度：${promotionStrength}`,
    `文章类型 / Content Intent：${contentIntent}`,
    `搜索意图 / Search Intent：${searchIntent}`,
    contentGoal === "BrandPromotion" ? `品牌要求：正文必须自然出现“${input.brand.companyName || input.brand.name}”，提供有价值的信息同时介绍企业，不机械堆砌。` : input.platformKey === "douyin" || input.platformKey === "bilibili" ? `品牌要求：脚本结尾或行动建议中自然出现“${input.brand.companyName || input.brand.name}”，不得只输出通用科普。` : "品牌要求：按内容目的决定品牌出现方式，不制造营销承诺。",
    input.topic ? `用户主题与复检要求：${input.topic}` : "用户主题与复检要求：无",
    topic ? `主题规划：${topic.title}；角度：${topic.angle}；要点：${topic.keyPoints.join("、")}` : "主题规划：请根据输入自行选择最稳妥的主题",
    `意图执行要求：${intentInstruction}`,
    `平台：${platform.displayName}`,
    `内容类型：${platform.contentType}`,
    `语气：${platform.tone}`,
    `结构：${platform.structure}`,
    `关键词布局：${platform.keywordLayout}`,
    input.mediaAssets?.length ? `可用 Media Assets：${input.mediaAssets.map((asset) => `${asset.title}(${asset.type})`).join("、")}` : "可用 Media Assets：无",
    input.videoAssets?.length ? `可参考视频素材：${input.videoAssets.map((asset) => `${asset.title}(${asset.fileName})`).join("、")}` : "可参考视频素材：无",
    `Relevant Brand Facts Snapshot（只允许使用以下事实）：\n${formatKnowledgeSnapshot(input.knowledgeSnapshot)}`,
    "聚焦规则：只围绕目标城市、业务和主关键词；除非内容目的明确为企业综合介绍，不要提及或展开其他无关业务。企业法定名称中的省份不是目标城市冲突。",
    "标题规则：标题不强制放公司名；根据搜索意图表达用户问题、选择判断或本地服务关系。不要连续套用“全攻略、全解析、指南、常见问题、要点、完整流程、必知”等万能模板；不得使用第一、最好、唯一、官方、全城最低等无证据排名或绝对宣传。",
    "品牌安全规则：不得编造第一、最好、唯一、国家级、百分百、永久有效、确保结果、虚假资质、证书、设备、客户或案例；知识库没有提供的企业事实必须省略。Soft 以知识分享为主但仍在脚本结尾自然保留品牌识别，Balanced 同时给出明确信息与品牌介绍，Strong 可增加企业介绍比例但仍只能使用事实。",
    "保持标题、内容结构、关键词布局和语气与其他平台明显不同。只返回结构化 JSON。字段：platformKey, contentType, title, body, summary, tags(string[]), seoKeywords(string[]), tone, structure(string[]), keywordLayout({primary,secondary(string[]),placements(string[])})."
  ].join("\n");
}

function getIntentInstruction(contentIntent: string, searchIntent: string, companyName: string): string {
  if (contentIntent === "BrandAnswer" || searchIntent === "Commercial") return `先直接回答用户的选择/找服务问题，再说明判断依据；让${companyName}的真实业务、服务区域或流程事实参与论证，不要只在结尾署名。`;
  if (contentIntent === "SelectionGuide" || searchIntent === "CommercialInvestigation") return "围绕用户比较、预算或服务选择，说明应核对的服务边界与流程；企业资料只用于可核验的选择依据，不编造价格或排名。";
  if (["LocalService", "ServiceIntroduction"].includes(contentIntent)) return `从用户在本地遇到的问题切入，解释服务范围和下一步决策，再自然介绍${companyName}能够被资料支持的业务、区域与流程事实。`;
  if (contentIntent === "Educational" || searchIntent === "Informational") return "以问题解释和事实边界为主；品牌可以弱化，但不把企业能力写成行业普遍事实。";
  if (contentIntent === "VideoScript") return `前三秒提出具体本地问题，中段用企业事实回答，结尾自然给出下一步咨询方向；不得把脚本写成泛化科普。`;
  return `围绕用户问题提供专业判断，并在论据段使用相关企业事实；${companyName}不必机械出现在标题，但正文要保持品牌归属清晰。`;
}

function formatKnowledgeSnapshot(snapshot: KnowledgeSnapshot | undefined): string {
  if (!snapshot || snapshot.facts.length === 0) return "未提供可用事实";
  return snapshot.facts.map((fact) => `[${fact.type}] ${fact.label}：${fact.content}`).join("\n");
}
