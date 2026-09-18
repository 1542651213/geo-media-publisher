import { describe, expect, it } from "vitest";
import type { XiaohongshuGlobalExactPublishDomRuntimeDiagnostic, XiaohongshuGlobalExactPublishNodeSafe } from "./global-exact-publish-diagnostic";
import { resolveTask10sExactPublishSurface } from "./task10s-final-surface";

function ancestor(depth: number, overrides: Partial<XiaohongshuGlobalExactPublishNodeSafe["ancestors"][number]> = {}): XiaohongshuGlobalExactPublishNodeSafe["ancestors"][number] {
  return {
    depth,
    tagName: depth === 1 ? "DIV" : "SECTION",
    role: null,
    classNameSafe: `ancestor-${String(depth)}`,
    tabIndex: -1,
    ariaDisabled: null,
    disabled: false,
    pointerEvents: "auto",
    cursor: "default",
    display: "block",
    visibility: "visible",
    boundingRect: { x: 20, y: 20, width: 120, height: 40 },
    connected: true,
    clickableSignals: ["POINTER_EVENTS_ACTIVE"],
    ...overrides
  };
}

function node(overrides: Partial<XiaohongshuGlobalExactPublishNodeSafe> = {}): XiaohongshuGlobalExactPublishNodeSafe {
  return {
    tagName: "SPAN",
    role: null,
    classNameSafe: "publish-label",
    tabIndex: -1,
    ariaDisabled: null,
    disabled: false,
    pointerEvents: "auto",
    cursor: "default",
    display: "inline",
    visibility: "visible",
    boundingRect: { x: 20, y: 20, width: 40, height: 20 },
    connected: true,
    clickableSignals: ["POINTER_EVENTS_ACTIVE"],
    rendered: true,
    ancestors: [ancestor(1, { cursor: "pointer", clickableSignals: ["CURSOR_POINTER", "POINTER_EVENTS_ACTIVE"] })],
    ...overrides
  };
}

function diagnostic(nodes: readonly XiaohongshuGlobalExactPublishNodeSafe[], count = nodes.length): XiaohongshuGlobalExactPublishDomRuntimeDiagnostic {
  return {
    inspectionStatus: "PASS",
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
    sanitizedUrl: "https://creator.xiaohongshu.com/publish/publish?target=image",
    globalExactPublishTextMatchCount: count,
    globalExactPublishUnique: count === 1 ? "YES" : count === 0 ? "NO" : "AMBIGUOUS",
    globalExactPublishNodesSafe: nodes,
    maxAncestorDepth: 5,
    scanTruncated: false
  };
}

describe("Task10S exact final publish surface resolver", () => {
  it("accepts a unique rendered span with one clickable parent div", () => {
    const result = resolveTask10sExactPublishSurface(diagnostic([node()]));

    expect(result).toMatchObject({ status: "FOUND_UNIQUE", present: true, enabled: true, currentState: "PRESENT_ENABLED" });
    expect(result.candidate).toMatchObject({ depth: 1, tagName: "DIV" });
  });

  it("accepts a div whose own cursor and pointer-events prove a bounded surface", () => {
    const result = resolveTask10sExactPublishSurface(diagnostic([node({ tagName: "DIV", cursor: "pointer", clickableSignals: ["CURSOR_POINTER", "POINTER_EVENTS_ACTIVE"], ancestors: [] })]));

    expect(result).toMatchObject({ status: "FOUND_UNIQUE", present: true, enabled: true });
    expect(result.candidate).toMatchObject({ tagName: "DIV" });
  });

  it.each([
    ["native button", node({ tagName: "BUTTON", clickableSignals: ["NATIVE_BUTTON", "POINTER_EVENTS_ACTIVE"], ancestors: [] })],
    ["role button", node({ role: "button", clickableSignals: ["ROLE_BUTTON", "POINTER_EVENTS_ACTIVE"], ancestors: [] })],
    ["tabindex", node({ tabIndex: 0, clickableSignals: ["TABINDEX_INTERACTIVE", "POINTER_EVENTS_ACTIVE"], ancestors: [] })]
  ])("accepts %s as a safe unique final surface", (_name, candidate) => {
    expect(resolveTask10sExactPublishSurface(diagnostic([candidate]))).toMatchObject({ status: "FOUND_UNIQUE", present: true, enabled: true });
  });

  it("separates a rendered disabled surface from enabled state", () => {
    const result = resolveTask10sExactPublishSurface(diagnostic([node({ disabled: true, ariaDisabled: "true", clickableSignals: ["ROLE_BUTTON", "POINTER_EVENTS_ACTIVE"], ancestors: [] })]));

    expect(result).toMatchObject({ status: "DISABLED", present: true, enabled: false, currentState: "PRESENT_DISABLED" });
  });

  it("fails closed for no, multiple, hidden, detached, and zero-geometry exact matches", () => {
    expect(resolveTask10sExactPublishSurface(diagnostic([], 0))).toMatchObject({ status: "NOT_FOUND", present: false });
    expect(resolveTask10sExactPublishSurface(diagnostic([node(), node({ classNameSafe: "second" })], 2))).toMatchObject({ status: "AMBIGUOUS", present: false });
    expect(resolveTask10sExactPublishSurface(diagnostic([node({ rendered: false })])).status).toBe("NOT_VISIBLE");
    expect(resolveTask10sExactPublishSurface(diagnostic([node({ connected: false })])).status).toBe("NOT_VISIBLE");
    expect(resolveTask10sExactPublishSurface(diagnostic([node({ boundingRect: { x: 0, y: 0, width: 0, height: 20 } })])).status).toBe("NOT_VISIBLE");
  });

  it("rejects a pointer-events none surface and an ancestor deeper than five", () => {
    expect(resolveTask10sExactPublishSurface(diagnostic([node({ pointerEvents: "none", clickableSignals: ["CURSOR_POINTER"], ancestors: [] })])).status).toBe("NO_CLICKABLE_SURFACE");
    expect(resolveTask10sExactPublishSurface(diagnostic([node({ ancestors: [ancestor(6, { cursor: "pointer", clickableSignals: ["CURSOR_POINTER", "POINTER_EVENTS_ACTIVE"] })] })])).status).toBe("NO_CLICKABLE_SURFACE");
  });

  it("fails closed when two distinct bounded ancestors are clickable", () => {
    const result = resolveTask10sExactPublishSurface(diagnostic([node({ ancestors: [
      ancestor(1, { cursor: "pointer", clickableSignals: ["CURSOR_POINTER", "POINTER_EVENTS_ACTIVE"] }),
      ancestor(2, { role: "button", clickableSignals: ["ROLE_BUTTON", "POINTER_EVENTS_ACTIVE"] })
    ] })]));

    expect(result).toMatchObject({ status: "AMBIGUOUS", present: false, enabled: false });
  });
});
