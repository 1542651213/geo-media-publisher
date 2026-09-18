import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { Brand } from "@publisher/domain";
import type { ContentQualityItemView } from "@publisher/db";
import { HumanReviewCalibrationPanel } from "./HumanReviewCalibrationPanel";

const statusClass = (status: string): string => status === "Approved" ? "success" : status === "Rejected" ? "danger" : status === "Needs_Review" ? "warning" : status === "AI_Checked" ? "purple" : "muted";
type History = Awaited<ReturnType<typeof window.publisherAPI.quality.history>>;

export function QualityGatePage({ refresh }: { refresh: () => void }): JSX.Element {
  const [items, setItems] = useState<ContentQualityItemView[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [history, setHistory] = useState<Record<string, History>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ item: ContentQualityItemView; title: string; body: string; summary: string } | null>(null);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const notify = (nextMessage: string, error = false): void => { setMessage(nextMessage); setMessageError(error); };
  const load = (): void => { void Promise.all([window.publisherAPI.quality.items(), window.publisherAPI.brands.list()]).then(([nextItems, nextBrands]) => { setItems(nextItems); setBrands(nextBrands); }); };
  useEffect(load, [refresh]);
  const run = async (item: ContentQualityItemView): Promise<void> => { try { await window.publisherAPI.quality.recheck(item.contentType, item.contentId); notify("已完成重新检查，发布前仍需要人工批准。"); load(); refresh(); } catch (error) { notify(error instanceof Error ? error.message : "重新检查失败", true); } };
  const decide = async (item: ContentQualityItemView, status: "Approved" | "Rejected"): Promise<void> => { try { await window.publisherAPI.quality.decide(item.contentType, item.contentId, status, status === "Approved" ? "人工审核批准" : "人工审核驳回"); notify(status === "Approved" ? "内容已批准，可进入发布队列。" : "内容已拒绝，需修改后重新检查。"); load(); refresh(); } catch (error) { notify(error instanceof Error ? error.message : "审核决策失败", true); } };
  const toggleHistory = async (item: ContentQualityItemView): Promise<void> => { const key = `${item.contentType}:${item.contentId}`; if (history[key]) { setHistory((current) => { const next = { ...current }; delete next[key]; return next; }); return; } const rows = await window.publisherAPI.quality.history(item.contentType, item.contentId); setHistory((current) => ({ ...current, [key]: rows })); setExpanded(key); };
  const openEditor = (item: ContentQualityItemView): void => setEditor({ item, title: item.title, body: item.body, summary: item.summary });
  const saveEditor = async (): Promise<void> => {
    if (!editor) return;
    try {
      if (editor.item.contentType === "article_variant") await window.publisherAPI.articles.updateVariant(editor.item.contentId, { title: editor.title, body: editor.body, summary: editor.summary });
      else await window.publisherAPI.articles.update(editor.item.contentId, { title: editor.title, body: editor.body, summary: editor.summary });
      await window.publisherAPI.quality.recheck(editor.item.contentType, editor.item.contentId);
      setEditor(null); notify("人工编辑已保存，并完成重新检查。"); load(); refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "编辑并复检失败", true); }
  };
  return <>
    <div className="studio-hero quality-hero"><div><div className="eyebrow">V0.9.1 / AI 内容审核中心</div><h2>AI Quality Gate</h2><p>对品牌事实、营销风险、城市一致性、平台长度、SEO 和重复度进行可追溯审核。只有 Approved 内容允许进入发布队列。</p></div><div className="studio-hero-badge">9 项检查<br /><small>生成后自动检查 · 人工修改后复检 · 审核历史</small></div></div>
    {message && <div className={`notice ${messageError ? "error" : "success"}`}>{message}</div>}
    <HumanReviewCalibrationPanel onMessage={notify} onRefresh={() => { load(); refresh(); }} />
    <section className="panel table-panel quality-panel"><div className="panel-heading"><div><h3>内容审核列表</h3><span>标题 · 品牌 · 城市 · 平台 · 风险数量 · 当前状态；内容哈希变化会使旧批准自动失效。</span></div><button className="secondary-button" onClick={load}>刷新</button></div>
      {items.length === 0 ? <div className="empty-state"><strong>暂无待审核内容</strong><p>从 AI Content Studio 或批量生成创建内容后，自动审核结果会显示在这里。</p></div> : <div className="quality-list">{items.map((item) => {
        const key = `${item.contentType}:${item.contentId}`;
        const record = history[key];
        const latest = record?.reviews[0];
        const brand = brands.find((candidate) => candidate.id === item.brandId);
        const canApprove = item.status === "AI_Checked" || item.status === "Needs_Review";
        return <article className="quality-row" key={key}><div className="quality-main"><div><div className="quality-title"><strong>{item.title || "无标题"}</strong><span className={`status-pill ${statusClass(item.status)}`}>{item.status}</span></div><span>{brand?.name ?? item.brandId} · {item.city} · {item.platformKey ?? "文章"} · {item.keyword}</span><small>分数 {item.score ?? "—"} · 风险 {item.issueCount} · {new Date(item.updatedAt).toLocaleString("zh-CN")}</small></div><div className="row-actions"><button className="mini-button" onClick={() => void run(item)}>重新 AI 检查</button>{canApprove && <button className="mini-button" onClick={() => void decide(item, "Approved")}>批准</button>}{item.status !== "Rejected" && <button className="mini-button danger-mini" onClick={() => void decide(item, "Rejected")}>驳回</button>}<button className="mini-button" onClick={() => openEditor(item)}>编辑并复检</button><button className="mini-button" onClick={() => void toggleHistory(item)}>历史</button></div></div>{expanded === key && latest && <div className="quality-detail"><h4>风险项与证据</h4>{latest.issues.length === 0 ? <small>本次检查未发现风险项。</small> : latest.issues.map((risk, index) => <div className="quality-risk" key={`${risk.code}-${index}`}><b>{risk.severity === "error" ? "高风险" : "需复核"} · {risk.code}</b><span>{risk.message}</span>{risk.evidence && <small>证据：{risk.evidence}</small>}<small>原文位置：{risk.location ?? "标题或正文"}</small>{risk.suggestion && <small>建议：{risk.suggestion}</small>}</div>)}<div className="quality-history">{record?.audits.map((audit) => <div className="quality-history-row" key={audit.id}><span>{new Date(audit.timestamp).toLocaleString("zh-CN")}</span><b>{audit.operatorType === "human" ? "人工" : "系统"}</b><span>{audit.previousStatus} → {audit.newStatus}</span><span>{audit.reason}</span><small>Hash {audit.contentHash.slice(0, 12)}</small></div>)}</div></div>}{record && <div className="quality-history">{record.reviews.map((review) => <div className="quality-history-row" key={review.id}><span>{new Date(review.createdAt).toLocaleString("zh-CN")}</span><b className={`status-pill ${statusClass(review.status)}`}>{review.status}</b><span>{review.operatorType === "human" ? "人工" : review.trigger}</span><span>{review.provider}/{review.model}</span><span>{review.score} 分</span></div>)}</div>}</article>;
      })}</div>}
    </section>
    {editor && <div className="drawer-backdrop" onClick={() => setEditor(null)}><aside className="drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">人工审核</span><h2>编辑并复检</h2></div><button className="icon-button" onClick={() => setEditor(null)}>×</button></div><label>标题<input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label><label>摘要<textarea rows={3} value={editor.summary} onChange={(event) => setEditor({ ...editor, summary: event.target.value })} /></label><label>正文<textarea rows={16} value={editor.body} onChange={(event) => setEditor({ ...editor, body: event.target.value })} /></label><div className="hint-box">保存后会将状态重置为 Draft，并立即执行一次 Quality Gate 复检。</div><div className="drawer-footer"><button className="secondary-button" onClick={() => setEditor(null)}>取消</button><button className="primary-button" onClick={() => void saveEditor()}>保存并复检</button></div></aside></div>}
  </>;
}
