import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrowserSessionManager, browserSessionIdHash, isAutomationAdapter } from "@publisher/adapters-core";
import { BaijiahaoBrowserAdapter } from "@publisher/adapters-baijiahao/browser";
import { BilibiliBrowserAdapter } from "@publisher/adapters-bilibili/browser";
import { QqPublicBrowserAdapter } from "@publisher/adapters-qq-public/browser";
import { SohuBrowserAdapter } from "@publisher/adapters-sohu-media/browser";
import { WeiboBrowserAdapter } from "@publisher/adapters-weibo/browser";
import { ZhihuBrowserAdapter } from "@publisher/adapters-zhihu/browser";
import { SafeStorageCredentialStore, type CredentialStore, type SafeStoragePort } from "@publisher/security";

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

class FakeSafeStorage implements SafeStoragePort {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from("v10:" + value, "utf8"); }
  decryptString(value: Buffer): string { return value.toString("utf8").replace(/^v10:/, ""); }
}

describe("V1.0 Browser Automation Hub", () => {
  it("declares the six first-batch platforms as BrowserAutomation without claiming publish proof", () => {
    const store = new MemoryCredentialStore();
    const adapters = [
      new ZhihuBrowserAdapter({ credentialStore: store }),
      new BaijiahaoBrowserAdapter({ credentialStore: store }),
      new WeiboBrowserAdapter({ credentialStore: store }),
      new SohuBrowserAdapter({ credentialStore: store }),
      new QqPublicBrowserAdapter({ credentialStore: store }),
      new BilibiliBrowserAdapter({ credentialStore: store })
    ];
    expect(adapters.map((adapter) => adapter.platformKey)).toEqual(["zhihu", "baijiahao", "weibo", "sohu_media", "qq_public", "bilibili"]);
    for (const adapter of adapters) {
      expect(isAutomationAdapter(adapter)).toBe(true);
      expect(adapter.manifest).toMatchObject({ transport: "browser", integrationMode: "BrowserAutomation", status: "WaitingForUser", adapterStatus: "ready" });
      expect(adapter.getCredentialSchema()[0]?.type).toBe("browser_login");
    }
  });

  it("opens an owned visible Page and waits for user login when no encrypted session exists", async () => {
    const currentUrl = "https://www.zhihu.com/signin";
    const page = { goto: vi.fn(async () => undefined), url: vi.fn(() => currentUrl) };
    const session = { page, context: { pages: vi.fn(() => [page]) }, sessionIdHash: "owned-session", executionMode: "VISIBLE" as const, headless: false };
    const manager = {
      hasStoredSession: vi.fn(() => false),
      open: vi.fn(async () => session),
      save: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      closeAll: vi.fn(async () => undefined),
      clear: vi.fn()
    } as unknown as BrowserSessionManager;
    const adapter = new ZhihuBrowserAdapter({ sessionManager: manager });
    const context = { accountId: "account-1", accountName: "自有账号", platformKey: "zhihu", settings: { userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "RUN_SELF_TEST" as const } };
    await expect(adapter.checkSession(context)).resolves.toBe("needs_user_action");
    expect(manager.open).toHaveBeenCalledWith({ platformKey: "zhihu", accountId: "account-1" }, context.settings, "VISIBLE");
    expect(manager.close).not.toHaveBeenCalled();
    await adapter.closeOwnedSessions();
    expect(manager.closeAll).toHaveBeenCalledTimes(1);
  });

  it("persists storageState through the encrypted CredentialStore boundary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v10-session-"));
    try {
      const store = new SafeStorageCredentialStore(join(dir, "credentials.json"), new FakeSafeStorage());
      const manager = new BrowserSessionManager(store);
      const identity = { platformKey: "zhihu", accountId: "account-1" };
      const state = { cookies: [{ name: "session", value: "cookie-secret", domain: ".example.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }], origins: [] };
      const context = { storageState: vi.fn(async () => state) };

      await manager.save(identity, context as unknown as Parameters<BrowserSessionManager["save"]>[1]);

      expect(readFileSync(join(dir, "credentials.json"), "utf8")).not.toContain("cookie-secret");
      expect(JSON.parse(store.get("session:zhihu:account-1") ?? "{}")).toEqual(state);
      expect(manager.hasStoredSession(identity)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses a stable hash for audit records and never exposes the session key", () => {
    const hash = browserSessionIdHash({ platformKey: "zhihu", accountId: "account-1" });
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("zhihu");
    expect(hash).not.toContain("account-1");
  });
});
