import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { Account, Article, Platform, PublishJob, PublishRecord } from "@publisher/domain";
import type { AccountCredentialStatusView } from "../shared/api";

const PLATFORM_KEY = "wechat_official";

interface WeChatVerificationWizardProps {
  account: Account;
  platform: Platform | null;
  credentialStatus: AccountCredentialStatusView;
  onBack: () => void;
  refresh: () => void;
}

interface CheckItem {
  label: string;
  passed: boolean;
  detail: string;
}

export function WeChatVerificationWizard({ account, platform, credentialStatus: initialCredentialStatus, onBack, refresh }: WeChatVerificationWizardProps): JSX.Element {
  const [credentialStatus, setCredentialStatus] = useState(initialCredentialStatus);
  const [loginStatus, setLoginStatus] = useState(account.loginStatus);
  const [lastCheckedAt, setLastCheckedAt] = useState(account.lastLoginCheck);
  const [articles, setArticles] = useState<Article[]>([]);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [records, setRecords] = useState<PublishRecord[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const [nextCredentials, nextArticles, nextJobs] = await Promise.all([
      window.publisherAPI.accounts.credentialStatus(account.id, PLATFORM_KEY),
      window.publisherAPI.articles.list(),
      window.publisherAPI.jobs.list()
    ]);
    const nextArticlesForReview = nextArticles.filter((item) => item.status !== "archived");
    const nextWechatJobs = nextJobs.filter((item) => item.accountId === account.id && item.platformKey === PLATFORM_KEY);
    setCredentialStatus(nextCredentials);
    setArticles(nextArticlesForReview);
    setJobs(nextWechatJobs);
    setSelectedArticleId((current) => current || nextWechatJobs[0]?.articleId || nextArticlesForReview[0]?.id || "");
  }, [account.id]);

  const loadRecords = useCallback(async (articleId: string): Promise<void> => {
    if (!articleId) { setRecords([]); return; }
    const history = await window.publisherAPI.articles.history(articleId);
    setRecords(history.filter((item) => item.accountId === account.id && item.platformKey === PLATFORM_KEY));
  }, [account.id]);

  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "微信公众号验收数据加载失败")); }, [load, refresh]);
  useEffect(() => { void loadRecords(selectedArticleId).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "PublishRecord 加载失败")); }, [loadRecords, refresh, selectedArticleId]);

  const selectedArticle = articles.find((item) => item.id === selectedArticleId) ?? null;
  const selectedJob = useMemo(() => jobs.find((item) => item.articleId === selectedArticleId && ["DryRunPassed", "AwaitingConfirmation", "Pending", "Scheduled", "Retry", "NeedsUserAction"].includes(item.status)) ?? jobs.find((item) => item.articleId === selectedArticleId) ?? null, [jobs, selectedArticleId]);
  const latestDryRun = records.find((item) => item.dryRun === true || item.status === "DryRun") ?? null;
  const latestPublish = records.find((item) => item.dryRun !== true && item.status !== "DryRun") ?? null;
  const articlePassed = Boolean(selectedArticle && selectedArticle.title.trim() && selectedArticle.body.trim() && selectedArticle.qualityStatus !== "failed");
  const coverPassed = Boolean(selectedArticle?.coverAssetId);
  const connectionPassed = loginStatus === "logged_in";
  const environmentPassed = Boolean(account.enabled && platform?.adapterStatus === "ready" && credentialStatus.configured);
  const dryRunPassed = Boolean(latestDryRun?.success && selectedJob?.status === "DryRunPassed");
  const publishPassed = Boolean(latestPublish?.success && latestPublish.status === "Published" && latestPublish.publishedExternalId && latestPublish.publishedUrl);
  const canDryRun = environmentPassed && connectionPassed && articlePassed && coverPassed && Boolean(selectedJob);
  const checks: CheckItem[] = [
    { label: "账号配置", passed: environmentPassed, detail: environmentPassed ? "账号启用、Adapter ready、必填 Credential 已配置" : "需要真实账号、启用账号和完整 AppID/AppSecret" },
    { label: "连接测试", passed: connectionPassed, detail: lastCheckedAt ? `${loginStatus}，最近检查 ${formatDate(lastCheckedAt)}` : "尚未执行真实 checkLogin" },
    { label: "权限检查", passed: connectionPassed && credentialStatus.configured, detail: connectionPassed && credentialStatus.configured ? "已通过真实账号连接检查；最终权限以官方接口响应为准" : "未获得有效 access_token 或必填权限响应" },
    { label: "文章检查", passed: articlePassed, detail: articlePassed ? "标题、正文和质量状态满足基础检查" : "需要选择有效文章，且标题/正文不能为空" },
    { label: "封面检查", passed: coverPassed, detail: coverPassed ? "文章已关联封面素材" : "微信公众号图文发布必须关联封面素材" },
    { label: "Dry Run", passed: dryRunPassed, detail: dryRunPassed ? "已产生成功的真实 Dry Run PublishRecord" : "尚未产生真实 Dry Run 记录" },
    { label: "人工确认", passed: Boolean(confirmed && dryRunPassed), detail: confirmed && dryRunPassed ? "已勾选本次低风险正式发布确认" : "Dry Run 通过后仍需人工确认" },
    { label: "正式发布", passed: Boolean(latestPublish?.publishedExternalId), detail: latestPublish?.publishedExternalId ? "已获得 publish_id" : "尚未调用正式发布接口" },
    { label: "状态回查", passed: publishPassed, detail: publishPassed ? "已获得 Published、External ID 和 External URL" : "需要官方 freepublish/get 返回最终状态和 URL" }
  ];

  const runConnectionTest = async (): Promise<void> => {
    setBusy("connection"); setError("");
    try {
      const result = await window.publisherAPI.accounts.checkLogin(account.id, PLATFORM_KEY);
      setLoginStatus(result.loginStatus);
      setLastCheckedAt(new Date().toISOString());
      setMessage(result.loginStatus === "logged_in" ? "微信公众号连接测试通过；未改变平台生命周期" : `连接测试结果：${result.loginStatus}；仍保持 WaitingForUser`);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "微信公众号连接测试失败"); }
    finally { setBusy(null); }
  };

  const runPreflight = async (): Promise<void> => {
    setBusy("preflight"); setError("");
    try {
      const [nextCredentials, result] = await Promise.all([
        window.publisherAPI.accounts.credentialStatus(account.id, PLATFORM_KEY),
        window.publisherAPI.accounts.checkLogin(account.id, PLATFORM_KEY)
      ]);
      setCredentialStatus(nextCredentials);
      setLoginStatus(result.loginStatus);
      setLastCheckedAt(new Date().toISOString());
      setMessage(result.loginStatus === "logged_in" && nextCredentials.configured ? "发布前环境检查通过；真实权限仍以微信官方接口响应为准" : "发布前环境检查未通过；未执行 Dry Run 或正式发布");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "发布前环境检查失败"); }
    finally { setBusy(null); }
  };

  const runDryRun = async (): Promise<void> => {
    if (!selectedJob || !canDryRun) { setError("Dry Run 前置条件未满足，未执行任何发布调用"); return; }
    setBusy("dry-run"); setError(""); setMessage("");
    try {
      const prepared = selectedJob.dryRun ? selectedJob : await window.publisherAPI.jobs.confirm(selectedJob.id, true);
      const result = prepared.status === "DryRunPassed" ? { job: prepared, message: "已有 Dry Run 结果" } : await window.publisherAPI.jobs.run(prepared.id);
      setMessage(result.message);
      await load();
      await loadRecords(selectedArticleId);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "微信公众号 Dry Run 失败"); }
    finally { setBusy(null); }
  };

  const publish = async (): Promise<void> => {
    if (!selectedJob || !dryRunPassed || !confirmed) { setError("必须先完成真实 Dry Run 并勾选人工确认，未执行正式发布"); return; }
    setBusy("publish"); setError(""); setMessage("");
    try {
      const scheduled = await window.publisherAPI.jobs.confirm(selectedJob.id, false);
      const result = await window.publisherAPI.jobs.run(scheduled.id);
      setMessage(result.message);
      await load();
      await loadRecords(selectedArticleId);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "微信公众号正式发布失败"); }
    finally { setBusy(null); }
  };

  const reconcile = async (): Promise<void> => {
    if (!selectedJob || !["Publishing", "NeedsReconciliation"].includes(selectedJob.status)) { setError("当前没有等待状态回查的正式发布任务"); return; }
    setBusy("reconcile"); setError("");
    try {
      const result = await window.publisherAPI.jobs.reconcile(selectedJob.id);
      setMessage(result.message);
      await load();
      await loadRecords(selectedArticleId);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "微信公众号状态回查失败"); }
    finally { setBusy(null); }
  };

  return <><div className="page-title"><div><div className="eyebrow">V0.7 / 微信公众号</div><h2>微信公众号真实发布验收向导</h2><p>账号：{account.name}；所有步骤均基于真实账号、持久化 Job Queue 和 PublishRecord。</p></div><div className="row-actions"><button className="secondary-button" onClick={onBack}>返回账号中心配置</button><span className="status-pill muted">生命周期：{platform?.verificationStatus ?? "WaitingForUser"}</span></div></div><div className="wizard-steps">{checks.map((item) => <div className={`wizard-step ${item.passed ? "passed" : "pending"}`} key={item.label}><span>{item.passed ? "✓" : "·"}</span>{item.label}</div>)}</div>{error && <div className="notice error">{error}</div>}{message && <div className="notice success">{message}</div>}<div className="verification-layout"><section className="panel verification-panel"><div className="panel-heading"><div><h3>验收清单</h3><span>没有真实账号、真实响应或真实记录时保持 WaitingForUser。</span></div></div><div className="verification-checklist">{checks.map((item) => <div className={`verification-check ${item.passed ? "passed" : "blocked"}`} key={item.label}><strong>{item.passed ? "通过" : "待处理"} · {item.label}</strong><span>{item.detail}</span></div>)}</div><div className="wizard-actions"><button className="secondary-button" disabled={busy !== null} onClick={() => void runConnectionTest()}>连接测试</button><button className="secondary-button" disabled={busy !== null} onClick={() => void runPreflight()}>检查发布前环境</button><button className="primary-button" disabled={busy !== null || !canDryRun} onClick={() => void runDryRun()}>执行真实 Dry Run</button></div></section><section className="panel verification-panel"><div className="panel-heading"><div><h3>文章与任务</h3><span>向导只执行已进入持久化队列的微信公众号任务。</span></div></div><label className="wizard-field">验收文章<select value={selectedArticleId} onChange={(event) => { setSelectedArticleId(event.target.value); setConfirmed(false); }}>{articles.length === 0 ? <option value="">暂无可用文章</option> : articles.map((article) => <option value={article.id} key={article.id}>{article.title}</option>)}</select></label><div className="verification-facts"><div><span>文章</span><b>{selectedArticle ? selectedArticle.title : "未选择"}</b></div><div><span>队列任务</span><b>{selectedJob ? `${selectedJob.id.slice(0, 12)} / ${selectedJob.status}` : "未找到微信公众号任务"}</b></div><div><span>封面</span><b>{coverPassed ? "已关联" : "缺少封面"}</b></div><div><span>Credential</span><b>{credentialStatus.configured ? "已配置" : "未配置"}</b></div></div>{!selectedJob && <div className="hint-box">请先在发布计划/发布队列为该微信公众号账号生成文章任务；向导不会绕过持久化 Job Queue 创建隐式任务。</div>}</section></div><section className="panel verification-panel confirmation-panel"><div className="panel-heading"><div><h3>人工确认与正式发布</h3><span>正式发布会调用微信公众号官方发布接口；确认前不会执行。</span></div></div><label className="check-row"><input type="checkbox" checked={confirmed} disabled={!dryRunPassed || busy !== null} onChange={(event) => setConfirmed(event.target.checked)} /><span>我确认本次微信公众号内容、封面、目标账号和低风险发布范围</span></label><div className="wizard-actions"><button className="primary-button" disabled={busy !== null || !dryRunPassed || !confirmed} onClick={() => void publish()}>确认并正式发布</button><button className="secondary-button" disabled={busy !== null || !selectedJob || !["Publishing", "NeedsReconciliation"].includes(selectedJob.status)} onClick={() => void reconcile()}>执行状态回查</button></div></section><section className="panel verification-panel"><div className="panel-heading"><div><h3>PublishRecord 与 External URL</h3><span>Dry Run 不升级 PublishPassed；正式发布必须有 External ID、URL 和最终状态回查。</span></div></div>{records.length === 0 ? <div className="empty-state compact"><strong>暂无微信公众号 PublishRecord</strong><p>当前没有真实 Dry Run 或正式发布记录。</p></div> : <div className="record-list">{records.map((record) => <div className="record-row" key={record.id}><div><strong>{record.dryRun || record.status === "DryRun" ? "Dry Run" : "正式发布"}</strong><span>{formatDate(record.publishedAt)} · {record.status ?? "unknown"}</span></div><span>{record.publishedExternalId ?? "无 External ID"}</span>{record.publishedUrl ? <a href={record.publishedUrl} target="_blank" rel="noreferrer">打开 External URL</a> : <span>无 External URL</span>}<span>{record.success ? "成功" : "失败"}</span></div>)}</div>}</section></>;
}

function formatDate(value: string | null | undefined): string { if (!value) return "暂无"; const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "无效时间"; }
