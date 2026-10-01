import { describe, expect, it, vi } from "vitest";
import { BrowserSessionManager, browserSessionCredentialKey } from "@publisher/adapters-core";
import { SohuBrowserAdapter } from "@publisher/adapters-sohu-media/browser";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { CredentialStore } from "@publisher/security";

function fixture(authenticated: boolean) {
  const values = new Map<string, string>();
  const credentials: CredentialStore = { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); }, has: key => values.has(key) };
  const identity = { accountId: "owned-sohu", platformKey: "sohu_media" };
  credentials.set(browserSessionCredentialKey(identity), JSON.stringify({ cookies: [], origins: [] }));
  const page = { goto: vi.fn(async () => undefined), url: () => authenticated ? "https://mp.sohu.com/mpfe/v4/" : "https://mp.sohu.com/",
    isClosed: () => false, waitForFunction: vi.fn(async () => undefined), evaluate: vi.fn(async () => ({ bodyPresent: true, bodyTextLength: 20 })),
    locator: () => ({ innerText: async () => authenticated ? "我的内容 内容管理 发布文章" : "推荐 登录/注册" }), context: () => context } as unknown as Page;
  const context = { setDefaultTimeout: vi.fn(), newPage: async () => page, pages: () => [page], close: vi.fn(async () => undefined), storageState: async () => ({ cookies: [], origins: [] }) } as unknown as BrowserContext;
  const browser = { newContext: async () => context, close: vi.fn(async () => undefined), isConnected: () => true, on: vi.fn() } as unknown as Browser;
  const manager = new BrowserSessionManager(credentials, { launchBrowser: async () => browser });
  return { manager, context, identity, adapter: new SohuBrowserAdapter({ sessionManager: manager }) };
}

describe("Sohu current login classification and owned context lifecycle", () => {
  it.each(["VISIBLE", "BACKGROUND"] as const)("classifies the authenticated Creator DOM before %s cleanup", async mode => {
    const f = fixture(true);
    await expect(f.adapter.checkSession({ ...f.identity, accountName: "Owner", settings: { browserExecutionMode: mode, userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "RUN_SELF_TEST" } })).resolves.toBe("logged_in");
    expect(f.context.close).toHaveBeenCalledTimes(mode === "BACKGROUND" ? 1 : 0);
    if (mode === "BACKGROUND") expect(f.manager.getActiveSession(f.identity)).toBeNull();
    await f.adapter.closeOwnedSessions();
  });
  it("does not treat the public recommendation page as a Creator login", async () => {
    const f = fixture(false);
    await expect(f.adapter.checkSession({ ...f.identity, accountName: "Owner", settings: { browserExecutionMode: "BACKGROUND", userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "RUN_SELF_TEST" } })).resolves.toBe("needs_user_action");
    expect(f.context.close).toHaveBeenCalledTimes(1);
  });
});
