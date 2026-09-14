import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Account } from "@publisher/domain";
const XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID = "historical-test-account";
import type { XiaohongshuCurrentImageEditorReadiness } from "@publisher/adapters-xiaohongshu/browser";
import { XhsIdentityService } from "../apps/desktop/src/main/xhs-identity";

const account: Account = {
  id: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID,
  platformAccountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID,
  platformKey: "xiaohongshu",
  accountAlias: "小红书测试账号",
  accountName: "测试账号",
  name: "小红书测试账号",
  groupId: null,
  enabled: true,
  loginStatus: "logged_in",
  pausedReason: null,
  lastLoginCheck: null,
  lastPublishAt: null,
  todayPublishCount: 0,
  allowAutoPublish: false,
  publishMode: "manual",
  minimumIntervalSeconds: 0,
  failedCount: 0,
  connectionMode: "BrowserAutomation",
  authorizationStatus: "Authorized",
  browserSessionId: "session-hash",
  externalAccountId: "960803317",
  lastVerifiedAt: new Date().toISOString(),
  lastUsedAt: null,
  archivedAt: null
};

describe("Task10S retained canonical Page editor readiness diagnostic", () => {
  it("routes the selected account-owned diagnostic through Main without accepting Page inputs", async () => {
    const readiness = { inspectionStatus: "PASS", accountId: account.id } as XiaohongshuCurrentImageEditorReadiness;
    const adapter = { inspectCurrentXiaohongshuImageEditorReadiness: vi.fn(async () => readiness) };
    const repository = {
      getAccountById: vi.fn(() => account),
      getPlatformAccountIdentityBinding: vi.fn(() => null),
      bindPlatformAccountIdentity: vi.fn(),
      convergeUnusedOneShotAuthorization: vi.fn()
    };
    const registry = { getForContent: vi.fn(() => adapter) } as unknown as AdapterRegistry;
    const service = new XhsIdentityService({ repository, registry });

    await expect(service.inspectCurrentXiaohongshuImageEditorReadiness(account.id)).resolves.toBe(readiness);
    expect(adapter.inspectCurrentXiaohongshuImageEditorReadiness).toHaveBeenCalledWith(expect.objectContaining({ accountId: account.id, platformKey: "xiaohongshu" }));
  });

  it("keeps the Renderer boundary account-id based and blocks selector, URL, script, and Page identity input", () => {
    const api = readFileSync("apps/desktop/src/shared/api.ts", "utf8");
    const preload = readFileSync("apps/desktop/src/main/preload.ts", "utf8");
    const ipc = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
    const adapter = readFileSync("packages/adapters/xiaohongshu/src/browser.ts", "utf8");

    expect(api).toContain("inspectCurrentXiaohongshuImageEditorReadiness(accountId: string): Promise<XiaohongshuCurrentImageEditorReadiness>");
    expect(preload).toContain("inspectCurrentXiaohongshuImageEditorReadiness: (accountId) => invoke(\"platform-self-test:inspect-current-xhs-image-editor-readiness\", { accountId })");
    expect(ipc).toContain('register("platform-self-test:inspect-current-xhs-image-editor-readiness", async (_event, payload) =>');
    expect(adapter).toContain("activeCanonicalPage(ctx)");
    expect(adapter).not.toContain("inspectCurrentXiaohongshuImageEditorReadiness(pageId");
    expect(adapter).not.toContain("inspectCurrentXiaohongshuImageEditorReadiness(url");
    expect(adapter).not.toContain("inspectCurrentXiaohongshuImageEditorReadiness(selector");
  });
});
