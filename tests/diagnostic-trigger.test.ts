import { describe, expect, it, vi } from "vitest";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuCurrentFileInputState, XiaohongshuCurrentPostUploadReconciliation, XiaohongshuCurrentPostUploadTerminalReadiness, XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic, XiaohongshuPublishEntryDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import { createFixedDiagnosticRunner, ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION, INSPECT_XHS_CONTEXT_PAGES, INSPECT_XHS_FILE_INPUT_STATE, INSPECT_XHS_FINAL_SUBMIT_DOM, INSPECT_XHS_POST_UPLOAD_RECONCILIATION, INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS, INSPECT_XHS_PUBLISH_ENTRY_DOM, PROBE_XHS_CANONICAL_PAGE, XHS_CONTEXT_IDENTITY_ATTESTATION_FLAG, XHS_CONTEXT_PAGE_INVENTORY_FLAG, XHS_FILE_INPUT_STATE_FLAG, XHS_FINAL_SUBMIT_DOM_DIAGNOSTIC_FLAG, XHS_POST_UPLOAD_RECONCILIATION_FLAG, XHS_POST_UPLOAD_TERMINAL_READINESS_FLAG, XHS_PUBLISH_ENTRY_DOM_DIAGNOSTIC_FLAG, XHS_CANONICAL_PAGE_PROBE_FLAG, parseDiagnosticAction } from "../apps/desktop/src/main/diagnostic-trigger";

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

const reconciliationDiagnostic = { inspectionStatus: "PASS", accountId: "account-1" } as XiaohongshuCurrentPostUploadReconciliation;
const terminalReadinessDiagnostic = { inspectionStatus: "PASS", accountId: "account-1", terminalReadiness: { ready: true, postUploadState: "EDITOR_READY", blockerCodes: [] } } as unknown as XiaohongshuCurrentPostUploadTerminalReadiness;
const fileInputDiagnostic = { inspectionStatus: "PASS", accountId: "account-1" } as XiaohongshuCurrentFileInputState;
const finalSubmitDiagnostic = { inspectionStatus: "PASS", accountId: "account-1" } as XiaohongshuPublishEditorSemanticCandidatesRuntimeDiagnostic;
const attestationResult = { status: "PASS", attestation: { accountId: "account-1" } } as never;

describe("fixed XHS diagnostic triggers", () => {
  it("accepts only the bounded Context Page inventory flag or action", () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_CONTEXT_PAGE_INVENTORY_FLAG])).toBe(INSPECT_XHS_CONTEXT_PAGES);
    expect(parseDiagnosticAction(["publisher.exe", XHS_CANONICAL_PAGE_PROBE_FLAG])).toBe(PROBE_XHS_CANONICAL_PAGE);
    expect(parseDiagnosticAction(["publisher.exe", XHS_CONTEXT_PAGE_INVENTORY_FLAG, "--unexpected"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_CONTEXT_PAGES })).toBe(INSPECT_XHS_CONTEXT_PAGES);
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_CONTEXT_PAGES, extra: true })).toBeNull();
  });

  it("dispatches the fixed no-argument Context identity attestation action and rejects caller data", async () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_CONTEXT_IDENTITY_ATTESTATION_FLAG])).toBe(ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION);
    expect(parseDiagnosticAction(["publisher.exe", XHS_CONTEXT_IDENTITY_ATTESTATION_FLAG, "--page-id=page-1"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe"], { action: ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION, pageId: "page-1" })).toBeNull();
    const establish = vi.fn(async () => attestationResult);
    const write = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(async () => unusedProbe), writeEvidence: vi.fn(), establishXhsContextIdentityAttestation: establish, writeXhsContextIdentityAttestationEvidence: write });
    await expect(runner(ESTABLISH_XHS_CONTEXT_IDENTITY_ATTESTATION)).resolves.toBe(true);
    expect(establish).toHaveBeenCalledTimes(1);
    expect(establish).toHaveBeenCalledWith();
    expect(write).toHaveBeenCalledWith(attestationResult);
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

  it("accepts only the fixed post-upload reconciliation flag and rejects caller data", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_POST_UPLOAD_RECONCILIATION_FLAG])).toBe(INSPECT_XHS_POST_UPLOAD_RECONCILIATION);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_POST_UPLOAD_RECONCILIATION_FLAG, "selector"])).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_POST_UPLOAD_RECONCILIATION_FLAG], { action: INSPECT_XHS_POST_UPLOAD_RECONCILIATION, selector: "input" })).toBeNull();
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_POST_UPLOAD_RECONCILIATION_FLAG], { action: INSPECT_XHS_POST_UPLOAD_RECONCILIATION, pageId: "page-1" })).toBeNull();
  });

  it("routes the fixed action through the existing read-only reconciliation and evidence callbacks", async () => {
    const inspectPostUploadReconciliation = vi.fn(async () => reconciliationDiagnostic);
    const writePostUploadReconciliationEvidence = vi.fn();
    const runner = createFixedDiagnosticRunner({
      probe: vi.fn(async () => unusedProbe),
      writeEvidence: vi.fn(),
      inspectPostUploadReconciliation,
      writePostUploadReconciliationEvidence
    });

    await expect(runner(INSPECT_XHS_POST_UPLOAD_RECONCILIATION)).resolves.toBe(true);
    expect(inspectPostUploadReconciliation).toHaveBeenCalledTimes(1);
    expect(writePostUploadReconciliationEvidence).toHaveBeenCalledWith(reconciliationDiagnostic);
  });

  it("fails closed when the fixed post-upload diagnostic callback is unavailable", async () => {
    const runner = createFixedDiagnosticRunner({ probe: vi.fn(), writeEvidence: vi.fn() });

    await expect(runner(INSPECT_XHS_POST_UPLOAD_RECONCILIATION)).resolves.toBe(false);
  });

  it("dispatches the fixed readonly post-upload terminal-readiness action", async () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_POST_UPLOAD_TERMINAL_READINESS_FLAG])).toBe(INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS);
    expect(parseDiagnosticAction(["publisher.exe", XHS_POST_UPLOAD_TERMINAL_READINESS_FLAG, "selector"])).toBeNull();
    const inspectPostUploadTerminalReadiness = vi.fn(async () => terminalReadinessDiagnostic);
    const writePostUploadTerminalReadinessEvidence = vi.fn();
    const runner = createFixedDiagnosticRunner({
      probe: vi.fn(async () => unusedProbe),
      writeEvidence: vi.fn(),
      inspectPostUploadTerminalReadiness,
      writePostUploadTerminalReadinessEvidence
    });

    await expect(runner(INSPECT_XHS_POST_UPLOAD_TERMINAL_READINESS)).resolves.toBe(true);
    expect(inspectPostUploadTerminalReadiness).toHaveBeenCalledTimes(1);
    expect(writePostUploadTerminalReadinessEvidence).toHaveBeenCalledWith(terminalReadinessDiagnostic);
  });

  it("accepts only the fixed final-submit DOM diagnostic flag and rejects caller data", () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_FINAL_SUBMIT_DOM_DIAGNOSTIC_FLAG])).toBe(INSPECT_XHS_FINAL_SUBMIT_DOM);
    expect(parseDiagnosticAction(["publisher.exe", XHS_FINAL_SUBMIT_DOM_DIAGNOSTIC_FLAG, "selector"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_FINAL_SUBMIT_DOM, selector: "button" })).toBeNull();
  });

  it("routes the fixed final-submit DOM diagnostic through the existing semantic inspector", async () => {
    const inspectFinalSubmitDom = vi.fn(async () => finalSubmitDiagnostic);
    const writeFinalSubmitDomEvidence = vi.fn();
    const runner = createFixedDiagnosticRunner({
      probe: vi.fn(async () => unusedProbe),
      writeEvidence: vi.fn(),
      inspectFinalSubmitDom,
      writeFinalSubmitDomEvidence
    });

    await expect(runner(INSPECT_XHS_FINAL_SUBMIT_DOM)).resolves.toBe(true);
    expect(inspectFinalSubmitDom).toHaveBeenCalledTimes(1);
    expect(writeFinalSubmitDomEvidence).toHaveBeenCalledWith(finalSubmitDiagnostic);
  });

  it("routes the fixed file-input diagnostic without accepting caller data", async () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_FILE_INPUT_STATE_FLAG])).toBe(INSPECT_XHS_FILE_INPUT_STATE);
    expect(parseDiagnosticAction(["publisher.exe", XHS_FILE_INPUT_STATE_FLAG, "--selector"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_FILE_INPUT_STATE, filePath: "C:/private.png" })).toBeNull();

    const inspectFileInputState = vi.fn(async () => fileInputDiagnostic);
    const writeFileInputEvidence = vi.fn();
    const runner = createFixedDiagnosticRunner({
      probe: vi.fn(async () => unusedProbe),
      writeEvidence: vi.fn(),
      inspectFileInputState,
      writeFileInputEvidence
    });

    await expect(runner(INSPECT_XHS_FILE_INPUT_STATE)).resolves.toBe(true);
    expect(inspectFileInputState).toHaveBeenCalledTimes(1);
    expect(writeFileInputEvidence).toHaveBeenCalledWith(fileInputDiagnostic);
  });
});
