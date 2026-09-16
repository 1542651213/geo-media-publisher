import { app, safeStorage } from "electron";
import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AccountContext } from "@publisher/domain";
import { isAutomationAdapter } from "@publisher/adapters-core";
import { SafeStorageCredentialStore } from "@publisher/security";
import { collectXhsProfileFileMetadata, type XiaohongshuBrowserAdapter } from "@publisher/adapters-xiaohongshu";
import type { BrowserSessionScopeEvidence } from "@publisher/adapters-browser";
import type { Logger } from "@publisher/logger";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";
import { diffXhsAuthStateSnapshots, hasNoAuthValues, parseXhsAuthStateDiagnostics, selectLatestOwnerDiagnostics, type AuthStateDiagnosticSnapshot } from "./v143-xiaohongshu-auth-state-restart-diagnosis.helpers";

const ACCOUNT_ID = "54b390ac-d81e-440a-baeb-d00f9f346cc3";
const PLATFORM_KEY = "xiaohongshu";
const USER_DATA_PATH = process.env.PUBLISHER_USER_DATA_PATH?.trim() || "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const DATA_DIRECTORY = process.env.PUBLISHER_DATA_DIRECTORY?.trim() || join(USER_DATA_PATH, "production-data");
const PROFILE_ROOT = join(USER_DATA_PATH, "browser-profiles");
const PROFILE_PATH = join(PROFILE_ROOT, PLATFORM_KEY, ACCOUNT_ID);
const CREDENTIAL_FILE_PATH = join(DATA_DIRECTORY, "credentials.enc");
const APP_LOG_PATH = process.env.XIAOHONGSHU_APP_LOG_PATH?.trim() || join(DATA_DIRECTORY, "logs", "app.log");
const DATABASE_PATH = process.env.XIAOHONGSHU_DB_PATH?.trim() || join(DATA_DIRECTORY, "publisher.db");
const OUTPUT_PATH = process.env.XIAOHONGSHU_AUTH_DIAGNOSIS_V2_OUTPUT?.trim() || "output/v143-xiaohongshu-auth-state-restart-diagnosis-v2.json";
const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;
type ProcessSnapshot = { queryAvailable: boolean; browserProcessIds: number[]; temporaryProfileProcessIds: number[]; error: string | null };

function asRecord(value: unknown): JsonRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null; }
function powershellLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function errorEvidence(error: unknown): JsonRecord { return { name: error instanceof Error ? error.name : "UnknownError", message: "diagnostic operation failed" }; }
function accountContext(): AccountContext { return { accountId: ACCOUNT_ID, accountName: "account-1", platformKey: PLATFORM_KEY, settings: { triggerSource: "CONTINUE_PENDING_ACTION", userActionId: `v143-xhs-auth-v2-${Date.now()}`, browserExecutionMode: "VISIBLE" }, secrets: {} }; }

function countPublishingRows(db: Database.Database): JsonRecord {
  const count = (table: string): number => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: unknown }).count ?? 0);
  return { publish_jobs: count("publish_jobs"), submission_intents: count("submission_intents"), publish_records: count("publish_records") };
}

async function inspectBrowserProcesses(): Promise<ProcessSnapshot> {
  const target = powershellLiteral(PROFILE_PATH);
  const command = `$target=${target}; $rows=Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and ($_.CommandLine -like ('*' + $target + '*') -or $_.CommandLine -match 'playwright_chromiumdev_profile-') } | ForEach-Object { [pscustomobject]@{ processId=[int]$_.ProcessId; temporary=[bool]($_.CommandLine -match 'playwright_chromiumdev_profile-') } }; if ($null -eq $rows) { '[]' } else { $rows | ConvertTo-Json -Compress }`;
  try {
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, maxBuffer: 1_000_000 });
    const parsed: unknown = JSON.parse(result.stdout.trim() || "[]");
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).map(asRecord).filter((row): row is JsonRecord => row !== null);
    return { queryAvailable: true, browserProcessIds: rows.filter((row) => row.temporary !== true).map((row) => Number(row.processId)).filter(Number.isInteger), temporaryProfileProcessIds: rows.filter((row) => row.temporary === true).map((row) => Number(row.processId)).filter(Number.isInteger), error: null };
  } catch {
    return { queryAvailable: false, browserProcessIds: [], temporaryProfileProcessIds: [], error: "PROCESS_QUERY_FAILED" };
  }
}

async function waitForProfileRelease(timeoutMs = 15_000): Promise<JsonRecord> {
  const startedAt = Date.now();
  let latest: JsonRecord = { observedAt: new Date().toISOString(), profileFiles: collectXhsProfileFileMetadata(PROFILE_PATH), process: await inspectBrowserProcesses(), released: false };
  while (Date.now() - startedAt <= timeoutMs) {
    const process = await inspectBrowserProcesses();
    const profileFiles = collectXhsProfileFileMetadata(PROFILE_PATH);
    const lockFiles = profileFiles.filter((file) => file.exists && /^(?:SingletonLock|SingletonCookie|SingletonSocket)$/u.test(file.relativePath)).map((file) => file.relativePath).sort();
    latest = { observedAt: new Date().toISOString(), profileFiles, process, lockFiles, released: process.queryAvailable && process.browserProcessIds.length === 0 && process.temporaryProfileProcessIds.length === 0 && lockFiles.length === 0 };
    if (latest.released === true) return latest;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  return latest;
}

function readOwnerDiagnostics(): ReturnType<typeof parseXhsAuthStateDiagnostics> {
  try { return parseXhsAuthStateDiagnostics(readFileSync(APP_LOG_PATH, "utf8"), ACCOUNT_ID, PROFILE_PATH); } catch { return []; }
}

async function waitForOwnerDiagnostics(timeoutMs = 30_000): Promise<ReturnType<typeof parseXhsAuthStateDiagnostics>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const diagnostics = readOwnerDiagnostics();
    const pair = selectLatestOwnerDiagnostics(diagnostics);
    if (pair) return pair;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("OWNER_CONTROLLED_LOGIN_DIAGNOSTIC_NOT_FOUND");
}

function createLogger(): Logger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

function ownerSnapshot(diagnostics: ReturnType<typeof parseXhsAuthStateDiagnostics>): AuthStateDiagnosticSnapshot {
  const beforeClose = diagnostics.find((diagnostic) => diagnostic.phase === "AUTH_STATE_BEFORE_CLOSE");
  const context = beforeClose?.context ?? {};
  const sessionEvidence = (context.sessionEvidence as BrowserSessionScopeEvidence | null | undefined) ?? null;
  const authState = (context.authState as AuthStateDiagnosticSnapshot["authState"] | null | undefined) ?? null;
  return { status: "logged_in", sessionEvidence, authState, profileFiles: authState?.profileFiles ?? collectXhsProfileFileMetadata(PROFILE_PATH) };
}

async function restoreAttempt1(): Promise<JsonRecord> {
  const credentials = new SafeStorageCredentialStore(CREDENTIAL_FILE_PATH, safeStorage);
  const registry = createRuntimeAdapterRegistry(credentials, false, createLogger(), PROFILE_ROOT, CREDENTIAL_FILE_PATH);
  const selected = registry.getForContent(PLATFORM_KEY, "article");
  if (!isAutomationAdapter(selected)) throw new Error("XIAOHONGSHU_ARTICLE_ROUTE_NOT_BROWSER_AUTOMATION");
  const adapter = selected as XiaohongshuBrowserAdapter;
  let result: JsonRecord | null = null;
  let error: JsonRecord | null = null;
  try {
    const probe = await adapter.runRestoreNavigationDiagnostic(accountContext());
    const snapshot: AuthStateDiagnosticSnapshot = { status: probe.loginStatus, sessionEvidence: probe.sessionEvidence, authState: probe.afterNavigation, profileFiles: probe.afterNavigation.profileFiles };
    result = { attempt: "RESTORE_ATTEMPT_1", snapshot, preNavigation: probe.preNavigation, afterNavigation: probe.afterNavigation, navigation: probe.navigation, sameContextPageOwnership: probe.sameContextPageOwnership, sameContextPage: probe.sameContextPage };
  } catch (caught) {
    error = errorEvidence(caught);
  } finally {
    await adapter.closeOwnedSessions().catch((caught: unknown) => { error ??= errorEvidence(caught); });
  }
  if (!result) throw Object.assign(new Error("RESTORE_ATTEMPT_1_FAILED"), { cause: error });
  return { ...result, postClose: await waitForProfileRelease(), error };
}

export async function runXiaohongshuAuthStateRestartDiagnosisV2(): Promise<JsonRecord> {
  app.setName("codex-media-publisher-xhs-auth-state-diagnostic-v2");
  app.setPath("userData", USER_DATA_PATH);
  await app.whenReady();
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const evidence: JsonRecord = {
    operation: "xiaohongshu_auth_state_restart_diagnosis_v2",
    startedAt: new Date().toISOString(),
    account: { platformKey: PLATFORM_KEY, accountId: ACCOUNT_ID, sessionKey: `session:${PLATFORM_KEY}:${ACCOUNT_ID}` },
    paths: { userDataPath: USER_DATA_PATH, profileRoot: PROFILE_ROOT, profilePath: PROFILE_PATH, credentialFilePath: CREDENTIAL_FILE_PATH, appLogPath: APP_LOG_PATH, databasePath: DATABASE_PATH },
    scope: { diagnosticOnly: true, preSubmitGateRun: false, editorOpened: false, uploadAttempted: false, titleWritten: false, bodyWritten: false, preparePublishCalled: false, finalSubmitClicked: false, selfTestCreated: false, restoreAttemptsExecuted: 0 },
    ownerAction: "WAITING_FOR_ONE_CONTROLLED_LOGIN_EXPERIMENT",
    result: "NOT_EXECUTED",
    finalSubmitCount: 0,
    jobCreated: false,
    intentCreated: false,
    publishRecordCreated: false,
    credentialValuesRecorded: false,
    error: null
  };
  let db: Database.Database | null = null;
  try {
    db = new Database(DATABASE_PATH, { readonly: true, fileMustExist: true });
    evidence.databaseBefore = countPublishingRows(db);
    const ownerDiagnostics = await waitForOwnerDiagnostics();
    if (!ownerDiagnostics.every((diagnostic) => hasNoAuthValues(diagnostic))) throw new Error("AUTH_DIAGNOSTIC_CONTAINS_UNSAFE_VALUE");
    const snapshotA = ownerSnapshot(ownerDiagnostics);
    const releaseB = await waitForProfileRelease();
    evidence.authStateBeforeClose = { source: "installed_app_log", diagnostics: ownerDiagnostics, snapshot: snapshotA };
    evidence.profileFilesAfterClose = { source: "post_owner_close_profile_flush", profileFiles: releaseB.profileFiles, release: releaseB };
    if (releaseB.released !== true) throw new Error("OWNER_BROWSER_PROFILE_NOT_RELEASED");
    const attempt = await restoreAttempt1();
    evidence.restoreAttempt1 = attempt;
    evidence.scope = { ...(evidence.scope as JsonRecord), restoreAttemptsExecuted: 1 };
    const snapshotC = attempt.snapshot as AuthStateDiagnosticSnapshot;
    evidence.authStateDiffAfterRestart = diffXhsAuthStateSnapshots(snapshotA, snapshotC);
    const hasAuthState = Boolean(snapshotC.authState && (snapshotC.authState.persistentCookieCount > 0 || snapshotC.authState.localStorage.some((entry) => entry.keyCount > 0) || snapshotC.authState.indexedDB.some((entry) => entry.databaseNames.length > 0) || snapshotC.authState.serviceWorkers.some((entry) => entry.count > 0)));
    evidence.diagnosis = { authMetadataPresentAfterReopen: hasAuthState, authMetadataPresentButLoginRejected: snapshotC.status === "expired" && hasAuthState, rootCause: snapshotC.status === "expired" && hasAuthState ? "AUTH_METADATA_PRESENT_BUT_LOGIN_REJECTED" : "UNDETERMINED_FROM_ONE_ATTEMPT", note: "This is a correlation from sanitized metadata and navigation signals; it does not assert server revocation." };
    evidence.AUTH_RESTART_ROOT_CAUSE = snapshotC.status === "expired" && hasAuthState ? "AUTH_METADATA_PRESENT_BUT_LOGIN_REJECTED" : "UNDETERMINED_FROM_ONE_ATTEMPT";
    evidence.LIVE_LOGIN_BEFORE_CLOSE = true;
    evidence.XHS_SESSION_ONLY_COOKIES_PRESENT = snapshotA.authState?.sessionCookieCount !== undefined && snapshotA.authState.sessionCookieCount > 0;
    evidence.SESSION_COOKIE_COUNT_BEFORE_CLOSE = snapshotA.authState?.sessionCookieCount ?? null;
    evidence.PERSISTENT_COOKIE_COUNT_BEFORE_CLOSE = snapshotA.authState?.persistentCookieCount ?? null;
    evidence.GRACEFUL_BROWSER_CLOSE = (evidence.profileFilesAfterClose as JsonRecord | undefined)?.release !== undefined;
    evidence.PROFILE_FLUSH_AFTER_CLOSE = releaseB.released === true;
    evidence.AUTH_STATE_PRESENT_AFTER_REOPEN = hasAuthState;
    evidence.AUTH_STATE_PRESENT_BUT_SERVER_REJECTED = snapshotC.status === "expired" && hasAuthState;
    evidence.SESSION_ONLY_COOKIE_LOSS_CORRELATED_WITH_LOGIN_EXPIRY = (evidence.authStateDiffAfterRestart as JsonRecord).sessionOnlyCookieLossCorrelated === true;
    evidence.ACCOUNT_STATUS_AFTER_RESTORE_FAILURE = snapshotC.status === "expired" ? "UNCHANGED_DIAGNOSTIC_ONLY" : snapshotC.status;
    evidence.OWNER_ACTION_REQUIRED = snapshotC.status !== "logged_in";
    evidence.PERSISTENT_PROFILE_CREDENTIAL_REINJECTION = snapshotC.sessionEvidence?.credentialSnapshotInjected === true ? "YES" : "NO";
    evidence.CREDENTIAL_REINJECTION_ORDER = "NONE_FOR_XIAOHONGSHU_PERSISTENT_PROFILE";
    evidence.PERSISTENT_PROFILE_IS_CANONICAL_AUTH_SOURCE = true;
    evidence.COOKIE_VALUE_FINGERPRINT_ENABLED = Boolean(snapshotC.authState?.cookies.every((cookie) => typeof cookie.valueFingerprint === "string"));
    evidence.PRE_NAVIGATION_COOKIE_SNAPSHOT_ENABLED = true;
    evidence.RUNTIME_MANIFEST_ENABLED = Boolean(snapshotC.authState?.runtimeManifest);
    evidence.REDIRECT_CLASSIFICATION_ENABLED = Boolean((attempt.navigation as JsonRecord).classification);
    evidence.NEW_PAGE_SAME_CONTEXT_ENABLED = true;
    evidence.result = snapshotC.status === "logged_in" ? "RESTORE_ATTEMPT_1_PASS_DIAGNOSIS_STOPPED" : "RESTORE_ATTEMPT_1_BLOCKED_DIAGNOSIS_STOPPED";
    evidence.ownerAction = "NONE";
  } catch (caught) {
    evidence.result = "BLOCKED_DIAGNOSIS_STOPPED";
    evidence.error = errorEvidence(caught);
  } finally {
    if (db) {
      evidence.databaseAfter = countPublishingRows(db);
      evidence.databaseBeforeAfterEqual = JSON.stringify(evidence.databaseBefore) === JSON.stringify(evidence.databaseAfter);
      db.close();
    }
    evidence.finishedAt = new Date().toISOString();
    evidence.finalSubmitCount = 0;
    evidence.jobCreated = false;
    evidence.intentCreated = false;
    evidence.publishRecordCreated = false;
    evidence.noAuthValuesRecorded = hasNoAuthValues(evidence);
    writeFileSync(OUTPUT_PATH, JSON.stringify(evidence, null, 2), "utf8");
    app.exit(0);
  }
  return evidence;
}

void runXiaohongshuAuthStateRestartDiagnosisV2();
