import { createHash } from "node:crypto";
import type { AIUsage, Article, Brand, ContentStudioInput, ContentStudioPlatformInput, ContentStudioContent, ContentStudioTopicPlan } from "@publisher/domain";
import { buildArticlePrompt, getContentStudioPlatform, type PromptInput } from "@publisher/domain";

export interface ArticleTask extends PromptInput {
  brand: Brand;
  variant?: number;
}

export interface GeneratedArticle {
  title: string;
  body: string;
  summary: string;
  tags: string[];
  seoKeywords: string[];
  suggestedCoverPrompt: string;
  usage?: AIUsage;
  durationMs?: number;
}

export const STRUCTURED_OUTPUT_FAILURE_CATEGORIES = [
  "JSON_PARSE_FAILED",
  "SCHEMA_VALIDATION_FAILED",
  "REQUIRED_FIELD_MISSING",
  "WRONG_FIELD_TYPE",
  "OUTPUT_TRUNCATED",
  "PLATFORM_FIELD_MISMATCH",
  "MARKDOWN_CODE_FENCE",
  "NORMALIZATION_APPLIED",
  "REPAIR_RETRY_SUCCEEDED",
  "REPAIR_RETRY_FAILED",
  "PROVIDER_STRUCTURED_OUTPUT_INCOMPATIBILITY"
] as const;
export type StructuredOutputFailureCategory = (typeof STRUCTURED_OUTPUT_FAILURE_CATEGORIES)[number];

export interface StructuredOutputDiagnostic {
  phase: "strict" | "normalization" | "repair";
  category: StructuredOutputFailureCategory;
  platformKey?: string;
  issuePath?: string;
  expectedType?: string;
  receivedType?: string;
  missingField?: string;
  parserError?: string;
  finishReason?: string | null;
  responseLength?: number;
  tokenUsage?: AIUsage;
  appliedFields?: string[];
  repairAttempted?: boolean;
}

export type GeneratedContentStudioContent = ContentStudioContent & { usage?: AIUsage; durationMs?: number; structuredDiagnostics?: StructuredOutputDiagnostic[] };
export type GeneratedContentStudioTopicPlan = ContentStudioTopicPlan & { usage?: AIUsage; durationMs?: number };

export type ConnectionCheckStatus = "normal" | "failed" | "not_tested";

export interface AIConnectionDiagnostic {
  provider: string;
  operation: "test_connection";
  baseUrl: string;
  endpoint: string;
  credentialPresent: boolean;
  credentialLength: number;
  credentialPrefixValid: boolean;
  model: string;
  apiAddress: ConnectionCheckStatus;
  authentication: ConnectionCheckStatus;
  api: ConnectionCheckStatus;
  modelStatus: ConnectionCheckStatus;
  chatCompletion: ConnectionCheckStatus;
  availableModels?: string[];
  httpStatus?: number;
  durationMs: number;
  requestId?: string;
  errorCode?: string;
  responseBodySummary?: string;
}

export interface AIConnectionResult {
  ok: boolean;
  message: string;
  diagnostic?: AIConnectionDiagnostic;
}

export interface AIProvider {
  readonly providerKey: string;
  readonly model: string;
  generateTitles(input: ArticleTask): Promise<string[]>;
  generateArticle(input: ArticleTask): Promise<GeneratedArticle>;
  rewriteArticle(input: ArticleTask & { article: Article }): Promise<GeneratedArticle>;
  rewriteForPlatform(input: ArticleTask & { article: Article; platformKey: string }): Promise<GeneratedArticle>;
  generateTopicPlan(input: ContentStudioInput): Promise<GeneratedContentStudioTopicPlan>;
  generateStudioContent(input: ContentStudioPlatformInput): Promise<GeneratedContentStudioContent>;
  testConnection(): Promise<AIConnectionResult>;
}

function compact(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export class MockAIProvider implements AIProvider {
  readonly providerKey = "mock";
  readonly model = "mock-editor-v0.1";

  async generateTitles(input: ArticleTask): Promise<string[]> {
    return [
      `${input.city}${input.keyword}怎么选？${input.brand.name}给出实用建议`,
      `${input.city}家庭${input.keyword}指南：从判断到服务流程`,
      `关于${input.keyword}，${input.brand.name}整理了这份${input.articleType}说明`
    ];
  }

  async generateArticle(input: ArticleTask): Promise<GeneratedArticle> {
    const prompt = buildArticlePrompt(input);
    const variantLabel = input.variant && input.variant > 1 ? `（第${input.variant}篇）` : "";
    const title = compact(`${input.city}${input.keyword}怎么选？一份基于实际服务流程的说明${variantLabel}`, 48);
    const body = [
      `围绕“${input.keyword}”，很多${input.city}用户首先关注的是服务是否清晰、流程是否可核验。本文从实际决策角度整理一份${input.articleType}内容${variantLabel}，帮助读者先明确需求，再比较服务方案。`,
      `选择服务时，可以先了解现场评估、方案沟通、施工安排和售后反馈等环节。${input.brand.name}的主营业务是${input.brand.mainBusiness || "相关企业服务"}，具体项目应以现场情况和双方确认内容为准。`,
      `企业资料中已经明确的信息包括：${input.brand.description || "品牌资料待补充"}。对于证书、效果数据、客户案例等信息，建议以企业提供的真实材料和正式文件为依据，不把未提供的内容当作承诺。`,
      `如果你正在了解${input.city}${input.keyword}，可以把房屋类型、面积、问题表现和期望时间整理好，再向服务方询问流程、报价范围与售后边界。这样更容易得到可比较、可执行的方案。`,
      input.includeFaq ? `常见问题：服务前需要准备什么？通常可以先提供基础需求和现场信息；最终方案仍应以实际勘察和双方确认结果为准。` : ""
    ].filter(Boolean).join("\n\n");
    const summary = input.includeSummary ? compact(body.replaceAll("\n", " "), 110) : "";
    const tags = input.includeTags ? [input.city, input.keyword, input.articleType, input.brand.name] : [];
    const seoKeywords = input.includeSeoKeywords ? [input.keyword, `${input.city}${input.keyword}`, `${input.brand.name}${input.keyword}`] : [];
    void prompt;
    return { title, body, summary, tags, seoKeywords, suggestedCoverPrompt: `${input.city}本地企业服务场景，真实自然光，干净克制，不出现文字、Logo、证书、数字或无法验证的效果承诺` };
  }

  async rewriteArticle(input: ArticleTask & { article: Article }): Promise<GeneratedArticle> {
    const generated = await this.generateArticle(input);
    return { ...generated, title: `改写版｜${generated.title}`, body: `${generated.body}\n\n本版本为内容复用前的结构化改写。` };
  }

  async rewriteForPlatform(input: ArticleTask & { article: Article; platformKey: string }): Promise<GeneratedArticle> {
    const generated = await this.generateArticle(input);
    return { ...generated, title: `${generated.title}｜${input.platformKey}`, body: `${generated.body}\n\n平台适配说明：保留事实边界，并按目标平台阅读习惯调整段落。` };
  }

  async generateTopicPlan(input: ContentStudioInput): Promise<GeneratedContentStudioTopicPlan> {
    const keyword = input.keywords[0] ?? "企业服务";
    const city = input.cities[0] ?? "本地";
    return {
      summary: `围绕${city}${input.industry || "行业"}${keyword}，先解释用户判断问题，再给出可核验的服务流程与选择建议。`,
      topics: [
        { title: `${city}${keyword}选择指南`, angle: "从用户决策问题出发解释服务流程", audience: `${city}正在了解${keyword}的用户`, keyPoints: ["先明确需求", "核对服务边界", "保留双方确认记录"], recommendedPlatforms: input.targetPlatforms.slice(0, 3) },
        { title: `${input.brand.name}的${keyword}服务流程`, angle: "把企业已提供的流程资料转成易读内容", audience: "需要比较服务方案的潜在客户", keyPoints: ["企业能提供什么", "哪些信息仍需现场确认", "售后边界如何理解"], recommendedPlatforms: input.targetPlatforms.slice(0, 4) },
        { title: `${city}${input.industry || "行业"}常见误区`, angle: "用事实边界澄清常见误解", audience: "希望降低决策风险的用户", keyPoints: ["避免无依据承诺", "关注可验证信息", "用问题清单沟通"], recommendedPlatforms: input.targetPlatforms.slice(0, 6) }
      ],
      durationMs: 0
    };
  }

  async generateStudioContent(input: ContentStudioPlatformInput): Promise<GeneratedContentStudioContent> {
    const platform = getContentStudioPlatform(input.platformKey);
    const keyword = input.keywords[0] ?? "企业服务";
    const city = input.cities[0] ?? "本地";
    const topic = input.topicPlan?.topics[0]?.title ?? `${city}${keyword}选择指南`;
    const primary = `${city}${keyword}`;
    const common = `围绕“${keyword}”，${input.brand.name}在${city}提供的已知信息是：${input.brand.description || input.brand.mainBusiness || "企业资料待补充"}。具体服务内容、现场情况和双方确认结果应以正式资料为准。`;
    const articleBodies: Record<string, string> = {
      wechat_official: `导语\n\n${common}\n\n一、先明确自己的需求\n把使用场景、时间安排和希望解决的问题整理清楚，再进入方案沟通。\n\n二、核对服务流程与边界\n${input.brand.serviceProcess || "服务流程需要在沟通时逐项确认"}。对于未提供的证书、案例、数据和效果，不作额外推断。\n\n三、留下可核验的确认记录\n将方案范围、交付节点和售后边界写入双方确认内容。\n\n结语\n${city}用户了解${keyword}时，先比较信息是否清晰，再选择适合自己的沟通方式。`,
      zhihu: `先说结论：判断${city}${keyword}是否适合自己，重点不是一句宣传语，而是企业资料、服务流程和交付边界能否被核对。\n\n${common}\n\n可以从三个问题开始：\n1. 我的实际需求和使用场景是什么？\n2. 服务方能明确说明哪些步骤？\n3. 哪些内容还需要现场评估或双方确认？\n\n常见误区是把“保存联系方式”理解成“已经获得服务”，或者把“选择方案”理解成“交付结果已经保证”。这些环节需要分别确认。\n\n如果你正在了解${keyword}，建议先列问题清单，再基于正式资料做比较。`,
      toutiao: `很多${city}用户第一次了解${keyword}时，最容易卡在“怎么判断”。这篇内容用一份清单，把${topic}拆开说明。\n\n第一步：说清楚场景和需求。\n第二步：了解${input.brand.name}已经公开的业务资料。\n第三步：逐项确认服务流程、报价范围和售后边界。\n\n${common}\n\n提醒：没有资料支持的排名、数据、案例和效果不能当作承诺。把关键问题写下来，沟通效率会更高。`,
      weibo: `在${city}了解${keyword}，先记住这 3 点：明确需求、核对流程、确认边界。${common} 具体信息以正式资料和双方确认内容为准。\n\n#${primary}# #${input.industry || "企业服务"}# 你还会先确认哪个问题？`,
      douyin: `【0-3秒钩子】在${city}想了解${keyword}，别先被一句宣传语带着走！\n\n【分镜1｜0-5秒】画面：用户写下需求清单。口播：先说清楚你要解决什么问题。字幕：明确场景和需求。\n\n【分镜2｜5-15秒】画面：展示企业资料与流程卡片。口播：再看服务方能不能讲清流程和边界。字幕：信息要可核对。\n\n【分镜3｜15-25秒】画面：双方确认记录。口播：最后把方案范围、节点和售后写下来。\n\n【结尾】${input.brand.name}提醒：${common}。评论区留下你最想确认的问题。`,
      bilibili: `【视频定位】用一条可复用的判断框架，解释${city}${keyword}的选择逻辑。\n\n【开场承诺】今天不讲夸张承诺，只用三个章节带你看懂${topic}。\n\n【第一章：从需求出发】旁白：先记录场景、问题表现和期望时间。画面：问题清单逐项出现。\n\n【第二章：看懂企业资料】旁白：${common}画面：品牌资料、业务范围和服务流程卡片。\n\n【第三章：确认交付边界】旁白：把方案范围、节点、售后和仍待现场确认的事项写入记录。\n\n【结尾互动】你在了解${keyword}时最担心哪一步？欢迎在评论区讨论。`
    };
    return {
      platformKey: input.platformKey,
      contentType: platform.contentType,
      title: input.platformKey === "wechat_official" ? `${city}${keyword}｜一份可核验的服务判断指南` : input.platformKey === "zhihu" ? `在${city}，${keyword}到底应该怎么判断？` : input.platformKey === "toutiao" ? `${city}${keyword}：把选择问题拆成一份清单` : input.platformKey === "weibo" ? `${city}${keyword}，先确认这 3 件事` : input.platformKey === "douyin" ? `抖音脚本｜${city}${keyword}的 3 个确认动作` : `B站视频脚本｜${city}${keyword}完整判断框架`,
      body: articleBodies[input.platformKey] ?? common,
      summary: compact(`${topic}：${common}`, 120),
      tags: [city, keyword, input.industry || "企业服务"],
      seoKeywords: [primary, keyword, `${city}${input.industry || "企业服务"}`],
      tone: platform.tone,
      structure: platform.structure.split("-").map((item) => item.trim()),
      keywordLayout: { primary, secondary: [keyword, input.industry || "企业服务"], placements: platform.keywordLayout.split("，") },
      durationMs: 0
    };
  }

  async testConnection(): Promise<AIConnectionResult> { return { ok: true, message: "Mock Provider 可用" }; }
}

export class FallbackAIProvider implements AIProvider {
  readonly providerKey: string;
  readonly model: string;

  constructor(private readonly primary: AIProvider, private readonly fallback: AIProvider) {
    this.providerKey = primary.providerKey;
    this.model = primary.model;
  }

  async generateTitles(input: ArticleTask): Promise<string[]> { try { return await this.primary.generateTitles(input); } catch { return this.fallback.generateTitles(input); } }
  async generateArticle(input: ArticleTask): Promise<GeneratedArticle> { try { return await this.primary.generateArticle(input); } catch { return this.fallback.generateArticle(input); } }
  async rewriteArticle(input: ArticleTask & { article: Article }): Promise<GeneratedArticle> { try { return await this.primary.rewriteArticle(input); } catch { return this.fallback.rewriteArticle(input); } }
  async rewriteForPlatform(input: ArticleTask & { article: Article; platformKey: string }): Promise<GeneratedArticle> { try { return await this.primary.rewriteForPlatform(input); } catch { return this.fallback.rewriteForPlatform(input); } }
  async generateTopicPlan(input: ContentStudioInput): Promise<GeneratedContentStudioTopicPlan> { try { return await this.primary.generateTopicPlan(input); } catch { return this.fallback.generateTopicPlan(input); } }
  async generateStudioContent(input: ContentStudioPlatformInput): Promise<GeneratedContentStudioContent> { try { return await this.primary.generateStudioContent(input); } catch { return this.fallback.generateStudioContent(input); } }
  async testConnection(): Promise<AIConnectionResult> { const primary = await this.primary.testConnection(); return primary.ok ? primary : this.fallback.testConnection(); }
}

export function contentHash(article: Pick<GeneratedArticle, "title" | "body">): string {
  return createHash("sha256").update(`${article.title}\n${article.body}`).digest("hex");
}

export function makeArticleTask(input: ArticleTask): ArticleTask {
  return { ...input, brand: { ...input.brand, aiForbiddenClaims: [...input.brand.aiForbiddenClaims] } };
}

// Kept as a compile-time guard for consumers that map provider output to persistence models.
export type GeneratedArticleShape = GeneratedArticle;

export { AIProviderError, DeepSeekErrorMapper, DeepSeekProvider, OpenAICompatibleProvider, buildAuthorizationHeader, normalizeBaseUrl } from "./openai-compatible";
export type { AIProviderErrorCode, DeepSeekConfig, DeepSeekMappedError, OpenAICompatibleConfig, ProviderError } from "./openai-compatible";
