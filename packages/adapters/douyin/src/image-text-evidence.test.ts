import { describe, expect, it } from "vitest";
import { assertDouyinEditorSettings, classifyDouyinPublishResponse, matchDouyinManagementRows,
  protectExistingDouyinDraft, verifyDouyinUploadEvidence } from "./image-text-evidence";

describe("Douyin image/text BrowserNative evidence gates", () => {
  it("protects an existing unpublished item before navigation or upload", () => {
    expect(() => protectExistingDouyinDraft("你还有上次未发布的图文，是否继续编辑？")).toThrow("EXISTING_UNPUBLISHED_ITEM");
    expect(() => protectExistingDouyinDraft("继续编辑")).toThrow("EXISTING_UNPUBLISHED_ITEM");
    expect(() => protectExistingDouyinDraft("发布图文 上传图文")).not.toThrow();
  });

  it("requires one new processed image associated with this upload", () => {
    const valid = { preUploadImageCount: 0, postUploadImageCount: 1, selectedFileName: "owner.png",
      uploadInputFileName: "owner.png", imageVisible: true, imageLoaded: true, processing: false, error: false,
      currentEditorRoute: true, contextOwned: true };
    expect(() => verifyDouyinUploadEvidence(valid)).not.toThrow();
    expect(() => verifyDouyinUploadEvidence({ ...valid, postUploadImageCount: 2 })).toThrow("IMAGE_COUNT");
    expect(() => verifyDouyinUploadEvidence({ ...valid, uploadInputFileName: "other.png" })).toThrow("FILE_ASSOCIATION");
    expect(() => verifyDouyinUploadEvidence({ ...valid, imageLoaded: false })).toThrow("PROCESSING_INCOMPLETE");
    expect(() => verifyDouyinUploadEvidence({ ...valid, processing: true })).toThrow("PROCESSING_INCOMPLETE");
    expect(() => verifyDouyinUploadEvidence({ ...valid, contextOwned: false })).toThrow("CONTEXT_MISMATCH");
  });

  it("reads selected visibility and timing, never infers them from visible labels", () => {
    const valid = { visibility: "public" as const, visibilitySelected: true, timing: "immediate" as const,
      timingSelected: true, requiredEmptyCount: 0, unknownMandatoryCount: 0, selectedMandatory: [] };
    expect(() => assertDouyinEditorSettings(valid, "public")).not.toThrow();
    expect(() => assertDouyinEditorSettings({ ...valid, visibilitySelected: false }, "public")).toThrow("VISIBILITY_NOT_SELECTED");
    expect(() => assertDouyinEditorSettings({ ...valid, timing: "scheduled" }, "public")).toThrow("TIMING_MISMATCH");
    expect(() => assertDouyinEditorSettings({ ...valid, unknownMandatoryCount: 1 }, "public")).toThrow("MANDATORY_SETTING_UNKNOWN");
  });

  it("treats response timeouts, nonzero codes and duplicate requests as uncertain", () => {
    const accepted = { finalClickCount: 1, requestCount: 1, responseObserved: true, httpStatus: 200,
      statusCode: 0, itemId: "7361234567890123456", samePage: true, afterFinalAction: true };
    expect(classifyDouyinPublishResponse(accepted)).toEqual({ status: "ACCEPTED", remoteId: accepted.itemId });
    expect(classifyDouyinPublishResponse({ ...accepted, responseObserved: false }).status).toBe("UNKNOWN");
    expect(classifyDouyinPublishResponse({ ...accepted, statusCode: 1001 }).status).toBe("UNKNOWN");
    expect(classifyDouyinPublishResponse({ ...accepted, requestCount: 2 }).status).toBe("UNKNOWN");
    expect(classifyDouyinPublishResponse({ ...accepted, samePage: false }).status).toBe("UNKNOWN");
    expect(classifyDouyinPublishResponse({ ...accepted, itemId: null }).status).toBe("UNKNOWN");
  });

  it("matches the target management row uniquely and preserves ambiguity", () => {
    const row = { remoteId: "7361234567890123456", title: "室内空气测试", description: "室内空气测试", state: "REVIEWING" as const,
      submittedAt: "2026-09-26T03:00:00.000Z", publicUrl: null, imageCount: 1 };
    const query = { remoteId: null, title: "室内空气测试", windowStart: "2026-09-26T02:45:00.000Z",
      windowEnd: "2026-09-26T03:15:00.000Z", scopeComplete: true };
    expect(matchDouyinManagementRows([row], query)).toMatchObject({ state: "REVIEWING", remoteId: row.remoteId });
    expect(matchDouyinManagementRows([row, { ...row, remoteId: "7361234567890123457" }], query).state).toBe("AMBIGUOUS");
    expect(matchDouyinManagementRows([row], { ...query, scopeComplete: false }).state).toBe("UNKNOWN");
    expect(matchDouyinManagementRows([{ ...row, state: "PUBLISHED", remoteId: null }], query).state).toBe("UNKNOWN");
    expect(matchDouyinManagementRows([row], { ...query, remoteId: "7361234567890123458" }).state).toBe("NOT_FOUND");
  });
});
