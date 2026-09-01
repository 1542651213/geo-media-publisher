import { describe, expect, it, vi } from "vitest";
import type { ControlledPostUploadDiscoveryResult } from "./automation";
import { PlatformSelfTestService } from "../../../../apps/desktop/src/main/platform-self-test";

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
    repository: { listAccounts: () => [account] } as never,
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
    const run = { testRunId, platformKey: "xiaohongshu", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", requestedLevel: "L5_PUBLISH", publishJobId: null, publishConfirmedAt: null, steps: [{ stepKey: "PUBLISH_CONFIRMATION", errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" }] };
    const account = { id: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformKey: "xiaohongshu", accountAlias: "XHS", name: "XHS", enabled: true, archivedAt: null };
    const confirmAtomic = vi.fn(() => { throw Object.assign(new Error("forced database failure"), { code: "DB_ERROR" }); });
    const repository = { listAccounts: () => [account], getPlatformSelfTestRun: () => run, confirmPlatformSelfTestOneShotAtomically: confirmAtomic };
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
    const run = { testRunId, platformKey: "xiaohongshu", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", requestedLevel: "L5_PUBLISH", publishJobId: null, publishConfirmedAt: "2026-09-01T04:00:10.700Z", steps: [{ stepKey: "PUBLISH_CONFIRMATION", errorCode: "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" }] };
    const account = { id: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformAccountId: "54b390ac-d81e-440a-baeb-d00f9f346cc3", platformKey: "xiaohongshu", accountAlias: "XHS", name: "XHS", enabled: true, archivedAt: null };
    const confirmAtomic = vi.fn();
    const repository = { listAccounts: () => [account], getPlatformSelfTestRun: () => run, getOneShotPublicationAuthorization: () => null, confirmPlatformSelfTestOneShotAtomically: confirmAtomic };
    const adapter = { connectAccount: vi.fn(), checkSession: vi.fn(), preparePublish: vi.fn(), finalSubmit: vi.fn() };
    const instance = new PlatformSelfTestService({ repository: repository as never, registry: { getForContent: vi.fn(() => adapter) } as never, publisher: {} as never, resolveAccountSecrets: vi.fn(() => ({})) });

    await expect(instance.confirmOneShotPublish(testRunId)).rejects.toMatchObject({ code: "ONE_SHOT_CONFIRMATION_PARTIAL_STATE" });
    expect(confirmAtomic).not.toHaveBeenCalled();
    expect(adapter.connectAccount).not.toHaveBeenCalled();
  });
});
