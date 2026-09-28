import type { BrowserContext, Page } from "playwright-core";

export interface DouyinManagementPublicProbe {
  attempted: boolean;
  reason: string;
  exactTargetCardCount: number;
  cardState: "PUBLISHED" | "REVIEWING" | "REJECTED" | null;
  cardTime: string | null;
  cardTimeMatchesBoundary: boolean;
  actualPublicUrl: string | null;
  actualRemoteId: string | null;
  exactRemoteIdMatch: boolean;
  publicUrlSource: "OPENED_PAGE" | "ACTUAL_VIEW_HREF" | null;
  publicReachable: boolean;
  publicTitleMatch: boolean;
  publicMarkerMatch: boolean;
  publicImageEvidence: boolean;
  observedPageHost: string | null;
  observedPagePath: string | null;
  popupOpened: boolean;
  visibleWorkLinkPaths: Array<{ host: string; path: string; url: string; exactRemoteIdInPath: boolean }>;
  visibleDialogCount: number;
}

const managementUrl = "https://creator.douyin.com/creator-micro/content/manage";
const publicPath = /^\/(?:note|video)\/(\d{10,30})(?:\/|$)/u;

function publishedTime(raw: string | null): number | null {
  const match = raw && /^(\d{4})年(\d{2})月(\d{2})日\s+(\d{2}):(\d{2})$/u.exec(raw);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month! < 1 || month! > 12 || day! < 1 || day! > 31 || hour! > 23 || minute! > 59) return null;
  return Date.UTC(year!, month! - 1, day!, hour! - 8, minute!);
}

/** Clicks only the cover of one exact, same-window management card; this is a read-only view action. */
export async function probeDouyinPublishedCardPublicUrl(page: Page, context: BrowserContext,
  input: { remoteId: string; title: string; marker: string; submitBoundaryEnteredAt: string }): Promise<DouyinManagementPublicProbe> {
  const empty = (reason: string, details?: Partial<DouyinManagementPublicProbe>): DouyinManagementPublicProbe => ({
    attempted: false, reason, exactTargetCardCount: 0, cardState: null, cardTime: null,
    cardTimeMatchesBoundary: false, actualPublicUrl: null, actualRemoteId: null,
    exactRemoteIdMatch: false, publicReachable: false, publicTitleMatch: false,
    publicMarkerMatch: false, publicImageEvidence: false, publicUrlSource: null, observedPageHost: null,
    observedPagePath: null, popupOpened: false, visibleWorkLinkPaths: [], visibleDialogCount: 0,
    ...details });
  if (page.isClosed() || page.context() !== context || !context.pages().includes(page)) return empty("CONTEXT_MISMATCH");
  if (!/^\d{10,30}$/u.test(input.remoteId) || !input.title || !/^DYCORE[A-Za-z0-9]{4,32}$/u.test(input.marker))
    return empty("TARGET_INVALID");
  const submittedAt = Date.parse(input.submitBoundaryEnteredAt);
  if (!Number.isFinite(submittedAt)) return empty("SUBMIT_TIME_INVALID");
  await page.goto(managementUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  if (new URL(page.url()).origin !== "https://creator.douyin.com"
    || new URL(page.url()).pathname !== "/creator-micro/content/manage") return empty("MANAGEMENT_ROUTE_CHANGED");
  await page.locator('input[placeholder="搜索作品"]').waitFor({ state: "visible", timeout: 15_000 });
  // The list's load-more/loading shell appears before cards. It cannot establish a negative result.
  await page.waitForFunction(() => document.querySelector('[class*="content-body-"] > [class*="video-card-"]'),
    null, { timeout: 15_000 }).catch(() => undefined);
  const cards = page.locator('[class*="list-scroll-"] [class*="content-body-"] > [class*="video-card-"]')
    .filter({ hasText: input.title }).filter({ hasText: input.marker });
  const count = await cards.count();
  if (count !== 1) return empty("TARGET_CARD_NOT_UNIQUE", { exactTargetCardCount: count });
  const card = cards.first();
  const stateNodes = await card.locator('[class*="info-status-"]').allInnerTexts();
  const state: DouyinManagementPublicProbe["cardState"] = stateNodes.length === 1 && stateNodes[0]?.trim() === "已发布" ? "PUBLISHED"
    : stateNodes.length === 1 && stateNodes[0]?.trim() === "审核中" ? "REVIEWING"
      : stateNodes.length === 1 && stateNodes[0]?.trim() === "未通过" ? "REJECTED" : null;
  const cardTime = await card.locator('[class*="info-time-"]').count() === 1
    ? (await card.locator('[class*="info-time-"]').innerText()).replace(/\s+/gu, " ").trim() : null;
  const parsedTime = publishedTime(cardTime);
  const cardTimeMatchesBoundary = parsedTime !== null && Math.abs(parsedTime - submittedAt) <= 30 * 60_000;
  const details = { exactTargetCardCount: count, cardState: state, cardTime, cardTimeMatchesBoundary };
  if (state !== "PUBLISHED" || !cardTimeMatchesBoundary)
    return empty("TARGET_CARD_STATE_OR_TIME_UNVERIFIED", details);
  const covers = card.locator('[class*="video-card-cover-"]');
  if (await covers.count() !== 1 || !await covers.isVisible()) return empty("TARGET_COVER_NOT_UNIQUE", details);
  const cursor = await covers.evaluate((element) => getComputedStyle(element).cursor);
  if (cursor !== "pointer") return empty("TARGET_COVER_NOT_VIEW_CONTROL", details);
  const pageBefore = page.url();
  const popupPromise = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  try { await covers.click({ timeout: 3_000 }); }
  catch { return empty("TARGET_COVER_CLICK_UNCERTAIN", { ...details, attempted: true }); }
  const popup = await popupPromise;
  const observed = popup ?? page;
  try {
    if (observed.url() === "about:blank") await observed.waitForURL((url) => url.toString() !== "about:blank", { timeout: 8_000 });
    await observed.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    const parsed = new URL(observed.url());
    if (parsed.hostname === "www.douyin.com" && parsed.pathname === "/user/self") {
      await observed.waitForFunction((targetId) => [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
        .some((anchor) => { try { const url = new URL(anchor.href);
          const box = anchor.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && url.protocol === "https:"
            && (url.hostname === "douyin.com" || url.hostname.endsWith(".douyin.com"))
            && /^\/(?:note|video)\/\d{10,30}(?:\/|$)/u.test(url.pathname)
            && url.pathname.split("/").includes(targetId); } catch { return false; } }),
      input.remoteId, { timeout: 10_000 }).catch(() => undefined);
    }
    const viewTopology = await observed.evaluate((targetId) => ({
      visibleDialogCount: [...document.querySelectorAll<HTMLElement>('[role="dialog"],[class*="modal"],[class*="dialog"]')]
        .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; }).length,
      visibleWorkLinkPaths: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
        .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; })
        .map((element) => { try { const url = new URL(element.href);
          return { host: url.host, path: url.pathname.slice(0, 150),
            url: `${url.origin}${url.pathname}`.slice(0, 200),
            exactRemoteIdInPath: url.pathname.split("/").includes(targetId) }; } catch { return null; } })
        .filter((value): value is { host: string; path: string; url: string; exactRemoteIdInPath: boolean } => value !== null)
        .filter((value) => /\/(?:note|video)\//u.test(value.path)
          && (value.host === "douyin.com" || value.host.endsWith(".douyin.com"))).slice(0, 12)
    }), input.remoteId).catch(() => ({ visibleDialogCount: 0, visibleWorkLinkPaths: [] }));
    const viewDetails = { ...details, attempted: true, observedPageHost: parsed.host,
      observedPagePath: parsed.pathname.slice(0, 150), popupOpened: Boolean(popup), ...viewTopology };
    const openedId = parsed.protocol === "https:" && (parsed.hostname === "douyin.com" || parsed.hostname.endsWith(".douyin.com"))
      ? publicPath.exec(parsed.pathname)?.[1] ?? null : null;
    const exactProfileLinks = viewTopology.visibleWorkLinkPaths.filter((link) => link.exactRemoteIdInPath);
    const actualPublicUrl = openedId ? `${parsed.origin}${parsed.pathname}`
      : exactProfileLinks.length === 1 ? exactProfileLinks[0]!.url : null;
    const actualRemoteId = actualPublicUrl ? publicPath.exec(new URL(actualPublicUrl).pathname)?.[1] ?? null : null;
    const publicUrlSource = openedId ? "OPENED_PAGE" : actualPublicUrl ? "ACTUAL_VIEW_HREF" : null;
    if (!actualPublicUrl) return empty("COVER_DID_NOT_OPEN_PUBLIC_WORK", viewDetails);
    if (publicUrlSource === "ACTUAL_VIEW_HREF") {
      await observed.goto(actualPublicUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (new URL(observed.url()).pathname !== new URL(actualPublicUrl).pathname)
        return empty("PROFILE_LINK_NAVIGATION_CHANGED", { ...viewDetails, actualPublicUrl,
          actualRemoteId, exactRemoteIdMatch: actualRemoteId === input.remoteId, publicUrlSource });
    }
    const evidence = await observed.evaluate(({ title, marker }) => ({
      title: document.body.innerText.includes(title), marker: document.body.innerText.includes(marker),
      images: [...document.images].some((image) => image.complete && image.naturalWidth > 0)
    }), { title: input.title, marker: input.marker }).catch(() => ({ title: false, marker: false, images: false }));
    return { ...empty(actualRemoteId === input.remoteId ? "ACTUAL_PUBLIC_WORK_OPENED" : "PUBLIC_REMOTE_ID_MISMATCH", viewDetails),
      attempted: true, actualPublicUrl, actualRemoteId, exactRemoteIdMatch: actualRemoteId === input.remoteId,
      publicUrlSource,
      publicReachable: true, publicTitleMatch: evidence.title, publicMarkerMatch: evidence.marker,
      publicImageEvidence: evidence.images };
  } catch {
    return empty("PUBLIC_VIEW_READ_FAILED_AFTER_CLICK", { ...details, attempted: true });
  } finally {
    if (popup && !popup.isClosed()) await popup.close().catch(() => undefined);
    if (!popup && !page.isClosed() && page.url() !== pageBefore) {
      // The caller owns this temporary tab and closes it; never navigate the canonical Creator Page.
    }
  }
}
