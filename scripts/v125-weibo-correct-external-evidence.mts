import { app, safeStorage } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const dataDirectory = join(userDataPath, "production-data");
const accountId = "28fc11e7-ba6b-4b35-b13e-fe2ad1b1a1ef";
const platformKey = "weibo";
const testRunId = "cd6d0418-567e-4dd9-976b-4b52630050ef";
const jobId = "d9582333-7b4f-4957-a3a3-ad5abf1c0300";
const candidateUrl = "https://weibo.com/4020073566/Rf17LuR6n";
const candidateExternalId = "Rf17LuR6n";
const outputPath = join(process.cwd(), "output", "v125-weibo-correct-external-evidence.json");

app.setName("codex-media-publisher");
app.setPath("userData", userDataPath);
mkdirSync(join(process.cwd(), "output"), { recursive: true });

type ActiveSession = { page: Page };
type AdapterInternals = { activeSessions: Map<string, ActiveSession> };

async function main(): Promise<void> {
  await app.whenReady();
  const adapterRegistryModulePath = "../apps/desktop/src/main/adapter-registry.ts";
  const [{ openDatabase }, { SafeStorageCredentialStore }, { createFileLogger }, { createRuntimeAdapterRegistry }] = await Promise.all([
    import("@publisher/db"), import("@publisher/security"), import("@publisher/logger"), import(adapterRegistryModulePath)
  ]);
  const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
  const registry = createRuntimeAdapterRegistry(credentials, false, logger);
  const repository = opened.repository;
  const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), platformKey, accountId, testRunId, jobId, candidateUrl, candidateExternalId, readOnly: true, clickCount: 0, finalSubmitCount: 1 };
  try {
    const job = repository.getJob(jobId);
    const record = repository.getPublishRecordByJob(jobId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const intent = repository.getSubmissionIntentByJob(jobId);
    if (!job || job.status !== "Success" || !record || !article || !intent || intent.finalSubmitCount !== 1) throw new Error("微博已成功回收的 Job/Record/Intent 状态不满足只读证据修正");
    const adapter = registry.get(platformKey);
    const account = repository.listAccounts().find((item) => item.id === accountId);
    const context = { accountId, accountName: account?.name ?? "微博测试账号", platformKey, settings: { dryRun: false, manualConfirmationRequired: false, triggerSource: "CONTINUE_PENDING_ACTION", userActionId: testRunId, browserExecutionMode: "VISIBLE" }, secrets: {} };
    const login = await adapter.checkLogin(context);
    if (login !== "logged_in") throw new Error(`微博动态 URL 验证登录未通过：${login}`);
    const page = (adapter as unknown as AdapterInternals).activeSessions.get(`${platformKey}:${accountId}`)?.page;
    if (!page) throw new Error("微博动态 URL 验证未取得应用自建 Visible Browser Page");
    await page.goto(candidateUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const bodyMatch = bodyText.includes(article.body);
    evidence.verification = { verifiedPageUrl: page.url(), bodyMatch, bodyExcerpt: bodyText.slice(0, 2_000) };
    if (!bodyMatch) throw new Error("微博动态 URL 可访问但唯一正文不匹配，保持现有已回收状态不变");
    const updatedRecord = repository.updatePublishRecord(record.id, { status: "Published", success: true, publishedUrl: candidateUrl, publishedExternalId: candidateExternalId, response: { ...record.response, readOnlyExternalEvidenceCorrection: true, verifiedUrl: page.url(), bodyMatch, clickCount: 0, finalSubmitCount: 1 }, verificationStatus: "Verified" });
    opened.db.prepare("UPDATE publish_jobs SET external_id=? WHERE id=?").run(candidateExternalId, jobId);
    opened.db.prepare("UPDATE submission_intents SET external_id=? WHERE job_id=?").run(candidateExternalId, jobId);
    repository.linkPlatformSelfTestPublishEvidence(testRunId, updatedRecord.id);
    evidence.after = { job: repository.getJob(jobId), record: repository.getPublishRecordByJob(jobId), intent: repository.getSubmissionIntentByJob(jobId), run: repository.getPlatformSelfTestRun(testRunId) };
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    console.log(`V125_FINAL=${JSON.stringify({ outputPath, jobStatus: repository.getJob(jobId)?.status, publishRecordId: updatedRecord.id, externalId: candidateExternalId, externalUrl: candidateUrl, finalSubmitCount: 1 })}`);
  } catch (error) {
    evidence.error = { message: error instanceof Error ? error.message : String(error) };
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    console.error(`V125_ERROR=${JSON.stringify({ outputPath, message: evidence.error })}`);
    throw error;
  } finally {
    await Promise.allSettled(registry.list().map((item: unknown) => (item as { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions?.()).filter((promise: Promise<void> | undefined): promise is Promise<void> => Boolean(promise)));
    opened.db.close();
    app.quit();
  }
}

void main().catch(() => {
  if (!app.isReady()) app.quit();
});
