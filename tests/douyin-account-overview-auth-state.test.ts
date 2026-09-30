import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import { BrowserSessionManager, type BrowserSession } from "@publisher/adapters-core";
import { DouyinImageTextBrowserAdapter } from "../packages/adapters/douyin/src/image-text-browser";
import { openDatabase } from "@publisher/db";
import { connectedAccountsForPlatform } from "../apps/desktop/src/renderer/v11-ui-model";
import type { IpcDependencies } from "../apps/desktop/src/main/ipc";

const handlers = vi.hoisted(() => new Map<string, (_event: unknown, payload: unknown) => Promise<unknown>>());
vi.mock("electron", () => ({ ipcMain: {
  removeHandler: (channel: string) => handlers.delete(channel),
  handle: (channel: string, handler: (_event: unknown, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); }
}, app: { getPath: () => "" }, dialog: {}, shell: {} }));

import { registerIpc } from "../apps/desktop/src/main/ipc";

const temporaryDirectories: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open !== false) db.close();
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Douyin image/text account overview", () => {
  it("rechecks the owned Creator identity before making the account selectable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-douyin-auth-overview-")); temporaryDirectories.push(dir);
    const opened = openDatabase(join(dir, "publisher.db"), join(process.cwd(), "packages", "db", "migrations"));
    databases.push(opened.db);
    const { repository } = opened;
    repository.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
    const account = repository.createAccount({ platformKey: "douyin", name: "Owner" });
    const other = repository.createAccount({ platformKey: "douyin", name: "Other" });
    repository.updateAccount(other.id, { loginStatus: "logged_in" });
    repository.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "72388977613", browserSessionIdHash: "owned-session" });
    repository.updateAccount(account.id, { loginStatus: "logged_in" });
    const credentials = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false };
    const manager = new BrowserSessionManager(credentials);
    const adapter = new DouyinImageTextBrowserAdapter({ sessionManager: manager });
    const registry = { getAccountConnectionMode: () => null, tryGetForConnection: () => null,
      tryGet: (platformKey: string) => platformKey === "douyin" ? adapter : null,
      getForContent: () => adapter };
    registerIpc({ repository, publisher: {}, scheduler: {}, registry, resolveAccountSecrets: () => ({}),
      dataDirectory: dir, coverDir: dir, logger: { info: () => {}, warn: () => {}, error: () => {} },
      credentials, aiCredentials: {}, appLogPath: "", databasePath: join(dir, "publisher.db") } as unknown as IpcDependencies);
    const overview = async () => {
      const handler = handlers.get("accounts:overview");
      if (!handler) throw new Error("accounts:overview is missing");
      return await handler({}, {}) as Array<{ account: typeof account; accountStatus: string; imageTextCreatorReady: boolean }>;
    };

    const storedFlagRows = await overview();
    expect(storedFlagRows.find((row) => row.account.id === account.id)).toMatchObject({ imageTextCreatorReady: false,
      accountStatus: "Unverified" });
    expect(storedFlagRows.find((row) => row.account.id === other.id)).toMatchObject({ imageTextCreatorReady: false,
      accountStatus: "Unverified" });
    expect(connectedAccountsForPlatform(storedFlagRows.map((row) => ({ ...row.account,
      accountStatus: row.accountStatus, imageTextCreatorReady: row.imageTextCreatorReady })), "douyin")).toEqual([]);
    repository.updateAccount(account.id, { loginStatus: "expired" });
    let url = "https://creator.douyin.com/creator-micro/home";
    let visibleId = "72388977613";
    let closed = false;
    const context = { pages: () => closed ? [] : [page] };
    const page = { url: () => url, isClosed: () => closed, context: () => context,
      locator: () => ({ innerText: async () => `抖音号：${visibleId}` }) } as unknown as Page;
    const session = { context, page, browser: { isConnected: () => true }, executionMode: "VISIBLE",
      sessionIdHash: "owned-session" } as unknown as BrowserSession;
    manager.setActiveSession({ platformKey: "douyin", accountId: account.id }, session);

    const verifiedRows = await overview();
    const verified = verifiedRows.find((row) => row.account.id === account.id);
    expect(verified).toMatchObject({ accountStatus: "Connected", imageTextCreatorReady: true });
    expect(manager.getRuntimeAuthState({ platformKey: "douyin", accountId: account.id }).state).toBe("AUTHENTICATED");
    expect(connectedAccountsForPlatform(verifiedRows.map((row) => ({ ...row.account,
      accountStatus: row.accountStatus, imageTextCreatorReady: row.imageTextCreatorReady })), "douyin").map((row) => row.id)).toEqual([account.id]);
    expect(verifiedRows.find((row) => row.account.id === other.id)?.imageTextCreatorReady).toBe(false);

    manager.setRuntimeAuthState({ platformKey: "douyin", accountId: account.id }, "UNVERIFIED", null);
    vi.spyOn(adapter, "completeConnection").mockResolvedValue("logged_in");
    vi.spyOn(adapter, "getAccountProfile").mockResolvedValue({ accountId: "72388977613", accountName: "Owner" });
    vi.spyOn(adapter, "getBrowserSessionEvidence").mockResolvedValue({ accountId: account.id,
      platformKey: "douyin", sessionIdHash: "owned-session" } as unknown as Awaited<ReturnType<typeof adapter.getBrowserSessionEvidence>>);
    const completeLogin = handlers.get("accounts:complete-login");
    if (!completeLogin) throw new Error("accounts:complete-login is missing");
    await expect(completeLogin({}, { accountId: account.id, platformKey: "douyin", contentKind: "article", callbackUrl: "",
      pendingLogin: { accountId: account.id, platformKey: "douyin", contentKind: "article" } })).resolves.toMatchObject({ accountStatus: "Connected" });
    expect(manager.getRuntimeAuthState({ platformKey: "douyin", accountId: account.id }).state).toBe("AUTHENTICATED");

    visibleId = "11111111111";
    expect((await overview()).find((row) => row.account.id === account.id)?.imageTextCreatorReady).toBe(false);
    url = "https://creator.douyin.com/login";
    expect((await overview()).find((row) => row.account.id === account.id)?.imageTextCreatorReady).toBe(false);
    closed = true;
    expect((await overview()).find((row) => row.account.id === account.id)?.imageTextCreatorReady).toBe(false);
    manager.clearActiveSession({ platformKey: "douyin", accountId: account.id }, session);
    expect((await overview()).find((row) => row.account.id === account.id)?.imageTextCreatorReady).toBe(false);
  });
});
