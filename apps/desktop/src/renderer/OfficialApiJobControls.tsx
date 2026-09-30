import type { JSX } from "react";
import type { OfficialApiJobView, OfficialApiMaintenanceOperation } from "../shared/official-api";
import { websiteJobActions } from "./official-api-publish-ui";

const operationLabel: Record<OfficialApiMaintenanceOperation, string> = {
  unpublish: "下线公开内容",
  delete: "移入回收站",
  restore: "恢复内容",
  purge: "永久清除"
};

export function OfficialApiJobControls({ view, busy, onRecover, onMaintain }: {
  view: OfficialApiJobView;
  busy: boolean;
  onRecover(): void;
  onMaintain(operation: OfficialApiMaintenanceOperation): void;
}): JSX.Element {
  const actions = websiteJobActions(view);
  const maintain = (operation: OfficialApiMaintenanceOperation): void => {
    const prompt = operation === "purge"
      ? "永久清除后不可恢复。仅在服务端确认 canPurge 后继续。确认永久清除？"
      : `确认执行“${operationLabel[operation]}”？系统会使用这条任务原有的官网绑定。`;
    if (window.confirm(prompt)) onMaintain(operation);
  };
  return <section className="panel" aria-label="官网任务恢复与维护">
    <h3>官网任务状态</h3>
    <div className="v11-job-detail">
      <span>环境：{view.environment === "production" ? "正式环境 production" : "测试环境 staging"}</span>
      <span>站点：{view.siteId} · 类型：{view.kind === "case" ? "现场案例" : "行业科普"}</span>
      <span>阶段：{view.phase}</span>
      {view.contentId && <span>内容 ID：{view.contentId}</span>}{view.revisionId && <span>版本 ID：{view.revisionId}</span>}
      {view.contentHash && <span>内容哈希：{view.contentHash}</span>}
      {view.remoteJobId && <span>远端任务 ID：{view.remoteJobId}</span>}{view.rowVersion !== null && <span>行版本：{view.rowVersion}</span>}
      {view.publicUrl && <span>公开地址：{view.publicUrl}</span>}
      {view.publicContentVerified !== null && <span>公开内容校验：{view.publicContentVerified ? "通过" : "未通过"}</span>}
      {view.fidelityWarning && <div className="notice warning">内容已发布；一致性提醒：{view.fidelityWarning}</div>}
      {view.errorCode && <div className="notice warning">错误代码：{view.errorCode}</div>}
    </div>
    <div className="row-actions">
      {actions.includes("recover") && <button className="secondary-button" disabled={busy} onClick={onRecover}>{busy ? "恢复中…" : "按原操作恢复"}</button>}
      {actions.filter((action): action is OfficialApiMaintenanceOperation => action !== "recover").map(operation =>
        <button className={operation === "purge" ? "mini-button danger-mini" : "mini-button"} disabled={busy} key={operation} onClick={() => maintain(operation)}>{operationLabel[operation]}</button>)}
    </div>
  </section>;
}
