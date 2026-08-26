import { app, safeStorage } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { DeepSeekProvider } from "@publisher/ai";
import { openDatabase } from "@publisher/db";
import { CredentialDecryptError, SafeStorageCredentialStore } from "@publisher/security";
import type { Logger } from "@publisher/logger";
import { BENCHMARK_BUSINESSES, BENCHMARK_CITIES, BENCHMARK_ID, BENCHMARK_PLATFORMS, BENCHMARK_PROMPT_VERSION, BENCHMARK_TOPICS, DATASET_VERSION, assertFrozenBenchmarkDataset } from "../../../../scripts/v092-benchmark-dataset";
import { runQualityBenchmark } from "./quality-benchmark";

const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function readSetting(source: Database.Database, key: string, fallback: unknown): unknown {
  try {
    const row = source.prepare("SELECT value_json FROM app_settings WHERE key=?").get(key) as { value_json?: unknown } | undefined;
    if (typeof row?.value_json !== "string") return fallback;
    return JSON.parse(row.value_json) as unknown;
  } catch {
    return fallback;
  }
}

function readString(source: Database.Database, key: string, fallback: string): string { const value = readSetting(source, key, fallback); return typeof value === "string" ? value : fallback; }
function readNumber(source: Database.Database, key: string, fallback: number): number { const value = readSetting(source, key, fallback); return typeof value === "number" ? value : fallback; }

export async function runDeepSeekBenchmarkMode(): Promise<void> {
  let opened: ReturnType<typeof openDatabase> | null = null;
  let credentialRefForReport = "ai:apiKey";
  let credentialStatus = "NotConfigured";
  try {
    assertFrozenBenchmarkDataset();
    const dataDirectory = [join(app.getPath("userData"), "production-data"), join(process.env.APPDATA ?? "", "codex-media-publisher", "production-data")].find((path) => existsSync(join(path, "credentials.enc")) && existsSync(join(path, "publisher.db")));
    if (!dataDirectory) throw new Error("DeepSeek secure data directory is not available");
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const migrationsDir = [join(app.getAppPath(), "packages", "db", "migrations"), join(process.cwd(), "packages", "db", "migrations")].find((path) => existsSync(path));
    const platformsCsv = [join(app.getAppPath(), "PLATFORMS.csv"), join(process.cwd(), "PLATFORMS.csv")].find((path) => existsSync(path));
    if (!migrationsDir || !platformsCsv) throw new Error("Benchmark resources are not available");
    opened = openDatabase(join(dataDirectory, "publisher.db"), migrationsDir);
    opened.repository.seedPlatformCatalog(platformsCsv);
    const source = opened.db;
    const profile = source.prepare("SELECT base_url,model,credential_ref,temperature,max_output_tokens,timeout_ms,retry_count FROM ai_provider_profiles WHERE provider='deepseek' AND enabled=1 ORDER BY is_default DESC LIMIT 1").get() as { base_url?: string; model?: string; credential_ref?: string; temperature?: number; max_output_tokens?: number; timeout_ms?: number; retry_count?: number } | undefined;
    credentialRefForReport = profile?.credential_ref || "ai:apiKey";
    credentialStatus = credentials.getStatus?.(credentialRefForReport) ?? (credentials.has(credentialRefForReport) ? "Configured" : "NotConfigured");
    const apiKey = credentials.get(credentialRefForReport);
    if (!apiKey) throw new Error("DeepSeek safeStorage credential is not configured");
    const provider = new DeepSeekProvider({ apiKey, baseUrl: profile?.base_url || readString(source, "deepseekBaseUrl", "https://api.deepseek.com"), model: profile?.model || readString(source, "deepseekModel", "deepseek-v4-flash"), thinking: readString(source, "deepseekGenerationMode", "economy") === "quality" ? "enabled" : "disabled", temperature: profile?.temperature ?? readNumber(source, "temperature", 0.7), maxOutputTokens: profile?.max_output_tokens ?? readNumber(source, "maxOutputTokens", 3000), timeoutMs: profile?.timeout_ms ?? readNumber(source, "timeout", 30000), retryCount: profile?.retry_count ?? readNumber(source, "retry", 3), inputCostPer1k: readNumber(source, "deepseekInputCostPer1k", 0), outputCostPer1k: readNumber(source, "deepseekOutputCostPer1k", 0) });
    const brand = opened.repository.createBrand({ name: "康一环保测试资料", companyName: "江苏康一环保科技有限公司", description: "提供甲醛治理、定期消杀、灭四害、白蚁防治、病媒生物防制等环境治理服务；具体服务范围、方案、效果和交付边界以双方确认资料为准。", mainBusiness: BENCHMARK_BUSINESSES.join("、"), serviceRegions: [...BENCHMARK_CITIES], advantages: ["服务范围以企业资料为准", "流程与边界可在沟通时确认"], serviceProcess: "需求沟通、现场情况评估、方案与报价确认、服务实施、结果复核与售后沟通；具体以双方确认的服务约定为准。", afterSales: "是否复检、整改或返工，以合同和现场情况为准。", faq: "服务前可准备房屋或场所类型、面积、问题表现和期望时间。", certificates: "", patents: "", cases: "", aiForbiddenClaims: ["国家级认证", "不存在的资质", "不存在的证书", "不存在的专利", "行业第一", "最好", "100%清除甲醛", "绝对", "唯一", "保证", "永久", "永不反弹", "一次治理永久有效"] });
    opened.repository.expandContentStudioKeywords({ brandId: brand.id, cities: [...BENCHMARK_CITIES], keywords: [...BENCHMARK_BUSINESSES], industry: "环保服务" });
    const result = await runQualityBenchmark(opened.repository, silentLogger, { createAiProvider: () => provider }, { brandId: brand.id, benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, promptVersion: BENCHMARK_PROMPT_VERSION, runType: "DEEPSEEK_REAL", providerHint: provider.providerKey, modelHint: provider.model, benchmarkRunId: process.env.PUBLISHER_BENCHMARK_RUN_ID?.trim() || undefined, temperature: profile?.temperature ?? readNumber(source, "temperature", 0.7), maxTokens: profile?.max_output_tokens ?? readNumber(source, "maxOutputTokens", 3000), topics: BENCHMARK_TOPICS, platforms: BENCHMARK_PLATFORMS, concurrency: 3, retryFailed: true });
    const reviewSample = null;
    const finalMetrics = opened.repository.getQualityBenchmarkMetrics(result.run.benchmarkRunId);
    const generationCompleted = result.run.status === "COMPLETED" && result.run.successCount === BENCHMARK_TOPICS.length * BENCHMARK_PLATFORMS.length && result.run.failureCount === 0;
    process.stdout.write(JSON.stringify({ deepseekCalled: result.run.successCount > 0 || result.run.failureCount > 0, credentialStatus: "Validated", generationEvent: generationCompleted ? "DEEPSEEK_BENCHMARK_GENERATION_COMPLETED" : null, run: result.run, initialMetrics: result.metrics, finalMetrics, reviewSample }) + "\n");
  } catch (error) {
    if (error instanceof CredentialDecryptError) credentialStatus = "DecryptFailed";
    process.stdout.write(JSON.stringify({ deepseekCalled: false, status: "BLOCKED", credentialRef: credentialRefForReport, credentialStatus, reason: error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9._-]+/gu, "[REDACTED]").slice(0, 300) : "DeepSeek benchmark blocked" }) + "\n");
  } finally {
    opened?.db.close();
  }
}
