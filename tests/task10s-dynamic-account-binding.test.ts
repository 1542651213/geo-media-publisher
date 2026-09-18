import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@publisher/adapters-core";
import { createOwnerAuthorizedOneShotPublication, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE } from "@publisher/adapters-core";
import type { Account } from "@publisher/domain";
import { XhsIdentityService } from "../apps/desktop/src/main/xhs-identity";

const ACCOUNT_A = "account-a";
const ACCOUNT_B = "account-b";
const CREATOR_A = "creator-a";
const CREATOR_B = "creator-b";

function account(id: string, creatorId: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    platformAccountId: id,
    platformKey: "xiaohongshu",
    accountAlias: id,
    accountName: id,
    name: id,
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
    browserSessionId: `${id}-session`,
    externalAccountId: creatorId,
    archivedAt: null,
    ...overrides
  };
}

function observation(accountId: string, creatorId: string) {
  return {
    canonicalContextId: `${accountId}-context`,
    canonicalPageId: `${accountId}-page`,
    canonicalPageUrl: "https://creator.xiaohongshu.com/new/home",
    domLocationHref: "https://creator.xiaohongshu.com/new/home",
    pageUrlConsistency: "PASS" as const,
    routeClass: "CREATOR_HOME" as const,
    runtimeAuthState: "AUTHENTICATED" as const,
    browserConnected: true,
    pageClosed: false,
    proof: {
      platformKey: "xiaohongshu" as const,
      externalCreatorId: creatorId,
      displayName: accountId,
      profileUrl: `https://creator.xiaohongshu.com/user/profile/${creatorId}`,
      source: "CREATOR_PROFILE_LINK" as const,
      stable: true
    }
  };
}

function identityService(current: Account, observedCreatorId = current.externalAccountId ?? "") {
  const reader = { readCanonicalCreatorIdentity: vi.fn(async () => observation(current.id, observedCreatorId)) };
  const repository = {
    getAccountById: vi.fn(() => current),
    getPlatformAccountIdentityBinding: vi.fn(() => null),
    bindPlatformAccountIdentity: vi.fn(),
    convergeUnusedOneShotAuthorization: vi.fn(() => ({ reusableOperationId: null, supersededOperationIds: [], activeUnusedAuthorizationCount: 0, mutationCount: 0 }))
  };
  const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
  return { service: new XhsIdentityService({ repository, registry }), repository };
}

describe("r47 dynamic XHS account binding", () => {
  it("accepts a selected XHS account without a historical fixed-account gate", async () => {
    const fixture = identityService(account(ACCOUNT_A, CREATOR_A));
    await expect(fixture.service.verifyCreatorIdentity(ACCOUNT_A)).resolves.toMatchObject({
      expectedExternalCreatorId: CREATOR_A,
      observed: { externalCreatorId: CREATOR_A },
      verified: true,
      mismatch: false
    });
  });

  it("keeps creator identity bound to the selected account and rejects creator B", async () => {
    const mismatch = identityService(account(ACCOUNT_A, CREATOR_A), CREATOR_B);
    await expect(mismatch.service.verifyAndConverge(ACCOUNT_A)).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_MISMATCH" });
  });

  it("allows one-shot authorization for either selected XHS account and binds its account ID", () => {
    const first = createOwnerAuthorizedOneShotPublication({ platformKey: "xiaohongshu", accountId: ACCOUNT_A, operationId: "run-a", mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
    const second = createOwnerAuthorizedOneShotPublication({ platformKey: "xiaohongshu", accountId: ACCOUNT_B, operationId: "run-b", mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
    expect(first.accountId).toBe(ACCOUNT_A);
    expect(second.accountId).toBe(ACCOUNT_B);
  });

  it("has no historical fixed account or creator literal in production runtime sources", () => {
    const productionFiles = [
      "apps/desktop/src/main/xhs-identity.ts",
      "apps/desktop/src/main/platform-self-test.ts",
      "apps/desktop/src/main/main.ts",
      "apps/desktop/src/main/ipc.ts",
      "apps/desktop/src/main/preload.ts",
      "apps/desktop/src/shared/controlled-self-test-entry.ts",
      "packages/adapters/core/src/one-shot-publication.ts"
    ];
    const source = productionFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(source).not.toContain("123456789");
    expect(source).not.toContain("小红书身份证明只允许指定测试账号");
  });
});
