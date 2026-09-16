import type { AIUsage, Article, ContentStudioInput, ContentStudioPlatformInput, ContentStudioContent, ContentStudioTopicPlan } from "@publisher/domain";
import { buildArticlePrompt, buildContentStudioPlanPrompt, buildContentStudioPlatformPrompt, getContentStudioPlatform, type PromptInput } from "@publisher/domain";
import { z } from "zod";
import type { AIConnectionDiagnostic, AIConnectionResult, AIProvider, ArticleTask, GeneratedArticle, GeneratedContentStudioContent, GeneratedContentStudioTopicPlan, StructuredOutputDiagnostic, StructuredOutputFailureCategory } from "./index";

export interface OpenAICompatibleConfig {
  providerKey?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryCount: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  logger?: AIProviderLogger;
}

export interface AIProviderLogger {
  info(module: string, code: string, message: string, context?: Record<string, unknown>): void;
  warn?(module: string, code: string, message: string, context?: Record<string, unknown>): void;
  error?(module: string, code: string, message: string, context?: Record<string, unknown>): void;
}

const GeneratedArticleSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1),
  summary: z.string().default(""),
  tags: z.array(z.string()).default([]),
  seoKeywords: z.array(z.string()).default([]),
  suggestedCoverPrompt: z.string().default("")
});

const ContentStudioTopicPlanSchema = z.object({
  summary: z.string().trim().min(1),
  topics: z.array(z.object({
    title: z.string().trim().min(1),
    angle: z.string().trim().min(1),
    audience: z.string().trim().min(1),
    keyPoints: z.array(z.string().trim().min(1)).min(1),
    recommendedPlatforms: z.array(z.string().trim().min(1))
  })).min(1).max(10)
});

const ContentStudioContentSchema = z.object({
  platformKey: z.enum(["wechat_official", "zhihu", "toutiao", "weibo", "douyin", "bilibili"]),
  contentType: z.enum(["article", "video_script"]),
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1),
  summary: z.string().default(""),
  tags: z.array(z.string()).default([]),
  seoKeywords: z.array(z.string()).default([]),
  tone: z.string().default(""),
  structure: z.array(z.string()).default([]),
  keywordLayout: z.object({ primary: z.string().default(""), secondary: z.array(z.string()).default([]), placements: z.array(z.string()).default([]) })
});

interface ChatResponse {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; prompt_cache_hit_tokens?: unknown };
}

interface ModelsResponse {
  data?: Array<{ id?: unknown }>;
}

type ChatMessage = { role: "system" | "user"; content: string };
interface ChatRequestOptions { structuredOutput?: boolean }

export type AIProviderErrorCode =
  | "AI_AUTH"
  | "AI_BALANCE"
  | "AI_MODEL"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_TRANSPORT"
  | "AI_BAD_REQUEST"
  | "AI_INVALID_REQUEST"
  | "AI_INVALID_RESPONSE"
  | "AI_INVALID_OUTPUT"
  | "AI_SERVER"
  | "AI_HTTP";

export interface ProviderError {
  code: AIProviderErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  provider?: string;
  requestId?: string;
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseUsage(value: ChatResponse["usage"], config: OpenAICompatibleConfig): AIUsage | undefined {
  if (!value) return undefined;
  const promptTokens = positiveNumber(value.prompt_tokens);
  const completionTokens = positiveNumber(value.completion_tokens);
  const totalTokens = positiveNumber(value.total_tokens) || promptTokens + completionTokens;
  const cacheHitTokens = positiveNumber(value.prompt_cache_hit_tokens);
  const estimatedCost = config.inputCostPer1k === undefined && config.outputCostPer1k === undefined ? undefined : promptTokens / 1000 * (config.inputCostPer1k ?? 0) + completionTokens / 1000 * (config.outputCostPer1k ?? 0);
  return { promptTokens, completionTokens, totalTokens, ...(cacheHitTokens > 0 ? { cacheHitTokens } : {}), ...(estimatedCost === undefined ? {} : { estimatedCost, currency: "USD" }) };
}

export function normalizeBaseUrl(baseUrl: string, options: { stripV1?: boolean } = {}): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  if (!options.stripV1) return trimmed;
  return trimmed.replace(/\/v1$/iu, "");
}

function endpoint(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

export function buildAuthorizationHeader(apiKey: string): string {
  return `Bearer ${apiKey.trim()}`;
}

function isRetryableCode(code: AIProviderErrorCode): boolean {
  return ["AI_RATE_LIMITED", "AI_SERVER", "AI_TRANSPORT", "AI_TIMEOUT"].includes(code);
}

function safeResponseBodySummary(value: string): string | undefined {
  const compact = value.replace(/[\r\n\t]+/gu, " ").replace(/\s{2,}/gu, " ").trim();
  if (!compact) return undefined;
  return compact
    .replace(/Bearer\s+[^\s,}]+/giu, "Bearer [REDACTED]")
    .replace(/("?(?:api[_-]?key|apikey|authorization|cookie|secret|token|password)"?\s*[:=]\s*")([^"\r\n]+)(")/giu, "$1[REDACTED]$3")
    .slice(0, 500);
}

function responseRequestId(headers: Headers, body: unknown): string | undefined {
  const headerId = headers.get("x-request-id") ?? headers.get("x-trace-id") ?? headers.get("request-id");
  if (headerId?.trim()) return headerId.trim();
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  for (const key of ["request_id", "requestId", "trace_id", "traceId"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}

function httpErrorCode(status: number): AIProviderErrorCode {
  if (status === 400) return "AI_BAD_REQUEST";
  if (status === 401 || status === 403) return "AI_AUTH";
  if (status === 402) return "AI_BALANCE";
  if (status === 404) return "AI_MODEL";
  if (status === 422) return "AI_INVALID_REQUEST";
  if (status === 429) return "AI_RATE_LIMITED";
  if (status >= 500) return "AI_SERVER";
  return "AI_HTTP";
}

function safeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return "[invalid-url]";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError" || Boolean(error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError");
}

function contentFromResponse(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item): item is { text: string } => Boolean(item) && typeof item === "object" && "text" in item && typeof item.text === "string").map((item) => item.text).join("\n");
  return "";
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) return trimmed.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "").trim();
  return trimmed;
}

interface StructuredResponseMetadata {
  platformKey: string;
  finishReason: string | null;
  responseLength: number;
  usage?: AIUsage;
  repairAttempted?: boolean;
}

interface StructuredParseResult {
  value: z.infer<typeof ContentStudioContentSchema> | null;
  diagnostics: StructuredOutputDiagnostic[];
}

function runtimeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function splitStringList(value: string): string[] {
  return value.split(/[\n,，、;；|]/u).map((item) => item.trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAtPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((current, segment) => isRecord(current) ? current[segment] : undefined, value);
}

function parseStructuredJson(value: string, metadata: StructuredResponseMetadata): { raw: unknown | null; diagnostic: StructuredOutputDiagnostic | null } {
  const trimmed = value.trim();
  const hadCodeFence = /^```(?:json)?\s*/iu.test(trimmed) && /```$/u.test(trimmed);
  const candidate = stripCodeFence(value);
  let raw = parseJson(candidate);
  let extracted = false;
  if (raw === undefined) {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      raw = parseJson(candidate.slice(firstBrace, lastBrace + 1));
      extracted = raw !== undefined;
    }
  }
  if (raw !== undefined) {
    return { raw, diagnostic: hadCodeFence || extracted ? { phase: "strict", category: "MARKDOWN_CODE_FENCE", platformKey: metadata.platformKey, finishReason: metadata.finishReason, responseLength: metadata.responseLength, tokenUsage: metadata.usage, repairAttempted: metadata.repairAttempted } : null };
  }
  const likelyTruncated = metadata.finishReason === "length" || candidate.trim().startsWith("{") && !candidate.trim().endsWith("}");
  let parserError = "JSON parse failed";
  try { JSON.parse(candidate); } catch (error) { if (error instanceof SyntaxError) parserError = error.message.slice(0, 160); }
  return {
    raw: null,
    diagnostic: { phase: metadata.repairAttempted ? "repair" : "strict", category: likelyTruncated ? "OUTPUT_TRUNCATED" : "JSON_PARSE_FAILED", platformKey: metadata.platformKey, parserError, finishReason: metadata.finishReason, responseLength: metadata.responseLength, tokenUsage: metadata.usage, repairAttempted: metadata.repairAttempted }
  };
}

function schemaDiagnostic(raw: unknown, result: z.ZodSafeParseError<z.infer<typeof ContentStudioContentSchema>>, metadata: StructuredResponseMetadata): StructuredOutputDiagnostic {
  const issue = result.error.issues[0];
  const path = issue?.path.map((part: PropertyKey) => String(part)).join(".") || undefined;
  const issueRecord = issue as unknown as Record<string, unknown> | undefined;
  const expectedType = typeof issueRecord?.expected === "string" ? issueRecord.expected : undefined;
  const receivedType = typeof issueRecord?.received === "string" ? issueRecord.received : runtimeType(valueAtPath(raw, path));
  const missingField = issue?.code === "invalid_type" && receivedType === "undefined" ? path : undefined;
  const category: StructuredOutputFailureCategory = metadata.finishReason === "length"
    ? "OUTPUT_TRUNCATED"
    : path === "platformKey" || path === "contentType"
      ? "PLATFORM_FIELD_MISMATCH"
      : missingField
        ? "REQUIRED_FIELD_MISSING"
        : issue?.code === "invalid_type"
          ? "WRONG_FIELD_TYPE"
          : "SCHEMA_VALIDATION_FAILED";
  return { phase: metadata.repairAttempted ? "repair" : "strict", category, platformKey: metadata.platformKey, issuePath: path, expectedType, receivedType, missingField, finishReason: metadata.finishReason, responseLength: metadata.responseLength, tokenUsage: metadata.usage, repairAttempted: metadata.repairAttempted };
}

function normalizeWeChatContent(raw: unknown, input: ContentStudioPlatformInput): { value: Record<string, unknown>; appliedFields: string[] } | null {
  if (!isRecord(raw) || input.platformKey !== "wechat_official") return null;
  const value: Record<string, unknown> = { ...raw };
  const appliedFields: string[] = [];
  const copyAlias = (from: string, to: string): void => {
    if (value[to] === undefined && value[from] !== undefined) { value[to] = value[from]; appliedFields.push(`${from}->${to}`); }
  };
  copyAlias("platform_key", "platformKey");
  copyAlias("content_type", "contentType");
  copyAlias("headline", "title");
  copyAlias("content", "body");
  copyAlias("seo_keywords", "seoKeywords");
  copyAlias("keyword_layout", "keywordLayout");
  if (value.platformKey === undefined) { value.platformKey = input.platformKey; appliedFields.push("platformKey=target"); }
  if (["wechat", "微信公众号"].includes(String(value.platformKey))) { value.platformKey = input.platformKey; appliedFields.push("platformKey=canonical"); }
  if (value.platformKey !== input.platformKey) return null;
  if (value.contentType === undefined) { value.contentType = getContentStudioPlatform(input.platformKey).contentType; appliedFields.push("contentType=platform-definition"); }
  for (const field of ["tags", "seoKeywords", "structure"] as const) {
    if (typeof value[field] === "string") { value[field] = splitStringList(value[field] as string); appliedFields.push(`${field}=string-list`); }
  }
  if (typeof value.summary !== "string" && typeof value.body === "string") { value.summary = value.body.slice(0, 120); appliedFields.push("summary=body-excerpt"); }
  if (typeof value.keywordLayout === "string") {
    value.keywordLayout = { primary: input.keywords[0] ?? "", secondary: [], placements: splitStringList(value.keywordLayout as string) };
    appliedFields.push("keywordLayout=string-object");
  } else if (isRecord(value.keywordLayout)) {
    const keywordLayout = { ...value.keywordLayout };
    if (typeof keywordLayout.secondary === "string") { keywordLayout.secondary = splitStringList(keywordLayout.secondary); appliedFields.push("keywordLayout.secondary=string-list"); }
    if (typeof keywordLayout.placements === "string") { keywordLayout.placements = splitStringList(keywordLayout.placements); appliedFields.push("keywordLayout.placements=string-list"); }
    if (keywordLayout.primary === undefined) { keywordLayout.primary = input.keywords[0] ?? ""; appliedFields.push("keywordLayout.primary=input-keyword"); }
    value.keywordLayout = keywordLayout;
  } else if (value.keywordLayout === undefined) {
    value.keywordLayout = { primary: input.keywords[0] ?? "", secondary: [], placements: [] };
    appliedFields.push("keywordLayout=derived-from-input");
  }
  return appliedFields.length > 0 ? { value, appliedFields } : null;
}

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly provider?: string;
  readonly requestId?: string;
  readonly bodySummary?: string;
  readonly structuredDiagnostics?: StructuredOutputDiagnostic[];

  constructor(code: AIProviderErrorCode, message: string, options: { retryable?: boolean; httpStatus?: number; provider?: string; requestId?: string; bodySummary?: string; structuredDiagnostics?: StructuredOutputDiagnostic[] } = {}) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.retryable = options.retryable ?? isRetryableCode(code);
    this.httpStatus = options.httpStatus;
    this.provider = options.provider;
    this.requestId = options.requestId;
    this.bodySummary = options.bodySummary;
    this.structuredDiagnostics = options.structuredDiagnostics;
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly providerKey: string;
  readonly model: string;
  protected readonly config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    const apiKey = config.apiKey.trim();
    this.config = { ...config, apiKey, baseUrl: normalizeBaseUrl(config.baseUrl), providerKey: config.providerKey ?? "openai-compatible" };
    this.providerKey = this.config.providerKey as string;
    this.model = config.model;
    if (!apiKey) throw new AIProviderError("AI_AUTH", "AI API Key 未配置", { provider: this.providerKey });
  }

  async testConnection(): Promise<AIConnectionResult> {
    try {
      await this.requestChat([{ role: "user", content: "只回复 OK" }], 16, { structuredOutput: false });
      return { ok: true, message: "AI Provider 连接成功" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "AI Provider 连接失败" };
    }
  }

  async generateTitles(input: ArticleTask): Promise<string[]> {
    const generated = await this.generateArticle(input);
    return [generated.title];
  }

  async generateArticle(input: ArticleTask): Promise<GeneratedArticle> {
    return this.generateStructured(input, buildArticlePrompt(input));
  }

  async rewriteArticle(input: ArticleTask & { article: Article }): Promise<GeneratedArticle> {
    const prompt = `${buildArticlePrompt(input)}\n\n待改写文章标题：${input.article.title}\n待改写文章正文：\n${input.article.body}\n\n请在不增加事实的前提下重写，保留可核验信息，改变结构和表达。`;
    return this.generateStructured(input, prompt);
  }

  async rewriteForPlatform(input: ArticleTask & { article: Article; platformKey: string }): Promise<GeneratedArticle> {
    const prompt = `${buildArticlePrompt({ ...input, platformKey: input.platformKey })}\n\n目标平台：${input.platformKey}\n原文标题：${input.article.title}\n原文正文：\n${input.article.body}\n\n请按平台阅读习惯生成独立版本，但不得新增原文没有的事实。`;
    return this.generateStructured(input, prompt);
  }

  async generateTopicPlan(input: ContentStudioInput): Promise<GeneratedContentStudioTopicPlan> {
    const startedAt = Date.now();
    const first = await this.requestChat([{ role: "system", content: "只返回合法 JSON，不要 Markdown 代码围栏。" }, { role: "user", content: buildContentStudioPlanPrompt(input) }], this.config.maxOutputTokens);
    const repaired = this.parseTopicPlan(first.content);
    if (repaired) return { ...repaired, usage: first.usage, durationMs: Date.now() - startedAt };
    const second = await this.requestChat([{ role: "system", content: "只返回合法 JSON，不要解释。" }, { role: "user", content: `请修复为合法 JSON，只保留 summary 和 topics 字段，不得增加事实：\n${first.content.slice(0, 16000)}` }], this.config.maxOutputTokens);
    const parsed = this.parseTopicPlan(second.content);
    if (!parsed) throw new AIProviderError("AI_INVALID_OUTPUT", "AI 主题规划未通过结构化校验");
    return { ...parsed, usage: second.usage ?? first.usage, durationMs: Date.now() - startedAt };
  }

  async generateStudioContent(input: ContentStudioPlatformInput): Promise<GeneratedContentStudioContent> {
    const startedAt = Date.now();
    const first = await this.requestChat([{ role: "system", content: "只返回合法 JSON，不要 Markdown 代码围栏，不要补写未提供的企业事实。" }, { role: "user", content: buildContentStudioPlatformPrompt(input) }], this.config.maxOutputTokens);
    const firstParsed = this.parseContentStudio(first.content, input, { platformKey: input.platformKey, finishReason: first.finishReason, responseLength: first.responseLength, usage: first.usage });
    if (firstParsed.value) return { ...firstParsed.value, usage: first.usage, durationMs: Date.now() - startedAt, structuredDiagnostics: firstParsed.diagnostics };
    const repairRequirements = input.platformKey === "wechat_official" ? "platformKey 必须严格为 wechat_official，contentType 必须为 article；字段类型必须符合平台 schema。" : "字段类型必须符合平台 schema。";
    const second = await this.requestChat([{ role: "system", content: "只返回合法 JSON，不要解释。" }, { role: "user", content: `请修复为合法 JSON，只保留平台内容字段，不得增加事实。${repairRequirements}\n${first.content.slice(0, 16000)}` }], this.config.maxOutputTokens);
    const secondParsed = this.parseContentStudio(second.content, input, { platformKey: input.platformKey, finishReason: second.finishReason, responseLength: second.responseLength, usage: second.usage ?? first.usage, repairAttempted: true });
    if (!secondParsed.value) {
      const diagnostics = [...firstParsed.diagnostics, { phase: "repair" as const, category: "REPAIR_RETRY_FAILED" as const, platformKey: input.platformKey, repairAttempted: true }, ...secondParsed.diagnostics];
      throw new AIProviderError("AI_INVALID_OUTPUT", "AI Content Studio 输出未通过结构化校验", { structuredDiagnostics: diagnostics });
    }
    return { ...secondParsed.value, usage: second.usage ?? first.usage, durationMs: Date.now() - startedAt, structuredDiagnostics: [...firstParsed.diagnostics, { phase: "repair", category: "REPAIR_RETRY_SUCCEEDED", platformKey: input.platformKey, repairAttempted: true, finishReason: second.finishReason, responseLength: second.responseLength, tokenUsage: second.usage ?? first.usage }, ...secondParsed.diagnostics] };
  }

  private async generateStructured(input: PromptInput, prompt: string): Promise<GeneratedArticle> {
    const startedAt = Date.now();
    const system = "你必须只输出一个合法 JSON 对象，不要 Markdown 代码围栏，不要解释。字段必须是 title、body、summary、tags、seoKeywords、suggestedCoverPrompt。";
    const first = await this.requestChat([{ role: "system", content: system }, { role: "user", content: prompt }], this.config.maxOutputTokens);
    const repaired = this.parse(first.content);
    if (repaired) return { ...repaired, usage: first.usage, durationMs: Date.now() - startedAt };

    const repairPrompt = `上一次输出不是符合要求的 JSON。请修复下面的原始输出，只返回合法 JSON，不能补充新事实：\n${first.content.slice(0, 16000)}\n\n要求字段：title(string), body(string), summary(string), tags(string[]), seoKeywords(string[]), suggestedCoverPrompt(string)。`;
    const second = await this.requestChat([{ role: "system", content: system }, { role: "user", content: repairPrompt }], this.config.maxOutputTokens);
    const parsed = this.parse(second.content);
    if (!parsed) throw new AIProviderError("AI_INVALID_OUTPUT", "AI 返回内容未通过结构化校验，已完成一次修复重试");
    return { ...parsed, usage: second.usage ?? first.usage, durationMs: Date.now() - startedAt };
  }

  private parse(value: string): z.infer<typeof GeneratedArticleSchema> | null {
    try {
      const raw: unknown = JSON.parse(stripCodeFence(value));
      const parsed = GeneratedArticleSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private parseTopicPlan(value: string): ContentStudioTopicPlan | null {
    try {
      const parsed = ContentStudioTopicPlanSchema.safeParse(JSON.parse(stripCodeFence(value)));
      return parsed.success ? parsed.data as ContentStudioTopicPlan : null;
    } catch {
      return null;
    }
  }

  private parseContentStudio(value: string, input: ContentStudioPlatformInput, metadata: StructuredResponseMetadata): StructuredParseResult {
    const parsedJson = parseStructuredJson(value, metadata);
    if (parsedJson.raw === null) return { value: null, diagnostics: parsedJson.diagnostic ? [parsedJson.diagnostic] : [] };
    const strict = ContentStudioContentSchema.safeParse(parsedJson.raw);
    if (strict.success) return { value: strict.data as ContentStudioContent, diagnostics: parsedJson.diagnostic ? [parsedJson.diagnostic] : [] };
    const strictDiagnostic = schemaDiagnostic(parsedJson.raw, strict, metadata);
    const normalized = normalizeWeChatContent(parsedJson.raw, input);
    if (!normalized) return { value: null, diagnostics: [ ...(parsedJson.diagnostic ? [parsedJson.diagnostic] : []), strictDiagnostic ] };
    const normalizedResult = ContentStudioContentSchema.safeParse(normalized.value);
    if (!normalizedResult.success) return { value: null, diagnostics: [ ...(parsedJson.diagnostic ? [parsedJson.diagnostic] : []), strictDiagnostic, schemaDiagnostic(normalized.value, normalizedResult, { ...metadata, repairAttempted: metadata.repairAttempted }) ] };
    return {
      value: normalizedResult.data as ContentStudioContent,
      diagnostics: [ ...(parsedJson.diagnostic ? [parsedJson.diagnostic] : []), strictDiagnostic, { phase: "normalization", category: "NORMALIZATION_APPLIED", platformKey: input.platformKey, appliedFields: normalized.appliedFields, finishReason: metadata.finishReason, responseLength: metadata.responseLength, tokenUsage: metadata.usage, repairAttempted: metadata.repairAttempted } ]
    };
  }

  protected buildChatRequestBody(messages: ChatMessage[], maxTokens: number, options: ChatRequestOptions): Record<string, unknown> {
    return { model: this.config.model, messages, temperature: this.config.temperature, max_tokens: maxTokens, stream: false, ...(options.structuredOutput === false ? {} : { response_format: { type: "json_object" } }) };
  }

  protected async requestChat(messages: ChatMessage[], maxTokens: number, options: ChatRequestOptions = {}): Promise<{ content: string; usage?: AIUsage; finishReason: string | null; responseLength: number }> {
    const attempts = Math.max(0, Math.min(5, Math.floor(this.config.retryCount))) + 1;
    let lastError: AIProviderError = new AIProviderError("AI_TRANSPORT", "AI 请求失败", { provider: this.providerKey });
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, this.config.timeoutMs));
      try {
        const response = await fetch(endpoint(this.config.baseUrl, "chat/completions"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: buildAuthorizationHeader(this.config.apiKey) },
          body: JSON.stringify(this.buildChatRequestBody(messages, maxTokens, options)),
          signal: controller.signal
        });
        const text = await response.text();
        const parsedBody = parseJson(text);
        const requestId = responseRequestId(response.headers, parsedBody);
        if (!response.ok) {
          const code = httpErrorCode(response.status);
          throw new AIProviderError(code, `AI 请求失败（HTTP ${response.status}）`, { httpStatus: response.status, provider: this.providerKey, requestId, bodySummary: safeResponseBodySummary(text) });
        }
        const payload = parsedBody;
        if (!payload || typeof payload !== "object") throw new AIProviderError("AI_INVALID_RESPONSE", "AI 返回不是有效 JSON", { httpStatus: response.status, provider: this.providerKey, requestId, bodySummary: safeResponseBodySummary(text) });
        const data = payload as ChatResponse;
        const choice = data.choices?.[0];
        const content = contentFromResponse(choice?.message?.content);
        if (!content) throw new AIProviderError("AI_INVALID_OUTPUT", "AI 返回缺少 message.content", { httpStatus: response.status, provider: this.providerKey, requestId, bodySummary: safeResponseBodySummary(text) });
        return { content, usage: parseUsage(data.usage, this.config), finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null, responseLength: content.length };
      } catch (error) {
        lastError = isAbortError(error) ? new AIProviderError("AI_TIMEOUT", "AI 请求超时", { provider: this.providerKey }) : error instanceof AIProviderError ? error : new AIProviderError("AI_TRANSPORT", "AI network connection failed", { provider: this.providerKey });
        const retryable = lastError.retryable;
        if (!retryable || attempt === attempts - 1) throw lastError;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  thinking?: "disabled" | "enabled";
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  retryCount?: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  logger?: AIProviderLogger;
}

export class DeepSeekProvider extends OpenAICompatibleProvider {
  private readonly thinking: "disabled" | "enabled";

  constructor(config: DeepSeekConfig) {
    super({ providerKey: "deepseek", baseUrl: normalizeBaseUrl(config.baseUrl ?? "https://api.deepseek.com", { stripV1: true }), apiKey: config.apiKey.trim(), model: config.model?.trim() || "deepseek-v4-flash", temperature: config.temperature ?? 0.7, maxOutputTokens: config.maxOutputTokens ?? 3000, timeoutMs: config.timeoutMs ?? 30000, retryCount: config.retryCount ?? 3, inputCostPer1k: config.inputCostPer1k, outputCostPer1k: config.outputCostPer1k, logger: config.logger });
    this.thinking = config.thinking ?? "disabled";
    if (this.config.apiKey && !this.config.apiKey.startsWith("sk-")) throw new AIProviderError("AI_AUTH", "DeepSeek API Key 格式无效", { provider: "deepseek" });
  }

  protected override buildChatRequestBody(messages: ChatMessage[], maxTokens: number, options: ChatRequestOptions): Record<string, unknown> {
    return { ...super.buildChatRequestBody(messages, maxTokens, options), thinking: { type: this.thinking } };
  }

  override async testConnection(): Promise<AIConnectionResult> {
    const startedAt = Date.now();
    const credentialPresent = this.config.apiKey.length > 0;
    const credentialPrefixValid = this.config.apiKey.startsWith("sk-");
    const baseUrl = safeBaseUrl(this.config.baseUrl);
    const baseDiagnostic = (overrides: Partial<AIConnectionDiagnostic> = {}): AIConnectionDiagnostic => ({
      provider: "deepseek",
      operation: "test_connection",
      baseUrl,
      endpoint: "/models",
      credentialPresent,
      credentialLength: this.config.apiKey.length,
      credentialPrefixValid,
      model: this.model,
      apiAddress: "normal",
      authentication: "not_tested",
      api: "not_tested",
      modelStatus: "not_tested",
      chatCompletion: "not_tested",
      durationMs: Date.now() - startedAt,
      ...overrides
    });

    try {
      const modelsResponse = await this.requestModels();
      const availableModels = modelsResponse.models;
      const modelAvailable = availableModels.includes(this.model);
      if (!modelAvailable) {
        const diagnostic = baseDiagnostic({ api: "normal", authentication: "normal", modelStatus: "failed", availableModels, httpStatus: modelsResponse.httpStatus, requestId: modelsResponse.requestId, durationMs: Date.now() - startedAt });
        const message = `DeepSeek 连接正常，但当前模型不可用。当前配置：${this.model}；可用模型：${availableModels.length > 0 ? availableModels.join("、") : "未返回模型"}`;
        this.logDiagnostic(diagnostic, "model_unavailable");
        return { ok: false, message, diagnostic };
      }

      try {
        await this.requestChat([{ role: "user", content: "仅回复 OK" }], 16, { structuredOutput: false });
        const diagnostic = baseDiagnostic({ api: "normal", authentication: "normal", modelStatus: "normal", chatCompletion: "normal", availableModels, httpStatus: modelsResponse.httpStatus, requestId: modelsResponse.requestId, durationMs: Date.now() - startedAt });
        this.logDiagnostic(diagnostic, "success");
        return { ok: true, message: "DeepSeek 连接成功", diagnostic };
      } catch (error) {
        const mapped = DeepSeekErrorMapper.map(error);
        const providerError = error instanceof AIProviderError ? error : undefined;
        const diagnostic = baseDiagnostic({ api: "normal", authentication: "normal", modelStatus: "normal", chatCompletion: "failed", availableModels, httpStatus: providerError?.httpStatus, requestId: providerError?.requestId, errorCode: mapped.code, ...(providerError?.bodySummary ? { responseBodySummary: providerError.bodySummary } : {}), durationMs: Date.now() - startedAt });
        this.logDiagnostic(diagnostic, "chat_completion_failed");
        return { ok: false, message: mapped.message, diagnostic };
      }
    } catch (error) {
      const mapped = DeepSeekErrorMapper.map(error);
      const providerError = error instanceof AIProviderError ? error : undefined;
      const httpStatus = providerError?.httpStatus;
      const authentication = httpStatus === 401 || httpStatus === 403 ? "failed" : httpStatus === undefined ? "not_tested" : "normal";
      const diagnostic = baseDiagnostic({ api: httpStatus === undefined ? "failed" : "normal", authentication, httpStatus, requestId: providerError?.requestId, errorCode: mapped.code, ...(providerError?.bodySummary ? { responseBodySummary: providerError.bodySummary } : {}), durationMs: Date.now() - startedAt });
      this.logDiagnostic(diagnostic, "failed");
      return { ok: false, message: mapped.message, diagnostic };
    }
  }

  private async requestModels(): Promise<{ models: string[]; httpStatus: number; requestId?: string }> {
    const attempts = Math.max(0, Math.min(5, Math.floor(this.config.retryCount))) + 1;
    let lastError: AIProviderError = new AIProviderError("AI_TRANSPORT", "AI 请求失败", { provider: this.providerKey });
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, this.config.timeoutMs));
      try {
        const response = await fetch(endpoint(this.config.baseUrl, "models"), { method: "GET", headers: { Authorization: buildAuthorizationHeader(this.config.apiKey) }, signal: controller.signal });
        const text = await response.text();
        const payload = parseJson(text);
        const requestId = responseRequestId(response.headers, payload);
        if (!response.ok) {
          const code = httpErrorCode(response.status);
          throw new AIProviderError(code, `AI 请求失败（HTTP ${response.status}）`, { httpStatus: response.status, provider: this.providerKey, requestId, bodySummary: safeResponseBodySummary(text) });
        }
        if (!payload || typeof payload !== "object") throw new AIProviderError("AI_INVALID_RESPONSE", "DeepSeek /models 返回不是有效 JSON", { httpStatus: response.status, provider: this.providerKey, requestId, bodySummary: safeResponseBodySummary(text) });
        const data = payload as ModelsResponse;
        const models = Array.isArray(data.data) ? data.data.flatMap((item) => typeof item?.id === "string" ? [item.id] : []) : [];
        return { models, httpStatus: response.status, requestId };
      } catch (error) {
        lastError = isAbortError(error) ? new AIProviderError("AI_TIMEOUT", "AI 请求超时", { provider: this.providerKey }) : error instanceof AIProviderError ? error : new AIProviderError("AI_TRANSPORT", "AI network connection failed", { provider: this.providerKey });
        if (!lastError.retryable || attempt === attempts - 1) throw lastError;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  private logDiagnostic(diagnostic: AIConnectionDiagnostic, result: string): void {
    this.config.logger?.info("AI", "DEEPSEEK_CONNECTION_TEST", "DeepSeek 连接诊断", {
      provider: diagnostic.provider,
      operation: diagnostic.operation,
      baseUrl: diagnostic.baseUrl,
      endpoint: diagnostic.endpoint,
      credentialPresent: diagnostic.credentialPresent,
      credentialLength: diagnostic.credentialLength,
      credentialPrefixValid: diagnostic.credentialPrefixValid,
      model: diagnostic.model,
      httpStatus: diagnostic.httpStatus,
      durationMs: diagnostic.durationMs,
      result,
      ...(diagnostic.errorCode ? { errorCode: diagnostic.errorCode } : {}),
      ...(diagnostic.responseBodySummary ? { responseBodySummary: diagnostic.responseBodySummary } : {}),
      ...(diagnostic.requestId ? { requestId: diagnostic.requestId } : {})
    });
  }
}

export interface DeepSeekMappedError {
  code: "credential" | "balance" | "rate_limit" | "server" | "timeout" | "network" | "bad_request" | "invalid_request" | "invalid_response" | "invalid_json" | "model" | "http" | "unknown";
  message: string;
  retryable: boolean;
  httpStatus?: number;
  provider?: string;
  requestId?: string;
}

export class DeepSeekErrorMapper {
  static map(error: unknown): DeepSeekMappedError {
    const providerError = error instanceof AIProviderError ? error : undefined;
    const code = providerError?.code ?? (typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "");
    const metadata = { ...(providerError?.httpStatus === undefined ? {} : { httpStatus: providerError.httpStatus }), ...(providerError?.provider ? { provider: providerError.provider } : {}), ...(providerError?.requestId ? { requestId: providerError.requestId } : {}) };
    if (code === "AI_AUTH") return { ...metadata, code: "credential", message: "DeepSeek API Key 无效", retryable: false };
    if (code === "AI_BALANCE") return { ...metadata, code: "balance", message: "DeepSeek 账户余额不足", retryable: false };
    if (code === "AI_MODEL") return { ...metadata, code: "model", message: "DeepSeek 模型不可用", retryable: false };
    if (code === "AI_BAD_REQUEST") return { ...metadata, code: "bad_request", message: "DeepSeek 请求格式错误", retryable: false };
    if (code === "AI_INVALID_REQUEST") return { ...metadata, code: "invalid_request", message: "DeepSeek 请求参数不正确", retryable: false };
    if (code === "AI_RATE_LIMITED") return { ...metadata, code: "rate_limit", message: "DeepSeek 请求过于频繁，请稍后重试", retryable: true };
    if (code === "AI_TIMEOUT") return { ...metadata, code: "timeout", message: "DeepSeek 请求超时", retryable: true };
    if (code === "AI_SERVER") return { ...metadata, code: "server", message: "DeepSeek 服务暂时异常", retryable: true };
    if (code === "AI_INVALID_RESPONSE") return { ...metadata, code: "invalid_response", message: "DeepSeek 服务返回格式异常", retryable: false };
    if (code === "AI_INVALID_OUTPUT") return { ...metadata, code: "invalid_json", message: "DeepSeek 返回内容格式异常", retryable: false };
    if (code === "AI_TRANSPORT") return { ...metadata, code: "network", message: "网络连接失败", retryable: true };
    if (code === "AI_HTTP") return { ...metadata, code: "http", message: "DeepSeek 请求失败", retryable: false };
    return { ...metadata, code: "unknown", message: "DeepSeek 请求失败", retryable: false };
  }
}
