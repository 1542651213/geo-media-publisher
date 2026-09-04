import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuContextPageInventory, XiaohongshuCurrentFileInputState, XiaohongshuCurrentPostUploadReconciliation, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import { RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG, type Task10sControlledUploadAttempt3Result } from "./task10s-attempt3";
export { RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3, XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG } from "./task10s-attempt3";

export const XHS_CANONICAL_PAGE_PROBE_FLAG = "--probe-xhs-canonical-page" as const;
export const PROBE_XHS_CANONICAL_PAGE = "PROBE_XHS_CANONICAL_PAGE" as const;
export const XHS_CONTEXT_PAGE_INVENTORY_FLAG = "--inspect-xhs-context-pages" as const;
export const INSPECT_XHS_CONTEXT_PAGES = "INSPECT_XHS_CONTEXT_PAGES" as const;
export const XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG = "--inspect-xhs-publish-entry-dom" as const;
export const INSPECT_XHS_PUBLISH_ENTRY_DOM = "INSPECT_XHS_PUBLISH_ENTRY_DOM" as const;
export const XHS_POST_UPLOAD_RECONCILIATION_FLAG = "--probe-xhs-post-upload-state" as const;
export const INSPECT_XHS_POST_UPLOAD_RECONCILIATION = "INSPECT_XHS_POST_UPLOAD_RECONCILIATION" as const;
export const XHS_FILE_INPUT_STATE_FLAG = "--probe-xhs-file-input-state" as const;
export const INSPECT_XHS_FILE_INPUT_STATE = "INSPECT_XHS_FILE_INPUT_STATE" as const;

export type DiagnosticAction = typeof PROBE_XHS_CANONICAL_PAGE | typeof INSPECT_XHS_CONTEXT_PAGES | typeof INSPECT_XHS_PUBLISH_ENTRY_DOM | typeof INSPECT_XHS_POST_UPLOAD_RECONCILIATION | typeof INSPECT_XHS_FILE_INPUT_STATE | typeof RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3;

function actionForValue(value: unknown): DiagnosticAction | null {
  if (value === PROBE_XHS_CANONICAL_PAGE) return PROBE_XHS_CANONICAL_PAGE;
  if (value === INSPECT_XHS_CONTEXT_PAGES) return INSPECT_XHS_CONTEXT_PAGES;
  if (value === INSPECT_XHS_PUBLISH_ENTRY_DOM) return INSPECT_XHS_PUBLISH_ENTRY_DOM;
  if (value === INSPECT_XHS_POST_UPLOAD_RECONCILIATION) return INSPECT_XHS_POST_UPLOAD_RECONCILIATION;
  if (value === INSPECT_XHS_FILE_INPUT_STATE) return INSPECT_XHS_FILE_INPUT_STATE;
  if (value === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3) return RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3;
  return null;
}

function actionForFlag(value: string | undefined): DiagnosticAction | null {
  if (value === XHS_CANONICAL_PAGE_PROBE_FLAG) return PROBE_XHS_CANONICAL_PAGE;
  if (value === XHS_CONTEXT_PAGE_INVENTORY_FLAG) return INSPECT_XHS_CONTEXT_PAGES;
  if (value === XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG) return INSPECT_XHS_PUBLISH_ENTRY_DOM;
  if (value === XHS_POST_UPLOAD_RECONCILIATION_FLAG) return INSPECT_XHS_POST_UPLOAD_RECONCILIATION;
  if (value === XHS_FILE_INPUT_STATE_FLAG) return INSPECT_XHS_FILE_INPUT_STATE;
  if (value === XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3_FLAG) return RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3;
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
  const args = commandLine.slice(1);
  return isKnownElectronLauncherPositional(args[0]) ? args.slice(1) : args;
}

function parseFixedAdditionalData(additionalData: unknown): DiagnosticAction | null {
  if (!additionalData || typeof additionalData !== "object" || Array.isArray(additionalData)) return null;
  const entries = Object.entries(additionalData);
  if (entries.length !== 1 || entries[0]?.[0] !== "action") return null;
  return actionForValue(entries[0][1]);
}

export function parseDiagnosticAction(commandLine: readonly string[], additionalData?: unknown): DiagnosticAction | null {
  const args = normalizeSecondInstanceArgv(commandLine);
  const cliAction = args.length === 1 ? actionForFlag(args[0]) : null;
  if (additionalData !== undefined) {
    const additionalAction = parseFixedAdditionalData(additionalData);
    if (!additionalAction) return null;
    if (additionalAction === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3) return args.length === 0 || cliAction === additionalAction ? additionalAction : null;
    return additionalAction;
  }
  return cliAction;
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
  inspectFileInputState?: () => Promise<XiaohongshuCurrentFileInputState>;
  writeFileInputEvidence?: (diagnostic: XiaohongshuCurrentFileInputState) => void;
  runTask10sControlledUploadAttempt3?: () => Promise<Task10sControlledUploadAttempt3Result>;
  writeTask10sControlledUploadAttempt3Evidence?: (result: Task10sControlledUploadAttempt3Result) => void;
}): (action: DiagnosticAction) => Promise<boolean> {
  return async (action: DiagnosticAction): Promise<boolean> => {
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
    if (action === INSPECT_XHS_FILE_INPUT_STATE && options.inspectFileInputState && options.writeFileInputEvidence) {
      const diagnostic = await options.inspectFileInputState();
      options.writeFileInputEvidence(diagnostic);
      return true;
    }
    if (action === RUN_XHS_TASK10S_CONTROLLED_UPLOAD_ATTEMPT3 && options.runTask10sControlledUploadAttempt3 && options.writeTask10sControlledUploadAttempt3Evidence) {
      const result = await options.runTask10sControlledUploadAttempt3();
      options.writeTask10sControlledUploadAttempt3Evidence(result);
      return true;
    }
    return false;
  };
}
