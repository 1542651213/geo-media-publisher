import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertDouyinAcceptanceChannel, type AcceptanceJobRef } from "../apps/desktop/src/main/douyin-acceptance-gate";
import { openDatabase } from "@publisher/db";

const ARTICLE_ID = "40a8c738-417a-4460-bce3-63297eddf313";
const JOB_ID = "75bf2065-7ed8-46f1-8b58-bb2f5cc01a2d";
const ACCOUNT_ID = "8f245d8b-0a51-46fd-98c4-2a633a95c786";
const CREATOR_ID = "72388977613";
const MARKER = "R11095cf7999";
const TITLE = "装修后为什么要关注甲醛？";
const BODY = `甲醛是装修后常见的室内空气污染物之一，部分板材、胶黏剂、家具和软装材料都可能成为释放来源。刚装修完不要只依靠气味判断空气质量，保持通风，并根据实际使用场景关注室内空气状况。入住前如对空气质量有疑问，可通过规范检测了解实际情况，再决定是否需要进一步处理。本条仅作室内环境科普。测试标识：${MARKER}`;
const BODY_SHA256 = "b5eb24412219e9c40a2d57ad30d4fe8dcf5e70d445948033b3f2fa2700aed6c0";
const IMAGE_SHA256 = "12549e819791a4b06160e9eb38445ceb53da5e71b0dcadc4cc10f3876afe4872";
const SETTINGS = { version: 1 as const, visibility: "public" as const, timing: "immediate" as const,
  musicMode: "AUTO_RECOMMENDED" as const };
const target = { accountId: ACCOUNT_ID, articleId: ARTICLE_ID };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const openFixtures: Array<{ db: { close(): void }; directory: string }> = [];

function makeR110LocalFixture() {
  const directory = mkdtempSync(join(tmpdir(), "douyin-r110-resume-"));
  const opened = openDatabase(join(directory, "fixture.db"), join(process.cwd(), "packages/db/migrations"));
  openFixtures.push({ db: opened.db, directory });
  const { db, repository } = opened;
  repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  repository.setSetting("contentReviewMode", "Off");
  const brand = repository.createBrand({ name: "R1.10 offline fixture", companyName: "R1.10 offline fixture" });
  const createdAccount = repository.createAccount({ platformKey: "douyin", name: "R1.10 fixture account" });
  db.prepare("UPDATE accounts SET id=? WHERE id=?").run(ACCOUNT_ID, createdAccount.id);
  repository.saveDouyinImageTextConnection({ accountId: ACCOUNT_ID, creatorId: CREATOR_ID,
    browserSessionIdHash: "offline-fixture-session" });

  const sourceContentHash = sha256(JSON.stringify({ title: TITLE, body: BODY, imageHash: IMAGE_SHA256,
    visibility: "public", timing: "immediate", musicMode: "AUTO_RECOMMENDED" }));
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO articles (id,brand_id,title,body,ai_provider,ai_model,generated_at,content_hash,
    quality_status,created_at,updated_at,source,source_note,target_platforms_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ARTICLE_ID, brand.id, TITLE, BODY, "system",
    "owner-approved-test-copy", timestamp, sourceContentHash, "unchecked", timestamp, timestamp,
    "production", `owner-authorized:douyin-r1-10:${MARKER}`, '["douyin"]');

  // The fixture file exercises local selection identity only. Its bytes do not represent the Owner's image.
  const imagePath = join(directory, "fixture.png");
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=", "base64");
  writeFileSync(imagePath, imageBytes);
  const image = repository.createImageAsset({ brandId: brand.id, name: "offline fixture image", filePath: imagePath,
    originalFileName: "fixture.png", mimeType: "image/png", size: imageBytes.length });
  const createdJob = repository.createArticlePublishJob({ articleId: ARTICLE_ID, platformKey: "douyin",
    platformAccountId: ACCOUNT_ID, publishMode: "ASSISTED", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
    selectedImageAssetId: image.id, imageSelectionMode: "manual", douyinImageTextSettings: SETTINGS });
  db.prepare("UPDATE publish_jobs SET id=? WHERE id=?").run(JOB_ID, createdJob.id);
  return { db, repository, image };
}

function findAcceptanceJob(repository: ReturnType<typeof makeR110LocalFixture>["repository"], id: string): AcceptanceJobRef | null {
  const job = repository.getJob(id);
  return job ? { id: job.id, accountId: job.accountId, articleId: job.articleId,
    platformKey: job.platformKey, contentKind: job.contentKind ?? null } : null;
}

afterEach(() => {
  for (const { db, directory } of openFixtures.splice(0)) {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("R1.10 existing candidate offline resume eligibility", () => {
  it("retains the exact pre-upload Article and Job for a first preparation", () => {
    const { db, repository, image } = makeR110LocalFixture();
    const article = repository.getArticle(ARTICLE_ID);
    const job = repository.getJob(JOB_ID);
    const payload = repository.getPublishPayload(JOB_ID);
    expect(article).toMatchObject({ id: ARTICLE_ID, title: TITLE, body: BODY,
      sourceNote: `owner-authorized:douyin-r1-10:${MARKER}` });
    expect(sha256(article?.body ?? "")).toBe(BODY_SHA256);
    expect(article?.contentHash).toBe(sha256(JSON.stringify({ title: TITLE, body: BODY, imageHash: IMAGE_SHA256,
      visibility: "public", timing: "immediate", musicMode: "AUTO_RECOMMENDED" })));
    expect(repository.getDouyinImageTextConnection(ACCOUNT_ID)).toMatchObject({ creatorId: CREATOR_ID, active: true });
    expect(job).toMatchObject({ id: JOB_ID, accountId: ACCOUNT_ID, platformAccountId: ACCOUNT_ID,
      articleId: ARTICLE_ID, platformKey: "douyin", contentKind: "article", status: "AwaitingConfirmation",
      attemptCount: 0, selectedImageAssetId: image.id, imageSelectionMode: "manual",
      finalPublishMode: "CONFIRM_BEFORE_PUBLISH" });
    expect(repository.getDouyinImageTextJobSettings(JOB_ID)).toEqual(SETTINGS);
    expect(payload).toEqual({ douyinImageTextSettings: SETTINGS });
    expect(payload.douyinImageSelection).toBeUndefined();
    expect(repository.getSubmissionIntentByJob(JOB_ID)).toBeNull();
    expect(repository.getPublishRecordByJob(JOB_ID)).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS count FROM submission_intents WHERE job_id=?").get(JOB_ID) as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS count FROM publish_records WHERE job_id=?").get(JOB_ID) as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT COALESCE(SUM(final_submit_count),0) AS count FROM submission_intents WHERE job_id=?").get(JOB_ID) as { count: number }).count).toBe(0);

    expect(() => assertDouyinAcceptanceChannel("jobs:prepare-existing-douyin", { id: JOB_ID }, target,
      (id) => findAcceptanceJob(repository, id))).not.toThrow();
    const reused = repository.createArticlePublishJob({ articleId: ARTICLE_ID, platformKey: "douyin",
      platformAccountId: ACCOUNT_ID, publishMode: "ASSISTED", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
      selectedImageAssetId: image.id, imageSelectionMode: "manual", douyinImageTextSettings: SETTINGS });
    expect(reused.id).toBe(JOB_ID);
    expect((db.prepare("SELECT COUNT(*) AS count FROM publish_jobs WHERE article_id=?").get(ARTICLE_ID) as { count: number }).count).toBe(1);
  });

  it("rejects changed persisted account binding at the exact acceptance gate", () => {
    const { db, repository } = makeR110LocalFixture();
    const other = repository.createAccount({ platformKey: "douyin", name: "other fixture account" });
    db.prepare("UPDATE publish_jobs SET account_id=? WHERE id=?").run(other.id, JOB_ID);
    expect(() => assertDouyinAcceptanceChannel("jobs:prepare-existing-douyin", { id: JOB_ID }, target,
      (id) => findAcceptanceJob(repository, id))).toThrow("DOUYIN_ACCEPTANCE_JOB_MISMATCH");
    expect(repository.getSubmissionIntentByJob(JOB_ID)).toBeNull();
    expect(repository.getPublishRecordByJob(JOB_ID)).toBeNull();
  });
});
