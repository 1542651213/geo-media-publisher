import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { chromium, type Page } from "playwright-core";
import {
  collectCreatorHomeTopology,
  collectPublishSemanticNodes,
  inspectCreatorHomeReadiness,
  observeCreatorHomeReadiness,
  type XiaohongshuCreatorHomeTopology,
  type XiaohongshuHomeReadinessSnapshot,
  type XiaohongshuPublishSemanticNodeCollection
} from "./browser";

type SnapshotPayload = Omit<XiaohongshuHomeReadinessSnapshot, "result" | "elapsedSinceNavigationMs"> & { elapsedSinceNavigationMs?: number };

function pageWithEvaluate<T>(payload: T, url = "https://creator.xiaohongshu.com/new/home"): Page & { click: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn> } {
  return {
    url: vi.fn(() => url),
    evaluate: vi.fn(async <R>(_pageFunction: unknown): Promise<R> => payload as unknown as R),
    waitForTimeout: vi.fn(async () => undefined),
    click: vi.fn(),
    fill: vi.fn(),
    locator: vi.fn(),
    frames: vi.fn(() => [])
  } as unknown as Page & { click: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn> };
}

function pageWithSnapshots(snapshots: SnapshotPayload[]): Page {
  let index = 0;
  return {
    url: vi.fn(() => "https://creator.xiaohongshu.com/new/home"),
    evaluate: vi.fn(async <R>(_pageFunction: unknown): Promise<R> => {
      const payload = snapshots[Math.min(index++, snapshots.length - 1)];
      return payload as unknown as R;
    }),
    waitForTimeout: vi.fn(async () => undefined),
    locator: vi.fn(),
    frames: vi.fn(() => [])
  } as unknown as Page;
}

function snapshot(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    documentReadyState: "complete",
    currentUrl: "https://creator.xiaohongshu.com/new/home",
    bodyExists: true,
    bodyChildCount: 3,
    documentElementChildCount: 2,
    anchorCount: 1,
    buttonCount: 2,
    roleButtonCount: 1,
    tabbableCount: 3,
    navigationElementCount: 1,
    iframeCount: 0,
    shadowHostCount: 0,
    visibleInteractiveCount: 3,
    creatorShellSignalCount: 2,
    publishSemanticTextSignalCount: 0,
    ...overrides
  };
}

describe("Xiaohongshu Creator Home diagnostics", () => {
  it("classifies an empty /new/home document as shell not ready without requiring a publish entry", async () => {
    const page = pageWithEvaluate(snapshot({ bodyExists: false, bodyChildCount: 0, documentElementChildCount: 0, visibleInteractiveCount: 0, creatorShellSignalCount: 0 }));
    await expect(inspectCreatorHomeReadiness(page)).resolves.toMatchObject({ result: "HOME_SHELL_NOT_READY", bodyExists: false, publishSemanticTextSignalCount: 0 });
  });

  it("classifies a populated stable shell as ready even when no publish entry is present", async () => {
    const page = pageWithEvaluate(snapshot());
    await expect(inspectCreatorHomeReadiness(page)).resolves.toMatchObject({ result: "HOME_SHELL_READY", visibleInteractiveCount: 3, publishSemanticTextSignalCount: 0 });
  });

  it("detects a delayed shell during bounded observation", async () => {
    const page = pageWithSnapshots([
      snapshot({ bodyChildCount: 0, anchorCount: 0, buttonCount: 0, roleButtonCount: 0, tabbableCount: 0, navigationElementCount: 0, visibleInteractiveCount: 0, creatorShellSignalCount: 0 }),
      snapshot(),
      snapshot()
    ]);
    const result = await observeCreatorHomeReadiness(page, { maxObservationMs: 100, sampleIntervalMs: 0 });
    expect(result.result).toBe("HOME_SHELL_READY");
    expect(result.samples.length).toBeGreaterThanOrEqual(2);
  });

  it("returns timeout when the shell never renders within the bound", async () => {
    const page = pageWithSnapshots([snapshot({ bodyChildCount: 0, anchorCount: 0, buttonCount: 0, roleButtonCount: 0, tabbableCount: 0, navigationElementCount: 0, visibleInteractiveCount: 0, creatorShellSignalCount: 0 })]);
    const result = await observeCreatorHomeReadiness(page, { maxObservationMs: 1, sampleIntervalMs: 0, maxSamples: 3 });
    expect(result.result).toBe("HOME_SHELL_TIMEOUT");
    expect(result.samples.length).toBeLessThanOrEqual(3);
  });

  it("preserves a bounded topology summary and interactive element type counts", async () => {
    const topology: XiaohongshuCreatorHomeTopology = {
      topLevelElementCounts: { DIV: 2, NAV: 1, ASIDE: 1 },
      interactiveElementTypeCounts: { a: 1, button: 0, "role=button": 0, "role=menuitem": 1, "role=link": 1, "role=tab": 0, "[tabindex]": 1, nav: 1, aside: 1 },
      frameCount: 0,
      frameSummary: [],
      shadowHostCount: 0,
      shadowSummary: [],
      publishEntryLocation: "MAIN_DOCUMENT",
      publishSemanticSignalPresent: false
    };
    const page = pageWithEvaluate(topology);
    await expect(collectCreatorHomeTopology(page)).resolves.toEqual(topology);
  });

  it("records a semantic publish text inside a clickable div's nearest interactive ancestor", async () => {
    const semantic: XiaohongshuPublishSemanticNodeCollection = {
      textSignalPresent: true,
      candidateCount: 1,
      truncated: false,
      nodes: [{
        index: 0,
        tagName: "SPAN",
        role: null,
        normalizedVisibleText: "发布笔记",
        ariaLabel: null,
        title: null,
        sanitizedHref: null,
        tabIndex: -1,
        visible: true,
        enabled: true,
        parentTag: "DIV",
        parentRole: null,
        nearestInteractiveAncestorTag: "DIV",
        nearestInteractiveAncestorRole: null,
        nearestInteractiveAncestorHref: null,
        nearestInteractiveAncestorHasOnclick: true,
        stableDataAttributes: { "data-testid": "publish-entry" }
      }],
      discoveryDiagnosis: "PUBLISH_ENTRY_OUTSIDE_LEGACY_ELEMENT_TYPES"
    };
    const page = pageWithEvaluate(semantic);
    await expect(collectPublishSemanticNodes(page)).resolves.toMatchObject({ textSignalPresent: true, candidateCount: 1, nodes: [{ nearestInteractiveAncestorTag: "DIV", nearestInteractiveAncestorHasOnclick: true }] });
  });

  it("classifies publish text without an interactive ancestor", async () => {
    const page = pageWithEvaluate({ textSignalPresent: true, candidateCount: 1, truncated: false, nodes: [{ index: 0, tagName: "SPAN", role: null, normalizedVisibleText: "发布笔记", ariaLabel: null, title: null, sanitizedHref: null, tabIndex: -1, visible: true, enabled: true, parentTag: "P", parentRole: null, nearestInteractiveAncestorTag: null, nearestInteractiveAncestorRole: null, nearestInteractiveAncestorHref: null, nearestInteractiveAncestorHasOnclick: false, stableDataAttributes: {} }], discoveryDiagnosis: "PUBLISH_ENTRY_TEXT_PRESENT_NO_INTERACTIVE_ANCESTOR" } satisfies XiaohongshuPublishSemanticNodeCollection);
    await expect(collectPublishSemanticNodes(page)).resolves.toMatchObject({ discoveryDiagnosis: "PUBLISH_ENTRY_TEXT_PRESENT_NO_INTERACTIVE_ANCESTOR", nodes: [{ nearestInteractiveAncestorTag: null }] });
  });

  it.each([
    ["menuitem", "role=menuitem"],
    ["link", "role=link"]
  ])("retains %s topology roles", async (_label, role) => {
    const topology = { topLevelElementCounts: {}, interactiveElementTypeCounts: { a: 0, button: 0, "role=button": 0, "role=menuitem": role === "role=menuitem" ? 1 : 0, "role=link": role === "role=link" ? 1 : 0, "role=tab": 0, "[tabindex]": 0, nav: 0, aside: 0 }, frameCount: 0, frameSummary: [], shadowHostCount: 0, shadowSummary: [], publishEntryLocation: "MAIN_DOCUMENT", publishSemanticSignalPresent: true } satisfies XiaohongshuCreatorHomeTopology;
    await expect(collectCreatorHomeTopology(pageWithEvaluate(topology))).resolves.toMatchObject({ interactiveElementTypeCounts: { [role]: 1 } });
  });

  it("reports a same-origin iframe as a possible publish-entry location without clicking", async () => {
    const topology = { topLevelElementCounts: {}, interactiveElementTypeCounts: { a: 0, button: 0, "role=button": 0, "role=menuitem": 0, "role=link": 0, "role=tab": 0, "[tabindex]": 0, nav: 0, aside: 0 }, frameCount: 1, frameSummary: [{ index: 0, sanitizedUrl: "https://creator.xiaohongshu.com/frame", name: "creator-shell", sameOrigin: true, crossOrigin: false, publishSemanticSignalPresent: true }], shadowHostCount: 0, shadowSummary: [], publishEntryLocation: "SAME_ORIGIN_IFRAME", publishSemanticSignalPresent: true } satisfies XiaohongshuCreatorHomeTopology;
    await expect(collectCreatorHomeTopology(pageWithEvaluate(topology))).resolves.toMatchObject({ publishEntryLocation: "SAME_ORIGIN_IFRAME", frameSummary: [{ sameOrigin: true, publishSemanticSignalPresent: true }] });
  });

  it("records only safe metadata for a cross-origin iframe", async () => {
    const topology = { topLevelElementCounts: {}, interactiveElementTypeCounts: { a: 0, button: 0, "role=button": 0, "role=menuitem": 0, "role=link": 0, "role=tab": 0, "[tabindex]": 0, nav: 0, aside: 0 }, frameCount: 1, frameSummary: [{ index: 0, sanitizedUrl: "https://external.example/frame", name: "external", sameOrigin: false, crossOrigin: true, publishSemanticSignalPresent: false }], shadowHostCount: 0, shadowSummary: [], publishEntryLocation: "MAIN_DOCUMENT", publishSemanticSignalPresent: false } satisfies XiaohongshuCreatorHomeTopology;
    const result = await collectCreatorHomeTopology(pageWithEvaluate(topology));
    expect(result.frameSummary[0]).toMatchObject({ sameOrigin: false, crossOrigin: true });
    expect(JSON.stringify(result.frameSummary[0])).not.toMatch(/innerHTML|cookie|storage|token/iu);
  });

  it("reports an open shadow host and bounded semantic inspection", async () => {
    const topology = { topLevelElementCounts: {}, interactiveElementTypeCounts: { a: 0, button: 0, "role=button": 0, "role=menuitem": 0, "role=link": 0, "role=tab": 0, "[tabindex]": 0, nav: 0, aside: 0 }, frameCount: 0, frameSummary: [], shadowHostCount: 1, shadowSummary: [{ hostTag: "X-CREATOR-SHELL", role: null, stableDataAttributes: {}, open: true, publishSemanticSignalPresent: true }], publishEntryLocation: "SHADOW_DOM", publishSemanticSignalPresent: true } satisfies XiaohongshuCreatorHomeTopology;
    await expect(collectCreatorHomeTopology(pageWithEvaluate(topology))).resolves.toMatchObject({ shadowHostCount: 1, publishEntryLocation: "SHADOW_DOM", shadowSummary: [{ open: true, publishSemanticSignalPresent: true }] });
  });

  it("classifies a stable shell with no publish text as truly not observed", async () => {
    const semantic = { textSignalPresent: false, candidateCount: 0, truncated: false, nodes: [], discoveryDiagnosis: "PUBLISH_ENTRY_TRULY_NOT_OBSERVED" } satisfies XiaohongshuPublishSemanticNodeCollection;
    await expect(collectPublishSemanticNodes(pageWithEvaluate(semantic))).resolves.toMatchObject({ candidateCount: 0, discoveryDiagnosis: "PUBLISH_ENTRY_TRULY_NOT_OBSERVED" });
  });

  it("bounds semantic nodes and exposes no HTML or sensitive storage fields", async () => {
    const node = { index: 0, tagName: "BUTTON", role: "button", normalizedVisibleText: "发布图文", ariaLabel: "发布图文", title: null, sanitizedHref: null, tabIndex: 0, visible: true, enabled: true, parentTag: "NAV", parentRole: "navigation", nearestInteractiveAncestorTag: "BUTTON", nearestInteractiveAncestorRole: "button", nearestInteractiveAncestorHref: null, nearestInteractiveAncestorHasOnclick: false, stableDataAttributes: { "data-testid": "publish-entry" } };
    const semantic = { textSignalPresent: true, candidateCount: 20, truncated: true, nodes: Array.from({ length: 20 }, (_, index) => ({ ...node, index })), discoveryDiagnosis: "PUBLISH_ENTRY_OUTSIDE_LEGACY_ELEMENT_TYPES" } satisfies XiaohongshuPublishSemanticNodeCollection;
    const result = await collectPublishSemanticNodes(pageWithEvaluate(semantic));
    expect(result.nodes).toHaveLength(20);
    expect(JSON.stringify(result)).not.toMatch(/innerHTML|outerHTML|localStorage|sessionStorage|cookie|token/iu);
  });

  it("does not click, fill, type, upload, or submit while collecting diagnostics", async () => {
    const page = pageWithEvaluate(snapshot()) as Page & { click: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn> };
    await inspectCreatorHomeReadiness(page);
    await collectCreatorHomeTopology(page);
    await collectPublishSemanticNodes(page);
    expect(page.click).not.toHaveBeenCalled();
    expect(page.fill).not.toHaveBeenCalled();
  });

  it("preserves sample fields needed for operation-correlated readiness events", async () => {
    const page = pageWithSnapshots([snapshot(), snapshot()]);
    const result = await observeCreatorHomeReadiness(page, { maxObservationMs: 100, sampleIntervalMs: 0 });
    expect(result.samples[0]).toEqual(expect.objectContaining({ sampleIndex: 0, elapsedMs: expect.any(Number), readyState: "complete", bodyChildCount: 3, interactiveCount: 3, navigationCount: 1, publishSemanticTextSignalCount: 0 }));
  });

  it("caps maxSamples even when a caller requests an unbounded tight loop", async () => {
    const page = pageWithSnapshots([snapshot({ bodyChildCount: 0, anchorCount: 0, buttonCount: 0, roleButtonCount: 0, tabbableCount: 0, navigationElementCount: 0, visibleInteractiveCount: 0, creatorShellSignalCount: 0 })]);
    const result = await observeCreatorHomeReadiness(page, { maxObservationMs: 1000, sampleIntervalMs: 0, maxSamples: 100000 });
    expect(result.samples.length).toBeLessThanOrEqual(32);
  });

  it("fails a stalled page evaluation closed within the diagnostics timeout", async () => {
    const page = {
      url: vi.fn(() => "https://creator.xiaohongshu.com/new/home"),
      evaluate: vi.fn(async () => await new Promise<unknown>(() => undefined))
    } as unknown as Page;
    await expect(inspectCreatorHomeReadiness(page)).resolves.toMatchObject({ result: "HOME_SHELL_NOT_READY" });
  });

  const chromeExecutable = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  it.skipIf(!existsSync(chromeExecutable))("executes the real read-only DOM evaluator against a local non-XHS fixture", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
    try {
      const page = await browser.newPage();
      await page.setContent("<nav><div role='menuitem' tabindex='0'><span>发布笔记</span></div></nav>");
      await page.evaluate(() => {
        const host = document.createElement("x-creator-shell");
        const root = host.attachShadow({ mode: "open" });
        const button = document.createElement("button");
        button.textContent = "图文";
        root.append(button);
        document.body.append(host);
      });
      const topology = await collectCreatorHomeTopology(page);
      const semantic = await collectPublishSemanticNodes(page);
      expect(topology).toMatchObject({ publishEntryLocation: "SHADOW_DOM", shadowHostCount: 1, publishSemanticSignalPresent: true });
      expect(semantic).toMatchObject({ textSignalPresent: true });
      expect(semantic.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ normalizedVisibleText: expect.stringContaining("发布笔记"), nearestInteractiveAncestorRole: "menuitem" })
      ]));
    } finally {
      await browser.close();
    }
  });
});
