import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { chromium, type Page } from "playwright-core";
import {
  collectExactPublishSemanticTargets,
  collectPublishAncestorChainDiagnostics,
  collectPublishClickableSurfaceDiagnostics,
  collectPublishNoteDropdownTriggerDiagnostics,
  collectExactImagePostMenuItems,
  collectPublishEventListenerDiagnostics,
  collectPublishHitTestDiagnostics,
  resolvePublishNoteDropdownTrigger,
  resolveExactImagePostMenuItem,
  resolvePublishClickableSurfaces,
  type XiaohongshuExactPublishSemanticTarget,
  type XiaohongshuPublishDropdownTriggerDiagnostic,
  type XiaohongshuImagePostMenuItemDiagnostic,
  type XiaohongshuPublishAncestorDiagnostic,
  type XiaohongshuPublishEventListenerInspection,
  type XiaohongshuPublishHitTestDiagnostic,
  type XiaohongshuPublishInteractionEvent
} from "./publish-clickable-surface";

const box = { x: 10, y: 20, width: 120, height: 40 };

function target(overrides: Partial<XiaohongshuExactPublishSemanticTarget> = {}): XiaohongshuExactPublishSemanticTarget {
  return {
    targetId: "target-0",
    tagName: "SPAN",
    exactText: "发布笔记",
    visible: true,
    boundingBox: box,
    parentTag: "DIV",
    depth: 0,
    ...overrides
  };
}

function ancestor(overrides: Partial<XiaohongshuPublishAncestorDiagnostic> = {}): XiaohongshuPublishAncestorDiagnostic {
  return {
    targetId: "target-0",
    surfaceId: "surface-0",
    depth: 1,
    tagName: "DIV",
    role: null,
    tabIndex: -1,
    ariaLabel: null,
    title: null,
    stableDataAttributes: { "data-testid": "publish-entry" },
    classTokens: ["publish-entry"],
    cursor: "pointer",
    pointerEvents: "auto",
    display: "block",
    visibility: "visible",
    visible: true,
    boundingBox: box,
    onclickAttributePresent: false,
    ...overrides
  };
}

function listenerInspection(
  targetId: string,
  surfaceId: string,
  depth: number,
  type: XiaohongshuPublishInteractionEvent = "click"
): XiaohongshuPublishEventListenerInspection {
  return {
    status: "AVAILABLE",
    targets: [{
      targetId,
      listeners: [{ eventType: type, listenerCount: 1, ancestorDepth: depth, surfaceId }]
    }]
  };
}

function hitTest(targetId: string, surfaceId: string, relation: "TARGET" | "ANCESTOR" | "DESCENDANT" | "UNRELATED" = "ANCESTOR"): XiaohongshuPublishHitTestDiagnostic {
  return {
    targetId,
    center: { x: 70, y: 40 },
    elements: [{
      surfaceId,
      tagName: "DIV",
      role: null,
      exactSemanticText: "发布笔记",
      ancestorRelation: relation
    }]
  };
}

function dropdownTrigger(overrides: Partial<XiaohongshuPublishDropdownTriggerDiagnostic> = {}): XiaohongshuPublishDropdownTriggerDiagnostic {
  return {
    triggerId: "xhs-publish-dropdown-trigger-42",
    targetId: "target-0",
    tagName: "BUTTON",
    role: "button",
    ariaHasPopup: "menu",
    ariaExpanded: "false",
    ariaLabel: "选择发布类型",
    title: null,
    visible: true,
    enabled: true,
    boundingBox: { x: 125, y: 20, width: 24, height: 40 },
    ...overrides
  };
}

function imagePostMenuItem(overrides: Partial<XiaohongshuImagePostMenuItemDiagnostic> = {}): XiaohongshuImagePostMenuItemDiagnostic {
  return {
    itemId: "xhs-publish-menu-item-42",
    tagName: "LI",
    role: "menuitem",
    exactText: "上传图文",
    visible: true,
    enabled: true,
    boundingBox: { x: 10, y: 70, width: 120, height: 32 },
    ...overrides
  };
}

function resolve(
  exactTargets: readonly XiaohongshuExactPublishSemanticTarget[],
  chains: readonly XiaohongshuPublishAncestorDiagnostic[],
  eventListeners: XiaohongshuPublishEventListenerInspection,
  hitTests: readonly XiaohongshuPublishHitTestDiagnostic[]
) {
  return resolvePublishClickableSurfaces({ exactTargets, ancestorChains: chains, eventListeners, hitTests });
}

describe("Xiaohongshu clickable publish surfaces", () => {
  it("requires the unique dropdown trigger instead of the publish-note primary action", () => {
    const exact = target();
    const result = resolvePublishNoteDropdownTrigger({
      exactTargets: [exact],
      dropdownTriggers: [dropdownTrigger({ targetId: exact.targetId })]
    });

    expect(result).toMatchObject({ status: "PROVEN_UNIQUE", trigger: { triggerId: "xhs-publish-dropdown-trigger-42", targetId: exact.targetId } });
    expect(result.trigger?.tagName).toBe("BUTTON");
  });

  it("fails closed when the publish-note dropdown trigger is missing or ambiguous", () => {
    const exact = target();
    expect(resolvePublishNoteDropdownTrigger({ exactTargets: [exact], dropdownTriggers: [] })).toMatchObject({ status: "NOT_FOUND", trigger: null });
    expect(resolvePublishNoteDropdownTrigger({ exactTargets: [exact], dropdownTriggers: [dropdownTrigger(), dropdownTrigger({ triggerId: "xhs-publish-dropdown-trigger-43" })] })).toMatchObject({ status: "AMBIGUOUS", trigger: null });
  });

  it("accepts only one exact visible enabled 上传图文 menu action", () => {
    expect(resolveExactImagePostMenuItem({ items: [imagePostMenuItem()] })).toMatchObject({ status: "PROVEN_UNIQUE", item: { exactText: "上传图文" } });
    expect(resolveExactImagePostMenuItem({ items: [] })).toMatchObject({ status: "NOT_FOUND", item: null });
    expect(resolveExactImagePostMenuItem({ items: [imagePostMenuItem(), imagePostMenuItem({ itemId: "xhs-publish-menu-item-43" })] })).toMatchObject({ status: "AMBIGUOUS", item: null });
  });

  it("proves a SPAN exact target through a parent DIV click listener", () => {
    const exact = target();
    const surface = ancestor();
    const result = resolve([exact], [surface], listenerInspection(exact.targetId, surface.surfaceId, surface.depth), [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.publishNoteSurface).toMatchObject({ status: "PROVEN_UNIQUE", confidence: "HIGH", surface: { surfaceId: "surface-0", ancestorDepth: 1 } });
  });

  it("proves a SPAN exact target through a grandparent listener", () => {
    const exact = target();
    const surface = ancestor({ surfaceId: "surface-2", depth: 2, tagName: "SECTION" });
    const result = resolve([exact], [ancestor({ surfaceId: "surface-1", depth: 1 }), surface], listenerInspection(exact.targetId, surface.surfaceId, surface.depth), [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.publishNoteSurface).toMatchObject({ status: "PROVEN_UNIQUE", surface: { surfaceId: "surface-2", ancestorDepth: 2 } });
  });

  it("deduplicates duplicate exact targets that converge on one surface", () => {
    const first = target({ targetId: "target-0" });
    const second = target({ targetId: "target-1" });
    const chains = [ancestor({ targetId: first.targetId }), ancestor({ targetId: second.targetId })];
    const listeners: XiaohongshuPublishEventListenerInspection = {
      status: "AVAILABLE",
      targets: [
        { targetId: first.targetId, listeners: [{ eventType: "click", listenerCount: 1, ancestorDepth: 1, surfaceId: "surface-0" }] },
        { targetId: second.targetId, listeners: [{ eventType: "click", listenerCount: 1, ancestorDepth: 1, surfaceId: "surface-0" }] }
      ]
    };
    const result = resolve([first, second], chains, listeners, [hitTest(first.targetId, "surface-0"), hitTest(second.targetId, "surface-0")]);

    expect(result.publishNoteSurface).toMatchObject({ status: "PROVEN_UNIQUE", surface: { surfaceId: "surface-0" } });
  });

  it("fails closed when duplicate exact targets resolve to different surfaces", () => {
    const first = target({ targetId: "target-0" });
    const second = target({ targetId: "target-1" });
    const result = resolve(
      [first, second],
      [ancestor({ targetId: first.targetId, surfaceId: "surface-0" }), ancestor({ targetId: second.targetId, surfaceId: "surface-1" })],
      {
        status: "AVAILABLE",
        targets: [
          { targetId: first.targetId, listeners: [{ eventType: "click", listenerCount: 1, ancestorDepth: 1, surfaceId: "surface-0" }] },
          { targetId: second.targetId, listeners: [{ eventType: "click", listenerCount: 1, ancestorDepth: 1, surfaceId: "surface-1" }] }
        ]
      },
      [hitTest(first.targetId, "surface-0"), hitTest(second.targetId, "surface-1")]
    );

    expect(result.publishNoteSurface).toMatchObject({ status: "AMBIGUOUS", failureCode: "PUBLISH_CLICK_SURFACE_AMBIGUOUS" });
  });

  it("fails closed when exact target identity itself is ambiguous", () => {
    const exact = target({ targetId: "duplicate-target" });
    const duplicate = target({ targetId: "duplicate-target" });

    const result = resolve([exact, duplicate], [ancestor({ targetId: exact.targetId })], listenerInspection(exact.targetId, "surface-0", 1), [hitTest(exact.targetId, "surface-0")]);

    expect(result.publishNoteSurface).toMatchObject({ status: "AMBIGUOUS", failureCode: "PUBLISH_SEMANTIC_TARGET_AMBIGUOUS" });
  });

  it("does not prove text when the bounded ancestor chain has no click signal", () => {
    const exact = target();
    const surface = ancestor({ cursor: "default" });
    const result = resolve([exact], [surface], { status: "AVAILABLE", targets: [{ targetId: exact.targetId, listeners: [] }] }, [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.publishNoteSurface).toMatchObject({ status: "NO_CLICK_SURFACE_FOUND", failureCode: "PUBLISH_CLICK_SURFACE_NOT_FOUND" });
  });

  it("rejects a hidden clickable surface", () => {
    const exact = target();
    const surface = ancestor({ visibility: "hidden" });
    const result = resolve([exact], [surface], listenerInspection(exact.targetId, surface.surfaceId, surface.depth), [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.publishNoteSurface).toMatchObject({ status: "NO_CLICK_SURFACE_FOUND", failureCode: "PUBLISH_CLICK_SURFACE_NOT_VISIBLE" });
  });

  it("rejects pointer-events none even when a click listener exists", () => {
    const exact = target();
    const surface = ancestor({ pointerEvents: "none" });
    const result = resolve([exact], [surface], listenerInspection(exact.targetId, surface.surfaceId, surface.depth), [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.publishNoteSurface).toMatchObject({ status: "NO_CLICK_SURFACE_FOUND", failureCode: "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED" });
  });

  it("rejects a surface whose center hit-test is outside the target subtree", () => {
    const exact = target();
    const surface = ancestor();
    const result = resolve([exact], [surface], listenerInspection(exact.targetId, surface.surfaceId, surface.depth), [hitTest(exact.targetId, "unrelated", "UNRELATED")]);

    expect(result.publishNoteSurface).toMatchObject({ status: "NO_CLICK_SURFACE_FOUND", failureCode: "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED" });
  });

  it("does not treat cursor:pointer alone as proof", () => {
    const exact = target();
    const surface = ancestor({ cursor: "pointer" });
    const result = resolve([exact], [surface], { status: "AVAILABLE", targets: [{ targetId: exact.targetId, listeners: [] }] }, [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.publishNoteSurface.status).not.toBe("PROVEN_UNIQUE");
  });

  it("does not let an event listener without an exact semantic target prove a surface", () => {
    const surface = ancestor({ targetId: "unrelated-target" });
    const result = resolve([], [surface], listenerInspection("unrelated-target", surface.surfaceId, surface.depth), [hitTest("unrelated-target", surface.surfaceId)]);

    expect(result.publishNoteSurface).toMatchObject({ status: "NO_CLICK_SURFACE_FOUND", failureCode: "PUBLISH_SEMANTIC_TARGET_NOT_FOUND" });
  });

  it("identifies 发布图文笔记 independently from 发布笔记", () => {
    const exact = target({ targetId: "image-target", exactText: "发布图文笔记" });
    const surface = ancestor({ targetId: exact.targetId, surfaceId: "image-surface" });
    const result = resolve([exact], [surface], listenerInspection(exact.targetId, surface.surfaceId, surface.depth), [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.imagePostSurface).toMatchObject({ exactText: "发布图文笔记", status: "PROVEN_UNIQUE" });
    expect(result.publishNoteSurface).toMatchObject({ exactText: "发布笔记", failureCode: "PUBLISH_SEMANTIC_TARGET_NOT_FOUND" });
  });

  it.each(["发布笔记管理", "发布"]) ("does not fuzzy-match %s", (text) => {
    const invalidTarget = { ...target(), exactText: text } as unknown as XiaohongshuExactPublishSemanticTarget;
    const result = resolve([invalidTarget], [], { status: "AVAILABLE", targets: [] }, []);
    expect(result.publishNoteSurface.status).not.toBe("PROVEN_UNIQUE");
    expect(result.imagePostSurface.status).not.toBe("PROVEN_UNIQUE");
  });

  it("keeps ancestor diagnostics bounded to eight levels", async () => {
    const raw = Array.from({ length: 12 }, (_, depth) => ancestor({ depth, surfaceId: `surface-${depth}` }));
    const page = { evaluate: vi.fn(async () => ({ targetId: "target-0", ancestors: raw })) } as unknown as Page;

    const result = await collectPublishAncestorChainDiagnostics(page, [target()]);

    expect(result).toHaveLength(8);
    expect(result.at(-1)?.depth).toBe(7);
  });

  it("keeps event listener diagnostics bounded and excludes handler source", () => {
    const exact = target();
    const chain = Array.from({ length: 12 }, (_, depth) => ancestor({ depth, surfaceId: `surface-${depth}` }));
    const result = resolve([exact], chain, {
      status: "AVAILABLE",
      targets: [{ targetId: exact.targetId, listeners: [{ eventType: "click", listenerCount: 1, ancestorDepth: 9, surfaceId: "surface-9" }] }]
    }, [hitTest(exact.targetId, "surface-9")]);

    expect(result.publishNoteSurface.status).not.toBe("PROVEN_UNIQUE");
    expect(JSON.stringify(result)).not.toMatch(/function\s*\(|handler\s*[:=]|closure\s*[:=]|innerHTML|outerHTML|["'](?:cookie|storage|token)["']/iu);
  });

  it("returns unavailable when event listener inspection is unavailable", () => {
    const exact = target();
    const surface = ancestor();
    const result = resolve([exact], [surface], { status: "UNAVAILABLE", targets: [] }, [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.publishNoteSurface).toMatchObject({ status: "EVENT_LISTENER_INSPECTION_UNAVAILABLE", failureCode: "PUBLISH_CLICK_SURFACE_DIAGNOSTIC_FAILED" });
  });

  it("uses bounded CDP listener counts without returning listener source", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "Runtime.evaluate") return { result: { objectId: "object-0" } };
      if (method === "DOMDebugger.getEventListeners") return { listeners: [{ type: "click", handler: "secret-handler-source" }, { type: "pointerup", handler: "secret-handler-source" }, { type: "load", handler: "ignored" }] };
      if (method === "Runtime.callFunctionOn") return { result: { value: "surface-0" } };
      return {};
    });
    const cdpSession = { send } as never;

    const result = await collectPublishEventListenerDiagnostics({} as Page, [target()], { cdpSession });

    expect(result.status).toBe("AVAILABLE");
    expect(result.targets[0]?.listeners.filter((entry) => entry.listenerCount > 0)).toEqual([
      expect.objectContaining({ eventType: "click", listenerCount: 1, ancestorDepth: 0 }),
      expect.objectContaining({ eventType: "pointerup", listenerCount: 1, ancestorDepth: 0 }),
      expect.objectContaining({ eventType: "click", listenerCount: 1, ancestorDepth: 1 }),
      expect.objectContaining({ eventType: "pointerup", listenerCount: 1, ancestorDepth: 1 }),
      expect.objectContaining({ eventType: "click", listenerCount: 1, ancestorDepth: 2 }),
      expect.objectContaining({ eventType: "pointerup", listenerCount: 1, ancestorDepth: 2 }),
      expect.objectContaining({ eventType: "click", listenerCount: 1, ancestorDepth: 3 }),
      expect.objectContaining({ eventType: "pointerup", listenerCount: 1, ancestorDepth: 3 }),
      expect.objectContaining({ eventType: "click", listenerCount: 1, ancestorDepth: 4 }),
      expect.objectContaining({ eventType: "pointerup", listenerCount: 1, ancestorDepth: 4 }),
      expect.objectContaining({ eventType: "click", listenerCount: 1, ancestorDepth: 5 }),
      expect.objectContaining({ eventType: "pointerup", listenerCount: 1, ancestorDepth: 5 }),
      expect.objectContaining({ eventType: "click", listenerCount: 1, ancestorDepth: 6 }),
      expect.objectContaining({ eventType: "pointerup", listenerCount: 1, ancestorDepth: 6 }),
      expect.objectContaining({ eventType: "click", listenerCount: 1, ancestorDepth: 7 }),
      expect.objectContaining({ eventType: "pointerup", listenerCount: 1, ancestorDepth: 7 })
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-handler-source");
    expect(JSON.stringify(result)).not.toContain("load");
    expect(send).toHaveBeenCalledWith("DOMDebugger.getEventListeners", expect.objectContaining({ objectId: "object-0" }));
  });

  it("collects exact semantic targets without clicking or dumping HTML", async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        textSignalPresent: true,
        truncated: false,
        targets: [target(), target({ targetId: "target-1", exactText: "发布图文笔记" }), { ...target(), exactText: "发布笔记管理" }, { ...target(), exactText: "发布" }]
      })),
      click: vi.fn(),
      dispatchEvent: vi.fn()
    } as unknown as Page;

    const result = await collectExactPublishSemanticTargets(page);

    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.exactText)).toEqual(["发布笔记", "发布图文笔记"]);
    expect(page.click).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/innerHTML|outerHTML|cookie|storage|token/iu);
  });

  it("collects a bounded elementsFromPoint hit-test without dispatching events", async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        hitTests: [{
          targetId: "target-0",
          center: { x: 70, y: 40 },
          elements: Array.from({ length: 20 }, () => ({ surfaceId: "surface-0", tagName: "DIV", role: null, exactSemanticText: "发布笔记", ancestorRelation: "ANCESTOR" }))
        }]
      })),
      click: vi.fn(),
      dispatchEvent: vi.fn()
    } as unknown as Page;

    const result = await collectPublishHitTestDiagnostics(page, [target()]);

    expect(result[0]?.elements).toHaveLength(8);
    expect(page.click).not.toHaveBeenCalled();
    expect(page.dispatchEvent).not.toHaveBeenCalled();
  });

  it("orchestrates all proof collectors without falling back to a click", async () => {
    let evaluation = 0;
    const page = {
      evaluate: vi.fn(async () => {
        evaluation += 1;
        if (evaluation === 1) return { targets: [target()] };
        if (evaluation === 2) return { chains: [{ targetId: "target-0", ancestors: [ancestor()] }] };
        return { hitTests: [hitTest("target-0", "surface-0")] };
      }),
      click: vi.fn(),
      dispatchEvent: vi.fn()
    } as unknown as Page;

    const result = await collectPublishClickableSurfaceDiagnostics(page);

    expect(result.eventListenerInspection.status).toBe("UNAVAILABLE");
    expect(result.publishNoteSurface.status).toBe("EVENT_LISTENER_INSPECTION_UNAVAILABLE");
    expect(page.click).not.toHaveBeenCalled();
    expect(page.dispatchEvent).not.toHaveBeenCalled();
  });

  it("keeps the proof input side-effect free", () => {
    const exact = target();
    const surface = ancestor();
    const result = resolve([exact], [surface], listenerInspection(exact.targetId, surface.surfaceId, surface.depth), [hitTest(exact.targetId, surface.surfaceId)]);

    expect(result.diagnosticClickCount).toBe(0);
    expect(result.mouseEventDispatchCount).toBe(0);
    expect(result.keyboardEventCount).toBe(0);
    expect(result.gateSideEffects).toEqual({ preparePublish: "NO", contentMutationCount: 0, uploadCount: 0, finalSubmitCount: 0 });
  });

  it("preserves a separate image-post result when both semantic surfaces are present", () => {
    const note = target({ targetId: "note-target" });
    const image = target({ targetId: "image-target", exactText: "发布图文笔记" });
    const noteSurface = ancestor({ targetId: note.targetId, surfaceId: "note-surface" });
    const imageSurface = ancestor({ targetId: image.targetId, surfaceId: "image-surface" });
    const result = resolve(
      [note, image],
      [noteSurface, imageSurface],
      {
        status: "AVAILABLE",
        targets: [
          { targetId: note.targetId, listeners: [{ eventType: "click", listenerCount: 1, ancestorDepth: 1, surfaceId: noteSurface.surfaceId }] },
          { targetId: image.targetId, listeners: [{ eventType: "click", listenerCount: 1, ancestorDepth: 1, surfaceId: imageSurface.surfaceId }] }
        ]
      },
      [hitTest(note.targetId, noteSurface.surfaceId), hitTest(image.targetId, imageSurface.surfaceId)]
    );

    expect(result.publishNoteSurface.surface?.surfaceId).toBe("note-surface");
    expect(result.imagePostSurface.surface?.surfaceId).toBe("image-surface");
  });

  const chromeExecutable = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  it.skipIf(!existsSync(chromeExecutable))("proves a real DIV listener through Chromium CDP without clicking", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.setContent("<div id='surface' style='display:block;width:240px;height:80px;cursor:pointer'><span>发布笔记</span></div>");
      await page.evaluate(() => {
        document.querySelector("#surface")?.addEventListener("click", () => undefined);
      });

      const result = await collectPublishClickableSurfaceDiagnostics(page);

      expect(result.publishNoteSurface).toMatchObject({ status: "PROVEN_UNIQUE", confidence: "HIGH", surface: { tagName: "DIV" } });
      expect(result.eventListenerInspection.status).toBe("AVAILABLE");
      expect(result.diagnosticClickCount).toBe(0);
      expect(result.mouseEventDispatchCount).toBe(0);
      expect(result.keyboardEventCount).toBe(0);
    } finally {
      await browser.close();
    }
  });

  it.skipIf(!existsSync(chromeExecutable))("finds the dropdown trigger beside the publish-note primary action", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.setContent("<div id='publish-note'><button id='primary'><span>发布笔记</span></button><button id='dropdown' aria-haspopup='menu' aria-expanded='false' aria-label='选择发布类型'><span>⌄</span></button></div>");
      await page.evaluate(() => {
        document.querySelector("#primary")?.addEventListener("click", () => undefined);
        document.querySelector("#dropdown")?.addEventListener("click", () => undefined);
      });

      const exactTargets = await collectExactPublishSemanticTargets(page);
      const triggers = await collectPublishNoteDropdownTriggerDiagnostics(page, exactTargets);
      const result = resolvePublishNoteDropdownTrigger({ exactTargets, dropdownTriggers: triggers });

      expect(result).toMatchObject({ status: "PROVEN_UNIQUE", trigger: { tagName: "BUTTON", ariaHasPopup: "menu", ariaExpanded: "false" } });
      expect(result.trigger?.triggerId).toMatch(/^xhs-publish-dropdown-trigger-\d+$/u);
    } finally {
      await browser.close();
    }
  });

  it.skipIf(!existsSync(chromeExecutable))("finds the exact image menu action after the dropdown is open", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.setContent("<div role='menu'><div role='menuitem'><span>上传图文</span></div><div role='menuitem'>上传视频</div><div role='menuitem'>写长文</div><div role='menuitem'>发播客</div></div>");
      const items = await collectExactImagePostMenuItems(page);
      expect(resolveExactImagePostMenuItem({ items })).toMatchObject({ status: "PROVEN_UNIQUE", item: { tagName: "DIV", role: "menuitem", exactText: "上传图文" } });
    } finally {
      await browser.close();
    }
  });
});
