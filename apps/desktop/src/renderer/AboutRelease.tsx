import { useEffect, useState, type JSX } from 'react';
import { BUILD_IDENTITY, type ProductReadiness } from '../shared/build-identity';

export function AboutRelease(): JSX.Element {
  const [readiness, setReadiness] = useState<ProductReadiness | null>(null), [error, setError] = useState('');
  useEffect(() => { let active = true; void window.publisherAPI.product.readiness().then(value => { if (active) setReadiness(value); }).catch(() => { if (active) setError('暂时无法读取数据状态，请重新进入设置。'); }); return () => { active = false; }; }, []);
  return <section className="panel"><h3>关于此版本</h3><p>交付版本 {BUILD_IDENTITY.deliveryId} · 应用版本 {BUILD_IDENTITY.appVersion}</p><p>构建 {BUILD_IDENTITY.sourceCommit.slice(0, 8)} · {BUILD_IDENTITY.builtAt}</p>
    {error && <p role="alert">{error}</p>}{readiness && <><p>数据 Schema {readiness.dataSchemaVersion} · 已应用 {readiness.migrationCount} 项迁移</p><p>Owner 待核对 {readiness.ownerActionCount} 项：{readiness.unassignedAccounts} 个账号归属，{readiness.attentionJobs} 个发布任务，{readiness.unknownAIRequests} 个 AI 未知请求。</p><p>备份建议：{readiness.backupRecommended}</p></>}
  </section>;
}
