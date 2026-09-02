import { app, BrowserWindow, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID } from "@publisher/domain";
import type { XiaohongshuCanonicalPageRuntimeProbe } from "@publisher/adapters-xiaohongshu/browser";
import { openDatabase, restoreDatabaseSafely } from "@publisher/db";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";
import { registerIpc } from "./ipc";
import { createRuntimeAdapterRegistry } from "./adapter-registry";
import { runDeepSeekBenchmarkMode } from "./deepseek-benchmark-mode";
import { createProcessDiagnostics } from "./process-diagnostics";
import { recordAppStartup } from "./runtime-observability";
import { createFixedDiagnosticRunner, parseDiagnosticAction, type DiagnosticAction, PROBE_XHS_CANONICAL_PAGE } from "./diagnostic-trigger";

app.setName("codex-media-publisher");
const processDiagnostics = createProcessDiagnostics(join(app.getPath("userData"), "production-data", "logs", "main-process-diagnostics.log"));
processDiagnostics.installProcessHandlers();

let scheduler: PersistentScheduler | null = null;
const ownedBrowserSessionClosers = new Set<() => Promise<void>>();
let shutdownStarted = false;
let shutdownReady = false;
const initialDiagnosticAction = parseDiagnosticAction(process.argv);
const primaryInstanceLockAcquired = app.requestSingleInstanceLock(initialDiagnosticAction ? { action: initialDiagnosticAction } : undefined);
let queuedDiagnosticAction: DiagnosticAction | null = initialDiagnosticAction;
let fixedDiagnosticActionRunner: ((action: DiagnosticAction) => Promise<boolean>) | null = null;
let diagnosticRunInFlight: Promise<boolean> | null = null;

export function isDevelopmentEnvironment(appIsPackaged: boolean, publisherEnv = process.env.PUBLISHER_ENV): boolean { return !appIsPackaged && publisherEnv !== "production"; }

function firstExisting(paths: string[]): string {
  const found = paths.find((path) => existsSync(path));
  if (!found) throw new Error(`Required application resource not found: ${paths.join(", ")}`);
  return found;
}

function safeUrlPart(value: string | null, part: "origin" | "pathname"): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.toString() === "about:blank" ? "about:blank" : parsed[part];
  }
  catch { return null; }
}

function hashFile(path: string): string | null {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase(); }
  catch { return null; }
}

function buildTask10wLiveProbeEvidence(input: {
  probe: XiaohongshuCanonicalPageRuntimeProbe;
  timestamp: string;
  evidencePath: string;
  installedAppAsarSha256: string | null;
  expectedCreatorId: string | null;
  expectedCreatorIdProvenance: string;
}): Record<string, unknown> {
  const { probe } = input;
  const browserSessionExists = Boolean(probe.canonicalContextId || probe.canonicalPageId);
  const canonicalContextExists = Boolean(probe.canonicalContextId);
  const canonicalPageExists = Boolean(probe.canonicalPageId) && !probe.pageClosed;
  const contextCorrelation = !canonicalContextExists && !probe.probedContextId ? "NOT_RUN" : probe.pageContextMatchesSession ? "PASS" : "FAIL";
  const pageCorrelation = !probe.canonicalPageId && !probe.probedPageId ? "NOT_RUN" : probe.canonicalPageId === probe.probedPageId ? "PASS" : "FAIL";
  const pageUrlCallStatus = probe.failureStage === "PLAYWRIGHT_URL" ? "FAIL" : probe.playwrightPageUrl ? "PASS" : "NOT_RUN";
  const creatorIdMatch = input.expectedCreatorId && probe.observedCreatorIdNormalized
    ? input.expectedCreatorId === probe.observedCreatorIdNormalized ? "YES" : "NO"
    : "NOT_RUN";
  const stableIdentityCandidate = probe.identitySourceCandidates.some((candidate) => candidate.stableIdentifierPresent && candidate.readOnlySafe && !candidate.sensitiveDataRequired);
  const accountIdentityVerified = probe.probeStatus === "PASS"
    && probe.domLocationEvaluateStatus === "PASS"
    && probe.pageUrlConsistency === "PASS"
    && contextCorrelation === "PASS"
    && pageCorrelation === "PASS"
    && creatorIdMatch === "YES"
    && stableIdentityCandidate
    && probe.runtimeAuthState === "AUTHENTICATED"
    && probe.browserConnected
    && !probe.pageClosed;
  return {
    timestamp: input.timestamp,
    sourceCommit: process.env.PUBLISHER_SOURCE_COMMIT ?? null,
    installedAppAsarSha256: input.installedAppAsarSha256,
    evidencePath: input.evidencePath,
    probeTriggerReceived: "YES",
    probeEventCount: 1,
    action: PROBE_XHS_CANONICAL_PAGE,
    browserSessionExists,
    browserSessionConnected: probe.browserConnected,
    canonicalContextExists,
    canonicalPageExists,
    canonicalPageClosed: probe.pageClosed,
    canonicalContextId: probe.canonicalContextId,
    canonicalPageId: probe.canonicalPageId,
    probedContextId: probe.probedContextId,
    probedPageId: probe.probedPageId,
    pageUrlCallStatus,
    pageUrl: probe.playwrightPageUrl,
    domLocationEvaluateStatus: probe.domLocationEvaluateStatus,
    domLocationHref: probe.domLocationHref,
    evaluateFailureStage: probe.failureStage === "DOM_LOCATION_EVALUATE" ? probe.failureStage : null,
    evaluateErrorCategory: probe.domLocationEvaluateErrorClass,
    evaluateErrorMessageSafe: null,
    pageUrlOrigin: safeUrlPart(probe.playwrightPageUrl, "origin"),
    domUrlOrigin: safeUrlPart(probe.domLocationHref, "origin"),
    pageUrlPathname: safeUrlPart(probe.playwrightPageUrl, "pathname"),
    domUrlPathname: safeUrlPart(probe.domLocationHref, "pathname"),
    pageUrlConsistency: probe.pageUrlConsistency,
    contextCorrelation,
    pageCorrelation,
    expectedCreatorId: input.expectedCreatorId,
    expectedCreatorIdProvenance: input.expectedCreatorIdProvenance,
    identityCandidates: probe.identitySourceCandidates,
    observedCreatorIdRaw: probe.observedCreatorIdRaw,
    observedCreatorIdNormalized: probe.observedCreatorIdNormalized,
    creatorIdMatch,
    accountIdentityVerified: accountIdentityVerified ? "YES" : "NO",
    probeStatus: probe.probeStatus,
    failureStage: probe.failureStage,
    failureCode: probe.failureCode,
    failureErrorClass: probe.failureErrorClass,
    routeClass: probe.routeClass,
    runtimeAuthState: probe.runtimeAuthState,
    identityObservationStatus: probe.identityObservationStatus,
    createdNewPage: probe.createdNewPage,
    pageContextMatchesSession: probe.pageContextMatchesSession,
    ownerLoginRequired: canonicalPageExists ? "NO" : "YES",
    liveCanonicalProbe: canonicalPageExists ? "EXECUTED" : "BLOCKED_NO_CANONICAL_PAGE"
  };
}

async function createWindow(): Promise<void> {
  const migrationsDir = firstExisting([join(app.getAppPath(), "packages", "db", "migrations"), join(process.resourcesPath, "packages", "db", "migrations"), join(process.cwd(), "packages", "db", "migrations"), join(__dirname, "../../packages/db/migrations")]);
  const csvPath = firstExisting([join(app.getAppPath(), "PLATFORMS.csv"), join(process.resourcesPath, "PLATFORMS.csv"), join(process.cwd(), "PLATFORMS.csv")]);
  const dataDirectory = join(app.getPath("userData"), app.isPackaged || process.env.PUBLISHER_DATA_MODE === "production" ? "production-data" : "development-data");
  const databasePath = join(dataDirectory, "publisher.db");
  const appLogPath = join(dataDirectory, "logs", "app.log");
  const logger = createFileLogger(appLogPath);
  const database = openDatabase(databasePath, migrationsDir, (event) => logger.info("DATABASE", event.code, "数据库迁移生命周期事件", { migrationId: event.migrationId, discoveredMigrationCount: event.discoveredMigrationCount, appliedMigrationCount: event.appliedMigrationCount, latestMigrationId: event.latestMigrationId, productionSchemaVersion: event.productionSchemaVersion, authTablePresent: event.authTablePresent }));
  const isDevelopment = isDevelopmentEnvironment(app.isPackaged);
  if (isDevelopment) database.repository.seedDevelopment(csvPath);
  else database.repository.seedPlatformCatalog(csvPath);
  recordAppStartup(logger, { pid: process.pid, packaged: app.isPackaged, userDataPath: app.getPath("userData"), productionDataPath: dataDirectory, appLogPath });
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const registry = createRuntimeAdapterRegistry(credentials, isDevelopment, logger, join(app.getPath("userData"), "browser-profiles"), join(dataDirectory, "credentials.enc"));
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
  const publisher = new PublisherService(database.repository, registry, logger, { resolveSecrets: resolveAccountSecrets });
  scheduler = new PersistentScheduler(database.repository, publisher, logger);
  const platformSelfTests = registerIpc({ repository: database.repository, publisher, scheduler, registry, resolveAccountSecrets, dataDirectory, coverDir: join(dataDirectory, "covers"), logger, credentials, aiCredentials: credentials, appLogPath, databasePath, processDiagnostics, restoreDatabase: (backupPath) => { scheduler?.stop(); restoreDatabaseSafely(database.db, databasePath, backupPath); app.relaunch(); app.exit(0); } });
  const targetAccount = database.repository.getAccountById(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, "xiaohongshu");
  const targetBinding = targetAccount ? database.repository.getPlatformAccountIdentityBinding("xiaohongshu", targetAccount.id) : null;
  const expectedCreatorId = targetBinding?.externalCreatorId ?? targetAccount?.externalAccountId ?? null;
  const expectedCreatorIdProvenance = targetBinding?.externalCreatorId
    ? "platform_account_identity_bindings.external_creator_id"
    : targetAccount?.externalAccountId
      ? "accounts.external_account_id"
      : "missing";
  const evidenceDirectory = join(dataDirectory, "evidence");
  const evidencePath = join(evidenceDirectory, "xiaohongshu-task10w-live-probe-r3-20260902.json");
  const installedAppAsarSha256 = app.isPackaged ? hashFile(join(process.resourcesPath, "app.asar")) : null;
  const writeProbeEvidence = (probe: XiaohongshuCanonicalPageRuntimeProbe): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const evidence = buildTask10wLiveProbeEvidence({ probe, timestamp: new Date().toISOString(), evidencePath, installedAppAsarSha256, expectedCreatorId, expectedCreatorIdProvenance });
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_CANONICAL_PAGE_RUNTIME_PROBE_EVIDENCE_WRITTEN", "小红书 canonical Page runtime probe evidence 已写入", { action: PROBE_XHS_CANONICAL_PAGE, evidencePath, probeEventCount: 1, accountIdentityVerified: evidence.accountIdentityVerified, liveCanonicalProbe: evidence.liveCanonicalProbe });
  };
  fixedDiagnosticActionRunner = createFixedDiagnosticRunner({
    probe: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_CANONICAL_PAGE_RUNTIME_PROBE_TRIGGER_RECEIVED", "收到固定非 UI 小红书 canonical Page probe trigger", { action: PROBE_XHS_CANONICAL_PAGE, accountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID });
      return platformSelfTests.inspectCanonicalXhsPageRuntime(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID);
    },
    writeEvidence: writeProbeEvidence
  });
  const pendingDiagnosticAction = queuedDiagnosticAction;
  queuedDiagnosticAction = null;
  if (pendingDiagnosticAction) void runFixedDiagnosticAction(pendingDiagnosticAction);
  scheduler.start();

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

function runFixedDiagnosticAction(action: DiagnosticAction): Promise<boolean> {
  if (!fixedDiagnosticActionRunner) return Promise.resolve(false);
  if (diagnosticRunInFlight) return diagnosticRunInFlight;
  diagnosticRunInFlight = fixedDiagnosticActionRunner(action).catch((error: unknown) => {
    processDiagnostics.record("TASK10W_FIXED_DIAGNOSTIC_FAILED", { action, errorType: error instanceof Error ? error.name : "UnknownError" });
    return false;
  }).finally(() => { diagnosticRunInFlight = null; });
  return diagnosticRunInFlight;
}

if (primaryInstanceLockAcquired) {
  app.on("second-instance", (_event, commandLine, _workingDirectory, additionalData) => {
    const action = parseDiagnosticAction(commandLine, additionalData);
    if (!action) return;
    processDiagnostics.record("TASK10W_FIXED_DIAGNOSTIC_SECOND_INSTANCE", { action, commandLineArgCount: commandLine.length });
    if (!fixedDiagnosticActionRunner) {
      queuedDiagnosticAction ??= action;
      return;
    }
    void runFixedDiagnosticAction(action);
  });
}

if (!primaryInstanceLockAcquired) {
  app.quit();
} else if (process.env.PUBLISHER_BENCHMARK_MODE === "deepseek") {
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
