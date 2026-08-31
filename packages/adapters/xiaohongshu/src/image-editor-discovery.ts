import type { Locator, Page } from "playwright-core";
import type { PreSubmitGateFailureCode, PreSubmitGateFailureStage } from "@publisher/adapters-core";

export type ImageEditorShellStatus = "IMAGE_EDITOR_SHELL_READY" | "IMAGE_EDITOR_SHELL_NOT_READY" | "IMAGE_EDITOR_SHELL_TIMEOUT";
export type ImageEditorInspectionStatus = "READY" | "FAILED";
export type ImageEditorContentType = "IMAGE_POST" | "VIDEO" | "UNKNOWN";
export type ImageEditorControlStatus = "FOUND_UNIQUE" | "NOT_FOUND" | "AMBIGUOUS" | "NOT_VISIBLE" | "DISABLED";
export type ImageEditorSettingsStatus = ImageEditorControlStatus | "NOT_APPLICABLE";
export type ImageEditorPhase = "IMAGE_POST_PRE_UPLOAD" | "IMAGE_POST_POST_UPLOAD_EDITOR" | "IMAGE_POST_TRANSITIONING" | "IMAGE_POST_UNKNOWN" | "LOGIN" | "SECURITY_VERIFICATION";
export type ImageEditorPhaseConfidence = "HIGH" | "LOW";
export type ImageEditorUploadCapabilityStatus = "PRESENT" | "AMBIGUOUS" | "ABSENT";

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
  uploadControlRelationships: readonly ImageEditorUploadControlRelationship[];
  phaseTopology: ImageEditorPhaseTopology;
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
  | "IMAGE_EDITOR_INSPECTION_FAILED";

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
  uploadControlRelationships?: readonly ImageEditorUploadControlRelationship[];
  uploadCapabilityStatus?: ImageEditorUploadCapabilityStatus;
  uploadCapabilityPresent?: boolean;
  uploadCapabilityUnique?: boolean;
  phaseTopology?: ImageEditorPhaseTopology;
  status?: ImageEditorInspectionStatus;
  failureCode?: PreSubmitGateFailureCode;
  failureStage?: PreSubmitGateFailureStage;
  missingSignal?: string | null;
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
  securityVerificationPresent: boolean;
  loginPagePresent: boolean;
  sanitizedUrl: string;
  failureCode?: PreSubmitGateFailureCode;
  failureStage?: PreSubmitGateFailureStage;
  missingSignal?: string | null;
}

export interface ImageEditorInspectionOptions {
  maxWaitMs?: number;
  probeIntervalMs?: number;
  stableSampleCount?: number;
  emit?: (diagnostic: ImageEditorDiagnostic) => void;
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
  securityVerificationPresent: boolean;
  loginPagePresent: boolean;
  sanitizedUrl: string;
}

const DEFAULT_MAX_WAIT_MS = 3_000;
const DEFAULT_PROBE_INTERVAL_MS = 80;
const DEFAULT_STABLE_SAMPLE_COUNT = 2;
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
    && evidence.titleCandidateCount === 0
    && evidence.bodyCandidateCount === 0
    && evidence.finalSubmitCandidateCount === 0
  ) {
    return { phase: "IMAGE_POST_PRE_UPLOAD", confidence: "HIGH", reason: "unique upload capability and pre-upload semantic signals are present while post-upload controls are absent" };
  }
  return { phase: "IMAGE_POST_UNKNOWN", confidence: "LOW", reason: "phase evidence does not satisfy a strict staged-editor rule" };
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
  if (enabled.length === 1) return { kind, status: "FOUND_UNIQUE", detected: true, candidates };
  if (enabled.length > 1) return { kind, status: "AMBIGUOUS", detected: false, candidates };
  if (candidates.length === 0) return { kind, status: "NOT_FOUND", detected: false, candidates };
  if (visible.length === 0) return { kind, status: "NOT_VISIBLE", detected: false, candidates };
  return { kind, status: "DISABLED", detected: false, candidates };
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
    enabled: record.enabled
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
    finalSubmitCandidates: normalizeCandidates(record.finalSubmitCandidates)
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
    uploadControlRelationships: [],
    phaseTopology: emptyPhaseTopology()
  };
}

function normalizePhaseSnapshot(value: unknown, fallbackUrl: string): ImageEditorPhaseDomSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyPhaseSnapshot(fallbackUrl);
  const record = value as Record<string, unknown>;
  const relationships = normalizeUploadRelationships(record.uploadControlRelationships);
  const uploadCapability = resolveImageEditorUploadCapability(relationships);
  const topology = normalizePhaseTopology(record.phaseTopology);
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
    preUploadSemanticSignalPresent: record.preUploadSemanticSignalPresent === true,
    titleCandidateCount: topology.titleCandidateCount,
    bodyCandidateCount: topology.bodyCandidateCount,
    finalSubmitCandidateCount: topology.finalSubmitCandidateCount,
    preUploadSemanticNodes: normalizeSemanticNodes(record.preUploadSemanticNodes),
    uploadControlRelationships: relationships,
    phaseTopology: topology
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

async function readLocatorCandidates(page: Page, selector: string, semanticSignal: string, filter: (locator: Locator) => Promise<boolean> = async () => true): Promise<readonly ImageEditorControlCandidate[]> {
  const locator = page.locator(selector);
  const candidates: ImageEditorControlCandidate[] = [];
  for (let index = 0; index < await locatorCount(locator); index += 1) {
    const item = locatorAt(locator, index);
    if (!(await filter(item))) continue;
    candidates.push({
      candidateId: (await locatorAttribute(item, "data-testid")) || `${semanticSignal}-${index}`,
      tagName: (await locatorAttribute(item, "tagName")).toUpperCase() || "UNKNOWN",
      role: (await locatorAttribute(item, "role")) || null,
      semanticSignal,
      visible: await locatorVisible(item),
      enabled: await locatorEnabled(item)
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
    finalSubmitCandidates.push({
      candidateId: (await locatorAttribute(item, "data-testid")) || `final-submit-${index}`,
      tagName: (await locatorAttribute(item, "tagName")).toUpperCase() || "BUTTON",
      role: (await locatorAttribute(item, "role")) || null,
      semanticSignal: "final-submit-label",
      visible: await locatorVisible(item),
      enabled: await locatorEnabled(item)
    });
  }
  const contentTypeSignal: ImageEditorContentType = /视频|video/iu.test(bodyText) && uploadCandidates.length === 0 ? "VIDEO" : uploadCandidates.length > 0 || /图文|图片|image/iu.test(bodyText) ? "IMAGE_POST" : "UNKNOWN";
  const shellSignal = EDITOR_ROUTE_PATTERN.test(currentUrl) && !loginPagePresent && !securityVerificationPresent;
  const shellFingerprint = JSON.stringify({ title: titleCandidates.length, body: bodyCandidates.length, upload: uploadCandidates.length, settings: publishSettingsCandidates.length, finalSubmit: finalSubmitCandidates.length });
  return { currentUrl, readyState: "complete", shellSignal, shellFingerprint, contentTypeSignal, securityVerificationPresent, loginPagePresent, titleCandidates, bodyCandidates, uploadCandidates, publishSettingsCandidates, finalSubmitCandidates };
}

async function readSnapshot(page: Page): Promise<ImageEditorDomSnapshot> {
  const fallbackUrl = page.url();
  let raw: unknown = null;
  try {
    raw = await page.evaluate(() => {
    const normalize = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
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
    const candidate = (element: Element, semanticSignal: string, index: number) => ({
      candidateId: element.getAttribute("data-testid")?.trim() || `${semanticSignal}-${index}`,
      tagName: element.tagName.toUpperCase(),
      role: element.getAttribute("role"),
      semanticSignal,
      visible: visible(element),
      enabled: enabled(element)
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
    const semanticControls = Array.from(document.querySelectorAll('[role="tab"], [role="radio"], button, [aria-label], [data-content-type], [data-type]')).map((element) => normalize(`${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("data-content-type") ?? ""} ${element.getAttribute("data-type") ?? ""}`)).join(" ");
    const typedAttributes = Array.from(document.querySelectorAll("[data-content-type], [data-type]")).map((element) => `${element.getAttribute("data-content-type") ?? ""} ${element.getAttribute("data-type") ?? ""}`).join(" ").toLowerCase();
    const hasVideoSignal = /video|视频/iu.test(`${typedAttributes} ${semanticControls}`);
    const hasImageSignal = /image|图文|图片/iu.test(`${typedAttributes} ${semanticControls}`) || uploadCandidates.length > 0;
    const contentTypeSignal = hasVideoSignal && !hasImageSignal ? "VIDEO" : hasImageSignal ? "IMAGE_POST" : "UNKNOWN";
    const loginPagePresent = /\/login(?:[/?#]|$)/iu.test(window.location.href) || Boolean(document.querySelector('[data-testid*="login" i], form[action*="login" i]'));
    const securityVerificationPresent = /security|verify|captcha|验证|验证码/iu.test(`${window.location.pathname} ${semanticControls}`) || Boolean(document.querySelector('[data-testid*="captcha" i], [class*="captcha" i], [aria-label*="安全验证"]'));
    const shellCount = document.querySelectorAll('main, [role="main"], [data-testid*="publish" i], [class*="publish" i], [class*="editor" i]').length;
    const shellSignal = document.readyState === "complete" && document.body.childElementCount > 0 && shellCount > 0 && !loginPagePresent && !securityVerificationPresent;
    const shellFingerprint = JSON.stringify({ shellCount, title: titleCandidates.length, body: bodyCandidates.length, upload: uploadCandidates.length, settings: settingsCandidates.length, finalSubmit: finalSubmitCandidates.length });
    return { currentUrl: window.location.href, readyState: document.readyState, shellSignal, shellFingerprint, contentTypeSignal, securityVerificationPresent, loginPagePresent, titleCandidates, bodyCandidates, uploadCandidates, publishSettingsCandidates: settingsCandidates, finalSubmitCandidates };
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
      const semanticText = (element: Element): string => normalize(`${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${element.getAttribute("data-content-type") ?? ""} ${element.getAttribute("data-type") ?? ""}`).slice(0, 120);
      const signalFor = (value: string): string | null => {
        const text = value.toLowerCase();
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
      const typedAttributes = Array.from(document.querySelectorAll("[data-content-type], [data-type]")).map((element) => `${element.getAttribute("data-content-type") ?? ""} ${element.getAttribute("data-type") ?? ""}`).join(" ");
      const imageSignal = uploadInputs.length > 0 || /image|图文|图片/iu.test(`${typedAttributes} ${semanticControls} ${bodyText}`);
      const videoSignal = /video|视频/iu.test(`${typedAttributes} ${semanticControls} ${bodyText}`);
      const contentTypeSignal: ImageEditorContentType = videoSignal && !imageSignal ? "VIDEO" : imageSignal ? "IMAGE_POST" : "UNKNOWN";
      const loginPagePresent = /\/login(?:[/?#]|$)/iu.test(window.location.href) || /登录/iu.test(bodyText) || Boolean(document.querySelector('[data-testid*="login" i], form[action*="login" i]'));
      const securityVerificationPresent = /security|verify|captcha|安全验证|验证码/iu.test(`${window.location.pathname} ${semanticControls} ${bodyText}`) || Boolean(document.querySelector('[data-testid*="captcha" i], [class*="captcha" i], [aria-label*="安全验证"]'));
      const shellCount = document.querySelectorAll('main, [role="main"], [data-testid*="publish" i], [class*="publish" i], [class*="editor" i]').length;
      const shellSignal = /^https:\/\/creator\.xiaohongshu\.com\/publish\/publish(?:[/?#]|$)/iu.test(window.location.href) && document.readyState === "complete" && document.body !== null && shellCount > 0 && !loginPagePresent && !securityVerificationPresent;
      const semanticSignals = Array.from(new Set(preUploadSemanticNodes.map((node) => signalFor(node.normalizedText)).filter((signal): signal is string => signal !== null))).slice(0, 12);
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
      return {
        currentUrl: window.location.href,
        readyState: document.readyState,
        shellSignal,
        shellFingerprint: JSON.stringify({ shellCount, titleCandidateCount, bodyCandidateCount, uploadCandidateCount, finalSubmitCandidateCount, semanticSignals, capabilityCount: capability.length }),
        contentTypeSignal,
        securityVerificationPresent,
        loginPagePresent,
        domStable: false,
        uploadCapabilityPresent: capability.length === 1,
        uploadCapabilityUnique: capability.length === 1,
        preUploadSemanticSignalPresent: semanticSignals.some((signal) => signal === "upload" || signal === "drag" || signal === "image" || signal === "image-post"),
        titleCandidateCount,
        bodyCandidateCount,
        finalSubmitCandidateCount,
        preUploadSemanticNodes,
        uploadControlRelationships,
        phaseTopology
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
    loginPagePresent: snapshot.loginPagePresent
  };
}

function baseFields(snapshot: ImageEditorDomSnapshot): Omit<ImageEditorDiagnostic, "code" | "timestamp" | "operationId" | "platformKey" | "accountId" | "contextDebugId" | "pageDebugId"> {
  return { sanitizedUrl: sanitizeUrl(snapshot.currentUrl), currentUrl: sanitizeUrl(snapshot.currentUrl), readyState: snapshot.readyState, securityVerificationPresent: snapshot.securityVerificationPresent, loginPagePresent: snapshot.loginPagePresent };
}

export async function inspectImagePostEditor(page: Page, metadata: ImageEditorInspectionMetadata, options: ImageEditorInspectionOptions = {}): Promise<ImagePostEditorInspectionResult> {
  const maxWaitMs = Math.max(0, Math.min(DEFAULT_MAX_WAIT_MS, options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS));
  const probeIntervalMs = Math.max(0, options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS);
  const stableSampleCount = Math.max(2, options.stableSampleCount ?? DEFAULT_STABLE_SAMPLE_COUNT);
  const startedAt = Date.now();
  const readinessSamples: ImageEditorReadinessSample[] = [];
  let previousFingerprint = "";
  let stableCount = 0;
  let lastSnapshot = normalizeSnapshot(null, page.url());
  emit(options, metadata, "IMAGE_EDITOR_INSPECTION_STARTED", { sanitizedUrl: sanitizeUrl(page.url()) });

  while (Date.now() - startedAt <= maxWaitMs) {
    lastSnapshot = await readSnapshot(page);
    const sample = readinessSample(lastSnapshot, readinessSamples.length, startedAt);
    readinessSamples.push(sample);
    emit(options, metadata, "IMAGE_EDITOR_READINESS_SAMPLE", { ...baseFields(lastSnapshot), sampleIndex: sample.sampleIndex, elapsedMs: sample.elapsedMs, titleCandidateCount: sample.titleCandidateCount, bodyCandidateCount: sample.bodyCandidateCount, uploadCandidateCount: sample.uploadCandidateCount, finalSubmitCandidateCount: sample.finalSubmitCandidateCount });
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
    if (lastSnapshot.shellSignal && EDITOR_ROUTE_PATTERN.test(lastSnapshot.currentUrl) && lastSnapshot.readyState === "complete") {
      stableCount = lastSnapshot.shellFingerprint === previousFingerprint ? stableCount + 1 : 1;
      previousFingerprint = lastSnapshot.shellFingerprint;
      if (stableCount >= stableSampleCount) break;
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

  const titleEditor = controlDiscovery("TITLE_EDITOR", lastSnapshot.titleCandidates);
  const bodyEditor = controlDiscovery("BODY_EDITOR", lastSnapshot.bodyCandidates);
  const imageUploadControl = controlDiscovery("IMAGE_UPLOAD_CONTROL", lastSnapshot.uploadCandidates);
  const publishSettingsArea = settingsDiscovery(lastSnapshot.publishSettingsCandidates);
  const finalSubmitControl = controlDiscovery("FINAL_SUBMIT_CONTROL", lastSnapshot.finalSubmitCandidates);
  emit(options, metadata, "IMAGE_EDITOR_CONTROLS_DISCOVERED", { ...baseFields(lastSnapshot), contentType, contentTypeReady, titleEditor, bodyEditor, imageUploadControl, publishSettingsArea, finalSubmitControl });
  const controls = [titleEditor, bodyEditor, imageUploadControl, finalSubmitControl];
  const failedControl = controls.find((control) => control.status !== "FOUND_UNIQUE");
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
  result.finalSubmitControlDetected = finalSubmitControl.detected;
  result.securityVerificationPresent = lastSnapshot.securityVerificationPresent;
  result.loginPagePresent = lastSnapshot.loginPagePresent;
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
    loginPagePresent: snapshot.loginPagePresent
  };
}

function phaseDiagnosticFields(snapshot: ImageEditorPhaseDomSnapshot): Pick<ImageEditorDiagnostic, "sanitizedUrl" | "currentUrl" | "readyState" | "securityVerificationPresent" | "loginPagePresent" | "contentType" | "contentTypeReady" | "preUploadSemanticNodes" | "uploadControlRelationships" | "uploadCapabilityStatus" | "uploadCapabilityPresent" | "uploadCapabilityUnique" | "phaseTopology"> {
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
    phaseTopology: snapshot.phaseTopology
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
    securityVerificationPresent: snapshot.securityVerificationPresent,
    loginPagePresent: snapshot.loginPagePresent,
    sanitizedUrl: sanitizeUrl(snapshot.currentUrl)
  };
}

export async function inspectImagePostEditorPhase(page: Page, metadata: ImageEditorInspectionMetadata, options: ImageEditorInspectionOptions = {}): Promise<ImagePostEditorPhaseInspectionResult> {
  const maxWaitMs = Math.max(0, Math.min(DEFAULT_MAX_WAIT_MS, options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS));
  const probeIntervalMs = Math.max(0, options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS);
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
      titleCandidateCount: lastSnapshot.titleCandidateCount,
      bodyCandidateCount: lastSnapshot.bodyCandidateCount,
      finalSubmitCandidateCount: lastSnapshot.finalSubmitCandidateCount
    });
    if (lastClassification.phase === "LOGIN" || lastClassification.phase === "SECURITY_VERIFICATION" || lastSnapshot.domStable) {
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
