import { describe, expect, it } from "vitest";
import { INSPECT_XHS_CONTEXT_PAGES, PROBE_XHS_CANONICAL_PAGE, XHS_CONTEXT_PAGE_INVENTORY_FLAG, XHS_CANONICAL_PAGE_PROBE_FLAG, parseDiagnosticAction } from "../apps/desktop/src/main/diagnostic-trigger";

describe("fixed XHS diagnostic triggers", () => {
  it("accepts only the bounded Context Page inventory flag or action", () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_CONTEXT_PAGE_INVENTORY_FLAG])).toBe(INSPECT_XHS_CONTEXT_PAGES);
    expect(parseDiagnosticAction(["publisher.exe", XHS_CANONICAL_PAGE_PROBE_FLAG])).toBe(PROBE_XHS_CANONICAL_PAGE);
    expect(parseDiagnosticAction(["publisher.exe", XHS_CONTEXT_PAGE_INVENTORY_FLAG, "--unexpected"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_CONTEXT_PAGES })).toBe(INSPECT_XHS_CONTEXT_PAGES);
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_CONTEXT_PAGES, extra: true })).toBeNull();
  });
});
