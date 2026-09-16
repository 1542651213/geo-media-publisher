import { describe, expect, it, vi } from "vitest";
import type { BrowserSession, BrowserSessionManager } from "@publisher/adapters-core";
import { BaijiahaoBrowserAdapter, normalizeBaijiahaoEditorText } from "./browser";

const article = {
  articleId: "article-1",
  title: "GMP Baijiahao self-test 2026-08-25 15:00:00",
  body: "GMP Baijiahao short self-test body.",
  summary: "",
  tags: []
};

function setupPage(options: {
  securityText?: string;
  publicUrl?: string;
  editorInitiallyClosed?: boolean;
  articleEntryLabel?: string;
  duplicateTitleCandidates?: boolean;
  duplicateBodyCandidates?: boolean;
  titleReadback?: string;
  bodyReadback?: string;
} = {}) {
  let currentUrl = "https://baijiahao.baidu.com/";
  let editorOpened = !options.editorInitiallyClosed;
  let titleValue = "";
  let bodyValue = "";
  let publicBodyText = options.securityText ?? "百家号账号 GMP Baijiahao short self-test body.";
  const title = {
    count: vi.fn(async () => editorOpened ? (options.duplicateTitleCandidates ? 2 : 1) : 0),
    first: vi.fn(function () { return title; }),
    nth: vi.fn(function () { return title; }),
    waitFor: vi.fn(async () => undefined),
    fill: vi.fn(async (value: string) => { titleValue = value; }),
    inputValue: vi.fn(async () => options.titleReadback ?? titleValue),
    innerText: vi.fn(async () => options.titleReadback ?? titleValue),
    textContent: vi.fn(async () => options.titleReadback ?? titleValue),
    getAttribute: vi.fn(async (name: string) => ({ placeholder: "标题", role: "textbox", contenteditable: null, name: "title", class: "title-field", id: "title-editor" }[name] ?? null)),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined)
  };
  const body = {
    count: vi.fn(async () => editorOpened ? (options.duplicateBodyCandidates ? 2 : 1) : 0),
    first: vi.fn(function () { return body; }),
    nth: vi.fn(function () { return body; }),
    waitFor: vi.fn(async () => undefined),
    fill: vi.fn(async (value: string) => { bodyValue = value; publicBodyText = `百家号账号 ${value}`; }),
    inputValue: vi.fn(async () => options.bodyReadback ?? bodyValue),
    innerText: vi.fn(async () => options.bodyReadback ?? bodyValue),
    textContent: vi.fn(async () => options.bodyReadback ?? bodyValue),
    getAttribute: vi.fn(async (name: string) => ({ placeholder: null, role: "textbox", contenteditable: "true", name: null, class: "ProseMirror body-editor", id: "body-editor" }[name] ?? null)),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined)
  };
  const imageInput = {
    count: vi.fn(async () => editorOpened ? 1 : 0),
    first: vi.fn(function () { return imageInput; }),
    waitFor: vi.fn(async () => undefined),
    setInputFiles: vi.fn(async () => undefined)
  };
  const submit = {
    count: vi.fn(async () => editorOpened ? 1 : 0),
    first: vi.fn(function () { return submit; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => "发布"),
    getAttribute: vi.fn(async () => null),
    click: vi.fn(async () => { currentUrl = options.publicUrl ?? "https://baijiahao.baidu.com/s?id=123456789"; })
  };
  const editorEntry = {
    count: vi.fn(async () => editorOpened ? 0 : 1),
    first: vi.fn(function () { return editorEntry; }),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    innerText: vi.fn(async () => options.articleEntryLabel ?? "图文"),
    getAttribute: vi.fn(async () => null),
    click: vi.fn(async () => { editorOpened = true; currentUrl = "https://baijiahao.baidu.com/content"; })
  };
  const pageRoot = { innerText: vi.fn(async () => publicBodyText) };
  const page = {
    goto: vi.fn(async (url: string) => { currentUrl = url; }),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => "GMP Baijiahao self-test 2026-08-25 15:00:00"),
    waitForURL: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    frames: vi.fn(() => []),
    locator: vi.fn((selector: string) => {
      if (selector === "body") return pageRoot;
      if (selector.includes("input[type=\"file\"]")) return imageInput;
      if (selector === "input" || selector.includes("标题") || selector.includes("title")) return title;
      if (selector === "textarea" || selector.includes("contenteditable") || selector.includes("正文") || selector.includes("article") || selector.includes("role=\"textbox\"")) return body;
      return editorOpened ? submit : editorEntry;
    })
  };
  const session = { page, executionMode: "VISIBLE", headless: false, sessionIdHash: "baijiahao-session-hash", context: { pages: () => [page] } } as unknown as BrowserSession;
  const manager = {
    hasStoredSession: vi.fn(() => true),
    open: vi.fn(async () => session),
    close: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined)
  } as unknown as BrowserSessionManager;
  return { page, title, body, imageInput, submit, manager, setBodyText: (value: string) => { publicBodyText = value; } };
}

describe("Baijiahao browser article adapter", () => {
  it("normalizes only editor formatting noise before exact semantic equality", () => {
    const expected = "第一段\n第二段";
    const actual = " 第一段\r\n\u200b第二段\uFEFF ";

    expect(normalizeBaijiahaoEditorText(actual)).toBe(normalizeBaijiahaoEditorText(expected));
    expect(normalizeBaijiahaoEditorText("第一段\n第二段额外内容")).not.toBe(normalizeBaijiahaoEditorText(expected));
  });

  it("declares a platform-specific final-submit and verification contract", () => {
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: setupPage().manager });
    expect(adapter.manifest).toMatchObject({ platformKey: "baijiahao", integrationMode: "BrowserAutomation", supportsArticle: true });
    expect(adapter.finalSubmit).toBeTypeOf("function");
    expect(adapter.collectPublishResult).toBeTypeOf("function");
    expect(adapter.verifyPublished).toBeTypeOf("function");
  });

  it("fills the visible article editor and uploads at most one test image", async () => {
    const fixture = setupPage();
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });
    const result = await adapter.preparePublish(
      { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } },
      { ...article, images: ["C:/media/test.jpg", "C:/media/ignored.jpg"] }
    );

    expect(result).toMatchObject({ prepared: true, titleFilled: true, bodyFilled: true, sessionIdHash: "baijiahao-session-hash", response: { browserExecutionMode: "VISIBLE", headless: false, events: ["EDITOR_OPEN_PASSED", "TITLE_FILLED", "BODY_FILLED", "IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_PASSED"] } });
    expect(fixture.title.fill).toHaveBeenCalledWith(article.title);
    expect(fixture.body.fill).toHaveBeenCalledWith(article.body);
    expect(fixture.imageInput.setInputFiles).toHaveBeenCalledTimes(1);
    expect(fixture.imageInput.setInputFiles).toHaveBeenCalledWith("C:/media/test.jpg");
  });

  it("opens the visible article entry before filling when the backend starts on a dashboard", async () => {
    const fixture = setupPage({ editorInitiallyClosed: true });
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });
    const result = await adapter.preparePublish(
      { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } },
      article
    );

    expect(fixture.page.locator).toHaveBeenCalled();
    expect(result).toMatchObject({ prepared: true, response: { pageUrl: "https://baijiahao.baidu.com/content", entryLabel: "图文" } });
  });

  it("recognizes a semantically labelled 图文 entry without clicking a final-submit control", async () => {
    const fixture = setupPage({ editorInitiallyClosed: true, articleEntryLabel: "发布图文" });
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });

    const result = await adapter.preparePublish(
      { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } },
      article
    );

    expect(result).toMatchObject({ prepared: true, response: { entryLabel: "发布图文" } });
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("rejects multiple equally plausible title candidates instead of choosing the first", async () => {
    const fixture = setupPage({ duplicateTitleCandidates: true });
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.preparePublish(
      { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } },
      article
    )).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_EDITOR_AMBIGUOUS") });
  });

  it("reports a title-specific readback failure", async () => {
    const fixture = setupPage({ titleReadback: "另一个标题" });
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.preparePublish(
      { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } },
      article
    )).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_TITLE_NOT_VERIFIED") });
  });

  it("reports a body-specific readback failure", async () => {
    const fixture = setupPage({ bodyReadback: "正文被前端改写" });
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });

    await expect(adapter.preparePublish(
      { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } },
      article
    )).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_BODY_NOT_VERIFIED") });
  });

  it("fails closed on a visible security challenge without clicking publish", async () => {
    const fixture = setupPage();
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } };
    await adapter.preparePublish(context, article);
    fixture.setBodyText("请完成安全验证");

    await expect(adapter.finalSubmit(context, article, { jobId: "job-1", submissionIntentId: "intent-1", attempt: 1 })).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("only inspects the final-submit control during preflight and never clicks it", async () => {
    const fixture = setupPage();
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } };
    await adapter.preparePublish(context, article);

    const result = await adapter.prepareFinalSubmit(context, article);

    expect(result.response).toMatchObject({ finalSubmit: "platform_specific_once", finalSubmitControl: { verified: true, enabled: true } });
    expect(fixture.submit.click).not.toHaveBeenCalled();
  });

  it("marks the side effect immediately before one final click and returns the external result", async () => {
    const fixture = setupPage();
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } };
    await adapter.preparePublish(context, article);
    const markSideEffect = vi.fn();

    const result = await adapter.finalSubmit(context, article, { jobId: "job-1", submissionIntentId: "intent-1", attempt: 1, markSubmissionSideEffect: markSideEffect });

    expect(markSideEffect).toHaveBeenCalledTimes(1);
    expect(fixture.submit.click).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, externalId: "123456789", publishedUrl: "https://baijiahao.baidu.com/s?id=123456789" });
  });

  it("verifies the public result only when account, title, and body evidence match", async () => {
    const fixture = setupPage();
    const adapter = new BaijiahaoBrowserAdapter({ sessionManager: fixture.manager });
    const context = { accountId: "account-1", accountName: "百家号账号", platformKey: "baijiahao", settings: { browserExecutionMode: "VISIBLE" } };
    await adapter.preparePublish(context, article);
    const result = await adapter.verifyPublished(context, article, { externalId: "123456789", publishedUrl: "https://baijiahao.baidu.com/s?id=123456789" });

    expect(result).toMatchObject({ status: "published", externalId: "123456789", publishedUrl: "https://baijiahao.baidu.com/s?id=123456789", response: { accountMatch: true, titleMatch: true, bodyMatch: true, urlReachable: true } });
  });
});
