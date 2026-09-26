import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { vi } from "vitest";
import type { CredentialStore } from "@publisher/security";
import { DouyinImageTextBrowserAdapter, dismissKnownDouyinHomeTour, douyinRequiredSettingsPass, parseVisibleDouyinCreatorId,
  waitForUniqueDouyinImageInput } from "./image-text-browser";

const store: CredentialStore = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false };

describe("Douyin image/text BrowserNative adapter", () => {
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
