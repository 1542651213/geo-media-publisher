import { describe, expect, it } from "vitest";
import { resolveTask10sExactPublishSurface, type Task10sFinalSurfaceResolution } from "./task10s-final-surface";
import { evaluateTask10sRetainedEditorGate, TASK10S_FIXED_BODY, TASK10S_FIXED_TITLE, type Task10sRetainedEditorGateInput } from "./task10s-retained-editor-completion";

const enabledSurface: Task10sFinalSurfaceResolution = {
  status: "FOUND_UNIQUE",
  present: true,
  enabled: true,
  currentState: "PRESENT_ENABLED",
  candidate: null,
  failureCode: null
};

const disabledSurface: Task10sFinalSurfaceResolution = {
  status: "DISABLED",
  present: true,
  enabled: false,
  currentState: "PRESENT_DISABLED",
  candidate: null,
  failureCode: "FINAL_SURFACE_DISABLED"
};

function input(overrides: Partial<Task10sRetainedEditorGateInput> = {}): Task10sRetainedEditorGateInput {
  return {
    uploadAttemptCount: 1,
    setInputFilesCallCount: 0,
    postUploadState: "EDITOR_READY",
    imageAssetRenderedCount: 1,
    titleControlPresent: true,
    bodyControlPresent: true,
    noExplicitUploadError: true,
    initialPublishSurface: disabledSurface,
    titleReadback: TASK10S_FIXED_TITLE,
    bodyReadback: TASK10S_FIXED_BODY,
    requiredFieldsPass: true,
    finalPublishSurface: enabledSurface,
    identityPass: true,
    sameContext: true,
    samePage: true,
    authorizationState: "AUTHORIZED_UNUSED",
    finalSubmitClickCount: 0,
    ...overrides
  };
}

describe("Task10S retained-editor completion gate", () => {
  it("accepts a previously uploaded editor with a disabled pre-fill publish surface and enabled final surface", () => {
    expect(evaluateTask10sRetainedEditorGate(input())).toMatchObject({ status: "READY_TO_SUBMIT", titleReadbackExact: true, bodyReadbackExact: true, finalSubmitPresent: true, finalSubmitEnabled: true });
  });

  it("blocks fill and submit when the image or editor proof is missing", () => {
    expect(evaluateTask10sRetainedEditorGate(input({ imageAssetRenderedCount: 0 }))).toMatchObject({ status: "BLOCKED", failureCode: "IMAGE_ASSET_NOT_PROVEN" });
    expect(evaluateTask10sRetainedEditorGate(input({ postUploadState: "AMBIGUOUS" }))).toMatchObject({ status: "BLOCKED", failureCode: "POST_UPLOAD_EDITOR_NOT_READY" });
  });

  it("blocks when fixed title/body readback is not exact", () => {
    expect(evaluateTask10sRetainedEditorGate(input({ titleReadback: "其他标题" }))).toMatchObject({ status: "BLOCKED", failureCode: "TITLE_READBACK_NOT_EXACT" });
    expect(evaluateTask10sRetainedEditorGate(input({ bodyReadback: "其他正文" }))).toMatchObject({ status: "BLOCKED", failureCode: "BODY_READBACK_NOT_EXACT" });
  });

  it("blocks final submit on identity, authorization, page, upload, or final-surface failures", () => {
    const cases: Array<[keyof Task10sRetainedEditorGateInput, unknown, string]> = [
      ["setInputFilesCallCount", 1, "UPLOAD_CALL_OBSERVED"],
      ["identityPass", false, "IDENTITY_REVALIDATION_FAILED"],
      ["sameContext", false, "SAME_CONTEXT_REQUIRED"],
      ["samePage", false, "SAME_PAGE_REQUIRED"],
      ["authorizationState", "CONSUMED", "AUTHORIZATION_NOT_UNUSED"],
      ["finalSubmitClickCount", 1, "FINAL_SUBMIT_ALREADY_CLICKED"]
    ];
    for (const [field, value, failureCode] of cases) expect(evaluateTask10sRetainedEditorGate(input({ [field]: value } as Partial<Task10sRetainedEditorGateInput>))).toMatchObject({ status: "BLOCKED", failureCode });
    expect(evaluateTask10sRetainedEditorGate(input({ finalPublishSurface: disabledSurface }))).toMatchObject({ status: "BLOCKED", failureCode: "FINAL_SURFACE_NOT_ENABLED" });
  });

  it("keeps nonstandard publish surface resolution separate from the completion gate", () => {
    const diagnostic = {
      inspectionStatus: "PASS" as const,
      failureCode: null,
      accountId: "account-a",
      contextDebugId: "context-a",
      pageId: "page-a",
      sessionExists: true,
      browserConnected: true,
      contextExists: true,
      pageExists: true,
      pageClosed: false,
      pageContextMatchesSession: true,
      origin: "https://creator.xiaohongshu.com",
      pathname: "/publish/publish",
      sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish",
      globalExactPublishTextMatchCount: 1,
      globalExactPublishUnique: "YES" as const,
      maxAncestorDepth: 5 as const,
      scanTruncated: false,
      globalExactPublishNodesSafe: [{
        tagName: "SPAN",
        role: null,
        classNameSafe: "label",
        tabIndex: -1,
        ariaDisabled: null,
        disabled: false,
        pointerEvents: "auto",
        cursor: "default",
        display: "inline",
        visibility: "visible",
        boundingRect: { x: 1, y: 1, width: 20, height: 20 },
        connected: true,
        clickableSignals: ["POINTER_EVENTS_ACTIVE"] as const,
        rendered: true,
        ancestors: [{ depth: 1, tagName: "DIV", role: "button", classNameSafe: "surface", tabIndex: -1, ariaDisabled: null, disabled: false, pointerEvents: "auto", cursor: "default", display: "block", visibility: "visible", boundingRect: { x: 1, y: 1, width: 80, height: 32 }, connected: true, clickableSignals: ["ROLE_BUTTON", "POINTER_EVENTS_ACTIVE"] as const }]
      }]
    };
    expect(resolveTask10sExactPublishSurface(diagnostic)).toMatchObject({ status: "FOUND_UNIQUE", present: true });
  });
});
