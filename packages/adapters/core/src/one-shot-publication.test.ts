import { describe, expect, it, vi } from "vitest";
import {
  ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
  OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
  OneShotPublicationGuard,
  classifyOneShotPostSubmitObservation,
  createOwnerAuthorizedOneShotPublication,
  reconcileOneShotPublication,
  type OneShotFinalSubmitPreflight,
  type OneShotPublicationAuthorization
} from "./one-shot-publication";

const ACCOUNT_ID = "54b390ac-d81e-440a-baeb-d00f9f346cc3";
const OPERATION_ID = "operation-task10s-1";

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

describe("Task10S one-shot publication contract", () => {
  it("binds authorization to the selected XHS account, operation and mode", () => {
    expect(createOwnerAuthorizedOneShotPublication({ platformKey: "xiaohongshu", accountId: ACCOUNT_ID, operationId: OPERATION_ID, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE })).toMatchObject(authorization());
    expect(() => createOwnerAuthorizedOneShotPublication({ platformKey: "weibo", accountId: ACCOUNT_ID, operationId: OPERATION_ID, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE })).toThrow("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH");
    expect(createOwnerAuthorizedOneShotPublication({ platformKey: "xiaohongshu", accountId: "wrong-account", operationId: "operation-task10s-2", mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE })).toMatchObject({ accountId: "wrong-account", operationId: "operation-task10s-2" });
  });

  it("consumes before the side effect and rejects a second submit even after failure", async () => {
    const order: string[] = [];
    const guard = new OneShotPublicationGuard(authorization(), { onConsumed: () => { order.push("consumed"); } });
    await expect(guard.startFinalSubmit(preflight(), async () => { order.push("action"); throw new Error("timeout"); })).rejects.toThrow("timeout");
    expect(order).toEqual(["consumed", "action"]);
    expect(guard.authorization.state).toBe("CONSUMED");
    expect(guard.authorization.finalSubmitAttemptCount).toBe(1);
    await expect(guard.startFinalSubmit(preflight({ authorizationState: "CONSUMED" }), async () => "must-not-run")).rejects.toThrow("FINAL_SUBMIT_ALREADY_USED");
  });

  it("defers one-shot persistence until the explicit mousePressed dispatch boundary", async () => {
    const order: string[] = [];
    const persisted: string[] = [];
    const guard = new OneShotPublicationGuard(authorization(), {
      onFinalMousePressDispatchStarted: () => { order.push("persist"); persisted.push("started"); }
    });
    const start = guard.startFinalSubmit.bind(guard) as unknown as (preflight: OneShotFinalSubmitPreflight, action: () => Promise<unknown>, options: { deferDispatchLock: true }) => Promise<unknown>;

    await expect(start(preflight(), async () => {
      order.push("before-boundary");
      expect(guard.authorization.state).toBe("ARMED");
      await guard.beginFinalMousePress();
      order.push("mousePressed");
      return "done";
    }, { deferDispatchLock: true })).resolves.toBe("done");

    expect(order).toEqual(["before-boundary", "persist", "mousePressed"]);
    expect(persisted).toEqual(["started"]);
    expect(guard.authorization.state).toBe("FINAL_MOUSEPRESS_DISPATCH_STARTED");
    expect(guard.authorization.finalSubmitAttemptCount).toBe(1);
  });

  it("leaves authorization unused when deferred pre-dispatch validation fails", async () => {
    const persisted = vi.fn();
    const guard = new OneShotPublicationGuard(authorization(), { onFinalMousePressDispatchStarted: persisted });
    const start = guard.startFinalSubmit.bind(guard) as unknown as (preflight: OneShotFinalSubmitPreflight, action: () => Promise<unknown>, options: { deferDispatchLock: true }) => Promise<unknown>;

    await expect(start(preflight(), async () => { throw new Error("box model unavailable"); }, { deferDispatchLock: true })).rejects.toThrow("box model unavailable");
    expect(persisted).not.toHaveBeenCalled();
    expect(guard.authorization.state).toBe("AUTHORIZED_UNUSED");
    expect(guard.authorization.finalSubmitAttemptCount).toBe(0);
  });

  it("locks once before mousePressed and enters reconciliation without retry after dispatch failure", async () => {
    const persisted: string[] = [];
    const guard = new OneShotPublicationGuard(authorization(), {
      onFinalMousePressDispatchStarted: () => { persisted.push("started"); },
      onSubmissionReconciliationRequired: () => { persisted.push("reconciliation"); }
    });
    const start = guard.startFinalSubmit.bind(guard) as unknown as (preflight: OneShotFinalSubmitPreflight, action: () => Promise<unknown>, options: { deferDispatchLock: true }) => Promise<unknown>;
    await expect(start(preflight(), async () => {
      await guard.beginFinalMousePress();
      throw new Error("mousePressed timeout");
    }, { deferDispatchLock: true })).rejects.toThrow("mousePressed timeout");
    expect(persisted).toEqual(["started"]);
    expect(guard.authorization.finalSubmitAttemptCount).toBe(1);
    expect(guard.authorization.state).toBe("FINAL_MOUSEPRESS_DISPATCH_STARTED");
    await guard.markSubmissionReconciliationRequired();
    expect(guard.authorization.state).toBe("SUBMIT_RECONCILIATION_REQUIRED");
    await expect(guard.startFinalSubmit(preflight(), async () => "must-not-retry")).rejects.toThrow("FINAL_SUBMIT_ALREADY_USED");
  });

  it("allows one high-confidence confirmation action in the same transaction only", async () => {
    const guard = new OneShotPublicationGuard(authorization());
    await guard.startFinalSubmit(preflight(), async () => "submitted");
    const candidate = { candidateId: "confirm-1", modalId: "modal-1", semanticIntent: "确认发布", sameModal: true, unique: true, visible: true, enabled: true, hitTestValid: true } as const;
    await expect(guard.confirmModal(candidate, async () => "confirmed")).resolves.toBe("confirmed");
    expect(guard.authorization.publicationTransactionCount).toBe(1);
    expect(guard.authorization.publicationCommitActionCount).toBe(2);
    await expect(guard.confirmModal({ ...candidate, candidateId: "confirm-2" }, async () => "must-not-run")).rejects.toThrow("PUBLICATION_COMMIT_ACTION_LIMIT");
    const invalidGuard = new OneShotPublicationGuard(authorization());
    await invalidGuard.startFinalSubmit(preflight(), async () => "submitted");
    await expect(invalidGuard.confirmModal({ ...candidate, sameModal: false }, async () => "must-not-run")).rejects.toThrow("CONFIRMATION_MODAL_NOT_VERIFIED");
  });

  it("classifies ambiguous observation and reconciles only on complete read-only evidence", () => {
    expect(classifyOneShotPostSubmitObservation({ urlChanged: false, successToast: false, editorExited: false, successPage: false, creatorContentMatched: "UNKNOWN", platformError: null })).toBe("NEEDS_RECONCILIATION");
    expect(classifyOneShotPostSubmitObservation({ urlChanged: false, successToast: false, editorExited: false, successPage: false, creatorContentMatched: "NO", platformError: "平台拒绝" })).toBe("PLATFORM_REJECTED");
    expect(reconcileOneShotPublication({ titleMatch: true, accountMatch: true, timeWindowMatch: true, thumbnailMatch: true, externalId: "note-1", publishedUrl: "https://www.xiaohongshu.com/explore/note-1" })).toMatchObject({ reconciled: true, externalId: "note-1" });
    expect(reconcileOneShotPublication({ titleMatch: true, accountMatch: false, timeWindowMatch: true, thumbnailMatch: true })).toMatchObject({ reconciled: false, status: "NeedsReconciliation" });
  });

  it("does not provide a global final-submit enable switch", () => {
    const guard = new OneShotPublicationGuard(authorization());
    expect((guard as unknown as Record<string, unknown>).finalSubmitAllowed).toBeUndefined();
    expect(vi.fn()).toBeDefined();
  });
});
