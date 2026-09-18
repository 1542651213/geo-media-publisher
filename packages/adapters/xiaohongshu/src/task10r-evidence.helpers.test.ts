import { describe, expect, it } from "vitest";
// @ts-expect-error The CLI is an .mts entrypoint and is resolved by Vitest/tsx.
import { assertTask10rDbUnchanged, collectTask10rOperationEvidence, collectTask10rTimeline, sanitizeTask10rDiagnostic } from "../../../../scripts/xiaohongshu-task10r-publish-flow-exploration.mts";

const base = { operationId: "op-10r", platformKey: "xiaohongshu", accountId: "account-10r", sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish?xsec_token=secret", finalSubmitCount: 0 };

describe("Task10R evidence helpers", () => {
  it("keeps bounded DOM evidence while stripping secrets and query strings", () => {
    const value = sanitizeTask10rDiagnostic({ ...base, cookie: "cookie-value", access_token: "token-value", imagePath: "C:/private/image.png", phase: "IMAGE_POST_MEDIA_PREVIEW", semanticText: "下一步" });
    expect(value).toMatchObject({ sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish", phase: "IMAGE_POST_MEDIA_PREVIEW", semanticText: "下一步" });
    expect(JSON.stringify(value)).not.toContain("cookie-value");
    expect(JSON.stringify(value)).not.toContain("token-value");
    expect(JSON.stringify(value)).not.toContain("private/image.png");
  });

  it("correlates one operation and preserves ordered timeline/actions", () => {
    const diagnostics = [
      { ...base, code: "XHS_PUBLISH_FLOW_TIMELINE", timelineEntry: { timestamp: "2026-09-01T00:00:02.000Z", url: base.sanitizedUrl, phase: "IMAGE_UPLOAD", action: "UPLOAD", result: "PASS" } },
      { ...base, code: "XHS_PUBLISH_FLOW_INTERMEDIATE_ACTION", phase: "IMAGE_POST_MEDIA_PREVIEW", action: "下一步", intermediateActionClickCount: 1 },
      { ...base, code: "XHS_PUBLISH_FLOW_COMPLETED", status: "PASS_READY_FOR_FINAL_SUBMIT", finalSubmitVisible: true, finalSubmitEnabled: true, finalSubmitHitTestValid: true, finalSubmitCount: 0, finalSubmitControl: { label: "发布笔记" } }
    ];
    expect(collectTask10rTimeline(diagnostics)).toMatchObject([{ phase: "IMAGE_UPLOAD", action: "UPLOAD", result: "PASS" }]);
    expect(collectTask10rOperationEvidence(diagnostics, "op-10r", "account-10r")).toMatchObject({ readyForFinalSubmit: true, counters: { intermediateActionClickCount: 1, finalSubmitCount: 0 }, finalSubmit: { visible: true, enabled: true, hitTestValid: true } });
    expect(collectTask10rOperationEvidence(diagnostics, "other-operation").timeline).toEqual([]);
  });

  it("fails if the publish domain changed", () => {
    const counts = { publishJobs: 15, submissionIntents: 12, publishRecords: 9 };
    expect(() => assertTask10rDbUnchanged(counts, counts)).not.toThrow();
    expect(() => assertTask10rDbUnchanged(counts, { ...counts, publishJobs: 16 })).toThrow("TASK10R_DB_CHANGED");
  });

  it("rejects operation evidence that spans more than one account", () => {
    expect(() => collectTask10rOperationEvidence([
      { ...base, accountId: "account-a", code: "XHS_PUBLISH_FLOW_COMPLETED" },
      { ...base, accountId: "account-b", code: "XHS_PUBLISH_FLOW_COMPLETED" }
    ], "op-10r")).toThrow("TASK10R_OPERATION_AMBIGUOUS_ACCOUNT");
  });
});
