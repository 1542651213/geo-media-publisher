import { describe, expect, it, vi } from "vitest";
import type { BrowserSessionManager } from "@publisher/adapters-core";
import { ZhihuBrowserAdapter } from "./browser";

describe("Zhihu browser article preparation", () => {
  it("rejects ambiguous title candidates instead of choosing the first editor-like node", async () => {
    const title = {
      count: vi.fn(async () => 2),
      first: vi.fn(function () { return title; }),
      nth: vi.fn(function () { return title; }),
      waitFor: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      inputValue: vi.fn(async () => "标题"),
      innerText: vi.fn(async () => "标题"),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      getAttribute: vi.fn(async (name: string) => ({ placeholder: "标题", role: "textbox", name: "title", id: "title-editor" }[name] ?? null))
    };
    const body = {
      count: vi.fn(async () => 1),
      first: vi.fn(function () { return body; }),
      nth: vi.fn(function () { return body; }),
      waitFor: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      innerText: vi.fn(async () => "正文"),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      getAttribute: vi.fn(async (name: string) => ({ contenteditable: "true", role: "textbox", class: "ProseMirror" }[name] ?? null))
    };
    const pageRoot = { innerText: vi.fn(async () => "") };
    const page = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "https://zhuanlan.zhihu.com/write"),
      frames: vi.fn(() => []),
      locator: vi.fn((selector: string) => selector.includes("contenteditable") ? body : selector === "body" ? pageRoot : title)
    };
    const session = { sessionIdHash: "browser-session-hash", executionMode: "VISIBLE", headless: false, context: { pages: () => [page] } };
    const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), close: vi.fn(async () => undefined), clear: vi.fn() } as unknown as BrowserSessionManager;
    const adapter = new ZhihuBrowserAdapter({ sessionManager: manager });

    await expect(adapter.preparePublish(
      { accountId: "account-1", accountName: "知乎账号", platformKey: "zhihu", settings: {} },
      { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] }
    )).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_EDITOR_AMBIGUOUS") });
  });

  it("reports title and body readback failures separately", async () => {
    const title = { count: vi.fn(async () => 1), first: vi.fn(function () { return title; }), waitFor: vi.fn(async () => undefined), fill: vi.fn(async () => undefined), inputValue: vi.fn(async () => "另一个标题"), isVisible: vi.fn(async () => true), isEnabled: vi.fn(async () => true), getAttribute: vi.fn(async (name: string) => ({ placeholder: "标题", name: "title" }[name] ?? null)) };
    const body = { count: vi.fn(async () => 1), first: vi.fn(function () { return body; }), waitFor: vi.fn(async () => undefined), fill: vi.fn(async () => undefined), innerText: vi.fn(async () => "正文"), isVisible: vi.fn(async () => true), isEnabled: vi.fn(async () => true), getAttribute: vi.fn(async (name: string) => ({ contenteditable: "true", role: "textbox" }[name] ?? null)) };
    const page = { goto: vi.fn(async () => undefined), url: vi.fn(() => "https://zhuanlan.zhihu.com/write"), frames: vi.fn(() => []), locator: vi.fn((selector: string) => selector === "body" ? { innerText: vi.fn(async () => "") } : selector.includes("contenteditable") ? body : title) };
    const session = { sessionIdHash: "browser-session-hash", executionMode: "VISIBLE", headless: false, context: { pages: () => [page] } };
    const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), close: vi.fn(async () => undefined), clear: vi.fn() } as unknown as BrowserSessionManager;
    const adapter = new ZhihuBrowserAdapter({ sessionManager: manager });

    await expect(adapter.preparePublish(
      { accountId: "account-1", accountName: "知乎账号", platformKey: "zhihu", settings: {} },
      { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] }
    )).rejects.toMatchObject({ code: "CONTENT_REJECTED", message: expect.stringContaining("CONTENT_TITLE_NOT_VERIFIED") });
  });

  it("fills and verifies the real title/body inputs, then stops before submit", async () => {
    const title = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return title; }), fill: vi.fn(async () => undefined), inputValue: vi.fn(async () => "标题") };
    const body = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return body; }), fill: vi.fn(async () => undefined), innerText: vi.fn(async () => "正文"), focus: vi.fn(async () => undefined), press: vi.fn(async () => undefined) };
    const pageRoot = { innerText: vi.fn(async () => "") };
    const page = { goto: vi.fn(async () => undefined), url: vi.fn(() => "https://zhuanlan.zhihu.com/write"), locator: vi.fn((selector: string) => selector === "body" ? pageRoot : selector.includes("contenteditable") ? body : title) };
    const session = { sessionIdHash: "browser-session-hash", executionMode: "BACKGROUND", headless: true, context: { pages: () => [page] } };
    const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), close: vi.fn(async () => undefined), clear: vi.fn() } as unknown as BrowserSessionManager;
    const adapter = new ZhihuBrowserAdapter({ sessionManager: manager });
    const result = await adapter.preparePublish({ accountId: "account-1", accountName: "知乎账号", platformKey: "zhihu", settings: {} }, { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] });
    expect(result).toMatchObject({ prepared: true, requiresUserAction: true, titleFilled: true, bodyFilled: true, sessionIdHash: "browser-session-hash", response: { browserExecutionMode: "BACKGROUND", headless: true, events: ["EDITOR_OPEN_PASSED", "TITLE_FILLED", "BODY_FILLED"], finalSubmit: "user_action_required" } });
    expect(title.fill).toHaveBeenCalledWith("标题");
    expect(body.fill).toHaveBeenCalledWith("正文");
    expect(title.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 10_000 });
    expect(body.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 10_000 });
    expect(page.locator).toHaveBeenCalledWith('.DraftEditor-root [contenteditable="true"], .public-DraftEditor-content[contenteditable="true"], [role="textbox"][contenteditable="true"]');
    expect(page.goto).toHaveBeenCalledWith("https://zhuanlan.zhihu.com/write", expect.anything());
  });

  it("uploads only the first article image and requires new loaded editor DOM evidence", async () => {
    const title = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return title; }), fill: vi.fn(async () => undefined), inputValue: vi.fn(async () => "标题") };
    const body = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return body; }), fill: vi.fn(async () => undefined), innerText: vi.fn(async () => "正文"), focus: vi.fn(async () => undefined), press: vi.fn(async () => undefined) };
    const pageRoot = { innerText: vi.fn(async () => "") };
    const editorImages = { count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1), evaluateAll: vi.fn(async () => []) };
    const uploadInput = { first: vi.fn(function () { return uploadInput; }), last: vi.fn(function () { return uploadInput; }), count: vi.fn(async () => 1), waitFor: vi.fn(async () => undefined), setInputFiles: vi.fn(async () => undefined) };
    const page = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "https://zhuanlan.zhihu.com/write"),
      waitForFunction: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn((selector: string) => {
        if (selector === "body") return pageRoot;
        if (selector.includes('input[type="file"]')) return uploadInput;
        if (selector.includes(".DraftEditor-root img")) return editorImages;
        if (selector.includes("contenteditable")) return body;
        return title;
      })
    };
    const session = { sessionIdHash: "browser-session-hash", executionMode: "BACKGROUND", headless: true, context: { pages: () => [page] } };
    const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), close: vi.fn(async () => undefined), clear: vi.fn() } as unknown as BrowserSessionManager;
    const adapter = new ZhihuBrowserAdapter({ sessionManager: manager });

    const result = await adapter.preparePublish(
      { accountId: "account-1", accountName: "知乎账号", platformKey: "zhihu", settings: {} },
      { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [], images: ["C:/media/first.jpg", "C:/media/ignored.jpg"] }
    );

    expect(body.focus).toHaveBeenCalledTimes(1);
    expect(body.press).toHaveBeenCalledWith("Control+End");
    expect(uploadInput.setInputFiles).toHaveBeenCalledTimes(1);
    expect(uploadInput.setInputFiles).toHaveBeenCalledWith("C:/media/first.jpg");
    expect(page.locator).toHaveBeenCalledWith('.InputLike.PostEditor.EditorSnapshotWrapper input[type="file"][accept*="image/webp"][accept*="image/jpeg"][accept*="image/png"]');
    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ baseline: 0 }), { timeout: 60_000 });
    expect(result.response).toMatchObject({
      events: ["EDITOR_OPEN_PASSED", "TITLE_FILLED", "BODY_FILLED", "IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_PASSED"],
      imageUploaded: true,
      imageUploadEvidence: "editor_image_count_increased_with_new_loaded_https_image_and_no_upload_progress",
      imageCountBefore: 0,
      imageCountAfter: 1,
      finalSubmit: "user_action_required"
    });
  });

  it("throws UPLOAD_FAILED and never returns imageUploaded when editor DOM evidence is missing", async () => {
    const title = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return title; }), fill: vi.fn(async () => undefined), inputValue: vi.fn(async () => "标题") };
    const body = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return body; }), fill: vi.fn(async () => undefined), innerText: vi.fn(async () => "正文"), focus: vi.fn(async () => undefined), press: vi.fn(async () => undefined) };
    const pageRoot = { innerText: vi.fn(async () => "") };
    const editorImages = { count: vi.fn(async () => 0), evaluateAll: vi.fn(async () => []) };
    const uploadInput = { first: vi.fn(function () { return uploadInput; }), last: vi.fn(function () { return uploadInput; }), count: vi.fn(async () => 1), waitFor: vi.fn(async () => undefined), setInputFiles: vi.fn(async () => undefined) };
    const page = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "https://zhuanlan.zhihu.com/write"),
      waitForFunction: vi.fn().mockRejectedValueOnce(new Error("editor image did not appear")),
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({ fileInputs: 1, editorImages: 0, busyIndicators: 0 })),
      locator: vi.fn((selector: string) => {
        if (selector === "body") return pageRoot;
        if (selector.includes('input[type="file"]')) return uploadInput;
        if (selector.includes(".DraftEditor-root img")) return editorImages;
        if (selector.includes("contenteditable")) return body;
        return title;
      })
    };
    const session = { sessionIdHash: "browser-session-hash", executionMode: "BACKGROUND", headless: true, context: { pages: () => [page] } };
    const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), close: vi.fn(async () => undefined), clear: vi.fn() } as unknown as BrowserSessionManager;
    const adapter = new ZhihuBrowserAdapter({ sessionManager: manager });

    const failure = await adapter.preparePublish(
      { accountId: "account-1", accountName: "知乎账号", platformKey: "zhihu", settings: {} },
      { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [], images: ["C:/media/first.jpg"] }
    ).catch((error: unknown) => error);

    expect(uploadInput.setInputFiles).toHaveBeenCalledWith("C:/media/first.jpg");
    expect(failure).toMatchObject({ code: "UPLOAD_FAILED" });
    expect(failure).not.toHaveProperty("imageUploaded");
  });

  it("clicks the Zhihu final submit button once and collects a real article URL", async () => {
    let currentUrl = "https://zhuanlan.zhihu.com/write";
    const title = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return title; }), fill: vi.fn(async () => undefined), inputValue: vi.fn(async () => "标题") };
    const body = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return body; }), fill: vi.fn(async () => undefined), inputValue: vi.fn(async () => ""), innerText: vi.fn(async () => "正文"), focus: vi.fn(async () => undefined), press: vi.fn(async () => undefined) };
    const submit = { isVisible: vi.fn(async () => true), isEnabled: vi.fn(async () => true), innerText: vi.fn(async () => "发布"), getAttribute: vi.fn(async () => null), click: vi.fn(async () => { currentUrl = "https://zhuanlan.zhihu.com/p/123456789" }) };
    const pageRoot = { innerText: vi.fn(async () => "") };
    const buttons = { count: vi.fn(async () => 1), nth: vi.fn(() => submit) };
    const page = {
      goto: vi.fn(async (url: string) => { currentUrl = url; }),
      url: vi.fn(() => currentUrl),
      waitForURL: vi.fn(async () => undefined),
      locator: vi.fn((selector: string) => selector === "body" ? pageRoot : selector.includes("contenteditable") ? body : selector.includes("button") || selector.includes("role") ? buttons : selector === "h1" ? { first: vi.fn(() => ({ innerText: vi.fn(async () => "标题") })) } : title)
    };
    const session = { sessionIdHash: "browser-session-hash", executionMode: "VISIBLE", headless: false, context: { pages: () => [page] } };
    const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), close: vi.fn(async () => undefined), clear: vi.fn() } as unknown as BrowserSessionManager;
    const adapter = new ZhihuBrowserAdapter({ sessionManager: manager });
    const context = { accountId: "account-1", accountName: "知乎账号", platformKey: "zhihu", settings: { browserExecutionMode: "VISIBLE", triggerSource: "RUN_SELF_TEST", userActionId: "run-1" } };

    await adapter.preparePublish(context, { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] });
    const result = await adapter.finalSubmit(context, { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] }, { jobId: "job-1", submissionIntentId: "intent-1", attempt: 1 });
    const collected = await adapter.collectPublishResult(context, { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] }, { jobId: "job-1", submissionIntentId: "intent-1", attempt: 1 });

    expect(result).toMatchObject({ success: true, externalId: "123456789", publishedUrl: "https://zhuanlan.zhihu.com/p/123456789" });
    expect(collected).toMatchObject({ externalId: "123456789", publishedUrl: "https://zhuanlan.zhihu.com/p/123456789" });
    expect(submit.click).toHaveBeenCalledTimes(1);
  });

  it("inspects the final-submit control without clicking it", async () => {
    const title = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return title; }), fill: vi.fn(async () => undefined), inputValue: vi.fn(async () => "标题"), count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), isEnabled: vi.fn(async () => true), getAttribute: vi.fn(async (name: string) => ({ placeholder: "标题" }[name] ?? null)) };
    const body = { waitFor: vi.fn(async () => undefined), first: vi.fn(function () { return body; }), fill: vi.fn(async () => undefined), innerText: vi.fn(async () => "正文"), count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), isEnabled: vi.fn(async () => true), getAttribute: vi.fn(async (name: string) => ({ contenteditable: "true", role: "textbox" }[name] ?? null)) };
    const submit = { isVisible: vi.fn(async () => true), isEnabled: vi.fn(async () => true), innerText: vi.fn(async () => "发布文章"), getAttribute: vi.fn(async () => null), click: vi.fn(async () => undefined) };
    const buttons = { count: vi.fn(async () => 1), nth: vi.fn(() => submit) };
    const page = { goto: vi.fn(async () => undefined), url: vi.fn(() => "https://zhuanlan.zhihu.com/write"), frames: vi.fn(() => []), locator: vi.fn((selector: string) => selector === "body" ? { innerText: vi.fn(async () => "") } : selector.includes("contenteditable") ? body : selector.includes("button") || selector.includes("role") ? buttons : title) };
    const session = { sessionIdHash: "browser-session-hash", executionMode: "VISIBLE", headless: false, context: { pages: () => [page] } };
    const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), close: vi.fn(async () => undefined), clear: vi.fn() } as unknown as BrowserSessionManager;
    const adapter = new ZhihuBrowserAdapter({ sessionManager: manager });
    const context = { accountId: "account-1", accountName: "知乎账号", platformKey: "zhihu", settings: { browserExecutionMode: "VISIBLE" } };
    const article = { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] };

    await adapter.preparePublish(context, article);
    const result = await adapter.prepareFinalSubmit(context, article);

    expect(result.response).toMatchObject({ finalSubmitControl: { verified: true, enabled: true } });
    expect(submit.click).not.toHaveBeenCalled();
  });
});
