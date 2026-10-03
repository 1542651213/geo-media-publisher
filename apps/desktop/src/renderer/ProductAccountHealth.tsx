import { useEffect, useState } from "react";
import type { JSX } from "react";
import { productPlatform, type ProductAccountHealth as Health } from "../shared/product-platform-policy";
import { operationsHealthPresentation } from './operations-center-ui';
import { StatusBadge, EmptyState } from './design/WorkspacePrimitives';
export function ProductAccountHealth({ refreshKey }: { refreshKey: number }): JSX.Element {
  const [rows, setRows] = useState<Health[]>([]), [error, setError] = useState("");
  useEffect(() => { void window.publisherAPI.product.health().then(setRows).catch(() => setError("账号健康暂时无法读取，请重试")); }, [refreshKey]);
  return <section className="panel product-account-health"><div className="panel-heading"><div><h3>账号健康与下一步</h3><span>身份、企业归属与普通发布资格分别核对。发布前仍会重新检查远端身份。</span></div><StatusBadge label="所有批量发布关闭" tone="muted" /></div>{error && <div role="alert" className="notice error">{error}</div>}
    {rows.length === 0 && !error && <EmptyState title="等待可信的账号状态" description="账号状态来自当前连接检查；尚未验证不会显示为已登录。" />}
    <div className="account-health-card-grid">{rows.map(row => <article className="account-health-card" key={`${row.platformKey}:${row.accountId}`}><header><strong>{productPlatform(row.platformKey)?.displayName} · {row.accountName}</strong><StatusBadge label={row.status} tone={operationsHealthPresentation(row.status).tone} /></header><div className="account-health-facts">
      <div><span>所属企业</span><b>{row.companyName || '尚未确认'}</b></div><div><span>身份核验</span><b>{row.identityEvidence === 'REMOTE_VERIFIED' ? '最近已核实 · 发布前再检查' : '尚未核实'}</b></div>
      <div><span>上次检查</span><b>{row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString('zh-CN') : '尚未验证'}</b></div><div><span>普通发布能力</span><b>{productPlatform(row.platformKey)?.ordinaryPublishEnabled ? '平台已开放 · 需账号及内容预检' : '当前平台未开放'}</b></div>
    </div><p className="account-health-next">下一步：{row.ownerNextAction}</p><details><summary>连接与诊断详情</summary><p>连接方式：{row.connectionMode === 'BrowserAutomation' ? '官方浏览器' : row.connectionMode} · 平台 {row.platformKey} · 批量发布关闭</p></details></article>)}</div>
  </section>;
}
