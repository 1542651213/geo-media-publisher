import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { ContentQualityIssue } from "@publisher/domain";
import type { HumanReviewContentSnapshot, HumanReviewDatasetItemView, HumanReviewDatasetView, HumanReviewDecision, HumanReviewFinalStatus, HumanReviewSubmitInput } from "@publisher/db";

const statusClass = (status: string): string => status === "Approved" ? "success" : status === "Rejected" ? "danger" : status === "Needs_Review" ? "warning" : "purple";
const decisionLabel: Record<HumanReviewDecision, string> = { TruePositive: "规则判断正确", FalsePositive: "规则误报", Uncertain: "不确定", MissedIssue: "发现系统漏检" };
const platformLabel: Record<string, string> = { wechat_official: "微信公众号", zhihu: "知乎", toutiao: "今日头条", weibo: "微博", douyin: "抖音", bilibili: "B站" };

interface DraftContent { title: string; body: string; summary: string; }
interface DecisionDraft { machineDecision: "Detected" | "NotDetected"; humanDecision: HumanReviewDecision; reason: string; issue: ContentQualityIssue | null; }

const contentHash = async (content: HumanReviewContentSnapshot): Promise<string> => {
  const input = `${content.title}\n${content.body}${content.platformKey ? `\n${content.platformKey}` : ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
};

export function HumanReviewCalibrationPanel({ onMessage, onRefresh }: { onMessage: (message: string, error?: boolean) => void; onRefresh: () => void }): JSX.Element {
  const [dataset, setDataset] = useState<HumanReviewDatasetView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HumanReviewDatasetItemView | null>(null);
  const [draft, setDraft] = useState<DraftContent | null>(null);
  const [editing, setEditing] = useState(false);
  const [finalStatus, setFinalStatus] = useState<HumanReviewFinalStatus>("Needs_Review");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DecisionDraft>>({});
  const [missedRuleId, setMissedRuleId] = useState("");
  const [missedReason, setMissedReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback((): void => { void window.publisherAPI.humanReview.dataset().then(setDataset).catch((error: unknown) => onMessage(error instanceof Error ? error.message : "固定人工审核队列加载失败", true)); }, [onMessage]);
  useEffect(load, [load]);

  const openItem = (item: HumanReviewDatasetItemView): void => {
    setSelectedId(item.id); setDetail(item); setDraft({ title: item.content.title, body: item.content.body, summary: item.content.summary }); setEditing(false); setFinalStatus(item.finalStatus ?? (item.originalStatus === "Approved" ? "Approved" : "Needs_Review")); setStartedAt(item.reviewStatus === "Pending" ? Date.now() : null); setMissedRuleId(""); setMissedReason("");
    const next: Record<string, DecisionDraft> = {};
    for (const issue of item.issues) next[`${issue.ruleId}:${issue.issueIndex}`] = { machineDecision: "Detected", humanDecision: issue.humanDecision ?? "Uncertain", reason: issue.reason ?? "", issue: issue.issue };
    for (const decision of item.latestReview?.issueDecisions ?? []) if (decision.machineDecision === "NotDetected") next[`${decision.ruleId}:${decision.issueIndex}`] = { machineDecision: "NotDetected", humanDecision: decision.humanDecision, reason: decision.reason ?? "", issue: decision.issue };
    setDecisions(next);
  };

  const selectedSequence = useMemo(() => dataset?.items.find((item) => item.id === selectedId)?.sequence ?? null, [dataset, selectedId]);
  const setIssueDecision = (ruleId: string, issueIndex: number, humanDecision: HumanReviewDecision): void => setDecisions((current) => ({ ...current, [`${ruleId}:${issueIndex}`]: { ...current[`${ruleId}:${issueIndex}`], machineDecision: "Detected", humanDecision, reason: current[`${ruleId}:${issueIndex}`]?.reason ?? "", issue: current[`${ruleId}:${issueIndex}`]?.issue ?? null } }));
  const addMissedIssue = (): void => {
    const ruleId = missedRuleId.trim();
    if (!ruleId || !missedReason.trim()) { onMessage("请填写漏检规则名和原因", true); return; }
    const issueIndex = (detail?.issues.length ?? 0) + Object.values(decisions).filter((decision) => decision.machineDecision === "NotDetected").length;
    setDecisions((current) => ({ ...current, [`${ruleId}:${issueIndex}`]: { machineDecision: "NotDetected", humanDecision: "MissedIssue", reason: missedReason.trim(), issue: null } }));
    setMissedRuleId(""); setMissedReason(""); onMessage("已加入漏检判断，提交时会一并保存。");
  };

  const submit = async (requestedStatus?: HumanReviewFinalStatus): Promise<void> => {
    if (!detail || !draft || detail.reviewStatus === "Completed") return;
    setBusy(true);
    try {
      const originalContent = detail.originalContent;
      const finalSnapshot: HumanReviewContentSnapshot = { ...detail.content, title: draft.title, body: draft.body, summary: draft.summary, contentHash: "" };
      finalSnapshot.contentHash = await contentHash(finalSnapshot);
      const changed = finalSnapshot.title !== originalContent.title || finalSnapshot.body !== originalContent.body || finalSnapshot.summary !== originalContent.summary;
      const issueDecisions: HumanReviewSubmitInput["issueDecisions"] = Object.entries(decisions).map(([key, value]) => {
        const [ruleId, indexText] = key.split(":");
        return { ruleId, issueIndex: Number(indexText), machineDecision: value.machineDecision, humanDecision: value.humanDecision, reason: value.reason || null, issue: value.issue };
      });
      await window.publisherAPI.humanReview.submit({ datasetItemId: detail.id, finalStatus: requestedStatus ?? finalStatus, reviewDurationMs: startedAt ? Date.now() - startedAt : 0, editCount: changed ? 1 : 0, originalContentHash: detail.originalContentHash, finalContentHash: finalSnapshot.contentHash, originalContent, finalContent: finalSnapshot, issueDecisions, reason: requestedStatus === "Approved" ? "无需修改直接批准" : requestedStatus === "Rejected" ? "人工审核驳回" : changed ? "人工编辑后提交校准结果" : "人工审核提交" });
      onMessage("本条人工审核已保存；机器原始状态保持不变。"); setSelectedId(null); setDetail(null); setDraft(null); setStartedAt(null); load(); onRefresh();
    } catch (error) { onMessage(error instanceof Error ? error.message : "人工审核提交失败", true); } finally { setBusy(false); }
  };

  if (!dataset) return <section className="panel human-review-panel"><div className="panel-heading"><div><h3>V0.9.3 固定人工审核队列</h3><span>正在加载固定 20 条样本……</span></div></div></section>;
  return <section className="panel human-review-panel">
    <div className="panel-heading"><div><div className="eyebrow">V0.9.3 / Human Review Calibration</div><h3>固定人工审核队列</h3><span>只审核固定 20 条；不重新生成、不自动批准其余 100 条、不触发发布。</span></div><div className="human-review-summary"><b>{dataset.completedCount}/{dataset.targetCount}</b><span>{dataset.status === "HUMAN_REVIEW_COMPLETED" ? "HUMAN_REVIEW_COMPLETED" : "WAITING_FOR_HUMAN_REVIEW"}</span></div></div>
    <div className="notice">数据集：{dataset.datasetId} · 状态配额 Approved {dataset.composition.Approved} / Needs_Review {dataset.composition.Needs_Review} / Rejected {dataset.composition.Rejected} · 平台覆盖 {dataset.platforms.map((platform) => platformLabel[platform] ?? platform).join("、") || "待加载"}</div>
    <div className="human-review-layout">
      <div className="human-review-queue">{dataset.items.map((item) => <button className={`human-review-row ${selectedId === item.id ? "selected" : ""}`} key={item.id} onClick={() => openItem(item)}><span className="human-review-sequence">{String(item.sequence).padStart(2, "0")}</span><span className="human-review-row-main"><strong>{item.title || "无标题"}</strong><small>{platformLabel[item.platformKey ?? ""] ?? item.platformKey ?? "文章"} · {item.topic} · {item.city}</small></span><span className={`status-pill ${statusClass(item.originalStatus)}`}>{item.originalStatus}</span><span className="human-review-risk">风险 {item.originalRiskCount}</span><span className={`status-pill ${item.reviewStatus === "Completed" ? "success" : "muted"}`}>{item.reviewStatus === "Completed" ? "已审核" : "待审核"}</span></button>)}</div>
      {detail && draft && <div className="human-review-detail"><div className="human-review-detail-head"><div><span className="eyebrow">第 {selectedSequence ?? detail.sequence} / 20 条</span><h4>{detail.title}</h4><span>{platformLabel[detail.platformKey ?? ""] ?? detail.platformKey ?? "文章"} · {detail.business} · {detail.city} · {detail.keyword}</span></div><span className={`status-pill ${statusClass(detail.originalStatus)}`}>机器结果：{detail.originalStatus}</span></div>
        <div className="hint-box">原始 Gate 风险 {detail.originalRiskCount} 条。每条机器风险必须选择 TruePositive / FalsePositive / Uncertain；额外发现的问题使用 MissedIssue。原始状态不会被覆盖。</div>
        <div className="human-review-content"><h5>原始内容快照</h5><strong>{detail.originalContent.title}</strong><small>摘要：{detail.originalContent.summary || "—"}</small><p>{detail.originalContent.body}</p></div>
        <div className="human-review-issues"><h5>机器风险与人工判断</h5>{detail.issues.length === 0 && <small>机器没有记录风险项；仍可添加漏检判断。</small>}{detail.issues.map((issue) => { const key = `${issue.ruleId}:${issue.issueIndex}`; const decision = decisions[key] ?? { machineDecision: "Detected" as const, humanDecision: "Uncertain" as const, reason: "", issue: issue.issue }; return <div className="quality-risk human-review-issue" key={key}><b>{issue.ruleId} · 机器已检出</b><span>{issue.issue.message}</span>{issue.issue.evidence && <small>证据：{issue.issue.evidence}</small>}<small>原文位置：{issue.issue.location ?? "标题或正文"} · 建议：{issue.issue.suggestion ?? "—"}</small><div className="human-review-decision-buttons">{(["TruePositive", "FalsePositive", "Uncertain"] as const).map((value) => <button className={`mini-button ${decision.humanDecision === value ? "selected" : ""}`} key={value} disabled={detail.reviewStatus === "Completed"} onClick={() => setIssueDecision(issue.ruleId, issue.issueIndex, value)}>{decisionLabel[value]}</button>)}</div><input disabled={detail.reviewStatus === "Completed"} value={decision.reason} placeholder="可选：记录判断依据" onChange={(event) => setDecisions((current) => ({ ...current, [key]: { ...decision, reason: event.target.value } }))} /></div>; })}</div>
        <div className="human-review-missed"><h5>系统漏检</h5><div className="inline-form"><input disabled={detail.reviewStatus === "Completed"} value={missedRuleId} placeholder="ruleId，例如 city_consistency" onChange={(event) => setMissedRuleId(event.target.value)} /><input disabled={detail.reviewStatus === "Completed"} value={missedReason} placeholder="漏检原因" onChange={(event) => setMissedReason(event.target.value)} /><button className="secondary-button" disabled={detail.reviewStatus === "Completed"} onClick={addMissedIssue}>加入 MissedIssue</button></div>{Object.entries(decisions).filter(([, decision]) => decision.machineDecision === "NotDetected").map(([key, decision]) => <div className="human-review-missed-row" key={key}><b>{key}</b><span>{decisionLabel[decision.humanDecision]}</span><small>{decision.reason}</small></div>)}</div>
        {detail.reviewStatus === "Pending" && <><div className="human-review-editor"><div className="panel-heading"><h5>最终内容</h5><button className="mini-button" onClick={() => setEditing((value) => !value)}>{editing ? "收起编辑" : "编辑内容"}</button></div>{editing ? <><label>标题<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>摘要<textarea rows={3} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label><label>正文<textarea rows={8} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label></> : <div className="hint-box">默认沿用原始内容。点击“编辑内容”后，编辑结果只保存到本次人工校准快照，不会回写文章或触发复检。</div>}</div><div className="human-review-submit"><label>最终状态<select value={finalStatus} onChange={(event) => setFinalStatus(event.target.value as HumanReviewFinalStatus)}><option value="Approved">Approved / 批准</option><option value="Needs_Review">Needs_Review / 需复核</option><option value="Rejected">Rejected / 驳回</option><option value="AI_Checked">AI_Checked / 机器检查通过</option></select></label><button className="secondary-button" disabled={busy} onClick={() => void submit("Approved")}>无需修改直接批准</button><button className="secondary-button" disabled={busy} onClick={() => void submit("Rejected")}>驳回</button><button className="primary-button" disabled={busy} onClick={() => void submit()}>{busy ? "保存中…" : "保存人工审核结果"}</button></div></>}
        {detail.latestReview && <div className="hint-box">已保存：{detail.latestReview.finalStatus} · 审核耗时 {detail.latestReview.reviewDurationMs} ms · 编辑 {detail.latestReview.editCount} 次 · reviewerType={detail.latestReview.reviewerType}</div>}
      </div>}
    </div>
  </section>;
}
