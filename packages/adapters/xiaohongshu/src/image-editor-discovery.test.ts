import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import {
  inspectImagePostEditor,
  type ImageEditorDiagnostic,
  type ImageEditorDomSnapshot,
  type ImageEditorInspectionMetadata
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
});
