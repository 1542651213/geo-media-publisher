import type { ControlledPostUploadDiscoveryResult, ControlledSelfTestMode } from "@publisher/adapters-core";
import type { Account, Platform } from "@publisher/domain";

export const CONTROLLED_POST_UPLOAD_DISCOVERY_MODE: ControlledSelfTestMode = "POST_UPLOAD_DISCOVERY_ONLY";
export const CONTROLLED_SELF_TEST_CONFIRMATION = "仅上传一张内置安全测试图片，完成上传后只读发现编辑器控件；不会填写标题或正文、不会修改设置、不会保存草稿、不会发布。确认继续？";

type ControlledEntryAccount = Pick<Account, "id" | "platformAccountId" | "enabled" | "archivedAt">;
type ControlledEntryPlatform = Pick<Platform, "capabilities">;

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
