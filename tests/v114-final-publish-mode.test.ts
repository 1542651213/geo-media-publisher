import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import type { FinalPublishMode } from "@publisher/domain";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const temporaryDirectories: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "publisher-v114-final-mode-"));
  temporaryDirectories.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedDevelopment(platformCsv);
  opened.repository.setSetting("contentReviewMode", "Off");
  const brand = opened.repository.createBrand({ name: "最终发布模式测试企业", companyName: "最终发布模式测试企业" });

  const browserAccount = opened.repository.createAccount({ platformKey: "zhihu", name: "知乎模式测试账号" });
  opened.repository.syncBrowserPlatformAccount({ accountId: browserAccount.id, platformKey: "zhihu", browserSessionId: "encrypted-session-reference" });

  const apiAccount = opened.repository.createAccount({ platformKey: "cnblogs", name: "博客园模式测试账号" });
  opened.repository.syncOfficialApiAccount({ accountId: apiAccount.id, platformKey: "cnblogs", externalAccountId: "cnblogs-owner" });

  let sequence = 0;
  const article = (label: string) => {
    sequence += 1;
    const created = opened.repository.createArticle({
      brandId: brand.id,
      topic: `最终发布模式-${label}`,
      keyword: "发布模式",
      city: "苏州",
      title: `最终发布模式测试-${label}-${sequence}`,
      body: `这是一条只用于持久化发布模式测试的文章正文-${label}-${sequence}。`,
      summary: "",
      tags: [],
      seoKeywords: ["发布模式"],
      articleType: "测试",
      aiProvider: "fixture",
      aiModel: "repository-fixture",
      generatedAt: new Date().toISOString(),
      reusePolicy: "once",
      contentHash: `v114-final-mode-${label}-${sequence}-${"a".repeat(32)}`,
      source: "production"
    });
    if (!created) throw new Error("最终发布模式测试文章创建失败");
    opened.repository.saveContentQualityReview({
      contentType: "article",
      contentId: created.id,
      brandId: created.brandId,
      platformKey: null,
      contentHash: created.contentHash,
      trigger: "manual_recheck",
      provider: "test",
      model: "repository-fixture",
      result: { status: "AI_Checked", score: 100, checks: [], issues: [] },
      snapshot: { title: created.title, body: created.body }
    });
    opened.repository.decideContentQuality("article", created.id, "Approved", "human-review", "manual", "最终发布模式测试夹具审批");
    return created;
  };

  return { ...opened, browserAccount, apiAccount, article };
}

afterEach(() => {
  for (const database of databases.splice(0)) if (database.open !== false) database.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("V1.1.4 final publish mode persistence and capability fallback", () => {
  it.each([
    ["PREPARE_ONLY", "MANUAL"],
    ["CONFIRM_BEFORE_PUBLISH", "ASSISTED"]
  ] as const)("persists %s as a user-confirmed job boundary", (finalPublishMode, publishMode) => {
    const fixture = createFixture();
    const job = fixture.repository.createArticlePublishJob({
      articleId: fixture.article(finalPublishMode).id,
      platformKey: "zhihu",
      platformAccountId: fixture.browserAccount.id,
      publishMode,
      finalPublishMode
    });

    expect(job).toMatchObject({
      finalPublishMode,
      status: "AwaitingConfirmation",
      manualConfirmationRequired: true,
      confirmedAt: null,
      dryRun: false
    });
    expect(fixture.repository.listDueJobs()).not.toContainEqual(expect.objectContaining({ id: job.id }));
    expect(fixture.repository.getPublishRecordByJob(job.id)).toBeNull();
  });

  it("defaults to CONFIRM_BEFORE_PUBLISH when the user has not opted into automatic publishing", () => {
    const fixture = createFixture();
    const job = fixture.repository.createArticlePublishJob({
      articleId: fixture.article("default-confirm").id,
      platformKey: "zhihu",
      platformAccountId: fixture.browserAccount.id,
      publishMode: "ASSISTED"
    });

    expect(job).toMatchObject({
      finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
      status: "AwaitingConfirmation",
      manualConfirmationRequired: true
    });
  });

  it("schedules AUTO_PUBLISH directly only for an official API platform", () => {
    const fixture = createFixture();
    expect(fixture.repository.listPlatforms().find((platform) => platform.platformKey === "cnblogs")?.integrationMode).toBe("API");
    const job = fixture.repository.createArticlePublishJob({
      articleId: fixture.article("api-auto").id,
      platformKey: "cnblogs",
      platformAccountId: fixture.apiAccount.id,
      finalPublishMode: "AUTO_PUBLISH"
    });

    expect(job).toMatchObject({
      finalPublishMode: "AUTO_PUBLISH",
      status: "Scheduled",
      manualConfirmationRequired: false,
      confirmedAt: null,
      dryRun: false
    });
    expect(fixture.repository.listDueJobs()).toContainEqual(expect.objectContaining({ id: job.id, platformKey: "cnblogs" }));
  });

  it.each(["UNKNOWN", "PASSED"] as const)("falls Browser AUTO_PUBLISH back to confirmation when background status is %s", (backgroundStatus) => {
    const fixture = createFixture();
    expect(fixture.repository.listPlatforms().find((platform) => platform.platformKey === "zhihu")?.integrationMode).toBe("BrowserAutomation");
    fixture.repository.updatePlatformBackgroundAutomation("zhihu", backgroundStatus, backgroundStatus === "PASSED" ? null : "尚未完成后台自测");
    const job = fixture.repository.createArticlePublishJob({
      articleId: fixture.article(`browser-auto-${backgroundStatus}`).id,
      platformKey: "zhihu",
      platformAccountId: fixture.browserAccount.id,
      finalPublishMode: "AUTO_PUBLISH"
    });

    expect(job).toMatchObject({
      finalPublishMode: "AUTO_PUBLISH",
      status: "AwaitingConfirmation",
      manualConfirmationRequired: true,
      confirmedAt: null
    });
    expect(fixture.repository.listDueJobs()).not.toContainEqual(expect.objectContaining({ id: job.id }));
  });

  it("round-trips every final mode from SQLite without collapsing distinct user choices", () => {
    const fixture = createFixture();
    const modes: FinalPublishMode[] = ["PREPARE_ONLY", "CONFIRM_BEFORE_PUBLISH", "AUTO_PUBLISH"];
    const jobs = modes.map((finalPublishMode) => fixture.repository.createArticlePublishJob({
      articleId: fixture.article(`roundtrip-${finalPublishMode}`).id,
      platformKey: "zhihu",
      platformAccountId: fixture.browserAccount.id,
      finalPublishMode
    }));

    expect(jobs.map((job) => fixture.repository.getJob(job.id)?.finalPublishMode)).toEqual(modes);
  });
});
