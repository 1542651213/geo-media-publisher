import { describe, expect, it, vi } from "vitest";
import type { BrowserSessionManager } from "@publisher/adapters-core";
import type { BrowserSession } from "@publisher/adapters-core";
import { classifySohuArticleStatus, classifySohuControlCandidate, classifySohuDiscovery, diffSohuDomSnapshots, matchSohuArticleCandidates, mergeSohuReconciliationSnapshots, parseSohuListStatusCounts, shouldAllowSohuDirectSubmitPreflight, SohuBrowserAdapter, type SohuDeepDomCandidate, type SohuDeepDomSnapshot, type SohuReconciliationCandidate, type SohuReconciliationSnapshot } from "./browser";

const sessionManager = {
  hasStoredSession: vi.fn(() => true),
  open: vi.fn(),
  close: vi.fn(async (_session: BrowserSession) => undefined),
  closeAll: vi.fn(async () => undefined)
} as unknown as BrowserSessionManager;

type ReconciliationFixture = {
  pageEvidence: Record<string, unknown>;
  candidates: Array<{ href?: string | null; context: string; label?: string; externalId?: string | null; title?: string; status?: SohuReconciliationCandidate["status"]; statusText?: string }>;
  initialUrl?: string;
  publicHeading?: string;
  publicPageTitle?: string;
  publicBody?: string;
};

function fakeReconciliationPage(fixture: ReconciliationFixture) {
  let currentUrl = fixture.initialUrl ?? "https://mp.sohu.com/mpfe/v4/";
  let evaluateCount = 0;
  const contentEntry = {
    text: "文章",
    href: "/mpfe/v4/contentManagement/first/page?newsType=1",
    click: async () => { currentUrl = `https://mp.sohu.com${contentEntry.href}`; }
  };
  const emptyLocator = () => ({
    count: async () => 0,
    nth: () => emptyLocator(),
    first: () => emptyLocator(),
    filter: () => emptyLocator(),
    isVisible: async () => false,
    isEnabled: async () => false,
    getAttribute: async () => null,
    innerText: async () => ""
  });
  const publicLocator = (text: string) => ({
    ...emptyLocator(),
    count: async () => 1,
    first: () => publicLocator(text),
    innerText: async () => text
  });
  const entryLocator = {
    count: async () => 1,
    nth: () => ({
      isVisible: async () => true,
      isEnabled: async () => true,
      getAttribute: async (name: string) => name === "href" ? contentEntry.href : null,
      innerText: async () => contentEntry.text,
      click: contentEntry.click
    }),
    filter: () => emptyLocator()
  };
  return {
    goto: async (url: string) => { currentUrl = url; },
    url: () => currentUrl,
    title: async () => fixture.publicPageTitle ?? "",
    waitForFunction: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: (selector: string) => currentUrl.startsWith("https://www.sohu.com/") && selector === "h1" ? publicLocator(fixture.publicHeading ?? "") : currentUrl.startsWith("https://www.sohu.com/") && selector === "body" ? publicLocator(fixture.publicBody ?? "") : selector === "button" || selector === "body *" ? emptyLocator() : entryLocator,
    getByText: () => emptyLocator(),
    evaluate: async () => {
      evaluateCount += 1;
      return evaluateCount === 1 ? fixture.pageEvidence : fixture.candidates;
    }
  };
}

function setupReconciliation(fixture: ReconciliationFixture) {
  const page = fakeReconciliationPage(fixture);
  sessionManager.open = vi.fn(async () => ({
    page,
    executionMode: "VISIBLE",
    headless: false,
    sessionIdHash: "sohu-session-hash"
  } as unknown as BrowserSession));
  return { adapter: new SohuBrowserAdapter({ sessionManager }), page };
}

const completeEvidence = {
  pageLoaded: true,
  articleManagementPage: true,
  accountIdentityVisible: true,
  totalContentCount: 0,
  statusCounts: { 全部: 0, 已发布: 0, 审核中: 0, 未通过: 0, 草稿: 0, 定时发布: 0 },
  statusCategoriesComplete: true,
  titleOccurrenceCount: 0,
  matchingTitleHrefs: [],
  matchingTitleExternalIds: [],
  bodyText: "实名认证 我的内容 搜狐号账号 总内容量0 全部0已发布0审核中0未通过0草稿0定时发布0"
};

const reconciliationContext = { accountId: "account-1", accountName: "搜狐号账号", platformKey: "sohu_media", settings: { browserExecutionMode: "VISIBLE" } };

describe("Sohu browser article adapter", () => {
  const reconciliationCandidate = (overrides: Partial<SohuReconciliationCandidate> = {}): SohuReconciliationCandidate => ({
    title: "Geo Media Publisher 发布链路测试",
    status: "Unknown",
    statusText: "Geo Media Publisher 发布链路测试 2026-08-25 11:37",
    timeText: "2026-08-25 11:37",
    href: null,
    externalId: null,
    articleId: "sohu-article-1",
    summary: "Geo Media Publisher 内部发布链路测试",
    context: "Geo Media Publisher 发布链路测试 2026-08-25 11:37 Geo Media Publisher 内部发布链路测试",
    tab: "文章",
    actionLabels: ["查看"],
    dataAttributes: { "data-content-id": "sohu-article-1" },
    ...overrides
  });

  const reconciliationSnapshot = (candidates: SohuReconciliationCandidate[], overrides: Partial<SohuReconciliationSnapshot> = {}): SohuReconciliationSnapshot => ({
    pageUrl: "https://mp.sohu.com/mpfe/v4/contentManagement/first/page?newsType=1",
    tab: "文章",
    pageIndex: 1,
    lazyLoadPass: 0,
    searchUsed: false,
    candidates,
    ...overrides
  });

  it("classifies Sohu article review states from row semantics", () => {
    expect(classifySohuArticleStatus("Geo Media Publisher 发布链路测试 审核中")).toBe("PendingReview");
    expect(classifySohuArticleStatus("Geo Media Publisher 发布链路测试 已发布")).toBe("Published");
    expect(classifySohuArticleStatus("Geo Media Publisher 发布链路测试 未通过：内容不符合规范")).toBe("Rejected");
    expect(classifySohuArticleStatus("Geo Media Publisher 发布链路测试 草稿")).toBe("Draft");
  });

  it("returns a unique pending-review match without requiring an external URL", () => {
    const result = matchSohuArticleCandidates([reconciliationCandidate({ status: "PendingReview" })], {
      title: "Geo Media Publisher 发布链路测试",
      windowStart: "2026-08-25T02:00:00.000Z",
      windowEnd: "2026-08-25T04:00:00.000Z"
    });
    expect(result).toMatchObject({ classification: "UNIQUE", candidate: { status: "PendingReview", externalId: null }, timeWindowMatch: true });
  });

  it("returns PendingReview from a real management-row observation", async () => {
    const title = "Geo Media Publisher 发布链路测试";
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, titleOccurrenceCount: 1, bodyText: `${completeEvidence.bodyText} ${title}` },
      candidates: [{ title, status: "PendingReview", href: null, context: `${title} 2026-08-25 11:37 审核中`, label: "查看" }]
    });
    const result = await adapter.reconcile(reconciliationContext, { jobId: "job-1", articleId: "article-1", title, accountName: "搜狐号账号", windowStart: "2026-08-25T02:00:00.000Z", windowEnd: "2026-08-25T04:00:00.000Z", finalSubmitCount: 1 });
    expect(result).toMatchObject({ status: "STILL_UNCERTAIN", titleMatch: true, timeWindowMatch: true, response: { matchedBy: "exact_title_pending_review", platformStatus: "PendingReview" } });
    expect(result.message).toContain("SOHU_REAL_PUBLISH_PENDING_REVIEW");
  });

  it("returns a unique published match with an external URL", () => {
    const result = matchSohuArticleCandidates([reconciliationCandidate({ status: "Published", href: "https://www.sohu.com/a/123456789_1", externalId: "123456789" })], {
      title: "Geo Media Publisher 发布链路测试",
      windowStart: "2026-08-25T02:00:00.000Z",
      windowEnd: "2026-08-25T04:00:00.000Z"
    });
    expect(result).toMatchObject({ classification: "UNIQUE", candidate: { status: "Published", externalId: "123456789", href: "https://www.sohu.com/a/123456789_1" }, timeWindowMatch: true });
  });

  it("uses the target article row status instead of page-level 未通过 counts", async () => {
    const title = "Geo Media Publisher 发布链路测试";
    const listSummary = "全部1已发布1审核中0未通过0草稿0定时发布0";
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, titleOccurrenceCount: 1, bodyText: `${completeEvidence.bodyText} ${listSummary}` },
      candidates: [{ title, context: `${listSummary} ${title} 2026-08-25 13:58 已发布 查看`, statusText: `${title} 2026-08-25 13:58 已发布`, href: "https://www.sohu.com/a/1234567890_122970301", externalId: "1234567890", label: "查看" }]
    });
    const result = await adapter.reconcile(reconciliationContext, { jobId: "job-1", articleId: "article-1", title, accountName: "搜狐号账号", windowStart: "2026-08-25T05:00:00.000Z", windowEnd: "2026-08-25T06:00:00.000Z" });
    expect(result).toMatchObject({ status: "FOUND_PUBLISHED", externalId: "1234567890", publishedUrl: "https://www.sohu.com/a/1234567890_122970301", response: { platformStatus: "Published" } });
    expect(result.message).not.toContain("SOHU_REAL_PUBLISH_REJECTED");
  });

  it("uses unique target-row evidence plus published-list counts as auxiliary evidence", async () => {
    const title = "Geo Media Publisher 发布链路测试";
    const listSummary = "全部1已发布1审核中0未通过0草稿0定时发布0";
    const href = "https://www.sohu.com/a/1234567890_122970301";
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, titleOccurrenceCount: 1, bodyText: `${completeEvidence.bodyText} ${listSummary}` },
      candidates: [{ title, status: "Unknown", statusText: "阅读 0 评论 0 编辑 更多", context: `${listSummary} ${title} 2026-08-25 13:58 本内容用于公司内部验证。 阅读 0 评论 0 编辑 更多`, href, externalId: "1234567890", label: "查看" }]
    });
    const result = await adapter.reconcile(reconciliationContext, { jobId: "job-1", articleId: "article-1", title, accountName: "搜狐号账号", windowStart: "2026-08-25T05:00:00.000Z", windowEnd: "2026-08-25T06:00:00.000Z" });
    expect(result).toMatchObject({ status: "FOUND_PUBLISHED", externalId: "1234567890", publishedUrl: href, response: { matchedBy: "exact_title_unique_published_list_auxiliary", platformStatus: "Published", candidate: { statusSource: "list_level_auxiliary" } } });
  });

  it("takes the current maximum from repeated list-count renderings without using it as row status", () => {
    expect(parseSohuListStatusCounts([
      "全部0已发布0审核中0未通过0草稿0定时发布0",
      "全部1已发布1审核中0未通过0草稿0定时发布0 公告 全部 08-25搜狐号本周安全小贴士"
    ])).toEqual({ 全部: 1, 已发布: 1, 审核中: 0, 未通过: 0, 草稿: 0, 定时发布: 0 });
    expect(classifySohuArticleStatus("Geo Media Publisher 发布链路测试 阅读 0 评论 0 编辑 更多")).toBe("Unknown");
  });

  it("returns Rejected only when the target row itself says 未通过", async () => {
    const title = "Geo Media Publisher 发布链路测试";
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, titleOccurrenceCount: 1, bodyText: `${completeEvidence.bodyText} 全部1已发布1审核中0未通过0草稿0定时发布0` },
      candidates: [{ title, context: `${title} 2026-08-25 13:58 未通过`, statusText: `${title} 2026-08-25 13:58 未通过`, href: null, externalId: null, label: "查看" }]
    });
    const result = await adapter.reconcile(reconciliationContext, { jobId: "job-1", articleId: "article-1", title, accountName: "搜狐号账号", windowStart: "2026-08-25T05:00:00.000Z", windowEnd: "2026-08-25T06:00:00.000Z" });
    expect(result).toMatchObject({ status: "STILL_UNCERTAIN", response: { matchedBy: "exact_title_platform_rejected", platformStatus: "Rejected" } });
    expect(result.message).toContain("SOHU_REAL_PUBLISH_REJECTED");
  });

  it("enriches a published target row with its unique matching management href", async () => {
    const title = "Geo Media Publisher 发布链路测试";
    const href = "https://www.sohu.com/a/1234567890_122970301";
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, titleOccurrenceCount: 1, matchingTitleHrefs: [href], matchingTitleExternalIds: ["1234567890"], bodyText: `${completeEvidence.bodyText} ${title}` },
      candidates: [{ title, status: "Published", statusText: `${title} 2026-08-25 13:58 已发布`, context: `${title} 2026-08-25 13:58 已发布 查看`, href: null, externalId: null, label: "查看" }]
    });
    const result = await adapter.reconcile(reconciliationContext, { jobId: "job-1", articleId: "article-1", title, accountName: "搜狐号账号", windowStart: "2026-08-25T05:00:00.000Z", windowEnd: "2026-08-25T06:00:00.000Z" });
    expect(result).toMatchObject({ status: "FOUND_PUBLISHED", externalId: "1234567890", publishedUrl: href, response: { platformStatus: "Published" } });
  });

  it("does not let another article row's Rejected status affect the exact-title match", () => {
    const result = matchSohuArticleCandidates([
      reconciliationCandidate({ status: "Published" }),
      reconciliationCandidate({ title: "另一个文章", status: "Rejected", articleId: "sohu-article-2" })
    ], {
      title: "Geo Media Publisher 发布链路测试",
      windowStart: "2026-08-25T02:00:00.000Z",
      windowEnd: "2026-08-25T04:00:00.000Z"
    });
    expect(result).toMatchObject({ classification: "UNIQUE", candidate: { title: "Geo Media Publisher 发布链路测试", status: "Published" } });
  });

  it("verifies a published external URL by reading the public page title", async () => {
    const title = "Geo Media Publisher 发布链路测试";
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, titleOccurrenceCount: 1, bodyText: `${completeEvidence.bodyText} ${title}` },
      candidates: [{ href: "https://www.sohu.com/a/123456789_1", context: `${title} 2026-08-25 11:37 已发布`, label: "查看", externalId: "123456789" }],
      publicHeading: title,
      publicPageTitle: title,
      publicBody: title
    });
    const reconciliation = await adapter.reconcile(reconciliationContext, { jobId: "job-1", articleId: "article-1", title, accountName: "搜狐号账号", windowStart: "2026-08-25T02:00:00.000Z", windowEnd: "2026-08-25T04:00:00.000Z" });
    const verification = await adapter.verifyPublished(reconciliationContext, { articleId: "article-1", title, body: "正文", summary: "", tags: [] }, { externalId: reconciliation.externalId, publishedUrl: reconciliation.publishedUrl });
    expect(verification).toMatchObject({ status: "published", externalId: "123456789", publishedUrl: "https://www.sohu.com/a/123456789_1", response: { titleMatch: true, urlReachable: true } });
  });

  it("does not verify a published result when the public page title cannot be read", async () => {
    const title = "Geo Media Publisher 发布链路测试";
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, titleOccurrenceCount: 1, bodyText: `${completeEvidence.bodyText} ${title}` },
      candidates: [{ href: "https://www.sohu.com/a/123456789_1", context: `${title} 2026-08-25 11:37 已发布`, label: "查看", externalId: "123456789" }],
      publicHeading: "404",
      publicPageTitle: "404",
      publicBody: "页面不存在"
    });
    const reconciliation = await adapter.reconcile(reconciliationContext, { jobId: "job-1", articleId: "article-1", title, accountName: "搜狐号账号", windowStart: "2026-08-25T02:00:00.000Z", windowEnd: "2026-08-25T04:00:00.000Z" });
    const verification = await adapter.verifyPublished(reconciliationContext, { articleId: "article-1", title, body: "正文", summary: "", tags: [] }, { externalId: reconciliation.externalId, publishedUrl: reconciliation.publishedUrl });
    expect(verification.status).toBe("failed");
    expect(verification.errorCode).toBe("RECONCILIATION_UNCERTAIN");
  });

  it("keeps rejected and draft matches non-publishable", () => {
    for (const status of ["Rejected", "Draft"] as const) {
      const result = matchSohuArticleCandidates([reconciliationCandidate({ status })], {
        title: "Geo Media Publisher 发布链路测试",
        windowStart: "2026-08-25T02:00:00.000Z",
        windowEnd: "2026-08-25T04:00:00.000Z"
      });
      expect(result).toMatchObject({ classification: "UNIQUE", candidate: { status } });
      expect(result.candidate?.status).not.toBe("Published");
    }
  });

  it("reports duplicate exact-title rows as ambiguous instead of selecting the first", () => {
    const result = matchSohuArticleCandidates([
      reconciliationCandidate({ articleId: "sohu-article-1", href: "https://www.sohu.com/a/123456789_1", externalId: "123456789", status: "Published" }),
      reconciliationCandidate({ articleId: "sohu-article-2", href: "https://www.sohu.com/a/987654321_1", externalId: "987654321", status: "Published" })
    ], {
      title: "Geo Media Publisher 发布链路测试",
      windowStart: "2026-08-25T02:00:00.000Z",
      windowEnd: "2026-08-25T04:00:00.000Z"
    });
    expect(result.classification).toBe("AMBIGUOUS");
    expect(result.candidate).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });

  it("merges a target found on the second page and after lazy loading", () => {
    const target = reconciliationCandidate({ status: "Published", href: "https://www.sohu.com/a/123456789_1", externalId: "123456789" });
    const snapshots = mergeSohuReconciliationSnapshots([
      reconciliationSnapshot([], { pageIndex: 1 }),
      reconciliationSnapshot([], { pageIndex: 2 }),
      reconciliationSnapshot([target], { pageIndex: 2, lazyLoadPass: 1 })
    ]);
    const result = matchSohuArticleCandidates(snapshots.candidates, {
      title: "Geo Media Publisher 发布链路测试",
      windowStart: "2026-08-25T02:00:00.000Z",
      windowEnd: "2026-08-25T04:00:00.000Z"
    });
    expect(result.classification).toBe("UNIQUE");
    expect(result.candidate?.externalId).toBe("123456789");
    expect(snapshots.paginationChecked).toBe(true);
    expect(snapshots.lazyLoadChecked).toBe(true);
  });

  it("keeps the known Published row status discovered after an Unknown 全部 row", () => {
    const href = "https://www.sohu.com/a/1234567890_122970301";
    const merged = mergeSohuReconciliationSnapshots([
      reconciliationSnapshot([reconciliationCandidate({ status: "Unknown", statusText: "阅读 0 评论 0 编辑 更多", href, externalId: "1234567890" })], { tab: "全部" }),
      reconciliationSnapshot([reconciliationCandidate({ status: "Published", statusText: "2026-08-25 13:58 已发布", href, externalId: "1234567890" })], { tab: "已发布" })
    ]);
    expect(merged.candidates).toHaveLength(1);
    expect(merged.candidates[0]).toMatchObject({ status: "Published", tab: "已发布", href, externalId: "1234567890" });
  });

  it("finds a target revealed after switching from the default filter", () => {
    const target = reconciliationCandidate({ status: "PendingReview" });
    const snapshots = mergeSohuReconciliationSnapshots([
      reconciliationSnapshot([], { tab: "全部", searchUsed: false }),
      reconciliationSnapshot([target], { tab: "文章", searchUsed: true })
    ]);
    const result = matchSohuArticleCandidates(snapshots.candidates, {
      title: "Geo Media Publisher 发布链路测试",
      windowStart: "2026-08-25T02:00:00.000Z",
      windowEnd: "2026-08-25T04:00:00.000Z"
    });
    expect(result.classification).toBe("UNIQUE");
    expect(result.candidate?.status).toBe("PendingReview");
    expect(snapshots.tabsChecked).toBe(true);
    expect(snapshots.searchUsed).toBe(true);
  });

  it("returns no match without converting it into a publish failure", () => {
    const result = matchSohuArticleCandidates([], {
      title: "Geo Media Publisher 发布链路测试",
      windowStart: "2026-08-25T02:00:00.000Z",
      windowEnd: "2026-08-25T04:00:00.000Z"
    });
    expect(result.classification).toBe("NONE");
    expect(result.candidate).toBeUndefined();
  });

  const candidate = (overrides: Partial<SohuDeepDomCandidate> = {}): SohuDeepDomCandidate => ({
    tag: "button",
    text: "",
    selector: "button:nth-of-type(1)",
    frameUrl: "https://mp.sohu.com/mpfe/v4/contentManagement/news/addmoment",
    inFrame: false,
    visible: true,
    inViewport: true,
    disabled: false,
    ariaDisabled: false,
    boundingBox: { x: 10, y: 20, width: 80, height: 32 },
    css: { display: "block", visibility: "visible", opacity: "1" },
    region: "page",
    surface: "page",
    keywordMatches: [],
    ...overrides
  });

  const snapshot = (candidates: SohuDeepDomCandidate[]): SohuDeepDomSnapshot => ({
    phase: "after_content_reuse",
    pageUrl: "https://mp.sohu.com/mpfe/v4/contentManagement/news/addmoment",
    scrollY: 0,
    frameUrls: ["https://mp.sohu.com/mpfe/v4/contentManagement/news/addmoment"],
    candidates,
    bottomDom: [],
    portalSummary: [],
    shadowRootCount: 0
  });

  it("classifies an enabled direct final publish control without clicking it", () => {
    expect(classifySohuControlCandidate(candidate({ text: "立即发布", keywordMatches: ["立即发布"] }))).toBe("FINAL_SUBMIT_DIRECT");
  });

  it("classifies a visible custom div labeled 发布 as a direct final publish control", () => {
    expect(classifySohuControlCandidate(candidate({ tag: "div", text: "发布", keywordMatches: ["发布"] }))).toBe("FINAL_SUBMIT_DIRECT");
  });

  it("allows direct-submit preflight only for an explicit pending-action continuation", () => {
    expect(shouldAllowSohuDirectSubmitPreflight("RUN_SELF_TEST")).toBe(false);
    expect(shouldAllowSohuDirectSubmitPreflight("CONTINUE_PENDING_ACTION")).toBe(true);
    expect(shouldAllowSohuDirectSubmitPreflight(undefined)).toBe(false);
  });

  it("classifies exact next-step and preview controls as non-final transitions", () => {
    expect(classifySohuControlCandidate(candidate({ text: "下一步" }))).toBe("NEXT_STEP_TO_CONFIRMATION");
    expect(classifySohuControlCandidate(candidate({ tag: "a", text: "预览" }))).toBe("PREVIEW_ONLY");
  });

  it("classifies a hidden or disabled publish candidate as required-state blocked", () => {
    expect(classifySohuControlCandidate(candidate({ text: "发布", visible: false, disabled: true, css: { display: "none", visibility: "hidden", opacity: "0" } }))).toBe("CONTROL_HIDDEN_BY_REQUIRED_STATE");
  });

  it("preserves iframe and portal location classifications", () => {
    expect(classifySohuControlCandidate(candidate({ text: "发布", frameUrl: "https://mp.sohu.com/confirm-frame", inFrame: true, surface: "confirmation" }))).toBe("CONTROL_IN_IFRAME");
    expect(classifySohuControlCandidate(candidate({ text: "下一步", region: "portal", surface: "modal" }))).toBe("CONTROL_IN_PORTAL");
  });

  it("classifies a discovery with no candidates as control not found", () => {
    expect(classifySohuDiscovery(snapshot([]))).toMatchObject({ classification: "CONTROL_NOT_FOUND", directFinalCount: 0, safeTransitionCount: 0 });
  });

  it("reports bounded candidate additions and changes between content phases", () => {
    const before = snapshot([candidate({ selector: "button.save", text: "保存" })]);
    const after = snapshot([candidate({ selector: "button.save", text: "保存并发布" }), candidate({ selector: "button.next", text: "下一步" })]);
    expect(diffSohuDomSnapshots(before, after)).toMatchObject({ added: [`${before.pageUrl}::button.next`], removed: [], changed: [`${before.pageUrl}::button.save`] });
  });

  it("declares V1.1.9 article capability and platform-specific result contracts", () => {
    const adapter = new SohuBrowserAdapter({ sessionManager });
    expect(adapter.manifest).toMatchObject({ platformKey: "sohu_media", integrationMode: "BrowserAutomation", supportsArticle: true });
    expect(adapter.getCapabilities()).toMatchObject({ article: true, imagePost: true, categories: true });
    expect(adapter.finalSubmit).toBeTypeOf("function");
    expect(adapter.collectPublishResult).toBeTypeOf("function");
    expect(adapter.verifyPublished).toBeTypeOf("function");
    expect(adapter.reconcile).toBeTypeOf("function");
  });

  it("keeps final submit fail-closed until the verified visible editor session exists", async () => {
    sessionManager.open = vi.fn();
    const adapter = new SohuBrowserAdapter({ sessionManager });
    await expect(adapter.finalSubmit(
      { accountId: "account-1", accountName: "搜狐号账号", platformKey: "sohu_media", settings: {} },
      { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] },
      { jobId: "job-1", submissionIntentId: "intent-1", attempt: 1 }
    )).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
  });

  it("returns FOUND_PUBLISHED only for a complete authenticated article-management match", async () => {
    const title = "Geo Media Publisher 发布链路测试";
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, titleOccurrenceCount: 1, bodyText: `${completeEvidence.bodyText} ${title}` },
      candidates: [{ href: "https://www.sohu.com/a/123456789_1", context: `${title} 今天`, label: title, externalId: "123456789" }]
    });
    const result = await adapter.reconcile(reconciliationContext, {
      jobId: "job-1", articleId: "article-1", title, accountName: "搜狐号账号", windowStart: "2026-08-25T02:00:00.000Z", windowEnd: "2026-08-25T04:00:00.000Z"
    });
    expect(result).toMatchObject({ status: "FOUND_PUBLISHED", externalId: "123456789", publishedUrl: "https://www.sohu.com/a/123456789_1", titleMatch: true, accountMatch: true, timeWindowMatch: true });
  });

  it("returns CONFIRMED_NOT_PUBLISHED only when every negative-evidence gate is explicit", async () => {
    const { adapter } = setupReconciliation({ pageEvidence: completeEvidence, candidates: [] });
    const result = await adapter.reconcile(reconciliationContext, {
      jobId: "job-1", articleId: "article-1", title: "Geo Media Publisher 发布链路测试", accountName: "搜狐号账号", windowStart: "2026-08-25T02:00:00.000Z", windowEnd: "2026-08-25T04:00:00.000Z", waitWindowSatisfied: true, submissionIntentState: "Unknown", finalSubmitCount: 1
    });
    expect(result.status).toBe("CONFIRMED_NOT_PUBLISHED");
    expect(result.response).toMatchObject({ negativeEvidence: { totalContentCount: 0, statusCategoriesComplete: true, noMatchingTitle: true, noMatchingExternalId: true, noMatchingUrl: true, noSecondSubmit: true, waitWindowSatisfied: true } });
  });

  it("keeps incomplete DOM evidence STILL_UNCERTAIN even when no candidate is found", async () => {
    const { adapter } = setupReconciliation({
      pageEvidence: { ...completeEvidence, statusCategoriesComplete: false, statusCounts: { ...completeEvidence.statusCounts, 草稿: null } },
      candidates: []
    });
    const result = await adapter.reconcile(reconciliationContext, {
      jobId: "job-1", articleId: "article-1", title: "Geo Media Publisher 发布链路测试", accountName: "搜狐号账号", windowStart: "2026-08-25T02:00:00.000Z", windowEnd: "2026-08-25T04:00:00.000Z", waitWindowSatisfied: true, submissionIntentState: "Unknown", finalSubmitCount: 1
    });
    expect(result.status).toBe("STILL_UNCERTAIN");
    expect(result.message).toContain("DOM 未完整加载");
  });

  it("does not call finalSubmit during reconciliation and preserves the persisted count", async () => {
    const { adapter } = setupReconciliation({ pageEvidence: completeEvidence, candidates: [] });
    const finalSubmit = vi.spyOn(adapter, "finalSubmit");
    const result = await adapter.reconcile(reconciliationContext, { jobId: "job-1", articleId: "article-1", title: "Geo Media Publisher 发布链路测试", accountName: "搜狐号账号", windowStart: "2026-08-25T02:00:00.000Z", windowEnd: "2026-08-25T04:00:00.000Z", finalSubmitCount: 1 });
    expect(finalSubmit).not.toHaveBeenCalled();
    expect(result.response).toMatchObject({ finalSubmitEvidence: { finalSubmitCount: 1, noSecondSubmit: true } });
  });
});
