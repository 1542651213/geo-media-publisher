import { app, safeStorage } from "electron";
import { execFile } from "node:child_process";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { join } from "node:path";
import type { AccountContext, LoginStatus } from "@publisher/domain";
import { isAutomationAdapter, type AutomationAdapter } from "@publisher/adapters-core";
import { SafeStorageCredentialStore } from "@publisher/security";
import { collectXhsProfileFileMetadata, type XhsAuthStateMetadata } from "@publisher/adapters-xiaohongshu";
import type { BrowserSessionScopeEvidence } from "@publisher/adapters-browser";
import type { Logger } from "@publisher/logger";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";
import { diffXhsAuthStateSnapshots, hasNoAuthValues, parseXhsAuthStateDiagnostics, type AuthStateDiagnosticSnapshot } from "./v143-xiaohongshu-auth-state-restart-diagnosis.helpers";

const ACCOUNT_ID = "54b390ac-d81e-440a-baeb-d00f9f346cc3";
const PLATFORM_KEY = "xiaohongshu";
const USER_DATA_PATH = process.env.PUBLISHER_USER_DATA_PATH?.trim() || "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const DATA_DIRECTORY = process.env.PUBLISHER_DATA_DIRECTORY?.trim() || join(USER_DATA_PATH, "production-data");
const PROFILE_ROOT = join(USER_DATA_PATH, "browser-profiles");
const PROFILE_PATH = join(PROFILE_ROOT, PLATFORM_KEY, ACCOUNT_ID);
const CREDENTIAL_FILE_PATH = join(DATA_DIRECTORY, "credentials.enc");
const APP_LOG_PATH = process.env.XIAOHONGSHU_APP_LOG_PATH?.trim() || join(DATA_DIRECTORY, "logs", "app.log");
const DATABASE_PATH = process.env.XIAOHONGSHU_DB_PATH?.trim() || join(DATA_DIRECTORY, "publisher.db");
const OUTPUT_PATH = process.env.XIAOHONGSHU_AUTH_DIAGNOSIS_OUTPUT?.trim() || "output/v143-xiaohongshu-auth-state-restart-diagnosis.json";
const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;
type ProcessSnapshot = { queryAvailable: boolean; browserProcessIds: number[]; temporaryProfileProcessIds: number[]; error: string | null };
type ReleaseSnapshot = { observedAt: string; profileFiles: ReturnType<typeof collectXhsProfileFileMetadata>; process: ProcessSnapshot; lockFiles: string[]; released: boolean };

function asRecord(value: unknown): JsonRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null; }

function errorEvidence(error: unknown): JsonRecord {
  return { name: error instanceof Error ? error.name : "UnknownError", code: error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : null, message: "diagnostic operation failed" };
}

function accountContext(): AccountContext {
  return { accountId: ACCOUNT_ID, accountName: "account-1", platformKey: PLATFORM_KEY, settings: { triggerSource: "CONTINUE_PENDING_ACTION", userActionId: `v143-xhs-auth-restore-${Date.now()}`, browserExecutionMode: "VISIBLE" }, secrets: {} };
}

function countPublishingRows(db: Database.Database): JsonRecord {
  const count = (table: string): number => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: unknown }).count ?? 0);
  return { publish_jobs: count("publish_jobs"), submission_intents: count("submission_intents"), publish_records: count("publish_records") };
}

function powershellLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

async function inspectBrowserProcesses(): Promise<ProcessSnapshot> {
  const command = `$target=${powershellLiteral(PROFILE_PATH)}; $rows=Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and ($_.CommandLine -like ('*' + $target + '*') -or $_.CommandLine -match 'playwright_chromiumdev_profile-') } | ForEach-Object { [pscustomobject]@{ processId=[int]$_.ProcessId; temporary=[bool]($_.CommandLine -match 'playwright_chromiumdev_profile-') } }; if ($null -eq $rows) { '[]' } else { $rows | ConvertTo-Json -Compress }`;
  try {
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, maxBuffer: 1_000_000 });
    const parsed: unknown = JSON.parse(result.stdout.trim() || "[]");
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).map(asRecord).filter((row): row is JsonRecord => row !== null);
    return {
      queryAvailable: true,
      browserProcessIds: rows.filter((row) => row.temporary !== true).map((row) => Number(row.processId)).filter(Number.isInteger),
      temporaryProfileProcessIds: rows.filter((row) => row.temporary === true).map((row) => Number(row.processId)).filter(Number.isInteger),
      error: null
    };
  } catch {
    return { queryAvailable: false, browserProcessIds: [], temporaryProfileProcessIds: [], error: "PROCESS_QUERY_FAILED" };
  }
}

function lockFiles(files: ReturnType<typeof collectXhsProfileFileMetadata>): string[] { return files.filter((file) => file.exists && /^(?:SingletonLock|SingletonCookie|SingletonSocket)$/u.test(file.relativePath)).map((file) => file.relativePath).sort(); }

async function waitForProfileRelease(timeoutMs = 15_000): Promise<ReleaseSnapshot> {
  const startedAt = Date.now();
  let latest: ReleaseSnapshot = { observedAt: new Date().toISOString(), profileFiles: collectXhsProfileFileMetadata(PROFILE_PATH), process: await inspectBrowserProcesses(), lockFiles: [], released: false };
  while (Date.now() - startedAt <= timeoutMs) {
    const files = collectXhsProfileFileMetadata(PROFILE_PATH);
    const process = await inspectBrowserProcesses();
    const locks = lockFiles(files);
    latest = { observedAt: new Date().toISOString(), profileFiles: files, process, lockFiles: locks, released: process.queryAvailable && process.browserProcessIds.length === 0 && process.temporaryProfileProcessIds.length === 0 && locks.length === 0 };
    if (latest.released) return latest;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  return latest;
}

function readLogDiagnostics(): ReturnType<typeof parseXhsAuthStateDiagnostics> {
  try { return parseXhsAuthStateDiagnostics(readFileSync(APP_LOG_PATH, "utf8"), ACCOUNT_ID, PROFILE_PATH); } catch { return []; }
}

async function waitForOwnerDiagnostics(timeoutMs = 30_000): Promise<ReturnType<typeof parseXhsAuthStateDiagnostics>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const diagnostics = readLogDiagnostics();
    const live = diagnostics.find((diagnostic) => diagnostic.phase === "LIVE_LOGIN_BEFORE_CLOSE" && diagnostic.context.stableObservationPassed === true);
    const beforeClose = diagnostics.find((diagnostic) => diagnostic.phase === "AUTH_STATE_BEFORE_CLOSE");
    if (live && beforeClose) return [live, beforeClose];
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("OWNER_CONTROLLED_LOGIN_DIAGNOSTIC_NOT_FOUND");
}

function ownerSnapshot(diagnostics: ReturnType<typeof parseXhsAuthStateDiagnostics>): AuthStateDiagnosticSnapshot {
  const beforeClose = diagnostics.find((diagnostic) => diagnostic.phase === "AUTH_STATE_BEFORE_CLOSE");
  const context = beforeClose?.context ?? {};
  const sessionEvidence = (context.sessionEvidence as BrowserSessionScopeEvidence | null | undefined) ?? null;
  const authState = (context.authState as XhsAuthStateMetadata | null | undefined) ?? null;
  return { status: "logged_in", sessionEvidence, authState, profileFiles: authState?.profileFiles ?? collectXhsProfileFileMetadata(PROFILE_PATH) };
}

function createMemoryLogger(lifecycleEvents: JsonRecord[]): Logger {
  const write = (code: string, context: Record<string, unknown> | undefined): void => {
    if (code.startsWith("XHS_BROWSER_SESSION_")) lifecycleEvents.push(context ?? {});
  };
  return { info: (_module, code, _message, context) => write(code, context), warn: (_module, code, _message, context) => write(code, context), error: (_module, code, _message, context) => write(code, context) };
}

async function restoreAttempt(lifecycleEvents: JsonRecord[]): Promise<{ snapshot: AuthStateDiagnosticSnapshot; afterClose: ReleaseSnapshot; lifecycleEvents: JsonRecord[]; error: JsonRecord | null }> {
  const credentials = new SafeStorageCredentialStore(CREDENTIAL_FILE_PATH, safeStorage);
  const registry = createRuntimeAdapterRegistry(credentials, false, createMemoryLogger(lifecycleEvents), PROFILE_ROOT, CREDENTIAL_FILE_PATH);
  const selected = registry.getForContent(PLATFORM_KEY, "article");
  if (!isAutomationAdapter(selected)) throw new Error("XIAOHONGSHU_ARTICLE_ROUTE_NOT_BROWSER_AUTOMATION");
  const adapter: AutomationAdapter & { collectAuthStateMetadata?: (ctx: AccountContext) => Promise<XhsAuthStateMetadata | null> } = selected;
  const context = accountContext();
  let status: LoginStatus | "ERROR" = "ERROR";
  let sessionEvidence: BrowserSessionScopeEvidence | null = null;
  let authState: XhsAuthStateMetadata | null = null;
  let error: JsonRecord | null = null;
  try {
    status = await adapter.checkLogin(context);
    const rawSessionEvidence = await adapter.getBrowserSessionEvidence?.(context) ?? null;
    sessionEvidence = rawSessionEvidence as BrowserSessionScopeEvidence | null;
    authState = await adapter.collectAuthStateMetadata?.(context) ?? null;
  } catch (caught) {
    error = errorEvidence(caught);
  } finally {
    await adapter.closeOwnedSessions?.().catch((caught: unknown) => { error ??= errorEvidence(caught); });
  }
  const snapshot: AuthStateDiagnosticSnapshot = { status, sessionEvidence, authState, profileFiles: authState?.profileFiles ?? collectXhsProfileFileMetadata(PROFILE_PATH) };
  return { snapshot, afterClose: await waitForProfileRelease(), lifecycleEvents, error };
}

export async function runXiaohongshuAuthStateRestartDiagnosis(): Promise<JsonRecord> {
  app.setName("codex-media-publisher-xhs-auth-state-diagnostic");
  app.setPath("userData", USER_DATA_PATH);
  await app.whenReady();
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const startedAt = new Date().toISOString();
  const evidence: JsonRecord = {
    operation: "xiaohongshu_auth_state_restart_diagnosis_v143",
    startedAt,
    account: { platformKey: PLATFORM_KEY, accountId: ACCOUNT_ID, sessionKey: `session:${PLATFORM_KEY}:${ACCOUNT_ID}` },
    paths: { userDataPath: USER_DATA_PATH, profileRoot: PROFILE_ROOT, profilePath: PROFILE_PATH, credentialFilePath: CREDENTIAL_FILE_PATH, appLogPath: APP_LOG_PATH, databasePath: DATABASE_PATH },
    scope: { preSubmitGateRun: false, editorOpened: false, uploadAttempted: false, finalSubmitClicked: false, selfTestCreated: false },
    ownerAction: "WAITING_FOR_ONE_CONTROLLED_LOGIN_EXPERIMENT",
    result: "NOT_EXECUTED",
    finalSubmitCount: 0,
    jobCreated: false,
    intentCreated: false,
    publishRecordCreated: false,
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
    const snapshotB: AuthStateDiagnosticSnapshot = { status: "closed", sessionEvidence: snapshotA.sessionEvidence, authState: null, profileFiles: releaseB.profileFiles };
    evidence.snapshotA = { source: "installed_app_log", diagnostics: ownerDiagnostics, sessionEvidence: snapshotA.sessionEvidence, authState: snapshotA.authState, profileFiles: snapshotA.profileFiles };
    evidence.snapshotB = { source: "post_owner_close_profile_flush", sessionEvidence: null, authState: null, profileFiles: releaseB.profileFiles, release: releaseB };
    if (!releaseB.released) throw new Error("OWNER_BROWSER_PROFILE_NOT_RELEASED");
    const lifecycleEvents: JsonRecord[] = [];
    const attempt = await restoreAttempt(lifecycleEvents);
    const snapshotC = attempt.snapshot;
    evidence.restoreAttempt1 = { status: snapshotC.status, sessionEvidence: snapshotC.sessionEvidence, authState: snapshotC.authState, profileFiles: snapshotC.profileFiles, error: attempt.error, lifecycleEvents, postClose: attempt.afterClose };
    evidence.snapshotC = evidence.restoreAttempt1;
    evidence.diffAtoB = diffXhsAuthStateSnapshots(snapshotA, snapshotB);
    evidence.diffBtoC = diffXhsAuthStateSnapshots(snapshotB, snapshotC);
    evidence.diagnosis = {
      authStatePresentAfterReopen: (evidence.diffBtoC as JsonRecord).authStatePresentAfterReopen,
      authStatePresentButServerRejected: (evidence.diffBtoC as JsonRecord).authStatePresentButServerRejected,
      sessionOnlyCookieLossCorrelated: (evidence.diffBtoC as JsonRecord).sessionOnlyCookieLossCorrelated,
      runtimeMismatchDetected: (evidence.diffBtoC as JsonRecord).runtimeChanged || (evidence.diffBtoC as JsonRecord).browserChannelChanged || (evidence.diffBtoC as JsonRecord).headlessChanged || (evidence.diffBtoC as JsonRecord).profilePathChanged || (evidence.diffBtoC as JsonRecord).storageModeChanged,
      interpretation: "Flags are correlations from sanitized metadata and live login status; no root cause is patched by this runner."
    };
    evidence.result = snapshotC.status === "logged_in" && Boolean(attempt.afterClose.released) ? "RESTORE_ATTEMPT_1_PASS_DIAGNOSIS_STOPPED" : "RESTORE_ATTEMPT_1_BLOCKED_DIAGNOSIS_STOPPED";
    evidence.ownerAction = "NONE";
  } catch (caught) {
    evidence.result = "BLOCKED_DIAGNOSIS_STOPPED";
    evidence.error = errorEvidence(caught);
  } finally {
    if (db) {
      evidence.databaseAfter = countPublishingRows(db);
      const before = evidence.databaseBefore as JsonRecord | undefined;
      const after = evidence.databaseAfter as JsonRecord | undefined;
      evidence.databaseBeforeAfterEqual = Boolean(before && after && JSON.stringify(before) === JSON.stringify(after));
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

void runXiaohongshuAuthStateRestartDiagnosis();
