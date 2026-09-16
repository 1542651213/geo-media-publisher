import { describe, expect, it } from "vitest";
import { diffXhsAuthStateSnapshots, hasNoAuthValues, parseXhsAuthStateDiagnostics, selectLatestOwnerDiagnostics, type AuthStateDiagnosticSnapshot } from "./v143-xiaohongshu-auth-state-restart-diagnosis.helpers";

function state(overrides: Record<string, unknown> = {}): AuthStateDiagnosticSnapshot {
  return {
    status: "logged_in",
    sessionEvidence: { browserChannel: "chrome", headless: false, profilePath: "C:/profile", storageMode: "PERSISTENT_PROFILE" } as AuthStateDiagnosticSnapshot["sessionEvidence"],
    authState: {
      capturedAt: "2026-08-28T00:00:00.000Z",
      pageUrl: "https://creator.xiaohongshu.com/new/home",
      origins: ["https://creator.xiaohongshu.com"],
      cookies: [], sessionCookieNames: [], persistentCookieNames: [], cookieCountTotal: 0, cookieCountXiaohongshu: 0, sessionCookieCount: 0, persistentCookieCount: 0,
      localStorage: [], sessionStorage: [], indexedDB: [], serviceWorkers: [], profileFiles: [], credentialFile: { path: null, exists: false, size: null, modifiedAt: null },
      runtime: { userAgent: "ua", language: "zh-CN", timezone: "Asia/Shanghai", viewport: { width: 1, height: 1, deviceScaleFactor: 1 } }, runtimeManifest: { executablePath: null, browserVersion: null, chromiumVersion: null, playwrightVersion: "1.62.1", launchArgs: [], launchArgsAvailable: false, userAgent: "ua", language: "zh-CN", timezone: "Asia/Shanghai", viewport: { width: 1, height: 1, deviceScaleFactor: 1 }, proxyEnabled: null, browserChannel: "chrome", headless: false, profilePath: "C:/profile", storageMode: "PERSISTENT_PROFILE" }, collectionWarnings: [], ...overrides
    } as AuthStateDiagnosticSnapshot["authState"],
    profileFiles: []
  };
}

describe("Xiaohongshu auth-state restart diagnosis helpers", () => {
  it("detects session-cookie loss and separates it from persistent state changes", () => {
    const before = state({ sessionCookieNames: ["sid"], sessionCookieCount: 1, persistentCookieNames: ["persist"], persistentCookieCount: 1 });
    const after = state({ persistentCookieNames: ["persist"], persistentCookieCount: 1 });
    after.status = "expired";
    const diff = diffXhsAuthStateSnapshots(before, after);
    expect(diff.sessionCookieNamesLost).toEqual(["sid"]);
    expect(diff.persistentCookieNamesLost).toEqual([]);
    expect(diff.sessionOnlyCookieLossCorrelated).toBe(true);
    expect(diff.lostLocalStorageKeys).toEqual([]);
  });

  it("parses only the exact account/profile diagnostic events and rejects auth values", () => {
    const log = `${JSON.stringify({ timestamp: "t1", code: "XHS_AUTH_STATE_DIAGNOSTIC", context: { phase: "AUTH_STATE_BEFORE_CLOSE", platformKey: "xiaohongshu", accountId: "a", profilePath: "C:/p", authState: { cookies: [{ name: "sid" }] } } })}\n${JSON.stringify({ code: "XHS_AUTH_STATE_DIAGNOSTIC", context: { phase: "AUTH_STATE_BEFORE_CLOSE", platformKey: "xiaohongshu", accountId: "other", profilePath: "C:/p" } })}`;
    const parsed = parseXhsAuthStateDiagnostics(log, "a", "C:/p");
    expect(parsed).toHaveLength(1);
    expect(hasNoAuthValues(parsed[0])).toBe(true);
    expect(hasNoAuthValues({ value: "secret" })).toBe(false);
  });

  it("selects the latest coherent live-login and before-close pair", () => {
    const parsed = parseXhsAuthStateDiagnostics([
      JSON.stringify({ timestamp: "2026-08-28T00:00:00.000Z", code: "XHS_AUTH_STATE_DIAGNOSTIC", context: { phase: "LIVE_LOGIN_BEFORE_CLOSE", platformKey: "xiaohongshu", accountId: "a", profilePath: "C:/p", stableObservationPassed: true, marker: "old-live" } }),
      JSON.stringify({ timestamp: "2026-08-28T00:00:01.000Z", code: "XHS_AUTH_STATE_DIAGNOSTIC", context: { phase: "AUTH_STATE_BEFORE_CLOSE", platformKey: "xiaohongshu", accountId: "a", profilePath: "C:/p", marker: "old-before" } }),
      JSON.stringify({ timestamp: "2026-08-28T01:00:00.000Z", code: "XHS_AUTH_STATE_DIAGNOSTIC", context: { phase: "LIVE_LOGIN_BEFORE_CLOSE", platformKey: "xiaohongshu", accountId: "a", profilePath: "C:/p", stableObservationPassed: true, marker: "new-live" } }),
      JSON.stringify({ timestamp: "2026-08-28T01:00:01.000Z", code: "XHS_AUTH_STATE_DIAGNOSTIC", context: { phase: "AUTH_STATE_BEFORE_CLOSE", platformKey: "xiaohongshu", accountId: "a", profilePath: "C:/p", marker: "new-before" } })
    ].join("\n"), "a", "C:/p");

    const pair = selectLatestOwnerDiagnostics(parsed);
    expect(pair?.[0].context.marker).toBe("new-live");
    expect(pair?.[1].context.marker).toBe("new-before");
  });
});
