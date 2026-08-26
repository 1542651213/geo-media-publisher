import { describe, expect, it, vi } from "vitest";
import type { BrowserSessionManager } from "@publisher/adapters-core";
import { LIEJU_LOGIN_URL, LIEJU_PUBLISH_URL, LiejuBrowserAdapter } from "./index";

function createHarness(fillTitle?: () => Promise<void>) {
  const title = { count: vi.fn(async () => 1), fill: vi.fn(fillTitle ?? (async () => undefined)), inputValue: vi.fn(async () => "测试标题") };
  const body = { count: vi.fn(async () => 1), fill: vi.fn(async () => undefined), inputValue: vi.fn(async () => "第一段\n第二段") };
  const upload = { count: vi.fn(async () => 1), setInputFiles: vi.fn(async () => undefined), evaluate: vi.fn(async () => true), getAttribute: vi.fn(async () => null) };
  let url = "https://post.lieju.com/190/192";
  const page = { goto: vi.fn(async (next: string) => { if (next !== LIEJU_PUBLISH_URL && next !== LIEJU_LOGIN_URL) url = next; }), url: vi.fn(() => url), waitForURL: vi.fn(async () => undefined), locator: vi.fn((selector: string) => selector === "#atc_title" ? title : selector === "#atc_content" ? body : upload) };
  const session = { sessionIdHash: "session-hash", context: { pages: () => [page] } };
  const manager = { hasStoredSession: vi.fn(() => true), open: vi.fn(async () => session), close: vi.fn(async () => undefined), clear: vi.fn(), save: vi.fn(async () => undefined) } as unknown as BrowserSessionManager;
  return { adapter: new LiejuBrowserAdapter({ sessionManager: manager }), manager, page, title, body };
}

describe("Lieju BrowserAutomation adapter", () => {
  it("declares the official login page and stops before final submit", async () => {
    const { adapter, page } = createHarness();
    expect(adapter.manifest).toMatchObject({ platformKey: "lieju", integrationMode: "BrowserAutomation", transport: "browser" });
    const login = await adapter.connectAccount({ accountId: "lieju-01", accountName: "列举网-01", platformKey: "lieju", settings: {} });
    expect(login).toMatchObject({ opened: true, requiresUserAction: true });
    expect(page.goto).toHaveBeenCalledWith(LIEJU_LOGIN_URL, expect.anything());
  });

  it("fills only verified title/body fields and requires user confirmation", async () => {
    const { adapter, title, body } = createHarness();
    const result = await adapter.preparePublish({ accountId: "lieju-01", accountName: "列举网-01", platformKey: "lieju", settings: {} }, { articleId: "article", title: "测试标题", body: "第一段\n第二段", summary: "", tags: [] });
    expect(result).toMatchObject({ prepared: true, requiresUserAction: true, titleFilled: true, bodyFilled: true, response: { stage: "form_prepared", finalSubmit: "user_action_required", requiredUserFields: ["category", "location", "contact", "captcha"] } });
    expect(title.fill).toHaveBeenCalledWith("测试标题");
    expect(body.fill).toHaveBeenCalledWith("第一段\n第二段");
  });

  it("enforces one browser prepare flow per platformAccountId", async () => {
    let release: (() => void) | undefined;
    const firstFill = new Promise<void>((resolve) => { release = resolve; });
    const { adapter } = createHarness(() => firstFill);
    const ctx = { accountId: "lieju-01", accountName: "列举网-01", platformKey: "lieju", settings: {} };
    const article = { articleId: "article", title: "测试标题", body: "第一段\n第二段", summary: "", tags: [] };
    const first = adapter.preparePublish(ctx, article);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(adapter.preparePublish(ctx, article)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    release?.();
    await expect(first).resolves.toMatchObject({ prepared: true });
  });
});
