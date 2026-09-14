import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Account, PlatformAccountIdentityBinding } from "@publisher/domain";
import type { XiaohongshuPageScopedIdentityVerification } from "@publisher/adapters-xiaohongshu/browser";
import { XhsIdentityService } from "../../../../apps/desktop/src/main/xhs-identity";

const account = {
  id: "account-xhs-recovery",
  platformAccountId: "account-xhs-recovery",
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
  browserSessionId: "session-hash",
  externalAccountId: "960803317",
  lastVerifiedAt: new Date().toISOString(),
  lastUsedAt: null,
  archivedAt: null
} as Account;

function binding(): PlatformAccountIdentityBinding {
  const timestamp = new Date().toISOString();
  return { id: "binding-xhs-recovery", platformKey: "xiaohongshu", accountId: account.id, externalCreatorId: "960803317", displayName: "测试账号", profileUrl: null, bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH", boundAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
}

function identityProof(): NonNullable<XiaohongshuPageScopedIdentityVerification["proof"]> {
  return {
    browserSessionId: "session-a",
    contextId: "context-a",
    pageId: "identity-page-a",
    pageOrigin: "https://creator.xiaohongshu.com",
    pagePathname: "/new/home",
    creatorId: "960803317",
    verifiedAt: "2026-09-14T08:00:00.000Z",
    expiresAt: "2026-09-14T08:05:00.000Z"
  };
}

function runtimeSnapshot(): Record<string, unknown> {
  return {
    platformKey: "xiaohongshu",
    accountId: account.id,
    sessionExists: true,
    browserSessionIdentity: "session-a",
    contextDebugId: "context-a",
    canonicalPageDebugId: "editor-page-a",
    browserConnected: true,
    contextExists: true,
    contextPageCount: 2,
    canonicalPageExists: true,
    canonicalPageClosed: false,
    canonicalPageContextMatchesSession: true,
    runtimeAuthState: "AUTHENTICATED"
  };
}

function repository() {
  return {
    getAccountById: vi.fn(() => account),
    getPlatformAccountIdentityBinding: vi.fn(() => binding()),
    bindPlatformAccountIdentity: vi.fn(),
    convergeUnusedOneShotAuthorization: vi.fn()
  };
}

describe("Task10S completion identity recovery", () => {
  it("fails closed when the current Context has no identity Page", async () => {
    const reader = {
      ensureXhsIdentityPage: vi.fn(async () => ({
        status: "BLOCKED" as const,
        failureCode: "IDENTITY_PAGE_NOT_FOUND",
        action: null,
        identityPage: null,
        identityPageUrl: null,
        editorPage: {},
        editorPageUrl: "https://creator.xiaohongshu.com/publish/publish",
        sameBrowserContext: true
      })),
      verifyIdentityOnContextPage: vi.fn(),
      getBrowserRuntimeSnapshot: vi.fn(() => runtimeSnapshot())
    };
    const repo = repository();
    const service = new XhsIdentityService({ repository: repo, registry: { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry });

    await expect(service.ensureCurrentContextIdentityPage(account.id)).resolves.toMatchObject({ status: "BLOCKED", failureCode: "IDENTITY_PAGE_NOT_FOUND" });
    expect(reader.verifyIdentityOnContextPage).not.toHaveBeenCalled();
  });

  it("creates a same-Context identity Page, preserves the editor, and attests the verified Creator", async () => {
    const reader = {
      ensureXhsIdentityPage: vi.fn(async () => ({
        status: "PASS" as const,
        failureCode: null,
        action: "CREATED_NEW_PAGE" as const,
        identityPage: {},
        identityPageUrl: "https://creator.xiaohongshu.com/new/home",
        editorPage: {},
        editorPageUrl: "https://creator.xiaohongshu.com/publish/publish",
        sameBrowserContext: true
      })),
      verifyIdentityOnContextPage: vi.fn(async () => ({ status: "PASS", failureCode: null, proof: identityProof() } satisfies XiaohongshuPageScopedIdentityVerification)),
      getBrowserRuntimeSnapshot: vi.fn(() => runtimeSnapshot())
    };
    const repo = repository();
    const service = new XhsIdentityService({ repository: repo, registry: { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry });

    await expect(service.ensureCurrentContextIdentityPage(account.id)).resolves.toMatchObject({
      status: "PASS",
      attestation: { browserSessionIdentity: "session-a", browserContextIdentity: "context-a", sourcePageIdentity: "identity-page-a", observedExternalCreatorId: "960803317" }
    });
    expect(reader.ensureXhsIdentityPage).toHaveBeenCalledTimes(1);
    expect(reader.verifyIdentityOnContextPage).toHaveBeenCalledTimes(2);
    expect(repo.bindPlatformAccountIdentity).not.toHaveBeenCalled();
    expect(repo.convergeUnusedOneShotAuthorization).not.toHaveBeenCalled();
  });

  it("rejects an identity Page reported from a different Context", async () => {
    const reader = {
      ensureXhsIdentityPage: vi.fn(async () => ({
        status: "BLOCKED" as const,
        failureCode: "IDENTITY_PAGE_CONTEXT_MISMATCH",
        action: null,
        identityPage: null,
        identityPageUrl: null,
        editorPage: {},
        editorPageUrl: "https://creator.xiaohongshu.com/publish/publish",
        sameBrowserContext: false
      })),
      verifyIdentityOnContextPage: vi.fn(),
      getBrowserRuntimeSnapshot: vi.fn(() => runtimeSnapshot())
    };
    const repo = repository();
    const service = new XhsIdentityService({ repository: repo, registry: { getForContent: vi.fn(() => reader) } as unknown as AdapterRegistry });

    await expect(service.ensureCurrentContextIdentityPage(account.id)).resolves.toMatchObject({ status: "BLOCKED", failureCode: "IDENTITY_PAGE_CONTEXT_MISMATCH" });
    expect(reader.verifyIdentityOnContextPage).not.toHaveBeenCalled();
  });
});
