import { useEffect, useState, type JSX } from 'react';
import type { WorkspaceJobPage, WorkspaceJobQuery } from '../shared/workspace-jobs';
import { platformLabel, publishStatusLabel, publishStatusTone } from './v11-ui-model';
import { LoadingState, EmptyState } from './design/WorkspacePrimitives';
import { jobStateDescription } from './design/presentation';

export function JobsBoard({ companyId, refreshVersion = 0 }: { companyId: string; refreshVersion?: number }): JSX.Element {
  const [query, setQuery] = useState<WorkspaceJobQuery>({ page: 1 });
  const [data, setData] = useState<WorkspaceJobPage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const change = (filters: Partial<WorkspaceJobQuery>): void => setQuery(current => ({ ...current, ...filters, page: 1 }));
  useEffect(() => { setQuery({ page: 1 }); setData(null); }, [companyId]);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    void window.publisherAPI.jobs.page(query).then(result => { if (current && result.companyId === companyId) setData(result); }).catch(reason => { if (current) { setData(null); setError(reason instanceof Error ? reason.message : '读取历史任务失败，请重试'); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [companyId, query, revision, refreshVersion]);
  const rows = data?.companyId === companyId ? data.items : [];
  return <section className="panel operations-panel" aria-busy={loading}>
    <div className="panel-heading"><div><h3>发布看板</h3><span>查看当前企业完整历史，每页最多 50 条；正式操作在发布中心逐项确认。</span></div><button className="secondary-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>刷新任务状态</button></div>
    <div className="operations-toolbar operations-publish-filters">
      <select aria-label="任务筛选平台" value={query.platform ?? ''} disabled={loading} onChange={event => change({ platform: event.target.value || undefined })}><option value="">全部平台</option>{data?.platforms.map(key => <option key={key} value={key}>{platformLabel(key)}</option>)}</select>
      <select aria-label="任务筛选账号" value={query.account ?? ''} disabled={loading} onChange={event => change({ account: event.target.value || undefined })}><option value="">全部账号</option>{data?.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select>
      <input type="date" aria-label="发布日期" value={query.date ?? ''} disabled={loading} onChange={event => change({ date: event.target.value || undefined })} />
      <select aria-label="任务筛选状态" value={query.status ?? ''} disabled={loading} onChange={event => change({ status: event.target.value || undefined })}><option value="">全部状态</option>{data?.statuses.map(status => <option key={status} value={status}>{publishStatusLabel(status)}</option>)}</select>
      <label className="operations-checkbox"><input type="checkbox" checked={query.ownerOnly === true} disabled={loading} onChange={event => change({ ownerOnly: event.target.checked })} />只看 Owner 处理项</label>
    </div>
    {error && <div role="alert" className="notice error"><strong>任务读取失败，请刷新重试。</strong><details><summary>查看读取诊断</summary><span>{error}</span></details></div>}
    {loading ? <LoadingState title="正在读取当前企业的任务…" description="核对完整历史与当前筛选。首次读取可能需要几秒，任务状态以实际回执为准。" rows={4} /> : error ? <EmptyState title="任务暂未读取成功" description="当前无法判断是否有符合筛选的记录。请使用上方的“刷新任务状态”重试。" /> : rows.length === 0 ? <EmptyState title="当前筛选没有记录" description="调整平台、账号、日期或状态筛选。正式操作请在发布中心逐项确认。" /> : <div className="operations-table operations-publish-table">
      <div className="operations-table-head"><span>内容</span><span>平台</span><span>账号</span><span>日期</span><span>状态</span></div>
      {rows.map(row => <div className="operations-table-row" key={row.id}><strong>{row.title}</strong><span>{platformLabel(row.platform)}</span><span>{row.account}</span><span>{row.date ? new Date(row.date).toLocaleString('zh-CN') : '—'}</span><div><span className={`status-chip ${publishStatusTone(row.status)}`}>{publishStatusLabel(row.status)}</span><span className="job-state-hint">{jobStateDescription(row.status)}</span>{row.ownerActionRequired && <small className="operations-warning">需要 Owner 处理</small>}</div></div>)}
    </div>}
    {data && <nav className="operations-toolbar" aria-label="运营记录分页"><span>共 {data.total} 条 · 第 {data.page} / {data.pages} 页</span><button className="secondary-button" disabled={loading || data.page === 1} onClick={() => setQuery(current => ({ ...current, page: data.page - 1 }))}>上一页</button><button className="secondary-button" disabled={loading || data.page === data.pages} onClick={() => setQuery(current => ({ ...current, page: data.page + 1 }))}>下一页</button></nav>}
  </section>;
}
