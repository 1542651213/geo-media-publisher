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
const outputPath = join(process.cwd(), "output", "v124-weibo-reconcile-readonly.json");

app.setName("codex-media-publisher");
app.setPath("userData", userDataPath);
mkdirSync(join(process.cwd(), "output"), { recursive: true });

type ActiveSession = { page: Page };
type AdapterInternals = { activeSessions: Map<string, ActiveSession> };

function externalIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "weibo.com" && url.hostname !== "www.weibo.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "";
    return last && !["home", "u", "mygroups", "tv", "login"].includes(last.toLowerCase()) ? last : null;
  } catch {
    return null;
  }
}

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
  const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), platformKey, accountId, testRunId, jobId, readOnly: true, clickCount: 0, finalSubmitCount: null };
  try {
    const job = repository.getJob(jobId);
    const record = repository.getPublishRecordByJob(jobId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const intent = repository.getSubmissionIntentByJob(jobId);
    evidence.before = { job, record, article: article ? { id: article.id, title: article.title, body: article.body } : null, intent };
    evidence.finalSubmitCount = intent?.finalSubmitCount ?? null;
    if (!job || job.platformKey !== platformKey || job.status !== "NeedsReconciliation" || !article || !intent || intent.finalSubmitCount !== 1) throw new Error("微博 Job 不满足只读回收前置状态");
    const adapter = registry.get(platformKey);
    const context = { accountId, accountName: repository.listAccounts().find((item) => item.id === accountId)?.name ?? "微博测试账号", platformKey, settings: { dryRun: false, manualConfirmationRequired: false, triggerSource: "CONTINUE_PENDING_ACTION", userActionId: testRunId, browserExecutionMode: "VISIBLE" }, secrets: {} };
    const login = await adapter.checkLogin(context);
    if (login !== "logged_in") throw new Error(`微博只读回收登录检查未通过：${login}`);
    const page = (adapter as unknown as AdapterInternals).activeSessions.get(`${platformKey}:${accountId}`)?.page;
    if (!page) throw new Error("微博只读回收未取得应用自建 Visible Browser Page");
    await page.goto("https://weibo.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const hits = await page.evaluate((expectedBody) => {
      const result: Array<{ href: string; text: string; containerText: string; selectorHint: string }> = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let current: Node | null = walker.nextNode();
      while (current) {
        if ((current.textContent ?? "").includes(expectedBody as string)) {
          let element = current.parentElement;
          for (let depth = 0; element && depth < 10; depth += 1, element = element.parentElement) {
            const anchors = Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]"));
            for (const anchor of anchors) result.push({ href: anchor.href.split("#", 1)[0], text: anchor.innerText.trim(), containerText: (element.innerText || "").replace(/\s+/gu, " ").slice(0, 800), selectorHint: `${anchor.tagName.toLowerCase()}[href]` });
            const closest = element.closest<HTMLAnchorElement>("a[href]");
            if (closest) result.push({ href: closest.href.split("#", 1)[0], text: closest.innerText.trim(), containerText: (element.innerText || "").replace(/\s+/gu, " ").slice(0, 800), selectorHint: "closest-a" });
          }
        }
        current = walker.nextNode();
      }
      return result;
    }, article.body);
    const currentUrl = page.url().split("#", 1)[0];
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const candidates = [...hits, ...(externalIdFromUrl(currentUrl) ? [{ href: currentUrl, text: "", containerText: bodyText, selectorHint: "current-url" }] : [])]
      .filter((item) => /^https:\/\/(www\.)?weibo\.com\//iu.test(item.href) && externalIdFromUrl(item.href) && item.containerText.includes(article.body));
    const candidate = candidates[0] ?? null;
    evidence.page = { url: currentUrl, bodyMatch: bodyText.includes(article.body), hits: hits.slice(0, 40), candidates: candidates.slice(0, 20) };
    if (!candidate) throw new Error("微博只读回收仍未取得包含唯一正文的 External URL；保持 NeedsReconciliation");
    const externalId = externalIdFromUrl(candidate.href);
    if (!externalId) throw new Error("微博只读回收 External ID 解析失败");
    await page.goto(candidate.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const verifiedBody = await page.locator("body").innerText().catch(() => "");
    const bodyMatch = verifiedBody.includes(article.body);
    evidence.verification = { externalId, externalUrl: candidate.href, verifiedPageUrl: page.url(), bodyMatch, verifiedBodyExcerpt: verifiedBody.slice(0, 2_000) };
    if (!bodyMatch) throw new Error("微博 External URL 可访问但正文不匹配；保持 NeedsReconciliation");
    const reconciled = repository.reconcileJobAsPublished(jobId, { externalId, publishedUrl: candidate.href, response: { adapter: platformKey, verificationStatus: "Verified", readOnlyReconciliation: true, bodyMatch, clickCount: 0, finalSubmitCount: 1 } });
    repository.linkPlatformSelfTestPublishEvidence(testRunId, reconciled.record.id);
    evidence.after = { job: reconciled.job, record: reconciled.record, intent: repository.getSubmissionIntentByJob(jobId), run: repository.getPlatformSelfTestRun(testRunId) };
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    console.log(`V124_FINAL=${JSON.stringify({ outputPath, jobStatus: reconciled.job.status, publishRecordId: reconciled.record.id, externalId, externalUrl: candidate.href, finalSubmitCount: 1 })}`);
  } catch (error) {
    evidence.error = { message: error instanceof Error ? error.message : String(error) };
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    console.error(`V124_ERROR=${JSON.stringify({ outputPath, message: evidence.error })}`);
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
