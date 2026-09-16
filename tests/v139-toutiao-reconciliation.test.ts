import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const tempDirs: string[] = [];
const databases: Array<{ close(): void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("V1.3.9 Toutiao accepted pending-review reconciliation", () => {
  it("closes the existing uncertain records as Submitted without changing finalSubmitCount or creating rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-v139-toutiao-reconciliation-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const brand = opened.repository.createBrand({ name: "Toutiao reconciliation brand", companyName: "GMP" });
    const rawAccount = opened.repository.createAccount({ platformKey: "toutiao", name: "Toutiao account" });
    const account = opened.repository.syncBrowserPlatformAccount({ accountId: rawAccount.id, platformKey: "toutiao", browserSessionId: "toutiao-fixture-session" });
    const article = opened.repository.createArticle({ brandId: brand.id, topic: "reconciliation", keyword: "test", city: "Nanjing", title: "GMP Toutiao reconciliation", body: "accepted pending review", summary: "", tags: [], seoKeywords: [], articleType: "self-test", aiProvider: "system", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "toutiao-reconciliation-hash", qualityStatus: "passed", qualityWarnings: [], source: "production" });
    if (!article) throw new Error("article fixture failed");
    const job = opened.repository.createArticlePublishJob({ articleId: article.id, platformKey: "toutiao", platformAccountId: account.platformAccountId ?? account.id });
    opened.repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: "toutiao", articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false, response: { stage: "editor_prepared" }, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation", verificationStatus: "WaitingUser" });
    opened.repository.confirmJob(job.id, false);
    const intent = opened.repository.prepareSubmissionIntent(job.id);
    opened.repository.claimFinalSubmitAttempt(intent.id);
    opened.repository.markSubmissionIntentUncertain(intent.id, "SUBMISSION_UNCERTAIN");
    const beforeCounts = { jobs: opened.repository.listJobs().length, records: opened.repository.getPublishRecords().length };

    const reconciled = opened.repository.reconcileJobAsSubmitted(job.id, { response: { adapter: "toutiao", readOnly: true, titleMatch: true, accountMatch: true, timeWindowMatch: true, platformStatus: "审核中" } });

    expect(reconciled.job).toMatchObject({ id: job.id, status: "Submitted", lastErrorCode: null });
    expect(reconciled.record).toMatchObject({ id: expect.any(String), status: "Submitted", success: false, publishedExternalId: null, publishedUrl: null, verificationStatus: "WaitingUser" });
    expect(reconciled.record.response).toMatchObject({ reconciliationStatus: "PENDING_REVIEW", reconciliation: { platformStatus: "审核中" } });
    expect(opened.repository.getSubmissionIntentByJob(job.id)).toMatchObject({ state: "Submitted", finalSubmitCount: 1, errorCode: null, externalId: null });
    expect({ jobs: opened.repository.listJobs().length, records: opened.repository.getPublishRecords().length }).toEqual(beforeCounts);

    const published = opened.repository.reconcileJobAsPublished(job.id, { externalId: "7678241442350891547", publishedUrl: "https://www.toutiao.com/item/7678241442350891547/", response: { readOnly: true, verified: true } });
    expect(published.job).toMatchObject({ id: job.id, status: "Success" });
    expect(published.record).toMatchObject({ status: "Published", success: true, publishedExternalId: "7678241442350891547", publishedUrl: "https://www.toutiao.com/item/7678241442350891547/", verificationStatus: "Verified" });
    expect(opened.repository.getSubmissionIntentByJob(job.id)).toMatchObject({ state: "Submitted", finalSubmitCount: 1, errorCode: null, externalId: "7678241442350891547" });
  });
});
