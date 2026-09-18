import { describe, expect, it, vi } from "vitest";
import {
  ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
  OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
  OneShotPublicationGuard,
  type OneShotFinalSubmitPreflight,
  type OneShotPublicationAuthorization
} from "@publisher/adapters-core";
import {
  clickTask10sClosedShadowPublishSurface,
  resolveTask10sClosedShadowPublishSurface,
  runTask10sClosedShadowFinalSubmit,
  type Task10sClosedShadowDomSnapshot,
  type Task10sClosedShadowHostSafe,
  type Task10sClosedShadowInnerButtonSafe
} from "./task10s-closed-shadow-final-submit";

const rect = { x: 10, y: 20, width: 120, height: 36 };

function host(overrides: Partial<Task10sClosedShadowHostSafe> = {}): Task10sClosedShadowHostSafe {
  return {
    tagName: "XHS-PUBLISH-BTN",
    isPublish: "true",
    isSaveDraft: "true",
    submitText: "发布",
    saveText: "暂存离开",
    submitDisabled: "false",
    submitLoading: "false",
    connected: true,
    rendered: true,
    display: "block",
    visibility: "visible",
    pointerEvents: "auto",
    boundingRect: rect,
    ...overrides
  };
}

function button(overrides: Partial<Task10sClosedShadowInnerButtonSafe> = {}): Task10sClosedShadowInnerButtonSafe {
  return {
    tagName: "BUTTON",
    type: "button",
    classNameSafe: "ce-btn bg-red",
    exactText: "发布",
    ariaDisabled: "false",
    ariaBusy: "false",
    connected: true,
    rendered: true,
    display: "block",
    visibility: "visible",
    pointerEvents: "auto",
    boundingRect: rect,
    ...overrides
  };
}

function snapshot(overrides: Partial<Task10sClosedShadowDomSnapshot> = {}): Task10sClosedShadowDomSnapshot {
  return {
    inspectionStatus: "PASS",
    failureCode: null,
    hostMatchCount: 1,
    hosts: [{ host: host(), innerPublishButtons: [button()], innerButtonMatchCount: 1 }],
    ...overrides
  };
}

describe("Task10S closed-shadow final publish resolver", () => {
  it("accepts one fixed xhs-publish-btn host and one exact native 发布 button", () => {
    expect(resolveTask10sClosedShadowPublishSurface(snapshot())).toMatchObject({
      status: "FOUND_UNIQUE",
      present: true,
      enabled: true,
      currentState: "PRESENT_ENABLED"
    });
  });

  it("keeps presence separate from disabled and loading state", () => {
    expect(resolveTask10sClosedShadowPublishSurface(snapshot({
      hosts: [{ host: host({ submitDisabled: "true" }), innerPublishButtons: [button()], innerButtonMatchCount: 1 }]
    }))).toMatchObject({ status: "DISABLED", present: true, enabled: false, currentState: "PRESENT_DISABLED" });
    expect(resolveTask10sClosedShadowPublishSurface(snapshot({
      hosts: [{ host: host({ submitLoading: "true" }), innerPublishButtons: [button()], innerButtonMatchCount: 1 }]
    }))).toMatchObject({ status: "DISABLED", present: true, enabled: false });
    expect(resolveTask10sClosedShadowPublishSurface(snapshot({
      hosts: [{ host: host(), innerPublishButtons: [button({ ariaDisabled: "true" })], innerButtonMatchCount: 1 }]
    }))).toMatchObject({ status: "DISABLED", present: true, enabled: false });
  });

  it("fails closed for zero or multiple hosts", () => {
    expect(resolveTask10sClosedShadowPublishSurface(snapshot({ hostMatchCount: 0, hosts: [] }))).toMatchObject({ status: "NOT_FOUND", present: false });
    expect(resolveTask10sClosedShadowPublishSurface(snapshot({ hostMatchCount: 2, hosts: [snapshot().hosts[0]!, snapshot().hosts[0]!] }))).toMatchObject({ status: "AMBIGUOUS", present: false });
  });

  it("fails closed for zero or multiple exact inner publish buttons", () => {
    expect(resolveTask10sClosedShadowPublishSurface(snapshot({
      hosts: [{ host: host(), innerPublishButtons: [], innerButtonMatchCount: 0 }]
    }))).toMatchObject({ status: "NOT_FOUND", present: false });
    expect(resolveTask10sClosedShadowPublishSurface(snapshot({
      hosts: [{ host: host(), innerPublishButtons: [button(), button({ classNameSafe: "second" })], innerButtonMatchCount: 2 }]
    }))).toMatchObject({ status: "AMBIGUOUS", present: false });
  });

  it("ignores the 暂存离开 draft button and requires rendered geometry", () => {
    const result = resolveTask10sClosedShadowPublishSurface(snapshot());
    expect(result.innerButton?.exactText).toBe("发布");
    expect(resolveTask10sClosedShadowPublishSurface(snapshot({
      hosts: [{ host: host(), innerPublishButtons: [button({ rendered: false, boundingRect: null })], innerButtonMatchCount: 1 }]
    }))).toMatchObject({ status: "NOT_VISIBLE", present: false });
  });
});

function cdpTree(buttonNodeId: number): Record<string, unknown> {
  return {
    nodeId: 1,
    nodeName: "#document",
    children: [{
      nodeId: 2,
      nodeName: "HTML",
      children: [{
        nodeId: 3,
        nodeName: "XHS-PUBLISH-BTN",
        attributes: ["is-publish", "true", "is-save-draft", "true", "submit-text", "发布", "save-text", "暂存离开", "submit-disabled", "false", "submit-loading", "false"],
        shadowRoots: [{
          nodeId: 4,
          nodeName: "#document-fragment",
          children: [
            { nodeId: buttonNodeId, nodeName: "BUTTON", attributes: ["type", "button", "class", "ce-btn bg-red", "aria-disabled", "false", "aria-busy", "false"], children: [{ nodeId: 6, nodeName: "#text", nodeValue: "发布" }] },
            { nodeId: 7, nodeName: "BUTTON", attributes: ["type", "button", "class", "draft"], children: [{ nodeId: 8, nodeName: "#text", nodeValue: "暂存离开" }] }
          ]
        }]
      }]
    }]
  };
}

function fakeCdpSession(options: { pressFails?: boolean; releaseFails?: boolean; nodeId?: number } = {}) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const session = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "DOM.getDocument") return { root: cdpTree(options.nodeId ?? 5) };
      if (method === "CSS.getComputedStyleForNode") return { computedStyle: [
        { name: "display", value: "block" },
        { name: "visibility", value: "visible" },
        { name: "pointer-events", value: "auto" }
      ] };
      if (method === "DOM.getBoxModel") return { model: { content: [10, 20, 130, 20, 130, 56, 10, 56] } };
      if (method === "Input.dispatchMouseEvent" && params?.type === "mousePressed" && options.pressFails) throw new Error("press timeout");
      if (method === "Input.dispatchMouseEvent" && params?.type === "mouseReleased" && options.releaseFails) throw new Error("release timeout");
      return {};
    }),
    detach: vi.fn(async () => undefined)
  };
  return { session, calls };
}

describe("Task10S closed-shadow CDP click", () => {
  it("uses pierced DOM, resolves a fresh button node, and dispatches exactly one press/release pair", async () => {
    const { session, calls } = fakeCdpSession({ nodeId: 5 });
    const page = { context: () => ({ newCDPSession: async () => session }) } as never;
    const result = await clickTask10sClosedShadowPublishSurface(page);

    expect(result.status).toBe("CLICK_DISPATCHED");
    expect(result.mousePressedCount).toBe(1);
    expect(result.mouseReleasedCount).toBe(1);
    expect(calls.find((call) => call.method === "DOM.getDocument")?.params).toMatchObject({ depth: -1, pierce: true });
    expect(calls.filter((call) => call.method === "Input.dispatchMouseEvent").map((call) => call.params?.type)).toEqual(["mousePressed", "mouseReleased"]);
    expect(calls.some((call) => call.method === "DOM.scrollIntoViewIfNeeded")).toBe(true);
  });

  it("runs the durable boundary callback after box-model resolution and before mousePressed", async () => {
    const { session, calls } = fakeCdpSession();
    const page = { context: () => ({ newCDPSession: async () => session }) } as never;
    const order: string[] = [];
    const result = await clickTask10sClosedShadowPublishSurface(page, {
      beforeMousePress: async () => { order.push("durable-lock"); }
    });
    order.push("returned");
    expect(result.status).toBe("CLICK_DISPATCHED");
    expect(order).toEqual(["durable-lock", "returned"]);
    expect(calls.findIndex((call) => call.method === "DOM.getBoxModel")).toBeLessThan(calls.findIndex((call) => call.method === "Input.dispatchMouseEvent" && call.params?.type === "mousePressed"));
  });

  it("does not retry after the one-shot mouse press/release boundary", async () => {
    const { session, calls } = fakeCdpSession({ releaseFails: true });
    const page = { context: () => ({ newCDPSession: async () => session }) } as never;

    await expect(clickTask10sClosedShadowPublishSurface(page)).rejects.toThrow("release timeout");
    expect(calls.filter((call) => call.method === "Input.dispatchMouseEvent").map((call) => call.params?.type)).toEqual(["mousePressed", "mouseReleased"]);
    expect(calls.filter((call) => call.method === "DOM.getDocument")).toHaveLength(1);
  });

  it("re-resolves the closed-shadow node after a rerender instead of reusing a stale node id", async () => {
    let documentRead = 0;
    const nodeIds: number[] = [];
    const session = {
      send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "DOM.getDocument") return { root: cdpTree(documentRead++ === 0 ? 11 : 22) };
        if (method === "CSS.getComputedStyleForNode") return { computedStyle: [{ name: "display", value: "block" }, { name: "visibility", value: "visible" }, { name: "pointer-events", value: "auto" }] };
        if (method === "DOM.getBoxModel") {
          if (typeof params?.nodeId === "number") nodeIds.push(params.nodeId);
          return { model: { content: [10, 20, 130, 20, 130, 56, 10, 56] } };
        }
        return {};
      }),
      detach: vi.fn(async () => undefined)
    };
    const page = { context: () => ({ newCDPSession: async () => session }) } as never;

    await expect(clickTask10sClosedShadowPublishSurface(page)).resolves.toMatchObject({ status: "CLICK_DISPATCHED" });
    await expect(clickTask10sClosedShadowPublishSurface(page)).resolves.toMatchObject({ status: "CLICK_DISPATCHED" });
    expect(nodeIds).toContain(11);
    expect(nodeIds).toContain(22);
  });
});

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "task10s-r58-boundary";

function authorization(overrides: Partial<OneShotPublicationAuthorization> = {}): OneShotPublicationAuthorization {
  return {
    authorization: OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
    state: "AUTHORIZED_UNUSED",
    platformKey: "xiaohongshu",
    accountId: ACCOUNT_ID,
    operationId: OPERATION_ID,
    mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
    publicationTransactionCount: 0,
    publicationCommitActionCount: 0,
    finalSubmitAttemptCount: 0,
    finalSubmitRetryCount: 0,
    finalSubmitActionStarted: false,
    finalSubmitActionCompleted: false,
    ...overrides
  };
}

function preflight(overrides: Partial<OneShotFinalSubmitPreflight> = {}): OneShotFinalSubmitPreflight {
  return {
    authorization: OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
    authorizationState: "AUTHORIZED_UNUSED",
    platformKey: "xiaohongshu",
    accountId: ACCOUNT_ID,
    operationId: OPERATION_ID,
    mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
    authenticated: true,
    sameCanonicalContext: true,
    sameCanonicalPage: true,
    mutexOwned: true,
    editorPhase: "IMAGE_POST_POST_UPLOAD_EDITOR",
    safeFixtureUploaded: true,
    titleReadbackVerified: true,
    bodyReadbackVerified: true,
    requiredFieldsPass: true,
    loginPagePresent: false,
    securityVerificationPresent: false,
    finalSubmitControl: { status: "FOUND_UNIQUE", visible: true, enabled: true, hitTestValid: true },
    ...overrides
  };
}

describe("Task10S retained final-submit boundary ownership", () => {
  it("rejects duplicate boundary ownership before mousePressed", async () => {
    const { session, calls } = fakeCdpSession();
    const page = { context: () => ({ newCDPSession: async () => session }) } as never;
    const guard = new OneShotPublicationGuard(authorization(), { onFinalMousePressDispatchStarted: vi.fn() });

    await expect(guard.startFinalSubmit(preflight(), async () => {
      const result = await clickTask10sClosedShadowPublishSurface(page, {
        beforeMousePress: async () => { await guard.beginFinalMousePress(); }
      });
      if (result.status !== "CLICK_DISPATCHED") throw new Error(result.failureCode ?? result.status);
    })).rejects.toThrow("FINAL_SUBMIT_ALREADY_USED");
    expect(calls.filter((call) => call.method === "Input.dispatchMouseEvent")).toHaveLength(0);
  });

  it("owns the durable boundary once and dispatches immediately after persistence", async () => {
    const { session, calls } = fakeCdpSession();
    const page = { context: () => ({ newCDPSession: async () => session }) } as never;
    const order: string[] = [];
    const guard = new OneShotPublicationGuard(authorization(), { onFinalMousePressDispatchStarted: () => { order.push("persist"); } });

    const result = await runTask10sClosedShadowFinalSubmit(page, guard, preflight(), () => { order.push("side-effect-marker"); });

    expect(result.status).toBe("CLICK_DISPATCHED");
    expect(guard.authorization.finalSubmitAttemptCount).toBe(1);
    expect(guard.authorization.publicationTransactionCount).toBe(1);
    expect(order).toEqual(["side-effect-marker", "persist"]);
    expect(calls.filter((call) => call.method === "Input.dispatchMouseEvent").map((call) => call.params?.type)).toEqual(["mousePressed", "mouseReleased"]);
  });

  it("does not persist or dispatch when preflight fails", async () => {
    const { session, calls } = fakeCdpSession();
    const page = { context: () => ({ newCDPSession: async () => session }) } as never;
    const persisted = vi.fn();
    const guard = new OneShotPublicationGuard(authorization(), { onFinalMousePressDispatchStarted: persisted });

    await expect(runTask10sClosedShadowFinalSubmit(page, guard, preflight({ requiredFieldsPass: false }))).rejects.toThrow("FINAL_SUBMIT_PREFLIGHT_FAILED");
    expect(persisted).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.method === "Input.dispatchMouseEvent")).toHaveLength(0);
  });

  it("locks permanently when mousePressed is ambiguous and never retries", async () => {
    const { session, calls } = fakeCdpSession({ pressFails: true });
    const page = { context: () => ({ newCDPSession: async () => session }) } as never;
    const guard = new OneShotPublicationGuard(authorization(), { onFinalMousePressDispatchStarted: vi.fn() });

    const first = await runTask10sClosedShadowFinalSubmit(page, guard, preflight());
    expect(first.status).toBe("FAILED");
    expect(guard.authorization.finalSubmitAttemptCount).toBe(1);
    expect(calls.filter((call) => call.method === "Input.dispatchMouseEvent" && call.params?.type === "mousePressed")).toHaveLength(1);
    await expect(runTask10sClosedShadowFinalSubmit(page, guard, preflight())).rejects.toThrow("FINAL_SUBMIT_ALREADY_USED");
  });
});
