import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CredentialStore } from "@publisher/security";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

describe("runtime AdapterRegistry", () => {
  it("registers only real adapters in production and every key exists in PLATFORMS.csv", () => {
    const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), false);
    const keys = registry.list().map((adapter) => adapter.platformKey);
    const csvRows = readFileSync(join(process.cwd(), "PLATFORMS.csv"), "utf8").split(/\r?\n/u).slice(1).filter(Boolean).map((line) => line.split(","));
    const csvKeys = new Set(csvRows.map((row) => row[0]?.replace(/^\uFEFF/u, "")));
    const csvLifecycle = new Map(csvRows.map((row) => [row[0]?.replace(/^\uFEFF/u, ""), row[6]]));
    expect(keys).toEqual(["wechat_official", "douyin", "kuaishou", "bilibili", "youtube", "tiktok", "toutiao", "facebook", "weibo", "baijiahao", "zhihu", "sohu_media", "qq_public", "lieju", "cnblogs", "wechat_channels", "xiaohongshu"]);
    expect(keys.every((key) => csvKeys.has(key))).toBe(true);
    expect(registry.manifests().every((manifest) => csvLifecycle.get(manifest.platformKey) === manifest.status)).toBe(true);
    expect(registry.manifests().some((manifest) => manifest.platformKey === "test" || manifest.status === "Stable")).toBe(false);
  });

  it("adds TestPlatform only for development", () => {
    const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), true);
    expect(registry.list()).toHaveLength(18);
    expect(registry.get("test").manifest.status).toBe("Stable");
  });

  it("routes Toutiao video and article content to separate capability adapters", () => {
    const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), false);
    const video = registry.getForContent("toutiao", "video");
    const article = registry.getForContent("toutiao", "article");

    expect(video).not.toBe(article);
    expect(video.manifest).toMatchObject({ transport: "official_api", supportsArticle: false, supportsVideo: true });
    expect(article.manifest).toMatchObject({ transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false });
    expect(() => registry.getForContent("toutiao", "image")).toThrow(/unsupported content kind/i);
  });

  it("routes Xiaohongshu article content to BrowserAutomation and rejects video", () => {
    const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), false);
    const article = registry.getForContent("xiaohongshu", "article");
    expect(article.constructor.name).toBe("XiaohongshuBrowserAdapter");
    expect(article.manifest).toMatchObject({ platformKey: "xiaohongshu", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false });
    expect(() => registry.getForContent("xiaohongshu", "video")).toThrow(/no adapter registered/i);
  });

  it("reuses one long-lived Xiaohongshu adapter and BrowserSessionManager for both login IPC stages", () => {
    const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), false);
    const beginAdapter = registry.getForConnection("xiaohongshu") as unknown as { getBrowserConnectionDebugIds: () => { adapterDebugId: string; browserSessionManagerDebugId: string } };
    const completeAdapter = registry.getForConnection("xiaohongshu") as unknown as { getBrowserConnectionDebugIds: () => { adapterDebugId: string; browserSessionManagerDebugId: string } };

    expect(completeAdapter).toBe(beginAdapter);
    expect(completeAdapter.getBrowserConnectionDebugIds().adapterDebugId).toBe(beginAdapter.getBrowserConnectionDebugIds().adapterDebugId);
    expect(completeAdapter.getBrowserConnectionDebugIds().browserSessionManagerDebugId).toBe(beginAdapter.getBrowserConnectionDebugIds().browserSessionManagerDebugId);
  });

  it("registers the retained-context policy only for Xiaohongshu", () => {
    const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), false);
    const xhsManager = (registry.getForConnection("xiaohongshu") as unknown as {
      sessionManager: {
        retainsContextAfterPageClose: (identity: { platformKey: string; accountId: string }) => boolean;
        requiresActiveContextForOperations: (identity: { platformKey: string; accountId: string }) => boolean;
      };
    }).sessionManager;
    const sohuManager = (registry.getForConnection("sohu_media") as unknown as { sessionManager: typeof xhsManager }).sessionManager;

    expect(xhsManager.retainsContextAfterPageClose({ platformKey: "xiaohongshu", accountId: "account-a" })).toBe(true);
    expect(xhsManager.requiresActiveContextForOperations({ platformKey: "xiaohongshu", accountId: "account-a" })).toBe(true);
    expect(sohuManager.retainsContextAfterPageClose({ platformKey: "sohu_media", accountId: "account-a" })).toBe(false);
    expect(sohuManager.requiresActiveContextForOperations({ platformKey: "sohu_media", accountId: "account-a" })).toBe(false);
  });

  it("keeps ordinary Xiaohongshu separate from the historical merchant/private catalog rows", () => {
    const csvRows = readFileSync(join(process.cwd(), "PLATFORMS.csv"), "utf8").split(/\r?\n/u).slice(1).filter(Boolean).map((line) => line.split(","));
    const byKey = new Map(csvRows.map((row) => [row[0]?.replace(/^\uFEFF/u, ""), row]));
    expect(byKey.get("xiaohongshu")?.[1]).toBe("小红书");
    expect(byKey.get("xiaohongshu")?.[7]).toBe("browser");
    expect(byKey.get("xiaohongshu")?.[11]).toBe("BrowserAutomation");
    expect(byKey.get("xiaohongshu_business")?.[1]).toBe("小红书商家号");
    expect(byKey.get("xiaohongshu_private")?.[1]).toBe("小红书私信版");
    expect(byKey.get("xiaohongshu_business")?.[0]).not.toBe(byKey.get("xiaohongshu")?.[0]);
    expect(byKey.get("xiaohongshu_private")?.[0]).not.toBe(byKey.get("xiaohongshu")?.[0]);
  });
});
