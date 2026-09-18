import { describe, expect, it, vi } from "vitest";
import type { AccountContext } from "@publisher/domain";
import { defaultCapabilities, type BrowserSession, type BrowserSessionManager, type BrowserSessionRuntimeState } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, type BrowserPlatformDefinition } from "./index";

const definition: BrowserPlatformDefinition = {
  platformKey: "browser-test",
  displayName: "浏览器测试平台",
  category: "测试",
  officialWebsite: "https://example.com/",
  backendUrl: "https://example.com/backend",
  loginUrl: "https://example.com/login",
  officialSources: ["https://example.com/"],
  capabilities: { ...defaultCapabilities },
  version: "1.1.4",
  blockingReason: "测试",
  researchStatus: "partial"
};

const context = (): AccountContext => ({
  accountId: "account-1",
  accountName: "测试账号",
  platformKey: definition.platformKey,
  settings: { userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "CONNECT_ACCOUNT" }
});

class TestBrowserAutomationAdapter extends BrowserAutomationAdapter {
  async activeBackendPageForTest(ctx: AccountContext) {
    return this.activeBackendPage(ctx);
  }

  async diagnosticSessionForTest(ctx: AccountContext) {
    return this.diagnosticBrowserSession(ctx) ?? await this.getOrOpen(ctx);
  }
}

function pageFixture(initialUrl = definition.backendUrl as string, isClosed = false) {
  let currentUrl = initialUrl;
  return {
    goto: vi.fn(async (url: string) => { currentUrl = url; }),
    url: vi.fn(() => currentUrl),
    isClosed: vi.fn(() => isClosed)
  };
}

function fixture(staysOnLogin = false, hasStoredSession = false, saveFails = false) {
  let currentUrl = definition.loginUrl as string;
  const page = {
    goto: vi.fn(async (url: string) => { currentUrl = staysOnLogin ? definition.loginUrl as string : url; }),
    url: vi.fn(() => currentUrl)
  };
  const session = { sessionIdHash: "owned-session", context: { pages: vi.fn(() => [page]) } };
  const manager = {
    open: vi.fn(async (_identity: unknown, _action: unknown, executionMode: "BACKGROUND" | "VISIBLE" = "VISIBLE") => ({ ...session, executionMode, headless: executionMode === "BACKGROUND" })),
    save: vi.fn(async () => { if (saveFails) throw new Error("session save failed"); }),
    close: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined),
    clear: vi.fn(),
    hasStoredSession: vi.fn(() => hasStoredSession)
  } as unknown as BrowserSessionManager;
  return { adapter: new BrowserAutomationAdapter(definition, { sessionManager: manager }), manager, page };
}

describe("BrowserAutomationAdapter login lifecycle", () => {
  it("verifies in the dedicated login session, saves storageState and closes without opening a second browser", async () => {
    const { adapter, manager, page } = fixture();
    const ctx = context();

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");

    expect(manager.open).toHaveBeenCalledTimes(1);
    expect(manager.open).toHaveBeenCalledWith(
      { platformKey: definition.platformKey, accountId: ctx.accountId },
      { userActionId: ctx.settings.userActionId, triggerSource: "CONNECT_ACCOUNT" },
      "VISIBLE"
    );
    expect(page.goto).toHaveBeenLastCalledWith(definition.backendUrl, expect.anything());
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(manager.close).toHaveBeenCalledTimes(1);
    expect(adapter.isConnectionPending(ctx)).toBe(false);
  });

  it("keeps the dedicated browser open when login or platform verification is not complete", async () => {
    const { adapter, manager } = fixture(true);
    const ctx = context();

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).resolves.toBe("needs_user_action");

    expect(manager.open).toHaveBeenCalledTimes(1);
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.close).not.toHaveBeenCalled();
    expect(adapter.isConnectionPending(ctx)).toBe(true);
  });

  it("closes a failed login session without clearing a previously stored Session", async () => {
    const { adapter, manager } = fixture(false, true, true);
    const ctx = context();

    await adapter.connectAccount(ctx);
    await expect(adapter.completeConnection(ctx)).rejects.toThrow("session save failed");

    expect(manager.close).toHaveBeenCalledTimes(1);
    expect(manager.clear).not.toHaveBeenCalled();
    expect(adapter.isConnectionPending(ctx)).toBe(false);
  });

  it("can close every browser resource owned by the adapter without clearing unrelated user browser processes", async () => {
    const { adapter, manager } = fixture();
    const ctx = context();
    await adapter.connectAccount(ctx);

    await adapter.closeOwnedSessions();

    expect(manager.closeAll).toHaveBeenCalledTimes(1);
    expect(adapter.isConnectionPending(ctx)).toBe(false);
  });

  it("passes an explicit BACKGROUND mode to the owned Playwright session and reports actual headless evidence", async () => {
    const { adapter, manager } = fixture(false, true);
    const ctx: AccountContext = { ...context(), settings: { userActionId: "22222222-2222-4222-8222-222222222222", triggerSource: "START_PUBLISH", browserExecutionMode: "BACKGROUND" } };

    const opened = await adapter.openBackend(ctx);

    expect(manager.open).toHaveBeenCalledWith(
      { platformKey: definition.platformKey, accountId: ctx.accountId },
      { userActionId: ctx.settings.userActionId, triggerSource: "START_PUBLISH" },
      "BACKGROUND"
    );
    expect(opened).toMatchObject({ executionMode: "BACKGROUND", headless: true });
    await adapter.releaseOperationSession(ctx);
    expect(manager.close).toHaveBeenCalledTimes(1);
  });

  it("does not cold-open a policy-enabled account for a normal backend operation", async () => {
    const open = vi.fn(async () => { throw new Error("cold open must not run"); });
    const manager = {
      getActiveSession: vi.fn(() => null),
      requiresActiveContextForOperations: vi.fn(() => true),
      hasStoredSession: vi.fn(() => true),
      open,
      getRuntimeAuthState: vi.fn(() => ({ state: "UNVERIFIED", contextDebugId: null, updatedAt: new Date(0).toISOString(), reason: null }))
    } as unknown as BrowserSessionManager;
    const adapter = new BrowserAutomationAdapter({ ...definition, platformKey: "xiaohongshu" }, { sessionManager: manager });
    const ctx = { ...context(), platformKey: "xiaohongshu" };

    await expect(adapter.openBackend(ctx)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    expect(open).not.toHaveBeenCalled();
  });

  it("uses an operation Page for policy-enabled backend operations", async () => {
    const canonicalPage = pageFixture("https://example.com/home");
    const operationPage = pageFixture("https://example.com/operation");
    const session = {
      sessionIdHash: "owned-session",
      executionMode: "VISIBLE",
      headless: false,
      page: canonicalPage,
      context: { pages: vi.fn(() => [canonicalPage]) }
    } as unknown as BrowserSession;
    const manager = {
      getActiveSession: vi.fn(() => session),
      requiresActiveContextForOperations: vi.fn(() => true),
      openOperationPage: vi.fn(async () => ({ session, page: operationPage, pageDebugId: "operation-page-debug-id" })),
      getRuntimeAuthState: vi.fn(() => ({ state: "AUTHENTICATED", contextDebugId: "context-1", updatedAt: new Date(0).toISOString(), reason: null })),
      debugId: "manager-debug-id"
    } as unknown as BrowserSessionManager;
    const adapter = new BrowserAutomationAdapter({ ...definition, platformKey: "xiaohongshu" }, { sessionManager: manager });
    const ctx: AccountContext = { ...context(), platformKey: "xiaohongshu" };

    const opened = await adapter.openBackend(ctx);

    expect(manager.openOperationPage).toHaveBeenCalledWith(
      { platformKey: "xiaohongshu", accountId: ctx.accountId },
      { userActionId: ctx.settings.userActionId, triggerSource: "CONNECT_ACCOUNT" },
      "VISIBLE"
    );
    expect(canonicalPage.goto).not.toHaveBeenCalled();
    expect(operationPage.goto).toHaveBeenCalledWith(definition.backendUrl, expect.anything());
    expect(opened.backendUrl).toBe(definition.backendUrl);
  });

  it("keeps retained-context sessions addressable after the canonical Page closes", async () => {
    const closedPage = pageFixture("https://example.com/original", true);
    const retainedPage = pageFixture("https://example.com/retained");
    const session = {
      sessionIdHash: "owned-session",
      executionMode: "VISIBLE",
      headless: false,
      page: closedPage,
      context: { pages: vi.fn(() => [closedPage, retainedPage]) }
    } as unknown as BrowserSession;
    const manager = {
      getActiveSession: vi.fn(() => session),
      retainsContextAfterPageClose: vi.fn(() => true),
      debugId: "manager-debug-id"
    } as unknown as BrowserSessionManager;
    const adapter = new TestBrowserAutomationAdapter({ ...definition, platformKey: "xiaohongshu" }, { sessionManager: manager });
    const ctx: AccountContext = { ...context(), platformKey: "xiaohongshu" };

    const active = await adapter.activeBackendPageForTest(ctx);

    expect(active).toMatchObject({ session });
    expect(active?.page).toBe(retainedPage);
  });

  it("passes through runtime auth state from the shared session manager", () => {
    const runtimeState: BrowserSessionRuntimeState = {
      state: "DISCONNECTED",
      contextDebugId: "context-123",
      updatedAt: "2026-08-28T00:00:00.000Z",
      reason: "browser disconnected"
    };
    const manager = {
      getRuntimeAuthState: vi.fn(() => runtimeState),
      debugId: "manager-debug-id"
    } as unknown as BrowserSessionManager;
    const adapter = new BrowserAutomationAdapter({ ...definition, platformKey: "xiaohongshu" }, { sessionManager: manager });
    const ctx: AccountContext = { ...context(), platformKey: "xiaohongshu" };

    expect(adapter.getBrowserRuntimeState(ctx)).toBe(runtimeState);
  });

  it("allows the explicit diagnostic-only path to cold-open while normal backend remains blocked", async () => {
    const restoredPage = pageFixture("https://example.com/restored");
    const restoredSession = {
      sessionIdHash: "owned-session",
      executionMode: "VISIBLE",
      headless: false,
      page: restoredPage,
      context: { pages: vi.fn(() => [restoredPage]) }
    } as unknown as BrowserSession;
    const open = vi.fn(async () => restoredSession);
    const manager = {
      getActiveSession: vi.fn(() => null),
      requiresActiveContextForOperations: vi.fn(() => true),
      hasStoredSession: vi.fn(() => true),
      open,
      getRuntimeAuthState: vi.fn(() => ({ state: "UNVERIFIED", contextDebugId: null, updatedAt: new Date(0).toISOString(), reason: null })),
      debugId: "manager-debug-id"
    } as unknown as BrowserSessionManager;
    const adapter = new TestBrowserAutomationAdapter({ ...definition, platformKey: "xiaohongshu" }, { sessionManager: manager });
    const ctx: AccountContext = { ...context(), platformKey: "xiaohongshu" };

    await expect(adapter.openBackend(ctx)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
    await expect(adapter.diagnosticSessionForTest(ctx)).resolves.toBe(restoredSession);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("keeps a VISIBLE operation session open for user handling", async () => {
    const { adapter, manager } = fixture(false, true);
    const ctx: AccountContext = { ...context(), settings: { userActionId: "77777777-7777-4777-8777-777777777777", triggerSource: "OPEN_BACKEND", browserExecutionMode: "VISIBLE" } };

    await adapter.openBackend(ctx);
    await adapter.releaseOperationSession(ctx);

    expect(manager.close).not.toHaveBeenCalled();
  });

  it("releases the account browser session after a BACKGROUND publish job finishes", async () => {
    const { adapter, manager } = fixture(false, true);
    const ctx: AccountContext = {
      ...context(),
      settings: {
        userActionId: "33333333-3333-4333-8333-333333333333",
        triggerSource: "START_PUBLISH",
        browserExecutionMode: "BACKGROUND",
        dryRun: true
      }
    };

    await expect(adapter.publishArticle(ctx, {
      articleId: "article-1",
      title: "测试标题",
      body: "用于验证后台任务资源释放的正文",
      summary: "",
      tags: []
    })).resolves.toMatchObject({ success: true, dryRun: true });

    expect(manager.open).toHaveBeenCalledTimes(1);
    expect(manager.close).toHaveBeenCalledTimes(1);
  });

  it("runs a task in one account-scoped browser session owned by the manager", async () => {
    const page = pageFixture("https://example.com/backend");
    const session = {
      sessionIdHash: "scoped-session",
      executionMode: "BACKGROUND",
      headless: true,
      page,
      context: { pages: vi.fn(() => [page]) }
    } as unknown as BrowserSession;
    const runScopedOperation = vi.fn(async (_identity: unknown, _action: unknown, _mode: unknown, _caller: unknown, task: (opened: BrowserSession) => Promise<string>) => task(session));
    const manager = {
      runScopedOperation,
      getActiveSession: vi.fn(() => session),
      hasStoredSession: vi.fn(() => true),
      debugId: "manager-debug-id"
    } as unknown as BrowserSessionManager;
    const adapter = new TestBrowserAutomationAdapter(definition, { sessionManager: manager });
    const ctx: AccountContext = {
      ...context(),
      settings: { userActionId: "88888888-8888-4888-8888-888888888888", triggerSource: "START_PUBLISH", browserExecutionMode: "BACKGROUND" }
    };

    const result = await adapter.runWithBrowserSession(ctx, "PublisherService.prepareArticle", async () => {
      const active = await adapter.activeBackendPageForTest(ctx);
      expect(active?.session).toBe(session);
      return "prepared";
    });

    expect(result).toBe("prepared");
    expect(runScopedOperation).toHaveBeenCalledWith(
      { platformKey: definition.platformKey, accountId: ctx.accountId },
      { userActionId: ctx.settings.userActionId, triggerSource: "START_PUBLISH" },
      "BACKGROUND",
      "PublisherService.prepareArticle",
      expect.any(Function)
    );
  });

  it("rethrows a scoped task error without clearing the stored account session", async () => {
    const page = pageFixture("https://example.com/backend");
    const session = {
      sessionIdHash: "scoped-session",
      executionMode: "BACKGROUND",
      headless: true,
      page,
      context: { pages: vi.fn(() => [page]) }
    } as unknown as BrowserSession;
    const original = new Error("prepare failed");
    const manager = {
      runScopedOperation: vi.fn(async (_identity: unknown, _action: unknown, _mode: unknown, _caller: unknown, task: (opened: BrowserSession) => Promise<never>) => task(session)),
      getActiveSession: vi.fn(() => session),
      clear: vi.fn(),
      hasStoredSession: vi.fn(() => true),
      debugId: "manager-debug-id"
    } as unknown as BrowserSessionManager;
    const adapter = new BrowserAutomationAdapter(definition, { sessionManager: manager });

    await expect(adapter.runWithBrowserSession(context(), "PublisherService.prepareArticle", async () => { throw original; })).rejects.toBe(original);

    expect(manager.clear).not.toHaveBeenCalled();
    expect(manager.hasStoredSession({ platformKey: definition.platformKey, accountId: "account-1" })).toBe(true);
  });

  it("keeps the legacy context-closing release for ordinary browser platforms", async () => {
    const fixtureState = fixture(false, true);

    await fixtureState.adapter.releaseConnectionSession(context());
    expect(fixtureState.manager.close).toHaveBeenCalledTimes(1);
  });
});
