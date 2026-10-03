import type { JSX } from 'react';
import { EmptyState, StatusBadge } from '../design/WorkspacePrimitives';
import { operationsHealthPresentation, type OperationsTab } from '../operations-center-ui';
import { platformLabel } from '../v11-ui-model';
import type { OperationsViewSnapshot } from './view-types';

export function TodayTab({ snapshot, onNavigate, onTab }: { snapshot: OperationsViewSnapshot; onNavigate?: (route: string) => void; onTab: (tab: OperationsTab) => void }): JSX.Element {
  const metrics = [['待审核草稿', snapshot.dashboard.pendingReview, 'review'], ['已审核内容', snapshot.dashboard.approved, 'publish'], ['今日内容计划', snapshot.dashboard.draftPlansToday, 'plan']] as const;
  const attention = snapshot.dashboard.needsOwnerAction > 0 || snapshot.dashboard.failed > 0;
  return <>
    <section className={`panel home-attention ${attention ? '' : 'clear'}`}>
      <div className="home-attention-heading"><div><h3>先处理需要关注的事项</h3><p>账号、生成与人工事项优先；发布失败和未知结果请在发布看板核对。</p></div><StatusBadge label={attention ? '有待处理事项' : '当前运营快照无新增异常'} tone={attention ? 'warning' : 'muted'} /></div>
      <div className="home-attention-grid">
        <button className="attention-action" onClick={() => onTab('owner')}><div><span>需要 Owner 处理</span><small>核对身份、归属与连接</small></div><strong>{snapshot.dashboard.needsOwnerAction}</strong></button>
        <button className="attention-action" onClick={() => onTab('queue')}><div><span>生成异常待处理</span><small>查看失败、可恢复和阻塞项</small></div><strong>{snapshot.dashboard.failed}</strong></button>
        <button className="attention-action" onClick={() => onTab('publish')}><div><span>核对发布结果</span><small>失败与未知结果以原任务为准</small></div><strong aria-hidden="true">→</strong></button>
      </div>
    </section>
    <div className="home-section-title"><h3>今天的内容工作</h3><span>当前企业 · 独立工作区</span></div>
    <section className="operations-metrics">{metrics.map(([label, value, target]) => <button type="button" key={label} onClick={() => onTab(target)}><span>{label}</span><strong>{value}</strong><em>查看详情 →</em></button>)}</section>
    <div className="operations-two-column">
      <section className="panel operations-panel"><div className="panel-heading"><div><h3>平台与账号状态</h3><span>最近一次可信检查结果；未知状态保持待核对。</span></div></div>
        {snapshot.platformHealth.length === 0 ? <EmptyState title="还没有可信的账号检查结果" description="在账号中心核对当前企业的账号与身份；持久化登录标记不能代替实时核验。" action={<button className="secondary-button" disabled={!onNavigate} onClick={() => onNavigate?.('accounts')}>前往账号中心</button>} /> : <div className="operations-list">{snapshot.platformHealth.map(row => { const presentation = operationsHealthPresentation(row.status); return <div key={`${row.platformKey}-${row.message}`}><div><strong>{platformLabel(row.platformKey)}</strong><span>{row.message}</span></div><StatusBadge label={presentation.label} tone={presentation.tone} /></div>; })}</div>}
      </section>
      <section className="panel operations-panel"><div className="panel-heading"><div><h3>开始今天的工作</h3><span>生成与导入只创建草稿，发布仍需核对。</span></div></div><div className="operations-shortcuts">
        <button className="primary-button" onClick={() => onTab('review')}>审核草稿</button>
        <button className="secondary-button" onClick={() => onTab('queue')}>生成今日内容</button>
        <button className="secondary-button" onClick={() => onTab('plan')}>查看内容计划</button>
        <button className="secondary-button" disabled={!onNavigate} title={onNavigate ? '' : '当前容器未提供页面导航'} onClick={() => onNavigate?.('publishing')}>进入发布中心</button>
      </div><div className="home-section-title"><span>今日已发布 {snapshot.dashboard.todayPublished}</span><span>生成中 {snapshot.dashboard.generating}</span></div></section>
    </div>
  </>;
}
