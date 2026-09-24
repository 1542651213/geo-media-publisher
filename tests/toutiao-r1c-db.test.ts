import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildToutiaoFinalPayload, BoundToutiaoArticleSigner, prepareToutiaoArticleJob, ToutiaoCredentialBundleService, toutiaoAuthSignerEvidence } from "@publisher/adapters-toutiao/article-api";
import { openDatabase, runMigrations } from "@publisher/db";
import { sanitizeValue } from "@publisher/logger";
import { SafeStorageCredentialStore, type SafeStoragePort } from "@publisher/security";

const migrations = join(process.cwd(), "packages", "db", "migrations");
const dirs: string[] = [];
const dbs: Array<ReturnType<typeof openDatabase>["db"]> = [];
afterEach(() => { for (const db of dbs.splice(0)) if (db.open) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const fixtureSafeStorage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`fixture:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").slice("fixture:".length),
};
function fixture(migrationDir = migrations) {
  const dir = mkdtempSync(join(tmpdir(), "toutiao-r1c-db-")); dirs.push(dir);
  const opened = openDatabase(join(dir, "app.db"), migrationDir); dbs.push(opened.db);
  const repo = opened.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = repo.createBrand({ name: "R1C", companyName: "R1C" });
  const account = repo.syncBrowserPlatformAccount({ accountId: repo.createAccount({ platformKey: "toutiao", name: "R1C account" }).id, platformKey: "toutiao", browserSessionId: "offline-fixture" });
  const article = repo.createArticle({ brandId: brand.id, topic: "r1c", keyword: "r1c", city: "南京", title: "图文标题", body: "<p>正文</p>", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: "c".repeat(64), qualityStatus: "passed", qualityWarnings: [], source: "production" })!;
  const job = repo.createToutiaoArticlePublishJob({ articleId: article.id, platformAccountId: account.platformAccountId! });
  return { opened, repo, account, article, job };
}

describe("Toutiao R1-C durable non-secret bindings", () => {
  it("binds semantic content, final payload, credential generation and signer evidence before submit without crossing the boundary", async () => {
    const { opened, repo, account, job } = fixture();
    const credentialDir = mkdtempSync(join(tmpdir(), "toutiao-r1c-credentials-")); dirs.push(credentialDir);
    const store = new SafeStorageCredentialStore(join(credentialDir, "credentials.enc"), fixtureSafeStorage);
    const service = new ToutiaoCredentialBundleService(store, repo);
    const material = { cookieMaterial: [], sessionIdentity: "fixture-session", csrf: "csrf-secret", antiToken: "anti-secret", msToken: "ms-secret",
      expiresAt: null, validatedAt: "2026-09-24T01:00:00.000Z", state: "VALID" as const, source: "browser_session" as const };
    const credential = service.update(account.id, material, "initial_login");
    const prepared = prepareToutiaoArticleJob(repo, job.id, new Date("2026-09-24T00:00:00.000Z"));
    const intent = repo.prepareSubmissionIntent(job.id);
    repo.bindToutiaoArticlePreparationToIntent(job.id, intent.id);
    const final = buildToutiaoFinalPayload(prepared.payload, prepared.contentBindingHash, []);
    expect(final.state).toBe("FINAL_PAYLOAD_READY");
    if (final.state !== "FINAL_PAYLOAD_READY") return;
    const signer = new BoundToutiaoArticleSigner({ version: "offline-fixture-v1", compute: async (canonical) => createHash("sha256").update(`fixture-signature:${canonical}`).digest("hex") },
      { accountId: account.id, finalPayloadHash: final.finalPayloadHash, credentialBundleVersion: credential.version, loginGeneration: credential.loginGeneration }, ["csrf", "antiToken", "msToken"]);
    const signed = await signer.sign({ finalPayload: final.payload, finalPayloadHash: final.finalPayloadHash, credentialBundleVersion: credential.version,
      loginGeneration: credential.loginGeneration, tokenMaterial: { csrf: "csrf-secret", antiToken: "anti-secret", msToken: "ms-secret" }, requestMetadata: { method: "POST" } });
    repo.bindToutiaoFinalPayloadForFutureSubmit({ jobId: job.id, intentId: intent.id, accountId: account.id, contentBindingHash: prepared.contentBindingHash,
      finalPayloadHash: final.finalPayloadHash, credentialBundleVersion: credential.version, loginGeneration: credential.loginGeneration,
      signerVersion: signed.signerVersion, signerInputHash: signed.inputHash, signatureGeneratedAt: signed.signedAt, authValidatedAt: credential.validatedAt! }, service);
    expect(repo.assertToutiaoFutureSubmitReady(job.id, service)).toBe("SUBMIT_READY");
    const bundleKey = `toutiao:article-api:credential-bundle:${account.id}`;
    const encryptedBundle = store.get(bundleKey)!;
    store.delete(bundleKey);
    expect(() => repo.assertToutiaoFutureSubmitReady(job.id, service)).toThrow();
    store.set(bundleKey, encryptedBundle);
    expect(repo.getSubmissionIntentByJob(job.id)?.finalSubmitCount).toBe(0);
    expect(repo.getSubmissionIntentByJob(job.id)?.submitBoundaryEnteredAt).toBeNull();
    const serializedDb = JSON.stringify({ metadata: opened.db.prepare("SELECT * FROM toutiao_article_credential_metadata").all(),
      finalBindings: opened.db.prepare("SELECT * FROM toutiao_article_final_bindings").all(), preparations: opened.db.prepare("SELECT * FROM toutiao_article_job_preparations").all() });
    for (const secret of ["csrf-secret", "anti-secret", "ms-secret", signed.signature]) expect(serializedDb).not.toContain(secret);
    service.update(account.id, { ...material, msToken: "new-ms-secret", source: "token_refresh" }, "token_refresh");
    expect(() => repo.assertToutiaoFutureSubmitReady(job.id, service)).toThrow();
    service.update(account.id, material, "login");
    expect(() => repo.assertToutiaoFutureSubmitReady(job.id, service)).toThrow();
  });

  it("upgrades 0024 twice without changing a historical Published record", () => {
    const dir = mkdtempSync(join(tmpdir(), "toutiao-r1c-prior-")); dirs.push(dir);
    const prior = join(dir, "prior"); mkdirSync(prior);
    for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name < "0025_toutiao_auth_final_binding.sql")) copyFileSync(join(migrations, file), join(prior, file));
    const { opened, repo, account, article, job } = fixture(prior);
    const record = repo.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId!, platformKey: "toutiao", articleId: article.id,
      publishedUrl: "https://example.invalid/historical", publishedExternalId: "historical", success: true, response: { fixture: true }, status: "Published" });
    const before = opened.db.prepare("SELECT id,status,success,published_url,published_external_id,response_json FROM publish_records WHERE id=?").get(record.id);
    runMigrations(opened.db, migrations);
    runMigrations(opened.db, migrations);
    expect(opened.db.prepare("SELECT id,status,success,published_url,published_external_id,response_json FROM publish_records WHERE id=?").get(record.id)).toEqual(before);
    expect((opened.db.prepare("SELECT COUNT(*) AS n FROM migrations WHERE id='0025_toutiao_auth_final_binding.sql'").get() as { n: number }).n).toBe(1);
  });

  it("redacts nested auth material from logs and PublishRecord responses but preserves allowlisted evidence", () => {
    const { opened, repo, account, article, job } = fixture();
    const response = { nested: { cookie: "cookie-secret", "tt-anti-token": "anti-secret", msToken: "ms-secret", a_bogus: "abogus-secret", signature: "sign-secret" },
      message: "x-secsdk-csrf-token=csrf-secret", status: 200 };
    const record = repo.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId!, platformKey: "toutiao", articleId: article.id,
      publishedUrl: null, publishedExternalId: null, success: false, response, status: "Failed" });
    repo.insertLog({ level: "info", module: "TOUTIAO", code: "FIXTURE", message: "msToken=ms-secret", context: response });
    const data = JSON.stringify({ record: repo.getPublishRecordByJob(job.id), log: opened.db.prepare("SELECT * FROM app_logs ORDER BY created_at DESC LIMIT 1").get() });
    const redacted = JSON.stringify(sanitizeValue(response));
    for (const secret of ["cookie-secret", "anti-secret", "ms-secret", "abogus-secret", "sign-secret", "csrf-secret"]) {
      expect(data).not.toContain(secret);
      expect(redacted).not.toContain(secret);
    }
    expect(record.response).toMatchObject({ nested: { cookie: "[REDACTED]", msToken: "[REDACTED]" }, status: 200 });
    const evidence = toutiaoAuthSignerEvidence({ accountId: account.id, credentialBundleVersion: 2, loginGeneration: 1, credentialState: "VALID",
      credentialValidatedAt: "2026-09-24T01:00:00.000Z", credentialFingerprint: "a".repeat(64), finalPayloadHash: "b".repeat(64), signerVersion: "fixture-v1",
      signerInputHash: "c".repeat(64), signatureGeneratedAt: "2026-09-24T02:00:00.000Z", reasonCode: "AUTHENTICATED", httpStatus: 200 });
    expect(JSON.stringify(evidence)).not.toContain("secret");
  });
});
