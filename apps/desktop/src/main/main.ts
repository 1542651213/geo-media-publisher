import { app, BrowserWindow, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync as readPhysicalFileSync } from "node:original-fs";
import { join } from "node:path";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic, XiaohongshuContextPageInventory, XiaohongshuCurrentFileInputState, XiaohongshuCurrentPostUploadReconciliation, XiaohongshuCurrentPostUploadTerminalReadiness, XiaohongshuGlobalExactPublishDomRuntimeDiagnostic, XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import { openDatabase, restoreDatabaseSafely } from "@publisher/db";
import { SafeStorageCredentialStore, type CredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";
import { registerIpc } from "./ipc";
import { createRuntimeAdapterRegistry } from "./adapter-registry";
import { initializeOrdinaryPilot } from "./ordinary-xhs-pilot";
import { initializeXhsMax3Live } from "./xhs-max3-live";
import { initializeFormalXhsProductionPilot } from "./formal-xhs-production-pilot";
import { runDeepSeekBenchmarkMode } from "./deepseek-benchmark-mode";
import { createProcessDiagnostics } from "./process-diagnostics";
import { recordAppStartup } from "./runtime-observability";
import type { PlatformSelfTestService } from "./platform-self-test";
import { ApplicationShutdownCoordinator } from "./application-shutdown";
import { buildSecondInstanceDispatchTrace, createFixedDiagnosticRunner, ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION, INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT, INSPECT_XHS_CONTEXT_PAGES, INSPECT_XHS_FILE_INPUT_STATE, INSPECT_XHS_FINAL_SUBMIT_DOM, INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM, INSPECT_XHS_POST_UPLOAD_RECONCILIATION, INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS, INSPECT_XHS_PUBLISH_ENTRY_DOM, parseDiagnosticActionWithTrace, RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN, RUN_XHS_TASK10S_ARM_RUN, RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5, RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE, RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, type DiagnosticAction, type FixedDiagnosticInvocationContext, type Task10sAttempt3DispatchTrace, PROBE_XHS_CANONICAL_PAGE } from "./diagnostic-trigger";
import type { XhsIdentityPageEnsureServiceResult } from "./xhs-identity";

app.setName("codex-media-publisher");
const scopedLive = initializeXhsMax3Live();
if (scopedLive && (process.env.GEO_XHS_PRODUCTION_PILOT || process.env.GEO_XHS_PRODUCTION_PILOT_CONFIG)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_MODE_CONFLICT");
const formalPilot = scopedLive ? null : initializeFormalXhsProductionPilot();
const ordinaryPilot = scopedLive || formalPilot ? null : initializeOrdinaryPilot();
const processDiagnostics = createProcessDiagnostics(join(scopedLive?.dataDirectory ?? formalPilot?.dataDirectory ?? ordinaryPilot?.dataDirectory ?? join(app.getPath("userData"), "production-data"), "logs", "main-process-diagnostics.log"));
processDiagnostics.installProcessHandlers();

let scheduler: PersistentScheduler | null = null;
const ownedBrowserSessionClosers = new Set<() => Promise<void>>();
let databaseCloser: (() => void | Promise<void>) | null = null;
const shutdownCoordinator = new ApplicationShutdownCoordinator({
  stopSchedulers: () => { scheduler?.stop(); },
  closeBrowserSessions: async () => { await Promise.allSettled([...ownedBrowserSessionClosers].map((close) => close())); },
  closeDatabase: async () => { await databaseCloser?.(); },
  onEvent: (event) => processDiagnostics.record("APP_SHUTDOWN_TIMELINE", { phase: event }),
  onError: (stage, error) => processDiagnostics.record("APP_SHUTDOWN_STAGE_FAILED", { phase: stage, error })
});
const initialDiagnosticInvocation = parseDiagnosticActionWithTrace(process.argv);
const initialDiagnosticAction = ordinaryPilot || scopedLive || formalPilot ? null : initialDiagnosticInvocation.action;
const primaryInstanceLockAcquired = app.requestSingleInstanceLock(initialDiagnosticAction ? { action: initialDiagnosticAction } : undefined);
let queuedDiagnosticAction: DiagnosticAction | null = initialDiagnosticAction;
let queuedDiagnosticInvocationContext: FixedDiagnosticInvocationContext | undefined = (initialDiagnosticAction === RUN_XHS_TASK10S_ARM_RUN || initialDiagnosticAction === RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW || initialDiagnosticAction === RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY || initialDiagnosticAction === RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR) && initialDiagnosticInvocation.testRunId
  ? { testRunId: initialDiagnosticInvocation.testRunId }
  : undefined;
let fixedDiagnosticActionRunner: ((action: DiagnosticAction, context?: FixedDiagnosticInvocationContext) => Promise<boolean>) | null = null;
let diagnosticRunInFlight: Promise<boolean> | null = null;
let writeTask10sAttempt3DispatchDryRunEvidence: ((trace: Task10sAttempt3DispatchTrace) => void) | null = null;

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
  const browserSessionExists = probe.sessionExists ?? Boolean(probe.canonicalContextId || probe.canonicalPageId);
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

function buildTask10sPublishEntryDomEvidence(input: {
  diagnostic: XiaohongshuPublishEntryDomRuntimeDiagnostic;
  timestamp: string;
  evidencePath: string;
}): Record<string, unknown> {
  const { diagnostic } = input;
  const card = diagnostic.imagePost;
  const uniqueCardAncestor = card.uniqueClickableAncestor;
  const imageNoteCardContractProven = diagnostic.inspectionStatus === "PASS"
    && diagnostic.pageContextMatchesSession
    && diagnostic.browserConnected
    && !diagnostic.pageClosed
    && diagnostic.pageOrigin === "https://creator.xiaohongshu.com"
    && diagnostic.pathname === "/new/home"
    && card.matchCount === 1
    && card.clickableAncestorCount === 1
    && Boolean(uniqueCardAncestor?.visible && uniqueCardAncestor.enabled && uniqueCardAncestor.clickableContainer);
  const oldPublishNote = diagnostic.publishNote;
  const oldDropdownTrigger = oldPublishNote.uniqueClickableAncestor;
  const oldDropdownContractFailure = oldPublishNote.matchCount !== 1
    ? "PUBLISH_NOTE_EXACT_LABEL_NOT_UNIQUE"
    : oldPublishNote.clickableAncestorCount !== 1 || !oldDropdownTrigger
      ? "PUBLISH_NOTE_UNIQUE_CLICKABLE_ANCESTOR_NOT_PROVEN"
      : !(oldDropdownTrigger.isButton || oldDropdownTrigger.isRoleButton)
        ? "PUBLISH_NOTE_ANCESTOR_NOT_NATIVE_BUTTON_OR_ROLE_BUTTON"
        : !oldDropdownTrigger.ariaHasPopup && !oldDropdownTrigger.ariaExpanded
          ? "PUBLISH_NOTE_DROPDOWN_SEMANTICS_NOT_OBSERVED"
          : null;
  return {
    timestamp: input.timestamp,
    evidencePath: input.evidencePath,
    action: INSPECT_XHS_PUBLISH_ENTRY_DOM,
    inspectionStatus: diagnostic.inspectionStatus,
    failureCode: diagnostic.failureCode,
    accountId: diagnostic.accountId,
    contextDebugId: diagnostic.contextDebugId,
    pageId: diagnostic.pageId,
    pageContextMatchesSession: diagnostic.pageContextMatchesSession,
    browserConnected: diagnostic.browserConnected,
    pageClosed: diagnostic.pageClosed,
    PAGE_ORIGIN: diagnostic.pageOrigin || null,
    PAGE_PATHNAME: diagnostic.pathname || null,
    PUBLISH_NOTE: diagnostic.publishNote,
    PUBLISH_IMAGE_CARD: diagnostic.imagePost,
    UPLOAD_IMAGE: diagnostic.uploadImage,
    IMAGE_NOTE_CARD_CONTRACT: imageNoteCardContractProven ? "PROVEN" : "NOT_PROVEN",
    OLD_DROPDOWN_CONTRACT_FAILURE_LIVE_EVIDENCE: oldDropdownContractFailure,
    DIAGNOSTIC_CLICK_COUNT: diagnostic.diagnosticClickCount,
    NAVIGATION_COUNT: diagnostic.navigationCount,
    CODE_CHANGED: "DIAGNOSTIC_ONLY_NO_ENTRY_FIX"
  };
}

async function createWindow(): Promise<void> {
  const migrationsDir = firstExisting([join(app.getAppPath(), "packages", "db", "migrations"), join(process.resourcesPath, "packages", "db", "migrations"), join(process.cwd(), "packages", "db", "migrations"), join(__dirname, "../../packages/db/migrations")]);
  const csvPath = firstExisting([join(app.getAppPath(), "PLATFORMS.csv"), join(process.resourcesPath, "PLATFORMS.csv"), join(process.cwd(), "PLATFORMS.csv")]);
  const dataDirectory = scopedLive?.dataDirectory ?? formalPilot?.dataDirectory ?? ordinaryPilot?.dataDirectory ?? join(app.getPath("userData"), app.isPackaged || process.env.PUBLISHER_DATA_MODE === "production" ? "production-data" : "development-data");
  const databasePath = join(dataDirectory, "publisher.db");
  const appLogPath = join(dataDirectory, "logs", "app.log");
  const logger = createFileLogger(appLogPath);
  const database = openDatabase(databasePath, migrationsDir, (event) => logger.info("DATABASE", event.code, "数据库迁移生命周期事件", { migrationId: event.migrationId, discoveredMigrationCount: event.discoveredMigrationCount, appliedMigrationCount: event.appliedMigrationCount, latestMigrationId: event.latestMigrationId, latestSourceMigration: event.latestSourceMigrationId, latestPackagedMigration: event.latestPackagedMigrationId, productionSchemaVersion: event.productionSchemaVersion, schemaUpToDate: event.schemaUpToDate, authTablePresent: event.authTablePresent }));
  let databaseClosed = false;
  databaseCloser = () => {
    if (databaseClosed) return;
    databaseClosed = true;
    database.db.close();
  };
  const isDevelopment = isDevelopmentEnvironment(app.isPackaged);
  if (isDevelopment) database.repository.seedDevelopment(csvPath);
  else database.repository.seedPlatformCatalog(csvPath);
  scopedLive?.ensureAccountAndLedger(database.repository);
  formalPilot?.ensureRepository(database.repository);
  if (scopedLive) ownedBrowserSessionClosers.add(async () => { scopedLive.close(); });
  recordAppStartup(logger, { pid: process.pid, packaged: app.isPackaged, userDataPath: app.getPath("userData"), productionDataPath: dataDirectory, appLogPath });
  const credentials: CredentialStore = ordinaryPilot ? {
    get: () => null,
    has: () => false,
    getStatus: () => "NotConfigured",
    set: () => { throw new Error("ORDINARY_PILOT_CREDENTIAL_OPERATION_DENIED"); },
    delete: () => { throw new Error("ORDINARY_PILOT_CREDENTIAL_OPERATION_DENIED"); }
  } : new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const pilotServices = ordinaryPilot ? await ordinaryPilot.createServices(database.repository, logger) : null;
  if (pilotServices) ownedBrowserSessionClosers.add(() => pilotServices.close());
  const registry = pilotServices?.registry ?? createRuntimeAdapterRegistry(credentials, isDevelopment, logger, join(app.getPath("userData"), "browser-profiles"), join(dataDirectory, "credentials.enc"), scopedLive?.productionReceiptFactory ?? formalPilot?.productionReceiptFactory);
  ownedBrowserSessionClosers.add(async () => {
    const closableAdapters = registry.listAll().filter((adapter): adapter is typeof adapter & { closeOwnedSessions(): Promise<void> } => typeof (adapter as { closeOwnedSessions?: unknown }).closeOwnedSessions === "function");
    await Promise.allSettled(closableAdapters.map((adapter) => adapter.closeOwnedSessions()));
  });
  database.repository.syncAdapterManifests(registry.list().map((adapter) => ({ manifest: adapter.manifest, capabilities: adapter.getCapabilities() })));
  database.repository.reconcileAdapterRegistrations(registry.list().map((adapter) => adapter.platformKey));
  const resolveAccountSecrets = (accountId: string, platformKey: string): Record<string, string> => {
    if (ordinaryPilot) return {};
    const adapter = registry.get(platformKey);
    const keys = [...new Set([...adapter.getCredentialSchema().map((field) => field.key), "oauthAccessToken"])]
    return Object.fromEntries(keys.map((key) => [key, credentials.get(`account:${accountId}:${platformKey}:${key}`) ?? ""]));
  };
  const platformSelfTestsRef: { current?: PlatformSelfTestService } = {};
  const publisher = new PublisherService(database.repository, registry, logger, {
    resolveSecrets: resolveAccountSecrets,
    resolveRuntimeIdentityAttestation: (accountId) => pilotServices ? pilotServices.resolveRuntimeIdentityAttestation(accountId) : platformSelfTestsRef.current?.getXhsContextIdentityAttestation(accountId) ?? null,
    scopedCampaignBuildSha256: scopedLive?.buildSha256 ?? formalPilot?.buildSha256,
    productionPilotGuard: formalPilot ? formalPilot.createGuard(database.repository) : undefined,
    onScopedProductionBoundary: scopedLive?.onBoundary,
    onScopedProductionUnknown: scopedLive?.onUnknown
  });
  scheduler = new PersistentScheduler(database.repository, publisher, logger);
  const platformSelfTests = registerIpc({ resumeBackgroundTasks: scopedLive || formalPilot ? false : ordinaryPilot?.resumeBackgroundTasks, scopedLiveGuard: scopedLive ? (channel, payload) => scopedLive.assertIpc(channel, payload, database.repository) : formalPilot ? (channel, payload) => formalPilot.assertIpc(channel, payload, database.repository) : undefined, repository: database.repository, publisher, scheduler, registry, resolveAccountSecrets, dataDirectory, coverDir: join(dataDirectory, "covers"), logger, credentials, aiCredentials: credentials, appLogPath, databasePath, processDiagnostics, restoreDatabase: (backupPath) => { if (ordinaryPilot || scopedLive || formalPilot) throw new Error("SCOPED_DATABASE_RESTORE_DENIED"); scheduler?.stop(); restoreDatabaseSafely(database.db, databasePath, backupPath); app.relaunch(); app.exit(0); } });
  platformSelfTestsRef.current = platformSelfTests;
  const resolveXhsAccountId = (): string => {
    const accounts = database.repository.listAccounts().filter((item) => item.platformKey === "xiaohongshu" && item.enabled && !item.archivedAt);
    if (accounts.length !== 1 || !accounts[0]) throw new Error("小红书账号选择不明确或不可用");
    return accounts[0].id;
  };
  const targetAccount = database.repository.listAccounts().find((item) => item.platformKey === "xiaohongshu" && item.enabled && !item.archivedAt) ?? null;
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
  const publishEntryDomEvidencePath = join(evidenceDirectory, "xiaohongshu-task10s-publish-entry-dom-diagnostic-20260903.json");
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
  const writePublishEntryDomEvidence = (diagnostic: XiaohongshuPublishEntryDomRuntimeDiagnostic): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const evidence = buildTask10sPublishEntryDomEvidence({ diagnostic, timestamp: new Date().toISOString(), evidencePath: publishEntryDomEvidencePath });
    writeFileSync(publishEntryDomEvidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_ENTRY_DOM_EVIDENCE_WRITTEN", "小红书 publish-entry bounded DOM diagnostic evidence 已写入", { action: INSPECT_XHS_PUBLISH_ENTRY_DOM, evidencePath: publishEntryDomEvidencePath, inspectionStatus: evidence.inspectionStatus, imageNoteCardContract: evidence.IMAGE_NOTE_CARD_CONTRACT, diagnosticClickCount: evidence.DIAGNOSTIC_CLICK_COUNT, navigationCount: evidence.NAVIGATION_COUNT });
  };
  const writePostUploadReconciliationEvidence = (diagnostic: XiaohongshuCurrentPostUploadReconciliation): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-post-upload-reconciliation-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      action: INSPECT_XHS_POST_UPLOAD_RECONCILIATION,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      accountId: diagnostic.accountId,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      sessionExists: diagnostic.sessionExists,
      browserConnected: diagnostic.browserConnected,
      contextExists: diagnostic.contextExists,
      pageExists: diagnostic.pageExists,
      pageClosed: diagnostic.pageClosed,
      pageContextMatchesSession: diagnostic.pageContextMatchesSession,
      route: { origin: diagnostic.origin, pathname: diagnostic.pathname, source: diagnostic.source, from: diagnostic.from, target: diagnostic.target, sanitizedUrl: diagnostic.sanitizedUrl },
      readyState: diagnostic.readyState,
      postUploadState: diagnostic.postUploadState,
      imageUploadReconciliation: diagnostic.imageUploadReconciliation,
      imageAssetRenderedCount: diagnostic.imageAssetRenderedCount,
      postUploadImageEditorPresent: diagnostic.postUploadImageEditorPresent,
      imageItems: diagnostic.imageItems,
      visibleImageItemCount: diagnostic.visibleImageItemCount,
      imageCounterTextSafe: diagnostic.imageCounterTextSafe,
      addImageControlPresent: diagnostic.addImageControlPresent,
      deleteImageControlCount: diagnostic.deleteImageControlCount,
      titleControlMatchCount: diagnostic.titleControlMatchCount,
      titleControlPresent: diagnostic.titleControlPresent,
      bodyControlMatchCount: diagnostic.bodyControlMatchCount,
      bodyControlPresent: diagnostic.bodyControlPresent,
      finalSubmitCandidateCount: diagnostic.finalSubmitCandidateCount,
      finalSubmitVisibleCount: diagnostic.finalSubmitVisibleCount,
      finalSubmitProof: diagnostic.finalSubmitProof,
      explicitUploadErrorSignals: diagnostic.explicitUploadErrorSignals,
      noExplicitUploadError: diagnostic.noExplicitUploadError,
      processingSignalPresent: diagnostic.processingSignalPresent,
      finalSubmitClickCount: 0,
      publicationTransactionCount: 0
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_POST_UPLOAD_RECONCILIATION_EVIDENCE_WRITTEN", "小红书 post-upload reconciliation evidence 已写入", { action: INSPECT_XHS_POST_UPLOAD_RECONCILIATION, evidencePath, inspectionStatus: diagnostic.inspectionStatus, postUploadState: diagnostic.postUploadState, imageAssetRenderedCount: diagnostic.imageAssetRenderedCount, titleControlPresent: diagnostic.titleControlPresent, bodyControlPresent: diagnostic.bodyControlPresent, finalSubmitControlPresent: diagnostic.finalSubmitVisibleCount > 0 });
  };
  const writePostUploadTerminalReadinessEvidence = (diagnostic: XiaohongshuCurrentPostUploadTerminalReadiness): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-post-upload-terminal-readiness-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      action: INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      accountId: diagnostic.accountId,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      sessionExists: diagnostic.sessionExists,
      browserConnected: diagnostic.browserConnected,
      contextExists: diagnostic.contextExists,
      pageExists: diagnostic.pageExists,
      pageClosed: diagnostic.pageClosed,
      pageContextMatchesSession: diagnostic.pageContextMatchesSession,
      route: { origin: diagnostic.origin, pathname: diagnostic.pathname, source: diagnostic.source, from: diagnostic.from, target: diagnostic.target, sanitizedUrl: diagnostic.sanitizedUrl },
      readyState: diagnostic.readyState,
      postUploadState: diagnostic.terminalReadiness.postUploadState,
      imageAssetRenderedCount: diagnostic.terminalReadiness.editorScopedImageAssetCount,
      imageCounterTextSafe: diagnostic.terminalReadiness.imageCounterTextSafe,
      imageCounterValid: diagnostic.terminalReadiness.imageCounterValid,
      titleControlPresent: diagnostic.terminalReadiness.titleControlPresent,
      bodyControlPresent: diagnostic.terminalReadiness.bodyControlPresent,
      uploadErrorSignalPresent: diagnostic.terminalReadiness.uploadErrorSignalPresent,
      busySignalPresent: diagnostic.terminalReadiness.busySignalPresent,
      postUploadTerminalReadiness: diagnostic.terminalReadiness,
      finalSubmitClickCount: 0,
      publicationTransactionCount: 0
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_POST_UPLOAD_TERMINAL_READINESS_EVIDENCE_WRITTEN", "小红书 post-upload terminal readiness evidence 已写入", { action: INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS, evidencePath, status: diagnostic.terminalReadiness.ready ? "EDITOR_READY" : "NOT_READY", blockerCodes: diagnostic.terminalReadiness.blockerCodes });
  };
  const writeFileInputEvidence = (diagnostic: XiaohongshuCurrentFileInputState): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-file-input-state-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      action: INSPECT_XHS_FILE_INPUT_STATE,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      accountId: diagnostic.accountId,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      sessionExists: diagnostic.sessionExists,
      browserConnected: diagnostic.browserConnected,
      contextExists: diagnostic.contextExists,
      pageExists: diagnostic.pageExists,
      pageClosed: diagnostic.pageClosed,
      pageContextMatchesSession: diagnostic.pageContextMatchesSession,
      route: { origin: diagnostic.origin, pathname: diagnostic.pathname, sanitizedUrl: diagnostic.sanitizedUrl },
      readyState: diagnostic.readyState,
      currentFileInputMatchCount: diagnostic.matchCount,
      currentFileInputs: diagnostic.inputs,
      fileInputContainsExpectedFixture: diagnostic.fileInputContainsExpectedFixture
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_FILE_INPUT_STATE_EVIDENCE_WRITTEN", "小红书 file-input state evidence 已写入", { action: INSPECT_XHS_FILE_INPUT_STATE, evidencePath, inspectionStatus: diagnostic.inspectionStatus, fileInputMatchCount: diagnostic.matchCount, fileInputContainsExpectedFixture: diagnostic.fileInputContainsExpectedFixture, fileInputFilesLengths: diagnostic.inputs.map((input) => input.filesLength) });
  };
  const writeFinalSubmitDomEvidence = (diagnostic: XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-final-submit-dom-diagnostic-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      action: INSPECT_XHS_FINAL_SUBMIT_DOM,
      ...diagnostic,
      FINAL_PUBLISH_EXACT_TEXT_MATCH_COUNT: diagnostic.finalPublishExactTextMatchCount,
      FINAL_PUBLISH_NATIVE_BUTTON_MATCH_COUNT: diagnostic.finalPublishNativeButtonMatchCount,
      FINAL_PUBLISH_ROLE_BUTTON_MATCH_COUNT: diagnostic.finalPublishRoleButtonMatchCount,
      FINAL_PUBLISH_CANDIDATES_SAFE: diagnostic.finalPublishCandidatesSafe,
      FINAL_PUBLISH_CONTAINER_SAFE: diagnostic.finalPublishContainerSafe,
      FINAL_SUBMIT_CONTROL_PRESENT: diagnostic.finalSubmitControlPresent,
      FINAL_SUBMIT_CONTROL_ENABLED: diagnostic.finalSubmitControlEnabled,
      safety: { clickCount: 0, setInputFilesCallCount: 0, titleFillCount: 0, bodyFillCount: 0, finalSubmitClickCount: 0, publicationTransactionCount: 0, newAuthorizationCreated: 0 }
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_FINAL_SUBMIT_DOM_EVIDENCE_WRITTEN", "小红书 final-submit bounded DOM diagnostic evidence 已写入", { action: INSPECT_XHS_FINAL_SUBMIT_DOM, evidencePath, inspectionStatus: diagnostic.inspectionStatus, finalSubmitControlPresent: diagnostic.finalSubmitControlPresent, finalSubmitControlEnabled: diagnostic.finalSubmitControlEnabled, finalPublishExactTextMatchCount: diagnostic.finalPublishExactTextMatchCount, finalSubmitClickCount: 0 });
  };
  const writeClosedShadowFinalSubmitEvidence = (diagnostic: XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-closed-shadow-final-submit-diagnostic-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      action: INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT,
      ...diagnostic,
      CLOSED_SHADOW_FINAL_SUBMIT_SURFACE: diagnostic.closedShadowFinalSubmitSurface,
      CDP_SESSION_CREATED: diagnostic.cdpSessionCreated,
      CDP_GET_DOCUMENT_SUCCESS: diagnostic.cdpGetDocumentSuccess,
      CDP_GET_DOCUMENT_DEPTH: diagnostic.cdpGetDocumentDepth,
      CDP_GET_DOCUMENT_PIERCE: diagnostic.cdpGetDocumentPierce,
      PIERCED_XHS_PUBLISH_BTN_COUNT: diagnostic.piercedXhsPublishBtnCount,
      HOST_NODE_NAME: diagnostic.hostNodeName,
      HOST_ATTRIBUTES_SAFE: diagnostic.hostAttributesSafe,
      HOST_IS_PUBLISH: diagnostic.hostIsPublish,
      HOST_SUBMIT_TEXT: diagnostic.hostSubmitText,
      HOST_SUBMIT_DISABLED: diagnostic.hostSubmitDisabled,
      HOST_SUBMIT_LOADING: diagnostic.hostSubmitLoading,
      HOST_DESCENDANT_BUTTON_COUNT: diagnostic.hostDescendantButtonCount,
      EXACT_PUBLISH_NATIVE_BUTTON_COUNT: diagnostic.exactPublishNativeButtonCount,
      BUTTON_NODE_NAME: diagnostic.buttonNodeName,
      BUTTON_TEXT_SAFE: diagnostic.buttonTextSafe,
      BUTTON_TYPE: diagnostic.buttonType,
      BUTTON_CLASS_SAFE: diagnostic.buttonClassSafe,
      BUTTON_ARIA_DISABLED: diagnostic.buttonAriaDisabled,
      BUTTON_ARIA_BUSY: diagnostic.buttonAriaBusy,
      BUTTON_BOX_MODEL_PRESENT: diagnostic.buttonBoxModelPresent,
      BUTTON_CENTER_X_SAFE: diagnostic.buttonCenterXSafe,
      BUTTON_CENTER_Y_SAFE: diagnostic.buttonCenterYSafe,
      FINAL_SUBMIT_CONTROL_PRESENT: diagnostic.finalSubmitControlPresent,
      FINAL_SUBMIT_CONTROL_ENABLED: diagnostic.finalSubmitControlEnabled,
      safety: { clickCount: 0, mousePressedCount: 0, mouseReleasedCount: 0, setInputFilesCallCount: 0, titleFillCount: 0, bodyFillCount: 0, finalSubmitClickCount: 0, publicationTransactionCount: 0, newAuthorizationCreated: 0 }
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_CLOSED_SHADOW_FINAL_SUBMIT_EVIDENCE_WRITTEN", "小红书 closed-shadow final-submit 只读 diagnostic evidence 已写入", {
      action: INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT,
      evidencePath,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      hostMatchCount: diagnostic.piercedXhsPublishBtnCount,
      exactPublishNativeButtonCount: diagnostic.exactPublishNativeButtonCount,
      finalSubmitControlPresent: diagnostic.finalSubmitControlPresent,
      finalSubmitControlEnabled: diagnostic.finalSubmitControlEnabled,
      finalSubmitClickCount: 0
    });
  };
  const writeGlobalExactPublishDomEvidence = (diagnostic: XiaohongshuGlobalExactPublishDomRuntimeDiagnostic): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-global-exact-publish-dom-diagnostic-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      action: INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM,
      ...diagnostic,
      GLOBAL_EXACT_PUBLISH_LABEL: "发布",
      GLOBAL_EXACT_PUBLISH_TEXT_MATCH_COUNT: diagnostic.globalExactPublishTextMatchCount,
      GLOBAL_EXACT_PUBLISH_UNIQUE: diagnostic.globalExactPublishUnique,
      GLOBAL_EXACT_PUBLISH_NODES_SAFE: diagnostic.globalExactPublishNodesSafe,
      MAX_ANCESTOR_DEPTH: diagnostic.maxAncestorDepth,
      SIDE_EFFECT_COUNTS: { clickCount: 0, setInputFilesCallCount: 0, titleFillCount: 0, bodyFillCount: 0, finalSubmitClickCount: 0, publicationTransactionCount: 0, newAuthorizationCreated: 0 }
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_GLOBAL_EXACT_PUBLISH_DOM_EVIDENCE_WRITTEN", "小红书 document-global exact 发布只读 diagnostic evidence 已写入", { action: INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM, evidencePath, inspectionStatus: diagnostic.inspectionStatus, globalExactPublishTextMatchCount: diagnostic.globalExactPublishTextMatchCount, globalExactPublishUnique: diagnostic.globalExactPublishUnique });
  };
  const writeXhsContextIdentityAttestationEvidence = (result: Awaited<ReturnType<typeof platformSelfTests.establishXhsContextIdentityAttestation>>): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-context-identity-attestation-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = { timestamp, evidencePath, action: ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION, ...result, sideEffectCounts: { pageCreated: 0, contextCreated: 0, navigation: 0, reload: 0, uploadImages: 0, setInputFiles: 0, titleFill: 0, bodyFill: 0, finalSubmitClick: 0, publicationTransaction: 0, newAuthorizationCreated: 0 } };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_CONTEXT_IDENTITY_ATTESTATION_EVIDENCE_WRITTEN", "小红书 Context-bound identity attestation evidence 已写入", { action: ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION, evidencePath, status: result.status, failureCode: result.status === "BLOCKED" ? result.failureCode : null });
  };
  const writeXhsIdentityPageEnsureEvidence = (result: XhsIdentityPageEnsureServiceResult): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-ensure-identity-page-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      ...result,
      action: RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE,
      sideEffectCounts: {
        pageCreated: result.action === "CREATED_NEW_PAGE" ? 1 : 0,
        contextCreated: 0,
        navigation: result.action === "REUSED" ? 0 : 1,
        reload: 0,
        uploadImages: 0,
        setInputFiles: 0,
        titleFill: 0,
        bodyFill: 0,
        finalSubmitClick: 0,
        publicationTransaction: 0,
        newJob: 0,
        newRecord: 0,
        newAuthorization: 0
      }
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_IDENTITY_PAGE_ENSURE_EVIDENCE_WRITTEN", "小红书 identity Page ensure evidence 已写入；未修改编辑器且未执行发布", {
      action: RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE,
      evidencePath,
      status: result.status,
      failureCode: result.failureCode,
      identityPageUrl: result.identityPageUrl,
      editorPageUrl: result.editorPageUrl,
      sameBrowserContext: result.sameBrowserContext,
      identityMatch: result.identityMatch,
      finalSubmitClickCount: 0,
      publicationTransactionCount: 0
    });
  };
  const writeTask10sControlledUploadAttempt3Evidence = (result: Awaited<ReturnType<typeof platformSelfTests.runTask10sControlledUploadAttempt3>>): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-controlled-upload-attempt3-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = { ...result, evidencePath, action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, safety: { titleFillCount: 0, bodyFillCount: 0, finalSubmitClickCount: 0, publicationTransactionCount: 0, newAuthorizationCreated: 0 } };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_EVIDENCE_WRITTEN", "Task10S Attempt 3 已写入安全证据；流程停止在上传后，不填标题正文、不提交", { action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, evidencePath, status: result.status, failureCode: result.failureCode, uploadLayer2: result.uploadLayer2, uploadLayer4: result.uploadLayer4, finalSubmitClickCount: 0, publicationTransactionCount: 0 });
  };
  const writeTask10sControlledUploadAttempt4Evidence = (result: Awaited<ReturnType<typeof platformSelfTests.runTask10sControlledUploadAttempt4>>): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-controlled-upload-attempt4-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = { ...result, evidencePath, action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4, safety: { titleFillCount: 0, bodyFillCount: 0, finalSubmitClickCount: 0, publicationTransactionCount: 0, newAuthorizationCreated: 0 } };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "TASK10S_CONTROLLED_UPLOAD_ATTEMPT4_EVIDENCE_WRITTEN", "Task10S Attempt 4 已写入安全证据；流程停止在上传后，不填标题正文、不提交", { action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4, evidencePath, status: result.status, failureCode: result.failureCode, uploadLayer2: result.uploadLayer2, uploadLayer4: result.uploadLayer4, finalSubmitClickCount: 0, publicationTransactionCount: 0 });
  };
  const writeTask10sControlledUploadAttempt5Evidence = (result: Awaited<ReturnType<typeof platformSelfTests.runTask10sControlledUploadAttempt5>>): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-controlled-upload-attempt5-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = { ...result, evidencePath, action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5, safety: { titleFillCount: 0, bodyFillCount: 0, finalSubmitClickCount: 0, publicationTransactionCount: 0, newAuthorizationCreated: 0 } };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "TASK10S_CONTROLLED_UPLOAD_ATTEMPT5_EVIDENCE_WRITTEN", "Task10S Attempt 5 已写入安全证据；流程停止在上传后，不填标题正文、不提交", { action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5, evidencePath, status: result.status, failureCode: result.failureCode, uploadLayer2: result.uploadLayer2, uploadLayer4: result.uploadLayer4, finalSubmitClickCount: 0, publicationTransactionCount: 0 });
  };
  const writeTask10sCompleteRetainedEditorEvidence = (result: Awaited<ReturnType<typeof platformSelfTests.runTask10sCompleteRetainedEditor>>): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-complete-retained-editor-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      ...result,
      action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR,
      OPEN_FILE_PICKER_QUERY_SOURCE: "NOT_PROVEN",
      safety: {
        uploadCallCount: result.uploadCallCount,
        titleFillCount: result.titleFillCount ?? 0,
        bodyFillCount: result.bodyFillCount ?? 0,
        finalSubmitClickCount: result.finalSubmitClickCount,
        publicationTransactionCount: result.publicationTransactionCount ?? 0,
        newAuthorizationCreated: 0
      }
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "TASK10S_COMPLETE_RETAINED_EDITOR_EVIDENCE_WRITTEN", "Task10S retained-editor completion action evidence 已写入", { action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, evidencePath, status: result.status, failureCode: result.failureCode, uploadCallCount: result.uploadCallCount, finalSubmitClickCount: result.finalSubmitClickCount });
  };
  const writeTask10sFreshPublishFlowEvidence = (result: Awaited<ReturnType<typeof platformSelfTests.runTask10sFreshPublishFlow>>): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-fresh-publish-flow-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      timestamp,
      evidencePath,
      ...result,
      safety: {
        ...result.safety,
        setInputFilesCallCount: result.safety.uploadAttempts,
        uploadImagesCallCount: result.safety.uploadAttempts,
        finalSubmitClickCount: 0,
        publicationTransactionCount: 0,
        newAuthorizationCreated: 0
      }
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "XHS_TASK10S_FRESH_PUBLISH_FLOW_EVIDENCE_WRITTEN", "小红书 fresh publish flow diagnostic evidence 已写入；未执行最终发布", { action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, evidencePath, status: result.status, failureCode: result.failureCode, newPublishEntry: result.newPublishEntry, readyForFinalSubmit: result.readyForFinalSubmit, uploadAttempts: result.safety.uploadAttempts, titleMutationCount: result.safety.titleMutationCount, bodyMutationCount: result.safety.bodyMutationCount, finalSubmitCount: 0 });
  };
  const writeTask10sArmRunEvidence = (result: Awaited<ReturnType<typeof platformSelfTests.armTask10sRun>>): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-arm-run-${timestamp.replace(/[:.]/gu, "-")}.json`);
    writeFileSync(evidencePath, JSON.stringify({ timestamp, evidencePath, ...result }, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "TASK10S_ARM_RUN_EVIDENCE_WRITTEN", "Parameterized Task10S ARM 结果已写入；不自动执行 completion", { evidencePath, ...result });
  };
  const writeTask10sPreparedEditorRecoveryEvidence = (result: Awaited<ReturnType<typeof platformSelfTests.recoverTask10sPreparedEditor>>): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-prepared-editor-recovery-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = { timestamp, evidencePath, ...result, safety: { finalSubmitClickCount: 0, mousePressedCount: 0, mouseReleasedCount: 0, publicationTransactionCount: 0 } };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "TASK10S_PREPARED_EDITOR_RECOVERY_EVIDENCE_WRITTEN", "Prepared Job 编辑器恢复证据已写入；未创建发布记录或执行发布", { action: RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, evidencePath, status: result.status, failureCode: result.failureCode, readyForFreshIdentityAttestation: result.readyForFreshIdentityAttestation });
  };
  writeTask10sAttempt3DispatchDryRunEvidence = (trace: Task10sAttempt3DispatchTrace): void => {
    mkdirSync(evidenceDirectory, { recursive: true });
    const timestamp = new Date().toISOString();
    const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-attempt3-dispatch-trace-${timestamp.replace(/[:.]/gu, "-")}.json`);
    const evidence = {
      ...trace,
      evidencePath,
      action: RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN,
      UNKNOWN_OPTION_LENGTH: trace.unknownOptionLength,
      UNKNOWN_OPTION_SHA256: trace.unknownOptionSha256,
      UNKNOWN_OPTION_SAFE_CLASS: trace.unknownOptionSafeClass,
      UNKNOWN_OPTION_MATCHES_ALLOW_FILE_ACCESS_FROM_FILES: trace.unknownOptionMatchesAllowFileAccessFromFiles,
      UNKNOWN_OPTION_MATCHES_ORIGINAL_PROCESS_START_TIME_PREFIX: trace.unknownOptionMatchesOriginalProcessStartTimePrefix,
      UNKNOWN_OPTION_MATCHES_OTHER_PROVEN_LAUNCHER_FLAG: trace.unknownOptionMatchesOtherProvenLauncherFlag,
      SIDE_EFFECT_COUNTS: trace.sideEffectCounts
    };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    logger.info("PLATFORM_SELF_TEST", "TASK10S_ATTEMPT3_DISPATCH_TRACE_WRITTEN", "Task10S Attempt 3 dispatch dry-run trace 已写入", { action: RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN, evidencePath, actionParseResult: trace.actionParseResult, dispatchEntered: trace.dispatchEntered, dryRunHandlerReached: trace.dryRunHandlerReached, sideEffectCounts: trace.sideEffectCounts });
  };
  fixedDiagnosticActionRunner = ordinaryPilot || formalPilot ? null : createFixedDiagnosticRunner({
    probe: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_CANONICAL_PAGE_RUNTIME_PROBE_TRIGGER_RECEIVED", "收到固定非 UI 小红书 canonical Page probe trigger", { action: PROBE_XHS_CANONICAL_PAGE, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectCanonicalXhsPageRuntime(resolveXhsAccountId());
    },
    writeEvidence: writeProbeEvidence,
    inspectContextPages: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_CONTEXT_PAGE_INVENTORY_TRIGGER_RECEIVED", "收到固定非 UI 小红书 Context Page inventory trigger", { action: INSPECT_XHS_CONTEXT_PAGES, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectXhsContextPages(resolveXhsAccountId());
    },
    writeContextPageEvidence,
    inspectPublishEntryDom: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_ENTRY_DOM_TRIGGER_RECEIVED", "收到固定非 UI 小红书 publish-entry bounded DOM diagnostic trigger", { action: INSPECT_XHS_PUBLISH_ENTRY_DOM, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectXhsPublishEntryDom(resolveXhsAccountId());
    },
    writePublishEntryDomEvidence,
    inspectPostUploadReconciliation: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_POST_UPLOAD_RECONCILIATION_TRIGGER_RECEIVED", "收到固定非 UI 小红书 post-upload reconciliation trigger", { action: INSPECT_XHS_POST_UPLOAD_RECONCILIATION, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectCurrentXiaohongshuPostUploadReconciliation(resolveXhsAccountId());
    },
    writePostUploadReconciliationEvidence,
    inspectPostUploadTerminalReadiness: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_POST_UPLOAD_TERMINAL_READINESS_TRIGGER_RECEIVED", "收到固定非 UI 小红书 post-upload terminal readiness trigger", { action: INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectCurrentXiaohongshuPostUploadTerminalReadiness(resolveXhsAccountId());
    },
    writePostUploadTerminalReadinessEvidence,
    inspectFileInputState: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_FILE_INPUT_STATE_TRIGGER_RECEIVED", "收到固定非 UI 小红书 file-input state trigger", { action: INSPECT_XHS_FILE_INPUT_STATE, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectCurrentXiaohongshuFileInputState(resolveXhsAccountId());
    },
    writeFileInputEvidence,
    inspectFinalSubmitDom: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_FINAL_SUBMIT_DOM_TRIGGER_RECEIVED", "收到固定非 UI 小红书 final-submit bounded DOM diagnostic trigger", { action: INSPECT_XHS_FINAL_SUBMIT_DOM, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectCurrentXiaohongshuPublishEditorSemanticCandidates(resolveXhsAccountId());
    },
    writeFinalSubmitDomEvidence,
    inspectGlobalExactPublishDom: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_GLOBAL_EXACT_PUBLISH_DOM_TRIGGER_RECEIVED", "收到固定非 UI 小红书 document-global exact 发布只读 diagnostic trigger", { action: INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectCurrentXiaohongshuGlobalExactPublishDom(resolveXhsAccountId());
    },
    writeGlobalExactPublishDomEvidence,
    inspectClosedShadowFinalSubmit: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_CLOSED_SHADOW_FINAL_SUBMIT_TRIGGER_RECEIVED", "收到固定非 UI 小红书 closed-shadow final-submit 只读 diagnostic trigger", { action: INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT, accountId: resolveXhsAccountId() });
      return platformSelfTests.inspectCurrentXiaohongshuClosedShadowFinalSubmit(resolveXhsAccountId());
    },
    writeClosedShadowFinalSubmitEvidence,
    establishXhsContextIdentityAttestation: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_CONTEXT_IDENTITY_ATTESTATION_TRIGGER_RECEIVED", "收到固定 Main-side 小红书 Context-bound identity attestation trigger", { action: ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION, accountId: resolveXhsAccountId() });
      return platformSelfTests.establishXhsContextIdentityAttestation();
    },
    writeXhsContextIdentityAttestationEvidence,
    ensureXhsIdentityPage: async () => {
      logger.info("PLATFORM_SELF_TEST", "XHS_IDENTITY_PAGE_ENSURE_TRIGGER_RECEIVED", "收到固定 Main-side 小红书 identity Page ensure trigger", { action: RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE, accountId: resolveXhsAccountId() });
      return platformSelfTests.ensureXhsIdentityPage(resolveXhsAccountId());
    },
    writeXhsIdentityPageEnsureEvidence,
    runTask10sControlledUploadAttempt3: async () => {
      logger.info("PLATFORM_SELF_TEST", "TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_TRIGGER_RECEIVED", "收到固定 Main-side Task10S Attempt 3 trigger", { action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, accountId: resolveXhsAccountId() });
      return platformSelfTests.runTask10sControlledUploadAttempt3();
    },
    writeTask10sControlledUploadAttempt3Evidence,
    runTask10sControlledUploadAttempt4: async () => {
      logger.info("PLATFORM_SELF_TEST", "TASK10S_CONTROLLED_UPLOAD_ATTEMPT4_TRIGGER_RECEIVED", "收到固定 Main-side Task10S Attempt 4 trigger", { action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4, accountId: resolveXhsAccountId() });
      return platformSelfTests.runTask10sControlledUploadAttempt4();
    },
    writeTask10sControlledUploadAttempt4Evidence,
    runTask10sControlledUploadAttempt5: async () => {
      logger.info("PLATFORM_SELF_TEST", "TASK10S_CONTROLLED_UPLOAD_ATTEMPT5_TRIGGER_RECEIVED", "收到固定 Main-side Task10S Attempt 5 trigger", { action: RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5, accountId: resolveXhsAccountId() });
      return platformSelfTests.runTask10sControlledUploadAttempt5();
    },
    writeTask10sControlledUploadAttempt5Evidence,
    runTask10sCompleteRetainedEditor: async (testRunId) => {
      logger.info("PLATFORM_SELF_TEST", "TASK10S_COMPLETE_RETAINED_EDITOR_TRIGGER_RECEIVED", "收到固定 Main-side Task10S retained-editor completion trigger", { action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, accountId: resolveXhsAccountId() });
      return testRunId ? platformSelfTests.runTask10sCompleteRetainedEditor(testRunId) : platformSelfTests.runTask10sCompleteRetainedEditor("__explicit_target_required__");
    },
    writeTask10sCompleteRetainedEditorEvidence,
    armTask10sRun: (testRunId) => platformSelfTests.armTask10sRun(testRunId),
    writeTask10sArmRunEvidence,
    armTask10sFreshCompletion: () => platformSelfTests.armTask10sFreshCompletion(),
    writeTask10sFreshCompletionArmEvidence: (result) => {
      mkdirSync(evidenceDirectory, { recursive: true });
      const timestamp = new Date().toISOString();
      const evidencePath = join(evidenceDirectory, `xiaohongshu-task10s-fresh-completion-arm-${timestamp.replace(/[:.]/gu, "-")}.json`);
      writeFileSync(evidencePath, JSON.stringify({ timestamp, ...result }, null, 2), "utf8");
      logger.info("PLATFORM_SELF_TEST", "TASK10S_FRESH_COMPLETION_ARM_EVIDENCE_WRITTEN", "ARM 结果已写入；不自动执行 completion", { evidencePath, ...result });
    },
    runTask10sFreshPublishFlow: async (testRunId) => {
      logger.info("PLATFORM_SELF_TEST", "TASK10S_FRESH_PUBLISH_FLOW_TRIGGER_RECEIVED", "收到固定 Main-side Task10S fresh publish flow trigger", { action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, accountId: resolveXhsAccountId() });
      return platformSelfTests.runTask10sFreshPublishFlow(undefined, testRunId);
    },
    writeTask10sFreshPublishFlowEvidence,
    recoverTask10sPreparedEditor: async (testRunId) => {
      logger.info("PLATFORM_SELF_TEST", "TASK10S_PREPARED_EDITOR_RECOVERY_TRIGGER_RECEIVED", "收到固定 Main-side Prepared Job 编辑器恢复 trigger", { action: RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, accountId: resolveXhsAccountId() });
      return testRunId ? platformSelfTests.recoverTask10sPreparedEditor(testRunId) : platformSelfTests.recoverTask10sPreparedEditor("__explicit_target_required__");
    },
    writeTask10sPreparedEditorRecoveryEvidence,
    runTask10sAttempt3DispatchDryRun: () => platformSelfTests.runTask10sAttempt3DispatchDryRun(),
    writeTask10sAttempt3DispatchDryRunEvidence: (trace) => writeTask10sAttempt3DispatchDryRunEvidence?.(trace)
  });
  const pendingDiagnosticAction = queuedDiagnosticAction;
  const pendingDiagnosticInvocationContext = queuedDiagnosticInvocationContext;
  queuedDiagnosticAction = null;
  queuedDiagnosticInvocationContext = undefined;
  if (pendingDiagnosticAction) void runFixedDiagnosticAction(pendingDiagnosticAction, pendingDiagnosticInvocationContext);
  if (!ordinaryPilot && !scopedLive && !formalPilot) scheduler.start();

  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f4f6f9",
    webPreferences: { preload: join(__dirname, "../preload/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.on("close", () => shutdownCoordinator.record("WINDOW_CLOSE_REQUESTED"));
  window.on("closed", () => shutdownCoordinator.record("WINDOW_DESTROYED"));
  if (!ordinaryPilot && !scopedLive && !formalPilot && process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(join(__dirname, "../renderer/index.html"));
}

function runFixedDiagnosticAction(action: DiagnosticAction, context?: FixedDiagnosticInvocationContext): Promise<boolean> {
  if (ordinaryPilot || scopedLive || formalPilot || !fixedDiagnosticActionRunner) return Promise.resolve(false);
  if (diagnosticRunInFlight) return diagnosticRunInFlight;
  diagnosticRunInFlight = fixedDiagnosticActionRunner(action, context).catch((error: unknown) => {
    processDiagnostics.record("TASK10W_FIXED_DIAGNOSTIC_FAILED", { action, errorType: error instanceof Error ? error.name : "UnknownError" });
    return false;
  }).finally(() => { diagnosticRunInFlight = null; });
  return diagnosticRunInFlight;
}

if (primaryInstanceLockAcquired) {
  app.on("second-instance", (_event, commandLine, _workingDirectory, additionalData) => {
    if (ordinaryPilot || scopedLive || formalPilot) return;
    const receivedTrace = buildSecondInstanceDispatchTrace(commandLine, process.pid);
    processDiagnostics.record("TASK10S_ATTEMPT3_DISPATCH_SECOND_INSTANCE_RECEIVED", {
      activeMainPid: receivedTrace.activeMainPid,
      timestamp: receivedTrace.timestamp,
      argvCount: receivedTrace.argvCount,
      rawArgvSafe: receivedTrace.rawArgvSafe,
      normalizedArgvSafe: receivedTrace.normalizedArgvSafe,
      removedLauncherArgumentsSafe: receivedTrace.removedLauncherArgumentsSafe,
      expectedDryRunActionPresentRaw: receivedTrace.expectedDryRunActionPresentRaw,
      expectedDryRunActionPresentNormalized: receivedTrace.expectedDryRunActionPresentNormalized
    });
    const parsed = parseDiagnosticActionWithTrace(commandLine, additionalData);
    if (!parsed.action) {
      if (receivedTrace.expectedDryRunActionPresentRaw === "YES" || receivedTrace.expectedDryRunActionPresentNormalized === "YES") writeTask10sAttempt3DispatchDryRunEvidence?.(parsed.trace);
      return;
    }
    const action = parsed.action;
    processDiagnostics.record("TASK10W_FIXED_DIAGNOSTIC_SECOND_INSTANCE", { action, commandLineArgCount: commandLine.length });
    if (!fixedDiagnosticActionRunner) {
      if (queuedDiagnosticAction === null) {
        queuedDiagnosticAction = action;
        queuedDiagnosticInvocationContext = action === RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN
          ? { dispatchTrace: parsed.trace }
          : (action === RUN_XHS_TASK10S_ARM_RUN || action === RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW || action === RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY || action === RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR) && parsed.testRunId ? { testRunId: parsed.testRunId } : undefined;
      }
      return;
    }
    void runFixedDiagnosticAction(action, action === RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN
      ? { dispatchTrace: parsed.trace }
      : (action === RUN_XHS_TASK10S_ARM_RUN || action === RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW || action === RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY || action === RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR) && parsed.testRunId ? { testRunId: parsed.testRunId } : undefined);
  });
}

if (!primaryInstanceLockAcquired) {
  app.quit();
} else if (!ordinaryPilot && !scopedLive && !formalPilot && process.env.PUBLISHER_BENCHMARK_MODE === "deepseek") {
  void app.whenReady().then(runDeepSeekBenchmarkMode).catch((error: unknown) => {
    processDiagnostics.record("DEEPSEEK_BENCHMARK_FAILED", { error });
    app.quit();
  }).finally(() => app.quit());
} else {
  void app.whenReady().then(async () => {
    ordinaryPilot?.installNetworkPolicy();
    await createWindow();
    app.on("activate", () => { if (!scopedLive && !formalPilot && BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  }).catch((error: unknown) => {
    processDiagnostics.record("APP_START_FAILED", { error });
    app.quit();
  });
}

app.on("before-quit", (event) => shutdownCoordinator.handleBeforeQuit(event, () => app.quit()));

app.on("window-all-closed", () => { shutdownCoordinator.record("WINDOW_DESTROYED"); if (process.platform !== "darwin") app.quit(); });
app.on("will-quit", () => shutdownCoordinator.markMainExit());
