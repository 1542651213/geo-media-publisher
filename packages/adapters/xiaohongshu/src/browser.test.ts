import { describe, expect, it, vi } from "vitest";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";
import type { BrowserSession, BrowserSessionManager } from "@publisher/adapters-core";
import type { Locator, Page } from "playwright-core";
import { XiaohongshuBrowserAdapter, classifyXiaohongshuPublishSettings, normalizeXiaohongshuEditorText } from "./browser";

const article: PublishArticleInput = {
  articleId: "article-xhs-1",
  title: "GMP 小红书图文能力验证 2026-08-27 12:34:56",
  body: "这是 Geo Media Publisher 小红书 BrowserAutomation 图文能力验证内容，仅用于验证账号、图片、标题、正文和发布控件，不执行最终发布。",
  summary: "",
  tags: [],
  images: ["C:/fixtures/xiaohongshu-test.png"]
};

type FixtureOptions = {
  accountId?: string | null;
  accountName?: string;
  profileHref?: string | null;
  pageUrl?: string;
  entryCount?: number;
  videoEntryCount?: number;
  titleCount?: number;
  bodyCount?: number;
  titleReadback?: string;
  bodyReadback?: string;
  imagePreviewCount?: number;
  imageLoading?: boolean;
  imageFailed?: boolean;
  requiredEmpty?: boolean;
  securityText?: string;
  settings?: Array<{ label: string; required: boolean; value: string }>;
  submitCount?: number;
  submitEnabled?: boolean;
  secondConfirmation?: boolean;
  loginPage?: boolean;
  pagePresentInContext?: boolean;
};

interface Fixture {
  page: Page;
  manager: BrowserSessionManager;
  submitClick: ReturnType<typeof vi.fn>;
  inputSetFiles: ReturnType<typeof vi.fn>;
  entryClick: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  calls: string[];
}

function installSharedConnectionLifecycle(fixture: Fixture): void {
  const managerState = (fixture.manager as unknown as {
    __fixtureState?: {
      session: BrowserSession;
      context: { pages: () => Page[] };
      createOperationPage: () => Page;
    };
  }).__fixtureState;
  if (!managerState) throw new Error("fixture state is missing");
  const active = new Map<string, BrowserSession>();
  const pending = new Set<string>();
  const runtimeStates = new Map<string, { state: "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED"; contextDebugId: string | null; updatedAt: string; reason: string | null }>();
  const operationPages = new Map<string, Set<Page>>();
  const manager = fixture.manager as unknown as Record<string, unknown>;
  const identityKey = (identity: { platformKey: string; accountId: string }): string => `${identity.platformKey}:${identity.accountId}`;
  manager.getActiveSession = vi.fn((identity: { platformKey: string; accountId: string }) => active.get(identityKey(identity)) ?? null);
  manager.setActiveSession = vi.fn((identity: { platformKey: string; accountId: string }, session: BrowserSession) => { active.set(`${identity.platformKey}:${identity.accountId}`, session); });
  manager.clearActiveSession = vi.fn((identity: { platformKey: string; accountId: string }, session?: BrowserSession) => {
    const key = identityKey(identity);
    if (!session || active.get(key) === session) active.delete(key);
  });
  manager.markConnectionPending = vi.fn((identity: { platformKey: string; accountId: string }) => { pending.add(identityKey(identity)); });
  manager.isConnectionPending = vi.fn((identity: { platformKey: string; accountId: string }) => pending.has(identityKey(identity)));
  manager.clearConnectionPending = vi.fn((identity: { platformKey: string; accountId: string }) => { pending.delete(identityKey(identity)); });
  manager.requiresActiveContextForOperations = vi.fn((identity: { platformKey: string; accountId: string }) => identity.platformKey === "xiaohongshu");
  manager.retainsContextAfterPageClose = vi.fn((identity: { platformKey: string; accountId: string }) => identity.platformKey === "xiaohongshu");
  manager.openOperationPage = vi.fn(async (identity: { platformKey: string; accountId: string }) => {
    const key = identityKey(identity);
    const session = active.get(key) ?? managerState.session;
    active.set(key, session);
    const page = managerState.createOperationPage();
    const pages = operationPages.get(key) ?? new Set<Page>();
    pages.add(page);
    operationPages.set(key, pages);
    return { session, page, pageDebugId: `operation-page-${pages.size}` };
  });
  manager.closeOperationPage = vi.fn(async (identity: { platformKey: string; accountId: string }, page: Page) => {
    const key = identityKey(identity);
    const session = active.get(key) ?? null;
    const ownedOperationPage = Boolean(session && operationPages.get(key)?.has(page));
    const retainedCanonicalPage = Boolean(session && identity.platformKey === "xiaohongshu" && session.page === page);
    if (!session || (!ownedOperationPage && !retainedCanonicalPage) || !managerState.context.pages().includes(page)) {
      throw new Error("Operation Page does not belong to the active session Context");
    }
    await (page as unknown as { close: () => Promise<void> }).close();
    if (ownedOperationPage) operationPages.get(key)?.delete(page);
  });
  manager.setRuntimeAuthState = vi.fn((identity: { platformKey: string; accountId: string }, state: "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED", reason: string | null) => {
    const session = active.get(identityKey(identity)) ?? null;
    runtimeStates.set(identityKey(identity), { state, contextDebugId: session?.contextDebugId ?? null, updatedAt: new Date().toISOString(), reason });
  });
  manager.getRuntimeAuthState = vi.fn((identity: { platformKey: string; accountId: string }) => runtimeStates.get(identityKey(identity)) ?? {
    state: "UNVERIFIED",
    contextDebugId: null,
    updatedAt: new Date(0).toISOString(),
    reason: null
  });
}

function locator(overrides: Partial<Record<string, unknown>> = {}): Locator {
  return {
    count: vi.fn(async () => 0),
    first: vi.fn(function (this: Locator) { return this; }),
    nth: vi.fn(function (this: Locator) { return this; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => ""),
    textContent: vi.fn(async () => ""),
    inputValue: vi.fn(async () => ""),
    fill: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    setInputFiles: vi.fn(async () => undefined),
    getAttribute: vi.fn(async () => null),
    evaluateAll: vi.fn(async () => []),
    ...overrides
  } as unknown as Locator;
}

function setupPage(options: FixtureOptions = {}): Fixture {
  const calls: string[] = [];
  const creatorHomeUrl = options.pageUrl ?? "https://creator.xiaohongshu.com/";
  let currentUrl = options.loginPage ? "https://www.xiaohongshu.com/login" : creatorHomeUrl;
  let titleValue = "";
  let bodyValue = "";
  let imageUploaded = false;
  let contextPages: Page[] = [];
  const submitClick = vi.fn(async () => { calls.push("final-submit-click"); });
  const inputSetFiles = vi.fn(async () => { imageUploaded = true; calls.push("image-set-input-files"); });
  const entryClick = vi.fn(async () => { currentUrl = "https://creator.xiaohongshu.com/publish/publish"; calls.push("image-post-entry-click"); });

  const profile = locator({
    count: vi.fn(async () => options.profileHref === null ? 0 : 1),
    innerText: vi.fn(async () => options.accountName ?? "XHS owner"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? options.profileHref ?? "https://www.xiaohongshu.com/user/profile/65abc123" : name === "aria-label" ? "个人主页" : null)
  });
  const nickname = locator({
    count: vi.fn(async () => options.profileHref === null ? 1 : 0),
    innerText: vi.fn(async () => options.accountName ?? "XHS owner"),
    getAttribute: vi.fn(async (name: string) => name === "aria-label" ? "账号昵称" : null)
  });
  const entry = locator({
    count: vi.fn(async () => currentUrl.endsWith("/") ? options.entryCount ?? 1 : 0),
    innerText: vi.fn(async () => "发布图文笔记"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? "/publish/publish" : name === "aria-label" ? "图文笔记" : null),
    click: entryClick
  });
  const videoEntry = locator({
    count: vi.fn(async () => currentUrl.endsWith("/") ? options.videoEntryCount ?? 0 : 0),
    innerText: vi.fn(async () => "发布视频"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? "/publish/video" : null)
  });
  const title = locator({
    count: vi.fn(async () => currentUrl.includes("/publish/") ? options.titleCount ?? 1 : 0),
    inputValue: vi.fn(async () => options.titleReadback ?? titleValue),
    innerText: vi.fn(async () => options.titleReadback ?? titleValue),
    fill: vi.fn(async (value: string) => { titleValue = value; calls.push("title-fill"); }),
    getAttribute: vi.fn(async (name: string) => ({ placeholder: "填写标题", "aria-label": "笔记标题", name: "title", id: "note-title" }[name] ?? null))
  });
  const body = locator({
    count: vi.fn(async () => currentUrl.includes("/publish/") ? options.bodyCount ?? 1 : 0),
    innerText: vi.fn(async () => options.bodyReadback ?? bodyValue),
    textContent: vi.fn(async () => options.bodyReadback ?? bodyValue),
    fill: vi.fn(async (value: string) => { bodyValue = value; calls.push("body-fill"); }),
    getAttribute: vi.fn(async (name: string) => ({ role: "textbox", contenteditable: "true", "data-placeholder": "填写正文", class: "note-editor ProseMirror" }[name] ?? null))
  });
  const fileInput = locator({
    count: vi.fn(async () => currentUrl.includes("/publish/") ? 1 : 0),
    setInputFiles: inputSetFiles,
    getAttribute: vi.fn(async (name: string) => name === "accept" ? "image/*" : name === "aria-label" ? "上传图片" : null)
  });
  const preview = locator({
    count: vi.fn(async () => imageUploaded ? options.imagePreviewCount ?? 1 : 0),
    isVisible: vi.fn(async () => imageUploaded),
    getAttribute: vi.fn(async (name: string) => name === "src" ? "https://sns-webpic-qc.xhscdn.com/test-image.png" : null)
  });
  const loading = locator({
    count: vi.fn(async () => options.imageLoading ? 1 : 0),
    isVisible: vi.fn(async () => Boolean(options.imageLoading)),
    innerText: vi.fn(async () => "上传中")
  });
  const required = locator({
    count: vi.fn(async () => options.requiredEmpty ? 1 : 0),
    innerText: vi.fn(async () => options.requiredEmpty ? "话题" : ""),
    inputValue: vi.fn(async () => options.requiredEmpty ? "" : "已填写"),
    getAttribute: vi.fn(async (name: string) => name === "aria-required" ? "true" : name === "aria-label" ? "话题" : null)
  });
  const settings = locator({
    count: vi.fn(async () => options.settings?.length ?? 0),
    nth: vi.fn((index: number) => locator({
      innerText: vi.fn(async () => options.settings?.[index]?.label ?? ""),
      getAttribute: vi.fn(async (name: string) => name === "aria-required" ? options.settings?.[index]?.required ? "true" : null : name === "aria-checked" ? options.settings?.[index]?.value : null)
    }))
  });
  const submit = locator({
    count: vi.fn(async () => currentUrl.includes("/publish/") ? options.submitCount ?? 1 : 0),
    isEnabled: vi.fn(async () => options.submitEnabled !== false),
    innerText: vi.fn(async () => "发布笔记"),
    getAttribute: vi.fn(async (name: string) => name === "aria-label" ? "发布笔记" : name === "data-confirm" ? options.secondConfirmation ? "true" : null : null),
    click: submitClick
  });
  const secondConfirm = locator({
    count: vi.fn(async () => options.secondConfirmation ? 1 : 0),
    innerText: vi.fn(async () => "确认发布")
  });
  const empty = locator();
  const pageRoot = locator({ innerText: vi.fn(async () => `${options.accountName ?? "XHS owner"} ${options.securityText ?? ""} ${options.imageFailed ? "图片上传失败" : ""}`) });
  const createPage = (initialUrl: string, onClose?: () => void): Page => {
    let pageUrl = initialUrl;
    let closed = false;
    const page = {
      goto: vi.fn(async (_url: string) => {
        pageUrl = options.loginPage ? "https://www.xiaohongshu.com/login" : creatorHomeUrl;
        currentUrl = pageUrl;
      }),
      url: vi.fn(() => pageUrl),
      title: vi.fn(async () => "小红书创作服务平台"),
      frames: vi.fn(() => []),
      close: vi.fn(async () => {
        closed = true;
        contextPages = contextPages.filter((candidate) => candidate !== page);
        onClose?.();
      }),
      isClosed: vi.fn(() => closed),
      locator: vi.fn((selector: string) => {
        currentUrl = pageUrl;
        if (selector === "body") return pageRoot;
        if (selector === "a[href]") return profile;
        if (selector.includes("nickname") || selector.includes("账号")) return nickname;
        if (selector.includes("/publish/video") || selector.includes("视频")) return videoEntry;
        if (selector.includes("/publish/publish") || selector.includes("图文") || selector.includes("笔记")) return entry;
        if (selector.includes("input[type=\"file\"]") || selector.includes("input[type='file']")) return fileInput;
        if (selector.includes("preview") || selector.includes("upload-result") || selector.includes("note-image")) return preview;
        if (selector.includes("loading") || selector.includes("progress") || selector.includes("上传中")) return loading;
        if (selector.includes("required") || selector.includes("aria-required")) return required;
        if (selector.includes("checkbox") || selector.includes("radio") || selector.includes("setting")) return settings;
        if (selector.includes("button") || selector.includes("[role=\"button\"]")) return submit;
        if (selector.includes("确认发布")) return secondConfirm;
        if (selector.includes("textarea") || selector.includes("contenteditable") || selector.includes("textbox") || selector.includes("正文")) return body;
        if (selector.includes("title") || selector.includes("标题") || selector.includes("placeholder")) return title;
        return empty;
      })
    } as unknown as Page;
    return page;
  };
  const page = createPage(currentUrl);
  contextPages = options.pagePresentInContext === false ? [] : [page];
  const context = {
    pages: vi.fn(() => [...contextPages]),
    newPage: vi.fn(async () => {
      const operationPage = createPage(creatorHomeUrl);
      contextPages = [...contextPages, operationPage];
      return operationPage;
    })
  };
  const session = {
    page,
    executionMode: "VISIBLE",
    headless: false,
    hasStoredSession: true,
    sessionIdHash: `session-${options.accountId ?? "account-a"}`,
    storageMode: "PERSISTENT_PROFILE",
    profilePath: "C:/profiles/xiaohongshu/account-a",
    browserChannel: "chrome",
    credentialSnapshotInjected: false,
    contextDebugId: "context-debug-id",
    pageDebugId: "canonical-page-debug-id",
    context
  } as unknown as BrowserSession;
  const open = vi.fn(async (identity: { platformKey: string; accountId: string }) => {
    calls.push(`open:${identity.platformKey}:${identity.accountId}`);
    return session;
  });
  const manager = {
    debugId: "manager-debug-id",
    hasStoredSession: vi.fn(() => true),
    open,
    save: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    clear: vi.fn(),
    closeAll: vi.fn(async () => undefined),
    __fixtureState: {
      session,
      context,
      createOperationPage: () => {
        const operationPage = createPage(creatorHomeUrl);
        contextPages = [...contextPages, operationPage];
        return operationPage;
      }
    }
  } as unknown as BrowserSessionManager;
  const fixture = { page, manager, submitClick, inputSetFiles, entryClick, open, calls };
  installSharedConnectionLifecycle(fixture);
  return fixture;
}

function installPageEvidence(fixture: Fixture, options: {
  positiveSignals?: string[];
  blockingSignals?: string[];
  displayName?: string | null;
  externalAccountId?: string | null;
  profileUrl?: string | null;
}): void {
  (fixture.page as unknown as { evaluate: (pageFunction: () => unknown) => Promise<unknown> }).evaluate = vi.fn(async () => ({
    available: true,
    bodyPresent: true,
    bodyTextLength: 512,
    login: {
      available: true,
      url: "https://creator.xiaohongshu.com/new/home",
      creatorHost: true,
      creatorHomePath: true,
      explicitLoginUrl: false,
      verificationUrl: false,
      publishNoteVisible: (options.positiveSignals ?? ["发布笔记", "笔记管理"]).includes("发布笔记"),
      noteManagementVisible: (options.positiveSignals ?? ["发布笔记", "笔记管理"]).includes("笔记管理"),
      dataDashboardVisible: (options.positiveSignals ?? []).includes("数据看板"),
      accountStatusVisible: (options.positiveSignals ?? []).includes("账号状态正常"),
      profileAreaVisible: Boolean(options.displayName || options.externalAccountId),
      visibleLoginForm: false,
      visibleQrLogin: false,
      visibleSmsVerification: false,
      visibleCaptcha: false,
      visibleSlider: false,
      visibleSecurityModal: false,
      positiveSignals: options.positiveSignals ?? ["发布笔记", "笔记管理"],
      blockingSignals: options.blockingSignals ?? []
    },
    identity: {
      displayName: options.displayName ?? null,
      externalAccountId: options.externalAccountId ?? null,
      externalAccountIdCandidates: options.externalAccountId ? [options.externalAccountId] : [],
      profileUrl: options.profileUrl ?? null
    }
  }));
}

function context(accountId = "account-a") {
  return { accountId, accountName: "XHS owner", platformKey: "xiaohongshu", settings: { browserExecutionMode: "VISIBLE", triggerSource: "START_PUBLISH", userActionId: `action-${accountId}` } };
}

describe("Xiaohongshu BrowserAutomation article gate", () => {
  it("evaluates the existing creator home without navigating away and emits raw login evidence", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installSharedConnectionLifecycle(fixture);
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板", "创作服务平台", "账号状态正常"], displayName: "苏州别墅光伏", externalAccountId: "960803317" });
    const evaluations: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, onLoginEvaluation: (evaluation: Record<string, unknown>) => evaluations.push(evaluation) } as never);

    await adapter.connectAccount(context());
    await expect(adapter.completeConnection(context())).resolves.toBe("logged_in");

    expect(fixture.page.goto).toHaveBeenCalledTimes(1);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]).toMatchObject({
      phase: "COMPLETE_LOGIN_CHECK",
      pageUrl: "https://creator.xiaohongshu.com/new/home",
      pageIsClosed: false,
      creatorDomain: true,
      creatorHomePath: true,
      publishNoteVisible: true,
      noteManagementVisible: true,
      dataDashboardVisible: true,
      accountStatusVisible: true,
      profileAreaVisible: true,
      visibleLoginForm: false,
      visibleQrLogin: false,
      visibleSmsVerification: false,
      visibleCaptcha: false,
      visibleSlider: false,
      visibleSecurityModal: false,
      positiveSignalCount: 5,
      blockingSignalCount: 0,
      loginClassification: "logged_in"
    });
  });

  it("emits live-login and before-close auth diagnostics without exposing storage values", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"] });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      loginStabilityWindowMs: 0,
      onAuthStateDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    const lifecycle = adapter as unknown as { persistConnectionSession: (context: AccountContext) => Promise<void> };
    await lifecycle.persistConnectionSession(ctx);

    expect(diagnostics.map((diagnostic) => diagnostic.phase)).toEqual(["LIVE_LOGIN_BEFORE_CLOSE", "AUTH_STATE_BEFORE_CLOSE"]);
    expect(diagnostics[0]).toMatchObject({ platformKey: "xiaohongshu", accountId: "account-a", stableObservationPassed: true });
    expect(diagnostics[1]).toMatchObject({ platformKey: "xiaohongshu", accountId: "account-a", authState: null });
    expect(JSON.stringify(diagnostics)).not.toMatch(/"value"|secret/iu);
  });

  it("exposes an article-only BrowserAutomation capability", () => {
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: setupPage().manager });
    expect(adapter.manifest).toMatchObject({ platformKey: "xiaohongshu", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false });
    expect(adapter.getCapabilities()).toMatchObject({ article: true, imagePost: true, video: false, maxImageCount: 18 });
  });

  it("probes a new Page in the same account-owned Context without changing account identity", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installSharedConnectionLifecycle(fixture);
    const session = await fixture.open({ platformKey: "xiaohongshu", accountId: "account-a" });
    let pages: Page[] = [fixture.page];
    (fixture.page as unknown as { close: () => Promise<void> }).close = vi.fn(async () => { pages = []; });
    const newPage = {
      url: vi.fn(() => "https://creator.xiaohongshu.com/"),
      goto: vi.fn(async () => undefined),
      close: vi.fn(async () => { pages = pages.filter((page) => page !== newPage); }),
      isClosed: vi.fn(() => false)
    } as unknown as Page;
    const ownedContext = session.context as unknown as { pages: () => Page[]; newPage: () => Promise<Page> };
    ownedContext.pages = vi.fn(() => pages);
    ownedContext.newPage = vi.fn(async () => { pages = [...pages, newPage]; return newPage; });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    const result = await adapter.openSameContextDiagnosticPage(context("account-a"));

    expect(result).toMatchObject({ platformKey: "xiaohongshu", accountId: "account-a", originalPageClosed: true, newPageOwnedByContext: true, pageCountBefore: 1, pageCountAfter: 1, newPageUrl: "https://creator.xiaohongshu.com/" });
    expect(ownedContext.newPage).toHaveBeenCalledTimes(1);
    expect(newPage.close).not.toHaveBeenCalled();
  });

  it("recognizes a logged-in account and returns stable profile identity", async () => {
    const fixture = setupPage({ accountId: "account-a", profileHref: "https://www.xiaohongshu.com/user/profile/65abc123", accountName: "小红书账号 A" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("logged_in");
    await expect(adapter.getAccountProfile(context("account-a"))).resolves.toMatchObject({ accountId: "65abc123", accountName: "小红书账号 A" });
    expect(fixture.open).toHaveBeenCalledWith({ platformKey: "xiaohongshu", accountId: "account-a" }, expect.anything(), "VISIBLE");
  });

  it("accepts a creator home with multiple creator signals despite ordinary login text", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", securityText: "登录 验证码登录 安全验证帮助文案" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板", "创作服务平台"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("logged_in");
  });

  it("fails closed when the owned Page redirects to login immediately after the first home check", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "数据看板"] });
    let redirected = false;
    (fixture.page as unknown as { waitForTimeout: (milliseconds: number) => Promise<void> }).waitForTimeout = vi.fn(async () => { redirected = true; });
    vi.mocked(fixture.page.url).mockImplementation(() => redirected ? "https://creator.xiaohongshu.com/login" : "https://creator.xiaohongshu.com/new/home");
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("expired");
  });

  it("ignores hidden verification text on an otherwise logged-in creator home", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", securityText: "验证码登录" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("logged_in");
  });

  it("blocks a visible SMS verification panel", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], blockingSignals: ["visible_sms_verification_panel"] });
    expect(typeof (fixture.page as unknown as { evaluate?: unknown }).evaluate).toBe("function");
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("needs_user_action");
  });

  it("blocks a visible CAPTCHA or slider modal", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { blockingSignals: ["visible_captcha_slider_modal"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("needs_user_action");
  });

  it("reads the stable Xiaohongshu account field instead of guessing an external ID", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: null, accountName: "苏州别墅光伏" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"], displayName: "苏州别墅光伏", externalAccountId: "960803317" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.getAccountProfile(context("account-a"))).resolves.toMatchObject({ accountName: "苏州别墅光伏", accountId: "960803317" });
  });

  it("keeps the owner visible Page through login completion and identity readback", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home", profileHref: "https://www.xiaohongshu.com/user/profile/65abc123", accountName: "小红书账号 A" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], displayName: "小红书账号 A", externalAccountId: "65abc123" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    expect(fixture.manager.close).not.toHaveBeenCalled();

    await expect(adapter.getAccountProfile(ctx)).resolves.toMatchObject({ accountName: "小红书账号 A", accountId: "65abc123" });
    expect(fixture.open).toHaveBeenCalledTimes(1);
  });

  it("resolves the same active Page when begin and complete use different adapter instances", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    installSharedConnectionLifecycle(fixture);
    const beginAdapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const completeAdapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await beginAdapter.connectAccount(ctx);
    await expect(completeAdapter.completeConnection(ctx)).resolves.toBe("logged_in");
    expect(fixture.manager.getActiveSession?.({ platformKey: "xiaohongshu", accountId: "account-a" })).toBeDefined();
  });

  it("emits sanitized begin and complete diagnostics with identical Page and Context IDs", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager, onConnectionDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic) } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);

    expect(diagnostics.map((diagnostic) => diagnostic.phase)).toEqual(["BEGIN_LOGIN_PAGE", "COMPLETE_LOGIN_PAGE"]);
    expect(diagnostics[0]).toMatchObject({ platformKey: "xiaohongshu", accountId: "account-a", activeSessionFound: true, pageUrl: "https://creator.xiaohongshu.com/new/home", pageClosed: false });
    expect(diagnostics[0]?.adapterDebugId).toBe(diagnostics[1]?.adapterDebugId);
    expect(diagnostics[0]?.browserSessionManagerDebugId).toBe(diagnostics[1]?.browserSessionManagerDebugId);
    expect(diagnostics[0]?.contextDebugId).toBe(diagnostics[1]?.contextDebugId);
    expect(diagnostics[0]?.pageDebugId).toBe(diagnostics[1]?.pageDebugId);
    expect(diagnostics.flatMap((diagnostic) => Object.keys(diagnostic))).not.toContain("storageState");
  });

  it("reports ACTIVE_LOGIN_SESSION_NOT_FOUND instead of falling back to stored-session checks", async () => {
    const fixture = setupPage();
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.completeConnection(context("account-a"))).rejects.toThrow(/ACTIVE_LOGIN_SESSION_NOT_FOUND/iu);
    expect(fixture.open).not.toHaveBeenCalled();
  });

  it("reads identity before explicit Session persistence and keeps the same Page until release", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], displayName: "小红书账号 A", externalAccountId: "65abc123" });
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    expect(fixture.manager.save).not.toHaveBeenCalled();
    await expect(adapter.getAccountProfile(ctx)).resolves.toMatchObject({ accountId: "65abc123", accountName: "小红书账号 A" });
    const beforePersist = await adapter.getBrowserSessionEvidence(ctx);
    const lifecycle = adapter as unknown as { persistConnectionSession: (context: AccountContext) => Promise<void> };
    await lifecycle.persistConnectionSession(ctx);
    expect(fixture.manager.save).toHaveBeenCalledTimes(1);
    expect(fixture.manager.close).not.toHaveBeenCalled();
    const afterPersist = await adapter.getBrowserSessionEvidence(ctx);
    expect(afterPersist).toMatchObject({ pageDebugId: beforePersist?.pageDebugId, contextDebugId: beforePersist?.contextDebugId, pageUrl: "https://creator.xiaohongshu.com/new/home" });
    await adapter.releaseConnectionSession?.(ctx);
    expect(fixture.manager.close).toHaveBeenCalledTimes(1);
  });

  it("releases only the XHS login Page after persistence and retains the canonical Context", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
    await adapter.getAccountProfile(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);

    expect((fixture.page as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1);
    expect(fixture.manager.close).not.toHaveBeenCalled();
    expect(fixture.manager.getActiveSession?.({ platformKey: "xiaohongshu", accountId: "account-a" })).toBeDefined();
  });

  it("emits sanitized LOGIN_PAGE_RELEASED evidence after retaining the XHS Context", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const diagnostics: Array<Record<string, unknown>> = [];
    const adapter = new XiaohongshuBrowserAdapter({
      sessionManager: fixture.manager,
      onConnectionDiagnostic: (diagnostic: Record<string, unknown>) => diagnostics.push(diagnostic)
    } as never);
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.getAccountProfile(ctx);
    await adapter.persistConnectionSession(ctx);
    await adapter.releaseConnectionPage?.(ctx);

    expect(diagnostics.at(-1)).toMatchObject({
      phase: "LOGIN_PAGE_RELEASED",
      platformKey: "xiaohongshu",
      accountId: "account-a",
      pageClosed: true,
      sessionRetainedAfterPageClose: true
    });
    expect(diagnostics.flatMap((diagnostic) => Object.keys(diagnostic))).not.toContain("storageState");
  });

  it("only releases the login-only browser after identity persistence is complete", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"], displayName: "小红书账号 A" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await adapter.completeConnection(ctx);
    await adapter.getAccountProfile(ctx);
    const releaseConnectionSession = (adapter as unknown as { releaseConnectionSession?: (releaseContext: AccountContext) => Promise<void> }).releaseConnectionSession;
    expect(releaseConnectionSession).toBeTypeOf("function");
    if (!releaseConnectionSession) throw new Error("releaseConnectionSession is unavailable");
    await releaseConnectionSession.call(adapter, ctx);
    expect(fixture.manager.close).toHaveBeenCalledTimes(1);
  });

  it("reports the exact account-scoped Session and owner-visible Page evidence", async () => {
    const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const ctx = context("account-a");

    await adapter.connectAccount(ctx);
    await expect(adapter.getBrowserSessionEvidence(ctx)).resolves.toMatchObject({
      platformKey: "xiaohongshu",
      accountId: "account-a",
      sessionKey: "session:xiaohongshu:account-a",
      pageUrl: "https://creator.xiaohongshu.com/new/home",
      pageTitle: "小红书创作服务平台",
      pageCount: 1,
      ownerVisiblePage: true
    });
  });

  it("fails closed with a Session/Page mismatch instead of inspecting an unrelated page", async () => {
    const fixture = setupPage({ pagePresentInContext: false });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.connectAccount(context("account-a"))).rejects.toThrow(/BrowserSession\/Page mismatch/iu);
  });

  it("records a nickname when the page exposes no stable external account ID", async () => {
    const fixture = setupPage({ profileHref: null, accountName: "仅昵称" });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const profile = await adapter.getAccountProfile(context("account-a"));
    expect(profile).toMatchObject({ accountName: "仅昵称" });
    expect(profile).not.toHaveProperty("accountId");
  });

  it("fails closed when the session is on a login page", async () => {
    const fixture = setupPage({ loginPage: true });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.checkLogin(context())).resolves.toBe("expired");
  });

  it("reports LOGIN_REQUIRED when no stored account session exists", async () => {
    const fixture = setupPage();
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.getAccountProfile(context())).rejects.toMatchObject({ message: expect.stringContaining("LOGIN_REQUIRED") });
    expect(fixture.open).not.toHaveBeenCalled();
  });

  it("does not create a new context to check an account with no stored session", async () => {
    const fixture = setupPage();
    vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.checkLogin(context())).resolves.toBe("needs_user_action");
    expect(fixture.open).not.toHaveBeenCalled();
  });

  it("runs the image-post gate in order and never clicks final submit", async () => {
    const fixture = setupPage({ settings: [{ label: "公开范围", required: false, value: "公开" }] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const result = await adapter.preparePublish(context(), article);
    expect(result).toMatchObject({ prepared: true, requiresUserAction: true, titleFilled: true, bodyFilled: true, response: { imagePostEntry: "verified", imageUploaded: true, titleReadback: true, bodyReadback: true, requiredFieldsStatus: "KNOWN", publishSettingsStatus: "KNOWN", finalSubmitClickCount: 0 } });
    expect(fixture.calls.indexOf("image-post-entry-click")).toBeLessThan(fixture.calls.indexOf("image-set-input-files"));
    expect(fixture.calls.indexOf("image-set-input-files")).toBeLessThan(fixture.calls.indexOf("title-fill"));
    expect(fixture.calls.indexOf("title-fill")).toBeLessThan(fixture.calls.indexOf("body-fill"));
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("rejects a video-only entry instead of navigating to it", async () => {
    const fixture = setupPage({ entryCount: 0, videoEntryCount: 1 });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("IMAGE_POST_ENTRY_NOT_VERIFIED") });
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("fails when the image preview never proves upload completion", async () => {
    const fixture = setupPage({ imagePreviewCount: 0 });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "UPLOAD_FAILED", message: expect.stringContaining("IMAGE_UPLOAD_NOT_VERIFIED") });
    expect(fixture.submitClick).not.toHaveBeenCalled();
  });

  it("blocks an upload that remains in a visible loading state", async () => {
    const fixture = setupPage({ imageLoading: true });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "UPLOAD_FAILED", message: expect.stringContaining("IMAGE_UPLOAD_NOT_VERIFIED") });
  });

  it("stops when the real page reports an image upload failure", async () => {
    const fixture = setupPage({ imageFailed: true });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "UPLOAD_FAILED", message: expect.stringContaining("IMAGE_UPLOAD_NOT_VERIFIED") });
  });

  it("fails closed for ambiguous title candidates and strict title readback mismatch", async () => {
    const ambiguous = setupPage({ titleCount: 2 });
    const ambiguousAdapter = new XiaohongshuBrowserAdapter({ sessionManager: ambiguous.manager });
    await expect(ambiguousAdapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_TITLE_NOT_VERIFIED") });

    const mismatch = setupPage({ titleReadback: "other title" });
    const mismatchAdapter = new XiaohongshuBrowserAdapter({ sessionManager: mismatch.manager });
    await expect(mismatchAdapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_TITLE_NOT_VERIFIED") });
  });

  it("uses strict body readback and rejects mismatch without substring acceptance", async () => {
    const mismatch = setupPage({ bodyReadback: `${article.body} 额外内容` });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: mismatch.manager });
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_BODY_NOT_VERIFIED") });
  });

  it("reports missing required fields and classifies publish settings", async () => {
    const fixture = setupPage({ requiredEmpty: true, settings: [{ label: "公开范围", required: true, value: "" }, { label: "允许下载", required: false, value: "false" }] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "REQUIRED_FIELD_MISSING" });
  });

  it("stops on security verification before opening the image-post editor", async () => {
    const fixture = setupPage({ securityText: "请完成安全验证" });
    installPageEvidence(fixture, { blockingSignals: ["visible_security_modal"] });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    await expect(adapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED", message: expect.stringContaining("SECURITY_VERIFICATION_REQUIRED") });
    expect(fixture.entryClick).not.toHaveBeenCalled();
  });

  it("requires a unique enabled final-submit control and records second confirmation without clicking", async () => {
    const fixture = setupPage({ secondConfirmation: true });
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
    const result = await adapter.preparePublish(context(), article);
    expect(result.response).toMatchObject({ finalSubmitControl: { verified: true, visible: true, enabled: true, unique: true, secondConfirmation: "present" }, finalSubmitClickCount: 0 });
    expect(fixture.submitClick).not.toHaveBeenCalled();

    const ambiguous = setupPage({ submitCount: 2 });
    const ambiguousAdapter = new XiaohongshuBrowserAdapter({ sessionManager: ambiguous.manager });
    await expect(ambiguousAdapter.preparePublish(context(), article)).rejects.toMatchObject({ code: "FINAL_SUBMIT_CONTROL_NOT_FOUND", message: expect.stringContaining("FINAL_SUBMIT_CONTROL_NOT_VERIFIED") });
  });

  it("normalizes only permitted editor differences and requires equality", () => {
    expect(normalizeXiaohongshuEditorText("  A\r\nB\u200b  ")).toBe("A\nB");
    expect(normalizeXiaohongshuEditorText("A B")).not.toBe(normalizeXiaohongshuEditorText("A B extra"));
    expect(classifyXiaohongshuPublishSettings([{ label: "公开范围", required: false, value: "" }])).toBe("KNOWN");
    expect(classifyXiaohongshuPublishSettings([{ label: "", required: false, value: "公开" }])).toBe("UNKNOWN");
  });

  it("routes every account to its own session and never falls back after account A fails", async () => {
    const urls = new Map<string, string>();
    const pages = new Map<string, Page>();
    const pageFor = (accountId: string): Page => {
      let currentUrl = accountId === "account-a" ? "https://creator.xiaohongshu.com/login" : "https://creator.xiaohongshu.com/";
      const page = {
        goto: vi.fn(async (url: string) => { if (accountId !== "account-a") currentUrl = url; }),
        url: vi.fn(() => currentUrl),
        locator: vi.fn(() => locator({ innerText: vi.fn(async () => "小红书账号") }))
      } as unknown as Page;
      pages.set(accountId, page);
      return page;
    };
    const manager = {
      hasStoredSession: vi.fn((identity: { accountId: string }) => identity.accountId !== "missing-account"),
      open: vi.fn(async (identity: { accountId: string }) => {
        const page = pageFor(identity.accountId);
        urls.set(identity.accountId, page.url());
        return { page, context: { pages: () => [page] }, executionMode: "VISIBLE", headless: false, hasStoredSession: true, sessionIdHash: `session-${identity.accountId}` } as unknown as BrowserSession;
      }),
      close: vi.fn(async () => undefined),
      save: vi.fn(async () => undefined),
      clear: vi.fn(),
      closeAll: vi.fn(async () => undefined)
    } as unknown as BrowserSessionManager;
    const adapter = new XiaohongshuBrowserAdapter({ sessionManager: manager });

    await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("expired");
    await expect(adapter.checkLogin(context("account-b"))).resolves.toBe("logged_in");
    await expect(adapter.openBackend(context("missing-account"))).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });

    expect(manager.open).toHaveBeenNthCalledWith(1, { platformKey: "xiaohongshu", accountId: "account-a" }, expect.anything(), "VISIBLE");
    expect(manager.open).toHaveBeenNthCalledWith(2, { platformKey: "xiaohongshu", accountId: "account-b" }, expect.anything(), "VISIBLE");
    expect(manager.open).toHaveBeenCalledTimes(2);
    expect(urls.get("account-a")).toContain("/login");
    expect(urls.get("account-b")).toContain("creator.xiaohongshu.com");
    expect(pages.get("account-a")).not.toBe(pages.get("account-b"));
  });
});
