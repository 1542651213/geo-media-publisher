import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountContext, LoginStatus } from "@publisher/domain";
import { isAutomationAdapter, type AutomationAdapter } from "@publisher/adapters-core";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";

const ACCOUNT_ID = "54b390ac-d81e-440a-baeb-d00f9f346cc3";
const PLATFORM_KEY = "xiaohongshu";
const USER_DATA_PATH = process.env.PUBLISHER_USER_DATA_PATH?.trim() || "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const DATA_DIRECTORY = process.env.PUBLISHER_DATA_DIRECTORY?.trim() || join(USER_DATA_PATH, "production-data");
const PROFILE_ROOT = join(USER_DATA_PATH, "browser-profiles");
const OUTPUT_PATH = process.env.XIAOHONGSHU_SESSION_DIAGNOSIS_OUTPUT?.trim() || "output/v143-xiaohongshu-session-persistence-diagnosis.json";
const CREDENTIAL_KEY = `session:${PLATFORM_KEY}:${ACCOUNT_ID}`;

type JsonRecord = Record<string, unknown>;

function redact(value: string): string {
  return value.replace(/(cookie|token|secret|authorization|access[_-]?key|refresh[_-]?token)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]").slice(0, 4_000);
}

function errorEvidence(error: unknown): JsonRecord {
  return { name: error instanceof Error ? error.name : "UnknownError", code: error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : null, message: redact(error instanceof Error ? error.message : String(error)) };
}

function accountContext(attempt: number): AccountContext {
  return {
    accountId: ACCOUNT_ID,
    accountName: "account-1",
    platformKey: PLATFORM_KEY,
    settings: { triggerSource: "CONTINUE_PENDING_ACTION", userActionId: `v143-session-restore-${attempt}-${Date.now()}`, browserExecutionMode: "VISIBLE" },
    secrets: {}
  };
}

function profileEvidence(): JsonRecord {
  const profilePath = join(PROFILE_ROOT, PLATFORM_KEY, ACCOUNT_ID);
  const markerPath = join(profilePath, ".gmp-profile-initialized");
  return {
    rootPath: PROFILE_ROOT,
    profilePath,
    profileExists: existsSync(profilePath),
    markerExists: existsSync(markerPath),
    profileLastWrite: existsSync(profilePath) ? statSync(profilePath).mtime.toISOString() : null
  };
}

async function runRestoreAttempt(attempt: number): Promise<JsonRecord> {
  const credentials = new SafeStorageCredentialStore(join(DATA_DIRECTORY, "credentials.enc"), safeStorage);
  const registry = createRuntimeAdapterRegistry(credentials, false, undefined, PROFILE_ROOT);
  const selected = registry.getForContent(PLATFORM_KEY, "article");
  if (!isAutomationAdapter(selected)) throw new Error("XIAOHONGSHU_ARTICLE_ROUTE_NOT_BROWSER_AUTOMATION");
  const adapter: AutomationAdapter = selected;
  const context = accountContext(attempt);
  let status: LoginStatus | "ERROR" = "ERROR";
  let sessionEvidence: unknown = null;
  let error: JsonRecord | null = null;
  try {
    status = await adapter.checkLogin(context);
    sessionEvidence = await adapter.getBrowserSessionEvidence?.(context) ?? null;
  } catch (caught) {
    error = errorEvidence(caught);
  } finally {
    await adapter.closeOwnedSessions?.().catch((caught: unknown) => { error ??= errorEvidence(caught); });
  }
  return {
    attempt,
    accountId: ACCOUNT_ID,
    platformKey: PLATFORM_KEY,
    credentialKey: CREDENTIAL_KEY,
    status,
    sessionEvidence,
    profile: profileEvidence(),
    error
  };
}

export async function runXiaohongshuSessionPersistenceRestore(): Promise<JsonRecord> {
  app.setName("codex-media-publisher-session-persistence-diagnostic");
  app.setPath("userData", USER_DATA_PATH);
  await app.whenReady();
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const evidence: JsonRecord = {
    operation: "xiaohongshu_session_persistence_restore_v143",
    accountId: ACCOUNT_ID,
    platformKey: PLATFORM_KEY,
    credentialKey: CREDENTIAL_KEY,
    credentialFile: join(DATA_DIRECTORY, "credentials.enc"),
    safeStorageAvailable: safeStorage.isEncryptionAvailable(),
    installedApp: {
      executablePath: "C:/GMP116ZhihuL5/Geo Media Publisher/Geo Media Publisher.exe",
      userDataPath: USER_DATA_PATH,
      browserRuntime: "playwright-core system channel (chrome, msedge fallback)",
      currentBinaryDeployed: false,
      currentObservedRestoreMode: "pre-fix chromium.launch + browser.newContext(storageState)",
      postFixRestoreMode: "chromium.launchPersistentContext",
      profileRoot: PROFILE_ROOT,
      platformProfile: join(PROFILE_ROOT, PLATFORM_KEY, ACCOUNT_ID)
    },
    gateRunner: {
      restoreMode: "same createRuntimeAdapterRegistry + same BrowserSessionManager",
      profileRoot: PROFILE_ROOT,
      publishPreparationCalled: false,
      finalSubmitClicked: false
    },
    restoreAttempts: [],
    finalSubmitCount: 0,
    jobCreated: false,
    intentCreated: false,
    publishRecordCreated: false,
    ownerActionRequired: false,
    result: "NOT_EXECUTED"
  };
  try {
    const first = await runRestoreAttempt(1);
    (evidence.restoreAttempts as JsonRecord[]).push(first);
    if (first.status !== "logged_in") {
      evidence.ownerActionRequired = true;
      evidence.result = "STOPPED_CLOSED_ON_FIRST_RESTORE";
    } else {
      const second = await runRestoreAttempt(2);
      (evidence.restoreAttempts as JsonRecord[]).push(second);
      evidence.ownerActionRequired = second.status !== "logged_in";
      evidence.result = second.status === "logged_in" ? "TWO_RESTORE_ATTEMPTS_PASS" : "STOPPED_CLOSED_ON_SECOND_RESTORE";
    }
  } catch (caught) {
    evidence.ownerActionRequired = true;
    evidence.result = "FAILED_CLOSED";
    evidence.error = errorEvidence(caught);
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.profileAfter = profileEvidence();
    evidence.finalSubmitCount = 0;
    evidence.jobCreated = false;
    evidence.intentCreated = false;
    evidence.publishRecordCreated = false;
    writeFileSync(OUTPUT_PATH, JSON.stringify(evidence, null, 2), "utf8");
    app.exit(0);
  }
  return evidence;
}

void runXiaohongshuSessionPersistenceRestore();
