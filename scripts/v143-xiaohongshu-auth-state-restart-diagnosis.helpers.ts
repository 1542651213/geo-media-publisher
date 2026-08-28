import type { BrowserSessionScopeEvidence } from "@publisher/adapters-browser";
import type { XhsAuthStateMetadata, XhsProfileFileMetadata } from "@publisher/adapters-xiaohongshu";

export type AuthStateDiagnosticSnapshot = {
  status: string;
  sessionEvidence: BrowserSessionScopeEvidence | null;
  authState: XhsAuthStateMetadata | null;
  profileFiles: XhsProfileFileMetadata[];
};

export type AuthStateDiagnosticDiff = {
  sessionCookieNamesLost: string[];
  sessionCookieNamesAdded: string[];
  persistentCookieNamesLost: string[];
  persistentCookieNamesAdded: string[];
  localStorageChanged: boolean;
  sessionStorageChanged: boolean;
  indexedDBChanged: boolean;
  serviceWorkersChanged: boolean;
  profileFilesChanged: string[];
  runtimeChanged: boolean;
  browserChannelChanged: boolean;
  headlessChanged: boolean;
  profilePathChanged: boolean;
  storageModeChanged: boolean;
  authStatePresentAfterReopen: boolean;
  authStatePresentButServerRejected: boolean;
  sessionOnlyCookieLossCorrelated: boolean;
};

export type ParsedXhsLogDiagnostic = {
  timestamp: string | null;
  phase: string;
  accountId: string;
  platformKey: string;
  context: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }

function listDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((item) => !rightSet.has(item)).sort();
}

function namedStorageEntries(state: XhsAuthStateMetadata | null, storage: "localStorage" | "sessionStorage"): string[] {
  return (state?.[storage] ?? []).flatMap((entry) => entry.keyNames.map((key) => `${entry.origin}\u0000${key}`)).sort();
}

function indexedDbEntries(state: XhsAuthStateMetadata | null): string[] {
  return (state?.indexedDB ?? []).flatMap((entry) => entry.databaseNames.flatMap((name) => [
    `${entry.origin}\u0000db\u0000${name}`,
    ...(entry.objectStoresByDatabase[name] ?? []).map((store) => `${entry.origin}\u0000store\u0000${name}\u0000${store}`)
  ])).sort();
}

function serviceWorkerEntries(state: XhsAuthStateMetadata | null): string[] {
  return (state?.serviceWorkers ?? []).flatMap((entry) => entry.registrationScopes.map((scope) => `${entry.origin}\u0000${scope}`)).sort();
}

function profileFileMap(files: XhsProfileFileMetadata[]): Map<string, string> {
  return new Map(files.map((file) => [file.relativePath, JSON.stringify(file)]));
}

function changedProfileFiles(before: XhsProfileFileMetadata[], after: XhsProfileFileMetadata[]): string[] {
  const left = profileFileMap(before);
  const right = profileFileMap(after);
  return [...new Set([...left.keys(), ...right.keys()])].filter((path) => left.get(path) !== right.get(path)).sort();
}

function runtimeSignature(state: XhsAuthStateMetadata | null): string {
  return JSON.stringify(state?.runtime ?? null);
}

function hasAuthStateSignal(state: XhsAuthStateMetadata | null): boolean {
  return Boolean(state && (state.persistentCookieCount > 0 || state.localStorage.some((entry) => entry.keyCount > 0) || state.indexedDB.some((entry) => entry.databaseNames.length > 0) || state.serviceWorkers.some((entry) => entry.count > 0)));
}

export function diffXhsAuthStateSnapshots(before: AuthStateDiagnosticSnapshot, after: AuthStateDiagnosticSnapshot): AuthStateDiagnosticDiff {
  const beforeState = before.authState;
  const afterState = after.authState;
  const beforeEvidence = before.sessionEvidence;
  const afterEvidence = after.sessionEvidence;
  const sessionCookieNamesLost = listDifference(beforeState?.sessionCookieNames ?? [], afterState?.sessionCookieNames ?? []);
  const sessionCookieNamesAdded = listDifference(afterState?.sessionCookieNames ?? [], beforeState?.sessionCookieNames ?? []);
  const persistentCookieNamesLost = listDifference(beforeState?.persistentCookieNames ?? [], afterState?.persistentCookieNames ?? []);
  const persistentCookieNamesAdded = listDifference(afterState?.persistentCookieNames ?? [], beforeState?.persistentCookieNames ?? []);
  return {
    sessionCookieNamesLost,
    sessionCookieNamesAdded,
    persistentCookieNamesLost,
    persistentCookieNamesAdded,
    localStorageChanged: JSON.stringify(namedStorageEntries(beforeState, "localStorage")) !== JSON.stringify(namedStorageEntries(afterState, "localStorage")),
    sessionStorageChanged: JSON.stringify(namedStorageEntries(beforeState, "sessionStorage")) !== JSON.stringify(namedStorageEntries(afterState, "sessionStorage")),
    indexedDBChanged: JSON.stringify(indexedDbEntries(beforeState)) !== JSON.stringify(indexedDbEntries(afterState)),
    serviceWorkersChanged: JSON.stringify(serviceWorkerEntries(beforeState)) !== JSON.stringify(serviceWorkerEntries(afterState)),
    profileFilesChanged: changedProfileFiles(beforeState?.profileFiles ?? [], afterState?.profileFiles ?? []),
    runtimeChanged: runtimeSignature(beforeState) !== runtimeSignature(afterState),
    browserChannelChanged: beforeEvidence?.browserChannel !== afterEvidence?.browserChannel,
    headlessChanged: beforeEvidence?.headless !== afterEvidence?.headless,
    profilePathChanged: beforeEvidence?.profilePath !== afterEvidence?.profilePath,
    storageModeChanged: beforeEvidence?.storageMode !== afterEvidence?.storageMode,
    authStatePresentAfterReopen: hasAuthStateSignal(afterState),
    authStatePresentButServerRejected: after.status === "expired" && hasAuthStateSignal(afterState),
    sessionOnlyCookieLossCorrelated: beforeState?.sessionCookieCount !== undefined && beforeState.sessionCookieCount > 0 && sessionCookieNamesLost.length > 0 && after.status === "expired"
  };
}

export function parseXhsAuthStateDiagnostics(logText: string, accountId: string, profilePath: string): ParsedXhsLogDiagnostic[] {
  const diagnostics: ParsedXhsLogDiagnostic[] = [];
  for (const line of logText.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const envelope = asRecord(JSON.parse(line));
      if (!envelope || envelope.code !== "XHS_AUTH_STATE_DIAGNOSTIC") continue;
      const context = asRecord(envelope.context);
      if (!context || context.platformKey !== "xiaohongshu" || context.accountId !== accountId || context.profilePath !== profilePath) continue;
      const phase = stringValue(context.phase);
      if (!phase) continue;
      diagnostics.push({ timestamp: stringValue(envelope.timestamp), phase, accountId, platformKey: "xiaohongshu", context });
    } catch {
      // Ignore unrelated or partially-written log lines.
    }
  }
  return diagnostics;
}

export function hasNoAuthValues(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(hasNoAuthValues);
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(([key, item]) => {
    if (/^(?:value|token|secret|authorization|cookie|storageState|localStorageValues|sessionStorageValues)$/iu.test(key)) return false;
    return hasNoAuthValues(item);
  });
}
