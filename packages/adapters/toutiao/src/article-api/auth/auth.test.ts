import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import { SafeStorageCredentialStore, type SafeStoragePort } from "@publisher/security";
import { credentialFingerprint, ToutiaoCredentialBundleService, type ToutiaoCredentialBundle, type ToutiaoCredentialMaterial } from "./credential-bundle";
import { resolveCreatorCookies, type ToutiaoCookie } from "./cookie-resolver";
import { checkCreatorSession } from "./session-check";
import { resolveCsrfToken } from "./csrf";
import { resolveAntiToken } from "./anti-token";
import { resolveMsToken } from "./ms-token";
import type { ToutiaoHttpTransport } from "./transport";

const fixtureSafeStorage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`fixture:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").slice("fixture:".length),
};
const dirs: string[] = [];
const dbs: Array<ReturnType<typeof openDatabase>["db"]> = [];
afterEach(() => { for (const db of dbs.splice(0)) if (db.open) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const cookie: ToutiaoCookie = { name: "session", value: "secret-value", domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null };
const material: ToutiaoCredentialMaterial = { cookieMaterial: [cookie], sessionIdentity: "creator-a", csrf: null, antiToken: null, msToken: null,
  expiresAt: null, validatedAt: "2026-09-24T00:00:00.000Z", state: "VALID", source: "browser_session" };
function fixture(storagePort: SafeStoragePort = fixtureSafeStorage) {
  const dir = mkdtempSync(join(tmpdir(), "toutiao-credentials-")); dirs.push(dir);
  const opened = openDatabase(join(dir, "app.db"), join(process.cwd(), "packages", "db", "migrations")); dbs.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const account = opened.repository.createAccount({ platformKey: "toutiao", name: "Offline account" });
  const store = new SafeStorageCredentialStore(join(dir, "credentials.enc"), storagePort);
  return { dir, repo: opened.repository, account, store, service: new ToutiaoCredentialBundleService(store, opened.repository) };
}
function bundle(): ToutiaoCredentialBundle { return { accountId: "account", version: 1, loginGeneration: 1, capturedAt: "2026-09-24T00:00:00.000Z", ...material }; }

describe("Toutiao credential bundle", () => {
  it("versions token refresh separately from login generation and rejects stale bindings", () => {
    const { repo, account, store, service } = fixture();
    const first = service.update(account.id, material, "initial_login");
    const refreshed = service.update(account.id, { ...material, msToken: "new-ms", source: "token_refresh" }, "token_refresh");
    expect([first.version, refreshed.version]).toEqual([1, 2]);
    expect([first.loginGeneration, refreshed.loginGeneration]).toEqual([1, 1]);
    expect(service.read(account.id)?.msToken).toBe("new-ms");
    expect(() => service.update(account.id, { ...material, sessionIdentity: "different-creator" }, "token_refresh")).toThrowError(expect.objectContaining({ code: "CREDENTIAL_BINDING_MISMATCH" }));
    expect(repo.getToutiaoCredentialMetadata(account.id)?.credentialFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => service.assertBound(account.id, 1, 1, "pre_submit")).toThrowError(expect.objectContaining({ code: "CREDENTIAL_REPREFLIGHT_REQUIRED" }));
    expect(() => service.assertBound(account.id, 1, 1, "signed_or_submitting")).toThrowError(expect.objectContaining({ code: "CREDENTIAL_BINDING_MISMATCH" }));
    const loggedOut = service.update(account.id, { ...material, cookieMaterial: [], csrf: null, antiToken: null, msToken: null, validatedAt: null, state: "INVALID" }, "logout");
    const loggedIn = service.update(account.id, material, "login");
    expect([loggedOut.version, loggedOut.loginGeneration, loggedIn.version, loggedIn.loginGeneration]).toEqual([3, 2, 4, 3]);
    expect(() => service.assertBound(account.id, 2, 1, "pre_submit")).toThrowError(expect.objectContaining({ code: "CREDENTIAL_BINDING_MISMATCH" }));
    expect(store.has(`toutiao:article-api:credential-bundle:${account.id}`)).toBe(true);
    expect(JSON.stringify(repo.getToutiaoCredentialMetadata(account.id))).not.toContain("secret-value");
  });

  it("rolls back a partial metadata update and rejects a wrong-account bundle", () => {
    const { repo, account, store, service } = fixture();
    service.update(account.id, material, "initial_login");
    const before = store.get(`toutiao:article-api:credential-bundle:${account.id}`);
    const spy = vi.spyOn(repo, "updateToutiaoCredentialMetadata").mockImplementation(() => { throw new Error("fixture write failure"); });
    expect(() => service.update(account.id, { ...material, msToken: "changed" }, "token_refresh")).toThrow("fixture write failure");
    spy.mockRestore();
    expect(store.get(`toutiao:article-api:credential-bundle:${account.id}`)).toBe(before);
    expect(service.read(account.id)?.version).toBe(1);
    store.set(`toutiao:article-api:credential-bundle:${account.id}`, JSON.stringify({ ...service.read(account.id), accountId: "other-account" }));
    expect(() => service.read(account.id)).toThrowError(expect.objectContaining({ code: "CREDENTIAL_BINDING_MISMATCH" }));
  });

  it("fails closed after a restart when a crash leaves the secret bundle ahead of SQLite", () => {
    const { dir, repo, account, store, service } = fixture();
    const first = service.update(account.id, material, "initial_login");
    store.set(`toutiao:article-api:credential-bundle:${account.id}`, JSON.stringify({ ...first, version: 2, msToken: "new-token" }));
    const restarted = new ToutiaoCredentialBundleService(new SafeStorageCredentialStore(join(dir, "credentials.enc"), fixtureSafeStorage), repo);
    expect(() => restarted.read(account.id)).toThrowError(expect.objectContaining({ code: "CREDENTIAL_BINDING_MISMATCH" }));
    expect(() => restarted.assertBound(account.id, 1, 1, "pre_submit")).toThrow();
  });

  it("fails closed after a restart when SQLite is ahead of the secret bundle", () => {
    const { dir, repo, account, service } = fixture();
    const first = service.update(account.id, material, "initial_login");
    repo.updateToutiaoCredentialMetadata({ accountId: account.id, bundleVersion: 2, loginGeneration: 1, credentialState: "VALID",
      credentialFingerprint: credentialFingerprint(first), validatedAt: first.validatedAt }, 1);
    const restarted = new ToutiaoCredentialBundleService(new SafeStorageCredentialStore(join(dir, "credentials.enc"), fixtureSafeStorage), repo);
    expect(() => restarted.read(account.id)).toThrowError(expect.objectContaining({ code: "CREDENTIAL_BINDING_MISMATCH" }));
  });

  it("keeps SQLite and the old encrypted bundle when encryption fails before a refresh", () => {
    let fail = false;
    const port: SafeStoragePort = { isEncryptionAvailable: () => true,
      encryptString: (value) => { if (fail) throw new Error("fixture encrypt failed"); return Buffer.from(`fixture:${value}`); },
      decryptString: (value) => value.toString("utf8").slice("fixture:".length) };
    const { dir, repo, account, service } = fixture(port);
    service.update(account.id, material, "initial_login");
    fail = true;
    expect(() => service.update(account.id, { ...material, msToken: "new-token" }, "token_refresh")).toThrow("fixture encrypt failed");
    expect(repo.getToutiaoCredentialMetadata(account.id)?.bundleVersion).toBe(1);
    expect(new ToutiaoCredentialBundleService(new SafeStorageCredentialStore(join(dir, "credentials.enc"), port), repo).read(account.id)?.version).toBe(1);
  });
});

describe("Toutiao offline authentication transport", () => {
  it("selects the creator-domain cookie among duplicate names and rejects missing required cookies", () => {
    const parent = { ...cookie, domain: ".toutiao.com", value: "parent", hostOnly: false };
    expect(resolveCreatorCookies([parent, cookie], ["session"]).header).toBe("session=secret-value");
    expect(() => resolveCreatorCookies([parent], ["session", "missing"])).toThrowError(expect.objectContaining({ code: "TOUTIAO_COOKIE_UNAVAILABLE" }));
    expect(credentialFingerprint({ ...bundle(), cookieMaterial: [cookie, parent] })).toBe(credentialFingerprint({ ...bundle(), cookieMaterial: [parent, cookie] }));
  });

  it("maps explicit auth evidence to INVALID and transport/server/malformed failures to UNKNOWN", async () => {
    const make = (status: number, body: unknown): ToutiaoHttpTransport => ({ mode: "MOCK", request: vi.fn(async () => ({ status, headers: {}, body })) });
    expect(await checkCreatorSession(bundle(), make(200, { authenticated: true }), "https://example.invalid/session", ["session"], ["example.invalid"])).toMatchObject({ state: "VALID" });
    expect(await checkCreatorSession(bundle(), make(401, {}), "https://example.invalid/session", ["session"], ["example.invalid"])).toMatchObject({ state: "INVALID" });
    expect(await checkCreatorSession(bundle(), make(200, { authenticated: false }), "https://example.invalid/session", ["session"], ["example.invalid"])).toMatchObject({ state: "INVALID" });
    expect(await checkCreatorSession(bundle(), make(500, {}), "https://example.invalid/session", ["session"], ["example.invalid"])).toMatchObject({ state: "UNKNOWN", reasonCode: "SERVER_UNKNOWN" });
    expect(await checkCreatorSession(bundle(), make(200, "malformed"), "https://example.invalid/session", ["session"], ["example.invalid"])).toMatchObject({ state: "UNKNOWN", reasonCode: "MALFORMED_RESPONSE" });
    expect(await checkCreatorSession(bundle(), { mode: "MOCK", request: async () => { throw new Error("timeout"); } }, "https://example.invalid/session", ["session"], ["example.invalid"])).toMatchObject({ state: "UNKNOWN", reasonCode: "NETWORK_UNKNOWN" });
    const blocked = vi.fn(async () => { throw new Error("must not run"); });
    expect(await checkCreatorSession(bundle(), { mode: "MOCK", request: blocked }, "https://example.invalid/session", ["session"])).toMatchObject({ state: "UNKNOWN" });
    expect(blocked).not.toHaveBeenCalled();
    expect(await checkCreatorSession(bundle(), { mode: "REAL", request: blocked }, "https://mp.toutiao.com/offline-fixture", ["session"])).toMatchObject({ state: "UNKNOWN", reasonCode: "NETWORK_UNKNOWN" });
    expect(blocked).not.toHaveBeenCalled();
  });

  it("resolves CSRF, anti-token and msToken through only injected mock transport without DB effects", async () => {
    const transport: ToutiaoHttpTransport = { mode: "MOCK", request: vi.fn(async ({ url }) => ({ status: 200,
      headers: url.endsWith("csrf") ? { "x-secsdk-csrf-token": "csrf-secret" } as Record<string, string> : {} as Record<string, string>,
      body: url.endsWith("anti") ? { antiToken: "anti-secret" } : { msToken: "ms-secret" } })) };
    expect((await resolveCsrfToken(bundle(), transport, "https://example.invalid/csrf", ["session"], ["example.invalid"])).value).toBe("csrf-secret");
    expect((await resolveAntiToken(bundle(), transport, "https://example.invalid/anti", ["session"], ["example.invalid"])).value).toBe("anti-secret");
    expect((await resolveMsToken(bundle(), transport, "https://example.invalid/ms", ["session"], ["example.invalid"])).value).toBe("ms-secret");
    expect(vi.mocked(transport.request)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(transport.request).mock.calls[2]?.[0].headers).toEqual({});
  });
});
