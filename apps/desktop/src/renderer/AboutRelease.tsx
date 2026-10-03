import { useEffect, useState, type JSX } from 'react';
import { BUILD_IDENTITY, type ProductReadiness } from '../shared/build-identity';
import { StatusBadge, LoadingState } from './design/WorkspacePrimitives';

export function AboutRelease(): JSX.Element {
  const [readiness, setReadiness] = useState<ProductReadiness | null>(null), [error, setError] = useState('');
  useEffect(() => { let active = true; void window.publisherAPI.product.readiness().then(value => { if (active) setReadiness(value); }).catch(() => { if (active) setError('暂时无法读取数据状态，请重新进入设置。'); }); return () => { active = false; }; }, []);
  return <section className="panel about-release"><div className="about-version-row"><div><h3>关于此版本</h3><strong>GEO Media Publisher {BUILD_IDENTITY.appVersion}</strong></div><StatusBadge label={`${BUILD_IDENTITY.deliveryId} · UI Candidate`} tone="blue" /></div><p>Owner 视觉确认后再决定是否合并。当前正式功能基线仍为 R1.15-H Candidate。</p>
    {error && <div role="alert" className="notice error">{error}</div>}{!readiness && !error && <LoadingState title="正在读取本机数据状态…" rows={2} />}{readiness && <><p>Owner 待核对 {readiness.ownerActionCount} 项：{readiness.unassignedAccounts} 个账号归属，{readiness.attentionJobs} 个发布任务，{readiness.unknownAIRequests} 个 AI 未知请求。</p><p>备份建议：{readiness.backupRecommended}</p></>}
    <details><summary>构建与数据版本详情</summary><p>交付版本 {BUILD_IDENTITY.deliveryId} · 应用版本 {BUILD_IDENTITY.appVersion}</p><p>源码 <code>{BUILD_IDENTITY.sourceCommit}</code> · 构建 {BUILD_IDENTITY.builtAt}</p>{readiness && <p>数据 Schema {readiness.dataSchemaVersion} · 已应用 {readiness.migrationCount} 项迁移</p>}</details>
  </section>;
}
