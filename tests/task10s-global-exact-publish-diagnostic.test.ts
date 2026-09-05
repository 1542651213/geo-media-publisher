import { describe, expect, it, vi } from "vitest";
import type { XiaohongshuCanonicalPageRuntimeProbe, XiaohongshuGlobalExactPublishDomRuntimeDiagnostic } from "@publisher/adapters-xiaohongshu/browser";
import {
  createFixedDiagnosticRunner,
  INSPECT_XHS_FINAL_SUBMIT_DOM,
  INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM,
  parseDiagnosticAction,
  XHS_FINAL_SUBMIT_DOM_DIAGNOSTIC_FLAG,
  XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG
} from "../apps/desktop/src/main/diagnostic-trigger";

const unusedProbe = vi.fn(async (): Promise<XiaohongshuCanonicalPageRuntimeProbe> => { throw new Error("unused"); });
const diagnostic = { inspectionStatus: "PASS", accountId: "account-1" } as XiaohongshuGlobalExactPublishDomRuntimeDiagnostic;

describe("fixed XHS global exact publish diagnostic", () => {
  it("accepts only the exact action and rejects caller data or conflicting actions", () => {
    expect(parseDiagnosticAction(["publisher.exe", XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG])).toBe(INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM);
    expect(parseDiagnosticAction(["C:\\Program Files\\Geo Media Publisher\\Geo Media Publisher.exe", "D:\\GEO\\worktrees\\task10s\\resources\\app.asar", "--allow-file-access-from-files", XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG])).toBe(INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM);
    expect(parseDiagnosticAction(["publisher.exe", XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG, "发布"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe", XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG, "--selector=button"])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe", XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG], { action: INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM, text: "发布" })).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe"], { action: INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM, selector: "button" })).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe", XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG, XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG])).toBeNull();
    expect(parseDiagnosticAction(["publisher.exe", XHS_GLOBAL_EXACT_PUBLISH_DOM_DIAGNOSTIC_FLAG, XHS_FINAL_SUBMIT_DOM_DIAGNOSTIC_FLAG])).toBeNull();
  });

  it("routes the fixed action to the read-only global inspector once", async () => {
    const inspectGlobalExactPublishDom = vi.fn(async () => diagnostic);
    const writeGlobalExactPublishDomEvidence = vi.fn();
    const runner = createFixedDiagnosticRunner({
      probe: unusedProbe,
      writeEvidence: vi.fn(),
      inspectGlobalExactPublishDom,
      writeGlobalExactPublishDomEvidence
    });

    await expect(runner(INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM)).resolves.toBe(true);
    expect(inspectGlobalExactPublishDom).toHaveBeenCalledTimes(1);
    expect(writeGlobalExactPublishDomEvidence).toHaveBeenCalledWith(diagnostic);
  });

  it("does not reuse the final-submit semantic candidate action", () => {
    expect(INSPECT_XHS_GLOBAL_EXACT_PUBLISH_DOM).not.toBe(INSPECT_XHS_FINAL_SUBMIT_DOM);
  });
});
