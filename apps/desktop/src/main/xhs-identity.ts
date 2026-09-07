import type { AdapterRegistry, BrowserSessionRuntimeSnapshot } from "@publisher/adapters-core";
import type { AppRepository } from "@publisher/db";
import { ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, type Account, type AccountContext, type CreatorIdentityVerificationResult, type PlatformAccountIdentityBinding, type XhsIdentityAcceptance } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuContextPageInventory, XiaohongshuCreatorIdentityObservation, XiaohongshuCurrentFileInputState, XiaohongshuCurrentImageEditorReadiness, XiaohongshuCurrentPostUploadReconciliation, XiaohongshuGlobalExactPublishDomRuntimeDiagnostic, XiaohongshuPublishEditorDomRuntimeDiagnostic, XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import { createXhsContextIdentityAttestation, validateXhsContextIdentityAttestation, type XhsContextIdentityAttestation, type XhsContextIdentityAttestationResult, type XhsContextIdentityRuntime } from "./xhs-context-identity-attestation";

type IdentityReader = {
  inspectCanonicalPageRuntime?: (ctx: AccountContext) => Promise<XiaohongshuCanonicalPageRuntimeProbe>;
  inspectXhsContextPages?: (ctx: AccountContext) => Promise<XiaohongshuContextPageInventory>;
  inspectXhsPublishEntryDom?: (ctx: AccountContext) => Promise<XiaohongshuPublishEntryDomRuntimeDiagnostic>;
  inspectCurrentXiaohongshuImageEditorReadiness?: (ctx: AccountContext) => Promise<XiaohongshuCurrentImageEditorReadiness>;
  inspectCurrentXiaohongshuPublishEditorDom?: (ctx: AccountContext) => Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic>;
  inspectCurrentXiaohongshuPublishEditorSemanticCandidates?: (ctx: AccountContext) => Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic>;
  inspectCurrentXiaohongshuGlobalExactPublishDom?: (ctx: AccountContext) => Promise<XiaohongshuGlobalExactPublishDomRuntimeDiagnostic>;
  inspectCurrentXiaohongshuPostUploadReconciliation?: (ctx: AccountContext) => Promise<XiaohongshuCurrentPostUploadReconciliation>;
  inspectCurrentXiaohongshuFileInputState?: (ctx: AccountContext) => Promise<XiaohongshuCurrentFileInputState>;
  readCanonicalCreatorIdentity?: (ctx: AccountContext) => Promise<XiaohongshuCreatorIdentityObservation>;
  getBrowserRuntimeSnapshot?: (ctx: AccountContext) => BrowserSessionRuntimeSnapshot;
};

export interface XhsIdentityServiceOptions {
  repository: Pick<AppRepository, "getAccountById" | "getPlatformAccountIdentityBinding" | "bindPlatformAccountIdentity" | "convergeUnusedOneShotAuthorization">;
  registry: Pick<AdapterRegistry, "getForContent">;
  logger?: Logger;
}

const BLOCKED_ROUTE_CLASSES = new Set<XiaohongshuCreatorIdentityObservation["routeClass"]>(["LOGIN", "SECURITY_VERIFICATION", "UNKNOWN"]);

function safeUrlParts(value: string): { origin: string; pathname: string } {
  try {
    const parsed = new URL(value);
    return { origin: parsed.origin, pathname: parsed.pathname };
  } catch {
    return { origin: "", pathname: "" };
  }
}

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
    const identity = await this.verifyCreatorIdentity(accountId);
    const parsedSourceUrl = safeUrlParts(identity.canonicalPageUrl);
    const result = createXhsContextIdentityAttestation({
      accountId: account.id,
      expectedExternalCreatorId: identity.expectedExternalCreatorId,
      observedExternalCreatorId: identity.observed.externalCreatorId,
      identityObservationStatus: identity.verified ? "PASS" : "NOT_VERIFIED",
      browserSessionIdentity: runtime.browserSessionIdentity ?? null,
      browserContextIdentity: runtime.contextDebugId,
      sourcePageIdentity: identity.canonicalPageId,
      sourceOrigin: parsedSourceUrl.origin,
      sourcePathname: parsedSourceUrl.pathname,
      browserConnected: runtime.browserConnected === true,
      pageClosed: runtime.canonicalPageClosed === true,
      runtimeAuthState: runtime.runtimeAuthState,
      externalAccountId: account.externalAccountId
    });
    if (result.status === "PASS" && (identity.canonicalContextId !== runtime.contextDebugId || identity.canonicalPageId !== runtime.canonicalPageDebugId)) {
      this.contextIdentityAttestations.delete(account.id);
      return { status: "BLOCKED", failureCode: "IDENTITY_RUNTIME_SCOPE_MISMATCH" };
    }
    if (result.status === "PASS") this.contextIdentityAttestations.set(account.id, result.attestation);
    else this.contextIdentityAttestations.delete(account.id);
    return result;
  }

  async validateContextIdentityAttestation(accountId: string): Promise<ReturnType<typeof validateXhsContextIdentityAttestation>> {
    const account = this.requireAccount(accountId);
    const attestation = this.contextIdentityAttestations.get(account.id);
    if (!attestation) return { valid: false, failureCode: "CONTEXT_IDENTITY_ATTESTATION_MISSING" };
    const adapter = this.options.registry.getForContent("xiaohongshu", "article") as IdentityReader;
    if (typeof adapter.getBrowserRuntimeSnapshot !== "function") return { valid: false, failureCode: "XHS_RUNTIME_SNAPSHOT_UNAVAILABLE" };
    const runtime = adapter.getBrowserRuntimeSnapshot(this.context(account));
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
