import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@publisher/db";
import { CredentialDecryptError, type CredentialStore } from "@publisher/security";
import { OfficialApiAdapter, parseOfficialApiCredential, assertOfficialApiCapabilities } from "../packages/adapters/official-api/src";
import { importOfficialApiCredential, officialApiAccountView, verifyOfficialApiConnection } from "../apps/desktop/src/main/official-api-account";

const publicTestSecret = "0123456789abcdef0123456789abcdef"; // gitleaks:allow -- public fixture, never a service credential
const configuration = { origin: "https://staging.kangyihb.com", siteId: "kangyi", environment: "staging", keyId: "test-only-key", secret: publicTestSecret };
const capabilities = { siteId: "kangyi", environment: "staging" as const, protocolVersion: "2", contentKinds: ["article" as const, "case" as const],
  limits: { jsonBytes: 1048576, mediaBytes: 8388608, imagePixels: 40000000, imageDimension: 10000 }, writesEnabled: true };
class MemoryStore implements CredentialStore {
  readonly values = new Map<string, string>();
  get(key: string) { return this.values.get(key) ?? null; }
  has(key: string) { return this.values.has(key); }
  set(key: string, value: string) { this.values.set(key, value); }
  setMany(values: Readonly<Record<string, string>>) { for (const [key, value] of Object.entries(values)) this.values.set(key, value); }
  delete(key: string) { this.values.delete(key); }
}
const directories: string[] = [];
const databases: Array<{ close(): void }> = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "official-api-account-")); directories.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), join(process.cwd(), "packages/db/migrations")); databases.push(opened.db);
  opened.repository.seedPlatformCatalog(join(process.cwd(), "PLATFORMS.csv"));
  return { ...opened, credentials: new MemoryStore() };
}

describe("OfficialAPI Main connection boundary", () => {
  it("rolls back new account and authorization when encrypted storage fails", async () => {
    const { repository, credentials, db } = fixture();
    credentials.setMany = () => { throw Error("fixture secure storage unavailable"); };
    await expect(importOfficialApiCredential({ repository, credentials, verify: async () => capabilities }, JSON.stringify(configuration), "staging"))
      .rejects.toThrow("fixture secure storage unavailable");
    expect(repository.listAccounts()).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM account_authorizations").get()).toEqual({ count: 0 });
    expect(credentials.values.size).toBe(0);
  });
  it("requires atomic credential persistence instead of a five-field partial write", async () => {
    const { repository, credentials } = fixture();
    Object.defineProperty(credentials, "setMany", { value: undefined });
    await expect(importOfficialApiCredential({ repository, credentials, verify: async () => capabilities }, JSON.stringify(configuration), "staging"))
      .rejects.toThrow("ATOMIC_CREDENTIAL_STORAGE_REQUIRED");
    expect(repository.listAccounts()).toHaveLength(0);
  });
  it("accepts the raw UTF-8 byte contract without trimming or rejecting valid multibyte secrets", () => {
    const secret = "密".repeat(11);
    expect(parseOfficialApiCredential(JSON.stringify({ ...configuration, secret }), "staging").secret).toBe(secret);
    expect(() => parseOfficialApiCredential(JSON.stringify({ ...configuration, secret: "密".repeat(10) }), "staging")).toThrow();
  });
  it("imports verified scope through Main, storing the secret only in the credential store", async () => {
    const { repository, db, credentials } = fixture();
    const result = await importOfficialApiCredential({ repository, credentials, verify: async () => capabilities }, JSON.stringify(configuration), "staging");
    expect(result).toMatchObject({ configured: true, connectionMode: "OfficialAPI", environment: "staging", siteId: "kangyi", writesEnabled: true });
    expect(JSON.stringify(result)).not.toContain(publicTestSecret);
    expect(JSON.stringify(db.prepare("SELECT * FROM accounts").all())).not.toContain(publicTestSecret);
    expect(repository.getAccountById(result.accountId, "website")).toMatchObject({ connectionMode: "OfficialAPI", loginStatus: "logged_in", allowAutoPublish: false });
    expect(credentials.get(`account:${result.accountId}:website:secret`)).toBe(publicTestSecret);
  });
  it.each([
    { ...configuration, siteId: "huiquan" },
    { ...configuration, origin: "https://xn--4gq502b.com" },
    { ...configuration, origin: "https://staging.kangyihb.com/admin/" },
    { ...configuration, origin: "http://staging.kangyihb.com" },
    { ...configuration, status: "FinalApproved" }
  ])("rejects credential scope or arbitrary state input before persistence (%j)", async config => {
    const { repository, credentials } = fixture();
    await expect(importOfficialApiCredential({ repository, credentials, verify: async () => capabilities }, JSON.stringify(config), "staging")).rejects.toThrow();
    expect(repository.listAccounts().filter(a => a.platformKey === "website")).toHaveLength(0);
    expect(credentials.values.size).toBe(0);
  });
  it("rechecks the remote environment before creating any account", async () => {
    const { repository, credentials } = fixture();
    await expect(importOfficialApiCredential({ repository, credentials, verify: async () => ({ ...capabilities, environment: "production" }) }, JSON.stringify(configuration), "staging")).rejects.toThrow("ENVIRONMENT");
    expect(repository.listAccounts().filter(a => a.platformKey === "website")).toHaveLength(0);
  });
  it("does not silently create a second account on a repeated environment import", async () => {
    const { repository, credentials } = fixture();
    const deps = { repository, credentials, verify: async () => capabilities };
    await importOfficialApiCredential(deps, JSON.stringify(configuration), "staging");
    await expect(importOfficialApiCredential(deps, JSON.stringify(configuration), "staging")).rejects.toThrow("ACCOUNT_SELECTION_REQUIRED");
    expect(repository.listAccounts().filter(a => a.platformKey === "website")).toHaveLength(1);
  });
  it("keeps read-only capability separate from account connection", async () => {
    const { repository, credentials } = fixture();
    const result = await importOfficialApiCredential({ repository, credentials, verify: async () => ({ ...capabilities, writesEnabled: false }) }, JSON.stringify(configuration), "staging");
    expect(result.writesEnabled).toBe(false);
    expect(result.status).toBe("READ_ONLY");
  });
  it("never changes an existing scoped account from staging to production", async () => {
    const { repository, credentials } = fixture();
    const deps = { repository, credentials, verify: async () => capabilities };
    const staging = await importOfficialApiCredential(deps, JSON.stringify(configuration), "staging");
    const before = new Map(credentials.values);
    await expect(importOfficialApiCredential({ repository, credentials, verify: async () => ({ ...capabilities, environment: "production" }) },
      JSON.stringify({ ...configuration, environment: "production", origin: "https://xn--4gq502b.com" }), "production", staging.accountId))
      .rejects.toThrow("ACCOUNT_SCOPE_IMMUTABLE");
    expect(credentials.values).toEqual(before);
    expect(repository.getAccountById(staging.accountId, "website")?.externalAccountId).toBe("kangyi:staging");
  });
  it("rejects archived accounts before remote verification or storage", async () => {
    const { repository, credentials } = fixture();
    const account = repository.createAccount({ platformKey: "website", name: "Archived fixture" });
    repository.markPlatformAccountDisconnected(account.id, "website", "AppCredential");
    let verifications = 0;
    await expect(importOfficialApiCredential({ repository, credentials, verify: async () => { verifications += 1; return capabilities; } },
      JSON.stringify(configuration), "staging", account.id)).rejects.toThrow("ACCOUNT_NOT_FOUND");
    expect(verifications).toBe(0);
    expect(credentials.values.size).toBe(0);
  });
  it("does not create duplicate scoped accounts during concurrent verification", async () => {
    const { repository, credentials } = fixture();
    const outcomes = await Promise.allSettled([1, 2].map(() => importOfficialApiCredential({ repository, credentials,
      verify: async () => capabilities }, JSON.stringify(configuration), "staging")));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    expect(repository.listAccounts().filter(account => account.platformKey === "website")).toHaveLength(1);
  });
  it("rejects duplicate scope even when Renderer supplies another unbound account id", async () => {
    const { repository, credentials } = fixture();
    const deps = { repository, credentials, verify: async () => capabilities };
    const first = await importOfficialApiCredential(deps, JSON.stringify(configuration), "staging");
    const second = repository.createAccount({ platformKey: "website", name: "Unbound second" });
    await expect(importOfficialApiCredential(deps, JSON.stringify(configuration), "staging", second.id)).rejects.toThrow("SCOPE_ALREADY_BOUND");
    expect(repository.getAccountById(second.id, "website")?.externalAccountId).toBeNull();
    expect(credentials.get(`account:${second.id}:website:secret`)).toBeNull();
    expect(repository.getAccountById(first.accountId, "website")?.externalAccountId).toBe("kangyi:staging");
  });
  it("cannot revive an account disconnected during remote verification", async () => {
    const { repository, credentials } = fixture();
    const view = await importOfficialApiCredential({ repository, credentials, verify: async () => capabilities }, JSON.stringify(configuration), "staging");
    await expect(verifyOfficialApiConnection({ repository, credentials, verify: async () => {
      repository.markPlatformAccountDisconnected(view.accountId, "website", "AppCredential"); return capabilities;
    } }, view.accountId)).rejects.toThrow("ACCOUNT_CHANGED");
    expect(repository.getAccountById(view.accountId, "website")).toMatchObject({ loginStatus: "logged_out", authorizationStatus: "NotAuthorized" });
    expect(repository.getAccountById(view.accountId, "website")?.archivedAt).not.toBeNull();
  });
  it("does not apply verified capability evidence to replaced credentials", async () => {
    const { repository, credentials } = fixture();
    const view = await importOfficialApiCredential({ repository, credentials, verify: async () => capabilities }, JSON.stringify(configuration), "staging");
    await expect(verifyOfficialApiConnection({ repository, credentials, verify: async () => {
      credentials.set(`account:${view.accountId}:website:keyId`, "replacement-test-key"); return capabilities;
    } }, view.accountId)).rejects.toThrow("CREDENTIAL_CHANGED");
  });
  it("reports missing or undecryptable credentials without trusting DB logged_in", () => {
    const { repository, credentials } = fixture();
    const account = repository.createAccount({ platformKey: "website", name: "Fixture" });
    repository.updateAccount(account.id, { loginStatus: "logged_in" });
    expect(officialApiAccountView(repository, credentials, account.id)).toMatchObject({ configured: false, status: "MISSING" });
    credentials.get = () => { throw new CredentialDecryptError(); };
    expect(officialApiAccountView(repository, credentials, account.id)).toMatchObject({ configured: false, status: "DECRYPT_FAILED" });
  });
  it("retains known account environment when credentials fail and never creates a replacement account", async () => {
    const { repository, credentials } = fixture();
    const account = repository.createAccount({ platformKey: "website", name: "Existing scoped account" });
    repository.syncOfficialApiAccount({ accountId: account.id, platformKey: "website", externalAccountId: "kangyi:staging" });
    expect(officialApiAccountView(repository, credentials, account.id)).toMatchObject({ configured: false, environment: "staging", status: "MISSING", writesEnabled: false });
    await expect(importOfficialApiCredential({ repository, credentials, verify: async () => capabilities }, JSON.stringify(configuration), "staging"))
      .rejects.toThrow("ACCOUNT_SELECTION_REQUIRED");
    expect(repository.listAccounts()).toHaveLength(1);
  });
  it("rejects invalid V2 capability values and environment mismatches", () => {
    const config = parseOfficialApiCredential(JSON.stringify(configuration), "staging");
    expect(() => assertOfficialApiCapabilities(config, { ...capabilities, protocolVersion: "3" })).toThrow();
    expect(() => assertOfficialApiCapabilities(config, { ...capabilities, writesEnabled: "true" })).toThrow();
    expect(() => assertOfficialApiCapabilities(config, { ...capabilities, siteId: "shupai" })).toThrow();
  });
  it("cannot publish through adapter or diagnostic calls before real acceptance", async () => {
    const adapter = new OfficialApiAdapter();
    expect(() => adapter.assertFormalSubmitAvailable()).toThrow("ACCEPTANCE_REQUIRED");
    await expect(adapter.publishArticle({ accountId: "fixture", accountName: "Fixture", platformKey: "website", settings: {} },
      { articleId: "fixture", title: "Title", body: "Body", summary: "Summary", tags: [] })).rejects.toThrow("ACCEPTANCE_REQUIRED");
  });
});
