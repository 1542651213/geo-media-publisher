import { assertCurrentContentApproved, assertJobCurrentCompany } from "./content-review-authority";
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { createClosedSnapshot, type SnapshotIdentity } from "./backup-restore";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DraftFlushBarrier } from "./draft-flush-barrier";
import { resolveRuntimePaths } from "./runtime-paths";
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
import { b01CandidateCapabilityEnabled } from "./b01-candidate-capability";
import { OfficialApiAdapter } from "../../../../packages/adapters/official-api/src";
import { candidateGrantActive, readOfficialApiAcceptance } from "./official-api-candidate";
import { OfficialApiController } from "./official-api-controller";
import { SqliteOfficialApiOperationStore } from "./official-api-operation-store";
import { verifyOfficialApiPublicContent } from "./official-api-public-verifier";
import { readSprintAcceptance, SprintAcceptanceController } from "./sprint-acceptance";

app.setName("codex-media-publisher");
// Installed Candidate smoke must explicitly override Electron's cached userData path.
const runtimePaths = resolveRuntimePaths(app.getPath("userData"), process.env.GMP_B01_ISOLATED_USER_DATA_DIR, app.isPackaged || process.env.PUBLISHER_DATA_MODE === "production");
app.setPath("userData", runtimePaths.userData);
// Electron's lock is scoped to the resolved userData, before migrations or recovery.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => { const window = BrowserWindow.getAllWindows()[0]; if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
const processDiagnostics = createProcessDiagnostics(join(app.getPath("userData"), "production-data", "logs", "main-process-diagnostics.log"));
processDiagnostics.installProcessHandlers();

let scheduler: PersistentScheduler | null = null;
const ownedBrowserSessionClosers = new Set<() => Promise<void>>();
let shutdownStarted = false;
let shutdownReady = false;
const draftFlushBarrier = new DraftFlushBarrier();
const restoredExecutionPaused = existsSync(join(runtimePaths.userData, "restore-pending-owner-review.json"));
let pendingFullSnapshot: {directory:string;identity:SnapshotIdentity} | null = null;
let closeDatabase: (()=>void) | null = null;
const approvedWindowCloses = new WeakSet<BrowserWindow>();
ipcMain.on("drafts:flush-result", (event, requestId: unknown, success: unknown) => { draftFlushBarrier.respond(event.sender.id, requestId, success); });
async function flushWindowDrafts(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed() || approvedWindowCloses.has(window)) return true;
  return draftFlushBarrier.request(window.webContents.id, requestId => window.webContents.send("drafts:flush-request", requestId));
}

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
  const dataDirectory = runtimePaths.dataDirectory;
  const databasePath = runtimePaths.database;
  const database = openDatabase(databasePath, migrationsDir);
  closeDatabase = () => { if(database.db.open){database.db.pragma("wal_checkpoint(TRUNCATE)");database.db.close();} };
  const isDevelopment = isDevelopmentEnvironment(app.isPackaged);
  if (isDevelopment) database.repository.seedDevelopment(csvPath);
  else database.repository.seedPlatformCatalog(csvPath);
  const appLogPath = join(dataDirectory, "logs", "app.log");
  const logger = createFileLogger(appLogPath);
  recordAppStartup(logger, { pid: process.pid, packaged: app.isPackaged, userDataPath: app.getPath("userData"), productionDataPath: dataDirectory, appLogPath });
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const ordinaryDouyinEnabled = productPlatform("douyin")?.ordinaryPublishEnabled === true;
  const b01AcceptanceEnabled = !ordinaryDouyinEnabled && b01CandidateCapabilityEnabled(app.isPackaged, process.resourcesPath);
  const ordinaryWebsiteEnabled = productPlatform("website")?.ordinaryPublishEnabled === true;
  const officialApiGrants = readOfficialApiAcceptance(app.isPackaged, process.resourcesPath);
  const officialApiStore = new SqliteOfficialApiOperationStore(database.repository);
  const sprintAcceptance = new SprintAcceptanceController(readSprintAcceptance(app.isPackaged, process.resourcesPath), database.repository);
  const registry = createRuntimeAdapterRegistry(credentials, isDevelopment, logger, join(app.getPath("userData"), "browser-profiles"), join(dataDirectory, "credentials.enc"), {
    claimDouyinImageTextFileSelection: (input) => database.repository.claimDouyinImageTextFileSelection(input),
    // Main and Publisher retain the exact one-shot gate; the Adapter capability must be live before a new grant is requested.
    douyinImageTextNativeSubmitEnabled: ordinaryDouyinEnabled || b01AcceptanceEnabled,
    toutiaoBrowserNativeSubmitEnabled: productPlatform("toutiao")?.ordinaryPublishEnabled === true
      || sprintAcceptance.availability().some(grant => grant.platformKey === "toutiao"),
    officialApiOptions: { operationStore: officialApiStore, publicVerifier: verifyOfficialApiPublicContent,
      formalExecution: { available: ordinaryWebsiteEnabled || officialApiGrants.length > 0,
        ...(ordinaryWebsiteEnabled ? {} : { authorizationValid: () => officialApiGrants.some(candidateGrantActive),
          allowedBindings: officialApiGrants.map(({ accountId, articleId, contentBindingId }) => ({ accountId, articleId, contentBindingId })) }) } }
  });
  ownedBrowserSessionClosers.add(async () => {
    const closableAdapters = registry.listAll().filter((adapter): adapter is typeof adapter & { closeOwnedSessions(): Promise<void> } => typeof (adapter as { closeOwnedSessions?: unknown }).closeOwnedSessions === "function");
    await Promise.all(closableAdapters.map((adapter) => adapter.closeOwnedSessions()));
  });
  database.repository.syncAdapterManifests(registry.list().map((adapter) => ({ manifest: adapter.manifest, capabilities: adapter.getCapabilities() })));
  database.repository.reconcileAdapterRegistrations(registry.list().map((adapter) => adapter.platformKey));
  const resolveAccountSecrets = (accountId: string, platformKey: string): Record<string, string> => {
    const adapter = registry.get(platformKey);
    const keys = [...new Set([...adapter.getCredentialSchema().map((field) => field.key), "oauthAccessToken"])]
    return Object.fromEntries(keys.map((key) => [key, credentials.get(`account:${accountId}:${platformKey}:${key}`) ?? ""]));
  };
  const publisher = new PublisherService(database.repository, registry, logger, { resolveSecrets: resolveAccountSecrets, enforceB01ForDouyin: !ordinaryDouyinEnabled,
    assertContentApproval: job => { assertJobCurrentCompany(database.repository, job); assertCurrentContentApproved(database.repository, job.articleId); },
    assertFinalAuthorization: job => {
      if (["weibo", "toutiao", "sohu_media", "cnblogs"].includes(job.platformKey) && !productPlatform(job.platformKey)?.ordinaryPublishEnabled)
        sprintAcceptance.assertFinalJob(job);
    } });
  const officialApiAdapter = registry.get("website");
  if (!(officialApiAdapter instanceof OfficialApiAdapter)) throw new Error("WEBSITE_MAIN_ADAPTER_REQUIRED");
  const officialApi = new OfficialApiController({ repository: database.repository, credentials, store: officialApiStore,
    adapter: officialApiAdapter, ordinaryEnabled: ordinaryWebsiteEnabled, grants: officialApiGrants,
    assertWorkspace: (articleId, accountId) => {
      const repository = database.repository;
      const current = String(repository.getSettings().operationsWorkspaceCompanyId ?? repository.listBrands()[0]?.id ?? "");
      const binding = repository.db.prepare("SELECT company_id FROM operations_account_company_bindings WHERE account_id=?").get(accountId) as { company_id: string } | undefined;
      if (!current || repository.getArticle(articleId)?.brandId !== current || binding?.company_id !== current) throw new Error("企业工作区已切换，请重新选择当前企业的内容和账号");
    } });
  scheduler = new PersistentScheduler(database.repository, publisher, logger, 5_000, {
    allowAccountLoginSweep: () => false,
    allowScheduledJob: (job) => productPlatform(job.platformKey)?.batchPublishEnabled === true
      && operatorPublishBlockReason(job.platformKey, database.repository.listPlatforms().find((platform) => platform.platformKey === job.platformKey)) === null
  });
  registerIpc({ repository: database.repository, publisher, scheduler, registry, browserSessions: registry.browserSessionManager, b01AcceptanceEnabled, officialApi, sprintAcceptance, resolveAccountSecrets, dataDirectory, coverDir: join(dataDirectory, "covers"), logger, credentials, aiCredentials: credentials, appLogPath, databasePath, processDiagnostics, automaticExecutionDisabled: restoredExecutionPaused, queueClosedSnapshot: () => {
    if(pendingFullSnapshot)throw new Error("完整快照正在安排，请等待正常退出完成");
    const root=join(dirname(runtimePaths.userData),"geo-full-snapshots");mkdirSync(root,{recursive:true});
    const directory=join(root,`snapshot-${new Date().toISOString().replace(/[:.]/gu,"-")}`);
    pendingFullSnapshot={directory,identity:{appVersion:app.getVersion(),sourceCommit: "SOURCE_IDENTITY_PENDING",deliveryId:"R1.15-G",migrations:(database.db.prepare("SELECT id FROM migrations ORDER BY id").all() as {id:string}[]).map(row=>row.id)}};
    writeFileSync(directory+".status.json",JSON.stringify({status:"PendingClose",directory,createdAt:new Date().toISOString()}));
    setTimeout(()=>app.quit(),250);
    return {directory,status:"PendingClose" as const};
  }, restoreDatabase: (backupPath) => { scheduler?.stop(); restoreDatabaseSafely(database.db, databasePath, backupPath); app.relaunch(); app.exit(0); } });
  // The one-shot diagnostic process owns the sole publish lane; existing queued jobs remain untouched.
  if (!restoredExecutionPaused && process.env.TOUTIAO_MVP5_ONE_SHOT_ENABLED !== "true" && process.env.TOUTIAO_READONLY_PREFLIGHT !== "true"
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
  let closePending = false;
  window.on("close", event => {
    if (shutdownReady || approvedWindowCloses.has(window)) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    void flushWindowDrafts(window).then(success => {
      if (success && !window.isDestroyed()) { approvedWindowCloses.add(window); window.close(); }
      else processDiagnostics.record("DRAFT_CLOSE_BLOCKED", { reason: "draft persistence acknowledgement unavailable" });
    }).finally(() => { closePending = false; });
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
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void (async () => {
    const windows = BrowserWindow.getAllWindows();
    const saved = await Promise.all(windows.map(flushWindowDrafts));
    if (saved.some(success => !success)) { shutdownStarted = false; processDiagnostics.record("DRAFT_QUIT_BLOCKED", { reason: "draft save failed; window retained" }); return; }
    windows.forEach(window => approvedWindowCloses.add(window));
    scheduler?.stop();
    await Promise.all([...ownedBrowserSessionClosers].map(close => close()));
    closeDatabase?.();
    if(pendingFullSnapshot){
      const {directory,identity}=pendingFullSnapshot;
      try{const manifest=createClosedSnapshot(runtimePaths.userData,directory,identity,()=>BrowserWindow.getAllWindows().every(window=>approvedWindowCloses.has(window)));writeFileSync(directory+".status.json",JSON.stringify({status:"Complete",directory,createdAt:manifest.createdAt,totalBytes:manifest.totalBytes}));}
      catch(error){writeFileSync(directory+".status.json",JSON.stringify({status:"Incomplete",directory,error:error instanceof Error?error.message:"BACKUP_FAILED"}));processDiagnostics.record("FULL_SNAPSHOT_FAILED",{error});}
    }
    shutdownReady = true;
    app.quit();
  })().catch((error: unknown) => { shutdownStarted = false; processDiagnostics.record("APP_CLOSE_FAILED", { error }); });
});

app.on("window-all-closed", () => { scheduler?.stop(); if (process.platform !== "darwin") app.quit(); });
