import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  inspectXiaohongshuPostUploadReconciliationDom,
  hasExactlyOneXiaohongshuSelectedImage,
  parseXiaohongshuImageCounterText,
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
  it("accepts only a sane editor image counter", () => {
    expect(parseXiaohongshuImageCounterText("1/18")).toEqual({ current: 1, total: 18 });
    expect(parseXiaohongshuImageCounterText("7 / 18")).toEqual({ current: 7, total: 18 });
    expect(parseXiaohongshuImageCounterText("0/18")).toBeNull();
    expect(parseXiaohongshuImageCounterText("1/0")).toBeNull();
    expect(parseXiaohongshuImageCounterText("1/18 ordinary page text")).toBeNull();
    expect(parseXiaohongshuImageCounterText(null)).toBeNull();
  });

  it("supports a server-backed reopened draft without blob or historical file evidence", () => {
    const result = reconcileXiaohongshuPostUploadSnapshot(snapshot({
      imageItems: [{ ...visibleImageItem, blobUrlPresent: false, dataUrlPresent: false, classNameSafe: "draft-server-image-preview" }],
      imageCounterTextSafe: "1/18"
    }));
    expect(result.imageUploadReconciliation).toBe("PASS");
    expect(result.imageItems[0]).toMatchObject({ blobUrlPresent: false, dataUrlPresent: false });
    expect(parseXiaohongshuImageCounterText(result.imageCounterTextSafe)).not.toBeNull();
  });
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

  it("uses the bounded editor counter to distinguish one selected image from repeated previews", () => {
    const repeatedPreview = reconcileXiaohongshuPostUploadSnapshot(snapshot({
      imageItems: [visibleImageItem, visibleImageItem, visibleImageItem, visibleImageItem],
      visibleImageItemCount: 4,
      imageCounterTextSafe: "1/18"
    }));
    expect(repeatedPreview.imageAssetRenderedCount).toBe(4);
    expect(hasExactlyOneXiaohongshuSelectedImage(repeatedPreview)).toBe(true);
    expect(hasExactlyOneXiaohongshuSelectedImage({ ...repeatedPreview, imageCounterTextSafe: "2/18" })).toBe(false);
    expect(hasExactlyOneXiaohongshuSelectedImage({ ...repeatedPreview, imageAssetRenderedCount: 0 })).toBe(false);
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
