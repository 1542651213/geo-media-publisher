import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import type { BrowserSessionContextPage } from "@publisher/adapters-core";
import { inspectXiaohongshuContextPage, readXiaohongshuContextPageDomSnapshot } from "./context-page-inventory";

function entry(page: Page, pageIndex: number, pageDebugId: string, isCanonical: boolean): BrowserSessionContextPage {
  return { session: {} as BrowserSessionContextPage["session"], page, pageIndex, pageDebugId, isCanonical };
}

describe("XHS Context Page inventory", () => {
  it("returns only bounded editor/control facts and discards non-routing query parameters", async () => {
    const dom = {
      documentReadyState: "complete" as const,
      titleSafe: "小红书创作服务平台",
      visibilityState: "visible" as const,
      openerPresent: false,
      editorShellPresent: true,
      uploadImageTabPresent: true,
      currentSelectedTab: "上传图文" as const,
      imageUploadControlPresent: true,
      titleControlPresent: false,
      bodyControlPresent: false,
      finalSubmitControlPresent: false,
      contentType: "IMAGE_POST" as const,
      imageEditorPhase: "IMAGE_POST_PRE_UPLOAD" as const
    };
    const page = {
      isClosed: vi.fn(() => false),
      url: vi.fn(() => "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image&token=must-not-escape"),
      evaluate: vi.fn(async () => dom),
      frames: vi.fn(() => [{}]),
      opener: vi.fn(async () => null)
    } as unknown as Page;
    const inventoryEntry = await inspectXiaohongshuContextPage(entry(page, 1, "page-b", false), [entry(page, 1, "page-b", false)]);

    expect(inventoryEntry).toMatchObject({
      pageId: "page-b",
      isCanonical: false,
      urlOrigin: "https://creator.xiaohongshu.com",
      pathname: "/publish/publish",
      from: "menu",
      target: "image",
      source: null,
      documentReadyState: "complete",
      visibilityState: "visible",
      editorShellPresent: true,
      uploadImageTabPresent: true,
      currentSelectedTab: "上传图文",
      imageUploadControlPresent: true,
      contentType: "IMAGE_POST"
    });
    expect(inventoryEntry).not.toHaveProperty("token");
    expect(JSON.stringify(inventoryEntry)).not.toMatch(/bodyText|cookie|storage|authorization|response\s+body/iu);
  });

  it("fails closed to unknown DOM facts when a Page is closed or evaluation is unavailable", async () => {
    const closedPage = {
      isClosed: vi.fn(() => true),
      url: vi.fn(() => "https://creator.xiaohongshu.com/publish/publish?target=image"),
      evaluate: vi.fn(),
      frames: vi.fn(),
      opener: vi.fn()
    } as unknown as Page;
    const result = await inspectXiaohongshuContextPage(entry(closedPage, 0, "closed", true), [entry(closedPage, 0, "closed", true)]);
    expect(result).toMatchObject({ isClosed: true, pageId: "closed", pathname: "/publish/publish", target: "image", editorShellPresent: false, contentType: "UNKNOWN" });
    expect(closedPage.evaluate).not.toHaveBeenCalled();
  });

  it("does not expose arbitrary DOM text through the evaluator result", async () => {
    const page = { evaluate: vi.fn(async () => { throw new Error("DOM unavailable"); }) } as unknown as Page;
    const snapshot = await readXiaohongshuContextPageDomSnapshot(page);
    expect(snapshot).toMatchObject({ titleSafe: "", editorShellPresent: false, currentSelectedTab: null, contentType: "UNKNOWN" });
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|cookie|token|storage/iu);
  });
});
