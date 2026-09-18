import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  activateXiaohongshuImagePostEntry,
  inspectXiaohongshuImagePostEntry,
  type XiaohongshuImagePostEntryInspectionPayload
} from "./publish-clickable-surface";

const homeUrl = "https://creator.xiaohongshu.com/new/home";
const imageEditorUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image";

function payload(overrides: Partial<XiaohongshuImagePostEntryInspectionPayload> = {}): XiaohongshuImagePostEntryInspectionPayload {
  return {
    pageOrigin: "https://creator.xiaohongshu.com",
    pathname: "/new/home",
    exactTextMatchCount: 1,
    target: {
      tagName: "DIV",
      role: null,
      tabIndex: -1,
      visible: true,
      enabled: true,
      disabled: false,
      connected: true,
      boundingBox: { x: 10, y: 20, width: 160, height: 48 },
      style: { display: "block", visibility: "visible", pointerEvents: "auto", cursor: "pointer", userSelect: "none" },
      ancestorChain: [{ tagName: "DIV", role: null, tabIndex: -1, hrefPresent: false, onclickPropertyPresent: false, cursor: "default", pointerEvents: "auto" }]
    },
    ...overrides
  };
}

type FakeLocator = {
  count: () => Promise<number>;
  isVisible: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  evaluate: <T>(pageFunction: (element: unknown) => T) => Promise<T>;
  click: () => Promise<void>;
};

type FakePage = {
  url: () => string;
  isClosed: () => boolean;
  evaluate: <T>(pageFunction: (...args: never[]) => T) => Promise<unknown>;
  getByText: (text: string, options: { exact: true }) => FakeLocator;
};

function pageWithPayload(currentPayload: XiaohongshuImagePostEntryInspectionPayload, clickUrl?: string, initialUrl = homeUrl): { page: Page; locator: FakeLocator; clickCount: () => number } {
  let currentUrl = initialUrl;
  let clicks = 0;
  const locator: FakeLocator = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    boundingBox: vi.fn(async () => currentPayload.target?.boundingBox ?? null),
    evaluate: async <T,>(pageFunction: (element: unknown) => T): Promise<T> => pageFunction({}),
    click: vi.fn(async () => {
      clicks += 1;
      if (clickUrl) currentUrl = clickUrl;
    })
  };
  const page: FakePage = {
    url: () => currentUrl,
    isClosed: () => false,
    evaluate: vi.fn(async () => currentPayload),
    getByText: vi.fn(() => locator)
  };
  return { page: page as unknown as Page, locator, clickCount: () => clicks };
}

describe("XHS exact image-post entry activation", () => {
  it("allows a unique visible clickable DIV without native button semantics", async () => {
    const result = await inspectXiaohongshuImagePostEntry(pageWithPayload(payload()).page);

    expect(result).toMatchObject({ inspectionStatus: "PASS", exactTextMatchCount: 1, safeToTestClick: true, target: { tagName: "DIV", role: null, tabIndex: -1 } });
  });

  it("keeps the exact inspection function executable across the Page.evaluate serialization boundary", async () => {
    const fixture = pageWithPayload(payload());
    const page = fixture.page as unknown as {
      evaluate: <T>(pageFunction: (...args: never[]) => T) => Promise<unknown>;
    };
    page.evaluate = vi.fn(async (pageFunction: (...args: never[]) => unknown) => {
      if (String(pageFunction).includes("MAX_IMAGE_POST_ENTRY_")) throw new Error("browser isolate cannot resolve Main closure constants");
      return payload();
    });

    const result = await inspectXiaohongshuImagePostEntry(fixture.page);

    expect(result).toMatchObject({
      inspectionStatus: "PASS",
      safeToTestClick: true,
      pageCapabilities: { exists: true, hasUrl: true, hasIsClosed: true, hasEvaluate: true }
    });
  });

  it("fails closed with a bounded capability reason for a serialized Page snapshot", async () => {
    const snapshot = { url: homeUrl, isClosed: false } as unknown as Page;

    const result = await inspectXiaohongshuImagePostEntry(snapshot);

    expect(result).toMatchObject({
      inspectionStatus: "FAIL",
      safeToTestClick: false,
      failureCode: "PAGE_EVALUATION_UNAVAILABLE",
      evaluationFailureReason: "EVALUATE_METHOD_MISSING",
      pageCapabilities: { typeofPage: "object", exists: true, hasUrl: false, hasIsClosed: false, hasEvaluate: false }
    });
  });

  it.each([
    ["zero match", { exactTextMatchCount: 0 }],
    ["multiple matches", { exactTextMatchCount: 2 }],
    ["hidden target", { target: { ...payload().target!, visible: false } }],
    ["pointer-events none", { target: { ...payload().target!, style: { ...payload().target!.style, pointerEvents: "none" } } }],
    ["zero-size target", { target: { ...payload().target!, boundingBox: { x: 0, y: 0, width: 0, height: 0 } } }],
    ["wrong pathname", { pathname: "/new/other" }]
  ] as const)("fails closed for %s", async (_label, overrides) => {
    const result = await inspectXiaohongshuImagePostEntry(pageWithPayload(payload(overrides)).page);

    expect(result.inspectionStatus).toBe("FAIL");
    expect(result.safeToTestClick).toBe(false);
  });

  it("clicks the unique exact node once and requires the image target route", async () => {
    const fixture = pageWithPayload(payload(), imageEditorUrl);
    const result = await activateXiaohongshuImagePostEntry(fixture.page, { navigationClickCount: 0 });

    expect(result).toMatchObject({ status: "ACTIVATED", clickCount: 1, observedTarget: "image", routeReadback: "PASS" });
    expect(fixture.locator.click).toHaveBeenCalledTimes(1);
    expect(fixture.clickCount()).toBe(1);
  });

  it("rejects a video target after the single click and never treats it as image", async () => {
    const fixture = pageWithPayload(payload(), "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video");
    const result = await activateXiaohongshuImagePostEntry(fixture.page, { navigationClickCount: 0 });

    expect(result).toMatchObject({ status: "REJECTED", clickCount: 1, observedTarget: "video", routeReadback: "FAIL" });
    expect(fixture.locator.click).toHaveBeenCalledTimes(1);
  });

  it("fails closed on no-effect and refuses a second click", async () => {
    const fixture = pageWithPayload(payload());
    const first = await activateXiaohongshuImagePostEntry(fixture.page, { navigationClickCount: 0 });
    const second = await activateXiaohongshuImagePostEntry(fixture.page, { navigationClickCount: first.clickCount });

    expect(first).toMatchObject({ status: "NO_EFFECT", clickCount: 1, routeReadback: "FAIL" });
    expect(second).toMatchObject({ status: "REJECTED", clickCount: 1, failureCode: "CLICK_ALREADY_USED" });
    expect(fixture.locator.click).toHaveBeenCalledTimes(1);
  });

  it("does not activate an arbitrary popup or a non-home page", async () => {
    const fixture = pageWithPayload(payload(), imageEditorUrl, imageEditorUrl);
    const result = await activateXiaohongshuImagePostEntry(fixture.page, { navigationClickCount: 0 });

    expect(result.status).toBe("REJECTED");
    expect(result.failureCode).toBe("NOT_CREATOR_HOME");
    expect(fixture.locator.click).not.toHaveBeenCalled();
  });
});
