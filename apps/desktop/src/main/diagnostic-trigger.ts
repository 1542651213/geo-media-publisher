import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuContextPageInventory, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";

export const XHS_CANONICAL_PAGE_PROBE_FLAG = "--probe-xhs-canonical-page" as const;
export const PROBE_XHS_CANONICAL_PAGE = "PROBE_XHS_CANONICAL_PAGE" as const;
export const XHS_CONTEXT_PAGE_INVENTORY_FLAG = "--inspect-xhs-context-pages" as const;
export const INSPECT_XHS_CONTEXT_PAGES = "INSPECT_XHS_CONTEXT_PAGES" as const;
export const XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG = "--inspect-xhs-publish-entry-dom" as const;
export const INSPECT_XHS_PUBLISH_ENTRY_DOM = "INSPECT_XHS_PUBLISH_ENTRY_DOM" as const;

export type DiagnosticAction = typeof PROBE_XHS_CANONICAL_PAGE | typeof INSPECT_XHS_CONTEXT_PAGES | typeof INSPECT_XHS_PUBLISH_ENTRY_DOM;

function parseFixedAdditionalData(additionalData: unknown): DiagnosticAction | null {
  if (!additionalData || typeof additionalData !== "object" || Array.isArray(additionalData)) return null;
  const entries = Object.entries(additionalData);
  if (entries.length !== 1 || entries[0]?.[0] !== "action") return null;
  return entries[0][1] === PROBE_XHS_CANONICAL_PAGE ? PROBE_XHS_CANONICAL_PAGE : entries[0][1] === INSPECT_XHS_CONTEXT_PAGES ? INSPECT_XHS_CONTEXT_PAGES : entries[0][1] === INSPECT_XHS_PUBLISH_ENTRY_DOM ? INSPECT_XHS_PUBLISH_ENTRY_DOM : null;
}

export function parseDiagnosticAction(commandLine: readonly string[], additionalData?: unknown): DiagnosticAction | null {
  const args = commandLine.slice(1);
  const cliAction = args.length === 1
    ? args[0] === XHS_CANONICAL_PAGE_PROBE_FLAG
      ? PROBE_XHS_CANONICAL_PAGE
      : args[0] === XHS_CONTEXT_PAGE_INVENTORY_FLAG
        ? INSPECT_XHS_CONTEXT_PAGES
        : args[0] === XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG
          ? INSPECT_XHS_PUBLISH_ENTRY_DOM
        : null
    : null;
  if (additionalData !== undefined) return parseFixedAdditionalData(additionalData);
  return cliAction;
}

export function createFixedDiagnosticRunner(options: {
  probe: () => Promise<XiaohongshuCanonicalPageRuntimeProbe>;
  writeEvidence: (probe: XiaohongshuCanonicalPageRuntimeProbe) => void;
  inspectContextPages?: () => Promise<XiaohongshuContextPageInventory>;
  writeContextPageEvidence?: (inventory: XiaohongshuContextPageInventory) => void;
  inspectPublishEntryDom?: () => Promise<XiaohongshuPublishEntryDomRuntimeDiagnostic>;
  writePublishEntryDomEvidence?: (diagnostic: XiaohongshuPublishEntryDomRuntimeDiagnostic) => void;
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
    return false;
  };
}
