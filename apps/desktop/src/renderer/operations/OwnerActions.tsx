import type { JSX } from 'react';
import type { OperationsOwnerAction } from '../../shared/content-operations';
import { AccountOwnershipReview } from '../AccountOwnershipReview';
import { ownerReleaseChecklist } from '../design/presentation';
import { EmptyState, StatusBadge } from '../design/WorkspacePrimitives';
import { platformLabel } from '../v11-ui-model';

function dateText(value: string | null): string {
  if (!value) return '尚未记录';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN');
}

export function OwnerTab({ rows, companyId, busy, onNavigate, onAction }: { rows: OperationsOwnerAction[]; companyId: string; busy: boolean; onNavigate?: (route: string) => void; onAction: (action: () => Promise<unknown>, success: string) => Promise<void> }): JSX.Element {
  const routeForAction = (action: string): string => action.includes('AI') ? 'ai-center' : action.includes('发布') || action.includes('reconcile') ? 'publishing' : 'accounts';
  return <div className="operations-stack">
    <section className="panel operations-panel"><div className="panel-heading"><div><h3>需要我处理</h3><span>当前企业的实时运营事项。归属、登录身份和文章发布资格分别核对。</span></div><StatusBadge label={`${rows.length} 项当前事项`} tone={rows.length ? 'warning' : 'muted'} /></div>
      {rows.length === 0 ? <EmptyState title="当前企业没有新增运营处理项" description="仍需核对下方 H 交付清单；这里的数量不代表历史发布或备份已经通过。" /> : rows.map(row => <article className="owner-action-row" key={row.id}><strong>{row.what.replace(/^(\S+)(\s+)/u, (_match, key: string, space: string) => platformLabel(key) + space)}</strong><p>{row.why}</p><p className="owner-risk">处理前请核对企业与账号身份，未验证状态不能作为发布资格。</p><small>最近检查：{dateText(row.lastCheckedAt)}</small><div className="row-actions"><button className="secondary-button" disabled={!onNavigate} onClick={() => onNavigate?.(routeForAction(row.action))}>{row.action}</button></div></article>)}
    </section>
    <section className="panel operations-panel"><div className="panel-heading"><div><h3>H 交付后待 Owner 核对</h3><span>以下是 H 基线交付清单，并非当前企业的实时检查结论。处理结果需 Owner 另行确认。</span></div><StatusBadge label="交付清单 · 待核对" tone="warning" /></div>
      {([['must', '必须处理', '使用相关账号或恢复资料前核对'], ['suggested', '建议处理', '按实际使用需求安排'], ['later', '可稍后处理', '广泛分发前完成']] as const).map(([priority, title, note]) => <section className="owner-priority-group" key={priority} aria-label={title}><div className="owner-priority-heading"><h4>{title}</h4><span>{note}</span></div><div className="owner-release-list">{ownerReleaseChecklist.filter(item => item.priority === priority).map(item => <article className="owner-release-item" key={item.title}><strong>{item.title}</strong><p>{item.detail}</p><details><summary>风险与处理原则</summary><p className="owner-risk">{item.risk}</p></details>{item.route ? <button className="text-button" disabled={!onNavigate} onClick={() => onNavigate?.(item.route)}>{item.next} →</button> : <a href="#ownership-review">{item.next} ↓</a>}</article>)}</div></section>)}
    </section>
    <div id="ownership-review"><AccountOwnershipReview companyId={companyId} busy={busy} onAction={onAction} /></div>
  </div>;
}
