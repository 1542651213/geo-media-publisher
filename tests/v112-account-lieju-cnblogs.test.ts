import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserContext } from "playwright-core";
import { BrowserSessionManager, browserSessionCredentialKey, browserSessionIdHash } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { defaultAccountSelection } from "@publisher/domain";
import { createRuntimeAdapterRegistry } from "../apps/desktop/src/main/adapter-registry";
import { accountCenterPriority, orderPlatformCatalog, searchOrderedPlatforms } from "../apps/desktop/src/renderer/v11-ui-model";
import { SafeStorageCredentialStore, type CredentialStore } from "@publisher/security";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const openDatabases: Array<{ close: () => void; open?: boolean }> = [];

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  has(key: string): boolean { return this.values.has(key); }
}

function openProductionCatalog() {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v112-")); tempDirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), migrationDir); openDatabases.push(opened.db);
  opened.repository.seedPlatformCatalog(platformCsv);
  const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), false);
  opened.repository.syncAdapterManifests(registry.list().map((adapter) => ({ manifest: adapter.manifest, capabilities: adapter.getCapabilities() })));
  opened.repository.reconcileAdapterRegistrations(registry.list().map((adapter) => adapter.platformKey));
  return { ...opened, registry, dir };
}

afterEach(() => { for (const db of openDatabases.splice(0)) if (db.open !== false) db.close(); for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("V1.1.2 account priority and 41-platform catalog", () => {
  it("orders connected first, connectable before manual, then favorite/recent/name without changing search", () => {
    const { repository } = openProductionCatalog();
    const zhihu = repository.createAccount({ platformKey: "zhihu", name: "知乎主账号" });
    repository.syncBrowserPlatformAccount({ accountId: zhihu.id, platformKey: "zhihu", browserSessionId: "zhihu-session" });
    const platforms = repository.listPlatforms();
    const accounts = repository.listAccounts();
    const ordered = orderPlatformCatalog(platforms, ["weibo"], accounts);
    expect(ordered[0]?.platformKey).toBe("zhihu");
    expect(accountCenterPriority(ordered[0]!, accounts)).toBe("CONNECTED");
    expect(ordered.findIndex((platform) => platform.platformKey === "weibo")).toBeLessThan(ordered.findIndex((platform) => platform.platformKey === "yidian"));
    expect(ordered.filter((platform) => accountCenterPriority(platform, accounts) === "CONNECTABLE")[0]?.platformKey).toBe("weibo");
    expect(accountCenterPriority(platforms.find((platform) => platform.platformKey === "lieju")!, accounts)).toBe("CONNECTABLE");
    expect(accountCenterPriority(platforms.find((platform) => platform.platformKey === "cnblogs")!, accounts)).toBe("CONFIG_REQUIRED");
    expect(searchOrderedPlatforms(ordered, "列举").map((platform) => platform.platformKey)).toEqual(["lieju"]);
  });

  it("keeps all original platforms and exposes exactly 41 production platforms", () => {
    const { repository, registry } = openProductionCatalog();
    const platforms = repository.listPlatforms();
    expect(platforms).toHaveLength(41);
    expect(new Set(platforms.map((platform) => platform.platformKey)).size).toBe(41);
    expect(registry.get("lieju").manifest).toMatchObject({ integrationMode: "BrowserAutomation", transport: "browser" });
    expect(registry.get("cnblogs").manifest).toMatchObject({ integrationMode: "API", transport: "official_api", authStrategy: "AppCredential" });
    expect(registry.get("zhihu").manifest.version).toBe("1.1.6");
  });
});

describe("V1.1.2 Lieju multi-account isolation", () => {
  it("carries 13 aliases and isolates relogin/disconnect by platformAccountId", () => {
    const { repository } = openProductionCatalog();
    const accounts = Array.from({ length: 13 }, (_, index) => repository.createAccount({ platformKey: "lieju", name: `列举网-${String(index + 1).padStart(2, "0")}` }));
    expect(repository.listAccounts().filter((account) => account.platformKey === "lieju")).toHaveLength(13);
    expect(accounts[12]).toMatchObject({ accountAlias: "列举网-13", accountName: null });

    const first = repository.syncBrowserPlatformAccount({ accountId: accounts[0]!.id, platformKey: "lieju", accountName: "平台账号甲", externalAccountId: "lieju-a", browserSessionId: "session-a" });
    const second = repository.syncBrowserPlatformAccount({ accountId: accounts[1]!.id, platformKey: "lieju", accountName: "平台账号乙", externalAccountId: "lieju-b", browserSessionId: "session-b" });
    expect(first.platformAccountId).not.toBe(second.platformAccountId);
    repository.syncBrowserPlatformAccount({ accountId: first.id, platformKey: "lieju", accountName: "平台账号甲", externalAccountId: "lieju-a", browserSessionId: "session-a-renewed" });
    expect(repository.listAccounts().find((account) => account.id === second.id)?.browserSessionId).toBe("session-b");
    repository.markPlatformAccountDisconnected(first.id, "lieju");
    expect(repository.getAccountById(first.id, "lieju")?.browserSessionId).toBeNull();
    expect(repository.listAccounts().find((account) => account.id === second.id)).toMatchObject({ loginStatus: "logged_in", browserSessionId: "session-b" });
  });

  it("uses different encrypted storage keys and clearing one Session leaves the other intact", async () => {
    const store = new MemoryCredentialStore();
    const manager = new BrowserSessionManager(store);
    const first = { platformKey: "lieju", accountId: "account-01" };
    const second = { platformKey: "lieju", accountId: "account-02" };
    const contextA = { storageState: async () => ({ cookies: [{ name: "session", value: "a", domain: ".lieju.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }], origins: [] }) } as unknown as BrowserContext;
    const contextB = { storageState: async () => ({ cookies: [{ name: "session", value: "b", domain: ".lieju.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }], origins: [] }) } as unknown as BrowserContext;
    await manager.save(first, contextA); await manager.save(second, contextB);
    expect(browserSessionCredentialKey(first)).not.toBe(browserSessionCredentialKey(second));
    expect(browserSessionIdHash(first)).not.toBe(browserSessionIdHash(second));
    manager.clear(first);
    expect(store.has(browserSessionCredentialKey(first))).toBe(false);
    expect(store.has(browserSessionCredentialKey(second))).toBe(true);
  });

  it("creates one persistent Job per selected Lieju account", () => {
    const { repository } = openProductionCatalog();
    const brand = repository.createBrand({ name: "品牌", companyName: "公司" });
    const first = repository.createAccount({ platformKey: "lieju", name: "列举网-01" });
    const second = repository.createAccount({ platformKey: "lieju", name: "列举网-02" });
    repository.syncBrowserPlatformAccount({ accountId: first.id, platformKey: "lieju", browserSessionId: "session-1" });
    repository.syncBrowserPlatformAccount({ accountId: second.id, platformKey: "lieju", browserSessionId: "session-2" });
    repository.setSetting("contentReviewMode", "Off");
    const article = repository.createArticle({ brandId: brand.id, topic: "主题", keyword: "关键词", city: "苏州", title: "标题", body: "正文", summary: "", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "excel_import", aiModel: "1.0", generatedAt: new Date().toISOString(), reusePolicy: "same_platform_different_account", contentHash: "lieju-multi-job" });
    if (!article) throw new Error("article not created");
    const jobs = [first, second].map((account) => repository.createArticlePublishJob({ articleId: article.id, platformKey: "lieju", platformAccountId: account.id }));
    expect(new Set(jobs.map((job) => job.id)).size).toBe(2);
    expect(new Set(jobs.map((job) => job.platformAccountId)).size).toBe(2);
    expect(jobs.every((job) => job.status === "AwaitingConfirmation")).toBe(true);
  });
});

describe("V1.1.2 CNBlogs credential and article flow", () => {
  it("encrypts PAT storage and the preload exposes status/actions but no credential getter", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-v112-pat-")); tempDirs.push(dir);
    const path = join(dir, "credentials.enc");
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`protected:${Buffer.from(value).toString("base64")}`), decryptString: (value: Buffer) => Buffer.from(value.toString().replace(/^protected:/u, ""), "base64").toString() };
    const store = new SafeStorageCredentialStore(path, safeStorage);
    store.set("account:cnblogs-1:cnblogs:pat", "sensitive-test-pat");
    expect(readFileSync(path, "utf8")).not.toContain("sensitive-test-pat");
    const preload = readFileSync(join(process.cwd(), "apps", "desktop", "src", "main", "preload.ts"), "utf8");
    expect(preload).toContain("credentialStatus");
    expect(preload).not.toMatch(/getCredentials|getCredentialValue|readSecret/u);
  });

  it("auto-selects one CNBlogs account and imports simple Excel content into its publish Job", () => {
    const { repository } = openProductionCatalog();
    const brand = repository.createBrand({ name: "品牌", companyName: "公司" });
    const account = repository.createAccount({ platformKey: "cnblogs", name: "博客园账号" });
    repository.syncOfficialApiAccount({ accountId: account.id, platformKey: "cnblogs", accountName: "demo-blog" });
    expect(defaultAccountSelection(repository.listAccounts().filter((item) => item.platformKey === "cnblogs"))).toEqual({ selectedAccountId: account.id, requiresChoice: false });
    const preview = repository.previewExcelArticleImport({ fileName: "简易模板.xlsx", rows: [{ rowNumber: 2, templateVersion: "1.0", title: "Excel 标题", body: "第一段\n第二段", summary: "", company: brand.companyName, business: "", city: "", keywords: "", tags: "", targetPlatforms: "cnblogs", contentType: "", promotionStrength: "", sourceNote: "" }] });
    const imported = repository.confirmExcelArticleImport({ preview });
    const article = repository.getArticle(imported.articleIds[0]!);
    if (!article) throw new Error("Excel article not imported");
    repository.setSetting("contentReviewMode", "Off");
    const job = repository.createArticlePublishJob({ articleId: article.id, platformKey: "cnblogs", platformAccountId: account.id });
    expect(job).toMatchObject({ platformKey: "cnblogs", articleId: article.id, platformAccountId: account.id, status: "AwaitingConfirmation" });
  });

  it("keeps ConnectionPassed distinct from PublishPassed", () => {
    const { repository } = openProductionCatalog();
    const account = repository.createAccount({ platformKey: "cnblogs", name: "博客园账号" });
    repository.syncOfficialApiAccount({ accountId: account.id, platformKey: "cnblogs", accountName: "demo-blog" });
    expect(repository.listAccounts().find((item) => item.id === account.id)).toMatchObject({ loginStatus: "logged_in", connectionMode: "OfficialAPI", authorizationStatus: "Authorized" });
    expect(repository.getPublishRecords().filter((record) => record.accountId === account.id)).toHaveLength(0);
  });
});
