import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import {
  assertPreUploadImageEditorContract,
  classifyImagePostEditorPhase,
  classifyPostUploadImageEditorState,
  resolveImageEditorUploadCapability,
  inspectImagePostEditorPhase,
  inspectImagePostEditor,
  inspectPostUploadImageEditor,
  type ImageEditorDiagnostic,
  type ImageEditorDomSnapshot,
  type ImageEditorInspectionMetadata,
  type ImageEditorPhaseEvidence,
  type ImageEditorUploadControlRelationship
} from "./image-editor-discovery";

const metadata: ImageEditorInspectionMetadata = {
  operationId: "operation-editor-1",
  platformKey: "xiaohongshu",
  accountId: "account-editor-1",
  contextDebugId: "context-editor-1",
  pageDebugId: "page-editor-1"
};

const editorUrl = "https://creator.xiaohongshu.com/publish/publish";

type CandidateFixture = {
  candidateId: string;
  tagName: string;
  role: string | null;
  semanticSignal: string;
  visible: boolean;
  enabled: boolean;
};

function candidate(candidateId: string, overrides: Partial<CandidateFixture> = {}): CandidateFixture {
  return {
    candidateId,
    tagName: "INPUT",
    role: null,
    semanticSignal: "stable-test-signal",
    visible: true,
    enabled: true,
    ...overrides
  };
}

function snapshot(overrides: Partial<ImageEditorDomSnapshot> = {}): ImageEditorDomSnapshot {
  return {
    currentUrl: editorUrl,
    readyState: "complete",
    shellSignal: true,
    shellFingerprint: "shell-ready",
    contentTypeSignal: "IMAGE_POST",
    securityVerificationPresent: false,
    loginPagePresent: false,
    titleCandidates: [candidate("title-0")],
    bodyCandidates: [candidate("body-0", { tagName: "DIV", role: "textbox" })],
    uploadCandidates: [candidate("upload-0", { tagName: "INPUT", semanticSignal: "input[type=file]" })],
    publishSettingsCandidates: [],
    finalSubmitCandidates: [candidate("submit-0", { tagName: "BUTTON", semanticSignal: "final-submit-label" })],
    uploadBusy: false,
    previewReady: true,
    ...overrides
  };
}

function pageFor(snapshots: ImageEditorDomSnapshot[]): Page {
  let index = 0;
  const page = {
    url: () => snapshots[Math.min(index, snapshots.length - 1)]!.currentUrl,
    evaluate: async () => snapshots[Math.min(index++, snapshots.length - 1)]!,
    click: async () => { throw new Error("discovery must not click"); },
    fill: async () => { throw new Error("discovery must not fill"); },
    type: async () => { throw new Error("discovery must not type"); }
  };
  return page as unknown as Page;
}

async function inspect(snapshots: ImageEditorDomSnapshot[], diagnostics: ImageEditorDiagnostic[] = []) {
  return inspectImagePostEditor(pageFor(snapshots), metadata, {
    maxWaitMs: 80,
    probeIntervalMs: 0,
    stableSampleCount: 2,
    emit: (event) => diagnostics.push(event)
  });
}

describe("Xiaohongshu image editor discovery", () => {
  function phaseEvidence(overrides: Partial<ImageEditorPhaseEvidence> = {}): ImageEditorPhaseEvidence {
    return {
      shellReady: true,
      contentType: "IMAGE_POST",
      contentTypeReady: true,
      loginPagePresent: false,
      securityVerificationPresent: false,
      domStable: true,
      uploadCapabilityPresent: true,
      uploadCapabilityUnique: true,
      preUploadSemanticSignalPresent: true,
      titleCandidateCount: 0,
      bodyCandidateCount: 0,
      finalSubmitCandidateCount: 0,
      ...overrides
    };
  }

  function uploadRelationship(overrides: Partial<ImageEditorUploadControlRelationship> = {}): ImageEditorUploadControlRelationship {
    return {
      candidateId: "upload-0",
      tagName: "INPUT",
      type: "file",
      accept: "image/*",
      multiple: true,
      enabled: true,
      visible: false,
      usableSurface: true,
      surfaceSignal: "visible-upload-ancestor",
      ancestors: [],
      ...overrides
    };
  }

  it("classifies a stable image editor with upload surface and no post-upload controls as pre-upload", () => {
    expect(classifyImagePostEditorPhase(phaseEvidence()).phase).toBe("IMAGE_POST_PRE_UPLOAD");
  });

  it("classifies a stable image editor with post-upload controls as post-upload editor", () => {
    expect(classifyImagePostEditorPhase(phaseEvidence({
      titleCandidateCount: 1,
      bodyCandidateCount: 1,
      finalSubmitCandidateCount: 1
    })).phase).toBe("IMAGE_POST_POST_UPLOAD_EDITOR");
  });

  it("fails closed when upload capability is absent or evidence is unstable", () => {
    expect(classifyImagePostEditorPhase(phaseEvidence({
      uploadCapabilityPresent: false,
      uploadCapabilityUnique: false,
      preUploadSemanticSignalPresent: false
    })).phase).toBe("IMAGE_POST_UNKNOWN");
    expect(classifyImagePostEditorPhase(phaseEvidence({ domStable: false })).phase).toBe("IMAGE_POST_TRANSITIONING");
  });

  it("prioritizes authentication and security phases over editor controls", () => {
    expect(classifyImagePostEditorPhase(phaseEvidence({ loginPagePresent: true })).phase).toBe("LOGIN");
    expect(classifyImagePostEditorPhase(phaseEvidence({ securityVerificationPresent: true })).phase).toBe("SECURITY_VERIFICATION");
  });

  it("treats a hidden file input under one usable upload surface as present", () => {
    const result = resolveImageEditorUploadCapability([uploadRelationship()]);
    expect(result.status).toBe("PRESENT");
    expect(result.present).toBe(true);
    expect(result.uniqueSurface).toBe(true);
  });

  it("rejects an isolated hidden file input without a usable upload surface", () => {
    const result = resolveImageEditorUploadCapability([uploadRelationship({ usableSurface: false, surfaceSignal: "none" })]);
    expect(result.status).toBe("ABSENT");
    expect(result.present).toBe(false);
  });

  it("rejects two distinct usable upload surfaces as ambiguous", () => {
    const result = resolveImageEditorUploadCapability([
      uploadRelationship({ candidateId: "upload-0" }),
      uploadRelationship({ candidateId: "upload-1" })
    ]);
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.present).toBe(false);
    expect(result.uniqueSurface).toBe(false);
  });

  it("emits a bounded read-only pre-upload phase observation", async () => {
    const diagnostics: ImageEditorDiagnostic[] = [];
    const phaseSnapshot = {
      currentUrl: editorUrl,
      readyState: "complete",
      shellSignal: true,
      shellFingerprint: "pre-upload-shell",
      contentTypeSignal: "IMAGE_POST",
      securityVerificationPresent: false,
      loginPagePresent: false,
      preUploadSemanticSignalPresent: true,
      phaseTopology: {
        titleCandidateCount: 0,
        bodyCandidateCount: 0,
        uploadCandidateCount: 1,
        finalSubmitCandidateCount: 0,
        contenteditableCount: 0,
        textareaCount: 0,
        textInputCount: 0,
        fileInputCount: 1,
        buttonCount: 1,
        roleButtonCount: 0,
        semanticSignals: ["upload", "image"],
        stable: false
      },
      preUploadSemanticNodes: [{
        tagName: "DIV",
        normalizedText: "上传图片",
        role: null,
        visible: true,
        enabled: true,
        boundingBox: { x: 10, y: 20, width: 120, height: 40 },
        nearestInteractiveAncestorTag: "LABEL",
        nearestInteractiveAncestorRole: null
      }],
      uploadControlRelationships: [uploadRelationship()]
    };
    let evaluateCount = 0;
    const page = {
      url: () => editorUrl,
      evaluate: async () => {
        evaluateCount += 1;
        return phaseSnapshot;
      }
    } as unknown as Page;

    const result = await inspectImagePostEditorPhase(page, metadata, { maxWaitMs: 80, probeIntervalMs: 0, stableSampleCount: 2, emit: (event) => diagnostics.push(event) });

    expect(result.phase).toBe("IMAGE_POST_PRE_UPLOAD");
    expect(result.confidence).toBe("HIGH");
    expect(result.uploadCapabilityStatus).toBe("PRESENT");
    expect(result.preUploadSemanticNodes).toHaveLength(1);
    expect(result.phaseTopology.stable).toBe(true);
    expect(evaluateCount).toBeGreaterThanOrEqual(2);
    expect(diagnostics.some((event) => event.code === "IMAGE_EDITOR_PHASE_OBSERVED" && event.phase === "IMAGE_POST_PRE_UPLOAD")).toBe(true);
  });

  it("waits for a stable editor shell before discovering delayed controls", async () => {
    const diagnostics: ImageEditorDiagnostic[] = [];
    const result = await inspect([
      snapshot({ readyState: "loading", shellSignal: false, shellFingerprint: "loading" }),
      snapshot({ shellFingerprint: "shell-before-controls", titleCandidates: [], bodyCandidates: [], uploadCandidates: [], finalSubmitCandidates: [] }),
      snapshot({ shellFingerprint: "shell-with-controls" }),
      snapshot({ shellFingerprint: "shell-with-controls" })
    ], diagnostics);

    expect(result.shellStatus).toBe("IMAGE_EDITOR_SHELL_READY");
    expect(result.status).toBe("READY");
    expect(result.titleEditorDetected).toBe(true);
    expect(result.readinessSamples.length).toBeGreaterThanOrEqual(2);
    expect(diagnostics.map((event) => event.code)).toEqual(expect.arrayContaining([
      "IMAGE_EDITOR_INSPECTION_STARTED",
      "IMAGE_EDITOR_READINESS_SAMPLE",
      "IMAGE_EDITOR_SHELL_NOT_READY",
      "IMAGE_EDITOR_SHELL_READY",
      "IMAGE_EDITOR_CONTROLS_DISCOVERED",
      "IMAGE_EDITOR_INSPECTION_COMPLETED"
    ]));
  });

  it("returns a bounded shell timeout instead of editor_not_found", async () => {
    const diagnostics: ImageEditorDiagnostic[] = [];
    const result = await inspect([
      snapshot({ shellSignal: false, shellFingerprint: "loading" })
    ], diagnostics);

    expect(result.shellStatus).toBe("IMAGE_EDITOR_SHELL_TIMEOUT");
    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("IMAGE_EDITOR_SHELL_TIMEOUT");
    expect(result.failureStage).toBe("EDITOR_DISCOVERY");
    expect(diagnostics.at(-1)?.code).toBe("IMAGE_EDITOR_INSPECTION_FAILED");
  });

  it("fails closed for ambiguous, hidden, and disabled controls while allowing settings to be not applicable", async () => {
    const failingSnapshot = snapshot({
      titleCandidates: [candidate("title-0"), candidate("title-1")],
      bodyCandidates: [candidate("body-0", { visible: false })],
      uploadCandidates: [candidate("upload-0", { enabled: false })],
      publishSettingsCandidates: []
    });
    const result = await inspect([failingSnapshot, failingSnapshot]);

    expect(result.titleEditor.status).toBe("AMBIGUOUS");
    expect(result.titleEditorDetected).toBe(false);
    expect(result.bodyEditor.status).toBe("NOT_VISIBLE");
    expect(result.imageUploadControl.status).toBe("DISABLED");
    expect(result.publishSettingsArea.status).toBe("NOT_APPLICABLE");
    expect(result.finalSubmitControl.status).toBe("FOUND_UNIQUE");
    expect(result.failureCode).toBe("TITLE_EDITOR_AMBIGUOUS");
    expect(result.failureStage).toBe("EDITOR_DISCOVERY");
  });

  it("rejects video content type without clicking a tab", async () => {
    const result = await inspect([snapshot({ contentTypeSignal: "VIDEO" }), snapshot({ contentTypeSignal: "VIDEO" })]);

    expect(result.contentType).toBe("VIDEO");
    expect(result.contentTypeReady).toBe(false);
    expect(result.failureCode).toBe("CONTENT_TYPE_NOT_READY");
    expect(result.failureStage).toBe("EDITOR_DISCOVERY");
  });

  it("fails closed immediately on login or security verification evidence", async () => {
    const login = await inspect([snapshot({ loginPagePresent: true })]);
    const security = await inspect([snapshot({ securityVerificationPresent: true })]);

    expect(login.failureCode).toBe("AUTH_REDIRECTED_TO_LOGIN");
    expect(login.loginPagePresent).toBe(true);
    expect(security.failureCode).toBe("SECURITY_VERIFICATION_REQUIRED");
    expect(security.securityVerificationPresent).toBe(true);
  });

  it("does not expose body values or invoke interaction APIs in discovery evidence", async () => {
    const diagnostics: ImageEditorDiagnostic[] = [];
    await inspect([snapshot()], diagnostics);
    const serialized = JSON.stringify(diagnostics);

    expect(serialized).not.toContain("innerHTML");
    expect(serialized).not.toContain("outerHTML");
    expect(serialized).not.toContain("正文内容");
    expect(serialized).not.toContain("handler");
  });

  it("passes the PRE_UPLOAD contract without requiring post-upload controls", () => {
    const phase = {
      phase: "IMAGE_POST_PRE_UPLOAD" as const,
      confidence: "HIGH" as const,
      reason: "unique upload capability and stable pre-upload evidence",
      readinessSamples: [],
      contentType: "IMAGE_POST" as const,
      contentTypeReady: true,
      preUploadSemanticNodes: [{
        tagName: "DIV",
        normalizedText: "上传图片",
        role: "button",
        visible: true,
        enabled: true,
        boundingBox: { x: 1, y: 2, width: 120, height: 40 },
        nearestInteractiveAncestorTag: "DIV",
        nearestInteractiveAncestorRole: "button"
      }],
      uploadControlRelationships: [uploadRelationship()],
      uploadCapabilityStatus: "PRESENT" as const,
      uploadCapabilityPresent: true,
      uploadCapabilityUnique: true,
      phaseTopology: {
        titleCandidateCount: 0,
        bodyCandidateCount: 0,
        uploadCandidateCount: 1,
        finalSubmitCandidateCount: 0,
        contenteditableCount: 0,
        textareaCount: 0,
        textInputCount: 0,
        fileInputCount: 1,
        buttonCount: 1,
        roleButtonCount: 1,
        semanticSignals: ["upload", "image"],
        stable: true
      },
      securityVerificationPresent: false,
      loginPagePresent: false,
      sanitizedUrl: editorUrl
    };

    expect(assertPreUploadImageEditorContract(phase)).toMatchObject({
      status: "PASS",
      expectedPhase: "IMAGE_POST_PRE_UPLOAD",
      observedPhase: "IMAGE_POST_PRE_UPLOAD",
      postUploadControlsStatus: "NOT_APPLICABLE_BEFORE_UPLOAD"
    });
  });

  it("fails the PRE_UPLOAD contract when the upload capability is not unique", () => {
    const phase = {
      phase: "IMAGE_POST_PRE_UPLOAD" as const,
      confidence: "HIGH" as const,
      reason: "missing unique upload capability",
      readinessSamples: [],
      contentType: "IMAGE_POST" as const,
      contentTypeReady: true,
      preUploadSemanticNodes: [{
        tagName: "DIV",
        normalizedText: "上传图片",
        role: "button",
        visible: true,
        enabled: true,
        boundingBox: null,
        nearestInteractiveAncestorTag: null,
        nearestInteractiveAncestorRole: null
      }],
      uploadControlRelationships: [],
      uploadCapabilityStatus: "ABSENT" as const,
      uploadCapabilityPresent: false,
      uploadCapabilityUnique: false,
      phaseTopology: {
        titleCandidateCount: 0,
        bodyCandidateCount: 0,
        uploadCandidateCount: 0,
        finalSubmitCandidateCount: 0,
        contenteditableCount: 0,
        textareaCount: 0,
        textInputCount: 0,
        fileInputCount: 0,
        buttonCount: 0,
        roleButtonCount: 0,
        semanticSignals: ["upload"],
        stable: true
      },
      securityVerificationPresent: false,
      loginPagePresent: false,
      sanitizedUrl: editorUrl
    };

    expect(assertPreUploadImageEditorContract(phase)).toMatchObject({
      status: "FAIL",
      failureCode: "UPLOAD_CAPABILITY_NOT_VERIFIED",
      failureStage: "EDITOR_DISCOVERY",
      missingSignal: "image-upload-capability"
    });
  });

  it("keeps IMAGE_POST classification when supporting copy mentions video", () => {
    const classification = classifyImagePostEditorPhase(phaseEvidence());

    expect(classification.phase).toBe("IMAGE_POST_PRE_UPLOAD");
    expect(classification.confidence).toBe("HIGH");
  });

  it("discovers post-upload controls only after bounded post-upload readiness", async () => {
    const diagnostics: ImageEditorDiagnostic[] = [];
    const result = await inspectPostUploadImageEditor(pageFor([
      snapshot({
        shellFingerprint: "post-upload-shell",
        titleCandidates: [candidate("title-0")],
        bodyCandidates: [candidate("body-0", { tagName: "DIV", role: "textbox" })],
        uploadCandidates: [candidate("upload-0", { tagName: "INPUT", semanticSignal: "input[type=file]" })],
        finalSubmitCandidates: [candidate("submit-0", { tagName: "BUTTON", semanticSignal: "final-submit-label" })]
      }),
      snapshot({
        shellFingerprint: "post-upload-shell",
        titleCandidates: [candidate("title-0")],
        bodyCandidates: [candidate("body-0", { tagName: "DIV", role: "textbox" })],
        uploadCandidates: [candidate("upload-0", { tagName: "INPUT", semanticSignal: "input[type=file]" })],
        finalSubmitCandidates: [candidate("submit-0", { tagName: "BUTTON", semanticSignal: "final-submit-label" })]
      })
    ]), metadata, {
      maxWaitMs: 80,
      probeIntervalMs: 0,
      stableSampleCount: 2,
      emit: (event) => diagnostics.push(event)
    });

    expect(result).toMatchObject({
      status: "READY",
      phase: "IMAGE_POST_POST_UPLOAD_EDITOR",
      postUploadControlsStatus: "READY"
    });
    expect(result.readinessSamples).toEqual(expect.arrayContaining([
      expect.objectContaining({ titleCandidateCount: 1, bodyCandidateCount: 1, finalSubmitCandidateCount: 1 })
    ]));
    expect(diagnostics.map((event) => event.code)).toEqual(expect.arrayContaining([
      "POST_UPLOAD_EDITOR_READINESS_STARTED",
      "POST_UPLOAD_EDITOR_READINESS_SAMPLE",
      "POST_UPLOAD_EDITOR_PHASE_OBSERVED",
      "POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED",
      "POST_UPLOAD_EDITOR_INSPECTION_COMPLETED"
    ]));
  });

  it("fails closed when upload completion remains busy", async () => {
    const result = await inspectPostUploadImageEditor(pageFor([
      snapshot({ uploadBusy: true, previewReady: false }),
      snapshot({ uploadBusy: true, previewReady: false })
    ]), metadata, { maxWaitMs: 80, probeIntervalMs: 0, stableSampleCount: 2 });

    expect(result.status).toBe("FAILED");
    expect(result.phase).toBe("IMAGE_POST_TRANSITIONING");
    expect(result.failureCode).toBe("POST_UPLOAD_EDITOR_TIMEOUT");
    expect(result.postUploadControlsStatus).toBe("FAIL");
  });

  it("does not treat stable DOM as a terminal post-upload state while phase is transitioning", () => {
    const result = classifyPostUploadImageEditorState({
      shellReady: true,
      contentType: "IMAGE_POST",
      contentTypeReady: true,
      domStable: true,
      loginPagePresent: false,
      securityVerificationPresent: false,
      uploadBusy: false,
      previewReady: true,
      previewCount: 1,
      mediaPreviewSignalPresent: false,
      mediaEditingSignalPresent: false,
      modalVisible: false,
      intermediateActionSignalPresent: false,
      titleCandidateCount: 0,
      bodyCandidateCount: 0,
      finalSubmitCandidateCount: 0
    });

    expect(result.phase).toBe("IMAGE_POST_TRANSITIONING");
    expect(result.terminalStateReached).toBe(false);
  });

  it("recognizes a stable media preview as an explicit intermediate state without interaction", () => {
    const result = classifyPostUploadImageEditorState({
      shellReady: true,
      contentType: "IMAGE_POST",
      contentTypeReady: true,
      domStable: true,
      loginPagePresent: false,
      securityVerificationPresent: false,
      uploadBusy: false,
      previewReady: true,
      previewCount: 1,
      mediaPreviewSignalPresent: true,
      mediaEditingSignalPresent: false,
      modalVisible: false,
      intermediateActionSignalPresent: true,
      titleCandidateCount: 0,
      bodyCandidateCount: 0,
      finalSubmitCandidateCount: 0
    });

    expect(result.phase).toBe("IMAGE_POST_MEDIA_PREVIEW");
    expect(result.terminalStateReached).toBe(true);
    expect(result.intermediateState).toBe("IMAGE_POST_MEDIA_PREVIEW");
  });

  it("recognizes confirmation-required state without clicking the intermediate action", () => {
    const result = classifyPostUploadImageEditorState({
      shellReady: true,
      contentType: "IMAGE_POST",
      contentTypeReady: true,
      domStable: true,
      loginPagePresent: false,
      securityVerificationPresent: false,
      uploadBusy: false,
      previewReady: true,
      previewCount: 1,
      mediaPreviewSignalPresent: false,
      mediaEditingSignalPresent: false,
      modalVisible: true,
      intermediateActionSignalPresent: true,
      titleCandidateCount: 0,
      bodyCandidateCount: 0,
      finalSubmitCandidateCount: 0
    });

    expect(result.phase).toBe("IMAGE_POST_CONFIRMATION_REQUIRED");
    expect(result.terminalStateReached).toBe(true);
    expect(result.intermediateState).toBe("IMAGE_POST_CONFIRMATION_REQUIRED");
  });

  it("stops on an intermediate state before discovering post-upload controls", async () => {
    const diagnostics: ImageEditorDiagnostic[] = [];
    const intermediateAction = { candidateId: "continue-0", tagName: "BUTTON", role: "button", semanticSignal: "继续", visible: true, enabled: true };
    const result = await inspectPostUploadImageEditor(pageFor([
      snapshot({
        titleCandidates: [],
        bodyCandidates: [],
        finalSubmitCandidates: [],
        modalDiagnostics: { dialogCount: 1, modalSignalCount: 1, maskCount: 0, overlayCount: 0, drawerCount: 0, visible: true, ariaModalCount: 1 },
        intermediateActionCandidates: [intermediateAction],
        mediaPreviewSignalPresent: true
      }),
      snapshot({
        titleCandidates: [],
        bodyCandidates: [],
        finalSubmitCandidates: [],
        modalDiagnostics: { dialogCount: 1, modalSignalCount: 1, maskCount: 0, overlayCount: 0, drawerCount: 0, visible: true, ariaModalCount: 1 },
        intermediateActionCandidates: [intermediateAction],
        mediaPreviewSignalPresent: true
      })
    ]), metadata, {
      maxWaitMs: 80,
      probeIntervalMs: 0,
      stableSampleCount: 2,
      emit: (event) => diagnostics.push(event)
    });

    expect(result.phase).toBe("IMAGE_POST_CONFIRMATION_REQUIRED");
    expect(result.failureCode).toBe("POST_UPLOAD_INTERMEDIATE_ACTION_REQUIRED");
    expect(diagnostics.map((event) => event.code)).not.toContain("POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED");
    expect(diagnostics.map((event) => event.code)).toContain("POST_UPLOAD_EDITOR_MODAL_STATE_OBSERVED");
  });

  it("waits beyond stable transitioning samples and gives phase-first failure", async () => {
    const result = await inspectPostUploadImageEditor(pageFor([
      snapshot({ titleCandidates: [], bodyCandidates: [], finalSubmitCandidates: [], previewReady: true }),
      snapshot({ titleCandidates: [], bodyCandidates: [], finalSubmitCandidates: [], previewReady: true })
    ]), metadata, { maxWaitMs: 12, probeIntervalMs: 0, stableSampleCount: 2 });

    expect(result.phase).toBe("IMAGE_POST_TRANSITIONING");
    expect(result.failureCode).toBe("POST_UPLOAD_EDITOR_TIMEOUT");
    expect(result.failureCode).not.toBe("TITLE_EDITOR_NOT_FOUND_POST_UPLOAD");
  });

  it("continues readiness until the terminal post-upload editor appears", async () => {
    const result = await inspectPostUploadImageEditor(pageFor([
      snapshot({ titleCandidates: [], bodyCandidates: [], finalSubmitCandidates: [], previewReady: true }),
      snapshot({ titleCandidates: [], bodyCandidates: [], finalSubmitCandidates: [], previewReady: true }),
      snapshot({ previewReady: true }),
      snapshot({ previewReady: true })
    ]), metadata, { maxWaitMs: 80, probeIntervalMs: 0, stableSampleCount: 2 });

    expect(result.status).toBe("READY");
    expect(result.phase).toBe("IMAGE_POST_POST_UPLOAD_EDITOR");
    expect(result.postUploadControlsStatus).toBe("READY");
  });
});
