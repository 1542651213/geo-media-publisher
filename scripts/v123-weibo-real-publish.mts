import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, Locator } from "playwright-core";
import type { AccountContext, ErrorCode, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import type { AutomationPrepareResult, BrowserPublishAttemptContext } from "@publisher/adapters-core";

const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const dataDirectory = join(userDataPath, "production-data");
const accountId = "28fc11e7-ba6b-4b35-b13e-fe2ad1b1a1ef";
const platformKey = "weibo";
const testRunId = "cd6d0418-567e-4dd9-976b-4b52630050ef";
const outputPath = join(process.cwd(), "output", "v123-weibo-real-publish.json");
const beforeScreenshot = join(process.cwd(), "output", "v123-weibo-before-final-submit.png");
const afterScreenshot = join(process.cwd(), "output", "v123-weibo-after-final-submit.png");

app.setName("codex-media-publisher");
app.setPath("userData", userDataPath);
mkdirSync(join(process.cwd(), "output"), { recursive: true });

type ActiveSession = { page: Page };
type AdapterInternals = { activeSessions: Map<string, ActiveSession> };
type LiveAdapter = {
  preparePublish: (ctx: AccountContext, article: PublishArticleInput) => Promise<AutomationPrepareResult>;
  finalSubmit: (ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext) => Promise<PublishResult>;
  collectPublishResult: (ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext) => Promise<PublishResult>;
  verifyPublished: (ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">) => Promise<PublishStatusResult>;
};

const localTimestamp = (): string => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false });
const visible = async (locator: Locator): Promise<boolean> => locator.isVisible().catch(() => false);
const enabled = async (locator: Locator): Promise<boolean> => locator.isEnabled().catch(() => false);

function platformError(code: ErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function ensureNoSecurityChallenge(page: Page): Promise<void> {
  const frameUrls = page.frames().map((frame) => frame.url());
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (frameUrls.some((url) => /captcha|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(url))
    || /captcha|security check|安全验证|验证码|人机验证|风控/iu.test(bodyText)) {
    throw platformError("USER_ACTION_REQUIRED", `微博页面出现 CAPTCHA/SECURITY_CHECK，已停止自动操作；frameUrls=${frameUrls.join(" | ")}`);
  }
}

async function activePage(adapter: unknown, ctx: AccountContext): Promise<Page> {
  const internals = adapter as AdapterInternals;
  const session = internals.activeSessions.get(`${ctx.platformKey}:${ctx.accountId}`);
  if (!session) throw new Error("微博应用自建 Visible Browser Session 未找到");
  return session.page;
}

async function findComposeBox(page: Page): Promise<Locator | null> {
  const candidates = page.locator('textarea, [contenteditable="true"]');
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!await visible(candidate)) continue;
    const placeholder = `${await candidate.getAttribute("placeholder").catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")}`;
    if (/搜索|评论|comment|search/iu.test(placeholder)) continue;
    return candidate;
  }
  return null;
}

async function findPublishButton(page: Page): Promise<Locator | null> {
  const candidates = page.locator('button, [role="button"]');
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!await visible(candidate) || !await enabled(candidate)) continue;
    const label = (await candidate.innerText().catch(() => "")).replace(/\s+/gu, " ").trim();
    if (/^(发布|发送)$/u.test(label)) return candidate;
  }
  return null;
}

async function imageEvidence(page: Page): Promise<{ count: number; sources: string[] }> {
  return page.evaluate(() => {
    const images = Array.from(document.images).filter((image) => {
      const style = window.getComputedStyle(image);
      const rect = image.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width >= 24 && rect.height >= 24 && image.complete && image.naturalWidth > 0;
    });
    return { count: images.length, sources: images.map((image) => image.currentSrc || image.src).filter(Boolean).slice(-12) };
  });
}

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

async function findPublicEvidence(page: Page, body: string, profileHref: string | null): Promise<{ externalId: string; publishedUrl: string; bodyMatch: boolean }> {
  const readAnchors = async (): Promise<{ href: string; context: string }[]> => page.locator("a[href]").evaluateAll((anchors, expectedBody) => anchors.map((anchor) => ({ href: (anchor as HTMLAnchorElement).href.split("#", 1)[0], context: (anchor.textContent || (anchor.parentElement?.textContent ?? "")).replace(/\s+/gu, " ").trim() })).filter((item) => item.href.includes("weibo.com") && item.context.includes(expectedBody as string)).slice(0, 20), body);
  const currentUrl = page.url().split("#", 1)[0];
  const currentBody = await page.locator("body").innerText().catch(() => "");
  const currentCandidates = await readAnchors();
  let candidate = currentCandidates.find((item) => externalIdFromUrl(item.href));
  if (!candidate && externalIdFromUrl(currentUrl) && currentBody.includes(body)) candidate = { href: currentUrl, context: currentBody };

  if (!candidate && profileHref && /^https:\/\/(www\.)?weibo\.com\//iu.test(profileHref)) {
    await page.goto(profileHref, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    const profileBody = await page.locator("body").innerText().catch(() => "");
    const profileCandidates = await readAnchors();
    candidate = profileCandidates.find((item) => externalIdFromUrl(item.href));
    if (!candidate && profileBody.includes(body)) {
      const profileUrl = page.url().split("#", 1)[0];
      const profileId = externalIdFromUrl(profileUrl);
      if (profileId) candidate = { href: profileUrl, context: profileBody };
    }
  }

  if (!candidate) throw platformError("EXTERNAL_EVIDENCE_INCOMPLETE", "微博已触发最终提交，但当前页/个人主页未取得包含测试正文的 External URL；禁止再次提交");
  const externalId = externalIdFromUrl(candidate.href);
  if (!externalId) throw platformError("EXTERNAL_EVIDENCE_INCOMPLETE", `微博 External URL 无法解析 ID：${candidate.href}`);
  return { externalId, publishedUrl: candidate.href, bodyMatch: candidate.context.includes(body) || currentBody.includes(body) };
}

async function main(): Promise<void> {
  await app.whenReady();
  const adapterRegistryModulePath = "../apps/desktop/src/main/adapter-registry.ts";
  const [{ openDatabase }, { SafeStorageCredentialStore }, { createFileLogger }, { PublisherService }, { createRuntimeAdapterRegistry }] = await Promise.all([
    import("@publisher/db"), import("@publisher/security"), import("@publisher/logger"), import("@publisher/publisher"), import(adapterRegistryModulePath)
  ]);
  const opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
  const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
  const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
  const registry = createRuntimeAdapterRegistry(credentials, false, logger);
  const resolveSecrets = (resolvedAccountId: string, resolvedPlatformKey: string): Record<string, string> => {
    const adapter = registry.get(resolvedPlatformKey);
    const keys = [...new Set([...adapter.getCredentialSchema().map((field: { key: string }) => field.key), "oauthAccessToken"])]
    return Object.fromEntries(keys.map((key) => [key, credentials.get(`account:${resolvedAccountId}:${resolvedPlatformKey}:${key}`) ?? ""]));
  };
  const repository = opened.repository;
  const publisher = new PublisherService(repository, registry, logger, { resolveSecrets });
  const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), platformKey, accountId, testRunId, browserMode: "VISIBLE", finalSubmitMax: 1, uniqueSelfTestBody: null };
  let keepSessionOpen = false;
  try {
    const account = repository.listAccounts().find((item) => item.id === accountId && item.platformKey === platformKey);
    if (!account) throw new Error("微博测试账号不存在");
    const run = repository.getPlatformSelfTestRun(testRunId);
    if (!run || run.platformKey !== platformKey) throw new Error("微博既有 L5 Run 不可复用");
    if (!run.publishConfirmedAt) repository.confirmPlatformSelfTestPublish(testRunId);
    const image = repository.listImageAssets(undefined, true).find((item) => item.universal || [...item.usage, ...item.tags].some((label) => /^(测试|通用)$/u.test(label.trim())));
    if (!image || !existsSync(image.filePath)) throw new Error("没有可用且存在于本地的测试图片");
    const existingJobs = repository.listJobs().filter((item) => item.platformKey === platformKey && item.accountId === account.id && !["Failed", "Cancelled", "ReconciledNotPublished"].includes(item.status));
    if (existingJobs.length > 1) throw new Error(`微博已有多条未完成 Job，拒绝继续：${existingJobs.map((item) => `${item.id}:${item.status}`).join(",")}`);
    let job = run.publishJobId ? repository.getJob(run.publishJobId) : null;
    if (run.publishJobId && (!job || job.platformKey !== platformKey || job.status !== "AwaitingConfirmation")) throw new Error("微博既有 Job 不是可继续的 AwaitingConfirmation 状态");
    if (job && existingJobs.some((item) => item.id !== job?.id)) throw new Error(`微博存在不属于既有自测 Run 的未完成 Job：${existingJobs.map((item) => item.id).join(",")}`);
    const existingArticle = job ? repository.getArticle(job.articleId) : null;
    const body = existingArticle?.body ?? `GMP 新浪微博真实发布测试 ${localTimestamp()}`;
    evidence.uniqueSelfTestBody = body;
    job ??= repository.createPlatformSelfTestPublishJob({ testRunId, title: body, body, dryRun: false, selectedImageAssetId: image.id });
    evidence.createdJobId = job.id;
    evidence.selectedImageAssetId = image.id;
    const adapter = registry.get(platformKey);
    const live = adapter as unknown as LiveAdapter;
    const preparedAt = new Date().toISOString();
    let preparedPage: Page | null = null;
    let collected: PublishResult | null = null;
    live.preparePublish = async (ctx, article): Promise<AutomationPrepareResult> => {
      const page = await activePage(adapter, ctx);
      preparedPage = page;
      await page.goto("https://weibo.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2_000);
      await ensureNoSecurityChallenge(page);
      const compose = await findComposeBox(page);
      if (!compose) throw platformError("USER_ACTION_REQUIRED", `微博普通动态编辑框未在当前可见页面找到：${page.url()}`);
      await compose.fill(article.body);
      const readBack = await compose.inputValue().catch(async () => compose.textContent().catch(() => ""));
      if (!String(readBack).includes(article.body)) throw platformError("CONTENT_REJECTED", "微博正文回读与唯一 SELF_TEST 正文不一致");
      const beforeImages = await imageEvidence(page);
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count() === 0) throw platformError("UPLOAD_FAILED", "微博普通动态未提供图片上传控件");
      await fileInput.setInputFiles(article.images?.[0] ?? image.filePath);
      await page.waitForTimeout(2_000);
      const afterImages = await imageEvidence(page);
      if (afterImages.count <= beforeImages.count) throw platformError("UPLOAD_FAILED", "微博图片上传后未观察到新的可见图片");
      await page.screenshot({ path: beforeScreenshot, fullPage: false });
      return {
        prepared: true,
        requiresUserAction: true,
        message: "微博普通动态正文和一张测试图片已填入并取得可见图片证据，等待一次最终发布",
        sessionIdHash: account.browserSessionId ?? undefined,
        backendUrl: page.url(),
        editorOpenedAt: preparedAt,
        titleFilled: true,
        bodyFilled: true,
        response: { adapter: platformKey, stage: "editor_prepared", pageUrl: page.url(), domEvidence: "playwright:live-weibo-compose", browserExecutionMode: "VISIBLE", headless: false, events: ["EDITOR_OPEN_PASSED", "BODY_FILLED", "IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_PASSED"], imageUploaded: true, imageUploadEvidence: `visible_image_count:${afterImages.count}:sources:${afterImages.sources.join(",")}` }
      };
    };
    live.finalSubmit = async (ctx, article, attempt): Promise<PublishResult> => {
      if (!preparedPage) throw platformError("USER_ACTION_REQUIRED", "微博可见编辑页未保留");
      await ensureNoSecurityChallenge(preparedPage);
      const button = await findPublishButton(preparedPage);
      if (!button) throw platformError("USER_ACTION_REQUIRED", `微博普通动态最终发布控件未找到：${preparedPage.url()}`);
      const profileHref = await preparedPage.locator('a[href*="/u/"]').first().getAttribute("href").catch(() => null);
      attempt.markSubmissionSideEffect?.();
      await button.click({ timeout: 10_000 });
      await preparedPage.waitForTimeout(4_000);
      await preparedPage.screenshot({ path: afterScreenshot, fullPage: false });
      const result = await findPublicEvidence(preparedPage, article.body, profileHref);
      collected = { success: true, status: "published", externalId: result.externalId, publishedUrl: result.publishedUrl, response: { adapter: platformKey, stage: "final_submitted", finalSubmitCount: 1, submissionIntentId: attempt.submissionIntentId, bodyMatch: result.bodyMatch, imageUploaded: true, browserPageUrl: preparedPage.url() } };
      return collected;
    };
    live.collectPublishResult = async (): Promise<PublishResult> => {
      if (!collected) throw platformError("EXTERNAL_EVIDENCE_INCOMPLETE", "微博提交结果未取得；禁止再次提交");
      return collected;
    };
    live.verifyPublished = async (ctx, article, result): Promise<PublishStatusResult> => {
      if (!result.externalId || !result.publishedUrl) return { status: "failed", response: { adapter: platformKey, verificationStatus: "missing_external_evidence" }, errorCode: "EXTERNAL_EVIDENCE_INCOMPLETE", errorMessage: "微博 External ID/URL 缺失" };
      const page = await activePage(adapter, ctx);
      await page.goto(result.publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2_000);
      await ensureNoSecurityChallenge(page);
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const bodyMatch = bodyText.includes(article.body);
      return { status: bodyMatch ? "published" : "failed", externalId: result.externalId, publishedUrl: result.publishedUrl, response: { adapter: platformKey, verificationStatus: bodyMatch ? "Verified" : "body_mismatch", bodyMatch, verifiedUrl: page.url() }, ...(bodyMatch ? {} : { errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "微博验证页未发现唯一测试正文" }) };
    };
    const action = { userActionId: testRunId, triggerSource: "RUN_SELF_TEST" as const };
    const input: PublishArticleInput = { articleId: job.articleId, title: body, body, summary: "", tags: [], images: [image.filePath] };
    const context: AccountContext = { accountId: account.id, accountName: account.name, platformKey, settings: { dryRun: false, manualConfirmationRequired: true, triggerSource: "RUN_SELF_TEST", userActionId: testRunId, browserExecutionMode: "VISIBLE" }, secrets: resolveSecrets(account.id, platformKey) };
    const login = await adapter.checkLogin(context);
    if (login !== "logged_in") throw platformError("USER_ACTION_REQUIRED", `微博登录检查未通过：${login}`);
    const prepared = await live.preparePublish(context, input);
    if (!prepared.response.imageUploaded) throw platformError("UPLOAD_FAILED", "微博测试图片未取得上传完成证据");
    const preparedRecord = repository.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.platformAccountId, platformKey, articleId: job.articleId, publishedUrl: null, publishedExternalId: null, success: false, response: prepared.response, dryRun: false, status: "Prepared", publishMode: "ASSISTED", automationType: (adapter as unknown as { automationType: "BrowserAutomation" }).automationType, browserSessionIdHash: prepared.sessionIdHash ?? account.browserSessionId, operator: process.env.USERNAME?.trim() || process.env.USER?.trim() || "desktop-user", verificationStatus: "WaitingUser", editorOpenedAt: prepared.editorOpenedAt ?? null, titleFilled: prepared.titleFilled ?? false, bodyFilled: prepared.bodyFilled ?? false, selectedImageAssetId: image.id, imageSelectionMode: "manual" });
    evidence.preparedPublishRecordId = preparedRecord.id;
    repository.confirmJob(job.id, false);
    const execution = await publisher.executeJob(job.id, action, "VISIBLE");
    const record = repository.getPublishRecordByJob(job.id);
    const intent = repository.getSubmissionIntentByJob(job.id);
    evidence.execution = { message: execution.message, job: execution.job, record, intent };
    if (record?.success && record.publishedExternalId && record.publishedUrl) repository.linkPlatformSelfTestPublishEvidence(testRunId, record.id);
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    console.log(`V123_FINAL=${JSON.stringify({ outputPath, jobId: job.id, jobStatus: execution.job.status, publishRecordId: record?.id ?? null, externalId: record?.publishedExternalId ?? null, externalUrl: record?.publishedUrl ?? null, finalSubmitCount: intent?.finalSubmitCount ?? null })}`);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string" ? (error as { code: string }).code : "UNKNOWN";
    evidence.error = { code, message: error instanceof Error ? error.message : String(error) };
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    console.error(`V123_ERROR=${JSON.stringify({ outputPath, code, message: evidence.error })}`);
    if (code === "USER_ACTION_REQUIRED" || code === "CAPTCHA" || code === "SECURITY_CHECK") keepSessionOpen = true;
    throw error;
  } finally {
    if (!keepSessionOpen) await Promise.allSettled(registry.list().map((item: unknown) => (item as { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions?.()).filter((promise: Promise<void> | undefined): promise is Promise<void> => Boolean(promise)));
    opened.db.close();
    if (!keepSessionOpen) app.quit();
  }
}

void main().catch(() => {
  if (!app.isReady()) app.quit();
});
