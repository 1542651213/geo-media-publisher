import type { ControlledPostUploadDiscoveryResult, ControlledSelfTestMode, PublishFlowExplorationResult } from "@publisher/adapters-core";
import type { Account, Platform } from "@publisher/domain";

export const CONTROLLED_POST_UPLOAD_DISCOVERY_MODE = "POST_UPLOAD_DISCOVERY_ONLY" as const;
export const PUBLISH_FLOW_EXPLORATION_MODE = "XHS_PUBLISH_FLOW_EXPLORATION" as const;
export const ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_MODE = "ONE_SHOT_REAL_PUBLISH_ACCEPTANCE" as const;
export const ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_CONFIRMATION = "本次会真实发布 1 条测试笔记，最多提交一次。";
export const CONTROLLED_SELF_TEST_CONFIRMATION = "仅上传一张内置安全测试图片，完成上传后只读发现编辑器控件；不会填写标题或正文、不会修改设置、不会保存草稿、不会发布。确认继续？";
export const PUBLISH_FLOW_EXPLORATION_CONFIRMATION = "将使用一张内置安全测试图片，并填写测试标题“小红书发布流程测试-请勿发布”和测试正文；只操作发布流程内部的必要控件，不会点击最终发布、不会保存正式草稿、不会创建发布记录。确认开始探索？";

type ControlledEntryAccount = Pick<Account, "id" | "platformAccountId" | "enabled" | "archivedAt"> & Partial<Pick<Account, "platformKey">>;
type ControlledEntryPlatform = Pick<Platform, "capabilities"> & Partial<Pick<Platform, "platformKey">>;

export function supportsControlledPostUploadDiscovery(platform: ControlledEntryPlatform, account: ControlledEntryAccount): boolean {
  return account.enabled
    && !account.archivedAt
    && platform.capabilities.controlledSelfTestModes?.includes(CONTROLLED_POST_UPLOAD_DISCOVERY_MODE) === true;
}

export function buildControlledSelfTestRequest(input: {
  account: ControlledEntryAccount;
  platform: ControlledEntryPlatform;
  connected: boolean;
  busy: boolean;
  confirmed: boolean;
}): { platformAccountId: string; mode: ControlledSelfTestMode } | null {
  if (!supportsControlledPostUploadDiscovery(input.platform, input.account) || !input.connected || input.busy || !input.confirmed) return null;
  return { platformAccountId: input.account.platformAccountId ?? input.account.id, mode: CONTROLLED_POST_UPLOAD_DISCOVERY_MODE };
}

/** UI-side single-flight guard; execution remains owned by the existing Task10N handler. */
export class ControlledSelfTestEntryGuard {
  private readonly active = new Set<string>();

  tryAcquire(accountId: string): boolean {
    if (this.active.has(accountId)) return false;
    this.active.add(accountId);
    return true;
  }

  release(accountId: string): void {
    this.active.delete(accountId);
  }

  isRunning(accountId: string): boolean {
    return this.active.has(accountId);
  }
}

export function controlledSelfTestResultMessage(result: Pick<ControlledPostUploadDiscoveryResult, "status" | "failureCode">): string {
  return result.status === "PASS"
    ? "上传后编辑器检查完成；已停止在标题、正文和最终发布之前。"
    : `上传后编辑器检查已安全停止：${result.failureCode ?? "UNKNOWN"}`;
}

export function supportsPublishFlowExploration(platform: ControlledEntryPlatform, account: ControlledEntryAccount): boolean {
  return account.enabled
    && !account.archivedAt
    && platform.capabilities.controlledSelfTestModes?.includes(PUBLISH_FLOW_EXPLORATION_MODE) === true;
}

export function buildPublishFlowExplorationRequest(input: {
  account: ControlledEntryAccount;
  platform: ControlledEntryPlatform;
  connected: boolean;
  busy: boolean;
  confirmed: boolean;
}): { platformAccountId: string; mode: typeof PUBLISH_FLOW_EXPLORATION_MODE } | null {
  if (!supportsPublishFlowExploration(input.platform, input.account) || !input.connected || input.busy || !input.confirmed) return null;
  return { platformAccountId: input.account.platformAccountId ?? input.account.id, mode: PUBLISH_FLOW_EXPLORATION_MODE };
}

export function publishFlowExplorationResultMessage(result: Pick<PublishFlowExplorationResult, "readyForFinalSubmit" | "blocker">): string {
  return result.readyForFinalSubmit
    ? "小红书发布流程已探索到最终发布控件可用；未点击发布。"
    : `小红书发布流程已安全停止：${result.blocker ?? "未知阻塞"}`;
}

export function supportsOneShotRealPublishAcceptance(platform: ControlledEntryPlatform, account: ControlledEntryAccount): boolean {
  return platform.platformKey === "xiaohongshu"
    && account.platformKey === "xiaohongshu"
    && account.enabled
    && !account.archivedAt;
}

export function buildOneShotRealPublishRequest(input: {
  account: ControlledEntryAccount;
  platform: ControlledEntryPlatform;
  connected: boolean;
  busy: boolean;
  confirmed: boolean;
}): { platformAccountId: string; mode: typeof ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_MODE } | null {
  if (!supportsOneShotRealPublishAcceptance(input.platform, input.account) || !input.connected || input.busy || !input.confirmed) return null;
  return { platformAccountId: input.account.platformAccountId ?? input.account.id, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_MODE };
}
