import { app, BrowserWindow, safeStorage } from "electron";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { openDatabase, restoreDatabaseSafely } from "@publisher/db";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";
import { registerIpc } from "./ipc";
import { createRuntimeAdapterRegistry } from "./adapter-registry";
import { operatorPublishBlockReason, productPlatform } from "../shared/product-platform-policy";
import { runDeepSeekBenchmarkMode } from "./deepseek-benchmark-mode";
import { createProcessDiagnostics } from "./process-diagnostics";
import { recordAppStartup } from "./runtime-observability";

app.setName("codex-media-publisher");
// Installed Candidate smoke must explicitly override Electron's cached userData path.
const isolatedUserData = process.env.GMP_B01_ISOLATED_USER_DATA_DIR;
if (isolatedUserData) {
  const isolatedPath = resolve(isolatedUserData);
  if (!isAbsolute(isolatedUserData) || basename(isolatedPath) !== "b01-isolated-user-data" || !existsSync(isolatedPath)
    || isolatedPath.toLowerCase() === resolve(app.getPath("userData")).toLowerCase()) {
    throw new Error("B01_ISOLATED_USER_DATA_PATH_INVALID");
  }
  app.setPath("userData", isolatedPath);
}
const processDiagnostics = createProcessDiagnostics(join(app.getPath("userData"), "production-data", "logs", "main-process-diagnostics.log"));
processDiagnostics.installProcessHandlers();

let scheduler: PersistentScheduler | null = null;
const ownedBrowserSessionClosers = new Set<() => Promise<void>>();
let shutdownStarted = false;
let shutdownReady = false;

export function isDevelopmentEnvironment(appIsPackaged: boolean, publisherEnv = process.env.PUBLISHER_ENV): boolean { return !appIsPackaged && publisherEnv !== "production"; }

function firstExisting(paths: string[]): string {
  const found = paths.find((path) => existsSync(path));
  if (!found) throw new Error(`Required application resource not found: ${paths.join(", ")}`);
  return found;
}

async function createWindow(): Promise<void> {
  if (process.env.DOUYIN_R1_14_READONLY_JOB_ID?.trim()
    && (!process.env.DOUYIN_R1_ACCEPTANCE_ACCOUNT_ID?.trim()
      || !process.env.DOUYIN_R1_ACCEPTANCE_ARTICLE_ID?.trim()
      || process.env.DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED === "true"))
    throw new Error("DOUYIN_R14_READONLY_RUNTIME_BINDING_INVALID");
  const migrationsDir = firstExisting([join(app.getAppPath(), "packages", "db", "migrations"), join(process.resourcesPath, "packages", "db", "migrations"), join(process.cwd(), "packages", "db", "migrations"), join(__dirname, "../../packages/db/migrations")]);
  const csvPath = firstExisting([join(app.getAppPath(), "PLATFORMS.csv"), join(process.resourcesPath, "PLATFORMS.csv"), join(process.cwd(), "PLATFORMS.csv")]);
  const dataDirectory = join(app.getPath("userData"), app.isPackaged || process.env.PUBLISHER_DATA_MODE === "production" ? "production-data" : "development-data");
  const databasePath = join(dataDirectory, "publisher.db");
  const database = openDatabase(databasePath, migrationsDir);
  const isDevelopment = isDevelopmentEnvironment(app.isPackaged);
  if (isDevelopment) database.repository.seedDevelopment(csvPath);
  else database.repository.seedPlatformCatalog(csvPath);
  const appLogPath = join(dataDirectory, "logs", "app.log");
  const logger = createFileLogger(appLogPath);
  recordAppStartup(logger, { pid: process.pid, packaged: app.isPackaged, userDataPath: app.getPath("userData"), productionDataPath: dataDirectory, appLogPath });
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const b01Authorization = database.repository.getB01Authorization();
  const registry = createRuntimeAdapterRegistry(credentials, isDevelopment, logger, join(app.getPath("userData"), "browser-profiles"), join(dataDirectory, "credentials.enc"), {
    claimDouyinImageTextFileSelection: (input) => database.repository.claimDouyinImageTextFileSelection(input),
    douyinImageTextNativeSubmitEnabled: Boolean(b01Authorization && !["Revoked", "Consumed"].includes(b01Authorization.status)
      && Date.parse(b01Authorization.expiresAt) > Date.now())
  });
  ownedBrowserSessionClosers.add(async () => {
    const closableAdapters = registry.listAll().filter((adapter): adapter is typeof adapter & { closeOwnedSessions(): Promise<void> } => typeof (adapter as { closeOwnedSessions?: unknown }).closeOwnedSessions === "function");
    await Promise.allSettled(closableAdapters.map((adapter) => adapter.closeOwnedSessions()));
  });
  database.repository.syncAdapterManifests(registry.list().map((adapter) => ({ manifest: adapter.manifest, capabilities: adapter.getCapabilities() })));
  database.repository.reconcileAdapterRegistrations(registry.list().map((adapter) => adapter.platformKey));
  const resolveAccountSecrets = (accountId: string, platformKey: string): Record<string, string> => {
    const adapter = registry.get(platformKey);
    const keys = [...new Set([...adapter.getCredentialSchema().map((field) => field.key), "oauthAccessToken"])]
    return Object.fromEntries(keys.map((key) => [key, credentials.get(`account:${accountId}:${platformKey}:${key}`) ?? ""]));
  };
  const publisher = new PublisherService(database.repository, registry, logger, { resolveSecrets: resolveAccountSecrets, enforceB01ForDouyin: true });
  scheduler = new PersistentScheduler(database.repository, publisher, logger, 5_000, {
    allowScheduledJob: (job) => productPlatform(job.platformKey)?.batchPublishEnabled === true
      && operatorPublishBlockReason(job.platformKey, database.repository.listPlatforms().find((platform) => platform.platformKey === job.platformKey)) === null
  });
  registerIpc({ repository: database.repository, publisher, scheduler, registry, resolveAccountSecrets, dataDirectory, coverDir: join(dataDirectory, "covers"), logger, credentials, aiCredentials: credentials, appLogPath, databasePath, processDiagnostics, restoreDatabase: (backupPath) => { scheduler?.stop(); restoreDatabaseSafely(database.db, databasePath, backupPath); app.relaunch(); app.exit(0); } });
  // The one-shot diagnostic process owns the sole publish lane; existing queued jobs remain untouched.
  if (process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true" && process.env.TOUTIAO_READONLY_PREFLIGHT !== "true"
    && !process.env.TOUTIAO_NATIVE_ACCEPTANCE_ACCOUNT_ID?.trim()
    && !process.env.DOUYIN_R1_ACCEPTANCE_ACCOUNT_ID?.trim()
    && !process.env.DOUYIN_R1_14_READONLY_JOB_ID?.trim()) scheduler.start();

  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f4f6f9",
    webPreferences: { preload: join(__dirname, "../preload/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(join(__dirname, "../renderer/index.html"));
}

if (process.env.PUBLISHER_BENCHMARK_MODE === "deepseek") {
  void app.whenReady().then(runDeepSeekBenchmarkMode).catch((error: unknown) => {
    processDiagnostics.record("DEEPSEEK_BENCHMARK_FAILED", { error });
    app.quit();
  }).finally(() => app.quit());
} else {
  void app.whenReady().then(async () => {
    await createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  }).catch((error: unknown) => {
    processDiagnostics.record("APP_START_FAILED", { error });
    app.quit();
  });
}

app.on("before-quit", (event) => {
  scheduler?.stop();
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void Promise.allSettled([...ownedBrowserSessionClosers].map((close) => close())).finally(() => {
    shutdownReady = true;
    app.quit();
  });
});

app.on("window-all-closed", () => { scheduler?.stop(); if (process.platform !== "darwin") app.quit(); });
