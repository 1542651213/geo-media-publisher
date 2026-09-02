import type { AdapterRegistry } from "@publisher/adapters-core";
import type { AppRepository } from "@publisher/db";
import { ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, type Account, type AccountContext, type CreatorIdentityVerificationResult, type PlatformAccountIdentityBinding, type XhsIdentityAcceptance } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuCreatorIdentityObservation } from "@publisher/adapters-xiaohongshu/browser";

type IdentityReader = {
  inspectCanonicalPageRuntime?: (ctx: AccountContext) => Promise<XiaohongshuCanonicalPageRuntimeProbe>;
  readCanonicalCreatorIdentity?: (ctx: AccountContext) => Promise<XiaohongshuCreatorIdentityObservation>;
};

export interface XhsIdentityServiceOptions {
  repository: Pick<AppRepository, "getAccountById" | "getPlatformAccountIdentityBinding" | "bindPlatformAccountIdentity" | "convergeUnusedOneShotAuthorization">;
  registry: Pick<AdapterRegistry, "getForContent">;
  logger?: Logger;
}

const BLOCKED_ROUTE_CLASSES = new Set<XiaohongshuCreatorIdentityObservation["routeClass"]>(["LOGIN", "SECURITY_VERIFICATION", "UNKNOWN"]);

function observationFromRuntimeProbe(probe: XiaohongshuCanonicalPageRuntimeProbe): XiaohongshuCreatorIdentityObservation {
  if (probe.probeStatus !== "PASS" || probe.domLocationEvaluateStatus !== "PASS" || probe.pageUrlConsistency !== "PASS") {
    throw Object.assign(new Error(`小红书 canonical Page runtime probe failed at ${probe.failureStage ?? "UNKNOWN"}`), {
      code: "XHS_CANONICAL_PAGE_RUNTIME_PROBE_FAILED",
      failureStage: probe.failureStage,
      failureCode: probe.failureCode,
      failureErrorClass: probe.failureErrorClass,
      probe
    });
  }
  const stable = probe.identityObservationStatus === "PASS" && probe.identitySourceCandidates.some((candidate) => candidate.stableIdentifierPresent);
  return {
    canonicalContextId: probe.canonicalContextId ?? "unknown-context",
    canonicalPageId: probe.canonicalPageId ?? "unknown-page",
    canonicalPageUrl: probe.playwrightPageUrl ?? "about:blank",
    domLocationHref: probe.domLocationHref ?? "about:blank",
    pageUrlConsistency: probe.pageUrlConsistency === "PASS" ? "PASS" : "FAIL",
    routeClass: probe.routeClass,
    runtimeAuthState: probe.runtimeAuthState,
    browserConnected: probe.browserConnected,
    pageClosed: probe.pageClosed,
    proof: {
      platformKey: "xiaohongshu",
      externalCreatorId: probe.observedCreatorIdNormalized,
      displayName: probe.observedDisplayName,
      profileUrl: probe.observedProfileUrl,
      source: probe.observedProfileUrl ? "CREATOR_PROFILE_LINK" : probe.observedCreatorIdNormalized ? "CREATOR_ACCOUNT_SURFACE" : "CREATOR_ACCOUNT_SURFACE",
      stable
    }
  };
}

export class XhsIdentityService {
  constructor(private readonly options: XhsIdentityServiceOptions) {}

  async inspectCanonicalPageRuntime(accountId: string): Promise<XiaohongshuCanonicalPageRuntimeProbe> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectCanonicalPageRuntime !== "function") throw Object.assign(new Error("当前小红书运行时未提供 canonical Page runtime probe"), { code: "XHS_CANONICAL_PAGE_RUNTIME_PROBE_UNAVAILABLE" });
    const probe = await adapter.inspectCanonicalPageRuntime(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_CANONICAL_PAGE_RUNTIME_PROBE", "小红书 canonical Page 只读 runtime probe 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      probeStatus: probe.probeStatus,
      failureStage: probe.failureStage,
      failureCode: probe.failureCode,
      domLocationEvaluateStatus: probe.domLocationEvaluateStatus,
      pageUrlConsistency: probe.pageUrlConsistency,
      canonicalContextId: probe.canonicalContextId,
      canonicalPageId: probe.canonicalPageId,
      probedContextId: probe.probedContextId,
      probedPageId: probe.probedPageId,
      identityObservationStatus: probe.identityObservationStatus,
      observedCreatorId: probe.observedCreatorIdNormalized,
      identitySourceCount: probe.identitySourceCandidates.length,
      createdNewPage: probe.createdNewPage
    });
    return probe;
  }

  async verifyCreatorIdentity(accountId: string): Promise<CreatorIdentityVerificationResult> {
    const account = this.requireAccount(accountId);
    const operationId = `task10v-identity-proof-${accountId}`;
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    const observation = typeof adapter.inspectCanonicalPageRuntime === "function"
      ? observationFromRuntimeProbe(await this.inspectCanonicalPageRuntime(accountId))
      : typeof adapter.readCanonicalCreatorIdentity === "function"
        ? await adapter.readCanonicalCreatorIdentity(this.context(account))
        : (() => { throw Object.assign(new Error("当前小红书运行时未提供 canonical Creator identity observer"), { code: "XHS_CREATOR_IDENTITY_OBSERVER_UNAVAILABLE" }); })();
    const binding = this.options.repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id);
    if (binding?.externalCreatorId && account.externalAccountId && binding.externalCreatorId !== account.externalAccountId) {
      throw Object.assign(new Error("内部账号已有互相冲突的小红书 Creator 身份记录，拒绝继续"), { code: "ACCOUNT_IDENTITY_BINDING_CONFLICT" });
    }
    const expectedExternalCreatorId = binding?.externalCreatorId ?? account.externalAccountId ?? null;
    const observedId = observation.proof.externalCreatorId;
    const mismatch = Boolean(expectedExternalCreatorId && observedId && expectedExternalCreatorId !== observedId);
    const verified = observation.pageUrlConsistency === "PASS"
      && observation.runtimeAuthState === "AUTHENTICATED"
      && observation.browserConnected
      && !observation.pageClosed
      && !BLOCKED_ROUTE_CLASSES.has(observation.routeClass)
      && observation.proof.stable
      && Boolean(observedId)
      && expectedExternalCreatorId !== null
      && expectedExternalCreatorId === observedId;
    const result: CreatorIdentityVerificationResult = {
      expectedExternalCreatorId,
      observed: observation.proof,
      verified,
      mismatch,
      canonicalContextId: observation.canonicalContextId,
      canonicalPageId: observation.canonicalPageId,
      canonicalPageUrl: observation.canonicalPageUrl,
      domLocationHref: observation.domLocationHref,
      pageUrlConsistency: observation.pageUrlConsistency,
      routeClass: observation.routeClass
    };
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_CREATOR_IDENTITY_PROOF", "小红书 Creator 身份只读证明完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      operationId,
      EXPECTED_CREATOR_IDENTITY: expectedExternalCreatorId,
      OBSERVED_CREATOR_IDENTITY: { externalCreatorId: observedId, displayName: observation.proof.displayName, profileUrl: observation.proof.profileUrl, source: observation.proof.source, stable: observation.proof.stable },
      ACCOUNT_IDENTITY_VERIFIED: verified,
      ACCOUNT_IDENTITY_MISMATCH: mismatch,
      expectedCreatorId: expectedExternalCreatorId,
      observedCreatorId: observedId,
      verified,
      mismatch,
      routeClass: observation.routeClass,
      pageUrlConsistency: observation.pageUrlConsistency,
      canonicalContextId: observation.canonicalContextId,
      canonicalPageId: observation.canonicalPageId
    });
    return result;
  }

  async verifyAndConverge(accountId: string, input: { ownerApproved?: boolean } = {}): Promise<XhsIdentityAcceptance> {
    const account = this.requireAccount(accountId);
    let verification = await this.verifyCreatorIdentity(accountId);
    const existingBinding = this.options.repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id);
    if (verification.mismatch) throw Object.assign(new Error("当前登录的小红书 Creator 身份与已绑定账号不一致"), { code: "ACCOUNT_IDENTITY_MISMATCH" });
    if (verification.expectedExternalCreatorId === null && !existingBinding && !input.ownerApproved) throw Object.assign(new Error("建立小红书 Creator 身份绑定需要 Owner 明确批准"), { code: "OWNER_APPROVAL_REQUIRED" });
    if (!verification.verified) {
      if (verification.expectedExternalCreatorId !== null) throw Object.assign(new Error("小红书 Creator 身份未通过稳定外部 ID 证明"), { code: "ACCOUNT_IDENTITY_UNVERIFIED" });
      if (!input.ownerApproved) throw Object.assign(new Error("建立小红书 Creator 身份绑定需要 Owner 明确批准"), { code: "OWNER_APPROVAL_REQUIRED" });
      if (!verification.observed.stable || !verification.observed.externalCreatorId) throw Object.assign(new Error("小红书 Creator 稳定外部 ID 不可读，拒绝绑定"), { code: "ACCOUNT_IDENTITY_UNVERIFIED" });
    }

    let binding = existingBinding;
    if (!binding) {
      const externalCreatorId = verification.observed.externalCreatorId;
      if (!externalCreatorId) throw Object.assign(new Error("小红书 Creator 外部 ID 不可读，拒绝身份绑定"), { code: "ACCOUNT_IDENTITY_UNVERIFIED" });
      binding = this.options.repository.bindPlatformAccountIdentity({
        platformKey: "xiaohongshu",
        accountId: account.id,
        externalCreatorId,
        displayName: verification.observed.displayName,
        profileUrl: verification.observed.profileUrl,
        bindingSource: verification.expectedExternalCreatorId ? "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH" : "OWNER_APPROVED_CREATOR_IDENTITY_BINDING"
      });
      verification = { ...verification, expectedExternalCreatorId: binding.externalCreatorId, verified: true, mismatch: false };
    }

    const convergence = this.options.repository.convergeUnusedOneShotAuthorization({ platformKey: "xiaohongshu", accountId: account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE });
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_IDENTITY_AUTHORIZATION_CONVERGED", "小红书 Creator 身份已证明，一次性未消费授权已收敛", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      operationId: `task10v-identity-proof-${accountId}`,
      ACCOUNT_IDENTITY_VERIFIED: verification.verified,
      ACTIVE_UNUSED_AUTHORIZATION_COUNT: convergence.activeUnusedAuthorizationCount,
      REUSABLE_ONE_SHOT_OPERATION_ID: convergence.reusableOperationId,
      SUPERSEDED_UNUSED_AUTHORIZATION_COUNT: convergence.supersededOperationIds.length,
      verified: verification.verified,
      activeUnusedAuthorizationCount: convergence.activeUnusedAuthorizationCount,
      reusableOperationId: convergence.reusableOperationId,
      supersededCount: convergence.supersededOperationIds.length,
      mutationCount: convergence.mutationCount
    });
    return { verification, binding, convergence };
  }

  bindOwnerApprovedCreatorIdentity(input: { accountId: string; externalCreatorId: string; displayName?: string | null; profileUrl?: string | null }): PlatformAccountIdentityBinding {
    const account = this.requireAccount(input.accountId);
    if (!input.externalCreatorId.trim()) throw new Error("小红书 Creator 外部 ID 不能为空");
    return this.options.repository.bindPlatformAccountIdentity({
      platformKey: "xiaohongshu",
      accountId: account.id,
      externalCreatorId: input.externalCreatorId,
      displayName: input.displayName,
      profileUrl: input.profileUrl,
      bindingSource: "OWNER_APPROVED_CREATOR_IDENTITY_BINDING"
    });
  }

  private requireAccount(accountId: string): Account {
    if (accountId !== XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID) throw Object.assign(new Error("小红书身份证明只允许指定测试账号"), { code: "XHS_IDENTITY_ACCOUNT_MISMATCH" });
    const account = this.options.repository.getAccountById(accountId, "xiaohongshu");
    if (!account || account.platformKey !== "xiaohongshu" || !account.enabled || Boolean(account.archivedAt)) throw Object.assign(new Error("小红书指定账号不可用"), { code: "XHS_IDENTITY_ACCOUNT_UNAVAILABLE" });
    return account;
  }

  private context(account: Account): AccountContext {
    return {
      accountId: account.id,
      accountName: account.accountAlias || account.name,
      platformKey: "xiaohongshu",
      settings: { triggerSource: "PLATFORM_SELF_TEST", browserExecutionMode: "VISIBLE" }
    };
  }
}
