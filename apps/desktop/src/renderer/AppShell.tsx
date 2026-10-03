import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { Brand } from '@publisher/domain';
import { BUILD_IDENTITY } from '../shared/build-identity';
import { normalNavigation, type V11NavigationTarget } from './v11-ui-model';
import { useDialogAccessibility } from './design/dialog-accessibility';

const navGroups = [{ title: '运营工作台', items: normalNavigation }];
const routeLabels = new Map<V11NavigationTarget, string>([...normalNavigation.map(item => [item.route, item.label] as const), ['preferences', '设置'], ['advanced', '高级设置'], ['brand', '企业资料'], ['knowledge', '企业知识库'], ['backups', '数据备份'], ['platforms', '平台能力'], ['self-test', '平台自测'], ['quality', '高级审核规则'], ['quality-rules', '平台内容规则'], ['studio', '内容生产高级设置'], ['batch', '批量生成'], ['keywords', '关键词扩展'], ['ai-tasks', '内容生产记录'], ['assets', '视频素材'], ['images-advanced', '图片高级标签'], ['plans', '发布计划'], ['queue', '发布任务与技术诊断'], ['logs', '运行日志'], ['settings', 'AI 与模型设置'], ['placeholder', '模块准备中']]);

export function AppShell({ route, onNavigate, children, companies, companyId, switching, onSelectCompany }: {
  route: V11NavigationTarget; onNavigate: (route: V11NavigationTarget) => void; children: ReactNode; companies: Brand[]; companyId: string; switching: boolean; onSelectCompany: (id: string) => Promise<void>;
}): JSX.Element {
  useDialogAccessibility();
  const current = routeLabels.get(route) ?? '首页';
  const company = companies.find(item => item.id === companyId);
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof window.publisherAPI.product.buildIdentity>> | null>(null);
  useEffect(() => { void window.publisherAPI.product.buildIdentity().then(setRuntime).catch(() => {}); }, []);
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-mark" aria-hidden="true">GEO</div><div><strong>GEO Publisher</strong><span>内容运营工作台</span></div></div>
      <div className="workspace-switch"><label>当前企业工作区<select aria-label="当前企业工作区" value={companyId} disabled={switching} onChange={event => void onSelectCompany(event.target.value)}><option value="" disabled>请先创建企业</option>{companies.map(item => <option key={item.id} value={item.id}>{item.companyName || item.name}</option>)}</select></label></div>
      <nav aria-label="主要导航">{navGroups.map(group => <div className="nav-group" key={group.title}><div className="nav-caption">{group.title}</div>{group.items.map(item => <button className={`nav-item ${item.route === route ? 'active' : ''}`} aria-current={item.route === route ? 'page' : undefined} key={item.route} onClick={() => onNavigate(item.route)}><span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}</button>)}</div>)}</nav>
      <div className="sidebar-footer"><button className={`nav-item ${route === 'preferences' ? 'active' : ''}`} onClick={() => onNavigate('preferences')}><span className="nav-icon" aria-hidden="true">⚙</span>设置</button><button className={`nav-item ${route === 'advanced' ? 'active' : ''}`} onClick={() => onNavigate('advanced')}><span className="nav-icon" aria-hidden="true">⌘</span>高级功能</button><div className="build-stamp" title={`源码 ${BUILD_IDENTITY.sourceCommit} · 构建 ${BUILD_IDENTITY.builtAt}`}>{BUILD_IDENTITY.deliveryId} · {BUILD_IDENTITY.appVersion}<small>{BUILD_IDENTITY.sourceCommit.slice(0, 8)}</small></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div><div className="breadcrumb">内容运营 <span>/</span> {current}</div><h1>{current}</h1></div><div className="top-actions"><button className="company-context-chip" onClick={() => onNavigate('brand')} title="查看企业资料">{company?.companyName || company?.name || '创建企业资料'}</button><div className="avatar" aria-hidden="true">运</div></div></header><section className="content-area">
      {runtime?.automaticExecutionDisabled && <div role="status" className="notice warning">隔离恢复 · 人工复核中。外部连接、云请求与自动执行已暂停；请核对企业、账号身份和未知结果后按恢复说明处理。</div>}
      {runtime && runtime.sourceCommit !== BUILD_IDENTITY.sourceCommit && <div role="alert" className="notice error">安装包组件版本不一致，请使用交付清单中的完整安装包。</div>}
      {children}
    </section></main>
  </div>;
}
