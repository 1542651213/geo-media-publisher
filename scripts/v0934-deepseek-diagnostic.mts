import { app, safeStorage } from "electron";
import { join } from "node:path";
import { DeepSeekProvider } from "@publisher/ai";
import { openDatabase } from "@publisher/db";
import { SafeStorageCredentialStore } from "@publisher/security";

app.setName("codex-media-publisher");

async function main(): Promise<void> {
  await app.whenReady();
  const dataDirectory = join(app.getPath("userData"), "production-data");
  const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  try {
    const settings = opened.repository.getSettings();
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const apiKey = credentials.get("ai:apiKey");
    if (!apiKey) throw new Error("DeepSeek secure credential is not configured");
    const config = {
      provider: "deepseek",
      model: typeof settings.deepseekModel === "string" ? settings.deepseekModel : "deepseek-v4-flash",
      baseUrl: typeof settings.deepseekBaseUrl === "string" ? settings.deepseekBaseUrl : "https://api.deepseek.com",
      maxOutputTokens: typeof settings.maxOutputTokens === "number" ? settings.maxOutputTokens : 3000,
      temperature: typeof settings.temperature === "number" ? settings.temperature : 0.7,
      retryCount: typeof settings.retry === "number" ? settings.retry : 3,
      generationMode: settings.deepseekGenerationMode === "quality" ? "quality" : "economy"
    } as const;
    const provider = new DeepSeekProvider({ apiKey, baseUrl: config.baseUrl, model: config.model, thinking: config.generationMode === "quality" ? "enabled" : "disabled", temperature: config.temperature, maxOutputTokens: config.maxOutputTokens, timeoutMs: typeof settings.timeout === "number" ? settings.timeout : 30000, retryCount: config.retryCount });
    const result = await provider.testConnection();
    console.log(JSON.stringify({ config, result: { ok: result.ok, message: result.message, diagnostic: result.diagnostic ? { provider: result.diagnostic.provider, model: result.diagnostic.model, httpStatus: result.diagnostic.httpStatus, requestId: result.diagnostic.requestId, errorCode: result.diagnostic.errorCode, responseBodySummary: result.diagnostic.responseBodySummary, api: result.diagnostic.api, authentication: result.diagnostic.authentication, modelStatus: result.diagnostic.modelStatus, chatCompletion: result.diagnostic.chatCompletion, availableModels: result.diagnostic.availableModels } : null } }, null, 2));
  } finally {
    opened.db.close();
  }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "DeepSeek diagnostic failed"); process.exitCode = 1; }).finally(() => { app.quit(); });
