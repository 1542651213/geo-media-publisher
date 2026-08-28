import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright-core";
import { collectXhsAuthStateMetadata } from "./auth-state-diagnostics";

function fixtureInput(overrides: {
  cookies?: Array<Record<string, unknown>>;
  storageState?: { origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> };
  pageEvaluation?: Record<string, unknown>;
  profilePath?: string | null;
  credentialFilePath?: string | null;
} = {}): Parameters<typeof collectXhsAuthStateMetadata>[0] {
  const evaluation = overrides.pageEvaluation ?? {
    origin: "https://creator.xiaohongshu.com",
    sessionStorageKeys: ["runtime-session-key"],
    indexedDB: [{ databaseName: "xhs-auth", objectStoreNames: ["sessions"] }],
    serviceWorkerScopes: ["https://creator.xiaohongshu.com/"],
    runtime: { userAgent: "Mozilla/5.0 test", language: "zh-CN", timezone: "Asia/Shanghai", viewport: { width: 1280, height: 800, deviceScaleFactor: 1 } }
  };
  const page = {
    url: vi.fn(() => "https://creator.xiaohongshu.com/new/home"),
    evaluate: vi.fn(async () => evaluation)
  } as unknown as Page;
  const context = {
    cookies: vi.fn(async () => overrides.cookies ?? [
      { name: "session_cookie", domain: ".xiaohongshu.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax", value: "secret-cookie-value" },
      { name: "persistent_cookie", domain: ".xiaohongshu.com", path: "/", expires: 1_900_000_000, httpOnly: false, secure: true, sameSite: "None", value: "secret-cookie-value" }
    ]),
    storageState: vi.fn(async () => overrides.storageState ?? { cookies: [], origins: [{ origin: "https://creator.xiaohongshu.com", localStorage: [{ name: "auth-key", value: "secret-local-value" }] }] }),
    pages: vi.fn(() => [page]),
    serviceWorkers: vi.fn(() => [])
  } as unknown as BrowserContext;
  return { context, page, profilePath: null, credentialFilePath: null };
}

describe("collectXhsAuthStateMetadata", () => {
  it("classifies session and persistent cookies without returning values", async () => {
    const result = await collectXhsAuthStateMetadata(fixtureInput());

    expect(result.sessionCookieNames).toEqual(["session_cookie"]);
    expect(result.persistentCookieNames).toEqual(["persistent_cookie"]);
    expect(result.sessionCookieCount).toBe(1);
    expect(result.persistentCookieCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret-cookie-value");
    expect(JSON.stringify(result)).not.toContain("secret-local-value");
    expect(JSON.stringify(result)).not.toMatch(/"value"/iu);
  });

  it("collects storage names, runtime metadata, and safe file metadata only", async () => {
    const result = await collectXhsAuthStateMetadata(fixtureInput({ profilePath: "C:/profile-that-does-not-exist", credentialFilePath: "C:/credential-that-does-not-exist" }));

    expect(result.localStorage).toEqual([{ origin: "https://creator.xiaohongshu.com", keyNames: ["auth-key"], keyCount: 1 }]);
    expect(result.sessionStorage).toEqual([{ origin: "https://creator.xiaohongshu.com", keyNames: ["runtime-session-key"], keyCount: 1 }]);
    expect(result.indexedDB).toEqual([{ origin: "https://creator.xiaohongshu.com", databaseNames: ["xhs-auth"], objectStoresByDatabase: { "xhs-auth": ["sessions"] } }]);
    expect(result.serviceWorkers).toEqual([{ origin: "https://creator.xiaohongshu.com", registrationScopes: ["https://creator.xiaohongshu.com/"], count: 1 }]);
    expect(result.runtime.timezone).toBe("Asia/Shanghai");
    expect(result.profileFiles.every((file) => file.exists === false)).toBe(true);
    expect(result.credentialFile.exists).toBe(false);
  });
});
