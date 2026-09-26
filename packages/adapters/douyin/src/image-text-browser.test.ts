import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { vi } from "vitest";
import type { CredentialStore } from "@publisher/security";
import { DouyinImageTextBrowserAdapter, denyOptionalDouyinLocation, dismissKnownDouyinHomeTour, douyinRequiredSettingsPass, isAuthorizedDouyinDraftResume, isSameDouyinUploadOperation, parseVisibleDouyinCreatorId,
  waitForUniqueDouyinImageInput } from "./image-text-browser";

const store: CredentialStore = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false };

describe("Douyin image/text BrowserNative adapter", () => {
  it("denies only optional Creator geolocation in the owned browser context", async () => {
    const session = { send: vi.fn(async () => undefined), detach: vi.fn(async () => undefined) };
    const context = { newCDPSession: vi.fn(async () => session) };
    const page = { url: () => "https://creator.douyin.com/creator-micro/content/post/image", context: () => context,
      evaluate: vi.fn(async () => "denied") } as unknown as Page;
    await denyOptionalDouyinLocation(page);
    expect(session.send).toHaveBeenCalledWith("Browser.setPermission", { permission: { name: "geolocation" },
      setting: "denied", origin: "https://creator.douyin.com" });
    expect(session.detach).toHaveBeenCalledTimes(1);
  });
  it("allows an owner-confirmed editor resume only with exact existing candidate content", () => {
    const target = { accountId: "owner", articleId: "new-test", pagePath: "/creator-micro/content/post/image",
      title: "Unique test title", body: "Exact test body", imageCount: 1 };
    const approved = { accountId: "owner", articleId: "new-test", title: "Unique test title", body: "Exact test body" };
    expect(isAuthorizedDouyinDraftResume(target, approved)).toBe(true);
    expect(isAuthorizedDouyinDraftResume({ ...target, title: "" }, approved)).toBe(false);
    expect(isAuthorizedDouyinDraftResume({ ...target, body: "" }, approved)).toBe(false);
    expect(isAuthorizedDouyinDraftResume({ ...target, imageCount: 0 }, approved)).toBe(false);
    expect(isAuthorizedDouyinDraftResume({ ...target, title: "Old draft" }, approved)).toBe(false);
    expect(isAuthorizedDouyinDraftResume({ ...target, accountId: "other" }, approved)).toBe(false);
    expect(isAuthorizedDouyinDraftResume({ ...target, articleId: "old-test" }, approved)).toBe(false);
    expect(isAuthorizedDouyinDraftResume({ ...target, pagePath: "/creator-micro/home" }, approved)).toBe(false);
    expect(isAuthorizedDouyinDraftResume(target, null)).toBe(false);
  });
  it("continues an empty editor only within the same returned selection operation", () => {
    const page = {} as Page;
    const context = {};
    const attempt = { accountId: "owner", articleId: "new-test", jobId: "new-job", operationId: "operation-1",
      page, context, sessionIdHash: "session-1", loginGeneration: 1,
      sourceContentHash: "a".repeat(64), imageSha256: "b".repeat(64),
      previewDigest: "c".repeat(64), selectionStatus: "RETURNED" as const };
    const current = { ...attempt, pagePath: "/creator-micro/content/post/image", title: "", body: "" };
    expect(isSameDouyinUploadOperation(attempt, current)).toBe(true);
    expect(isSameDouyinUploadOperation({ ...attempt, selectionStatus: "THREW" }, current)).toBe(false);
    expect(isSameDouyinUploadOperation({ ...attempt, previewDigest: undefined }, current)).toBe(false);
    expect(isSameDouyinUploadOperation(attempt, { ...current, context: {} })).toBe(false);
    expect(isSameDouyinUploadOperation(attempt, { ...current, page: {} as Page })).toBe(false);
    expect(isSameDouyinUploadOperation(attempt, { ...current, sessionIdHash: "new-session" })).toBe(false);
    expect(isSameDouyinUploadOperation(attempt, { ...current, imageSha256: "c".repeat(64) })).toBe(false);
    expect(isSameDouyinUploadOperation(attempt, { ...current, pagePath: "/creator-micro/home" })).toBe(false);
  });
  it("dismisses only the known Creator home tour before choosing the image-post entry", async () => {
    const skip = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), click: vi.fn(async () => undefined) };
    const welcome = { count: vi.fn(async () => 1), isVisible: vi.fn(async () => true), waitFor: vi.fn(async () => undefined) };
    const page = { getByText: vi.fn((text: string) => text === "跳过" ? skip : welcome) } as unknown as Page;
    await expect(dismissKnownDouyinHomeTour(page)).resolves.toBe(true);
    expect(skip.click).toHaveBeenCalledTimes(1);
    expect(welcome.waitFor).toHaveBeenCalledWith({ state: "hidden", timeout: 5_000 });
    skip.count.mockResolvedValue(2);
    await expect(dismissKnownDouyinHomeTour(page)).rejects.toThrow(/DOUYIN_HOME_TOUR_SKIP_AMBIGUOUS/u);
    expect(skip.click).toHaveBeenCalledTimes(1);
    welcome.count.mockResolvedValue(0);
    await expect(dismissKnownDouyinHomeTour(page)).resolves.toBe(false);
    expect(skip.click).toHaveBeenCalledTimes(1);
  });
  it("waits for hydrated image input and rejects multiple image inputs", async () => {
    let count = 0;
    const upload = { count: vi.fn(async () => count), first: vi.fn(() => ({ waitFor: vi.fn(async () => { count = 1; }) })) };
    const page = { locator: vi.fn(() => upload) } as unknown as Page;
    await expect(waitForUniqueDouyinImageInput(page)).resolves.toBe(upload);
    expect(page.locator).toHaveBeenCalledWith('input[type="file"][accept*="image/"]');
    expect(upload.count).toHaveBeenCalledTimes(1);
    upload.first.mockReturnValue({ waitFor: vi.fn(async () => { count = 2; }) });
    await expect(waitForUniqueDouyinImageInput(page)).rejects.toThrow(/DOUYIN_IMAGE_UPLOAD_CONTROL_AMBIGUOUS/u);
  });
  it("requires a visible stable Douyin ID rather than accepting the home URL alone", () => {
    expect(parseVisibleDouyinCreatorId("抖音号：72388977613")).toBe("72388977613");
    expect(parseVisibleDouyinCreatorId("欢迎来到创作者中心")).toBeNull();
    expect(parseVisibleDouyinCreatorId("抖音号：123 抖音号：456")).toBeNull();
  });

  it("fails closed unless public visibility and schedule-off are explicit", () => {
    const base = { visibility: "public" as const, visibilitySelected: true, timing: "immediate" as const,
      timingSelected: true, requiredEmptyCount: 0, unknownMandatoryCount: 0, selectedMandatory: [] };
    expect(douyinRequiredSettingsPass(base)).toBe(true);
    expect(douyinRequiredSettingsPass({ ...base, visibilitySelected: false })).toBe(false);
    expect(douyinRequiredSettingsPass({ ...base, visibility: "private" })).toBe(false);
    expect(douyinRequiredSettingsPass({ ...base, timing: "scheduled" })).toBe(false);
    expect(douyinRequiredSettingsPass({ ...base, timingSelected: false })).toBe(false);
    expect(douyinRequiredSettingsPass({ ...base, requiredEmptyCount: 1 })).toBe(false);
  });
  it("advertises an article-only, one-image route with default-off formal submit", async () => {
    const adapter = new DouyinImageTextBrowserAdapter({ credentialStore: store });
    expect(adapter.manifest.platformKey).toBe("douyin");
    expect(adapter.manifest.transport).toBe("browser");
    expect(adapter.manifest.supportsArticle).toBe(true);
    expect(adapter.manifest.supportsVideo).toBe(false);
    expect(adapter.getCapabilities()).toMatchObject({ article: true, imagePost: true, video: false, maxImageCount: 1,
      scheduledPublish: false, draft: false, contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER" });
    expect(() => adapter.assertFormalSubmitAvailable()).toThrow(/disabled/u);
    const base = { articleId: "article", title: "测试", body: "正文", summary: "", tags: [], images: ["test.png"] };
    await expect(adapter.validateArticle(base)).resolves.toMatchObject({ valid: true });
    await expect(adapter.validateArticle({ ...base, images: [] })).resolves.toMatchObject({ valid: false });
    await expect(adapter.validateArticle({ ...base, images: ["a.png", "b.png"] })).resolves.toMatchObject({ valid: false });
    await expect(adapter.validateArticle({ ...base, tags: ["话题"] })).resolves.toMatchObject({ valid: false });
  });

  it("does not treat a stored account flag as an active Creator browser session", async () => {
    const adapter = new DouyinImageTextBrowserAdapter({ credentialStore: store });
    const ctx = { accountId: "owner-account", accountName: "Owner", platformKey: "douyin",
      settings: { expectedCreatorId: "72388977613", browserExecutionMode: "VISIBLE" }, secrets: {} };
    await expect(adapter.checkSession(ctx)).resolves.toBe("needs_user_action");
    await expect(adapter.activateStoredCreatorSession(ctx)).rejects.toThrow(/尚未连接账号|DOUYIN_ACTIVE_OWNED_CONTEXT_REQUIRED/u);
  });

  it("keeps a recently verified identity bound to the same Page, Context and Session only", async () => {
    const adapter = new DouyinImageTextBrowserAdapter({ credentialStore: store });
    const context = {};
    let path = "/creator-micro/home";
    let visible = "抖音号：72388977613";
    const page = { url: () => `https://creator.douyin.com${path}`, isClosed: () => false, context: () => context,
      locator: () => ({ innerText: async () => visible }), evaluate: async () => ({ labels: ["已发布"],
        searchControlCount: 1, visibleRowCount: 0 }) } as unknown as Page;
    const session = { context, page, executionMode: "VISIBLE", sessionIdHash: "session-1" };
    Object.defineProperty(adapter, "activeCanonicalPage", { value: async () => ({ page, session }) });
    const ctx = { accountId: "owner-account", accountName: "Owner", platformKey: "douyin",
      settings: { expectedCreatorId: "72388977613", browserExecutionMode: "VISIBLE" }, secrets: {} };
    expect((await adapter.activateStoredCreatorSession(ctx)).status).toBe("ACTIVE");
    visible = "作品管理";
    path = "/creator-micro/content/manage";
    expect(await adapter.inspectCurrentManagementPage(ctx)).toMatchObject({ ready: true, creatorId: "72388977613",
      pagePath: "/creator-micro/content/manage", searchControlCount: 1 });
    session.sessionIdHash = "session-2";
    expect((await adapter.activateStoredCreatorSession(ctx)).status).toBe("WAITING_FOR_OWNER");
    visible = "抖音号：12345678901";
    expect((await adapter.activateStoredCreatorSession(ctx)).status).toBe("IDENTITY_MISMATCH");
  });
});
