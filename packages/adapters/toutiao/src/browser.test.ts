import { describe, expect, it, vi } from "vitest";
import type { BrowserSession, BrowserSessionManager } from "@publisher/adapters-core";
import type { PublishArticleInput } from "@publisher/domain";
import { isToutiaoCreatorCenterPage, ToutiaoArticleBrowserAdapter } from "./browser";

const article: PublishArticleInput = {
  articleId: "article-1",
  title: "Toutiao article editor test title",
  body: "Toutiao article editor test body",
  summary: "",
  tags: [],
  coverPath: "C:/media/cover.jpg",
  images: ["C:/media/body.jpg"]
};

function setupPage(options: { titleReadback?: string; bodyReadback?: string; duplicateTitle?: boolean; missingRequired?: boolean; editorInFrame?: boolean; noisyDashboard?: boolean; editorFieldsDelayed?: boolean; coverModeSelectionRequired?: boolean; coverAddRequired?: boolean; assistantDrawerOpen?: boolean; scheduledPublishFirst?: boolean; duplicateFinalSubmit?: boolean; publishedUrl?: string; accountPageText?: string; afterSubmitPageText?: string; profileHref?: string | null; profileLabel?: string; loginPage?: boolean; articleEntryAvailable?: boolean; finalSubmitDisabled?: boolean; finalSubmitDisabledReason?: string } = {}) {
  let currentUrl = options.loginPage ? "https://mp.toutiao.com/auth/page/login?redirect_url=JTJGcHJvZmlsZV92NCUyRg==" : "https://mp.toutiao.com/";
  let titleValue = "";
  let bodyValue = "";
  let titleLookupCount = 0;
  let coverModeSelected = !options.coverModeSelectionRequired;
  let coverAddSelected = !options.coverAddRequired;
  let assistantOpen = Boolean(options.assistantDrawerOpen);
  let currentPageText = options.accountPageText ?? "";
  const title = {
    count: vi.fn(async () => options.editorFieldsDelayed && titleLookupCount++ < 4 ? 0 : options.duplicateTitle ? 2 : 1),
    first: vi.fn(function () { return title; }),
    nth: vi.fn(function () { return title; }),
    waitFor: vi.fn(async () => undefined),
    fill: vi.fn(async (value: string) => { titleValue = value; }),
    inputValue: vi.fn(async () => options.titleReadback ?? titleValue),
    innerText: vi.fn(async () => options.titleReadback ?? titleValue),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    getAttribute: vi.fn(async (name: string) => ({ placeholder: "Title", "aria-label": "Article title", name: "title", id: "title-editor" }[name] ?? null))
  };
  const body = {
    count: vi.fn(async () => 1),
    first: vi.fn(function () { return body; }),
    nth: vi.fn(function () { return body; }),
    waitFor: vi.fn(async () => undefined),
    fill: vi.fn(async (value: string) => { bodyValue = value; }),
    inputValue: vi.fn(async () => options.bodyReadback ?? bodyValue),
    innerText: vi.fn(async () => options.bodyReadback ?? bodyValue),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    getAttribute: vi.fn(async (name: string) => ({ role: "textbox", contenteditable: "true", class: "ProseMirror editor" }[name] ?? null))
  };
  const required = {
    count: vi.fn(async () => options.missingRequired ? 1 : 0),
    nth: vi.fn(function () { return required; }),
    first: vi.fn(function () { return required; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    inputValue: vi.fn(async () => options.missingRequired ? "" : "Technology"),
    innerText: vi.fn(async () => "Category"),
    getAttribute: vi.fn(async (name: string) => ({ "aria-required": "true", "aria-label": "Category" }[name] ?? null))
  };
  const fileInput = {
    count: vi.fn(async () => coverModeSelected && coverAddSelected ? 1 : 0),
    first: vi.fn(function () { return fileInput; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    setInputFiles: vi.fn(async () => undefined),
    getAttribute: vi.fn(async (name: string) => ({ accept: "image/*", "aria-label": "Cover image" }[name] ?? null))
  };
  const coverPreview = {
    count: vi.fn(async () => 1),
    first: vi.fn(function () { return coverPreview; }),
    nth: vi.fn(function () { return coverPreview; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => ""),
    getAttribute: vi.fn(async () => null)
  };
  const singleCover = {
    count: vi.fn(async () => 1),
    first: vi.fn(function () { return singleCover; }),
    nth: vi.fn(function () { return singleCover; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => { coverModeSelected = true; }),
    innerText: vi.fn(async () => "单图"),
    getAttribute: vi.fn(async () => null)
  };
  const coverAdd = {
    count: vi.fn(async () => 1),
    first: vi.fn(function () { return coverAdd; }),
    nth: vi.fn(function () { return coverAdd; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => { coverAddSelected = true; }),
    innerText: vi.fn(async () => ""),
    getAttribute: vi.fn(async (name: string) => name === "class" ? "article-cover-add" : null)
  };
  const assistantDrawer = {
    count: vi.fn(async () => assistantOpen ? 1 : 0),
    first: vi.fn(function () { return assistantDrawer; }),
    nth: vi.fn(function () { return assistantDrawer; }),
    isVisible: vi.fn(async () => assistantOpen),
    isEnabled: vi.fn(async () => assistantOpen),
    getAttribute: vi.fn(async () => null)
  };
  const drawerMask = {
    count: vi.fn(async () => assistantOpen ? 1 : 0),
    first: vi.fn(function () { return drawerMask; }),
    nth: vi.fn(function () { return drawerMask; }),
    isVisible: vi.fn(async () => assistantOpen),
    isEnabled: vi.fn(async () => assistantOpen),
    click: vi.fn(async () => { assistantOpen = false; }),
    getAttribute: vi.fn(async () => null)
  };
  const submit = {
    count: vi.fn(async () => 1),
    nth: vi.fn(() => submit),
    first: vi.fn(function () { return submit; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => !options.finalSubmitDisabled),
    innerText: vi.fn(async () => "Publish article"),
    getAttribute: vi.fn(async (name: string) => name === "aria-disabled" ? (options.finalSubmitDisabled ? "true" : null) : name === "title" ? options.finalSubmitDisabledReason ?? null : null),
    click: vi.fn(async () => { if (options.publishedUrl) currentUrl = options.publishedUrl; if (options.afterSubmitPageText) currentPageText = options.afterSubmitPageText; })
  };
  const scheduledPublish = {
    count: vi.fn(async () => 1),
    first: vi.fn(function () { return scheduledPublish; }),
    nth: vi.fn(function () { return scheduledPublish; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => "定时发布"),
    getAttribute: vi.fn(async () => null),
    click: vi.fn(async () => undefined)
  };
  const submitCandidates = {
    count: vi.fn(async () => options.duplicateFinalSubmit ? 3 : 2),
    first: vi.fn(function () { return scheduledPublish; }),
    nth: vi.fn((index: number) => index === 0 ? scheduledPublish : submit)
  };
  const entry = {
    count: vi.fn(async () => currentUrl === "https://mp.toutiao.com/" && options.articleEntryAvailable !== false ? 1 : 0),
    first: vi.fn(function () { return entry; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => "Write article"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? "/profile_v4/graphic/publish" : null),
    click: vi.fn(async () => { currentUrl = "https://mp.toutiao.com/profile_v4/graphic/publish"; })
  };
  const entryNoise = {
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => "Published article history"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? "/profile_v4/manage/content/all" : null)
  };
  const entryCandidates = {
    count: vi.fn(async () => currentUrl === "https://mp.toutiao.com/" ? options.noisyDashboard ? 2 : 1 : 0),
    first: vi.fn(function () { return entry; }),
    nth: vi.fn((index: number) => index === 0 ? entry : entryNoise)
  };
  const pageRoot = { innerText: vi.fn(async () => currentPageText || (options.publishedUrl && currentUrl === options.publishedUrl ? `${article.title} ${article.body} Toutiao creator` : "Toutiao creator center")) };
  const empty = {
    count: vi.fn(async () => 0),
    first: vi.fn(function () { return empty; }),
    nth: vi.fn(function () { return empty; }),
    isVisible: vi.fn(async () => false),
    isEnabled: vi.fn(async () => false),
    innerText: vi.fn(async () => ""),
    getAttribute: vi.fn(async () => null)
  };
  const publishedAnchor = {
    count: vi.fn(async () => 0),
    first: vi.fn(() => publishedAnchor),
    nth: vi.fn(() => publishedAnchor),
    isVisible: vi.fn(async () => false),
    isEnabled: vi.fn(async () => false),
    innerText: vi.fn(async () => ""),
    getAttribute: vi.fn(async () => null)
  };
  const accountProfileHref = options.profileHref === undefined ? "https://www.toutiao.com/c/user/123456789/" : options.profileHref;
  const profileAnchor = {
    count: vi.fn(async () => accountProfileHref ? 1 : 0),
    first: vi.fn(function () { return profileAnchor; }),
    nth: vi.fn(function () { return profileAnchor; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => options.profileLabel ?? "Toutiao test account"),
    getAttribute: vi.fn(async (name: string) => name === "href" ? accountProfileHref : null)
  };
  const frame = {
    url: vi.fn(() => currentUrl),
    locator: vi.fn((selector: string) => {
      if (selector === ".ai-assistant-drawer") return assistantDrawer;
      if (selector === ".byte-drawer-mask") return drawerMask;
      if (selector === ".article-cover-add") return coverAdd;
      if (selector.includes(".article-cover-images") || selector.includes(".article-cover-img-wrap") || selector.includes(".article-cover-preview")) return coverPreview;
      if (selector === ".article-cover-radio-group .byte-radio" || selector === 'text="单图"') return singleCover;
      if (selector.includes("button") || selector.includes('[role="button"]')) return currentUrl === "https://mp.toutiao.com/" ? entry : (options.scheduledPublishFirst || options.duplicateFinalSubmit) ? submitCandidates : submit;
      if (selector.includes("input[type=\"file\"]")) return fileInput;
      if (selector.includes("[required]") || selector.includes("aria-required")) return required;
      if (selector.includes("contenteditable") || selector.includes("ProseMirror") || selector.includes("body")) return body;
      return currentUrl === "https://mp.toutiao.com/" ? entry : title;
    })
  };
  const page = {
    goto: vi.fn(async (url: string) => { currentUrl = options.loginPage ? "https://mp.toutiao.com/auth/page/login?redirect_url=JTJGcHJvZmlsZV92NCUyRg==" : url; }),
    url: vi.fn(() => currentUrl),
    frames: vi.fn(() => options.editorInFrame ? [frame] : []),
    evaluate: vi.fn(async () => ({ bodyPresent: true, bodyTextLength: 10 })),
    locator: vi.fn((selector: string) => {
      if (selector === "body") return pageRoot;
      if (selector.includes('/c/user/')) return profileAnchor;
      if (selector === "a[href]") return options.publishedUrl && currentUrl === options.publishedUrl ? publishedAnchor : profileAnchor;
      if (selector === ".ai-assistant-drawer") return assistantDrawer;
      if (selector === ".byte-drawer-mask") return drawerMask;
      if (selector === ".article-cover-add") return coverAdd;
      if (selector.includes(".article-cover-images") || selector.includes(".article-cover-img-wrap") || selector.includes(".article-cover-preview")) return coverPreview;
      if (options.editorInFrame) return empty;
      if (selector === ".article-cover-radio-group .byte-radio" || selector === 'text="单图"') return singleCover;
      if (selector.includes("input[type=\"file\"]")) return fileInput;
      if (selector.includes("button") || selector.includes('[role="button"]')) return currentUrl === "https://mp.toutiao.com/" ? options.noisyDashboard ? entryCandidates : entry : (options.scheduledPublishFirst || options.duplicateFinalSubmit) ? submitCandidates : submit;
      if (selector.includes("[required]") || selector.includes("aria-required")) return required;
      if (selector.includes("contenteditable") || selector.includes("ProseMirror") || selector.includes("body")) return body;
      return currentUrl === "https://mp.toutiao.com/" ? entry : title;
    })
  };
  const session = { page, executionMode: "VISIBLE", headless: false, sessionIdHash: "toutiao-browser-session", context: { pages: () => [page] } } as unknown as BrowserSession;
  const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), save: vi.fn(async () => undefined), close: vi.fn(async () => undefined), clear: vi.fn() } as unknown as BrowserSessionManager;
  return { page, frame, title, body, required, fileInput, coverPreview, singleCover, coverAdd, assistantDrawer, drawerMask, submit, scheduledPublish, entry, manager };
}

describe("Toutiao article browser adapter", () => {
  it("keeps the official video adapter article=false while exposing a separate toutiao article browser adapter", () => {
    const fixture = setupPage();
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    expect(adapter.platformKey).toBe("toutiao");
    expect(adapter.manifest).toMatchObject({ transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false });
  });

  it("connects Toutiao through a visible manual-login session and persists it after completion", async () => {
    const fixture = setupPage();
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = {
      accountId: "account-1",
      accountName: "Toutiao test account",
      platformKey: "toutiao",
      settings: {
        browserExecutionMode: "VISIBLE",
        userActionId: "11111111-1111-4111-8111-111111111111",
        triggerSource: "CONNECT_ACCOUNT"
      }
    };

    await expect(adapter.connectAccount(context)).resolves.toMatchObject({ opened: true, requiresUserAction: true, authStrategy: "ManualSession" });
    expect(fixture.manager.open).toHaveBeenCalledWith(
      { platformKey: "toutiao", accountId: "account-1" },
      { userActionId: context.settings.userActionId, triggerSource: context.settings.triggerSource },
      "VISIBLE"
    );
    expect(fixture.page.goto).toHaveBeenCalledWith("https://mp.toutiao.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });

    await expect(adapter.completeConnection(context)).resolves.toBe("logged_in");
    expect(fixture.manager.save).toHaveBeenCalledTimes(1);
    expect(fixture.manager.close).toHaveBeenCalledTimes(1);
    expect(adapter.isConnectionPending(context)).toBe(false);
  });

  it("passes login, discovers the article entry, fills title/body, checks required fields and uploads the cover without submit", async () => {
    const fixture = setupPage();
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.checkLogin(context)).resolves.toBe("logged_in");
    const result = await adapter.preparePublish(context, article);

    expect(result).toMatchObject({ prepared: true, titleFilled: true, bodyFilled: true, response: { requiredFieldsVerified: true, imageRequirement: "cover_uploaded", finalSubmit: "user_action_required" } });
    expect(fixture.entry.click).toHaveBeenCalledTimes(1);
    expect(fixture.title.fill).toHaveBeenCalledWith(article.title);
    expect(fixture.body.fill).toHaveBeenCalledWith(article.body);
    expect(fixture.fileInput.setInputFiles).toHaveBeenCalledWith(article.coverPath);
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("returns ACCOUNT_MUTED from a read-only account preflight without opening the article editor", async () => {
    const fixture = setupPage({
      accountPageText: "创作中心 账号已被禁言 无法发布文章",
      profileHref: "https://www.toutiao.com/c/user/778899/",
      profileLabel: "new account"
    });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.inspectAccountPreflight(context)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "ACCOUNT_MUTED",
      identity: { externalAccountId: "778899", displayName: "new account" }
    });
    expect(fixture.entry.click).not.toHaveBeenCalled();
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("treats an account-completion prompt as a weak signal when the article entry remains usable", async () => {
    const fixture = setupPage({
      accountPageText: "请完善账号信息，解锁发布文章、视频等权益功能",
      profileHref: "//www.toutiao.com/c/user/2732723872994553/",
      profileLabel: "在沙滩作画的画家"
    });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.inspectAccountPreflight(context)).resolves.toMatchObject({
      allowed: true,
      creatorCenterAccessible: true,
      articlePublishPermission: true,
      reasonCode: null,
      warnings: ["ACCOUNT_COMPLETION_PROMPT"],
      identity: { externalAccountId: "2732723872994553", displayName: "在沙滩作画的画家" },
      identityCandidates: [{ href: "//www.toutiao.com/c/user/2732723872994553/", externalAccountId: "2732723872994553" }]
    });
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("fails when explicit no-permission evidence also prevents entering the article editor", async () => {
    const fixture = setupPage({
      accountPageText: "当前账号无发文权限，无法发布文章",
      articleEntryAvailable: false,
      profileHref: "//www.toutiao.com/c/user/2732723872994553/",
      profileLabel: "在沙滩作画的画家"
    });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.inspectAccountPreflight(context)).resolves.toMatchObject({
      allowed: false,
      articlePublishPermission: false,
      reasonCode: "PUBLISH_PERMISSION_DENIED"
    });
    expect(fixture.entry.click).not.toHaveBeenCalled();
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("fails when the final submit control is explicitly disabled for account permission", async () => {
    const fixture = setupPage({ finalSubmitDisabled: true, finalSubmitDisabledReason: "账号无发文权限" });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.preparePublish(context, article)).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: expect.stringContaining("PUBLISH_PERMISSION_DENIED") });
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("does not treat a Toutiao login or security page as the creator center", async () => {
    expect(isToutiaoCreatorCenterPage("https://mp.toutiao.com/auth/page/login?redirect_url=profile", "登录 验证码登录 获取验证码 滑动查看更多")).toBe(false);
    expect(isToutiaoCreatorCenterPage("https://mp.toutiao.com/profile_v4/index", "头条号 文章 创作中心")).toBe(true);
  });

  it("classifies a post-click account mute as a permission error without retrying", async () => {
    const fixture = setupPage({ afterSubmitPageText: "创作中心 账号已被禁言 无法发布文章" });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };
    const attempt = { jobId: "job-muted-after-click", submissionIntentId: "intent-muted-after-click", attempt: 1, markSubmissionSideEffect: vi.fn() };

    await adapter.preparePublish(context, article);
    await expect(adapter.finalSubmit(context, article, attempt)).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: expect.stringContaining("ACCOUNT_MUTED") });
    expect(attempt.markSubmissionSideEffect).toHaveBeenCalledTimes(1);
    expect(fixture.submit.click).toHaveBeenCalledTimes(1);
  });

  it("discovers the Toutiao article editor entry and fields inside the authenticated creator frame", async () => {
    const fixture = setupPage({ editorInFrame: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.preparePublish(context, article)).resolves.toMatchObject({ prepared: true, response: { articleEntry: "verified", titleReadback: true, bodyReadback: true } });
    expect(fixture.entry.click).toHaveBeenCalledTimes(1);
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("uses the exact article-editor href when dashboard history also contains publish wording", async () => {
    const fixture = setupPage({ noisyDashboard: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.preparePublish(context, article)).resolves.toMatchObject({ prepared: true, response: { articleEntry: "verified", finalSubmitClickCount: 0 } });
    expect(fixture.entry.click).toHaveBeenCalledTimes(1);
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("waits for editor fields that hydrate after the article route is ready", async () => {
    const fixture = setupPage({ editorFieldsDelayed: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.preparePublish(context, article)).resolves.toMatchObject({ prepared: true, response: { titleReadback: true, bodyReadback: true, finalSubmitClickCount: 0 } });
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("selects the verified single-cover mode before uploading when Toutiao defers the file input", async () => {
    const fixture = setupPage({ coverModeSelectionRequired: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.preparePublish(context, article)).resolves.toMatchObject({ prepared: true, response: { imageRequirement: "cover_uploaded", coverInputVerified: true, finalSubmitClickCount: 0 } });
    expect(fixture.singleCover.click).toHaveBeenCalledTimes(1);
    expect(fixture.fileInput.setInputFiles).toHaveBeenCalledWith(article.coverPath);
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("uses the verified cover-add control when the file input is created only after opening it", async () => {
    const fixture = setupPage({ coverModeSelectionRequired: true, coverAddRequired: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.preparePublish(context, article)).resolves.toMatchObject({ prepared: true, response: { imageRequirement: "cover_uploaded", coverInputVerified: true, coverUploadMethod: "file_input", finalSubmitClickCount: 0 } });
    expect(fixture.singleCover.click).toHaveBeenCalledTimes(1);
    expect(fixture.coverAdd.click).toHaveBeenCalledTimes(1);
    expect(fixture.fileInput.setInputFiles).toHaveBeenCalledWith(article.coverPath);
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("closes a uniquely verified assistant drawer before selecting the required cover mode", async () => {
    const fixture = setupPage({ coverModeSelectionRequired: true, assistantDrawerOpen: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.preparePublish(context, article)).resolves.toMatchObject({ prepared: true, response: { imageRequirement: "cover_uploaded", coverInputVerified: true, finalSubmitClickCount: 0 } });
    expect(fixture.drawerMask.click).toHaveBeenCalledTimes(1);
    expect(fixture.singleCover.click).toHaveBeenCalledTimes(1);
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("does not mistake the scheduled-publish control for the final submit control", async () => {
    const fixture = setupPage({ scheduledPublishFirst: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    const result = await adapter.preparePublish(context, article);
    expect(result.response).toMatchObject({ finalSubmitControl: { label: "Publish article", enabled: true, clickRequired: false }, finalSubmitClickCount: 0 });
    expect(fixture.scheduledPublish.click).not.toHaveBeenCalled();
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("fails closed when final submit discovery is not unique", async () => {
    const fixture = setupPage({ duplicateFinalSubmit: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };

    await expect(adapter.preparePublish(context, article)).rejects.toMatchObject({ code: "FINAL_SUBMIT_CONTROL_NOT_FOUND" });
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("fails closed on ambiguous title candidates and specific readback failures", async () => {
    const ambiguous = setupPage({ duplicateTitle: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: ambiguous.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };
    await expect(adapter.preparePublish(context, article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_EDITOR_AMBIGUOUS") });

    const mismatch = setupPage({ titleReadback: "Other title" });
    const mismatchAdapter = new ToutiaoArticleBrowserAdapter({ sessionManager: mismatch.manager });
    await expect(mismatchAdapter.preparePublish(context, article)).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_TITLE_NOT_VERIFIED") });
  });

  it("reports missing required fields and only inspects the final-submit control", async () => {
    const fixture = setupPage({ missingRequired: true });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };
    await expect(adapter.preparePublish(context, article)).rejects.toMatchObject({ code: "REQUIRED_FIELD_MISSING" });

    const ready = setupPage();
    const readyAdapter = new ToutiaoArticleBrowserAdapter({ sessionManager: ready.manager });
    await readyAdapter.preparePublish(context, article);
    expect(ready.submit.click).not.toHaveBeenCalled();
    const result = await readyAdapter.prepareFinalSubmit(context, article);
    expect(result.response).toMatchObject({ finalSubmitControl: { verified: true, enabled: true }, finalSubmitClickCount: 0 });
    expect(ready.submit.click).not.toHaveBeenCalled();
  });

  it("performs the Toutiao final submit once and rejects a second invocation", async () => {
    const fixture = setupPage({ publishedUrl: "https://www.toutiao.com/article/1234567890/" });
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };
    const attempt = { jobId: "job-1", submissionIntentId: "intent-1", attempt: 1, markSubmissionSideEffect: vi.fn() };

    await adapter.preparePublish(context, article);
    const result = await adapter.finalSubmit(context, article, attempt);

    expect(attempt.markSubmissionSideEffect).toHaveBeenCalledTimes(1);
    expect(fixture.submit.click).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, externalId: "1234567890", publishedUrl: "https://www.toutiao.com/article/1234567890/", response: { finalSubmitCount: 1 } });
    await expect(adapter.finalSubmit(context, article, attempt)).rejects.toMatchObject({ code: "FINAL_SUBMIT_ALREADY_USED" });
    expect(fixture.submit.click).toHaveBeenCalledTimes(1);
  });

  it("marks a clicked but unverifiable Toutiao submission as uncertain without retrying", async () => {
    const fixture = setupPage();
    const adapter = new ToutiaoArticleBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "Toutiao test account", platformKey: "toutiao", settings: { browserExecutionMode: "VISIBLE" } };
    const attempt = { jobId: "job-unknown", submissionIntentId: "intent-unknown", attempt: 1, markSubmissionSideEffect: vi.fn() };

    await adapter.preparePublish(context, article);
    await expect(adapter.finalSubmit(context, article, attempt)).rejects.toMatchObject({ code: "SUBMISSION_UNCERTAIN" });

    expect(attempt.markSubmissionSideEffect).toHaveBeenCalledTimes(1);
    expect(fixture.submit.click).toHaveBeenCalledTimes(1);
  });
});
