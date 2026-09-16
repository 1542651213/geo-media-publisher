import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { XiaohongshuCanonicalPageRuntimeProbe } from "@publisher/adapters-xiaohongshu/browser";
import { createFixedDiagnosticRunner, parseDiagnosticAction, PROBE_XHS_CANONICAL_PAGE, XHS_CANONICAL_PAGE_PROBE_FLAG } from "../apps/desktop/src/main/diagnostic-trigger";

const mainSource = readFileSync("apps/desktop/src/main/main.ts", "utf8");

const probeFixture: XiaohongshuCanonicalPageRuntimeProbe = {
  probeStatus: "FAIL",
  failureStage: "CANONICAL_PAGE_LOOKUP",
  failureCode: "CANONICAL_PAGE_UNAVAILABLE",
  failureErrorClass: null,
  canonicalContextId: null,
  canonicalPageId: null,
  probedContextId: null,
  probedPageId: null,
  pageContextMatchesSession: false,
  createdNewPage: false,
  browserConnected: false,
  pageClosed: true,
  runtimeAuthState: "UNVERIFIED",
  playwrightPageUrl: null,
  domLocationHref: null,
  domLocationEvaluateStatus: "NOT_RUN",
  domLocationEvaluateErrorClass: null,
  pageUrlConsistency: "NOT_VERIFIED",
  routeClass: "UNKNOWN",
  identityObservationStatus: "NOT_RUN",
  identitySourceCandidates: [],
  identityDomDiagnosticMatchCount: 0,
  identityDomDiagnosticMatches: [],
  observedCreatorIdRaw: null,
  observedCreatorIdNormalized: null,
  observedDisplayName: null,
  observedProfileUrl: null
};

describe("Task10W fixed non-UI diagnostic trigger", () => {
  it("accepts only the exact zero-payload probe flag", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_CANONICAL_PAGE_PROBE_FLAG])).toBe(PROBE_XHS_CANONICAL_PAGE);
    for (const args of [
      ["Geo Media Publisher.exe"],
      ["Geo Media Publisher.exe", `${XHS_CANONICAL_PAGE_PROBE_FLAG}=payload`],
      ["Geo Media Publisher.exe", XHS_CANONICAL_PAGE_PROBE_FLAG, "--url=https://example.com"],
      ["Geo Media Publisher.exe", "--url=https://example.com"],
      ["Geo Media Publisher.exe", "--selector=.creator"],
      ["Geo Media Publisher.exe", "--script=location.href"],
      ["Geo Media Publisher.exe", "--page-id=page-1"],
      ["Geo Media Publisher.exe", "--context-id=context-1"],
      ["Geo Media Publisher.exe", "--evaluate=location.href"],
      ["Geo Media Publisher.exe", "--goto=https://example.com"],
      ["Geo Media Publisher.exe", "--unknown-diagnostic"]
    ]) expect(parseDiagnosticAction(args)).toBeNull();
  });

  it("accepts only the fixed enum handoff from a secondary instance", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", "--unexpected-electron-arg"], { action: PROBE_XHS_CANONICAL_PAGE })).toBe(PROBE_XHS_CANONICAL_PAGE);
    for (const data of [
      undefined,
      null,
      {},
      { action: XHS_CANONICAL_PAGE_PROBE_FLAG },
      { action: "UNKNOWN_ACTION" },
      { action: PROBE_XHS_CANONICAL_PAGE, payload: "https://example.com" },
      { action: PROBE_XHS_CANONICAL_PAGE, pageId: "page-1" },
      [PROBE_XHS_CANONICAL_PAGE]
    ]) expect(parseDiagnosticAction(["Geo Media Publisher.exe", "--unexpected-electron-arg"], data)).toBeNull();
  });

  it("dispatches exactly the existing proof-only probe and writes its result", async () => {
    const probe = vi.fn(async () => probeFixture);
    const writeEvidence = vi.fn();
    const runner = createFixedDiagnosticRunner({ probe, writeEvidence });

    await expect(runner(PROBE_XHS_CANONICAL_PAGE)).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(writeEvidence).toHaveBeenCalledWith(probeFixture);
  });

  it("keeps the Main second-instance path single-purpose and primary-instance only", () => {
    expect(mainSource).toContain("requestSingleInstanceLock(");
    expect(mainSource).toContain('app.on("second-instance"');
    expect(mainSource).toContain("parseDiagnosticActionWithTrace(commandLine, additionalData)");
    expect(mainSource).toContain("inspectCanonicalXhsPageRuntime");
    expect(mainSource).toContain("hashFile(app.getAppPath())");
    expect(mainSource).toContain("original-fs");
    expect(mainSource).toContain("xiaohongshu-task10w-live-probe-r6-20260902.json");
    expect(mainSource).not.toContain("runDiagnostic(action: string, payload: unknown)");
    expect(mainSource).not.toContain("newContext");
    expect(mainSource).not.toContain("newPage");
    expect(mainSource).not.toContain("verifyAndConvergeXhsIdentity");
  });
});
