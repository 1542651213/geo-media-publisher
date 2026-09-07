import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Account, PlatformAccountIdentityBinding } from "@publisher/domain";
import { XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID } from "@publisher/domain";
import type { XiaohongshuCreatorIdentityObservation, XiaohongshuCurrentImageEditorReadiness } from "@publisher/adapters-xiaohongshu/browser";
import { XhsIdentityService } from "./xhs-identity";

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
    proof: { platformKey: "xiaohongshu", externalCreatorId, displayName: "测试账号", profileUrl: "https://creator.xiaohongshu.com/user/profile/960803317", source: "CREATOR_PROFILE_LINK", stable: externalCreatorId !== null }
  };
}

function binding(externalCreatorId: string): PlatformAccountIdentityBinding {
  const timestamp = new Date().toISOString();
  return { id: "binding-1", platformKey: "xiaohongshu", accountId: account.id, externalCreatorId, displayName: "测试账号", profileUrl: "https://creator.xiaohongshu.com/user/profile/960803317", bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH", boundAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
}

function setup(input: { observedId: string | null; expectedId?: string | null; existingBinding?: PlatformAccountIdentityBinding | null; runtimeAuthState?: XiaohongshuCreatorIdentityObservation["runtimeAuthState"] } = { observedId: "960803317" }) {
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
  it("routes the current publish-editor DOM diagnostic through the fixed account-owned adapter", async () => {
    const diagnostic = { inspectionStatus: "PASS", accountId: account.id };
    const reader = { inspectCurrentXiaohongshuPublishEditorDom: vi.fn(async () => diagnostic) };
    const repository = {
      getAccountById: vi.fn(() => account),
      getPlatformAccountIdentityBinding: vi.fn(() => null),
      bindPlatformAccountIdentity: vi.fn(),
      convergeUnusedOneShotAuthorization: vi.fn()
    };
    const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
    const service = new XhsIdentityService({ repository, registry });

    await expect(service.inspectCurrentXiaohongshuPublishEditorDom(account.id)).resolves.toBe(diagnostic);
    expect(reader.inspectCurrentXiaohongshuPublishEditorDom).toHaveBeenCalledWith(expect.objectContaining({ accountId: account.id, platformKey: "xiaohongshu" }));
  });

  it("routes semantic candidate evidence through the fixed account-owned adapter", async () => {
    const diagnostic = { inspectionStatus: "PASS", accountId: account.id };
    const reader = { inspectCurrentXiaohongshuPublishEditorSemanticCandidates: vi.fn(async () => diagnostic) };
    const repository = {
      getAccountById: vi.fn(() => account),
      getPlatformAccountIdentityBinding: vi.fn(() => null),
      bindPlatformAccountIdentity: vi.fn(),
      convergeUnusedOneShotAuthorization: vi.fn()
    };
    const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
    const service = new XhsIdentityService({ repository, registry });

    await expect(service.inspectCurrentXiaohongshuPublishEditorSemanticCandidates(account.id)).resolves.toBe(diagnostic);
    expect(reader.inspectCurrentXiaohongshuPublishEditorSemanticCandidates).toHaveBeenCalledWith(expect.objectContaining({ accountId: account.id, platformKey: "xiaohongshu" }));
  });

  it("routes the retained canonical-page readiness diagnostic through the account-owned adapter", async () => {
    const readiness = { inspectionStatus: "PASS", accountId: account.id } as XiaohongshuCurrentImageEditorReadiness;
    const reader = { inspectCurrentXiaohongshuImageEditorReadiness: vi.fn(async () => readiness) };
    const repository = {
      getAccountById: vi.fn(() => account),
      getPlatformAccountIdentityBinding: vi.fn(() => null),
      bindPlatformAccountIdentity: vi.fn(),
      convergeUnusedOneShotAuthorization: vi.fn()
    };
    const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
    const service = new XhsIdentityService({ repository, registry });

    await expect(service.inspectCurrentXiaohongshuImageEditorReadiness(account.id)).resolves.toBe(readiness);
    expect(reader.inspectCurrentXiaohongshuImageEditorReadiness).toHaveBeenCalledWith(expect.objectContaining({ accountId: account.id, platformKey: "xiaohongshu" }));
  });

  it("requires the stable Creator ID and converges only after an exact match", async () => {
    const fixture = setup();
    const result = await fixture.service.verifyAndConverge(account.id);

    expect(result.verification).toMatchObject({ expectedExternalCreatorId: "960803317", verified: true, mismatch: false, routeClass: "CREATOR_HOME" });
    expect(result.convergence).toMatchObject({ reusableOperationId: "run-newest", activeUnusedAuthorizationCount: 1 });
    expect(fixture.repository.bindPlatformAccountIdentity).toHaveBeenCalledWith(expect.objectContaining({ externalCreatorId: "960803317", bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH" }));
    expect(fixture.repository.convergeUnusedOneShotAuthorization).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a different Creator ID without writing or converging", async () => {
    const fixture = setup({ observedId: "different-creator" });

    await expect(fixture.service.verifyAndConverge(account.id)).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_MISMATCH" });
    expect(fixture.repository.bindPlatformAccountIdentity).not.toHaveBeenCalled();
    expect(fixture.repository.convergeUnusedOneShotAuthorization).not.toHaveBeenCalled();
  });

  it("requires explicit Owner approval before creating a first local binding", async () => {
    const fixture = setup({ observedId: "960803317", expectedId: null });

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
    const fixture = setup({ observedId: "960803317", runtimeAuthState: "UNVERIFIED" });

    await expect(fixture.service.verifyCreatorIdentity(account.id)).resolves.toMatchObject({
      expectedExternalCreatorId: "960803317",
      observed: { externalCreatorId: "960803317" },
      verified: true,
      mismatch: false
    });
  });

  it("creates a Context-bound attestation from the fresh shared proof and validates it on a later Page", async () => {
    const reader = {
      readCanonicalCreatorIdentity: vi.fn(async () => observation("960803317")),
      getBrowserRuntimeSnapshot: vi.fn(() => ({
        platformKey: "xiaohongshu",
        accountId: account.id,
        sessionExists: true,
        browserSessionIdentity: "session-a",
        contextDebugId: "context-1",
        canonicalPageDebugId: "page-home",
        browserConnected: true,
        contextExists: true,
        contextPageCount: 2,
        canonicalPageExists: true,
        canonicalPageClosed: false,
        canonicalPageContextMatchesSession: true,
        runtimeAuthState: "AUTHENTICATED" as const,
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
      getAccountById: vi.fn(() => account),
      getPlatformAccountIdentityBinding: vi.fn(() => binding("960803317")),
      bindPlatformAccountIdentity: vi.fn(),
      convergeUnusedOneShotAuthorization: vi.fn()
    };
    const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
    const service = new XhsIdentityService({ repository, registry });

    await expect(service.establishContextIdentityAttestation(account.id)).resolves.toMatchObject({ status: "PASS", attestation: { browserSessionIdentity: "session-a", browserContextIdentity: "context-1", sourcePageIdentity: "page-1" } });
    await expect(service.validateContextIdentityAttestation(account.id)).resolves.toMatchObject({ valid: true });
    expect(service.getContextIdentityAttestation(account.id)).toMatchObject({ sourcePageIdentity: "page-1" });
  });

  it("fails closed when the current runtime is rebound to a different Session", async () => {
    const reader = {
      readCanonicalCreatorIdentity: vi.fn(async () => observation("960803317")),
      getBrowserRuntimeSnapshot: vi.fn()
        .mockReturnValueOnce({ sessionExists: true, browserSessionIdentity: "session-a", contextDebugId: "context-1", canonicalPageDebugId: "page-1", browserConnected: true, contextExists: true, contextPageCount: 1, canonicalPageExists: true, canonicalPageClosed: false, canonicalPageContextMatchesSession: true, runtimeAuthState: "AUTHENTICATED" as const })
        .mockReturnValueOnce({ sessionExists: true, browserSessionIdentity: "session-b", contextDebugId: "context-1", canonicalPageDebugId: "page-draft", browserConnected: true, contextExists: true, contextPageCount: 1, canonicalPageExists: true, canonicalPageClosed: false, canonicalPageContextMatchesSession: true, runtimeAuthState: "AUTHENTICATED" as const })
    };
    const repository = {
      getAccountById: vi.fn(() => account),
      getPlatformAccountIdentityBinding: vi.fn(() => binding("960803317")),
      bindPlatformAccountIdentity: vi.fn(),
      convergeUnusedOneShotAuthorization: vi.fn()
    };
    const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
    const service = new XhsIdentityService({ repository, registry });

    await expect(service.establishContextIdentityAttestation(account.id)).resolves.toMatchObject({ status: "PASS" });
    await expect(service.validateContextIdentityAttestation(account.id)).resolves.toMatchObject({ valid: false, failureCode: "BROWSER_SESSION_REBOUND" });
    expect(service.getContextIdentityAttestation(account.id)).toBeNull();
  });
});
