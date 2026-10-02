import { STUDIO_TARGETS } from "@publisher/domain";
import type { OperationsPlanStatus } from "../shared/content-operations";
import type { ProductHealthStatus } from "../shared/product-platform-policy";

export type OperationsTab = "today" | "review" | "queue" | "plan" | "facts" | "usage" | "import" | "owner" | "publish";
export type OperationsTone = "success" | "warning" | "danger" | "purple" | "muted";

export const operationsPlatformOptions = [...STUDIO_TARGETS];

export function canonicalStudioTargets(values: readonly string[]): Array<typeof STUDIO_TARGETS[number]> {
  const allowed = new Set<string>(operationsPlatformOptions);
  return values.filter((value): value is typeof STUDIO_TARGETS[number] => allowed.has(value));
}

export function startOperationsQueueRefresh(refresh:()=>Promise<unknown>,intervalMs=1000):()=>void {
  let active=true;
  let timer:ReturnType<typeof setTimeout>;
  const tick=async():Promise<void>=>{
    // The UI refresh callback displays read errors; a rejected read must not leak a timer.
    await refresh().catch(()=>undefined);
    if(active)timer=setTimeout(()=>void tick(),intervalMs);
  };
  timer=setTimeout(()=>void tick(),intervalMs);
  return()=>{active=false;clearTimeout(timer);};
}

export async function transitionAndRunGenerationQueue(
  transition: () => Promise<unknown>,
  run: () => Promise<unknown>,
): Promise<void> {
  await transition();
  void run().catch(() => undefined);
}

export async function preparePlanAndNavigate(
  prepare: () => Promise<unknown>,
  navigate: () => void,
): Promise<void> {
  await prepare();
  navigate();
}

export function planDraftBody(topic: string, contentType: string): string {
  return `内容计划：${topic.trim()}\n内容类型：${contentType.trim()}\n\n正文待人工编辑。`;
}

export function isValidGenerationCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}

export function factExpiryIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const expiry = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (expiry.getFullYear() !== year || expiry.getMonth() !== month - 1 || expiry.getDate() !== day) return null;
  return expiry.toISOString();
}

export function generationProgressPercent(
  queueId: string,
  completedCount: number,
  items: ReadonlyArray<{ queueId: string }>,
): number {
  const totalItems = items.filter(item => item.queueId === queueId).length;
  if (totalItems === 0) return 0;
  return Math.min(100, completedCount / totalItems * 100);
}

export interface OperationsUiState {
  companyId: string;
  selectedReviewId: string;
  selectedPlanId: string;
  selectedQueueId: string;
  importFileName: string;
  queueTopic: string;
  importPreviewReady: boolean;
}

export interface WorkspaceRequestToken {
  companyId: string;
  requestId: number;
}

export interface OwnerActionCopy {
  what: string;
  why: string;
  action: string;
}

export interface QueueActionAvailability {
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  retryFailed: boolean;
}

export function initialOperationsUiState(companyId: string): OperationsUiState {
  return {
    companyId,
    selectedReviewId: "",
    selectedPlanId: "",
    selectedQueueId: "",
    importFileName: "",
    queueTopic: "",
    importPreviewReady: false,
  };
}

export function advanceWorkspaceRequest(previous: WorkspaceRequestToken | undefined, companyId: string): WorkspaceRequestToken {
  return { companyId, requestId: (previous?.requestId ?? 0) + 1 };
}

export function isCurrentWorkspaceResponse(current: WorkspaceRequestToken, response: WorkspaceRequestToken): boolean {
  return current.companyId === response.companyId && current.requestId === response.requestId;
}

export function ownerActionCopy(code: string): OwnerActionCopy {
  const copies: Record<string, OwnerActionCopy> = {
    WEIBO_LOGIN_REQUIRED: {
      what: "登录微博账号",
      why: "微博会话需要 Owner 在平台正常登录后才能继续。",
      action: "前往账号中心",
    },
    SOHU_CREATOR_LOGIN_REQUIRED: {
      what: "登录搜狐 Creator",
      why: "搜狐账号尚未建立可验证的 Creator 会话。",
      action: "前往账号中心",
    },
    CNBLOGS_CREDENTIAL_INVALID: {
      what: "更新博客园 PAT",
      why: "当前博客园凭据已失效或无法通过验证。",
      action: "前往账号中心",
    },
    PROVIDER_NOT_CONFIGURED: {
      what: "配置 AI 服务商",
      why: "草稿生成队列缺少可用的服务商配置。",
      action: "配置 AI 服务商",
    },
    ACCOUNT_EXPIRED: {
      what: "恢复失效账号",
      why: "账号身份已确认失效，需要重新连接。",
      action: "前往账号中心",
    },
    RECONCILIATION_REQUIRED: {
      what: "核对发布结果",
      why: "任务结果仍不确定，需要人工核对平台记录。",
      action: "进入发布中心",
    },
  };
  return copies[code] ?? {
    what: "处理账号或任务异常",
    why: "该事项需要人工确认后才能继续。",
    action: "查看详情",
  };
}

export function queueActionAvailability(status: string, hasValidationBlocked = false): QueueActionAvailability {
  const normalized = status.toUpperCase();
  return {
    pause: normalized === "RUNNING",
    resume: normalized === "PAUSED",
    cancel: normalized === "PENDING" || normalized === "RUNNING" || normalized === "PAUSED",
    retryFailed: !hasValidationBlocked && (normalized === "FAILED" || normalized === "COMPLETED_WITH_ERRORS"),
  };
}

export function operationsHealthPresentation(status: ProductHealthStatus): { label: string; tone: OperationsTone } {
  if (status === "可发布" || status === "已连接") return { label: status, tone: "success" };
  if (status === "正在验证账号") return { label: status, tone: "purple" };
  if (["凭据失效", "登录已失效，请重新登录", "凭据已失效，请更新凭据", "当前登录账号与绑定账号不一致"].includes(status)) return { label: status, tone: "danger" };
  if (["需要登录", "需要 Owner 操作", "连接异常", "暂时无法验证连接"].includes(status)) return { label: status, tone: "warning" };
  return { label: status, tone: "muted" };
}

export function planStatusLabel(status: OperationsPlanStatus): string {
  return { Planned: "计划中", DraftCreated: "已创建草稿", Archived: "已归档" }[status];
}

export function planMatchesStatus(status: OperationsPlanStatus, filter: OperationsPlanStatus | ""): boolean {
  return filter === "" || status === filter;
}

/** Filter first, then render a bounded page without dropping historical rows. */
export function operationsPage<T>(rows: readonly T[], requested: number): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1));
  return { items: rows.slice((page - 1) * 50, page * 50), page, pages, total: rows.length };
}
