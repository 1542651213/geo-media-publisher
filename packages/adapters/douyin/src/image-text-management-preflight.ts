import type { BrowserContext, Page } from "playwright-core";

const origin = "https://creator.douyin.com";
const homePath = "/creator-micro/home";
const managePath = "/creator-micro/content/manage";

export interface DouyinManagementReadOnlyPreflight {
  managementUrl: string;
  returnUrl: string;
  ready: boolean;
  searchControlCount: number;
  stateLabels: string[];
  filterControlTexts: string[];
  managementControlHints: Array<{ tag: string; text: string; role: string | null }>;
  imageEntryCount: number;
}

function assertOwned(page: Page, context: BrowserContext): void {
  if (page.isClosed() || page.context() !== context || !context.pages().includes(page))
    throw new Error("DOUYIN_READONLY_CONTEXT_MISMATCH");
}

/** GET-only navigation on the account's canonical Page. An editor is never displaced. */
export async function inspectDouyinManagementReadOnlyNavigation(page: Page, context: BrowserContext,
  verifyIdentity: () => Promise<boolean>): Promise<DouyinManagementReadOnlyPreflight> {
  assertOwned(page, context);
  const initial = new URL(page.url());
  if (initial.origin !== origin || ![homePath, managePath].includes(initial.pathname))
    throw new Error("DOUYIN_READONLY_EDITOR_PRESERVED");
  if (!await verifyIdentity()) throw new Error("DOUYIN_READONLY_CREATOR_IDENTITY_CHANGED");
  if (initial.pathname !== managePath)
    await page.goto(`${origin}${managePath}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  assertOwned(page, context);
  const management = new URL(page.url());
  if (management.origin !== origin || management.pathname !== managePath || !await verifyIdentity())
    throw new Error("DOUYIN_READONLY_CREATOR_IDENTITY_CHANGED");
  const search = page.locator('input[placeholder="搜索作品"]');
  await search.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  await page.waitForFunction(() => ["已发布", "审核中", "未通过"].every((label) =>
    [...document.querySelectorAll<HTMLElement>('button,[role="tab"],span,div')].some((element) => {
      const value = element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
      return element.getBoundingClientRect().width > 0 && value.startsWith(label)
        && /^(已发布|审核中|未通过)(?:\s*[（(]\s*\d+\s*[）)])?$/u.test(value);
    })),
  null, { timeout: 10_000 }).catch(() => undefined);
  const searchControlCount = await search.count();
  const filterControlTexts = await page.evaluate(() => [...new Set(
    [...document.querySelectorAll<HTMLElement>('button,[role="tab"],span,div')]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => element.textContent?.replace(/\s+/gu, " ").trim() ?? "")
      .filter((value) => /^(已发布|审核中|未通过)(?:\s*[（(]\s*\d+\s*[）)])?$/u.test(value)))]);
  const stateLabels = ["已发布", "审核中", "未通过"].filter((label) =>
    filterControlTexts.some((value) => value.startsWith(label)));
  const managementControlHints = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
    'button,[role="tab"],[class*="filter"],[class*="tab"],select')]
    .filter((element) => element.getBoundingClientRect().width > 0)
    .map((element) => ({ tag: element.tagName.toLowerCase(),
      text: (element.textContent ?? "").replace(/\s+/gu, " ").trim(), role: element.getAttribute("role") }))
    .filter(({ text }) => text.length <= 40 && /已发布|审核|未通过|状态|作品|全部/u.test(text))
    .slice(0, 20));
  const managementUrl = `${management.origin}${management.pathname}`;

  await page.goto(`${origin}${homePath}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  assertOwned(page, context);
  const home = new URL(page.url());
  if (home.origin !== origin || home.pathname !== homePath || !await verifyIdentity())
    throw new Error("DOUYIN_READONLY_CREATOR_IDENTITY_CHANGED");
  const imageEntry = page.getByText("发布图文", { exact: true });
  await imageEntry.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  const imageEntryCount = await imageEntry.count();
  const entryVisible = imageEntryCount === 1 && await imageEntry.isVisible();
  return { managementUrl, returnUrl: `${home.origin}${home.pathname}`,
    ready: searchControlCount === 1 && stateLabels.length === 3 && entryVisible,
    searchControlCount, stateLabels, filterControlTexts, managementControlHints, imageEntryCount };
}
