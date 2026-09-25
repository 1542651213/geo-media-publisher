import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { SafeStorageCredentialStore, type SafeStoragePort } from "@publisher/security";
import { ToutiaoCredentialBundleService, type ToutiaoCookie } from "@publisher/adapters-toutiao/article-api";
import { synchronizeOwnedToutiaoCredential } from "../apps/desktop/src/main/toutiao-owned-credential-binding";

const dirs: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>["db"]> = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const encryption: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`fixture:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").slice("fixture:".length)
};
const cookie = (value: string): ToutiaoCookie => ({ name: "session", value,
  domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "toutiao-owned-credential-")); dirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  databases.push(opened.db);
  opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const account = opened.repository.createAccount({ platformKey: "toutiao", name: "Owner" });
  opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "toutiao", browserSessionId: "owned-session" });
  const credentials = new ToutiaoCredentialBundleService(new SafeStorageCredentialStore(join(dir, "credentials.enc"), encryption), opened.repository);
  const evidence = { accountId: account.id, creatorId: "123456789", remoteAuthState: "VALID" as const,
    runtimeActive: true, contextOwnsPage: true, cookies: [cookie("fixture-secret")], validatedAt: new Date().toISOString() };
  return { ...opened, account, credentials, evidence };
}

describe("MVP5 authorized BrowserSession credential binding", () => {
  it("first synchronizes verified owner identity and encrypted cookies without writing secrets to SQLite", () => {
    const { db, repository, account, credentials, evidence } = fixture();
    const result = synchronizeOwnedToutiaoCredential(repository, credentials, evidence, "123456789");
    expect(result).toMatchObject({ accountId: account.id, creatorId: "123456789", bundleVersion: 1, loginGeneration: 1, changed: true });
    expect(repository.getAccountById(account.id)?.externalAccountId).toBe("123456789");
    expect(credentials.assertBound(account.id, 1, 1, "pre_submit").sessionIdentity).toBe("123456789");
    expect(JSON.stringify(db.prepare("SELECT * FROM toutiao_article_credential_metadata").all())).not.toContain("fixture-secret");
  });

  it("is idempotent for the same session and increments only bundle version when cookies refresh", () => {
    const { repository, credentials, evidence } = fixture();
    const first = synchronizeOwnedToutiaoCredential(repository, credentials, evidence, "123456789");
    const same = synchronizeOwnedToutiaoCredential(repository, credentials, evidence, "123456789");
    const refreshed = synchronizeOwnedToutiaoCredential(repository, credentials,
      { ...evidence, cookies: [cookie("rotated-secret")] }, "123456789");
    expect(same).toMatchObject({ bundleVersion: first.bundleVersion, loginGeneration: first.loginGeneration, changed: false });
    expect(refreshed).toMatchObject({ bundleVersion: 2, loginGeneration: 1, changed: true });
  });

  it("rejects wrong creator identity and non-active or unverified sessions", () => {
    const { repository, credentials, evidence } = fixture();
    for (const bad of [
      { ...evidence, creatorId: "other" },
      { ...evidence, runtimeActive: false },
      { ...evidence, contextOwnsPage: false },
      { ...evidence, remoteAuthState: "UNKNOWN" as const }
    ]) expect(() => synchronizeOwnedToutiaoCredential(repository, credentials, bad, "123456789")).toThrow();
    expect(repository.getToutiaoCredentialMetadata(evidence.accountId)).toBeNull();
  });

  it("fails closed on a mismatched encrypted bundle and does not repair it from cookies", () => {
    const { repository, credentials, evidence } = fixture();
    synchronizeOwnedToutiaoCredential(repository, credentials, evidence, "123456789");
    repository.updateToutiaoCredentialMetadata({ accountId: evidence.accountId, bundleVersion: 2,
      loginGeneration: 1, credentialState: "VALID", credentialFingerprint: "a".repeat(64),
      validatedAt: evidence.validatedAt }, 1);
    expect(() => synchronizeOwnedToutiaoCredential(repository, credentials, evidence, "123456789")).toThrow();
    expect(repository.getToutiaoCredentialMetadata(evidence.accountId)?.bundleVersion).toBe(2);
  });
});
