import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Account, PlatformAccountIdentityBinding } from "@publisher/domain";
const XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID = "historical-test-account";
import type { XiaohongshuPageScopedIdentityVerification } from "@publisher/adapters-xiaohongshu/browser";
import { XhsIdentityService } from "../apps/desktop/src/main/xhs-identity";

const account: Account = {
  id: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID,
  platformAccountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID,
  platformKey: "xiaohongshu",
  accountAlias: "小红书测试账号",
  accountName: "小红书测试账号",
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
  browserSessionId: "session-a",
  externalAccountId: "123456789",
  lastVerifiedAt: new Date().toISOString(),
  lastUsedAt: null,
  archivedAt: null
};

function binding(): PlatformAccountIdentityBinding {
  const timestamp = new Date().toISOString();
  return { id: "binding-a", platformKey: "xiaohongshu", accountId: account.id, externalCreatorId: "123456789", displayName: "测试账号", profileUrl: null, bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH", boundAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
}

function runtime(session = "session-a", context = "context-a", page = "home-page") {
  return {
    platformKey: "xiaohongshu",
    accountId: account.id,
    sessionExists: true,
    browserSessionIdentity: session,
    contextDebugId: context,
    canonicalPageDebugId: page,
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
  };
}

function scopedIdentityProof(overrides: Partial<NonNullable<XiaohongshuPageScopedIdentityVerification["proof"]>> = {}): NonNullable<XiaohongshuPageScopedIdentityVerification["proof"]> {
  return {
    browserSessionId: "session-a",
    contextId: "context-a",
    pageId: "home-page",
    pageOrigin: "https://creator.xiaohongshu.com",
    pagePathname: "/new/home",
    creatorId: "123456789",
    verifiedAt: "2026-09-07T08:00:00.000Z",
    expiresAt: "2026-09-07T08:05:00.000Z",
    ...overrides
  };
}

function setup(observedCreatorId: string | null = "123456789") {
  const reader = {
    verifyIdentityOnContextPage: vi.fn(async () => observedCreatorId === null
      ? { status: "FAIL", failureCode: "CREATOR_ID_NOT_FOUND", proof: null }
      : { status: "PASS", failureCode: null, proof: scopedIdentityProof({ creatorId: observedCreatorId }) } satisfies XiaohongshuPageScopedIdentityVerification),
    getBrowserRuntimeSnapshot: vi.fn(() => runtime())
  };
  const repository = {
    getAccountById: vi.fn(() => account),
    getPlatformAccountIdentityBinding: vi.fn(() => binding()),
    bindPlatformAccountIdentity: vi.fn(),
    convergeUnusedOneShotAuthorization: vi.fn()
  };
  const registry = { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry;
  return { reader, service: new XhsIdentityService({ repository, registry }) };
}

describe("r36 XHS Context-bound identity service", () => {
  it("uses the scoped identity verifier before creating the attestation", async () => {
    const fixture = setup();
    await expect(fixture.service.establishContextIdentityAttestation(account.id)).resolves.toMatchObject({ status: "PASS" });
    expect(fixture.reader.verifyIdentityOnContextPage).toHaveBeenCalledTimes(1);
  });

  it.each([null, "different-creator"])("fails closed when the fresh Creator ID is %s", async (observedCreatorId) => {
    const fixture = setup(observedCreatorId);
    await expect(fixture.service.establishContextIdentityAttestation(account.id)).resolves.toMatchObject({ status: "BLOCKED" });
    expect(fixture.service.getContextIdentityAttestation(account.id)).toBeNull();
  });

  it("validates the same Context after the draft Page changes and rejects a rebind", async () => {
    const fixture = setup();
    await fixture.service.establishContextIdentityAttestation(account.id);
    await expect(fixture.service.validateContextIdentityAttestation(account.id)).resolves.toMatchObject({ valid: true });
    fixture.reader.getBrowserRuntimeSnapshot.mockReturnValueOnce(runtime("session-a", "context-a", "draft-page"));
    await expect(fixture.service.validateContextIdentityAttestation(account.id)).resolves.toMatchObject({ valid: true });
    fixture.reader.getBrowserRuntimeSnapshot.mockReturnValue(runtime("session-b", "context-a", "draft-page"));
    await expect(fixture.service.validateContextIdentityAttestation(account.id)).resolves.toMatchObject({ valid: false, failureCode: "BROWSER_SESSION_REBOUND" });
  });

  it("accepts a publish editor without identity DOM when the Context attestation came from /new/home", async () => {
    const fixture = setup();
    await expect(fixture.service.establishContextIdentityAttestation(account.id)).resolves.toMatchObject({ status: "PASS", attestation: { sourcePageIdentity: "home-page", sourcePathname: "/new/home" } });
    fixture.reader.getBrowserRuntimeSnapshot.mockReturnValue(runtime("session-a", "context-a", "draft-page"));
    await expect(fixture.service.validateContextIdentityAttestation(account.id)).resolves.toEqual({ valid: true, failureCode: null });
  });
});
