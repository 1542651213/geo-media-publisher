import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@publisher/adapters-core";
import type { Account } from "@publisher/domain";
const XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID = "historical-test-account";
import type { XiaohongshuCanonicalPageRuntimeProbe } from "@publisher/adapters-xiaohongshu/browser";
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

function probe(overrides: Partial<XiaohongshuCanonicalPageRuntimeProbe> = {}): XiaohongshuCanonicalPageRuntimeProbe {
  return {
    probeStatus: "PASS",
    failureStage: null,
    failureCode: null,
    failureErrorClass: null,
    canonicalContextId: "context-1",
    canonicalPageId: "page-1",
    probedContextId: "context-1",
    probedPageId: "page-1",
    pageContextMatchesSession: true,
    createdNewPage: false,
    browserConnected: true,
    pageClosed: false,
    runtimeAuthState: "AUTHENTICATED",
    playwrightPageUrl: "https://creator.xiaohongshu.com/new/home",
    domLocationHref: "https://creator.xiaohongshu.com/new/home",
    domLocationEvaluateStatus: "PASS",
    domLocationEvaluateErrorClass: null,
    pageUrlConsistency: "PASS",
    routeClass: "CREATOR_HOME",
    identityObservationStatus: "PASS",
    identitySourceCandidates: [{
      sourceType: "PUBLIC_PROFILE_LINK",
      stableIdentifierPresent: true,
      identifierFieldName: "externalCreatorId",
      sensitiveDataRequired: false,
      readOnlySafe: true,
      confidence: "HIGH",
      tagName: "A",
      text: "测试账号",
      href: "https://creator.xiaohongshu.com/user/profile/960803317",
      role: null,
      dataIdentifierField: null,
      visible: true,
      source: "CREATOR_PROFILE_LINK",
      rawValue: "960803317",
      normalizedCreatorId: "960803317",
      semanticAnchor: "xiaohongshu-profile-link"
    }],
    identityDomDiagnosticMatchCount: 0,
    identityDomDiagnosticMatches: [],
    observedCreatorIdRaw: "960803317",
    observedCreatorIdNormalized: "960803317",
    observedDisplayName: "测试账号",
    observedProfileUrl: "https://creator.xiaohongshu.com/user/profile/960803317",
    ...overrides
  };
}

function setup(runtimeProbe: XiaohongshuCanonicalPageRuntimeProbe = probe()) {
  const adapter = { inspectCanonicalPageRuntime: vi.fn(async () => runtimeProbe) };
  const repository = {
    getAccountById: vi.fn(() => account),
    getPlatformAccountIdentityBinding: vi.fn(() => null),
    bindPlatformAccountIdentity: vi.fn(),
    convergeUnusedOneShotAuthorization: vi.fn(() => ({ reusableOperationId: "existing", supersededOperationIds: [], activeUnusedAuthorizationCount: 1, mutationCount: 0 }))
  };
  const registry = { getForContent: vi.fn(() => adapter) } as unknown as AdapterRegistry;
  return { adapter, repository, registry, service: new XhsIdentityService({ repository, registry }) };
}

describe("Task10W canonical Page runtime probe wiring", () => {
  it("uses the existing adapter probe for identity verification and preserves the same Page ids", async () => {
    const fixture = setup();

    const result = await fixture.service.verifyCreatorIdentity(account.id);

    expect(fixture.adapter.inspectCanonicalPageRuntime).toHaveBeenCalledWith(expect.objectContaining({ accountId: account.id, platformKey: "xiaohongshu" }));
    expect(result).toMatchObject({
      verified: true,
      mismatch: false,
      canonicalContextId: "context-1",
      canonicalPageId: "page-1",
      pageUrlConsistency: "PASS"
    });
    expect(fixture.repository.convergeUnusedOneShotAuthorization).not.toHaveBeenCalled();
  });

  it("fails closed before identity convergence when the fixed URL cross-check fails", async () => {
    const fixture = setup(probe({
      probeStatus: "FAIL",
      failureStage: "URL_CONSISTENCY",
      failureCode: "CANONICAL_PAGE_URL_MISMATCH",
      pageUrlConsistency: "FAIL"
    }));

    await expect(fixture.service.verifyCreatorIdentity(account.id)).rejects.toMatchObject({
      code: "XHS_CANONICAL_PAGE_RUNTIME_PROBE_FAILED",
      failureStage: "URL_CONSISTENCY"
    });
    expect(fixture.repository.convergeUnusedOneShotAuthorization).not.toHaveBeenCalled();
  });

  it("exposes only the fixed read-only probe entry and accepts no renderer script or URL", () => {
    const ipc = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
    const preload = readFileSync("apps/desktop/src/main/preload.ts", "utf8");
    const adapter = readFileSync("packages/adapters/xiaohongshu/src/browser.ts", "utf8");

    expect(ipc).toContain('"platform-self-test:probe-xhs-canonical-page"');
    expect(preload).toContain("probeXhsCanonicalPage: (accountId) => invoke(\"platform-self-test:probe-xhs-canonical-page\", { accountId })");
    expect(adapter).toContain("evaluate(() => location.href)");
    expect(ipc).not.toContain("payload.script");
    expect(ipc).not.toContain("payload.url");
  });

  it("gates XHS complete-login with the same Task10W identity service before profile persistence", () => {
    const ipc = readFileSync("apps/desktop/src/main/ipc.ts", "utf8");
    const completeLogin = ipc.slice(ipc.indexOf('register("accounts:complete-login"'), ipc.indexOf('register("accounts:refresh-login"'));
    expect(completeLogin).toContain("platformSelfTests.bootstrapXhsCreatorIdentity(input.accountId)");
    expect(completeLogin.indexOf("platformSelfTests.bootstrapXhsCreatorIdentity(input.accountId)")).toBeLessThan(completeLogin.indexOf("adapter.getAccountProfile"));
    expect(completeLogin).not.toContain("verifyAndConvergeXhsIdentity");
  });
});
