import type { AdapterRegistry, BrowserSessionRuntimeSnapshot } from "@publisher/adapters-core";
import type { AppRepository } from "@publisher/db";
import { ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type Account, type AccountContext, type CreatorIdentityVerificationResult, type PlatformAccountIdentityBinding, type XhsIdentityAcceptance } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { classifyXiaohongshuPostUploadTerminalReadiness } from "@publisher/adapters-xiaohongshu/browser";
import type { IdentityPageEnsureResult, XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic, XiaohongshuContextPageInventory, XiaohongshuCreatorIdentityObservation, XiaohongshuCurrentFileInputState, XiaohongshuCurrentImageEditorReadiness, XiaohongshuCurrentPostUploadReconciliation, XiaohongshuCurrentPostUploadTerminalReadiness, XiaohongshuGlobalExactPublishDomRuntimeDiagnostic, XiaohongshuPageScopedIdentityVerification, XiaohongshuPublishEditorDomRuntimeDiagnostic, XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import { createXhsContextIdentityAttestation, validateXhsContextIdentityAttestation, type XhsContextIdentityAttestation, type XhsContextIdentityAttestationResult, type XhsContextIdentityRuntime } from "./xhs-context-identity-attestation";

type IdentityReader = {
  inspectCanonicalPageRuntime?: (ctx: AccountContext) => Promise<XiaohongshuCanonicalPageRuntimeProbe>;
  inspectXhsContextPages?: (ctx: AccountContext) => Promise<XiaohongshuContextPageInventory>;
  ensureXhsIdentityPage?: (ctx: AccountContext) => Promise<IdentityPageEnsureResult>;
  verifyIdentityOnContextPage?: (ctx: AccountContext) => Promise<XiaohongshuPageScopedIdentityVerification>;
  inspectXhsPublishEntryDom?: (ctx: AccountContext) => Promise<XiaohongshuPublishEntryDomRuntimeDiagnostic>;
  inspectCurrentXiaohongshuImageEditorReadiness?: (ctx: AccountContext) => Promise<XiaohongshuCurrentImageEditorReadiness>;
  inspectCurrentXiaohongshuPublishEditorDom?: (ctx: AccountContext) => Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic>;
  inspectCurrentXiaohongshuPublishEditorSemanticCandidates?: (ctx: AccountContext) => Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic>;
  inspectCurrentXiaohongshuGlobalExactPublishDom?: (ctx: AccountContext) => Promise<XiaohongshuGlobalExactPublishDomRuntimeDiagnostic>;
  inspectCurrentXiaohongshuClosedShadowFinalSubmit?: (ctx: AccountContext) => Promise<XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic>;
  inspectCurrentXiaohongshuPostUploadReconciliation?: (ctx: AccountContext) => Promise<XiaohongshuCurrentPostUploadReconciliation>;
  inspectCurrentXiaohongshuFileInputState?: (ctx: AccountContext) => Promise<XiaohongshuCurrentFileInputState>;
  readCanonicalCreatorIdentity?: (ctx: AccountContext) => Promise<XiaohongshuCreatorIdentityObservation>;
  getBrowserRuntimeSnapshot?: (ctx: AccountContext) => BrowserSessionRuntimeSnapshot;
};

export interface XhsIdentityServiceOptions {
  repository: Pick<AppRepository, "getAccountById" | "getPlatformAccountIdentityBinding" | "bindPlatformAccountIdentity" | "convergeUnusedOneShotAuthorization"> & {
    bootstrapXhsCreatorIdentity?: (input: { accountId: string; observedCreatorId: string; displayName?: string | null; profileUrl?: string | null }) => { account: Account; binding: PlatformAccountIdentityBinding };
  };
  registry: Pick<AdapterRegistry, "getForContent">;
  logger?: Logger;
}

export interface XhsIdentityPageEnsureServiceResult {
  status: "PASS" | "BLOCKED";
  failureCode: string | null;
  identityPageEnsured: boolean;
  identityPageUrl: string | null;
  editorPageUrl: string | null;
  sameBrowserContext: boolean;
  identityMatch: boolean;
  observedCreatorId: string | null;
  action: IdentityPageEnsureResult["action"];
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
  private readonly contextIdentityAttestations = new Map<string, XhsContextIdentityAttestation>();

  constructor(private readonly options: XhsIdentityServiceOptions) {}

  async establishContextIdentityAttestation(accountId: string): Promise<XhsContextIdentityAttestationResult> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.getBrowserRuntimeSnapshot !== "function") throw Object.assign(new Error("当前小红书运行时未提供 BrowserSession runtime snapshot"), { code: "XHS_RUNTIME_SNAPSHOT_UNAVAILABLE" });
    const context = this.context(account);
    const runtime = adapter.getBrowserRuntimeSnapshot(context);
    if (runtime.platformKey !== "xiaohongshu" || runtime.accountId !== account.id) {
      this.contextIdentityAttestations.delete(account.id);
      return { status: "BLOCKED", failureCode: "ACCOUNT_SESSION_BINDING_MISMATCH" };
    }
    const identity = typeof adapter.verifyIdentityOnContextPage === "function"
      ? await adapter.verifyIdentityOnContextPage(context)
      : { status: "FAIL", failureCode: "XHS_CONTEXT_IDENTITY_PAGE_VERIFIER_UNAVAILABLE", proof: null } satisfies XiaohongshuPageScopedIdentityVerification;
    if (identity.status !== "PASS") {
      this.contextIdentityAttestations.delete(account.id);
      return { status: "BLOCKED", failureCode: identity.failureCode };
    }
    if (identity.proof.browserSessionId !== (runtime.browserSessionIdentity ?? null) || identity.proof.contextId !== runtime.contextDebugId) {
      this.contextIdentityAttestations.delete(account.id);
      return { status: "BLOCKED", failureCode: "IDENTITY_RUNTIME_SCOPE_MISMATCH" };
    }
    const binding = this.options.repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id);
    const expectedExternalCreatorId = binding?.externalCreatorId ?? account.externalAccountId ?? null;
    const result = createXhsContextIdentityAttestation({
      accountId: account.id,
      expectedExternalCreatorId,
      observedExternalCreatorId: identity.proof.creatorId,
      identityObservationStatus: "PASS",
      browserSessionIdentity: identity.proof.browserSessionId,
      browserContextIdentity: identity.proof.contextId,
      sourcePageIdentity: identity.proof.pageId,
      sourceOrigin: identity.proof.pageOrigin,
      sourcePathname: identity.proof.pagePathname,
      browserConnected: runtime.browserConnected === true,
      pageClosed: runtime.canonicalPageClosed === true,
      runtimeAuthState: runtime.runtimeAuthState,
      externalAccountId: account.externalAccountId
    });
    if (result.status === "PASS") this.contextIdentityAttestations.set(account.id, result.attestation);
    else this.contextIdentityAttestations.delete(account.id);
    return result;
  }

  /** Ensure the current authenticated Context has an identity Page before creating the completion attestation. */
  async ensureCurrentContextIdentityPage(accountId: string): Promise<XhsContextIdentityAttestationResult> {
    const ensured = await this.ensureIdentityPage(accountId);
    if (ensured.status !== "PASS" || !ensured.identityMatch || !ensured.observedCreatorId) {
      return { status: "BLOCKED", failureCode: ensured.failureCode ?? "XHS_CURRENT_CONTEXT_IDENTITY_PAGE_RECOVERY_FAILED" };
    }
    return this.establishContextIdentityAttestation(accountId);
  }

  async validateContextIdentityAttestation(accountId: string): Promise<ReturnType<typeof validateXhsContextIdentityAttestation>> {
    const account = this.requireAccount(accountId);
    const attestation = this.contextIdentityAttestations.get(account.id);
    if (!attestation) return { valid: false, failureCode: "CONTEXT_IDENTITY_ATTESTATION_MISSING" };
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.getBrowserRuntimeSnapshot !== "function") return { valid: false, failureCode: "XHS_RUNTIME_SNAPSHOT_UNAVAILABLE" };
    const runtime = adapter.getBrowserRuntimeSnapshot(this.context(account));
    if (runtime.platformKey !== "xiaohongshu" || runtime.accountId !== account.id) {
      this.contextIdentityAttestations.delete(account.id);
      return { valid: false, failureCode: "ACCOUNT_SESSION_BINDING_MISMATCH" };
    }
    const binding = this.options.repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id);
    const expectedCreatorId = binding?.externalCreatorId ?? account.externalAccountId ?? null;
    const current: XhsContextIdentityRuntime = {
      accountId: account.id,
      browserSessionIdentity: runtime.browserSessionIdentity ?? null,
      browserContextIdentity: runtime.contextDebugId,
      currentPageExists: runtime.canonicalPageExists,
      currentPageClosed: runtime.canonicalPageClosed === true,
      browserConnected: runtime.browserConnected === true,
      runtimeAuthState: runtime.runtimeAuthState,
      observedExternalCreatorId: expectedCreatorId
    };
    const validation = validateXhsContextIdentityAttestation(attestation, current);
    if (!validation.valid) this.contextIdentityAttestations.delete(account.id);
    return validation;
  }

  getContextIdentityAttestation(accountId: string): XhsContextIdentityAttestation | null {
    return this.contextIdentityAttestations.get(accountId) ?? null;
  }

  invalidateContextIdentityAttestation(accountId: string): void {
    this.contextIdentityAttestations.delete(accountId);
  }

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

  async inspectXhsContextPages(accountId: string): Promise<XiaohongshuContextPageInventory> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectXhsContextPages !== "function") throw Object.assign(new Error("当前小红书运行时未提供 Context Page inventory"), { code: "XHS_CONTEXT_PAGE_INVENTORY_UNAVAILABLE" });
    const inventory = await adapter.inspectXhsContextPages(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_CONTEXT_PAGE_INVENTORY", "小红书 Context Page 只读 inventory 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inventoryStatus: inventory.inventoryStatus,
      failureCode: inventory.failureCode,
      contextDebugId: inventory.contextDebugId,
      pageCount: inventory.pageCount,
      canonicalPageId: inventory.canonicalPageId,
      readyImageEditorPageCount: inventory.pages.filter((page) => page.urlOrigin === "https://creator.xiaohongshu.com" && page.pathname === "/publish/publish" && !page.isClosed && page.editorShellPresent && page.uploadImageTabPresent && page.imageUploadControlPresent && page.contentType === "IMAGE_POST").length
    });
    return inventory;
  }

  async ensureIdentityPage(accountId: string): Promise<XhsIdentityPageEnsureServiceResult> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    const blocked = (failureCode: string, ensured?: Partial<IdentityPageEnsureResult>, observedCreatorId: string | null = null): XhsIdentityPageEnsureServiceResult => ({
      status: "BLOCKED", failureCode, identityPageEnsured: false,
      identityPageUrl: ensured?.identityPageUrl ?? null, editorPageUrl: ensured?.editorPageUrl ?? null,
      sameBrowserContext: ensured?.sameBrowserContext ?? false, identityMatch: false, observedCreatorId,
      action: ensured?.action ?? null
    });
    if (typeof adapter.ensureXhsIdentityPage !== "function") return blocked("XHS_IDENTITY_PAGE_ENSURE_UNAVAILABLE");
    if (typeof adapter.getBrowserRuntimeSnapshot === "function") {
      const runtime = adapter.getBrowserRuntimeSnapshot(this.context(account));
      if (runtime.platformKey !== "xiaohongshu" || runtime.accountId !== account.id) return blocked("ACCOUNT_SESSION_BINDING_MISMATCH");
      if (!runtime.sessionExists || runtime.browserConnected !== true || !runtime.contextExists || runtime.runtimeAuthState !== "AUTHENTICATED") return blocked("XHS_IDENTITY_PAGE_RUNTIME_UNAVAILABLE");
    }
    const ensured = await adapter.ensureXhsIdentityPage(this.context(account));
    if (ensured.status !== "PASS" || !ensured.identityPageUrl || !ensured.editorPageUrl || !ensured.sameBrowserContext) return blocked(ensured.failureCode ?? "IDENTITY_PAGE_ENSURE_FAILED", ensured);
    if (typeof adapter.verifyIdentityOnContextPage !== "function") return blocked("XHS_CONTEXT_IDENTITY_PAGE_VERIFIER_UNAVAILABLE", ensured);
    const identity = await adapter.verifyIdentityOnContextPage(this.context(account));
    const binding = this.options.repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id);
    if (binding?.externalCreatorId && account.externalAccountId && binding.externalCreatorId !== account.externalAccountId) return blocked("ACCOUNT_IDENTITY_BINDING_CONFLICT", ensured);
    const expectedCreatorId = binding?.externalCreatorId ?? account.externalAccountId ?? null;
    const observedCreatorId = identity.status === "PASS" ? identity.proof.creatorId : null;
    const identityMatch = identity.status === "PASS" && expectedCreatorId !== null && observedCreatorId === expectedCreatorId;
    if (!identityMatch) return blocked(identity.status === "PASS" ? "CREATOR_ID_MISMATCH" : identity.failureCode, ensured, observedCreatorId);
    return { status: "PASS", failureCode: null, identityPageEnsured: true, identityPageUrl: ensured.identityPageUrl, editorPageUrl: ensured.editorPageUrl, sameBrowserContext: true, identityMatch: true, observedCreatorId, action: ensured.action };
  }

  async inspectCurrentXiaohongshuImageEditorReadiness(accountId: string): Promise<XiaohongshuCurrentImageEditorReadiness> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectCurrentXiaohongshuImageEditorReadiness !== "function") throw Object.assign(new Error("当前小红书运行时未提供 retained canonical Page editor readiness diagnostic"), { code: "XHS_CURRENT_EDITOR_READINESS_DIAGNOSTIC_UNAVAILABLE" });
    const diagnostic = await adapter.inspectCurrentXiaohongshuImageEditorReadiness(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_CURRENT_IMAGE_EDITOR_READINESS", "小红书 retained canonical Page editor 只读 readiness diagnostic 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      sessionExists: diagnostic.sessionExists,
      browserConnected: diagnostic.browserConnected,
      contextExists: diagnostic.contextExists,
      pageExists: diagnostic.pageExists,
      pageClosed: diagnostic.pageClosed,
      pageContextMatchesSession: diagnostic.pageContextMatchesSession,
      origin: diagnostic.origin,
      pathname: diagnostic.pathname,
      source: diagnostic.source,
      from: diagnostic.from,
      target: diagnostic.target,
      readyState: diagnostic.readyState,
      editorShellPresent: diagnostic.editorShellPresent,
      uploadImageTabPresent: diagnostic.uploadImageTabPresent,
      currentSelectedTab: diagnostic.currentSelectedTab,
      imageUploadControlPresent: diagnostic.imageUploadControlPresent,
      contentType: diagnostic.contentType,
      imageEditorPhase: diagnostic.imageEditorPhase,
      preUploadPhaseResult: diagnostic.preUploadPhaseResult,
      preUploadFailureCode: diagnostic.preUploadFailureCode
    });
    return diagnostic;
  }

  async inspectCurrentXiaohongshuPublishEditorDom(accountId: string): Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectCurrentXiaohongshuPublishEditorDom !== "function") throw Object.assign(new Error("当前小红书运行时未提供 publish editor bounded DOM diagnostic"), { code: "XHS_PUBLISH_EDITOR_DOM_DIAGNOSTIC_UNAVAILABLE" });
    const diagnostic = await adapter.inspectCurrentXiaohongshuPublishEditorDom(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_EDITOR_DOM_DIAGNOSTIC", "小红书 publish editor bounded DOM diagnostic 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      sessionExists: diagnostic.sessionExists,
      browserConnected: diagnostic.browserConnected,
      contextExists: diagnostic.contextExists,
      pageExists: diagnostic.pageExists,
      pageClosed: diagnostic.pageClosed,
      pageContextMatchesSession: diagnostic.pageContextMatchesSession,
      origin: diagnostic.origin,
      pathname: diagnostic.pathname,
      source: diagnostic.source,
      from: diagnostic.from,
      target: diagnostic.target,
      labelMatchCounts: diagnostic.labels.map((item) => ({ label: item.label, exactTextMatchCount: item.exactTextMatchCount })),
      actualSelectedTabSignal: diagnostic.actualSelectedTabSignal,
      fileInputMatchCount: diagnostic.fileInputs.length
    });
    return diagnostic;
  }

  async inspectCurrentXiaohongshuPublishEditorSemanticCandidates(accountId: string): Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectCurrentXiaohongshuPublishEditorSemanticCandidates !== "function") throw Object.assign(new Error("当前小红书运行时未提供 publish editor semantic candidate diagnostic"), { code: "XHS_PUBLISH_EDITOR_SEMANTIC_DIAGNOSTIC_UNAVAILABLE" });
    const diagnostic = await adapter.inspectCurrentXiaohongshuPublishEditorSemanticCandidates(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_EDITOR_SEMANTIC_DIAGNOSTIC", "小红书 publish editor semantic candidate 只读 diagnostic 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      origin: diagnostic.origin,
      pathname: diagnostic.pathname,
      uploadImageTabTextMatchCount: diagnostic.uploadImageTabTextMatchCount,
      uploadImageTabRenderedCandidateCount: diagnostic.uploadImageTabRenderedCandidateCount,
      uploadImageButtonTextMatchCount: diagnostic.uploadImageButtonTextMatchCount,
      uploadImageButtonRenderedCandidateCount: diagnostic.uploadImageButtonRenderedCandidateCount,
      visibleCreatorTabCount: diagnostic.visibleCreatorTabCount,
      activeCreatorTabCount: diagnostic.activeCreatorTabCount,
      activeCreatorTabLabel: diagnostic.activeCreatorTabLabel,
      actualSelectedTabSignal: diagnostic.actualSelectedTabSignal,
      selectedImageTabProof: diagnostic.selectedImageTabProof,
      imageUploadSurfaceProof: diagnostic.imageUploadSurfaceProof,
      fileInputMatchCount: diagnostic.fileInputs.length,
      acceptableImageFileInputCount: diagnostic.acceptableImageFileInputCount,
      imagePostSemanticProof: diagnostic.imagePostSemanticProof
    });
    return diagnostic;
  }

  async inspectCurrentXiaohongshuGlobalExactPublishDom(accountId: string): Promise<XiaohongshuGlobalExactPublishDomRuntimeDiagnostic> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectCurrentXiaohongshuGlobalExactPublishDom !== "function") throw Object.assign(new Error("当前小红书运行时未提供 global exact publish DOM diagnostic"), { code: "XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_UNAVAILABLE" });
    const diagnostic = await adapter.inspectCurrentXiaohongshuGlobalExactPublishDom(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC", "小红书 document-global exact 发布只读 diagnostic 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      origin: diagnostic.origin,
      pathname: diagnostic.pathname,
      globalExactPublishTextMatchCount: diagnostic.globalExactPublishTextMatchCount,
      globalExactPublishUnique: diagnostic.globalExactPublishUnique,
      maxAncestorDepth: diagnostic.maxAncestorDepth
    });
    return diagnostic;
  }

  async inspectCurrentXiaohongshuClosedShadowFinalSubmit(accountId: string): Promise<XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectCurrentXiaohongshuClosedShadowFinalSubmit !== "function") throw Object.assign(new Error("当前小红书运行时未提供 closed-shadow final-submit diagnostic"), { code: "XHS_CLOSED_SHADOW_FINAL_SUBMIT_DIAGNOSTIC_UNAVAILABLE" });
    const diagnostic = await adapter.inspectCurrentXiaohongshuClosedShadowFinalSubmit(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_CLOSED_SHADOW_FINAL_SUBMIT_DIAGNOSTIC", "小红书 closed-shadow final-submit 只读 diagnostic 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      origin: diagnostic.origin,
      pathname: diagnostic.pathname,
      cdpSessionCreated: diagnostic.cdpSessionCreated,
      cdpGetDocumentSuccess: diagnostic.cdpGetDocumentSuccess,
      hostMatchCount: diagnostic.piercedXhsPublishBtnCount,
      exactPublishNativeButtonCount: diagnostic.exactPublishNativeButtonCount,
      finalSubmitControlPresent: diagnostic.finalSubmitControlPresent,
      finalSubmitControlEnabled: diagnostic.finalSubmitControlEnabled
    });
    return diagnostic;
  }

  async inspectCurrentXiaohongshuPostUploadReconciliation(accountId: string): Promise<XiaohongshuCurrentPostUploadReconciliation> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectCurrentXiaohongshuPostUploadReconciliation !== "function") throw Object.assign(new Error("当前小红书运行时未提供 post-upload reconciliation diagnostic"), { code: "XHS_POST_UPLOAD_RECONCILIATION_DIAGNOSTIC_UNAVAILABLE" });
    const diagnostic = await adapter.inspectCurrentXiaohongshuPostUploadReconciliation(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_POST_UPLOAD_RECONCILIATION", "小红书 retained canonical Page post-upload 只读 reconciliation 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      sessionExists: diagnostic.sessionExists,
      browserConnected: diagnostic.browserConnected,
      contextExists: diagnostic.contextExists,
      pageExists: diagnostic.pageExists,
      pageClosed: diagnostic.pageClosed,
      pageContextMatchesSession: diagnostic.pageContextMatchesSession,
      origin: diagnostic.origin,
      pathname: diagnostic.pathname,
      readyState: diagnostic.readyState,
      postUploadState: diagnostic.postUploadState,
      imageUploadReconciliation: diagnostic.imageUploadReconciliation,
      imageItemCount: diagnostic.imageItems.length,
      visibleImageItemCount: diagnostic.visibleImageItemCount,
      titleControlPresent: diagnostic.titleControlPresent,
      bodyControlPresent: diagnostic.bodyControlPresent,
      finalSubmitProof: diagnostic.finalSubmitProof,
      noExplicitUploadError: diagnostic.noExplicitUploadError
    });
    return diagnostic;
  }

  async inspectCurrentXiaohongshuPostUploadTerminalReadiness(accountId: string): Promise<XiaohongshuCurrentPostUploadTerminalReadiness> {
    const diagnostic = await this.inspectCurrentXiaohongshuPostUploadReconciliation(accountId);
    const terminalReadiness = classifyXiaohongshuPostUploadTerminalReadiness({
      originalPostUploadState: diagnostic.postUploadState,
      editorScopedImageAssetCount: diagnostic.imageAssetRenderedCount,
      imageCounterTextSafe: diagnostic.imageCounterTextSafe,
      titleControlPresent: diagnostic.titleControlPresent,
      bodyControlPresent: diagnostic.bodyControlPresent,
      uploadErrorSignalPresent: diagnostic.explicitUploadErrorSignals.length > 0,
      busySignalPresent: diagnostic.processingSignalPresent
    });
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_POST_UPLOAD_TERMINAL_READINESS", "小红书 post-upload terminal readiness 只读 diagnostic 完成", {
      platformKey: "xiaohongshu",
      accountId: diagnostic.accountId,
      inspectionStatus: diagnostic.inspectionStatus,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      editorScopedImageAssetCount: terminalReadiness.editorScopedImageAssetCount,
      imageCounterTextSafe: terminalReadiness.imageCounterTextSafe,
      imageCounterValid: terminalReadiness.imageCounterValid,
      titleControlPresent: terminalReadiness.titleControlPresent,
      bodyControlPresent: terminalReadiness.bodyControlPresent,
      uploadErrorSignalPresent: terminalReadiness.uploadErrorSignalPresent,
      busySignalPresent: terminalReadiness.busySignalPresent,
      postUploadState: terminalReadiness.postUploadState,
      ready: terminalReadiness.ready,
      blockerCodes: terminalReadiness.blockerCodes
    });
    return { ...diagnostic, terminalReadiness };
  }

  async inspectCurrentXiaohongshuFileInputState(accountId: string): Promise<XiaohongshuCurrentFileInputState> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectCurrentXiaohongshuFileInputState !== "function") throw Object.assign(new Error("当前小红书运行时未提供 file-input delivery diagnostic"), { code: "XHS_FILE_INPUT_DIAGNOSTIC_UNAVAILABLE" });
    const diagnostic = await adapter.inspectCurrentXiaohongshuFileInputState(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_FILE_INPUT_STATE", "小红书 retained canonical Page file-input 只读 delivery diagnostic 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      contextDebugId: diagnostic.contextDebugId,
      pageId: diagnostic.pageId,
      sessionExists: diagnostic.sessionExists,
      browserConnected: diagnostic.browserConnected,
      contextExists: diagnostic.contextExists,
      pageExists: diagnostic.pageExists,
      pageClosed: diagnostic.pageClosed,
      pageContextMatchesSession: diagnostic.pageContextMatchesSession,
      origin: diagnostic.origin,
      pathname: diagnostic.pathname,
      readyState: diagnostic.readyState,
      fileInputMatchCount: diagnostic.matchCount,
      fileInputContainsExpectedFixture: diagnostic.fileInputContainsExpectedFixture,
      fileInputFilesLengths: diagnostic.inputs.map((input) => input.filesLength)
    });
    return diagnostic;
  }

  async inspectXhsPublishEntryDom(accountId: string): Promise<XiaohongshuPublishEntryDomRuntimeDiagnostic> {
    const account = this.requireAccount(accountId);
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.inspectXhsPublishEntryDom !== "function") throw Object.assign(new Error("当前小红书运行时未提供 publish-entry DOM diagnostic"), { code: "XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_UNAVAILABLE" });
    const diagnostic = await adapter.inspectXhsPublishEntryDom(this.context(account));
    this.options.logger?.info("PLATFORM_SELF_TEST", "XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC", "小红书 publish-entry bounded DOM diagnostic 完成", {
      platformKey: "xiaohongshu",
      accountId: account.id,
      inspectionStatus: diagnostic.inspectionStatus,
      failureCode: diagnostic.failureCode,
      pageOrigin: diagnostic.pageOrigin,
      pathname: diagnostic.pathname,
      publishNoteMatchCount: diagnostic.publishNote.matchCount,
      imagePostMatchCount: diagnostic.imagePost.matchCount,
      imagePostClickableAncestorCount: diagnostic.imagePost.clickableAncestorCount,
      uploadImageMatchCount: diagnostic.uploadImage.matchCount,
      diagnosticClickCount: diagnostic.diagnosticClickCount,
      navigationCount: diagnostic.navigationCount
    });
    return diagnostic;
  }

  /**
   * Establish the first trusted Creator binding from the account-owned,
   * page-scoped verifier. This path is used only by complete-login; later
   * read-only verification continues through verifyCreatorIdentity.
   */
  async bootstrapCreatorIdentity(accountId: string): Promise<CreatorIdentityVerificationResult> {
    const account = this.requireAccount(accountId);
    if (typeof this.options.repository.bootstrapXhsCreatorIdentity !== "function") throw Object.assign(new Error("当前数据库未提供 XHS Creator identity bootstrap"), { code: "XHS_IDENTITY_BOOTSTRAP_UNAVAILABLE" });
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.getBrowserRuntimeSnapshot !== "function") throw Object.assign(new Error("当前小红书运行时未提供 BrowserSession runtime snapshot"), { code: "XHS_RUNTIME_SNAPSHOT_UNAVAILABLE" });
    const runtime = adapter.getBrowserRuntimeSnapshot(this.context(account));
    if (runtime.platformKey !== "xiaohongshu" || runtime.accountId !== account.id) throw Object.assign(new Error("小红书 BrowserSession 未绑定当前内部账号"), { code: "ACCOUNT_SESSION_BINDING_MISMATCH" });
    if (!runtime.sessionExists || runtime.browserConnected !== true || !runtime.contextExists || !runtime.canonicalPageExists || runtime.canonicalPageClosed === true || runtime.canonicalPageContextMatchesSession !== true) {
      throw Object.assign(new Error("小红书 BrowserSession/Context 不满足可信身份绑定前置条件"), { code: "XHS_IDENTITY_RUNTIME_UNAVAILABLE" });
    }
    if (runtime.runtimeAuthState !== "AUTHENTICATED") throw Object.assign(new Error("小红书运行时尚未处于 AUTHENTICATED 状态"), { code: "XHS_IDENTITY_RUNTIME_UNAUTHENTICATED" });
    if (typeof adapter.verifyIdentityOnContextPage !== "function") throw Object.assign(new Error("当前小红书运行时未提供 Page-scoped identity verifier"), { code: "XHS_PAGE_SCOPED_IDENTITY_VERIFIER_UNAVAILABLE" });
    const identity = await adapter.verifyIdentityOnContextPage(this.context(account));
    if (identity.status !== "PASS" || !identity.proof) throw Object.assign(new Error("小红书 Page-scoped Creator identity proof 未通过"), { code: identity.failureCode ?? "XHS_IDENTITY_UNVERIFIED" });
    const proof = identity.proof;
    if (proof.pageOrigin !== "https://creator.xiaohongshu.com" || proof.pagePathname !== "/new/home") throw Object.assign(new Error("小红书 Creator identity proof 不在 /new/home"), { code: "XHS_IDENTITY_PAGE_ROUTE_INVALID" });
    if (!runtime.browserSessionIdentity || !runtime.contextDebugId || proof.browserSessionId !== runtime.browserSessionIdentity || proof.contextId !== runtime.contextDebugId) throw Object.assign(new Error("小红书 Page-scoped identity proof 不属于当前 Session/Context"), { code: "IDENTITY_RUNTIME_SCOPE_MISMATCH" });
    const observedCreatorId = proof.creatorId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(observedCreatorId)) throw Object.assign(new Error("小红书 Creator 稳定外部 ID 不可读，拒绝绑定"), { code: "XHS_IDENTITY_UNVERIFIED" });
    const existingBinding = this.options.repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id);
    const expectedBefore = existingBinding?.externalCreatorId ?? account.externalAccountId ?? null;
    if (expectedBefore && expectedBefore !== observedCreatorId) throw Object.assign(new Error("当前登录的小红书 Creator 身份与已绑定账号不一致"), { code: "XHS_CREATOR_IDENTITY_MISMATCH" });
    const persisted = this.options.repository.bootstrapXhsCreatorIdentity({ accountId: account.id, observedCreatorId, displayName: null, profileUrl: null });
    const reloadedAccount = this.options.repository.getAccountById(account.id, "xiaohongshu");
    const reloadedBinding = this.options.repository.getPlatformAccountIdentityBinding("xiaohongshu", account.id);
    if (!reloadedAccount || !reloadedBinding || reloadedAccount.externalAccountId !== observedCreatorId || reloadedBinding.accountId !== account.id || reloadedBinding.externalCreatorId !== observedCreatorId || persisted.account.externalAccountId !== observedCreatorId || persisted.binding.externalCreatorId !== observedCreatorId) {
      throw Object.assign(new Error("小红书 Creator identity bootstrap 提交后一致性复核失败"), { code: "XHS_IDENTITY_BOOTSTRAP_REVALIDATION_FAILED" });
    }
    const observed = {
      platformKey: "xiaohongshu" as const,
      externalCreatorId: observedCreatorId,
      displayName: null,
      profileUrl: null,
      source: "CREATOR_ACCOUNT_SURFACE" as const,
      stable: true
    };
    return {
      expectedExternalCreatorId: observedCreatorId,
      observed,
      verified: true,
      mismatch: false,
      canonicalContextId: proof.contextId,
      canonicalPageId: proof.pageId,
      canonicalPageUrl: `https://creator.xiaohongshu.com${proof.pagePathname}`,
      domLocationHref: `https://creator.xiaohongshu.com${proof.pagePathname}`,
      pageUrlConsistency: "PASS",
      routeClass: "CREATOR_HOME"
    };
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
    // A fresh canonical probe is the identity proof consumed by Task10S. After
    // restoring a persistent browser profile, the manager may still report
    // UNVERIFIED because no generic login classification has run in this
    // process yet. That state must not override an exact, stable Creator ID
    // proof from the current Context/Page; active checking, login, security,
    // and disconnected states remain fail-closed below.
    const runtimeStateAllowsFreshIdentityProof = observation.runtimeAuthState === "AUTHENTICATED" || observation.runtimeAuthState === "UNVERIFIED";
    const verified = observation.pageUrlConsistency === "PASS"
      && runtimeStateAllowsFreshIdentityProof
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
    const account = this.options.repository.getAccountById(accountId, "xiaohongshu");
    if (!account || account.platformKey !== "xiaohongshu" || !account.enabled || Boolean(account.archivedAt)) throw Object.assign(new Error("小红书账号不可用"), { code: "XHS_IDENTITY_ACCOUNT_UNAVAILABLE" });
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
