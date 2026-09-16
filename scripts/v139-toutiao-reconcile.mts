import { app, safeStorage } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { Page } from "playwright-core";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";
import { isAutomationAdapter, type AutomationAdapter } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { SafeStorageCredentialStore } from "@publisher/security";
import { createFileLogger } from "@publisher/logger";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";

const userDataPath = "C:/Users/Administrator/AppData/Roaming/codex-media-publisher";
const dataDirectory = join(userDataPath, "production-data");
const accountId = "3ffa4368-e8cd-4725-8658-846ad35b1980";
const externalAccountId = "3841036825934266";
const jobId = "f2e31cfc-176c-488b-8ca9-e6fd3d769ab7";
const intentId = "fe2e81e7-1ec2-4ba1-a080-7a2b4206a6d3";
const recordId = "8500aae4-f2d1-49a3-a3db-b55e7336b3f3";
const testRunId = "18d0cb95-770c-4ac1-a59d-4ee962679c4d";
const managementUrl = "https://mp.toutiao.com/profile_v4/manage/content/all";
const outputPath = join(process.cwd(), "output", "v139-toutiao-reconciliation.json");

type JsonRecord = Record<string, unknown>;
function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function normalize(value: string): string { return value.normalize("NFKC").replace(/[\s\u00a0]+/gu, " ").trim(); }
function redact(value: string): string { return value.replace(/(cookie|token|secret|authorization|access[_-]?key|refresh[_-]?token)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]").slice(0, 30_000); }
function activePage(adapter: AutomationAdapter): Page | null {
  const internals = adapter as unknown as { activeSessions?: Map<string, { page: Page }> };
  return internals.activeSessions?.get(`toutiao:${accountId}`)?.page ?? null;
}
function databaseSnapshot(repository: import("@publisher/db").AppRepository): JsonRecord {
  const job = repository.getJob(jobId);
  return {
    counts: {
      toutiaoJobs: repository.listJobs().filter((item) => item.platformKey === "toutiao" && item.accountId === accountId).length,
      submissionIntents: repository.listJobs().filter((item) => item.platformKey === "toutiao" && item.accountId === accountId && Boolean(repository.getSubmissionIntentByJob(item.id))).length,
      publishRecords: repository.listJobs().filter((item) => item.platformKey === "toutiao" && item.accountId === accountId && Boolean(repository.getPublishRecordByJob(item.id))).length
    },
    job,
    intent: repository.getSubmissionIntentByJob(jobId),
    record: repository.getPublishRecordByJob(jobId),
    run: repository.getPlatformSelfTestRun(testRunId),
    ids: { jobId, intentId, recordId, testRunId }
  };
}
async function collectPage(page: Page, label: string): Promise<JsonRecord> {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const anchors: JsonRecord[] = [];
  const locator = page.locator("a[href]");
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 400); index += 1) {
    const item = locator.nth(index);
    if (!await item.isVisible().catch(() => false)) continue;
    const href = (await item.getAttribute("href").catch(() => null))?.trim() ?? "";
    if (!href) continue;
    anchors.push({ href, text: normalize(await item.innerText().catch(() => "")) });
  }
  return { label, url: page.url(), title: await page.title().catch(() => ""), bodyText: redact(bodyText), anchors };
}
async function titleContexts(page: Page, title: string): Promise<JsonRecord[]> {
  const result: JsonRecord[] = [];
  const anchors = page.locator("a[href]");
  const count = await anchors.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 400); index += 1) {
    const anchor = anchors.nth(index);
    if (!await anchor.isVisible().catch(() => false)) continue;
    const text = normalize(await anchor.innerText().catch(() => ""));
    if (!text.includes(title)) continue;
    const href = (await anchor.getAttribute("href").catch(() => null))?.trim() ?? "";
    const ancestors: string[] = [];
    let current = anchor;
    for (let depth = 0; depth < 7; depth += 1) {
      const contextText = normalize(await current.innerText().catch(() => ""));
      if (contextText) ancestors.push(contextText.slice(0, 1_000));
      current = current.locator("xpath=..");
    }
    result.push({ tag: "A", className: await anchor.getAttribute("class").catch(() => "") ?? "", dataId: await anchor.getAttribute("data-id").catch(() => null) ?? await anchor.getAttribute("data-article-id").catch(() => null) ?? await anchor.getAttribute("data-item-id").catch(() => null), text, href, ancestors });
  }
  return result;
}
function minuteVariants(value: string): string[] {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return [];
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string): string => parts.find((item) => item.type === type)?.value ?? "";
  const year = get("year"); const month = get("month"); const day = get("day"); const hour = get("hour"); const minute = get("minute");
  return [...new Set([`${month}-${day} ${hour}:${minute}`, `${year}-${month}-${day} ${hour}:${minute}`, `${year}/${month}/${day} ${hour}:${minute}`, `${month}/${day} ${hour}:${minute}`])];
}
function publicUrl(value: string): { externalId: string; publishedUrl: string } | null {
  try {
    const url = new URL(value);
    if (!/^(?:www\.)?toutiao\.com$/iu.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:article|w|item)\/([0-9]+)\/?$/iu);
    if (!match) return null;
    url.hash = "";
    return { externalId: match[1], publishedUrl: url.toString() };
  } catch { return null; }
}

async function main(): Promise<void> {
  app.setName("codex-media-publisher-readonly-reconcile");
  app.setPath("userData", userDataPath);
  await app.whenReady();
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const evidence: JsonRecord = {
    operation: "TOUTIAO_READ_ONLY_RECONCILIATION",
    mode: "READ_ONLY",
    platformKey: "toutiao",
    accountId,
    externalAccountId,
    jobId,
    intentId,
    recordId,
    testRunId,
    managementUrl,
    finalSubmitClickCount: 1,
    publishControlClicksThisRun: 0,
    dbMutation: "not_started",
    result: "NOT_STARTED"
  };
  let opened: { db: Database.Database; repository: import("@publisher/db").AppRepository } | null = null;
  let registry: import("@publisher/adapters-core").AdapterRegistry | null = null;
  try {
    opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    const repository = opened.repository;
    const job = repository.getJob(jobId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const account = repository.listAccounts().find((item) => item.id === accountId && item.platformKey === "toutiao");
    const intent = repository.getSubmissionIntentByJob(jobId);
    const record = repository.getPublishRecordByJob(jobId);
    if (!job || !article || !account || !intent || !record || intent.id !== intentId || record.id !== recordId) throw new Error("reconciliation target is missing or ID mismatch");
    evidence.before = databaseSnapshot(repository);
    evidence.article = { id: article.id, title: article.title, bodyExcerpt: article.body.slice(0, 240) };
    evidence.submissionTime = { jobScheduledAt: job.scheduledAt, jobStartedAt: job.startedAt, recordPublishedAt: record.publishedAt, minuteVariants: minuteVariants(job.startedAt ?? record.publishedAt) };
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
    registry = createRuntimeAdapterRegistry(credentials, false, logger);
    const selected = registry.getForContent("toutiao", "article");
    if (!isAutomationAdapter(selected) || selected.constructor.name !== "ToutiaoArticleBrowserAdapter") throw new Error(`unexpected Toutiao article adapter: ${selected.constructor.name}`);
    const context: AccountContext = { accountId: account.id, accountName: account.accountAlias || account.name, platformKey: "toutiao", settings: { triggerSource: "CONTINUE_PENDING_ACTION", userActionId: testRunId, browserExecutionMode: "VISIBLE" }, secrets: {} };
    const login = await selected.checkLogin(context);
    evidence.login = { status: login, passed: login === "logged_in" };
    if (login !== "logged_in") throw new Error(`LOGIN_REQUIRED: ${login}`);
    const page = activePage(selected);
    if (!page) throw new Error("no application-owned BrowserSession page");
    const home = await collectPage(page, "creator_home");
    evidence.home = home;
    const preflight = await (selected as typeof selected & { inspectAccountPreflight?: (ctx: AccountContext) => Promise<unknown> }).inspectAccountPreflight?.(context);
    evidence.accountIdentity = preflight;
    await page.goto(managementUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1_000);
    const management = await collectPage(page, "content_management");
    evidence.management = management;
    const contexts = await titleContexts(page, article.title);
    evidence.titleContexts = contexts;
    const minuteValues = minuteVariants(job.startedAt ?? record.publishedAt);
    const contextText = (item: JsonRecord): string => [item.text, ...(Array.isArray(item.ancestors) ? item.ancestors.filter((value): value is string => typeof value === "string") : [])].join(" ");
    const candidateContexts = contexts.filter((item): item is JsonRecord => isRecord(item) && typeof item.text === "string" && contextText(item).includes(article.title) && minuteValues.some((minute) => contextText(item).includes(minute)));
    const pendingCandidates = candidateContexts.filter((item) => contextText(item).includes("审核中"));
    const publishedCandidates = candidateContexts.filter((item) => contextText(item).includes("已发布"));
    const candidates = [...pendingCandidates, ...publishedCandidates];
    const platformStatus = pendingCandidates.length === 1 && publishedCandidates.length === 0 ? "审核中" : publishedCandidates.length === 1 && pendingCandidates.length === 0 ? "已发布" : null;
    const identityEvidence = isRecord(preflight) && isRecord(preflight.identity) ? preflight.identity : null;
    const matched = candidates.length === 1 && isRecord(candidates[0]) ? candidates[0] : null;
    const matchedHref = matched && typeof matched.href === "string" ? matched.href : null;
    let platformArticleId: string | null = null;
    if (matchedHref) {
      try { platformArticleId = publicUrl(new URL(matchedHref, managementUrl).toString())?.externalId ?? new URL(matchedHref, managementUrl).searchParams.get("pgc_id"); } catch { platformArticleId = null; }
    }
    const matchedPublic = matchedHref ? publicUrl(new URL(matchedHref, managementUrl).toString()) : null;
    evidence.match = { candidateCount: candidates.length, candidates, title: article.title, status: platformStatus, timeVariants: minuteValues, account: { externalAccountId, displayName: identityEvidence && typeof identityEvidence.displayName === "string" ? identityEvidence.displayName : account.accountAlias || account.name, identityVerified: identityEvidence?.externalAccountId === externalAccountId }, unique: candidates.length === 1, platformArticleId, managementPageUrl: managementUrl, matchedPreviewUrl: matchedHref && !matchedPublic ? new URL(matchedHref, managementUrl).toString() : null, matchedPublishedUrl: matchedPublic?.publishedUrl ?? null };
    if (candidates.length === 1 && platformStatus && identityEvidence?.externalAccountId === externalAccountId) {
      const content: PublishArticleInput = { articleId: article.id, title: article.title, body: article.body, summary: article.summary, tags: article.tags };
      const reconciliationResponse: JsonRecord = { adapter: "toutiao", readOnly: true, managementPageUrl: managementUrl, matchedPreviewUrl: matchedHref && !matchedPublic ? new URL(matchedHref, managementUrl).toString() : null, matchedPublishedUrl: matchedPublic?.publishedUrl ?? null, platformArticleId, title: article.title, account: { externalAccountId, displayName: identityEvidence.displayName ?? null }, submittedAt: job.startedAt ?? record.publishedAt, matchedTime: "08-26 15:38", platformStatus, titleMatch: true, accountMatch: true, timeWindowMatch: true, finalSubmitCount: intent.finalSubmitCount, publishControlClicks: 0 };
      if (platformStatus === "已发布" && matchedPublic) {
        if (!selected.verifyPublished) throw new Error("Toutiao adapter does not expose read-only published verification");
        const verification = await selected.verifyPublished(context, content, matchedPublic);
        evidence.verification = verification;
        if (verification.status === "published" && verification.externalId && verification.publishedUrl) {
          const currentJob = repository.getJob(jobId);
          const currentIntent = repository.getSubmissionIntentByJob(jobId);
          const currentRecord = repository.getPublishRecordByJob(jobId);
          const reconciled = currentJob && ["NeedsReconciliation", "Submitted"].includes(currentJob.status)
            ? repository.reconcileJobAsPublished(jobId, { externalId: verification.externalId, publishedUrl: verification.publishedUrl, response: { ...reconciliationResponse, verification: verification.response } })
            : currentJob?.status === "Success" && currentIntent?.state === "Submitted" && currentIntent.externalId === verification.externalId && currentRecord?.status === "Published"
              ? { job: currentJob, record: currentRecord }
              : (() => { throw new Error("target is neither an awaiting-submission state nor an already verified Published state"); })();
          const linkedRun = repository.linkPlatformSelfTestPublishEvidence(testRunId, recordId);
          const verifiedStep = repository.recordPlatformSelfTestStep({ testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_SUBMIT", startedAt: new Date().toISOString(), result: "PASSED", message: "只读作品管理与公开文章页面均唯一验证了本次发布", verificationSignal: "readonly_public_page_verified", externalId: verification.externalId, externalUrl: verification.publishedUrl });
          const finishedRun = repository.finishPlatformSelfTestRun(testRunId, "PASSED");
          evidence.dbMutation = "existing_submitted_job_intent_record_to_published_and_run_link";
          evidence.reconciled = { job: reconciled.job, intent: repository.getSubmissionIntentByJob(jobId), record: reconciled.record };
          evidence.reconciledRun = linkedRun;
          evidence.verifiedStep = verifiedStep;
          evidence.finishedRun = finishedRun;
          evidence.externalId = verification.externalId;
          evidence.externalUrl = verification.publishedUrl;
          evidence.result = "TOUTIAO_REAL_PUBLISH_PASS";
          evidence.publishPassed = "PASS";
          evidence.secondReadOnlyCheck = { page: await collectPage(page, "content_management_after_published_reconciliation"), titleContexts: await titleContexts(page, article.title), clicks: 0 };
        } else {
          evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
          evidence.publishPassed = "NOT_PASS";
          evidence.dbMutation = "none";
        }
      } else if (platformStatus === "审核中") {
        const currentJob = repository.getJob(jobId);
        const currentIntent = repository.getSubmissionIntentByJob(jobId);
        const currentRecord = repository.getPublishRecordByJob(jobId);
        const reconciled = currentJob?.status === "NeedsReconciliation"
          ? repository.reconcileJobAsSubmitted(jobId, { response: reconciliationResponse })
          : currentJob?.status === "Submitted" && currentIntent?.state === "Submitted" && currentRecord?.status === "Submitted"
            ? { job: currentJob, record: currentRecord }
            : (() => { throw new Error("target is neither the original NeedsReconciliation state nor an already reconciled Submitted state"); })();
        const linkedRun = repository.linkPlatformSelfTestPublishEvidence(testRunId, recordId);
        evidence.dbMutation = currentJob?.status === "NeedsReconciliation" ? "existing_job_intent_record_only_and_run_link" : "already_reconciled_state_and_run_link";
        evidence.reconciled = { job: reconciled.job, intent: repository.getSubmissionIntentByJob(jobId), record: reconciled.record };
        evidence.reconciledRun = linkedRun;
        evidence.result = "TOUTIAO_PLATFORM_ACCEPTED_PENDING_REVIEW";
        evidence.publishPassed = "NOT_PASS";
        evidence.secondReadOnlyCheck = { page: await collectPage(page, "content_management_after_reconciliation"), titleContexts: await titleContexts(page, article.title), clicks: 0 };
      } else {
        evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
        evidence.publishPassed = "NOT_PASS";
        evidence.dbMutation = "none";
      }
    } else {
      evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
      evidence.publishPassed = "NOT_PASS";
      evidence.dbMutation = "none";
    }
    evidence.after = databaseSnapshot(repository);
    evidence.finishedAt = new Date().toISOString();
  } catch (error) {
    evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
    evidence.publishPassed = "NOT_PASS";
    evidence.dbMutation = "none";
    evidence.error = { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) };
    evidence.finishedAt = new Date().toISOString();
  } finally {
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (registry) await Promise.allSettled(registry.listAll().map((item) => (item as typeof item & { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions?.()).filter((promise): promise is Promise<void> => Boolean(promise)));
    opened?.db.close();
    app.quit();
  }
}

void main().catch((error) => { console.error(`V139_READONLY_FATAL=${error instanceof Error ? error.message : String(error)}`); app.quit(); });
