import { describe, expect, it } from "vitest";
import { resolveTask10sExactPublishSurface, type Task10sFinalSurfaceResolution } from "./task10s-final-surface";
import { evaluateTask10sRetainedEditorGate, type Task10sRetainedEditorGateInput } from "./task10s-retained-editor-completion";

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
    imageCounterTextSafe: "1/18",
    titleControlPresent: true,
    bodyControlPresent: true,
    noExplicitUploadError: true,
    initialPublishSurface: disabledSurface,
    trustedArticleTitle: "自动化发布测试｜请忽略",
    trustedArticleBody: "这是一条 GEO Media Publisher 小红书自动发布链路测试内容，请忽略。",
    titleReadback: "自动化发布测试｜请忽略",
    bodyReadback: "这是一条 GEO Media Publisher 小红书自动发布链路测试内容，请忽略。",
    requiredFieldsPass: true,
    finalPublishSurface: enabledSurface,
    contextIdentityAttestationPass: true,
    sameContext: true,
    samePage: true,
    authorizationState: "AUTHORIZED_UNUSED",
    finalSubmitClickCount: 0,
    ...overrides
  };
}

function inputWithDraftCounter(imageCounterTextSafe: string | null, overrides: Partial<Task10sRetainedEditorGateInput> = {}): Task10sRetainedEditorGateInput {
  return { ...input(overrides), imageCounterTextSafe } as Task10sRetainedEditorGateInput;
}

const freshPreparedArticle = {
  title: "自动化发布测试1｜请忽略",
  body: "GEO Media Publisher 自动发布链路测试。"
} as const;

function freshPreparedArticleInput(overrides: Record<string, unknown> = {}): Task10sRetainedEditorGateInput {
  return {
    ...input({ titleReadback: freshPreparedArticle.title, bodyReadback: freshPreparedArticle.body }),
    trustedArticleTitle: freshPreparedArticle.title,
    trustedArticleBody: freshPreparedArticle.body,
    ...overrides
  } as Task10sRetainedEditorGateInput;
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

  it("uses the current Prepared Job Article instead of legacy fixed content", () => {
    expect(evaluateTask10sRetainedEditorGate(freshPreparedArticleInput())).toMatchObject({ status: "READY_TO_SUBMIT", titleReadbackExact: true, bodyReadbackExact: true });
  });

  it("accepts normalized editor title readback for a fullwidth bound Article title", () => {
    expect(evaluateTask10sRetainedEditorGate(freshPreparedArticleInput({ titleReadback: "自动化发布测试1|请忽略" }))).toMatchObject({ status: "READY_TO_SUBMIT", titleReadbackExact: true });
  });

  it("requires strict editor readback against the bound Article", () => {
    expect(evaluateTask10sRetainedEditorGate(freshPreparedArticleInput({ titleReadback: "其他标题" }))).toMatchObject({ status: "BLOCKED", failureCode: "TITLE_READBACK_NOT_EXACT" });
    expect(evaluateTask10sRetainedEditorGate(freshPreparedArticleInput({ bodyReadback: "其他正文" }))).toMatchObject({ status: "BLOCKED", failureCode: "BODY_READBACK_NOT_EXACT" });
  });

  it("fails closed when the Prepared Job Article content is unavailable", () => {
    expect(evaluateTask10sRetainedEditorGate({
      ...freshPreparedArticleInput(),
      trustedArticleTitle: "",
      trustedArticleBody: ""
    } as Task10sRetainedEditorGateInput)).toMatchObject({ status: "BLOCKED", failureCode: "PREPARED_ARTICLE_CONTENT_NOT_AVAILABLE" });
  });

  it("allows legacy retained-editor content when that Article is the bound source", () => {
    const legacyTitle = "自动化发布测试｜请忽略";
    const legacyBody = "这是一条 GEO Media Publisher 小红书自动发布链路测试内容，请忽略。";
    expect(evaluateTask10sRetainedEditorGate({
      ...input({ titleReadback: legacyTitle, bodyReadback: legacyBody }),
      trustedArticleTitle: legacyTitle,
      trustedArticleBody: legacyBody
    } as Task10sRetainedEditorGateInput)).toMatchObject({ status: "READY_TO_SUBMIT" });
  });

  it("accepts arbitrary bound Article content without a fresh-flow literal", () => {
    const title = "任意已准备任务标题";
    const body = "任意已准备任务正文";
    expect(evaluateTask10sRetainedEditorGate({
      ...input({ titleReadback: title, bodyReadback: body }),
      trustedArticleTitle: title,
      trustedArticleBody: body
    } as Task10sRetainedEditorGateInput)).toMatchObject({ status: "READY_TO_SUBMIT" });
  });

  it("blocks final submit on identity, authorization, context, upload, or final-surface failures", () => {
    const cases: Array<[keyof Task10sRetainedEditorGateInput, unknown, string]> = [
      ["setInputFilesCallCount", 1, "UPLOAD_CALL_OBSERVED"],
      ["contextIdentityAttestationPass", false, "CONTEXT_IDENTITY_ATTESTATION_INVALID"],
      ["sameContext", false, "SAME_CONTEXT_REQUIRED"],
      ["authorizationState", "CONSUMED", "AUTHORIZATION_NOT_UNUSED"],
      ["finalSubmitClickCount", 1, "FINAL_SUBMIT_ALREADY_CLICKED"]
    ];
    for (const [field, value, failureCode] of cases) expect(evaluateTask10sRetainedEditorGate(input({ [field]: value } as Partial<Task10sRetainedEditorGateInput>))).toMatchObject({ status: "BLOCKED", failureCode });
    expect(evaluateTask10sRetainedEditorGate(input({ finalPublishSurface: disabledSurface }))).toMatchObject({ status: "BLOCKED", failureCode: "FINAL_SURFACE_NOT_ENABLED" });
  });

  it("allows the retained editor Page to differ from the attestation source Page", () => {
    expect(evaluateTask10sRetainedEditorGate(input({ samePage: false }))).toMatchObject({ status: "READY_TO_SUBMIT" });
  });

  it("requires a valid current editor image counter for a reopened server-backed draft", () => {
    expect(evaluateTask10sRetainedEditorGate(inputWithDraftCounter("1/18"))).toMatchObject({ status: "READY_TO_SUBMIT" });
    expect(evaluateTask10sRetainedEditorGate(inputWithDraftCounter("1/18", { uploadAttemptCount: 0 }))).toMatchObject({ status: "READY_TO_SUBMIT", currentDraftImageProof: true });
    expect(evaluateTask10sRetainedEditorGate(inputWithDraftCounter("0/18"))).toMatchObject({ status: "BLOCKED", failureCode: "IMAGE_COUNTER_NOT_VALID" });
    expect(evaluateTask10sRetainedEditorGate(inputWithDraftCounter(null))).toMatchObject({ status: "BLOCKED", failureCode: "IMAGE_COUNTER_NOT_VALID" });
    expect(evaluateTask10sRetainedEditorGate(inputWithDraftCounter("1/18", { imageAssetRenderedCount: 0 }))).toMatchObject({ status: "BLOCKED", failureCode: "IMAGE_ASSET_NOT_PROVEN" });
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
