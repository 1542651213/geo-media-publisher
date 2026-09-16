import { basename, join, relative, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext } from "playwright-core";
import type { CredentialStore } from "@publisher/security";
import { BrowserRuntimeError, BrowserSessionManager, BrowserSessionPageOwnershipError, ExternalLaunchBlockedError, browserExecutionModeFromSettings, type BrowserSessionLifecycleEvent, type BrowserSessionOperationPageLifecycleEvent, type UserInitiatedAction } from "./index";

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

const userAction: UserInitiatedAction = { userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "CONNECT_ACCOUNT" };

describe("BrowserSessionManager credential boundary", () => {
  it("closes an XHS operation Page without closing its canonical Context", async () => {
    const firstPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined), context: vi.fn(() => context) };
    const secondPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined), context: vi.fn(() => context) };
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage),
      pages: vi.fn(() => [firstPage, secondPage]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
      launchBrowser: vi.fn(async () => browser),
      platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } }
    });
    const identity = { platformKey: "xiaohongshu", accountId: "account-a" };

    const session = await manager.open(identity, userAction);
    const operation = await manager.openOperationPage(identity, userAction);
    await manager.closeOperationPage(identity, operation.page);

    expect(operation.session).toBe(session);
    expect(operation.page).not.toBe(firstPage);
    expect(operation.page.close).toHaveBeenCalledTimes(1);
    expect(context.close).not.toHaveBeenCalled();
    expect(manager.getActiveSession(identity)).toBe(session);
  });

  it("enforces Page-to-Context identity and emits operation Page lifecycle evidence", async () => {
    const lifecycle: BrowserSessionOperationPageLifecycleEvent[] = [];
    const canonicalPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "https://creator.xiaohongshu.com/"), close: vi.fn(async () => undefined), context: vi.fn(() => context) };
    const operationPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "https://creator.xiaohongshu.com/"), close: vi.fn(async () => undefined), context: vi.fn(() => context) };
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => operationPage),
      pages: vi.fn(() => [canonicalPage, operationPage]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
      launchBrowser: vi.fn(async () => browser),
      onOperationPageLifecycle: (event) => lifecycle.push(event)
    });
    const identity = { platformKey: "xiaohongshu", accountId: "operation-evidence" };

    const opened = await manager.openOperationPage(identity, userAction);
    await manager.closeOperationPage(identity, opened.page);

    expect(lifecycle).toHaveLength(3);
    expect(lifecycle[0]).toMatchObject({ phase: "OPERATION_PAGE_OPENED", platformKey: "xiaohongshu", accountId: "operation-evidence", contextDebugId: expect.any(String), pageDebugId: opened.pageDebugId, pageCountBefore: 2, pageCountAfter: 2, browserConnected: true, contextMatch: true });
    expect(lifecycle[1]).toMatchObject({ phase: "OPERATION_PAGE_CLOSE_STARTED", contextDebugId: lifecycle[0]?.contextDebugId, pageDebugId: opened.pageDebugId });
    expect(lifecycle[2]).toMatchObject({ phase: "OPERATION_PAGE_CLOSE_COMPLETED", contextDebugId: lifecycle[0]?.contextDebugId, pageDebugId: opened.pageDebugId, remainingPageCount: 2, browserConnected: true });
    expect(JSON.stringify(lifecycle)).not.toMatch(/cookie|token|authorization|storage/iu);
  });

  it("rejects an operation Page returned by a foreign BrowserContext", async () => {
    const foreignContext = {} as BrowserContext;
    const canonicalPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), context: vi.fn(() => ownerContext) };
    const foreignPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), context: vi.fn(() => foreignContext) };
    const ownerContext = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => foreignPage),
      pages: vi.fn(() => [canonicalPage, foreignPage]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => ownerContext), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });

    await expect(manager.openOperationPage({ platformKey: "xiaohongshu", accountId: "foreign-page" }, userAction)).rejects.toBeInstanceOf(BrowserSessionPageOwnershipError);
    expect(foreignPage.context).toHaveBeenCalled();
  });

  it("rejects closing the canonical XHS session Page as an operation Page", async () => {
    const canonicalPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => canonicalPage), pages: vi.fn(() => [canonicalPage]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });
    const identity = { platformKey: "xiaohongshu", accountId: "account-canonical" };
    const session = await manager.open(identity, userAction);

    await expect(manager.closeOperationPage(identity, session.page)).rejects.toThrow("Operation Page");
    expect(canonicalPage.close).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("rejects closing an XHS operation Page under a different account identity", async () => {
    const canonicalPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
    const operationPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn().mockResolvedValueOnce(canonicalPage).mockResolvedValueOnce(operationPage),
      pages: vi.fn(() => [canonicalPage, operationPage]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });
    const identity = { platformKey: "xiaohongshu", accountId: "account-operation" };
    const operation = await manager.openOperationPage(identity, userAction);

    await expect(manager.closeOperationPage({ platformKey: "xiaohongshu", accountId: "account-other" }, operation.page)).rejects.toThrow("Operation Page");
    expect(operation.page.close).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("rejects closing an XHS operation Page under a different platform identity", async () => {
    const canonicalPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
    const operationPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn().mockResolvedValueOnce(canonicalPage).mockResolvedValueOnce(operationPage),
      pages: vi.fn(() => [canonicalPage, operationPage]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });
    const identity = { platformKey: "xiaohongshu", accountId: "account-platform-boundary" };
    const operation = await manager.openOperationPage(identity, userAction);

    await expect(manager.closeOperationPage({ platformKey: "other-platform", accountId: "account-other-platform" }, operation.page)).rejects.toThrow("Operation Page");
    expect(operation.page.close).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("saves and clears storage state through the credential store without launching a browser", async () => {
    const store = new MemoryCredentialStore();
    const manager = new BrowserSessionManager(store);
    const identity = { platformKey: "browser-platform", accountId: "account-1" };
    const state = { cookies: [{ name: "session", value: "encrypted-by-store", domain: ".example.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }], origins: [] };
    const context = { storageState: vi.fn(async () => state) } as unknown as BrowserContext;

    await manager.save(identity, context);

    expect(store.get("session:browser-platform:account-1")).toBe(JSON.stringify(state));
    expect(context.storageState).toHaveBeenCalledTimes(1);
    manager.clear(identity);
    expect(store.has("session:browser-platform:account-1")).toBe(false);
  });

  it("sanitizes every debug path segment and keeps it below the configured root", () => {
    const root = resolve("browser-debug-artifacts");
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { debugArtifactsDir: root });

    const artifact = manager.debugArtifactPath({ platformKey: "../tik?tok", accountId: "acct/../../1" }, "../shot.png");

    expect(artifact).not.toBeNull();
    if (!artifact) throw new Error("debug path was not created");
    expect(relative(root, artifact).startsWith("..")) .toBe(false);
    expect(basename(artifact)).toBe("___shot_png");
    expect(artifact).not.toContain("../");
    expect(artifact).not.toContain("..\\");
  });

  it("returns null when debug artifacts are disabled", () => {
    const manager = new BrowserSessionManager(new MemoryCredentialStore());
    expect(manager.debugArtifactPath({ platformKey: "platform", accountId: "account" }, "shot.png")).toBeNull();
  });

  it("prefers the independently updated Chrome channel and keeps the browser visible by default", async () => {
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => ({ url: vi.fn(() => "about:blank") })), close: vi.fn() } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context) } as unknown as Browser;
    const launchBrowser = vi.fn(async ({ channel, headless }: { channel: "msedge" | "chrome"; headless: boolean }) => {
      expect(channel).toBe("chrome");
      expect(headless).toBe(false);
      return browser;
    });
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser });

    await expect(manager.open({ platformKey: "zhihu", accountId: "account-1" }, userAction)).resolves.toMatchObject({ browser, context });
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(launchBrowser).toHaveBeenCalledWith({ channel: "chrome", headless: false });
  });

  it("falls back to Edge when Chrome is unavailable", async () => {
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => ({ url: vi.fn(() => "about:blank") })), close: vi.fn() } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context) } as unknown as Browser;
    const launchBrowser = vi.fn(async ({ channel }: { channel: "msedge" | "chrome"; headless: boolean }) => {
      if (channel === "chrome") throw new Error("Chrome is not installed");
      return browser;
    });
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser });

    await expect(manager.open({ platformKey: "bilibili", accountId: "account-2" }, userAction)).resolves.toMatchObject({ browser, context });
    expect(launchBrowser).toHaveBeenNthCalledWith(1, { channel: "chrome", headless: false });
    expect(launchBrowser).toHaveBeenNthCalledWith(2, { channel: "msedge", headless: false });
  });

  it("uses headless only for an explicit per-action BACKGROUND execution mode", async () => {
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => ({ url: vi.fn(() => "about:blank") })), close: vi.fn() } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context) } as unknown as Browser;
    const launchBrowser = vi.fn(async () => browser);
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser });

    await expect(manager.open({ platformKey: "zhihu", accountId: "background-account" }, { ...userAction, triggerSource: "START_PUBLISH" }, "BACKGROUND")).resolves.toMatchObject({ executionMode: "BACKGROUND", headless: true });
    expect(launchBrowser).toHaveBeenCalledWith({ channel: "chrome", headless: true });
    expect(browserExecutionModeFromSettings({ browserExecutionMode: "BACKGROUND" })).toBe("BACKGROUND");
    expect(browserExecutionModeFromSettings({ browserExecutionMode: "UNKNOWN" })).toBe("VISIBLE");
    expect(browserExecutionModeFromSettings({})).toBe("VISIBLE");
  });

  it("fails closed with a safe runtime error when no supported browser exists", async () => {
    const launchBrowser = vi.fn(async () => { throw new Error("private executable path must not reach the UI"); });
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser });

    const error = await manager.open({ platformKey: "zhihu", accountId: "account-3" }, userAction).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(BrowserRuntimeError);
    expect(error).toMatchObject({ diagnostic: { errorCode: "BROWSER_RUNTIME_NOT_FOUND", module: "BrowserSessionManager", attemptedChannels: ["chrome", "msedge"] } });
    expect(error instanceof Error ? error.message : String(error)).toBe("未检测到 Microsoft Edge 或 Google Chrome，请安装浏览器后重试。");
    expect(error instanceof Error ? error.message : String(error)).not.toContain("private executable path");
  });

  it("blocks APP_STARTUP before any external browser launch", async () => {
    const launchBrowser = vi.fn(async () => { throw new Error("must not launch"); });
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser });

    const error = await manager.open(
      { platformKey: "zhihu", accountId: "startup-account" },
      { userActionId: null, triggerSource: "APP_STARTUP" }
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ExternalLaunchBlockedError);
    expect(error).toMatchObject({ code: "USER_ACTION_REQUIRED", diagnostic: { errorCode: "EXTERNAL_LAUNCH_BLOCKED", triggerSource: "APP_STARTUP", userActionId: null } });
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it("requires a userActionId even for an otherwise allowed trigger source", async () => {
    const launchBrowser = vi.fn(async () => { throw new Error("must not launch"); });
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser });

    await expect(manager.open(
      { platformKey: "zhihu", accountId: "missing-action-id" },
      { userActionId: null, triggerSource: "START_PUBLISH" }
    )).rejects.toBeInstanceOf(ExternalLaunchBlockedError);
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it("attempts both context and browser cleanup and closeAll only touches owned sessions", async () => {
    const contextClose = vi.fn(async () => { throw new Error("context close failed"); });
    const browserClose = vi.fn(async () => undefined);
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => ({ url: vi.fn(() => "about:blank") })), close: contextClose } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context), close: browserClose } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });

    await manager.open({ platformKey: "zhihu", accountId: "owned-account" }, userAction);
    await manager.closeAll();

    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(browserClose).toHaveBeenCalledTimes(1);
    await manager.closeAll();
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  it("keeps one account-scoped active Page and pending marker available across adapter instances", async () => {
    const page = { url: vi.fn(() => "https://creator.xiaohongshu.com/new/home"), isClosed: vi.fn(() => false) };
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), pages: vi.fn(() => [page]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
    const browser = { newContext: vi.fn(async () => context), contexts: vi.fn(() => [context]), close: vi.fn(async () => undefined) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });
    const identity = { platformKey: "xiaohongshu", accountId: "account-a" };

    const first = await manager.open(identity, userAction, "VISIBLE");
    manager.markConnectionPending(identity);
    const second = await manager.open(identity, userAction, "VISIBLE");

    expect(second).toBe(first);
    expect(manager.getActiveSession(identity)).toBe(first);
    expect(manager.isConnectionPending(identity)).toBe(true);
    expect(manager.debugId).toMatch(/^[0-9a-f-]{36}$/iu);
    manager.clearConnectionPending(identity);
    expect(manager.isConnectionPending(identity)).toBe(false);
    await manager.close(first);
    expect(manager.getActiveSession(identity)).toBeNull();
  });

  it("uses one deterministic persistent profile per platform account and seeds it only when explicitly enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-browser-profile-test-"));
    try {
      const page = { url: vi.fn(() => "about:blank"), isClosed: vi.fn(() => false) };
      const newContext = vi.fn();
      const browser = { close: vi.fn(async () => undefined), newContext } as unknown as Browser;
      const context = {
        browser: vi.fn(() => browser),
        setDefaultTimeout: vi.fn(),
        newPage: vi.fn(async () => page),
        pages: vi.fn(() => [page]),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserContext;
      const storedState = { cookies: [], origins: [] };
      const store = new MemoryCredentialStore();
      store.set("session:xiaohongshu:account-1", JSON.stringify(storedState));
      const launchPersistentContext = vi.fn(async (userDataDir: string, options: { channel: "chrome" | "msedge"; headless: boolean; storageState?: unknown }) => {
        expect(userDataDir).toBe(join(root, "xiaohongshu", "account-1"));
        expect(options).toMatchObject({ channel: "chrome", headless: false, storageState: storedState });
        return context;
      });
      const manager = new BrowserSessionManager(store, {
        browserProfileRootDir: root,
        persistentProfilePlatforms: ["xiaohongshu"],
        persistentProfileCredentialSnapshotPlatforms: ["xiaohongshu"],
        launchPersistentContext
      } as never);

      const session = await manager.open({ platformKey: "xiaohongshu", accountId: "account-1" }, userAction);

      expect(launchPersistentContext).toHaveBeenCalledTimes(1);
      expect(session).toMatchObject({ storageMode: "PERSISTENT_PROFILE", profilePath: join(root, "xiaohongshu", "account-1") });
      expect(session.browser).toBe(browser);
      expect(newContext).not.toHaveBeenCalled();
      await manager.close(session);
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(browser.close).toHaveBeenCalledTimes(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the canonical Xiaohongshu persistent profile free from credential snapshot reinjection", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-browser-profile-canonical-test-"));
    try {
      const page = { url: vi.fn(() => "about:blank"), isClosed: vi.fn(() => false) };
      const context = {
        browser: vi.fn(() => ({ close: vi.fn(async () => undefined) })),
        setDefaultTimeout: vi.fn(),
        newPage: vi.fn(async () => page),
        pages: vi.fn(() => [page]),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserContext;
      const store = new MemoryCredentialStore();
      const storedState = { cookies: [{ name: "legacy", value: "must-not-be-reinjected", domain: ".xiaohongshu.com", path: "/", expires: -1 }], origins: [] };
      store.set("session:xiaohongshu:account-1", JSON.stringify(storedState));
      const launchPersistentContext = vi.fn(async (_userDataDir: string, options: { storageState?: unknown }) => {
        expect(options.storageState).toBeUndefined();
        return context;
      });
      const manager = new BrowserSessionManager(store, {
        browserProfileRootDir: root,
        persistentProfilePlatforms: ["xiaohongshu"],
        persistentProfileCredentialSnapshotPlatforms: [],
        launchPersistentContext
      } as never);

      const session = await manager.open({ platformKey: "xiaohongshu", accountId: "account-1" }, userAction);

      expect(launchPersistentContext).toHaveBeenCalledTimes(1);
      expect(session).toMatchObject({ storageMode: "PERSISTENT_PROFILE", credentialSnapshotInjected: false });
      await manager.close(session);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves legacy snapshot seeding for persistent platforms without a platform policy override", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-browser-profile-legacy-default-test-"));
    try {
      const page = { url: vi.fn(() => "about:blank"), isClosed: vi.fn(() => false) };
      const context = {
        browser: vi.fn(() => ({ close: vi.fn(async () => undefined) })),
        setDefaultTimeout: vi.fn(),
        newPage: vi.fn(async () => page),
        pages: vi.fn(() => [page]),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserContext;
      const store = new MemoryCredentialStore();
      const storedState = { cookies: [], origins: [] };
      store.set("session:legacy-platform:account-1", JSON.stringify(storedState));
      const launchPersistentContext = vi.fn(async (_userDataDir: string, options: { storageState?: unknown }) => {
        expect(options.storageState).toEqual(storedState);
        return context;
      });
      const manager = new BrowserSessionManager(store, { browserProfileRootDir: root, persistentProfilePlatforms: ["legacy-platform"], launchPersistentContext } as never);

      const session = await manager.open({ platformKey: "legacy-platform", accountId: "account-1" }, userAction);

      expect(session.credentialSnapshotInjected).toBe(true);
      await manager.close(session);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refreshes indexedDB together with cookies and origins for persistent profiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-browser-profile-save-test-"));
    try {
      const state = { cookies: [], origins: [] };
      const context = { storageState: vi.fn(async () => state) } as unknown as BrowserContext;
      const store = new MemoryCredentialStore();
      const manager = new BrowserSessionManager(store, {
        browserProfileRootDir: root,
        persistentProfilePlatforms: ["xiaohongshu"]
      } as never);

      await manager.save({ platformKey: "xiaohongshu", accountId: "account-1" }, context);

      expect(context.storageState).toHaveBeenCalledWith({ indexedDB: true });
      expect(store.get("session:xiaohongshu:account-1")).toBe(JSON.stringify(state));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deduplicates concurrent XHS Context creation by platform and account", async () => {
    let releaseLaunch: (() => void) | undefined;
    const launchGate = new Promise<void>((resolve) => { releaseLaunch = resolve; });
    const page = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank") };
    const context = {
      browser: vi.fn(() => browser),
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => page),
      pages: vi.fn(() => [page]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => true)
    } as unknown as Browser;
    const launchPersistentContext = vi.fn(async () => {
      await launchGate;
      return context;
    });
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
      browserProfileRootDir: "C:\\temp\\browser-profiles",
      persistentProfilePlatforms: ["xiaohongshu"],
      platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } },
      launchPersistentContext
    } as never);
    const identity = { platformKey: "xiaohongshu", accountId: "account-concurrent" };

    const first = manager.open(identity, userAction);
    const second = manager.open(identity, userAction);
    releaseLaunch?.();
    const sessions = await Promise.all([first, second]);

    expect(sessions[0]).toBe(sessions[1]);
    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
  });

  it("does not re-register a session when closeAll races with a pending XHS open", async () => {
    let releaseLaunch: (() => void) | undefined;
    let pageClosed = false;
    const launchGate = new Promise<void>((resolve) => { releaseLaunch = resolve; });
    const page = {
      isClosed: vi.fn(() => pageClosed),
      url: vi.fn(() => "about:blank")
    };
    const context = {
      browser: vi.fn(() => browser),
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => page),
      pages: vi.fn(() => [page]),
      close: vi.fn(async () => { pageClosed = true; })
    } as unknown as BrowserContext;
    const browser = {
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => !pageClosed)
    } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
      browserProfileRootDir: "C:\\temp\\browser-profiles",
      persistentProfilePlatforms: ["xiaohongshu"],
      platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } },
      launchPersistentContext: vi.fn(async () => {
        await launchGate;
        return context;
      })
    } as never);
    const identity = { platformKey: "xiaohongshu", accountId: "account-closeall-race" };

    const opening = manager.open(identity, userAction);
    const closing = manager.closeAll();
    releaseLaunch?.();
    await Promise.allSettled([opening, closing]);

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(manager.getActiveSession(identity)).toBeNull();
    expect(manager.getRuntimeAuthState(identity).state).toBe("UNVERIFIED");
  });

  it("does not register a persistent-profile session after closeAll starts during profile marker write", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-browser-profile-closeall-write-race-test-"));
    let resolveWriteStarted: (() => void) | undefined;
    let releaseWrite: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => { resolveWriteStarted = resolve; });
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const writeProfileInitializedMarker = vi.fn(async () => {
      resolveWriteStarted?.();
      await writeGate;
    });

    try {
      let pageClosed = false;
      const page = {
        isClosed: vi.fn(() => pageClosed),
        url: vi.fn(() => "about:blank")
      };
      const browser = {
        close: vi.fn(async () => undefined),
        isConnected: vi.fn(() => !pageClosed)
      } as unknown as Browser;
      const context = {
        browser: vi.fn(() => browser),
        setDefaultTimeout: vi.fn(),
        newPage: vi.fn(async () => page),
        pages: vi.fn(() => [page]),
        close: vi.fn(async () => { pageClosed = true; })
      } as unknown as BrowserContext;
      const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
        browserProfileRootDir: root,
        persistentProfilePlatforms: ["xiaohongshu"],
        platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } },
        launchPersistentContext: vi.fn(async () => context),
        writeProfileInitializedMarker
      } as never);
      const identity = { platformKey: "xiaohongshu", accountId: "account-closeall-write-race" };

      const opening = manager.open(identity, userAction);
      await writeStarted;
      const closing = manager.closeAll();
      releaseWrite?.();
      await Promise.allSettled([opening, closing]);

      expect(writeProfileInitializedMarker).toHaveBeenCalledTimes(1);
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(manager.getActiveSession(identity)).toBeNull();
      expect(manager.getRuntimeAuthState(identity).state).toBe("UNVERIFIED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps authenticated runtime state after Page close and clears it on Browser disconnect", async () => {
    let disconnected: (() => void) | undefined;
    let canonicalPageClosed = false;
    const page = {
      isClosed: vi.fn(() => canonicalPageClosed),
      url: vi.fn(() => "about:blank"),
      close: vi.fn(async () => { canonicalPageClosed = true; })
    };
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => page),
      pages: vi.fn(() => [page]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => true),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "disconnected") disconnected = listener;
      })
    } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
      launchBrowser: vi.fn(async () => browser),
      platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } }
    });
    const identity = { platformKey: "xiaohongshu", accountId: "account-disconnect" };
    const session = await manager.open(identity, userAction);
    manager.setRuntimeAuthState(identity, "AUTHENTICATED", null);
    await manager.closeOperationPage(identity, session.page);

    expect(manager.getActiveSession(identity)).toBe(session);
    expect(manager.getRuntimeAuthState(identity).state).toBe("AUTHENTICATED");
    disconnected?.();
    expect(manager.getActiveSession(identity)).toBeNull();
    expect(manager.getRuntimeAuthState(identity).state).toBe("DISCONNECTED");
  });

  it("records explicit close causality and disconnect classification", async () => {
    let browserConnected = true;
    let disconnected: (() => void) | undefined;
    const page = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => page),
      pages: vi.fn(() => [page]),
      close: vi.fn(async () => { browserConnected = false; })
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => browserConnected),
      on: vi.fn((event: string, listener: () => void) => { if (event === "disconnected") disconnected = listener; })
    } as unknown as Browser;
    const events: BrowserSessionLifecycleEvent[] = [];
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
      launchBrowser: vi.fn(async () => browser),
      onSessionLifecycle: (event: BrowserSessionLifecycleEvent) => events.push(event),
      platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } }
    });
    const identity = { platformKey: "xiaohongshu", accountId: "account-close-causality" };
    await manager.open(identity, userAction);

    browserConnected = false;
    disconnected?.();

    expect(events.at(-1)).toMatchObject({
      phase: "CONTEXT_DISCONNECTED",
      explicitCloseInProgress: false,
      lastExplicitCloseReason: null,
      activePageCountBeforeDisconnect: 1,
      browserConnectedBeforeEvent: true,
      contextLaunchCount: 1,
      disconnectReason: "UNEXPECTED_BROWSER_DISCONNECT"
    });

    browserConnected = true;
    const replacement = await manager.open(identity, userAction);
    await manager.close(replacement, { reason: "APP_SHUTDOWN", callerOperation: "test.appShutdown" });

    expect(events.find((event) => event.phase === "CLOSE_STARTED")).toMatchObject({
      closeReason: "APP_SHUTDOWN",
      callerOperation: "test.appShutdown",
      pageCount: 1,
      explicitCloseInProgress: true,
      lastExplicitCloseReason: "APP_SHUTDOWN"
    });
  });

  it("ignores stale disconnect from an older same-key session after a newer session replaces it", async () => {
    let staleDisconnected: (() => void) | undefined;
    const oldPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank") };
    const oldContext = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => oldPage),
      pages: vi.fn(() => [oldPage]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const oldBrowser = {
      newContext: vi.fn(async () => oldContext),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => true),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "disconnected") staleDisconnected = listener;
      })
    } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
      launchBrowser: vi.fn(async () => oldBrowser),
      platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } }
    });
    const identity = { platformKey: "xiaohongshu", accountId: "account-stale-disconnect" };
    const olderSession = await manager.open(identity, userAction);
    const newerSession = {
      ...olderSession,
      browser: { isConnected: vi.fn(() => true), close: vi.fn(async () => undefined) } as unknown as Browser,
      context: {
        setDefaultTimeout: vi.fn(),
        newPage: vi.fn(async () => oldPage),
        pages: vi.fn(() => [oldPage]),
        close: vi.fn(async () => undefined)
      } as unknown as BrowserContext,
      contextDebugId: "newer-context-debug-id",
      pageDebugId: "newer-page-debug-id"
    };

    manager.setActiveSession(identity, newerSession);
    manager.setRuntimeAuthState(identity, "AUTHENTICATED", "newer session");
    staleDisconnected?.();

    expect(manager.getActiveSession(identity)).toBe(newerSession);
    expect(manager.getRuntimeAuthState(identity)).toMatchObject({
      state: "AUTHENTICATED",
      contextDebugId: "newer-context-debug-id",
      reason: "newer session"
    });
  });

  it("closes only owned contexts during shutdown and leaves different accounts isolated", async () => {
    let pageAClosed = false;
    const pageA = {
      isClosed: vi.fn(() => pageAClosed),
      url: vi.fn(() => "about:blank"),
      close: vi.fn(async () => { pageAClosed = true; })
    };
    const pageB = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank") };
    const contextA = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => pageA),
      pages: vi.fn(() => [pageA]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const contextB = {
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn(async () => pageB),
      pages: vi.fn(() => [pageB]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn().mockResolvedValueOnce(contextA).mockResolvedValueOnce(contextB),
      isConnected: vi.fn(() => true),
      close: vi.fn(async () => undefined)
    } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
      launchBrowser: vi.fn(async () => browser),
      platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } }
    });
    const identityA = { platformKey: "xiaohongshu", accountId: "a" };
    const identityB = { platformKey: "xiaohongshu", accountId: "b" };

    const accountA = await manager.open(identityA, userAction);
    const accountB = await manager.open(identityB, userAction);
    manager.setRuntimeAuthState(identityA, "AUTHENTICATED", null);
    manager.setRuntimeAuthState(identityB, "AUTHENTICATED", null);
    await manager.closeOperationPage(identityA, accountA.page);

    expect(manager.getActiveSession(identityB)).toBe(accountB);
    await manager.closeAll();
    expect(contextA.close).toHaveBeenCalledTimes(1);
    expect(contextB.close).toHaveBeenCalledTimes(1);
    expect(manager.getRuntimeAuthState(identityA).state).toBe("UNVERIFIED");
    expect(manager.getRuntimeAuthState(identityB).state).toBe("UNVERIFIED");
  });

  it("reuses the same account profile across independent manager instances without reseeding it", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-browser-profile-restore-test-"));
    try {
      const state = { cookies: [], origins: [] };
      const store = new MemoryCredentialStore();
      store.set("session:xiaohongshu:account-1", JSON.stringify(state));
      const calls: Array<{ userDataDir: string; storageState?: unknown }> = [];
      const launch = vi.fn(async (userDataDir: string, options: { storageState?: unknown }) => {
        calls.push({ userDataDir, storageState: options.storageState });
        const page = { url: vi.fn(() => "about:blank"), isClosed: vi.fn(() => false) };
        const browser = { close: vi.fn(async () => undefined) } as unknown as Browser;
        const context = { browser: vi.fn(() => browser), setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), pages: vi.fn(() => [page]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
        return context;
      });
      const makeManager = () => new BrowserSessionManager(store, { browserProfileRootDir: root, persistentProfilePlatforms: ["xiaohongshu"], persistentProfileCredentialSnapshotPlatforms: ["xiaohongshu"], launchPersistentContext: launch } as never);

      const firstManager = makeManager();
      const first = await firstManager.open({ platformKey: "xiaohongshu", accountId: "account-1" }, userAction);
      await firstManager.close(first);
      const secondManager = makeManager();
      const second = await secondManager.open({ platformKey: "xiaohongshu", accountId: "account-1" }, userAction);

      expect(calls).toHaveLength(2);
      expect(calls[0]?.userDataDir).toBe(calls[1]?.userDataDir);
      expect(calls[0]?.storageState).toEqual(state);
      expect(calls[1]?.storageState).toBeUndefined();
      await secondManager.close(second);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits ordered lifecycle evidence and awaits persistent context close", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-browser-profile-lifecycle-test-"));
    try {
      let browserConnected = true;
      const page = { url: vi.fn(() => "about:blank"), isClosed: vi.fn(() => false) };
      const browser = { isConnected: vi.fn(() => browserConnected), close: vi.fn(async () => undefined) } as unknown as Browser;
      const context = {
        browser: vi.fn(() => browser),
        setDefaultTimeout: vi.fn(),
        newPage: vi.fn(async () => page),
        pages: vi.fn(() => [page]),
        close: vi.fn(async () => { browserConnected = false; })
      } as unknown as BrowserContext;
      const events: BrowserSessionLifecycleEvent[] = [];
      const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
        browserProfileRootDir: root,
        persistentProfilePlatforms: ["xiaohongshu"],
        launchPersistentContext: vi.fn(async () => context),
        onSessionLifecycle: (event: BrowserSessionLifecycleEvent) => events.push(event)
      } as never);
      const identity = { platformKey: "xiaohongshu", accountId: "account-lifecycle" };

      const session = await manager.open(identity, userAction);
      await manager.close(session);

      expect(events.map((event) => event.phase)).toEqual(["OPEN_STARTED", "OPEN_COMPLETED", "CLOSE_STARTED", "CONTEXT_CLOSE_COMPLETED", "CLOSE_COMPLETED"]);
      expect(events.every((event) => event.platformKey === identity.platformKey && event.accountId === identity.accountId)).toBe(true);
      expect(events.at(-1)).toMatchObject({ storageMode: "PERSISTENT_PROFILE", browserConnected: false });
      expect(browser.close).not.toHaveBeenCalled();
      expect(manager.getActiveSession(identity)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits close failure after cleanup when persistent context close rejects", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-browser-profile-close-failure-test-"));
    try {
      const page = { url: vi.fn(() => "about:blank"), isClosed: vi.fn(() => false) };
      const browser = { isConnected: vi.fn(() => true) } as unknown as Browser;
      const context = {
        browser: vi.fn(() => browser),
        setDefaultTimeout: vi.fn(),
        newPage: vi.fn(async () => page),
        pages: vi.fn(() => [page]),
        close: vi.fn(async () => { throw new Error("close failed"); })
      } as unknown as BrowserContext;
      const events: BrowserSessionLifecycleEvent[] = [];
      const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
        browserProfileRootDir: root,
        persistentProfilePlatforms: ["xiaohongshu"],
        launchPersistentContext: vi.fn(async () => context),
        onSessionLifecycle: (event: BrowserSessionLifecycleEvent) => events.push(event)
      } as never);
      const identity = { platformKey: "xiaohongshu", accountId: "account-close-failure" };
      const session = await manager.open(identity, userAction);

      await expect(manager.close(session)).rejects.toThrow("close failed");
      expect(events.map((event) => event.phase)).toEqual(["OPEN_STARTED", "OPEN_COMPLETED", "CLOSE_STARTED", "CLOSE_FAILED"]);
      expect(manager.getActiveSession(identity)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes an in-process canonical session snapshot without creating browser resources", async () => {
    const page = { isClosed: vi.fn(() => false), url: vi.fn(() => "https://creator.xiaohongshu.com/"), context: vi.fn() };
    const newPage = vi.fn(async () => page);
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage,
      pages: vi.fn(() => [page]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    page.context.mockReturnValue(context);
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });
    const identity = { platformKey: "xiaohongshu", accountId: "snapshot-account" };
    const session = await manager.open(identity, userAction);
    manager.setRuntimeAuthState(identity, "AUTHENTICATED", "login-complete");
    manager.recordCanonicalPagePromotion(identity, session);

    const beforeNewPageCalls = newPage.mock.calls.length;
    const snapshot = manager.getSessionSnapshot(identity);

    expect(snapshot).toMatchObject({
      platformKey: identity.platformKey,
      accountId: identity.accountId,
      sessionExists: true,
      contextDebugId: session.contextDebugId,
      canonicalPageDebugId: session.pageDebugId,
      browserConnected: true,
      contextExists: true,
      contextPageCount: 1,
      canonicalPageExists: true,
      canonicalPageClosed: false,
      canonicalPageContextMatchesSession: true,
      runtimeAuthState: "AUTHENTICATED",
      contextLaunchCount: 1,
      canonicalPagePromotionCount: 1
    });
    expect(newPage.mock.calls.length).toBe(beforeNewPageCalls);
    expect(snapshot).not.toHaveProperty("cookies");
    expect(snapshot).not.toHaveProperty("storageState");
    expect(snapshot).not.toHaveProperty("token");
  });

  it("enumerates every existing Context Page with stable diagnostic identities without creating a Page", async () => {
    const canonicalPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "https://creator.xiaohongshu.com/"), context: vi.fn() };
    const secondPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image"), context: vi.fn() };
    const newPage = vi.fn(async () => canonicalPage);
    const context = {
      setDefaultTimeout: vi.fn(),
      newPage,
      pages: vi.fn(() => [canonicalPage, secondPage]),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    canonicalPage.context.mockReturnValue(context);
    secondPage.context.mockReturnValue(context);
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });
    const identity = { platformKey: "xiaohongshu", accountId: "context-inventory-account" };
    const session = await manager.open(identity, userAction);

    const first = manager.getContextPages(identity);
    const second = manager.getContextPages(identity);

    expect(first).toHaveLength(2);
    expect(first?.[0]).toMatchObject({ page: canonicalPage, pageIndex: 0, pageDebugId: session.pageDebugId, isCanonical: true });
    expect(first?.[1]).toMatchObject({ page: secondPage, pageIndex: 1, isCanonical: false });
    expect(first?.[1]?.pageDebugId).toEqual(second?.[1]?.pageDebugId);
    expect(first?.[1]?.pageDebugId).not.toEqual(first?.[0]?.pageDebugId);
    expect(newPage).toHaveBeenCalledTimes(1);
  });

  it("records read-only Context page creation events with sanitized route fields", async () => {
    let pages: unknown[] = [];
    let pageListener: ((page: unknown) => void) | undefined;
    const canonicalPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "https://creator.xiaohongshu.com/"), context: vi.fn() };
    const secondPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "https://creator.xiaohongshu.com/publish/publish?target=image&token=drop"), context: vi.fn() };
    const context = {
      setDefaultTimeout: vi.fn(),
      on: vi.fn((event: string, listener: (page: unknown) => void) => { if (event === "page") pageListener = listener; }),
      off: vi.fn(),
      newPage: vi.fn(async () => canonicalPage),
      pages: vi.fn(() => pages),
      close: vi.fn(async () => undefined)
    } as unknown as BrowserContext;
    canonicalPage.context.mockReturnValue(context);
    secondPage.context.mockReturnValue(context);
    pages = [canonicalPage];
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });
    const identity = { platformKey: "xiaohongshu", accountId: "context-page-event-account" };
    const session = await manager.open(identity, userAction);
    pages = [canonicalPage, secondPage];
    pageListener?.(secondPage);

    const events = manager.getContextPageLifecycleEvents(identity);
    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({ phase: "CONTEXT_PAGE_CREATED", accountId: identity.accountId, contextDebugId: session.contextDebugId, pageIndex: 1, pageCount: 2, pageUrlOrigin: "https://creator.xiaohongshu.com", pageUrlPathname: "/publish/publish" });
    expect(JSON.stringify(events)).not.toMatch(/token|cookie|storage/iu);
  });

  it("keeps launch count stable when an existing canonical session is reused", async () => {
    const page = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), context: vi.fn() };
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), pages: vi.fn(() => [page]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
    page.context.mockReturnValue(context);
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const launchBrowser = vi.fn(async () => browser);
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser });
    const identity = { platformKey: "xiaohongshu", accountId: "reuse-count-account" };

    await manager.open(identity, userAction);
    await manager.open(identity, userAction);

    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(manager.getSessionSnapshot(identity).contextLaunchCount).toBe(1);
  });

  it("records an attributed disconnect and clears the live session without inventing identity", async () => {
    let disconnected: (() => void) | undefined;
    let browserConnected = true;
    const page = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), context: vi.fn() };
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), pages: vi.fn(() => [page]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
    page.context.mockReturnValue(context);
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
      isConnected: vi.fn(() => browserConnected),
      on: vi.fn((event: string, listener: () => void) => { if (event === "disconnected") disconnected = listener; })
    } as unknown as Browser;
    const events: BrowserSessionLifecycleEvent[] = [];
    const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser), onSessionLifecycle: (event) => events.push(event) });
    const identity = { platformKey: "xiaohongshu", accountId: "disconnect-snapshot-account" };
    const session = await manager.open(identity, userAction);

    browserConnected = false;
    disconnected?.();

    expect(events.at(-1)).toMatchObject({ phase: "CONTEXT_DISCONNECTED", platformKey: identity.platformKey, accountId: identity.accountId, contextDebugId: session.contextDebugId });
    expect(manager.getSessionSnapshot(identity)).toMatchObject({ sessionExists: false, runtimeAuthState: "DISCONNECTED", lastDisconnectContextDebugId: session.contextDebugId, lastDisconnectReason: "UNEXPECTED_BROWSER_DISCONNECT" });
  });

  it("reports missing and closed canonical Page liveness without cold-opening a session", async () => {
    const manager = new BrowserSessionManager(new MemoryCredentialStore());
    const missing = manager.getSessionSnapshot({ platformKey: "xiaohongshu", accountId: "missing-snapshot-account" });
    expect(missing).toMatchObject({ sessionExists: false, contextExists: false, canonicalPageExists: false, canonicalPageClosed: null, canonicalPageContextMatchesSession: null, runtimeAuthState: "UNVERIFIED", contextLaunchCount: 0 });

    let pageClosed = false;
    const page = { isClosed: vi.fn(() => pageClosed), url: vi.fn(() => "about:blank"), context: vi.fn() };
    const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), pages: vi.fn(() => [page]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
    const foreignContext = {} as BrowserContext;
    page.context.mockReturnValue(context);
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
    const identity = { platformKey: "xiaohongshu", accountId: "closed-snapshot-account" };
    const activeManager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });
    await activeManager.open(identity, userAction);
    pageClosed = true;
    page.context.mockReturnValue(foreignContext);
    expect(activeManager.getSessionSnapshot(identity)).toMatchObject({ sessionExists: true, canonicalPageExists: true, canonicalPageClosed: true, canonicalPageContextMatchesSession: false, contextPageCount: 1 });
  });
});
