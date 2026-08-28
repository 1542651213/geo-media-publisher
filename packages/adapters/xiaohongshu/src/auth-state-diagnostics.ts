import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";

export interface XhsCookieMetadata {
  name: string;
  domain: string;
  path: string;
  expires: number;
  isSessionCookie: boolean;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
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
  page: Page;
  profilePath?: string | null;
  credentialFilePath?: string | null;
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
  localStorage: Array<{ origin: string; keyNames: string[]; keyCount: number }>;
  sessionStorage: Array<{ origin: string; keyNames: string[]; keyCount: number }>;
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
  collectionWarnings: string[];
}

interface PageAuthMetadata {
  origin: string;
  sessionStorageKeys: string[];
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
      const sessionStorageKeys = Object.keys(window.sessionStorage).sort();
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

function mergeStorageEntries(entries: Array<{ origin: string; keyNames: string[] }>): Array<{ origin: string; keyNames: string[]; keyCount: number }> {
  const merged = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.origin) continue;
    const keys = merged.get(entry.origin) ?? new Set<string>();
    for (const key of entry.keyNames) keys.add(key);
    merged.set(entry.origin, keys);
  }
  return [...merged.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([origin, keys]) => {
    const keyNames = [...keys].sort();
    return { origin, keyNames, keyCount: keyNames.length };
  });
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
    sameSite: cookie.sameSite ?? null
  })).sort((left, right) => `${left.domain}\u0000${left.path}\u0000${left.name}`.localeCompare(`${right.domain}\u0000${right.path}\u0000${right.name}`));
  const sessionCookieNames = cookies.filter((cookie) => cookie.isSessionCookie).map((cookie) => cookie.name).sort();
  const persistentCookieNames = cookies.filter((cookie) => !cookie.isSessionCookie).map((cookie) => cookie.name).sort();
  const storageState = await input.context.storageState();
  const localStorage = storageState.origins.map((origin) => ({ origin: origin.origin, keyNames: origin.localStorage.map((entry) => entry.name) }));
  const pages = [...new Set([input.page, ...input.context.pages()])];
  const pageMetadata = (await Promise.all(pages.map((page) => readPageAuthMetadata(page)))).filter((metadata): metadata is PageAuthMetadata => metadata !== null);
  if (pageMetadata.length === 0) warnings.push("PAGE_METADATA_UNAVAILABLE");
  const sessionStorage = mergeStorageEntries(pageMetadata.map((metadata) => ({ origin: metadata.origin, keyNames: metadata.sessionStorageKeys })));
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
  return {
    capturedAt: new Date().toISOString(),
    pageUrl: input.page.url(),
    origins,
    cookies,
    sessionCookieNames,
    persistentCookieNames,
    cookieCountTotal: cookies.length,
    cookieCountXiaohongshu: cookies.filter((cookie) => isXiaohongshuDomain(cookie.domain)).length,
    sessionCookieCount: sessionCookieNames.length,
    persistentCookieCount: persistentCookieNames.length,
    localStorage: mergeStorageEntries(localStorage),
    sessionStorage,
    indexedDB,
    serviceWorkers,
    profileFiles: collectXhsProfileFileMetadata(input.profilePath),
    credentialFile: collectXhsCredentialFileMetadata(input.credentialFilePath),
    runtime,
    collectionWarnings: warnings
  };
}
