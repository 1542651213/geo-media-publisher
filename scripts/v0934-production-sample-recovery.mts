import { app, safeStorage } from "electron";
import { join } from "node:path";
import { DeepSeekProvider, type AIConnectionResult } from "@publisher/ai";
import { openDatabase, type ContentStudioTaskPayload, type ContentStudioTaskView } from "@publisher/db";
import { type Article, type ContentGoal, type ContentIntent, type ContentStudioPlatformKey, type ContentStudioTopicPlan, type PromotionStrength, type SearchIntent } from "@publisher/domain";
import { createFileLogger } from "@publisher/logger";
import { SafeStorageCredentialStore } from "@publisher/security";
import { runContentStudioTask, CONTENT_STUDIO_PROMPT_VERSION } from "../apps/desktop/src/main/content-studio";

app.setName("codex-media-publisher");

const COMPANY_NAME = "江苏康一环保科技有限公司";
const RECOVERY_VERSION = "V0.9.3.4";

interface RecoveryScenario {
  city: string;
  keyword: string;
  business: string;
  topic: string;
  contentGoal: ContentGoal;
  contentIntent: ContentIntent;
  searchIntent: SearchIntent;
  promotionStrength: PromotionStrength;
}

const scenarios: RecoveryScenario[] = [
  { city: "苏州", keyword: "苏州甲醛治理哪家好", business: "甲醛治理", topic: "苏州甲醛治理怎么选：重点看服务环节", contentGoal: "BrandPromotion", contentIntent: "BrandAnswer", searchIntent: "Commercial", promotionStrength: "Balanced" },
  { city: "苏州", keyword: "苏州除甲醛找谁", business: "甲醛治理", topic: "苏州除甲醛怎么选服务方：先核对需求与服务边界", contentGoal: "SEOArticle", contentIntent: "SelectionGuide", searchIntent: "Commercial", promotionStrength: "Balanced" },
  { city: "苏州", keyword: "苏州甲醛治理价格", business: "甲醛治理", topic: "苏州甲醛治理价格怎么比较：先看服务范围与交付边界", contentGoal: "SEOArticle", contentIntent: "SelectionGuide", searchIntent: "CommercialInvestigation", promotionStrength: "Balanced" },
  { city: "木渎", keyword: "木渎白蚁防治公司", business: "白蚁防治", topic: "木渎白蚁防治找服务方时，如何核对真实信息", contentGoal: "BrandPromotion", contentIntent: "BrandAnswer", searchIntent: "Commercial", promotionStrength: "Balanced" },
  { city: "木渎", keyword: "木渎白蚁防治服务", business: "白蚁防治", topic: "木渎白蚁防治本地服务：从现场沟通到结果复核", contentGoal: "SEOArticle", contentIntent: "LocalService", searchIntent: "Commercial", promotionStrength: "Balanced" },
  { city: "木渎", keyword: "木渎定期消杀怎么选服务商", business: "定期消杀", topic: "木渎定期消杀怎么选服务商：看哪些可核对信息", contentGoal: "BrandPromotion", contentIntent: "SelectionGuide", searchIntent: "Commercial", promotionStrength: "Balanced" },
  { city: "木渎", keyword: "木渎消杀找谁", business: "定期消杀", topic: "木渎消杀找谁：三个确认动作口播脚本", contentGoal: "VideoScript", contentIntent: "LocalService", searchIntent: "Commercial", promotionStrength: "Soft" },
  { city: "江苏", keyword: "江苏病媒生物防制服务", business: "病媒生物防制", topic: "江苏病媒生物防制服务信息如何被准确理解", contentGoal: "GEOArticle", contentIntent: "ServiceIntroduction", searchIntent: "Commercial", promotionStrength: "Balanced" },
  { city: "江苏", keyword: "江苏病媒生物防制流程", business: "病媒生物防制", topic: "江苏病媒生物防制问题怎么拆解：从需求到服务边界", contentGoal: "GEOArticle", contentIntent: "ProblemSolution", searchIntent: "Informational", promotionStrength: "Soft" },
  { city: "苏州", keyword: "苏州甲醛治理原理", business: "甲醛治理", topic: "苏州甲醛治理原理与服务边界：先理解问题再沟通方案", contentGoal: "Educational", contentIntent: "Educational", searchIntent: "Informational", promotionStrength: "Soft" },
  { city: "木渎", keyword: "木渎消杀常见问题", business: "定期消杀", topic: "木渎消杀 FAQ：服务前需要核对哪些信息", contentGoal: "FAQ", contentIntent: "FAQ", searchIntent: "Informational", promotionStrength: "Soft" },
  { city: "江苏", keyword: "江苏病媒生物防制专业问题", business: "病媒生物防制", topic: "江苏病媒生物防制专业判断：如何核对服务信息", contentGoal: "GEOArticle", contentIntent: "ProfessionalInsight", searchIntent: "Informational", promotionStrength: "Soft" }
];

function topicPlan(scenario: RecoveryScenario, targetPlatforms: ContentStudioPlatformKey[]): ContentStudioTopicPlan {
  return {
    summary: scenario.topic,
    topics: [{
      title: scenario.topic,
      angle: "围绕用户问题组织相关企业事实，不扩展到无关业务",
      audience: `${scenario.city}${scenario.business}的需求用户`,
      keyPoints: ["用户问题", "选择或判断标准", "相关企业事实", "下一步核对事项"],
      recommendedPlatforms: targetPlatforms
    }]
  };
}

function recoveryPayload(current: ContentStudioTaskPayload, scenario: RecoveryScenario): ContentStudioTaskPayload {
  const targetPlatforms = current.targetPlatforms as ContentStudioPlatformKey[];
  return {
    ...current,
    cities: [scenario.city],
    city: scenario.city,
    keywords: [scenario.keyword],
    keyword: scenario.keyword,
    business: scenario.business,
    topic: scenario.topic,
    contentGoal: scenario.contentGoal,
    contentIntent: scenario.contentIntent,
    searchIntent: scenario.searchIntent,
    promotionStrength: scenario.promotionStrength,
    promptVersion: CONTENT_STUDIO_PROMPT_VERSION,
    topicPlan: topicPlan(scenario, targetPlatforms)
  };
}

function safeConfig(settings: Record<string, unknown>): { provider: string; model: string; baseUrl: string; maxOutputTokens: number; temperature: number; retryCount: number; generationMode: "economy" | "quality" } {
  return {
    provider: "deepseek",
    model: typeof settings.deepseekModel === "string" ? settings.deepseekModel : "deepseek-v4-flash",
    baseUrl: typeof settings.deepseekBaseUrl === "string" ? settings.deepseekBaseUrl : "https://api.deepseek.com",
    maxOutputTokens: typeof settings.maxOutputTokens === "number" ? settings.maxOutputTokens : 3000,
    temperature: typeof settings.temperature === "number" ? settings.temperature : 0.7,
    retryCount: typeof settings.retry === "number" ? settings.retry : 3,
    generationMode: settings.deepseekGenerationMode === "quality" ? "quality" : "economy"
  };
}

function safeDiagnostic(result: AIConnectionResult, config: ReturnType<typeof safeConfig>): Record<string, unknown> {
  const diagnostic = result.diagnostic;
  return {
    provider: config.provider,
    model: config.model,
    status: result.ok ? "ready" : "blocked",
    message: result.message,
    httpStatus: diagnostic?.httpStatus ?? null,
    requestId: diagnostic?.requestId ?? null,
    errorCategory: diagnostic?.errorCode ?? null,
    responseBodySummary: diagnostic?.responseBodySummary ?? null,
    providerStatus: {
      api: diagnostic?.api ?? "not_tested",
      authentication: diagnostic?.authentication ?? "not_tested",
      model: diagnostic?.modelStatus ?? "not_tested",
      chatCompletion: diagnostic?.chatCompletion ?? "not_tested",
      credentialPresent: diagnostic?.credentialPresent ?? false,
      availableModels: diagnostic?.availableModels ?? []
    },
    tokenParameters: { maxOutputTokens: config.maxOutputTokens, temperature: config.temperature, retryCount: config.retryCount }
  };
}

function resultForArticle(taskId: string, scenario: RecoveryScenario, brandName: string, article: Article | null, task: ContentStudioTaskView | null): Record<string, unknown> {
  const text = `${article?.title ?? ""}\n${article?.body ?? ""}`;
  const brandMentionCount = article?.brandMentionCount ?? 0;
  const brandPresent = text.includes(COMPANY_NAME) || text.includes(brandName);
  const absoluteWordHits = ["第一", "最好", "唯一", "百分百", "永久有效", "国家级"].filter((word) => text.includes(word));
  const snapshot = article?.knowledgeSnapshot ?? task?.output.knowledgeSnapshot ?? null;
  return {
    taskId,
    scenario: `${scenario.city} ${scenario.business} ${scenario.contentIntent}`,
    title: article?.title ?? null,
    source: article?.source ?? null,
    status: task?.status ?? "unknown",
    brandPresent,
    contentGoal: article?.contentGoal ?? scenario.contentGoal,
    contentIntent: article?.contentIntent ?? scenario.contentIntent,
    searchIntent: article?.searchIntent ?? scenario.searchIntent,
    brandFactUsageCount: article?.brandFactUsageCount ?? snapshot?.factCount ?? 0,
    brandMentionCount,
    uniqueBrandFactCount: article?.uniqueBrandFactCount ?? 0,
    brandDifferentiationScore: article?.brandDifferentiationScore ?? null,
    knowledgeSnapshot: snapshot,
    provider: article?.aiProvider ?? "deepseek",
    model: article?.aiModel ?? "deepseek-v4-flash",
    promptVersion: article?.promptVersion ?? CONTENT_STUDIO_PROMPT_VERSION,
    absoluteWordHits,
    qualityStatus: article?.qualityStatus ?? null,
    qualityWarnings: article?.qualityWarnings ?? [],
    cityMatches: article?.city === scenario.city,
    businessMatches: article?.keyword.includes(scenario.business) || article?.topic.includes(scenario.business) || text.includes(scenario.business),
    brandMentionMetricMatches: brandMentionCount > 0
  };
}

async function main(): Promise<void> {
  await app.whenReady();
  const dataDirectory = join(app.getPath("userData"), "production-data");
  const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
  try {
    const settings = opened.repository.getSettings();
    const config = safeConfig(settings);
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const apiKey = credentials.get("ai:apiKey");
    if (!apiKey) throw new Error("DeepSeek secure credential is not configured");
    const provider = new DeepSeekProvider({ apiKey, baseUrl: config.baseUrl, model: config.model, thinking: config.generationMode === "quality" ? "enabled" : "disabled", temperature: config.temperature, maxOutputTokens: config.maxOutputTokens, timeoutMs: typeof settings.timeout === "number" ? settings.timeout : 30000, retryCount: config.retryCount, logger });
    const connection = await provider.testConnection();
    const diagnostic = safeDiagnostic(connection, config);
    if (!connection.ok) {
      const failedTasks = opened.repository.listContentStudioTasks().filter((task) => task.type === "production_intent_sample" && task.status === "failed" && !task.sourceArticleId);
      for (const task of failedTasks) {
        opened.repository.updateContentStudioTask(task.id, { completed: task.completed, success: task.success, failed: task.failed, status: task.status, errorMessage: task.errorMessage, usage: task.usage, durationMs: task.durationMs, output: { providerDiagnostics: diagnostic } });
      }
      console.log(JSON.stringify({ version: RECOVERY_VERSION, status: "BLOCKED", reason: diagnostic, recordedTaskDiagnostics: failedTasks.length }, null, 2));
      return;
    }

    const brand = opened.repository.listBrands().find((item) => item.companyName === COMPANY_NAME);
    if (!brand) throw new Error(`Production brand ${COMPANY_NAME} not found`);
    const tasks = opened.repository.listContentStudioTasks().filter((task) => task.type === "production_intent_sample").sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    if (tasks.length !== scenarios.length) throw new Error(`Expected exactly ${scenarios.length} existing production sample tasks, found ${tasks.length}`);
    if (tasks.some((task) => task.sourceArticleId || task.status === "completed")) throw new Error("Recovery requires only source-less, incomplete production sample tasks");

    const results: Array<Record<string, unknown>> = [];
    for (const [index, task] of tasks.entries()) {
      const scenario = scenarios[index] as RecoveryScenario;
      const payload = recoveryPayload(task.payload, scenario);
      opened.repository.resetContentStudioTaskForRecovery(task.id, payload);
      await runContentStudioTask(opened.repository, logger, { createAiProvider: () => provider }, task.id);
      const recoveredTask = opened.repository.getContentStudioTask(task.id);
      const article = recoveredTask?.sourceArticleId ? opened.repository.getArticle(recoveredTask.sourceArticleId) : null;
      results.push(resultForArticle(task.id, scenario, brand.name, article, recoveredTask));
    }
    const completed = results.filter((result) => result.status === "completed" && result.source === "production").length;
    console.log(JSON.stringify({ version: RECOVERY_VERSION, status: completed === scenarios.length ? "COMPLETED" : "PARTIAL", companyName: brand.companyName, brandId: brand.id, promptVersion: CONTENT_STUDIO_PROMPT_VERSION, preflight: diagnostic, completed, total: scenarios.length, samples: results }, null, 2));
  } finally {
    opened.db.close();
  }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "V0.9.3.4 production sample recovery failed"); process.exitCode = 1; }).finally(() => { app.quit(); });
