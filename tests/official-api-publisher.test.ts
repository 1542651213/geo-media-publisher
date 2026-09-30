import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, defaultCapabilities, type BrowserPublishAttemptContext, type PlatformAdapter } from "@publisher/adapters-core";
import type { AccountContext, PublishArticleInput, PublishResult } from "@publisher/domain";
import { openDatabase } from "@publisher/db";
import { PublisherService } from "@publisher/publisher";

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function fixture(prepared = true) {
  const dir = mkdtempSync(join(tmpdir(), "website-publisher-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const { db, repository: repo } = openDatabase(join(dir, "fixture.db"), join(process.cwd(), "packages/db/migrations")); cleanup.push(() => db.close());
  repo.seedPlatformCatalog(join(process.cwd(), "PLATFORMS.csv")); repo.setSetting("contentReviewMode", "Off");
  const brand = repo.createBrand({ name: "Fixture", companyName: "Fixture" });
  const created = repo.createAccount({ platformKey: "website", name: "Fixture" });
  const account = repo.syncOfficialApiAccount({ accountId: created.id, platformKey: "website", externalAccountId: "kangyi:staging" });
  const article = repo.createArticle({ brandId: brand.id, title: "原始冻结标题", body: "原始冻结正文。", summary: "摘要", tags: [], seoKeywords: [],
    topic: "测试", keyword: "测试", city: "", articleType: "科普", aiProvider: "system", aiModel: "fixture", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: randomUUID() });
  if (!article) throw new Error("fixture article required");
  const input = { articleId: article.id, title: article.title, body: article.body, summary: article.summary, tags: [] };
  const job = repo.createArticlePublishJob({ articleId: article.id, platformKey: "website", platformAccountId: account.id });
  const published: PublishResult = { success: true, status: "published", externalId: "10000000-0000-4000-a000-000000000001", publishedUrl: "https://staging.kangyihb.com/news/test/", response: { publishResult: "PUBLISHED_CONFIRMED", publicContentVerified: false, fidelityWarning: "PUBLIC_FIDELITY_WARNING" } };
  const finalSubmit = vi.fn(async (_ctx: AccountContext, _input: PublishArticleInput, attempt: BrowserPublishAttemptContext) => { attempt.markSubmissionSideEffect?.(); return published; });
  const adapter = { platformKey: "website", manifest: { platformKey: "website", displayName: "Website", category: "article", version: "fixture", adapterStatus: "ready", authStrategy: "AppCredential", callbackStrategy: "ManualCodeCallback", status: "Ready", researchStatus: "verified", transport: "official_api", integrationMode: "API", supportsArticle: true, supportsVideo: false, officialWebsite: "https://xn--4gq502b.com", credentialSchema: [], officialSources: ["https://staging.kangyihb.com/_publish-api/v2/health"] },
    getCapabilities: () => defaultCapabilities, getCredentialSchema: () => [], checkLogin: async () => "logged_in", beginLogin: async () => ({ sessionId: "fixture", requiresUserAction: false }),
    getPreparedArticleInput: vi.fn(() => input), prepareFinalSubmit: vi.fn(async () => ({ ready: true, response: {} })), finalSubmit,
    collectPublishResult: async () => published, verifyPublished: async () => ({ status: "published", externalId: published.externalId, publishedUrl: published.publishedUrl, response: published.response }),
    publishArticle: vi.fn(async () => { throw new Error("UNPREPARED_PATH_FORBIDDEN"); }) } as unknown as PlatformAdapter;
  const registry = new AdapterRegistry(); registry.register(adapter);
  if (prepared) repo.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: "website", articleId: article.id, publishedUrl: null, publishedExternalId: null, status: "Prepared", success: false, response: {}, automationType: "API" });
  repo.confirmJob(job.id, false);
  return { db, repo, article, job, input, adapter, finalSubmit, publisher: new PublisherService(repo, registry, { info: () => {}, warn: () => {}, error: () => {} }) };
}
describe("Website generic Publisher boundary", () => {
  it("requires a persisted prepared record before reserving any final claim", async () => {
    const f = fixture(false); await f.publisher.executeJob(f.job.id);
    expect(f.finalSubmit).not.toHaveBeenCalled();
    expect(f.repo.getSubmissionIntentByJob(f.job.id)?.finalSubmitCount ?? 0).toBe(0);
    expect(f.adapter.publishArticle).not.toHaveBeenCalled();
  });
  it("passes exact Job identity and frozen input through the existing single final-submit counter", async () => {
    const f = fixture(); f.repo.updateArticle(f.article.id, { title: "之后编辑的标题", body: "之后编辑的正文" });
    const result = await f.publisher.executeJob(f.job.id);
    expect(result.job.status).toBe("Success");
    expect(f.finalSubmit).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ publishJobId: f.job.id }) }), f.input, expect.anything());
    expect(f.repo.getSubmissionIntentByJob(f.job.id)).toMatchObject({ finalSubmitCount: 1, remoteStatus: "PUBLISHED_CONFIRMED" });
    expect(f.repo.getPublishRecordByJob(f.job.id)).toMatchObject({ status: "Published", success: true, response: { fidelityWarning: "PUBLIC_FIDELITY_WARNING" } });
    await f.publisher.executeJob(f.job.id); expect(f.finalSubmit).toHaveBeenCalledTimes(1);
    expect(f.adapter.publishArticle).not.toHaveBeenCalled();
  });
  it("keeps an accepted queued Website job Publishing until polling the original job succeeds", async () => {
    const f = fixture();
    const accepted: PublishResult = { success: true, status: "publishing", externalId: "10000000-0000-4000-a000-000000000001",
      response: { remoteJobId: "20000000-0000-4000-a000-000000000001", stage: "queued" } };
    f.finalSubmit.mockImplementation(async (_ctx, _input, attempt) => { attempt.markSubmissionSideEffect?.(); return accepted; });
    const collect = vi.fn(async () => { throw new Error("FIRST_JOB_GET_UNCERTAIN"); });
    f.adapter.collectPublishResult = collect;
    const verify = vi.fn(); f.adapter.verifyPublished = verify;
    const result = await f.publisher.executeJob(f.job.id);
    expect(result.job.status).toBe("Publishing"); expect(verify).not.toHaveBeenCalled(); expect(collect).not.toHaveBeenCalled();
    expect(f.repo.getPublishRecordByJob(f.job.id)).toMatchObject({ status: "Publishing", success: false });
    expect(f.repo.getSubmissionIntentByJob(f.job.id)).toMatchObject({ state: "Submitted", externalId: accepted.externalId, finalSubmitCount: 1 });
    f.adapter.getPublishStatus = vi.fn(async () => { throw new Error("FIRST_JOB_GET_UNCERTAIN"); });
    const uncertain = await f.publisher.pollPublishingJob(f.job.id, false);
    expect(["Publishing", "NeedsReconciliation"]).toContain(uncertain.job.status);
    expect(f.repo.getSubmissionIntentByJob(f.job.id)?.externalId).toBe(accepted.externalId);
    f.adapter.getPublishStatus = vi.fn(async () => ({ status: "published" as const, externalId: "10000000-0000-4000-a000-000000000001",
      publishedUrl: "https://staging.kangyihb.com/news/test/", response: { remoteJobId: "20000000-0000-4000-a000-000000000001" } }));
    const reconciled = await f.publisher.pollPublishingJob(f.job.id, false);
    expect(reconciled.job.status).toBe("Success");
    expect(f.adapter.getPublishStatus).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ publishJobId: f.job.id }) }), "10000000-0000-4000-a000-000000000001");
    expect(f.repo.getSubmissionIntentByJob(f.job.id)?.finalSubmitCount).toBe(1); expect(f.finalSubmit).toHaveBeenCalledTimes(1);
  });
});
