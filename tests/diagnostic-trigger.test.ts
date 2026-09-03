import { describe, expect, it, vi } from "vitest";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import { createFixedDiagnosticRunner, INSPECT_XHS_CONTEXT_PAGES, INSPECT_XHS_PUBLISH_ENTRY_DOM, PROBE_XHS_CANONICAL_PAGE, XHS_CONTEXT_PAGE_INVENTORY_FLAG, XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG, XHS_CANONICAL_PAGE_PROBE_FLAG, parseDiagnosticAction } from "../apps/desktop/src/main/diagnostic-trigger";

const unusedProbe: XiaohongshuCanonicalPageRuntimeProbe = {} as XiaohongshuCanonicalPageRuntimeProbe;
const entryDomDiagnostic: XiaohongshuPublishEntryDomRuntimeDiagnostic = {
  inspectionStatus: "PASS",
  failureCode: null,
  accountId: "account-1",
  contextDebugId: "context-1",
  pageId: "page-1",
  pageContextMatchesSession: true,
  browserConnected: true,
  pageClosed: false,
  pageOrigin: "https://creator.xiaohongshu.com",
  pathname: "/new/home",
  publishNote: { label: "发布笔记", matchCount: 1, matches: [], clickableAncestorCount: 1, target: null, ancestors: [], uniqueClickableAncestor: null },
  imagePost: { label: "发布图文笔记", matchCount: 1, matches: [], clickableAncestorCount: 1, target: null, ancestors: [], uniqueClickableAncestor: null },
  uploadImage: { label: "上传图文", matchCount: 0, matches: [], clickableAncestorCount: 0, target: null, ancestors: [], uniqueClickableAncestor: null },
  diagnosticClickCount: 0,
  navigationCount: 0
};

describe("fixed XHS diagnostic triggers", () => {
  it("accepts only the bounded Context Page inventory flag or action", () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_CONTEXT_PAGE_INVENTORY_FLAG])).toBe(INSPECT_XHS_CONTEXT_PAGES);
    expect(parseDiagnosticAction(["publisher.exe", XHS_CANONICAL_PAGE_PROBE_FLAG])).toBe(PROBE_XHS_CANONICAL_PAGE);
    expect(parseDiagnosticAction(["publisher.exe", XHS_CONTEXT_PAGE_INVENTORY_FLAG, "--unexpected"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_CONTEXT_PAGES })).toBe(INSPECT_XHS_CONTEXT_PAGES);
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_CONTEXT_PAGES, extra: true })).toBeNull();
  });

  it("accepts only the fixed publish-entry DOM diagnostic action", () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG])).toBe(INSPECT_XHS_PUBLISH_ENTRY_DOM);
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_PUBLISH_ENTRY_DOM })).toBe(INSPECT_XHS_PUBLISH_ENTRY_DOM);
    expect(parseDiagnosticAction(["publisher.exe", XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG, "--page-id=page-1"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_PUBLISH_ENTRY_DOM, pageId: "page-1" })).toBeNull();
  });

  it("dispatches the bounded publish-entry DOM diagnostic without UI mutation", async () => {
    const inspectPublishEntryDom = vi.fn(async () => entryDomDiagnostic);
    const writePublishEntryDomEvidence = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(async () => unusedProbe), writeEvidence: vi.fn(), inspectPublishEntryDom, writePublishEntryDomEvidence });

    await expect(runner(INSPECT_XHS_PUBLISH_ENTRY_DOM)).resolves.toBe(true);
    expect(inspectPublishEntryDom).toHaveBeenCalledTimes(1);
    expect(writePublishEntryDomEvidence).toHaveBeenCalledWith(entryDomDiagnostic);
  });
});
