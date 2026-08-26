import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { Account, LoginSession, Platform, PublishJob, PublishRecord } from "@publisher/domain";
import type { AccountCredentialStatusView } from "../shared/api";

const PLATFORM_KEY = "douyin";

interface DouyinVerificationWizardProps {
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

export function DouyinVerificationWizard({ account, platform, credentialStatus: initialCredentialStatus, onBack, refresh }: DouyinVerificationWizardProps): JSX.Element {
  const [credentialStatus, setCredentialStatus] = useState(initialCredentialStatus);
  const [loginStatus, setLoginStatus] = useState(account.loginStatus);
  const [lastCheckedAt, setLastCheckedAt] = useState(account.lastLoginCheck);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [records, setRecords] = useState<PublishRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [oauthSession, setOauthSession] = useState<LoginSession | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const [nextCredentials, nextJobs] = await Promise.all([
      window.publisherAPI.accounts.credentialStatus(account.id, PLATFORM_KEY),
      window.publisherAPI.jobs.list()
    ]);
    const nextDouyinJobs = nextJobs.filter((item) => item.accountId === account.id && item.platformKey === PLATFORM_KEY && item.contentKind === "video");
    setCredentialStatus(nextCredentials);
    setJobs(nextDouyinJobs);
    setSelectedJobId((current) => current || nextDouyinJobs[0]?.id || "");
  }, [account.id]);

  const loadRecords = useCallback(async (job: PublishJob | null): Promise<void> => {
    if (!job) { setRecords([]); return; }
    const history = await window.publisherAPI.articles.history(job.articleId);
    setRecords(history.filter((item) => item.accountId === account.id && item.platformKey === PLATFORM_KEY && item.jobId === job.id));
  }, [account.id]);

  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "抖音验收数据加载失败"));
  }, [load, refresh]);

  const selectedJob = useMemo(() => jobs.find((item) => item.id === selectedJobId) ?? null, [jobs, selectedJobId]);

  useEffect(() => {
    void loadRecords(selectedJob).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "PublishRecord 加载失败"));
  }, [loadRecords, refresh, selectedJob]);

  const clientKeyConfigured = Boolean(credentialStatus.fields.find((field) => field.key === "clientKey")?.configured);
  const clientSecretConfigured = Boolean(credentialStatus.fields.find((field) => field.key === "clientSecret")?.configured);
  const redirectUriConfigured = Boolean(credentialStatus.fields.find((field) => field.key === "redirectUri")?.configured);
  const environmentPassed = Boolean(account.enabled && platform?.adapterStatus === "ready" && credentialStatus.configured);
  const connectionPassed = loginStatus === "logged_in";
  const permissionPassed = Boolean(connectionPassed && credentialStatus.configured);
  const videoAssetPassed = Boolean(selectedJob?.contentKind === "video" && selectedJob.videoAssetId);
  const latestDryRun = records.find((item) => item.dryRun === true || item.status === "DryRun") ?? null;
  const latestPublish = records.find((item) => item.dryRun !== true && item.status !== "DryRun") ?? null;
  const dryRunPassed = Boolean(latestDryRun?.success && selectedJob?.status === "DryRunPassed");
  const publishPassed = Boolean(latestPublish?.success && latestPublish.status === "Published" && latestPublish.publishedExternalId && latestPublish.publishedUrl);
  const canDryRun = Boolean(environmentPassed && permissionPassed && videoAssetPassed && selectedJob);

  const checks: CheckItem[] = [
    { label: "账号配置", passed: environmentPassed, detail: environmentPassed ? "账号已启用、Adapter ready、Client Key/Secret/回调配置完整" : "需要真实账号、启用账号并完成 Client Key、Client Secret 和 redirect URI 配置" },
    { label: "连接测试", passed: connectionPassed, detail: lastCheckedAt ? `${loginStatus}；最近检查 ${formatDate(lastCheckedAt)}，由 userinfo 验证用户账号` : "尚未执行真实 checkLogin；不会显示或输出 Access Token" },
    { label: "权限检查", passed: permissionPassed, detail: permissionPassed ? "OAuth token 已由主进程安全存储并完成 video.create 连接边界检查" : "需要完成抖音官方 OAuth，并取得 video.create 授权" },
    { label: "视频素材检查", passed: videoAssetPassed, detail: videoAssetPassed ? `持久化 Job 已绑定视频素材 ${selectedJob?.videoAssetId?.slice(0, 12)}…；文件格式由 Adapter 继续校验` : "需要选择一个 contentKind=video 且已绑定 videoAssetId 的持久化任务" },
    { label: "Dry Run", passed: dryRunPassed, detail: dryRunPassed ? "Job 已通过 Adapter Dry Run；当前实现明确 networkCalls=0，仅是本地视频参数校验" : "尚未产生成功的抖音视频 Dry Run PublishRecord" },
    { label: "人工确认", passed: Boolean(confirmed && dryRunPassed), detail: confirmed && dryRunPassed ? "已确认本次低风险正式发布" : "Dry Run 后仍需人工确认" },
    { label: "正式发布", passed: Boolean(latestPublish?.publishedExternalId), detail: latestPublish?.publishedExternalId ? "已保存抖音返回的 External ID" : "尚未调用正式视频上传/发布流程" },
    { label: "状态回查", passed: publishPassed, detail: publishPassed ? "已回查 Published，并保存 External ID 与 External URL" : "需要调用抖音视频状态查询并取得最终 URL" }
  ];

  const runOAuth = async (): Promise<void> => {
    setBusy("oauth"); setError("");
    try {
      const session = await window.publisherAPI.accounts.beginLogin(account.id, PLATFORM_KEY);
      setOauthSession(session);
      setMessage(session.message ?? "抖音官方 OAuth 已启动，请完成账号授权");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "抖音 OAuth 启动失败"); }
    finally { setBusy(null); }
  };

  const completeOAuth = async (): Promise<void> => {
    if (!callbackUrl.trim()) { setError("请粘贴抖音 OAuth 完成后的完整回调 URL"); return; }
    setBusy("oauth-complete"); setError("");
    try {
      await window.publisherAPI.accounts.completeLogin(account.id, PLATFORM_KEY, callbackUrl.trim());
      setCallbackUrl("");
      setMessage("抖音 OAuth 已完成；Access Token 仅由主进程安全存储");
      await load();
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "抖音 OAuth 回调处理失败"); }
    finally { setBusy(null); }
  };

  const runConnectionTest = async (): Promise<void> => {
    setBusy("connection"); setError("");
    try {
      const result = await window.publisherAPI.accounts.checkLogin(account.id, PLATFORM_KEY);
      setLoginStatus(result.loginStatus);
      setLastCheckedAt(new Date().toISOString());
      setMessage(result.loginStatus === "logged_in" ? "抖音连接测试通过；用户账号已由 userinfo 验证，未改变平台生命周期" : `连接测试结果：${result.loginStatus}；保持 WaitingForUser`);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "抖音连接测试失败"); }
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
      setMessage(result.loginStatus === "logged_in" && nextCredentials.configured ? "发布前环境检查通过；正式上传仍必须进入持久化 Job Queue" : "发布前环境检查未通过；未执行视频上传或发布");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "抖音发布前环境检查失败"); }
    finally { setBusy(null); }
  };

  const runDryRun = async (): Promise<void> => {
    if (!selectedJob || !canDryRun) { setError("Dry Run 前置条件未满足，未执行任何发布调用"); return; }
    setBusy("dry-run"); setError(""); setMessage("");
    try {
      const prepared = selectedJob.dryRun ? selectedJob : await window.publisherAPI.jobs.confirm(selectedJob.id, true);
      const result = prepared.status === "DryRunPassed" ? { job: prepared, message: "已有 Dry Run 结果" } : await window.publisherAPI.jobs.run(prepared.id);
      setMessage(`${result.message} 当前抖音 Adapter Dry Run 为离线校验（networkCalls=0），不能据此升级平台生命周期`);
      await load();
      await loadRecords(result.job);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "抖音 Dry Run 失败"); }
    finally { setBusy(null); }
  };

  const publish = async (): Promise<void> => {
    if (!selectedJob || !dryRunPassed || !confirmed) { setError("必须先完成抖音 Dry Run 并勾选人工确认，未执行正式发布"); return; }
    setBusy("publish"); setError(""); setMessage("");
    try {
      const scheduled = await window.publisherAPI.jobs.confirm(selectedJob.id, false);
      const result = await window.publisherAPI.jobs.run(scheduled.id);
      setMessage(result.message);
      await load();
      await loadRecords(result.job);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "抖音正式发布失败"); }
    finally { setBusy(null); }
  };

  const reconcile = async (): Promise<void> => {
    if (!selectedJob || !["Publishing", "NeedsReconciliation"].includes(selectedJob.status)) { setError("当前没有等待状态回查的抖音正式发布任务"); return; }
    setBusy("reconcile"); setError("");
    try {
      const result = await window.publisherAPI.jobs.reconcile(selectedJob.id);
      setMessage(result.message);
      await load();
      await loadRecords(result.job);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "抖音状态回查失败"); }
    finally { setBusy(null); }
  };

  return <><div className="page-title"><div><div className="eyebrow">V0.7.1 / 抖音</div><h2>抖音真实发布验收向导</h2><p>账号：{account.name}；使用官方 OAuth、持久化 Job Queue、视频上传和 PublishRecord 完成验收。</p></div><div className="row-actions"><button className="secondary-button" onClick={onBack}>返回账号中心配置</button><span className="status-pill muted">平台生命周期：{platform?.verificationStatus ?? "WaitingForUser"}</span></div></div><div className="wizard-steps">{checks.map((item) => <div className={`wizard-step ${item.passed ? "passed" : "pending"}`} key={item.label}><span>{item.passed ? "✓" : "·"}</span>{item.label}</div>)}</div>{error && <div className="notice error">{error}</div>}{message && <div className="notice success">{message}</div>}<section className="panel verification-panel"><div className="panel-heading"><div><h3>账号配置、OAuth 与连接</h3><span>Client Secret、Access Token 和 Authorization 不会在 Renderer 或日志中显示。</span></div></div><div className="verification-facts"><div><span>Client Key</span><b>{clientKeyConfigured ? "已配置" : "未配置"}</b></div><div><span>Client Secret</span><b>{clientSecretConfigured ? "已配置（安全存储）" : "未配置"}</b></div><div><span>Redirect URI</span><b>{redirectUriConfigured ? "已配置" : "未配置"}</b></div><div><span>Access Token</span><b>{connectionPassed ? "主进程安全存储且可用" : "未验证"}</b></div></div><div className="wizard-actions"><button className="secondary-button" disabled={busy !== null} onClick={() => void runOAuth()}>开始抖音官方 OAuth</button><button className="secondary-button" disabled={busy !== null} onClick={() => void runConnectionTest()}>连接测试 / 用户验证</button><button className="secondary-button" disabled={busy !== null} onClick={() => void runPreflight()}>发布前环境检查</button></div>{oauthSession?.authorizationUrl && <div className="credential-box"><small>官方授权页已打开，请在抖音完成正常授权；遇到验证码或安全验证时请人工完成。</small><label>粘贴授权后的完整回调 URL<input value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} /></label><button className="secondary-button wide" disabled={busy !== null} onClick={() => void completeOAuth()}>完成 OAuth 回调</button></div>}</section><div className="verification-layout"><section className="panel verification-panel"><div className="panel-heading"><div><h3>视频素材与持久化任务</h3><span>向导只执行已经进入 Job Queue 的抖音视频任务，不隐式创建任务。</span></div></div><label className="wizard-field">验收视频任务<select value={selectedJobId} onChange={(event) => { setSelectedJobId(event.target.value); setConfirmed(false); }}>{jobs.length === 0 ? <option value="">暂无抖音视频任务</option> : jobs.map((job) => <option value={job.id} key={job.id}>{job.id.slice(0, 12)} / {job.status} / {job.videoAssetId ? "已绑定视频" : "缺少视频"}</option>)}</select></label><div className="verification-facts"><div><span>视频素材</span><b>{videoAssetPassed ? `${selectedJob?.videoAssetId?.slice(0, 16)}…` : "缺少 videoAssetId"}</b></div><div><span>任务类型</span><b>{selectedJob?.contentKind ?? "未选择"}</b></div><div><span>队列状态</span><b>{selectedJob?.status ?? "未找到抖音任务"}</b></div><div><span>Dry Run Record</span><b>{latestDryRun?.success ? "已记录" : "未记录"}</b></div></div>{!selectedJob && <div className="hint-box">请先在发布计划或发布队列中，为该抖音账号生成 contentKind=video 且绑定 videoAssetId 的持久化任务。</div>}<div className="wizard-actions"><button className="primary-button" disabled={busy !== null || !canDryRun} onClick={() => void runDryRun()}>执行抖音 Dry Run</button></div></section><section className="panel verification-panel"><div className="panel-heading"><div><h3>验收门禁</h3><span>本地 Dry Run 不等同于真实平台 DryRunPassed。</span></div></div><div className="verification-checklist">{checks.map((item) => <div className={`verification-check ${item.passed ? "passed" : "blocked"}`} key={item.label}><strong>{item.passed ? "通过" : "待处理"} · {item.label}</strong><span>{item.detail}</span></div>)}</div></section></div><section className="panel verification-panel confirmation-panel"><div className="panel-heading"><div><h3>人工确认、正式发布与状态回查</h3><span>正式流程会进入持久化 Job Queue；发布成功后保存 External ID，再回查最终状态和 URL。</span></div></div><label className="check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我确认已检查视频内容、账号、发布权限，并同意执行一次正式抖音发布</span></label><div className="wizard-actions"><button className="primary-button" disabled={busy !== null || !dryRunPassed || !confirmed} onClick={() => void publish()}>人工确认后正式发布</button><button className="secondary-button" disabled={busy !== null || !selectedJob || !["Publishing", "NeedsReconciliation"].includes(selectedJob.status)} onClick={() => void reconcile()}>状态回查</button></div><div className="verification-facts"><div><span>External ID</span><b>{latestPublish?.publishedExternalId ?? "尚未保存"}</b></div><div><span>External URL</span><b>{latestPublish?.publishedUrl ?? "尚未保存"}</b></div><div><span>PublishRecord</span><b>{latestPublish?.success ? latestPublish.status ?? "已记录" : "尚未完成正式发布"}</b></div><div><span>平台状态</span><b>{publishPassed ? "证据已具备；仍需按真实验收记录确认" : "WaitingForUser"}</b></div></div></section></>;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "未记录";
}
