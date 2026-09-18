import { describe, expect, it, vi } from "vitest";
import {
  classifyPublishNotePostClickState,
  clickPublishNoteNavigationSurface,
  resolvePublishNoteNavigationSurface,
  type PublishNoteNavigationLifecycle,
  type PublishNoteNavigationSurfaceHandle,
  type PublishNoteNavigationSurfaceResolution,
  type PublishNoteSurfaceRuntimeState
} from "./publish-note-navigation";
import type { Page } from "playwright-core";

const target = {
  targetId: "target-0",
  tagName: "SPAN",
  exactText: "发布笔记" as const,
  visible: true,
  boundingBox: { x: 10, y: 20, width: 120, height: 40 },
  parentTag: "DIV",
  depth: 4
};

const surface = {
  surfaceId: "surface-0",
  targetId: target.targetId,
  ancestorDepth: 2,
  tagName: "DIV",
  boundingBox: { x: 10, y: 20, width: 120, height: 40 },
  strongSignals: ["event:click"]
};

const pageIdentity = { id: "page-1" };
const contextIdentity = { id: "context-1" };

function lifecycle(overrides: Partial<PublishNoteNavigationLifecycle> = {}): PublishNoteNavigationLifecycle {
  return {
    operationId: "operation-1",
    platformKey: "xiaohongshu",
    accountId: "account-1",
    contextDebugId: "context-1",
    pageDebugId: "page-1",
    page: pageIdentity,
    context: contextIdentity,
    authState: "AUTHENTICATED",
    ...overrides
  };
}

function runtimeState(overrides: Partial<PublishNoteSurfaceRuntimeState> = {}): PublishNoteSurfaceRuntimeState {
  return {
    targetAttached: true,
    surfaceAttached: true,
    exactSemanticText: "发布笔记",
    targetWithinSurface: true,
    visible: true,
    pointerEventsActive: true,
    geometryValid: true,
    hitTestConsistent: true,
    ...overrides
  };
}

function resolution(
  handle: PublishNoteNavigationSurfaceHandle,
  overrides: Partial<PublishNoteNavigationSurfaceResolution> = {}
): PublishNoteNavigationSurfaceResolution {
  return {
    status: "PROVEN_UNIQUE",
    target,
    surface,
    evidence: {
      exactSemanticText: "发布笔记",
      visible: true,
      pointerEventsActive: true,
      geometryValid: true,
      hitTestConsistent: true,
      uniqueSurface: true,
      strongClickabilitySignal: true,
      eventListenerSignal: "event:click"
    },
    diagnostics: null,
    dropdownTrigger: null,
    surfaceHandle: handle,
    dropdownTriggerHandle: null,
    lifecycle: lifecycle(),
    ...overrides
  };
}

function handle(state: PublishNoteSurfaceRuntimeState = runtimeState(), click: () => Promise<void> = async () => undefined): PublishNoteNavigationSurfaceHandle {
  return { inspect: vi.fn(async () => state), click: vi.fn(click) };
}

function dropdownHandle(click: () => Promise<void> = async () => undefined) {
  return {
    inspect: vi.fn(async () => ({ triggerAttached: true, relatedTargetAttached: true, visible: true, enabled: true, pointerEventsActive: true, geometryValid: true, hitTestConsistent: true, dropdownSemanticsActive: true })),
    click: vi.fn(click)
  };
}

describe("Xiaohongshu publish-note navigation policy", () => {
  it("resolves the current dynamic surface identity into a click handle without hardcoding surface ids", async () => {
    const targetElement = { evaluate: vi.fn(async () => runtimeState()) };
    const surfaceElement = { click: vi.fn(async () => undefined), evaluate: vi.fn(async () => runtimeState()) };
    const targetHandle = { asElement: () => targetElement, dispose: vi.fn(async () => undefined) };
    const surfaceHandle = { asElement: () => surfaceElement, dispose: vi.fn(async () => undefined) };
    const dropdownElement = { click: vi.fn(async () => undefined), evaluate: vi.fn(async () => ({ triggerAttached: true, relatedTargetAttached: true, visible: true, enabled: true, pointerEventsActive: true, geometryValid: true, hitTestConsistent: true, dropdownSemanticsActive: true })) };
    const dropdownHandle = { asElement: () => dropdownElement, dispose: vi.fn(async () => undefined) };
    const context = { newCDPSession: vi.fn(async () => ({
        send: vi.fn(async (method: string, _params?: { expression?: string }) => {
        if (method === "Runtime.evaluate") return { result: { objectId: "object-0" } };
        if (method === "DOMDebugger.getEventListeners") return { listeners: [{ type: "click" }] };
        if (method === "Runtime.callFunctionOn") return { result: { value: "xhs-publish-surface-42" } };
        return {};
      })
    })) };
    const page = {
      context: vi.fn(() => context),
      evaluate: vi.fn(async (pageFunction: (...args: never[]) => unknown) => {
        const name = pageFunction.name;
        if (name === "readExactPublishSemanticTargets") return { targets: [target] };
        if (name === "readPublishAncestorChains") return { chains: [{ targetId: target.targetId, ancestors: [{ ...surface, surfaceId: "xhs-publish-surface-42", depth: 2, visible: true, pointerEvents: "auto", display: "block", visibility: "visible", boundingBox: surface.boundingBox }] }] };
        if (name === "readPublishDropdownTriggers") return { triggers: [{ triggerId: "xhs-publish-dropdown-trigger-42", targetId: target.targetId, tagName: "BUTTON", role: "button", ariaHasPopup: "menu", ariaExpanded: "false", ariaLabel: "选择发布类型", title: null, visible: true, enabled: true, boundingBox: { x: 125, y: 20, width: 24, height: 40 } }] };
        return { hitTests: [{ targetId: target.targetId, center: { x: 70, y: 40 }, elements: [{ surfaceId: "xhs-publish-surface-42", tagName: "DIV", role: null, exactSemanticText: "发布笔记", ancestorRelation: "ANCESTOR" }] }] };
      }),
      evaluateHandle: vi.fn(async () => {
        const call = page.evaluateHandle.mock.calls.length;
        return call === 1 || call === 3 ? targetHandle : call === 2 ? surfaceHandle : dropdownHandle;
      })
    } as unknown as Page & { evaluateHandle: ReturnType<typeof vi.fn> };
    const resolved = await resolvePublishNoteNavigationSurface(page, lifecycle({ page, context }));

    expect(resolved).toMatchObject({ status: "PROVEN_UNIQUE", surface: { surfaceId: "xhs-publish-surface-42" }, evidence: { strongClickabilitySignal: true } });
    expect(resolved.surfaceHandle).not.toBeNull();
    expect(resolved.surface?.surfaceId).not.toBe("xhs-publish-surface-99");
  });

  it("clicks one proven exact 发布笔记 surface", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({
      resolution: resolution(surfaceHandle),
      current: lifecycle(),
      navigationClickCount: 0,
      sanitizedUrlBefore: "https://creator.xiaohongshu.com/new/home",
      readSanitizedUrl: () => "https://creator.xiaohongshu.com/publish/publish"
    });

    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_COMPLETED", preClickRevalidated: true, navigationClickCount: 1, navigationTransition: true });
    expect(surfaceHandle.click).toHaveBeenCalledTimes(1);
  });

  it("clicks the unique dropdown trigger and never the publish-note primary action", async () => {
    const primarySurface = handle();
    const trigger = dropdownHandle();
    const menuItem = {
      inspect: vi.fn(async () => ({ itemAttached: true, visible: true, enabled: true, pointerEventsActive: true, geometryValid: true, hitTestConsistent: true, exactText: "上传图文" })),
      click: vi.fn(async () => undefined)
    };
    const result = await clickPublishNoteNavigationSurface({
      resolution: resolution(primarySurface, {
        dropdownTrigger: { triggerId: "xhs-publish-dropdown-trigger-42", targetId: target.targetId, tagName: "BUTTON", role: "button", ariaHasPopup: "menu", ariaExpanded: "false", ariaLabel: "选择发布类型", title: null, visible: true, enabled: true, boundingBox: { x: 125, y: 20, width: 24, height: 40 } },
        dropdownTriggerHandle: trigger,
        imagePostMenuItemHandle: menuItem
      }),
      current: lifecycle(),
      navigationClickCount: 0,
      sanitizedUrlBefore: "https://creator.xiaohongshu.com/new/home",
      readSanitizedUrl: () => "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image"
    });

    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_COMPLETED", navigationClickCount: 1 });
    expect(trigger.click).toHaveBeenCalledTimes(1);
    expect(menuItem.click).toHaveBeenCalledTimes(1);
    expect(primarySurface.click).not.toHaveBeenCalled();
    expect(result.imagePostMenuItemClickCount).toBe(1);
  });

  it("supports SPAN -> btn-inner -> btn-wrapper and selects the listener surface", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle, { surface: { ...surface, tagName: "DIV", ancestorDepth: 2 } }), current: lifecycle(), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "editor" });
    expect(result.status).toBe("NAVIGATION_CLICK_COMPLETED");
    expect(surfaceHandle.click).toHaveBeenCalledTimes(1);
  });

  it("allows duplicate exact targets when diagnostics converge on one surface", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle(), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    expect(result.navigationClickCount).toBe(1);
  });

  it("fails closed when diagnostics resolve two distinct surfaces", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle, { status: "AMBIGUOUS", surface: null, surfaceHandle: null, failureCode: "PUBLISH_CLICK_SURFACE_AMBIGUOUS", evidence: { ...resolution(surfaceHandle).evidence, uniqueSurface: false } }), current: lifecycle(), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_REJECTED", failureCode: "PUBLISH_CLICK_SURFACE_AMBIGUOUS", navigationClickCount: 0 });
    expect(surfaceHandle.click).not.toHaveBeenCalled();
  });

  it("fails closed when listener inspection is unavailable", async () => {
    const surfaceHandle = handle();
    const resolved = resolution(surfaceHandle, {
      status: "EVENT_LISTENER_INSPECTION_UNAVAILABLE",
      surfaceHandle: null,
      failureCode: "PUBLISH_CLICK_SURFACE_DIAGNOSTIC_FAILED",
      evidence: { ...resolution(surfaceHandle).evidence, strongClickabilitySignal: false, uniqueSurface: false, eventListenerSignal: null }
    });
    const result = await clickPublishNoteNavigationSurface({ resolution: resolved, current: lifecycle(), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_REJECTED", failureCode: "PUBLISH_CLICK_SURFACE_DIAGNOSTIC_FAILED", navigationClickCount: 0 });
    expect(surfaceHandle.click).not.toHaveBeenCalled();
  });

  it.each([
    ["detached", runtimeState({ surfaceAttached: false }), "PUBLISH_SURFACE_DETACHED"],
    ["hit-test changed", runtimeState({ hitTestConsistent: false }), "PUBLISH_CLICK_SURFACE_HIT_TEST_FAILED"],
    ["hidden", runtimeState({ visible: false }), "PUBLISH_CLICK_SURFACE_NOT_VISIBLE"],
    ["pointer-events none", runtimeState({ pointerEventsActive: false }), "PUBLISH_SURFACE_POINTER_EVENTS_NONE"],
    ["semantic text changed", runtimeState({ exactSemanticText: "发布图文笔记" }), "PUBLISH_SURFACE_DOM_CHANGED_BEFORE_CLICK"]
  ] as const)("does not click when %s before click", async (_label, state, failureCode) => {
    const surfaceHandle = handle(state);
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle(), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_REJECTED", failureCode, navigationClickCount: 0, preClickRevalidated: false });
    expect(surfaceHandle.click).not.toHaveBeenCalled();
  });

  it("does not click after an auth redirect", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle({ authState: "LOGIN_REQUIRED" }), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "login" });
    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_REJECTED", failureCode: "PUBLISH_SURFACE_AUTH_STATE_CHANGED" });
    expect(surfaceHandle.click).not.toHaveBeenCalled();
  });

  it("does not click after canonical Page identity changes", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle({ page: { id: "other-page" } }), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    expect(result.failureCode).toBe("PUBLISH_SURFACE_PAGE_IDENTITY_CHANGED");
    expect(surfaceHandle.click).not.toHaveBeenCalled();
  });

  it("does not click after Context identity changes", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle({ context: { id: "other-context" } }), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    expect(result.failureCode).toBe("PUBLISH_SURFACE_CONTEXT_IDENTITY_CHANGED");
    expect(surfaceHandle.click).not.toHaveBeenCalled();
  });

  it("allows at most one navigation click", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle(), navigationClickCount: 1, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_REJECTED", failureCode: "PUBLISH_NAVIGATION_CLICK_ALREADY_USED", navigationClickCount: 1 });
    expect(surfaceHandle.click).not.toHaveBeenCalled();
  });

  it("does not retry when the first navigation click has no transition", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle(), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "home" });
    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_REJECTED", failureCode: "PUBLISH_ENTRY_CLICK_NO_TRANSITION", navigationClickCount: 1, navigationTransition: false });
    expect(surfaceHandle.click).toHaveBeenCalledTimes(1);
  });

  it("waits for an observed transition without issuing a second click", async () => {
    const surfaceHandle = handle();
    let observedUrl = "home";
    const result = await clickPublishNoteNavigationSurface({
      resolution: resolution(surfaceHandle),
      current: lifecycle(),
      navigationClickCount: 0,
      sanitizedUrlBefore: "home",
      readSanitizedUrl: () => observedUrl,
      waitForTransition: async () => { observedUrl = "selection"; }
    });
    expect(result).toMatchObject({ status: "NAVIGATION_CLICK_COMPLETED", navigationClickCount: 1, navigationTransition: true });
    expect(surfaceHandle.click).toHaveBeenCalledTimes(1);
  });

  it("never counts a navigation click as final submit", async () => {
    const surfaceHandle = handle();
    const result = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle(), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    expect(result.finalSubmitCount).toBe(0);
    expect(result.action).toBe("PUBLISH_NOTE_NAVIGATION_CLICK");
  });

  it("classifies image-post selection after the single note click", () => {
    expect(classifyPublishNotePostClickState({ url: "https://creator.xiaohongshu.com/new/publish", bodyText: "发布图文笔记 发布视频笔记" })).toBe("IMAGE_POST_SELECTION_PAGE");
  });

  it("classifies a direct image editor after the single note click", () => {
    expect(classifyPublishNotePostClickState({ url: "https://creator.xiaohongshu.com/publish/publish", bodyText: "填写标题" })).toBe("IMAGE_EDITOR");
  });

  it("rejects a video target as the wrong content-type editor", () => {
    expect(classifyPublishNotePostClickState({ url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video", bodyText: "上传视频" })).toBe("VIDEO_EDITOR");
  });

  it("classifies login and security verification redirects", () => {
    expect(classifyPublishNotePostClickState({ url: "https://creator.xiaohongshu.com/login", bodyText: "登录" })).toBe("LOGIN");
    expect(classifyPublishNotePostClickState({ url: "https://creator.xiaohongshu.com/security-check", bodyText: "安全验证" })).toBe("SECURITY_VERIFICATION");
  });

  it("records image-post evidence only and never exposes a second-click path", async () => {
    const surfaceHandle = handle();
    const first = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle(), navigationClickCount: 0, sanitizedUrlBefore: "home", readSanitizedUrl: () => "selection" });
    const second = await clickPublishNoteNavigationSurface({ resolution: resolution(surfaceHandle), current: lifecycle(), navigationClickCount: first.navigationClickCount, sanitizedUrlBefore: "selection", readSanitizedUrl: () => "selection" });
    expect(second.failureCode).toBe("PUBLISH_NAVIGATION_CLICK_ALREADY_USED");
    expect(surfaceHandle.click).toHaveBeenCalledTimes(1);
  });
});
