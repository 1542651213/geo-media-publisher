import type { XiaohongshuCanonicalPageRuntimeProbe } from "@publisher/adapters-xiaohongshu/browser";

export const XHS_CANONICAL_PAGE_PROBE_FLAG = "--probe-xhs-canonical-page" as const;
export const PROBE_XHS_CANONICAL_PAGE = "PROBE_XHS_CANONICAL_PAGE" as const;

export type DiagnosticAction = typeof PROBE_XHS_CANONICAL_PAGE;

export function parseDiagnosticAction(commandLine: readonly string[]): DiagnosticAction | null {
  const args = commandLine.slice(1);
  return args.length === 1 && args[0] === XHS_CANONICAL_PAGE_PROBE_FLAG ? PROBE_XHS_CANONICAL_PAGE : null;
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
