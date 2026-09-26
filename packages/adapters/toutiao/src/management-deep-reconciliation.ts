import type { BrowserContext, Page, Response, Route } from "playwright-core";
import { matchToutiaoManagementRows, type ToutiaoManagementMatch, type ToutiaoManagementRow } from "./management-reconciliation";
import { classifyReconciliationRequest, safeReconciliationRequestMetadata } from "./reconciliation-network-policy";

const MANAGEMENT_URL = "https://mp.toutiao.com/profile_v4/manage/content/all";
const DRAFT_URL = "https://mp.toutiao.com/profile_v4/manage/draft";
const NEXT_SELECTOR = '.fake-pagination-list > li.fake-pagination-item-icon:last-child';
const MAX_PAGES_PER_STATUS = 8;

export interface ToutiaoDeepScanTarget {
  readonly title: string;
  readonly submittedAt: string;
  readonly remoteId: string | null;
}
export interface ToutiaoStatusScan {
  readonly status: string;
  readonly pages: number;
  readonly rows: number;
  readonly earliestAt: string | null;
  readonly latestAt: string | null;
  readonly scopeComplete: boolean;
}
export interface ToutiaoDeepScanResult {
  readonly ownedPageCount: number;
  readonly managementPageUrl: string;
  readonly availableStatuses: readonly string[];
  readonly scans: readonly ToutiaoStatusScan[];
  readonly totalRows: number;
  readonly match: ToutiaoManagementMatch;
  readonly normalizedTargetMatch: boolean;
  readonly scopeComplete: boolean;
  readonly apiListObserved: boolean;
  readonly apiTargetObserved: boolean;
  readonly blockedRequestCount: number;
  readonly blockedPostCount: number;
  readonly blockedUnknownGetCount: number;
  readonly blockedGetPaths: readonly string[];
  readonly blockedContentMutationCount: number;
  readonly postCatalog: readonly ReturnType<typeof safeReconciliationRequestMetadata>[];
  readonly readRequestPaths: readonly string[];
  readonly managementLinkPaths: readonly string[];
  readonly paginationControls: readonly string[];
  readonly statusControlShape: readonly { label: string; className: string; parentClassName: string;
    grandparentClassName: string; visible: boolean }[];
}

const normalized = (value: string): string => value.normalize("NFC").replace(/\s+/gu, " ").trim();

export function resolveOwnedToutiaoManagementPage(context: BrowserContext, canonicalPage: Page): Page | null {
  if (canonicalPage.isClosed() || canonicalPage.context() !== context || !context.pages().includes(canonicalPage))
    throw new Error("TOUTIAO_RECONCILIATION_CONTEXT_OWNERSHIP_MISMATCH");
  return context.pages().find((page) => {
    if (page.isClosed() || page.context() !== context) return false;
    try { const url = new URL(page.url()); return url.hostname === "mp.toutiao.com"
      && url.pathname === "/profile_v4/manage/content/all"; }
    catch { return false; }
  }) ?? null;
}

export function parseToutiaoManagementRowTime(text: string, submittedAt: string): number | null {
  const full = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})/u);
  const short = full ? null : text.match(/(?:^|\s)(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})/u);
  const year = full ? Number(full[1]) : new Date(submittedAt).getUTCFullYear();
  const month = Number(full?.[2] ?? short?.[1]);
  const day = Number(full?.[3] ?? short?.[2]);
  const hour = Number(full?.[4] ?? short?.[3]);
  const minute = Number(full?.[5] ?? short?.[4]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
    || !Number.isInteger(hour) || !Number.isInteger(minute)
    || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

export function matchDeepToutiaoRows(rows: readonly ToutiaoManagementRow[], target: ToutiaoDeepScanTarget): {
  readonly match: ToutiaoManagementMatch; readonly normalizedTargetMatch: boolean
} {
  const submittedAt = Date.parse(target.submittedAt);
  const candidates = rows.filter((row) => normalized(row.title) === normalized(target.title)
    && (target.remoteId || (Number.isFinite(submittedAt)
      && Math.abs((parseToutiaoManagementRowTime(row.rowText, target.submittedAt) ?? Infinity) - submittedAt)
        <= 48 * 60 * 60 * 1_000)));
  if (candidates.length !== 1) return { match: { state: candidates.length ? "AMBIGUOUS" : "NOT_FOUND",
    externalId: null, publicUrl: null, matchedRowCount: candidates.length }, normalizedTargetMatch: false };
  const row = candidates[0]!;
  const rowTime = parseToutiaoManagementRowTime(row.rowText, target.submittedAt);
  const match = matchToutiaoManagementRows([row], { title: target.title,
    submittedAt: rowTime === null ? target.submittedAt : new Date(rowTime).toISOString(),
    accountIdentityVerified: true, remoteId: target.remoteId });
  return { match, normalizedTargetMatch: row.title !== target.title };
}

interface PageSnapshot { rows: ToutiaoManagementRow[]; statuses: string[]; nextExists: boolean; nextDisabled: boolean;
  emptyState: boolean;
  managementLinkPaths: string[]; paginationControls: string[];
  statusControlShape: { label: string; className: string; parentClassName: string;
    grandparentClassName: string; visible: boolean }[]; }
async function readPageSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => {
    const rows: ToutiaoManagementRow[] = [];
    const seen = new Set<string>();
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const title = (anchor.innerText ?? "").replace(/\s+/gu, " ").trim();
      if (!title || title.length > 120) continue;
      let element: HTMLElement | null = anchor;
      for (let depth = 0; depth < 7 && element; depth += 1, element = element.parentElement) {
        const rowText = (element.innerText ?? "").replace(/\s+/gu, " ").trim();
        if (rowText.length > 800) break;
        if (/审核|已发布|草稿|定时|预约|拒绝|失败|未通过/u.test(rowText)
          && /(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2})\s+\d{1,2}:\d{2}/u.test(rowText)) {
          const key = `${title}\0${rowText}`;
          if (!seen.has(key)) rows.push({ title, rowText,
            href: anchor.getAttribute("href"),
            dataId: element.getAttribute("data-id") ?? element.getAttribute("data-article-id")
              ?? element.getAttribute("data-item-id") });
          seen.add(key); break;
        }
      }
    }
    const statuses = [...new Set([...document.querySelectorAll<HTMLElement>("a,button,[role=tab],li,span")]
      .map((item) => (item.innerText ?? "").trim().replace(/[（(]\d+[）)]$/u, "").trim()).filter((text) =>
        /^(?:全部|全部作品|审核中|待审核|已发布|未通过|审核未通过|草稿|定时|定时发布|已撤回)$/u.test(text)))];
    const statusControlShape = [...document.querySelectorAll<HTMLElement>("a,button,[role=tab],li,span")]
      .filter((item) => /^(?:全部|全部作品|审核中|待审核|已发布|未通过|审核未通过|草稿|定时|定时发布|已撤回)$/u
        .test((item.innerText ?? "").trim()))
      .slice(0, 30).map((item) => ({ label: item.innerText.trim(),
        className: typeof item.className === "string" ? item.className.slice(0, 80) : "",
        parentClassName: typeof item.parentElement?.className === "string" ? item.parentElement.className.slice(0, 80) : "",
        grandparentClassName: typeof item.parentElement?.parentElement?.className === "string"
          ? item.parentElement.parentElement.className.slice(0, 80) : "",
        visible: Boolean(item.getClientRects().length) }));
    const managementLinkPaths = [...new Set([...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .map((anchor) => { try { const url = new URL(anchor.href); return url.hostname === "mp.toutiao.com"
        && url.pathname.startsWith("/profile_v4/manage/content/") ? url.pathname : null; }
      catch { return null; } }).filter((path): path is string => path !== null))].slice(0, 30);
    const paginationControls = [...new Set([...document.querySelectorAll<HTMLElement>(
      '[class*="pagination"], [class*="Pagination"], [aria-label*="页"], [title*="页"]')]
      .map((item) => `${item.tagName.toLowerCase()}:${String(item.className).slice(0, 80)}`))].slice(0, 30);
    const next = document.querySelector<HTMLElement>(
      '.fake-pagination-list > li.fake-pagination-item-icon:last-child');
    return { rows, statuses, statusControlShape, managementLinkPaths, paginationControls,
      emptyState: /暂无(?:内容|作品|草稿|数据)|还没有(?:内容|作品|草稿)|没有符合条件的内容/u
        .test(document.body.innerText),
      nextExists: Boolean(next), nextDisabled: Boolean(next
      && (next.hasAttribute("disabled") || next.getAttribute("aria-disabled") === "true"
        || /disabled/u.test(next.className))) };
  });
}

/** All navigation is under a Context-wide guard; no captured request or publish transport is reachable here. */
export async function scanOwnedToutiaoManagement(context: BrowserContext, canonicalPage: Page,
  target: ToutiaoDeepScanTarget): Promise<ToutiaoDeepScanResult> {
  const existing = resolveOwnedToutiaoManagementPage(context, canonicalPage);
  if (context.serviceWorkers().length > 0) throw new Error("TOUTIAO_RECONCILIATION_SERVICE_WORKER_UNGUARDED");
  const ownedPageCount = context.pages().length;
  const catalog: ReturnType<typeof safeReconciliationRequestMetadata>[] = [];
  let blockedRequestCount = 0;
  let blockedPostCount = 0;
  let blockedUnknownGetCount = 0;
  let blockedContentMutationCount = 0;
  let apiListObserved = false;
  let apiTargetObserved = false;
  const readRequestPaths = new Set<string>();
  const blockedGetPaths = new Set<string>();
  const guard = async (route: Route): Promise<void> => {
    const request = route.request();
    const metadata = safeReconciliationRequestMetadata(request);
    const decision = classifyReconciliationRequest({ method: request.method(), url: request.url(),
      bodyKeys: metadata.bodyKeys });
    if (decision === "ALLOW_READ") {
      if (request.method().toUpperCase() === "GET" && readRequestPaths.size < 100)
        readRequestPaths.add(`${metadata.host}${metadata.path}`);
      await route.continue(); return;
    }
    blockedRequestCount += 1;
    if (request.method().toUpperCase() === "POST") blockedPostCount += 1;
    if (decision === "BLOCK_UNKNOWN" && request.method().toUpperCase() === "GET") {
      blockedUnknownGetCount += 1;
      if (blockedGetPaths.size < 30) blockedGetPaths.add(`${metadata.host}${metadata.path}`);
    }
    if (decision === "BLOCK_CONTENT_MUTATION") blockedContentMutationCount += 1;
    if (request.method().toUpperCase() === "POST" && catalog.length < 100) catalog.push(metadata);
    await route.abort("blockedbyclient");
  };
  await context.route("**/*", guard);
  let page: Page | null = existing;
  const closePage = !existing;
  try {
    if (!page) page = await context.newPage();
    const responseListener = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (response.request().method() !== "GET" || url.hostname !== "mp.toutiao.com"
          || !["/mp/agw/creator_center/item/list", "/api/feed/mp_provider/v1/"].includes(url.pathname)) return;
        apiListObserved = true;
        void response.json().then((value: unknown) => {
          if (JSON.stringify(value).includes(target.title)) apiTargetObserved = true;
        }).catch(() => undefined);
      } catch { /* malformed response metadata is ignored */ }
    };
    page.on("response", responseListener);
    try {
    await page.goto(MANAGEMENT_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (new URL(page.url()).hostname !== "mp.toutiao.com"
      || !new URL(page.url()).pathname.startsWith("/profile_v4/manage/content/"))
      throw new Error("TOUTIAO_RECONCILIATION_REDIRECTED");
    await page.waitForTimeout(5_000);
    const first = await readPageSnapshot(page);
    const availableStatuses = ["全部", ...first.statuses.filter((label) => label !== "全部" && label !== "全部作品"),
      "草稿箱"];
    const scans: ToutiaoStatusScan[] = [];
    const allRows: ToutiaoManagementRow[] = [];
    let found = false;
    for (const status of availableStatuses) {
      if (status === "草稿箱") {
        await page.goto(DRAFT_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (new URL(page.url()).hostname !== "mp.toutiao.com"
          || new URL(page.url()).pathname !== "/profile_v4/manage/draft")
          throw new Error("TOUTIAO_RECONCILIATION_DRAFT_REDIRECTED");
        await page.waitForTimeout(3_000);
      } else if (status !== "全部") {
        const trigger = page.locator(".status-filter-select .label-select:visible").first();
        if (!await trigger.isVisible()) continue;
        await trigger.hover({ timeout: 5_000 });
        const control = page.locator(".status-filter-select .label-select-option:visible")
          .filter({ hasText: status }).first();
        if (!await control.count() || !await control.isVisible()) continue;
        await control.click({ timeout: 5_000 });
        await page.waitForTimeout(2_000);
      }
      let pages = 0;
      let rows = 0;
      let earliest: number | null = null;
      let latest: number | null = null;
      let scopeComplete = false;
      let previousSignature = "";
      while (pages < MAX_PAGES_PER_STATUS) {
        if (blockedContentMutationCount > 0) throw new Error("TOUTIAO_RECONCILIATION_MUTATION_ATTEMPT_BLOCKED");
        const current = await readPageSnapshot(page);
        const signature = JSON.stringify(current.rows.map((row) => [row.title, row.rowText]));
        if (pages > 0 && signature === previousSignature) break;
        previousSignature = signature;
        pages += 1; rows += current.rows.length; allRows.push(...current.rows);
        for (const row of current.rows) {
          const time = parseToutiaoManagementRowTime(row.rowText, target.submittedAt);
          if (time !== null) { earliest = Math.min(earliest ?? time, time); latest = Math.max(latest ?? time, time); }
        }
        const candidate = matchDeepToutiaoRows(allRows, target);
        if (candidate.match.state !== "NOT_FOUND" && candidate.match.state !== "UNKNOWN") { found = true; break; }
        const submittedAt = Date.parse(target.submittedAt);
        if (earliest !== null && Number.isFinite(submittedAt)
          && earliest < submittedAt - 48 * 60 * 60 * 1_000) { scopeComplete = true; break; }
        if (!current.nextExists || current.nextDisabled) {
          scopeComplete = current.nextExists || current.emptyState || current.rows.length > 0 && current.rows.length < 10;
          break;
        }
        const next = page.locator(NEXT_SELECTOR);
        if (!await next.isVisible() || !await next.isEnabled()) { scopeComplete = true; break; }
        await next.click({ timeout: 5_000 });
        await page.waitForTimeout(1_500);
      }
      scans.push({ status, pages, rows, earliestAt: earliest === null ? null : new Date(earliest).toISOString(),
        latestAt: latest === null ? null : new Date(latest).toISOString(), scopeComplete });
      if (found) break;
    }
    const matched = matchDeepToutiaoRows(allRows, target);
    return { ownedPageCount, managementPageUrl: new URL(page.url()).origin + new URL(page.url()).pathname,
      availableStatuses, scans, totalRows: scans.reduce((sum, scan) => sum + scan.rows, 0),
      ...matched, scopeComplete: first.statuses.length > 1 && scans.length === availableStatuses.length
        && scans.every((scan) => scan.scopeComplete),
      apiListObserved, apiTargetObserved, blockedRequestCount, blockedPostCount,
      blockedUnknownGetCount, blockedGetPaths: [...blockedGetPaths].sort(), blockedContentMutationCount,
      postCatalog: catalog, readRequestPaths: [...readRequestPaths].sort(),
      managementLinkPaths: first.managementLinkPaths, paginationControls: first.paginationControls,
      statusControlShape: first.statusControlShape };
    } finally { page.off("response", responseListener); }
  } finally {
    if (closePage) await page?.close().catch(() => undefined);
    await context.unroute("**/*", guard);
  }
}
