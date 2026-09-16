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
const jobId = "84aebddc-aa54-43cf-a4f8-2269c706a0d7";
const testRunId = "1595795e-f11c-4544-91ad-8e503124042c";
const outputPath = join(process.cwd(), "output", "v132-toutiao-readonly-reconciliation.json");

type JsonRecord = Record<string, unknown>;
function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function redact(value: string): string { return value.replace(/(cookie|token|secret|authorization|access[_-]?key|refresh[_-]?token)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]").slice(0, 20_000); }
function activePage(adapter: AutomationAdapter): Page | null {
  const internals = adapter as unknown as { activeSessions?: Map<string, { page: Page }> };
  return internals.activeSessions?.get(`toutiao:${accountId}`)?.page ?? null;
}
function publicUrl(value: string): { externalId: string; publishedUrl: string } | null {
  try {
    const url = new URL(value);
    if (!/^(?:www\.)?toutiao\.com$/iu.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:article|w)\/([0-9]+)\/?$/iu);
    if (!match) return null;
    url.hash = "";
    return { externalId: match[1], publishedUrl: url.toString() };
  } catch { return null; }
}
async function collectPage(page: Page, label: string, screenshotPath: string): Promise<JsonRecord> {
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const links: JsonRecord[] = [];
  const anchors = page.locator("a[href]");
  const count = await anchors.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 300); index += 1) {
    const anchor = anchors.nth(index);
    if (!await anchor.isVisible().catch(() => false)) continue;
    const href = (await anchor.getAttribute("href").catch(() => null))?.trim() ?? "";
    if (!href) continue;
    const text = (await anchor.innerText().catch(() => "")).replace(/\s+/gu, " ").trim();
    links.push({ href, text, public: Boolean(publicUrl(href)) });
  }
  return { label, url: page.url(), title: await page.title().catch(() => ""), bodyTextExcerpt: redact(bodyText), links };
}

async function main(): Promise<void> {
  app.setName("codex-media-publisher-readonly-reconcile");
  app.setPath("userData", userDataPath);
  await app.whenReady();
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const evidence: JsonRecord = { startedAt: new Date().toISOString(), mode: "READ_ONLY_RECONCILIATION", platformKey: "toutiao", accountId, jobId, testRunId, clicks: 0, finalSubmitClickCount: 1, dbMutation: "none_unless_unique_verified_public_match" };
  let opened: { db: Database.Database; repository: import("@publisher/db").AppRepository } | null = null;
  let registry: import("@publisher/adapters-core").AdapterRegistry | null = null;
  let adapter: AutomationAdapter | null = null;
  try {
    opened = openDatabase(join(dataDirectory, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    const repository = opened.repository;
    const job = repository.getJob(jobId);
    const run = repository.getPlatformSelfTestRun(testRunId);
    const article = job ? repository.getArticle(job.articleId) : null;
    const account = repository.listAccounts().find((item) => item.id === accountId && item.platformKey === "toutiao");
    if (!job || !run || !article || !account) throw new Error("reconciliation target is missing");
    const content: PublishArticleInput = { articleId: article.id, title: article.title, body: article.body, summary: article.summary, tags: article.tags };
    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
    registry = createRuntimeAdapterRegistry(credentials, false, logger);
    const selected = registry.getForContent("toutiao", "article");
    if (!isAutomationAdapter(selected) || selected.constructor.name !== "ToutiaoArticleBrowserAdapter") throw new Error("unexpected Toutiao article adapter for read-only reconciliation");
    adapter = selected;
    const context: AccountContext = { accountId: account.id, accountName: account.accountAlias || account.name, platformKey: "toutiao", settings: { triggerSource: "CONTINUE_PENDING_ACTION", userActionId: testRunId, browserExecutionMode: "VISIBLE" }, secrets: {} };
    const login = await adapter.checkLogin(context);
    evidence.login = { status: login, passed: login === "logged_in" };
    if (login !== "logged_in") throw new Error(`read-only reconciliation login gate failed: ${login}`);
    const page = activePage(adapter);
    if (!page) throw new Error("no application-owned page was available for read-only reconciliation");
    const pages: JsonRecord[] = [await collectPage(page, "creator_home_after_login", join(process.cwd(), "output", "v132-toutiao-reconcile-home.png"))];
    const homeLinks = pages[0]?.links;
    const candidateUrls = Array.isArray(homeLinks)
      ? homeLinks.map((item) => isRecord(item) && typeof item.href === "string" ? item.href : "").map((href) => { try { return new URL(href, page.url()).toString(); } catch { return ""; } }).filter((href) => /^https:\/\/mp\.toutiao\.com\//iu.test(href) && /(?:manage|content|works|作品|内容)/iu.test(href) && !/graphic\/publish|article\/publish/iu.test(href))
      : [];
    const uniqueCandidateUrls = [...new Set(candidateUrls)];
    evidence.managementCandidates = uniqueCandidateUrls;
    for (let index = 0; index < uniqueCandidateUrls.length; index += 1) {
      const url = uniqueCandidateUrls[index];
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(500).catch(() => undefined);
      pages.push(await collectPage(page, `management_candidate_${index + 1}`, join(process.cwd(), "output", `v132-toutiao-reconcile-management-${index + 1}.png`)));
    }
    evidence.pages = pages;
    const matchingLinks: Array<{ externalId: string; publishedUrl: string; sourcePage: string; linkText: string }> = [];
    for (const pageEvidence of pages) {
      const pageText = typeof pageEvidence.bodyTextExcerpt === "string" ? pageEvidence.bodyTextExcerpt : "";
      if (!pageText.includes(article.title)) continue;
      const links = Array.isArray(pageEvidence.links) ? pageEvidence.links : [];
      for (const link of links) {
        if (!isRecord(link) || typeof link.href !== "string") continue;
        const parsed = publicUrl(link.href);
        if (parsed) matchingLinks.push({ ...parsed, sourcePage: typeof pageEvidence.url === "string" ? pageEvidence.url : "", linkText: typeof link.text === "string" ? link.text : "" });
      }
    }
    const uniqueMatches = [...new Map(matchingLinks.map((item) => [item.publishedUrl, item])).values()];
    evidence.matchingPublicLinks = uniqueMatches;
    if (uniqueMatches.length === 1) {
      const match = uniqueMatches[0];
      const verifyPublished = adapter.verifyPublished;
      if (!verifyPublished) throw new Error("当前 Adapter 未提供只读发布验证能力");
      const verification = await verifyPublished(context, content, match);
      evidence.publicVerification = verification;
      if (verification.status === "published" && verification.externalId && verification.publishedUrl) {
        const reconciled = repository.reconcileJobAsPublished(job.id, { externalId: verification.externalId, publishedUrl: verification.publishedUrl, response: { readOnlyReconciliation: evidence } });
        repository.linkPlatformSelfTestPublishEvidence(run.testRunId, reconciled.record.id);
        repository.recordPlatformSelfTestStep({ testRunId: run.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_SUBMIT", startedAt: new Date().toISOString(), result: "PASSED", message: "只读作品管理回查找到并验证了唯一公开文章", verificationSignal: "readonly_management_unique_match", externalId: verification.externalId, externalUrl: verification.publishedUrl });
        repository.recordPlatformSelfTestStep({ testRunId: run.testRunId, testLevel: "L5_PUBLISH", stepKey: "EXTERNAL_EVIDENCE", startedAt: new Date().toISOString(), result: "PASSED", message: "只读回查取得稳定 External ID 与 URL", verificationSignal: "readonly_public_url_title_body_verified", externalId: verification.externalId, externalUrl: verification.publishedUrl });
        repository.recordPlatformSelfTestStep({ testRunId: run.testRunId, testLevel: "L5_PUBLISH", stepKey: "STATUS_RECONCILIATION", startedAt: new Date().toISOString(), result: "PASSED", message: "只读公开页面回查确认文章存在", verificationSignal: "readonly_public_page_verified", externalId: verification.externalId, externalUrl: verification.publishedUrl });
        repository.finishPlatformSelfTestRun(run.testRunId, "PASSED");
        evidence.result = "TOUTIAO_REAL_PUBLISH_PASS";
        evidence.publishPassed = "PASS";
        evidence.reconciled = reconciled;
      } else {
        evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
        evidence.publishPassed = "NOT_PASS";
      }
    } else {
      evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
      evidence.publishPassed = "NOT_PASS";
      evidence.reconciliationStatus = uniqueMatches.length === 0 ? "NO_UNIQUE_MATCH" : "MULTIPLE_MATCHES";
    }
    evidence.finishedAt = new Date().toISOString();
  } catch (error) {
    evidence.result = "TOUTIAO_REAL_PUBLISH_NEEDS_RECONCILIATION";
    evidence.publishPassed = "NOT_PASS";
    evidence.error = { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) };
    evidence.finishedAt = new Date().toISOString();
  } finally {
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (registry) await Promise.allSettled(registry.listAll().map((item) => (item as typeof item & { closeOwnedSessions?: () => Promise<void> }).closeOwnedSessions?.()).filter((promise): promise is Promise<void> => Boolean(promise)));
    opened?.db.close();
    app.quit();
  }
}

void main().catch((error) => { console.error(`V132_READONLY_FATAL=${error instanceof Error ? error.message : String(error)}`); app.quit(); });
