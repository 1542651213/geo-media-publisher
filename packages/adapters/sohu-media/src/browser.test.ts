import { describe, expect, it, vi } from "vitest";
import type { BrowserSessionManager } from "@publisher/adapters-core";
import type { BrowserSession } from "@publisher/adapters-core";
import { classifySohuControlCandidate, classifySohuDiscovery, diffSohuDomSnapshots, shouldAllowSohuDirectSubmitPreflight, SohuBrowserAdapter, type SohuDeepDomCandidate, type SohuDeepDomSnapshot } from "./browser";

const sessionManager = {
  hasStoredSession: vi.fn(() => true),
  open: vi.fn(),
  close: vi.fn(async (_session: BrowserSession) => undefined),
  closeAll: vi.fn(async () => undefined)
} as unknown as BrowserSessionManager;

type ReconciliationFixture = {
  pageEvidence: Record<string, unknown>;
  candidates: Array<{ href: string; context: string; label: string; externalId: string | null }>;
  initialUrl?: string;
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
    filter: () => emptyLocator(),
    isVisible: async () => false,
    isEnabled: async () => false,
    getAttribute: async () => null,
    innerText: async () => ""
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
    waitForFunction: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: (selector: string) => selector === "button" || selector === "body *" ? emptyLocator() : entryLocator,
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
});
