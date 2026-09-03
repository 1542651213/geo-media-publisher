import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  inspectXiaohongshuPostUploadReconciliationDom,
  reconcileXiaohongshuPostUploadSnapshot,
  type XiaohongshuPostUploadReconciliationDomSnapshot
} from "./post-upload-reconciliation-diagnostic";

const visibleImageItem = {
  tagName: "IMG",
  classNameSafe: "note-image-preview",
  boundingRect: { x: 20, y: 80, width: 160, height: 160 },
  display: "block",
  visibility: "visible",
  pointerEvents: "auto",
  imgPresent: true,
  imgNaturalWidth: 1080,
  imgNaturalHeight: 1440,
  complete: true,
  blobUrlPresent: true,
  dataUrlPresent: false,
  backgroundImagePresent: false,
  connected: true,
  visible: true
} as const;

function snapshot(overrides: Partial<XiaohongshuPostUploadReconciliationDomSnapshot> = {}): XiaohongshuPostUploadReconciliationDomSnapshot {
  return {
    origin: "https://creator.xiaohongshu.com",
    pathname: "/publish/publish",
    readyState: "complete",
    editorRegionPresent: true,
    imageItems: [visibleImageItem],
    visibleImageItemCount: 1,
    imageCounterTextSafe: "1/18",
    addImageControlPresent: true,
    deleteImageControlCount: 1,
    titleControlMatchCount: 1,
    titleControlVisible: true,
    bodyControlMatchCount: 1,
    bodyControlVisible: true,
    finalSubmitCandidateCount: 0,
    finalSubmitVisibleCount: 0,
    finalSubmitProof: "NOT_PROVEN",
    explicitUploadErrorSignals: [],
    processingSignalPresent: false,
    ...overrides
  };
}

describe("Xiaohongshu post-upload reconciliation diagnostic", () => {
  it("confirms one rendered image with title/body without requiring final submit proof", () => {
    const result = reconcileXiaohongshuPostUploadSnapshot(snapshot());

    expect(result).toMatchObject({
      imageUploadReconciliation: "PASS",
      postUploadState: "EDITOR_READY",
      imageAssetRenderedCount: 1,
      titleControlPresent: true,
      bodyControlPresent: true,
      finalSubmitProof: "NOT_PROVEN"
    });
  });

  it("does not treat add-image alone or title/body alone as upload proof", () => {
    expect(reconcileXiaohongshuPostUploadSnapshot(snapshot({ imageItems: [], visibleImageItemCount: 0 }))).toMatchObject({
      imageUploadReconciliation: "NOT_VERIFIED",
      postUploadState: "AMBIGUOUS"
    });
    expect(reconcileXiaohongshuPostUploadSnapshot(snapshot({ imageItems: [], visibleImageItemCount: 0, addImageControlPresent: true }))).toMatchObject({
      imageUploadReconciliation: "NOT_VERIFIED",
      postUploadState: "AMBIGUOUS"
    });
  });

  it("classifies processing and explicit rejection without permitting a retry", () => {
    expect(reconcileXiaohongshuPostUploadSnapshot(snapshot({ imageItems: [], visibleImageItemCount: 0, processingSignalPresent: true }))).toMatchObject({
      imageUploadReconciliation: "PENDING",
      postUploadState: "PROCESSING"
    });
    expect(reconcileXiaohongshuPostUploadSnapshot(snapshot({ explicitUploadErrorSignals: ["上传失败"] }))).toMatchObject({
      imageUploadReconciliation: "FAIL",
      postUploadState: "REJECTED"
    });
  });

  it("keeps blob/data URL evidence boolean-only and never calls mutation APIs", async () => {
    const page = {
      evaluate: vi.fn(async () => snapshot())
    };

    const result = await inspectXiaohongshuPostUploadReconciliationDom(page as unknown as Page);

    expect(result.imageItems[0]).toMatchObject({ blobUrlPresent: true, dataUrlPresent: false });
    expect(JSON.stringify(result)).not.toMatch(/blob:|data:image|setInputFiles|click|goto|reload/iu);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it("uses a self-contained bounded evaluator with no caller-provided selector", async () => {
    const page = {
      evaluate: vi.fn(async (callback: () => unknown) => {
        expect(String(callback)).not.toMatch(/setInputFiles|filechooser|\.click\(|\.goto\(|reload/iu);
        return snapshot();
      })
    };

    await inspectXiaohongshuPostUploadReconciliationDom(page as unknown as Page);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.evaluate.mock.calls[0]).toHaveLength(1);
  });
});
