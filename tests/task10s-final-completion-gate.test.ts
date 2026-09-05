import { describe, expect, it } from "vitest";
import { evaluateTask10sRetainedEditorGate, TASK10S_FIXED_BODY, TASK10S_FIXED_TITLE, type Task10sRetainedEditorGateInput } from "../packages/adapters/xiaohongshu/src/task10s-retained-editor-completion";
import type { Task10sFinalSurfaceResolution } from "../packages/adapters/xiaohongshu/src/task10s-final-surface";

const enabled: Task10sFinalSurfaceResolution = { status: "FOUND_UNIQUE", present: true, enabled: true, currentState: "PRESENT_ENABLED", candidate: null, failureCode: null };
const disabled: Task10sFinalSurfaceResolution = { status: "DISABLED", present: true, enabled: false, currentState: "PRESENT_DISABLED", candidate: null, failureCode: "FINAL_SURFACE_DISABLED" };

function base(overrides: Partial<Task10sRetainedEditorGateInput> = {}): Task10sRetainedEditorGateInput {
  return {
    uploadAttemptCount: 1,
    setInputFilesCallCount: 0,
    postUploadState: "EDITOR_READY",
    imageAssetRenderedCount: 1,
    titleControlPresent: true,
    bodyControlPresent: true,
    noExplicitUploadError: true,
    initialPublishSurface: disabled,
    titleReadback: TASK10S_FIXED_TITLE,
    bodyReadback: TASK10S_FIXED_BODY,
    requiredFieldsPass: true,
    finalPublishSurface: enabled,
    identityPass: true,
    sameContext: true,
    samePage: true,
    authorizationState: "AUTHORIZED_UNUSED",
    finalSubmitClickCount: 0,
    ...overrides
  };
}

describe("Task10S r31 final completion gate", () => {
  it("is ready only after retained upload/editor proof and fixed readbacks", () => {
    expect(evaluateTask10sRetainedEditorGate(base()).status).toBe("READY_TO_SUBMIT");
  });

  it("blocks fill/submit prerequisites fail-closed", () => {
    const cases: Array<[Partial<Task10sRetainedEditorGateInput>, string]> = [
      [{ imageAssetRenderedCount: 0 }, "IMAGE_ASSET_NOT_PROVEN"],
      [{ postUploadState: "AMBIGUOUS" }, "POST_UPLOAD_EDITOR_NOT_READY"],
      [{ titleReadback: "caller supplied title" }, "TITLE_READBACK_NOT_EXACT"],
      [{ bodyReadback: "caller supplied body" }, "BODY_READBACK_NOT_EXACT"],
      [{ identityPass: false }, "IDENTITY_REVALIDATION_FAILED"],
      [{ authorizationState: "CONSUMED" }, "AUTHORIZATION_NOT_UNUSED"],
      [{ sameContext: false }, "SAME_CONTEXT_REQUIRED"],
      [{ samePage: false }, "SAME_PAGE_REQUIRED"],
      [{ finalPublishSurface: disabled }, "FINAL_SURFACE_NOT_ENABLED"]
    ];
    for (const [override, failureCode] of cases) expect(evaluateTask10sRetainedEditorGate(base(override))).toMatchObject({ status: "BLOCKED", failureCode });
  });

  it("does not turn an observed final click or upload API call into a retry", () => {
    expect(evaluateTask10sRetainedEditorGate(base({ finalSubmitClickCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "FINAL_SUBMIT_ALREADY_CLICKED" });
    expect(evaluateTask10sRetainedEditorGate(base({ setInputFilesCallCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "UPLOAD_CALL_OBSERVED" });
  });
});
