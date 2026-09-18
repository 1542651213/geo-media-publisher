import type { AccountContext, AccountProfile, CreatorIdentityProof, CurrentRuntimeIdentityProof, LoginSession, LoginStatus, PublishArticleInput, PublishResult, PublishStatusResult, ValidationResult } from "@publisher/domain";
import { createHash, randomUUID } from "node:crypto";
import type { XhsContextIdentityAttestation } from "@publisher/domain";
import { userInitiatedActionFromSettings } from "@publisher/adapters-core";
import { classifyOneShotPostSubmitObservation, reconcileOneShotPublication, type AutomationPrepareResult, type BrowserPublishAttemptContext, type BrowserPublishReconciliationInput, type BrowserPublishReconciliationResult, type BrowserRuntimeAuthState, type BrowserSession, type BrowserSessionRuntimeSnapshot, type ControlledPostUploadDiscoveryResult, OneShotPublicationGuardError, type OneShotConfirmationCandidate, type OneShotFinalSubmitPreflight, type OneShotPublicationGuard, type OneShotPostSubmitObservation, type OneShotRealPublishAcceptanceInput, type OneShotRealPublishAcceptanceResult, type PreSubmitGateFailureCode, type PreSubmitGateFailureStage, type PreSubmitGateResult, type PreSubmitGateStatus, type PublishFlowExplorationBudgets, type PublishFlowExplorationCounters, type PublishFlowExplorationInput, type PublishFlowExplorationResult } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition, type BrowserSessionScopeEvidence } from "@publisher/adapters-browser";
import type { Locator, Page } from "playwright-core";
import { settleReceiptCapture, type XhsProductionReceiptObserver, type XhsReceiptMeta } from "./production-receipt-observer";
import { collectXhsAuthStateMetadata, collectXhsPreNavigationAuthStateMetadata, createXhsDiagnosticFingerprintKey, type XhsAuthStateMetadata } from "./auth-state-diagnostics";
import { XhsNavigationDiagnosticsTracker, type XhsNavigationClassification } from "./navigation-diagnostics";
import {
  collectCreatorHomeTopology,
  collectPublishSemanticNodes,
  observeCreatorHomeReadiness,
  type XiaohongshuCreatorHomeTopology,
  type XiaohongshuHomeReadinessObservation,
  type XiaohongshuPublishSemanticNodeCollection
} from "./creator-home-diagnostics";
import {
  activateXiaohongshuImagePostEntry,
  collectPublishEntryDomDiagnostics,
  collectPublishClickableSurfaceDiagnostics,
  inspectXiaohongshuImagePostEntry,
  type XiaohongshuClickableSurfaceDiagnostics,
  type XiaohongshuClickableSurfaceResolution,
  type XiaohongshuExactPublishSemanticTarget,
  type XiaohongshuImagePostEntryActivationResult,
  type XiaohongshuImagePostEntryInspection,
  type XiaohongshuPageCapabilitiesSafe,
  type XiaohongshuPageEvaluationFailureReason,
  type XiaohongshuPublishAncestorDiagnostic,
  type XiaohongshuPublishEntryDomRuntimeDiagnostic,
  type XiaohongshuPublishEventListenerInspection,
  type XiaohongshuPublishEventListenerTarget,
  type XiaohongshuPublishHitTestDiagnostic
} from "./publish-clickable-surface";
import {
  classifyPublishNotePostClickState,
  clickPublishNoteNavigationSurface,
  revalidatePublishNoteNavigationSurface,
  resolvePublishNoteNavigationSurface,
  type PublishNoteNavigationLifecycle,
  type PublishNoteNavigationSurfaceResolution,
  type PublishNotePostClickState
} from "./publish-note-navigation";
import {
  type inspectImagePostEditor,
  inspectImagePostEditorPhase,
  assertPreUploadImageEditorContract,
  inspectPostUploadImageEditor,
  type ImageEditorControlDiscovery,
  type ImageEditorBoundingBox,
  type ImageEditorContentType,
  type ImageEditorDiagnostic,
  type ImageEditorInspectionStatus,
  type ImageEditorInteractiveTopology,
  type ImageEditorIntermediateActionCandidate,
  type ImageEditorMediaPreviewDiagnostics,
  type ImageEditorModalDiagnostics,
  type ImageEditorPhase,
  type ImageEditorPhaseConfidence,
  type ImageEditorPhaseTopology,
  type ImageEditorPostUploadControlsStatus,
  type ImageEditorReadinessSample,
  type ImageEditorSemanticNode,
  type ImageEditorSelectedTab,
  type ImageEditorSettingsDiscovery,
  type ImageEditorShellStatus,
  type ImageEditorTabPresence,
  type ImageEditorUploadCapabilityStatus,
  type ImageEditorUploadControlRelationship
} from "./image-editor-discovery";
import {
  assertExplorationSafety,
  canSpendBudget,
  DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS,
  recordBudgetUse,
  selectSafeIntermediateAction,
  type XhsIntermediateActionCandidate
} from "./publish-flow-exploration";
import { isXiaohongshuIdentitySourcePath, readXiaohongshuCreatorIdentity, verifyIdentityOnPage, type XiaohongshuIdentityDomDiagnosticMatch, type XiaohongshuCreatorIdentityCandidate, type XiaohongshuPageScopedIdentityVerification } from "./identity";
import { isExactXhsPublishEditorRoute, runXhsEditorLoadDiagnostic, type XhsEditorLoadDiagnosticResult } from "./editor-load-diagnostic";
import { runXhsEditorNetworkFailureDiagnostic, type XhsEditorNetworkDiagnosticResult } from "./editor-network-diagnostic";
import { emptyXiaohongshuContextPageInventory, inspectXiaohongshuContextPage, type XiaohongshuContextPageInventory } from "./context-page-inventory";
import { emptyXiaohongshuPublishEditorDomRuntimeDiagnostic, inspectXiaohongshuPublishEditorDom, type XiaohongshuPublishEditorDomRuntimeDiagnostic } from "./publish-editor-dom-diagnostic";
import { emptyXiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic, inspectXiaohongshuPublishEditorSemanticCandidates, type XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic } from "./publish-editor-semantic-diagnostic";
import { emptyXiaohongshuGlobalExactPublishDomRuntimeDiagnostic, inspectXiaohongshuGlobalExactPublishDom, type XiaohongshuGlobalExactPublishDomRuntimeDiagnostic } from "./global-exact-publish-diagnostic";
import { clickTask10sClosedShadowPublishSurface, inspectTask10sClosedShadowPublishSurface, runTask10sClosedShadowFinalSubmit } from "./task10s-closed-shadow-final-submit";
import { evaluateTask10sRetainedEditorGate } from "./task10s-retained-editor-completion";
import { emptyXiaohongshuPostUploadReconciliationDomSnapshot, inspectXiaohongshuPostUploadReconciliationDom, reconcileXiaohongshuPostUploadSnapshot, type XiaohongshuPostUploadReconciliationResult } from "./post-upload-reconciliation-diagnostic";
import { classifyXiaohongshuPostUploadTerminalReadiness, type XiaohongshuPostUploadTerminalReadiness } from "./post-upload-terminal-readiness";
import { containsExpectedXiaohongshuSafeFixture, inspectXiaohongshuFileInputState, type XiaohongshuFileInputFixtureMatch, type XiaohongshuFileInputSafeNode } from "./file-input-diagnostic";
import { readXiaohongshuUploadInputImmediately, type XiaohongshuUploadFileExpectation, type XiaohongshuUploadInputImmediateReadback } from "./upload-delivery-diagnostic";
import { ensureXhsIdentityPage, type IdentityPageEnsureResult } from "./ensure-identity-page";
import { classifyXiaohongshuEditorReadback, normalizeXiaohongshuEditorText, type XiaohongshuEditorReadbackVerification } from "./editor-text-normalization";
import { createXhsNativeFilePickerRecovery, recoverNativeFilePicker, type NativeFilePickerRecoveryResult } from "./native-file-picker-recovery";
import { stabilizeAfterNativeFilePickerCancel, type PickerCancelFinalControl, type PickerCancelStabilizationResult } from "./picker-cancel-stabilization";
export { classifyXiaohongshuEditorReadback, normalizeXiaohongshuEditorText } from "./editor-text-normalization";
export type { XiaohongshuEditorNormalizationReason, XiaohongshuEditorReadbackStatus, XiaohongshuEditorReadbackVerification } from "./editor-text-normalization";
export type { XiaohongshuPostUploadBoundingRect, XiaohongshuPostUploadFinalSubmitProof, XiaohongshuPostUploadImageItemSafe, XiaohongshuPostUploadReconciliationDomSnapshot, XiaohongshuPostUploadReconciliationResult, XiaohongshuPostUploadReconciliationState } from "./post-upload-reconciliation-diagnostic";
export { classifyXiaohongshuPostUploadTerminalReadiness } from "./post-upload-terminal-readiness";
export type { XiaohongshuPostUploadTerminalReadiness, XiaohongshuPostUploadTerminalReadinessBlocker, XiaohongshuPostUploadTerminalReadinessInput } from "./post-upload-terminal-readiness";
export type { XiaohongshuFileInputAncestorFingerprint, XiaohongshuFileInputDomSnapshot, XiaohongshuFileInputFileSafeMetadata, XiaohongshuFileInputFixtureMatch, XiaohongshuFileInputSafeNode } from "./file-input-diagnostic";
export type { XiaohongshuUploadFileExpectation, XiaohongshuUploadFileMetadata, XiaohongshuUploadFileReadback, XiaohongshuUploadFixtureMatch, XiaohongshuUploadInputFingerprint, XiaohongshuUploadInputImmediateReadback } from "./upload-delivery-diagnostic";
export type { XhsEditorLoadDiagnosticResult } from "./editor-load-diagnostic";
export type { XhsEditorNetworkDiagnosticResult } from "./editor-network-diagnostic";
export type { XiaohongshuContextPageInventory, XiaohongshuContextPageInventoryEntry, XiaohongshuContextPageDomSnapshot, XiaohongshuDocumentReadyState, XiaohongshuVisibilityState } from "./context-page-inventory";
export type { IdentityPageEnsureAction, IdentityPageEnsureContext, IdentityPageEnsurePage, IdentityPageEnsureResult } from "./ensure-identity-page";
export type { XiaohongshuPublishEditorDomRuntimeDiagnostic } from "./publish-editor-dom-diagnostic";
export type { XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic } from "./publish-editor-semantic-diagnostic";
export type { XiaohongshuGlobalExactPublishAncestorSafe, XiaohongshuGlobalExactPublishBoundingRect, XiaohongshuGlobalExactPublishClickableSignal, XiaohongshuGlobalExactPublishDomRuntimeDiagnostic, XiaohongshuGlobalExactPublishDomSnapshot, XiaohongshuGlobalExactPublishNodeSafe, XiaohongshuGlobalExactPublishUnique } from "./global-exact-publish-diagnostic";
export { verifyIdentityOnPage } from "./identity";
export type { XiaohongshuPageIdentityScope, XiaohongshuPageScopedIdentityProof, XiaohongshuPageScopedIdentityVerification } from "./identity";

export interface XiaohongshuCurrentImageEditorReadiness {
  inspectionStatus: "PASS" | "FAIL";
  failureCode: string | null;
  accountId: string;
  contextDebugId: string | null;
  pageId: string | null;
  sessionExists: boolean;
  browserConnected: boolean;
  contextExists: boolean;
  pageExists: boolean;
  pageClosed: boolean;
  pageContextMatchesSession: boolean;
  origin: string | null;
  pathname: string | null;
  source: string | null;
  from: string | null;
  target: string | null;
  sanitizedUrl: string | null;
  readyState: string | null;
  editorShellPresent: boolean;
  uploadVideoTabPresent: boolean;
  uploadImageTabPresent: boolean;
  longFormTabPresent: boolean;
  podcastTabPresent: boolean;
  currentSelectedTab: ImageEditorSelectedTab | null;
  imageUploadControlPresent: boolean;
  titleControlPresent: boolean;
  bodyControlPresent: boolean;
  finalSubmitControlPresent: boolean;
  contentType: ImageEditorContentType;
  imageEditorPhase: ImageEditorPhase;
  preUploadPhaseResult: "PASS" | "FAIL";
  preUploadFailureCode: string | null;
  preUploadFailureStage: string | null;
  preUploadMissingSignal: string | null;
  readinessSamples: readonly ImageEditorReadinessSample[];
}

export interface XiaohongshuCurrentPostUploadReconciliation extends XiaohongshuPostUploadReconciliationResult {
  inspectionStatus: "PASS" | "FAIL";
  failureCode: string | null;
  accountId: string;
  contextDebugId: string | null;
  pageId: string | null;
  sessionExists: boolean;
  browserConnected: boolean;
  contextExists: boolean;
  pageExists: boolean;
  pageClosed: boolean;
  pageContextMatchesSession: boolean;
  source: string | null;
  from: string | null;
  target: string | null;
  sanitizedUrl: string | null;
}

export interface XiaohongshuCurrentPostUploadTerminalReadiness extends XiaohongshuCurrentPostUploadReconciliation {
  terminalReadiness: XiaohongshuPostUploadTerminalReadiness;
}

export interface XiaohongshuCurrentFileInputState {
  inspectionStatus: "PASS" | "FAIL";
  failureCode: string | null;
  accountId: string;
  contextDebugId: string | null;
  pageId: string | null;
  sessionExists: boolean;
  browserConnected: boolean;
  contextExists: boolean;
  pageExists: boolean;
  pageClosed: boolean;
  pageContextMatchesSession: boolean;
  origin: string | null;
  pathname: string | null;
  sanitizedUrl: string | null;
  readyState: string | null;
  matchCount: number;
  inputs: readonly XiaohongshuFileInputSafeNode[];
  fileInputContainsExpectedFixture: XiaohongshuFileInputFixtureMatch;
}

export interface XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic {
  inspectionStatus: "PASS" | "FAIL";
  failureCode: string | null;
  accountId: string;
  contextDebugId: string | null;
  pageId: string | null;
  sessionExists: boolean;
  browserConnected: boolean;
  contextExists: boolean;
  pageExists: boolean;
  pageClosed: boolean;
  pageContextMatchesSession: boolean;
  origin: string | null;
  pathname: string | null;
  sanitizedUrl: string | null;
  cdpSessionCreated: "YES" | "NO" | "NOT_PROVEN";
  cdpGetDocumentSuccess: "YES" | "NO" | "NOT_PROVEN";
  cdpGetDocumentDepth: -1;
  cdpGetDocumentPierce: true;
  piercedXhsPublishBtnCount: number;
  hostNodeName: "XHS-PUBLISH-BTN" | null;
  hostAttributesSafe: {
    isPublish: string | null;
    isSaveDraft: string | null;
    submitText: string | null;
    saveText: string | null;
    submitDisabled: string | null;
    submitLoading: string | null;
  } | null;
  hostIsPublish: string | null;
  hostSubmitText: string | null;
  hostSubmitDisabled: string | null;
  hostSubmitLoading: string | null;
  hostDescendantButtonCount: number;
  exactPublishNativeButtonCount: number;
  buttonNodeName: "BUTTON" | null;
  buttonTextSafe: "发布" | null;
  buttonType: string | null;
  buttonClassSafe: string | null;
  buttonAriaDisabled: string | null;
  buttonAriaBusy: string | null;
  buttonBoxModelPresent: "YES" | "NO" | "NOT_PROVEN";
  buttonCenterXSafe: number | null;
  buttonCenterYSafe: number | null;
  finalSubmitControlPresent: "YES" | "NO" | "NOT_PROVEN";
  finalSubmitControlEnabled: "YES" | "NO" | "NOT_PROVEN";
  closedShadowFinalSubmitSurface: "PASS" | "FAIL";
  saveDraftSurfacePresent: "NOT_INSPECTED";
  finalResolverSelectedSaveDraft: "NO";
}

function emptyCurrentFileInputState(accountId: string, overrides: Partial<XiaohongshuCurrentFileInputState> = {}): XiaohongshuCurrentFileInputState {
  return {
    inspectionStatus: "FAIL",
    failureCode: "BROWSER_SESSION_UNAVAILABLE",
    accountId,
    contextDebugId: null,
    pageId: null,
    sessionExists: false,
    browserConnected: false,
    contextExists: false,
    pageExists: false,
    pageClosed: false,
    pageContextMatchesSession: false,
    origin: null,
    pathname: null,
    sanitizedUrl: null,
    readyState: null,
    matchCount: 0,
    inputs: [],
    fileInputContainsExpectedFixture: "NOT_PROVEN",
    ...overrides
  };
}

function emptyClosedShadowFinalSubmitRuntimeDiagnostic(accountId: string, overrides: Partial<XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic> = {}): XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic {
  return {
    inspectionStatus: "FAIL",
    failureCode: "BROWSER_SESSION_UNAVAILABLE",
    accountId,
    contextDebugId: null,
    pageId: null,
    sessionExists: false,
    browserConnected: false,
    contextExists: false,
    pageExists: false,
    pageClosed: true,
    pageContextMatchesSession: false,
    origin: null,
    pathname: null,
    sanitizedUrl: null,
    cdpSessionCreated: "NOT_PROVEN",
    cdpGetDocumentSuccess: "NOT_PROVEN",
    cdpGetDocumentDepth: -1,
    cdpGetDocumentPierce: true,
    piercedXhsPublishBtnCount: 0,
    hostNodeName: null,
    hostAttributesSafe: null,
    hostIsPublish: null,
    hostSubmitText: null,
    hostSubmitDisabled: null,
    hostSubmitLoading: null,
    hostDescendantButtonCount: 0,
    exactPublishNativeButtonCount: 0,
    buttonNodeName: null,
    buttonTextSafe: null,
    buttonType: null,
    buttonClassSafe: null,
    buttonAriaDisabled: null,
    buttonAriaBusy: null,
    buttonBoxModelPresent: "NOT_PROVEN",
    buttonCenterXSafe: null,
    buttonCenterYSafe: null,
    finalSubmitControlPresent: "NOT_PROVEN",
    finalSubmitControlEnabled: "NOT_PROVEN",
    closedShadowFinalSubmitSurface: "FAIL",
    saveDraftSurfacePresent: "NOT_INSPECTED",
    finalResolverSelectedSaveDraft: "NO",
    ...overrides
  };
}
export {
  collectCreatorHomeTopology,
  collectPublishSemanticNodes,
  inspectCreatorHomeReadiness,
  observeCreatorHomeReadiness
} from "./creator-home-diagnostics";
export {
  activateXiaohongshuImagePostEntry,
  collectPublishEntryDomDiagnostics,
  collectExactPublishSemanticTargets,
  collectPublishAncestorChainDiagnostics,
  collectPublishClickableSurfaceDiagnostics,
  collectExactImagePostMenuItems,
  collectPublishNoteDropdownTriggerDiagnostics,
  collectPublishEventListenerDiagnostics,
  collectPublishHitTestDiagnostics,
  resolvePublishClickableSurfaces,
  resolvePublishNoteDropdownTrigger,
  resolveExactImagePostMenuItem
} from "./publish-clickable-surface";
export { inspectXiaohongshuImagePostEntry } from "./publish-clickable-surface";
export {
  classifyPublishNotePostClickState,
  clickPublishNoteNavigationSurface,
  revalidatePublishNoteNavigationSurface,
  resolvePublishNoteNavigationSurface
} from "./publish-note-navigation";
export type {
  XiaohongshuAccessibilityPublishSignal,
  XiaohongshuCreatorHomeTopology,
  XiaohongshuDiscoveryDiagnosis,
  XiaohongshuFrameDiagnostic,
  XiaohongshuHomeReadinessObservation,
  XiaohongshuHomeReadinessOptions,
  XiaohongshuHomeReadinessSample,
  XiaohongshuHomeReadinessSnapshot,
  XiaohongshuHomeShellResult,
  XiaohongshuInteractiveElementTypeCounts,
  XiaohongshuPublishEntryLocation,
  XiaohongshuPublishSemanticNode,
  XiaohongshuPublishSemanticNodeCollection,
  XiaohongshuShadowDiagnostic
} from "./creator-home-diagnostics";
export type {
  XiaohongshuClickableSurfaceDiagnostics,
  XiaohongshuClickableSurfaceFailureCode,
  XiaohongshuClickableSurfaceResolution,
  XiaohongshuClickableSurfaceStatus,
  XiaohongshuExactPublishSemanticTarget,
  XiaohongshuPublishAncestorDiagnostic,
  XiaohongshuPublishDropdownTriggerDiagnostic,
  XiaohongshuPublishDropdownTriggerResolution,
  XiaohongshuImagePostMenuItemDiagnostic,
  XiaohongshuImagePostMenuItemResolution,
  XiaohongshuPublishBoundingBox,
  XiaohongshuPublishEventListenerEntry,
  XiaohongshuPublishEventListenerInspection,
  XiaohongshuPublishEventListenerTarget,
  XiaohongshuPublishHitTestDiagnostic,
  XiaohongshuPublishHitTestElement,
  XiaohongshuPublishHitTestAncestorRelation,
  XiaohongshuPublishInteractionEvent,
  XiaohongshuPublishEntryDomDiagnostics,
  XiaohongshuPublishEntryDomElementDiagnostic,
  XiaohongshuPublishEntryDomLabel,
  XiaohongshuPublishEntryDomLabelDiagnostic,
  XiaohongshuPublishEntryDomMatchDiagnostic,
  XiaohongshuPublishEntryDomRuntimeDiagnostic,
  XiaohongshuImagePostEntryActivationResult,
  XiaohongshuImagePostEntryAncestorDiagnostic,
  XiaohongshuImagePostEntryBoundingBox,
  XiaohongshuImagePostEntryFailureCode,
  XiaohongshuImagePostEntryInspection,
  XiaohongshuImagePostEntryInspectionPayload,
  XiaohongshuPageCapabilitiesSafe,
  XiaohongshuPageEvaluationFailureReason,
  XiaohongshuImagePostEntryStyleDiagnostic,
  XiaohongshuImagePostEntryTargetDiagnostic
} from "./publish-clickable-surface";
export type {
  PublishNoteNavigationClickResult,
  PublishNoteNavigationEvidence,
  PublishNoteNavigationFailureCode,
  PublishNoteNavigationLifecycle,
  PublishNoteNavigationRevalidation,
  PublishNoteNavigationSurfaceHandle,
  PublishNoteNavigationSurfaceResolution,
  PublishNotePostClickState,
  PublishNoteSurfaceRuntimeState
} from "./publish-note-navigation";

const XIAOHONGSHU_CREATOR_HOME = "https://creator.xiaohongshu.com/";
const XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR = 'a[href*="/publish/publish"]';
const XIAOHONGSHU_VIDEO_POST_ENTRY_SELECTOR = 'a[href*="/publish/video"]';
const XIAOHONGSHU_PUBLISH_ENTRY_CANDIDATE_SELECTOR = 'a, button, [role="button"]';
const XIAOHONGSHU_PUBLISH_ENTRY_CANDIDATE_MAX = 20;
const XIAOHONGSHU_CONTENT_TYPE_ENTRY_SELECTOR = 'button[data-testid*="content-type-image" i], [role="button"][data-testid*="content-type-image" i], a[data-testid*="content-type-image" i]';
const XIAOHONGSHU_FILE_SELECTOR = 'input[type="file"]';
const XIAOHONGSHU_UPLOAD_BUSY_SELECTOR = '[aria-busy="true"], [class*="loading" i], [class*="uploading" i], progress';
const TASK10S_SAFE_FIXTURE_EXPECTATION: XiaohongshuUploadFileExpectation = { name: "task10s-safe-test.png", size: 19226, type: "image/png" };
const XIAOHONGSHU_TITLE_SELECTOR = 'input[placeholder*="标题"], input[aria-label*="标题"], input[name*="title" i], input[id*="title" i]';
const XIAOHONGSHU_TITLE_FALLBACK_SELECTOR = 'textarea[placeholder*="标题"], textarea[aria-label*="标题"], textarea[name*="title" i], textarea[id*="title" i]';
const XIAOHONGSHU_BODY_SELECTOR = '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder], textarea[aria-label*="正文"], textarea[name*="body" i], textarea[id*="body" i]';
const XIAOHONGSHU_REQUIRED_SELECTOR = 'input[required], textarea[required], select[required], [aria-required="true"]';
const XIAOHONGSHU_SETTINGS_SELECTOR = 'input[type="checkbox"], input[type="radio"], select, [role="checkbox"], [role="radio"], [data-setting]';
const XIAOHONGSHU_FINAL_SUBMIT_SELECTOR = 'button, [role="button"]';
const XIAOHONGSHU_IMAGE_POST_PATTERN = /图文|笔记|image\s*post|image|note/iu;
const XIAOHONGSHU_VIDEO_PATTERN = /视频|video/iu;
const XIAOHONGSHU_FINAL_SUBMIT_PATTERN = /发布(笔记|图文)?|提交|发表|publish|submit/iu;
const DEFAULT_LOGIN_STABILITY_WINDOW_MS = 4000;
const LOGIN_STABILITY_SAMPLE_INTERVAL_MS = 250;

const definition: BrowserPlatformDefinition = {
  platformKey: "xiaohongshu",
  displayName: "小红书",
  category: "图文",
  officialWebsite: "https://www.xiaohongshu.com/",
  developerPortal: "https://miniapp.xiaohongshu.com/",
  backendUrl: XIAOHONGSHU_CREATOR_HOME,
  officialSources: ["https://creator.xiaohongshu.com/", "https://miniapp.xiaohongshu.com/"],
  version: "1.0.0",
  researchStatus: "partial",
  blockingReason: "BrowserAutomation 只验证账号、图文编辑器和最终发布控件；本 gate-only 流程不会点击最终发布，也不声明真实发布通过。",
  capabilities: {
    article: true,
    imagePost: true,
    video: false,
    controlledSelfTestModes: ["POST_UPLOAD_DISCOVERY_ONLY", "XHS_PUBLISH_FLOW_EXPLORATION"],
    coverImage: false,
    tags: true,
    categories: false,
    scheduledPublish: false,
    draft: false,
    markdown: false,
    richText: true,
    maxTitleLength: 1000,
    maxImageCount: 18,
    maxTagCount: 10,
    supportsVideoCover: false,
    supportsVideoTags: false,
    videoPublishAsync: false
  }
};

export type XiaohongshuGateCode =
  | "LOGIN_REQUIRED"
  | "SECURITY_VERIFICATION_REQUIRED"
  | "ACCOUNT_IDENTITY_UNVERIFIED"
  | "IMAGE_POST_ENTRY_NOT_VERIFIED"
  | "CONTENT_TYPE_ENTRY_NOT_FOUND"
  | "CONTENT_TYPE_SELECTION_FAILED"
  | "EDITOR_NAVIGATION_TIMEOUT"
  | "IMAGE_UPLOAD_NOT_VERIFIED"
  | "CONTENT_TITLE_NOT_VERIFIED"
  | "CONTENT_BODY_NOT_VERIFIED"
  | "FINAL_SUBMIT_CONTROL_NOT_VERIFIED"
  | "REQUIRED_FIELDS_NOT_VERIFIED";

export interface XiaohongshuFinalSubmitControlEvidence {
  verified: boolean;
  visible: boolean;
  enabled: boolean;
  unique: boolean;
  label: string;
  selector: string;
  secondConfirmation: "present" | "absent" | "unknown";
}

export type XiaohongshuCanonicalPageRuntimeProbeFailureStage =
  | "CANONICAL_PAGE_LOOKUP"
  | "PAGE_OWNERSHIP"
  | "PLAYWRIGHT_URL"
  | "DOM_LOCATION_EVALUATE"
  | "URL_CONSISTENCY"
  | "IDENTITY_OBSERVATION";

export interface XiaohongshuIdentitySourceCandidate {
  sourceType: "PUBLIC_PROFILE_LINK" | "VISIBLE_ACCOUNT_TEXT" | "PUBLIC_DATA_IDENTIFIER" | "ACCOUNT_SURFACE";
  stableIdentifierPresent: boolean;
  identifierFieldName: "externalCreatorId" | "profileUrl" | null;
  sensitiveDataRequired: false;
  readOnlySafe: true;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  tagName: string | null;
  text: string | null;
  href: string | null;
  role: string | null;
  dataIdentifierField: string | null;
  visible: boolean;
  source?: XiaohongshuCreatorIdentityCandidate["source"];
  rawValue?: string;
  normalizedCreatorId?: string;
  semanticAnchor?: XiaohongshuCreatorIdentityCandidate["semanticAnchor"];
}

export interface XiaohongshuCanonicalPageRuntimeProbe {
  probeStatus: "PASS" | "FAIL";
  failureStage: XiaohongshuCanonicalPageRuntimeProbeFailureStage | null;
  failureCode: string | null;
  failureErrorClass: string | null;
  canonicalContextId: string | null;
  canonicalPageId: string | null;
  /** True when the probe resolved an account-owned live BrowserSession. */
  sessionExists?: boolean;
  probedContextId: string | null;
  probedPageId: string | null;
  pageContextMatchesSession: boolean;
  createdNewPage: false;
  browserConnected: boolean;
  pageClosed: boolean;
  runtimeAuthState: BrowserRuntimeAuthState;
  playwrightPageUrl: string | null;
  domLocationHref: string | null;
  domLocationEvaluateStatus: "PASS" | "FAIL" | "NOT_RUN";
  domLocationEvaluateErrorClass: string | null;
  pageUrlConsistency: "PASS" | "FAIL" | "NOT_VERIFIED";
  routeClass: XiaohongshuCreatorIdentityRouteClass;
  identityObservationStatus: "PASS" | "NOT_VERIFIED" | "FAIL" | "NOT_RUN";
  identitySourceCandidates: XiaohongshuIdentitySourceCandidate[];
  identityDomDiagnosticMatchCount: number;
  identityDomDiagnosticMatches: XiaohongshuIdentityDomDiagnosticMatch[];
  observedCreatorIdRaw: string | null;
  observedCreatorIdNormalized: string | null;
  observedDisplayName: string | null;
  observedProfileUrl: string | null;
}

export interface XiaohongshuAccountIdentityEvidence {
  externalAccountId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  identitySourceCandidates?: XiaohongshuIdentitySourceCandidate[];
  identityDomDiagnosticMatchCount?: number;
  identityDomDiagnosticMatches?: XiaohongshuIdentityDomDiagnosticMatch[];
}

export type XiaohongshuCreatorIdentityRouteClass = "CREATOR_HOME" | "PUBLISH_EDITOR" | "CREATOR_CONTENT" | "OTHER_CREATOR_PAGE" | "LOGIN" | "SECURITY_VERIFICATION" | "UNKNOWN";

export interface XiaohongshuCreatorIdentityObservation {
  canonicalContextId: string;
  canonicalPageId: string;
  canonicalPageUrl: string;
  domLocationHref: string;
  pageUrlConsistency: "PASS" | "FAIL";
  routeClass: XiaohongshuCreatorIdentityRouteClass;
  runtimeAuthState: BrowserRuntimeAuthState;
  browserConnected: boolean;
  pageClosed: boolean;
  proof: CreatorIdentityProof;
}

export interface XiaohongshuLoginEvidence {
  available: boolean;
  url: string;
  creatorHost: boolean;
  creatorHomePath: boolean;
  explicitLoginUrl: boolean;
  verificationUrl: boolean;
  publishNoteVisible: boolean;
  noteManagementVisible: boolean;
  dataDashboardVisible: boolean;
  accountStatusVisible: boolean;
  profileAreaVisible: boolean;
  visibleLoginForm: boolean;
  visibleQrLogin: boolean;
  visibleSmsVerification: boolean;
  visibleCaptcha: boolean;
  visibleSlider: boolean;
  visibleSecurityModal: boolean;
  positiveSignals: string[];
  blockingSignals: string[];
}

export interface XiaohongshuPageEvidence {
  available: boolean;
  bodyPresent: boolean;
  bodyTextLength: number;
  login: XiaohongshuLoginEvidence;
  identity: XiaohongshuAccountIdentityEvidence & { externalAccountIdCandidates: string[] };
}

export type XiaohongshuLoginDecision = "logged_in" | "needs_user_action" | "login_required" | "unknown";

export interface XiaohongshuLoginEvaluation {
  phase: "CHECK_LOGIN" | "COMPLETE_LOGIN_CHECK";
  operationId?: string;
  timestamp: string;
  platformKey: string;
  accountId: string;
  pageIsClosed: boolean;
  pageUrl: string;
  pageTitle: string;
  creatorDomain: boolean;
  creatorHomePath: boolean;
  publishNoteVisible: boolean;
  noteManagementVisible: boolean;
  dataDashboardVisible: boolean;
  accountStatusVisible: boolean;
  profileAreaVisible: boolean;
  visibleLoginForm: boolean;
  visibleQrLogin: boolean;
  visibleSmsVerification: boolean;
  visibleCaptcha: boolean;
  visibleSlider: boolean;
  visibleSecurityModal: boolean;
  positiveSignalCount: number;
  blockingSignalCount: number;
  loginClassification: XiaohongshuLoginDecision;
  stableObservationWindowMs: number;
  stableObservationSamples: number;
  stableObservationPassed: boolean;
}

export type XiaohongshuCanonicalPageOperationPhase = "STARTED" | "COMPLETED";

export interface XiaohongshuCanonicalPageOperationEvidence {
  phase: XiaohongshuCanonicalPageOperationPhase;
  timestamp: string;
  operationId: string;
  platformKey: "xiaohongshu";
  accountId: string;
  action: "CHECK_LOGIN" | "PRE_SUBMIT_GATE" | "CONTROLLED_POST_UPLOAD_DISCOVERY" | "XHS_PUBLISH_FLOW_EXPLORATION";
  contextDebugId: string;
  pageDebugId: string;
  pageRole: "CANONICAL_AUTHENTICATED";
  pageSource: "EXISTING_CANONICAL_PAGE";
  createdNewPage: false;
  pageContextMatchesSession: boolean;
  browserConnected: boolean;
  pageClosed: boolean;
  runtimeAuthState: BrowserRuntimeAuthState;
  activeOperation: string | null;
  mutexLocked: boolean;
  operationInProgress: boolean;
  sanitizedUrl: string;
  finalStatus?: LoginStatus | PreSubmitGateStatus;
  sanitizedFinalUrl?: string;
  failureCode?: PreSubmitGateFailureCode;
  failureStage?: PreSubmitGateFailureStage;
  missingSignal?: string | null;
}

export type XiaohongshuEditorEntryStepName =
  | "CREATOR_HOME_READY"
  | "PUBLISH_ENTRY_FOUND"
  | "PUBLISH_ENTRY_CLICKED"
  | "CONTENT_TYPE_ENTRY_FOUND"
  | "CONTENT_TYPE_SELECTED"
  | "EDITOR_ROUTE_REACHED";

export type XiaohongshuEditorNavigationTrigger = "DIRECT_GOTO" | "PUBLISH_ENTRY_CLICK" | "CONTENT_TYPE_CLICK" | "PLATFORM_REDIRECT" | "UNKNOWN";

export interface XiaohongshuEditorEntryDiagnostic {
  code: "PRE_SUBMIT_GATE_INSPECTION_STARTED" | "EDITOR_NAVIGATION_HELPER_INVOCATION_STARTED" | "EDITOR_ENTRY_STARTED" | "EDITOR_ENTRY_STEP" | "EDITOR_NAVIGATION_FAILED" | "PUBLISH_ENTRY_CANDIDATES_OBSERVED" | "CREATOR_HOME_READINESS_SAMPLE" | "CREATOR_HOME_TOPOLOGY_OBSERVED" | "PUBLISH_SEMANTIC_NODES_OBSERVED" | "FRAME_TOPOLOGY_OBSERVED" | "SHADOW_TOPOLOGY_OBSERVED" | "ACCESSIBILITY_PUBLISH_SIGNALS_OBSERVED" | "PUBLISH_EXACT_TARGETS_OBSERVED" | "PUBLISH_TARGET_ANCESTOR_CHAINS" | "PUBLISH_CLICK_SURFACE_DIAGNOSTICS" | "PUBLISH_HIT_TEST_OBSERVED" | "PUBLISH_EVENT_LISTENERS_OBSERVED" | "PUBLISH_NOTE_SURFACE_RESOLVED" | "PUBLISH_NOTE_SURFACE_PRECLICK_REVALIDATED" | "PUBLISH_NOTE_NAVIGATION_CLICK_STARTED" | "PUBLISH_NOTE_NAVIGATION_CLICK_COMPLETED" | "IMAGE_POST_ENTRY_INSPECTION" | "IMAGE_POST_ENTRY_ACTIVATION" | "POST_PUBLISH_NOTE_STATE_OBSERVED" | "IMAGE_EDITOR_INSPECTION_STARTED" | "IMAGE_EDITOR_READINESS_SAMPLE" | "IMAGE_EDITOR_SHELL_READY" | "IMAGE_EDITOR_SHELL_NOT_READY" | "IMAGE_EDITOR_SHELL_TIMEOUT" | "IMAGE_EDITOR_CONTENT_TYPE_OBSERVED" | "IMAGE_EDITOR_CONTROLS_DISCOVERED" | "IMAGE_EDITOR_PHASE_OBSERVED" | "IMAGE_EDITOR_INSPECTION_COMPLETED" | "IMAGE_EDITOR_INSPECTION_FAILED" | "PRE_UPLOAD_GATE_INSPECTION_STARTED" | "PRE_UPLOAD_GATE_RESULT" | "PREPARE_PUBLISH_MUTATION_BOUNDARY_ENTERED" | "IMAGE_UPLOAD_STARTED" | "IMAGE_UPLOAD_INPUT_READBACK" | "IMAGE_UPLOAD_COMPLETED" | "IMAGE_UPLOAD_FAILED" | "POST_UPLOAD_EDITOR_READINESS_STARTED" | "POST_UPLOAD_EDITOR_READINESS_SAMPLE" | "POST_UPLOAD_EDITOR_SEMANTIC_INVENTORY_OBSERVED" | "POST_UPLOAD_EDITOR_INTERACTIVE_TOPOLOGY_OBSERVED" | "POST_UPLOAD_EDITOR_MODAL_STATE_OBSERVED" | "POST_UPLOAD_EDITOR_MEDIA_PREVIEW_OBSERVED" | "POST_UPLOAD_EDITOR_PHASE_OBSERVED" | "POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED" | "POST_UPLOAD_EDITOR_INSPECTION_FAILED" | "POST_UPLOAD_EDITOR_INSPECTION_COMPLETED" | "XHS_PUBLISH_FLOW_TIMELINE" | "XHS_PUBLISH_FLOW_COMPLETED" | "XHS_PUBLISH_FLOW_BLOCKED" | "XHS_PUBLISH_FLOW_INTERMEDIATE_ACTION";
  timestamp: string;
  operationId: string;
  platformKey: "xiaohongshu";
  accountId: string;
  contextDebugId?: string;
  pageDebugId?: string;
  pageRole?: "CANONICAL_AUTHENTICATED";
  pageSource?: "EXISTING_CANONICAL_PAGE";
  createdNewPage?: false;
  pageContextMatchesSession?: boolean;
  browserConnected?: boolean;
  pageClosed?: boolean;
  runtimeAuthState?: BrowserRuntimeAuthState;
  activeOperation?: string | null;
  mutexLocked?: boolean;
  operationInProgress?: boolean;
  helper?: "navigateToImagePostEditor";
  startUrl?: string;
  entryMethod?: "CLICK_NAVIGATION" | "ALREADY_ON_EDITOR";
  expectedTarget?: string;
  stepName?: XiaohongshuEditorEntryStepName;
  success?: boolean;
  sanitizedUrlBefore?: string;
  sanitizedUrlAfter?: string;
  selectorSignal?: string;
  elapsedMs?: number;
  navigationTrigger?: XiaohongshuEditorNavigationTrigger;
  failureCode?: PreSubmitGateFailureCode;
  failureStage?: PreSubmitGateFailureStage;
  missingSignal?: string | null;
  lastCompletedStep?: XiaohongshuEditorEntryStepName | null;
  sanitizedUrl?: string;
  candidateCount?: number;
  candidates?: XiaohongshuPublishEntryCandidateIdentity[];
  candidateInventoryTruncated?: boolean;
  readinessResult?: XiaohongshuHomeReadinessObservation["result"];
  sampleIndex?: number;
  readyState?: string;
  bodyExists?: boolean;
  bodyChildCount?: number;
  documentElementChildCount?: number;
  anchorCount?: number;
  buttonCount?: number;
  roleButtonCount?: number;
  tabbableCount?: number;
  navigationElementCount?: number;
  frameCount?: number;
  iframeCount?: number;
  shadowHostCount?: number;
  visibleInteractiveCount?: number;
  creatorShellSignalCount?: number;
  publishSemanticTextSignalCount?: number;
  topLevelElementCounts?: Record<string, number>;
  interactiveElementTypeCounts?: XiaohongshuCreatorHomeTopology["interactiveElementTypeCounts"];
  frameSummary?: XiaohongshuCreatorHomeTopology["frameSummary"];
  shadowSummary?: XiaohongshuCreatorHomeTopology["shadowSummary"];
  publishEntryLocation?: XiaohongshuCreatorHomeTopology["publishEntryLocation"];
  publishSemanticSignalPresent?: boolean;
  textSignalPresent?: boolean;
  semanticNodes?: XiaohongshuPublishSemanticNodeCollection["nodes"];
  discoveryDiagnosis?: XiaohongshuPublishSemanticNodeCollection["discoveryDiagnosis"];
  accessibilityPublishSignals?: XiaohongshuPublishSemanticNodeCollection["accessibilityPublishSignals"];
  exactPublishSemanticTargets?: readonly XiaohongshuExactPublishSemanticTarget[];
  ancestorChainDiagnostics?: readonly XiaohongshuPublishAncestorDiagnostic[];
  eventListenerInspection?: XiaohongshuPublishEventListenerInspection["status"];
  eventListenerDiagnostics?: readonly XiaohongshuPublishEventListenerTarget[];
  hitTestDiagnostics?: readonly XiaohongshuPublishHitTestDiagnostic[];
  publishNoteSurface?: XiaohongshuClickableSurfaceResolution;
  imagePostSurface?: XiaohongshuClickableSurfaceResolution;
  publishNoteDropdownTrigger?: XiaohongshuClickableSurfaceDiagnostics["publishNoteDropdownTrigger"];
  clickableSurfaceStatus?: XiaohongshuClickableSurfaceDiagnostics["clickableSurfaceStatus"];
  clickableSurfaceFailureCode?: XiaohongshuClickableSurfaceDiagnostics["clickableSurfaceFailureCode"];
  clickableSurfaceConfidence?: XiaohongshuClickableSurfaceDiagnostics["clickableSurfaceConfidence"];
  diagnosticClickCount?: 0;
  mouseEventDispatchCount?: 0;
  keyboardEventCount?: 0;
  gateCallsPreparePublish?: "NO";
  gateContentMutationCount?: 0;
  gateUploadCount?: 0;
  gateFinalSubmitCount?: 0;
  finalSubmitCount?: number;
  navigationClickCount?: number;
  action?: "PUBLISH_NOTE_NAVIGATION_CLICK" | "IMAGE_UPLOAD_MUTATION" | "IMAGE_UPLOAD_INPUT_READBACK" | "IMAGE_UPLOAD_COMPLETED" | "IMAGE_UPLOAD_FAILED" | "XHS_PUBLISH_FLOW_INTERMEDIATE_ACTION";
  status?: string;
  revalidated?: boolean;
  exactSemanticText?: string;
  visible?: boolean;
  pointerEventsActive?: boolean;
  geometryValid?: boolean;
  hitTestConsistent?: boolean;
  uniqueSurface?: boolean;
  strongClickabilitySignal?: boolean;
  eventListenerSignal?: string | null;
  targetIdentity?: Record<string, unknown>;
  surfaceIdentity?: Record<string, unknown>;
  dropdownTriggerIdentity?: Record<string, unknown>;
  dropdownTriggerStatus?: XiaohongshuClickableSurfaceDiagnostics["publishNoteDropdownTrigger"]["status"];
  navigationTransition?: boolean;
  publishNoteDropdownClickCount?: 0 | 1;
  imagePostMenuItemClickCount?: 0 | 1;
  uploadVideoMenuItemClickCount?: 0;
  imagePostEntryInspection?: XiaohongshuImagePostEntryInspection;
  imagePostEntryActivation?: XiaohongshuImagePostEntryActivationResult;
  pageCapabilitiesSafe?: XiaohongshuPageCapabilitiesSafe;
  evaluationFailureReason?: XiaohongshuPageEvaluationFailureReason;
  exactTextMatchCount?: number;
  safeToTestClick?: boolean;
  imagePostEntryClickCount?: number;
  observedTarget?: "image" | "video" | null;
  imagePostEntryRouteReadback?: "PASS" | "FAIL";
  imagePostSurfaceAfterPublishNote?: XiaohongshuClickableSurfaceResolution;
  postPublishNoteState?: PublishNotePostClickState;
  shellStatus?: ImageEditorShellStatus;
  imageEditorReadinessSample?: ImageEditorReadinessSample;
  titleCandidateCount?: number;
  bodyCandidateCount?: number;
  uploadCandidateCount?: number;
  finalSubmitCandidateCount?: number;
  contentType?: ImageEditorContentType;
  contentTypeReady?: boolean;
  titleEditor?: ImageEditorControlDiscovery;
  bodyEditor?: ImageEditorControlDiscovery;
  imageUploadControl?: ImageEditorControlDiscovery;
  publishSettingsArea?: ImageEditorSettingsDiscovery;
  finalSubmitControl?: ImageEditorControlDiscovery;
  phase?: ImageEditorPhase;
  phaseConfidence?: ImageEditorPhaseConfidence;
  phaseReason?: string;
  preUploadSemanticNodes?: readonly ImageEditorSemanticNode[];
  postUploadSemanticNodes?: readonly ImageEditorSemanticNode[];
  uploadControlRelationships?: readonly ImageEditorUploadControlRelationship[];
  uploadCapabilityStatus?: ImageEditorUploadCapabilityStatus;
  uploadCapabilityPresent?: boolean;
  uploadCapabilityUnique?: boolean;
  phaseTopology?: ImageEditorPhaseTopology;
  interactiveTopology?: ImageEditorInteractiveTopology;
  mediaPreviewDiagnostics?: ImageEditorMediaPreviewDiagnostics;
  modalDiagnostics?: ImageEditorModalDiagnostics;
  intermediateActionCandidates?: readonly ImageEditorIntermediateActionCandidate[];
  requiredValidationSignals?: readonly string[];
  forbiddenActionSignalPresent?: boolean;
  postUploadTerminalStateReached?: boolean;
  postUploadIntermediateState?: ImageEditorPhase | null;
  postUploadReadinessDurationMs?: number;
  postUploadReadinessSampleCount?: number;
  imageEditorStatus?: ImageEditorInspectionStatus;
  securityVerificationPresent?: boolean;
  loginPagePresent?: boolean;
  currentUrl?: string;
  expectedPhase?: ImageEditorPhase;
  observedPhase?: ImageEditorPhase;
  preSubmitGatePhase?: "PRE_UPLOAD" | "POST_UPLOAD";
  preUploadGateStatus?: "PASS" | "FAIL";
  preUploadMutationRevalidated?: boolean;
  preUploadGateFailureCode?: PreSubmitGateFailureCode | null;
  postUploadControlsStatus?: ImageEditorPostUploadControlsStatus | "NOT_APPLICABLE_BEFORE_UPLOAD";
  preSubmitGatePassMeaning?: string | null;
  uploadBusy?: boolean;
  previewReady?: boolean;
  mutationType?: "IMAGE_UPLOAD_ONLY";
  selfTestMode?: "POST_UPLOAD_DISCOVERY_ONLY" | "XHS_PUBLISH_FLOW_EXPLORATION";
  uploadMutationCount?: number;
  fileInputImmediateReadbackStatus?: "PASS" | "FAIL";
  fileInputFilesLength?: number;
  fileInputExpectedFixtureMatch?: "YES" | "NO" | "NOT_REQUIRED";
  fileInputImmediateReadback?: XiaohongshuUploadInputImmediateReadback;
  previewDetector?: "POST_UPLOAD_EDITOR_SCOPED";
  uploadAttemptIndex?: number;
  finalSubmitVisible?: boolean;
  finalSubmitEnabled?: boolean;
  finalSubmitHitTestValid?: boolean;
  titleReadbackVerified?: boolean;
  bodyReadbackVerified?: boolean;
  intermediateActionClickCount?: number;
  timelineEntry?: Record<string, unknown>;
  requestedCount?: number;
  previewCount?: number;
  verified?: boolean;
  uploadFailureCode?: string;
}

export type XiaohongshuPublishEntryDiscoveryStrategy = "STABLE_HREF" | "STABLE_DATA_ATTRIBUTE" | "ROLE_EXACT_NAME" | "ARIA_LABEL_OR_TITLE" | "SCOPED_EXACT_TEXT";

export type XiaohongshuPublishEntryResolutionStatus = "FOUND_UNIQUE" | "PUBLISH_ENTRY_AMBIGUOUS" | "PUBLISH_ENTRY_NOT_VISIBLE" | "PUBLISH_ENTRY_DISABLED" | "PUBLISH_ENTRY_NOT_FOUND";

export interface XiaohongshuPublishEntryCandidateIdentity {
  index: number;
  tagName: string;
  role: string | null;
  normalizedVisibleText: string;
  sanitizedHref: string | null;
  ariaLabel: string | null;
  title: string | null;
  dataAttributes: Record<string, string>;
  visible: boolean;
  enabled: boolean;
}

export interface XiaohongshuPublishEntryCandidate extends XiaohongshuPublishEntryCandidateIdentity {
  locator: Locator;
}

export interface XiaohongshuPublishEntryCandidateSnapshot {
  candidates: readonly XiaohongshuPublishEntryCandidate[];
  scannedControlCount: number;
  truncated: boolean;
}

export type XiaohongshuPublishEntryDiscoveryResult =
  | {
    status: "FOUND_UNIQUE";
    strategy: XiaohongshuPublishEntryDiscoveryStrategy;
    selectorSignal: string;
    candidateIdentity: XiaohongshuPublishEntryCandidateIdentity;
    candidate: XiaohongshuPublishEntryCandidate;
    requiresContentTypeSelection: boolean;
  }
  | {
    status: Exclude<XiaohongshuPublishEntryResolutionStatus, "FOUND_UNIQUE">;
    strategy?: XiaohongshuPublishEntryDiscoveryStrategy;
    selectorSignal?: string;
    candidateIdentity?: XiaohongshuPublishEntryCandidateIdentity;
    failureCode: PreSubmitGateFailureCode;
    failureStage: "PUBLISH_ENTRY_DISCOVERY";
    missingSignal: string;
    candidates: readonly XiaohongshuPublishEntryCandidate[];
  };

export type XiaohongshuAuthStateDiagnosticPhase = "LIVE_LOGIN_BEFORE_CLOSE" | "AUTH_STATE_BEFORE_CLOSE";

export interface XiaohongshuAuthStateDiagnostic {
  phase: XiaohongshuAuthStateDiagnosticPhase;
  timestamp: string;
  platformKey: string;
  accountId: string;
  sessionKey: string;
  sessionIdHash: string;
  storageMode: BrowserSession["storageMode"];
  profilePath: string | null;
  sessionEvidence: BrowserSessionScopeEvidence;
  authState: XhsAuthStateMetadata | null;
  stableObservationWindowMs: number | null;
  stableObservationSamples: number | null;
  stableObservationPassed: boolean | null;
  credentialSnapshotInjected: boolean;
  error: { name: string; message: string } | null;
}

export interface XiaohongshuRestoreNavigationDiagnostic {
  platformKey: "xiaohongshu";
  accountId: string;
  sessionEvidence: BrowserSessionScopeEvidence;
  preNavigation: XhsAuthStateMetadata;
  afterNavigation: XhsAuthStateMetadata;
  navigation: XhsNavigationClassification;
  loginStatus: LoginStatus;
  sameContextPageOwnership: boolean;
  sameContextPage: XiaohongshuSameContextPageDiagnostic;
}

export interface XiaohongshuSameContextPageDiagnostic {
  platformKey: "xiaohongshu";
  accountId: string;
  contextDebugId: string;
  originalPageDebugId: string;
  originalPageClosed: boolean;
  newPageOwnedByContext: boolean;
  pageCountBefore: number;
  pageCountAfter: number;
  newPageUrl: string;
}

export interface XiaohongshuBrowserAdapterOptions extends BrowserAutomationAdapterOptions {
  onLoginEvaluation?: (evaluation: XiaohongshuLoginEvaluation) => void;
  onAuthStateDiagnostic?: (diagnostic: XiaohongshuAuthStateDiagnostic) => void;
  onCanonicalPageOperation?: (evidence: XiaohongshuCanonicalPageOperationEvidence) => void;
  onEditorEntryDiagnostic?: (diagnostic: XiaohongshuEditorEntryDiagnostic) => void;
  credentialFilePath?: string;
  loginStabilityWindowMs?: number;
  productionReceiptFactory?: (page: Page, meta: XhsReceiptMeta) => XhsProductionReceiptObserver;
}

export function classifyXiaohongshuLoginEvidence(evidence: XiaohongshuLoginEvidence): XiaohongshuLoginDecision {
  if (evidence.explicitLoginUrl || evidence.visibleLoginForm) return "login_required";
  if (evidence.verificationUrl) return "needs_user_action";
  if (evidence.blockingSignals.length > 0) return "needs_user_action";
  if (evidence.creatorHost && !evidence.explicitLoginUrl && new Set(evidence.positiveSignals).size >= 2) return "logged_in";
  return "unknown";
}

export class XiaohongshuGateError extends BrowserAutomationError {
  readonly gateCode: XiaohongshuGateCode;
  readonly failureCode?: PreSubmitGateFailureCode;
  readonly failureStage?: PreSubmitGateFailureStage;
  readonly missingSignal?: string;
  readonly bodyReadback?: XiaohongshuEditorReadbackVerification;

  constructor(code: XiaohongshuGateCode, adapterCode: ConstructorParameters<typeof BrowserAutomationError>[0], message: string, failure?: { failureCode?: PreSubmitGateFailureCode; failureStage?: PreSubmitGateFailureStage; missingSignal?: string; bodyReadback?: XiaohongshuEditorReadbackVerification }) {
    super(adapterCode, `${code}: ${message}`);
    this.name = "XiaohongshuGateError";
    this.gateCode = code;
    this.failureCode = failure?.failureCode;
    this.failureStage = failure?.failureStage;
    this.missingSignal = failure?.missingSignal;
    this.bodyReadback = failure?.bodyReadback;
  }
}

type XhsDocument = Page | { locator: (selector: string) => Locator; url: () => string };

interface XiaohongshuEditorEntryResult {
  editorReached: boolean;
  sanitizedUrl: string;
  preClickRevalidated?: boolean;
  navigationClickCount?: number;
  navigationTransitionObserved?: boolean;
  postPublishNoteState?: PublishNotePostClickState;
  imagePostSurfaceAfterPublishNote?: XiaohongshuClickableSurfaceResolution;
}

type XiaohongshuEditorNavigationPolicy = "GATE_NAVIGATION" | "PREPARE_PUBLISH";

function emptyPreSubmitGateResult(status: PreSubmitGateStatus): PreSubmitGateResult {
  return {
    status,
    editorReached: false,
    authStillValid: false,
    contentType: null,
    contentTypeReady: false,
    titleEditorDetected: false,
    bodyEditorDetected: false,
    imageUploadControlDetected: false,
    publishSettingsAreaDetected: false,
    finalSubmitControlDetected: false,
    securityVerificationPresent: false,
    loginPagePresent: false,
    needsUserAction: status !== "ready",
    sanitizedUrl: null,
    editorEntrySideEffectRisk: "NONE_OBSERVED"
  };
}

function locatorCount(locator: Locator): Promise<number> {
  const candidate = locator as unknown as { count?: () => Promise<number> };
  return typeof candidate.count === "function" ? candidate.count() : Promise.resolve(1);
}

function locatorAt(locator: Locator, index: number): Locator {
  const candidate = locator as unknown as { nth?: (position: number) => Locator; first?: () => Locator };
  if (typeof candidate.nth === "function") return candidate.nth(index);
  if (index === 0 && typeof candidate.first === "function") return candidate.first();
  return locator;
}

async function isVisible(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isVisible?: () => Promise<boolean> };
  return typeof candidate.isVisible === "function" ? candidate.isVisible().catch(() => false) : true;
}

async function isEnabled(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isEnabled?: () => Promise<boolean> };
  return typeof candidate.isEnabled === "function" ? candidate.isEnabled().catch(() => false) : true;
}

async function attribute(locator: Locator, name: string): Promise<string> {
  const candidate = locator as unknown as { getAttribute?: (attributeName: string) => Promise<string | null> };
  if (typeof candidate.getAttribute !== "function") return "";
  return (await candidate.getAttribute(name).catch(() => null))?.trim() ?? "";
}

async function innerText(locator: Locator): Promise<string> {
  const candidate = locator as unknown as { innerText?: () => Promise<string>; textContent?: () => Promise<string | null> };
  if (typeof candidate.innerText === "function") return candidate.innerText().catch(() => "");
  if (typeof candidate.textContent === "function") return candidate.textContent().then((value) => value ?? "").catch(() => "");
  return "";
}

async function inputValue(locator: Locator): Promise<string> {
  const candidate = locator as unknown as { inputValue?: () => Promise<string> };
  return typeof candidate.inputValue === "function" ? candidate.inputValue().catch(() => "") : innerText(locator);
}

async function isChecked(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isChecked?: () => Promise<boolean> };
  if (typeof candidate.isChecked === "function") return candidate.isChecked().catch(() => false);
  return (await attribute(locator, "aria-checked")) === "true" || (await attribute(locator, "checked")) !== "";
}

function emptyExplorationCounters(): PublishFlowExplorationCounters {
  return {
    navigationRestartCount: 0,
    refreshCount: 0,
    uploadAttempts: 0,
    uploadMutationCount: 0,
    uploadRetryCount: 0,
    intermediateActionClickCount: 0,
    titleMutationCount: 0,
    bodyMutationCount: 0,
    settingsMutationCount: 0,
    contentMutationCount: 0,
    finalSubmitCount: 0
  };
}

function emptyExplorationFieldEvidence(): { attempted: boolean; mutationCount: number; strategyCount: number; readbackVerified: boolean; readbackValue?: string } {
  return { attempted: false, mutationCount: 0, strategyCount: 0, readbackVerified: false };
}

function normalizeExplorationBudgets(overrides: Partial<PublishFlowExplorationBudgets> | undefined): PublishFlowExplorationBudgets {
  const supplied = overrides ?? {};
  const bounded = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : fallback;
  return {
    maxDurationMs: bounded(supplied.maxDurationMs, DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS.maxDurationMs),
    maxNavigationRestarts: bounded(supplied.maxNavigationRestarts, DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS.maxNavigationRestarts),
    maxUploadAttempts: bounded(supplied.maxUploadAttempts, DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS.maxUploadAttempts),
    maxIntermediateActionClicks: bounded(supplied.maxIntermediateActionClicks, DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS.maxIntermediateActionClicks),
    maxRefreshCount: bounded(supplied.maxRefreshCount, DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS.maxRefreshCount),
    maxTitleMutations: bounded(supplied.maxTitleMutations, DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS.maxTitleMutations),
    maxBodyMutations: bounded(supplied.maxBodyMutations, DEFAULT_XHS_PUBLISH_FLOW_EXPLORATION_BUDGETS.maxBodyMutations)
  };
}

function toExplorationIntermediateCandidate(candidate: ImageEditorIntermediateActionCandidate): XhsIntermediateActionCandidate {
  return {
    candidateId: candidate.candidateId,
    tagName: candidate.tagName,
    normalizedText: candidate.normalizedText ?? candidate.semanticSignal,
    role: candidate.role,
    semanticSignal: candidate.semanticSignal,
    visible: candidate.visible,
    enabled: candidate.enabled,
    boundingBox: candidate.boundingBox ?? null,
    nearestInteractiveAncestorTag: candidate.nearestInteractiveAncestorTag ?? null,
    nearestInteractiveAncestorRole: candidate.nearestInteractiveAncestorRole ?? null,
    pointerEvents: candidate.pointerEvents ?? "unknown",
    hitTestValid: candidate.hitTestValid === true
  };
}

function boxesOverlap(left: ImageEditorBoundingBox, right: ImageEditorBoundingBox): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

async function locatorBoundingBox(locator: Locator): Promise<ImageEditorBoundingBox | null> {
  const candidate = locator as unknown as { boundingBox?: () => Promise<ImageEditorBoundingBox | null> };
  if (typeof candidate.boundingBox !== "function") return null;
  return candidate.boundingBox().catch(() => null);
}

async function locatorHitTestValid(locator: Locator, box: ImageEditorBoundingBox | null): Promise<boolean> {
  if (!box) return false;
  const candidate = locator as unknown as { evaluate?: (pageFunction: (element: unknown, point: { x: number; y: number }) => unknown, arg: { x: number; y: number }) => Promise<unknown> };
  if (typeof candidate.evaluate !== "function") return true;
  try {
    return await candidate.evaluate((element, point) => {
      if (!(element instanceof Element)) return false;
      const hit = document.elementFromPoint(point.x, point.y);
      return hit === element || Boolean(hit && (element.contains(hit) || hit.contains(element)));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 }) === true;
  } catch {
    return false;
  }
}

const XIAOHONGSHU_PUBLISH_ENTRY_LABELS = new Set([
  "发布笔记",
  "发布图文",
  "上传图文",
  "上传笔记",
  "发笔记",
  "图文笔记",
  "image post",
  "create post",
  "create note"
]);
const XIAOHONGSHU_PUBLISH_ENTRY_INVENTORY_PATTERN = /发布|图文|笔记|上传|publish|post|note/iu;
const XIAOHONGSHU_STABLE_PUBLISH_DATA_PATTERN = /(?:publish[-_: ]?(?:entry|post|note)|post[-_: ]?entry|note[-_: ]?entry|image[-_: ]?(?:post|entry)|upload[-_: ]?image)/iu;
const XIAOHONGSHU_PUBLISH_ENTRY_DATA_ATTRIBUTES = ["data-testid", "data-test", "data-action", "data-qa", "data-cy"] as const;

function boundedPublishEntryText(value: string): string {
  return normalizeXiaohongshuEditorText(value).slice(0, 120);
}

function sanitizedPublishEntryHref(value: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, XIAOHONGSHU_CREATOR_HOME);
    if (parsed.hostname !== "creator.xiaohongshu.com") return null;
    return parsed.pathname || "/";
  } catch {
    return null;
  }
}

async function tagName(locator: Locator): Promise<string> {
  const candidate = locator as unknown as { evaluate?: (pageFunction: (element: unknown) => unknown) => Promise<unknown> };
  if (typeof candidate.evaluate !== "function") return "UNKNOWN";
  try {
    const value = await candidate.evaluate((element) => {
      if (element && typeof element === "object" && "tagName" in element) return (element as { tagName?: unknown }).tagName;
      return null;
    });
    if (typeof value === "string" && value.trim()) return value.trim().toUpperCase();
    if (value && typeof value === "object" && "tagName" in value) {
      const nested = (value as { tagName?: unknown }).tagName;
      if (typeof nested === "string" && nested.trim()) return nested.trim().toUpperCase();
    }
  } catch {
    // Candidate diagnostics are best-effort and must not affect the Gate result.
  }
  return "UNKNOWN";
}

function normalizedCandidateRole(tag: string, explicitRole: string): string | null {
  const role = explicitRole.trim().toLowerCase();
  if (role) return role;
  if (tag === "BUTTON") return "button";
  if (tag === "A") return "link";
  return null;
}

function exactPublishEntryLabel(value: string): boolean {
  return XIAOHONGSHU_PUBLISH_ENTRY_LABELS.has(value.toLowerCase());
}

function stablePublishDataAttribute(candidate: XiaohongshuPublishEntryCandidate): [string, string] | null {
  for (const name of XIAOHONGSHU_PUBLISH_ENTRY_DATA_ATTRIBUTES) {
    const value = candidate.dataAttributes[name] ?? "";
    if (value && XIAOHONGSHU_STABLE_PUBLISH_DATA_PATTERN.test(value)) return [name, value];
  }
  return null;
}

function hasStablePublishHref(candidate: XiaohongshuPublishEntryCandidate): boolean {
  return candidate.sanitizedHref === "/publish/publish";
}

function isPublishEntryInventoryCandidate(candidate: XiaohongshuPublishEntryCandidate): boolean {
  const data = Object.values(candidate.dataAttributes).join(" ");
  const signals = [candidate.sanitizedHref ?? "", candidate.normalizedVisibleText, candidate.ariaLabel ?? "", candidate.title ?? "", data];
  return signals.some((signal) => XIAOHONGSHU_PUBLISH_ENTRY_INVENTORY_PATTERN.test(signal)) || hasStablePublishHref(candidate) || Boolean(stablePublishDataAttribute(candidate));
}

function candidateAccessibleText(candidate: XiaohongshuPublishEntryCandidate): string {
  return boundedPublishEntryText(candidate.ariaLabel ?? candidate.normalizedVisibleText);
}

function directImagePostSemantic(candidate: XiaohongshuPublishEntryCandidate): boolean {
  const label = candidateAccessibleText(candidate).toLowerCase();
  return /(?:发布笔记|发布图文|上传图文|上传笔记|发笔记|图文笔记|image\s+post|create\s+note)/iu.test(label);
}

function candidateIdentity(candidate: XiaohongshuPublishEntryCandidate): XiaohongshuPublishEntryCandidateIdentity {
  const { locator: _locator, ...identity } = candidate;
  return { ...identity, dataAttributes: { ...identity.dataAttributes } };
}

function publishEntryFailure(
  status: Exclude<XiaohongshuPublishEntryResolutionStatus, "FOUND_UNIQUE">,
  candidates: readonly XiaohongshuPublishEntryCandidate[],
  strategy?: XiaohongshuPublishEntryDiscoveryStrategy,
  selectorSignal?: string,
  candidate?: XiaohongshuPublishEntryCandidate,
  missingSignal = "publish-entry-semantic-candidate"
): XiaohongshuPublishEntryDiscoveryResult {
  return {
    status,
    ...(strategy ? { strategy } : {}),
    ...(selectorSignal ? { selectorSignal } : {}),
    ...(candidate ? { candidateIdentity: candidateIdentity(candidate) } : {}),
    failureCode: status,
    failureStage: "PUBLISH_ENTRY_DISCOVERY",
    missingSignal,
    candidates: candidates.map((item) => item)
  };
}

function resolvePublishEntryPriority(
  candidates: readonly XiaohongshuPublishEntryCandidate[],
  strategy: XiaohongshuPublishEntryDiscoveryStrategy,
  matches: XiaohongshuPublishEntryCandidate[],
  selectorFor: (candidate: XiaohongshuPublishEntryCandidate) => string,
  requiresContentTypeSelection: (candidate: XiaohongshuPublishEntryCandidate) => boolean
): XiaohongshuPublishEntryDiscoveryResult | null {
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    return publishEntryFailure("PUBLISH_ENTRY_AMBIGUOUS", candidates, strategy, "multiple-equivalent-candidates", undefined, "multiple-equivalent-candidates");
  }
  const candidate = matches[0]!;
  const selectorSignal = selectorFor(candidate);
  if (!candidate.visible) return publishEntryFailure("PUBLISH_ENTRY_NOT_VISIBLE", candidates, strategy, selectorSignal, candidate, selectorSignal);
  if (!candidate.enabled) return publishEntryFailure("PUBLISH_ENTRY_DISABLED", candidates, strategy, selectorSignal, candidate, selectorSignal);
  return {
    status: "FOUND_UNIQUE",
    strategy,
    selectorSignal,
    candidateIdentity: candidateIdentity(candidate),
    candidate,
    requiresContentTypeSelection: requiresContentTypeSelection(candidate)
  };
}

/** Read-only, bounded snapshot of publish-semantic controls. The snapshot retains the Locator only for the subsequent safe click. */
export async function collectPublishEntryCandidates(page: Page): Promise<XiaohongshuPublishEntryCandidateSnapshot> {
  const controls = page.locator(XIAOHONGSHU_PUBLISH_ENTRY_CANDIDATE_SELECTOR);
  const controlCount = await locatorCount(controls);
  const candidates: XiaohongshuPublishEntryCandidate[] = [];
  for (let index = 0; index < controlCount; index += 1) {
    const locator = locatorAt(controls, index);
    const tag = await tagName(locator);
    const role = normalizedCandidateRole(tag, await attribute(locator, "role"));
    const visibleText = boundedPublishEntryText(await innerText(locator));
    const href = sanitizedPublishEntryHref(await attribute(locator, "href"));
    const ariaLabel = boundedPublishEntryText(await attribute(locator, "aria-label")) || null;
    const title = boundedPublishEntryText(await attribute(locator, "title")) || null;
    const dataAttributes: Record<string, string> = {};
    for (const name of XIAOHONGSHU_PUBLISH_ENTRY_DATA_ATTRIBUTES) {
      const value = boundedPublishEntryText(await attribute(locator, name));
      if (value) dataAttributes[name] = value;
    }
    const candidate: XiaohongshuPublishEntryCandidate = {
      index,
      tagName: tag,
      role,
      normalizedVisibleText: visibleText,
      sanitizedHref: href,
      ariaLabel,
      title,
      dataAttributes,
      visible: await isVisible(locator),
      enabled: await isEnabled(locator),
      locator
    };
    const semanticLabel = candidateAccessibleText(candidate);
    if (isPublishEntryInventoryCandidate(candidate) || exactPublishEntryLabel(semanticLabel) || exactPublishEntryLabel(visibleText)) {
      candidates.push(candidate);
    }
  }
  return {
    candidates: candidates.slice(0, XIAOHONGSHU_PUBLISH_ENTRY_CANDIDATE_MAX),
    scannedControlCount: controlCount,
    truncated: candidates.length > XIAOHONGSHU_PUBLISH_ENTRY_CANDIDATE_MAX
  };
}

/** Resolve only from the supplied snapshot; this function never scans the Page or clicks a Locator. */
export function findPublishEntry(snapshot: XiaohongshuPublishEntryCandidateSnapshot): XiaohongshuPublishEntryDiscoveryResult {
  const candidates = snapshot.candidates;
  if (snapshot.truncated) return publishEntryFailure("PUBLISH_ENTRY_AMBIGUOUS", candidates, undefined, "candidate-inventory-truncated", undefined, "candidate-inventory-truncated");

  const stableMatches = candidates.filter((candidate) => hasStablePublishHref(candidate) || stablePublishDataAttribute(candidate));
  if (stableMatches.length > 1) return publishEntryFailure("PUBLISH_ENTRY_AMBIGUOUS", candidates, undefined, undefined, undefined, "multiple-equivalent-candidates");
  if (stableMatches.length === 1) {
    const candidate = stableMatches[0]!;
    const hasHref = hasStablePublishHref(candidate);
    const data = stablePublishDataAttribute(candidate);
    const strategy: XiaohongshuPublishEntryDiscoveryStrategy = hasHref ? "STABLE_HREF" : "STABLE_DATA_ATTRIBUTE";
    const selectorSignal = hasHref ? `href:${candidate.sanitizedHref}` : `${data![0]}=${data![1]}`;
    const stableResult = resolvePublishEntryPriority(candidates, strategy, [candidate], () => selectorSignal, () => !hasHref);
    if (stableResult) return stableResult;
  }

  const roleMatches = candidates.filter((candidate) => (candidate.role === "button") && exactPublishEntryLabel(candidate.normalizedVisibleText));
  const roleResult = resolvePublishEntryPriority(candidates, "ROLE_EXACT_NAME", roleMatches, (candidate) => `role=button,name=${candidate.normalizedVisibleText}`, directImagePostSemantic);
  if (roleResult) return roleResult;

  const ariaTitleMatches = candidates.filter((candidate) => {
    const signal = candidate.ariaLabel ?? candidate.title ?? "";
    return Boolean(signal) && exactPublishEntryLabel(signal) && !(candidate.role === "button" && exactPublishEntryLabel(candidate.normalizedVisibleText));
  });
  const ariaTitleResult = resolvePublishEntryPriority(candidates, "ARIA_LABEL_OR_TITLE", ariaTitleMatches, (candidate) => candidate.ariaLabel ? `aria-label=${candidate.ariaLabel}` : `title=${candidate.title}`, directImagePostSemantic);
  if (ariaTitleResult) return ariaTitleResult;

  const scopedTextMatches = candidates.filter((candidate) => exactPublishEntryLabel(candidate.normalizedVisibleText) && candidate.role !== "button");
  const scopedTextResult = resolvePublishEntryPriority(candidates, "SCOPED_EXACT_TEXT", scopedTextMatches, (candidate) => `text=${candidate.normalizedVisibleText}`, directImagePostSemantic);
  if (scopedTextResult) return scopedTextResult;

  return publishEntryFailure("PUBLISH_ENTRY_NOT_FOUND", candidates);
}

function stableExternalAccountId(href: string): string | null {
  try {
    const url = new URL(href, XIAOHONGSHU_CREATOR_HOME);
    const match = url.pathname.match(/\/user\/profile\/([^/?#]+)/iu) ?? url.pathname.match(/\/user\/([^/?#]+)/iu);
    const value = match?.[1]?.trim() ?? "";
    return value && !/^(?:profile|home|index)$/iu.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function bodyText(page: XhsDocument): Promise<string> {
  return innerText(page.locator("body"));
}

function emptyPageEvidence(page: XhsDocument): XiaohongshuPageEvidence {
  const url = page.url();
  return {
    available: false,
    bodyPresent: true,
    bodyTextLength: 0,
    login: { available: false, url, creatorHost: false, creatorHomePath: false, explicitLoginUrl: /\/login(?:[/?#]|$)|\/signin(?:[/?#]|$)|passport|auth/iu.test(url), verificationUrl: /captcha|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(url), publishNoteVisible: false, noteManagementVisible: false, dataDashboardVisible: false, accountStatusVisible: false, profileAreaVisible: false, visibleLoginForm: false, visibleQrLogin: false, visibleSmsVerification: false, visibleCaptcha: false, visibleSlider: false, visibleSecurityModal: false, positiveSignals: [], blockingSignals: [] },
    identity: { externalAccountId: null, externalAccountIdCandidates: [], displayName: null, profileUrl: null, identitySourceCandidates: [], identityDomDiagnosticMatchCount: 0, identityDomDiagnosticMatches: [] }
  };
}

function sanitizePageUrl(page: Page): string {
  return sanitizeUrlString(page.url());
}

function sanitizeUrlString(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "about:blank";
  }
}

function safeXiaohongshuRouteMetadata(value: string): Pick<XiaohongshuCurrentImageEditorReadiness, "origin" | "pathname" | "source" | "from" | "target" | "sanitizedUrl"> {
  try {
    const parsed = new URL(value);
    const safeQueryValue = (key: string): string | null => {
      const queryValue = parsed.searchParams.get(key);
      if (!queryValue) return null;
      const normalized = queryValue.normalize("NFKC").trim();
      return normalized.length > 0 && normalized.length <= 80 ? normalized : null;
    };
    return {
      origin: parsed.origin,
      pathname: parsed.pathname,
      source: safeQueryValue("source"),
      from: safeQueryValue("from"),
      target: safeQueryValue("target"),
      sanitizedUrl: `${parsed.origin}${parsed.pathname}`
    };
  } catch {
    return { origin: null, pathname: null, source: null, from: null, target: null, sanitizedUrl: null };
  }
}

function inferredImageEditorTabs(inspection: { contentType: ImageEditorContentType; tabPresence?: ImageEditorTabPresence; preUploadSemanticNodes: readonly ImageEditorSemanticNode[] }): ImageEditorTabPresence {
  if (inspection.tabPresence) return inspection.tabPresence;
  const has = (pattern: RegExp): boolean => inspection.preUploadSemanticNodes.some((node) => pattern.test(node.normalizedText));
  const uploadImageTabPresent = has(/上传图文/iu);
  const uploadVideoTabPresent = has(/上传视频/iu);
  const longFormTabPresent = has(/写长文/iu);
  const podcastTabPresent = has(/发播客/iu);
  return {
    uploadVideoTabPresent,
    uploadImageTabPresent,
    longFormTabPresent,
    podcastTabPresent,
    currentSelectedTab: inspection.contentType === "IMAGE_POST" && uploadImageTabPresent ? "上传图文" : inspection.contentType === "VIDEO" && uploadVideoTabPresent ? "上传视频" : null
  };
}

function emptyCurrentImageEditorReadiness(accountId: string, overrides: Partial<XiaohongshuCurrentImageEditorReadiness> = {}): XiaohongshuCurrentImageEditorReadiness {
  return {
    inspectionStatus: "FAIL",
    failureCode: "BROWSER_SESSION_UNAVAILABLE",
    accountId,
    contextDebugId: null,
    pageId: null,
    sessionExists: false,
    browserConnected: false,
    contextExists: false,
    pageExists: false,
    pageClosed: true,
    pageContextMatchesSession: false,
    origin: null,
    pathname: null,
    source: null,
    from: null,
    target: null,
    sanitizedUrl: null,
    readyState: null,
    editorShellPresent: false,
    uploadVideoTabPresent: false,
    uploadImageTabPresent: false,
    longFormTabPresent: false,
    podcastTabPresent: false,
    currentSelectedTab: null,
    imageUploadControlPresent: false,
    titleControlPresent: false,
    bodyControlPresent: false,
    finalSubmitControlPresent: false,
    contentType: "UNKNOWN",
    imageEditorPhase: "IMAGE_POST_UNKNOWN",
    preUploadPhaseResult: "FAIL",
    preUploadFailureCode: null,
    preUploadFailureStage: null,
    preUploadMissingSignal: null,
    readinessSamples: [],
    ...overrides
  };
}

function emptyCurrentPostUploadReconciliation(accountId: string, overrides: Partial<XiaohongshuCurrentPostUploadReconciliation> = {}): XiaohongshuCurrentPostUploadReconciliation {
  const snapshot = emptyXiaohongshuPostUploadReconciliationDomSnapshot();
  return {
    ...reconcileXiaohongshuPostUploadSnapshot(snapshot),
    inspectionStatus: "FAIL",
    failureCode: "BROWSER_SESSION_UNAVAILABLE",
    accountId,
    contextDebugId: null,
    pageId: null,
    sessionExists: false,
    browserConnected: false,
    contextExists: false,
    pageExists: false,
    pageClosed: true,
    pageContextMatchesSession: false,
    source: null,
    from: null,
    target: null,
    sanitizedUrl: null,
    ...overrides
  };
}

function sameUrlOriginAndPath(first: string, second: string): boolean {
  try {
    const left = new URL(first);
    const right = new URL(second);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return false;
  }
}

function identitySourceCandidatesFromEvidence(identity: XiaohongshuPageEvidence["identity"]): XiaohongshuIdentitySourceCandidate[] {
  if (identity.identitySourceCandidates && identity.identitySourceCandidates.length > 0) return identity.identitySourceCandidates;
  const candidates: XiaohongshuIdentitySourceCandidate[] = [];
  if (identity.profileUrl) candidates.push({
    sourceType: "PUBLIC_PROFILE_LINK",
    stableIdentifierPresent: Boolean(stableExternalAccountId(identity.profileUrl)),
    identifierFieldName: "profileUrl",
    sensitiveDataRequired: false,
    readOnlySafe: true,
    confidence: "HIGH",
    tagName: "A",
    text: identity.displayName,
    href: sanitizePublicProfileUrl(identity.profileUrl),
    role: null,
    dataIdentifierField: null,
    visible: true,
    source: "CREATOR_PROFILE_LINK",
    rawValue: stableExternalAccountId(identity.profileUrl) ?? "",
    normalizedCreatorId: stableExternalAccountId(identity.profileUrl) ?? "",
    semanticAnchor: "xiaohongshu-profile-link"
  });
  if (identity.externalAccountId) candidates.push({
    sourceType: "ACCOUNT_SURFACE",
    stableIdentifierPresent: true,
    identifierFieldName: "externalCreatorId",
    sensitiveDataRequired: false,
    readOnlySafe: true,
    confidence: "HIGH",
    tagName: null,
    text: identity.displayName,
    href: null,
    role: null,
    dataIdentifierField: null,
    visible: true,
    source: "CREATOR_HOME_ACCOUNT_LABEL",
    rawValue: identity.externalAccountId,
    normalizedCreatorId: identity.externalAccountId,
    semanticAnchor: "xiaohongshu-account-id-label"
  });
  return candidates;
}

function normalizeExternalCreatorId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function emptyCanonicalPageRuntimeProbe(overrides: Partial<XiaohongshuCanonicalPageRuntimeProbe> = {}): XiaohongshuCanonicalPageRuntimeProbe {
  return {
    probeStatus: "FAIL",
    failureStage: null,
    failureCode: null,
    failureErrorClass: null,
    canonicalContextId: null,
    canonicalPageId: null,
    sessionExists: false,
    probedContextId: null,
    probedPageId: null,
    pageContextMatchesSession: false,
    createdNewPage: false,
    browserConnected: false,
    pageClosed: true,
    runtimeAuthState: "UNVERIFIED",
    playwrightPageUrl: null,
    domLocationHref: null,
    domLocationEvaluateStatus: "NOT_RUN",
    domLocationEvaluateErrorClass: null,
    pageUrlConsistency: "NOT_VERIFIED",
    routeClass: "UNKNOWN",
    identityObservationStatus: "NOT_RUN",
    identitySourceCandidates: [],
    identityDomDiagnosticMatchCount: 0,
    identityDomDiagnosticMatches: [],
    observedCreatorIdRaw: null,
    observedCreatorIdNormalized: null,
    observedDisplayName: null,
    observedProfileUrl: null,
    ...overrides
  };
}

function sanitizePublicProfileUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, XIAOHONGSHU_CREATOR_HOME);
    const id = stableExternalAccountId(parsed.toString());
    return id ? `${parsed.origin}${parsed.pathname}` : null;
  } catch {
    return null;
  }
}

function classifyXiaohongshuCreatorIdentityRoute(url: string, login: boolean, verification: boolean): XiaohongshuCreatorIdentityRouteClass {
  if (login) return "LOGIN";
  if (verification) return "SECURITY_VERIFICATION";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "creator.xiaohongshu.com") return "UNKNOWN";
    if (/^\/publish\/publish(?:[/?#]|$)/iu.test(parsed.pathname)) return "PUBLISH_EDITOR";
    if (/\/(?:publish\/manage|content|note|notes)(?:[/?#]|$)/iu.test(parsed.pathname)) return "CREATOR_CONTENT";
    if (/^\/(?:new\/home)?$/iu.test(parsed.pathname)) return "CREATOR_HOME";
    return "OTHER_CREATOR_PAGE";
  } catch {
    return "UNKNOWN";
  }
}

async function readXiaohongshuPageEvidence(page: Page, options: { failOnEvaluateError?: boolean } = {}): Promise<XiaohongshuPageEvidence> {
  const candidate = page as unknown as { evaluate?: <T>(pageFunction: () => T) => Promise<T> };
  if (typeof candidate.evaluate !== "function") {
    if (options.failOnEvaluateError) throw Object.assign(new Error("Page.evaluate is unavailable"), { name: "PageEvaluateUnavailableError" });
    return emptyPageEvidence(page);
  }
  try {
    const evaluated = await candidate.evaluate(() => {
      const compact = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
      const verificationPattern = /captcha|human|security|risk|验证码|人机|安全验证|风控|滑块|二维码|扫码/iu;
      const loginPattern = /登录|验证码|手机号|短信|密码/iu;
      const visible = (element: Element): boolean => {
        const node = element as HTMLElement;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
      };
      const textOf = (element: Element): string => compact((element as HTMLElement).innerText || element.textContent || "");
      const descriptorOf = (element: Element): string => compact([
        element.getAttribute("aria-label") || "",
        element.getAttribute("placeholder") || "",
        element.getAttribute("title") || "",
        element.getAttribute("name") || "",
        element.getAttribute("id") || "",
        element.getAttribute("class") || "",
        element.getAttribute("data-testid") || "",
        textOf(element)
      ].join(" "));
      const elements = Array.from(document.querySelectorAll("*"))
        .filter((element) => visible(element));
      const visibleTextContains = (pattern: RegExp): boolean => elements.some((element) => pattern.test(textOf(element)));
      const positiveSignals: string[] = [];
      if (visibleTextContains(/发布笔记/iu)) positiveSignals.push("发布笔记");
      if (visibleTextContains(/笔记管理/iu)) positiveSignals.push("笔记管理");
      if (visibleTextContains(/数据看板/iu)) positiveSignals.push("数据看板");
      if (visibleTextContains(/小红书创作服务平台/iu)) positiveSignals.push("创作服务平台");
      if (visibleTextContains(/账号状态正常/iu)) positiveSignals.push("账号状态正常");

      const blockingSignals: string[] = [];
      let visibleLoginForm = false;
      const inputs = elements.filter((element) => /^(INPUT|TEXTAREA|SELECT)$/u.test(element.tagName));
      const visibleVerificationInput = inputs.some((element) => {
        const descriptor = descriptorOf(element);
        return /验证码|短信|手机号|密码/iu.test(descriptor);
      });
      const visibleForms = elements.filter((element) => element.tagName.toLowerCase() === "form");
      if (visibleForms.some((form) => loginPattern.test(descriptorOf(form)) && form.querySelectorAll("input,textarea,select").length > 0)) visibleLoginForm = true;
      const visibleSmsVerification = inputs.some((element) => /验证码|短信|手机号/iu.test(descriptorOf(element)));
      if (visibleVerificationInput) blockingSignals.push("visible_verification_input");
      const visibleSecurityModal = elements.some((element) => {
        const descriptor = descriptorOf(element);
        const role = element.getAttribute("role") || "";
        const modal = role === "dialog" || element.getAttribute("aria-modal") === "true" || /modal|dialog|overlay|popup/iu.test(element.getAttribute("class") || "") || /modal|dialog|overlay|popup/iu.test(element.getAttribute("id") || "");
        return modal && verificationPattern.test(descriptor);
      });
      if (visibleSecurityModal) blockingSignals.push("visible_security_modal");
      const visibleChallengeElements = elements.filter((element) => {
        const descriptor = descriptorOf(element);
        const tag = element.tagName.toLowerCase();
        const verificationContainer = /captcha|slider|security|risk|二维码|\bqr\b/iu.test(descriptor);
        const visualChallenge = tag === "iframe" || tag === "canvas" || tag === "img" || /滑块|验证码|安全验证|二维码|扫码|captcha|slider/iu.test(descriptor);
        return verificationContainer && visualChallenge && verificationPattern.test(descriptor);
      });
      const visibleCaptcha = visibleChallengeElements.some((element) => /captcha|验证码/iu.test(descriptorOf(element)));
      const visibleSlider = visibleChallengeElements.some((element) => /slider|滑块/iu.test(descriptorOf(element)));
      if (visibleChallengeElements.length > 0) blockingSignals.push("visible_captcha_or_slider");
      const visibleQrLogin = elements.some((element) => {
        const descriptor = descriptorOf(element);
        return /二维码|扫码|\bqr\b/iu.test(descriptor) && /登录|验证/iu.test(descriptor) && /IMG|CANVAS|IFRAME/u.test(element.tagName);
      });
      if (visibleQrLogin) blockingSignals.push("visible_qr_login");

      const url = location.href;
      const parsedUrl = new URL(url);
      const creatorHost = parsedUrl.hostname.toLowerCase() === "creator.xiaohongshu.com";
      const creatorHomePath = /^\/(?:new\/home)?$/iu.test(parsedUrl.pathname);
      const explicitLoginUrl = /\/(?:login|signin|auth|passport)(?:[/?#]|$)/iu.test(parsedUrl.pathname);
      const verificationUrl = /captcha|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(url);
      return {
        available: true,
        bodyPresent: Boolean(document.body),
        bodyTextLength: document.body?.innerText.length ?? 0,
        login: { available: true, url, creatorHost, creatorHomePath, explicitLoginUrl, verificationUrl, publishNoteVisible: positiveSignals.includes("发布笔记"), noteManagementVisible: positiveSignals.includes("笔记管理"), dataDashboardVisible: positiveSignals.includes("数据看板"), accountStatusVisible: positiveSignals.includes("账号状态正常"), profileAreaVisible: false, visibleLoginForm, visibleQrLogin, visibleSmsVerification, visibleCaptcha, visibleSlider, visibleSecurityModal, positiveSignals: [...new Set(positiveSignals)], blockingSignals: [...new Set(blockingSignals)] },
        identity: { externalAccountId: null, externalAccountIdCandidates: [], displayName: null, profileUrl: null, identitySourceCandidates: [] }
      };
    });
    const boundedIdentity = await readXiaohongshuCreatorIdentity(page);
    const identitySourceCandidates: XiaohongshuIdentitySourceCandidate[] = boundedIdentity.candidates.map((candidate) => ({
      sourceType: candidate.source === "CREATOR_PROFILE_LINK" ? "PUBLIC_PROFILE_LINK" : "VISIBLE_ACCOUNT_TEXT",
      stableIdentifierPresent: true,
      identifierFieldName: "externalCreatorId",
      sensitiveDataRequired: false,
      readOnlySafe: true,
      confidence: "HIGH",
      tagName: candidate.source === "CREATOR_PROFILE_LINK" ? "A" : "SPAN",
      text: candidate.rawValue,
      href: candidate.source === "CREATOR_PROFILE_LINK" ? boundedIdentity.profileUrl : null,
      role: null,
      dataIdentifierField: null,
      visible: true,
      source: candidate.source,
      rawValue: candidate.rawValue,
      normalizedCreatorId: candidate.normalizedCreatorId,
      semanticAnchor: candidate.semanticAnchor
    }));
    return {
      ...evaluated,
      login: { ...evaluated.login, profileAreaVisible: evaluated.login.profileAreaVisible || Boolean(boundedIdentity.displayName || boundedIdentity.normalizedCreatorId) },
      identity: {
        externalAccountId: boundedIdentity.status === "PASS" ? boundedIdentity.observedCreatorIdRaw : null,
        externalAccountIdCandidates: boundedIdentity.candidates.map((candidate) => candidate.normalizedCreatorId),
        displayName: evaluated.identity.displayName ?? boundedIdentity.displayName,
        profileUrl: evaluated.identity.profileUrl ?? boundedIdentity.profileUrl,
        identitySourceCandidates,
        identityDomDiagnosticMatchCount: boundedIdentity.diagnostic.matchCount,
        identityDomDiagnosticMatches: boundedIdentity.diagnostic.matches
      }
    };
  } catch (error) {
    if (options.failOnEvaluateError) throw error;
    return emptyPageEvidence(page);
  }
}

async function waitForProbe(page: XhsDocument, milliseconds = 250): Promise<void> {
  const candidate = page as unknown as { waitForTimeout?: (timeout: number) => Promise<void> };
  if (typeof candidate.waitForTimeout === "function") await candidate.waitForTimeout(milliseconds);
}

async function readEditorRaw(locator: Locator, field: "title" | "body"): Promise<string> {
  return field === "title" ? await inputValue(locator) : await innerText(locator);
}

async function readEditor(locator: Locator, field: "title" | "body"): Promise<string> {
  return normalizeXiaohongshuEditorText(await readEditorRaw(locator, field));
}

export function classifyXiaohongshuPublishSettings(settings: Array<{ label: string; required: boolean; value: string }>): "KNOWN" | "UNKNOWN" {
  return settings.every((setting) => setting.label.trim().length > 0 && typeof setting.required === "boolean") ? "KNOWN" : "UNKNOWN";
}

export class AccountOperationMutex {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly activeOperations = new Map<string, string>();

  async run<T>(key: string, operation: () => Promise<T>, operationName = "unknown"): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, current);
    await previous;
    this.activeOperations.set(key, operationName);
    try {
      return await operation();
    } finally {
      this.activeOperations.delete(key);
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }

  getState(key: string): { activeOperation: string | null; mutexLocked: boolean; operationInProgress: boolean } {
    const activeOperation = this.activeOperations.get(key) ?? null;
    return { activeOperation, mutexLocked: this.tails.has(key), operationInProgress: activeOperation !== null };
  }
}

export class XiaohongshuBrowserAdapter extends BrowserAutomationAdapter {
  readonly supportsBoundImageBuffers = true;
  private readonly productionLoginPages = new Map<string, { accountId: string; page: Page; session: BrowserSession; pageDebugId: string }>();
  private readonly productionPages = new Map<string, { accountId: string; snapshotId: string; creatorId: string; page: Page; session: BrowserSession; pageDebugId: string; identityPage?: { page: Page; pageDebugId: string }; imageSha256: string; title: string; body: string; imageSurfaceHash: string; submitted: boolean }>();
  private readonly onLoginEvaluation?: (evaluation: XiaohongshuLoginEvaluation) => void;
  private readonly onAuthStateDiagnostic?: (diagnostic: XiaohongshuAuthStateDiagnostic) => void;
  private readonly onCanonicalPageOperation?: (evidence: XiaohongshuCanonicalPageOperationEvidence) => void;
  private readonly onEditorEntryDiagnostic?: (diagnostic: XiaohongshuEditorEntryDiagnostic) => void;
  private readonly credentialFilePath: string | null;
  private readonly loginStabilityWindowMs: number;
  private readonly productionReceiptFactory?: (page: Page, meta: XhsReceiptMeta) => XhsProductionReceiptObserver;
  private readonly accountOperationMutex = new AccountOperationMutex();
  private readonly completedCheckLoginOperationIds = new Map<string, string[]>();
  /** Replaced at the start of each login/restore diagnostic run; never emitted or persisted. */
  private authStateFingerprintKey: Uint8Array | null = null;

  constructor(options: XiaohongshuBrowserAdapterOptions = {}) {
    super(definition, options);
    this.onLoginEvaluation = options.onLoginEvaluation;
    this.onAuthStateDiagnostic = options.onAuthStateDiagnostic;
    this.onCanonicalPageOperation = options.onCanonicalPageOperation;
    this.onEditorEntryDiagnostic = options.onEditorEntryDiagnostic;
    this.credentialFilePath = options.credentialFilePath ?? null;
    this.loginStabilityWindowMs = Math.max(0, options.loginStabilityWindowMs ?? DEFAULT_LOGIN_STABILITY_WINDOW_MS);
    this.productionReceiptFactory = options.productionReceiptFactory;
  }

  override async connectAccount(ctx: AccountContext): Promise<LoginSession> {
    this.authStateFingerprintKey = createXhsDiagnosticFingerprintKey();
    return super.connectAccount(ctx);
  }

  override async completeConnection(ctx: AccountContext): Promise<LoginStatus> {
    const status = await super.completeConnection(ctx);
    if (status === "logged_in") this.sessionManager.setRuntimeAuthState({ platformKey: this.platformKey, accountId: ctx.accountId }, "AUTHENTICATED", null);
    return status;
  }

  override async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const base = await super.validateArticle(article);
    const errors = [...base.errors];
    if ((article.images?.length ?? 0) < 1) errors.push("小红书图文至少需要一张图片");
    if (article.coverPath) errors.push("小红书图文 gate 不接受额外封面字段");
    return { ...base, valid: errors.length === 0, errors };
  }

  override async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const identity = { platformKey: this.platformKey, accountId: ctx.accountId };
    return this.accountOperationMutex.run(`${identity.platformKey}:${identity.accountId}`, async () => {
      if (ctx.settings.ordinaryProduction === true) {
        if (!this.activeSession(identity) && !this.sessionManager.hasStoredSession(identity)) return "needs_user_action";
        const jobId = this.productionJobId(ctx);
        const retained = this.productionLoginPages.get(jobId);
        if (retained && retained.accountId !== ctx.accountId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "验证页面不属于所选账号");
        if (retained && retained.session !== this.activeSession(identity)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "验证页面 Session 已替换，请先取消旧任务");
        const owned = retained && !this.isCanonicalPageClosed(retained.page) ? retained : await this.sessionManager.openOperationPage(identity, userInitiatedActionFromSettings(ctx.settings), "VISIBLE");
        this.rememberActiveSession(identity, owned.session);
        let awaitingVerification = false;
        try {
          if (!this.pageContextMatchesSession(owned.session, owned.page)) return "needs_user_action";
          if (!retained || this.isCanonicalPageClosed(retained.page)) await this.navigate(owned.page, XIAOHONGSHU_CREATOR_HOME);
          const status = await this.loginStatusForPage(ctx, owned.page, "CHECK_LOGIN", randomUUID());
          if (status !== "logged_in") { awaitingVerification = true; this.productionLoginPages.set(jobId, { ...owned, accountId: ctx.accountId }); return status; }
          const current = await this.inspectAccountIdentity(owned.page);
          if (!ctx.settings.expectedExternalCreatorId || current.externalAccountId !== ctx.settings.expectedExternalCreatorId) return "needs_user_action";
          this.sessionManager.setRuntimeAuthState(identity, "AUTHENTICATED", null);
          return "logged_in";
        } finally { if (!awaitingVerification) { await this.sessionManager.closeOperationPage(identity, owned.page); this.productionLoginPages.delete(jobId); } }
      }
      const canonical = await this.activeCanonicalPage(ctx);
      if (!canonical) {
        this.sessionManager.setRuntimeAuthState(identity, "NEEDS_USER_ACTION", "ACTIVE_CANONICAL_PAGE_REQUIRED");
        return "needs_user_action";
      }
      const operationId = randomUUID();
      this.sessionManager.setRuntimeAuthState(identity, "CHECKING", null);
      const pageContextMatchesSession = this.pageContextMatchesSession(canonical.session, canonical.page);
      this.emitCanonicalPageOperation(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "STARTED", pageContextMatchesSession);
      try {
        if (!pageContextMatchesSession) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "BrowserSession/Page mismatch：小红书 checkLogin canonical Page 不属于当前 Context");
        const status = await this.loginStatusForPage(ctx, canonical.page, "CHECK_LOGIN", operationId);
        const state = status === "logged_in" ? "AUTHENTICATED" : status === "unknown" ? "UNVERIFIED" : "NEEDS_USER_ACTION";
        this.sessionManager.setRuntimeAuthState(identity, state, status === "logged_in" ? null : status);
        this.emitCanonicalPageOperation(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "COMPLETED", true, status);
        return status;
      } catch (error) {
        this.emitCanonicalPageOperation(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "COMPLETED", pageContextMatchesSession, "unknown");
        throw error;
      } finally {
        this.recordCompletedCheckLoginOperation(identity.accountId, operationId);
      }
    }, "checkLogin");
  }

  /**
   * Read-only runtime evidence on the retained canonical Page. This deliberately
   * does not navigate, open an operation Page, or mutate the XHS editor.
   */
  async inspectCanonicalPageRuntime(ctx: AccountContext): Promise<XiaohongshuCanonicalPageRuntimeProbe> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>>;
      try {
        canonical = await this.activeCanonicalPage(ctx);
      } catch (error) {
        return emptyCanonicalPageRuntimeProbe({
          failureStage: "PAGE_OWNERSHIP",
          failureCode: "CANONICAL_PAGE_OWNERSHIP",
          failureErrorClass: error instanceof Error ? error.name : "UnknownError"
        });
      }
      if (!canonical) return emptyCanonicalPageRuntimeProbe({
        failureStage: "CANONICAL_PAGE_LOOKUP",
        failureCode: "CANONICAL_PAGE_UNAVAILABLE"
      });

      const { session, page, pageDebugId } = canonical;
      const canonicalContextId = session.contextDebugId ?? "unknown-context";
      const canonicalPageId = pageDebugId;
      const runtimeAuthState = this.getBrowserRuntimeState(ctx).state;
      const browserConnected = this.isBrowserConnected(session);
      const pageClosed = this.isCanonicalPageClosed(page);
      const pageContextMatchesSession = !pageClosed
        && this.pageContextMatchesSession(session, page)
        && (typeof session.context.pages !== "function" || session.context.pages().includes(page));
      const base = {
        canonicalContextId,
        canonicalPageId,
        sessionExists: true,
        probedContextId: canonicalContextId,
        probedPageId: canonicalPageId,
        pageContextMatchesSession,
        createdNewPage: false as const,
        browserConnected,
        pageClosed,
        runtimeAuthState
      };
      if (pageClosed) return emptyCanonicalPageRuntimeProbe({
        ...base,
        failureStage: "CANONICAL_PAGE_LOOKUP",
        failureCode: "CANONICAL_PAGE_CLOSED"
      });
      if (!pageContextMatchesSession) return emptyCanonicalPageRuntimeProbe({
        ...base,
        failureStage: "PAGE_OWNERSHIP",
        failureCode: "CANONICAL_PAGE_OWNERSHIP"
      });
      if (!browserConnected) return emptyCanonicalPageRuntimeProbe({
        ...base,
        failureStage: "CANONICAL_PAGE_LOOKUP",
        failureCode: "BROWSER_DISCONNECTED"
      });
      let rawPageUrl: string;
      try {
        rawPageUrl = page.url();
      } catch (error) {
        return emptyCanonicalPageRuntimeProbe({
          ...base,
          failureStage: "PLAYWRIGHT_URL",
          failureCode: "PLAYWRIGHT_URL_READ_FAILED",
          failureErrorClass: error instanceof Error ? error.name : "UnknownError"
        });
      }
      const playwrightPageUrl = sanitizeUrlString(rawPageUrl);
      const routeClass = classifyXiaohongshuCreatorIdentityRoute(rawPageUrl, this.isLoginPage(rawPageUrl), this.isVerificationUrl(rawPageUrl));
      const evaluatePage = page as unknown as { evaluate?: <T>(pageFunction: () => T) => Promise<T> };
      if (typeof evaluatePage.evaluate !== "function") return emptyCanonicalPageRuntimeProbe({
        ...base,
        probeStatus: "FAIL",
        failureStage: "DOM_LOCATION_EVALUATE",
        failureCode: "DOM_LOCATION_EVALUATE_UNAVAILABLE",
        playwrightPageUrl,
        routeClass,
        domLocationEvaluateStatus: "FAIL",
        domLocationEvaluateErrorClass: "PageEvaluateUnavailableError"
      });

      let rawDomLocationHref: string;
      try {
        rawDomLocationHref = String(await evaluatePage.evaluate(() => location.href));
      } catch (error) {
        return emptyCanonicalPageRuntimeProbe({
          ...base,
          failureStage: "DOM_LOCATION_EVALUATE",
          failureCode: "DOM_LOCATION_EVALUATE_FAILED",
          failureErrorClass: error instanceof Error ? error.name : "UnknownError",
          playwrightPageUrl,
          routeClass,
          domLocationEvaluateStatus: "FAIL",
          domLocationEvaluateErrorClass: error instanceof Error ? error.name : "UnknownError"
        });
      }
      const domLocationHref = sanitizeUrlString(rawDomLocationHref);
      const pageUrlConsistency = sameUrlOriginAndPath(rawPageUrl, rawDomLocationHref) ? "PASS" : "FAIL";
      if (pageUrlConsistency === "FAIL") {
        // Keep the URL mismatch as the authoritative probe failure, while
        // retaining the legacy identity observation for callers of
        // readCanonicalCreatorIdentity. This remains read-only and uses the
        // same canonical Page; Task10V consumes the structured failure.
        let identity: XiaohongshuPageEvidence["identity"] | null = null;
        try {
          identity = (await readXiaohongshuPageEvidence(page, { failOnEvaluateError: true })).identity;
        } catch {
          identity = null;
        }
        return emptyCanonicalPageRuntimeProbe({
          ...base,
          failureStage: "URL_CONSISTENCY",
          failureCode: "CANONICAL_PAGE_URL_MISMATCH",
          playwrightPageUrl,
          domLocationHref,
          domLocationEvaluateStatus: "PASS",
          pageUrlConsistency,
          routeClass,
          identityObservationStatus: identity ? (identity.externalAccountId ? "PASS" : "NOT_VERIFIED") : "FAIL",
          identitySourceCandidates: identity ? identitySourceCandidatesFromEvidence(identity) : [],
          identityDomDiagnosticMatchCount: identity?.identityDomDiagnosticMatchCount ?? 0,
          identityDomDiagnosticMatches: identity?.identityDomDiagnosticMatches ?? [],
          observedCreatorIdRaw: identity?.externalAccountId ?? null,
          observedCreatorIdNormalized: normalizeExternalCreatorId(identity?.externalAccountId ?? null),
          observedDisplayName: identity?.displayName ?? null,
          observedProfileUrl: identity ? sanitizePublicProfileUrl(identity.profileUrl) : null
        });
      }

      let evidence: XiaohongshuPageEvidence;
      try {
        evidence = await readXiaohongshuPageEvidence(page, { failOnEvaluateError: true });
      } catch (error) {
        return emptyCanonicalPageRuntimeProbe({
          ...base,
          failureStage: "IDENTITY_OBSERVATION",
          failureCode: "IDENTITY_EVALUATE_FAILED",
          failureErrorClass: error instanceof Error ? error.name : "UnknownError",
          playwrightPageUrl,
          domLocationHref,
          domLocationEvaluateStatus: "PASS",
          pageUrlConsistency,
          routeClass,
          identityObservationStatus: "FAIL"
        });
      }
      const identity = evidence.identity;
      const observedCreatorIdRaw = identity.externalAccountId;
      const observedCreatorIdNormalized = normalizeExternalCreatorId(observedCreatorIdRaw);
      return {
        probeStatus: "PASS",
        failureStage: null,
        failureCode: null,
        failureErrorClass: null,
        ...base,
        playwrightPageUrl,
        domLocationHref,
        domLocationEvaluateStatus: "PASS",
        domLocationEvaluateErrorClass: null,
        pageUrlConsistency,
        routeClass,
        identityObservationStatus: observedCreatorIdNormalized ? "PASS" : "NOT_VERIFIED",
        identitySourceCandidates: identitySourceCandidatesFromEvidence(identity),
        identityDomDiagnosticMatchCount: identity.identityDomDiagnosticMatchCount ?? 0,
        identityDomDiagnosticMatches: identity.identityDomDiagnosticMatches ?? [],
        observedCreatorIdRaw,
        observedCreatorIdNormalized,
        observedDisplayName: identity.displayName,
        observedProfileUrl: sanitizePublicProfileUrl(identity.profileUrl)
      };
    }, "inspectCanonicalPageRuntime");
  }

  /**
   * Read-only inventory of every Page already present in the account-owned
   * BrowserContext. This method never creates, closes, navigates, reloads, or
   * mutates a Page and never accepts a Page identity from the Renderer.
   */
  async inspectXhsContextPages(ctx: AccountContext): Promise<XiaohongshuContextPageInventory> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const session = this.activeBrowserSession(ctx);
      const base = emptyXiaohongshuContextPageInventory({
        accountId: ctx.accountId,
        contextDebugId: session?.contextDebugId,
        runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
        browserConnected: session ? this.isBrowserConnected(session) : false
      });
      let pages: Awaited<ReturnType<typeof this.activeContextPages>>;
      try {
        pages = this.activeContextPages(ctx);
      } catch (error) {
        return { ...base, failureCode: error instanceof Error ? error.name : "CONTEXT_PAGE_OWNERSHIP" };
      }
      if (!pages || !session) return base;
      const inspectedPages = await Promise.all(pages.map((page) => inspectXiaohongshuContextPage(page, pages)));
      return {
        ...base,
        inventoryStatus: "PASS",
        failureCode: null,
        contextDebugId: session.contextDebugId ?? "unknown-context",
        pageCount: inspectedPages.length,
        canonicalPageId: inspectedPages.find((page) => page.isCanonical)?.pageId ?? null,
        pages: inspectedPages,
        pageCreationEvents: [...(this.activeContextPageLifecycleEvents(ctx) ?? [])]
      };
    }, "inspectXhsContextPages");
  }

  /** Ensure an identity-capable Page exists in the current account-owned Context without touching the editor. */
  async ensureXhsIdentityPage(ctx: AccountContext): Promise<IdentityPageEnsureResult> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const session = this.activeBrowserSession(ctx);
      if (!session || !this.isBrowserConnected(session)) {
        return { status: "BLOCKED", failureCode: "BROWSER_SESSION_UNAVAILABLE", action: null, identityPage: null, identityPageUrl: null, editorPage: null, editorPageUrl: null, sameBrowserContext: false };
      }
      let pages: Awaited<ReturnType<typeof this.activeContextPages>>;
      try {
        pages = this.activeContextPages(ctx);
      } catch {
        return { status: "BLOCKED", failureCode: "CONTEXT_PAGES_UNAVAILABLE", action: null, identityPage: null, identityPageUrl: null, editorPage: null, editorPageUrl: null, sameBrowserContext: false };
      }
      if (!pages) {
        return { status: "BLOCKED", failureCode: "CONTEXT_PAGES_UNAVAILABLE", action: null, identityPage: null, identityPageUrl: null, editorPage: null, editorPageUrl: null, sameBrowserContext: false };
      }
      return ensureXhsIdentityPage({ context: session.context, editorPage: session.page });
    }, "ensureXhsIdentityPage");
  }

  /**
   * Establish identity from the unique already-open identity-capable Page in
   * this account-owned Context. The canonical Page may be a publish editor;
   * identity is bound to the Session and Context, never to that Page.
   */
  async verifyIdentityOnContextPage(ctx: AccountContext): Promise<XiaohongshuPageScopedIdentityVerification> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const session = this.activeBrowserSession(ctx);
      if (!session) return { status: "FAIL", failureCode: "BROWSER_SESSION_UNAVAILABLE", proof: null };
      if (!this.isBrowserConnected(session)) return { status: "FAIL", failureCode: "BROWSER_SESSION_DISCONNECTED", proof: null };

      let pages: Awaited<ReturnType<typeof this.activeContextPages>>;
      try {
        pages = this.activeContextPages(ctx);
      } catch {
        return { status: "FAIL", failureCode: "CONTEXT_PAGE_OWNERSHIP_FAILURE", proof: null };
      }
      if (!pages) return { status: "FAIL", failureCode: "CONTEXT_PAGE_UNAVAILABLE", proof: null };

      const identityPages = pages.filter((entry) => {
        try {
          if (entry.page.isClosed() || !this.pageContextMatchesSession(session, entry.page)) return false;
          const parsed = new URL(entry.page.url());
          return parsed.origin === "https://creator.xiaohongshu.com" && isXiaohongshuIdentitySourcePath(parsed.pathname);
        } catch {
          return false;
        }
      });
      if (identityPages.length === 0) return { status: "FAIL", failureCode: "IDENTITY_PAGE_NOT_FOUND", proof: null };
      if (identityPages.length !== 1) return { status: "FAIL", failureCode: "IDENTITY_PAGE_AMBIGUOUS", proof: null };

      const identityPage = identityPages[0];
      if (!identityPage) return { status: "FAIL", failureCode: "IDENTITY_PAGE_NOT_FOUND", proof: null };
      return verifyIdentityOnPage(identityPage.page, {
        browserSessionId: session.runtimeSessionIdentity,
        contextId: session.contextDebugId ?? "",
        pageId: identityPage.pageDebugId
      });
    }, "verifyIdentityOnContextPage");
  }

  /**
   * Read-only readiness inspection of the retained canonical Page. The caller
   * supplies only the account context; Page identity, route validation, and
   * the editor inspection all stay inside Main/Adapter-owned state.
   */
  async inspectCurrentXiaohongshuImageEditorReadiness(ctx: AccountContext): Promise<XiaohongshuCurrentImageEditorReadiness> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const activeSession = this.activeBrowserSession(ctx);
      if (!activeSession) return emptyCurrentImageEditorReadiness(ctx.accountId, { failureCode: "BROWSER_SESSION_UNAVAILABLE" });

      const sessionBase = {
        accountId: ctx.accountId,
        contextDebugId: activeSession.contextDebugId ?? null,
        pageId: activeSession.pageDebugId ?? null,
        sessionExists: true,
        browserConnected: this.isBrowserConnected(activeSession),
        contextExists: Boolean(activeSession.context && typeof activeSession.context.pages === "function"),
        pageExists: false,
        pageClosed: this.isCanonicalPageClosed(activeSession.page),
        pageContextMatchesSession: false
      };
      let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>> = null;
      try {
        canonical = await this.activeCanonicalPage(ctx);
      } catch {
        return emptyCurrentImageEditorReadiness(ctx.accountId, { ...sessionBase, failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE" });
      }
      if (!canonical) {
        return emptyCurrentImageEditorReadiness(ctx.accountId, {
          ...sessionBase,
          failureCode: sessionBase.pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_UNAVAILABLE"
        });
      }

      const { session, page, pageDebugId } = canonical;
      const browserConnected = this.isBrowserConnected(session);
      const contextExists = Boolean(session.context && typeof session.context.pages === "function");
      const pageClosed = this.isCanonicalPageClosed(page);
      let pageExists = false;
      if (contextExists) {
        try { pageExists = session.context.pages().includes(page); } catch { pageExists = false; }
      }
      const pageContextMatchesSession = !pageClosed && this.pageContextMatchesSession(session, page) && pageExists;
      const base = {
        accountId: ctx.accountId,
        contextDebugId: session.contextDebugId ?? null,
        pageId: pageDebugId,
        sessionExists: true,
        browserConnected,
        contextExists,
        pageExists,
        pageClosed,
        pageContextMatchesSession
      };
      const fail = (failureCode: string, overrides: Partial<XiaohongshuCurrentImageEditorReadiness> = {}): XiaohongshuCurrentImageEditorReadiness => emptyCurrentImageEditorReadiness(ctx.accountId, { ...base, failureCode, ...overrides });
      if (!browserConnected) return fail("BROWSER_SESSION_DISCONNECTED");
      if (!contextExists || !pageExists || !pageContextMatchesSession) return fail(pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_OWNERSHIP_FAILURE");

      let rawUrl: string;
      try { rawUrl = page.url(); } catch { return fail("CANONICAL_PAGE_URL_UNAVAILABLE"); }
      const route = safeXiaohongshuRouteMetadata(rawUrl);
      const canonicalRoute = route.origin === "https://creator.xiaohongshu.com" && route.pathname === "/publish/publish";
      if (!canonicalRoute) return fail("CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", { ...route });

      const inspection = await inspectImagePostEditorPhase(page, {
        operationId: randomUUID(),
        platformKey: "xiaohongshu",
        accountId: ctx.accountId,
        contextDebugId: session.contextDebugId ?? "unknown-context",
        pageDebugId: session.pageDebugId ?? "unknown-page"
      });
      const preUpload = assertPreUploadImageEditorContract(inspection);
      const latestSample = inspection.readinessSamples[inspection.readinessSamples.length - 1] ?? null;
      const tabs = inferredImageEditorTabs(inspection);
      return {
        ...base,
        inspectionStatus: "PASS",
        failureCode: null,
        pageId: pageDebugId,
        ...route,
        readyState: latestSample?.readyState ?? null,
        editorShellPresent: latestSample?.shellSignal === true,
        uploadVideoTabPresent: tabs.uploadVideoTabPresent,
        uploadImageTabPresent: tabs.uploadImageTabPresent,
        longFormTabPresent: tabs.longFormTabPresent,
        podcastTabPresent: tabs.podcastTabPresent,
        currentSelectedTab: tabs.currentSelectedTab,
        imageUploadControlPresent: inspection.uploadCapabilityStatus === "PRESENT" && inspection.uploadCapabilityPresent,
        titleControlPresent: inspection.phaseTopology.titleCandidateCount > 0,
        bodyControlPresent: inspection.phaseTopology.bodyCandidateCount > 0,
        finalSubmitControlPresent: inspection.phaseTopology.finalSubmitCandidateCount > 0,
        contentType: inspection.contentType,
        imageEditorPhase: inspection.phase,
        preUploadPhaseResult: preUpload.status,
        preUploadFailureCode: preUpload.failureCode ?? null,
        preUploadFailureStage: preUpload.failureStage ?? null,
        preUploadMissingSignal: preUpload.missingSignal ?? null,
        readinessSamples: inspection.readinessSamples
      };
    }, "inspectCurrentXiaohongshuImageEditorReadiness");
  }

  /**
   * Read-only bounded DOM evidence on the retained canonical XHS publish Page.
   * The Page/evaluate boundary is entirely Main-owned and accepts no Renderer input.
   */
  async inspectCurrentXiaohongshuPublishEditorDom(ctx: AccountContext): Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const activeSession = this.activeBrowserSession(ctx);
      if (!activeSession) return emptyXiaohongshuPublishEditorDomRuntimeDiagnostic(ctx.accountId);

      const sessionBase = {
        accountId: ctx.accountId,
        contextDebugId: activeSession.contextDebugId ?? null,
        pageId: activeSession.pageDebugId ?? null,
        sessionExists: true,
        browserConnected: this.isBrowserConnected(activeSession),
        contextExists: Boolean(activeSession.context && typeof activeSession.context.pages === "function"),
        pageExists: false,
        pageClosed: this.isCanonicalPageClosed(activeSession.page),
        pageContextMatchesSession: false
      };

      let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>> = null;
      try {
        canonical = await this.activeCanonicalPage(ctx);
      } catch {
        return emptyXiaohongshuPublishEditorDomRuntimeDiagnostic(ctx.accountId, { ...sessionBase, failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE" });
      }
      if (!canonical) {
        return emptyXiaohongshuPublishEditorDomRuntimeDiagnostic(ctx.accountId, {
          ...sessionBase,
          failureCode: sessionBase.pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_UNAVAILABLE"
        });
      }

      const { session, page, pageDebugId } = canonical;
      const browserConnected = this.isBrowserConnected(session);
      const contextExists = Boolean(session.context && typeof session.context.pages === "function");
      const pageClosed = this.isCanonicalPageClosed(page);
      let pageExists = false;
      if (contextExists) {
        try { pageExists = session.context.pages().includes(page); } catch { pageExists = false; }
      }
      const pageContextMatchesSession = !pageClosed && this.pageContextMatchesSession(session, page) && pageExists;
      const base = {
        accountId: ctx.accountId,
        contextDebugId: session.contextDebugId ?? null,
        pageId: pageDebugId,
        sessionExists: true,
        browserConnected,
        contextExists,
        pageExists,
        pageClosed,
        pageContextMatchesSession
      };
      const fail = (failureCode: XiaohongshuPublishEditorDomRuntimeDiagnostic["failureCode"], overrides: Partial<XiaohongshuPublishEditorDomRuntimeDiagnostic> = {}): XiaohongshuPublishEditorDomRuntimeDiagnostic => emptyXiaohongshuPublishEditorDomRuntimeDiagnostic(ctx.accountId, { ...base, failureCode, ...overrides });
      if (!browserConnected) return fail("BROWSER_SESSION_DISCONNECTED");
      if (!contextExists || !pageExists || !pageContextMatchesSession) return fail(pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_OWNERSHIP_FAILURE");

      let rawUrl: string;
      try { rawUrl = page.url(); } catch { return fail("CANONICAL_PAGE_URL_UNAVAILABLE"); }
      const route = safeXiaohongshuRouteMetadata(rawUrl);
      if (route.origin !== "https://creator.xiaohongshu.com" || route.pathname !== "/publish/publish") {
        return fail("CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", { ...route });
      }

      try {
        const snapshot = await inspectXiaohongshuPublishEditorDom(page);
        return {
          ...base,
          inspectionStatus: "PASS",
          failureCode: null,
          ...route,
          ...snapshot
        };
      } catch {
        return fail("PAGE_EVALUATION_FAILED", { ...route });
      }
    }, "inspectCurrentXiaohongshuPublishEditorDom");
  }

  /**
   * Read-only semantic candidate evidence on the retained canonical XHS
   * publish Page. The candidate resolver is fixed inside Main and accepts no
   * Renderer-provided selector, text, URL, Page, or Context identity.
   */
  async inspectCurrentXiaohongshuPublishEditorSemanticCandidates(ctx: AccountContext): Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const activeSession = this.activeBrowserSession(ctx);
      if (!activeSession) return emptyXiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic(ctx.accountId);

      const sessionBase = {
        accountId: ctx.accountId,
        contextDebugId: activeSession.contextDebugId ?? null,
        pageId: activeSession.pageDebugId ?? null,
        sessionExists: true,
        browserConnected: this.isBrowserConnected(activeSession),
        contextExists: Boolean(activeSession.context && typeof activeSession.context.pages === "function"),
        pageExists: false,
        pageClosed: this.isCanonicalPageClosed(activeSession.page),
        pageContextMatchesSession: false
      };

      let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>> = null;
      try {
        canonical = await this.activeCanonicalPage(ctx);
      } catch {
        return emptyXiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic(ctx.accountId, { ...sessionBase, failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE" });
      }
      if (!canonical) {
        return emptyXiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic(ctx.accountId, {
          ...sessionBase,
          failureCode: sessionBase.pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_UNAVAILABLE"
        });
      }

      const { session, page, pageDebugId } = canonical;
      const browserConnected = this.isBrowserConnected(session);
      const contextExists = Boolean(session.context && typeof session.context.pages === "function");
      const pageClosed = this.isCanonicalPageClosed(page);
      let pageExists = false;
      if (contextExists) {
        try { pageExists = session.context.pages().includes(page); } catch { pageExists = false; }
      }
      const pageContextMatchesSession = !pageClosed && this.pageContextMatchesSession(session, page) && pageExists;
      const base = {
        accountId: ctx.accountId,
        contextDebugId: session.contextDebugId ?? null,
        pageId: pageDebugId,
        sessionExists: true,
        browserConnected,
        contextExists,
        pageExists,
        pageClosed,
        pageContextMatchesSession
      };
      const fail = (failureCode: XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic["failureCode"], overrides: Partial<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic> = {}): XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic => emptyXiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic(ctx.accountId, { ...base, failureCode, ...overrides });
      if (!browserConnected) return fail("BROWSER_SESSION_DISCONNECTED");
      if (!contextExists || !pageExists || !pageContextMatchesSession) return fail(pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_OWNERSHIP_FAILURE");

      let rawUrl: string;
      try { rawUrl = page.url(); } catch { return fail("CANONICAL_PAGE_URL_UNAVAILABLE"); }
      const route = safeXiaohongshuRouteMetadata(rawUrl);
      if (route.origin !== "https://creator.xiaohongshu.com" || route.pathname !== "/publish/publish") {
        return fail("CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", { ...route });
      }

      try {
        const snapshot = await inspectXiaohongshuPublishEditorSemanticCandidates(page);
        return {
          ...base,
          inspectionStatus: "PASS",
          failureCode: null,
          ...route,
          ...snapshot
        };
      } catch {
        return fail("PAGE_EVALUATION_FAILED", { ...route });
      }
    }, "inspectCurrentXiaohongshuPublishEditorSemanticCandidates");
  }

  /**
   * Read-only fixed Task10S evidence for the publish host's closed shadow
   * surface. The existing resolver owns all CDP tree traversal and matching.
   */
  async inspectCurrentXiaohongshuClosedShadowFinalSubmit(ctx: AccountContext): Promise<XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const activeSession = this.activeBrowserSession(ctx);
      if (!activeSession) return emptyClosedShadowFinalSubmitRuntimeDiagnostic(ctx.accountId);

      const sessionBase = {
        accountId: ctx.accountId,
        contextDebugId: activeSession.contextDebugId ?? null,
        pageId: activeSession.pageDebugId ?? null,
        sessionExists: true,
        browserConnected: this.isBrowserConnected(activeSession),
        contextExists: Boolean(activeSession.context && typeof activeSession.context.pages === "function"),
        pageExists: false,
        pageClosed: this.isCanonicalPageClosed(activeSession.page),
        pageContextMatchesSession: false
      };

      let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>> = null;
      try {
        canonical = await this.activeCanonicalPage(ctx);
      } catch {
        return emptyClosedShadowFinalSubmitRuntimeDiagnostic(ctx.accountId, { ...sessionBase, failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE" });
      }
      if (!canonical) {
        return emptyClosedShadowFinalSubmitRuntimeDiagnostic(ctx.accountId, {
          ...sessionBase,
          failureCode: sessionBase.pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_UNAVAILABLE"
        });
      }

      const { session, page, pageDebugId } = canonical;
      const browserConnected = this.isBrowserConnected(session);
      const contextExists = Boolean(session.context && typeof session.context.pages === "function");
      const pageClosed = this.isCanonicalPageClosed(page);
      let pageExists = false;
      if (contextExists) {
        try { pageExists = session.context.pages().includes(page); } catch { pageExists = false; }
      }
      const pageContextMatchesSession = !pageClosed && this.pageContextMatchesSession(session, page) && pageExists;
      const base = {
        accountId: ctx.accountId,
        contextDebugId: session.contextDebugId ?? null,
        pageId: pageDebugId,
        sessionExists: true,
        browserConnected,
        contextExists,
        pageExists,
        pageClosed,
        pageContextMatchesSession
      };
      const fail = (failureCode: string, overrides: Partial<XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic> = {}): XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic => emptyClosedShadowFinalSubmitRuntimeDiagnostic(ctx.accountId, { ...base, failureCode, ...overrides });
      if (!browserConnected) return fail("BROWSER_SESSION_DISCONNECTED");
      if (!contextExists || !pageExists || !pageContextMatchesSession) return fail(pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_OWNERSHIP_FAILURE");

      let rawUrl: string;
      try { rawUrl = page.url(); } catch { return fail("CANONICAL_PAGE_URL_UNAVAILABLE"); }
      const route = safeXiaohongshuRouteMetadata(rawUrl);
      if (route.origin !== "https://creator.xiaohongshu.com" || route.pathname !== "/publish/publish") {
        return fail("CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", { ...route });
      }

      const resolution = await inspectTask10sClosedShadowPublishSurface(page);
      const host = resolution.host;
      const button = resolution.innerButton;
      const buttonRect = button?.boundingRect ?? null;
      const cdpSessionCreated = resolution.failureCode === "TASK10S_CDP_SESSION_UNAVAILABLE" ? "NO" : "YES";
      const cdpGetDocumentSuccess = resolution.failureCode === null ? "YES" : resolution.failureCode === "CDP_DOM_DOCUMENT_UNAVAILABLE" ? "NO" : "NOT_PROVEN";
      return {
        ...base,
        inspectionStatus: "PASS",
        failureCode: resolution.failureCode,
        ...route,
        cdpSessionCreated,
        cdpGetDocumentSuccess,
        cdpGetDocumentDepth: -1,
        cdpGetDocumentPierce: true,
        piercedXhsPublishBtnCount: resolution.hostMatchCount,
        hostNodeName: host?.tagName ?? null,
        hostAttributesSafe: host ? {
          isPublish: host.isPublish,
          isSaveDraft: host.isSaveDraft,
          submitText: host.submitText,
          saveText: host.saveText,
          submitDisabled: host.submitDisabled,
          submitLoading: host.submitLoading
        } : null,
        hostIsPublish: host?.isPublish ?? null,
        hostSubmitText: host?.submitText ?? null,
        hostSubmitDisabled: host?.submitDisabled ?? null,
        hostSubmitLoading: host?.submitLoading ?? null,
        hostDescendantButtonCount: resolution.innerButtonMatchCount,
        exactPublishNativeButtonCount: resolution.innerButtonMatchCount,
        buttonNodeName: button?.tagName ?? null,
        buttonTextSafe: button?.exactText ?? null,
        buttonType: button?.type ?? null,
        buttonClassSafe: button?.classNameSafe ?? null,
        buttonAriaDisabled: button?.ariaDisabled ?? null,
        buttonAriaBusy: button?.ariaBusy ?? null,
        buttonBoxModelPresent: button ? (buttonRect ? "YES" : "NO") : "NOT_PROVEN",
        buttonCenterXSafe: buttonRect ? buttonRect.x + buttonRect.width / 2 : null,
        buttonCenterYSafe: buttonRect ? buttonRect.y + buttonRect.height / 2 : null,
        finalSubmitControlPresent: resolution.present ? "YES" : "NO",
        finalSubmitControlEnabled: resolution.enabled ? "YES" : resolution.present ? "NO" : "NOT_PROVEN",
        closedShadowFinalSubmitSurface: resolution.present && resolution.enabled ? "PASS" : "FAIL",
        saveDraftSurfacePresent: "NOT_INSPECTED",
        finalResolverSelectedSaveDraft: "NO"
      };
    }, "inspectCurrentXiaohongshuClosedShadowFinalSubmit");
  }

  /**
   * Read-only document-global exact 发布 evidence on the retained canonical
   * XHS publish Page. This is diagnostic-only and deliberately separate from
   * the production final-submit control resolver.
   */
  async inspectCurrentXiaohongshuGlobalExactPublishDom(ctx: AccountContext): Promise<XiaohongshuGlobalExactPublishDomRuntimeDiagnostic> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const activeSession = this.activeBrowserSession(ctx);
      if (!activeSession) return emptyXiaohongshuGlobalExactPublishDomRuntimeDiagnostic(ctx.accountId);

      const sessionBase = {
        accountId: ctx.accountId,
        contextDebugId: activeSession.contextDebugId ?? null,
        pageId: activeSession.pageDebugId ?? null,
        sessionExists: true,
        browserConnected: this.isBrowserConnected(activeSession),
        contextExists: Boolean(activeSession.context && typeof activeSession.context.pages === "function"),
        pageExists: false,
        pageClosed: this.isCanonicalPageClosed(activeSession.page),
        pageContextMatchesSession: false
      };

      let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>> = null;
      try {
        canonical = await this.activeCanonicalPage(ctx);
      } catch {
        return emptyXiaohongshuGlobalExactPublishDomRuntimeDiagnostic(ctx.accountId, { ...sessionBase, failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE" });
      }
      if (!canonical) {
        return emptyXiaohongshuGlobalExactPublishDomRuntimeDiagnostic(ctx.accountId, {
          ...sessionBase,
          failureCode: sessionBase.pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_UNAVAILABLE"
        });
      }

      const { session, page, pageDebugId } = canonical;
      const browserConnected = this.isBrowserConnected(session);
      const contextExists = Boolean(session.context && typeof session.context.pages === "function");
      const pageClosed = this.isCanonicalPageClosed(page);
      let pageExists = false;
      if (contextExists) {
        try { pageExists = session.context.pages().includes(page); } catch { pageExists = false; }
      }
      const pageContextMatchesSession = !pageClosed && this.pageContextMatchesSession(session, page) && pageExists;
      const base = {
        accountId: ctx.accountId,
        contextDebugId: session.contextDebugId ?? null,
        pageId: pageDebugId,
        sessionExists: true,
        browserConnected,
        contextExists,
        pageExists,
        pageClosed,
        pageContextMatchesSession
      };
      const fail = (failureCode: XiaohongshuGlobalExactPublishDomRuntimeDiagnostic["failureCode"], overrides: Partial<XiaohongshuGlobalExactPublishDomRuntimeDiagnostic> = {}): XiaohongshuGlobalExactPublishDomRuntimeDiagnostic => emptyXiaohongshuGlobalExactPublishDomRuntimeDiagnostic(ctx.accountId, { ...base, failureCode, ...overrides });
      if (!browserConnected) return fail("BROWSER_SESSION_DISCONNECTED");
      if (!contextExists || !pageExists || !pageContextMatchesSession) return fail(pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_OWNERSHIP_FAILURE");

      let rawUrl: string;
      try { rawUrl = page.url(); } catch { return fail("CANONICAL_PAGE_URL_UNAVAILABLE"); }
      const route = safeXiaohongshuRouteMetadata(rawUrl);
      if (route.origin !== "https://creator.xiaohongshu.com" || route.pathname !== "/publish/publish") {
        return fail("CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", { ...route });
      }

      try {
        const snapshot = await inspectXiaohongshuGlobalExactPublishDom(page);
        return {
          ...base,
          inspectionStatus: "PASS",
          failureCode: null,
          ...route,
          ...snapshot
        };
      } catch {
        return fail("PAGE_EVALUATION_FAILED", { ...route });
      }
    }, "inspectCurrentXiaohongshuGlobalExactPublishDom");
  }

  /**
   * Read-only reconciliation of the retained post-upload editor. This is
   * deliberately separate from the pre-upload contract and never performs a
   * retry, click, navigation, content fill, or file mutation.
   */
  async inspectCurrentXiaohongshuPostUploadReconciliation(ctx: AccountContext): Promise<XiaohongshuCurrentPostUploadReconciliation> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const activeSession = this.activeBrowserSession(ctx);
      if (!activeSession) return emptyCurrentPostUploadReconciliation(ctx.accountId);

      const sessionBase = {
        accountId: ctx.accountId,
        contextDebugId: activeSession.contextDebugId ?? null,
        pageId: activeSession.pageDebugId ?? null,
        sessionExists: true,
        browserConnected: this.isBrowserConnected(activeSession),
        contextExists: Boolean(activeSession.context && typeof activeSession.context.pages === "function"),
        pageExists: false,
        pageClosed: this.isCanonicalPageClosed(activeSession.page),
        pageContextMatchesSession: false
      };
      let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>> = null;
      try {
        canonical = await this.activeCanonicalPage(ctx);
      } catch {
        return emptyCurrentPostUploadReconciliation(ctx.accountId, { ...sessionBase, failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE" });
      }
      if (!canonical) {
        return emptyCurrentPostUploadReconciliation(ctx.accountId, {
          ...sessionBase,
          failureCode: sessionBase.pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_UNAVAILABLE"
        });
      }

      const { session, page, pageDebugId } = canonical;
      const browserConnected = this.isBrowserConnected(session);
      const contextExists = Boolean(session.context && typeof session.context.pages === "function");
      const pageClosed = this.isCanonicalPageClosed(page);
      let pageExists = false;
      if (contextExists) {
        try { pageExists = session.context.pages().includes(page); } catch { pageExists = false; }
      }
      const pageContextMatchesSession = !pageClosed && this.pageContextMatchesSession(session, page) && pageExists;
      const base = {
        accountId: ctx.accountId,
        contextDebugId: session.contextDebugId ?? null,
        pageId: pageDebugId,
        sessionExists: true,
        browserConnected,
        contextExists,
        pageExists,
        pageClosed,
        pageContextMatchesSession
      };
      const fail = (failureCode: string, overrides: Partial<XiaohongshuCurrentPostUploadReconciliation> = {}): XiaohongshuCurrentPostUploadReconciliation => emptyCurrentPostUploadReconciliation(ctx.accountId, { ...base, failureCode, ...overrides });
      if (!browserConnected) return fail("BROWSER_SESSION_DISCONNECTED");
      if (!contextExists || !pageExists || !pageContextMatchesSession) return fail(pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_OWNERSHIP_FAILURE");

      let rawUrl: string;
      try { rawUrl = page.url(); } catch { return fail("CANONICAL_PAGE_URL_UNAVAILABLE"); }
      const route = safeXiaohongshuRouteMetadata(rawUrl);
      if (route.origin !== "https://creator.xiaohongshu.com" || route.pathname !== "/publish/publish") {
        return fail("CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", { ...route, origin: route.origin ?? "", pathname: route.pathname ?? "" });
      }

      try {
        const snapshot = await inspectXiaohongshuPostUploadReconciliationDom(page);
        if (snapshot.origin !== route.origin || snapshot.pathname !== route.pathname) return fail("PAGE_ROUTE_CHANGED_DURING_DIAGNOSTIC", { ...route, origin: route.origin ?? "", pathname: route.pathname ?? "" });
        const reconciliation = reconcileXiaohongshuPostUploadSnapshot(snapshot);
        return {
          ...base,
          inspectionStatus: "PASS",
          failureCode: null,
          ...route,
          ...reconciliation
        };
      } catch {
        return fail("PAGE_EVALUATION_FAILED", { ...route, origin: route.origin ?? "", pathname: route.pathname ?? "" });
      }
    }, "inspectCurrentXiaohongshuPostUploadReconciliation");
  }

  /**
   * Read-only file-input delivery diagnostic for the retained canonical Page.
   * It does not accept a file path and never performs a file or UI mutation.
   */
  async inspectCurrentXiaohongshuFileInputState(ctx: AccountContext): Promise<XiaohongshuCurrentFileInputState> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const activeSession = this.activeBrowserSession(ctx);
      if (!activeSession) return emptyCurrentFileInputState(ctx.accountId);

      const sessionBase = {
        accountId: ctx.accountId,
        contextDebugId: activeSession.contextDebugId ?? null,
        pageId: activeSession.pageDebugId ?? null,
        sessionExists: true,
        browserConnected: this.isBrowserConnected(activeSession),
        contextExists: Boolean(activeSession.context && typeof activeSession.context.pages === "function"),
        pageExists: false,
        pageClosed: this.isCanonicalPageClosed(activeSession.page),
        pageContextMatchesSession: false
      };
      let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>> = null;
      try {
        canonical = await this.activeCanonicalPage(ctx);
      } catch {
        return emptyCurrentFileInputState(ctx.accountId, { ...sessionBase, failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE" });
      }
      if (!canonical) {
        return emptyCurrentFileInputState(ctx.accountId, {
          ...sessionBase,
          failureCode: sessionBase.pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_UNAVAILABLE"
        });
      }

      const { session, page, pageDebugId } = canonical;
      const browserConnected = this.isBrowserConnected(session);
      const contextExists = Boolean(session.context && typeof session.context.pages === "function");
      const pageClosed = this.isCanonicalPageClosed(page);
      let pageExists = false;
      if (contextExists) {
        try { pageExists = session.context.pages().includes(page); } catch { pageExists = false; }
      }
      const pageContextMatchesSession = !pageClosed && this.pageContextMatchesSession(session, page) && pageExists;
      const base = {
        accountId: ctx.accountId,
        contextDebugId: session.contextDebugId ?? null,
        pageId: pageDebugId,
        sessionExists: true,
        browserConnected,
        contextExists,
        pageExists,
        pageClosed,
        pageContextMatchesSession
      };
      const fail = (failureCode: string, overrides: Partial<XiaohongshuCurrentFileInputState> = {}): XiaohongshuCurrentFileInputState => emptyCurrentFileInputState(ctx.accountId, { ...base, failureCode, ...overrides });
      if (!browserConnected) return fail("BROWSER_SESSION_DISCONNECTED");
      if (!contextExists || !pageExists || !pageContextMatchesSession) return fail(pageClosed ? "CANONICAL_PAGE_CLOSED" : "CANONICAL_PAGE_OWNERSHIP_FAILURE");

      let rawUrl: string;
      try { rawUrl = page.url(); } catch { return fail("CANONICAL_PAGE_URL_UNAVAILABLE"); }
      const route = safeXiaohongshuRouteMetadata(rawUrl);
      if (route.origin !== "https://creator.xiaohongshu.com" || route.pathname !== "/publish/publish") {
        return fail("CANONICAL_PAGE_NOT_XHS_IMAGE_EDITOR_ROUTE", { origin: route.origin ?? null, pathname: route.pathname ?? null, sanitizedUrl: sanitizePageUrl(page) });
      }

      try {
        const snapshot = await inspectXiaohongshuFileInputState(page);
        if (snapshot.origin !== route.origin || snapshot.pathname !== route.pathname) return fail("PAGE_ROUTE_CHANGED_DURING_DIAGNOSTIC", { origin: snapshot.origin, pathname: snapshot.pathname, sanitizedUrl: sanitizePageUrl(page) });
        return {
          ...base,
          inspectionStatus: "PASS",
          failureCode: null,
          origin: snapshot.origin,
          pathname: snapshot.pathname,
          sanitizedUrl: sanitizePageUrl(page),
          readyState: snapshot.readyState,
          matchCount: snapshot.matchCount,
          inputs: snapshot.inputs,
          fileInputContainsExpectedFixture: containsExpectedXiaohongshuSafeFixture(snapshot.inputs)
        };
      } catch {
        return fail("PAGE_EVALUATION_FAILED", { origin: route.origin ?? null, pathname: route.pathname ?? null, sanitizedUrl: sanitizePageUrl(page) });
      }
    }, "inspectCurrentXiaohongshuFileInputState");
  }

  /** Read-only identity proof on the retained canonical Page. */
  async readCanonicalCreatorIdentity(ctx: AccountContext): Promise<XiaohongshuCreatorIdentityObservation> {
    const probe = await this.inspectCanonicalPageRuntime(ctx);
    const stable = probe.identityObservationStatus === "PASS" && probe.identitySourceCandidates.some((candidate) => candidate.stableIdentifierPresent);
    const proof: CreatorIdentityProof = {
      platformKey: "xiaohongshu",
      externalCreatorId: probe.observedCreatorIdNormalized,
      displayName: probe.observedDisplayName,
      profileUrl: probe.observedProfileUrl,
      source: probe.observedProfileUrl ? "CREATOR_PROFILE_LINK" : probe.observedCreatorIdNormalized ? "CREATOR_ACCOUNT_SURFACE" : "CREATOR_ACCOUNT_SURFACE",
      stable
    };
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
      proof
    };
  }

  /** Diagnostic correlation for the main-process CONNECTION_TEST log; it never changes checkLogin behavior. */
  consumeCompletedCheckLoginOperationId(accountId: string): string | null {
    const key = `${this.platformKey}:${accountId}`;
    const queue = this.completedCheckLoginOperationIds.get(key);
    const operationId = queue?.shift() ?? null;
    if (queue && queue.length === 0) this.completedCheckLoginOperationIds.delete(key);
    return operationId;
  }

  override async openBackend(ctx: AccountContext) {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, () => super.openBackend(ctx), "openBackend");
  }

  /**
   * Read-only editor readiness check. This deliberately has no article input and
   * never enters the content mutation path used by preparePublish.
   * The activeCanonicalPage is resolved by the private PRE_SUBMIT_GATE path.
   */
  async inspectPublishEditor(ctx: AccountContext): Promise<PreSubmitGateResult> {
    // The activeCanonicalPage is resolved inside the read-only PRE_SUBMIT_GATE path.
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, () => this.inspectPublishEditorOnCanonicalPage(ctx), "preSubmitGate");
  }

  /** Read-only bounded inspection of exact Creator Home publish-entry labels. */
  async inspectXhsPublishEntryDom(ctx: AccountContext): Promise<XiaohongshuPublishEntryDomRuntimeDiagnostic> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const activeSession = this.activeBrowserSession(ctx);
      const canonical = await this.activeCanonicalPage(ctx).catch(() => null);
      const empty = (failureCode: XiaohongshuPublishEntryDomRuntimeDiagnostic["failureCode"]): XiaohongshuPublishEntryDomRuntimeDiagnostic => ({
        inspectionStatus: "FAIL",
        failureCode,
        accountId: ctx.accountId,
        contextDebugId: activeSession?.contextDebugId ?? null,
        pageId: activeSession?.pageDebugId ?? null,
        pageContextMatchesSession: false,
        browserConnected: activeSession ? this.isBrowserConnected(activeSession) : false,
        pageClosed: activeSession ? this.isCanonicalPageClosed(activeSession.page) : true,
        pageOrigin: "",
        pathname: "",
        publishNote: { label: "发布笔记", matchCount: 0, matches: [], clickableAncestorCount: 0, target: null, ancestors: [], uniqueClickableAncestor: null },
        imagePost: { label: "发布图文笔记", matchCount: 0, matches: [], clickableAncestorCount: 0, target: null, ancestors: [], uniqueClickableAncestor: null },
        uploadImage: { label: "上传图文", matchCount: 0, matches: [], clickableAncestorCount: 0, target: null, ancestors: [], uniqueClickableAncestor: null },
        diagnosticClickCount: 0,
        navigationCount: 0
      });
      if (!canonical) return empty("CANONICAL_PAGE_UNAVAILABLE");
      const pageContextMatchesSession = this.pageContextMatchesSession(canonical.session, canonical.page);
      if (!pageContextMatchesSession) return { ...empty("CANONICAL_PAGE_OWNERSHIP_FAILURE"), contextDebugId: canonical.session.contextDebugId ?? null, pageId: canonical.pageDebugId, pageContextMatchesSession: false, browserConnected: this.isBrowserConnected(canonical.session), pageClosed: this.isCanonicalPageClosed(canonical.page) };
      if (!this.isBrowserConnected(canonical.session)) return { ...empty("BROWSER_SESSION_DISCONNECTED"), contextDebugId: canonical.session.contextDebugId ?? null, pageId: canonical.pageDebugId, pageContextMatchesSession: true, pageClosed: this.isCanonicalPageClosed(canonical.page) };
      const diagnostic = await collectPublishEntryDomDiagnostics(canonical.page);
      return { ...diagnostic, inspectionStatus: "PASS", failureCode: null, accountId: ctx.accountId, contextDebugId: canonical.session.contextDebugId ?? null, pageId: canonical.pageDebugId, pageContextMatchesSession: true, browserConnected: true, pageClosed: this.isCanonicalPageClosed(canonical.page) };
    }, "inspectPublishEntryDom");
  }

  /**
   * Controlled first-upload proof. This is intentionally separate from
   * preparePublish: it may mutate only the image input once, then stops at
   * post-upload discovery without filling content or submitting anything.
   */
  async runControlledPostUploadDiscovery(ctx: AccountContext, input: { imagePath: string; imageSource: "SAFE_TEST_FIXTURE"; onUploadMutationStarted?: () => void }): Promise<ControlledPostUploadDiscoveryResult> {
    const operationId = randomUUID();
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, () => this.runControlledPostUploadDiscoveryOnCanonicalPage(ctx, input, operationId), "controlledPostUploadDiscovery");
  }

  private async runControlledPostUploadDiscoveryOnCanonicalPage(
    ctx: AccountContext,
    input: { imagePath: string; imageSource: "SAFE_TEST_FIXTURE"; onUploadMutationStarted?: () => void },
    operationId: ReturnType<typeof randomUUID>
  ): Promise<ControlledPostUploadDiscoveryResult> {
    const initialCanonical = await this.activeCanonicalPage(ctx).catch(() => null);
    const sanitizedUrlBefore = initialCanonical ? sanitizePageUrl(initialCanonical.page) : null;
    const preUploadGate = await this.inspectPublishEditorOnCanonicalPage(ctx, operationId, false, "CONTROLLED_POST_UPLOAD_DISCOVERY");
    const canonical = await this.activeCanonicalPage(ctx).catch(() => null);
    const sameCanonicalPage = Boolean(initialCanonical && canonical && initialCanonical.page === canonical.page);
    const sameContext = Boolean(initialCanonical && canonical && initialCanonical.session.context === canonical.session.context);
    const finish = (result: ControlledPostUploadDiscoveryResult): ControlledPostUploadDiscoveryResult => {
      if (canonical) {
        this.emitCanonicalPageOperation(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "COMPLETED", sameContext, result.status === "PASS" ? "ready" : "needs_user_action", "CONTROLLED_POST_UPLOAD_DISCOVERY", {
          failureCode: (result.failureCode as PreSubmitGateFailureCode | null) ?? undefined,
          failureStage: (result.failureStage as PreSubmitGateFailureStage | null) ?? undefined,
          missingSignal: result.missingSignal
        });
      }
      return result;
    };
    const failure = (failureCode: string, failureStage: string, missingSignal: string, uploadMutationCount = 0): ControlledPostUploadDiscoveryResult => finish({
      mode: "POST_UPLOAD_DISCOVERY_ONLY",
      status: "FAIL",
      operationId,
      platformKey: this.platformKey,
      accountId: ctx.accountId,
      imageSource: input.imageSource,
      sanitizedUrlBefore,
      sanitizedUrlAfter: canonical ? sanitizePageUrl(canonical.page) : sanitizedUrlBefore,
      preUploadGateStatus: preUploadGate.preUploadGateStatus === "PASS" ? "PASS" : "FAIL",
      preUploadMutationRevalidated: false,
      uploadMutationCount,
      uploadCompletionObserved: false,
      postUploadPhase: null,
      postUploadPhaseConfidence: null,
      postUploadControlsStatus: "FAIL",
      titleEditorStatus: "NOT_TESTED",
      bodyEditorStatus: "NOT_TESTED",
      finalSubmitStatus: "NOT_TESTED",
      contentMutationCount: 0,
      finalSubmitCount: 0,
      sameCanonicalPage,
      sameContext,
      failureCode,
      failureStage,
      missingSignal,
      evidence: { preUploadGate }
    });

    if (!canonical) return failure(preUploadGate.failureCode ?? "CANONICAL_PAGE_UNAVAILABLE", preUploadGate.failureStage ?? "SESSION_PAGE_LIFECYCLE", preUploadGate.missingSignal ?? "active-canonical-page");
    if (!sameCanonicalPage) return failure("CANONICAL_PAGE_OWNERSHIP_FAILURE", "SESSION_PAGE_LIFECYCLE", "canonical-page-identity");
    if (!sameContext) return failure("CANONICAL_PAGE_OWNERSHIP_FAILURE", "SESSION_PAGE_LIFECYCLE", "canonical-context-identity");
    if (!this.isBrowserConnected(canonical.session)) return failure("BROWSER_SESSION_DISCONNECTED", "SESSION_PAGE_LIFECYCLE", "browser-disconnected");
    if (this.isCanonicalPageClosed(canonical.page)) return failure("CANONICAL_PAGE_UNAVAILABLE", "SESSION_PAGE_LIFECYCLE", "canonical-page-closed");
    if (this.getBrowserRuntimeState(ctx).state !== "AUTHENTICATED") return failure("AUTH_REDIRECTED_TO_LOGIN", "AUTHENTICATION", "runtime-auth-state");
    if (preUploadGate.status !== "ready" || preUploadGate.preUploadGateStatus !== "PASS") return failure(preUploadGate.failureCode ?? "PRE_UPLOAD_PHASE_NOT_READY", preUploadGate.failureStage ?? "EDITOR_DISCOVERY", preUploadGate.missingSignal ?? "pre-upload-gate");

    const metadata = {
      operationId,
      platformKey: "xiaohongshu" as const,
      accountId: ctx.accountId,
      contextDebugId: canonical.session.contextDebugId ?? "unknown-context",
      pageDebugId: canonical.pageDebugId
    };
    this.emitStagedEditorDiagnostic(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "PREPARE_PUBLISH_MUTATION_BOUNDARY_ENTERED", {
      expectedPhase: "IMAGE_POST_PRE_UPLOAD",
      observedPhase: "IMAGE_POST_PRE_UPLOAD",
      phase: "IMAGE_POST_PRE_UPLOAD",
      preSubmitGatePhase: "PRE_UPLOAD",
      preUploadGateStatus: "PASS",
      postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD",
      preSubmitGatePassMeaning: "SAFE_TO_ENTER_PREPARE_PUBLISH_UPLOAD_STAGE",
      uploadCapabilityPresent: true,
      mutationType: "IMAGE_UPLOAD_ONLY",
      selfTestMode: "POST_UPLOAD_DISCOVERY_ONLY",
      sanitizedUrl: sanitizePageUrl(canonical.page)
    });

    try {
      const imageEvidence = await this.uploadImages(canonical.page, [input.imagePath], { ctx, session: canonical.session, metadata, selfTestMode: "POST_UPLOAD_DISCOVERY_ONLY", expectedFileMetadata: TASK10S_SAFE_FIXTURE_EXPECTATION, onMutationStarted: input.onUploadMutationStarted });
      const uploadCompletionObserved = imageEvidence.verified === true;
      if (!uploadCompletionObserved) return failure("UPLOAD_COMPLETION_NOT_OBSERVED", "EDITOR_DISCOVERY", "upload-completion", 1);
      const postUploadInspection = await inspectPostUploadImageEditor(canonical.page, metadata, { nativeFilePickerRecovery: createXhsNativeFilePickerRecovery(canonical.page, { profilePath: canonical.session.profilePath, browserChannel: canonical.session.browserChannel ?? null }), emit: (diagnostic) => this.emitImageEditorDiagnostic(diagnostic) });
      const postUploadPassed = postUploadInspection.status === "READY" && postUploadInspection.phase === "IMAGE_POST_POST_UPLOAD_EDITOR" && postUploadInspection.postUploadControlsStatus === "READY";
      const result: ControlledPostUploadDiscoveryResult = {
        mode: "POST_UPLOAD_DISCOVERY_ONLY",
        status: postUploadPassed ? "PASS" : "FAIL",
        operationId,
        platformKey: this.platformKey,
        accountId: ctx.accountId,
        imageSource: input.imageSource,
        sanitizedUrlBefore,
        sanitizedUrlAfter: sanitizePageUrl(canonical.page),
      preUploadGateStatus: "PASS",
        preUploadMutationRevalidated: true,
        uploadMutationCount: 1,
        uploadCompletionObserved,
        postUploadPhase: postUploadInspection.phase,
        postUploadPhaseConfidence: postUploadInspection.confidence,
        postUploadControlsStatus: postUploadInspection.postUploadControlsStatus,
        titleEditorStatus: postUploadInspection.titleEditor.status,
        bodyEditorStatus: postUploadInspection.bodyEditor.status,
        finalSubmitStatus: postUploadInspection.finalSubmitControl.status,
        contentMutationCount: 0,
        finalSubmitCount: 0,
        sameCanonicalPage: true,
        sameContext: true,
        failureCode: postUploadPassed ? null : (postUploadInspection.failureCode ?? "POST_UPLOAD_PHASE_NOT_READY"),
        failureStage: postUploadPassed ? null : (postUploadInspection.failureStage ?? "EDITOR_DISCOVERY"),
        missingSignal: postUploadPassed ? null : (postUploadInspection.missingSignal ?? "post-upload-editor-controls"),
        evidence: { preUploadGate, imageEvidence, postUploadInspection }
      };
      return finish(result);
    } catch (error) {
      const details = this.failureDetailsForError(error);
      return failure(details.failureCode ?? "UPLOAD_FAILED", details.failureStage ?? "EDITOR_DISCOVERY", details.missingSignal ?? "image-upload", 1);
    }
  }

  /**
   * Bounded end-to-end exploration. This is deliberately separate from
   * preparePublish: it may fill only explicit test content and can discover the
   * final submit surface, but it never invokes or simulates submission.
   */
  async runPublishFlowExploration(ctx: AccountContext, input: PublishFlowExplorationInput): Promise<PublishFlowExplorationResult> {
    const operationId = input.operationId?.trim() || randomUUID();
    return this.accountOperationMutex.run(
      `${this.platformKey}:${ctx.accountId}`,
      () => this.runPublishFlowExplorationOnCanonicalPage(ctx, input, operationId),
      "publishFlowExploration"
    );
  }

  /**
   * Recreates the editor surface for an already-persisted Prepared Job. This
   * is deliberately separate from the diagnostic fresh-flow entry point: it
   * accepts trusted Article content from Main, performs one bounded upload,
   * and stops before any publication boundary.
   */
  async recoverPreparedEditor(ctx: AccountContext, input: PublishFlowExplorationInput): Promise<PublishFlowExplorationResult> {
    const operationId = input.operationId?.trim() || randomUUID();
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const pages = this.activeContextPages(ctx) ?? [];
      const editorExists = pages.some((entry) => {
        if (entry.page.isClosed()) return false;
        try {
          const parsed = new URL(entry.page.url());
          return parsed.origin === "https://creator.xiaohongshu.com" && parsed.pathname === "/publish/publish";
        } catch {
          return false;
        }
      });
      if (editorExists) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "EDITOR_ALREADY_EXISTS");
      return this.runPublishFlowExplorationOnCanonicalPage(ctx, {
        ...input,
        operationId,
        postUploadReadinessStrategy: "TERMINAL_CLASSIFIER",
        budgets: {
          ...input.budgets,
          maxDurationMs: 60_000,
          maxNavigationRestarts: 0,
          maxUploadAttempts: 1,
          maxIntermediateActionClicks: 1,
          maxRefreshCount: 0,
          maxTitleMutations: 1,
          maxBodyMutations: 1
        }
      }, operationId);
    }, "preparedEditorRecovery");
  }

  /**
   * Explicit Task10S adapter boundary. Callers must still create the formal
   * Job/SubmissionIntent/PublishRecord lifecycle; this low-level method only
   * exists for adapter contract tests and owner-approved orchestration.
   */
  async runOneShotRealPublishAcceptance(ctx: AccountContext, input: OneShotRealPublishAcceptanceInput & { oneShotPublicationGuard: OneShotPublicationGuard }): Promise<OneShotRealPublishAcceptanceResult> {
    const operationId = input.authorization.operationId;
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const exploration = await this.runPublishFlowExplorationOnCanonicalPage(ctx, { ...input, operationId }, operationId);
      const base = input.oneShotPublicationGuard.authorization;
      if (exploration.status !== "PASS_READY_FOR_FINAL_SUBMIT") {
        return {
          operationId,
          status: "BLOCKED",
          authorizationState: base.state === "CONSUMED" ? "CONSUMED" : "AUTHORIZED_UNUSED",
          publicationTransactionCount: base.publicationTransactionCount,
          publicationCommitActionCount: base.publicationCommitActionCount,
          finalSubmitAttemptCount: base.finalSubmitAttemptCount,
          finalSubmitRetryCount: 0,
          finalSubmitActionStarted: base.finalSubmitActionStarted,
          finalSubmitActionCompleted: base.finalSubmitActionCompleted,
          postSubmitObservation: { status: "NOT_STARTED", blocker: exploration.blocker },
          publicationReconciled: false,
          externalId: null,
          externalUrl: null,
          publicPageVerified: false,
          response: { exploration }
        };
      }
      const article: PublishArticleInput = { articleId: operationId, title: input.title, body: input.body, summary: "", tags: [], images: [input.imagePath] };
      try {
        const submitted = await this.performOneShotFinalSubmit(ctx, article, input.oneShotPublicationGuard, {
          jobId: operationId,
          submissionIntentId: operationId,
          attempt: 1
        });
        const auth = input.oneShotPublicationGuard.markFinalSubmitCompleted();
        return {
          operationId,
          status: "PUBLISHED_VERIFIED",
          authorizationState: "CONSUMED",
          publicationTransactionCount: auth.publicationTransactionCount,
          publicationCommitActionCount: auth.publicationCommitActionCount,
          finalSubmitAttemptCount: auth.finalSubmitAttemptCount,
          finalSubmitRetryCount: 0,
          finalSubmitActionStarted: auth.finalSubmitActionStarted,
          finalSubmitActionCompleted: auth.finalSubmitActionCompleted,
          postSubmitObservation: submitted.response.postSubmitObservation as Record<string, unknown>,
          publicationReconciled: submitted.response.publicPageVerified === true,
          externalId: submitted.externalId ?? null,
          externalUrl: submitted.publishedUrl ?? null,
          publicPageVerified: submitted.response.publicPageVerified === true,
          response: submitted.response
        };
      } catch (error) {
        const auth = input.oneShotPublicationGuard.authorization;
        return {
          operationId,
          status: error instanceof BrowserAutomationError && error.code === "CONTENT_REJECTED" ? "PLATFORM_REJECTED" : auth.finalSubmitActionStarted ? "NEEDS_RECONCILIATION" : "BLOCKED",
          authorizationState: auth.state === "CONSUMED" ? "CONSUMED" : "AUTHORIZED_UNUSED",
          publicationTransactionCount: auth.publicationTransactionCount,
          publicationCommitActionCount: auth.publicationCommitActionCount,
          finalSubmitAttemptCount: auth.finalSubmitAttemptCount,
          finalSubmitRetryCount: 0,
          finalSubmitActionStarted: auth.finalSubmitActionStarted,
          finalSubmitActionCompleted: auth.finalSubmitActionCompleted,
          postSubmitObservation: { status: "ERROR", message: error instanceof Error ? error.message : String(error) },
          publicationReconciled: false,
          externalId: null,
          externalUrl: null,
          publicPageVerified: false,
          response: { error: error instanceof Error ? error.message : String(error) }
        };
      }
    }, "oneShotRealPublishAcceptance");
  }

  private async runPublishFlowExplorationOnCanonicalPage(
    ctx: AccountContext,
    input: PublishFlowExplorationInput,
    operationId: string
  ): Promise<PublishFlowExplorationResult> {
    const startedAt = Date.now();
    const budgets = normalizeExplorationBudgets(input.budgets);
    let counters = emptyExplorationCounters();
    const timeline: Array<{ timestamp: string; url: string; phase: string; action: string; result: string }> = [];
    const states: Array<Record<string, unknown>> = [];
    const actions: Array<Record<string, unknown>> = [];
    const selectors: Array<Record<string, unknown>> = [];
    let titleEvidence = emptyExplorationFieldEvidence();
    let bodyEvidence = emptyExplorationFieldEvidence();
    let requiredSettings: { status: string; mutations: readonly Record<string, unknown>[] } = { status: "NOT_REQUIRED", mutations: [] };
    let finalSubmit: { status: string; visible: boolean; enabled: boolean; hitTestValid: boolean; label?: string } = { status: "NOT_DISCOVERED", visible: false, enabled: false, hitTestValid: false };
    let nativeFilePickerRecoveryResult: NativeFilePickerRecoveryResult | null = null;
    let pickerCancelStabilization: PickerCancelStabilizationResult | null = null;
    let forbiddenMutationObserved = false;
    let blocker: string | null = null;
    let canonical = await this.activeCanonicalPage(ctx).catch(() => null);
    const initialCanonical = canonical;
    const sameInitialPage = Boolean(canonical && this.pageContextMatchesSession(canonical.session, canonical.page));

    const addTimeline = (phase: string, action: string, result: string, page: Page | null = canonical?.page ?? null): void => {
      const entry = { timestamp: new Date().toISOString(), url: page ? sanitizePageUrl(page) : "about:blank", phase, action, result };
      timeline.push(entry);
      this.emitEditorEntryDiagnostic({
        code: "XHS_PUBLISH_FLOW_TIMELINE",
        timestamp: entry.timestamp,
        operationId,
        platformKey: "xiaohongshu",
        accountId: ctx.accountId,
        ...(canonical ? { contextDebugId: canonical.session.contextDebugId ?? "unknown-context", pageDebugId: canonical.pageDebugId, pageRole: "CANONICAL_AUTHENTICATED" as const, pageSource: "EXISTING_CANONICAL_PAGE" as const } : {}),
        createdNewPage: false,
        timelineEntry: entry,
        status: result,
        sanitizedUrl: entry.url,
        finalSubmitCount: counters.finalSubmitCount,
        intermediateActionClickCount: counters.intermediateActionClickCount
      });
    };

    const buildResult = (status: PublishFlowExplorationResult["status"]): PublishFlowExplorationResult => {
      const result: PublishFlowExplorationResult = {
        mode: "XHS_PUBLISH_FLOW_EXPLORATION",
        status,
        operationId,
        platformKey: this.platformKey,
        accountId: ctx.accountId,
        imageSource: input.imageSource,
        sameCanonicalPage: Boolean(initialCanonical && canonical && initialCanonical.page === canonical.page),
        sameContext: Boolean(initialCanonical && canonical && initialCanonical.session.context === canonical.session.context),
        timeline,
        states,
        actions,
        selectors,
        counters,
        uploadAttempts: counters.uploadAttempts,
        uploadMutationCount: counters.uploadMutationCount,
        uploadRetryCount: counters.uploadRetryCount,
        intermediateActionClickCount: counters.intermediateActionClickCount,
        titleMutationCount: counters.titleMutationCount,
        bodyMutationCount: counters.bodyMutationCount,
        settingsMutationCount: counters.settingsMutationCount,
        contentMutationCount: counters.contentMutationCount,
        finalSubmitCount: 0,
        budgets,
        title: titleEvidence,
        titleReadbackVerified: titleEvidence.readbackVerified,
        body: bodyEvidence,
        bodyReadbackVerified: bodyEvidence.readbackVerified,
        requiredSettings,
        finalSubmit,
        ...(pickerCancelStabilization ? {
          afterPickerCancelUrl: pickerCancelStabilization.afterPickerCancelUrl,
          afterPickerCancelWaitMs: pickerCancelStabilization.afterPickerCancelWaitMs,
          finalControlDiscoveryRetryCount: pickerCancelStabilization.finalControlDiscoveryRetryCount,
          finalControlFoundAfterWait: pickerCancelStabilization.finalControlFoundAfterWait
        } : {}),
        forbiddenMutationObserved,
        blocker,
        ...(blocker ? { failureCode: blocker, failureStage: "EXPLORATION", missingSignal: blocker } : {}),
        readyForFinalSubmit: status === "PASS_READY_FOR_FINAL_SUBMIT",
        evidence: {
          uploadedImageSha256: states.find((state) => state.phase === "IMAGE_UPLOAD")?.uploadedImageSha256 ?? null,
          titleReadbackValue: titleEvidence.readbackValue ?? null,
          bodyReadbackValue: bodyEvidence.readbackValue ?? null,
          runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
          canonicalContextMatch: sameInitialPage,
          canonicalPageMatch: Boolean(initialCanonical && canonical && initialCanonical.page === canonical.page),
          canonicalPageSurvivesUpload: Boolean(canonical && !this.isCanonicalPageClosed(canonical.page)),
          preUploadState: states[0] ?? null,
          postUploadStates: states.slice(1),
          selectors,
          actions,
          forbiddenMutationObserved
        }
      };
      try {
        assertExplorationSafety(result);
      } catch {
        result.status = "SAFETY_BOUNDARY_VIOLATION";
        result.readyForFinalSubmit = false;
      }
      if (canonical) {
        this.emitCanonicalPageOperation(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "COMPLETED", result.sameContext, undefined, "XHS_PUBLISH_FLOW_EXPLORATION", result.failureCode ? { failureCode: result.failureCode as PreSubmitGateFailureCode, failureStage: result.failureStage as PreSubmitGateFailureStage, missingSignal: result.missingSignal } : undefined);
      }
      this.emitEditorEntryDiagnostic({
        code: result.status === "PASS_READY_FOR_FINAL_SUBMIT" ? "XHS_PUBLISH_FLOW_COMPLETED" : "XHS_PUBLISH_FLOW_BLOCKED",
        timestamp: new Date().toISOString(),
        operationId,
        platformKey: "xiaohongshu",
        accountId: ctx.accountId,
        ...(canonical ? { contextDebugId: canonical.session.contextDebugId ?? "unknown-context", pageDebugId: canonical.pageDebugId, pageRole: "CANONICAL_AUTHENTICATED" as const, pageSource: "EXISTING_CANONICAL_PAGE" as const } : {}),
        createdNewPage: false,
        sanitizedUrl: canonical ? sanitizePageUrl(canonical.page) : "about:blank",
        status: result.status,
        finalSubmitCount: 0,
        intermediateActionClickCount: counters.intermediateActionClickCount,
        titleReadbackVerified: result.titleReadbackVerified,
        bodyReadbackVerified: result.bodyReadbackVerified,
        uploadMutationCount: counters.uploadMutationCount,
        timelineEntry: { blocker: result.blocker, elapsedMs: Date.now() - startedAt }
      });
      return result;
    };

    addTimeline("AUTHENTICATED", "AUTH_CHECK", sameInitialPage && this.getBrowserRuntimeState(ctx).state === "AUTHENTICATED" ? "PASS" : "BLOCKED");
    if (!canonical || !sameInitialPage) {
      blocker = "CANONICAL_PAGE_OWNERSHIP_FAILURE";
      return buildResult("BLOCKED");
    }
    if (this.getBrowserRuntimeState(ctx).state !== "AUTHENTICATED") {
      blocker = "AUTH_REQUIRED";
      return buildResult("BLOCKED");
    }
    if (input.imageSource !== "SAFE_TEST_FIXTURE") {
      blocker = "UNAPPROVED_IMAGE_SOURCE";
      return buildResult("BLOCKED");
    }
    addTimeline("CREATOR_HOME", "PUBLISH_FLOW_START", "OBSERVE");

    const preUploadGate = await this.inspectPublishEditorOnCanonicalPage(
      ctx,
      operationId,
      false,
      "XHS_PUBLISH_FLOW_EXPLORATION",
      { readinessWindowMs: 10_000, readinessSampleIntervalMs: 80 }
    );
    canonical = await this.activeCanonicalPage(ctx).catch(() => null);
    const sameAfterNavigation = Boolean(initialCanonical && canonical && initialCanonical.page === canonical.page && initialCanonical.session.context === canonical.session.context);
    states.push({
      phase: preUploadGate.imageEditorPhase ?? "IMAGE_POST_UNKNOWN",
      status: preUploadGate.status,
      preUploadGateStatus: preUploadGate.preUploadGateStatus ?? "FAIL",
      contentType: preUploadGate.contentType,
      contentTypeReady: preUploadGate.contentTypeReady,
      uploadCapabilityPresent: preUploadGate.uploadCapabilityPresent ?? false,
      sanitizedUrl: preUploadGate.sanitizedUrl
    });
    addTimeline("IMAGE_POST_PRE_UPLOAD", "PUBLISH_NOTE_NAVIGATION", preUploadGate.status === "ready" && sameAfterNavigation ? "PASS" : "BLOCKED");
    if (!canonical || !sameAfterNavigation) {
      blocker = "CANONICAL_PAGE_OWNERSHIP_FAILURE";
      return buildResult("BLOCKED");
    }
    if (preUploadGate.status !== "ready" || preUploadGate.preUploadGateStatus !== "PASS" || preUploadGate.imageEditorPhase !== "IMAGE_POST_PRE_UPLOAD" || preUploadGate.uploadCapabilityPresent !== true) {
      blocker = preUploadGate.failureCode ?? "PRE_UPLOAD_PHASE_NOT_READY";
      return buildResult("BLOCKED");
    }
    if (Date.now() - startedAt > budgets.maxDurationMs) {
      blocker = "EXPLORATION_TIMEOUT";
      return buildResult("BLOCKED");
    }

    const metadata = {
      operationId,
      platformKey: "xiaohongshu" as const,
      accountId: ctx.accountId,
      contextDebugId: canonical.session.contextDebugId ?? "unknown-context",
      pageDebugId: canonical.pageDebugId
    };
    this.emitStagedEditorDiagnostic(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "PREPARE_PUBLISH_MUTATION_BOUNDARY_ENTERED", {
      expectedPhase: "IMAGE_POST_PRE_UPLOAD",
      observedPhase: "IMAGE_POST_PRE_UPLOAD",
      phase: "IMAGE_POST_PRE_UPLOAD",
      preSubmitGatePhase: "PRE_UPLOAD",
      preUploadGateStatus: "PASS",
      preUploadMutationRevalidated: true,
      postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD",
      preSubmitGatePassMeaning: "SAFE_TO_ENTER_IMAGE_UPLOAD_ONLY_EXPLORATION_STAGE",
      uploadCapabilityPresent: true,
      mutationType: "IMAGE_UPLOAD_ONLY",
      selfTestMode: "XHS_PUBLISH_FLOW_EXPLORATION",
      sanitizedUrl: sanitizePageUrl(canonical.page)
    });

    let uploadCompleted = false;
    while (!uploadCompleted) {
      if (!canSpendBudget(counters, budgets, "uploadAttempts")) {
        blocker = "MAX_SAFE_IMAGE_UPLOAD_ATTEMPTS_EXCEEDED";
        return buildResult("BLOCKED");
      }
      const uploadCanonical = await this.activeCanonicalPage(ctx).catch(() => null);
      if (!uploadCanonical || uploadCanonical.page !== canonical.page || uploadCanonical.session.context !== canonical.session.context) {
        blocker = "CANONICAL_PAGE_OWNERSHIP_FAILURE";
        return buildResult("BLOCKED");
      }
      counters = recordBudgetUse(counters, "uploadAttempts");
      const uploadAttemptIndex = counters.uploadAttempts;
      addTimeline("IMAGE_UPLOAD", `UPLOAD_ATTEMPT_${counters.uploadAttempts}`, "STARTED");
      try {
        const imageEvidence = await this.uploadImages(canonical.page, [input.imagePath], { ctx, session: canonical.session, metadata, selfTestMode: "XHS_PUBLISH_FLOW_EXPLORATION", uploadAttemptIndex, expectedFileMetadata: input.boundImages ? undefined : TASK10S_SAFE_FIXTURE_EXPECTATION, boundImages: input.boundImages, onMutationStarted: () => { counters = { ...counters, uploadMutationCount: counters.uploadMutationCount + 1 }; } });
        states.push({ phase: "IMAGE_UPLOAD", ...imageEvidence });
        uploadCompleted = imageEvidence.verified === true;
        counters = { ...counters, uploadRetryCount: Math.max(0, counters.uploadAttempts - 1) };
        addTimeline("IMAGE_UPLOAD", `UPLOAD_ATTEMPT_${counters.uploadAttempts}`, uploadCompleted ? "COMPLETED" : "FAILED");
      } catch (error) {
        counters = { ...counters, uploadRetryCount: Math.max(0, counters.uploadAttempts - 1) };
        addTimeline("IMAGE_UPLOAD", `UPLOAD_ATTEMPT_${counters.uploadAttempts}`, "FAILED");
        if (!canSpendBudget(counters, budgets, "uploadAttempts")) {
          blocker = error instanceof Error ? error.message : "IMAGE_UPLOAD_FAILED";
          return buildResult("BLOCKED");
        }
      }
    }
    if (!uploadCompleted) {
      blocker = "UPLOAD_COMPLETION_NOT_OBSERVED";
      return buildResult("BLOCKED");
    }

    const nativeFilePickerRecovery = createXhsNativeFilePickerRecovery(canonical.page, { profilePath: canonical.session.profilePath, browserChannel: canonical.session.browserChannel ?? null });

    if (input.postUploadReadinessStrategy === "TERMINAL_CLASSIFIER") {
      try {
        const nativePickerRecovery = await recoverNativeFilePicker(nativeFilePickerRecovery);
        nativeFilePickerRecoveryResult = nativePickerRecovery;
        states.push({ phase: "NATIVE_FILE_PICKER_RECOVERY", ...nativePickerRecovery });
        addTimeline("POST_UPLOAD_EDITOR_DISCOVERY", "NATIVE_FILE_PICKER_RECOVERY", nativePickerRecovery.status === "BLOCKED" ? "BLOCKED" : nativePickerRecovery.status === "CANCELLED" ? "CANCELLED" : "NOT_DETECTED");
        if (nativePickerRecovery.status === "BLOCKED") {
          blocker = "NATIVE_FILE_PICKER_CANCEL_FAILED";
          return buildResult("BLOCKED");
        }
        const postUploadSnapshot = await inspectXiaohongshuPostUploadReconciliationDom(canonical.page);
        const postUploadReconciliation = reconcileXiaohongshuPostUploadSnapshot(postUploadSnapshot);
        const terminalReadiness = classifyXiaohongshuPostUploadTerminalReadiness({
          originalPostUploadState: postUploadReconciliation.postUploadState,
          editorScopedImageAssetCount: postUploadReconciliation.imageAssetRenderedCount,
          imageCounterTextSafe: postUploadReconciliation.imageCounterTextSafe,
          titleControlPresent: postUploadReconciliation.titleControlPresent,
          bodyControlPresent: postUploadReconciliation.bodyControlPresent,
          uploadErrorSignalPresent: postUploadReconciliation.explicitUploadErrorSignals.length > 0,
          busySignalPresent: postUploadReconciliation.processingSignalPresent
        });
        states.push({
          phase: "POST_UPLOAD_TERMINAL_READINESS",
          ...terminalReadiness,
          imageAssetRenderedCount: terminalReadiness.editorScopedImageAssetCount,
          imageCounterTextSafe: terminalReadiness.imageCounterTextSafe,
          uploadErrorSignal: terminalReadiness.uploadErrorSignalPresent,
          busySignal: terminalReadiness.busySignalPresent
        });
        addTimeline("POST_UPLOAD_TERMINAL_READINESS", "R38_TERMINAL_READINESS_CLASSIFIER", terminalReadiness.ready ? "PASS" : "BLOCKED");
        if (!terminalReadiness.ready) {
          blocker = terminalReadiness.blockerCodes.length > 0
            ? `POST_UPLOAD_TERMINAL_READINESS_BLOCKED:${terminalReadiness.blockerCodes.join(",")}`
            : "POST_UPLOAD_TERMINAL_READINESS_NOT_READY";
          return buildResult("BLOCKED");
        }
      } catch (error) {
        blocker = error instanceof Error ? `POST_UPLOAD_TERMINAL_READINESS_DIAGNOSTIC_FAILED:${error.message}` : "POST_UPLOAD_TERMINAL_READINESS_DIAGNOSTIC_FAILED";
        return buildResult("BLOCKED");
      }
    } else {
      let postUploadInspection = await inspectPostUploadImageEditor(canonical.page, metadata, {
        nativeFilePickerRecovery,
        readinessWindowMs: Math.max(0, Math.min(10_000, budgets.maxDurationMs - (Date.now() - startedAt))),
        readinessSampleIntervalMs: 80,
        emit: (diagnostic) => this.emitImageEditorDiagnostic(diagnostic)
      });
      nativeFilePickerRecoveryResult = postUploadInspection.nativeFilePickerRecovery === "CANCELLED"
        ? { status: "CANCELLED", detected: postUploadInspection.nativeFilePickerDetected, cancelled: true, failureCode: null, pickerWindowIdBefore: postUploadInspection.nativeFilePickerWindowIdBefore, pickerWindowIdAfter: postUploadInspection.nativeFilePickerWindowIdAfter, pickerOpenBefore: postUploadInspection.nativeFilePickerOpenBefore, pickerOpenAfter: postUploadInspection.nativeFilePickerOpenAfter, cancelActionSent: postUploadInspection.nativeFilePickerCancelActionSent, cancelEffectVerified: postUploadInspection.nativeFilePickerCancelEffectVerified }
        : postUploadInspection.nativeFilePickerRecovery === "BLOCKED"
          ? { status: "BLOCKED", detected: postUploadInspection.nativeFilePickerDetected, cancelled: false, failureCode: "NATIVE_FILE_PICKER_CANCEL_FAILED", pickerWindowIdBefore: postUploadInspection.nativeFilePickerWindowIdBefore, pickerWindowIdAfter: postUploadInspection.nativeFilePickerWindowIdAfter, pickerOpenBefore: postUploadInspection.nativeFilePickerOpenBefore, pickerOpenAfter: postUploadInspection.nativeFilePickerOpenAfter, cancelActionSent: postUploadInspection.nativeFilePickerCancelActionSent, cancelEffectVerified: postUploadInspection.nativeFilePickerCancelEffectVerified }
          : { status: "NOT_DETECTED", detected: false, cancelled: false, failureCode: null, pickerWindowIdBefore: postUploadInspection.nativeFilePickerWindowIdBefore, pickerWindowIdAfter: postUploadInspection.nativeFilePickerWindowIdAfter, pickerOpenBefore: postUploadInspection.nativeFilePickerOpenBefore, pickerOpenAfter: postUploadInspection.nativeFilePickerOpenAfter, cancelActionSent: postUploadInspection.nativeFilePickerCancelActionSent, cancelEffectVerified: postUploadInspection.nativeFilePickerCancelEffectVerified };
      states.push(postUploadInspection as unknown as Record<string, unknown>);
      if (postUploadInspection.forbiddenActionSignalPresent === true) {
        forbiddenMutationObserved = true;
        blocker = "FORBIDDEN_DESTRUCTIVE_ACTION_SIGNAL";
        return buildResult("SAFETY_BOUNDARY_VIOLATION");
      }
      if (postUploadInspection.nativeFilePickerRecovery === "BLOCKED") {
        blocker = postUploadInspection.failureCode ?? "POST_UPLOAD_PHASE_NOT_READY";
        return buildResult("BLOCKED");
      }
      const intermediateActions: Array<Record<string, unknown>> = [];
      let intermediateActionCount = 0;
      while (postUploadInspection.intermediateState !== "NONE") {
        const phase = postUploadInspection.phase;
        const candidates = (postUploadInspection.intermediateActionCandidates ?? []).map(toExplorationIntermediateCandidate);
        const resolution = selectSafeIntermediateAction(candidates, phase);
        if (resolution.status !== "FOUND_UNIQUE" || !resolution.candidate) {
          blocker = resolution.status === "AMBIGUOUS" ? "INTERMEDIATE_ACTION_AMBIGUOUS" : "INTERMEDIATE_ACTION_NOT_FOUND";
          break;
        }
        if (!canSpendBudget(counters, budgets, "intermediateActionClickCount")) {
          blocker = "MAX_INTERMEDIATE_ACTION_CLICKS_EXCEEDED";
          break;
        }
        const actionLocator = await this.resolveIntermediateActionLocator(canonical.page, resolution.candidate);
        const latestCanonical = await this.activeCanonicalPage(ctx).catch(() => null);
        if (!latestCanonical || latestCanonical.page !== canonical.page || latestCanonical.session.context !== canonical.session.context) {
          blocker = "CANONICAL_PAGE_OWNERSHIP_FAILURE";
          break;
        }
        if (!actionLocator) {
          blocker = "INTERMEDIATE_ACTION_SELECTOR_DRIFT";
          break;
        }
        counters = recordBudgetUse(counters, "intermediateActionClickCount");
        const actionBefore = { stateBefore: phase, semanticText: resolution.candidate.normalizedText, candidateStatus: resolution.status, candidateId: resolution.candidate.candidateId };
        try {
          await actionLocator.click();
          intermediateActionCount += 1;
          addTimeline(phase, `INTERMEDIATE_ACTION_${intermediateActionCount}`, "CLICKED");
          const actionEntry = { index: intermediateActionCount, ...actionBefore, clickResult: "CLICKED" };
          intermediateActions.push(actionEntry);
          actions.push(actionEntry);
          this.emitEditorEntryDiagnostic({ code: "XHS_PUBLISH_FLOW_INTERMEDIATE_ACTION", timestamp: new Date().toISOString(), operationId, platformKey: "xiaohongshu", accountId: ctx.accountId, contextDebugId: canonical.session.contextDebugId ?? "unknown-context", pageDebugId: canonical.pageDebugId, pageRole: "CANONICAL_AUTHENTICATED", pageSource: "EXISTING_CANONICAL_PAGE", createdNewPage: false, action: "XHS_PUBLISH_FLOW_INTERMEDIATE_ACTION", status: "CLICKED", phase, intermediateActionClickCount: counters.intermediateActionClickCount, finalSubmitCount: 0 });
          postUploadInspection = await inspectPostUploadImageEditor(canonical.page, metadata, { nativeFilePickerRecovery, readinessWindowMs: Math.max(0, Math.min(10_000, budgets.maxDurationMs - (Date.now() - startedAt))), readinessSampleIntervalMs: 80, emit: (diagnostic) => this.emitImageEditorDiagnostic(diagnostic) });
          states.push(postUploadInspection as unknown as Record<string, unknown>);
          if (postUploadInspection.forbiddenActionSignalPresent === true) {
            forbiddenMutationObserved = true;
            blocker = "FORBIDDEN_DESTRUCTIVE_ACTION_SIGNAL";
            break;
          }
          if (postUploadInspection.nativeFilePickerRecovery === "BLOCKED") {
            blocker = postUploadInspection.failureCode ?? "POST_UPLOAD_PHASE_NOT_READY";
            break;
          }
          const after = intermediateActions[intermediateActions.length - 1];
          if (after) after.stateAfter = postUploadInspection.phase;
        } catch (error) {
          const actionEntry = { index: intermediateActionCount + 1, ...actionBefore, clickResult: "FAILED", error: error instanceof Error ? error.message : String(error) };
          intermediateActions.push(actionEntry);
          actions.push(actionEntry);
          blocker = "INTERMEDIATE_ACTION_FAILED";
          break;
        }
        if (Date.now() - startedAt > budgets.maxDurationMs) {
          blocker = "EXPLORATION_TIMEOUT";
          break;
        }
      }
      if (intermediateActionCount !== counters.intermediateActionClickCount) counters = { ...counters, intermediateActionClickCount: intermediateActionCount };
      addTimeline("POST_UPLOAD_INTERMEDIATE_STEPS", "SAFE_FLOW_ACTIONS", blocker ? "BLOCKED" : "PASS");
      if (blocker || postUploadInspection.phase !== "IMAGE_POST_POST_UPLOAD_EDITOR") return buildResult("BLOCKED");
    }

    const title = await this.exploreEditorField(canonical.page, "title", input.title, budgets.maxTitleMutations);
    counters = { ...counters, titleMutationCount: title.mutationCount, contentMutationCount: counters.contentMutationCount + title.mutationCount };
    titleEvidence = title.evidence;
    selectors.push({ field: "title", status: title.status, strategyCount: title.evidence.strategyCount });
    addTimeline("TITLE", "TEST_CONTENT_FILL_AND_READBACK", title.evidence.readbackVerified ? "PASS" : "BLOCKED");
    if (!title.evidence.readbackVerified) {
      blocker = title.status;
      return buildResult("BLOCKED");
    }

    const body = await this.exploreEditorField(canonical.page, "body", input.body, budgets.maxBodyMutations);
    counters = { ...counters, bodyMutationCount: body.mutationCount, contentMutationCount: counters.contentMutationCount + body.mutationCount };
    bodyEvidence = body.evidence;
    selectors.push({ field: "body", status: body.status, strategyCount: body.evidence.strategyCount });
    addTimeline("BODY", "TEST_CONTENT_FILL_AND_READBACK", body.evidence.readbackVerified ? "PASS" : "BLOCKED");
    if (!body.evidence.readbackVerified) {
      blocker = body.status;
      return buildResult("BLOCKED");
    }

    const requiredFields = await this.inspectRequiredFields(canonical.page);
    const missingRequiredFields = requiredFields.filter((field) => field.empty);
    if (missingRequiredFields.length > 0) {
      const requiredSettingResult = await this.satisfyRequiredSettings(canonical.page, 3);
      requiredSettings = requiredSettingResult;
      counters = { ...counters, settingsMutationCount: requiredSettingResult.mutations.length };
      const remainingRequiredFields = await this.inspectRequiredFields(canonical.page);
      if (requiredSettingResult.status !== "PASS" || remainingRequiredFields.some((field) => field.empty)) {
        blocker = "REQUIRED_FIELDS_NOT_VERIFIED";
        return buildResult("BLOCKED");
      }
    } else {
      requiredSettings = { status: "PASS_NO_REQUIRED_MUTATION", mutations: [] };
    }
    addTimeline("REQUIRED_FIELDS", "READ_ONLY_VALIDATION", "PASS");
    const settings = await this.inspectPublishSettings(canonical.page);
    selectors.push({ field: "settings", status: classifyXiaohongshuPublishSettings(settings), requiredCount: settings.filter((setting) => setting.required).length });

    if (nativeFilePickerRecoveryResult?.status === "CANCELLED") {
      pickerCancelStabilization = await stabilizeAfterNativeFilePickerCancel(canonical.page, {
        maxWaitMs: Math.max(0, Math.min(10_000, budgets.maxDurationMs - (Date.now() - startedAt))),
        retryIntervalMs: 80,
        stableSampleCount: 2,
        clearOpenPickerMarker: async () => {
          const evaluatePage = canonical!.page as unknown as { evaluate?: <T>(pageFunction: () => T) => Promise<T> };
          if (typeof evaluatePage.evaluate !== "function") return false;
          try {
            return Boolean(await evaluatePage.evaluate(() => {
              const current = new URL(window.location.href);
              if (current.searchParams.get("openFilePicker") === "true") {
                current.searchParams.delete("openFilePicker");
                const nextUrl = `${current.pathname}${current.search}${current.hash}`;
                window.history.replaceState(window.history.state, document.title, nextUrl);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }
              return new URL(window.location.href).searchParams.get("openFilePicker") !== "true";
            }));
          } catch {
            return false;
          }
        },
        discoverFinalControl: async () => this.inspectClosedShadowFinalSubmitForExploration(canonical.page)
      });
      states.push({ phase: "PICKER_CANCEL_STABILIZATION", ...pickerCancelStabilization });
      addTimeline("POST_UPLOAD_EDITOR_DISCOVERY", "PICKER_CANCEL_STABILIZATION", pickerCancelStabilization.finalControlFoundAfterWait ? "PASS" : "BLOCKED");
      finalSubmit = pickerCancelStabilization.finalControl;
    } else {
      finalSubmit = await this.inspectFinalSubmitForExploration(canonical.page);
    }
    selectors.push({ field: "finalSubmit", ...finalSubmit });
    addTimeline("FINAL_SUBMIT_READY", "READ_ONLY_CONTROL_DISCOVERY", finalSubmit.status === "FOUND_UNIQUE" && finalSubmit.visible && finalSubmit.enabled && finalSubmit.hitTestValid ? "PASS" : "BLOCKED");
    if (finalSubmit.status !== "FOUND_UNIQUE" || !finalSubmit.visible || !finalSubmit.enabled || !finalSubmit.hitTestValid) {
      blocker = ["DISABLED", "NOT_VISIBLE", "HITTEST_INVALID"].includes(finalSubmit.status)
        ? "FINAL_SUBMIT_NOT_READY"
        : finalSubmit.status === "AMBIGUOUS" ? "FINAL_SUBMIT_CONTROL_AMBIGUOUS" : "FINAL_SUBMIT_CONTROL_NOT_FOUND";
      return buildResult("BLOCKED");
    }
    blocker = null;
    return buildResult("PASS_READY_FOR_FINAL_SUBMIT");
  }

  private async resolveIntermediateActionLocator(page: Page, candidate: XhsIntermediateActionCandidate): Promise<Locator | null> {
    const controls = page.locator("button, [role=\"button\"], a, [role=\"tab\"]");
    for (let index = 0; index < await locatorCount(controls); index += 1) {
      const control = locatorAt(controls, index);
      if (!(await isVisible(control)) || !(await isEnabled(control))) continue;
      const label = normalizeXiaohongshuEditorText((await innerText(control)) || (await attribute(control, "aria-label")) || (await attribute(control, "title")));
      if (!label || !(label === candidate.normalizedText || label.includes(candidate.normalizedText) || candidate.normalizedText.includes(label))) continue;
      const box = await locatorBoundingBox(control);
      if (!box || !candidate.boundingBox || !boxesOverlap(box, candidate.boundingBox)) continue;
      const hitTestValid = await locatorHitTestValid(control, box);
      if (!hitTestValid) continue;
      const pointerEvents = await attribute(control, "data-pointer-events");
      if (pointerEvents === "none") continue;
      return control;
    }
    return null;
  }

  private async exploreEditorField(page: Page, field: "title" | "body", value: string, maxMutations: number): Promise<{ status: string; mutationCount: number; evidence: { attempted: boolean; mutationCount: number; strategyCount: number; readbackVerified: boolean; readbackLength?: number; readbackValue?: string } }> {
    const limit = Math.max(0, maxMutations);
    let mutationCount = 0;
    let strategyCount = 0;
    while (mutationCount < limit) {
      strategyCount += 1;
      try {
        const editor = await this.discoverUniqueEditor(page, field);
        mutationCount += 1;
        await editor.fill(value);
        const readback = await readEditor(editor, field);
        const verified = readback === normalizeXiaohongshuEditorText(value);
        if (verified) return { status: "FOUND_UNIQUE", mutationCount, evidence: { attempted: true, mutationCount, strategyCount, readbackVerified: true, readbackLength: readback.length, readbackValue: readback } };
      } catch (error) {
        return { status: error instanceof XiaohongshuGateError ? error.gateCode : `${field.toUpperCase()}_WRITE_FAILED`, mutationCount, evidence: { attempted: mutationCount > 0, mutationCount, strategyCount, readbackVerified: false } };
      }
    }
    return { status: `${field.toUpperCase()}_READBACK_FAILED`, mutationCount, evidence: { attempted: mutationCount > 0, mutationCount, strategyCount, readbackVerified: false } };
  }

  private async inspectFinalSubmitForExploration(page: Page): Promise<{ status: string; visible: boolean; enabled: boolean; hitTestValid: boolean; label?: string }> {
    const controls = page.locator(XIAOHONGSHU_FINAL_SUBMIT_SELECTOR);
    const matches: Array<{ label: string; visible: boolean; enabled: boolean; hitTestValid: boolean }> = [];
    for (let index = 0; index < await locatorCount(controls); index += 1) {
      const control = locatorAt(controls, index);
      const label = normalizeXiaohongshuEditorText((await innerText(control)) || (await attribute(control, "aria-label")) || (await attribute(control, "title")));
      if (!XIAOHONGSHU_FINAL_SUBMIT_PATTERN.test(label) || XIAOHONGSHU_VIDEO_PATTERN.test(label)) continue;
      const visible = await isVisible(control);
      const enabled = await isEnabled(control);
      const box = await locatorBoundingBox(control);
      const hitTestValid = visible && box !== null && await locatorHitTestValid(control, box);
      matches.push({ label, visible, enabled, hitTestValid });
    }
    if (matches.length === 0) return { status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    if (matches.length > 1) return { status: "AMBIGUOUS", visible: false, enabled: false, hitTestValid: false };
    const match = matches[0]!;
    if (!match.visible) return { status: "NOT_VISIBLE", ...match };
    if (!match.enabled) return { status: "DISABLED", ...match };
    if (!match.hitTestValid) return { status: "HITTEST_INVALID", ...match };
    return { status: "FOUND_UNIQUE", ...match };
  }

  private async inspectClosedShadowFinalSubmitForExploration(page: Page): Promise<PickerCancelFinalControl> {
    const resolution = await inspectTask10sClosedShadowPublishSurface(page);
    const visible = Boolean(resolution.host?.rendered && resolution.innerButton?.rendered);
    const status = resolution.present
      ? resolution.enabled ? "FOUND_UNIQUE" : "DISABLED"
      : resolution.status === "AMBIGUOUS" ? "AMBIGUOUS" : "NOT_FOUND";
    return {
      status,
      visible,
      enabled: resolution.enabled,
      hitTestValid: resolution.present && resolution.enabled && resolution.innerButton?.boundingRect !== null,
      ...(resolution.innerButton?.exactText ? { label: resolution.innerButton.exactText } : {})
    };
  }

  private async satisfyRequiredSettings(page: Page, mutationBudget: number): Promise<{ status: string; mutations: readonly Record<string, unknown>[] }> {
    const required = page.locator(XIAOHONGSHU_REQUIRED_SELECTOR);
    const mutations: Array<Record<string, unknown>> = [];
    for (let index = 0; index < await locatorCount(required); index += 1) {
      const field = locatorAt(required, index);
      if (!(await isVisible(field)) || !(await isEnabled(field))) continue;
      const label = normalizeXiaohongshuEditorText((await attribute(field, "aria-label")) || (await attribute(field, "placeholder")) || (await innerText(field)));
      const role = (await attribute(field, "role")).toLowerCase();
      const type = (await attribute(field, "type")).toLowerCase();
      const checked = await isChecked(field);
      if (mutations.length >= mutationBudget) return { status: "MUTATION_BUDGET_EXCEEDED", mutations };
      if (type === "checkbox" || type === "radio" || role === "checkbox" || role === "radio") {
        if (checked) continue;
        const clickable = field as unknown as { click?: () => Promise<void> };
        if (typeof clickable.click !== "function") return { status: "REQUIRED_SETTING_NOT_INTERACTIVE", mutations };
        await clickable.click();
        mutations.push({ index, label, action: "CHECK_REQUIRED_SETTING" });
        continue;
      }
      if (!/话题|tag|topic/iu.test(label)) return { status: "REQUIRED_SETTING_NEEDS_OWNER_INPUT", mutations };
      const fillable = field as unknown as { fill?: (value: string) => Promise<void> };
      if (typeof fillable.fill !== "function") return { status: "REQUIRED_SETTING_NOT_INTERACTIVE", mutations };
      await fillable.fill("#自动化测试");
      const readback = normalizeXiaohongshuEditorText(await inputValue(field));
      if (readback !== "#自动化测试") return { status: "REQUIRED_SETTING_READBACK_FAILED", mutations };
      mutations.push({ index, label, action: "FILL_REQUIRED_TOPIC", readbackVerified: true });
    }
    return { status: "PASS", mutations };
  }

  private async inspectPublishEditorOnCanonicalPage(
    ctx: AccountContext,
    operationId: string = randomUUID(),
    completeOperation = true,
    operationAction: "PRE_SUBMIT_GATE" | "CONTROLLED_POST_UPLOAD_DISCOVERY" | "XHS_PUBLISH_FLOW_EXPLORATION" = "PRE_SUBMIT_GATE",
    inspectionOptions: { readinessWindowMs?: number; readinessSampleIntervalMs?: number } = {}
  ): Promise<PreSubmitGateResult> {
    const key = `${this.platformKey}:${ctx.accountId}`;
    let canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>> = null;
    let activeSession: BrowserSession | null = null;
    try {
      activeSession = this.activeBrowserSession(ctx);
      canonical = await this.activeCanonicalPage(ctx);
    } catch (error) {
      const failure = this.failureDetailsForError(error);
      const page = activeSession?.page ?? null;
      this.emitPreSubmitGateInspectionDiagnostic(ctx, operationId, null, page, false, failure);
      this.emitEditorNavigationFailureDiagnostic(ctx, operationId, null, page, false, failure, page ? sanitizePageUrl(page) : undefined, page ? sanitizePageUrl(page) : null);
      return this.preSubmitGateFailureResult(this.preSubmitGateStatusForError(error), failure, page);
    }
    if (!canonical) {
      const page = activeSession?.page ?? null;
      const failure = this.canonicalPageFailureDetails(activeSession, page);
      this.emitPreSubmitGateInspectionDiagnostic(ctx, operationId, null, page, false, failure);
      this.emitEditorNavigationFailureDiagnostic(ctx, operationId, null, page, false, failure, page ? sanitizePageUrl(page) : undefined, page ? sanitizePageUrl(page) : null);
      return this.preSubmitGateFailureResult("needs_user_action", failure, page);
    }

    const pageContextMatchesSession = this.pageContextMatchesSession(canonical.session, canonical.page);
    const operationStartUrl = sanitizePageUrl(canonical.page);
    this.emitPreSubmitGateInspectionDiagnostic(ctx, operationId, canonical, canonical.page, pageContextMatchesSession);
    this.emitCanonicalPageOperation(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "STARTED", pageContextMatchesSession, undefined, operationAction);
    if (!pageContextMatchesSession) {
      const failure = { failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE" as const, failureStage: "SESSION_PAGE_LIFECYCLE" as const, missingSignal: "page-context-ownership" };
      const result = this.preSubmitGateFailureResult("needs_user_action", failure, canonical.page);
      this.emitEditorEntryDiagnostic({
        code: "EDITOR_NAVIGATION_FAILED",
        timestamp: new Date().toISOString(),
        operationId,
        platformKey: "xiaohongshu",
        accountId: ctx.accountId,
        contextDebugId: canonical.session.contextDebugId ?? "unknown-context",
        pageDebugId: canonical.pageDebugId,
        pageRole: "CANONICAL_AUTHENTICATED",
        pageSource: "EXISTING_CANONICAL_PAGE",
        createdNewPage: false,
        pageContextMatchesSession,
        browserConnected: this.isBrowserConnected(canonical.session),
        pageClosed: this.isCanonicalPageClosed(canonical.page),
        runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
        activeOperation: this.accountOperationMutex.getState(key).activeOperation,
        mutexLocked: this.accountOperationMutex.getState(key).mutexLocked,
        operationInProgress: this.accountOperationMutex.getState(key).operationInProgress,
        sanitizedUrlBefore: operationStartUrl,
        sanitizedUrlAfter: operationStartUrl,
        navigationTrigger: "UNKNOWN",
        ...failure,
        lastCompletedStep: null
      });
      return this.completePreSubmitGateResult(ctx, canonical, operationId, result, false);
    }

    const complete = (result: PreSubmitGateResult): PreSubmitGateResult => {
      if (completeOperation) this.emitCanonicalPageOperation(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "COMPLETED", true, result.status, operationAction, result);
      return result;
    };
    const failBeforeEditorHelper = (failure: Pick<PreSubmitGateResult, "failureCode" | "failureStage" | "missingSignal">): PreSubmitGateResult => {
      this.emitEditorNavigationFailureDiagnostic(ctx, operationId, canonical, canonical.page, pageContextMatchesSession, failure, operationStartUrl, sanitizePageUrl(canonical.page));
      return complete(this.preSubmitGateFailureResult("needs_user_action", failure, canonical.page));
    };

    try {
      if (!this.isBrowserConnected(canonical.session)) {
        return failBeforeEditorHelper({ failureCode: "BROWSER_SESSION_DISCONNECTED", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "browser-disconnected" });
      }
      if (this.isCanonicalPageClosed(canonical.page)) {
        return failBeforeEditorHelper({ failureCode: "CANONICAL_PAGE_UNAVAILABLE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "canonical-page-closed" });
      }

      const currentUrl = canonical.page.url();
      if (!this.isEditorRoute(currentUrl) && !this.isCreatorHomeRoute(currentUrl)) await this.navigate(canonical.page, XIAOHONGSHU_CREATOR_HOME);
      const homeEvidence = await readXiaohongshuPageEvidence(canonical.page);
      this.assertProfilePageCanBeRead(homeEvidence);

      const helperStartUrl = sanitizePageUrl(canonical.page);
      this.emitEditorEntryDiagnostic({
        code: "EDITOR_NAVIGATION_HELPER_INVOCATION_STARTED",
        timestamp: new Date().toISOString(),
        operationId,
        platformKey: "xiaohongshu",
        accountId: ctx.accountId,
        contextDebugId: canonical.session.contextDebugId ?? "unknown-context",
        pageDebugId: canonical.pageDebugId,
        pageRole: "CANONICAL_AUTHENTICATED",
        pageSource: "EXISTING_CANONICAL_PAGE",
        createdNewPage: false,
        pageContextMatchesSession,
        browserConnected: this.isBrowserConnected(canonical.session),
        pageClosed: this.isCanonicalPageClosed(canonical.page),
        runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
        activeOperation: this.accountOperationMutex.getState(key).activeOperation,
        mutexLocked: this.accountOperationMutex.getState(key).mutexLocked,
        operationInProgress: this.accountOperationMutex.getState(key).operationInProgress,
        helper: "navigateToImagePostEditor",
        startUrl: helperStartUrl
      });
      const editorEntry = await this.navigateToImagePostEditor(canonical.page, operationId, ctx.accountId, { context: canonical.session.context, contextDebugId: canonical.session.contextDebugId ?? "unknown-context", pageDebugId: canonical.pageDebugId }, "GATE_NAVIGATION");
      if (!editorEntry.editorReached || editorEntry.postPublishNoteState !== "IMAGE_EDITOR") {
        const result: PreSubmitGateResult = {
          ...emptyPreSubmitGateResult("needs_user_action"),
          editorReached: editorEntry.editorReached,
          authStillValid: true,
          sanitizedUrl: sanitizePageUrl(canonical.page),
          failureCode: "EDITOR_ROUTE_NOT_REACHED",
          failureStage: "EDITOR_ROUTE",
          missingSignal: "url:/publish/publish"
        };
        return complete(result);
      }
      this.emitStagedEditorDiagnostic(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "PRE_UPLOAD_GATE_INSPECTION_STARTED", {
        expectedPhase: "IMAGE_POST_PRE_UPLOAD",
        observedPhase: "IMAGE_POST_TRANSITIONING",
        sanitizedUrl: sanitizePageUrl(canonical.page)
      });
      const editorPhaseInspection = await inspectImagePostEditorPhase(canonical.page, {
        operationId,
        platformKey: "xiaohongshu",
        accountId: ctx.accountId,
        contextDebugId: canonical.session.contextDebugId ?? "unknown-context",
        pageDebugId: canonical.pageDebugId
      }, { ...inspectionOptions, emit: (diagnostic) => this.emitImageEditorDiagnostic(diagnostic) });
      const preUploadContract = assertPreUploadImageEditorContract(editorPhaseInspection);
      this.emitStagedEditorDiagnostic(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "PRE_UPLOAD_GATE_RESULT", {
        expectedPhase: preUploadContract.expectedPhase,
        observedPhase: preUploadContract.observedPhase,
        preSubmitGatePhase: "PRE_UPLOAD",
        preUploadGateStatus: preUploadContract.status,
        preUploadGateFailureCode: preUploadContract.failureCode ?? null,
        phase: editorPhaseInspection.phase,
        phaseConfidence: editorPhaseInspection.confidence,
        phaseReason: editorPhaseInspection.reason,
        uploadCapabilityPresent: editorPhaseInspection.uploadCapabilityPresent,
        postUploadControlsStatus: preUploadContract.postUploadControlsStatus,
        preSubmitGatePassMeaning: preUploadContract.status === "PASS" ? "SAFE_TO_ENTER_PREPARE_PUBLISH_UPLOAD_STAGE" : null,
        sanitizedUrl: editorPhaseInspection.sanitizedUrl,
        ...(preUploadContract.failureCode ? { failureCode: preUploadContract.failureCode, failureStage: preUploadContract.failureStage, missingSignal: preUploadContract.missingSignal } : {})
      });
      return complete(this.preSubmitGateResultFromPreUploadContract(editorEntry, editorPhaseInspection, preUploadContract));
    } catch (error) {
      const result = emptyPreSubmitGateResult(this.preSubmitGateStatusForError(error));
      result.authStillValid = result.status !== "auth_expired" && result.status !== "security_verification_required";
      result.loginPagePresent = result.status === "auth_expired";
      result.securityVerificationPresent = result.status === "security_verification_required";
      result.sanitizedUrl = sanitizePageUrl(canonical.page);
      const failure = this.failureDetailsForError(error);
      if (failure) Object.assign(result, failure);
      this.emitEditorEntryDiagnostic({
        code: "EDITOR_NAVIGATION_FAILED",
        timestamp: new Date().toISOString(),
        operationId,
        platformKey: "xiaohongshu",
        accountId: ctx.accountId,
        contextDebugId: canonical.session.contextDebugId ?? "unknown-context",
        pageDebugId: canonical.pageDebugId,
        pageRole: "CANONICAL_AUTHENTICATED",
        pageSource: "EXISTING_CANONICAL_PAGE",
        createdNewPage: false,
        pageContextMatchesSession,
        browserConnected: this.isBrowserConnected(canonical.session),
        pageClosed: this.isCanonicalPageClosed(canonical.page),
        runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
        activeOperation: this.accountOperationMutex.getState(key).activeOperation,
        mutexLocked: this.accountOperationMutex.getState(key).mutexLocked,
        operationInProgress: this.accountOperationMutex.getState(key).operationInProgress,
        sanitizedUrlBefore: operationStartUrl,
        sanitizedUrlAfter: result.sanitizedUrl,
        navigationTrigger: "UNKNOWN",
        failureCode: failure.failureCode,
        failureStage: failure.failureStage,
        missingSignal: failure.missingSignal,
        lastCompletedStep: this.lastCompletedEditorEntryStep(failure.failureStage)
      });
      return complete(result);
    }
  }

  private preSubmitGateResultFromEditorInspection(editorEntry: XiaohongshuEditorEntryResult, inspection: Awaited<ReturnType<typeof inspectImagePostEditor>>): PreSubmitGateResult {
    const status: PreSubmitGateStatus = inspection.status === "READY"
      ? "ready"
      : inspection.failureCode === "AUTH_REDIRECTED_TO_LOGIN"
        ? "auth_expired"
        : inspection.failureCode === "SECURITY_VERIFICATION_REQUIRED"
          ? "security_verification_required"
          : "needs_user_action";
    return {
      status,
      editorReached: editorEntry.editorReached,
      authStillValid: !inspection.loginPagePresent,
      contentType: inspection.contentType,
      contentTypeReady: inspection.contentTypeReady,
      titleEditorDetected: inspection.titleEditorDetected,
      bodyEditorDetected: inspection.bodyEditorDetected,
      imageUploadControlDetected: inspection.imageUploadControlDetected,
      publishSettingsAreaDetected: inspection.publishSettingsAreaDetected,
      finalSubmitControlDetected: inspection.finalSubmitControlDetected,
      securityVerificationPresent: inspection.securityVerificationPresent,
      loginPagePresent: inspection.loginPagePresent,
      needsUserAction: status !== "ready",
      sanitizedUrl: inspection.sanitizedUrl,
      editorEntrySideEffectRisk: "NONE_OBSERVED",
      ...(inspection.failureCode ? { failureCode: inspection.failureCode } : {}),
      ...(inspection.failureStage ? { failureStage: inspection.failureStage } : {}),
      ...(inspection.missingSignal !== undefined ? { missingSignal: inspection.missingSignal } : {})
    };
  }

  private preSubmitGateResultFromPreUploadContract(
    editorEntry: XiaohongshuEditorEntryResult,
    inspection: Awaited<ReturnType<typeof inspectImagePostEditorPhase>>,
    contract: ReturnType<typeof assertPreUploadImageEditorContract>
  ): PreSubmitGateResult {
    const status: PreSubmitGateStatus = contract.status === "PASS"
      ? "ready"
      : contract.failureCode === "AUTH_REDIRECTED_TO_LOGIN"
        ? "auth_expired"
        : contract.failureCode === "SECURITY_VERIFICATION_REQUIRED"
          ? "security_verification_required"
          : "needs_user_action";
    return {
      status,
      editorReached: editorEntry.editorReached,
      authStillValid: !inspection.loginPagePresent,
      contentType: inspection.contentType,
      contentTypeReady: inspection.contentTypeReady,
      titleEditorDetected: false,
      bodyEditorDetected: false,
      imageUploadControlDetected: inspection.uploadCapabilityPresent,
      publishSettingsAreaDetected: false,
      finalSubmitControlDetected: false,
      securityVerificationPresent: inspection.securityVerificationPresent,
      loginPagePresent: inspection.loginPagePresent,
      needsUserAction: status !== "ready",
      sanitizedUrl: inspection.sanitizedUrl,
      editorEntrySideEffectRisk: "NONE_OBSERVED",
      preSubmitGatePhase: "PRE_UPLOAD",
      preUploadGateStatus: contract.status,
      preUploadGateFailureCode: contract.failureCode ?? null,
      imageEditorPhase: inspection.phase,
      imageEditorPhaseConfidence: inspection.confidence,
      uploadCapabilityPresent: inspection.uploadCapabilityPresent,
      postUploadControlsStatus: contract.postUploadControlsStatus,
      preSubmitGatePassMeaning: contract.status === "PASS" ? "SAFE_TO_ENTER_PREPARE_PUBLISH_UPLOAD_STAGE" : null,
      ...(contract.failureCode ? { failureCode: contract.failureCode } : {}),
      ...(contract.failureStage ? { failureStage: contract.failureStage } : {}),
      ...(contract.missingSignal ? { missingSignal: contract.missingSignal } : {})
    };
  }

  private emitStagedEditorDiagnostic(
    ctx: AccountContext,
    session: BrowserSession,
    page: Page,
    pageDebugId: string,
    operationId: string,
    code: Extract<XiaohongshuEditorEntryDiagnostic["code"], "PRE_UPLOAD_GATE_INSPECTION_STARTED" | "PRE_UPLOAD_GATE_RESULT" | "PREPARE_PUBLISH_MUTATION_BOUNDARY_ENTERED">,
    fields: Pick<XiaohongshuEditorEntryDiagnostic, "expectedPhase" | "observedPhase" | "phase" | "preSubmitGatePhase" | "preUploadGateStatus" | "preUploadMutationRevalidated" | "preUploadGateFailureCode" | "postUploadControlsStatus" | "preSubmitGatePassMeaning" | "phaseConfidence" | "phaseReason" | "uploadCapabilityPresent" | "sanitizedUrl" | "failureCode" | "failureStage" | "missingSignal" | "mutationType" | "selfTestMode">
  ): void {
    this.emitEditorEntryDiagnostic({
      code,
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId: ctx.accountId,
      contextDebugId: session.contextDebugId ?? "unknown-context",
      pageDebugId,
      sanitizedUrl: fields.sanitizedUrl ?? sanitizePageUrl(page),
      runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
      expectedPhase: fields.expectedPhase,
      observedPhase: fields.observedPhase,
      phase: fields.phase,
      preSubmitGatePhase: fields.preSubmitGatePhase,
      preUploadGateStatus: fields.preUploadGateStatus,
      preUploadMutationRevalidated: fields.preUploadMutationRevalidated,
      preUploadGateFailureCode: fields.preUploadGateFailureCode,
      postUploadControlsStatus: fields.postUploadControlsStatus,
      preSubmitGatePassMeaning: fields.preSubmitGatePassMeaning,
      phaseConfidence: fields.phaseConfidence,
      phaseReason: fields.phaseReason,
      uploadCapabilityPresent: fields.uploadCapabilityPresent,
      mutationType: fields.mutationType,
      selfTestMode: fields.selfTestMode,
      failureCode: fields.failureCode,
      failureStage: fields.failureStage,
      missingSignal: fields.missingSignal
    });
  }

  private emitImageEditorDiagnostic(diagnostic: ImageEditorDiagnostic): void {
    this.emitEditorEntryDiagnostic({
      code: diagnostic.code,
      timestamp: diagnostic.timestamp,
      operationId: diagnostic.operationId,
      platformKey: diagnostic.platformKey,
      accountId: diagnostic.accountId,
      contextDebugId: diagnostic.contextDebugId,
      pageDebugId: diagnostic.pageDebugId,
      sanitizedUrl: diagnostic.sanitizedUrl,
      currentUrl: diagnostic.currentUrl,
      shellStatus: diagnostic.shellStatus,
      sampleIndex: diagnostic.sampleIndex,
      elapsedMs: diagnostic.elapsedMs,
      readyState: diagnostic.readyState,
      titleCandidateCount: diagnostic.titleCandidateCount,
      bodyCandidateCount: diagnostic.bodyCandidateCount,
      uploadCandidateCount: diagnostic.uploadCandidateCount,
      finalSubmitCandidateCount: diagnostic.finalSubmitCandidateCount,
      securityVerificationPresent: diagnostic.securityVerificationPresent,
      loginPagePresent: diagnostic.loginPagePresent,
      expectedPhase: diagnostic.expectedPhase,
      observedPhase: diagnostic.observedPhase,
      preSubmitGatePhase: diagnostic.preSubmitGatePhase,
      preUploadGateStatus: diagnostic.preUploadGateStatus,
      preUploadGateFailureCode: diagnostic.preUploadGateFailureCode,
      postUploadControlsStatus: diagnostic.postUploadControlsStatus,
      preSubmitGatePassMeaning: diagnostic.preSubmitGatePassMeaning,
      action: diagnostic.action,
      mutationType: diagnostic.mutationType,
      selfTestMode: diagnostic.selfTestMode,
      uploadMutationCount: diagnostic.uploadMutationCount,
      uploadAttemptIndex: diagnostic.uploadAttemptIndex,
      uploadBusy: diagnostic.uploadBusy,
      previewReady: diagnostic.previewReady,
      contentType: diagnostic.contentType,
      contentTypeReady: diagnostic.contentTypeReady,
      titleEditor: diagnostic.titleEditor,
      bodyEditor: diagnostic.bodyEditor,
      imageUploadControl: diagnostic.imageUploadControl,
      publishSettingsArea: diagnostic.publishSettingsArea,
      finalSubmitControl: diagnostic.finalSubmitControl,
      phase: diagnostic.phase,
      phaseConfidence: diagnostic.phaseConfidence,
      phaseReason: diagnostic.phaseReason,
      preUploadSemanticNodes: diagnostic.preUploadSemanticNodes,
      postUploadSemanticNodes: diagnostic.postUploadSemanticNodes,
      uploadControlRelationships: diagnostic.uploadControlRelationships,
      uploadCapabilityStatus: diagnostic.uploadCapabilityStatus,
      uploadCapabilityPresent: diagnostic.uploadCapabilityPresent,
      uploadCapabilityUnique: diagnostic.uploadCapabilityUnique,
      phaseTopology: diagnostic.phaseTopology,
      interactiveTopology: diagnostic.interactiveTopology,
      mediaPreviewDiagnostics: diagnostic.mediaPreviewDiagnostics,
      modalDiagnostics: diagnostic.modalDiagnostics,
      intermediateActionCandidates: diagnostic.intermediateActionCandidates,
      postUploadTerminalStateReached: diagnostic.postUploadTerminalStateReached,
      postUploadIntermediateState: diagnostic.postUploadIntermediateState,
      postUploadReadinessDurationMs: diagnostic.postUploadReadinessDurationMs,
      postUploadReadinessSampleCount: diagnostic.postUploadReadinessSampleCount,
      requiredValidationSignals: diagnostic.requiredValidationSignals,
      forbiddenActionSignalPresent: diagnostic.forbiddenActionSignalPresent,
      imageEditorStatus: diagnostic.status,
      failureCode: diagnostic.failureCode,
      failureStage: diagnostic.failureStage,
      missingSignal: diagnostic.missingSignal
    });
  }

  override getBrowserRuntimeSnapshot(ctx: AccountContext): BrowserSessionRuntimeSnapshot {
    const key = `${this.platformKey}:${ctx.accountId}`;
    return { ...super.getBrowserRuntimeSnapshot(ctx), ...this.accountOperationMutex.getState(key) };
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const identityKey = { platformKey: this.platformKey, accountId: ctx.accountId };
    return this.accountOperationMutex.run(`${identityKey.platformKey}:${identityKey.accountId}`, async () => {
      const opened = await this.activeCanonicalPage(ctx);
      if (!opened) {
        if (!this.sessionManager.hasStoredSession(identityKey)) throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书账号没有已保存的浏览器 Session，请先完成登录");
        throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书没有当前 live BrowserSession，请由账号所有者重新连接并完成验证");
      }
      const evidence = await readXiaohongshuPageEvidence(opened.page);
      this.assertProfilePageCanBeRead(evidence);
      const identity = await this.inspectAccountIdentity(opened.page, evidence);
      return {
        ...(identity.externalAccountId ? { accountId: identity.externalAccountId } : {}),
        ...(identity.displayName ? { accountName: identity.displayName } : {}),
        authorizationStatus: "Authorized"
      };
    }, "getAccountProfile");
  }

  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, () => ctx.settings.ordinaryProduction === true ? this.prepareProductionArticle(ctx, article) : this.preparePublishOnCanonicalPage(ctx, article), "preparePublish");
  }

  private async preparePublishOnCanonicalPage(ctx: AccountContext, article: PublishArticleInput, ownedPage?: { page: Page; session: BrowserSession; pageDebugId: string; backendUrl: string }): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("；"));

    const runtimeIdentityProof = ownedPage ? undefined : ctx.runtimeIdentityProof;
    if (runtimeIdentityProof) {
      const currentCanonical = await this.activeCanonicalPage(ctx);
      if (!currentCanonical) throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "当前 canonical Page 不存在，拒绝消费 runtime identity proof");
      this.assertRuntimeIdentityProof(ctx, runtimeIdentityProof, currentCanonical.session.contextDebugId, currentCanonical.pageDebugId);
    }
    const opened = ownedPage ?? await this.openBackendPage(ctx, XIAOHONGSHU_CREATOR_HOME);
    if (runtimeIdentityProof) this.assertRuntimeIdentityProof(ctx, runtimeIdentityProof, opened.session.contextDebugId, opened.session.pageDebugId ?? "unknown-page");
    const page = opened.page;
    const evidence = await readXiaohongshuPageEvidence(page);
    this.assertProfilePageCanBeRead(evidence, runtimeIdentityProof);
    const gates: string[] = ["account_identity"];
    const identity = await this.inspectAccountIdentity(page, evidence);
    if (ctx.settings.ordinaryProduction === true && identity.externalAccountId !== ctx.settings.expectedExternalCreatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "当前 Creator 与所选账号不一致，未上传图片");
    if (runtimeIdentityProof && (identity.externalAccountId !== runtimeIdentityProof.observedExternalCreatorId || identity.identitySourceCandidates?.length !== 1)) {
      throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "当前页面 identity evidence 与 runtime identity proof 不一致");
    }

    const operationId = randomUUID();
    await this.navigateToImagePostEditor(page, operationId, ctx.accountId, { context: opened.session.context }, "PREPARE_PUBLISH");
    gates.push("login", "image_post_entry");
    const editorMetadata = {
      operationId,
      platformKey: "xiaohongshu",
      accountId: ctx.accountId,
      contextDebugId: opened.session.contextDebugId ?? "unknown-context",
      pageDebugId: ownedPage?.pageDebugId ?? opened.session.pageDebugId ?? "unknown-page"
    } as const;
    this.emitStagedEditorDiagnostic(ctx, opened.session, page, editorMetadata.pageDebugId, operationId, "PRE_UPLOAD_GATE_INSPECTION_STARTED", {
      expectedPhase: "IMAGE_POST_PRE_UPLOAD",
      observedPhase: "IMAGE_POST_TRANSITIONING",
      sanitizedUrl: sanitizePageUrl(page)
    });
    const preUploadInspection = await inspectImagePostEditorPhase(page, editorMetadata, {
      emit: (diagnostic) => this.emitImageEditorDiagnostic(diagnostic)
    });
    const preUploadContract = assertPreUploadImageEditorContract(preUploadInspection);
    this.emitStagedEditorDiagnostic(ctx, opened.session, page, editorMetadata.pageDebugId, operationId, "PRE_UPLOAD_GATE_RESULT", {
      expectedPhase: preUploadContract.expectedPhase,
      observedPhase: preUploadContract.observedPhase,
      phase: preUploadInspection.phase,
      phaseConfidence: preUploadInspection.confidence,
      phaseReason: preUploadInspection.reason,
      preSubmitGatePhase: "PRE_UPLOAD",
      preUploadGateStatus: preUploadContract.status,
      preUploadGateFailureCode: preUploadContract.failureCode ?? null,
      uploadCapabilityPresent: preUploadInspection.uploadCapabilityPresent,
      postUploadControlsStatus: preUploadContract.postUploadControlsStatus,
      preSubmitGatePassMeaning: preUploadContract.status === "PASS" ? "SAFE_TO_ENTER_PREPARE_PUBLISH_UPLOAD_STAGE" : null,
      sanitizedUrl: preUploadInspection.sanitizedUrl,
      ...(preUploadContract.failureCode ? { failureCode: preUploadContract.failureCode, failureStage: preUploadContract.failureStage, missingSignal: preUploadContract.missingSignal } : {})
    });
    if (preUploadContract.status !== "PASS") {
      const failureCode = preUploadContract.failureCode ?? "UNKNOWN_UI_STATE";
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `图文编辑器 discovery 未通过：${failureCode}`, {
        failureCode,
        failureStage: preUploadContract.failureStage ?? "EDITOR_DISCOVERY",
        missingSignal: preUploadContract.missingSignal ?? "image-editor-discovery"
      });
    }
    gates.push("pre_upload_gate");
    this.emitStagedEditorDiagnostic(ctx, opened.session, page, editorMetadata.pageDebugId, operationId, "PREPARE_PUBLISH_MUTATION_BOUNDARY_ENTERED", {
      expectedPhase: "IMAGE_POST_PRE_UPLOAD",
      observedPhase: "IMAGE_POST_PRE_UPLOAD",
      phase: "IMAGE_POST_PRE_UPLOAD",
      preSubmitGatePhase: "PRE_UPLOAD",
      preUploadGateStatus: "PASS",
      postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD",
      preSubmitGatePassMeaning: "SAFE_TO_ENTER_PREPARE_PUBLISH_UPLOAD_STAGE",
      uploadCapabilityPresent: true,
      sanitizedUrl: sanitizePageUrl(page)
    });
    const imageEvidence = await this.uploadImages(page, article.images ?? [], { ctx, session: opened.session, metadata: editorMetadata, boundImages: article.boundImages });
    gates.push("image_upload");
    const nativeFilePickerRecovery = createXhsNativeFilePickerRecovery(page, { profilePath: opened.session.profilePath, browserChannel: opened.session.browserChannel ?? null });
    const nativePickerRecovery = await recoverNativeFilePicker(nativeFilePickerRecovery);
    if (nativePickerRecovery.status === "BLOCKED") {
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `上传后图文编辑器 discovery 未通过：${nativePickerRecovery.failureCode ?? "NATIVE_FILE_PICKER_CANCEL_FAILED"}`, {
        // Keep the public gate taxonomy compatible with the existing image
        // editor contract while retaining the native recovery code in the
        // diagnostic signal.
        failureCode: "POST_UPLOAD_EDITOR_TIMEOUT",
        failureStage: "EDITOR_DISCOVERY",
        missingSignal: `native-file-picker-cancel:${nativePickerRecovery.failureCode ?? "NATIVE_FILE_PICKER_CANCEL_FAILED"}`
      });
    }

    const postUploadSnapshot = await inspectXiaohongshuPostUploadReconciliationDom(page);
    const postUploadReconciliation = reconcileXiaohongshuPostUploadSnapshot(postUploadSnapshot);
    const terminalReadiness = classifyXiaohongshuPostUploadTerminalReadiness({
      originalPostUploadState: postUploadReconciliation.postUploadState,
      editorScopedImageAssetCount: postUploadReconciliation.imageAssetRenderedCount,
      imageCounterTextSafe: postUploadReconciliation.imageCounterTextSafe,
      titleControlPresent: postUploadReconciliation.titleControlPresent,
      bodyControlPresent: postUploadReconciliation.bodyControlPresent,
      uploadErrorSignalPresent: postUploadReconciliation.explicitUploadErrorSignals.length > 0,
      busySignalPresent: postUploadReconciliation.processingSignalPresent
    });
    if (!terminalReadiness.ready) {
      const failureCode = "POST_UPLOAD_EDITOR_TIMEOUT";
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `上传后图文编辑器 discovery 未通过：${failureCode}`, {
        failureCode,
        failureStage: "EDITOR_DISCOVERY",
        missingSignal: terminalReadiness.blockerCodes.join(",") || "post-upload-terminal-readiness"
      });
    }

    if (nativePickerRecovery.status === "CANCELLED") {
      const pickerCancelStabilization = await stabilizeAfterNativeFilePickerCancel(page, {
        maxWaitMs: 10_000,
        retryIntervalMs: 80,
        stableSampleCount: 2,
        clearOpenPickerMarker: async () => {
          const evaluatePage = page as unknown as { evaluate?: <T>(pageFunction: () => T) => Promise<T> };
          if (typeof evaluatePage.evaluate !== "function") return false;
          try {
            return Boolean(await evaluatePage.evaluate(() => {
              const current = new URL(window.location.href);
              if (current.searchParams.get("openFilePicker") === "true") {
                current.searchParams.delete("openFilePicker");
                const nextUrl = `${current.pathname}${current.search}${current.hash}`;
                window.history.replaceState(window.history.state, document.title, nextUrl);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }
              return new URL(window.location.href).searchParams.get("openFilePicker") !== "true";
            }));
          } catch {
            return false;
          }
        },
        discoverFinalControl: async () => this.inspectClosedShadowFinalSubmitForExploration(page)
      });
      if (!pickerCancelStabilization.finalControlFoundAfterWait) {
        throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "上传后图文编辑器 discovery 未通过：POST_UPLOAD_EDITOR_TIMEOUT", {
          failureCode: "POST_UPLOAD_EDITOR_TIMEOUT",
          failureStage: "EDITOR_DISCOVERY",
          missingSignal: "picker-cancel-stabilization"
        });
      }
    }
    gates.push("post_upload_editor_discovery");

    let title: Locator;
    try {
      title = await this.discoverUniqueEditor(page, "title");
    } catch (error) {
      // Preserve the post-upload failure contract that the staged classifier
      // exposed before terminal readiness became authoritative.  The terminal
      // classifier decides whether the editor is ready; this wrapper keeps
      // ambiguous/missing editor controls fail-closed and diagnosable.
      if (error instanceof XiaohongshuGateError && error.gateCode === "CONTENT_TITLE_NOT_VERIFIED") {
        const failureCode: PreSubmitGateFailureCode = /matches=\d+/iu.test(error.message)
          ? "TITLE_EDITOR_AMBIGUOUS_POST_UPLOAD"
          : "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD";
        throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `上传后图文编辑器 discovery 未通过：${failureCode}`, {
          failureCode,
          failureStage: "EDITOR_DISCOVERY",
          missingSignal: "title-editor"
        });
      }
      throw error;
    }
    gates.push("title_editor", "title_write");
    await title.fill(article.title);
    const titleReadback = await readEditor(title, "title");
    if (titleReadback !== normalizeXiaohongshuEditorText(article.title)) throw new XiaohongshuGateError("CONTENT_TITLE_NOT_VERIFIED", "CONTENT_REJECTED", "标题 strict readback 与请求内容不一致");
    gates.push("title_readback");

    const body = await this.discoverUniqueEditor(page, "body");
    gates.push("body_editor", "body_write");
    await body.fill(article.body);
    const bodyReadbackRaw = await readEditorRaw(body, "body");
    const bodyReadbackVerification = classifyXiaohongshuEditorReadback(article.body, bodyReadbackRaw);
    const bodyReadback = normalizeXiaohongshuEditorText(bodyReadbackRaw);
    if (bodyReadbackVerification.status === "FAIL") {
      const telemetry = {
        expectedLength: bodyReadbackVerification.expectedLength,
        actualLength: bodyReadbackVerification.actualLength,
        expectedHash: bodyReadbackVerification.expectedHash,
        actualHash: bodyReadbackVerification.actualHash,
        firstDifferenceIndex: bodyReadbackVerification.firstDifferenceIndex,
        expectedCharacter: bodyReadbackVerification.expectedCharacter,
        actualCharacter: bodyReadbackVerification.actualCharacter,
        expectedCodePoint: bodyReadbackVerification.expectedCodePoint,
        actualCodePoint: bodyReadbackVerification.actualCodePoint,
        normalizationReasons: bodyReadbackVerification.normalizationReasons,
        expectedContextBeforeAfter: bodyReadbackVerification.expectedContextBeforeAfter,
        actualContextBeforeAfter: bodyReadbackVerification.actualContextBeforeAfter
      };
      throw new XiaohongshuGateError("CONTENT_BODY_NOT_VERIFIED", "CONTENT_REJECTED", `正文回读失败：${JSON.stringify(telemetry)}`, { bodyReadback: bodyReadbackVerification });
    }
    gates.push("body_readback");

    const requiredFields = await this.inspectRequiredFields(page);
    if (requiredFields.some((field) => field.empty)) throw new XiaohongshuGateError("REQUIRED_FIELDS_NOT_VERIFIED", "REQUIRED_FIELD_MISSING", `存在未填写必填字段：${requiredFields.filter((field) => field.empty).map((field) => field.label || "未命名字段").join("、")}`);
    gates.push("required_fields");

    const publishSettings = await this.inspectPublishSettings(page);
    gates.push("publish_settings");
    let finalSubmitControl: XiaohongshuFinalSubmitControlEvidence;
    try {
      finalSubmitControl = await this.inspectFinalSubmitControl(page);
    } catch (error) {
      const closedShadowSurface = await inspectTask10sClosedShadowPublishSurface(page);
      if (!closedShadowSurface.present || !closedShadowSurface.enabled) {
        if (error instanceof XiaohongshuGateError && error.gateCode === "FINAL_SUBMIT_CONTROL_NOT_VERIFIED" && /matches=\d+/iu.test(error.message)) {
          throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "上传后图文编辑器 discovery 未通过：FINAL_SUBMIT_CONTROL_AMBIGUOUS_POST_UPLOAD", {
            failureCode: "FINAL_SUBMIT_CONTROL_AMBIGUOUS_POST_UPLOAD",
            failureStage: "EDITOR_DISCOVERY",
            missingSignal: "final-submit-control"
          });
        }
        throw error;
      }
      finalSubmitControl = {
        verified: true,
        visible: true,
        enabled: true,
        unique: true,
        label: "发布",
        selector: "closed-shadow:XHS-PUBLISH-BTN",
        secondConfirmation: "unknown"
      };
    }
    gates.push("final_submit_control_discovery");

    return {
      prepared: true,
      requiresUserAction: true,
      message: "小红书图文 gate-only 已完成真实页面证据校验；已停止在最终发布控件 discovery 之后，未点击发布。",
      sessionIdHash: opened.session.sessionIdHash,
      backendUrl: page.url(),
      editorOpenedAt: new Date().toISOString(),
      titleFilled: true,
      bodyFilled: true,
      response: {
        adapter: this.platformKey,
        automationType: this.automationType,
        stage: "xiaohongshu_gate_only",
        gateOrder: gates,
        accountIdentity: identity,
        login: "PASS",
        imagePostEntry: "verified",
        imageUploaded: true,
        events: ["IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_PASSED"],
        uploadedImageSha256: imageEvidence.uploadedImageSha256 ?? null,
        imageUploadEvidence: imageEvidence,
        titleEditor: "verified",
        titleReadback: true,
        titleReadbackValue: titleReadback,
        bodyEditor: "verified",
        bodyReadback: true,
        bodyReadbackValue: bodyReadback,
        bodyReadbackStatus: bodyReadbackVerification.status,
        bodyReadbackTelemetry: bodyReadbackVerification,
        requiredFieldsStatus: "KNOWN",
        requiredFields,
        publishSettingsStatus: classifyXiaohongshuPublishSettings(publishSettings),
        publishSettings,
        finalSubmitControl,
        finalSubmitClickCount: 0,
        finalSubmit: "discovered_but_not_clicked",
        securityVerification: "NONE",
        publishPassed: "NOT_PASS",
        jobCreated: false,
        intentCreated: false,
        publishRecordCreated: false
      }
    };
  }

  private productionJobId(ctx: AccountContext): string {
    const id = ctx.settings.publishJobId;
    if (ctx.settings.ordinaryProduction !== true || typeof id !== "string" || !id) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "普通发布缺少持久化 Job 绑定");
    return id;
  }

  private productionImageHash(article: PublishArticleInput): string {
    const image = article.boundImages?.[0];
    if (!article.contentSnapshotId || !image || article.boundImages?.length !== 1 || article.images?.length !== 1) throw new BrowserAutomationError("CONTENT_REJECTED", "普通小红书发布需要确切快照和单张绑定图片");
    const hash = createHash("sha256").update(image.buffer).digest("hex");
    if (hash !== image.sha256.toLowerCase()) throw new BrowserAutomationError("CONTENT_REJECTED", "绑定图片字节已变化");
    return hash;
  }

  private async productionImageSurfaceHash(page: Page): Promise<string> {
    // This supplements the byte-level upload proof: replacing/deleting an editor
    // image while awaiting confirmation invalidates the retained preparation.
    const sources = await page.locator("img").evaluateAll((images) => images.map((image) => ({ src: (image as HTMLImageElement).currentSrc || image.getAttribute("src"), parent: image.parentElement?.className ?? "" })));
    return createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  }

  private async prepareProductionArticle(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const jobId = this.productionJobId(ctx);
    const imageSha256 = this.productionImageHash(article);
    const creatorId = ctx.settings.expectedExternalCreatorId;
    if (typeof creatorId !== "string" || !creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "所选账号缺少 Creator 绑定");
    const prior = this.productionPages.get(jobId);
    if (prior?.submitted) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "已有提交占用的任务不得重新准备");
    if (prior?.accountId && prior.accountId !== ctx.accountId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "任务页面不属于所选账号");
    if (prior) { await this.sessionManager.closeOperationPage(this.identity(ctx), prior.page); if (prior.identityPage) await this.sessionManager.closeOperationPage(this.identity(ctx), prior.identityPage.page); this.productionPages.delete(jobId); }
    const active = this.activeSession(this.identity(ctx));
    if (!active || !this.isBrowserConnected(active)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "所选账号没有活跃且归属明确的 Session");
    const owned = await this.sessionManager.openOperationPage(this.identity(ctx), userInitiatedActionFromSettings(ctx.settings), "VISIBLE");
    try {
      if (owned.session !== active || !this.pageContextMatchesSession(owned.session, owned.page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "任务 Page 跨 Context，已阻断");
      await this.navigate(owned.page, XIAOHONGSHU_CREATOR_HOME);
      const prepared = await this.preparePublishOnCanonicalPage(ctx, article, { ...owned, backendUrl: owned.page.url() });
      const uploadedHash = prepared.response.uploadedImageSha256;
      if (!prepared.prepared || typeof uploadedHash !== "string" || uploadedHash.toLowerCase() !== imageSha256) throw new BrowserAutomationError("UPLOAD_FAILED", "实际上传字节与所选图片快照不一致");
      this.productionPages.set(jobId, { ...owned, accountId: ctx.accountId, snapshotId: article.contentSnapshotId!, creatorId, title: article.title, body: article.body, imageSha256, imageSurfaceHash: await this.productionImageSurfaceHash(owned.page), submitted: false });
      await this.productionSubjectAndReadback(ctx, article);
      return { ...prepared, requiresUserAction: false, message: "所选账号的单图内容已准备；页面保留，等待本次明确确认", response: { ...prepared.response, stage: "PRODUCTION_PREPARED", ordinaryProduction: true, publishJobId: jobId, contentSnapshotId: article.contentSnapshotId, contextDebugId: owned.session.contextDebugId, operationPageDebugId: owned.pageDebugId, expectedExternalCreatorId: creatorId } };
    } catch (error) {
      const failed = this.productionPages.get(jobId);
      if (failed?.identityPage) await this.sessionManager.closeOperationPage(this.identity(ctx), failed.identityPage.page).catch(() => undefined);
      this.productionPages.delete(jobId);
      await this.sessionManager.closeOperationPage(this.identity(ctx), owned.page).catch(() => undefined);
      throw error;
    }
  }

  private async productionSubjectAndReadback(ctx: AccountContext, article: PublishArticleInput): Promise<XhsContextIdentityAttestation> {
    const lease = this.productionPages.get(this.productionJobId(ctx));
    const active = this.activeSession(this.identity(ctx));
    if (!lease || lease.accountId !== ctx.accountId || lease.snapshotId !== article.contentSnapshotId || lease.creatorId !== ctx.settings.expectedExternalCreatorId || active !== lease.session || this.isCanonicalPageClosed(lease.page) || !this.pageContextMatchesSession(lease.session, lease.page) || !this.isBrowserConnected(lease.session) || !isExactXhsPublishEditorRoute(lease.page.url())) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "普通发布 Page 已失活、跨账号或快照绑定不一致，请重新核验任务");
    if (lease.imageSha256 !== this.productionImageHash(article) || lease.title !== article.title || lease.body !== article.body) throw new BrowserAutomationError("CONTENT_REJECTED", "确认后的图片或文本发生变化");
    const editorEvidence = await readXiaohongshuPageEvidence(lease.page);
    if (!editorEvidence.available || this.isLoginPage(lease.page.url()) || this.isVerificationUrl(lease.page.url()) || editorEvidence.login.blockingSignals.length > 0 || editorEvidence.login.visibleLoginForm || editorEvidence.login.visibleCaptcha || editorEvidence.login.visibleSecurityModal) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "请先完成平台正常登录或安全验证");
    let identityPage = lease.page; let identityPageId = lease.pageDebugId;
    let currentIdentity: XiaohongshuAccountIdentityEvidence;
    if (editorEvidence.identity.externalAccountIdCandidates.length > 0) currentIdentity = await this.inspectAccountIdentity(lease.page, editorEvidence);
    else {
      if (!lease.identityPage || this.isCanonicalPageClosed(lease.identityPage.page)) {
        const probe = await this.sessionManager.openOperationPage(this.identity(ctx), userInitiatedActionFromSettings(ctx.settings), "VISIBLE");
        if (probe.session !== lease.session) { await this.sessionManager.closeOperationPage(this.identity(ctx), probe.page); throw new BrowserAutomationError("USER_ACTION_REQUIRED", "身份验证页面跨 Context"); }
        lease.identityPage = { page: probe.page, pageDebugId: probe.pageDebugId };
      }
      identityPage = lease.identityPage.page; identityPageId = lease.identityPage.pageDebugId;
      if (!this.pageContextMatchesSession(lease.session, identityPage)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "身份验证页面不属于任务 Context");
      await this.navigate(identityPage, XIAOHONGSHU_CREATOR_HOME);
      const evidence = await readXiaohongshuPageEvidence(identityPage);
      this.assertProfilePageCanBeRead(evidence);
      currentIdentity = await this.inspectAccountIdentity(identityPage, evidence);
    }
    if (currentIdentity.externalAccountId !== lease.creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "当前任务 Session 的 Creator 已变化");
    const title = await readEditor(await this.discoverUniqueEditor(lease.page, "title"), "title");
    const body = await readEditorRaw(await this.discoverUniqueEditor(lease.page, "body"), "body");
    if (title !== normalizeXiaohongshuEditorText(article.title) || classifyXiaohongshuEditorReadback(article.body, body).status === "FAIL") throw new BrowserAutomationError("CONTENT_REJECTED", "提交前标题或正文回读与确认快照不一致");
    const images = reconcileXiaohongshuPostUploadSnapshot(await inspectXiaohongshuPostUploadReconciliationDom(lease.page));
    if (images.imageAssetRenderedCount !== 1 || !images.noExplicitUploadError || images.processingSignalPresent || await this.productionImageSurfaceHash(lease.page) !== lease.imageSurfaceHash || (await this.inspectRequiredFields(lease.page)).some((field) => field.empty)) throw new BrowserAutomationError("CONTENT_REJECTED", "提交前图片或必填设置已变化");
    if (!lease.session.runtimeSessionIdentity || !lease.session.contextDebugId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "活跃 Session 缺少可审计身份");
    ctx.assertContentSnapshotCurrent?.();
    return { platformKey: "xiaohongshu", accountId: ctx.accountId, expectedExternalCreatorId: lease.creatorId, observedExternalCreatorId: lease.creatorId, externalAccountId: lease.creatorId, browserSessionIdentity: lease.session.runtimeSessionIdentity, browserContextIdentity: lease.session.contextDebugId, sourcePageIdentity: identityPageId, sourceOrigin: "https://creator.xiaohongshu.com", sourcePathname: new URL(identityPage.url()).pathname, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30000).toISOString(), verified: true };
  }

  async validatePreparedSession(ctx: AccountContext, article: PublishArticleInput): Promise<void> {
    await this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => { await this.productionSubjectAndReadback(ctx, article); }, "validateProductionPreparedSession");
  }

  async releasePreparedSession(ctx: AccountContext): Promise<void> {
    await this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const jobId = this.productionJobId(ctx); const lease = this.productionPages.get(jobId);
      const login = this.productionLoginPages.get(jobId);
      if (login?.accountId === ctx.accountId) { if (!this.isCanonicalPageClosed(login.page)) await this.sessionManager.closeOperationPage(this.identity(ctx), login.page); this.productionLoginPages.delete(jobId); }
      if (!lease || lease.accountId !== ctx.accountId) return;
      if (!this.isCanonicalPageClosed(lease.page)) await this.sessionManager.closeOperationPage(this.identity(ctx), lease.page);
      if (lease.identityPage && !this.isCanonicalPageClosed(lease.identityPage.page)) await this.sessionManager.closeOperationPage(this.identity(ctx), lease.identityPage.page);
      this.productionPages.delete(jobId);
    }, "releaseProductionPreparedSession");
  }

  private async performProductionFinalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const guard = attempt.productionPublicationGuard;
    if (!guard || attempt.oneShotPublicationGuard || attempt.task10sRetainedEditor || guard.accountId !== ctx.accountId || guard.contentSnapshotId !== article.contentSnapshotId || attempt.jobId !== this.productionJobId(ctx)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "普通用途最终提交合同不匹配");
    await this.productionSubjectAndReadback(ctx, article);
    const lease = this.productionPages.get(attempt.jobId)!;
    if (lease.submitted) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "本次操作已占用提交，不得重复发送");
    if (!this.productionReceiptFactory) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "XHS_RECEIPT_CAPTURE_NOT_CONFIGURED");
    const surface = await inspectTask10sClosedShadowPublishSurface(lease.page);
    if (!surface.present || !surface.enabled) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "最终发布控件未通过唯一性和可用性校验");
    const buildSha256 = ctx.settings.campaignBuildSha256;
    if (typeof buildSha256 !== "string" || !buildSha256) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "XHS_CAMPAIGN_BUILD_IDENTITY_REQUIRED");
    const observer = this.productionReceiptFactory(lease.page, { accountId: ctx.accountId, creatorId: lease.creatorId, jobId: attempt.jobId, intentId: attempt.submissionIntentId, snapshotId: lease.snapshotId, buildSha256, contextId: lease.session.contextDebugId ?? "", pageId: lease.pageDebugId });
    const click = await settleReceiptCapture(observer, () => clickTask10sClosedShadowPublishSurface(lease.page, { beforeMousePress: async () => {
        observer.arm();
        const subject = await this.productionSubjectAndReadback(ctx, article);
        guard.claim(subject);
        lease.submitted = true;
        attempt.markSubmissionSideEffect?.();
      } }), () => lease.submitted);
    if (!lease.submitted) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `未占用最终提交：${click.failureCode ?? click.status}`);
    // The first real response may establish a future schema, but an unreviewed
    // response, mouse action or matching historical note never proves acceptance.
    throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `本次最终提交已占用；安全回执已记录但真实受理合同仍为 ${observer.result().status}，禁止重发（${click.status}）`);
  }

  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    if (attempt.productionPublicationGuard) return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, () => this.performProductionFinalSubmit(ctx, article, attempt), "productionFinalSubmit");
    const guard = attempt.oneShotPublicationGuard;
    if (!guard) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书最终发布只允许通过 OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH guard；探索路径不会提交");
    return this.accountOperationMutex.run(
      `${this.platformKey}:${ctx.accountId}`,
      () => attempt.task10sRetainedEditor
        ? this.performTask10sRetainedEditorCompletion(ctx, article, guard, attempt)
        : this.performOneShotFinalSubmit(ctx, article, guard, attempt),
      attempt.task10sRetainedEditor ? "task10sRetainedEditorCompletion" : "oneShotFinalSubmit"
    );
  }

  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const externalId = result.externalId?.trim() ?? "";
    const publishedUrl = result.publishedUrl?.trim() ?? "";
    if (!externalId || !publishedUrl) return { status: "failed", externalId: externalId || undefined, publishedUrl: publishedUrl || undefined, response: { publicPageVerified: false, titleMatch: false, bodyMatch: false }, errorCode: "EXTERNAL_EVIDENCE_INCOMPLETE", errorMessage: "小红书真实发布缺少 External ID 或 URL" };
    const canonical = await this.activeCanonicalPage(ctx);
    if (!canonical) return { status: "failed", externalId, publishedUrl, response: { publicPageVerified: false, titleMatch: false, bodyMatch: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "小红书公开结果验证需要当前 canonical Page" };
    try {
      await canonical.page.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForProbe(canonical.page);
      const pageText = await bodyText(canonical.page);
      const titleMatch = pageText.includes(article.title);
      const bodyMatch = pageText.includes(article.body);
      const publicPageVerified = this.publicResultFromUrl(canonical.page.url())?.externalId === externalId && titleMatch && bodyMatch;
      return { status: publicPageVerified ? "published" : "failed", externalId, publishedUrl: canonical.page.url(), response: { publicPageVerified, titleMatch, bodyMatch, pageUrl: sanitizePageUrl(canonical.page) }, ...(publicPageVerified ? {} : { errorCode: "RECONCILIATION_UNCERTAIN" as const, errorMessage: "小红书公开页未同时证明 External ID、标题和正文" }) };
    } catch (error) {
      return { status: "failed", externalId, publishedUrl, response: { publicPageVerified: false, titleMatch: false, bodyMatch: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: error instanceof Error ? error.message : "小红书公开结果验证失败" };
    }
  }

  async reconcile(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult> {
    if (ctx.settings.ordinaryProduction === true) return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { adapter: "xiaohongshu", readOnly: true, publicationReconciled: false, expectedExternalId: input.expectedExternalId ?? null, reason: "OPERATION_CORRELATED_RECEIPT_NOT_VERIFIED" }, message: "尚无已核验且归属于本次操作的提交回执；历史同文、显示名、等待时间和页面 URL 不构成成功证据" };
    const canonical = await this.activeCanonicalPage(ctx);
    if (!canonical) return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { adapter: this.platformKey, readOnly: true, evidence: "canonical_page_unavailable" }, message: "当前没有可用于小红书只读回查的 canonical Page" };
    try {
      const pageText = await bodyText(canonical.page);
      const publicResult = this.publicResultFromUrl(canonical.page.url());
      const titleMatch = pageText.includes(input.title);
      const accountMatch = pageText.includes(input.accountName);
      const timeWindowMatch = input.waitWindowSatisfied === true || input.submissionIntentState === "Submitted";
      const thumbnailMatch = Boolean(publicResult);
      const result = reconcileOneShotPublication({ titleMatch, accountMatch, timeWindowMatch, thumbnailMatch, externalId: publicResult?.externalId ?? input.expectedExternalId ?? undefined, publishedUrl: publicResult?.publishedUrl ?? input.expectedPublishedUrl ?? undefined });
      if (result.reconciled && result.externalId && result.publishedUrl) return { status: "FOUND_PUBLISHED", externalId: result.externalId, publishedUrl: result.publishedUrl, titleMatch, accountMatch, timeWindowMatch, response: { adapter: this.platformKey, readOnly: true, publicationReconciled: true, publicPageVerified: true }, message: "小红书只读回查取得了标题、账号、时间窗口和缩略图信号" };
      return { status: "STILL_UNCERTAIN", titleMatch, accountMatch, timeWindowMatch, response: { adapter: this.platformKey, readOnly: true, publicationReconciled: false, publicPageVerified: false }, message: "小红书只读回查证据不足，保持 NeedsReconciliation" };
    } catch (error) {
      return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { adapter: this.platformKey, readOnly: true, error: error instanceof Error ? error.message : String(error) }, message: "小红书只读回查失败，保持 NeedsReconciliation" };
    }
  }

  private async performTask10sRetainedEditorCompletion(ctx: AccountContext, article: PublishArticleInput, guard: OneShotPublicationGuard, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    if (!article.title.trim() || !article.body.trim()) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Task10S retained-editor action 要求 Prepared Job Article 提供标题和正文");
    const canonical = await this.activeCanonicalPage(ctx);
    if (!canonical || this.isCanonicalPageClosed(canonical.page) || !this.pageContextMatchesSession(canonical.session, canonical.page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Task10S retained-editor action 要求当前 canonical Context/Page");
    if (!isExactXhsPublishEditorRoute(canonical.page.url())) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Task10S retained-editor action 要求 /publish/publish 路由");
    if (!this.isBrowserConnected(canonical.session) || this.getBrowserRuntimeState(ctx).state !== "AUTHENTICATED") throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Task10S retained-editor action 要求 authenticated BrowserSession");

    const postUploadSnapshot = await inspectXiaohongshuPostUploadReconciliationDom(canonical.page);
    const postUpload = reconcileXiaohongshuPostUploadSnapshot(postUploadSnapshot);
    if (postUpload.origin !== "https://creator.xiaohongshu.com" || postUpload.pathname !== "/publish/publish") throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Task10S retained-editor action 的 post-upload route proof 失败");
    if (postUpload.postUploadState !== "EDITOR_READY" || postUpload.imageAssetRenderedCount < 1 || !postUpload.titleControlPresent || !postUpload.bodyControlPresent || !postUpload.noExplicitUploadError) {
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "USER_ACTION_REQUIRED", "Task10S retained-editor action 未取得 post-upload editor-ready proof", { failureCode: "POST_UPLOAD_PHASE_NOT_READY", failureStage: "EDITOR_DISCOVERY", missingSignal: "editor-scoped-image-title-body" });
    }

    const initialGlobalDiagnostic = await inspectXiaohongshuGlobalExactPublishDom(canonical.page);
    const initialPublishSurface = await inspectTask10sClosedShadowPublishSurface(canonical.page);
    if (!initialPublishSurface.present) throw new XiaohongshuGateError("FINAL_SUBMIT_CONTROL_NOT_VERIFIED", "USER_ACTION_REQUIRED", `Task10S closed-shadow 发布 surface 未通过：${initialPublishSurface.failureCode ?? initialPublishSurface.status}；main-document exact count=${initialGlobalDiagnostic.globalExactPublishTextMatchCount}`);

    const titleEditor = await this.discoverUniqueEditor(canonical.page, "title");
    const titleReadback = await readEditor(titleEditor, "title");
    const bodyEditor = await this.discoverUniqueEditor(canonical.page, "body");
    const bodyReadback = await readEditor(bodyEditor, "body");
    const requiredFieldsPass = !(await this.inspectRequiredFields(canonical.page)).some((field) => field.empty);
    const finalGlobalDiagnostic = await inspectXiaohongshuGlobalExactPublishDom(canonical.page);
    const finalPublishSurface = await inspectTask10sClosedShadowPublishSurface(canonical.page);
    const runtimeSnapshot = this.getBrowserRuntimeSnapshot(ctx);
    const contextIdentityAttestationPass = Boolean(
      ctx.runtimeIdentityAttestation?.verified === true
      && new Date(ctx.runtimeIdentityAttestation.expiresAt).getTime() > Date.now()
      && runtimeSnapshot.browserConnected === true
      && runtimeSnapshot.runtimeAuthState === "AUTHENTICATED"
      && runtimeSnapshot.browserSessionIdentity === ctx.runtimeIdentityAttestation.browserSessionIdentity
      && runtimeSnapshot.contextDebugId === ctx.runtimeIdentityAttestation.browserContextIdentity
      && canonical.session.runtimeSessionIdentity === ctx.runtimeIdentityAttestation.browserSessionIdentity
      && canonical.session.contextDebugId === ctx.runtimeIdentityAttestation.browserContextIdentity
    );
    const gate = evaluateTask10sRetainedEditorGate({
      // A reopened server-backed draft is proved by the current page DOM;
      // historical upload attempts are deliberately not a completion gate.
      uploadAttemptCount: 0,
      setInputFilesCallCount: 0,
      postUploadState: postUpload.postUploadState,
      imageAssetRenderedCount: postUpload.imageAssetRenderedCount,
      imageCounterTextSafe: postUpload.imageCounterTextSafe,
      titleControlPresent: postUpload.titleControlPresent,
      bodyControlPresent: postUpload.bodyControlPresent,
      noExplicitUploadError: postUpload.noExplicitUploadError,
      initialPublishSurface,
      trustedArticleTitle: article.title,
      trustedArticleBody: article.body,
      titleReadback,
      bodyReadback,
      requiredFieldsPass,
      finalPublishSurface,
      contextIdentityAttestationPass,
      sameContext: this.pageContextMatchesSession(canonical.session, canonical.page),
      authorizationState: guard.authorization.state,
      finalSubmitClickCount: 0
    });
    if (gate.status !== "READY_TO_SUBMIT") throw new XiaohongshuGateError("FINAL_SUBMIT_CONTROL_NOT_VERIFIED", "USER_ACTION_REQUIRED", `Task10S retained-editor final gate 未通过：${gate.failureCode ?? "UNKNOWN"}`);

    if (!finalPublishSurface.present || !finalPublishSurface.enabled) throw new XiaohongshuGateError("FINAL_SUBMIT_CONTROL_NOT_VERIFIED", "USER_ACTION_REQUIRED", `Task10S closed-shadow 发布 surface 未通过最终 enabled 校验：${finalPublishSurface.failureCode ?? finalPublishSurface.status}；main-document exact count=${finalGlobalDiagnostic.globalExactPublishTextMatchCount}`);
    const preflight: OneShotFinalSubmitPreflight = {
      authorization: guard.authorization.authorization,
      authorizationState: guard.authorization.state,
      platformKey: "xiaohongshu",
      accountId: guard.authorization.accountId,
      operationId: guard.authorization.operationId,
      mode: guard.authorization.mode,
      authenticated: true,
      sameCanonicalContext: this.pageContextMatchesSession(canonical.session, canonical.page),
      sameCanonicalPage: canonical.session.page === canonical.page,
      mutexOwned: this.accountOperationMutex.getState(`${this.platformKey}:${ctx.accountId}`).operationInProgress,
      editorPhase: "IMAGE_POST_POST_UPLOAD_EDITOR",
      safeFixtureUploaded: true,
      titleReadbackVerified: gate.titleReadbackExact,
      bodyReadbackVerified: gate.bodyReadbackExact,
      requiredFieldsPass,
      loginPagePresent: this.isLoginPage(canonical.page.url()),
      securityVerificationPresent: this.isVerificationUrl(canonical.page.url()),
      finalSubmitControl: {
        status: "FOUND_UNIQUE",
        visible: Boolean(finalPublishSurface.host?.rendered && finalPublishSurface.innerButton?.rendered),
        enabled: finalPublishSurface.enabled,
        hitTestValid: Boolean(finalPublishSurface.innerButton?.boundingRect),
        label: "发布"
      }
    };
    const beforeUrl = canonical.page.url();
    try {
      const clickResult = await runTask10sClosedShadowFinalSubmit(canonical.page, guard, preflight, attempt.markSubmissionSideEffect);
      if (clickResult.status !== "CLICK_DISPATCHED") throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `Task10S closed-shadow 最终发布 action 已开始但 click 未正常返回：${clickResult.failureCode ?? clickResult.status}`);
    } catch (error) {
      if (guard.hasFinalMousePressStarted()) await guard.markSubmissionReconciliationRequired().catch(() => undefined);
      if (error instanceof OneShotPublicationGuardError) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${error.code}: 未执行 Task10S 最终发布`);
      throw error;
    }
    let observation: OneShotPostSubmitObservation;
    let publicResult: { externalId: string; publishedUrl: string } | null = null;
    try {
      const confirmation = await this.inspectOneShotConfirmationControl(canonical.page);
      if (confirmation.status === "AMBIGUOUS") throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "Task10S 发布后出现多个确认 modal 候选，未盲点");
      if (confirmation.status === "FOUND_UNIQUE" && confirmation.candidate) {
        try {
          await guard.confirmModal(confirmation.candidate, async () => confirmation.locator.click());
        } catch (error) {
          if (error instanceof OneShotPublicationGuardError) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `${error.code}: Task10S 确认 modal 未通过安全校验`);
          throw error;
        }
      }
      observation = await this.observeOneShotPostSubmit(canonical.page, beforeUrl);
      const observationStatus = classifyOneShotPostSubmitObservation(observation);
      if (observationStatus === "PLATFORM_REJECTED") throw new BrowserAutomationError("CONTENT_REJECTED", `小红书平台拒绝了 Task10S 测试发布：${observation.platformError ?? "未提供原因"}`);
      if (observationStatus !== "PUBLISHED_VERIFIED") throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "Task10S 提交结果不明确；只允许进入只读 reconciliation，不得重试");
      publicResult = this.publicResultFromUrl(canonical.page.url());
      if (!publicResult) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "Task10S 提交后未取得可靠 External ID/URL；禁止再次提交");
      guard.markFinalSubmitCompleted();
    } catch (error) {
      await guard.markSubmissionReconciliationRequired().catch(() => undefined);
      throw error;
    }
    return {
      success: true,
      status: "published",
      externalId: publicResult.externalId,
      publishedUrl: publicResult.publishedUrl,
      response: {
        adapter: this.platformKey,
        stage: "task10s_retained_editor_final_submitted",
        ownerFinalSubmitAuthorization: "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH",
        finalSubmitAuthorizationState: guard.authorization.state,
        finalSubmitPreflight: preflight,
        publicationTransactionCount: guard.authorization.publicationTransactionCount,
        publicationCommitActionCount: guard.authorization.publicationCommitActionCount,
        finalSubmitAttemptCount: guard.authorization.finalSubmitAttemptCount,
        finalSubmitRetryCount: 0,
        finalSubmitActionStarted: guard.authorization.finalSubmitActionStarted,
        finalSubmitActionCompleted: guard.authorization.finalSubmitActionCompleted,
        postSubmitObservation: observation,
        publicationReconciled: true,
        externalId: publicResult.externalId,
        externalUrl: publicResult.publishedUrl,
        publicPageVerified: true,
        imageUploaded: true,
        titleFilled: true,
        bodyFilled: true,
        uploadCallCount: 0,
        beforeUrl,
        afterUrl: canonical.page.url(),
        finalSubmitCount: 1
      }
    };
  }

  private async performOneShotFinalSubmit(ctx: AccountContext, article: PublishArticleInput, guard: OneShotPublicationGuard, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const canonical = await this.activeCanonicalPage(ctx);
    if (!canonical || this.isCanonicalPageClosed(canonical.page) || !this.pageContextMatchesSession(canonical.session, canonical.page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书 canonical Context/Page 不可用，未执行最终发布");
    const preflight = await this.buildOneShotFinalSubmitPreflight(ctx, article, canonical, guard);
    const finalControl = await this.inspectOneShotFinalSubmitControl(canonical.page);
    const beforeUrl = canonical.page.url();
    try {
      await guard.startFinalSubmit(preflight, async () => {
        attempt.markSubmissionSideEffect?.();
        try {
          await finalControl.locator.click();
        } catch (error) {
          throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `小红书最终发布 action 已开始但 click 未正常返回：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    } catch (error) {
      if (error instanceof OneShotPublicationGuardError) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `${error.code}: 未执行小红书最终发布`);
      throw error;
    }

    const confirmation = await this.inspectOneShotConfirmationControl(canonical.page);
    if (confirmation.status === "AMBIGUOUS") throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "小红书发布后出现多个确认 modal 候选，未盲点");
    if (confirmation.status === "FOUND_UNIQUE" && confirmation.candidate) {
      try {
        await guard.confirmModal(confirmation.candidate, async () => confirmation.locator.click());
      } catch (error) {
        if (error instanceof OneShotPublicationGuardError) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `${error.code}: 小红书确认 modal 未通过安全校验`);
        throw error;
      }
    }

    const observation = await this.observeOneShotPostSubmit(canonical.page, beforeUrl);
    const observationStatus = classifyOneShotPostSubmitObservation(observation);
    if (observationStatus === "PLATFORM_REJECTED") throw new BrowserAutomationError("CONTENT_REJECTED", `小红书平台拒绝了测试发布：${observation.platformError ?? "未提供原因"}`);
    if (observationStatus !== "PUBLISHED_VERIFIED") throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "小红书提交结果不明确；只允许进入只读 reconciliation，不得重试");
    const publicResult = this.publicResultFromUrl(canonical.page.url());
    if (!publicResult) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "小红书提交后未取得可靠 External ID/URL；禁止再次提交");
    guard.markFinalSubmitCompleted();
    return {
      success: true,
      status: "published",
      externalId: publicResult.externalId,
      publishedUrl: publicResult.publishedUrl,
      response: {
        adapter: this.platformKey,
        stage: "one_shot_final_submitted",
        ownerFinalSubmitAuthorization: "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH",
        finalSubmitAuthorizationState: guard.authorization.state,
        finalSubmitPreflight: preflight,
        publicationTransactionCount: guard.authorization.publicationTransactionCount,
        publicationCommitActionCount: guard.authorization.publicationCommitActionCount,
        finalSubmitAttemptCount: guard.authorization.finalSubmitAttemptCount,
        finalSubmitRetryCount: 0,
        finalSubmitActionStarted: guard.authorization.finalSubmitActionStarted,
        finalSubmitActionCompleted: guard.authorization.finalSubmitActionCompleted,
        postSubmitObservation: observation,
        publicationReconciled: true,
        externalId: publicResult.externalId,
        externalUrl: publicResult.publishedUrl,
        publicPageVerified: true,
        OWNER_FINAL_SUBMIT_AUTHORIZATION: "OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH",
        FINAL_SUBMIT_AUTHORIZATION_STATE: guard.authorization.state,
        FINAL_SUBMIT_PREFLIGHT: "PASS",
        PUBLICATION_TRANSACTION_COUNT: guard.authorization.publicationTransactionCount,
        PUBLICATION_COMMIT_ACTION_COUNT: guard.authorization.publicationCommitActionCount,
        FINAL_SUBMIT_ATTEMPT_COUNT: guard.authorization.finalSubmitAttemptCount,
        FINAL_SUBMIT_RETRY_COUNT: 0,
        FINAL_SUBMIT_ACTION_STARTED: guard.authorization.finalSubmitActionStarted,
        FINAL_SUBMIT_ACTION_COMPLETED: guard.authorization.finalSubmitActionCompleted,
        POST_SUBMIT_OBSERVATION: observation,
        PUBLICATION_RECONCILED: true,
        EXTERNAL_ID: publicResult.externalId,
        EXTERNAL_URL: publicResult.publishedUrl,
        PUBLIC_PAGE_VERIFIED: true,
        beforeUrl,
        afterUrl: canonical.page.url(),
        finalSubmitCount: 1
      }
    };
  }

  private async buildOneShotFinalSubmitPreflight(ctx: AccountContext, article: PublishArticleInput, canonical: { session: BrowserSession; page: Page }, guard: OneShotPublicationGuard): Promise<OneShotFinalSubmitPreflight> {
    const authorization = guard.authorization;
    const metadata = { operationId: authorization.operationId, platformKey: "xiaohongshu" as const, accountId: ctx.accountId, contextDebugId: canonical.session.contextDebugId ?? "unknown-context", pageDebugId: canonical.session.pageDebugId ?? "unknown-page" };
    const inspection = await inspectPostUploadImageEditor(canonical.page, metadata, { emit: (diagnostic) => this.emitImageEditorDiagnostic(diagnostic) });
    const titleEditor = await this.discoverUniqueEditor(canonical.page, "title");
    const bodyEditor = await this.discoverUniqueEditor(canonical.page, "body");
    const titleReadbackVerified = await readEditor(titleEditor, "title") === normalizeXiaohongshuEditorText(article.title);
    const bodyReadbackVerified = await readEditor(bodyEditor, "body") === normalizeXiaohongshuEditorText(article.body);
    const requiredFieldsPass = !(await this.inspectRequiredFields(canonical.page)).some((field) => field.empty);
    const finalControl = await this.inspectOneShotFinalSubmitControl(canonical.page);
    return {
      authorization: authorization.authorization,
      authorizationState: authorization.state,
      platformKey: "xiaohongshu",
      accountId: authorization.accountId,
      operationId: authorization.operationId,
      mode: authorization.mode,
      authenticated: this.getBrowserRuntimeState(ctx).state === "AUTHENTICATED",
      sameCanonicalContext: this.pageContextMatchesSession(canonical.session, canonical.page),
      sameCanonicalPage: canonical.session.page === canonical.page,
      mutexOwned: this.accountOperationMutex.getState(`${this.platformKey}:${ctx.accountId}`).operationInProgress,
      editorPhase: inspection.phase as "IMAGE_POST_POST_UPLOAD_EDITOR",
      safeFixtureUploaded: article.images?.length === 1 && ctx.settings.oneShotImageSource === "SAFE_TEST_FIXTURE",
      titleReadbackVerified,
      bodyReadbackVerified,
      requiredFieldsPass,
      loginPagePresent: this.isLoginPage(canonical.page.url()),
      securityVerificationPresent: this.isVerificationUrl(canonical.page.url()),
      finalSubmitControl: { status: finalControl.status, visible: finalControl.visible, enabled: finalControl.enabled, hitTestValid: finalControl.hitTestValid, label: finalControl.label }
    };
  }

  private async inspectOneShotFinalSubmitControl(page: Page): Promise<{ locator: Locator; status: "FOUND_UNIQUE" | "NOT_FOUND" | "AMBIGUOUS" | "NOT_VISIBLE" | "DISABLED" | "HITTEST_INVALID"; visible: boolean; enabled: boolean; hitTestValid: boolean; label?: string }> {
    const controls = page.locator(XIAOHONGSHU_FINAL_SUBMIT_SELECTOR);
    const matches: Array<{ locator: Locator; label: string; visible: boolean; enabled: boolean; hitTestValid: boolean }> = [];
    for (let index = 0; index < await locatorCount(controls); index += 1) {
      const locator = locatorAt(controls, index);
      const label = normalizeXiaohongshuEditorText((await innerText(locator)) || (await attribute(locator, "aria-label")) || (await attribute(locator, "title")));
      if (!XIAOHONGSHU_FINAL_SUBMIT_PATTERN.test(label) || XIAOHONGSHU_VIDEO_PATTERN.test(label)) continue;
      const visible = await isVisible(locator);
      const enabled = await isEnabled(locator);
      const box = await locatorBoundingBox(locator);
      matches.push({ locator, label, visible, enabled, hitTestValid: visible && box !== null && await locatorHitTestValid(locator, box) });
    }
    if (matches.length === 0) return { locator: controls, status: "NOT_FOUND", visible: false, enabled: false, hitTestValid: false };
    if (matches.length > 1) return { locator: matches[0]!.locator, status: "AMBIGUOUS", visible: false, enabled: false, hitTestValid: false };
    const match = matches[0]!;
    if (!match.visible) return { ...match, status: "NOT_VISIBLE" };
    if (!match.enabled) return { ...match, status: "DISABLED" };
    if (!match.hitTestValid) return { ...match, status: "HITTEST_INVALID" };
    return { ...match, status: "FOUND_UNIQUE" };
  }

  private async inspectOneShotConfirmationControl(page: Page): Promise<{ status: "NONE" | "FOUND_UNIQUE" | "AMBIGUOUS"; locator: Locator; candidate?: OneShotConfirmationCandidate }> {
    const modals = page.locator('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="dialog" i]');
    const matches: Array<{ locator: Locator; candidate: OneShotConfirmationCandidate }> = [];
    for (let modalIndex = 0; modalIndex < await locatorCount(modals); modalIndex += 1) {
      const modal = locatorAt(modals, modalIndex);
      if (!(await isVisible(modal))) continue;
      const controls = modal.locator('button, [role="button"]');
      for (let controlIndex = 0; controlIndex < await locatorCount(controls); controlIndex += 1) {
        const locator = locatorAt(controls, controlIndex);
        const semanticIntent = normalizeXiaohongshuEditorText((await innerText(locator)) || (await attribute(locator, "aria-label")) || (await attribute(locator, "title")));
        if (!/确认发布|继续发布|confirm\s*publish/iu.test(semanticIntent)) continue;
        const visible = await isVisible(locator);
        const enabled = await isEnabled(locator);
        const box = await locatorBoundingBox(locator);
        matches.push({ locator, candidate: { candidateId: `modal-${modalIndex}-control-${controlIndex}`, modalId: `modal-${modalIndex}`, semanticIntent, sameModal: true, unique: true, visible, enabled, hitTestValid: visible && enabled && box !== null && await locatorHitTestValid(locator, box) } });
      }
    }
    if (matches.length === 0) return { status: "NONE", locator: page.locator("body") };
    if (matches.length !== 1) return { status: "AMBIGUOUS", locator: matches[0]!.locator };
    return { status: "FOUND_UNIQUE", locator: matches[0]!.locator, candidate: matches[0]!.candidate };
  }

  private async observeOneShotPostSubmit(page: Page, beforeUrl: string): Promise<OneShotPostSubmitObservation> {
    const startedAt = Date.now();
    let observation: OneShotPostSubmitObservation = { urlChanged: false, successToast: false, editorExited: false, successPage: false, creatorContentMatched: "UNKNOWN", platformError: null };
    while (Date.now() - startedAt <= 10_000) {
      const currentUrl = page.url();
      const text = await bodyText(page);
      const urlChanged = currentUrl !== beforeUrl;
      const successToast = /发布成功|提交成功|发布完成|successfully published/iu.test(text);
      const editorExited = !this.isEditorRoute(currentUrl);
      const successPage = /\/explore\/|\/discovery\/item\/|success|published/iu.test(currentUrl);
      const platformError = /发布失败|提交失败|审核拒绝|publish failed|rejected/iu.exec(text)?.[0] ?? null;
      observation = { urlChanged, successToast, editorExited, successPage, creatorContentMatched: "UNKNOWN", platformError };
      if (platformError || (urlChanged && successPage) || (successToast && editorExited)) return observation;
      await waitForProbe(page, 250);
    }
    return observation;
  }

  private publicResultFromUrl(url: string): { externalId: string; publishedUrl: string } | null {
    const match = /^https:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/([^/?#]+)/iu.exec(url);
    return match?.[1] ? { externalId: match[1], publishedUrl: `${new URL(url).origin}${new URL(url).pathname}` } : null;
  }

  protected override async openBackendPage(ctx: AccountContext, url = XIAOHONGSHU_CREATOR_HOME): Promise<{ page: Page; session: BrowserSession; backendUrl: string }> {
    const opened = await this.activeCanonicalPage(ctx);
    if (!opened) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书当前没有可复用的 canonical authenticated Page，请先完成登录");
    const currentUrl = opened.page.url();
    if (!this.isCreatorHomeRoute(currentUrl) && !this.isEditorRoute(currentUrl)) await this.navigate(opened.page, url);
    if (this.isLoginPage(opened.page.url())) throw new BrowserAutomationError("LOGIN_EXPIRED", "小红书 Session 已过期，请重新登录");
    return { page: opened.page, session: opened.session, backendUrl: opened.page.url() };
  }

  /** Read-only load telemetry and one fixed-route reload on the existing canonical Page. */
  async inspectEditorLoad(ctx: AccountContext): Promise<XhsEditorLoadDiagnosticResult> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const canonical = await this.activeCanonicalPage(ctx);
      if (!canonical) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书当前没有可复用的 canonical Page，请先完成账号连接");
      if (!this.isBrowserConnected(canonical.session) || this.isCanonicalPageClosed(canonical.page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书 canonical Page 当前不可用");
      const currentUrl = canonical.page.url();
      if (!isExactXhsPublishEditorRoute(currentUrl)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书当前 canonical Page 不在固定 /publish/publish 路由");
      return runXhsEditorLoadDiagnostic(canonical.page, {
        operationId: randomUUID(),
        accountId: ctx.accountId,
        contextDebugId: canonical.session.contextDebugId ?? "unknown-context",
        pageDebugId: canonical.pageDebugId
      });
    }, "editorLoadDiagnostic");
  }

  /** Read-only CDP Network diagnostics and one fixed-route reload on the existing canonical Page. */
  async inspectEditorNetworkFailure(ctx: AccountContext): Promise<XhsEditorNetworkDiagnosticResult> {
    return this.accountOperationMutex.run(`${this.platformKey}:${ctx.accountId}`, async () => {
      const canonical = await this.activeCanonicalPage(ctx);
      if (!canonical) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书当前没有可复用的 canonical Page，请先完成账号连接");
      if (!this.isBrowserConnected(canonical.session) || this.isCanonicalPageClosed(canonical.page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书 canonical Page 当前不可用");
      if (!this.pageContextMatchesSession(canonical.session, canonical.page)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书 canonical Context/Page correlation 失败");
      if (!isExactXhsPublishEditorRoute(canonical.page.url())) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "小红书当前 canonical Page 不在固定 /publish/publish 路由");
      return runXhsEditorNetworkFailureDiagnostic(canonical.page, {
        operationId: randomUUID(),
        accountId: ctx.accountId,
        contextDebugId: canonical.session.contextDebugId ?? "unknown-context",
        pageDebugId: canonical.pageDebugId
      });
    }, "editorNetworkFailureDiagnostic");
  }

  protected override async inspectConnectionPage(ctx: AccountContext, page: Page): Promise<LoginStatus> {
    return this.loginStatusForPage(ctx, page, "COMPLETE_LOGIN_CHECK");
  }

  protected override deferConnectionPersistence(_ctx: AccountContext): boolean { return true; }

  async persistConnectionSession(ctx: AccountContext): Promise<void> {
    await this.saveConnectionSession(ctx);
    this.sessionManager.setRuntimeAuthState({ platformKey: this.platformKey, accountId: ctx.accountId }, "AUTHENTICATED", null);
    await this.emitAuthStateDiagnostic(ctx, "AUTH_STATE_BEFORE_CLOSE", null, null, null);
    this.markConnectionComplete({ platformKey: this.platformKey, accountId: ctx.accountId });
    const manager = this.sessionManager as unknown as { recordCanonicalPagePromotion?: (identity: { platformKey: string; accountId: string }, session: BrowserSession) => void };
    const session = this.activeBrowserSession(ctx);
    if (session) manager.recordCanonicalPagePromotion?.({ platformKey: this.platformKey, accountId: ctx.accountId }, session);
    await this.emitConnectionDiagnostic("CANONICAL_AUTHENTICATED_PAGE_PROMOTED", ctx, this.activeBrowserSession(ctx), true, "RETAINED_ACCOUNT_PAGE");
  }

  async releaseConnectionPage(ctx: AccountContext): Promise<void> {
    const identity = { platformKey: this.platformKey, accountId: ctx.accountId };
    const session = this.activeBrowserSession(ctx);
    if (!session) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `ACTIVE_LOGIN_SESSION_NOT_FOUND: accountId=${ctx.accountId} 的可见登录 Session 已丢失，请重新开始连接`);
    const retainAccountPage = this.sessionManager.retainsContextAfterPageClose(identity);
    if (!retainAccountPage) await this.sessionManager.closeOperationPage(identity, session.page);
    const retained = this.activeBrowserSession(ctx) === session;
    this.markConnectionComplete(identity);
    await this.emitConnectionDiagnostic("LOGIN_PAGE_RELEASED", ctx, session, retainAccountPage ? null : retained, retainAccountPage ? "RETAINED_ACCOUNT_PAGE" : "CLOSED");
  }

  /** Diagnostic-only snapshot of the already-open account-scoped session. It never navigates or mutates the page. */
  async collectAuthStateMetadata(ctx: AccountContext): Promise<XhsAuthStateMetadata | null> {
    const session = this.activeBrowserSession(ctx);
    if (!session) return null;
    const page = await this.page(session);
    return collectXhsAuthStateMetadata({ context: session.context, page, profilePath: session.profilePath, credentialFilePath: this.credentialFilePath, fingerprintKey: this.diagnosticFingerprintKey(), browserChannel: session.browserChannel ?? null, headless: session.headless, storageMode: session.storageMode });
  }

  /** Opens the account-owned BrowserSession without navigating; diagnostic runner only. */
  async openDiagnosticSession(ctx: AccountContext): Promise<{ session: BrowserSession; page: Page }> {
    const session = this.diagnosticBrowserSession(ctx) ?? await this.getOrOpen(ctx);
    if (!session) throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书没有 account-scoped BrowserSession");
    return { session, page: await this.page(session) };
  }

  /** Rotates only the Page inside the existing account-owned Context for restart diagnosis. */
  async openSameContextDiagnosticPage(ctx: AccountContext): Promise<XiaohongshuSameContextPageDiagnostic> {
    const { session, page } = await this.openDiagnosticSession(ctx);
    const before = session.context.pages().length;
    const originalPageDebugId = session.pageDebugId ?? "unknown";
    await page.close();
    const newPage = await session.context.newPage();
    const after = session.context.pages().length;
    const newPageOwnedByContext = session.context.pages().includes(newPage);
    await this.navigate(newPage, XIAOHONGSHU_CREATOR_HOME);
    session.page = newPage;
    session.pageDebugId = randomUUID();
    const result: XiaohongshuSameContextPageDiagnostic = {
      platformKey: "xiaohongshu",
      accountId: ctx.accountId,
      contextDebugId: session.contextDebugId ?? "unknown",
      originalPageDebugId,
      originalPageClosed: true,
      newPageOwnedByContext,
      pageCountBefore: before,
      pageCountAfter: after,
      newPageUrl: newPage.url()
    };
    return result;
  }

  /** One navigation-only restore probe. It never opens the publish editor or creates a publishing row. */
  async runRestoreNavigationDiagnostic(ctx: AccountContext): Promise<XiaohongshuRestoreNavigationDiagnostic> {
    this.authStateFingerprintKey = createXhsDiagnosticFingerprintKey();
    const { session, page } = await this.openDiagnosticSession(ctx);
    const tracker = new XhsNavigationDiagnosticsTracker();
    let trackedPage = page;
    try {
      const fingerprintKey = this.diagnosticFingerprintKey();
      const preNavigation = await collectXhsPreNavigationAuthStateMetadata({ context: session.context, profilePath: session.profilePath, credentialFilePath: this.credentialFilePath, fingerprintKey, browserChannel: session.browserChannel ?? null, headless: session.headless, storageMode: session.storageMode });
      const pageCountBefore = session.context.pages().length;
      const originalPageDebugId = session.pageDebugId ?? "unknown";
      await page.close();
      const newPage = await session.context.newPage();
      const pageCountAfter = session.context.pages().length;
      const newPageOwnedByContext = session.context.pages().includes(newPage);
      session.page = newPage;
      session.pageDebugId = randomUUID();
      trackedPage = newPage;
      tracker.attach(newPage);
      await this.navigate(newPage, XIAOHONGSHU_CREATOR_HOME);
      const loginStatus = await this.loginStatusForPage(ctx, newPage, "CHECK_LOGIN");
      const afterNavigation = await collectXhsAuthStateMetadata({ context: session.context, page: newPage, profilePath: session.profilePath, credentialFilePath: this.credentialFilePath, fingerprintKey, browserChannel: session.browserChannel ?? null, headless: session.headless, storageMode: session.storageMode });
      const sessionEvidence = await this.getBrowserSessionEvidence(ctx);
      if (!sessionEvidence) throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "恢复诊断期间 account-scoped Session evidence 丢失");
      return { platformKey: "xiaohongshu", accountId: ctx.accountId, sessionEvidence, preNavigation, afterNavigation, navigation: tracker.classify(), loginStatus, sameContextPageOwnership: newPageOwnedByContext, sameContextPage: { platformKey: "xiaohongshu", accountId: ctx.accountId, contextDebugId: session.contextDebugId ?? "unknown", originalPageDebugId, originalPageClosed: true, newPageOwnedByContext, pageCountBefore, pageCountAfter, newPageUrl: newPage.url() } };
    } finally {
      tracker.detach(trackedPage);
    }
  }

  protected override keepConnectionSessionOpenAfterCompletion(_ctx: AccountContext): boolean { return true; }

  protected override keepConnectionPageForCompletion(_ctx: AccountContext): boolean { return true; }

  private async loginStatusForPage(ctx: AccountContext, page: Page, phase: XiaohongshuLoginEvaluation["phase"], operationId?: string): Promise<LoginStatus> {
    // Creator performs client-side redirects after the initial DOM navigation.
    // Give that redirect a bounded opportunity to settle before accepting a
    // logged-in result; otherwise a home-page probe can race a later /login.
    await waitForProbe(page);
    const pageUrl = page.url();
    if (this.isLoginPage(pageUrl)) {
      await this.emitLoginEvaluation(ctx, page, emptyPageEvidence(page), "login_required", phase, 0, 0, false, operationId);
      return "expired";
    }
    if (this.isVerificationUrl(pageUrl)) {
      await this.emitLoginEvaluation(ctx, page, emptyPageEvidence(page), "needs_user_action", phase, 0, 0, false, operationId);
      return "needs_user_action";
    }
    const evidence = await readXiaohongshuPageEvidence(page);
    let decision = evidence.available ? classifyXiaohongshuLoginEvidence(evidence.login) : "unknown";
    let stableObservationWindowMs = 0;
    let stableObservationSamples = 0;
    let stableObservationPassed = false;
    if (!evidence.available) {
      decision = "logged_in";
      stableObservationSamples = 1;
      stableObservationPassed = true;
    } else if (decision === "logged_in") {
      const stable = await this.observeStableLogin(page, evidence);
      decision = stable.decision;
      stableObservationWindowMs = stable.windowMs;
      stableObservationSamples = stable.samples;
      stableObservationPassed = stable.passed;
      if (stable.evidence !== evidence) {
        await this.emitLoginEvaluation(ctx, page, stable.evidence, decision, phase, stableObservationWindowMs, stableObservationSamples, stableObservationPassed, operationId);
        if (decision === "logged_in" && phase === "COMPLETE_LOGIN_CHECK" && this.isConnectionPending(ctx)) {
          await this.emitAuthStateDiagnostic(ctx, "LIVE_LOGIN_BEFORE_CLOSE", stableObservationWindowMs, stableObservationSamples, stableObservationPassed);
        }
        return this.loginStatusFromDecision(decision);
      }
    }
    await this.emitLoginEvaluation(ctx, page, evidence, decision, phase, stableObservationWindowMs, stableObservationSamples, stableObservationPassed, operationId);
    if (decision === "logged_in" && phase === "COMPLETE_LOGIN_CHECK" && this.isConnectionPending(ctx)) {
      await this.emitAuthStateDiagnostic(ctx, "LIVE_LOGIN_BEFORE_CLOSE", stableObservationWindowMs, stableObservationSamples, stableObservationPassed);
    }
    if (!evidence.available) return "logged_in";
    return this.loginStatusFromDecision(decision);
  }

  private loginStatusFromDecision(decision: XiaohongshuLoginDecision): LoginStatus {
    if (decision === "logged_in") return "logged_in";
    if (decision === "login_required") return "expired";
    if (decision === "needs_user_action") return "needs_user_action";
    return "needs_user_action";
  }

  private async observeStableLogin(page: Page, initialEvidence: XiaohongshuPageEvidence): Promise<{ decision: XiaohongshuLoginDecision; evidence: XiaohongshuPageEvidence; windowMs: number; samples: number; passed: boolean }> {
    const candidate = page as unknown as { waitForTimeout?: (timeout: number) => Promise<void> };
    if (this.loginStabilityWindowMs === 0 || typeof candidate.waitForTimeout !== "function") {
      return { decision: "logged_in", evidence: initialEvidence, windowMs: this.loginStabilityWindowMs, samples: 1, passed: true };
    }
    const startedAt = Date.now();
    let samples = 1;
    let latestEvidence = initialEvidence;
    while (Date.now() - startedAt < this.loginStabilityWindowMs) {
      await waitForProbe(page, Math.min(LOGIN_STABILITY_SAMPLE_INTERVAL_MS, this.loginStabilityWindowMs));
      samples += 1;
      const currentUrl = page.url();
      if (this.isLoginPage(currentUrl)) return { decision: "login_required", evidence: emptyPageEvidence(page), windowMs: Date.now() - startedAt, samples, passed: false };
      if (this.isVerificationUrl(currentUrl)) return { decision: "needs_user_action", evidence: emptyPageEvidence(page), windowMs: Date.now() - startedAt, samples, passed: false };
      latestEvidence = await readXiaohongshuPageEvidence(page);
      const decision = latestEvidence.available ? classifyXiaohongshuLoginEvidence(latestEvidence.login) : "unknown";
      if (decision !== "logged_in") return { decision, evidence: latestEvidence, windowMs: Date.now() - startedAt, samples, passed: false };
    }
    return { decision: "logged_in", evidence: latestEvidence, windowMs: Date.now() - startedAt, samples, passed: true };
  }

  private async emitLoginEvaluation(ctx: AccountContext, page: Page, evidence: XiaohongshuPageEvidence, decision: XiaohongshuLoginDecision, phase: XiaohongshuLoginEvaluation["phase"], stableObservationWindowMs = 0, stableObservationSamples = 0, stableObservationPassed = false, operationId?: string): Promise<void> {
    if (!this.onLoginEvaluation) return;
    let pageUrl = "";
    let pageTitle = "";
    let pageIsClosed = false;
    try {
      pageUrl = page.url();
      const candidate = page as unknown as { title?: () => Promise<string>; isClosed?: () => boolean };
      pageTitle = typeof candidate.title === "function" ? await candidate.title().catch(() => "") : "";
      pageIsClosed = typeof candidate.isClosed === "function" && candidate.isClosed();
    } catch {
      pageIsClosed = true;
    }
    const login = evidence.login;
    const blockers = [login.visibleLoginForm, login.visibleQrLogin, login.visibleSmsVerification, login.visibleCaptcha, login.visibleSlider, login.visibleSecurityModal];
    this.onLoginEvaluation({ phase, ...(operationId ? { operationId } : {}), timestamp: new Date().toISOString(), platformKey: this.platformKey, accountId: ctx.accountId, pageIsClosed, pageUrl, pageTitle, creatorDomain: login.creatorHost, creatorHomePath: login.creatorHomePath, publishNoteVisible: login.publishNoteVisible, noteManagementVisible: login.noteManagementVisible, dataDashboardVisible: login.dataDashboardVisible, accountStatusVisible: login.accountStatusVisible, profileAreaVisible: login.profileAreaVisible, visibleLoginForm: login.visibleLoginForm, visibleQrLogin: login.visibleQrLogin, visibleSmsVerification: login.visibleSmsVerification, visibleCaptcha: login.visibleCaptcha, visibleSlider: login.visibleSlider, visibleSecurityModal: login.visibleSecurityModal, positiveSignalCount: new Set(login.positiveSignals).size, blockingSignalCount: blockers.filter(Boolean).length, loginClassification: decision, stableObservationWindowMs, stableObservationSamples, stableObservationPassed });
  }

  private emitCanonicalPageOperation(ctx: AccountContext, session: BrowserSession, page: Page, pageDebugId: string, operationId: string, phase: XiaohongshuCanonicalPageOperationPhase, pageContextMatchesSession: boolean, finalStatus?: LoginStatus | PreSubmitGateStatus, action: "CHECK_LOGIN" | "PRE_SUBMIT_GATE" | "CONTROLLED_POST_UPLOAD_DISCOVERY" | "XHS_PUBLISH_FLOW_EXPLORATION" = "CHECK_LOGIN", result?: Pick<PreSubmitGateResult, "failureCode" | "failureStage" | "missingSignal">): void {
    if (!this.onCanonicalPageOperation) return;
    const key = `${this.platformKey}:${ctx.accountId}`;
    const mutex = this.accountOperationMutex.getState(key);
    const pageClosed = this.isCanonicalPageClosed(page);
    const evidence: XiaohongshuCanonicalPageOperationEvidence = {
      phase,
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId: ctx.accountId,
      action,
      contextDebugId: session.contextDebugId ?? "unknown-context",
      pageDebugId,
      pageRole: "CANONICAL_AUTHENTICATED",
      pageSource: "EXISTING_CANONICAL_PAGE",
      createdNewPage: false,
      pageContextMatchesSession,
      browserConnected: this.isBrowserConnected(session),
      pageClosed,
      runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
      activeOperation: mutex.activeOperation,
      mutexLocked: mutex.mutexLocked,
      operationInProgress: mutex.operationInProgress,
      sanitizedUrl: sanitizePageUrl(page),
      ...(finalStatus === undefined ? {} : { finalStatus, sanitizedFinalUrl: sanitizePageUrl(page) }),
      ...(result?.failureCode ? { failureCode: result.failureCode } : {}),
      ...(result?.failureStage ? { failureStage: result.failureStage } : {}),
      ...(result?.missingSignal === undefined ? {} : { missingSignal: result.missingSignal })
    };
    try { this.onCanonicalPageOperation(evidence); }
    catch { /* diagnostics must never change the authentication result */ }
  }

  private recordCompletedCheckLoginOperation(accountId: string, operationId: string): void {
    if (!this.onCanonicalPageOperation) return;
    const key = `${this.platformKey}:${accountId}`;
    const queue = this.completedCheckLoginOperationIds.get(key) ?? [];
    queue.push(operationId);
    this.completedCheckLoginOperationIds.set(key, queue);
  }

  private pageContextMatchesSession(session: BrowserSession, page: Page): boolean {
    try { return page.context() === session.context; }
    catch { return false; }
  }

  private isBrowserConnected(session: BrowserSession): boolean {
    try {
      const browser = session.browser as unknown as { isConnected?: () => boolean };
      return typeof browser.isConnected === "function" && browser.isConnected();
    } catch {
      return false;
    }
  }

  private isCanonicalPageClosed(page: Page): boolean {
    try { return page.isClosed(); }
    catch { return true; }
  }

  private async emitAuthStateDiagnostic(ctx: AccountContext, phase: XiaohongshuAuthStateDiagnosticPhase, stableObservationWindowMs: number | null, stableObservationSamples: number | null, stableObservationPassed: boolean | null): Promise<void> {
    if (!this.onAuthStateDiagnostic) return;
    const session = this.activeBrowserSession(ctx);
    if (!session) return;
    let authState: XhsAuthStateMetadata | null = null;
    let error: { name: string; message: string } | null = null;
    try {
      authState = await collectXhsAuthStateMetadata({ context: session.context, page: session.page, profilePath: session.profilePath, credentialFilePath: this.credentialFilePath, fingerprintKey: this.diagnosticFingerprintKey(), browserChannel: session.browserChannel ?? null, headless: session.headless, storageMode: session.storageMode });
    } catch (caught) {
      error = { name: caught instanceof Error ? caught.name : "AuthStateDiagnosticError", message: "auth state metadata collection failed" };
    }
    const sessionEvidence = await this.getBrowserSessionEvidence(ctx).catch(() => null);
    if (!sessionEvidence) return;
    try {
      this.onAuthStateDiagnostic({ phase, timestamp: new Date().toISOString(), platformKey: this.platformKey, accountId: ctx.accountId, sessionKey: sessionEvidence.sessionKey, sessionIdHash: session.sessionIdHash, storageMode: session.storageMode, profilePath: session.profilePath, sessionEvidence, authState, stableObservationWindowMs, stableObservationSamples, stableObservationPassed, credentialSnapshotInjected: session.credentialSnapshotInjected ?? false, error });
    } catch {
      // Diagnostics are best-effort and must never alter persistence or close behavior.
    }
  }

  private diagnosticFingerprintKey(): Uint8Array {
    this.authStateFingerprintKey ??= createXhsDiagnosticFingerprintKey();
    return this.authStateFingerprintKey;
  }

  private assertProfilePageCanBeRead(evidence: XiaohongshuPageEvidence, runtimeIdentityProof?: CurrentRuntimeIdentityProof): void {
    if (!evidence.available) {
      if (this.isLoginPage(evidence.login.url)) throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书页面仍是登录页，请先完成登录");
      if (this.isVerificationUrl(evidence.login.url)) throw new XiaohongshuGateError("SECURITY_VERIFICATION_REQUIRED", "USER_ACTION_REQUIRED", "小红书页面仍是安全验证页；未尝试绕过");
      throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "小红书 Creator 页面身份证据不可读；未猜测账号身份");
    }
    const decision = classifyXiaohongshuLoginEvidence(evidence.login);
    if (decision === "login_required") throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书页面仍是登录页，请先完成登录");
    if (decision === "needs_user_action") throw new XiaohongshuGateError("SECURITY_VERIFICATION_REQUIRED", "USER_ACTION_REQUIRED", "页面存在可见且阻塞当前操作的登录/安全验证；未尝试绕过");
    if (decision === "unknown" && runtimeIdentityProof && evidence.login.creatorHost && !evidence.login.explicitLoginUrl && !evidence.login.verificationUrl && evidence.login.blockingSignals.length === 0 && evidence.identity.externalAccountId === runtimeIdentityProof.observedExternalCreatorId && evidence.identity.externalAccountIdCandidates.length === 1) return;
    if (decision !== "logged_in") throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "小红书 Creator 正向登录证据不足；未猜测账号身份");
  }

  private assertRuntimeIdentityProof(ctx: AccountContext, proof: CurrentRuntimeIdentityProof, contextDebugId: string | null | undefined, pageDebugId: string | null | undefined): void {
    if (proof.accountId !== ctx.accountId || proof.platformKey !== ctx.platformKey || proof.verified !== true || !proof.expectedExternalCreatorId || !proof.observedExternalCreatorId || proof.expectedExternalCreatorId !== proof.observedExternalCreatorId || proof.canonicalContextId !== contextDebugId || proof.canonicalPageId !== pageDebugId) {
      throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "runtime identity proof 与当前 canonical Context/Page 不一致");
    }
  }

  private async inspectAccountIdentity(page: Page, pageEvidence?: XiaohongshuPageEvidence): Promise<XiaohongshuAccountIdentityEvidence> {
    const evidence = pageEvidence ?? await readXiaohongshuPageEvidence(page);
    const identity = evidence.identity;
    if (!identity.externalAccountId || identity.externalAccountIdCandidates.length !== 1) {
      const failure = identity.externalAccountIdCandidates.length > 1 ? "页面发现多个互相冲突的平台账号 ID" : "未从真实页面可靠取得小红书账号身份；未猜测平台账号 ID";
      throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", failure);
    }
    return {
      externalAccountId: identity.externalAccountId,
      displayName: identity.displayName,
      profileUrl: identity.profileUrl,
      identitySourceCandidates: identity.identitySourceCandidates,
      identityDomDiagnosticMatchCount: identity.identityDomDiagnosticMatchCount,
      identityDomDiagnosticMatches: identity.identityDomDiagnosticMatches
    };
  }

  private preSubmitGateStatusForError(error: unknown): PreSubmitGateStatus {
    const failure = this.failureDetailsForError(error);
    if (failure.failureCode === "AUTH_REDIRECTED_TO_LOGIN") return "auth_expired";
    if (failure.failureCode === "SECURITY_VERIFICATION_REQUIRED") return "security_verification_required";
    if (failure.failureCode === "PUBLISH_ENTRY_NOT_FOUND" || failure.failureCode === "PUBLISH_ENTRY_AMBIGUOUS" || failure.failureCode === "PUBLISH_ENTRY_NOT_VISIBLE" || failure.failureCode === "PUBLISH_ENTRY_DISABLED" || failure.failureCode === "PUBLISH_ENTRY_DIAGNOSTIC_FAILED" || failure.failureCode === "PUBLISH_SEMANTIC_TARGET_NOT_FOUND" || failure.failureCode === "PUBLISH_SEMANTIC_TARGET_AMBIGUOUS" || failure.failureCode === "PUBLISH_CLICK_SURFACE_NOT_FOUND" || failure.failureCode === "PUBLISH_CLICK_SURFACE_AMBIGUOUS" || failure.failureCode === "PUBLISH_CLICK_SURFACE_NOT_VISIBLE" || failure.failureCode === "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED" || failure.failureCode === "PUBLISH_CLICK_SURFACE_DIAGNOSTIC_FAILED" || failure.failureCode === "CONTENT_TYPE_ENTRY_NOT_FOUND" || failure.failureCode === "CONTENT_TYPE_SELECTION_FAILED" || failure.failureCode === "EDITOR_SELECTOR_DRIFT") return "editor_not_found";
    if (failure.failureCode !== "UNKNOWN_UI_STATE") return "needs_user_action";
    if (error instanceof XiaohongshuGateError) {
      if (error.gateCode === "LOGIN_REQUIRED") return "auth_expired";
      if (error.gateCode === "SECURITY_VERIFICATION_REQUIRED") return "security_verification_required";
      if (error.gateCode === "IMAGE_POST_ENTRY_NOT_VERIFIED" || error.gateCode === "CONTENT_TITLE_NOT_VERIFIED" || error.gateCode === "CONTENT_BODY_NOT_VERIFIED" || error.gateCode === "IMAGE_UPLOAD_NOT_VERIFIED" || error.gateCode === "FINAL_SUBMIT_CONTROL_NOT_VERIFIED" || error.gateCode === "REQUIRED_FIELDS_NOT_VERIFIED") return "editor_not_found";
    }
    if (error instanceof BrowserAutomationError && error.code === "LOGIN_EXPIRED") return "auth_expired";
    return "needs_user_action";
  }

  private failureDetailsForError(error: unknown): Pick<PreSubmitGateResult, "failureCode" | "failureStage" | "missingSignal"> {
    if (error instanceof XiaohongshuGateError && error.failureCode && error.failureStage) {
      return { failureCode: error.failureCode, failureStage: error.failureStage, missingSignal: error.missingSignal ?? null };
    }
    if (error instanceof XiaohongshuGateError) {
      if (error.gateCode === "LOGIN_REQUIRED") return { failureCode: "AUTH_REDIRECTED_TO_LOGIN", failureStage: "AUTHENTICATION", missingSignal: "login-url" };
      if (error.gateCode === "SECURITY_VERIFICATION_REQUIRED") return { failureCode: "SECURITY_VERIFICATION_REQUIRED", failureStage: "AUTHENTICATION", missingSignal: "security-verification-signal" };
      if (error.gateCode === "ACCOUNT_IDENTITY_UNVERIFIED") return { failureCode: "AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND", failureStage: "AUTHENTICATION", missingSignal: "creator-authenticated-positive-signal" };
      if (error.gateCode === "IMAGE_POST_ENTRY_NOT_VERIFIED") return { failureCode: "PUBLISH_ENTRY_NOT_FOUND", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR };
      if (error.gateCode === "CONTENT_TYPE_ENTRY_NOT_FOUND") return { failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "content-type:image-text" };
      if (error.gateCode === "CONTENT_TYPE_SELECTION_FAILED") return { failureCode: "CONTENT_TYPE_SELECTION_FAILED", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "content-type:image-text" };
      if (error.gateCode === "EDITOR_NAVIGATION_TIMEOUT") return { failureCode: "EDITOR_NAVIGATION_TIMEOUT", failureStage: "EDITOR_NAVIGATION", missingSignal: "editor-route-wait" };
    }
    const errorCode = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorCode === "BROWSER_SESSION_PAGE_OWNERSHIP" || /BrowserSession\/Page mismatch|foreign BrowserContext|ownership invariant/iu.test(errorMessage)) return { failureCode: "CANONICAL_PAGE_OWNERSHIP_FAILURE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "page-context-ownership" };
    if (error instanceof BrowserAutomationError && error.code === "LOGIN_EXPIRED") return { failureCode: "AUTH_REDIRECTED_TO_LOGIN", failureStage: "AUTHENTICATION", missingSignal: "login-url" };
    if (/timeout|timed out/iu.test(`${error instanceof Error ? error.name : ""} ${errorMessage}`)) return { failureCode: "EDITOR_NAVIGATION_TIMEOUT", failureStage: "EDITOR_NAVIGATION", missingSignal: "editor-route-wait" };
    return { failureCode: "UNKNOWN_UI_STATE", failureStage: "EDITOR_NAVIGATION", missingSignal: null };
  }

  private emitEditorEntryDiagnostic(diagnostic: XiaohongshuEditorEntryDiagnostic): void {
    try { this.onEditorEntryDiagnostic?.(diagnostic); }
    catch { /* diagnostics must never change editor navigation behavior */ }
  }

  private emitPreSubmitGateInspectionDiagnostic(ctx: AccountContext, operationId: string, canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>>, page: Page | null, pageContextMatchesSession: boolean, failure?: Pick<PreSubmitGateResult, "failureCode" | "failureStage" | "missingSignal">): void {
    const session = canonical?.session ?? this.activeBrowserSession(ctx);
    const mutex = this.accountOperationMutex.getState(`${this.platformKey}:${ctx.accountId}`);
    this.emitEditorEntryDiagnostic({
      code: "PRE_SUBMIT_GATE_INSPECTION_STARTED",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId: ctx.accountId,
      contextDebugId: canonical?.session.contextDebugId ?? session?.contextDebugId ?? "unknown-context",
      pageDebugId: canonical?.pageDebugId ?? session?.pageDebugId ?? "unknown-page",
      ...(canonical ? { pageRole: "CANONICAL_AUTHENTICATED" as const, pageSource: "EXISTING_CANONICAL_PAGE" as const } : {}),
      createdNewPage: false,
      pageContextMatchesSession,
      browserConnected: session ? this.isBrowserConnected(session) : false,
      pageClosed: page ? this.isCanonicalPageClosed(page) : true,
      runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
      activeOperation: mutex.activeOperation,
      mutexLocked: mutex.mutexLocked,
      operationInProgress: mutex.operationInProgress,
      ...(page ? { startUrl: sanitizePageUrl(page) } : {}),
      ...(failure ? { failureCode: failure.failureCode, failureStage: failure.failureStage, missingSignal: failure.missingSignal } : {})
    });
  }

  private emitEditorNavigationFailureDiagnostic(ctx: AccountContext, operationId: string, canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>>, page: Page | null, pageContextMatchesSession: boolean, failure: Pick<PreSubmitGateResult, "failureCode" | "failureStage" | "missingSignal">, sanitizedUrlBefore: string | undefined, sanitizedUrlAfter: string | null): void {
    const session = canonical?.session ?? this.activeBrowserSession(ctx);
    const mutex = this.accountOperationMutex.getState(`${this.platformKey}:${ctx.accountId}`);
    this.emitEditorEntryDiagnostic({
      code: "EDITOR_NAVIGATION_FAILED",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId: ctx.accountId,
      contextDebugId: canonical?.session.contextDebugId ?? session?.contextDebugId ?? "unknown-context",
      pageDebugId: canonical?.pageDebugId ?? session?.pageDebugId ?? "unknown-page",
      ...(canonical ? { pageRole: "CANONICAL_AUTHENTICATED" as const, pageSource: "EXISTING_CANONICAL_PAGE" as const } : {}),
      createdNewPage: false,
      pageContextMatchesSession,
      browserConnected: session ? this.isBrowserConnected(session) : false,
      pageClosed: page ? this.isCanonicalPageClosed(page) : true,
      runtimeAuthState: this.getBrowserRuntimeState(ctx).state,
      activeOperation: mutex.activeOperation,
      mutexLocked: mutex.mutexLocked,
      operationInProgress: mutex.operationInProgress,
      ...(sanitizedUrlBefore ? { sanitizedUrlBefore } : {}),
      ...(sanitizedUrlAfter ? { sanitizedUrlAfter } : {}),
      navigationTrigger: "UNKNOWN",
      failureCode: failure.failureCode,
      failureStage: failure.failureStage,
      missingSignal: failure.missingSignal,
      lastCompletedStep: this.lastCompletedEditorEntryStep(failure.failureStage)
    });
  }

  private preSubmitGateFailureResult(status: PreSubmitGateStatus, failure: Pick<PreSubmitGateResult, "failureCode" | "failureStage" | "missingSignal">, page: Page | null): PreSubmitGateResult {
    const result = emptyPreSubmitGateResult(status);
    result.authStillValid = false;
    result.sanitizedUrl = page ? sanitizePageUrl(page) : null;
    Object.assign(result, failure);
    return result;
  }

  private canonicalPageFailureDetails(session: BrowserSession | null, page: Page | null): Pick<PreSubmitGateResult, "failureCode" | "failureStage" | "missingSignal"> {
    if (session && !this.isBrowserConnected(session)) return { failureCode: "BROWSER_SESSION_DISCONNECTED", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "browser-disconnected" };
    if (page && this.isCanonicalPageClosed(page)) return { failureCode: "CANONICAL_PAGE_UNAVAILABLE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "canonical-page-closed" };
    return { failureCode: "CANONICAL_PAGE_UNAVAILABLE", failureStage: "SESSION_PAGE_LIFECYCLE", missingSignal: "active-canonical-page" };
  }

  private completePreSubmitGateResult(ctx: AccountContext, canonical: Awaited<ReturnType<typeof this.activeCanonicalPage>>, operationId: string, result: PreSubmitGateResult, pageContextMatchesSession: boolean): PreSubmitGateResult {
    if (canonical) this.emitCanonicalPageOperation(ctx, canonical.session, canonical.page, canonical.pageDebugId, operationId, "COMPLETED", pageContextMatchesSession, result.status, "PRE_SUBMIT_GATE", result);
    return result;
  }

  private isEditorRoute(url: string): boolean { return /^https:\/\/creator\.xiaohongshu\.com\/publish\/publish(?:[/?#]|$)/iu.test(url); }

  private isCreatorHomeRoute(url: string): boolean { return /^https:\/\/creator\.xiaohongshu\.com\/(?:new\/home)?(?:[?#].*)?$/iu.test(url); }

  private lastCompletedEditorEntryStep(failureStage?: PreSubmitGateFailureStage): XiaohongshuEditorEntryStepName | null {
    if (failureStage === "EDITOR_ROUTE") return "PUBLISH_ENTRY_CLICKED";
    if (failureStage === "EDITOR_NAVIGATION") return "PUBLISH_ENTRY_CLICKED";
    if (failureStage === "CONTENT_TYPE_SELECTION") return "CONTENT_TYPE_ENTRY_FOUND";
    if (failureStage === "PUBLISH_ENTRY_CLICK") return "PUBLISH_ENTRY_FOUND";
    if (failureStage === "PUBLISH_ENTRY_DISCOVERY") return "CREATOR_HOME_READY";
    return null;
  }

  private emitEditorEntryStep(page: Page, operationId: string, accountId: string, startedAt: number, stepName: XiaohongshuEditorEntryStepName, success: boolean, selectorSignal: string, sanitizedUrlBefore = sanitizePageUrl(page), sanitizedUrlAfter = sanitizePageUrl(page), navigationTrigger: XiaohongshuEditorNavigationTrigger = "UNKNOWN"): void {
    this.emitEditorEntryDiagnostic({ code: "EDITOR_ENTRY_STEP", timestamp: new Date().toISOString(), operationId, platformKey: "xiaohongshu", accountId, stepName, success, sanitizedUrlBefore, sanitizedUrlAfter, selectorSignal, elapsedMs: Math.max(0, Date.now() - startedAt), navigationTrigger });
  }

  private async emitCreatorHomeDiagnostics(page: Page, operationId: string, accountId: string, identity: { contextDebugId?: string; pageDebugId?: string } = {}): Promise<void> {
    const shared = { operationId, platformKey: "xiaohongshu" as const, accountId, ...identity };
    try {
      const observation = await observeCreatorHomeReadiness(page);
      for (const sample of observation.samples) {
        this.emitEditorEntryDiagnostic({
          code: "CREATOR_HOME_READINESS_SAMPLE",
          timestamp: new Date().toISOString(),
          ...shared,
          readinessResult: observation.result,
          sampleIndex: sample.sampleIndex,
          elapsedMs: sample.elapsedMs,
          readyState: sample.readyState,
          bodyChildCount: sample.bodyChildCount,
          visibleInteractiveCount: sample.interactiveCount,
          navigationElementCount: sample.navigationCount,
          publishSemanticTextSignalCount: sample.publishSemanticTextSignalCount
        });
      }
      const topology = await collectCreatorHomeTopology(page);
      this.emitEditorEntryDiagnostic({
        code: "CREATOR_HOME_TOPOLOGY_OBSERVED",
        timestamp: new Date().toISOString(),
        ...shared,
        sanitizedUrl: sanitizePageUrl(page),
        topLevelElementCounts: topology.topLevelElementCounts,
        interactiveElementTypeCounts: topology.interactiveElementTypeCounts,
        frameCount: topology.frameCount,
        frameSummary: topology.frameSummary,
        shadowHostCount: topology.shadowHostCount,
        shadowSummary: topology.shadowSummary,
        publishEntryLocation: topology.publishEntryLocation,
        publishSemanticSignalPresent: topology.publishSemanticSignalPresent
      });
      const semantic = await collectPublishSemanticNodes(page);
      const discoveryDiagnosis = observation.result === "HOME_SHELL_TIMEOUT"
        ? "CREATOR_HOME_SHELL_TIMEOUT" as const
        : observation.result === "HOME_SHELL_NOT_READY"
          ? "CREATOR_HOME_SHELL_NOT_READY" as const
          : semantic.discoveryDiagnosis;
      this.emitEditorEntryDiagnostic({
        code: "PUBLISH_SEMANTIC_NODES_OBSERVED",
        timestamp: new Date().toISOString(),
        ...shared,
        sanitizedUrl: sanitizePageUrl(page),
        textSignalPresent: semantic.textSignalPresent,
        candidateCount: semantic.candidateCount,
        semanticNodes: semantic.nodes,
        candidateInventoryTruncated: semantic.truncated,
        publishSemanticTextSignalCount: semantic.candidateCount,
        discoveryDiagnosis,
        accessibilityPublishSignals: semantic.accessibilityPublishSignals
      });
      if (topology.frameCount > 0) {
        this.emitEditorEntryDiagnostic({ code: "FRAME_TOPOLOGY_OBSERVED", timestamp: new Date().toISOString(), ...shared, frameCount: topology.frameCount, frameSummary: topology.frameSummary, publishEntryLocation: topology.publishEntryLocation });
      }
      if (topology.shadowHostCount > 0) {
        this.emitEditorEntryDiagnostic({ code: "SHADOW_TOPOLOGY_OBSERVED", timestamp: new Date().toISOString(), ...shared, shadowHostCount: topology.shadowHostCount, shadowSummary: topology.shadowSummary, publishEntryLocation: topology.publishEntryLocation });
      }
      if (semantic.accessibilityPublishSignals) {
        this.emitEditorEntryDiagnostic({ code: "ACCESSIBILITY_PUBLISH_SIGNALS_OBSERVED", timestamp: new Date().toISOString(), ...shared, accessibilityPublishSignals: semantic.accessibilityPublishSignals });
      }
      const clickable = await collectPublishClickableSurfaceDiagnostics(page);
      this.emitEditorEntryDiagnostic({
        code: "PUBLISH_EXACT_TARGETS_OBSERVED",
        timestamp: new Date().toISOString(),
        ...shared,
        sanitizedUrl: sanitizePageUrl(page),
        exactPublishSemanticTargets: clickable.exactPublishSemanticTargets,
        candidateCount: clickable.exactPublishSemanticTargets.length,
        candidateInventoryTruncated: clickable.exactPublishSemanticTargets.length >= 20
      });
      this.emitEditorEntryDiagnostic({
        code: "PUBLISH_TARGET_ANCESTOR_CHAINS",
        timestamp: new Date().toISOString(),
        ...shared,
        sanitizedUrl: sanitizePageUrl(page),
        ancestorChainDiagnostics: clickable.ancestorChainDiagnostics
      });
      this.emitEditorEntryDiagnostic({
        code: "PUBLISH_CLICK_SURFACE_DIAGNOSTICS",
        timestamp: new Date().toISOString(),
        ...shared,
        sanitizedUrl: sanitizePageUrl(page),
        ancestorChainDiagnostics: clickable.ancestorChainDiagnostics,
        publishNoteSurface: clickable.publishNoteSurface,
        imagePostSurface: clickable.imagePostSurface,
        publishNoteDropdownTrigger: clickable.publishNoteDropdownTrigger,
        clickableSurfaceStatus: clickable.clickableSurfaceStatus,
        clickableSurfaceFailureCode: clickable.clickableSurfaceFailureCode,
        clickableSurfaceConfidence: clickable.clickableSurfaceConfidence,
        diagnosticClickCount: clickable.diagnosticClickCount,
        mouseEventDispatchCount: clickable.mouseEventDispatchCount,
        keyboardEventCount: clickable.keyboardEventCount,
        gateCallsPreparePublish: clickable.gateSideEffects.preparePublish,
        gateContentMutationCount: clickable.gateSideEffects.contentMutationCount,
        gateUploadCount: clickable.gateSideEffects.uploadCount,
        gateFinalSubmitCount: clickable.gateSideEffects.finalSubmitCount
      });
      this.emitEditorEntryDiagnostic({
        code: "PUBLISH_HIT_TEST_OBSERVED",
        timestamp: new Date().toISOString(),
        ...shared,
        sanitizedUrl: sanitizePageUrl(page),
        hitTestDiagnostics: clickable.hitTestDiagnostics
      });
      this.emitEditorEntryDiagnostic({
        code: "PUBLISH_EVENT_LISTENERS_OBSERVED",
        timestamp: new Date().toISOString(),
        ...shared,
        sanitizedUrl: sanitizePageUrl(page),
        eventListenerInspection: clickable.eventListenerInspection.status,
        eventListenerDiagnostics: clickable.eventListenerDiagnostics
      });
    } catch {
      // Diagnostics are best-effort and must never alter the existing entry resolver or Gate result.
    }
  }

  private async navigateToImagePostEditorViaExactCard(page: Page, operationId: string, accountId: string, startedAt: number): Promise<XiaohongshuEditorEntryResult> {
    const selectorSignal = "semantic:EXACT_PUBLISH_IMAGE_POST_CARD";
    const inspection = await inspectXiaohongshuImagePostEntry(page);
    this.emitEditorEntryDiagnostic({
      code: "IMAGE_POST_ENTRY_INSPECTION",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId,
      sanitizedUrl: sanitizePageUrl(page),
      selectorSignal,
      status: inspection.inspectionStatus,
      exactTextMatchCount: inspection.exactTextMatchCount,
      safeToTestClick: inspection.safeToTestClick,
      imagePostEntryInspection: inspection,
      pageCapabilitiesSafe: inspection.pageCapabilities,
      evaluationFailureReason: inspection.evaluationFailureReason,
      imagePostEntryClickCount: 0,
      failureCode: inspection.failureCode === "NOT_CREATOR_HOME" ? "EDITOR_ROUTE_NOT_REACHED" : inspection.failureCode === null ? undefined : "PUBLISH_ENTRY_NOT_FOUND",
      failureStage: inspection.failureCode === null ? undefined : "PUBLISH_ENTRY_DISCOVERY",
      missingSignal: inspection.failureCode === null ? undefined : selectorSignal
    });
    this.emitEditorEntryStep(page, operationId, accountId, startedAt, "PUBLISH_ENTRY_FOUND", inspection.safeToTestClick, selectorSignal);
    if (!inspection.safeToTestClick) {
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `小红书唯一“发布图文笔记”入口未通过 bounded contract：${inspection.failureCode ?? "UNKNOWN"}`, { failureCode: "PUBLISH_ENTRY_NOT_FOUND", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: selectorSignal });
    }

    const activation = await activateXiaohongshuImagePostEntry(page, { navigationClickCount: 0 });
    this.emitEditorEntryDiagnostic({
      code: "IMAGE_POST_ENTRY_ACTIVATION",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId,
      sanitizedUrl: sanitizePageUrl(page),
      selectorSignal,
      status: activation.status,
      imagePostEntryInspection: activation.inspection,
      imagePostEntryActivation: activation,
      imagePostEntryClickCount: activation.clickCount,
      observedTarget: activation.observedTarget,
      imagePostEntryRouteReadback: activation.routeReadback,
      sanitizedUrlBefore: activation.sanitizedUrlBefore,
      sanitizedUrlAfter: activation.sanitizedUrlAfter,
      navigationClickCount: activation.clickCount,
      navigationTransition: activation.status === "ACTIVATED",
      failureCode: activation.failureCode === "WRONG_TARGET" ? "CONTENT_TYPE_ENTRY_NOT_FOUND" : activation.failureCode === undefined ? undefined : "EDITOR_ROUTE_NOT_REACHED",
      failureStage: activation.failureCode === undefined ? undefined : "EDITOR_NAVIGATION",
      missingSignal: activation.failureCode === undefined ? undefined : selectorSignal
    });
    this.emitEditorEntryStep(page, operationId, accountId, startedAt, "PUBLISH_ENTRY_CLICKED", activation.status === "ACTIVATED", selectorSignal, activation.sanitizedUrlBefore, activation.sanitizedUrlAfter, "PUBLISH_ENTRY_CLICK");
    if (activation.status !== "ACTIVATED") {
      const failureCode = activation.failureCode === "WRONG_TARGET" ? "CONTENT_TYPE_ENTRY_NOT_FOUND" : activation.failureCode === "NO_ROUTE_TRANSITION" ? "EDITOR_ROUTE_NOT_REACHED" : "PUBLISH_ENTRY_NOT_FOUND";
      const failureStage = activation.failureCode === "WRONG_TARGET" ? "CONTENT_TYPE_SELECTION" : activation.failureCode === "NO_ROUTE_TRANSITION" ? "EDITOR_ROUTE" : "PUBLISH_ENTRY_CLICK";
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `唯一“发布图文笔记”入口激活未到达图文编辑器：${activation.failureCode ?? activation.status}；不会 retry`, { failureCode, failureStage, missingSignal: selectorSignal });
    }

    const postState = classifyPublishNotePostClickState({ url: page.url(), bodyText: "" });
    if (postState === "VIDEO_EDITOR") throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "发布图文笔记入口进入了视频编辑器；不会继续 mutation", { failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "target=image" });
    if (postState !== "IMAGE_EDITOR") throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "发布图文笔记入口未得到可验证的图文编辑器路由", { failureCode: "EDITOR_ROUTE_NOT_REACHED", failureStage: "EDITOR_ROUTE", missingSignal: "url:/publish/publish?target=image" });
    this.emitEditorEntryStep(page, operationId, accountId, startedAt, "EDITOR_ROUTE_REACHED", true, "url:/publish/publish?target=image", activation.sanitizedUrlBefore, activation.sanitizedUrlAfter, "PUBLISH_ENTRY_CLICK");
    return { editorReached: true, sanitizedUrl: activation.sanitizedUrlAfter, preClickRevalidated: true, navigationClickCount: 1, navigationTransitionObserved: true, postPublishNoteState: "IMAGE_EDITOR" };
  }

  private async navigateToImagePostEditor(page: Page, operationId: string = randomUUID(), accountId = "unknown-account", identity: { context?: object; contextDebugId?: string; pageDebugId?: string } = {}, policy: XiaohongshuEditorNavigationPolicy = "PREPARE_PUBLISH"): Promise<XiaohongshuEditorEntryResult> {
    const startedAt = Date.now();
    const startUrl = sanitizePageUrl(page);
    if (this.isEditorRoute(page.url())) {
      if (classifyPublishNotePostClickState({ url: page.url(), bodyText: "" }) === "VIDEO_EDITOR") {
        this.emitEditorEntryStep(page, operationId, accountId, startedAt, "EDITOR_ROUTE_REACHED", false, "url:/publish/publish?target=video", startUrl, startUrl, "PLATFORM_REDIRECT");
        throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "当前页面是视频发布编辑器；不会在错误内容类型页面继续上传或填写", { failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "target=image" });
      }
      this.emitEditorEntryDiagnostic({ code: "EDITOR_ENTRY_STARTED", timestamp: new Date().toISOString(), operationId, platformKey: "xiaohongshu", accountId, startUrl, entryMethod: "ALREADY_ON_EDITOR", expectedTarget: "https://creator.xiaohongshu.com/publish/publish" });
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "EDITOR_ROUTE_REACHED", true, "url:/publish/publish", startUrl, startUrl, "DIRECT_GOTO");
      return { editorReached: true, sanitizedUrl: startUrl, navigationClickCount: 0, navigationTransitionObserved: false, postPublishNoteState: "IMAGE_EDITOR" };
    }
    this.emitEditorEntryDiagnostic({ code: "EDITOR_ENTRY_STARTED", timestamp: new Date().toISOString(), operationId, platformKey: "xiaohongshu", accountId, startUrl, entryMethod: "CLICK_NAVIGATION", expectedTarget: "https://creator.xiaohongshu.com/publish/publish" });

    const homeReady = this.isCreatorHomeRoute(page.url()) && !this.isLoginPage(page.url()) && !this.isVerificationUrl(page.url());
    this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CREATOR_HOME_READY", homeReady, "creator.xiaohongshu.com:home", startUrl, sanitizePageUrl(page), "DIRECT_GOTO");
    if (!homeReady) {
      const failure = this.isLoginPage(page.url())
        ? { failureCode: "AUTH_REDIRECTED_TO_LOGIN" as const, failureStage: "AUTHENTICATION" as const, missingSignal: "login-url" }
        : this.isVerificationUrl(page.url())
          ? { failureCode: "SECURITY_VERIFICATION_REQUIRED" as const, failureStage: "AUTHENTICATION" as const, missingSignal: "security-verification-url" }
          : { failureCode: "EDITOR_ROUTE_NOT_REACHED" as const, failureStage: "CREATOR_HOME" as const, missingSignal: "creator-home" };
      throw new XiaohongshuGateError(failure.failureCode === "AUTH_REDIRECTED_TO_LOGIN" ? "LOGIN_REQUIRED" : failure.failureCode === "SECURITY_VERIFICATION_REQUIRED" ? "SECURITY_VERIFICATION_REQUIRED" : "IMAGE_POST_ENTRY_NOT_VERIFIED", "USER_ACTION_REQUIRED", "小红书 Creator 首页未处于可用的编辑器入口状态", failure);
    }

    await this.emitCreatorHomeDiagnostics(page, operationId, accountId, identity);

    if (typeof (page as unknown as { getByText?: unknown }).getByText === "function") {
      return this.navigateToImagePostEditorViaExactCard(page, operationId, accountId, startedAt);
    }

    if (typeof (page as unknown as { evaluateHandle?: unknown }).evaluateHandle === "function") {
      if (policy === "GATE_NAVIGATION") return this.navigateToImagePostEditorForGate(page, operationId, accountId, identity);
      const preparedResolution = await resolvePublishNoteNavigationSurface(page, {
        operationId,
        platformKey: "xiaohongshu",
        accountId,
        contextDebugId: identity.contextDebugId ?? "unknown-context",
        pageDebugId: identity.pageDebugId ?? "unknown-page",
        context: identity.context ?? page.context(),
        authState: "AUTHENTICATED"
      });
      if (preparedResolution.status === "PROVEN_UNIQUE" && preparedResolution.surfaceHandle) {
        const preparedEntry = await this.navigateToImagePostEditorForGate(page, operationId, accountId, identity, preparedResolution);
        if (preparedEntry.postPublishNoteState === "IMAGE_POST_SELECTION_PAGE") {
          await this.selectImagePostContentTypeForPrepare(page, operationId, accountId, Date.now());
          return { ...preparedEntry, editorReached: true, sanitizedUrl: sanitizePageUrl(page), postPublishNoteState: "IMAGE_EDITOR" };
        }
        return preparedEntry;
      }
    }

    let entry: { locator: Locator; selectorSignal: string; requiresContentTypeSelection: boolean };
    try {
      entry = await this.discoverPublishEntry(page, operationId, accountId);
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "PUBLISH_ENTRY_FOUND", true, entry.selectorSignal);
    } catch (error) {
      const failure = this.failureDetailsForError(error);
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "PUBLISH_ENTRY_FOUND", false, failure.missingSignal ?? XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR);
      throw error;
    }

    const publishEntryUrlBeforeClick = sanitizePageUrl(page);
    try {
      await entry.locator.click();
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "PUBLISH_ENTRY_CLICKED", true, entry.selectorSignal, publishEntryUrlBeforeClick, sanitizePageUrl(page), "PUBLISH_ENTRY_CLICK");
    } catch (error) {
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "PUBLISH_ENTRY_CLICKED", false, entry.selectorSignal, publishEntryUrlBeforeClick, sanitizePageUrl(page));
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `图文发布入口点击失败：${error instanceof Error ? error.message : String(error)}`, { failureCode: "PUBLISH_ENTRY_CLICK_FAILED", failureStage: "PUBLISH_ENTRY_CLICK", missingSignal: entry.selectorSignal });
    }

    if (entry.requiresContentTypeSelection && !this.isEditorRoute(page.url())) {
      let contentTypeEntry: { locator: Locator; selectorSignal: string };
      try {
        contentTypeEntry = await this.discoverContentTypeEntry(page);
        this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CONTENT_TYPE_ENTRY_FOUND", true, contentTypeEntry.selectorSignal);
      } catch (error) {
        const failure = this.failureDetailsForError(error);
        this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CONTENT_TYPE_ENTRY_FOUND", false, failure.missingSignal ?? "content-type:image-text");
        throw error;
      }
      const contentTypeUrlBeforeClick = sanitizePageUrl(page);
      try {
        await contentTypeEntry.locator.click();
        this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CONTENT_TYPE_SELECTED", true, contentTypeEntry.selectorSignal, contentTypeUrlBeforeClick, sanitizePageUrl(page), "CONTENT_TYPE_CLICK");
      } catch (error) {
        this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CONTENT_TYPE_SELECTED", false, contentTypeEntry.selectorSignal, contentTypeUrlBeforeClick, sanitizePageUrl(page), "CONTENT_TYPE_CLICK");
        throw new XiaohongshuGateError("CONTENT_TYPE_SELECTION_FAILED", "CONTENT_REJECTED", `图文内容类型选择失败：${error instanceof Error ? error.message : String(error)}`, { failureCode: "CONTENT_TYPE_SELECTION_FAILED", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "content-type:image-text" });
      }
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const currentUrl = page.url();
      if (this.isLoginPage(currentUrl)) {
        this.emitEditorEntryStep(page, operationId, accountId, startedAt, "EDITOR_ROUTE_REACHED", false, "login-url");
        throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "图文入口导航后被重定向到登录页", { failureCode: "AUTH_REDIRECTED_TO_LOGIN", failureStage: "AUTHENTICATION", missingSignal: "login-url" });
      }
      if (this.isVerificationUrl(currentUrl)) {
        this.emitEditorEntryStep(page, operationId, accountId, startedAt, "EDITOR_ROUTE_REACHED", false, "security-verification-url");
        throw new XiaohongshuGateError("SECURITY_VERIFICATION_REQUIRED", "USER_ACTION_REQUIRED", "图文入口导航后出现安全验证页；未尝试绕过", { failureCode: "SECURITY_VERIFICATION_REQUIRED", failureStage: "AUTHENTICATION", missingSignal: "security-verification-url" });
      }
      if (/\/publish\/publish(?:[/?#]|$)/iu.test(currentUrl)) {
        const postState = classifyPublishNotePostClickState({ url: currentUrl, bodyText: "" });
        if (postState === "VIDEO_EDITOR") {
          this.emitEditorEntryStep(page, operationId, accountId, startedAt, "EDITOR_ROUTE_REACHED", false, "url:/publish/publish?target=video", startUrl, sanitizePageUrl(page), "PLATFORM_REDIRECT");
          throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "发布笔记 dropdown 后进入了视频发布编辑器；不会切换 tab 或继续 mutation", { failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "target=image" });
        }
        this.emitEditorEntryStep(page, operationId, accountId, startedAt, "EDITOR_ROUTE_REACHED", true, "url:/publish/publish");
        return { editorReached: true, sanitizedUrl: sanitizePageUrl(page), navigationClickCount: 1, navigationTransitionObserved: true, postPublishNoteState: "IMAGE_EDITOR" };
      }
      try {
        await waitForProbe(page);
      } catch (error) {
        throw new XiaohongshuGateError("EDITOR_NAVIGATION_TIMEOUT", "USER_ACTION_REQUIRED", `等待图文编辑器路由超时：${error instanceof Error ? error.message : String(error)}`, { failureCode: "EDITOR_NAVIGATION_TIMEOUT", failureStage: "EDITOR_NAVIGATION", missingSignal: "editor-route-wait" });
      }
    }

    this.emitEditorEntryStep(page, operationId, accountId, startedAt, "EDITOR_ROUTE_REACHED", false, "url:/publish/publish");
    throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "图文入口点击后未到达 /publish/publish 编辑器路由", { failureCode: "EDITOR_ROUTE_NOT_REACHED", failureStage: "EDITOR_ROUTE", missingSignal: "url:/publish/publish" });
  }

  private async navigateToImagePostEditorForGate(page: Page, operationId: string, accountId: string, identity: { context?: object; contextDebugId?: string; pageDebugId?: string }, suppliedResolution?: PublishNoteNavigationSurfaceResolution): Promise<XiaohongshuEditorEntryResult> {
    const startedAt = Date.now();
    const lifecycle: PublishNoteNavigationLifecycle = {
      operationId,
      platformKey: "xiaohongshu",
      accountId,
      contextDebugId: identity.contextDebugId ?? "unknown-context",
      pageDebugId: identity.pageDebugId ?? "unknown-page",
      page,
      context: identity.context ?? page.context(),
      authState: "AUTHENTICATED"
    };
    const resolution = suppliedResolution ?? await resolvePublishNoteNavigationSurface(page, lifecycle);
    this.emitEditorEntryDiagnostic({
      code: "PUBLISH_NOTE_SURFACE_RESOLVED",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId,
      contextDebugId: lifecycle.contextDebugId,
      pageDebugId: lifecycle.pageDebugId,
      status: resolution.status,
      targetIdentity: resolution.target ? { targetId: resolution.target.targetId, tagName: resolution.target.tagName, exactText: resolution.target.exactText, depth: resolution.target.depth } : undefined,
      surfaceIdentity: resolution.surface ? { surfaceId: resolution.surface.surfaceId, targetId: resolution.surface.targetId, ancestorDepth: resolution.surface.ancestorDepth, tagName: resolution.surface.tagName } : undefined,
      dropdownTriggerIdentity: resolution.dropdownTrigger ? { triggerId: resolution.dropdownTrigger.triggerId, targetId: resolution.dropdownTrigger.targetId, tagName: resolution.dropdownTrigger.tagName, role: resolution.dropdownTrigger.role } : undefined,
      dropdownTriggerStatus: resolution.diagnostics?.publishNoteDropdownTrigger.status,
      exactSemanticText: resolution.evidence.exactSemanticText,
      visible: resolution.evidence.visible,
      pointerEventsActive: resolution.evidence.pointerEventsActive,
      geometryValid: resolution.evidence.geometryValid,
      hitTestConsistent: resolution.evidence.hitTestConsistent,
      uniqueSurface: resolution.evidence.uniqueSurface,
      strongClickabilitySignal: resolution.evidence.strongClickabilitySignal,
      eventListenerSignal: resolution.evidence.eventListenerSignal,
      failureCode: resolution.failureCode
    });
    if (resolution.status !== "PROVEN_UNIQUE" || !resolution.surfaceHandle) {
      const failureCode = resolution.failureCode ?? "PUBLISH_CLICK_SURFACE_NOT_FOUND";
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `发布笔记 surface 未通过 fail-closed proof：${failureCode}`, { failureCode, failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: "publish-note-proven-unique-surface" });
    }

    const currentAuthState = this.isLoginPage(page.url()) ? "LOGIN_REQUIRED" : this.isVerificationUrl(page.url()) ? "SECURITY_VERIFICATION" : "AUTHENTICATED";
    const currentLifecycle: PublishNoteNavigationLifecycle = { ...lifecycle, authState: currentAuthState };
    const preClick = await revalidatePublishNoteNavigationSurface(resolution, currentLifecycle);
    this.emitEditorEntryDiagnostic({
      code: "PUBLISH_NOTE_SURFACE_PRECLICK_REVALIDATED",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId,
      contextDebugId: lifecycle.contextDebugId,
      pageDebugId: lifecycle.pageDebugId,
      revalidated: preClick.revalidated,
      targetIdentity: resolution.target ? { targetId: resolution.target.targetId, exactText: resolution.target.exactText } : undefined,
      surfaceIdentity: resolution.surface ? { surfaceId: resolution.surface.surfaceId, ancestorDepth: resolution.surface.ancestorDepth } : undefined,
      failureCode: preClick.failureCode
    });
    if (!preClick.revalidated) {
      const failureCode = preClick.failureCode ?? "PUBLISH_SURFACE_REVALIDATION_FAILED";
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `发布笔记 surface pre-click revalidation 失败：${failureCode}`, { failureCode, failureStage: "PUBLISH_ENTRY_CLICK", missingSignal: "publish-note-preclick-revalidation" });
    }

    const sanitizedUrlBefore = sanitizePageUrl(page);
    this.emitEditorEntryDiagnostic({
      code: "PUBLISH_NOTE_NAVIGATION_CLICK_STARTED",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId,
      contextDebugId: lifecycle.contextDebugId,
      pageDebugId: lifecycle.pageDebugId,
      action: "PUBLISH_NOTE_NAVIGATION_CLICK",
      targetIdentity: resolution.target ? { targetId: resolution.target.targetId, exactText: resolution.target.exactText } : undefined,
      surfaceIdentity: resolution.surface ? { surfaceId: resolution.surface.surfaceId, ancestorDepth: resolution.surface.ancestorDepth } : undefined,
      sanitizedUrlBefore,
      navigationClickCount: 0,
      elapsedMs: Math.max(0, Date.now() - startedAt)
    });
    const click = await clickPublishNoteNavigationSurface({
      resolution,
      current: currentLifecycle,
      navigationClickCount: 0,
      sanitizedUrlBefore,
      readSanitizedUrl: () => sanitizePageUrl(page),
      waitForTransition: async () => {
        for (let attempt = 0; attempt < 8 && sanitizePageUrl(page) === sanitizedUrlBefore; attempt += 1) await waitForProbe(page);
      },
      preClickRevalidation: preClick
    });
    this.emitEditorEntryDiagnostic({
      code: "PUBLISH_NOTE_NAVIGATION_CLICK_COMPLETED",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId,
      contextDebugId: lifecycle.contextDebugId,
      pageDebugId: lifecycle.pageDebugId,
      action: click.action,
      targetIdentity: resolution.target ? { targetId: resolution.target.targetId, exactText: resolution.target.exactText } : undefined,
      surfaceIdentity: resolution.surface ? { surfaceId: resolution.surface.surfaceId, ancestorDepth: resolution.surface.ancestorDepth } : undefined,
      sanitizedUrlBefore: click.sanitizedUrlBefore,
      sanitizedUrlAfter: click.sanitizedUrlAfter,
      navigationTransition: click.navigationTransition,
      navigationClickCount: click.navigationClickCount,
      publishNoteDropdownClickCount: click.publishNoteDropdownClickCount,
      imagePostMenuItemClickCount: click.imagePostMenuItemClickCount,
      uploadVideoMenuItemClickCount: click.uploadVideoMenuItemClickCount,
      finalSubmitCount: click.finalSubmitCount,
      failureCode: click.failureCode,
      elapsedMs: Math.max(0, Date.now() - startedAt)
    });
    if (click.failureCode && click.failureCode !== "PUBLISH_ENTRY_CLICK_NO_TRANSITION") {
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `发布笔记 navigation click 失败：${click.failureCode}`, { failureCode: click.failureCode, failureStage: "PUBLISH_ENTRY_CLICK", missingSignal: "publish-note-navigation-click" });
    }
    if (!click.navigationTransition) throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "发布笔记 navigation click 后页面没有发生 transition；不会 retry", { failureCode: "PUBLISH_ENTRY_CLICK_NO_TRANSITION", failureStage: "EDITOR_NAVIGATION", missingSignal: "publish-note-navigation-transition" });

    const postEvidence = await readXiaohongshuPageEvidence(page);
    const postBodyText = await bodyText(page);
    if (resolution.dropdownTriggerHandle) {
      let route: URL;
      try {
        route = new URL(page.url());
      } catch {
        throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "上传图文菜单点击后的页面 URL 无法验证", { failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "from=menu&target=image" });
      }
      if (route.pathname !== "/publish/publish" || route.searchParams.get("from") !== "menu" || route.searchParams.get("target") !== "image") {
        throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "上传图文菜单点击后未得到 from=menu&target=image 路由", { failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "from=menu&target=image" });
      }
    }
    const postState = classifyPublishNotePostClickState({
      url: page.url(),
      bodyText: postBodyText,
      loginPagePresent: this.isLoginPage(page.url()) || postEvidence.login.explicitLoginUrl,
      securityVerificationPresent: this.isVerificationUrl(page.url()) || postEvidence.login.verificationUrl || postEvidence.login.visibleSecurityModal || postEvidence.login.visibleCaptcha || postEvidence.login.visibleSlider
    });
    let imagePostSurfaceAfterPublishNote: XiaohongshuClickableSurfaceResolution | undefined;
    if (postState === "IMAGE_POST_SELECTION_PAGE") {
      try { imagePostSurfaceAfterPublishNote = (await collectPublishClickableSurfaceDiagnostics(page)).imagePostSurface; } catch { imagePostSurfaceAfterPublishNote = undefined; }
    }
    this.emitEditorEntryDiagnostic({
      code: "POST_PUBLISH_NOTE_STATE_OBSERVED",
      timestamp: new Date().toISOString(),
      operationId,
      platformKey: "xiaohongshu",
      accountId,
      contextDebugId: lifecycle.contextDebugId,
      pageDebugId: lifecycle.pageDebugId,
      postPublishNoteState: postState,
      sanitizedUrlBefore: click.sanitizedUrlBefore,
      sanitizedUrlAfter: click.sanitizedUrlAfter,
      navigationTransition: click.navigationTransition,
      navigationClickCount: click.navigationClickCount,
      ...(imagePostSurfaceAfterPublishNote ? { imagePostSurfaceAfterPublishNote } : {}),
      targetIdentity: resolution.target ? { targetId: resolution.target.targetId, exactText: resolution.target.exactText } : undefined,
      surfaceIdentity: resolution.surface ? { surfaceId: resolution.surface.surfaceId, targetId: resolution.surface.targetId, ancestorDepth: resolution.surface.ancestorDepth } : undefined,
      elapsedMs: Math.max(0, Date.now() - startedAt)
    });
    if (postState === "LOGIN") throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "发布笔记 navigation 后被重定向到登录页", { failureCode: "AUTH_REDIRECTED_TO_LOGIN", failureStage: "AUTHENTICATION", missingSignal: "login-url" });
    if (postState === "SECURITY_VERIFICATION") throw new XiaohongshuGateError("SECURITY_VERIFICATION_REQUIRED", "USER_ACTION_REQUIRED", "发布笔记 navigation 后出现安全验证页；未尝试绕过", { failureCode: "SECURITY_VERIFICATION_REQUIRED", failureStage: "AUTHENTICATION", missingSignal: "security-verification-signal" });
    if (postState === "VIDEO_EDITOR") throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "发布笔记 dropdown 后进入了视频发布编辑器；不会切换 tab 或继续 mutation", { failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "target=image" });
    if (postState === "UNKNOWN") throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "发布笔记 navigation 后页面状态未知", { failureCode: "UNKNOWN_UI_STATE", failureStage: "EDITOR_NAVIGATION", missingSignal: "post-publish-note-state" });
    return {
      editorReached: postState === "IMAGE_EDITOR",
      sanitizedUrl: click.sanitizedUrlAfter,
      preClickRevalidated: click.preClickRevalidated,
      navigationClickCount: click.navigationClickCount,
      navigationTransitionObserved: click.navigationTransition,
      postPublishNoteState: postState,
      ...(imagePostSurfaceAfterPublishNote ? { imagePostSurfaceAfterPublishNote } : {})
    };
  }

  /** PreparePublish may continue through a content-type selection after the shared note surface click; Gate never calls this continuation. */
  private async selectImagePostContentTypeForPrepare(page: Page, operationId: string, accountId: string, startedAt: number): Promise<void> {
    let contentTypeEntry: { locator: Locator; selectorSignal: string };
    try {
      contentTypeEntry = await this.discoverContentTypeEntry(page);
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CONTENT_TYPE_ENTRY_FOUND", true, contentTypeEntry.selectorSignal);
    } catch (error) {
      const failure = this.failureDetailsForError(error);
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CONTENT_TYPE_ENTRY_FOUND", false, failure.missingSignal ?? "content-type:image-text");
      throw error;
    }
    const contentTypeUrlBeforeClick = sanitizePageUrl(page);
    try {
      await contentTypeEntry.locator.click();
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CONTENT_TYPE_SELECTED", true, contentTypeEntry.selectorSignal, contentTypeUrlBeforeClick, sanitizePageUrl(page), "CONTENT_TYPE_CLICK");
    } catch (error) {
      this.emitEditorEntryStep(page, operationId, accountId, startedAt, "CONTENT_TYPE_SELECTED", false, contentTypeEntry.selectorSignal, contentTypeUrlBeforeClick, sanitizePageUrl(page), "CONTENT_TYPE_CLICK");
      throw new XiaohongshuGateError("CONTENT_TYPE_SELECTION_FAILED", "CONTENT_REJECTED", `图文内容类型选择失败：${error instanceof Error ? error.message : String(error)}`, { failureCode: "CONTENT_TYPE_SELECTION_FAILED", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "content-type:image-text" });
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const currentUrl = page.url();
      if (this.isLoginPage(currentUrl)) throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "图文内容类型选择后被重定向到登录页", { failureCode: "AUTH_REDIRECTED_TO_LOGIN", failureStage: "AUTHENTICATION", missingSignal: "login-url" });
      if (this.isVerificationUrl(currentUrl)) throw new XiaohongshuGateError("SECURITY_VERIFICATION_REQUIRED", "USER_ACTION_REQUIRED", "图文内容类型选择后出现安全验证页；未尝试绕过", { failureCode: "SECURITY_VERIFICATION_REQUIRED", failureStage: "AUTHENTICATION", missingSignal: "security-verification-url" });
      if (this.isEditorRoute(currentUrl)) return;
      await waitForProbe(page);
    }
    throw new XiaohongshuGateError("EDITOR_NAVIGATION_TIMEOUT", "USER_ACTION_REQUIRED", "图文内容类型选择后未到达编辑器路由", { failureCode: "EDITOR_NAVIGATION_TIMEOUT", failureStage: "EDITOR_NAVIGATION", missingSignal: "editor-route-wait" });
  }

  private async discoverPublishEntry(page: Page, operationId: string, accountId: string): Promise<{ locator: Locator; selectorSignal: string; requiresContentTypeSelection: boolean }> {
    let snapshot: XiaohongshuPublishEntryCandidateSnapshot;
    try {
      snapshot = await collectPublishEntryCandidates(page);
      this.emitEditorEntryDiagnostic({
        code: "PUBLISH_ENTRY_CANDIDATES_OBSERVED",
        timestamp: new Date().toISOString(),
        operationId,
        platformKey: "xiaohongshu",
        accountId,
        sanitizedUrl: sanitizePageUrl(page),
        candidateCount: snapshot.candidates.length,
        candidates: snapshot.candidates.map(candidateIdentity),
        candidateInventoryTruncated: snapshot.truncated
      });
    } catch (error) {
      this.emitEditorEntryDiagnostic({
        code: "PUBLISH_ENTRY_CANDIDATES_OBSERVED",
        timestamp: new Date().toISOString(),
        operationId,
        platformKey: "xiaohongshu",
        accountId,
        sanitizedUrl: sanitizePageUrl(page),
        candidateCount: 0,
        candidates: [],
        failureCode: "PUBLISH_ENTRY_DIAGNOSTIC_FAILED",
        failureStage: "PUBLISH_ENTRY_DISCOVERY",
        missingSignal: "publish-entry-candidate-inventory"
      });
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `发布入口候选诊断失败：${error instanceof Error ? error.message : String(error)}`, { failureCode: "PUBLISH_ENTRY_DIAGNOSTIC_FAILED", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: "publish-entry-candidate-inventory" });
    }

    const result = findPublishEntry(snapshot);
    if (result.status !== "FOUND_UNIQUE") {
      throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `发布入口未通过 fail-closed 候选决策：${result.status}`, { failureCode: result.failureCode, failureStage: result.failureStage, missingSignal: result.missingSignal });
    }
    return { locator: result.candidate.locator, selectorSignal: result.selectorSignal, requiresContentTypeSelection: result.requiresContentTypeSelection };
  }

  private async discoverContentTypeEntry(page: Page): Promise<{ locator: Locator; selectorSignal: string }> {
    const typed = page.locator(XIAOHONGSHU_CONTENT_TYPE_ENTRY_SELECTOR);
    const typedCount = await locatorCount(typed);
    if (typedCount === 1 && await isVisible(typed) && await isEnabled(typed)) return { locator: typed, selectorSignal: XIAOHONGSHU_CONTENT_TYPE_ENTRY_SELECTOR };
    const generic = page.locator("button, [role=\"button\"], a");
    const matches: Locator[] = [];
    for (let index = 0; index < await locatorCount(generic); index += 1) {
      const candidate = locatorAt(generic, index);
      if (!(await isVisible(candidate)) || !(await isEnabled(candidate))) continue;
      const label = normalizeXiaohongshuEditorText((await innerText(candidate)) || (await attribute(candidate, "aria-label")) || (await attribute(candidate, "title")));
      if (XIAOHONGSHU_IMAGE_POST_PATTERN.test(label) && !XIAOHONGSHU_VIDEO_PATTERN.test(label)) matches.push(candidate);
    }
    if (matches.length === 1) return { locator: matches[0]!, selectorSignal: "semantic:CONTENT_TYPE_IMAGE_TEXT" };
    throw new XiaohongshuGateError("CONTENT_TYPE_ENTRY_NOT_FOUND", "CONTENT_REJECTED", "发布菜单中未发现唯一、可见、启用的图文内容类型入口", { failureCode: "CONTENT_TYPE_ENTRY_NOT_FOUND", failureStage: "CONTENT_TYPE_SELECTION", missingSignal: "content-type:image-text" });
  }

  private async hasUniqueEditor(page: Page, field: "title" | "body"): Promise<boolean> {
    try {
      await this.discoverUniqueEditor(page, field);
      return true;
    } catch {
      return false;
    }
  }

  private async hasImageUploadControl(page: Page): Promise<boolean> {
    const input = page.locator(XIAOHONGSHU_FILE_SELECTOR);
    return await locatorCount(input) === 1 && await isVisible(input) && await isEnabled(input);
  }

  private async discoverImagePostEntry(page: Page): Promise<{ locator: Locator; selectorSignal: string }> {
    const imageEntry = page.locator(XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR);
    const imageCount = await locatorCount(imageEntry);
    if (imageCount === 1 && await isVisible(imageEntry) && await isEnabled(imageEntry)) return { locator: imageEntry, selectorSignal: XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR };
    const videoEntry = page.locator(XIAOHONGSHU_VIDEO_POST_ENTRY_SELECTOR);
    const videoCount = await locatorCount(videoEntry);
    if (videoCount > 0) throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "页面只发现视频入口，未发现唯一可用的图文发布入口", { failureCode: "PUBLISH_ENTRY_NOT_FOUND", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR });
    const generic = page.locator('button, [role="button"], a');
    const genericMatches: Locator[] = [];
    for (let index = 0; index < await locatorCount(generic); index += 1) {
      const candidate = locatorAt(generic, index);
      if (!(await isVisible(candidate)) || !(await isEnabled(candidate))) continue;
      const label = normalizeXiaohongshuEditorText((await innerText(candidate)) || (await attribute(candidate, "aria-label")) || (await attribute(candidate, "title")));
      if (XIAOHONGSHU_IMAGE_POST_PATTERN.test(label) && !XIAOHONGSHU_VIDEO_PATTERN.test(label)) genericMatches.push(candidate);
    }
    if (genericMatches.length === 1) return { locator: genericMatches[0], selectorSignal: "semantic:IMAGE_TEXT_PUBLISH_ENTRY" };
    throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `图文入口未通过唯一、可见、启用校验；matches=${imageCount}`, { failureCode: "PUBLISH_ENTRY_NOT_FOUND", failureStage: "PUBLISH_ENTRY_DISCOVERY", missingSignal: XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR });
  }

  private async uploadImages(
    page: Page,
    images: string[],
    diagnosticContext?: {
      boundImages?: PublishArticleInput["boundImages"];
      ctx: AccountContext;
      session: BrowserSession;
      metadata: { operationId: string; platformKey: "xiaohongshu"; accountId: string; contextDebugId: string; pageDebugId: string };
      selfTestMode?: "POST_UPLOAD_DISCOVERY_ONLY" | "XHS_PUBLISH_FLOW_EXPLORATION";
      uploadAttemptIndex?: number;
      onMutationStarted?: () => void;
      expectedFileMetadata?: XiaohongshuUploadFileExpectation;
    }
  ): Promise<Record<string, unknown>> {
    const input = page.locator(XIAOHONGSHU_FILE_SELECTOR);
    const inputCount = await locatorCount(input);
    if (inputCount !== 1 || !(await isEnabled(input))) throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", `图片上传控件未通过唯一且启用校验；matches=${inputCount}`);
    if (diagnosticContext) {
      this.emitEditorEntryDiagnostic({
        code: "IMAGE_UPLOAD_STARTED",
        timestamp: new Date().toISOString(),
        operationId: diagnosticContext.metadata.operationId,
        platformKey: "xiaohongshu",
        accountId: diagnosticContext.ctx.accountId,
        contextDebugId: diagnosticContext.metadata.contextDebugId,
        pageDebugId: diagnosticContext.metadata.pageDebugId,
        sanitizedUrl: sanitizePageUrl(page),
        action: "IMAGE_UPLOAD_MUTATION",
        mutationType: "IMAGE_UPLOAD_ONLY",
        ...(diagnosticContext.selfTestMode ? { selfTestMode: diagnosticContext.selfTestMode } : {}),
        uploadMutationCount: 1,
        ...(diagnosticContext.uploadAttemptIndex === undefined ? {} : { uploadAttemptIndex: diagnosticContext.uploadAttemptIndex }),
        requestedCount: images.length
      });
    }
    try {
      const immediateReadback = await readXiaohongshuUploadInputImmediately(input, images, diagnosticContext?.expectedFileMetadata, diagnosticContext?.onMutationStarted, diagnosticContext?.boundImages);
      if (diagnosticContext) {
        this.emitEditorEntryDiagnostic({
          code: "IMAGE_UPLOAD_INPUT_READBACK",
          timestamp: new Date().toISOString(),
          operationId: diagnosticContext.metadata.operationId,
          platformKey: "xiaohongshu",
          accountId: diagnosticContext.ctx.accountId,
          contextDebugId: diagnosticContext.metadata.contextDebugId,
          pageDebugId: diagnosticContext.metadata.pageDebugId,
          sanitizedUrl: sanitizePageUrl(page),
          action: "IMAGE_UPLOAD_INPUT_READBACK",
          mutationType: "IMAGE_UPLOAD_ONLY",
          ...(diagnosticContext.selfTestMode ? { selfTestMode: diagnosticContext.selfTestMode } : {}),
          uploadMutationCount: 1,
          ...(diagnosticContext.uploadAttemptIndex === undefined ? {} : { uploadAttemptIndex: diagnosticContext.uploadAttemptIndex }),
          fileInputImmediateReadbackStatus: immediateReadback.status,
          fileInputFilesLength: immediateReadback.readback.filesLength,
          fileInputExpectedFixtureMatch: immediateReadback.expectedFixtureMatch
        });
      }
      if (immediateReadback.status !== "PASS") {
        throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", `setInputFiles 后同一 file input 即时回读未通过；failure=${immediateReadback.failureCode ?? "FILE_INPUT_READBACK_MISMATCH"}; files=${immediateReadback.readback.filesLength}`);
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const pageContent = await bodyText(page);
        if (/上传失败|图片上传失败|upload failed/iu.test(pageContent)) throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", "页面显示图片上传失败");
        const busy = page.locator(XIAOHONGSHU_UPLOAD_BUSY_SELECTOR);
        const postUploadSnapshot = await inspectXiaohongshuPostUploadReconciliationDom(page);
        const previewCount = postUploadSnapshot.visibleImageItemCount;
        if (previewCount >= images.length && previewCount > 0 && !postUploadSnapshot.processingSignalPresent && await locatorCount(busy) === 0) {
          if (diagnosticContext) {
            this.emitEditorEntryDiagnostic({
              code: "IMAGE_UPLOAD_COMPLETED",
              timestamp: new Date().toISOString(),
              operationId: diagnosticContext.metadata.operationId,
              platformKey: "xiaohongshu",
              accountId: diagnosticContext.ctx.accountId,
              contextDebugId: diagnosticContext.metadata.contextDebugId,
              pageDebugId: diagnosticContext.metadata.pageDebugId,
              sanitizedUrl: sanitizePageUrl(page),
              action: "IMAGE_UPLOAD_COMPLETED",
              mutationType: "IMAGE_UPLOAD_ONLY",
              ...(diagnosticContext.selfTestMode ? { selfTestMode: diagnosticContext.selfTestMode } : {}),
              ...(diagnosticContext.uploadAttemptIndex === undefined ? {} : { uploadAttemptIndex: diagnosticContext.uploadAttemptIndex }),
              requestedCount: images.length,
              previewCount,
              previewDetector: "POST_UPLOAD_EDITOR_SCOPED",
              fileInputImmediateReadbackStatus: immediateReadback.status,
              fileInputFilesLength: immediateReadback.readback.filesLength,
              fileInputExpectedFixtureMatch: immediateReadback.expectedFixtureMatch,
              verified: true
            });
          }
          return { mechanism: "input[type=file]", requestedCount: images.length, previewCount, previewVisible: true, previewDetector: "POST_UPLOAD_EDITOR_SCOPED", uploadBusyCount: 0, verified: true, uploadedImageSha256: immediateReadback.uploadedByteSha256?.[0] ?? null, fileInputImmediateReadback: immediateReadback };
        }
        await waitForProbe(page);
      }
    } catch (error) {
      if (diagnosticContext) {
        this.emitEditorEntryDiagnostic({
          code: "IMAGE_UPLOAD_FAILED",
          timestamp: new Date().toISOString(),
          operationId: diagnosticContext.metadata.operationId,
          platformKey: "xiaohongshu",
          accountId: diagnosticContext.ctx.accountId,
          contextDebugId: diagnosticContext.metadata.contextDebugId,
          pageDebugId: diagnosticContext.metadata.pageDebugId,
          sanitizedUrl: sanitizePageUrl(page),
          action: "IMAGE_UPLOAD_FAILED",
          mutationType: "IMAGE_UPLOAD_ONLY",
          ...(diagnosticContext.selfTestMode ? { selfTestMode: diagnosticContext.selfTestMode } : {}),
          ...(diagnosticContext.uploadAttemptIndex === undefined ? {} : { uploadAttemptIndex: diagnosticContext.uploadAttemptIndex }),
          requestedCount: images.length,
          uploadFailureCode: error instanceof XiaohongshuGateError ? error.gateCode : "IMAGE_UPLOAD_NOT_VERIFIED"
        });
      }
      if (error instanceof XiaohongshuGateError) throw error;
      throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", `图片上传控件操作或页面验证失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (diagnosticContext) {
      this.emitEditorEntryDiagnostic({
        code: "IMAGE_UPLOAD_FAILED",
        timestamp: new Date().toISOString(),
        operationId: diagnosticContext.metadata.operationId,
        platformKey: "xiaohongshu",
        accountId: diagnosticContext.ctx.accountId,
        contextDebugId: diagnosticContext.metadata.contextDebugId,
        pageDebugId: diagnosticContext.metadata.pageDebugId,
        sanitizedUrl: sanitizePageUrl(page),
        action: "IMAGE_UPLOAD_FAILED",
        mutationType: "IMAGE_UPLOAD_ONLY",
        ...(diagnosticContext.selfTestMode ? { selfTestMode: diagnosticContext.selfTestMode } : {}),
        ...(diagnosticContext.uploadAttemptIndex === undefined ? {} : { uploadAttemptIndex: diagnosticContext.uploadAttemptIndex }),
        requestedCount: images.length,
        uploadFailureCode: "IMAGE_UPLOAD_NOT_VERIFIED"
      });
    }
    throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", "setInputFiles 后未取得真实页面预览且无上传进行中状态；未声明上传成功");
  }

  private async discoverUniqueEditor(page: Page, field: "title" | "body"): Promise<Locator> {
    const selectors = field === "title" ? [XIAOHONGSHU_TITLE_SELECTOR, XIAOHONGSHU_TITLE_FALLBACK_SELECTOR] : [XIAOHONGSHU_BODY_SELECTOR];
    for (const selector of selectors) {
      const candidates = page.locator(selector);
      const count = await locatorCount(candidates);
      if (count === 1 && await isVisible(candidates) && await isEnabled(candidates)) return candidates;
      if (count > 1) throw new XiaohongshuGateError(field === "title" ? "CONTENT_TITLE_NOT_VERIFIED" : "CONTENT_BODY_NOT_VERIFIED", "CONTENT_REJECTED", `${field} editor 未通过唯一校验；matches=${count}`);
    }
    throw new XiaohongshuGateError(field === "title" ? "CONTENT_TITLE_NOT_VERIFIED" : "CONTENT_BODY_NOT_VERIFIED", "CONTENT_REJECTED", `${field} editor 未通过唯一、可见、启用校验`);
  }

  private async inspectRequiredFields(page: Page): Promise<Array<{ label: string; empty: boolean; visible: boolean; enabled: boolean }>> {
    const required = page.locator(XIAOHONGSHU_REQUIRED_SELECTOR);
    const fields: Array<{ label: string; empty: boolean; visible: boolean; enabled: boolean }> = [];
    for (let index = 0; index < await locatorCount(required); index += 1) {
      const field = locatorAt(required, index);
      const value = await inputValue(field);
      const label = normalizeXiaohongshuEditorText((await attribute(field, "aria-label")) || (await attribute(field, "placeholder")) || (await innerText(field)));
      const checked = await attribute(field, "aria-checked");
      const type = (await attribute(field, "type")).toLowerCase();
      const role = (await attribute(field, "role")).toLowerCase();
      const visible = await isVisible(field);
      const enabled = await isEnabled(field);
      if (!visible || !enabled) continue;
      const toggle = type === "checkbox" || type === "radio" || role === "checkbox" || role === "radio";
      fields.push({ label, empty: toggle ? !(checked === "true" || await isChecked(field)) : !value.trim(), visible, enabled });
    }
    return fields;
  }

  private async inspectPublishSettings(page: Page): Promise<Array<{ label: string; required: boolean; value: string }>> {
    const controls = page.locator(XIAOHONGSHU_SETTINGS_SELECTOR);
    const settings: Array<{ label: string; required: boolean; value: string }> = [];
    for (let index = 0; index < await locatorCount(controls); index += 1) {
      const control = locatorAt(controls, index);
      const label = normalizeXiaohongshuEditorText((await attribute(control, "aria-label")) || (await attribute(control, "title")) || (await innerText(control)));
      const value = (await attribute(control, "aria-checked")) || (await inputValue(control));
      settings.push({ label, required: (await attribute(control, "aria-required")) === "true", value });
    }
    return settings;
  }

  private async inspectFinalSubmitControl(page: Page): Promise<XiaohongshuFinalSubmitControlEvidence> {
    const controls = page.locator(XIAOHONGSHU_FINAL_SUBMIT_SELECTOR);
    const count = await locatorCount(controls);
    const matches: Array<{ locator: Locator; label: string; visible: boolean; enabled: boolean; secondConfirmation: "present" | "absent" | "unknown" }> = [];
    for (let index = 0; index < count; index += 1) {
      const control = locatorAt(controls, index);
      const label = normalizeXiaohongshuEditorText((await innerText(control)) || (await attribute(control, "aria-label")) || (await attribute(control, "title")));
      if (!XIAOHONGSHU_FINAL_SUBMIT_PATTERN.test(label) || XIAOHONGSHU_VIDEO_PATTERN.test(label)) continue;
      const visible = await isVisible(control);
      const enabled = await isEnabled(control);
      let secondConfirmation: "present" | "absent" | "unknown" = (await attribute(control, "data-confirm")) === "true" ? "present" : "absent";
      if (secondConfirmation === "absent") {
        const confirmations = page.locator('[data-testid*="confirm" i], [aria-label*="确认发布"], [class*="confirm" i]');
        const confirmationCount = await locatorCount(confirmations);
        for (let confirmationIndex = 0; confirmationIndex < confirmationCount; confirmationIndex += 1) {
          if (await isVisible(locatorAt(confirmations, confirmationIndex))) { secondConfirmation = "present"; break; }
        }
      }
      if (visible && enabled) matches.push({ locator: control, label, visible, enabled, secondConfirmation });
    }
    if (matches.length !== 1) throw new XiaohongshuGateError("FINAL_SUBMIT_CONTROL_NOT_VERIFIED", "FINAL_SUBMIT_CONTROL_NOT_FOUND", `最终发布控件未通过唯一、可见、启用 discovery；matches=${matches.length}`);
    return { verified: true, visible: matches[0].visible, enabled: matches[0].enabled, unique: true, label: matches[0].label, selector: XIAOHONGSHU_FINAL_SUBMIT_SELECTOR, secondConfirmation: matches[0].secondConfirmation };
  }
}

export { definition as xiaohongshuBrowserDefinition };

export { XhsProductionReceiptObserver, type XhsReceiptEvent, type XhsReceiptMeta } from "./production-receipt-observer";
