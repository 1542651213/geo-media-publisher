import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Account, PlatformAccountIdentityBinding } from "@publisher/domain";
const XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID = "historical-test-account";
import type { XiaohongshuCreatorIdentityObservation } from "../packages/adapters/xiaohongshu/src/browser";
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
  externalAccountId: "123456789",
  lastVerifiedAt: new Date().toISOString(),
  lastUsedAt: null,
  archivedAt: null
};

function observation(externalCreatorId: string | null, runtimeAuthState: XiaohongshuCreatorIdentityObservation["runtimeAuthState"] = "AUTHENTICATED"): XiaohongshuCreatorIdentityObservation {
  return {
    canonicalContextId: "context-1",
    canonicalPageId: "page-1",
    canonicalPageUrl: "https://creator.xiaohongshu.com/new/home",
    domLocationHref: "https://creator.xiaohongshu.com/new/home",
    pageUrlConsistency: "PASS",
    routeClass: "CREATOR_HOME",
    runtimeAuthState,
    browserConnected: true,
    pageClosed: false,
    proof: { platformKey: "xiaohongshu", externalCreatorId, displayName: "测试账号", profileUrl: "https://creator.xiaohongshu.com/user/profile/123456789", source: "CREATOR_PROFILE_LINK", stable: externalCreatorId !== null }
  };
}

function binding(externalCreatorId: string): PlatformAccountIdentityBinding {
  const timestamp = new Date().toISOString();
  return { id: "binding-1", platformKey: "xiaohongshu", accountId: account.id, externalCreatorId, displayName: "测试账号", profileUrl: "https://creator.xiaohongshu.com/user/profile/123456789", bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH", boundAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
}

function setup(input: { observedId: string | null; expectedId?: string | null; existingBinding?: PlatformAccountIdentityBinding | null; runtimeAuthState?: XiaohongshuCreatorIdentityObservation["runtimeAuthState"] } = { observedId: "123456789" }) {
  const reader = { readCanonicalCreatorIdentity: vi.fn(async () => observation(input.observedId, input.runtimeAuthState)) };
  const repository = {
    getAccountById: vi.fn(() => input.expectedId === undefined ? account : { ...account, externalAccountId: input.expectedId }),
    getPlatformAccountIdentityBinding: vi.fn(() => input.existingBinding ?? null),
    bindPlatformAccountIdentity: vi.fn((value: { externalCreatorId: string }) => binding(value.externalCreatorId)),
    convergeUnusedOneShotAuthorization: vi.fn(() => ({ reusableOperationId: "run-newest", supersededOperationIds: ["run-old"], activeUnusedAuthorizationCount: 1, mutationCount: 1 }))
  };
  const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
  return { reader, repository, registry, service: new XhsIdentityService({ repository, registry }) };
}

describe("Task10V XHS identity proof", () => {
  it("invokes bootstrap on the repository instance for existing bindings", async () => {
    const boundAccount = { ...account };
    const existingBinding = binding("123456789");
    const reader = {
      verifyIdentityOnContextPage: vi.fn(async () => ({ status: "PASS", failureCode: null, proof: {
        browserSessionId: "session-a",
        contextId: "context-1",
        pageId: "page-home",
        pageOrigin: "https://creator.xiaohongshu.com",
        pagePathname: "/new/home",
        creatorId: "123456789",
        verifiedAt: "2026-09-07T08:00:00.000Z",
        expiresAt: "2026-09-07T08:05:00.000Z"
      } })),
      getBrowserRuntimeSnapshot: vi.fn(() => ({
        platformKey: "xiaohongshu",
        accountId: boundAccount.id,
        sessionExists: true,
        browserSessionIdentity: "session-a",
        contextDebugId: "context-1",
        canonicalPageDebugId: "page-draft",
        browserConnected: true,
        contextExists: true,
        contextPageCount: 2,
        canonicalPageExists: true,
        canonicalPageClosed: false,
        canonicalPageContextMatchesSession: true,
        runtimeAuthState: "AUTHENTICATED",
        contextLaunchCount: 1,
        canonicalPagePromotionCount: 1,
        activeOperation: null,
        mutexLocked: false,
        operationInProgress: false,
        lastDisconnectAt: null,
        lastDisconnectContextDebugId: null,
        lastDisconnectReason: null
      }))
    };
    const repository = {
      db: {},
      getAccountById: vi.fn(() => boundAccount),
      getPlatformAccountIdentityBinding: vi.fn(() => existingBinding),
      bindPlatformAccountIdentity: vi.fn(),
      convergeUnusedOneShotAuthorization: vi.fn(),
      bootstrapXhsCreatorIdentity(this: { db: object }, input: { accountId: string; observedCreatorId: string }) {
        if (!this.db) throw new TypeError("Cannot read properties of undefined (reading 'db')");
        expect(input.accountId).toBe(boundAccount.id);
        expect(input.observedCreatorId).toBe("123456789");
        return { account: boundAccount, binding: existingBinding };
      }
    };
    const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
    const service = new XhsIdentityService({ repository, registry });

    await expect(service.bootstrapCreatorIdentity(boundAccount.id)).resolves.toMatchObject({
      expectedExternalCreatorId: "123456789",
      observed: { externalCreatorId: "123456789" },
      verified: true,
      mismatch: false
    });
  });

  it("requires the stable Creator ID and converges only after an exact match", async () => {
    const fixture = setup();
    const result = await fixture.service.verifyAndConverge(account.id);

    expect(result.verification).toMatchObject({ expectedExternalCreatorId: "123456789", verified: true, mismatch: false, routeClass: "CREATOR_HOME" });
    expect(result.convergence).toMatchObject({ reusableOperationId: "run-newest", activeUnusedAuthorizationCount: 1 });
    expect(fixture.repository.bindPlatformAccountIdentity).toHaveBeenCalledWith(expect.objectContaining({ externalCreatorId: "123456789", bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH" }));
    expect(fixture.repository.convergeUnusedOneShotAuthorization).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a different Creator ID without writing or converging", async () => {
    const fixture = setup({ observedId: "different-creator" });

    await expect(fixture.service.verifyAndConverge(account.id)).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_MISMATCH" });
    expect(fixture.repository.bindPlatformAccountIdentity).not.toHaveBeenCalled();
    expect(fixture.repository.convergeUnusedOneShotAuthorization).not.toHaveBeenCalled();
  });

  it("rejects conflicting stored identity metadata without overwriting either source", async () => {
    const fixture = setup({ observedId: "123456789", existingBinding: binding("different-stored-creator") });

    await expect(fixture.service.verifyAndConverge(account.id)).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_BINDING_CONFLICT" });
    expect(fixture.repository.bindPlatformAccountIdentity).not.toHaveBeenCalled();
    expect(fixture.repository.convergeUnusedOneShotAuthorization).not.toHaveBeenCalled();
  });

  it("requires explicit Owner approval before creating a first local binding", async () => {
    const fixture = setup({ observedId: "123456789", expectedId: null });

    await expect(fixture.service.verifyAndConverge(account.id)).rejects.toMatchObject({ code: "OWNER_APPROVAL_REQUIRED" });
    expect(fixture.repository.bindPlatformAccountIdentity).not.toHaveBeenCalled();
    await expect(fixture.service.verifyAndConverge(account.id, { ownerApproved: true })).resolves.toMatchObject({ verification: { verified: true } });
  });

  it("does not treat nickname-only evidence as a positive identity proof", async () => {
    const fixture = setup({ observedId: null });

    await expect(fixture.service.verifyAndConverge(account.id)).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_UNVERIFIED" });
    expect(fixture.repository.convergeUnusedOneShotAuthorization).not.toHaveBeenCalled();
  });

  it("accepts a fresh exact canonical identity proof when the manager has not classified the runtime yet", async () => {
    const fixture = setup({ observedId: "123456789", runtimeAuthState: "UNVERIFIED" });

    await expect(fixture.service.verifyCreatorIdentity(account.id)).resolves.toMatchObject({
      expectedExternalCreatorId: "123456789",
      observed: { externalCreatorId: "123456789" },
      verified: true,
      mismatch: false
    });
  });
});
