import type { Locator, Page } from "playwright-core";
import type { PreSubmitGateFailureCode, PreSubmitGateFailureStage } from "@publisher/adapters-core";
import { recoverNativeFilePicker, type NativeFilePickerRecoveryProbe, type NativeFilePickerRecoveryResult } from "./native-file-picker-recovery";

export type ImageEditorShellStatus = "IMAGE_EDITOR_SHELL_READY" | "IMAGE_EDITOR_SHELL_NOT_READY" | "IMAGE_EDITOR_SHELL_TIMEOUT";
export type ImageEditorInspectionStatus = "READY" | "FAILED";
export type ImageEditorContentType = "IMAGE_POST" | "VIDEO" | "UNKNOWN";
export type ImageEditorControlStatus = "FOUND_UNIQUE" | "NOT_FOUND" | "AMBIGUOUS" | "NOT_VISIBLE" | "DISABLED";
export type ImageEditorSettingsStatus = ImageEditorControlStatus | "NOT_APPLICABLE";
export type ImageEditorPhase = "IMAGE_POST_PRE_UPLOAD" | "IMAGE_POST_POST_UPLOAD_EDITOR" | "IMAGE_POST_MEDIA_PREVIEW" | "IMAGE_POST_MEDIA_EDITING" | "IMAGE_POST_CONFIRMATION_REQUIRED" | "IMAGE_POST_TRANSITIONING" | "IMAGE_POST_UNKNOWN" | "LOGIN" | "SECURITY_VERIFICATION";
export type ImageEditorPhaseConfidence = "HIGH" | "LOW";
export type ImageEditorUploadCapabilityStatus = "PRESENT" | "AMBIGUOUS" | "ABSENT";
export type ImageEditorPostUploadControlsStatus = "READY" | "FAIL";
export type ImageEditorSelectedTab = "上传视频" | "上传图文" | "写长文" | "发播客";

export interface ImageEditorTabPresence {
  uploadVideoTabPresent: boolean;
  uploadImageTabPresent: boolean;
  longFormTabPresent: boolean;
  podcastTabPresent: boolean;
  currentSelectedTab: ImageEditorSelectedTab | null;
}

export interface ImageEditorTabCandidateEvidence {
  label: ImageEditorSelectedTab;
  rendered: boolean;
  intersectsViewport: boolean;
  creatorTabRendered: boolean;
  creatorTabIntersectsViewport: boolean;
  enabled: boolean;
  pointerEvents: string;
  active: boolean;
}

export interface ImageEditorBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEditorSemanticNode {
  tagName: string;
  normalizedText: string;
  role: string | null;
  visible: boolean;
  enabled: boolean;
  boundingBox: ImageEditorBoundingBox | null;
  nearestInteractiveAncestorTag: string | null;
  nearestInteractiveAncestorRole: string | null;
}

export interface ImageEditorUploadAncestor {
  depth: number;
  tagName: string;
  role: string | null;
  boundedClassTokens: readonly string[];
  visible: boolean;
  pointerEvents: string;
  boundingBox: ImageEditorBoundingBox | null;
  semanticTextSignal: string | null;
}

export interface ImageEditorUploadControlRelationship {
  candidateId: string;
  tagName: string;
  type: string;
  accept: string | null;
  multiple: boolean;
  enabled: boolean;
  visible: boolean;
  usableSurface: boolean;
  surfaceSignal: string;
  ancestors: readonly ImageEditorUploadAncestor[];
}

export interface ImageEditorPhaseTopology {
  titleCandidateCount: number;
  bodyCandidateCount: number;
  uploadCandidateCount: number;
  finalSubmitCandidateCount: number;
  contenteditableCount: number;
  textareaCount: number;
  textInputCount: number;
  fileInputCount: number;
  buttonCount: number;
  roleButtonCount: number;
  semanticSignals: readonly string[];
  stable: boolean;
}

export interface ImageEditorInteractiveTopology {
  buttonCount: number;
  roleButtonCount: number;
  dialogCount: number;
  modalSignalCount: number;
  fileInputCount: number;
  contenteditableCount: number;
  textareaCount: number;
  textInputCount: number;
  titleCandidateCount: number;
  bodyCandidateCount: number;
  finalSubmitCandidateCount: number;
}

export interface ImageEditorMediaPreviewDiagnostics {
  previewCount: number;
  previewVisible: boolean;
  previewGeometry: readonly ImageEditorBoundingBox[];
  deleteReplaceEditSignals: readonly string[];
  associatedSemanticText: readonly string[];
}

export interface ImageEditorModalDiagnostics {
  dialogCount: number;
  modalSignalCount: number;
  maskCount: number;
  overlayCount: number;
  drawerCount: number;
  visible: boolean;
  ariaModalCount: number;
}

export interface ImageEditorIntermediateActionCandidate {
  candidateId: string;
  tagName: string;
  role: string | null;
  semanticSignal: string;
  visible: boolean;
  enabled: boolean;
  normalizedText?: string;
  boundingBox?: ImageEditorBoundingBox | null;
  nearestInteractiveAncestorTag?: string | null;
  nearestInteractiveAncestorRole?: string | null;
  pointerEvents?: string;
  hitTestValid?: boolean;
}

export interface ImageEditorPhaseEvidence {
  shellReady: boolean;
  contentType: ImageEditorContentType;
  contentTypeReady: boolean;
  loginPagePresent: boolean;
  securityVerificationPresent: boolean;
  domStable: boolean;
  uploadCapabilityPresent: boolean;
  uploadCapabilityUnique: boolean;
  preUploadSemanticSignalPresent: boolean;
  selectedTab: ImageEditorSelectedTab | null;
  titleCandidateCount: number;
  bodyCandidateCount: number;
  finalSubmitCandidateCount: number;
}

export interface ImageEditorPhaseClassification {
  phase: ImageEditorPhase;
  confidence: ImageEditorPhaseConfidence;
  reason: string;
}

interface ImageEditorPhaseDomSnapshot {
  currentUrl: string;
  readyState: string;
  shellSignal: boolean;
  shellFingerprint: string;
  contentTypeSignal: ImageEditorContentType;
  uploadCandidateCount: number;
  securityVerificationPresent: boolean;
  loginPagePresent: boolean;
  domStable: boolean;
  uploadCapabilityPresent: boolean;
  uploadCapabilityUnique: boolean;
  preUploadSemanticSignalPresent: boolean;
  titleCandidateCount: number;
  bodyCandidateCount: number;
  finalSubmitCandidateCount: number;
  preUploadSemanticNodes: readonly ImageEditorSemanticNode[];
  postUploadSemanticNodes: readonly ImageEditorSemanticNode[];
  uploadControlRelationships: readonly ImageEditorUploadControlRelationship[];
  phaseTopology: ImageEditorPhaseTopology;
  interactiveTopology: ImageEditorInteractiveTopology;
  mediaPreviewDiagnostics: ImageEditorMediaPreviewDiagnostics;
  modalDiagnostics: ImageEditorModalDiagnostics;
  intermediateActionCandidates: readonly ImageEditorIntermediateActionCandidate[];
  requiredValidationSignals: readonly string[];
  forbiddenActionSignalPresent: boolean;
  mediaPreviewSignalPresent: boolean;
  mediaEditingSignalPresent: boolean;
  tabPresence: ImageEditorTabPresence;
  tabCandidates: readonly ImageEditorTabCandidateEvidence[];
  uploadBusy?: boolean;
  previewReady?: boolean;
}

export interface ImageEditorUploadCapabilityResult {
  status: ImageEditorUploadCapabilityStatus;
  present: boolean;
  uniqueSurface: boolean;
  usableRelationships: readonly ImageEditorUploadControlRelationship[];
}

export type ImageEditorControlKind = "TITLE_EDITOR" | "BODY_EDITOR" | "IMAGE_UPLOAD_CONTROL" | "FINAL_SUBMIT_CONTROL";

export interface ImageEditorControlCandidate {
  candidateId: string;
  tagName: string;
  role: string | null;
  semanticSignal: string;
  visible: boolean;
  enabled: boolean;
  boundingBox?: ImageEditorBoundingBox | null;
  hitTestValid?: boolean;
  normalizedText?: string;
}

export interface ImageEditorControlDiscovery {
  kind: ImageEditorControlKind;
  status: ImageEditorControlStatus;
  detected: boolean;
  candidates: readonly ImageEditorControlCandidate[];
}

export interface ImageEditorSettingsDiscovery {
  status: ImageEditorSettingsStatus;
  detected: boolean;
  candidates: readonly ImageEditorControlCandidate[];
}

export interface ImageEditorDomSnapshot {
  currentUrl: string;
  readyState: string;
  shellSignal: boolean;
  shellFingerprint: string;
  contentTypeSignal: ImageEditorContentType;
  securityVerificationPresent: boolean;
  loginPagePresent: boolean;
  titleCandidates: readonly ImageEditorControlCandidate[];
  bodyCandidates: readonly ImageEditorControlCandidate[];
  uploadCandidates: readonly ImageEditorControlCandidate[];
  publishSettingsCandidates: readonly ImageEditorControlCandidate[];
  finalSubmitCandidates: readonly ImageEditorControlCandidate[];
  postUploadSemanticNodes?: readonly ImageEditorSemanticNode[];
  interactiveTopology?: ImageEditorInteractiveTopology;
  mediaPreviewDiagnostics?: ImageEditorMediaPreviewDiagnostics;
  modalDiagnostics?: ImageEditorModalDiagnostics;
  intermediateActionCandidates?: readonly ImageEditorIntermediateActionCandidate[];
  requiredValidationSignals?: readonly string[];
  forbiddenActionSignalPresent?: boolean;
  mediaPreviewSignalPresent?: boolean;
  mediaEditingSignalPresent?: boolean;
  phaseTopology?: ImageEditorPhaseTopology;
  tabPresence?: ImageEditorTabPresence;
  tabCandidates?: readonly ImageEditorTabCandidateEvidence[];
  uploadBusy?: boolean;
  previewReady?: boolean;
}

export interface ImageEditorReadinessSample {
  sampleIndex: number;
  elapsedMs: number;
  readyState: string;
  currentUrl: string;
  shellSignal: boolean;
  shellFingerprint: string;
  titleCandidateCount: number;
  bodyCandidateCount: number;
  uploadCandidateCount: number;
  finalSubmitCandidateCount: number;
  securityVerificationPresent: boolean;
  loginPagePresent: boolean;
  uploadBusy?: boolean;
  previewReady?: boolean;
  observedPhase?: ImageEditorPhase;
  domStable?: boolean;
}

export interface ImageEditorInspectionMetadata {
  operationId: string;
  platformKey: "xiaohongshu";
  accountId: string;
  contextDebugId: string;
  pageDebugId: string;
}

export type ImageEditorDiagnosticCode =
  | "IMAGE_EDITOR_INSPECTION_STARTED"
  | "IMAGE_EDITOR_READINESS_SAMPLE"
  | "IMAGE_EDITOR_SHELL_READY"
  | "IMAGE_EDITOR_SHELL_NOT_READY"
  | "IMAGE_EDITOR_SHELL_TIMEOUT"
  | "IMAGE_EDITOR_CONTENT_TYPE_OBSERVED"
  | "IMAGE_EDITOR_CONTROLS_DISCOVERED"
  | "IMAGE_EDITOR_PHASE_OBSERVED"
  | "IMAGE_EDITOR_INSPECTION_COMPLETED"
  | "IMAGE_EDITOR_INSPECTION_FAILED"
  | "PRE_UPLOAD_GATE_INSPECTION_STARTED"
  | "PRE_UPLOAD_GATE_RESULT"
  | "PREPARE_PUBLISH_MUTATION_BOUNDARY_ENTERED"
  | "IMAGE_UPLOAD_STARTED"
  | "IMAGE_UPLOAD_COMPLETED"
  | "IMAGE_UPLOAD_FAILED"
  | "POST_UPLOAD_EDITOR_READINESS_STARTED"
  | "POST_UPLOAD_EDITOR_READINESS_SAMPLE"
  | "POST_UPLOAD_EDITOR_SEMANTIC_INVENTORY_OBSERVED"
  | "POST_UPLOAD_EDITOR_INTERACTIVE_TOPOLOGY_OBSERVED"
  | "POST_UPLOAD_EDITOR_MEDIA_PREVIEW_OBSERVED"
  | "POST_UPLOAD_EDITOR_MODAL_STATE_OBSERVED"
  | "POST_UPLOAD_EDITOR_PHASE_OBSERVED"
  | "POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED"
  | "POST_UPLOAD_EDITOR_INSPECTION_FAILED"
  | "POST_UPLOAD_EDITOR_INSPECTION_COMPLETED";

export interface ImageEditorDiagnostic {
  code: ImageEditorDiagnosticCode;
  timestamp: string;
  operationId: string;
  platformKey: "xiaohongshu";
  accountId: string;
  contextDebugId: string;
  pageDebugId: string;
  sanitizedUrl: string;
  shellStatus?: ImageEditorShellStatus;
  sampleIndex?: number;
  elapsedMs?: number;
  domStable?: boolean;
  readyState?: string;
  currentUrl?: string;
  titleCandidateCount?: number;
  bodyCandidateCount?: number;
  uploadCandidateCount?: number;
  finalSubmitCandidateCount?: number;
  securityVerificationPresent?: boolean;
  loginPagePresent?: boolean;
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
  status?: ImageEditorInspectionStatus;
  failureCode?: PreSubmitGateFailureCode;
  failureStage?: PreSubmitGateFailureStage;
  missingSignal?: string | null;
  expectedPhase?: ImageEditorPhase;
  observedPhase?: ImageEditorPhase;
  preSubmitGatePhase?: "PRE_UPLOAD" | "POST_UPLOAD";
  preUploadGateStatus?: "PASS" | "FAIL";
  preUploadGateFailureCode?: PreSubmitGateFailureCode | null;
  postUploadControlsStatus?: ImageEditorPostUploadControlsStatus | "NOT_APPLICABLE_BEFORE_UPLOAD";
  preSubmitGatePassMeaning?: string | null;
  uploadBusy?: boolean;
  previewReady?: boolean;
  action?: "IMAGE_UPLOAD_MUTATION" | "IMAGE_UPLOAD_COMPLETED" | "IMAGE_UPLOAD_FAILED";
  mutationType?: "IMAGE_UPLOAD_ONLY";
  selfTestMode?: "POST_UPLOAD_DISCOVERY_ONLY";
  uploadMutationCount?: number;
  uploadAttemptIndex?: number;
  nativeFilePickerDetected?: boolean;
  nativeFilePickerCancelled?: boolean;
  nativeFilePickerRecovery?: NativeFilePickerRecoveryResult["status"];
  nativeFilePickerWindowIdBefore?: string | null;
  nativeFilePickerWindowIdAfter?: string | null;
  nativeFilePickerOpenBefore?: boolean;
  nativeFilePickerOpenAfter?: boolean | null;
  nativeFilePickerCancelActionSent?: boolean;
  nativeFilePickerCancelEffectVerified?: boolean;
}

export interface ImagePostEditorInspectionResult {
  status: ImageEditorInspectionStatus;
  shellStatus: ImageEditorShellStatus;
  readinessSamples: readonly ImageEditorReadinessSample[];
  contentType: ImageEditorContentType;
  contentTypeReady: boolean;
  titleEditor: ImageEditorControlDiscovery;
  bodyEditor: ImageEditorControlDiscovery;
  imageUploadControl: ImageEditorControlDiscovery;
  publishSettingsArea: ImageEditorSettingsDiscovery;
  finalSubmitControl: ImageEditorControlDiscovery;
  titleEditorDetected: boolean;
  bodyEditorDetected: boolean;
  imageUploadControlDetected: boolean;
  publishSettingsAreaDetected: boolean;
  finalSubmitControlDetected: boolean;
  finalSubmitControlPresent: boolean;
  finalSubmitControlEnabled: boolean;
  securityVerificationPresent: boolean;
  loginPagePresent: boolean;
  sanitizedUrl: string;
  failureCode?: PreSubmitGateFailureCode;
  failureStage?: PreSubmitGateFailureStage;
  missingSignal?: string | null;
  postUploadSemanticNodes?: readonly ImageEditorSemanticNode[];
  interactiveTopology?: ImageEditorInteractiveTopology;
  mediaPreviewDiagnostics?: ImageEditorMediaPreviewDiagnostics;
  modalDiagnostics?: ImageEditorModalDiagnostics;
  intermediateActionCandidates?: readonly ImageEditorIntermediateActionCandidate[];
  requiredValidationSignals?: readonly string[];
  forbiddenActionSignalPresent?: boolean;
}

export interface ImagePostUploadEditorInspectionResult extends ImagePostEditorInspectionResult {
  expectedPhase: "IMAGE_POST_POST_UPLOAD_EDITOR";
  phase: ImageEditorPhase;
  observedPhase: ImageEditorPhase;
  confidence: ImageEditorPhaseConfidence;
  reason: string;
  postUploadControlsStatus: ImageEditorPostUploadControlsStatus;
  terminalStateReached: boolean;
  intermediateState: "NONE" | "IMAGE_POST_MEDIA_PREVIEW" | "IMAGE_POST_MEDIA_EDITING" | "IMAGE_POST_CONFIRMATION_REQUIRED";
  postUploadReadinessDurationMs: number;
  nativeFilePickerDetected: boolean;
  nativeFilePickerCancelled: boolean;
  nativeFilePickerRecovery: NativeFilePickerRecoveryResult["status"];
  nativeFilePickerWindowIdBefore: string | null;
  nativeFilePickerWindowIdAfter: string | null;
  nativeFilePickerOpenBefore: boolean;
  nativeFilePickerOpenAfter: boolean | null;
  nativeFilePickerCancelActionSent: boolean;
  nativeFilePickerCancelEffectVerified: boolean;
}

export interface PreUploadImageEditorContractResult {
  status: "PASS" | "FAIL";
  expectedPhase: "IMAGE_POST_PRE_UPLOAD";
  observedPhase: ImageEditorPhase;
  observedConfidence: ImageEditorPhaseConfidence;
  postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD";
  failureCode?: PreSubmitGateFailureCode;
  failureStage?: PreSubmitGateFailureStage;
  missingSignal?: string;
}

export interface ImageEditorInspectionOptions {
  maxWaitMs?: number;
  probeIntervalMs?: number;
  readinessWindowMs?: number;
  readinessSampleIntervalMs?: number;
  stableSampleCount?: number;
  requiredControls?: readonly ImageEditorControlKind[];
  postUploadReadiness?: boolean;
  nativeFilePickerRecovery?: NativeFilePickerRecoveryProbe;
  emit?: (diagnostic: ImageEditorDiagnostic) => void;
}

export interface ImagePostUploadPhaseEvidence {
  shellReady: boolean;
  contentType: ImageEditorContentType;
  contentTypeReady: boolean;
  domStable: boolean;
  loginPagePresent: boolean;
  securityVerificationPresent: boolean;
  uploadBusy: boolean;
  previewReady: boolean;
  previewCount: number;
  mediaPreviewSignalPresent?: boolean;
  mediaEditingSignalPresent?: boolean;
  modalVisible: boolean;
  intermediateActionSignalPresent: boolean;
  titleCandidateCount: number;
  bodyCandidateCount: number;
  finalSubmitCandidateCount: number;
}

export interface ImagePostUploadPhaseClassification {
  phase: ImageEditorPhase;
  confidence: ImageEditorPhaseConfidence;
  reason: string;
  terminalStateReached: boolean;
  intermediateState: "NONE" | "IMAGE_POST_MEDIA_PREVIEW" | "IMAGE_POST_MEDIA_EDITING" | "IMAGE_POST_CONFIRMATION_REQUIRED";
}

export interface ImagePostEditorPhaseInspectionResult {
  phase: ImageEditorPhase;
  confidence: ImageEditorPhaseConfidence;
  reason: string;
  readinessSamples: readonly ImageEditorReadinessSample[];
  contentType: ImageEditorContentType;
  contentTypeReady: boolean;
  preUploadSemanticNodes: readonly ImageEditorSemanticNode[];
  uploadControlRelationships: readonly ImageEditorUploadControlRelationship[];
  uploadCapabilityStatus: ImageEditorUploadCapabilityStatus;
  uploadCapabilityPresent: boolean;
  uploadCapabilityUnique: boolean;
  phaseTopology: ImageEditorPhaseTopology;
  interactiveTopology?: ImageEditorInteractiveTopology;
  mediaPreviewDiagnostics?: ImageEditorMediaPreviewDiagnostics;
  modalDiagnostics?: ImageEditorModalDiagnostics;
  intermediateActionCandidates?: readonly ImageEditorIntermediateActionCandidate[];
  requiredValidationSignals?: readonly string[];
  forbiddenActionSignalPresent?: boolean;
  mediaPreviewSignalPresent?: boolean;
  mediaEditingSignalPresent?: boolean;
  tabPresence?: ImageEditorTabPresence;
  securityVerificationPresent: boolean;
  loginPagePresent: boolean;
  sanitizedUrl: string;
}

const DEFAULT_MAX_WAIT_MS = 3_000;
const DEFAULT_PROBE_INTERVAL_MS = 80;
const DEFAULT_STABLE_SAMPLE_COUNT = 2;
const DEFAULT_POST_UPLOAD_READINESS_WINDOW_MS = 15_000;
const DEFAULT_POST_UPLOAD_READINESS_SAMPLE_INTERVAL_MS = 300;
const MAX_READINESS_WINDOW_MS = 60_000;
const EDITOR_ROUTE_PATTERN = /^https:\/\/creator\.xiaohongshu\.com\/publish\/publish(?:[/?#]|$)/iu;
const TITLE_SELECTOR = 'input[placeholder*="标题"], input[aria-label*="标题"], input[name*="title" i], input[id*="title" i], [data-testid*="title" i]';
const TITLE_TEXTAREA_SELECTOR = 'textarea[placeholder*="标题"], textarea[aria-label*="标题"]';
const BODY_SELECTOR = '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder], textarea[aria-label*="正文"], textarea[name*="body" i], textarea[id*="body" i], [data-testid*="body" i][contenteditable="true"]';
const UPLOAD_SELECTOR = 'input[type="file"], [aria-label*="上传图片"], [aria-label*="添加图片"], [data-testid*="upload" i], [class*="upload" i][role="button"]';
const SETTINGS_SELECTOR = 'input[type="checkbox"], input[type="radio"], select, [role="checkbox"], [role="radio"], [data-setting]';
const FINAL_SUBMIT_SELECTOR = 'button, [role="button"]';

function emptyPhaseTopology(): ImageEditorPhaseTopology {
  return {
    titleCandidateCount: 0,
    bodyCandidateCount: 0,
    uploadCandidateCount: 0,
    finalSubmitCandidateCount: 0,
    contenteditableCount: 0,
    textareaCount: 0,
    textInputCount: 0,
    fileInputCount: 0,
    buttonCount: 0,
    roleButtonCount: 0,
    semanticSignals: [],
    stable: false
  };
}

function emptyInteractiveTopology(): ImageEditorInteractiveTopology {
  return {
    buttonCount: 0,
    roleButtonCount: 0,
    dialogCount: 0,
    modalSignalCount: 0,
    fileInputCount: 0,
    contenteditableCount: 0,
    textareaCount: 0,
    textInputCount: 0,
    titleCandidateCount: 0,
    bodyCandidateCount: 0,
    finalSubmitCandidateCount: 0
  };
}

function emptyMediaPreviewDiagnostics(): ImageEditorMediaPreviewDiagnostics {
  return { previewCount: 0, previewVisible: false, previewGeometry: [], deleteReplaceEditSignals: [], associatedSemanticText: [] };
}

function emptyModalDiagnostics(): ImageEditorModalDiagnostics {
  return { dialogCount: 0, modalSignalCount: 0, maskCount: 0, overlayCount: 0, drawerCount: 0, visible: false, ariaModalCount: 0 };
}

function emptyTabPresence(): ImageEditorTabPresence {
  return { uploadVideoTabPresent: false, uploadImageTabPresent: false, longFormTabPresent: false, podcastTabPresent: false, currentSelectedTab: null };
}

function normalizeTabPresence(value: unknown): ImageEditorTabPresence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyTabPresence();
  const record = value as Record<string, unknown>;
  const selected = record.currentSelectedTab;
  return {
    uploadVideoTabPresent: record.uploadVideoTabPresent === true,
    uploadImageTabPresent: record.uploadImageTabPresent === true,
    longFormTabPresent: record.longFormTabPresent === true,
    podcastTabPresent: record.podcastTabPresent === true,
    currentSelectedTab: selected === "上传视频" || selected === "上传图文" || selected === "写长文" || selected === "发播客" ? selected : null
  };
}

function normalizeTabCandidateEvidence(value: unknown): readonly ImageEditorTabCandidateEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): ImageEditorTabCandidateEvidence | null => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const label = record.label;
    if (label !== "上传视频" && label !== "上传图文" && label !== "写长文" && label !== "发播客") return null;
    return {
      label,
      rendered: record.rendered === true,
      intersectsViewport: record.intersectsViewport === true,
      creatorTabRendered: record.creatorTabRendered === true,
      creatorTabIntersectsViewport: record.creatorTabIntersectsViewport === true,
      enabled: record.enabled === true,
      pointerEvents: typeof record.pointerEvents === "string" ? record.pointerEvents.slice(0, 40) : "unknown",
      active: record.active === true
    };
  }).filter((item): item is ImageEditorTabCandidateEvidence => Boolean(item)).slice(0, 40);
}

export function resolveImageEditorTabPresence(candidates: readonly ImageEditorTabCandidateEvidence[]): ImageEditorTabPresence {
  const viewportCandidates = candidates.filter((candidate) => candidate.rendered
    && candidate.intersectsViewport
    && candidate.creatorTabRendered
    && candidate.creatorTabIntersectsViewport
    && candidate.enabled
    && candidate.pointerEvents !== "none");
  const activeCandidates = viewportCandidates.filter((candidate) => candidate.active);
  const currentSelectedTab = activeCandidates.length === 1 ? activeCandidates[0]?.label ?? null : null;
  return {
    uploadVideoTabPresent: viewportCandidates.some((candidate) => candidate.label === "上传视频"),
    uploadImageTabPresent: viewportCandidates.some((candidate) => candidate.label === "上传图文"),
    longFormTabPresent: viewportCandidates.some((candidate) => candidate.label === "写长文"),
    podcastTabPresent: viewportCandidates.some((candidate) => candidate.label === "发播客"),
    currentSelectedTab
  };
}

export function resolveImageEditorUploadCapability(relationships: readonly ImageEditorUploadControlRelationship[]): ImageEditorUploadCapabilityResult {
  const usableRelationships = relationships.filter((relationship) => relationship.enabled && relationship.usableSurface);
  const status: ImageEditorUploadCapabilityStatus = usableRelationships.length === 1
    ? "PRESENT"
    : usableRelationships.length > 1
      ? "AMBIGUOUS"
      : "ABSENT";
  return {
    status,
    present: status === "PRESENT",
    uniqueSurface: status === "PRESENT",
    usableRelationships
  };
}

export function classifyImagePostEditorPhase(evidence: ImageEditorPhaseEvidence): ImageEditorPhaseClassification {
  if (evidence.loginPagePresent) return { phase: "LOGIN", confidence: "HIGH", reason: "login evidence is present" };
  if (evidence.securityVerificationPresent) return { phase: "SECURITY_VERIFICATION", confidence: "HIGH", reason: "security verification evidence is present" };
  if (!evidence.domStable) return { phase: "IMAGE_POST_TRANSITIONING", confidence: "LOW", reason: "editor DOM evidence is not stable" };
  if (!evidence.shellReady || evidence.contentType !== "IMAGE_POST" || !evidence.contentTypeReady) {
    return { phase: "IMAGE_POST_UNKNOWN", confidence: "LOW", reason: "editor shell or image-post content type is not ready" };
  }
  if (evidence.titleCandidateCount > 0 && evidence.bodyCandidateCount > 0 && evidence.finalSubmitCandidateCount > 0) {
    return { phase: "IMAGE_POST_POST_UPLOAD_EDITOR", confidence: "HIGH", reason: "post-upload title, body, and final-submit candidates are present" };
  }
  if (
    evidence.uploadCapabilityPresent
    && evidence.uploadCapabilityUnique
    && evidence.preUploadSemanticSignalPresent
    && evidence.selectedTab === "上传图文"
    && evidence.titleCandidateCount === 0
    && evidence.bodyCandidateCount === 0
    && evidence.finalSubmitCandidateCount === 0
  ) {
    return { phase: "IMAGE_POST_PRE_UPLOAD", confidence: "HIGH", reason: "unique upload capability and pre-upload semantic signals are present while post-upload controls are absent" };
  }
  return { phase: "IMAGE_POST_UNKNOWN", confidence: "LOW", reason: "phase evidence does not satisfy a strict staged-editor rule" };
}

export function classifyPostUploadImageEditorState(evidence: ImagePostUploadPhaseEvidence): ImagePostUploadPhaseClassification {
  const noIntermediate = { terminalStateReached: false, intermediateState: "NONE" as const };
  if (evidence.loginPagePresent) return { phase: "LOGIN", confidence: "HIGH", reason: "login evidence is present", ...noIntermediate };
  if (evidence.securityVerificationPresent) return { phase: "SECURITY_VERIFICATION", confidence: "HIGH", reason: "security verification evidence is present", ...noIntermediate };
  if (!evidence.shellReady || evidence.contentType !== "IMAGE_POST" || !evidence.contentTypeReady) return { phase: "IMAGE_POST_UNKNOWN", confidence: "LOW", reason: "post-upload shell or image-post content type is not ready", ...noIntermediate };
  if (!evidence.domStable) return { phase: "IMAGE_POST_TRANSITIONING", confidence: "LOW", reason: "post-upload DOM evidence is not stable", ...noIntermediate };
  if (evidence.modalVisible && evidence.intermediateActionSignalPresent) {
    return { phase: "IMAGE_POST_CONFIRMATION_REQUIRED", confidence: "HIGH", reason: "a visible modal and intermediate confirmation action are present", terminalStateReached: true, intermediateState: "IMAGE_POST_CONFIRMATION_REQUIRED" };
  }
  if (evidence.mediaEditingSignalPresent) {
    return { phase: "IMAGE_POST_MEDIA_EDITING", confidence: "HIGH", reason: "stable media-editing signals are present", terminalStateReached: true, intermediateState: "IMAGE_POST_MEDIA_EDITING" };
  }
  if (evidence.previewReady && evidence.previewCount > 0 && evidence.mediaPreviewSignalPresent && evidence.intermediateActionSignalPresent) {
    return { phase: "IMAGE_POST_MEDIA_PREVIEW", confidence: "HIGH", reason: "stable media preview and intermediate action signals are present", terminalStateReached: true, intermediateState: "IMAGE_POST_MEDIA_PREVIEW" };
  }
  if (!evidence.uploadBusy && evidence.titleCandidateCount > 0 && evidence.bodyCandidateCount > 0 && evidence.finalSubmitCandidateCount > 0) {
    return { phase: "IMAGE_POST_POST_UPLOAD_EDITOR", confidence: "HIGH", reason: "stable post-upload editor controls are present", terminalStateReached: true, intermediateState: "NONE" };
  }
  return { phase: "IMAGE_POST_TRANSITIONING", confidence: "LOW", reason: "DOM is stable but no terminal post-upload phase has been proven", ...noIntermediate };
}

export function assertPreUploadImageEditorContract(inspection: ImagePostEditorPhaseInspectionResult): PreUploadImageEditorContractResult {
  const base: Pick<PreUploadImageEditorContractResult, "expectedPhase" | "observedPhase" | "observedConfidence" | "postUploadControlsStatus"> = {
    expectedPhase: "IMAGE_POST_PRE_UPLOAD",
    observedPhase: inspection.phase,
    observedConfidence: inspection.confidence,
    postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD"
  };
  const failure = (failureCode: PreSubmitGateFailureCode, missingSignal: string): PreUploadImageEditorContractResult => ({
    ...base,
    status: "FAIL",
    failureCode,
    failureStage: failureCode === "AUTH_REDIRECTED_TO_LOGIN" || failureCode === "SECURITY_VERIFICATION_REQUIRED" ? "AUTHENTICATION" : "EDITOR_DISCOVERY",
    missingSignal
  });
  if (inspection.loginPagePresent) return failure("AUTH_REDIRECTED_TO_LOGIN", "login-url");
  if (inspection.securityVerificationPresent) return failure("SECURITY_VERIFICATION_REQUIRED", "security-verification-signal");
  if (inspection.phaseTopology.stable !== true || inspection.phase === "IMAGE_POST_TRANSITIONING") return failure("PRE_UPLOAD_PHASE_NOT_READY", "stable-pre-upload-phase");
  if (inspection.contentType !== "IMAGE_POST" || !inspection.contentTypeReady) return failure("CONTENT_TYPE_NOT_READY", "content-type:image-post");
  if (!inspection.uploadCapabilityPresent || !inspection.uploadCapabilityUnique || inspection.uploadCapabilityStatus !== "PRESENT") return failure("UPLOAD_CAPABILITY_NOT_VERIFIED", "image-upload-capability");
  if (inspection.tabPresence?.currentSelectedTab !== "上传图文") return failure("PRE_UPLOAD_PHASE_NOT_READY", "selected-tab:上传图文");
  if (inspection.preUploadSemanticNodes.length === 0) return failure("PRE_UPLOAD_PHASE_NOT_READY", "pre-upload-semantic-signal");
  if (inspection.phase !== "IMAGE_POST_PRE_UPLOAD" || inspection.confidence !== "HIGH") return failure("PRE_UPLOAD_PHASE_NOT_READY", "image-post-pre-upload-phase");
  if (inspection.phaseTopology.titleCandidateCount !== 0 || inspection.phaseTopology.bodyCandidateCount !== 0 || inspection.phaseTopology.finalSubmitCandidateCount !== 0) return failure("PRE_UPLOAD_PHASE_NOT_READY", "post-upload-controls-absent-before-upload");
  return { ...base, status: "PASS" };
}

function nowIso(): string { return new Date().toISOString(); }

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "about:blank";
  }
}

function emptyControl(kind: ImageEditorControlKind): ImageEditorControlDiscovery {
  return { kind, status: "NOT_FOUND", detected: false, candidates: [] };
}

function emptySettings(): ImageEditorSettingsDiscovery {
  return { status: "NOT_APPLICABLE", detected: false, candidates: [] };
}

function emptyResult(status: ImageEditorInspectionStatus, shellStatus: ImageEditorShellStatus, sanitizedUrl: string, readinessSamples: readonly ImageEditorReadinessSample[]): ImagePostEditorInspectionResult {
  return {
    status,
    shellStatus,
    readinessSamples,
    contentType: "UNKNOWN",
    contentTypeReady: false,
    titleEditor: emptyControl("TITLE_EDITOR"),
    bodyEditor: emptyControl("BODY_EDITOR"),
    imageUploadControl: emptyControl("IMAGE_UPLOAD_CONTROL"),
    publishSettingsArea: emptySettings(),
    finalSubmitControl: emptyControl("FINAL_SUBMIT_CONTROL"),
    titleEditorDetected: false,
    bodyEditorDetected: false,
    imageUploadControlDetected: false,
    publishSettingsAreaDetected: false,
    finalSubmitControlDetected: false,
    finalSubmitControlPresent: false,
    finalSubmitControlEnabled: false,
    securityVerificationPresent: false,
    loginPagePresent: false,
    sanitizedUrl
  };
}

function emit(options: ImageEditorInspectionOptions, metadata: ImageEditorInspectionMetadata, code: ImageEditorDiagnosticCode, fields: Omit<ImageEditorDiagnostic, "code" | "timestamp" | "operationId" | "platformKey" | "accountId" | "contextDebugId" | "pageDebugId">): void {
  try {
    options.emit?.({ code, timestamp: nowIso(), ...metadata, ...fields });
  } catch {
    // Diagnostics must never affect the read-only inspection result.
  }
}

function controlDiscovery(kind: ImageEditorControlKind, candidates: readonly ImageEditorControlCandidate[]): ImageEditorControlDiscovery {
  const visible = candidates.filter((candidate) => candidate.visible);
  const enabled = visible.filter((candidate) => candidate.enabled);
  if (kind === "FINAL_SUBMIT_CONTROL") {
    if (visible.length > 1) return { kind, status: "AMBIGUOUS", detected: false, candidates };
    if (enabled.length === 1) return { kind, status: "FOUND_UNIQUE", detected: true, candidates };
    if (candidates.length === 0) return { kind, status: "NOT_FOUND", detected: false, candidates };
    if (visible.length === 0) return { kind, status: "NOT_VISIBLE", detected: false, candidates };
    return { kind, status: "DISABLED", detected: false, candidates };
  }
  if (enabled.length === 1) return { kind, status: "FOUND_UNIQUE", detected: true, candidates };
  if (enabled.length > 1) return { kind, status: "AMBIGUOUS", detected: false, candidates };
  if (candidates.length === 0) return { kind, status: "NOT_FOUND", detected: false, candidates };
  if (visible.length === 0) return { kind, status: "NOT_VISIBLE", detected: false, candidates };
  return { kind, status: "DISABLED", detected: false, candidates };
}

function finalSubmitControlPresence(candidates: readonly ImageEditorControlCandidate[]): { present: boolean; enabled: boolean } {
  const visible = candidates.filter((candidate) => candidate.visible);
  return {
    present: visible.length === 1,
    enabled: visible.length === 1 && visible[0]?.enabled === true
  };
}

function settingsDiscovery(candidates: readonly ImageEditorControlCandidate[]): ImageEditorSettingsDiscovery {
  if (candidates.length === 0) return emptySettings();
  const visible = candidates.filter((candidate) => candidate.visible);
  const enabled = visible.filter((candidate) => candidate.enabled);
  if (enabled.length === 1) return { status: "FOUND_UNIQUE", detected: true, candidates };
  if (enabled.length > 1) return { status: "AMBIGUOUS", detected: false, candidates };
  if (visible.length === 0) return { status: "NOT_VISIBLE", detected: false, candidates };
  return { status: "DISABLED", detected: false, candidates };
}

function controlFailureCode(control: ImageEditorControlDiscovery): PreSubmitGateFailureCode | null {
  if (control.status === "FOUND_UNIQUE") return null;
  if (control.status === "AMBIGUOUS") return control.kind === "TITLE_EDITOR"
    ? "TITLE_EDITOR_AMBIGUOUS"
    : control.kind === "BODY_EDITOR"
      ? "BODY_EDITOR_AMBIGUOUS"
      : control.kind === "IMAGE_UPLOAD_CONTROL"
        ? "IMAGE_UPLOAD_CONTROL_AMBIGUOUS"
        : "FINAL_SUBMIT_CONTROL_AMBIGUOUS";
  if (control.status === "NOT_VISIBLE") return control.kind === "TITLE_EDITOR"
    ? "TITLE_EDITOR_NOT_VISIBLE"
    : control.kind === "BODY_EDITOR"
      ? "BODY_EDITOR_NOT_VISIBLE"
      : control.kind === "IMAGE_UPLOAD_CONTROL"
        ? "IMAGE_UPLOAD_CONTROL_NOT_VISIBLE"
        : "FINAL_SUBMIT_CONTROL_NOT_VISIBLE";
  if (control.status === "DISABLED") return control.kind === "TITLE_EDITOR"
    ? "TITLE_EDITOR_DISABLED"
    : control.kind === "BODY_EDITOR"
      ? "BODY_EDITOR_DISABLED"
      : control.kind === "IMAGE_UPLOAD_CONTROL"
        ? "IMAGE_UPLOAD_CONTROL_DISABLED"
        : "FINAL_SUBMIT_CONTROL_DISABLED";
  return control.kind === "TITLE_EDITOR"
    ? "TITLE_EDITOR_NOT_FOUND"
    : control.kind === "BODY_EDITOR"
      ? "BODY_EDITOR_NOT_FOUND"
      : control.kind === "IMAGE_UPLOAD_CONTROL"
        ? "IMAGE_UPLOAD_CONTROL_NOT_FOUND"
        : "FINAL_SUBMIT_CONTROL_NOT_FOUND";
}

function controlMissingSignal(control: ImageEditorControlDiscovery): string {
  return control.kind === "TITLE_EDITOR"
    ? "title-editor"
    : control.kind === "BODY_EDITOR"
      ? "body-editor"
      : control.kind === "IMAGE_UPLOAD_CONTROL"
        ? "image-upload-control"
        : "final-submit-control";
}

function normalizeCandidate(value: unknown): ImageEditorControlCandidate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.candidateId !== "string" || typeof record.tagName !== "string" || typeof record.semanticSignal !== "string" || typeof record.visible !== "boolean" || typeof record.enabled !== "boolean") return null;
  return {
    candidateId: record.candidateId,
    tagName: record.tagName,
    role: typeof record.role === "string" ? record.role : null,
    semanticSignal: record.semanticSignal,
    visible: record.visible,
    enabled: record.enabled,
    boundingBox: normalizeBoundingBox(record.boundingBox),
    hitTestValid: record.hitTestValid === true,
    normalizedText: typeof record.normalizedText === "string" ? record.normalizedText.slice(0, 120) : undefined
  };
}

function normalizeCandidates(value: unknown): readonly ImageEditorControlCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeCandidate).filter((candidate): candidate is ImageEditorControlCandidate => Boolean(candidate));
}

function normalizeContentType(value: unknown): ImageEditorContentType {
  return value === "IMAGE_POST" || value === "VIDEO" ? value : "UNKNOWN";
}

function normalizeSnapshot(value: unknown, fallbackUrl: string): ImageEditorDomSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { currentUrl: fallbackUrl, readyState: "loading", shellSignal: false, shellFingerprint: "invalid", contentTypeSignal: "UNKNOWN", securityVerificationPresent: false, loginPagePresent: false, titleCandidates: [], bodyCandidates: [], uploadCandidates: [], publishSettingsCandidates: [], finalSubmitCandidates: [] };
  }
  const record = value as Record<string, unknown>;
  return {
    currentUrl: typeof record.currentUrl === "string" ? record.currentUrl : fallbackUrl,
    readyState: typeof record.readyState === "string" ? record.readyState : "loading",
    shellSignal: record.shellSignal === true,
    shellFingerprint: typeof record.shellFingerprint === "string" ? record.shellFingerprint : "unknown",
    contentTypeSignal: normalizeContentType(record.contentTypeSignal),
    securityVerificationPresent: record.securityVerificationPresent === true,
    loginPagePresent: record.loginPagePresent === true,
    titleCandidates: normalizeCandidates(record.titleCandidates),
    bodyCandidates: normalizeCandidates(record.bodyCandidates),
    uploadCandidates: normalizeCandidates(record.uploadCandidates),
    publishSettingsCandidates: normalizeCandidates(record.publishSettingsCandidates),
    finalSubmitCandidates: normalizeCandidates(record.finalSubmitCandidates),
    postUploadSemanticNodes: normalizeSemanticNodes(record.postUploadSemanticNodes),
    interactiveTopology: normalizeInteractiveTopology(record.interactiveTopology),
    mediaPreviewDiagnostics: normalizeMediaPreviewDiagnostics(record.mediaPreviewDiagnostics),
    modalDiagnostics: normalizeModalDiagnostics(record.modalDiagnostics),
    intermediateActionCandidates: normalizeIntermediateActionCandidates(record.intermediateActionCandidates),
    requiredValidationSignals: Array.isArray(record.requiredValidationSignals) ? record.requiredValidationSignals.filter((signal): signal is string => typeof signal === "string").map((signal) => signal.slice(0, 120)).slice(0, 12) : [],
    forbiddenActionSignalPresent: record.forbiddenActionSignalPresent === true,
    mediaPreviewSignalPresent: record.mediaPreviewSignalPresent === true,
    mediaEditingSignalPresent: record.mediaEditingSignalPresent === true,
    ...(typeof record.uploadBusy === "boolean" ? { uploadBusy: record.uploadBusy } : {}),
    ...(typeof record.previewReady === "boolean" ? { previewReady: record.previewReady } : {})
  };
}

function normalizeBoundingBox(value: unknown): ImageEditorBoundingBox | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const numbers = [record.x, record.y, record.width, record.height];
  if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number))) return null;
  if ((record.width as number) <= 0 || (record.height as number) <= 0) return null;
  return { x: record.x as number, y: record.y as number, width: record.width as number, height: record.height as number };
}

function normalizeSemanticNodes(value: unknown): readonly ImageEditorSemanticNode[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): ImageEditorSemanticNode | null => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.tagName !== "string" || typeof record.normalizedText !== "string" || typeof record.visible !== "boolean" || typeof record.enabled !== "boolean") return null;
    return {
      tagName: record.tagName,
      normalizedText: record.normalizedText.slice(0, 120),
      role: typeof record.role === "string" ? record.role : null,
      visible: record.visible,
      enabled: record.enabled,
      boundingBox: normalizeBoundingBox(record.boundingBox),
      nearestInteractiveAncestorTag: typeof record.nearestInteractiveAncestorTag === "string" ? record.nearestInteractiveAncestorTag : null,
      nearestInteractiveAncestorRole: typeof record.nearestInteractiveAncestorRole === "string" ? record.nearestInteractiveAncestorRole : null
    };
  }).filter((item): item is ImageEditorSemanticNode => Boolean(item)).slice(0, 20);
}

function normalizeUploadAncestors(value: unknown): readonly ImageEditorUploadAncestor[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): ImageEditorUploadAncestor | null => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.depth !== "number" || typeof record.tagName !== "string" || typeof record.visible !== "boolean" || typeof record.pointerEvents !== "string") return null;
    return {
      depth: Math.max(1, Math.min(6, Math.trunc(record.depth))),
      tagName: record.tagName,
      role: typeof record.role === "string" ? record.role : null,
      boundedClassTokens: Array.isArray(record.boundedClassTokens) ? record.boundedClassTokens.filter((token): token is string => typeof token === "string").slice(0, 8) : [],
      visible: record.visible,
      pointerEvents: record.pointerEvents,
      boundingBox: normalizeBoundingBox(record.boundingBox),
      semanticTextSignal: typeof record.semanticTextSignal === "string" ? record.semanticTextSignal.slice(0, 80) : null
    };
  }).filter((item): item is ImageEditorUploadAncestor => Boolean(item)).slice(0, 6);
}

function normalizeUploadRelationships(value: unknown): readonly ImageEditorUploadControlRelationship[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): ImageEditorUploadControlRelationship | null => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.candidateId !== "string" || typeof record.tagName !== "string" || typeof record.type !== "string" || typeof record.enabled !== "boolean" || typeof record.visible !== "boolean" || typeof record.usableSurface !== "boolean" || typeof record.surfaceSignal !== "string") return null;
    return {
      candidateId: record.candidateId,
      tagName: record.tagName,
      type: record.type,
      accept: typeof record.accept === "string" ? record.accept.slice(0, 120) : null,
      multiple: record.multiple === true,
      enabled: record.enabled,
      visible: record.visible,
      usableSurface: record.usableSurface,
      surfaceSignal: record.surfaceSignal.slice(0, 80),
      ancestors: normalizeUploadAncestors(record.ancestors)
    };
  }).filter((item): item is ImageEditorUploadControlRelationship => Boolean(item)).slice(0, 20);
}

function normalizePhaseTopology(value: unknown): ImageEditorPhaseTopology {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyPhaseTopology();
  const record = value as Record<string, unknown>;
  const count = (key: string): number => typeof record[key] === "number" && Number.isFinite(record[key]) ? Math.max(0, Math.trunc(record[key] as number)) : 0;
  return {
    titleCandidateCount: count("titleCandidateCount"),
    bodyCandidateCount: count("bodyCandidateCount"),
    uploadCandidateCount: count("uploadCandidateCount"),
    finalSubmitCandidateCount: count("finalSubmitCandidateCount"),
    contenteditableCount: count("contenteditableCount"),
    textareaCount: count("textareaCount"),
    textInputCount: count("textInputCount"),
    fileInputCount: count("fileInputCount"),
    buttonCount: count("buttonCount"),
    roleButtonCount: count("roleButtonCount"),
    semanticSignals: Array.isArray(record.semanticSignals) ? record.semanticSignals.filter((signal): signal is string => typeof signal === "string").slice(0, 12) : [],
    stable: record.stable === true
  };
}

function normalizeInteractiveTopology(value: unknown): ImageEditorInteractiveTopology {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyInteractiveTopology();
  const record = value as Record<string, unknown>;
  const count = (key: string): number => typeof record[key] === "number" && Number.isFinite(record[key]) ? Math.max(0, Math.trunc(record[key] as number)) : 0;
  return {
    buttonCount: count("buttonCount"),
    roleButtonCount: count("roleButtonCount"),
    dialogCount: count("dialogCount"),
    modalSignalCount: count("modalSignalCount"),
    fileInputCount: count("fileInputCount"),
    contenteditableCount: count("contenteditableCount"),
    textareaCount: count("textareaCount"),
    textInputCount: count("textInputCount"),
    titleCandidateCount: count("titleCandidateCount"),
    bodyCandidateCount: count("bodyCandidateCount"),
    finalSubmitCandidateCount: count("finalSubmitCandidateCount")
  };
}

function normalizeMediaPreviewDiagnostics(value: unknown): ImageEditorMediaPreviewDiagnostics {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyMediaPreviewDiagnostics();
  const record = value as Record<string, unknown>;
  return {
    previewCount: typeof record.previewCount === "number" && Number.isFinite(record.previewCount) ? Math.max(0, Math.trunc(record.previewCount)) : 0,
    previewVisible: record.previewVisible === true,
    previewGeometry: Array.isArray(record.previewGeometry) ? record.previewGeometry.map(normalizeBoundingBox).filter((box): box is ImageEditorBoundingBox => Boolean(box)).slice(0, 20) : [],
    deleteReplaceEditSignals: Array.isArray(record.deleteReplaceEditSignals) ? record.deleteReplaceEditSignals.filter((signal): signal is string => typeof signal === "string").slice(0, 12) : [],
    associatedSemanticText: Array.isArray(record.associatedSemanticText) ? record.associatedSemanticText.filter((signal): signal is string => typeof signal === "string").map((signal) => signal.slice(0, 120)).slice(0, 12) : []
  };
}

function normalizeModalDiagnostics(value: unknown): ImageEditorModalDiagnostics {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyModalDiagnostics();
  const record = value as Record<string, unknown>;
  const count = (key: string): number => typeof record[key] === "number" && Number.isFinite(record[key]) ? Math.max(0, Math.trunc(record[key] as number)) : 0;
  return {
    dialogCount: count("dialogCount"),
    modalSignalCount: count("modalSignalCount"),
    maskCount: count("maskCount"),
    overlayCount: count("overlayCount"),
    drawerCount: count("drawerCount"),
    visible: record.visible === true,
    ariaModalCount: count("ariaModalCount")
  };
}

function normalizeIntermediateActionCandidates(value: unknown): readonly ImageEditorIntermediateActionCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): ImageEditorIntermediateActionCandidate | null => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.candidateId !== "string" || typeof record.tagName !== "string" || typeof record.semanticSignal !== "string" || typeof record.visible !== "boolean" || typeof record.enabled !== "boolean") return null;
    return {
      candidateId: record.candidateId,
      tagName: record.tagName,
      role: typeof record.role === "string" ? record.role : null,
      semanticSignal: record.semanticSignal.slice(0, 80),
      visible: record.visible,
      enabled: record.enabled,
      normalizedText: typeof record.normalizedText === "string" ? record.normalizedText.slice(0, 120) : record.semanticSignal.slice(0, 120),
      boundingBox: normalizeBoundingBox(record.boundingBox),
      nearestInteractiveAncestorTag: typeof record.nearestInteractiveAncestorTag === "string" ? record.nearestInteractiveAncestorTag : null,
      nearestInteractiveAncestorRole: typeof record.nearestInteractiveAncestorRole === "string" ? record.nearestInteractiveAncestorRole : null,
      pointerEvents: typeof record.pointerEvents === "string" ? record.pointerEvents : "unknown",
      hitTestValid: record.hitTestValid === true
    };
  }).filter((item): item is ImageEditorIntermediateActionCandidate => Boolean(item)).slice(0, 20);
}

function emptyPhaseSnapshot(fallbackUrl: string): ImageEditorPhaseDomSnapshot {
  return {
    currentUrl: fallbackUrl,
    readyState: "loading",
    shellSignal: false,
    shellFingerprint: "invalid",
    contentTypeSignal: "UNKNOWN",
    uploadCandidateCount: 0,
    securityVerificationPresent: false,
    loginPagePresent: false,
    domStable: false,
    uploadCapabilityPresent: false,
    uploadCapabilityUnique: false,
    preUploadSemanticSignalPresent: false,
    titleCandidateCount: 0,
    bodyCandidateCount: 0,
    finalSubmitCandidateCount: 0,
    preUploadSemanticNodes: [],
    postUploadSemanticNodes: [],
    uploadControlRelationships: [],
    phaseTopology: emptyPhaseTopology(),
    interactiveTopology: emptyInteractiveTopology(),
    mediaPreviewDiagnostics: emptyMediaPreviewDiagnostics(),
    modalDiagnostics: emptyModalDiagnostics(),
    intermediateActionCandidates: [],
    requiredValidationSignals: [],
    forbiddenActionSignalPresent: false,
    mediaPreviewSignalPresent: false,
    mediaEditingSignalPresent: false,
    tabPresence: emptyTabPresence(),
    tabCandidates: [],
    uploadBusy: false,
    previewReady: false
  };
}

function normalizePhaseSnapshot(value: unknown, fallbackUrl: string): ImageEditorPhaseDomSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyPhaseSnapshot(fallbackUrl);
  const record = value as Record<string, unknown>;
  const relationships = normalizeUploadRelationships(record.uploadControlRelationships);
  const uploadCapability = resolveImageEditorUploadCapability(relationships);
  const topology = normalizePhaseTopology(record.phaseTopology);
  const tabCandidates = normalizeTabCandidateEvidence(record.tabCandidates);
  const tabPresence = tabCandidates.length > 0 ? resolveImageEditorTabPresence(tabCandidates) : normalizeTabPresence(record.tabPresence);
  return {
    currentUrl: typeof record.currentUrl === "string" ? record.currentUrl : fallbackUrl,
    readyState: typeof record.readyState === "string" ? record.readyState : "loading",
    shellSignal: record.shellSignal === true,
    shellFingerprint: typeof record.shellFingerprint === "string" ? record.shellFingerprint : "unknown",
    contentTypeSignal: normalizeContentType(record.contentTypeSignal),
    uploadCandidateCount: topology.uploadCandidateCount,
    securityVerificationPresent: record.securityVerificationPresent === true,
    loginPagePresent: record.loginPagePresent === true,
    domStable: false,
    uploadCapabilityPresent: uploadCapability.present,
    uploadCapabilityUnique: uploadCapability.uniqueSurface,
    preUploadSemanticSignalPresent: record.preUploadSemanticSignalPresent === true || tabPresence.currentSelectedTab === "上传图文",
    titleCandidateCount: topology.titleCandidateCount,
    bodyCandidateCount: topology.bodyCandidateCount,
    finalSubmitCandidateCount: topology.finalSubmitCandidateCount,
    preUploadSemanticNodes: normalizeSemanticNodes(record.preUploadSemanticNodes),
    postUploadSemanticNodes: normalizeSemanticNodes(record.postUploadSemanticNodes),
    uploadControlRelationships: relationships,
    interactiveTopology: normalizeInteractiveTopology(record.interactiveTopology),
    mediaPreviewDiagnostics: normalizeMediaPreviewDiagnostics(record.mediaPreviewDiagnostics),
    modalDiagnostics: normalizeModalDiagnostics(record.modalDiagnostics),
    intermediateActionCandidates: normalizeIntermediateActionCandidates(record.intermediateActionCandidates),
    requiredValidationSignals: Array.isArray(record.requiredValidationSignals) ? record.requiredValidationSignals.filter((signal): signal is string => typeof signal === "string").map((signal) => signal.slice(0, 120)).slice(0, 12) : [],
    forbiddenActionSignalPresent: record.forbiddenActionSignalPresent === true,
    mediaPreviewSignalPresent: record.mediaPreviewSignalPresent === true,
    mediaEditingSignalPresent: record.mediaEditingSignalPresent === true,
    tabPresence,
    tabCandidates,
    phaseTopology: topology,
    ...(typeof record.uploadBusy === "boolean" ? { uploadBusy: record.uploadBusy } : {}),
    ...(typeof record.previewReady === "boolean" ? { previewReady: record.previewReady } : {})
  };
}

function isSnapshotPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.shellSignal === "boolean" && Array.isArray(record.titleCandidates) && Array.isArray(record.bodyCandidates) && Array.isArray(record.uploadCandidates);
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

async function locatorAttribute(locator: Locator, name: string): Promise<string> {
  const candidate = locator as unknown as { getAttribute?: (attributeName: string) => Promise<string | null> };
  if (typeof candidate.getAttribute !== "function") return "";
  return (await candidate.getAttribute(name).catch(() => null))?.trim() ?? "";
}

async function locatorText(locator: Locator): Promise<string> {
  const candidate = locator as unknown as { innerText?: () => Promise<string>; textContent?: () => Promise<string | null> };
  if (typeof candidate.innerText === "function") return (await candidate.innerText().catch(() => "")).trim();
  if (typeof candidate.textContent === "function") return (await candidate.textContent().catch(() => null))?.trim() ?? "";
  return "";
}

async function locatorVisible(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isVisible?: () => Promise<boolean> };
  return typeof candidate.isVisible === "function" ? candidate.isVisible().catch(() => false) : true;
}

async function locatorEnabled(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isEnabled?: () => Promise<boolean> };
  return typeof candidate.isEnabled === "function" ? candidate.isEnabled().catch(() => false) : true;
}

async function locatorBoundingBox(locator: Locator): Promise<ImageEditorBoundingBox | null> {
  const candidate = locator as unknown as { boundingBox?: () => Promise<ImageEditorBoundingBox | null> };
  if (typeof candidate.boundingBox !== "function") return null;
  return candidate.boundingBox().catch(() => null);
}

async function readLocatorCandidates(page: Page, selector: string, semanticSignal: string, filter: (locator: Locator) => Promise<boolean> = async () => true): Promise<readonly ImageEditorControlCandidate[]> {
  const locator = page.locator(selector);
  const candidates: ImageEditorControlCandidate[] = [];
  for (let index = 0; index < await locatorCount(locator); index += 1) {
    const item = locatorAt(locator, index);
    if (!(await filter(item))) continue;
    const visible = await locatorVisible(item);
    const enabled = await locatorEnabled(item);
    const boundingBox = await locatorBoundingBox(item);
    candidates.push({
      candidateId: (await locatorAttribute(item, "data-testid")) || `${semanticSignal}-${index}`,
      tagName: (await locatorAttribute(item, "tagName")).toUpperCase() || "UNKNOWN",
      role: (await locatorAttribute(item, "role")) || null,
      semanticSignal,
      visible,
      enabled,
      boundingBox,
      hitTestValid: visible && enabled && boundingBox !== null
    });
  }
  return candidates;
}

async function readSnapshotFromLocators(page: Page, fallbackUrl: string): Promise<ImageEditorDomSnapshot> {
  const currentUrl = page.url() || fallbackUrl;
  const body = page.locator("body");
  const bodyText = (await locatorText(body)).normalize("NFKC").replace(/[\s]+/gu, " ").trim();
  const loginPagePresent = /\/login(?:[/?#]|$)/iu.test(currentUrl) || /登录/iu.test(bodyText);
  const securityVerificationPresent = /security|verify|captcha|安全验证|验证码/iu.test(`${currentUrl} ${bodyText}`);
  let titleCandidates = await readLocatorCandidates(page, TITLE_SELECTOR, "title-editor", async (locator) => {
    const label = `${await locatorAttribute(locator, "placeholder")} ${await locatorAttribute(locator, "aria-label")} ${await locatorAttribute(locator, "name")} ${await locatorAttribute(locator, "id")} ${await locatorAttribute(locator, "data-placeholder")}`;
    return /标题|title/iu.test(label);
  });
  if (titleCandidates.length === 0) {
    titleCandidates = await readLocatorCandidates(page, TITLE_TEXTAREA_SELECTOR, "title-editor", async (locator) => {
      const label = `${await locatorAttribute(locator, "placeholder")} ${await locatorAttribute(locator, "aria-label")}`;
      return /标题|title/iu.test(label);
    });
  }
  const bodyCandidates = await readLocatorCandidates(page, BODY_SELECTOR, "body-editor");
  const uploadCandidates = await readLocatorCandidates(page, UPLOAD_SELECTOR, "image-upload-control");
  const publishSettingsCandidates = await readLocatorCandidates(page, SETTINGS_SELECTOR, "publish-settings");
  const finalLocator = page.locator(FINAL_SUBMIT_SELECTOR);
  const finalSubmitCandidates: ImageEditorControlCandidate[] = [];
  for (let index = 0; index < await locatorCount(finalLocator); index += 1) {
    const item = locatorAt(finalLocator, index);
    const label = (await locatorText(item) || await locatorAttribute(item, "aria-label") || await locatorAttribute(item, "title")).normalize("NFKC").replace(/[\s]+/gu, " ").trim();
    if (!/^(发布|发布笔记|发表|提交|立即发布|publish|submit)$/iu.test(label) || /视频/iu.test(label)) continue;
    const visible = await locatorVisible(item);
    const enabled = await locatorEnabled(item);
    const boundingBox = await locatorBoundingBox(item);
    finalSubmitCandidates.push({
      candidateId: (await locatorAttribute(item, "data-testid")) || `final-submit-${index}`,
      tagName: (await locatorAttribute(item, "tagName")).toUpperCase() || "BUTTON",
      role: (await locatorAttribute(item, "role")) || null,
      semanticSignal: "final-submit-label",
      visible,
      enabled,
      boundingBox,
      hitTestValid: visible && boundingBox !== null
    });
  }
  const intermediateActionCandidates: ImageEditorIntermediateActionCandidate[] = [];
  const interactive = page.locator('button, [role="button"], a, [role="tab"]');
  for (let index = 0; index < await locatorCount(interactive); index += 1) {
    const item = locatorAt(interactive, index);
    const label = (await locatorText(item) || await locatorAttribute(item, "aria-label") || await locatorAttribute(item, "title")).normalize("NFKC").replace(/[\s]+/gu, " ").trim();
    if (!/完成|确认|下一步|继续|编辑图片|编辑照片|裁剪完成|返回编辑|done|confirm|next|continue|edit\s*(?:image|photo)|crop(?:ping)?\s*done|back\s*to\s*edit/iu.test(label)) continue;
    const visible = await locatorVisible(item);
    const enabled = await locatorEnabled(item);
    const boundingBox = await locatorBoundingBox(item);
    intermediateActionCandidates.push({
      candidateId: (await locatorAttribute(item, "data-testid")) || `intermediate-action-${index}`,
      tagName: (await locatorAttribute(item, "tagName")).toUpperCase() || "BUTTON",
      role: (await locatorAttribute(item, "role")) || "button",
      semanticSignal: "intermediate-action",
      normalizedText: label.slice(0, 120),
      visible,
      enabled,
      boundingBox,
      nearestInteractiveAncestorTag: "BUTTON",
      nearestInteractiveAncestorRole: "button",
      pointerEvents: "auto",
      hitTestValid: visible && enabled && boundingBox !== null
    });
  }
  const contentTypeSignal: ImageEditorContentType = /视频|video/iu.test(bodyText) && uploadCandidates.length === 0 ? "VIDEO" : uploadCandidates.length > 0 || /图文|图片|image/iu.test(bodyText) ? "IMAGE_POST" : "UNKNOWN";
  const shellSignal = EDITOR_ROUTE_PATTERN.test(currentUrl) && !loginPagePresent && !securityVerificationPresent;
  const shellFingerprint = JSON.stringify({ title: titleCandidates.length, body: bodyCandidates.length, upload: uploadCandidates.length, settings: publishSettingsCandidates.length, finalSubmit: finalSubmitCandidates.length });
  const busy = page.locator('[aria-busy="true"], [class*="loading" i], [class*="uploading" i], progress');
  const preview = page.locator('img[class*="preview" i], img[src*="xhscdn" i], [class*="preview" i], [data-testid*="upload-result" i], [class*="uploaded" i]');
  const uploadBusy = await locatorCount(busy) > 0;
  const previewCount = await locatorCount(preview);
  const previewGeometry: ImageEditorBoundingBox[] = [];
  for (let index = 0; index < previewCount; index += 1) {
    const box = await locatorBoundingBox(locatorAt(preview, index));
    if (box) previewGeometry.push(box);
  }
  const previewReady = previewCount > 0 && await locatorVisible(locatorAt(preview, 0));
  const interactiveTopology: ImageEditorInteractiveTopology = {
    buttonCount: 0,
    roleButtonCount: 0,
    dialogCount: 0,
    modalSignalCount: 0,
    fileInputCount: uploadCandidates.length,
    contenteditableCount: 0,
    textareaCount: 0,
    textInputCount: titleCandidates.length,
    titleCandidateCount: titleCandidates.length,
    bodyCandidateCount: bodyCandidates.length,
    finalSubmitCandidateCount: finalSubmitCandidates.length
  };
  const phaseTopology: ImageEditorPhaseTopology = {
    titleCandidateCount: titleCandidates.length,
    bodyCandidateCount: bodyCandidates.length,
    uploadCandidateCount: uploadCandidates.length,
    finalSubmitCandidateCount: finalSubmitCandidates.length,
    contenteditableCount: 0,
    textareaCount: 0,
    textInputCount: titleCandidates.length,
    fileInputCount: uploadCandidates.length,
    buttonCount: intermediateActionCandidates.length + finalSubmitCandidates.length,
    roleButtonCount: intermediateActionCandidates.length + finalSubmitCandidates.length,
    semanticSignals: intermediateActionCandidates.map((candidate) => candidate.normalizedText ?? candidate.semanticSignal),
    stable: false
  };
  return {
    currentUrl,
    readyState: "complete",
    shellSignal,
    shellFingerprint,
    contentTypeSignal,
    securityVerificationPresent,
    loginPagePresent,
    titleCandidates,
    bodyCandidates,
    uploadCandidates,
    publishSettingsCandidates,
    finalSubmitCandidates,
    postUploadSemanticNodes: intermediateActionCandidates.map((candidate) => ({ tagName: candidate.tagName, normalizedText: candidate.normalizedText ?? candidate.semanticSignal, role: candidate.role, visible: candidate.visible, enabled: candidate.enabled, boundingBox: candidate.boundingBox ?? null, nearestInteractiveAncestorTag: candidate.nearestInteractiveAncestorTag ?? null, nearestInteractiveAncestorRole: candidate.nearestInteractiveAncestorRole ?? null })),
    interactiveTopology,
    mediaPreviewDiagnostics: { previewCount, previewVisible: previewReady, previewGeometry, deleteReplaceEditSignals: [], associatedSemanticText: previewReady ? ["预览"] : [] },
    modalDiagnostics: emptyModalDiagnostics(),
    intermediateActionCandidates,
    requiredValidationSignals: [],
    forbiddenActionSignalPresent: false,
    mediaPreviewSignalPresent: previewReady || intermediateActionCandidates.length > 0,
    mediaEditingSignalPresent: intermediateActionCandidates.some((candidate) => /编辑|裁剪|edit|crop/iu.test(candidate.normalizedText ?? "")),
    phaseTopology,
    uploadBusy,
    previewReady
  };
}

async function readSnapshot(page: Page): Promise<ImageEditorDomSnapshot> {
  const fallbackUrl = page.url();
  let raw: unknown = null;
  try {
    raw = await page.evaluate(() => {
    const normalize = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
    const boundingBox = (element: Element): ImageEditorBoundingBox | null => {
      const rect = element.getBoundingClientRect();
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
      return { x: Math.round(rect.x * 100) / 100, y: Math.round(rect.y * 100) / 100, width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100 };
    };
    const visible = (element: Element): boolean => {
      const node = element as HTMLElement;
      const style = window.getComputedStyle(node);
      const rect = element.getBoundingClientRect();
      return !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
    };
    const enabled = (element: Element): boolean => {
      const node = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      return !node.disabled && element.getAttribute("aria-disabled") !== "true";
    };
    const isInteractive = (element: Element): boolean => ["A", "BUTTON", "INPUT", "LABEL", "SELECT", "TEXTAREA"].includes(element.tagName) || ["button", "link", "tab", "radio", "checkbox"].includes(element.getAttribute("role") ?? "");
    const nearestInteractive = (element: Element): Element | null => {
      let current: Element | null = element;
      for (let depth = 0; current && depth <= 6; depth += 1, current = current.parentElement) if (isInteractive(current)) return current;
      return null;
    };
    const hitTestValid = (element: Element): boolean => {
      const box = boundingBox(element);
      if (!box) return false;
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const owner = nearestInteractive(element) ?? element;
      return hit === element || Boolean(hit && (element.contains(hit) || owner.contains(hit)));
    };
    const candidate = (element: Element, semanticSignal: string, index: number) => ({
      candidateId: element.getAttribute("data-testid")?.trim() || `${semanticSignal}-${index}`,
      tagName: element.tagName.toUpperCase(),
      role: element.getAttribute("role"),
      semanticSignal,
      visible: visible(element),
      enabled: enabled(element),
      boundingBox: boundingBox(element),
      hitTestValid: hitTestValid(element),
      normalizedText: normalize(`${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`).slice(0, 120)
    });
    const select = (selector: string, semanticSignal: string, filter: (element: Element) => boolean = () => true) => Array.from(document.querySelectorAll(selector)).filter(filter).map((element, index) => candidate(element, semanticSignal, index));
    const titleCandidates = select('input[placeholder*="标题"], input[aria-label*="标题"], input[name*="title" i], input[id*="title" i], textarea[placeholder*="标题"], [data-testid*="title" i]', "title-editor", (element) => ["INPUT", "TEXTAREA"].includes(element.tagName) || element.getAttribute("role") === "textbox");
    const bodyCandidates = select('[contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder], textarea[aria-label*="正文"], textarea[name*="body" i], textarea[id*="body" i], [data-testid*="body" i][contenteditable="true"]', "body-editor");
    const uploadCandidates = select('input[type="file"], [aria-label*="上传图片"], [aria-label*="添加图片"], [data-testid*="upload" i], [class*="upload" i][role="button"]', "image-upload-control");
    const settingsCandidates = select('input[type="checkbox"], input[type="radio"], select, [role="checkbox"], [role="radio"], [data-setting]', "publish-settings");
    const finalSubmitCandidates = select('button, [role="button"]', "final-submit", (element) => {
      const label = normalize(element.textContent ?? element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "");
      return /^(发布|发布笔记|发表|提交|立即发布|publish|submit)$/iu.test(label) && !/视频/iu.test(label);
    });
    const uploadBusy = document.querySelector('[aria-busy="true"], [class*="loading" i], [class*="uploading" i], progress') !== null;
    const semanticElements = Array.from(document.querySelectorAll('[role="tab"], [role="radio"], button, [aria-label], [data-content-type], [data-type]'));
    const semanticText = (element: Element): string => normalize(`${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.getAttribute("data-content-type") ?? ""} ${element.getAttribute("data-type") ?? ""}`).slice(0, 120);
    const semanticControls = semanticElements.map(semanticText).join(" ");
    const intermediateActionElements = semanticElements.filter((element) => visible(element) && /完成|确认|下一步|继续|done|confirm|next|continue/iu.test(semanticText(element)));
    const mediaEditingSignalPresent = semanticElements.some((element) => visible(element) && /裁剪|编辑图片|编辑照片|crop|edit image/iu.test(semanticText(element)));
    const editorRoots = Array.from(document.querySelectorAll('[data-testid*="editor" i], [class*="editor" i], [data-testid*="publish" i], [class*="publish" i]')).filter((root) => {
      const hasEditorField = Boolean(root.querySelector('input[placeholder*="标题"], input[aria-label*="标题"], textarea[placeholder*="标题"], [contenteditable="true"], input[type="file"]'));
      const hasImageEditSignal = normalize(root.textContent ?? "").includes("图片编辑") || Boolean(root.querySelector('[data-testid*="upload-result" i], [class*="image-item" i], [class*="media-item" i]'));
      return hasEditorField || hasImageEditSignal;
    });
    const inEditor = (element: Element): boolean => editorRoots.length > 0 && editorRoots.some((root) => root.contains(element));
    const previewElements = Array.from(document.querySelectorAll('img[class*="preview" i], img[src^="blob:" i], img[src^="data:image" i], [data-testid*="upload-result" i], [data-testid*="preview" i], [class*="image-item" i], [class*="media-item" i]')).filter(inEditor);
    const previewReady = previewElements.some(visible);
    const previewGeometry = previewElements.map((element) => {
      const rect = element.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? { x: Math.round(rect.x * 100) / 100, y: Math.round(rect.y * 100) / 100, width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100 } : null;
    }).filter((box): box is { x: number; y: number; width: number; height: number } => box !== null).slice(0, 20);
    const associatedSemanticText = previewElements.map((element) => semanticText(element.parentElement ?? element)).filter((text) => text.length > 0).slice(0, 12);
    const mediaPreviewSignalPresent = associatedSemanticText.some((text) => /预览|重新上传|删除|替换|preview|replace|delete/iu.test(text)) || intermediateActionElements.length > 0;
    const modalElements = Array.from(document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="mask" i], [class*="overlay" i], [class*="drawer" i]'));
    const modalVisible = modalElements.some(visible);
    const modalDiagnostics = {
      dialogCount: document.querySelectorAll('dialog, [role="dialog"]').length,
      modalSignalCount: modalElements.length,
      maskCount: document.querySelectorAll('[class*="mask" i]').length,
      overlayCount: document.querySelectorAll('[class*="overlay" i]').length,
      drawerCount: document.querySelectorAll('[class*="drawer" i]').length,
      visible: modalVisible,
      ariaModalCount: document.querySelectorAll('[aria-modal="true"]').length
    };
    const postUploadSemanticNodes = semanticElements.filter((element) => visible(element) && /上传|拖拽|图片|图文|发布|完成|确认|下一步|继续|预览|裁剪|编辑|重新上传|删除|替换|upload|drag|image|publish|done|confirm|next|continue|preview|crop|edit|replace|delete/iu.test(semanticText(element))).slice(0, 30).map((element) => ({
      tagName: element.tagName.toUpperCase(),
      normalizedText: semanticText(element),
      role: element.getAttribute("role"),
      visible: true,
      enabled: !(element as HTMLButtonElement).disabled && element.getAttribute("aria-disabled") !== "true",
      boundingBox: (() => { const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; })(),
      nearestInteractiveAncestorTag: null,
      nearestInteractiveAncestorRole: null
    }));
    const intermediateActionCandidates = intermediateActionElements.slice(0, 20).map((element, index) => ({
      candidateId: element.getAttribute("data-testid")?.trim() || `intermediate-action-${index}`,
      tagName: element.tagName.toUpperCase(),
      role: element.getAttribute("role"),
      semanticSignal: "intermediate-action",
      normalizedText: semanticText(element),
      visible: true,
      enabled: !(element as HTMLButtonElement).disabled && element.getAttribute("aria-disabled") !== "true",
      boundingBox: boundingBox(element),
      nearestInteractiveAncestorTag: nearestInteractive(element)?.tagName.toUpperCase() ?? null,
      nearestInteractiveAncestorRole: nearestInteractive(element)?.getAttribute("role") ?? null,
      pointerEvents: window.getComputedStyle(nearestInteractive(element) ?? element).pointerEvents,
      hitTestValid: hitTestValid(element)
    }));
    const requiredValidationSignals = Array.from(new Set(semanticElements.map(semanticText).filter((text) => /必填|必须|不能为空|请选择|required|must\s+(?:select|choose|fill)/iu.test(text)))).slice(0, 12);
    const forbiddenActionSignalPresent = semanticElements.some((element) => /删除账号|注销账号|退出登录|永久删除|delete\s+account|log\s*out/iu.test(semanticText(element)));
    const typedAttributes = Array.from(document.querySelectorAll("[data-content-type], [data-type]")).map((element) => `${element.getAttribute("data-content-type") ?? ""} ${element.getAttribute("data-type") ?? ""}`).join(" ").toLowerCase();
    const hasVideoSignal = /video|视频/iu.test(`${typedAttributes} ${semanticControls}`);
    const hasImageSignal = /image|图文|图片/iu.test(`${typedAttributes} ${semanticControls}`) || uploadCandidates.length > 0;
    const contentTypeSignal = hasVideoSignal && !hasImageSignal ? "VIDEO" : hasImageSignal ? "IMAGE_POST" : "UNKNOWN";
    const loginPagePresent = /\/login(?:[/?#]|$)/iu.test(window.location.href) || Boolean(document.querySelector('[data-testid*="login" i], form[action*="login" i]'));
    const securityVerificationPresent = /security|verify|captcha|验证|验证码/iu.test(`${window.location.pathname} ${semanticControls}`) || Boolean(document.querySelector('[data-testid*="captcha" i], [class*="captcha" i], [aria-label*="安全验证"]'));
    const shellCount = document.querySelectorAll('main, [role="main"], [data-testid*="publish" i], [class*="publish" i], [class*="editor" i]').length;
    const shellSignal = document.readyState === "complete" && document.body.childElementCount > 0 && shellCount > 0 && !loginPagePresent && !securityVerificationPresent;
    const interactiveTopology = {
      buttonCount: document.querySelectorAll("button").length,
      roleButtonCount: document.querySelectorAll('[role="button"]').length,
      dialogCount: modalDiagnostics.dialogCount,
      modalSignalCount: modalDiagnostics.modalSignalCount,
      fileInputCount: document.querySelectorAll('input[type="file"]').length,
      contenteditableCount: document.querySelectorAll('[contenteditable="true"]').length,
      textareaCount: document.querySelectorAll("textarea").length,
      textInputCount: document.querySelectorAll('input[type="text"], input:not([type])').length,
      titleCandidateCount: titleCandidates.length,
      bodyCandidateCount: bodyCandidates.length,
      finalSubmitCandidateCount: finalSubmitCandidates.length
    };
    const shellFingerprint = JSON.stringify({ shellCount, title: titleCandidates.length, body: bodyCandidates.length, upload: uploadCandidates.length, settings: settingsCandidates.length, finalSubmit: finalSubmitCandidates.length, previewCount: previewGeometry.length, modalSignalCount: modalDiagnostics.modalSignalCount, intermediateActionCount: intermediateActionCandidates.length });
    return { currentUrl: window.location.href, readyState: document.readyState, shellSignal, shellFingerprint, contentTypeSignal, securityVerificationPresent, loginPagePresent, titleCandidates, bodyCandidates, uploadCandidates, publishSettingsCandidates: settingsCandidates, finalSubmitCandidates, postUploadSemanticNodes, interactiveTopology, mediaPreviewDiagnostics: { previewCount: previewGeometry.length, previewVisible: previewGeometry.length > 0, previewGeometry, deleteReplaceEditSignals: associatedSemanticText.filter((text) => /删除|替换|编辑|裁剪|重新上传|delete|replace|edit|crop|reupload/iu.test(text)).slice(0, 12), associatedSemanticText }, modalDiagnostics, intermediateActionCandidates, requiredValidationSignals, forbiddenActionSignalPresent, mediaPreviewSignalPresent, mediaEditingSignalPresent, uploadBusy, previewReady };
    });
  } catch {
    raw = null;
  }
  if (isSnapshotPayload(raw)) return normalizeSnapshot(raw, fallbackUrl);
  return readSnapshotFromLocators(page, fallbackUrl);
}

async function readPhaseDomSnapshot(page: Page): Promise<ImageEditorPhaseDomSnapshot> {
  const fallbackUrl = page.url();
  let raw: unknown = null;
  try {
    raw = await page.evaluate(() => {
      const normalize = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
      const boundingBox = (element: Element): ImageEditorBoundingBox | null => {
        const rect = element.getBoundingClientRect();
        if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
        return { x: Math.round(rect.x * 100) / 100, y: Math.round(rect.y * 100) / 100, width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100 };
      };
      const intersectsViewport = (box: ImageEditorBoundingBox | null): boolean => box !== null
        && box.x + box.width > 0
        && box.y + box.height > 0
        && box.x < window.innerWidth
        && box.y < window.innerHeight
        && box.width > 0
        && box.height > 0;
      const visible = (element: Element): boolean => {
        const style = window.getComputedStyle(element);
        const box = boundingBox(element);
        return !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && box !== null;
      };
      const enabled = (element: Element): boolean => {
        const node = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        return !node.disabled && element.getAttribute("aria-disabled") !== "true";
      };
      const role = (element: Element): string | null => element.getAttribute("role");
      const hasClassToken = (element: Element, token: string): boolean => (element.getAttribute("class") ?? "").split(/[\s]+/u).includes(token);
      const isPositiveState = (value: string | null): boolean => value !== null && value.toLowerCase() !== "false" && value !== "0";
      const activeSignal = (element: Element): boolean => isPositiveState(element.getAttribute("aria-selected"))
        || isPositiveState(element.getAttribute("aria-current"))
        || isPositiveState(element.getAttribute("aria-pressed"))
        || isPositiveState(element.getAttribute("data-selected"))
        || isPositiveState(element.getAttribute("data-active"))
        || hasClassToken(element, "active")
        || hasClassToken(element, "selected")
        || hasClassToken(element, "current");
      const semanticText = (element: Element): string => normalize(`${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.getAttribute("data-content-type") ?? ""} ${element.getAttribute("data-type") ?? ""}`).slice(0, 120);
      const signalFor = (value: string): string | null => {
        const text = value.toLowerCase();
        if (/裁剪|编辑图片|编辑照片|crop|edit image/iu.test(text)) return "media-edit";
        if (/预览|重新上传|删除|替换|preview|replace|delete/iu.test(text)) return "media-preview";
        if (/完成|确认|下一步|继续|done|confirm|next|continue/iu.test(text)) return "intermediate-action";
        if (/上传|选择图片|添加图片|upload/iu.test(text)) return "upload";
        if (/拖拽|drag/iu.test(text)) return "drag";
        if (/图片|图文|image/iu.test(text)) return "image";
        if (/发布图文|publish.*image/iu.test(text)) return "image-post";
        if (/发布/iu.test(text)) return "publish";
        return null;
      };
      const isInteractive = (element: Element): boolean => ["A", "BUTTON", "INPUT", "LABEL", "SELECT", "TEXTAREA"].includes(element.tagName) || ["button", "link", "tab", "radio", "checkbox"].includes(element.getAttribute("role") ?? "");
      const boundedClassTokens = (element: Element): string[] => (element.getAttribute("class") ?? "").split(/[\s]+/u).map((token) => token.replace(/[^\w-]/gu, "")).filter(Boolean).slice(0, 8);
      const nearestInteractive = (element: Element): Element | null => {
        let current: Element | null = element.parentElement;
        for (let depth = 1; current && depth <= 6; depth += 1, current = current.parentElement) {
          if (isInteractive(current)) return current;
        }
        return null;
      };
      const hitTestValid = (element: Element): boolean => {
        const box = boundingBox(element);
        if (!box) return false;
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const owner = nearestInteractive(element) ?? element;
        return hit === element || Boolean(hit && (element.contains(hit) || owner.contains(hit)));
      };
      const semanticElements = Array.from(document.querySelectorAll("button, a, label, [role], [aria-label], [data-testid], [data-content-type], [data-type]"));
      const preUploadSemanticNodes: ImageEditorSemanticNode[] = [];
      for (const element of semanticElements) {
        const text = semanticText(element);
        if (!signalFor(text) || !visible(element)) continue;
        const ancestor = nearestInteractive(element);
        preUploadSemanticNodes.push({
          tagName: element.tagName.toUpperCase(),
          normalizedText: text,
          role: role(element),
          visible: true,
          enabled: enabled(element),
          boundingBox: boundingBox(element),
          nearestInteractiveAncestorTag: ancestor?.tagName.toUpperCase() ?? null,
          nearestInteractiveAncestorRole: ancestor ? role(ancestor) : null
        });
        if (preUploadSemanticNodes.length >= 20) break;
      }
      const uploadInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const exactTabElements = (label: ImageEditorSelectedTab): Element[] => {
        const raw = Array.from(document.querySelectorAll("*")).filter((element) => normalize(element.textContent ?? "") === label);
        return raw.filter((element) => !raw.some((other) => other !== element && element.contains(other))).slice(0, 20);
      };
      const creatorTabAncestor = (element: Element): Element | null => {
        let current = element.parentElement;
        for (let depth = 1; current && depth <= 5; depth += 1, current = current.parentElement) {
          if (hasClassToken(current, "creator-tab")) return current;
        }
        return null;
      };
      const tabCandidates: ImageEditorTabCandidateEvidence[] = [];
      for (const label of ["上传视频", "上传图文", "写长文", "发播客"] as const) {
        for (const element of exactTabElements(label)) {
          const creatorTab = creatorTabAncestor(element);
          const elementBox = boundingBox(element);
          const creatorTabBox = creatorTab ? boundingBox(creatorTab) : null;
          let current: Element | null = element;
          let active = false;
          for (let depth = 0; current && depth <= 5; depth += 1, current = current.parentElement) {
            if (activeSignal(current)) { active = true; break; }
          }
          const elementStyle = window.getComputedStyle(element);
          tabCandidates.push({
            label,
            rendered: visible(element),
            intersectsViewport: intersectsViewport(elementBox),
            creatorTabRendered: creatorTab !== null && visible(creatorTab),
            creatorTabIntersectsViewport: intersectsViewport(creatorTabBox),
            enabled: enabled(element),
            pointerEvents: elementStyle.pointerEvents,
            active
          });
        }
      }
      const usableTabCandidates = tabCandidates.filter((candidate) => candidate.rendered
        && candidate.intersectsViewport
        && candidate.creatorTabRendered
        && candidate.creatorTabIntersectsViewport
        && candidate.enabled
        && candidate.pointerEvents !== "none");
      const activeTabCandidates = usableTabCandidates.filter((candidate) => candidate.active);
      const currentSelectedTab = activeTabCandidates.length === 1 ? activeTabCandidates[0]?.label ?? null : null;
      const tabPresence: ImageEditorTabPresence = {
        uploadVideoTabPresent: usableTabCandidates.some((candidate) => candidate.label === "上传视频"),
        uploadImageTabPresent: usableTabCandidates.some((candidate) => candidate.label === "上传图文"),
        longFormTabPresent: usableTabCandidates.some((candidate) => candidate.label === "写长文"),
        podcastTabPresent: usableTabCandidates.some((candidate) => candidate.label === "发播客"),
        currentSelectedTab
      };
      const uploadControlRelationships: ImageEditorUploadControlRelationship[] = uploadInputs.slice(0, 20).map((input, index) => {
        const ancestors: ImageEditorUploadAncestor[] = [];
        let current: Element | null = input.parentElement;
        let usableAncestor = false;
        for (let depth = 1; current && depth <= 6; depth += 1, current = current.parentElement) {
          const style = window.getComputedStyle(current);
          const textSignal = signalFor(semanticText(current));
          const currentBox = boundingBox(current);
          const currentVisible = visible(current);
          if (currentVisible && style.pointerEvents !== "none" && currentBox !== null && (isInteractive(current) || textSignal === "upload" || textSignal === "drag" || textSignal === "image" || textSignal === "image-post")) usableAncestor = true;
          ancestors.push({
            depth,
            tagName: current.tagName.toUpperCase(),
            role: role(current),
            boundedClassTokens: boundedClassTokens(current),
            visible: currentVisible,
            pointerEvents: style.pointerEvents,
            boundingBox: currentBox,
            semanticTextSignal: textSignal
          });
        }
        return {
          candidateId: input.getAttribute("data-testid")?.trim() || `image-upload-control-${index}`,
          tagName: input.tagName.toUpperCase(),
          type: (input.getAttribute("type") ?? "file").toLowerCase(),
          accept: input.getAttribute("accept"),
          multiple: input.hasAttribute("multiple"),
          enabled: enabled(input),
          visible: visible(input),
          usableSurface: enabled(input) && usableAncestor,
          surfaceSignal: usableAncestor ? "visible-upload-ancestor" : "none",
          ancestors
        };
      });
      const titleCandidateCount = document.querySelectorAll('input[placeholder*="标题"], input[aria-label*="标题"], input[name*="title" i], input[id*="title" i], textarea[placeholder*="标题"], textarea[aria-label*="标题"], [data-testid*="title" i]').length;
      const bodyCandidateCount = document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder], textarea[aria-label*="正文"], textarea[name*="body" i], textarea[id*="body" i], [data-testid*="body" i][contenteditable="true"]').length;
      const uploadCandidateCount = document.querySelectorAll('input[type="file"], [aria-label*="上传图片"], [aria-label*="添加图片"], [data-testid*="upload" i], [class*="upload" i][role="button"]').length;
      const finalSubmitCandidateCount = Array.from(document.querySelectorAll("button, [role=\"button\"]")).filter((element) => /^(发布|发布笔记|发表|提交|立即发布|publish|submit)$/iu.test(normalize(element.textContent ?? element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "")) && !/视频/iu.test(semanticText(element))).length;
      const bodyText = normalize(document.body?.innerText ?? "");
      const semanticControls = semanticElements.map(semanticText).join(" ");
      const intermediateActionElements = semanticElements.filter((element) => visible(element) && /完成|确认|下一步|继续|done|confirm|next|continue|编辑图片|裁剪完成|返回编辑|edit image|crop done|back to edit/iu.test(semanticText(element)));
      const intermediateActionCandidates = intermediateActionElements.slice(0, 20).map((element, index) => ({
        candidateId: element.getAttribute("data-testid")?.trim() || `intermediate-action-${index}`,
        tagName: element.tagName.toUpperCase(),
        role: element.getAttribute("role"),
        semanticSignal: "intermediate-action",
        normalizedText: semanticText(element),
        visible: true,
        enabled: enabled(element),
        boundingBox: boundingBox(element),
        nearestInteractiveAncestorTag: nearestInteractive(element)?.tagName.toUpperCase() ?? null,
        nearestInteractiveAncestorRole: nearestInteractive(element)?.getAttribute("role") ?? null,
        pointerEvents: window.getComputedStyle(nearestInteractive(element) ?? element).pointerEvents,
        hitTestValid: hitTestValid(element)
      }));
      const requiredValidationSignals = Array.from(new Set(semanticElements.map(semanticText).filter((text) => /必填|必须|不能为空|请选择|required|must\s+(?:select|choose|fill)/iu.test(text)))).slice(0, 12);
      const forbiddenActionSignalPresent = semanticElements.some((element) => /删除账号|注销账号|退出登录|永久删除|delete\s+account|log\s*out/iu.test(semanticText(element)));
      const typedAttributes = Array.from(document.querySelectorAll("[data-content-type], [data-type]")).map((element) => `${element.getAttribute("data-content-type") ?? ""} ${element.getAttribute("data-type") ?? ""}`).join(" ");
      const imageSignal = uploadInputs.length > 0 || usableTabCandidates.some((candidate) => candidate.label === "上传图文") || /image|图文|图片/iu.test(`${typedAttributes} ${semanticControls} ${bodyText}`);
      const videoSignal = /video|视频/iu.test(`${typedAttributes} ${semanticControls} ${bodyText}`);
      const contentTypeSignal: ImageEditorContentType = videoSignal && !imageSignal ? "VIDEO" : imageSignal ? "IMAGE_POST" : "UNKNOWN";
      const loginPagePresent = /\/login(?:[/?#]|$)/iu.test(window.location.href) || /登录/iu.test(bodyText) || Boolean(document.querySelector('[data-testid*="login" i], form[action*="login" i]'));
      const securityVerificationPresent = /security|verify|captcha|安全验证|验证码/iu.test(`${window.location.pathname} ${semanticControls} ${bodyText}`) || Boolean(document.querySelector('[data-testid*="captcha" i], [class*="captcha" i], [aria-label*="安全验证"]'));
      const shellCount = document.querySelectorAll('main, [role="main"], [data-testid*="publish" i], [class*="publish" i], [class*="editor" i]').length;
      const shellSignal = /^https:\/\/creator\.xiaohongshu\.com\/publish\/publish(?:[/?#]|$)/iu.test(window.location.href) && document.readyState === "complete" && document.body !== null && shellCount > 0 && !loginPagePresent && !securityVerificationPresent;
      const semanticSignals = Array.from(new Set([
        ...preUploadSemanticNodes.map((node) => signalFor(node.normalizedText)),
        ...(tabPresence.currentSelectedTab === "上传图文" ? ["image-post"] : [])
      ].filter((signal): signal is string => signal !== null))).slice(0, 12);
      const phaseTopology: ImageEditorPhaseTopology = {
        titleCandidateCount,
        bodyCandidateCount,
        uploadCandidateCount,
        finalSubmitCandidateCount,
        contenteditableCount: document.querySelectorAll('[contenteditable="true"]').length,
        textareaCount: document.querySelectorAll("textarea").length,
        textInputCount: document.querySelectorAll('input[type="text"], input:not([type])').length,
        fileInputCount: uploadInputs.length,
        buttonCount: document.querySelectorAll("button").length,
        roleButtonCount: document.querySelectorAll('[role="button"]').length,
        semanticSignals,
        stable: false
      };
      const capability = uploadControlRelationships.filter((relationship) => relationship.enabled && relationship.usableSurface);
      const uploadBusy = document.querySelector('[aria-busy="true"], [class*="loading" i], [class*="uploading" i], progress') !== null;
      const editorRoots = Array.from(document.querySelectorAll('[data-testid*="editor" i], [class*="editor" i], [data-testid*="publish" i], [class*="publish" i]')).filter((root) => {
        const hasEditorField = Boolean(root.querySelector('input[placeholder*="标题"], input[aria-label*="标题"], textarea[placeholder*="标题"], [contenteditable="true"], input[type="file"]'));
        const hasImageEditSignal = normalize(root.textContent ?? "").includes("图片编辑") || Boolean(root.querySelector('[data-testid*="upload-result" i], [class*="image-item" i], [class*="media-item" i]'));
        return hasEditorField || hasImageEditSignal;
      });
      const inEditor = (element: Element): boolean => editorRoots.length > 0 && editorRoots.some((root) => root.contains(element));
      const previewReady = Array.from(document.querySelectorAll('img[class*="preview" i], img[src^="blob:" i], img[src^="data:image" i], [data-testid*="upload-result" i], [data-testid*="preview" i], [class*="image-item" i], [class*="media-item" i]')).filter(inEditor).some(visible);
      return {
        currentUrl: window.location.href,
        readyState: document.readyState,
        shellSignal,
        shellFingerprint: JSON.stringify({ shellCount, titleCandidateCount, bodyCandidateCount, uploadCandidateCount, finalSubmitCandidateCount, semanticSignals, capabilityCount: capability.length, tabPresence }),
        contentTypeSignal,
        securityVerificationPresent,
        loginPagePresent,
        domStable: false,
        uploadCapabilityPresent: capability.length === 1,
        uploadCapabilityUnique: capability.length === 1,
        preUploadSemanticSignalPresent: semanticSignals.some((signal) => signal === "upload" || signal === "drag" || signal === "image" || signal === "image-post") || tabPresence.currentSelectedTab === "上传图文",
        tabCandidates,
        tabPresence,
        titleCandidateCount,
        bodyCandidateCount,
        finalSubmitCandidateCount,
        preUploadSemanticNodes,
        postUploadSemanticNodes: preUploadSemanticNodes,
        uploadControlRelationships,
        phaseTopology,
        interactiveTopology: {
          buttonCount: phaseTopology.buttonCount,
          roleButtonCount: phaseTopology.roleButtonCount,
          dialogCount: 0,
          modalSignalCount: 0,
          fileInputCount: phaseTopology.fileInputCount,
          contenteditableCount: phaseTopology.contenteditableCount,
          textareaCount: phaseTopology.textareaCount,
          textInputCount: phaseTopology.textInputCount,
          titleCandidateCount,
          bodyCandidateCount,
          finalSubmitCandidateCount
        },
        mediaPreviewDiagnostics: { previewCount: previewReady ? 1 : 0, previewVisible: previewReady, previewGeometry: [], deleteReplaceEditSignals: [], associatedSemanticText: [] },
        modalDiagnostics: { dialogCount: 0, modalSignalCount: 0, maskCount: 0, overlayCount: 0, drawerCount: 0, visible: false, ariaModalCount: 0 },
        intermediateActionCandidates,
        requiredValidationSignals,
        forbiddenActionSignalPresent,
        mediaPreviewSignalPresent: false,
        mediaEditingSignalPresent: false,
        uploadBusy,
        previewReady
      };
    });
  } catch {
    raw = null;
  }
  return normalizePhaseSnapshot(raw, fallbackUrl);
}

async function waitForProbe(page: Page, intervalMs: number): Promise<void> {
  if (intervalMs <= 0) return;
  const candidate = page as unknown as { waitForTimeout?: (timeout: number) => Promise<void> };
  if (typeof candidate.waitForTimeout === "function") {
    await candidate.waitForTimeout(intervalMs);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
}

function readinessSample(snapshot: ImageEditorDomSnapshot, sampleIndex: number, startedAt: number): ImageEditorReadinessSample {
  return {
    sampleIndex,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    readyState: snapshot.readyState,
    currentUrl: sanitizeUrl(snapshot.currentUrl),
    shellSignal: snapshot.shellSignal,
    shellFingerprint: snapshot.shellFingerprint,
    titleCandidateCount: snapshot.titleCandidates.length,
    bodyCandidateCount: snapshot.bodyCandidates.length,
    uploadCandidateCount: snapshot.uploadCandidates.length,
    finalSubmitCandidateCount: snapshot.finalSubmitCandidates.length,
    securityVerificationPresent: snapshot.securityVerificationPresent,
    loginPagePresent: snapshot.loginPagePresent,
    ...(snapshot.uploadBusy === undefined ? {} : { uploadBusy: snapshot.uploadBusy }),
    ...(snapshot.previewReady === undefined ? {} : { previewReady: snapshot.previewReady })
  };
}

function baseFields(snapshot: ImageEditorDomSnapshot): Omit<ImageEditorDiagnostic, "code" | "timestamp" | "operationId" | "platformKey" | "accountId" | "contextDebugId" | "pageDebugId"> {
  return { sanitizedUrl: sanitizeUrl(snapshot.currentUrl), currentUrl: sanitizeUrl(snapshot.currentUrl), readyState: snapshot.readyState, securityVerificationPresent: snapshot.securityVerificationPresent, loginPagePresent: snapshot.loginPagePresent };
}

function postUploadPhaseEvidence(snapshot: ImageEditorDomSnapshot, domStable: boolean): ImagePostUploadPhaseEvidence {
  const mediaPreview = snapshot.mediaPreviewDiagnostics ?? emptyMediaPreviewDiagnostics();
  const modal = snapshot.modalDiagnostics ?? emptyModalDiagnostics();
  return {
    shellReady: snapshot.shellSignal && EDITOR_ROUTE_PATTERN.test(snapshot.currentUrl) && snapshot.readyState === "complete",
    contentType: snapshot.contentTypeSignal,
    contentTypeReady: snapshot.contentTypeSignal === "IMAGE_POST",
    domStable,
    loginPagePresent: snapshot.loginPagePresent,
    securityVerificationPresent: snapshot.securityVerificationPresent,
    uploadBusy: snapshot.uploadBusy === true,
    previewReady: snapshot.previewReady === true,
    previewCount: mediaPreview.previewCount,
    mediaPreviewSignalPresent: snapshot.mediaPreviewSignalPresent === true || mediaPreview.associatedSemanticText.length > 0,
    mediaEditingSignalPresent: snapshot.mediaEditingSignalPresent === true || mediaPreview.deleteReplaceEditSignals.some((signal) => /裁剪|编辑|crop|edit/iu.test(signal)),
    modalVisible: modal.visible,
    intermediateActionSignalPresent: (snapshot.intermediateActionCandidates?.length ?? 0) > 0,
    titleCandidateCount: snapshot.titleCandidates.length,
    bodyCandidateCount: snapshot.bodyCandidates.length,
    finalSubmitCandidateCount: snapshot.finalSubmitCandidates.length
  };
}

export async function inspectImagePostEditor(page: Page, metadata: ImageEditorInspectionMetadata, options: ImageEditorInspectionOptions = {}): Promise<ImagePostEditorInspectionResult> {
  const requestedWaitMs = options.readinessWindowMs ?? options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const maxWaitMs = Math.max(0, Math.min(MAX_READINESS_WINDOW_MS, requestedWaitMs));
  const probeIntervalMs = Math.max(0, options.readinessSampleIntervalMs ?? options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS);
  const stableSampleCount = Math.max(2, options.stableSampleCount ?? DEFAULT_STABLE_SAMPLE_COUNT);
  const startedAt = Date.now();
  const readinessSamples: ImageEditorReadinessSample[] = [];
  let previousFingerprint = "";
  let stableCount = 0;
  let lastSnapshot = normalizeSnapshot(null, page.url());
  emit(options, metadata, "IMAGE_EDITOR_INSPECTION_STARTED", { sanitizedUrl: sanitizeUrl(page.url()) });

  while (Date.now() - startedAt <= maxWaitMs) {
    lastSnapshot = await readSnapshot(page);
    const shellStable = lastSnapshot.shellSignal && EDITOR_ROUTE_PATTERN.test(lastSnapshot.currentUrl) && lastSnapshot.readyState === "complete";
    if (shellStable && lastSnapshot.shellFingerprint === previousFingerprint) stableCount += 1;
    else if (shellStable) stableCount = 1;
    else stableCount = 0;
    previousFingerprint = shellStable ? lastSnapshot.shellFingerprint : "";
    const postUploadClassification = options.postUploadReadiness && stableCount >= stableSampleCount
      ? classifyPostUploadImageEditorState(postUploadPhaseEvidence(lastSnapshot, true))
      : null;
    const sample = readinessSample(lastSnapshot, readinessSamples.length, startedAt);
    const recordedSample: ImageEditorReadinessSample = postUploadClassification
      ? { ...sample, observedPhase: postUploadClassification.phase, domStable: true }
      : { ...sample, domStable: stableCount >= stableSampleCount };
    readinessSamples.push(recordedSample);
    emit(options, metadata, "IMAGE_EDITOR_READINESS_SAMPLE", { ...baseFields(lastSnapshot), sampleIndex: recordedSample.sampleIndex, elapsedMs: recordedSample.elapsedMs, titleCandidateCount: recordedSample.titleCandidateCount, bodyCandidateCount: recordedSample.bodyCandidateCount, uploadCandidateCount: recordedSample.uploadCandidateCount, finalSubmitCandidateCount: recordedSample.finalSubmitCandidateCount, observedPhase: recordedSample.observedPhase, ...(recordedSample.domStable === undefined ? {} : { domStable: recordedSample.domStable }), ...(recordedSample.uploadBusy === undefined ? {} : { uploadBusy: recordedSample.uploadBusy }), ...(recordedSample.previewReady === undefined ? {} : { previewReady: recordedSample.previewReady }) });
    if (lastSnapshot.loginPagePresent || lastSnapshot.securityVerificationPresent) {
      const result = emptyResult("FAILED", "IMAGE_EDITOR_SHELL_NOT_READY", sample.currentUrl, readinessSamples);
      result.loginPagePresent = lastSnapshot.loginPagePresent;
      result.securityVerificationPresent = lastSnapshot.securityVerificationPresent;
      result.failureCode = lastSnapshot.loginPagePresent ? "AUTH_REDIRECTED_TO_LOGIN" : "SECURITY_VERIFICATION_REQUIRED";
      result.failureStage = "AUTHENTICATION";
      result.missingSignal = lastSnapshot.loginPagePresent ? "login-url" : "security-verification-signal";
      emit(options, metadata, "IMAGE_EDITOR_INSPECTION_FAILED", { ...baseFields(lastSnapshot), shellStatus: result.shellStatus, status: result.status, failureCode: result.failureCode, failureStage: result.failureStage, missingSignal: result.missingSignal });
      return result;
    }
    if (shellStable) {
      if (stableCount >= stableSampleCount) {
        if (!options.postUploadReadiness) break;
        if (postUploadClassification?.terminalStateReached) break;
      }
        emit(options, metadata, "IMAGE_EDITOR_SHELL_NOT_READY", { ...baseFields(lastSnapshot), shellStatus: "IMAGE_EDITOR_SHELL_NOT_READY", sampleIndex: sample.sampleIndex, elapsedMs: sample.elapsedMs });
    } else {
      stableCount = 0;
      previousFingerprint = "";
      emit(options, metadata, "IMAGE_EDITOR_SHELL_NOT_READY", { ...baseFields(lastSnapshot), shellStatus: "IMAGE_EDITOR_SHELL_NOT_READY", sampleIndex: sample.sampleIndex, elapsedMs: sample.elapsedMs });
    }
    await waitForProbe(page, probeIntervalMs);
  }

  const lastSample = readinessSamples[readinessSamples.length - 1];
  const shellReady = stableCount >= stableSampleCount && lastSnapshot.shellSignal && EDITOR_ROUTE_PATTERN.test(lastSnapshot.currentUrl);
  if (!shellReady) {
    const result = emptyResult("FAILED", "IMAGE_EDITOR_SHELL_TIMEOUT", lastSample?.currentUrl ?? sanitizeUrl(lastSnapshot.currentUrl), readinessSamples);
    result.loginPagePresent = lastSnapshot.loginPagePresent;
    result.securityVerificationPresent = lastSnapshot.securityVerificationPresent;
    result.failureCode = "IMAGE_EDITOR_SHELL_TIMEOUT";
    result.failureStage = "EDITOR_DISCOVERY";
    result.missingSignal = "image-editor-shell-ready";
    emit(options, metadata, "IMAGE_EDITOR_SHELL_TIMEOUT", { ...baseFields(lastSnapshot), shellStatus: result.shellStatus, status: result.status, failureCode: result.failureCode, failureStage: result.failureStage, missingSignal: result.missingSignal });
    emit(options, metadata, "IMAGE_EDITOR_INSPECTION_FAILED", { ...baseFields(lastSnapshot), shellStatus: result.shellStatus, status: result.status, failureCode: result.failureCode, failureStage: result.failureStage, missingSignal: result.missingSignal });
    return result;
  }

  emit(options, metadata, "IMAGE_EDITOR_SHELL_READY", { ...baseFields(lastSnapshot), shellStatus: "IMAGE_EDITOR_SHELL_READY", elapsedMs: Math.max(0, Date.now() - startedAt) });
  const contentType = lastSnapshot.contentTypeSignal;
  const contentTypeReady = contentType === "IMAGE_POST";
  emit(options, metadata, "IMAGE_EDITOR_CONTENT_TYPE_OBSERVED", { ...baseFields(lastSnapshot), contentType, contentTypeReady });
  if (!contentTypeReady) {
    const result = emptyResult("FAILED", "IMAGE_EDITOR_SHELL_READY", sanitizeUrl(lastSnapshot.currentUrl), readinessSamples);
    result.contentType = contentType;
    result.contentTypeReady = false;
    result.securityVerificationPresent = lastSnapshot.securityVerificationPresent;
    result.loginPagePresent = lastSnapshot.loginPagePresent;
    result.failureCode = "CONTENT_TYPE_NOT_READY";
    result.failureStage = "EDITOR_DISCOVERY";
    result.missingSignal = "content-type:image-post";
    emit(options, metadata, "IMAGE_EDITOR_INSPECTION_FAILED", { ...baseFields(lastSnapshot), shellStatus: result.shellStatus, status: result.status, contentType, contentTypeReady, failureCode: result.failureCode, failureStage: result.failureStage, missingSignal: result.missingSignal });
    return result;
  }

  if (options.postUploadReadiness) {
    const postUploadClassification = classifyPostUploadImageEditorState(postUploadPhaseEvidence(lastSnapshot, stableCount >= stableSampleCount));
    if (!postUploadClassification.terminalStateReached || postUploadClassification.intermediateState !== "NONE") {
      const result = emptyResult("FAILED", "IMAGE_EDITOR_SHELL_READY", sanitizeUrl(lastSnapshot.currentUrl), readinessSamples);
      result.contentType = contentType;
      result.contentTypeReady = contentTypeReady;
      result.securityVerificationPresent = lastSnapshot.securityVerificationPresent;
      result.loginPagePresent = lastSnapshot.loginPagePresent;
      result.postUploadSemanticNodes = lastSnapshot.postUploadSemanticNodes;
      result.interactiveTopology = lastSnapshot.interactiveTopology;
      result.mediaPreviewDiagnostics = lastSnapshot.mediaPreviewDiagnostics;
      result.modalDiagnostics = lastSnapshot.modalDiagnostics;
      result.intermediateActionCandidates = lastSnapshot.intermediateActionCandidates;
      result.requiredValidationSignals = lastSnapshot.requiredValidationSignals;
      result.forbiddenActionSignalPresent = lastSnapshot.forbiddenActionSignalPresent;
      result.failureCode = postUploadClassification.intermediateState !== "NONE"
        ? (lastSnapshot.intermediateActionCandidates?.length ?? 0) > 0 ? "POST_UPLOAD_INTERMEDIATE_ACTION_REQUIRED" : "POST_UPLOAD_INTERMEDIATE_STATE"
        : "POST_UPLOAD_EDITOR_NOT_READY";
      result.failureStage = "EDITOR_DISCOVERY";
      result.missingSignal = postUploadClassification.intermediateState !== "NONE" ? "post-upload-intermediate-state" : "post-upload-terminal-phase";
      return result;
    }
  }

  const titleEditor = controlDiscovery("TITLE_EDITOR", lastSnapshot.titleCandidates);
  const bodyEditor = controlDiscovery("BODY_EDITOR", lastSnapshot.bodyCandidates);
  const imageUploadControl = controlDiscovery("IMAGE_UPLOAD_CONTROL", lastSnapshot.uploadCandidates);
  const publishSettingsArea = settingsDiscovery(lastSnapshot.publishSettingsCandidates);
  const finalSubmitControl = controlDiscovery("FINAL_SUBMIT_CONTROL", lastSnapshot.finalSubmitCandidates);
  emit(options, metadata, "IMAGE_EDITOR_CONTROLS_DISCOVERED", { ...baseFields(lastSnapshot), contentType, contentTypeReady, titleEditor, bodyEditor, imageUploadControl, publishSettingsArea, finalSubmitControl });
  const requiredControls = options.requiredControls ?? ["TITLE_EDITOR", "BODY_EDITOR", "IMAGE_UPLOAD_CONTROL", "FINAL_SUBMIT_CONTROL"];
  const controls = [titleEditor, bodyEditor, imageUploadControl, finalSubmitControl].filter((control) => requiredControls.includes(control.kind));
  const failedControl = controls.find((control) => options.postUploadReadiness && control.kind === "FINAL_SUBMIT_CONTROL"
    ? !finalSubmitControlPresence(control.candidates).present
    : control.status !== "FOUND_UNIQUE");
  const result = emptyResult(failedControl ? "FAILED" : "READY", "IMAGE_EDITOR_SHELL_READY", sanitizeUrl(lastSnapshot.currentUrl), readinessSamples);
  result.contentType = contentType;
  result.contentTypeReady = contentTypeReady;
  result.titleEditor = titleEditor;
  result.bodyEditor = bodyEditor;
  result.imageUploadControl = imageUploadControl;
  result.publishSettingsArea = publishSettingsArea;
  result.finalSubmitControl = finalSubmitControl;
  result.titleEditorDetected = titleEditor.detected;
  result.bodyEditorDetected = bodyEditor.detected;
  result.imageUploadControlDetected = imageUploadControl.detected;
  result.publishSettingsAreaDetected = publishSettingsArea.detected;
  const finalSubmitPresence = finalSubmitControlPresence(finalSubmitControl.candidates);
  result.finalSubmitControlPresent = finalSubmitPresence.present;
  result.finalSubmitControlEnabled = finalSubmitPresence.enabled;
  result.finalSubmitControlDetected = finalSubmitPresence.present;
  result.securityVerificationPresent = lastSnapshot.securityVerificationPresent;
  result.loginPagePresent = lastSnapshot.loginPagePresent;
  result.postUploadSemanticNodes = lastSnapshot.postUploadSemanticNodes;
  result.interactiveTopology = lastSnapshot.interactiveTopology;
  result.mediaPreviewDiagnostics = lastSnapshot.mediaPreviewDiagnostics;
  result.modalDiagnostics = lastSnapshot.modalDiagnostics;
  result.intermediateActionCandidates = lastSnapshot.intermediateActionCandidates;
  result.requiredValidationSignals = lastSnapshot.requiredValidationSignals;
  result.forbiddenActionSignalPresent = lastSnapshot.forbiddenActionSignalPresent;
  if (failedControl) {
    result.failureCode = controlFailureCode(failedControl) ?? "EDITOR_CONTROL_AMBIGUOUS";
    result.failureStage = "EDITOR_DISCOVERY";
    result.missingSignal = controlMissingSignal(failedControl);
    emit(options, metadata, "IMAGE_EDITOR_INSPECTION_FAILED", { ...baseFields(lastSnapshot), shellStatus: result.shellStatus, status: result.status, contentType, contentTypeReady, failureCode: result.failureCode, failureStage: result.failureStage, missingSignal: result.missingSignal });
    return result;
  }
  emit(options, metadata, "IMAGE_EDITOR_INSPECTION_COMPLETED", { ...baseFields(lastSnapshot), shellStatus: result.shellStatus, status: result.status, contentType, contentTypeReady });
  return result;
}

function postUploadControlFailureCode(code: PreSubmitGateFailureCode | undefined): PreSubmitGateFailureCode | undefined {
  switch (code) {
    case "TITLE_EDITOR_NOT_FOUND": return "TITLE_EDITOR_NOT_FOUND_POST_UPLOAD";
    case "TITLE_EDITOR_AMBIGUOUS": return "TITLE_EDITOR_AMBIGUOUS_POST_UPLOAD";
    case "TITLE_EDITOR_NOT_VISIBLE": return "TITLE_EDITOR_NOT_VISIBLE_POST_UPLOAD";
    case "TITLE_EDITOR_DISABLED": return "TITLE_EDITOR_DISABLED_POST_UPLOAD";
    case "BODY_EDITOR_NOT_FOUND": return "BODY_EDITOR_NOT_FOUND_POST_UPLOAD";
    case "BODY_EDITOR_AMBIGUOUS": return "BODY_EDITOR_AMBIGUOUS_POST_UPLOAD";
    case "BODY_EDITOR_NOT_VISIBLE": return "BODY_EDITOR_NOT_VISIBLE_POST_UPLOAD";
    case "BODY_EDITOR_DISABLED": return "BODY_EDITOR_DISABLED_POST_UPLOAD";
    case "FINAL_SUBMIT_CONTROL_NOT_FOUND": return "FINAL_SUBMIT_CONTROL_NOT_FOUND_POST_UPLOAD";
    case "FINAL_SUBMIT_CONTROL_AMBIGUOUS": return "FINAL_SUBMIT_CONTROL_AMBIGUOUS_POST_UPLOAD";
    case "FINAL_SUBMIT_CONTROL_NOT_VISIBLE": return "FINAL_SUBMIT_CONTROL_NOT_VISIBLE_POST_UPLOAD";
    case "FINAL_SUBMIT_CONTROL_DISABLED": return "FINAL_SUBMIT_CONTROL_DISABLED_POST_UPLOAD";
    default: return code;
  }
}

export async function inspectPostUploadImageEditor(page: Page, metadata: ImageEditorInspectionMetadata, options: ImageEditorInspectionOptions = {}): Promise<ImagePostUploadEditorInspectionResult> {
  const nativeFilePickerRecovery = await recoverNativeFilePicker(options.nativeFilePickerRecovery);
  emit(options, metadata, "POST_UPLOAD_EDITOR_READINESS_STARTED", {
    sanitizedUrl: sanitizeUrl(page.url()),
    expectedPhase: "IMAGE_POST_POST_UPLOAD_EDITOR",
    observedPhase: "IMAGE_POST_TRANSITIONING",
    nativeFilePickerDetected: nativeFilePickerRecovery.detected,
    nativeFilePickerCancelled: nativeFilePickerRecovery.cancelled,
    nativeFilePickerRecovery: nativeFilePickerRecovery.status,
    nativeFilePickerWindowIdBefore: nativeFilePickerRecovery.pickerWindowIdBefore,
    nativeFilePickerWindowIdAfter: nativeFilePickerRecovery.pickerWindowIdAfter,
    nativeFilePickerOpenBefore: nativeFilePickerRecovery.pickerOpenBefore,
    nativeFilePickerOpenAfter: nativeFilePickerRecovery.pickerOpenAfter,
    nativeFilePickerCancelActionSent: nativeFilePickerRecovery.cancelActionSent,
    nativeFilePickerCancelEffectVerified: nativeFilePickerRecovery.cancelEffectVerified
  });
  const startedAt = Date.now();
  const forwardedEmitter = (diagnostic: ImageEditorDiagnostic): void => {
    try { options.emit?.(diagnostic); } catch { /* diagnostics are best effort */ }
    if (diagnostic.code !== "IMAGE_EDITOR_READINESS_SAMPLE") return;
    emit(options, metadata, "POST_UPLOAD_EDITOR_READINESS_SAMPLE", {
      sanitizedUrl: diagnostic.sanitizedUrl,
      currentUrl: diagnostic.currentUrl,
      readyState: diagnostic.readyState,
      sampleIndex: diagnostic.sampleIndex,
      elapsedMs: diagnostic.elapsedMs,
      titleCandidateCount: diagnostic.titleCandidateCount,
      bodyCandidateCount: diagnostic.bodyCandidateCount,
      uploadCandidateCount: diagnostic.uploadCandidateCount,
      finalSubmitCandidateCount: diagnostic.finalSubmitCandidateCount,
      securityVerificationPresent: diagnostic.securityVerificationPresent,
      loginPagePresent: diagnostic.loginPagePresent,
      uploadBusy: diagnostic.uploadBusy,
      previewReady: diagnostic.previewReady,
      expectedPhase: "IMAGE_POST_POST_UPLOAD_EDITOR",
      observedPhase: diagnostic.observedPhase ?? "IMAGE_POST_TRANSITIONING",
      ...(diagnostic.postUploadTerminalStateReached === undefined ? {} : { postUploadTerminalStateReached: diagnostic.postUploadTerminalStateReached }),
      ...(diagnostic.postUploadIntermediateState === undefined ? {} : { postUploadIntermediateState: diagnostic.postUploadIntermediateState })
    });
  };
  const readinessWindowMs = options.readinessWindowMs ?? options.maxWaitMs ?? DEFAULT_POST_UPLOAD_READINESS_WINDOW_MS;
  const readinessSampleIntervalMs = options.readinessSampleIntervalMs ?? options.probeIntervalMs ?? DEFAULT_POST_UPLOAD_READINESS_SAMPLE_INTERVAL_MS;
  const inspected = await inspectImagePostEditor(page, metadata, {
    ...options,
    readinessWindowMs,
    readinessSampleIntervalMs,
    postUploadReadiness: true,
    requiredControls: ["TITLE_EDITOR", "BODY_EDITOR", "FINAL_SUBMIT_CONTROL"],
    emit: forwardedEmitter
  });
  const lastSample = inspected.readinessSamples[inspected.readinessSamples.length - 1];
  const uploadBusy = lastSample?.uploadBusy === true;
  const previewReady = lastSample?.previewReady ?? inspected.mediaPreviewDiagnostics?.previewVisible ?? true;
  const mediaPreview = inspected.mediaPreviewDiagnostics ?? emptyMediaPreviewDiagnostics();
  const modal = inspected.modalDiagnostics ?? emptyModalDiagnostics();
  const phaseState = classifyPostUploadImageEditorState({
    shellReady: inspected.shellStatus === "IMAGE_EDITOR_SHELL_READY",
    contentType: inspected.contentType,
    contentTypeReady: inspected.contentTypeReady,
    domStable: lastSample?.domStable === true,
    loginPagePresent: inspected.loginPagePresent,
    securityVerificationPresent: inspected.securityVerificationPresent,
    uploadBusy,
    previewReady,
    previewCount: mediaPreview.previewCount,
    mediaPreviewSignalPresent: mediaPreview.associatedSemanticText.length > 0,
    mediaEditingSignalPresent: mediaPreview.deleteReplaceEditSignals.some((signal) => /裁剪|编辑|crop|edit/iu.test(signal)),
    modalVisible: modal.visible,
    intermediateActionSignalPresent: (inspected.intermediateActionCandidates?.length ?? 0) > 0,
    titleCandidateCount: lastSample?.titleCandidateCount ?? 0,
    bodyCandidateCount: lastSample?.bodyCandidateCount ?? 0,
    finalSubmitCandidateCount: lastSample?.finalSubmitCandidateCount ?? 0
  });
  const controlsReady = inspected.status === "READY" && phaseState.phase === "IMAGE_POST_POST_UPLOAD_EDITOR";
  const completionReady = !uploadBusy && previewReady;
  const isAuthenticated = !inspected.loginPagePresent && !inspected.securityVerificationPresent;
  const ready = nativeFilePickerRecovery.status !== "BLOCKED" && controlsReady && completionReady && isAuthenticated && inspected.contentType === "IMAGE_POST" && inspected.contentTypeReady;
  const observedPhase: ImageEditorPhase = phaseState.phase;
  const confidence: ImageEditorPhaseConfidence = ready ? "HIGH" : phaseState.confidence;
  const reason = nativeFilePickerRecovery.status === "BLOCKED"
    ? "native file picker was detected but could not be safely cancelled"
    : ready
    ? "upload completion and stable post-upload editor controls are present"
    : uploadBusy
      ? "upload is still busy"
      : !previewReady
        ? "upload completion preview was not observed"
        : phaseState.reason;
  const postUploadControlsStatus: ImageEditorPostUploadControlsStatus = ready ? "READY" : "FAIL";
  if (!ready) {
    if (nativeFilePickerRecovery.status === "BLOCKED") {
      inspected.failureCode = "POST_UPLOAD_EDITOR_TIMEOUT";
      inspected.failureStage = "EDITOR_DISCOVERY";
      inspected.missingSignal = "native-file-picker-cancel";
    } else if (inspected.loginPagePresent) {
      inspected.failureCode = "AUTH_REDIRECTED_TO_LOGIN";
      inspected.failureStage = "AUTHENTICATION";
      inspected.missingSignal = "login-url";
    } else if (inspected.securityVerificationPresent) {
      inspected.failureCode = "SECURITY_VERIFICATION_REQUIRED";
      inspected.failureStage = "AUTHENTICATION";
      inspected.missingSignal = "security-verification-signal";
    } else if (!completionReady) {
      inspected.failureCode = uploadBusy ? "POST_UPLOAD_EDITOR_TIMEOUT" : "UPLOAD_COMPLETION_NOT_OBSERVED";
      inspected.failureStage = "EDITOR_DISCOVERY";
      inspected.missingSignal = "upload-completion";
    } else if (phaseState.intermediateState !== "NONE") {
      inspected.failureCode = (inspected.intermediateActionCandidates?.length ?? 0) > 0 ? "POST_UPLOAD_INTERMEDIATE_ACTION_REQUIRED" : "POST_UPLOAD_INTERMEDIATE_STATE";
      inspected.failureStage = "EDITOR_DISCOVERY";
      inspected.missingSignal = "post-upload-intermediate-state";
    } else if (phaseState.phase !== "IMAGE_POST_POST_UPLOAD_EDITOR") {
      inspected.failureCode = "POST_UPLOAD_EDITOR_TIMEOUT";
      inspected.failureStage = "EDITOR_DISCOVERY";
      inspected.missingSignal = "post-upload-terminal-phase";
    } else {
      inspected.failureCode = postUploadControlFailureCode(inspected.failureCode) ?? "POST_UPLOAD_PHASE_NOT_READY";
      inspected.failureStage = inspected.failureStage ?? "EDITOR_DISCOVERY";
      inspected.missingSignal = inspected.missingSignal ?? "post-upload-editor-controls";
    }
  }
  const markerFields = {
    sanitizedUrl: inspected.sanitizedUrl,
    contentType: inspected.contentType,
    contentTypeReady: inspected.contentTypeReady,
    titleEditor: inspected.titleEditor,
    bodyEditor: inspected.bodyEditor,
    imageUploadControl: inspected.imageUploadControl,
    publishSettingsArea: inspected.publishSettingsArea,
    finalSubmitControl: inspected.finalSubmitControl,
    expectedPhase: "IMAGE_POST_POST_UPLOAD_EDITOR" as const,
    observedPhase,
    postUploadControlsStatus,
    uploadBusy,
    previewReady,
    postUploadTerminalStateReached: phaseState.terminalStateReached,
    postUploadIntermediateState: phaseState.intermediateState === "NONE" ? null : phaseState.intermediateState,
    postUploadReadinessDurationMs: lastSample?.elapsedMs ?? Math.max(0, Date.now() - startedAt),
    postUploadReadinessSampleCount: inspected.readinessSamples.length,
    nativeFilePickerDetected: nativeFilePickerRecovery.detected,
    nativeFilePickerCancelled: nativeFilePickerRecovery.cancelled,
    nativeFilePickerRecovery: nativeFilePickerRecovery.status,
    nativeFilePickerWindowIdBefore: nativeFilePickerRecovery.pickerWindowIdBefore ?? null,
    nativeFilePickerWindowIdAfter: nativeFilePickerRecovery.pickerWindowIdAfter ?? null,
    nativeFilePickerOpenBefore: nativeFilePickerRecovery.pickerOpenBefore ?? false,
    nativeFilePickerOpenAfter: nativeFilePickerRecovery.pickerOpenAfter ?? null,
    nativeFilePickerCancelActionSent: nativeFilePickerRecovery.cancelActionSent ?? false,
    nativeFilePickerCancelEffectVerified: nativeFilePickerRecovery.cancelEffectVerified ?? false,
    postUploadSemanticNodes: inspected.postUploadSemanticNodes ?? [],
    interactiveTopology: inspected.interactiveTopology ?? emptyInteractiveTopology(),
    mediaPreviewDiagnostics: mediaPreview,
    modalDiagnostics: modal,
    intermediateActionCandidates: inspected.intermediateActionCandidates ?? [],
    requiredValidationSignals: inspected.requiredValidationSignals ?? [],
    forbiddenActionSignalPresent: inspected.forbiddenActionSignalPresent === true
  };
  emit(options, metadata, "POST_UPLOAD_EDITOR_SEMANTIC_INVENTORY_OBSERVED", {
    ...markerFields,
    postUploadSemanticNodes: markerFields.postUploadSemanticNodes
  });
  emit(options, metadata, "POST_UPLOAD_EDITOR_INTERACTIVE_TOPOLOGY_OBSERVED", {
    ...markerFields,
    interactiveTopology: markerFields.interactiveTopology
  });
  emit(options, metadata, "POST_UPLOAD_EDITOR_MEDIA_PREVIEW_OBSERVED", {
    ...markerFields,
    mediaPreviewDiagnostics: markerFields.mediaPreviewDiagnostics
  });
  emit(options, metadata, "POST_UPLOAD_EDITOR_MODAL_STATE_OBSERVED", {
    ...markerFields,
    modalDiagnostics: markerFields.modalDiagnostics,
    intermediateActionCandidates: markerFields.intermediateActionCandidates
  });
  emit(options, metadata, "POST_UPLOAD_EDITOR_PHASE_OBSERVED", {
    ...markerFields,
    phase: observedPhase,
    phaseConfidence: confidence,
    phaseReason: reason,
    failureCode: inspected.failureCode,
    failureStage: inspected.failureStage,
    missingSignal: inspected.missingSignal
  });
  if (phaseState.phase === "IMAGE_POST_POST_UPLOAD_EDITOR") emit(options, metadata, "POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED", markerFields);
  const result: ImagePostUploadEditorInspectionResult = {
    ...inspected,
    expectedPhase: "IMAGE_POST_POST_UPLOAD_EDITOR",
    phase: observedPhase,
    observedPhase,
    confidence,
    reason,
    postUploadControlsStatus,
    terminalStateReached: phaseState.terminalStateReached,
    intermediateState: phaseState.intermediateState,
    postUploadReadinessDurationMs: lastSample?.elapsedMs ?? Math.max(0, Date.now() - startedAt),
    nativeFilePickerDetected: nativeFilePickerRecovery.detected,
    nativeFilePickerCancelled: nativeFilePickerRecovery.cancelled,
    nativeFilePickerRecovery: nativeFilePickerRecovery.status,
    nativeFilePickerWindowIdBefore: nativeFilePickerRecovery.pickerWindowIdBefore ?? null,
    nativeFilePickerWindowIdAfter: nativeFilePickerRecovery.pickerWindowIdAfter ?? null,
    nativeFilePickerOpenBefore: nativeFilePickerRecovery.pickerOpenBefore ?? false,
    nativeFilePickerOpenAfter: nativeFilePickerRecovery.pickerOpenAfter ?? null,
    nativeFilePickerCancelActionSent: nativeFilePickerRecovery.cancelActionSent ?? false,
    nativeFilePickerCancelEffectVerified: nativeFilePickerRecovery.cancelEffectVerified ?? false,
    status: ready ? "READY" : "FAILED"
  };
  if (ready) {
    emit(options, metadata, "POST_UPLOAD_EDITOR_INSPECTION_COMPLETED", {
      ...markerFields,
      status: result.status,
      phase: observedPhase,
      phaseConfidence: confidence,
      phaseReason: reason,
      postUploadTerminalStateReached: result.terminalStateReached,
      postUploadReadinessDurationMs: result.postUploadReadinessDurationMs,
      postUploadReadinessSampleCount: result.readinessSamples.length
    });
  } else {
    emit(options, metadata, "POST_UPLOAD_EDITOR_INSPECTION_FAILED", {
      ...markerFields,
      status: result.status,
      phase: observedPhase,
      phaseConfidence: confidence,
      phaseReason: reason,
      failureCode: result.failureCode,
      failureStage: result.failureStage,
      missingSignal: result.missingSignal
    });
  }
  return result;
}

function phaseReadinessSample(snapshot: ImageEditorPhaseDomSnapshot, sampleIndex: number, startedAt: number): ImageEditorReadinessSample {
  return {
    sampleIndex,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    readyState: snapshot.readyState,
    currentUrl: sanitizeUrl(snapshot.currentUrl),
    shellSignal: snapshot.shellSignal,
    shellFingerprint: snapshot.shellFingerprint,
    titleCandidateCount: snapshot.titleCandidateCount,
    bodyCandidateCount: snapshot.bodyCandidateCount,
    uploadCandidateCount: snapshot.uploadCandidateCount,
    finalSubmitCandidateCount: snapshot.finalSubmitCandidateCount,
    securityVerificationPresent: snapshot.securityVerificationPresent,
    loginPagePresent: snapshot.loginPagePresent,
    ...(snapshot.uploadBusy === undefined ? {} : { uploadBusy: snapshot.uploadBusy }),
    ...(snapshot.previewReady === undefined ? {} : { previewReady: snapshot.previewReady })
  };
}

function phaseDiagnosticFields(snapshot: ImageEditorPhaseDomSnapshot): Pick<ImageEditorDiagnostic, "sanitizedUrl" | "currentUrl" | "readyState" | "securityVerificationPresent" | "loginPagePresent" | "contentType" | "contentTypeReady" | "preUploadSemanticNodes" | "uploadControlRelationships" | "uploadCapabilityStatus" | "uploadCapabilityPresent" | "uploadCapabilityUnique" | "phaseTopology" | "uploadBusy" | "previewReady"> {
  const capability = resolveImageEditorUploadCapability(snapshot.uploadControlRelationships);
  return {
    sanitizedUrl: sanitizeUrl(snapshot.currentUrl),
    currentUrl: sanitizeUrl(snapshot.currentUrl),
    readyState: snapshot.readyState,
    securityVerificationPresent: snapshot.securityVerificationPresent,
    loginPagePresent: snapshot.loginPagePresent,
    contentType: snapshot.contentTypeSignal,
    contentTypeReady: snapshot.contentTypeSignal === "IMAGE_POST",
    preUploadSemanticNodes: snapshot.preUploadSemanticNodes,
    uploadControlRelationships: snapshot.uploadControlRelationships,
    uploadCapabilityStatus: capability.status,
    uploadCapabilityPresent: capability.present,
    uploadCapabilityUnique: capability.uniqueSurface,
    phaseTopology: snapshot.phaseTopology,
    ...(snapshot.uploadBusy === undefined ? {} : { uploadBusy: snapshot.uploadBusy }),
    ...(snapshot.previewReady === undefined ? {} : { previewReady: snapshot.previewReady })
  };
}

function phaseResult(snapshot: ImageEditorPhaseDomSnapshot, classification: ImageEditorPhaseClassification, readinessSamples: readonly ImageEditorReadinessSample[]): ImagePostEditorPhaseInspectionResult {
  const capability = resolveImageEditorUploadCapability(snapshot.uploadControlRelationships);
  return {
    phase: classification.phase,
    confidence: classification.confidence,
    reason: classification.reason,
    readinessSamples,
    contentType: snapshot.contentTypeSignal,
    contentTypeReady: snapshot.contentTypeSignal === "IMAGE_POST",
    preUploadSemanticNodes: snapshot.preUploadSemanticNodes,
    uploadControlRelationships: snapshot.uploadControlRelationships,
    uploadCapabilityStatus: capability.status,
    uploadCapabilityPresent: capability.present,
    uploadCapabilityUnique: capability.uniqueSurface,
    phaseTopology: snapshot.phaseTopology,
    interactiveTopology: snapshot.interactiveTopology,
    mediaPreviewDiagnostics: snapshot.mediaPreviewDiagnostics,
    modalDiagnostics: snapshot.modalDiagnostics,
    intermediateActionCandidates: snapshot.intermediateActionCandidates,
    requiredValidationSignals: snapshot.requiredValidationSignals,
    forbiddenActionSignalPresent: snapshot.forbiddenActionSignalPresent,
    securityVerificationPresent: snapshot.securityVerificationPresent,
    loginPagePresent: snapshot.loginPagePresent,
    tabPresence: snapshot.tabPresence,
    sanitizedUrl: sanitizeUrl(snapshot.currentUrl)
  };
}

export async function inspectImagePostEditorPhase(page: Page, metadata: ImageEditorInspectionMetadata, options: ImageEditorInspectionOptions = {}): Promise<ImagePostEditorPhaseInspectionResult> {
  const requestedWaitMs = options.readinessWindowMs ?? options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const maxWaitMs = Math.max(0, Math.min(MAX_READINESS_WINDOW_MS, requestedWaitMs));
  const probeIntervalMs = Math.max(0, options.readinessSampleIntervalMs ?? options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS);
  const stableSampleCount = Math.max(2, options.stableSampleCount ?? DEFAULT_STABLE_SAMPLE_COUNT);
  const startedAt = Date.now();
  const readinessSamples: ImageEditorReadinessSample[] = [];
  let previousFingerprint = "";
  let stableCount = 0;
  let lastSnapshot = emptyPhaseSnapshot(page.url());
  let lastClassification: ImageEditorPhaseClassification = { phase: "IMAGE_POST_UNKNOWN", confidence: "LOW", reason: "no phase evidence was observed" };
  emit(options, metadata, "IMAGE_EDITOR_INSPECTION_STARTED", { sanitizedUrl: sanitizeUrl(page.url()) });

  while (Date.now() - startedAt <= maxWaitMs) {
    const observed = await readPhaseDomSnapshot(page);
    const shellStable = observed.shellSignal && EDITOR_ROUTE_PATTERN.test(observed.currentUrl) && observed.readyState === "complete";
    if (shellStable && observed.shellFingerprint === previousFingerprint) stableCount += 1;
    else if (shellStable) stableCount = 1;
    else stableCount = 0;
    previousFingerprint = shellStable ? observed.shellFingerprint : "";
    lastSnapshot = {
      ...observed,
      domStable: stableCount >= stableSampleCount,
      phaseTopology: { ...observed.phaseTopology, stable: stableCount >= stableSampleCount }
    };
    const sample = phaseReadinessSample(lastSnapshot, readinessSamples.length, startedAt);
    readinessSamples.push(sample);
    emit(options, metadata, "IMAGE_EDITOR_READINESS_SAMPLE", {
      ...phaseDiagnosticFields(lastSnapshot),
      sampleIndex: sample.sampleIndex,
      elapsedMs: sample.elapsedMs,
      titleCandidateCount: sample.titleCandidateCount,
      bodyCandidateCount: sample.bodyCandidateCount,
      uploadCandidateCount: sample.uploadCandidateCount,
      finalSubmitCandidateCount: sample.finalSubmitCandidateCount
    });
    lastClassification = classifyImagePostEditorPhase({
      shellReady: lastSnapshot.shellSignal && EDITOR_ROUTE_PATTERN.test(lastSnapshot.currentUrl) && lastSnapshot.readyState === "complete",
      contentType: lastSnapshot.contentTypeSignal,
      contentTypeReady: lastSnapshot.contentTypeSignal === "IMAGE_POST",
      loginPagePresent: lastSnapshot.loginPagePresent,
      securityVerificationPresent: lastSnapshot.securityVerificationPresent,
      domStable: lastSnapshot.domStable,
      uploadCapabilityPresent: lastSnapshot.uploadCapabilityPresent,
      uploadCapabilityUnique: lastSnapshot.uploadCapabilityUnique,
      preUploadSemanticSignalPresent: lastSnapshot.preUploadSemanticSignalPresent,
      selectedTab: lastSnapshot.tabPresence.currentSelectedTab,
      titleCandidateCount: lastSnapshot.titleCandidateCount,
      bodyCandidateCount: lastSnapshot.bodyCandidateCount,
      finalSubmitCandidateCount: lastSnapshot.finalSubmitCandidateCount
    });
    const terminalPhase = lastClassification.phase === "IMAGE_POST_PRE_UPLOAD" || lastClassification.phase === "IMAGE_POST_POST_UPLOAD_EDITOR";
    if (lastClassification.phase === "LOGIN" || lastClassification.phase === "SECURITY_VERIFICATION" || terminalPhase) {
      emit(options, metadata, "IMAGE_EDITOR_PHASE_OBSERVED", {
        ...phaseDiagnosticFields(lastSnapshot),
        phase: lastClassification.phase,
        phaseConfidence: lastClassification.confidence,
        phaseReason: lastClassification.reason
      });
      return phaseResult(lastSnapshot, lastClassification, readinessSamples);
    }
    await waitForProbe(page, probeIntervalMs);
  }

  emit(options, metadata, "IMAGE_EDITOR_PHASE_OBSERVED", {
    ...phaseDiagnosticFields(lastSnapshot),
    phase: lastClassification.phase,
    phaseConfidence: lastClassification.confidence,
    phaseReason: lastClassification.reason
  });
  return phaseResult(lastSnapshot, lastClassification, readinessSamples);
}
