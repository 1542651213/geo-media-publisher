import type { BrowserContext, Page } from "playwright-core";

/** Bounded, structural evidence only. It never contains a full URL, page HTML, or row text. */
export interface DouyinManagementTopology {
  capturedAt: string;
  pagePath: string;
  searchControls: Array<{ tag: string; role: string | null; placeholder: string | null; visible: boolean }>;
  statusControls: Array<{ tag: string; role: string | null; text: string; selected: string | null; classSummary: string }>;
  reviewDropdown: { controlMatchCount: number; opened: boolean; reasonCode: string | null;
    visibleOptions: Array<{ tag: string; role: string | null; text: string; selected: string | null;
      classSummary: string }> };
  visibleAnchorCount: number;
  anchorSamples: Array<{ pathTemplate: string; sameOrigin: boolean; exactTargetIdInPath: boolean;
    titleAttributePresent: boolean; ancestorChain: Array<{ tag: string; role: string | null;
      classSummary: string; dataAttributeNames: string[]; visible: boolean; exactTargetIdInData: boolean }> }>;
  rowCandidateCount: number;
  rowSamples: Array<{ tag: string; role: string | null; classSummary: string; dataAttributeNames: string[];
    visible: boolean; textLength: number; exactTargetIdInData: boolean; knownStateLabels: string[] }>;
  paginationControls: Array<{ tag: string; role: string | null; text: string; disabled: boolean;
    classSummary: string }>;
  scrollContainers: Array<{ tag: string; role: string | null; classSummary: string;
    clientHeight: number; scrollHeight: number; scrollTop: number; overflowY: string; visibleAnchorCount: number }>;
  listStructure: { listCount: number; directChildCount: number | null;
    firstBranch: Array<{ depth: number; tag: string; role: string | null; classSummary: string;
      childElementCount: number; directTextLength: number; totalTextLength: number;
      dataAttributeNames: string[]; exactTargetIdInData: boolean; knownStateLabels: string[] }>;
    statusAncestorChains: Array<Array<{ tag: string; role: string | null; classSummary: string;
      childElementCount: number; totalTextLength: number; dataAttributeNames: string[];
      exactTargetIdInData: boolean }>> };
  targetCardProbes: Array<{ query: "DEFAULT" | "REMOTE_ID" | "EXACT_TITLE"; cardCount: number;
    exactTitleCardCount: number; markerCardCount: number; exactIdAttributeCardCount: number;
    exactIdTextCardCount: number; loadingVisible: boolean; routePreserved: boolean;
    targetCards: Array<{ titleNodeClass: string | null; titleNodeTag: string | null;
      knownStateLabels: string[]; markerPresent: boolean; exactIdInAnyAttribute: boolean;
      imageCount: number; actionLabels: string[]; timeText: string | null;
      controls: Array<{ tag: string; role: string | null; classSummary: string; text: string;
        title: string | null; cursor: string; hasHref: boolean; hasOnclickAttribute: boolean }>;
      descendantClasses: string[] }> }>;
  loadingIndicatorCount: number;
  endOfListSignal: boolean;
  source: "APP_OWNED_MANAGEMENT_PAGE";
}

/** Reads only the already-opened management Page in the exact owned BrowserContext. */
export async function inspectDouyinManagementTopology(page: Page, context: BrowserContext,
  targetRemoteId: string, targetTitle?: string, targetMarker?: string): Promise<DouyinManagementTopology> {
  if (page.isClosed() || page.context() !== context || !context.pages().includes(page))
    throw new Error("DOUYIN_MANAGEMENT_TOPOLOGY_CONTEXT_MISMATCH");
  const url = new URL(page.url());
  if (url.origin !== "https://creator.douyin.com" || url.pathname !== "/creator-micro/content/manage")
    throw new Error("DOUYIN_MANAGEMENT_TOPOLOGY_ROUTE_MISMATCH");
  if (!/^\d{10,30}$/u.test(targetRemoteId)) throw new Error("DOUYIN_MANAGEMENT_TOPOLOGY_TARGET_ID_INVALID");
  if (targetTitle !== undefined && (targetTitle.length < 2 || targetTitle.length > 100))
    throw new Error("DOUYIN_MANAGEMENT_TOPOLOGY_TARGET_TITLE_INVALID");
  if (targetMarker !== undefined && !/^DYCORE[A-Za-z0-9]{4,32}$/u.test(targetMarker))
    throw new Error("DOUYIN_MANAGEMENT_TOPOLOGY_TARGET_MARKER_INVALID");
  await page.locator('input[placeholder="搜索作品"]').first().waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);
  // The search control can hydrate before the work list. Wait only for the observed loading surface;
  // a timeout remains visible in the returned snapshot and never proves an empty list.
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(
    '[aria-busy="true"],[role="progressbar"],[class*="loading"],[class*="spinner"]')]
    .every((element) => {
      const box = element.getBoundingClientRect();
      return box.width === 0 || box.height === 0 || getComputedStyle(element).visibility === "hidden";
    }), null, { timeout: 12_000 }).catch(() => undefined);
  const snapshot = await page.evaluate((targetId) => {
    const safeClass = (element: Element): string => {
      const value = typeof element.className === "string" ? element.className : "";
      return value.replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 120);
    };
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const dataNames = (element: Element): string[] => [...element.attributes]
      .filter((attribute) => attribute.name.startsWith("data-"))
      .map((attribute) => attribute.name.slice(0, 64)).slice(0, 12);
    const exactData = (element: Element): boolean => [...element.attributes]
      .some((attribute) => attribute.name.startsWith("data-") && attribute.value === targetId);
    const node = (element: Element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
      classSummary: safeClass(element), dataAttributeNames: dataNames(element), visible: visible(element),
      exactTargetIdInData: exactData(element) });
    const text = (element: Element): string => (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    const searchControls = [...document.querySelectorAll<HTMLInputElement>('input,[role="searchbox"]')]
      .filter((element) => /搜索|search/iu.test(element.getAttribute("placeholder") ?? "")
        || element.getAttribute("role") === "searchbox")
      .slice(0, 12).map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
        placeholder: element.getAttribute("placeholder")?.slice(0, 60) ?? null, visible: visible(element) }));
    const statusControls = [...document.querySelectorAll<HTMLElement>('button,[role="tab"],[role="option"],[role="button"],select,span,div')]
      .filter((element) => visible(element) && text(element).length <= 32
        && /^(?:全部(?:作品)?|已发布|审核中|未通过|审核状态|作品状态)(?:\s*[（(]\s*\d+\s*[）)])?$/u.test(text(element)))
      .slice(0, 30).map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
        text: text(element).slice(0, 32), selected: element.getAttribute("aria-selected") ?? element.getAttribute("aria-checked"),
        classSummary: safeClass(element) }));
    const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .filter((element) => visible(element) && !element.href.startsWith("javascript:"));
    const anchorSamples = anchors.slice(0, 30).map((anchor) => {
      let pathTemplate = "INVALID";
      let sameOrigin = false;
      let exactTargetIdInPath = false;
      try {
        const parsed = new URL(anchor.href);
        sameOrigin = parsed.origin === location.origin;
        const knownSegments = new Set(["creator-micro", "content", "manage", "video", "note", "item", "work", "detail"]);
        pathTemplate = parsed.pathname.split("/").map((segment) => /^\d{6,30}$/u.test(segment) ? ":id"
          : knownSegments.has(segment) ? segment : segment ? ":segment" : "").join("/").slice(0, 140);
        exactTargetIdInPath = parsed.pathname.split("/").includes(targetId);
      } catch { /* only structure is returned */ }
      const ancestorChain: ReturnType<typeof node>[] = [];
      let current: Element | null = anchor;
      for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement)
        ancestorChain.push(node(current));
      return { pathTemplate, sameOrigin, exactTargetIdInPath,
        titleAttributePresent: Boolean(anchor.getAttribute("title")), ancestorChain };
    });
    const rowCandidates = [...document.querySelectorAll<HTMLElement>(
      'tr,li,[role="row"],[data-id],[data-work-id],[data-aweme-id],[class*="item"],[class*="card"],[class*="row"]')]
      .filter((element) => visible(element) && (element.querySelector("a[href]") !== null
        || dataNames(element).some((name) => /id|item|work|aweme/iu.test(name))));
    const rowSamples = rowCandidates.slice(0, 30).map((element) => ({ ...node(element), textLength: text(element).length,
      knownStateLabels: ["已发布", "审核中", "未通过"].filter((label) => text(element).includes(label)) }));
    const paginationControls = [...document.querySelectorAll<HTMLElement>('button,a,[role="button"],select')]
      .filter((element) => visible(element) && text(element).length <= 32
        && (/(?:下一页|上一页|下页|上页|更多|加载更多|尾页|首页|^\d{1,3}$)/u.test(text(element))
        || /pag(e|ination)|pager/iu.test(safeClass(element))))
      .slice(0, 30).map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
        text: text(element).slice(0, 32), disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
        classSummary: safeClass(element) }));
    const scrollContainers = [...document.querySelectorAll<HTMLElement>("body,main,section,div")]
      .filter((element) => visible(element) && element.clientHeight >= 100
        && element.scrollHeight > element.clientHeight + 40)
      .slice(0, 12).map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
        classSummary: safeClass(element), clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
        overflowY: getComputedStyle(element).overflowY,
        visibleAnchorCount: [...element.querySelectorAll("a[href]")].filter(visible).length }));
    const listElements = [...document.querySelectorAll<HTMLElement>('div[class*="list-scroll-"]')]
      .filter(visible);
    const list = listElements.length === 1 ? listElements[0] : null;
    const listStructure: DouyinManagementTopology["listStructure"] = {
      listCount: listElements.length, directChildCount: list?.children.length ?? null,
      firstBranch: [], statusAncestorChains: []
    };
    if (list) {
      const queue: Array<{ element: Element; depth: number }> = [...list.children].slice(0, 3)
        .map((element) => ({ element, depth: 0 }));
      while (queue.length > 0 && listStructure.firstBranch.length < 60) {
        const current = queue.shift()!;
        if (!visible(current.element)) continue;
        const directTextLength = [...current.element.childNodes]
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .reduce((count, child) => count + (child.textContent?.length ?? 0), 0);
        listStructure.firstBranch.push({ depth: current.depth, ...node(current.element),
          childElementCount: current.element.children.length, directTextLength,
          totalTextLength: text(current.element).length,
          knownStateLabels: ["已发布", "审核中", "未通过"].filter((label) => text(current.element).includes(label)) });
        if (current.depth < 5) queue.push(...[...current.element.children].slice(0, 8)
          .map((element) => ({ element, depth: current.depth + 1 })));
      }
      const stateNodes = [...list.querySelectorAll<HTMLElement>('[class*="info-status-"]')]
        .filter(visible).slice(0, 2);
      for (const stateNode of stateNodes) {
        const chain: DouyinManagementTopology["listStructure"]["statusAncestorChains"][number] = [];
        let cursor: Element | null = stateNode;
        while (cursor && cursor !== list.parentElement && chain.length < 9) {
          chain.push({ ...node(cursor), childElementCount: cursor.children.length,
            totalTextLength: text(cursor).length });
          cursor = cursor.parentElement;
        }
        listStructure.statusAncestorChains.push(chain);
      }
    }
    const loadingIndicatorCount = [...document.querySelectorAll<HTMLElement>(
      '[aria-busy="true"],[role="progressbar"],[class*="loading"],[class*="spinner"]')]
      .filter(visible).length;
    const endOfListSignal = /没有更多|暂无更多|已经到底|已加载全部|没有更多作品/u.test(document.body.innerText);
    return { searchControls, statusControls, visibleAnchorCount: anchors.length, anchorSamples,
      rowCandidateCount: rowCandidates.length, rowSamples, paginationControls, scrollContainers, listStructure,
      loadingIndicatorCount, endOfListSignal };
  }, targetRemoteId);
  const reviewControl = page.getByText("审核状态", { exact: true });
  const controlMatchCount = await reviewControl.count();
  let reviewDropdown: DouyinManagementTopology["reviewDropdown"] = {
    controlMatchCount, opened: false, reasonCode: controlMatchCount === 1 ? null : "REVIEW_CONTROL_NOT_UNIQUE",
    visibleOptions: []
  };
  if (controlMatchCount === 1 && await reviewControl.isVisible()) {
    try {
      await reviewControl.click({ timeout: 3_000 });
      if (page.isClosed() || page.context() !== context || !context.pages().includes(page)
        || new URL(page.url()).origin !== url.origin || new URL(page.url()).pathname !== url.pathname)
        throw new Error("DOUYIN_MANAGEMENT_TOPOLOGY_FILTER_CHANGED_PAGE");
      const visibleOptions = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
        'button,[role="option"],[role="menuitem"],[role="tab"],span,div,li')]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const value = (element.textContent ?? "").replace(/\s+/gu, " ").trim();
          return box.width > 0 && box.height > 0 && /^(全部|已发布|审核中|未通过)(?:\s*[（(]\s*\d+\s*[）)])?$/u.test(value);
        }).slice(0, 30).map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
          text: (element.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 32),
          selected: element.getAttribute("aria-selected") ?? element.getAttribute("aria-checked"),
          classSummary: (typeof element.className === "string" ? element.className : "")
            .replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 120) })));
      reviewDropdown = { controlMatchCount, opened: true, reasonCode: null, visibleOptions };
    } catch {
      reviewDropdown = { controlMatchCount, opened: false, reasonCode: "REVIEW_DROPDOWN_READ_FAILED", visibleOptions: [] };
    } finally { await page.keyboard.press("Escape").catch(() => undefined); }
  } else if (controlMatchCount === 1) {
    reviewDropdown = { controlMatchCount, opened: false, reasonCode: "REVIEW_CONTROL_NOT_VISIBLE", visibleOptions: [] };
  }
  if (page.isClosed() || page.context() !== context || !context.pages().includes(page)
    || new URL(page.url()).origin !== url.origin || new URL(page.url()).pathname !== url.pathname)
    throw new Error("DOUYIN_MANAGEMENT_TOPOLOGY_PAGE_CHANGED");
  const cardProbe = async (query: DouyinManagementTopology["targetCardProbes"][number]["query"]): Promise<DouyinManagementTopology["targetCardProbes"][number]> => {
    const observation = await page.evaluate(({ id, title, marker }) => {
      const cards = [...document.querySelectorAll<HTMLElement>('[class*="content-body-"] > [class*="video-card-"]')];
      const exactAttribute = (card: Element): boolean => [card, ...card.querySelectorAll("*")]
        .some((element) => [...element.attributes].some((attribute) => attribute.value === id));
      const matched = cards.filter((card) => title && (card.innerText ?? "").includes(title)
        && (!marker || (card.innerText ?? "").includes(marker))).slice(0, 4);
      const targetCards = matched.map((card) => {
        const titleNode = [...card.querySelectorAll<HTMLElement>("*")]
          .find((element) => element.children.length === 0 && (element.innerText ?? "").trim() === title);
        const texts = [...card.querySelectorAll<HTMLElement>('button,[role="button"],a')]
          .map((element) => (element.innerText ?? "").replace(/\s+/gu, " ").trim())
          .filter((value) => value.length > 0 && value.length <= 24).slice(0, 12);
        const controlNodes = [...card.querySelectorAll<HTMLElement>(
          '[class*="info-title-text-"],[class*="video-card-cover-"],[class*="op-btns-"],[class*="edit-btn-"],[class*="ghost-btn-"],[class*="op-btn-"],button,a,[role="button"]')]
          .slice(0, 20);
        const controls = controlNodes.map((element) => ({ tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          classSummary: (typeof element.className === "string" ? element.className : "")
            .replace(/[^\p{L}\p{N}_\-\s]/gu, "").slice(0, 100),
          text: (element.innerText ?? "").replace(/\s+/gu, " ").trim().slice(0, 100),
          title: element.getAttribute("title")?.slice(0, 60) ?? null,
          cursor: getComputedStyle(element).cursor, hasHref: element.hasAttribute("href"),
          hasOnclickAttribute: element.hasAttribute("onclick") }));
        const timeText = card.querySelector<HTMLElement>('[class*="info-time-"]')?.innerText
          .replace(/\s+/gu, " ").trim().slice(0, 80) ?? null;
        return { titleNodeClass: titleNode && typeof titleNode.className === "string"
          ? titleNode.className.replace(/[^\p{L}\p{N}_\-\s]/gu, "").slice(0, 100) : null,
        titleNodeTag: titleNode?.tagName.toLowerCase() ?? null,
        knownStateLabels: ["已发布", "审核中", "未通过"].filter((label) =>
          [...card.querySelectorAll<HTMLElement>('[class*="info-status-"]')]
            .some((element) => (element.innerText ?? "").trim() === label)),
        markerPresent: Boolean(marker && (card.innerText ?? "").includes(marker)),
        exactIdInAnyAttribute: exactAttribute(card), imageCount: card.querySelectorAll("img").length,
        actionLabels: texts, timeText, controls,
        descendantClasses: [...card.querySelectorAll<HTMLElement>("*")]
          .filter((element) => typeof element.className === "string" && element.className.length > 0)
          .map((element) => (element.className as string).replace(/[^\p{L}\p{N}_\-\s]/gu, "").slice(0, 100))
          .slice(0, 45) };
      });
      const loadingVisible = [...document.querySelectorAll<HTMLElement>(
        '[aria-busy="true"],[role="progressbar"],[class*="loading"],[class*="spinner"]')]
        .some((element) => { const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; });
      return { cardCount: cards.length, exactTitleCardCount: cards.filter((card) =>
        title && (card.innerText ?? "").includes(title)).length,
      markerCardCount: cards.filter((card) => marker && (card.innerText ?? "").includes(marker)).length,
      exactIdAttributeCardCount: cards.filter(exactAttribute).length,
      exactIdTextCardCount: cards.filter((card) => (card.innerText ?? "").includes(id)).length,
      loadingVisible, targetCards };
    }, { id: targetRemoteId, title: targetTitle ?? "", marker: targetMarker ?? "" });
    return { query, ...observation, routePreserved: !page.isClosed()
      && page.context() === context && new URL(page.url()).origin === url.origin
      && new URL(page.url()).pathname === url.pathname };
  };
  const targetCardProbes: DouyinManagementTopology["targetCardProbes"] = [await cardProbe("DEFAULT")];
  if (targetTitle && targetMarker) {
    const search = page.locator('input[placeholder="搜索作品"]');
    if (await search.count() === 1 && await search.isVisible()) {
      for (const [query, value] of [["REMOTE_ID", targetRemoteId], ["EXACT_TITLE", targetTitle]] as const) {
        await search.fill(value);
        await search.press("Enter");
        await page.waitForTimeout(1_500);
        if (page.isClosed() || page.context() !== context || new URL(page.url()).origin !== url.origin
          || new URL(page.url()).pathname !== url.pathname) throw new Error("DOUYIN_MANAGEMENT_TOPOLOGY_SEARCH_CHANGED_PAGE");
        targetCardProbes.push(await cardProbe(query));
      }
    }
  }
  return { ...snapshot, reviewDropdown, targetCardProbes, capturedAt: new Date().toISOString(), pagePath: url.pathname,
    source: "APP_OWNED_MANAGEMENT_PAGE" };
}
