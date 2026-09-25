import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureAbortedPublishRequest, prepareToutiaoArticleJob, ToutiaoCredentialBundleService } from "@publisher/adapters-toutiao/article-api";
import { openDatabase } from "@publisher/db";
import { SafeStorageCredentialStore, type SafeStoragePort } from "@publisher/security";
import { ToutiaoCapturedRequestOneShot } from "../apps/desktop/src/main/toutiao-captured-request-one-shot";

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

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "toutiao-mvp5-")); dirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  databases.push(opened.db);
  const repo = opened.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = repo.createBrand({ name: "MVP5", companyName: "MVP5" });
  const account = repo.syncBrowserPlatformAccount({ accountId: repo.createAccount({ platformKey: "toutiao", name: "Fixture" }).id,
    platformKey: "toutiao", browserSessionId: "fixture-session" });
  const article = repo.createArticle({ brandId: brand.id, topic: "test", keyword: "test", city: "", title: "Test", body: "<p>Hello</p>",
    summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "manual", aiModel: "none",
    generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: "d".repeat(64),
    qualityStatus: "passed", source: "production" })!;
  const job = repo.createToutiaoArticlePublishJob({ articleId: article.id, platformAccountId: account.platformAccountId!,
    finalPublishMode: "CONFIRM_BEFORE_PUBLISH", settings: { version: 1, coverMode: "none", coverImages: [], articleAdType: "none", remoteScheduledAt: null } });
  prepareToutiaoArticleJob(repo, job.id);
  const credentials = new ToutiaoCredentialBundleService(new SafeStorageCredentialStore(join(dir, "credentials.enc"), encryption), repo);
  credentials.update(account.id, { cookieMaterial: [{ name: "session", value: "fake-secret", domain: "mp.toutiao.com", path: "/",
    hostOnly: true, secure: true, expiresAt: null }], sessionIdentity: "fixture-creator", csrf: null, antiToken: null, msToken: null,
    expiresAt: null, validatedAt: new Date().toISOString(), state: "VALID", source: "browser_session" }, "initial_login");
  const captured = captureAbortedPublishRequest({ method: "POST",
    url: "https://mp.toutiao.com/mp/agw/article/publish?a_bogus=fake-signature&msToken=fake-token",
    headers: { cookie: "session=fake-secret", "content-type": "application/x-www-form-urlencoded" },
    body: Buffer.from("title=Test&content=%3Cp%3EHello%3C%2Fp%3E&pgc_feed_covers=%5B%5D") }, Date.now());
  return { opened, repo, job, credentials, captured };
}

describe("Toutiao MVP5 durable one-shot boundary", () => {
  it("persists Job, Intent, Record and one boundary claim before mock HTTP and never confirms publication from code 0", async () => {
    const { opened, repo, job, credentials, captured } = fixture();
    const transport = vi.fn(async () => {
      expect(repo.getSubmissionIntentByJob(job.id)?.finalSubmitCount).toBe(1);
      expect(repo.getPublishRecordByJob(job.id)?.status).toBe("Prepared");
      return { status: 200, responseShape: ["code", "data"], platformCode: 0, remoteId: "123456" };
    });
    const service = new ToutiaoCapturedRequestOneShot(repo, credentials, transport, undefined, () => true,
      async () => [{ name: "session", value: "fake-secret", domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null }]);
    const result = await service.submit(job.id, captured);
    expect(result).toMatchObject({ state: "SUBMIT_ACCEPTED", remoteId: "123456" });
    expect(transport).toHaveBeenCalledOnce();
    expect(repo.getSubmissionIntentByJob(job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "SUBMIT_ACCEPTED" });
    expect(repo.getJob(job.id)?.status).toBe("Publishing");
    expect(repo.getPublishRecordByJob(job.id)).toMatchObject({ status: "Publishing", success: false, verificationStatus: "WaitingUser" });
    expect((await service.submit(job.id, captured)).state).toBe("BLOCKED_PRE_SUBMIT");
    expect(transport).toHaveBeenCalledOnce();
    const confirmed = repo.reconcileJobAsPublished(job.id, { externalId: "123456",
      publishedUrl: "https://www.toutiao.com/article/123456/",
      response: { readOnly: true, verified: true, titleMatch: true, bodyMatch: true } });
    expect(confirmed.job.status).toBe("Success");
    expect(confirmed.record).toMatchObject({ status: "Published", success: true, verificationStatus: "Verified" });
    expect(repo.getSubmissionIntentByJob(job.id)?.finalSubmitCount).toBe(1);
    const ordinaryRows = JSON.stringify({ intents: opened.db.prepare("SELECT * FROM submission_intents").all(),
      records: opened.db.prepare("SELECT * FROM publish_records").all(), bindings: opened.db.prepare("SELECT * FROM toutiao_article_final_bindings").all() });
    for (const secret of ["fake-secret", "fake-signature", "fake-token"]) expect(ordinaryRows).not.toContain(secret);
  });

  it("marks timeout as uncertain and forbids a second final submit", async () => {
    const { repo, job, credentials, captured } = fixture();
    const transport = vi.fn(async () => { throw new Error("fixture response lost"); });
    const service = new ToutiaoCapturedRequestOneShot(repo, credentials, transport, undefined, () => true,
      async () => [{ name: "session", value: "fake-secret", domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null }]);
    expect(await service.submit(job.id, captured)).toMatchObject({ state: "NEEDS_RECONCILIATION" });
    expect(repo.getJob(job.id)?.status).toBe("NeedsReconciliation");
    expect(repo.getSubmissionIntentByJob(job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "UNCERTAIN" });
    expect((await service.submit(job.id, captured)).state).toBe("BLOCKED_PRE_SUBMIT");
    expect(transport).toHaveBeenCalledOnce();
  });
});
