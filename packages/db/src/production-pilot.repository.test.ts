import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { XhsContextIdentityAttestation } from "@publisher/domain";
import { openDatabase } from "./index";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const directories: string[] = [];
const databases: Array<{ close(): void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type PilotRepository = {
  ensureProductionPilotAuthorization(input: { pilotId: string; expiresAt: string; maxFinalSubmissions: number }): void;
  registerProductionPilotPreparedBinding(input: { pilotId: string; jobId: string; snapshotId: string; publishRecordId: string }): void;
  claimProductionPilotFinalSubmit(input: { pilotId: string; buildSha256: string; jobId: string; intentId: string; snapshotId: string; subject: XhsContextIdentityAttestation }): { slotNumber: number };
  recordProductionPilotAccepted(input: { pilotId: string; intentId: string; externalId: string; publishedUrl: string; receiptSha256: string }): { state: string };
  markProductionPilotSubmissionUnknown(input: { pilotId: string; intentId: string; errorCode: string }): { status: string };
  listProductionPilotSlots(pilotId: string): Array<{ state: string; intentId: string }>;
};

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "production-pilot-repository-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  const repository = database.repository;
  repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  const brand = repository.createBrand({ name: "Pilot brand", companyName: "Pilot brand" });
  const account = repository.createAccount({ platformKey: "xiaohongshu", name: "Pilot creator" });
  repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", browserSessionId: "pilot-session", externalAccountId: "pilot-creator" });
  repository.updateAccount(account.id, { loginStatus: "logged_in", minimumIntervalSeconds: 0 });
  const subject = (): XhsContextIdentityAttestation => ({
    accountId: account.id,
    platformKey: "xiaohongshu",
    expectedExternalCreatorId: "pilot-creator",
    observedExternalCreatorId: "pilot-creator",
    externalAccountId: "pilot-creator",
    browserSessionIdentity: "pilot-session",
    browserContextIdentity: "pilot-context",
    sourcePageIdentity: "pilot-page",
    sourceOrigin: "https://creator.xiaohongshu.com",
    sourcePathname: "/publish/publish",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    verified: true
  });
  const prepare = (ordinal: number) => {
    const article = repository.createArticle({ brandId: brand.id, topic: "pilot", keyword: "pilot", city: "", title: `Pilot article ${ordinal}`, body: `Bound body ${ordinal}`, summary: "", tags: [], seoKeywords: [], articleType: "article", aiProvider: "fixture", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: randomUUID(), source: "production" })!;
    const bytes = Buffer.from(`pilot-image-${ordinal}`);
    const imagePath = join(directory, `image-${ordinal}.png`);
    writeFileSync(imagePath, bytes);
    const image = repository.createImageAsset({ brandId: brand.id, name: `pilot-${ordinal}`, filePath: imagePath, originalFileName: `image-${ordinal}.png`, mimeType: "image/png", size: bytes.length, universal: true });
    const job = repository.createArticlePublishJob({ articleId: article.id, platformKey: "xiaohongshu", platformAccountId: account.platformAccountId!, selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH" });
    repository.confirmJob(job.id, false);
    repository.claimJob(job.id);
    repository.prepareSubmissionIntent(job.id);
    const preparedRecord = repository.insertPublishRecord({
      jobId: job.id,
      accountId: account.id,
      platformAccountId: account.platformAccountId,
      platformKey: "xiaohongshu",
      articleId: article.id,
      publishedUrl: null,
      publishedExternalId: null,
      success: false,
      response: { preparedBy: "production-pilot-repository-test" },
      dryRun: false,
      status: "Prepared",
      publishMode: "ASSISTED",
      automationType: "BrowserAutomation",
      verificationStatus: "WaitingUser"
    });
    return { job: repository.getJob(job.id)!, intent: repository.getSubmissionIntentByJob(job.id)!, preparedRecord, imageSha256: createHash("sha256").update(bytes).digest("hex") };
  };
  return { database, repository, subject, prepare };
}

it("atomically allocates at most three formal pilot slots with the F01 final claim", () => {
  const fixtureState = fixture();
  const repository = fixtureState.repository as unknown as PilotRepository;
  const pilot = { pilotId: "GEO_XHS_PRODUCTION_PILOT_MAX3_20260918", expiresAt: "2099-09-18T14:59:59.000Z", maxFinalSubmissions: 3 };
  repository.ensureProductionPilotAuthorization(pilot);
  const first = fixtureState.prepare(1);
  const second = fixtureState.prepare(2);
  const third = fixtureState.prepare(3);
  const fourth = fixtureState.prepare(4);
  for (const item of [first, second, third, fourth]) repository.registerProductionPilotPreparedBinding({ pilotId: pilot.pilotId, jobId: item.job.id, snapshotId: item.job.contentBindingId!, publishRecordId: item.preparedRecord.id });
  const claim = (item: ReturnType<typeof fixtureState.prepare>) => repository.claimProductionPilotFinalSubmit({ pilotId: pilot.pilotId, buildSha256: "a".repeat(64), jobId: item.job.id, intentId: item.intent.id, snapshotId: item.job.contentBindingId!, subject: fixtureState.subject() });
  expect(claim(first)).toMatchObject({ slotNumber: 1 });
  expect(repository.recordProductionPilotAccepted({ pilotId: pilot.pilotId, intentId: first.intent.id, externalId: "accepted-1", publishedUrl: "https://www.xiaohongshu.com/explore/accepted-1?token=ignored", receiptSha256: "b".repeat(64) })).toMatchObject({ state: "Accepted" });
  expect(claim(second)).toMatchObject({ slotNumber: 2 });
  expect(repository.recordProductionPilotAccepted({ pilotId: pilot.pilotId, intentId: second.intent.id, externalId: "accepted-2", publishedUrl: "https://www.xiaohongshu.com/explore/accepted-2", receiptSha256: "c".repeat(64) })).toMatchObject({ state: "Accepted" });
  expect(claim(third)).toMatchObject({ slotNumber: 3 });
  expect(repository.recordProductionPilotAccepted({ pilotId: pilot.pilotId, intentId: third.intent.id, externalId: "accepted-3", publishedUrl: "https://www.xiaohongshu.com/explore/accepted-3", receiptSha256: "d".repeat(64) })).toMatchObject({ state: "Accepted" });
  expect(() => claim(fourth)).toThrow("PRODUCTION_PILOT_SLOT_LIMIT_REACHED");
  expect(fixtureState.repository.getSubmissionIntentByJob(fourth.job.id)).toMatchObject({ state: "Prepared", finalSubmitCount: 0 });
  expect(fixtureState.database.db.prepare("SELECT consumed FROM content_confirmations WHERE job_id=?").get(fourth.job.id)).toEqual({ consumed: 0 });
  expect(repository.listProductionPilotSlots(pilot.pilotId)).toHaveLength(3);
});

it("keeps every later article unclaimed after a claimed slot becomes Unknown", () => {
  const fixtureState = fixture();
  const repository = fixtureState.repository as unknown as PilotRepository;
  const pilot = { pilotId: "GEO_XHS_PRODUCTION_PILOT_MAX3_20260918", expiresAt: "2099-09-18T14:59:59.000Z", maxFinalSubmissions: 3 };
  repository.ensureProductionPilotAuthorization(pilot);
  const first = fixtureState.prepare(1);
  const second = fixtureState.prepare(2);
  for (const item of [first, second]) repository.registerProductionPilotPreparedBinding({ pilotId: pilot.pilotId, jobId: item.job.id, snapshotId: item.job.contentBindingId!, publishRecordId: item.preparedRecord.id });
  const claim = (item: ReturnType<typeof fixtureState.prepare>) => repository.claimProductionPilotFinalSubmit({ pilotId: pilot.pilotId, buildSha256: "a".repeat(64), jobId: item.job.id, intentId: item.intent.id, snapshotId: item.job.contentBindingId!, subject: fixtureState.subject() });
  expect(claim(first)).toMatchObject({ slotNumber: 1 });
  expect(repository.markProductionPilotSubmissionUnknown({ pilotId: pilot.pilotId, intentId: first.intent.id, errorCode: "SUBMISSION_UNCERTAIN" })).toMatchObject({ status: "NeedsReconciliation" });
  expect(() => claim(second)).toThrow("PRODUCTION_PILOT_RECONCILIATION_REQUIRED");
  expect(fixtureState.repository.getSubmissionIntentByJob(second.job.id)).toMatchObject({ state: "Prepared", finalSubmitCount: 0 });
  expect(fixtureState.database.db.prepare("SELECT consumed FROM content_confirmations WHERE job_id=?").get(second.job.id)).toEqual({ consumed: 0 });
  expect(repository.listProductionPilotSlots(pilot.pilotId)).toEqual([expect.objectContaining({ intentId: first.intent.id, state: "Unknown" })]);
});

it("rolls back F01 and F02 when durable pilot-slot persistence fails before the mouse boundary", () => {
  const fixtureState = fixture();
  const repository = fixtureState.repository as unknown as PilotRepository;
  const pilot = { pilotId: "GEO_XHS_PRODUCTION_PILOT_MAX3_20260918", expiresAt: "2099-09-18T14:59:59.000Z", maxFinalSubmissions: 3 };
  repository.ensureProductionPilotAuthorization(pilot);
  const item = fixtureState.prepare(1);
  repository.registerProductionPilotPreparedBinding({ pilotId: pilot.pilotId, jobId: item.job.id, snapshotId: item.job.contentBindingId!, publishRecordId: item.preparedRecord.id });
  fixtureState.database.db.exec("CREATE TRIGGER reject_pilot_slot BEFORE INSERT ON production_pilot_slots BEGIN SELECT RAISE(ABORT, 'TEST_SLOT_PERSIST_FAILED'); END;");
  expect(() => repository.claimProductionPilotFinalSubmit({ pilotId: pilot.pilotId, buildSha256: "a".repeat(64), jobId: item.job.id, intentId: item.intent.id, snapshotId: item.job.contentBindingId!, subject: fixtureState.subject() })).toThrow("TEST_SLOT_PERSIST_FAILED");
  expect(fixtureState.repository.getSubmissionIntentByJob(item.job.id)).toMatchObject({ state: "Prepared", finalSubmitCount: 0 });
  expect(fixtureState.database.db.prepare("SELECT consumed FROM content_confirmations WHERE job_id=?").get(item.job.id)).toEqual({ consumed: 0 });
  expect(fixtureState.database.db.prepare("SELECT * FROM submission_dispatch_claims WHERE intent_id=?").get(item.intent.id)).toBeUndefined();
  expect(repository.listProductionPilotSlots(pilot.pilotId)).toHaveLength(0);
});
