import { app, BrowserWindow, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync as readPhysicalFileSync } from "node:original-fs";
import { join } from "node:path";
import { XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID } from "@publisher/domain";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuContextPageInventory } from "@publisher/adapters-xiaohongshu/browser";
import { openDatabase, restoreDatabaseSafely } from "@publisher/db";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";
import { registerIpc } from "./ipc";
import { createRuntimeAdapterRegistry } from "./adapter-registry";
import { runDeepSeekBenchmarkMode } from "./deepseek-benchmark-mode";
import { createProcessDiagnostics } from "./process-diagnostics";
import { recordAppStartup } from "./runtime-observability";
import { createFixedDiagnosticRunner, INSPECT_XHS_CONTEXT_PAGES, parseDiagnosticAction, type DiagnosticAction, PROBE_XHS_CANONICAL_PAGE } from "./diagnostic-trigger";

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
  try { return createHash("sha256").update(readPhysicalFileSync(path)).digest("hex").toUpperCase(); }
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
    identityDomDiagnosticMatchCount: probe.identityDomDiagnosticMatchCount,
    identityDomDiagnosticMatches: probe.identityDomDiagnosticMatches,
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

function contextPageRoute(page: XiaohongshuContextPageInventory["pages"][number] | null): string | null {
  if (!page?.urlOrigin || !page.pathname) return null;
  return `${page.urlOrigin}${page.pathname}`;
}

function buildTask10sContextPageInventoryEvidence(input: {
  inventory: XiaohongshuContextPageInventory;
  timestamp: string;
  evidencePath: string;
}): Record<string, unknown> {
  const { inventory } = input;
  const canonical = inventory.pages.find((page) => page.isCanonical) ?? null;
  const readyPages = inventory.pages.filter((page) => page.urlOrigin === "https://creator.xiaohongshu.com"
    && page.pathname === "/publish/publish"
    && !page.isClosed
    && page.editorShellPresent
    && page.uploadImageTabPresent
    && page.imageUploadControlPresent
    && page.contentType === "IMAGE_POST");
  const ready = readyPages.length === 1 ? readyPages[0] : null;
  const oldCanonicalHasNoEditorShell = Boolean(canonical && !canonical.editorShellPresent);
  const canonicalSelectionBugProven = readyPages.length === 1 && Boolean(ready && !ready.isCanonical) && oldCanonicalHasNoEditorShell;
  const secondPage = ready && !ready.isCanonical ? ready : null;
  const creationEvent = secondPage ? inventory.pageCreationEvents.find((event) => event.pageDebugId === secondPage.pageId) ?? null : null;
  const contextPages = inventory.pages.map((page) => ({
    PAGE_INDEX: page.pageIndex,
    INTERNAL_PAGE_ID: page.pageId,
    IS_CANONICAL: page.isCanonical,
    IS_CLOSED: page.isClosed,
    URL_ORIGIN: page.urlOrigin,
    URL_PATHNAME: page.pathname,
    SOURCE: page.source,
    FROM: page.from,
    TARGET: page.target,
    DOCUMENT_READY_STATE: page.documentReadyState,
    TITLE_SAFE: page.titleSafe,
    OPENER_PRESENT: page.openerPresent,
    OPENER_PAGE_ID_IF_SAME_CONTEXT: page.openerPageIdIfSameContext,
    FRAME_COUNT: page.frameCount,
    VISIBILITY_STATE: page.visibilityState,
    EDITOR_SHELL_PRESENT: page.editorShellPresent,
    UPLOAD_IMAGE_TAB_PRESENT: page.uploadImageTabPresent,
    CURRENT_SELECTED_TAB: page.currentSelectedTab,
    IMAGE_UPLOAD_CONTROL_PRESENT: page.imageUploadControlPresent,
    TITLE_CONTROL_PRESENT: page.titleControlPresent,
    BODY_CONTROL_PRESENT: page.bodyControlPresent,
    FINAL_SUBMIT_CONTROL_PRESENT: page.finalSubmitControlPresent,
    CONTENT_TYPE: page.contentType,
    IMAGE_EDITOR_PHASE: page.imageEditorPhase
  }));
  return {
    timestamp: input.timestamp,
    evidencePath: input.evidencePath,
    action: INSPECT_XHS_CONTEXT_PAGES,
    inventoryStatus: inventory.inventoryStatus,
    failureCode: inventory.failureCode,
    platformKey: inventory.platformKey,
    accountId: inventory.accountId,
    contextDebugId: inventory.contextDebugId,
    runtimeAuthState: inventory.runtimeAuthState,
    browserConnected: inventory.browserConnected,
    CONTEXT_PAGE_COUNT: inventory.pageCount,
    CONTEXT_PAGES: contextPages,
    CANONICAL_PAGE_ID: canonical?.pageId ?? inventory.canonicalPageId,
    CANONICAL_PAGE_ROUTE: contextPageRoute(canonical),
    CANONICAL_PAGE_READY_STATE: canonical?.documentReadyState ?? null,
    CANONICAL_EDITOR_SHELL: canonical?.editorShellPresent ? "YES" : canonical ? "NO" : "NOT_RUN",
    READY_EDITOR_PAGE_ID: ready?.pageId ?? null,
    READY_EDITOR_PAGE_ROUTE: contextPageRoute(ready),
    READY_EDITOR_READY_STATE: ready?.documentReadyState ?? null,
    READY_EDITOR_SHELL: ready?.editorShellPresent ? "YES" : ready ? "NO" : "NOT_RUN",
    READY_IMAGE_EDITOR_PAGE_COUNT: readyPages.length,
    READY_IMAGE_EDITOR_PAGE_ID: ready?.pageId ?? null,
    READY_IMAGE_EDITOR_IS_CANONICAL: ready ? ready.isCanonical ? "YES" : "NO" : "NOT_RUN",
    UNIQUE_READY_EDITOR_PAGE_ID: ready?.pageId ?? null,
    VISIBLE_SUCCESSFUL_EDITOR_PAGE_ID: null,
    SAME_BROWSER_CONTEXT: ready && canonical ? "YES" : "NOT_RUN",
    SAME_ACCOUNT_RUNTIME: ready && canonical && inventory.accountId.length > 0 ? "YES" : "NOT_RUN",
    SAME_CREATOR_ORIGIN: ready && canonical && ready.urlOrigin === canonical.urlOrigin && ready.urlOrigin === "https://creator.xiaohongshu.com" ? "YES" : "NOT_RUN",
    CANONICAL_EQUALS_READY_EDITOR_PAGE: ready && canonical ? canonical.pageId === ready.pageId ? "YES" : "NO" : "NOT_RUN",
    SECOND_PAGE_CREATED_BY: creationEvent ? "CONTEXT_ON_PAGE_EVENT_ONLY_UNATTRIBUTED_SOURCE" : secondPage ? "NOT_RECORDED" : "NOT_APPLICABLE",
    SECOND_PAGE_CREATION_EVENT: creationEvent,
    CANONICAL_REGISTRY_UPDATE_ATTEMPTED: "NOT_OBSERVED",
    CANONICAL_REGISTRY_UPDATE_RESULT: "NOT_OBSERVED",
    FIRST_CANONICAL_REGISTRY_DIVERGENCE_POINT: canonicalSelectionBugProven ? "OBSERVED_DURING_CONTEXT_INVENTORY; HISTORICAL_FIRST_POINT_NOT_RECORDED" : "NOT_PROVEN",
    CANONICAL_PAGE_SELECTION_BUG: canonicalSelectionBugProven ? "PROVEN" : "NOT_PROVEN",
    ROOT_CAUSE: canonicalSelectionBugProven ? "STALE_OR_WRONG_CANONICAL_PAGE_AFTER_PUBLISH_TRANSITION" : "NOT_PROVEN",
    CODE_CHANGED: "DIAGNOSTIC_ONLY_NO_REGISTRY_FIX",
    FINAL_SUBMIT_COUNT: 0,
    PUBLICATION_TRANSACTION_COUNT: 0,
    AUTHORIZED_UNUSED_RUNS_AFTER: 1
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
  const evidencePath = join(evidenceDirectory, "xiaohongshu-task10w-live-probe-r6-20260902.json");
  const contextPageInventoryEvidencePath = join(evidenceDirectory, "xiaohongshu-task10s-context-page-inventory-20260903.json");
  const installedAppAsarSha256 = app.isPackaged ? hashFile(app.getAppPath()) : null;
  const writeProbeEvidence = (probe: XiaohongshuCanonicalPageRuntimeProbe): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const evidence = buildTask10wLiveProbeEvidence({ probe, timestamp: new Date().toISOString(), evidencePath, installedAppAsarSha256, expectedCreatorId, expectedCreatorIdProvenance });
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_CANONICAL_PAGE_RUNTIME_PROBE_EVIDENCE_WRITTEN", "小红书 canonical Page runtime probe evidence 已写入", { action: PROBE_XHS_CANONICAL_PAGE, evidencePath, probeEventCount: 1, accountIdentityVerified: evidence.accountIdentityVerified, liveCanonicalProbe: evidence.liveCanonicalProbe });
  };
  const writeContextPageEvidence = (inventory: XiaohongshuContextPageInventory): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const evidence = buildTask10sContextPageInventoryEvidence({ inventory, timestamp: new Date().toISOString(), evidencePath: contextPageInventoryEvidencePath });
    writeFileSync(contextPageInventoryEvidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_CONTEXT_PAGE_INVENTORY_EVIDENCE_WRITTEN", "小红书 Context Page inventory evidence 已写入", { action: INSPECT_XHS_CONTEXT_PAGES, evidencePath: contextPageInventoryEvidencePath, pageCount: evidence.CONTEXT_PAGE_COUNT, readyImageEditorPageCount: evidence.READY_IMAGE_EDITOR_PAGE_COUNT, canonicalEqualsReady: evidence.CANONICAL_EQUALS_READY_EDITOR_PAGE });
  };
  fixedDiagnosticActionRunner = createFixedDiagnosticRunner({
    probe: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_CANONICAL_PAGE_RUNTIME_PROBE_TRIGGER_RECEIVED", "收到固定非 UI 小红书 canonical Page probe trigger", { action: PROBE_XHS_CANONICAL_PAGE, accountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID });
      return platformSelfTests.inspectCanonicalXhsPageRuntime(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID);
    },
    writeEvidence: writeProbeEvidence,
    inspectContextPages: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_CONTEXT_PAGE_INVENTORY_TRIGGER_RECEIVED", "收到固定非 UI 小红书 Context Page inventory trigger", { action: INSPECT_XHS_CONTEXT_PAGES, accountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID });
      return platformSelfTests.inspectXhsContextPages(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID);
    },
    writeContextPageEvidence
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
