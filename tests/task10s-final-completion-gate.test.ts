import { describe, expect, it } from "vitest";
import { evaluateTask10sRetainedEditorGate, type Task10sRetainedEditorGateInput } from "../packages/adapters/xiaohongshu/src/task10s-retained-editor-completion";
import type { Task10sFinalSurfaceResolution } from "../packages/adapters/xiaohongshu/src/task10s-final-surface";

const enabled: Task10sFinalSurfaceResolution = { status: "FOUND_UNIQUE", present: true, enabled: true, currentState: "PRESENT_ENABLED", candidate: null, failureCode: null };
const disabled: Task10sFinalSurfaceResolution = { status: "DISABLED", present: true, enabled: false, currentState: "PRESENT_DISABLED", candidate: null, failureCode: "FINAL_SURFACE_DISABLED" };

function base(overrides: Partial<Task10sRetainedEditorGateInput> = {}): Task10sRetainedEditorGateInput {
  return {
    uploadAttemptCount: 1,
    setInputFilesCallCount: 0,
    postUploadState: "EDITOR_READY",
    imageAssetRenderedCount: 1,
    imageCounterTextSafe: "1/18",
    titleControlPresent: true,
    bodyControlPresent: true,
    noExplicitUploadError: true,
    initialPublishSurface: disabled,
    trustedArticleTitle: "自动化发布测试｜请忽略",
    trustedArticleBody: "这是一条 GEO Media Publisher 小红书自动发布链路测试内容，请忽略。",
    titleReadback: "自动化发布测试｜请忽略",
    bodyReadback: "这是一条 GEO Media Publisher 小红书自动发布链路测试内容，请忽略。",
    requiredFieldsPass: true,
    finalPublishSurface: enabled,
    contextIdentityAttestationPass: true,
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
      [{ contextIdentityAttestationPass: false }, "CONTEXT_IDENTITY_ATTESTATION_INVALID"],
      [{ authorizationState: "CONSUMED" }, "AUTHORIZATION_NOT_UNUSED"],
      [{ sameContext: false }, "SAME_CONTEXT_REQUIRED"],
      [{ samePage: false }, ""],
      [{ finalPublishSurface: disabled }, "FINAL_SURFACE_NOT_ENABLED"]
    ];
    for (const [override, failureCode] of cases) {
      if (failureCode) expect(evaluateTask10sRetainedEditorGate(base(override))).toMatchObject({ status: "BLOCKED", failureCode });
      else expect(evaluateTask10sRetainedEditorGate(base(override))).toMatchObject({ status: "READY_TO_SUBMIT" });
    }
  });

  it("does not turn an observed final click or upload API call into a retry", () => {
    expect(evaluateTask10sRetainedEditorGate(base({ finalSubmitClickCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "FINAL_SUBMIT_ALREADY_CLICKED" });
    expect(evaluateTask10sRetainedEditorGate(base({ setInputFilesCallCount: 1 }))).toMatchObject({ status: "BLOCKED", failureCode: "UPLOAD_CALL_OBSERVED" });
  });
});
