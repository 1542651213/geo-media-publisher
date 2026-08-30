import type { AccountManagementRow } from "../shared/api";
import type { AccountDisconnectResult } from "../shared/api";
import type { Platform } from "@publisher/domain";

export type PlatformConnectionKind = "browser" | "oauth" | "manual" | "blocked" | "not_implemented";
export type PlatformConnectionActionKind = "connect" | "view-account" | "open-backend" | "relogin" | "add-account" | "configure" | "reauthorize" | "instructions" | "reason" | "unsupported";

export interface PlatformConnectionAction {
  kind: PlatformConnectionActionKind;
  label: string;
}

export function disconnectFeedbackMessage(result: Pick<AccountDisconnectResult, "outcome"> | { outcome?: unknown }, accountName: string): string {
  if (result.outcome === "ALREADY_DISCONNECTED") return `${accountName} 当前已处于未连接状态；活动账号已移除。`;
  return `已移除${accountName}；已清除登录状态和本地会话，历史发布记录保留。`;
}

export function connectionErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (!raw || raw.length > 240 || /Error invoking remote method|playwright|ERR_MODULE_NOT_FOUND|at [A-Za-z]:[\\/]/iu.test(raw)) return "连接启动失败，请查看应用日志中的详细诊断。";
  return raw;
}

export function platformConnectionKind(platform: Platform): PlatformConnectionKind {
  if (platform.verificationStatus === "Blocked" || platform.integrationMode === "Blocked") return "blocked";
  if (platform.verificationStatus === "NotImplemented" || platform.adapterStatus === "not_implemented") return "not_implemented";
  if (platform.transport === "browser" || platform.integrationMode === "BrowserAutomation" || platform.accountConnectionMode === "BrowserAutomation") return "browser";
  if (platform.authStrategy === "OAuth2" || platform.authStrategy === "OAuth2PKCE" || platform.integrationMode === "OAuth") return "oauth";
  return "manual";
}

export function platformConnectionActions(platform: Platform, row: AccountManagementRow | null): PlatformConnectionAction[] {
  const kind = platformConnectionKind(platform);
  if (kind === "browser" && (row?.accountStatus === "Expired" || row?.accountStatus === "NeedsLogin" || row?.accountStatus === "Unverified")) return [{ kind: "relogin", label: "重新登录" }, { kind: "add-account", label: "+ 添加账号" }];
  if (kind === "blocked") return [{ kind: "reason", label: "查看原因" }];
  if (kind === "not_implemented") return [{ kind: "unsupported", label: "暂未支持" }];
  if (kind === "manual") return [{ kind: "instructions", label: "查看接入说明" }];
  if (kind === "browser") {
    if (row?.accountStatus === "Connected") return [{ kind: "view-account", label: "查看账号" }, { kind: "open-backend", label: "打开后台" }, { kind: "relogin", label: "重新登录" }, { kind: "add-account", label: "+ 添加账号" }];
    return [{ kind: "connect", label: "连接账号" }, { kind: "add-account", label: "+ 添加账号" }];
  }
  if (!row?.credentialStatus.configured) return [{ kind: "configure", label: "配置开放平台应用" }];
  if (row.accountStatus === "Connected") return [{ kind: "view-account", label: "查看账号" }, { kind: "reauthorize", label: "重新授权" }];
  return [{ kind: "connect", label: "连接账号" }];
}

export function accountStatusLabel(row: AccountManagementRow | null): string {
  if (!row || row.accountStatus === "NotConnected") return "未连接";
  if (row.accountStatus === "Connected") return "已连接";
  if (row.accountStatus === "Connecting") return "连接中";
  if (row.accountStatus === "NeedsLogin") return "需要登录";
  if (row.accountStatus === "Unverified") return "待验证";
  if (row.accountStatus === "Expired") return "已过期";
  return "暂不可用";
}

export function platformAccountStatusLabel(rows: AccountManagementRow[]): string {
  if (rows.length === 0) return "未连接";
  const connectedCount = rows.filter((row) => row.accountStatus === "Connected").length;
  if (connectedCount === rows.length) return `${rows.length} 个已登录`;
  if (connectedCount > 0) return `${connectedCount}/${rows.length} 个已登录`;
  const connectingCount = rows.filter((row) => row.accountStatus === "Connecting").length;
  if (connectingCount > 0) return `${connectingCount}/${rows.length} 个连接中`;
  return `${rows.length} 个账号待处理`;
}

export function platformAuthorizationStatusLabel(rows: AccountManagementRow[], kind: PlatformConnectionKind): string {
  if (kind === "browser") return rows.some((row) => row.accountStatus === "Connected") ? "已完成" : "待处理";
  return rows.some((row) => row.accountStatus === "Connected") ? "已完成" : "待处理";
}

export function authorizationLabel(platform: Platform, row: AccountManagementRow | null): string {
  if (platformConnectionKind(platform) === "browser") return row?.accountStatus === "Connected" ? "已完成" : "不适用";
  if (platformConnectionKind(platform) === "oauth") {
    if (!row?.credentialStatus.configured) return "应用未配置";
    if (row.accountStatus === "Connected") return "已完成";
    return "未完成";
  }
  return "人工流程";
}
