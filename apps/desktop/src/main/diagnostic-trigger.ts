import { TASK10S_ARM_RUN, TASK10S_FRESH_COMPLETION_ARM, type Task10sArmRunResult, type Task10sFreshCompletionArmResult } from "./platform-self-test";
import { createHash } from "node:crypto";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic, XiaohongshuContextPageInventory, XiaohongshuCurrentFileInputState, XiaohongshuCurrentPostUploadReconciliation, XiaohongshuCurrentPostUploadTerminalReadiness, XiaohongshuGlobalExactPublishDomRuntimeDiagnostic, XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import { RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN, RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5, XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG, XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG, XHS_TASK10S_COMPLETE_RETAINED_EDITOR_RUN_FLAG, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4_FLAG, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5_FLAG, type Task10sAttempt3DispatchDryRunResult, type Task10sControlledUploadAttemptResult, type Task10sRetainedEditorCompletionResult } from "./task10s-attempt3";
import { RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, XHS_TASK10S_FRESH_PUBLISH_FLOW_FLAG } from "./task10s-fresh-publish-flow";
import type { XhsContextIdentityAttestationResult } from "./xhs-context-identity-attestation";
import type { Task10sFreshPublishFlowResult } from "./task10s-fresh-publish-flow";
import { RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, XHS_TASK10S_PREPARED_EDITOR_RECOVERY_FLAG, XHS_TASK10S_PREPARED_EDITOR_RECOVERY_RUN_FLAG, type Task10sPreparedEditorRecoveryResult } from "./task10s-prepared-editor-recovery";
import type { XhsIdentityPageEnsureServiceResult } from "./xhs-identity";
export { RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN, RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4, RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5, XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG, XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG, XHS_TASK10S_COMPLETE_RETAINED_EDITOR_RUN_FLAG, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4_FLAG, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5_FLAG } from "./task10s-attempt3";
export { RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW, XHS_TASK10S_FRESH_PUBLISH_FLOW_FLAG } from "./task10s-fresh-publish-flow";
export { RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY, XHS_TASK10S_PREPARED_EDITOR_RECOVERY_FLAG, XHS_TASK10S_PREPARED_EDITOR_RECOVERY_RUN_FLAG } from "./task10s-prepared-editor-recovery";
export { RUN_XHS_TASK10S_ARM_RUN, TASK10S_ARM_RUN } from "./platform-self-test";

export const XHS_TASK10S_ENSURE_IDENTITY_PAGE_FLAG = "--xhs-task10s-ensure-identity-page" as const;
export const RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE = "RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE" as const;

export const XHS_CANONICAL_PAGE_PROBE_FLAG = "--probe-xhs-canonical-page" as const;
export const PROBE_XHS_CANONICAL_PAGE = "PROBE_XHS_CANONICAL_PAGE" as const;
export const XHS_CONTEXT_PAGE_INVENTORY_FLAG = "--inspect-xhs-context-pages" as const;
export const INSPECT_XHS_CONTEXT_PAGES = "INSPECT_XHS_CONTEXT_PAGES" as const;
export const XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG = "--inspect-xhs-publish-entry-dom" as const;
export const INSPECT_XHS_PUBLISH_ENTRY_DOM = "INSPECT_XHS_PUBLISH_ENTRY_DOM" as const;
export const XHS_POST_UPLOAD_RECONCILIATION_FLAG = "--probe-xhs-post-upload-state" as const;
export const INSPECT_XHS_POST_UPLOAD_RECONCILIATION = "INSPECT_XHS_POST_UPLOAD_RECONCILIATION" as const;
export const XHS_POST_UPLOAD_TERMINAL_READINESS_FLAG = "--xhs-task10s-post-upload-terminal-readiness" as const;
export const INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS = "INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS" as const;
export const XHS_FILE_INPUT_STATE_FLAG = "--probe-xhs-file-input-state" as const;
export const INSPECT_XHS_FILE_INPUT_STATE = "INSPECT_XHS_FILE_INPUT_STATE" as const;
export const XHS_FINAL_SUBMIT_DOM_DIAGNOSTIC_FLAG = "--xhs-task10s-final-submit-dom-diagnostic" as const;
export const INSPECT_XHS_FINAL_SUBMIT_DOM = "INSPECT_XHS_FINAL_SUBMIT_DOM" as const;
export const XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG = "--xhs-task10s-global-exact-publish-dom-diagnostic" as const;
export const INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM = "INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM" as const;
export const XHS_CLOSED_SHADOW_FINAL_SUBMIT_DIAGNOSTIC_FLAG = "--xhs-task10s-closed-shadow-final-submit-diagnostic" as const;
export const INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT = "INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT" as const;
export const XHS_CONTEXT_IDENTITY_ATTESTATION_FLAG = "--xhs-task10s-establish-context-identity-attestation" as const;
export const ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION = "ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION" as const;

export const XHS_TASK10S_ARM_FRESH_COMPLETION_FLAG = "--xhs-task10s-arm-fresh-completion" as const;
export const XHS_TASK10S_ARM_RUN_FLAG = "--xhs-task10s-arm-run" as const;
export const XHS_TASK10S_FRESH_RUN_FLAG = "--xhs-task10s-fresh-run" as const;
export type DiagnosticAction = typeof TASK10S_ARM_RUN | typeof TASK10S_FRESH_COMPLETION_ARM | typeof RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY | typeof RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE | typeof PROBE_XHS_CANONICAL_PAGE | typeof INSPECT_XHS_CONTEXT_PAGES | typeof INSPECT_XHS_PUBLISH_ENTRY_DOM | typeof INSPECT_XHS_POST_UPLOAD_RECONCILIATION | typeof INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS | typeof INSPECT_XHS_FILE_INPUT_STATE | typeof INSPECT_XHS_FINAL_SUBMIT_DOM | typeof INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM | typeof INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT | typeof ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION | typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3 | typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4 | typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5 | typeof RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN | typeof RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR | typeof RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW;

function actionForValue(value: unknown): DiagnosticAction | null {
  if (value === TASK10S_ARM_RUN) return TASK10S_ARM_RUN;
  if (value === TASK10S_FRESH_COMPLETION_ARM) return TASK10S_FRESH_COMPLETION_ARM;
  if (value === RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY) return RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY;
  if (value === RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE) return RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE;
  if (value === PROBE_XHS_CANONICAL_PAGE) return PROBE_XHS_CANONICAL_PAGE;
  if (value === INSPECT_XHS_CONTEXT_PAGES) return INSPECT_XHS_CONTEXT_PAGES;
  if (value === INSPECT_XHS_PUBLISH_ENTRY_DOM) return INSPECT_XHS_PUBLISH_ENTRY_DOM;
  if (value === INSPECT_XHS_POST_UPLOAD_RECONCILIATION) return INSPECT_XHS_POST_UPLOAD_RECONCILIATION;
  if (value === INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS) return INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS;
  if (value === INSPECT_XHS_FILE_INPUT_STATE) return INSPECT_XHS_FILE_INPUT_STATE;
  if (value === INSPECT_XHS_FINAL_SUBMIT_DOM) return INSPECT_XHS_FINAL_SUBMIT_DOM;
  if (value === INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM) return INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM;
  if (value === INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT) return INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT;
  if (value === ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION) return ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION;
  if (value === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3) return RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3;
  if (value === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4) return RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4;
  if (value === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5) return RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5;
  if (value === RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN) return RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN;
  if (value === RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR) return RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR;
  if (value === RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW) return RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW;
  return null;
}

function actionForFlag(value: string | undefined): DiagnosticAction | null {
  if (value === XHS_TASK10S_ARM_RUN_FLAG) return TASK10S_ARM_RUN;
  if (value === XHS_TASK10S_ARM_FRESH_COMPLETION_FLAG) return TASK10S_FRESH_COMPLETION_ARM;
  if (value === XHS_TASK10S_PREPARED_EDITOR_RECOVERY_FLAG) return RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY;
  if (value === XHS_TASK10S_ENSURE_IDENTITY_PAGE_FLAG) return RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE;
  if (value === XHS_CANONICAL_PAGE_PROBE_FLAG) return PROBE_XHS_CANONICAL_PAGE;
  if (value === XHS_CONTEXT_PAGE_INVENTORY_FLAG) return INSPECT_XHS_CONTEXT_PAGES;
  if (value === XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG) return INSPECT_XHS_PUBLISH_ENTRY_DOM;
  if (value === XHS_POST_UPLOAD_RECONCILIATION_FLAG) return INSPECT_XHS_POST_UPLOAD_RECONCILIATION;
  if (value === XHS_POST_UPLOAD_TERMINAL_READINESS_FLAG) return INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS;
  if (value === XHS_FILE_INPUT_STATE_FLAG) return INSPECT_XHS_FILE_INPUT_STATE;
  if (value === XHS_FINAL_SUBMIT_DOM_DIAGNOSTIC_FLAG) return INSPECT_XHS_FINAL_SUBMIT_DOM;
  if (value === XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG) return INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM;
  if (value === XHS_CLOSED_SHADOW_FINAL_SUBMIT_DIAGNOSTIC_FLAG) return INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT;
  if (value === XHS_CONTEXT_IDENTITY_ATTESTATION_FLAG) return ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION;
  if (value === XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG) return RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3;
  if (value === XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4_FLAG) return RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4;
  if (value === XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5_FLAG) return RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5;
  if (value === XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG) return RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN;
  if (value === XHS_TASK10S_COMPLETE_RETAINED_EDITOR_FLAG) return RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR;
  if (value === XHS_TASK10S_FRESH_PUBLISH_FLOW_FLAG) return RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW;
  if (value === XHS_TASK10S_FRESH_RUN_FLAG) return RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW;
  return null;
}

function isKnownElectronLauncherPositional(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  const workingDirectory = process.cwd().replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
  return normalized.endsWith("/app.asar")
    || normalized.endsWith("/apps/desktop")
    || normalized.endsWith("/apps/desktop/src/main/main.ts")
    || normalized.endsWith("/apps/desktop/src/main/main.js")
    || normalized.endsWith("/out/main/main.js")
    || normalized === workingDirectory;
}

export function normalizeSecondInstanceArgv(commandLine: readonly string[]): readonly string[] {
  return normalizationTrace(commandLine).normalizedArgs;
}

const ALLOW_FILE_ACCESS_FROM_FILES_OPTION = "--allow-file-access-from-files" as const;
const ORIGINAL_PROCESS_START_TIME_PREFIX = "--original-process-start-time=" as const;

type SafeArgvTokenKind = "EXECUTABLE" | "APP_ASAR" | "KNOWN_FIXED_ACTION" | "KNOWN_ELECTRON_LAUNCHER_OPTION" | "KNOWN_DEV_ENTRY" | "UNKNOWN_OPTION" | "UNKNOWN_POSITIONAL";

export interface SafeArgvToken {
  index: number;
  kind: SafeArgvTokenKind;
  length: number;
  startsWithDash: boolean;
  basenameSafe?: string;
  exactKnownAction?: string;
  knownLauncherOption?: "ALLOW_FILE_ACCESS_FROM_FILES";
}

export interface Task10sAttempt3DispatchTrace {
  secondInstanceEventReceived: "YES";
  activeMainPid: number;
  timestamp: string;
  argvCount: number;
  rawArgvSafe: readonly SafeArgvToken[];
  normalizedArgvSafe: readonly SafeArgvToken[];
  removedLauncherArgumentsSafe: readonly SafeArgvToken[];
  businessArgvSafe: readonly SafeArgvToken[];
  expectedDryRunActionPresentRaw: "YES" | "NO";
  expectedDryRunActionPresentNormalized: "YES" | "NO";
  actionParseEntered: "YES" | "NO";
  actionParseResult: "DRY_RUN_ATTEMPT3" | "READONLY_PROBE" | "FIXED_ACTION" | "NONE" | "REJECTED";
  actionParseRejectionCode: string | null;
  dispatchEntered: "YES" | "NO";
  dispatchSelectedAction: "DRY_RUN_ATTEMPT3" | null;
  dryRunHandlerReached: "YES" | "NO";
  dispatchFailureStage: string | null;
  unknownOptionLength: number | null;
  unknownOptionSha256: string | null;
  unknownOptionSafeClass: "NONE" | "UNKNOWN_OPTION" | "MULTIPLE_UNKNOWN_OPTIONS" | "EXACT_ALLOW_FILE_ACCESS_FROM_FILES_CANDIDATE" | "ORIGINAL_PROCESS_START_TIME_PREFIX_CANDIDATE";
  unknownOptionMatchesAllowFileAccessFromFiles: "YES" | "NO";
  unknownOptionMatchesOriginalProcessStartTimePrefix: "YES" | "NO";
  unknownOptionMatchesOtherProvenLauncherFlag: "YES" | "NO";
  sideEffectCounts: Task10sAttempt3DispatchDryRunResult["sideEffectCounts"];
}

export interface FixedDiagnosticInvocationContext {
  dispatchTrace?: Task10sAttempt3DispatchTrace;
  testRunId?: string;
}

function safeBasename(value: string): string | undefined {
  if (!/[\\/]/u.test(value)) return undefined;
  const basename = value.split(/[\\/]/u).pop() ?? "";
  return basename.length <= 80 ? basename : `${basename.slice(0, 77)}...`;
}

function safeArgvToken(value: string, index: number): SafeArgvToken {
  const action = actionForFlag(value);
  const launcherOption = knownElectronLauncherOption(value);
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  const kind: SafeArgvTokenKind = index === 0
    ? "EXECUTABLE"
    : action
      ? "KNOWN_FIXED_ACTION"
      : launcherOption
        ? "KNOWN_ELECTRON_LAUNCHER_OPTION"
      : normalized.endsWith("/app.asar")
        ? "APP_ASAR"
        : isKnownElectronLauncherPositional(value)
          ? "KNOWN_DEV_ENTRY"
          : value.startsWith("-")
            ? "UNKNOWN_OPTION"
            : "UNKNOWN_POSITIONAL";
  const token: SafeArgvToken = { index, kind, length: value.length, startsWithDash: value.startsWith("-") };
  const basename = index === 0 && !/[\\/]/u.test(value) && value.length <= 80 ? value : safeBasename(value);
  if (basename) token.basenameSafe = basename;
  if (action) token.exactKnownAction = value;
  if (launcherOption) token.knownLauncherOption = launcherOption;
  return token;
}

function safeArgvTokens(values: readonly string[], indexOffset: number): readonly SafeArgvToken[] {
  return values.map((value, index) => safeArgvToken(value, index + indexOffset));
}

function knownElectronLauncherOption(value: string): "ALLOW_FILE_ACCESS_FROM_FILES" | null {
  return value === ALLOW_FILE_ACCESS_FROM_FILES_OPTION ? "ALLOW_FILE_ACCESS_FROM_FILES" : null;
}

function unknownOptionDiagnostics(values: readonly string[]): Pick<Task10sAttempt3DispatchTrace, "unknownOptionLength" | "unknownOptionSha256" | "unknownOptionSafeClass" | "unknownOptionMatchesAllowFileAccessFromFiles" | "unknownOptionMatchesOriginalProcessStartTimePrefix" | "unknownOptionMatchesOtherProvenLauncherFlag"> {
  const unknownOptions = values.filter((value) => value.startsWith("-") && !actionForFlag(value));
  const matchesAllowFileAccess = unknownOptions.some((value) => value === ALLOW_FILE_ACCESS_FROM_FILES_OPTION);
  const matchesOriginalProcessStartTime = unknownOptions.some((value) => value.startsWith(ORIGINAL_PROCESS_START_TIME_PREFIX));
  const safeClass = unknownOptions.length === 0
    ? "NONE"
    : unknownOptions.length > 1
      ? "MULTIPLE_UNKNOWN_OPTIONS"
      : matchesAllowFileAccess
        ? "EXACT_ALLOW_FILE_ACCESS_FROM_FILES_CANDIDATE"
        : matchesOriginalProcessStartTime
          ? "ORIGINAL_PROCESS_START_TIME_PREFIX_CANDIDATE"
          : "UNKNOWN_OPTION";
  const singleUnknownOption = unknownOptions.length === 1 ? unknownOptions[0] : undefined;
  return {
    unknownOptionLength: singleUnknownOption?.length ?? null,
    unknownOptionSha256: singleUnknownOption ? createHash("sha256").update(singleUnknownOption, "utf8").digest("hex").toUpperCase() : null,
    unknownOptionSafeClass: safeClass,
    unknownOptionMatchesAllowFileAccessFromFiles: matchesAllowFileAccess ? "YES" : "NO",
    unknownOptionMatchesOriginalProcessStartTimePrefix: matchesOriginalProcessStartTime ? "YES" : "NO",
    unknownOptionMatchesOtherProvenLauncherFlag: "NO"
  };
}

function normalizationTrace(commandLine: readonly string[]): { normalizedArgs: readonly string[]; removedArgs: readonly string[] } {
  const args = commandLine.slice(1);
  const removedArgs: string[] = [];
  const launcherArgs = isKnownElectronLauncherPositional(args[0]) ? args.slice(1) : args;
  if (launcherArgs.length !== args.length && args[0]) removedArgs.push(args[0]);
  const normalizedArgs = launcherArgs.filter((value) => {
    if (!knownElectronLauncherOption(value)) return true;
    removedArgs.push(value);
    return false;
  });
  return { normalizedArgs, removedArgs };
}

export function buildSecondInstanceDispatchTrace(commandLine: readonly string[], activeMainPid: number, timestamp = new Date().toISOString()): Task10sAttempt3DispatchTrace {
  const normalization = normalizationTrace(commandLine);
  const normalizedArgs = normalization.normalizedArgs;
  const dryRunAction = XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN_FLAG;
  const unknownOptions = unknownOptionDiagnostics(commandLine.slice(1));
  return {
    secondInstanceEventReceived: "YES",
    activeMainPid,
    timestamp,
    argvCount: commandLine.length,
    rawArgvSafe: safeArgvTokens(commandLine, 0),
    normalizedArgvSafe: safeArgvTokens(normalizedArgs, 1),
    removedLauncherArgumentsSafe: safeArgvTokens(normalization.removedArgs, 1),
    businessArgvSafe: safeArgvTokens(normalizedArgs, 1),
    expectedDryRunActionPresentRaw: commandLine.some((value) => value === dryRunAction) ? "YES" : "NO",
    expectedDryRunActionPresentNormalized: normalizedArgs.some((value) => value === dryRunAction) ? "YES" : "NO",
    actionParseEntered: "NO",
    actionParseResult: "NONE",
    actionParseRejectionCode: null,
    dispatchEntered: "NO",
    dispatchSelectedAction: null,
    dryRunHandlerReached: "NO",
    dispatchFailureStage: null,
    ...unknownOptions,
    sideEffectCounts: { pageCreated: 0, contextCreated: 0, imagePostEntryClick: 0, uploadImages: 0, setInputFiles: 0, titleFill: 0, bodyFill: 0, finalSubmit: 0, publicationTransaction: 0, newAuthorization: 0 }
  };
}

function parseFixedAdditionalData(additionalData: unknown): DiagnosticAction | null {
  if (!additionalData || typeof additionalData !== "object" || Array.isArray(additionalData)) return null;
  const entries = Object.entries(additionalData);
  if (entries.length !== 1 || entries[0]?.[0] !== "action") return null;
  return actionForValue(entries[0][1]);
}

interface DiagnosticActionParseResult {
  action: DiagnosticAction | null;
  rejectionCode: string | null;
  testRunId: string | null;
}

export interface Task10sDiagnosticCommandParseResult {
  action: DiagnosticAction | null;
  testRunId: string | null;
  rejectionCode: string | null;
}

interface ParameterizedDiagnosticFlag {
  flag: string;
  action: DiagnosticAction;
}

const PARAMETERIZED_DIAGNOSTIC_FLAGS: readonly ParameterizedDiagnosticFlag[] = [
  { flag: XHS_TASK10S_ARM_RUN_FLAG, action: TASK10S_ARM_RUN },
  { flag: XHS_TASK10S_FRESH_RUN_FLAG, action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW },
  { flag: XHS_TASK10S_PREPARED_EDITOR_RECOVERY_RUN_FLAG, action: RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY },
  { flag: XHS_TASK10S_COMPLETE_RETAINED_EDITOR_RUN_FLAG, action: RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR }
];

function exactFlagMatches(commandLine: readonly string[], flag: string): number[] {
  const matches: number[] = [];
  for (let index = 0; index < commandLine.length; index += 1) {
    if (commandLine[index] === flag) matches.push(index);
  }
  return matches;
}

const TASK10S_RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isTask10sRunId(value: string): boolean {
  return TASK10S_RUN_ID_PATTERN.test(value);
}

function isTask10sLauncherArgument(value: string): boolean {
  return value.startsWith("-") || isKnownElectronLauncherPositional(value);
}

/**
 * Parses only the parameterized Task10S command routes. The run id is found
 * by UUID shape after the exact action flag so Electron launcher arguments can
 * be interleaved without changing the route. No fallback run is consulted.
 */
export function parseTask10sCommand(commandLine: readonly string[]): Task10sDiagnosticCommandParseResult {
  const matches = PARAMETERIZED_DIAGNOSTIC_FLAGS.flatMap((spec) => exactFlagMatches(commandLine, spec.flag).map((index) => ({ ...spec, index })));
  if (matches.length === 0) return { action: null, rejectionCode: null, testRunId: null };
  if (matches.length > 1) return { action: null, rejectionCode: "TASK10S_MULTIPLE_ACTIONS", testRunId: null };

  const match = matches[0];
  const trailingArguments = commandLine.slice(match.index + 1).map((value) => value.trim()).filter((value) => value.length > 0);
  const runIdCandidates = trailingArguments.filter(isTask10sRunId);
  if (runIdCandidates.length > 1) return { action: null, rejectionCode: "TASK10S_INVALID_RUN_ID", testRunId: null };
  if (runIdCandidates.length === 1) {
    const runId = runIdCandidates[0];
    const precedingNonLauncherArgument = trailingArguments
      .slice(0, trailingArguments.indexOf(runId))
      .some((value) => !isTask10sLauncherArgument(value));
    if (precedingNonLauncherArgument) return { action: null, rejectionCode: "TASK10S_INVALID_RUN_ID", testRunId: null };
    return { action: match.action, rejectionCode: null, testRunId: runId };
  }

  const nonLauncherArgument = trailingArguments.some((value) => !isTask10sLauncherArgument(value));
  return {
    action: null,
    rejectionCode: nonLauncherArgument ? "TASK10S_INVALID_RUN_ID" : "TASK10S_TEST_RUN_ID_REQUIRED",
    testRunId: null
  };
}

function parseParameterizedDiagnosticCommand(commandLine: readonly string[], _additionalData?: unknown): DiagnosticActionParseResult | null {
  const parsed = parseTask10sCommand(commandLine);
  if (parsed.action || parsed.rejectionCode) return parsed;
  return null;
}

export function parseTask10sDiagnosticCommand(commandLine: readonly string[], additionalData?: unknown): Task10sDiagnosticCommandParseResult {
  const parameterized = parseParameterizedDiagnosticCommand(commandLine, additionalData);
  if (parameterized) return parameterized;

  const args = normalizeSecondInstanceArgv(commandLine);
  const cliAction = args.length === 1 ? actionForFlag(args[0]) : null;
  if (additionalData !== undefined && additionalData !== null) {
    const additionalAction = parseFixedAdditionalData(additionalData);
    if (!additionalAction) return { action: null, rejectionCode: "INVALID_ADDITIONAL_DATA", testRunId: null };
    if (additionalAction === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3 || additionalAction === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4 || additionalAction === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5 || additionalAction === RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN) {
      return args.length === 0 || cliAction === additionalAction
        ? { action: additionalAction, rejectionCode: null, testRunId: null }
        : { action: null, rejectionCode: "UNKNOWN_OR_EXTRA_ARGUMENT", testRunId: null };
    }
    return { action: additionalAction, rejectionCode: null, testRunId: null };
  }
  if (cliAction) return { action: cliAction, rejectionCode: null, testRunId: null };
  return { action: null, rejectionCode: args.length === 0 ? "NO_FIXED_ACTION" : "UNKNOWN_OR_EXTRA_ARGUMENT", testRunId: null };
}

function parseDiagnosticActionInternal(commandLine: readonly string[], additionalData?: unknown): DiagnosticActionParseResult {
  return parseTask10sDiagnosticCommand(commandLine, additionalData);
}

function actionParseResult(action: DiagnosticAction | null, args: readonly string[]): Task10sAttempt3DispatchTrace["actionParseResult"] {
  if (!action) return args.length === 0 ? "NONE" : "REJECTED";
  if (action === RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN) return "DRY_RUN_ATTEMPT3";
  if (action === PROBE_XHS_CANONICAL_PAGE) return "READONLY_PROBE";
  return "FIXED_ACTION";
}

export function parseDiagnosticActionWithTrace(commandLine: readonly string[], additionalData?: unknown): { action: DiagnosticAction | null; testRunId: string | null; trace: Task10sAttempt3DispatchTrace } {
  const baseTrace = buildSecondInstanceDispatchTrace(commandLine, process.pid);
  const parsed = parseDiagnosticActionInternal(commandLine, additionalData);
  const normalizedArgs = normalizeSecondInstanceArgv(commandLine);
  return {
    action: parsed.action,
    testRunId: parsed.testRunId,
    trace: {
      ...baseTrace,
      actionParseEntered: "YES",
      actionParseResult: actionParseResult(parsed.action, normalizedArgs),
      actionParseRejectionCode: parsed.rejectionCode,
      dispatchFailureStage: parsed.action ? null : parsed.rejectionCode === "NO_FIXED_ACTION" ? "NO_ACTION" : "ACTION_PARSE_REJECTED"
    }
  };
}

export function parseDiagnosticAction(commandLine: readonly string[], additionalData?: unknown): DiagnosticAction | null {
  return parseDiagnosticActionInternal(commandLine, additionalData).action;
}

export function createFixedDiagnosticRunner(options: {
  probe: () => Promise<XiaohongshuCanonicalPageRuntimeProbe>;
  writeEvidence: (probe: XiaohongshuCanonicalPageRuntimeProbe) => void;
  inspectContextPages?: () => Promise<XiaohongshuContextPageInventory>;
  writeContextPageEvidence?: (inventory: XiaohongshuContextPageInventory) => void;
  inspectPublishEntryDom?: () => Promise<XiaohongshuPublishEntryDomRuntimeDiagnostic>;
  writePublishEntryDomEvidence?: (diagnostic: XiaohongshuPublishEntryDomRuntimeDiagnostic) => void;
  inspectPostUploadReconciliation?: () => Promise<XiaohongshuCurrentPostUploadReconciliation>;
  writePostUploadReconciliationEvidence?: (diagnostic: XiaohongshuCurrentPostUploadReconciliation) => void;
  inspectPostUploadTerminalReadiness?: () => Promise<XiaohongshuCurrentPostUploadTerminalReadiness>;
  writePostUploadTerminalReadinessEvidence?: (diagnostic: XiaohongshuCurrentPostUploadTerminalReadiness) => void;
  inspectFileInputState?: () => Promise<XiaohongshuCurrentFileInputState>;
  writeFileInputEvidence?: (diagnostic: XiaohongshuCurrentFileInputState) => void;
  inspectFinalSubmitDom?: () => Promise<XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic>;
  writeFinalSubmitDomEvidence?: (diagnostic: XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic) => void;
  inspectGlobalExactPublishDom?: () => Promise<XiaohongshuGlobalExactPublishDomRuntimeDiagnostic>;
  writeGlobalExactPublishDomEvidence?: (diagnostic: XiaohongshuGlobalExactPublishDomRuntimeDiagnostic) => void;
  inspectClosedShadowFinalSubmit?: () => Promise<XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic>;
  writeClosedShadowFinalSubmitEvidence?: (diagnostic: XiaohongshuClosedShadowFinalSubmitRuntimeDiagnostic) => void;
  establishXhsContextIdentityAttestation?: () => Promise<XhsContextIdentityAttestationResult>;
  writeXhsContextIdentityAttestationEvidence?: (result: XhsContextIdentityAttestationResult) => void;
  runTask10sControlledUploadAttempt3?: () => Promise<Task10sControlledUploadAttemptResult>;
  writeTask10sControlledUploadAttempt3Evidence?: (result: Task10sControlledUploadAttemptResult) => void;
  runTask10sControlledUploadAttempt4?: () => Promise<Task10sControlledUploadAttemptResult>;
  writeTask10sControlledUploadAttempt4Evidence?: (result: Task10sControlledUploadAttemptResult) => void;
  runTask10sControlledUploadAttempt5?: () => Promise<Task10sControlledUploadAttemptResult>;
  writeTask10sControlledUploadAttempt5Evidence?: (result: Task10sControlledUploadAttemptResult) => void;
  runTask10sAttempt3DispatchDryRun?: () => Promise<Task10sAttempt3DispatchDryRunResult>;
  writeTask10sAttempt3DispatchDryRunEvidence?: (trace: Task10sAttempt3DispatchTrace) => void;
  runTask10sCompleteRetainedEditor?: (testRunId?: string) => Promise<Task10sRetainedEditorCompletionResult>;
  armTask10sRun?: (testRunId: string) => Promise<Task10sArmRunResult>;
  writeTask10sArmRunEvidence?: (result: Task10sArmRunResult) => void;
  writeTask10sCompleteRetainedEditorEvidence?: (result: Task10sRetainedEditorCompletionResult) => void;
  armTask10sFreshCompletion?: () => Promise<Task10sFreshCompletionArmResult>;
  writeTask10sFreshCompletionArmEvidence?: (result: Task10sFreshCompletionArmResult) => void;
  runTask10sFreshPublishFlow?: (testRunId?: string) => Promise<Task10sFreshPublishFlowResult>;
  writeTask10sFreshPublishFlowEvidence?: (result: Task10sFreshPublishFlowResult) => void;
  recoverTask10sPreparedEditor?: (testRunId?: string) => Promise<Task10sPreparedEditorRecoveryResult>;
  writeTask10sPreparedEditorRecoveryEvidence?: (result: Task10sPreparedEditorRecoveryResult) => void;
  ensureXhsIdentityPage?: () => Promise<XhsIdentityPageEnsureServiceResult>;
  writeXhsIdentityPageEnsureEvidence?: (result: XhsIdentityPageEnsureServiceResult) => void;
}): (action: DiagnosticAction, context?: FixedDiagnosticInvocationContext) => Promise<boolean> {
  return async (action: DiagnosticAction, context?: FixedDiagnosticInvocationContext): Promise<boolean> => {
    if (action === PROBE_XHS_CANONICAL_PAGE) {
      const probe = await options.probe();
      options.writeEvidence(probe);
      return true;
    }
    if (action === INSPECT_XHS_CONTEXT_PAGES && options.inspectContextPages && options.writeContextPageEvidence) {
      const inventory = await options.inspectContextPages();
      options.writeContextPageEvidence(inventory);
      return true;
    }
    if (action === INSPECT_XHS_PUBLISH_ENTRY_DOM && options.inspectPublishEntryDom && options.writePublishEntryDomEvidence) {
      const diagnostic = await options.inspectPublishEntryDom();
      options.writePublishEntryDomEvidence(diagnostic);
      return true;
    }
    if (action === INSPECT_XHS_POST_UPLOAD_RECONCILIATION && options.inspectPostUploadReconciliation && options.writePostUploadReconciliationEvidence) {
      const diagnostic = await options.inspectPostUploadReconciliation();
      options.writePostUploadReconciliationEvidence(diagnostic);
      return true;
    }
    if (action === INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS && options.inspectPostUploadTerminalReadiness && options.writePostUploadTerminalReadinessEvidence) {
      const diagnostic = await options.inspectPostUploadTerminalReadiness();
      options.writePostUploadTerminalReadinessEvidence(diagnostic);
      return true;
    }
    if (action === INSPECT_XHS_FILE_INPUT_STATE && options.inspectFileInputState && options.writeFileInputEvidence) {
      const diagnostic = await options.inspectFileInputState();
      options.writeFileInputEvidence(diagnostic);
      return true;
    }
    if (action === INSPECT_XHS_FINAL_SUBMIT_DOM && options.inspectFinalSubmitDom && options.writeFinalSubmitDomEvidence) {
      const diagnostic = await options.inspectFinalSubmitDom();
      options.writeFinalSubmitDomEvidence(diagnostic);
      return true;
    }
    if (action === INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM && options.inspectGlobalExactPublishDom && options.writeGlobalExactPublishDomEvidence) {
      const diagnostic = await options.inspectGlobalExactPublishDom();
      options.writeGlobalExactPublishDomEvidence(diagnostic);
      return true;
    }
    if (action === INSPECT_XHS_CLOSED_SHADOW_FINAL_SUBMIT && options.inspectClosedShadowFinalSubmit && options.writeClosedShadowFinalSubmitEvidence) {
      const diagnostic = await options.inspectClosedShadowFinalSubmit();
      options.writeClosedShadowFinalSubmitEvidence(diagnostic);
      return true;
    }
    if (action === ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION && options.establishXhsContextIdentityAttestation && options.writeXhsContextIdentityAttestationEvidence) {
      const result = await options.establishXhsContextIdentityAttestation();
      options.writeXhsContextIdentityAttestationEvidence(result);
      return result.status === "PASS";
    }
    if (action === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3 && options.runTask10sControlledUploadAttempt3 && options.writeTask10sControlledUploadAttempt3Evidence) {
      const result = await options.runTask10sControlledUploadAttempt3();
      options.writeTask10sControlledUploadAttempt3Evidence(result);
      return true;
    }
    if (action === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT4 && options.runTask10sControlledUploadAttempt4 && options.writeTask10sControlledUploadAttempt4Evidence) {
      const result = await options.runTask10sControlledUploadAttempt4();
      options.writeTask10sControlledUploadAttempt4Evidence(result);
      return true;
    }
    if (action === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT5 && options.runTask10sControlledUploadAttempt5 && options.writeTask10sControlledUploadAttempt5Evidence) {
      const result = await options.runTask10sControlledUploadAttempt5();
      options.writeTask10sControlledUploadAttempt5Evidence(result);
      return true;
    }
    if (action === RUN_XHS_TASK10S_ATTEMPT3_DISPATCH_DRY_RUN && options.runTask10sAttempt3DispatchDryRun) {
      const result = await options.runTask10sAttempt3DispatchDryRun();
      if (context?.dispatchTrace && options.writeTask10sAttempt3DispatchDryRunEvidence) {
        options.writeTask10sAttempt3DispatchDryRunEvidence({
          ...context.dispatchTrace,
          dispatchEntered: "YES",
          dispatchSelectedAction: "DRY_RUN_ATTEMPT3",
          dryRunHandlerReached: "YES",
          sideEffectCounts: result.sideEffectCounts
        });
      }
      return result.status === "PASS";
    }
    if (action === RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR && options.runTask10sCompleteRetainedEditor && options.writeTask10sCompleteRetainedEditorEvidence) {
      const result = await options.runTask10sCompleteRetainedEditor(context?.testRunId);
      options.writeTask10sCompleteRetainedEditorEvidence(result);
      return result.status === "PASS";
    }
    if (action === TASK10S_ARM_RUN && options.armTask10sRun && options.writeTask10sArmRunEvidence && context?.testRunId) {
      const result = await options.armTask10sRun(context.testRunId);
      options.writeTask10sArmRunEvidence(result);
      return result.status === "PASS";
    }
    if (action === TASK10S_FRESH_COMPLETION_ARM && options.armTask10sFreshCompletion && options.writeTask10sFreshCompletionArmEvidence) {
      const result = await options.armTask10sFreshCompletion();
      options.writeTask10sFreshCompletionArmEvidence(result);
      return result.status === "PASS";
    }
    if (action === RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW && options.runTask10sFreshPublishFlow && options.writeTask10sFreshPublishFlowEvidence) {
      const result = await options.runTask10sFreshPublishFlow(context?.testRunId);
      options.writeTask10sFreshPublishFlowEvidence(result);
      return result.status === "PASS_READY_FOR_FINAL_SUBMIT" && result.readyForFinalSubmit;
    }
    if (action === RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY && options.recoverTask10sPreparedEditor && options.writeTask10sPreparedEditorRecoveryEvidence) {
      const result = await options.recoverTask10sPreparedEditor(context?.testRunId);
      options.writeTask10sPreparedEditorRecoveryEvidence(result);
      return result.status === "PASS" && result.readyForFreshIdentityAttestation;
    }
    if (action === RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE && options.ensureXhsIdentityPage && options.writeXhsIdentityPageEnsureEvidence) {
      const result = await options.ensureXhsIdentityPage();
      options.writeXhsIdentityPageEnsureEvidence(result);
      return result.status === "PASS" && result.identityPageEnsured && result.identityMatch && result.sameBrowserContext;
    }
    return false;
  };
}
