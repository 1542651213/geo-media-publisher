import { useEffect, useRef, useState, type JSX } from 'react';
import { OWNERSHIP_CONFIDENCES, type AccountOnboardingAccount, type OwnershipConfidence, type OwnershipSourceKind } from '../shared/account-onboarding';
import { platformLabel } from './v11-ui-model';
import { ownershipPresentation } from './design/presentation';
import { EmptyState, LoadingState, StatusBadge } from './design/WorkspacePrimitives';

const confidenceLabels: Record<OwnershipConfidence, string> = { HIGH: '高 · 依据较充分', MEDIUM: '中 · 有关系证据', LOW: '低 · 线索有限', CONFLICT: '冲突 · 必须核对', NO_EVIDENCE: '无证据 · 手动选择' };
const sourceLabels: Record<OwnershipSourceKind, string> = { HistoricalJob: '历史任务和文章', PublishRecord: '发布记录和文章', SelectedImage: '已选企业图片', OfficialApiOperation: '官网操作和原稿' };

export function AccountOwnershipReview({ companyId, busy, onAction }: {
  companyId: string; busy: boolean; onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}): JSX.Element {
  const [accounts, setAccounts] = useState<AccountOnboardingAccount[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; companyName?: string }[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}), [reassignment, setReassignment] = useState<Record<string, boolean>>({});
  const [platform, setPlatform] = useState(''), [confidence, setConfidence] = useState(''), [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [error, setError] = useState(''), [saving, setSaving] = useState(''), [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = async (): Promise<void> => {
    const request = generation.current;
    const [items, brands] = await Promise.all([window.publisherAPI.accountOnboarding.preview(), window.publisherAPI.workspace.companies()]);
    if (generation.current !== request) return;
    setAccounts(items); setCompanies(brands);
    setMapping(current => Object.fromEntries(items.map(item => [item.accountId, current[item.accountId] ?? item.currentCompanyId ?? item.suggestedCompanyId ?? ''])));
    setLoading(false);
  };
  useEffect(() => {
    const request = ++generation.current; setLoading(true); setError('');
    void load().catch(reason => { if (generation.current === request) { setLoading(false); setError(reason instanceof Error ? reason.message : '无法读取账号证据，请刷新'); } });
    return () => { generation.current = request + 1; };
  }, [companyId]);
  const confirm = async (item: AccountOnboardingAccount): Promise<void> => {
    setSaving(item.accountId); setError('');
    try {
      const target = mapping[item.accountId]; if (!target) throw Error('请逐账号选择所属企业');
      if (target !== companyId) throw Error('请先将顶部企业工作区切换为所选企业，再确认此账号');
      await window.publisherAPI.accountOnboarding.confirm({ accountId: item.accountId, companyId: target, expectedVersion: item.currentBindingVersion, expectedCompanyId: item.currentCompanyId, confirmReassignment: reassignment[item.accountId] === true });
      await load(); await onAction(async () => undefined, '企业归属已确认，身份仍需重新检查。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '归属确认失败，原记录仍保留'); }
    finally { setSaving(''); }
  };
  const filtered = accounts.filter(item => (!platform || item.platformKey === platform) && (!confidence || item.confidence === confidence) && (!unresolvedOnly || !item.currentCompanyId || item.confidence === 'CONFLICT'));
  return <section className="panel operations-panel" aria-label="账号归属一页确认">
    <div className="panel-heading"><div><h3>历史账号逐项确认</h3><span>建议关系 ≠ 已确认归属 · 每个账号由 Owner 明确确认</span></div><StatusBadge label="人工核对入口" tone="blue" /></div>
    <p>共 {accounts.length} 个账号；未确认 {accounts.filter(item => !item.currentCompanyId).length}；冲突 {accounts.filter(item => item.confidence === 'CONFLICT').length}。所有历史发布和冻结记录保留。</p>
    <p>先选择顶部企业工作区，再逐账号核对建议并确认。历史使用不等于归属；确认归属不等于登录成功。可保留未确认，稍后继续。</p>
    <div className="operations-toolbar">
      <label>平台<select aria-label="归属筛选平台" value={platform} onChange={event => setPlatform(event.target.value)}><option value="">全部平台</option>{[...new Set(accounts.map(item => item.platformKey))].map(key => <option key={key} value={key}>{platformLabel(key)}</option>)}</select></label>
      <label>置信度<select aria-label="归属筛选置信度" value={confidence} onChange={event => setConfidence(event.target.value)}><option value="">全部置信度</option>{OWNERSHIP_CONFIDENCES.map(value => <option key={value} value={value}>{confidenceLabels[value]}</option>)}</select></label>
      <label className="check-row"><input type="checkbox" checked={unresolvedOnly} onChange={event => setUnresolvedOnly(event.target.checked)} />只看未确认或冲突</label>
      <span>显示 {filtered.length} / {accounts.length}</span>
    </div>
    {error && <div role="alert" className="notice error">{error}</div>}
    {loading ? <LoadingState title="正在读取归属证据…" description="保留当前归属与历史记录，等待可信关系资料。" /> : filtered.length === 0 ? <EmptyState title="当前筛选没有账号" description="调整平台、置信度或未确认筛选。需要核对的账号不会被自动绑定。" /> : filtered.map(item => {
      const target = mapping[item.accountId] ?? '', changing = Boolean(item.currentCompanyId && target && target !== item.currentCompanyId), disabled = busy || Boolean(saving) || item.archived;
      const presentation = ownershipPresentation(item);
      return <article key={item.accountId} className="owner-account-card">
        <div className="owner-account-heading"><div><strong>{item.accountName || '未命名账号'}</strong> · {platformLabel(item.platformKey)}{item.archived && ' · 已归档'}</div><StatusBadge label={confidenceLabels[item.confidence]} tone={presentation.attentionTone} /></div>
        <dl className="ownership-facts"><div><dt>当前企业归属</dt><dd>{presentation.current}</dd></div><div className="suggestion"><dt>建议企业 · 仅供核对</dt><dd>{presentation.suggested}</dd></div></dl>
        <p className="ownership-evidence">关系证据：{item.evidenceSummary}</p><div className={`notice ${presentation.attentionTone === 'danger' ? 'error' : presentation.attentionTone === 'warning' ? 'warning' : ''}`}>{presentation.attention}</div>
        {item.evidence.map(evidence => <details key={evidence.companyId}><summary>{evidence.companyName} · 查看关系来源</summary>{evidence.sources.map((source, index) => <p key={`${source.kind}:${source.referenceId}:${index}`}>{sourceLabels[source.kind ?? 'HistoricalJob']} · 参考 {source.referenceId ?? source.jobId}</p>)}</details>)}
        <p>身份核验：{item.verificationState === 'AUTHENTICATED' ? '最近已核实；发布前仍需检查' : item.verificationState === 'CHECKING' ? '正在核验' : '尚未通过当前身份核验'} · 普通平台能力 {item.platformOrdinaryEnabled ? '已开放，仍需账号与内容预检' : '未开放'} · 批量关闭</p>
        <details><summary>查看核验诊断与能力边界</summary><p>认证状态：{item.verificationState} · 文章资格尚未评估 · 绑定版本 {item.currentBindingVersion}。确认企业归属不会确认登录成功。</p></details>
        <label>确认所属企业<select aria-label={`账号所属企业 ${item.accountId}`} value={target} disabled={disabled} onChange={event => { setMapping(current => ({ ...current, [item.accountId]: event.target.value })); setReassignment(current => ({ ...current, [item.accountId]: false })); }}>
          <option value="">请选择企业 / 保留未确认</option>{companies.map(company => <option key={company.id} value={company.id}>{company.companyName || company.name}</option>)}
        </select></label>
        {target && target !== companyId && <p className="operations-warning">请先将顶部企业工作区切换为所选企业，再确认此账号。</p>}
        {changing && <label className="check-row"><input type="checkbox" checked={reassignment[item.accountId] === true} onChange={event => setReassignment(current => ({ ...current, [item.accountId]: event.target.checked }))} />Owner 已核对并明确修改企业归属</label>}
        {changing && item.bindingBlockers.map(blocker => <p key={blocker.code} className="operations-warning">{blocker.summary}（{blocker.count}）</p>)}
        <p>{item.nextAction}</p>
        <div className="operations-toolbar"><button className="secondary-button" disabled={disabled || !target || target !== companyId || (changing ? !item.canReassign || !reassignment[item.accountId] : !item.canConfirm)} onClick={() => void confirm(item)}>{saving === item.accountId ? '正在确认…' : '确认该账号企业归属'}</button>
          {!item.currentCompanyId && <button className="text-button" disabled={disabled} onClick={() => setMapping(current => ({ ...current, [item.accountId]: '' }))}>保留未确认</button>}</div>
      </article>;
    })}
  </section>;
}
