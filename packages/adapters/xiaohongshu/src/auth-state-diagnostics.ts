import { createHmac, randomBytes } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import playwrightPackage from "playwright-core/package.json";
import type { BrowserContext, Page } from "playwright-core";

export type XhsAuthStateDiagnosticPhase = "PAGE" | "PRE_NAVIGATION";

export interface XhsValueFingerprint {
  key: string;
  fingerprint: string;
}

export interface XhsCookieMetadata {
  name: string;
  domain: string;
  path: string;
  expires: number;
  isSessionCookie: boolean;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
  valueFingerprint?: string;
}

export interface XhsProfileFileMetadata {
  relativePath: string;
  exists: boolean;
  kind: "file" | "directory" | "missing";
  size: number | null;
  modifiedAt: string | null;
}

export interface XhsAuthStateDiagnosticInput {
  context: BrowserContext;
  page?: Page;
  profilePath?: string | null;
  credentialFilePath?: string | null;
  phase?: XhsAuthStateDiagnosticPhase;
  /** Process-memory-only key. It must never be persisted or included in evidence. */
  fingerprintKey?: Uint8Array;
  browserChannel?: "chrome" | "msedge" | null;
  headless?: boolean | null;
  storageMode?: "EPHEMERAL_STORAGE_STATE" | "PERSISTENT_PROFILE" | null;
}

export interface XhsRuntimeManifest {
  executablePath: string | null;
  browserVersion: string | null;
  chromiumVersion: string | null;
  playwrightVersion: string | null;
  launchArgs: string[];
  launchArgsAvailable: boolean;
  userAgent: string | null;
  language: string | null;
  timezone: string | null;
  viewport: { width: number; height: number; deviceScaleFactor: number } | null;
  proxyEnabled: boolean | null;
  browserChannel: "chrome" | "msedge" | null;
  headless: boolean | null;
  profilePath: string | null;
  storageMode: "EPHEMERAL_STORAGE_STATE" | "PERSISTENT_PROFILE" | null;
}

export interface XhsAuthStateMetadata {
  capturedAt: string;
  pageUrl: string;
  origins: string[];
  cookies: XhsCookieMetadata[];
  sessionCookieNames: string[];
  persistentCookieNames: string[];
  cookieCountTotal: number;
  cookieCountXiaohongshu: number;
  sessionCookieCount: number;
  persistentCookieCount: number;
  localStorage: Array<{ origin: string; keyNames: string[]; keyCount: number; valueFingerprints?: XhsValueFingerprint[] }>;
  sessionStorage: Array<{ origin: string; keyNames: string[]; keyCount: number; valueFingerprints?: XhsValueFingerprint[] }>;
  indexedDB: Array<{ origin: string; databaseNames: string[]; objectStoresByDatabase: Record<string, string[]> }>;
  serviceWorkers: Array<{ origin: string; registrationScopes: string[]; count: number }>;
  profileFiles: XhsProfileFileMetadata[];
  credentialFile: { path: string | null; exists: boolean; size: number | null; modifiedAt: string | null };
  runtime: {
    userAgent: string | null;
    language: string | null;
    timezone: string | null;
    viewport: { width: number; height: number; deviceScaleFactor: number } | null;
  };
  runtimeManifest: XhsRuntimeManifest;
  collectionWarnings: string[];
}

interface PageAuthMetadata {
  origin: string;
  sessionStorageKeys: string[];
  sessionStorageEntries?: Array<{ name: string; value: string }>;
  indexedDB: Array<{ databaseName: string; objectStoreNames: string[] }>;
  serviceWorkerScopes: string[];
  runtime: XhsAuthStateMetadata["runtime"];
}

const PROFILE_METADATA_PATHS = [
  "Cookies",
  "Network/Cookies",
  "Local Storage",
  "Default/Local Storage",
  "IndexedDB",
  "Default/IndexedDB",
  "Session Storage",
  "Default/Session Storage",
  "Preferences",
  "Default/Preferences",
  "Secure Preferences",
  "Default/Secure Preferences",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket"
] as const;

export function createXhsDiagnosticFingerprintKey(): Uint8Array {
  return randomBytes(32);
}

export function fingerprintXhsDiagnosticValue(value: string, key: Uint8Array): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex").slice(0, 32);
}

function isXiaohongshuDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/^\./u, "");
  return normalized === "xiaohongshu.com" || normalized.endsWith(".xiaohongshu.com");
}

export function collectXhsProfileFileMetadata(profilePath: string | null | undefined): XhsProfileFileMetadata[] {
  if (!profilePath?.trim()) return [];
  return PROFILE_METADATA_PATHS.map((relativePath) => {
    const path = join(profilePath, relativePath);
    try {
      const stat = lstatSync(path);
      return {
        relativePath,
        exists: true,
        kind: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "missing",
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    } catch {
      return { relativePath, exists: false, kind: "missing", size: null, modifiedAt: null };
    }
  });
}

export function collectXhsCredentialFileMetadata(filePath: string | null | undefined): XhsAuthStateMetadata["credentialFile"] {
  if (!filePath?.trim()) return { path: null, exists: false, size: null, modifiedAt: null };
  try {
    const stat = lstatSync(filePath);
    return { path: filePath, exists: true, size: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch {
    return { path: filePath, exists: false, size: null, modifiedAt: null };
  }
}

async function readPageAuthMetadata(page: Page): Promise<PageAuthMetadata | null> {
  try {
    return await page.evaluate(async () => {
      const origin = window.location.origin === "null" ? "" : window.location.origin;
      const sessionStorageEntries = Object.keys(window.sessionStorage).sort().map((name) => ({ name, value: window.sessionStorage.getItem(name) ?? "" }));
      const sessionStorageKeys = sessionStorageEntries.map((entry) => entry.name);
      const indexedDBMetadata: Array<{ databaseName: string; objectStoreNames: string[] }> = [];
      const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
      for (const database of databases) {
        if (!database.name || !database.version || database.version < 1) continue;
        const objectStoreNames = await new Promise<string[]>((resolve) => {
          let settled = false;
          const finish = (names: string[]): void => {
            if (settled) return;
            settled = true;
            resolve(names);
          };
          try {
            const request = indexedDB.open(database.name as string, database.version);
            request.onsuccess = () => {
              const opened = request.result;
              const names = Array.from(opened.objectStoreNames).sort();
              opened.close();
              finish(names);
            };
            request.onerror = () => finish([]);
            request.onblocked = () => finish([]);
          } catch {
            finish([]);
          }
        });
        indexedDBMetadata.push({ databaseName: database.name, objectStoreNames });
      }
      let serviceWorkerScopes: string[] = [];
      try {
        if ("serviceWorker" in navigator) serviceWorkerScopes = (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope).sort();
      } catch {
        serviceWorkerScopes = [];
      }
      return {
        origin,
        sessionStorageKeys,
        sessionStorageEntries,
        indexedDB: indexedDBMetadata.sort((left, right) => left.databaseName.localeCompare(right.databaseName)),
        serviceWorkerScopes,
        runtime: {
          userAgent: navigator.userAgent || null,
          language: navigator.language || null,
          timezone: (() => {
            try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
          })(),
          viewport: { width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio || 1 }
        }
      };
    });
  } catch {
    return null;
  }
}

function mergeStorageEntries(entries: Array<{ origin: string; keyNames: string[]; values?: Array<{ name: string; value: string }> }>, fingerprintKey?: Uint8Array): Array<{ origin: string; keyNames: string[]; keyCount: number; valueFingerprints?: XhsValueFingerprint[] }> {
  const merged = new Map<string, { keys: Set<string>; values: Map<string, string> }>();
  for (const entry of entries) {
    if (!entry.origin) continue;
    const current = merged.get(entry.origin) ?? { keys: new Set<string>(), values: new Map<string, string>() };
    for (const key of entry.keyNames) current.keys.add(key);
    if (fingerprintKey) for (const value of entry.values ?? []) current.values.set(value.name, fingerprintXhsDiagnosticValue(value.value, fingerprintKey));
    merged.set(entry.origin, current);
  }
  return [...merged.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([origin, current]) => {
    const keyNames = [...current.keys].sort();
    const valueFingerprints = [...current.values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, fingerprint]) => ({ key, fingerprint }));
    return { origin, keyNames, keyCount: keyNames.length, ...(fingerprintKey ? { valueFingerprints } : {}) };
  });
}

async function collectBrowserVersion(context: BrowserContext): Promise<string | null> {
  try {
    const browser = context.browser?.();
    const version = browser?.version?.();
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

async function collectBrowserLaunchMetadata(context: BrowserContext): Promise<{ browserVersion: string | null; executablePath: string | null; launchArgs: string[]; launchArgsAvailable: boolean }> {
  try {
    const browser = context.browser?.() as unknown as { version?: () => string; process?: () => { spawnfile?: string; spawnargs?: string[] } | null } | null;
    const processInfo = browser?.process?.() ?? null;
    const launchArgs = (processInfo?.spawnargs ?? []).map((argument) => {
      if (/^--user-data-dir=/iu.test(argument)) return "--user-data-dir=[REDACTED_PATH]";
      if (/^--(?:remote-debugging|proxy-server)=/iu.test(argument)) return argument.slice(0, argument.indexOf("=") + 1) + "[REDACTED]";
      return argument;
    });
    const browserVersion = typeof browser?.version === "function" ? browser.version() : await collectBrowserVersion(context);
    return { browserVersion: typeof browserVersion === "string" ? browserVersion : null, executablePath: typeof processInfo?.spawnfile === "string" ? processInfo.spawnfile : null, launchArgs, launchArgsAvailable: Boolean(processInfo?.spawnargs) };
  } catch {
    return { browserVersion: await collectBrowserVersion(context), executablePath: null, launchArgs: [], launchArgsAvailable: false };
  }
}

function defaultRuntimeManifest(input: XhsAuthStateDiagnosticInput, runtime: XhsAuthStateMetadata["runtime"], launch: Awaited<ReturnType<typeof collectBrowserLaunchMetadata>>): XhsRuntimeManifest {
  return {
    executablePath: launch.executablePath,
    browserVersion: launch.browserVersion,
    chromiumVersion: process.versions.chrome ?? null,
    playwrightVersion: typeof playwrightPackage.version === "string" ? playwrightPackage.version : null,
    launchArgs: launch.launchArgs,
    launchArgsAvailable: launch.launchArgsAvailable,
    userAgent: runtime.userAgent,
    language: runtime.language,
    timezone: runtime.timezone,
    viewport: runtime.viewport,
    proxyEnabled: null,
    browserChannel: input.browserChannel ?? null,
    headless: input.headless ?? null,
    profilePath: input.profilePath ?? null,
    storageMode: input.storageMode ?? null
  };
}

export async function collectXhsAuthStateMetadata(input: XhsAuthStateDiagnosticInput): Promise<XhsAuthStateMetadata> {
  const warnings: string[] = [];
  const cookies = (await input.context.cookies()).map((cookie): XhsCookieMetadata => ({
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    isSessionCookie: cookie.expires <= 0,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite ?? null,
    ...(input.fingerprintKey ? { valueFingerprint: fingerprintXhsDiagnosticValue(cookie.value, input.fingerprintKey) } : {})
  })).sort((left, right) => `${left.domain}\u0000${left.path}\u0000${left.name}`.localeCompare(`${right.domain}\u0000${right.path}\u0000${right.name}`));
  const sessionCookieNames = cookies.filter((cookie) => cookie.isSessionCookie).map((cookie) => cookie.name).sort();
  const persistentCookieNames = cookies.filter((cookie) => !cookie.isSessionCookie).map((cookie) => cookie.name).sort();
  const storageState = await input.context.storageState();
  const localStorage = storageState.origins.map((origin) => ({ origin: origin.origin, keyNames: origin.localStorage.map((entry) => entry.name), values: origin.localStorage.map((entry) => ({ name: entry.name, value: entry.value })) }));
  const pages = input.phase === "PRE_NAVIGATION" || !input.page ? [] : [...new Set([input.page, ...input.context.pages()])];
  const pageMetadata = (await Promise.all(pages.map((page) => readPageAuthMetadata(page)))).filter((metadata): metadata is PageAuthMetadata => metadata !== null);
  if (pageMetadata.length === 0) warnings.push("PAGE_METADATA_UNAVAILABLE");
  if (input.phase === "PRE_NAVIGATION" || !input.page) warnings.push("SESSION_STORAGE_UNAVAILABLE_PRE_NAVIGATION");
  const sessionStorage = mergeStorageEntries(pageMetadata.map((metadata) => ({ origin: metadata.origin, keyNames: metadata.sessionStorageKeys, values: metadata.sessionStorageEntries })), input.fingerprintKey);
  const indexedDbByOrigin = new Map<string, Map<string, string[]>>();
  const serviceWorkersByOrigin = new Map<string, Set<string>>();
  for (const metadata of pageMetadata) {
    if (metadata.origin) {
      const databases = indexedDbByOrigin.get(metadata.origin) ?? new Map<string, string[]>();
      for (const database of metadata.indexedDB) databases.set(database.databaseName, database.objectStoreNames);
      indexedDbByOrigin.set(metadata.origin, databases);
      const scopes = serviceWorkersByOrigin.get(metadata.origin) ?? new Set<string>();
      for (const scope of metadata.serviceWorkerScopes) scopes.add(scope);
      serviceWorkersByOrigin.set(metadata.origin, scopes);
    }
  }
  const indexedDB = [...indexedDbByOrigin.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([origin, databases]) => ({
    origin,
    databaseNames: [...databases.keys()].sort(),
    objectStoresByDatabase: Object.fromEntries([...databases.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, stores]) => [name, [...stores].sort()]))
  }));
  const serviceWorkers = [...serviceWorkersByOrigin.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([origin, scopes]) => {
    const registrationScopes = [...scopes].sort();
    return { origin, registrationScopes, count: registrationScopes.length };
  });
  const origins = [...new Set([...storageState.origins.map((origin) => origin.origin), ...pageMetadata.map((metadata) => metadata.origin).filter(Boolean)])].sort();
  const runtime = pageMetadata[0]?.runtime ?? { userAgent: null, language: null, timezone: null, viewport: null };
  const launch = await collectBrowserLaunchMetadata(input.context);
  return {
    capturedAt: new Date().toISOString(),
    pageUrl: input.page?.url() ?? "about:blank",
    origins,
    cookies,
    sessionCookieNames,
    persistentCookieNames,
    cookieCountTotal: cookies.length,
    cookieCountXiaohongshu: cookies.filter((cookie) => isXiaohongshuDomain(cookie.domain)).length,
    sessionCookieCount: sessionCookieNames.length,
    persistentCookieCount: persistentCookieNames.length,
    localStorage: mergeStorageEntries(localStorage, input.fingerprintKey),
    sessionStorage,
    indexedDB,
    serviceWorkers,
    profileFiles: collectXhsProfileFileMetadata(input.profilePath),
    credentialFile: collectXhsCredentialFileMetadata(input.credentialFilePath),
    runtime,
    runtimeManifest: defaultRuntimeManifest(input, runtime, launch),
    collectionWarnings: warnings
  };
}

export async function collectXhsPreNavigationAuthStateMetadata(input: Omit<XhsAuthStateDiagnosticInput, "page" | "phase">): Promise<XhsAuthStateMetadata> {
  return collectXhsAuthStateMetadata({ ...input, page: undefined, phase: "PRE_NAVIGATION" });
}
