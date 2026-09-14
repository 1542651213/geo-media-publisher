import { describe, expect, it, vi } from "vitest";
import type { ControlledPostUploadDiscoveryResult } from "./automation";
import { PlatformSelfTestService } from "../../../../apps/desktop/src/main/platform-self-test";
import { evaluateStrictFailedOneShotConfirmation } from "../../../../apps/desktop/src/main/one-shot-reconciliation";

const account = { id: "account-1", platformAccountId: "platform-account-1", platformKey: "xiaohongshu", accountAlias: "XHS", name: "XHS", enabled: true, archivedAt: null } as Record<string, unknown>;
const result: ControlledPostUploadDiscoveryResult = {
  mode: "POST_UPLOAD_DISCOVERY_ONLY",
  status: "PASS",
  operationId: "operation-1",
  platformKey: "xiaohongshu",
  accountId: "account-1",
  imageSource: "SAFE_TEST_FIXTURE",
  sanitizedUrlBefore: null,
  sanitizedUrlAfter: null,
  preUploadGateStatus: "PASS",
  preUploadMutationRevalidated: true,
  uploadMutationCount: 1,
  uploadCompletionObserved: true,
  postUploadPhase: "IMAGE_POST_POST_UPLOAD_EDITOR",
  postUploadPhaseConfidence: "HIGH",
  postUploadControlsStatus: "READY",
  titleEditorStatus: "FOUND_UNIQUE",
  bodyEditorStatus: "FOUND_UNIQUE",
  finalSubmitStatus: "FOUND_UNIQUE",
  contentMutationCount: 0,
  finalSubmitCount: 0,
  sameCanonicalPage: true,
  sameContext: true,
  failureCode: null,
  failureStage: null,
  missingSignal: null,
  evidence: {}
};

function service(adapter: Record<string, unknown>) {
  return new PlatformSelfTestService({
    repository: { listAccounts: () => [account], getAccountById: (id: string) => id === account.id ? account : null } as never,
    registry: { getForContent: vi.fn(() => adapter) } as never,
    publisher: {} as never,
    resolveAccountSecrets: vi.fn(() => ({}))
  });
}

describe("Task10O controlled self-test dispatch", () => {
  it("dispatches the explicit mode and safe fixture to the existing handler", async () => {
    const runControlledPostUploadDiscovery = vi.fn(async () => result);
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), runControlledPostUploadDiscovery };
    await expect(service(adapter).runPostUploadDiscovery("platform-account-1", "POST_UPLOAD_DISCOVERY_ONLY")).resolves.toEqual(result);
    expect(runControlledPostUploadDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "account-1",
      platformKey: "xiaohongshu",
      settings: expect.objectContaining({ controlledSelfTestMode: "POST_UPLOAD_DISCOVERY_ONLY" })
    }), { imagePath: expect.stringContaining("task10n-safe-test.png"), imageSource: "SAFE_TEST_FIXTURE" });
  });

  it("rejects a second operation for the same account while the first is running", async () => {
    let release!: () => void;
    const pending = new Promise<ControlledPostUploadDiscoveryResult>((resolve) => { release = () => resolve(result); });
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), runControlledPostUploadDiscovery: vi.fn(() => pending) };
    const instance = service(adapter);
    const first = instance.runPostUploadDiscovery("platform-account-1", "POST_UPLOAD_DISCOVERY_ONLY");
    await expect(instance.runPostUploadDiscovery("platform-account-1", "POST_UPLOAD_DISCOVERY_ONLY")).rejects.toThrow("CONTROLLED_SELF_TEST_ALREADY_RUNNING");
    release();
    await expect(first).resolves.toEqual(result);
  });

  it("refuses disabled accounts before invoking the adapter", async () => {
    const runControlledPostUploadDiscovery = vi.fn(async () => result);
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), runControlledPostUploadDiscovery };
    const repository = { listAccounts: () => [{ ...account, enabled: false }] };
    const instance = new PlatformSelfTestService({ repository: repository as never, registry: { getForContent: vi.fn(() => adapter) } as never, publisher: {} as never, resolveAccountSecrets: vi.fn(() => ({})) });
    await expect(instance.runPostUploadDiscovery("platform-account-1", "POST_UPLOAD_DISCOVERY_ONLY")).rejects.toThrow("小红书受控上传自测账号不可用");
    expect(runControlledPostUploadDiscovery).not.toHaveBeenCalled();
  });

  it("coalesces duplicate Task10S confirmations before any browser call", async () => {
    const testRunId = "task10t-confirmation-run";
    const run = { testRunId, platformKey: "xiaohongshu", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", requestedLevel: "L5_PUBLISH", publishJobId: null, publishConfirmedAt: null, steps: [{ stepKey: "PUBLISH_CONFIRMATION", errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" }] };
    const account = { id: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformKey: "xiaohongshu", accountAlias: "XHS", name: "XHS", enabled: true, archivedAt: null };
    const confirmAtomic = vi.fn(() => { throw Object.assign(new Error("forced database failure"), { code: "DB_ERROR" }); });
    const repository = { listAccounts: () => [account], getAccountById: (id: string) => id === account.id ? account : null, getPlatformSelfTestRun: () => run, getOneShotPublicationAuthorization: () => null, confirmPlatformSelfTestOneShotAtomically: confirmAtomic };
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), finalSubmit: vi.fn() };
    const instance = new PlatformSelfTestService({ repository: repository as never, registry: { getForContent: vi.fn(() => adapter) } as never, publisher: {} as never, resolveAccountSecrets: vi.fn(() => ({})) });

    const results = await Promise.allSettled(Array.from({ length: 7 }, () => instance.confirmOneShotPublish(testRunId)));

    expect(confirmAtomic).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(adapter.connectAccount).not.toHaveBeenCalled();
    expect(adapter.preparePublish).not.toHaveBeenCalled();
  });

  it("blocks a previously partial confirmation until formal reconciliation", async () => {
    const testRunId = "task10t-partial-run";
    const run = { testRunId, platformKey: "xiaohongshu", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", requestedLevel: "L5_PUBLISH", publishJobId: null, publishConfirmedAt: "2026-09-01T04:00:10.700Z", steps: [{ stepKey: "PUBLISH_CONFIRMATION", errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" }] };
    const account = { id: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformKey: "xiaohongshu", accountAlias: "XHS", name: "XHS", enabled: true, archivedAt: null };
    const confirmAtomic = vi.fn();
    const repository = { listAccounts: () => [account], getAccountById: (id: string) => id === account.id ? account : null, getPlatformSelfTestRun: () => run, getOneShotPublicationAuthorization: () => null, confirmPlatformSelfTestOneShotAtomically: confirmAtomic };
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), finalSubmit: vi.fn() };
    const instance = new PlatformSelfTestService({ repository: repository as never, registry: { getForContent: vi.fn(() => adapter) } as never, publisher: {} as never, resolveAccountSecrets: vi.fn(() => ({})) });

    await expect(instance.confirmOneShotPublish(testRunId)).rejects.toMatchObject({ code: "ONE_SHOT_CONFIRMATION_PARTIAL_STATE" });
    expect(confirmAtomic).not.toHaveBeenCalled();
    expect(adapter.connectAccount).not.toHaveBeenCalled();
  });

  it("reconciles only the exact XHS orphan through the formal service and never calls a browser adapter", () => {
    const testRunId = "task10u-exact-orphan";
    const reconcile = vi.fn(() => ({ status: "RECONCILED_RETRYABLE", testRunId, mutationCount: 1, retryEligible: true }));
    const snapshot = {
      identity: { testRunId, platformKey: "xiaohongshu", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3" },
      run: { testRunId, platformKey: "xiaohongshu", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", requestedLevel: "L5_PUBLISH", overallResult: "WAITING_FOR_USER", publishConfirmedAt: "2026-09-01T04:00:10.700Z", publishJobId: null, publishRecordId: null, testArticleId: null, externalId: null, externalUrl: null, steps: [{ stepKey: "PUBLISH_CONFIRMATION", result: "WAITING_FOR_USER", errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" }] },
      authorizationCount: 0,
      operationCount: 0,
      publicationTransactionCount: 0,
      finalSubmitAttemptCount: 0,
      externalPublicationEvidence: false,
      needsReconciliation: false,
      publishedOrVerified: false
    };
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), finalSubmit: vi.fn() };
    const repository = { getOneShotConfirmationReconciliationSnapshot: vi.fn(() => snapshot), reconcileFailedOneShotConfirmation: reconcile };
    const instance = new PlatformSelfTestService({ repository: repository as never, registry: { getForContent: vi.fn(() => adapter) } as never, publisher: {} as never, resolveAccountSecrets: vi.fn(() => ({})) });

    expect(instance.reconcileFailedOneShotConfirmation(snapshot.identity as never)).toEqual({ status: "RECONCILED_RETRYABLE", testRunId, mutationCount: 1, retryEligible: true });
    expect(repository.getOneShotConfirmationReconciliationSnapshot).toHaveBeenCalledWith(snapshot.identity);
    expect(reconcile).toHaveBeenCalledWith(snapshot.identity);
    expect(adapter.connectAccount).not.toHaveBeenCalled();
    expect(adapter.finalSubmit).not.toHaveBeenCalled();
  });

  it("rejects a wrong one-shot identity through the persisted binding gate", () => {
    const snapshot = { testRunId: "task10u-wrong", platformKey: "xiaohongshu", accountId: "wrong-account" };
    const repository = {
      getOneShotConfirmationReconciliationSnapshot: vi.fn(() => ({
        identity: snapshot,
        run: { testRunId: snapshot.testRunId, platformKey: "xiaohongshu", accountId: "persisted-account", platformAccountId: "persisted-account", requestedLevel: "L5_PUBLISH", overallResult: "WAITING_FOR_USER", publishConfirmedAt: null, steps: [] },
        authorizationCount: 0, operationCount: 0, publicationTransactionCount: 0, finalSubmitAttemptCount: 0, externalPublicationEvidence: false, needsReconciliation: false, publishedOrVerified: false
      })),
      reconcileFailedOneShotConfirmation: vi.fn()
    };
    const instance = new PlatformSelfTestService({ repository: repository as never, registry: {} as never, publisher: {} as never, resolveAccountSecrets: vi.fn(() => ({})) });

    expect(() => instance.reconcileFailedOneShotConfirmation(snapshot as never)).toThrow("ONE_SHOT_RECONCILIATION_ACCOUNT_MISMATCH");
    expect(repository.getOneShotConfirmationReconciliationSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it.each([
    ["authorization exists", { authorizationCount: 1 }, "ONE_SHOT_RECONCILIATION_AUTHORIZATION_EXISTS"],
    ["operation exists", { operationCount: 1 }, "ONE_SHOT_RECONCILIATION_OPERATION_EXISTS"],
    ["publication started", { publicationTransactionCount: 1 }, "ONE_SHOT_RECONCILIATION_PUBLICATION_STARTED"],
    ["final submit started", { finalSubmitAttemptCount: 1 }, "ONE_SHOT_RECONCILIATION_FINAL_SUBMIT_STARTED"],
    ["external evidence exists", { externalPublicationEvidence: true }, "ONE_SHOT_RECONCILIATION_EXTERNAL_EVIDENCE_EXISTS"],
    ["needs reconciliation", { needsReconciliation: true }, "ONE_SHOT_RECONCILIATION_NEEDS_RECONCILIATION"],
    ["published or verified", { publishedOrVerified: true }, "ONE_SHOT_RECONCILIATION_ALREADY_PUBLISHED"],
    ["wrong platform", { identity: { testRunId: "x", platformKey: "weibo", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3" } }, "ONE_SHOT_RECONCILIATION_PLATFORM_MISMATCH"],
    ["wrong account", { identity: { testRunId: "x", platformKey: "xiaohongshu", accountId: "wrong" } }, "ONE_SHOT_RECONCILIATION_ACCOUNT_MISMATCH"]
  ])("fail-closes %s", (_label, override, reason) => {
    const base = {
      identity: { testRunId: "x", platformKey: "xiaohongshu", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3" },
      run: { platformKey: "xiaohongshu", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", requestedLevel: "L5_PUBLISH", overallResult: "WAITING_FOR_USER", publishConfirmedAt: "2026-09-01T04:00:10.700Z", steps: [{ stepKey: "PUBLISH_CONFIRMATION", result: "WAITING_FOR_USER", errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" }] },
      authorizationCount: 0,
      operationCount: 0,
      publicationTransactionCount: 0,
      finalSubmitAttemptCount: 0,
      externalPublicationEvidence: false,
      needsReconciliation: false,
      publishedOrVerified: false
    };
    const candidate = { ...base, ...override, identity: { ...base.identity, ...((override as { identity?: Record<string, string> }).identity ?? {}) } };
    const decision = evaluateStrictFailedOneShotConfirmation(candidate as never);
    expect(decision).toMatchObject({ allowed: false, alreadyReconciled: false, reason });
  });

  it("accepts only a confirmed orphan and treats the canonical pre-confirm state as already reconciled", () => {
    const base = {
      identity: { testRunId: "x", platformKey: "xiaohongshu", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3" },
      run: { platformKey: "xiaohongshu", accountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", requestedLevel: "L5_PUBLISH", overallResult: "WAITING_FOR_USER", publishConfirmedAt: "2026-09-01T04:00:10.700Z", steps: [{ stepKey: "PUBLISH_CONFIRMATION", result: "WAITING_FOR_USER", errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" }] },
      authorizationCount: 0, operationCount: 0, publicationTransactionCount: 0, finalSubmitAttemptCount: 0, externalPublicationEvidence: false, needsReconciliation: false, publishedOrVerified: false
    };
    expect(evaluateStrictFailedOneShotConfirmation(base as never)).toEqual({ allowed: true, alreadyReconciled: false, reason: null });
    expect(evaluateStrictFailedOneShotConfirmation({ ...base, run: { ...base.run, publishConfirmedAt: null } } as never)).toEqual({ allowed: true, alreadyReconciled: true, reason: null });
  });
});
