import { describe, expect, it } from "vitest";
import type { Platform } from "@publisher/domain";
import type { ControlledPostUploadDiscoveryResult } from "@publisher/adapters-core";
import {
  CONTROLLED_POST_UPLOAD_DISCOVERY_MODE,
  CONTROLLED_SELF_TEST_CONFIRMATION,
  PUBLISH_FLOW_EXPLORATION_CONFIRMATION,
  PUBLISH_FLOW_EXPLORATION_MODE,
  ControlledSelfTestEntryGuard,
  buildControlledSelfTestRequest,
  buildPublishFlowExplorationRequest,
  controlledSelfTestResultMessage,
  publishFlowExplorationResultMessage,
  supportsControlledPostUploadDiscovery,
  supportsPublishFlowExploration
} from "../apps/desktop/src/shared/controlled-self-test-entry";

const platform = (controlledSelfTestModes?: string[]): Pick<Platform, "capabilities"> => ({
  capabilities: {
    article: true,
    imagePost: true,
    video: false,
    coverImage: false,
    tags: true,
    categories: false,
    scheduledPublish: false,
    draft: false,
    markdown: false,
    richText: true,
    maxTitleLength: 1000,
    maxImageCount: 18,
    controlledSelfTestModes
  }
});

const account = (overrides: { enabled?: boolean; archivedAt?: string | null } = {}) => ({
  id: "account-1",
  platformAccountId: "platform-account-1",
  enabled: true,
  archivedAt: null,
  ...overrides
});

function result(overrides: Partial<ControlledPostUploadDiscoveryResult> = {}): ControlledPostUploadDiscoveryResult {
  return {
    mode: CONTROLLED_POST_UPLOAD_DISCOVERY_MODE,
    status: "FAIL",
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
    postUploadControlsStatus: "FAIL",
    titleEditorStatus: "FOUND_UNIQUE",
    bodyEditorStatus: "FOUND_UNIQUE",
    finalSubmitStatus: "FOUND_UNIQUE",
    contentMutationCount: 0,
    finalSubmitCount: 0,
    sameCanonicalPage: true,
    sameContext: true,
    failureCode: "POST_UPLOAD_EDITOR_TIMEOUT",
    failureStage: "POST_UPLOAD_READINESS",
    missingSignal: "previewReady",
    evidence: {},
    ...overrides
  };
}

describe("controlled self-test entry policy", () => {
  it("shows only when the platform capability and account lifecycle allow it", () => {
    expect(supportsControlledPostUploadDiscovery(platform([CONTROLLED_POST_UPLOAD_DISCOVERY_MODE]), account())).toBe(true);
    expect(supportsControlledPostUploadDiscovery(platform([]), account())).toBe(false);
    expect(supportsControlledPostUploadDiscovery(platform([CONTROLLED_POST_UPLOAD_DISCOVERY_MODE]), account({ enabled: false }))).toBe(false);
    expect(supportsControlledPostUploadDiscovery(platform([CONTROLLED_POST_UPLOAD_DISCOVERY_MODE]), account({ archivedAt: "2026-08-31T00:00:00.000Z" }))).toBe(false);
  });

  it("does not create a request when confirmation is cancelled", () => {
    expect(buildControlledSelfTestRequest({ account: account(), platform: platform([CONTROLLED_POST_UPLOAD_DISCOVERY_MODE]), connected: true, busy: false, confirmed: false })).toBeNull();
  });

  it("creates an explicit controlled request after confirmation", () => {
    expect(buildControlledSelfTestRequest({ account: account(), platform: platform([CONTROLLED_POST_UPLOAD_DISCOVERY_MODE]), connected: true, busy: false, confirmed: true })).toEqual({
      platformAccountId: "platform-account-1",
      mode: "POST_UPLOAD_DISCOVERY_ONLY"
    });
    expect(CONTROLLED_SELF_TEST_CONFIRMATION).toContain("仅上传一张内置安全测试图片");
    expect(CONTROLLED_SELF_TEST_CONFIRMATION).toContain("不会填写标题或正文");
    expect(CONTROLLED_SELF_TEST_CONFIRMATION).toContain("不会发布");
  });

  it("keeps generic self-test and controlled mode distinct", () => {
    const request = buildControlledSelfTestRequest({ account: account(), platform: platform([CONTROLLED_POST_UPLOAD_DISCOVERY_MODE]), connected: true, busy: false, confirmed: true });
    expect(request?.mode).toBe("POST_UPLOAD_DISCOVERY_ONLY");
    expect(request?.mode).not.toBe("L3_CONTENT_FILL");
  });

  it("allows only one controlled operation per account while running", () => {
    const guard = new ControlledSelfTestEntryGuard();
    expect(guard.tryAcquire("account-1")).toBe(true);
    expect(guard.tryAcquire("account-1")).toBe(false);
    expect(guard.isRunning("account-1")).toBe(true);
    guard.release("account-1");
    expect(guard.tryAcquire("account-1")).toBe(true);
    guard.release("account-1");
    expect(guard.isRunning("account-1")).toBe(false);
  });

  it("presents a controlled result without claiming publish success", () => {
    expect(controlledSelfTestResultMessage(result({ status: "PASS", failureCode: null }))).toContain("上传后编辑器检查完成");
    expect(controlledSelfTestResultMessage(result())).toContain("POST_UPLOAD_EDITOR_TIMEOUT");
    expect(controlledSelfTestResultMessage(result())).not.toContain("发布成功");
  });

  it("requires the dedicated capability, connected account, and confirmation for exploration", () => {
    const explorationPlatform = platform([PUBLISH_FLOW_EXPLORATION_MODE]);
    expect(supportsPublishFlowExploration(explorationPlatform, account())).toBe(true);
    expect(buildPublishFlowExplorationRequest({ account: account(), platform: explorationPlatform, connected: true, busy: false, confirmed: false })).toBeNull();
    expect(buildPublishFlowExplorationRequest({ account: account(), platform: explorationPlatform, connected: true, busy: false, confirmed: true })).toEqual({
      platformAccountId: "platform-account-1",
      mode: PUBLISH_FLOW_EXPLORATION_MODE
    });
    expect(PUBLISH_FLOW_EXPLORATION_CONFIRMATION).toContain("不会点击最终发布");
  });

  it("keeps exploration result messaging separate from formal publish success", () => {
    expect(publishFlowExplorationResultMessage({ readyForFinalSubmit: true, blocker: null })).toContain("未点击发布");
    expect(publishFlowExplorationResultMessage({ readyForFinalSubmit: false, blocker: "FINAL_SUBMIT_NOT_READY" })).toContain("FINAL_SUBMIT_NOT_READY");
    expect(publishFlowExplorationResultMessage({ readyForFinalSubmit: true, blocker: null })).not.toContain("发布成功");
  });
});
