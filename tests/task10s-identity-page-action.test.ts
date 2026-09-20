import { describe, expect, it, vi } from "vitest";
import {
  createFixedDiagnosticRunner,
  parseDiagnosticAction,
  RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE,
  XHS_TASK10S_ENSURE_IDENTITY_PAGE_FLAG
} from "../apps/desktop/src/main/diagnostic-trigger";

describe("Task10S identity-page ensure action", () => {
  it("accepts only the fixed no-argument action", () => {
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ENSURE_IDENTITY_PAGE_FLAG])).toBe(RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE);
    expect(parseDiagnosticAction(["Geo Media Publisher.exe", XHS_TASK10S_ENSURE_IDENTITY_PAGE_FLAG, "unexpected"])).toBeNull();
  });

  it("dispatches the ensure callback without any publish callback", async () => {
    const ensure = vi.fn(async () => ({ status: "PASS" as const, failureCode: null, identityPageEnsured: true, identityPageUrl: "https://creator.xiaohongshu.com/new/home", editorPageUrl: "https://creator.xiaohongshu.com/publish/publish", sameBrowserContext: true, identityMatch: true, observedCreatorId: "960803317", action: "NAVIGATED_EXISTING_BLANK" as const }));
    const write = vi.fn();
    const runner = createFixedDiagnosticRunner({
      probe: vi.fn(), writeEvidence: vi.fn(), ensureXhsIdentityPage: ensure, writeXhsIdentityPageEnsureEvidence: write
    });

    await expect(runner(RUN_XHS_TASK10S_ENSURE_IDENTITY_PAGE)).resolves.toBe(true);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
