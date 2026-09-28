import type { Page } from "playwright-core";

export interface DouyinIdentityMenuProbe {
  attempted: "NONE" | "HOVER" | "CLICK";
  reason: string;
  headerCandidates: Array<{ tag: string; role: string | null; classSummary: string;
    ariaLabel: string | null; title: string | null; cursor: string }>;
  cornerCandidates: Array<{ tag: string; role: string | null; classSummary: string;
    ariaLabel: string | null; title: string | null; text: string; cursor: string;
    parentClassSummary: string }>;
}

/** Reveals an account menu only when the owned Creator Page has one strong top-right avatar control. */
export async function revealDouyinCreatorIdentityReadOnly(page: Page,
  readVisibleId: () => Promise<string | null>): Promise<{ creatorId: string | null; probe: DouyinIdentityMenuProbe }> {
  const waitVisibleId = async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const visible = await readVisibleId();
      if (visible) return visible;
      await page.waitForTimeout(150);
    }
    return null;
  };
  const headerCandidates = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
    'header button,header [role="button"],header [class*="avatar"],'
    + '[class*="header"] [class*="avatar"],[class*="header"] [aria-label],'
    + '[class*="header"] [title]')]
    .filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top >= 0 && box.top < 180
        && box.left >= innerWidth * 0.55 && getComputedStyle(element).visibility !== "hidden";
    }).slice(0, 24).map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
      classSummary: (typeof element.className === "string" ? element.className : "")
        .replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s+/gu, " ").slice(0, 100),
      ariaLabel: element.getAttribute("aria-label")?.slice(0, 50) ?? null,
      title: element.getAttribute("title")?.slice(0, 50) ?? null,
      cursor: getComputedStyle(element).cursor })));
  const cornerCandidates = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
    'button,[role="button"],img,div,span')]
    .filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top >= 0 && box.top < 280
        && box.left >= innerWidth * 0.5 && getComputedStyle(element).visibility !== "hidden"
        && getComputedStyle(element).cursor === "pointer";
    }).slice(0, 35).map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
      classSummary: (typeof element.className === "string" ? element.className : "")
        .replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s+/gu, " ").slice(0, 100),
      parentClassSummary: (typeof element.parentElement?.className === "string" ? element.parentElement.className : "")
        .replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s+/gu, " ").slice(0, 100),
      ariaLabel: element.getAttribute("aria-label")?.slice(0, 50) ?? null,
      title: element.getAttribute("title")?.slice(0, 50) ?? null,
      text: (element.innerText ?? "").replace(/\s+/gu, " ").trim().slice(0, 60),
      cursor: getComputedStyle(element).cursor })));
  const noAttempt = (reason: string) => ({ creatorId: null,
    probe: { attempted: "NONE" as const, reason, headerCandidates, cornerCandidates } });
  if (page.isClosed() || new URL(page.url()).origin !== "https://creator.douyin.com") return noAttempt("CREATOR_PAGE_CHANGED");
  const selectors = [
    'header [class*="avatar"]',
    '[class*="header"] [class*="avatar"]',
    '[class*="avatar"]',
    '[class*="user-info"]',
    '[aria-label*="账号"],[aria-label*="头像"],[aria-label*="个人"]',
    '[title*="账号"],[title*="头像"]',
    'header [aria-label*="账号"],header [aria-label*="头像"],header [aria-label*="个人"]',
    '[class*="header"] [title*="账号"],[class*="header"] [title*="头像"]'
  ];
  for (const selector of selectors) {
    const candidate = page.locator(selector);
    if (await candidate.count() !== 1 || !await candidate.isVisible()) continue;
    const box = await candidate.boundingBox();
    if (!box || box.y < 0 || box.y >= 180 || box.x < await page.evaluate(() => innerWidth * 0.55)) continue;
    const cursor = await candidate.evaluate((element) => getComputedStyle(element).cursor);
    if (cursor !== "pointer") continue;
    const startUrl = page.url();
    try {
      await candidate.hover({ timeout: 2_000 });
      const afterHover = await waitVisibleId();
      if (afterHover) return { creatorId: afterHover,
        probe: { attempted: "HOVER", reason: "VISIBLE_CREATOR_ID", headerCandidates, cornerCandidates } };
      if (page.isClosed() || page.url() !== startUrl) return noAttempt("CREATOR_PAGE_CHANGED_AFTER_HOVER");
      await candidate.click({ timeout: 2_000 });
      const afterClick = await waitVisibleId();
      return { creatorId: afterClick, probe: { attempted: "CLICK",
        reason: afterClick ? "VISIBLE_CREATOR_ID" : "CREATOR_ID_NOT_VISIBLE_AFTER_MENU",
        headerCandidates, cornerCandidates } };
    } catch {
      return noAttempt("ACCOUNT_MENU_INTERACTION_UNAVAILABLE");
    }
  }
  return noAttempt("UNIQUE_ACCOUNT_MENU_TRIGGER_NOT_FOUND");
}
