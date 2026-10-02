export type ProviderKey = "mimo" | "openai" | "deepseek" | "ollama" | "custom";
export type CredentialRef = string;
export interface ProviderDefinition { key: ProviderKey; displayName: string; baseUrl: string; needsCredential: boolean; supportsModelList: boolean; presets: string[]; contractStatus: "VERIFIED"; source: string }
export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  { key: "mimo", displayName: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/v1", needsCredential: true, supportsModelList: false, presets: ["mimo-v2.6-pro"], contractStatus: "VERIFIED", source: "https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call" },
  { key: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1", needsCredential: true, supportsModelList: true, presets: [], contractStatus: "VERIFIED", source: "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create" },
  { key: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com", needsCredential: true, supportsModelList: true, presets: ["deepseek-flash", "deepseek-v4-pro"], contractStatus: "VERIFIED", source: "https://api-docs.deepseek.com/" },
  { key: "ollama", displayName: "Ollama", baseUrl: "http://127.0.0.1:11434", needsCredential: false, supportsModelList: true, presets: [], contractStatus: "VERIFIED", source: "https://docs.ollama.com/api/chat" },
  { key: "custom", displayName: "Custom OpenAI-Compatible", baseUrl: "https://example.invalid/v1", needsCredential: true, supportsModelList: true, presets: [], contractStatus: "VERIFIED", source: "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create" }
];
export interface ProviderConfig { provider: ProviderKey; baseUrl: string; defaultModel: string; timeoutMs?: number; maxOutputTokens?: number }
export interface ModelDescriptor { id: string; displayName: string }
export interface GenerationRequest { signal?: AbortSignal; model: string; systemPrompt: string; userPrompt: string }
export interface GenerationResult { text: string; model: string; tokenUsage?: { input: number; output: number }; durationMs: number }
export class TextProviderError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus?: number) { super(message); this.name = "TextProviderError"; }
}
export function validateProviderConfig(config: ProviderConfig): void {
  const definition = PROVIDER_DEFINITIONS.find((item) => item.key === config.provider);
  if (!definition) throw new TextProviderError("PROVIDER_INVALID", "服务商不受支持");
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { throw new TextProviderError("BASE_URL_INVALID", "API 地址无效"); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new TextProviderError("BASE_URL_INVALID", "API 地址须为 HTTPS，本机服务可用 HTTP，地址中不能含凭据或查询参数");
  if (config.provider === "ollama" && !local) throw new TextProviderError("BASE_URL_INVALID", "Ollama 本轮仅支持本机服务");
  const hosts: Partial<Record<ProviderKey, readonly string[]>> = { openai: ["api.openai.com"], deepseek: ["api.deepseek.com"], mimo: ["api.xiaomimimo.com", "token-plan-cn.xiaomimimo.com"] };
  if (hosts[config.provider] && !hosts[config.provider]!.includes(url.hostname)) throw new TextProviderError("BASE_URL_INVALID", "该服务商 API 地址不匹配；其它兼容服务请选择 Custom");
  if (!config.defaultModel.trim() || config.defaultModel.length > 200) throw new TextProviderError("MODEL_REQUIRED", "请填写模型 ID");
}
export class TextProviderClient {
  private readonly base: string;
  constructor(private readonly config: ProviderConfig, private readonly secret: string | null, private readonly fetchPort: typeof fetch = fetch) {
    validateProviderConfig(config);
    this.base = config.baseUrl.replace(/\/+$/u, "");
  }
  private async request(path: string, body?: unknown, signal?:AbortSignal): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.provider !== "ollama") {
      if (!this.secret?.trim()) throw new TextProviderError("KEY_NOT_CONFIGURED", "API Key 尚未配置");
      headers[this.config.provider === "mimo" ? "api-key" : "Authorization"] = this.config.provider === "mimo" ? this.secret.trim() : `Bearer ${this.secret.trim()}`;
    }
    if(signal?.aborted)throw new TextProviderError("AI_CANCELED","请求尚未发出，已取消");
    const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(this.config.timeoutMs??30000)]):AbortSignal.timeout(this.config.timeoutMs??30000);
    let response: Response;
    try { response = await this.fetchPort(`${this.base}${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: requestSignal }); }
    catch { throw new TextProviderError("TRANSPORT_UNKNOWN", "连接暂时不可用或请求超时，生成结果无法确认；请检查连接后自行决定是否重新生成"); }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "AUTH_INVALID" : response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "SERVICE_UNAVAILABLE" : "REQUEST_REJECTED";
      const message = code === "AUTH_INVALID" ? "授权已失效，请更新 API Key" : code === "RATE_LIMITED" ? "服务限流，请稍后再试" : code === "SERVICE_UNAVAILABLE" ? "AI 服务暂时不可用" : "AI 服务拒绝了请求，请核对模型和配置";
      throw new TextProviderError(code, message, response.status);
    }
    let data: unknown;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const decoder = new TextDecoder(); let bytes = 0, text = "";
      try {
        while (true) {
          const chunk = await reader.read().catch(()=>{throw new TextProviderError("TRANSPORT_UNKNOWN","生成响应在读取期间中断；结果无法确认，请人工核对后决定");});
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2_000_000) { await reader.cancel(); throw new Error(); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode(); data = JSON.parse(text);
      } finally { reader.releaseLock(); }
    }
    catch(error) { if(error instanceof TextProviderError)throw error; if(requestSignal.aborted)throw new TextProviderError("TRANSPORT_UNKNOWN","请求已发出，结果无法确认"); throw new TextProviderError("RESPONSE_INVALID", "AI 服务返回了无法读取的结果"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new TextProviderError("RESPONSE_INVALID", "AI 服务结果格式无效");
    return data as Record<string, unknown>;
  }
  async listModels(): Promise<ModelDescriptor[]> {
    const definition = PROVIDER_DEFINITIONS.find((item) => item.key === this.config.provider)!;
    if (!definition.supportsModelList) return definition.presets.map((id) => ({ id, displayName: id }));
    const data = await this.request(this.config.provider === "ollama" ? "/api/tags" : "/models");
    const rows = this.config.provider === "ollama" ? data.models : data.data;
    if (!Array.isArray(rows)) throw new TextProviderError("MODEL_LIST_INVALID", "无法读取模型列表；可以手工填写模型 ID");
    return rows.slice(0, 1000).flatMap((row: unknown) => {
      if (!row || typeof row !== "object") return [];
      const entry = row as Record<string, unknown>, id = this.config.provider === "ollama" ? entry.name : entry.id;
      return typeof id === "string" && id.trim() && id.length <= 200 ? [{ id, displayName: typeof entry.name === "string" ? entry.name : id }] : [];
    });
  }
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.config.provider === "mimo") {
      await this.generateText({ model: this.config.defaultModel, systemPrompt: "Reply briefly.", userPrompt: "Reply OK." });
      return { ok: true, message: "模型连接已验证（一次最小文本请求）" };
    }
    const models = await this.listModels();
    if (this.config.provider === "ollama" && models.length === 0) return { ok: false, message: "本机 Ollama 正在运行，但没有已安装模型" };
    return { ok: true, message: "连接和模型列表已验证；生成能力以实际请求为准" };
  }
  async generateText(input: GenerationRequest): Promise<GenerationResult> {
    if (!input.model.trim()) throw new TextProviderError("MODEL_REQUIRED", "请填写模型 ID");
    const started = Date.now(), native = this.config.provider === "ollama";
    const tokens = this.config.maxOutputTokens ?? 3000;
    const body = { model: input.model, messages: [{ role: "system", content: input.systemPrompt }, { role: "user", content: input.userPrompt }], stream: false,
      ...(native ? { options: { num_predict: tokens } } : this.config.provider === "mimo" || this.config.provider === "openai" ? { max_completion_tokens: tokens } : { max_tokens: tokens }) };
    const data = await this.request(native ? "/api/chat" : "/chat/completions", body, input.signal);
    const message = native ? data.message : Array.isArray(data.choices) ? (data.choices[0] as { message?: unknown })?.message : null;
    const text = message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
    if (typeof text !== "string" || !text.trim()) throw new TextProviderError("EMPTY_OUTPUT", "AI 返回空内容，请检查模型和输入");
    if (native && data.done !== true) throw new TextProviderError("OUTPUT_INCOMPLETE", "本机模型输出未完成");
    const finishReason = native ? data.done_reason : (data.choices as Array<{ finish_reason?: string }> | undefined)?.[0]?.finish_reason;
    if ((!native || finishReason !== undefined) && !["stop", "eos"].includes(String(finishReason))) throw new TextProviderError("OUTPUT_INCOMPLETE", "模型输出未完成或被过滤，请检查模型和输出长度设置");
    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return { text, model: input.model, durationMs: Date.now() - started, tokenUsage: usage ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 } : native ? { input: Number(data.prompt_eval_count ?? 0), output: Number(data.eval_count ?? 0) } : undefined };
  }
}
export function createTextProvider(config: ProviderConfig, secret: string | null, fetchPort: typeof fetch = fetch): TextProviderClient { return new TextProviderClient(config, secret, fetchPort); }
