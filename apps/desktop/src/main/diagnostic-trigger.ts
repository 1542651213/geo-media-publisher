import type { XiaohongshuCanonicalPageRuntimeProbe } from "@publisher/adapters-xiaohongshu/browser";

export const XHS_CANONICAL_PAGE_PROBE_FLAG = "--probe-xhs-canonical-page" as const;
export const PROBE_XHS_CANONICAL_PAGE = "PROBE_XHS_CANONICAL_PAGE" as const;

export type DiagnosticAction = typeof PROBE_XHS_CANONICAL_PAGE;

function parseFixedAdditionalData(additionalData: unknown): DiagnosticAction | null {
  if (!additionalData || typeof additionalData !== "object" || Array.isArray(additionalData)) return null;
  const entries = Object.entries(additionalData);
  if (entries.length !== 1 || entries[0]?.[0] !== "action" || entries[0][1] !== PROBE_XHS_CANONICAL_PAGE) return null;
  return PROBE_XHS_CANONICAL_PAGE;
}

export function parseDiagnosticAction(commandLine: readonly string[], additionalData?: unknown): DiagnosticAction | null {
  const args = commandLine.slice(1);
  const cliAction = args.length === 1 && args[0] === XHS_CANONICAL_PAGE_PROBE_FLAG ? PROBE_XHS_CANONICAL_PAGE : null;
  if (additionalData !== undefined) return parseFixedAdditionalData(additionalData);
  return cliAction;
}

export function createFixedDiagnosticRunner(options: {
  probe: () => Promise<XiaohongshuCanonicalPageRuntimeProbe>;
  writeEvidence: (probe: XiaohongshuCanonicalPageRuntimeProbe) => void;
}): (action: DiagnosticAction) => Promise<boolean> {
  return async (action: DiagnosticAction): Promise<boolean> => {
    if (action !== PROBE_XHS_CANONICAL_PAGE) return false;
    const probe = await options.probe();
    options.writeEvidence(probe);
    return true;
  };
}
