import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { ControlledPostUploadDiscoveryResult, PublishFlowExplorationResult } from "@publisher/adapters-core";
import { type ImageAsset, type Platform, type PlatformSelfTestResult, type PlatformSelfTestRun, type PlatformSelfTestStep, type XhsIdentityAcceptance } from "@publisher/domain";
import type { PlatformSelfTestAccountView } from "../shared/api";
import type { XiaohongshuCanonicalPageRuntimeProbe } from "@publisher/adapters-xiaohongshu/browser";
import { CONTROLLED_SELF_TEST_CONFIRMATION, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_CONFIRMATION, PUBLISH_FLOW_EXPLORATION_CONFIRMATION, ControlledSelfTestEntryGuard, buildControlledSelfTestRequest, buildOneShotRealPublishRequest, buildPublishFlowExplorationRequest, controlledSelfTestResultMessage, publishFlowExplorationResultMessage, supportsControlledPostUploadDiscovery, supportsOneShotRealPublishAcceptance, supportsPublishFlowExploration } from "../shared/controlled-self-test-entry";
import { OneShotConfirmationUiGuard, oneShotConfirmationErrorMessage } from "./one-shot-confirmation-ui";

const resultLabel: Record<PlatformSelfTestResult, string> = {
  NOT_TESTED: "未测试",
  TESTING: "测试中",
  PASSED: "通过",
  PARTIAL_PASSED: "部分通过",
  WAITING_FOR_USER: "等待用户",
  FAILED: "失败",
  NOT_SUPPORTED: "不支持"
};

const resultIcon: Record<PlatformSelfTestResult, string> = {
  NOT_TESTED: "—",
  TESTING: "⏳",
  PASSED: "✅",
  PARTIAL_PASSED: "⚠",
  WAITING_FOR_USER: "⏳",
  FAILED: "✕",
  NOT_SUPPORTED: "—"
};

function resultTone(result: PlatformSelfTestResult): string {
  if (result === "PASSED") return "success";
  if (result === "FAILED") return "danger";
  if (result === "WAITING_FOR_USER" || result === "PARTIAL_PASSED") return "warning";
  if (result === "TESTING") return "purple";
  return "muted";
}

function step(run: PlatformSelfTestRun | null, key: string): PlatformSelfTestStep | null {
  return [...(run?.steps ?? [])].reverse().find((item) => item.stepKey === key) ?? null;
}

function combined(run: PlatformSelfTestRun | null, keys: string[]): PlatformSelfTestResult {
  const values = keys.map((key) => step(run, key)?.result ?? "NOT_TESTED");
  if (values.some((value) => value === "FAILED")) return "FAILED";
  if (values.some((value) => value === "WAITING_FOR_USER")) return "WAITING_FOR_USER";
  if (values.some((value) => value === "TESTING")) return "TESTING";
  if (values.every((value) => value === "NOT_SUPPORTED")) return "NOT_SUPPORTED";
  if (values.every((value) => value === "PASSED" || value === "NOT_SUPPORTED") && values.some((value) => value === "PASSED")) return "PASSED";
  if (values.some((value) => value === "PASSED" || value === "PARTIAL_PASSED")) return "PARTIAL_PASSED";
  return "NOT_TESTED";
}

export const PLATFORM_SELF_TEST_COLUMNS = ["平台", "账号", "测试进度", "最终状态", "操作"] as const;

function ProgressChip({ label, run, keys }: { label: string; run: PlatformSelfTestRun | null; keys: string[] }): JSX.Element {
  const result = combined(run, keys);
  return <span className={`self-test-progress-chip ${resultTone(result)}`}><b>{label}</b><span>{resultIcon[result]}</span></span>;
}

export function PlatformSelfTestCenter({ onNavigate }: { onNavigate: (route: "accounts" | "assets") => void }): JSX.Element {
  const [accounts, setAccounts] = useState<PlatformSelfTestAccountView[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [confirmRun, setConfirmRun] = useState<PlatformSelfTestRun | null>(null);
  const [oneShotConfirmRun, setOneShotConfirmRun] = useState<PlatformSelfTestRun | null>(null);
  const [oneShotConfirmationError, setOneShotConfirmationError] = useState("");
  const [detailRun, setDetailRun] = useState<PlatformSelfTestRun | null>(null);
  const [testVideoPath, setTestVideoPath] = useState("");
  const [controlledResults, setControlledResults] = useState<Record<string, ControlledPostUploadDiscoveryResult>>({});
  const [explorationResults, setExplorationResults] = useState<Record<string, PublishFlowExplorationResult>>({});
  const [identityResults, setIdentityResults] = useState<Record<string, XhsIdentityAcceptance>>({});
  const [canonicalProbeResults, setCanonicalProbeResults] = useState<Record<string, XiaohongshuCanonicalPageRuntimeProbe>>({});
  const controlledEntryGuard = useRef(new ControlledSelfTestEntryGuard()).current;
  const oneShotConfirmationGuard = useRef(new OneShotConfirmationUiGuard()).current;
  const load = useCallback((): void => { void Promise.all([window.publisherAPI.platformSelfTest.list(), window.publisherAPI.platforms.list(), window.publisherAPI.imageAssets.list({ enabledOnly: true })]).then(([nextAccounts, nextPlatforms, nextImages]) => { setAccounts(nextAccounts); setPlatforms(nextPlatforms); setImageAssets(nextImages); }); }, []);
  useEffect(load, [load]);
  const platformByKey = useMemo(() => new Map(platforms.map((platform) => [platform.platformKey, platform])), [platforms]);
  const rows = useMemo(() => [...accounts].sort((left, right) => {
    if (left.account.platformKey === "zhihu" && right.account.platformKey !== "zhihu") return -1;
    if (right.account.platformKey === "zhihu" && left.account.platformKey !== "zhihu") return 1;
    const leftConnected = left.account.loginStatus === "logged_in" ? 0 : 1;
    const rightConnected = right.account.loginStatus === "logged_in" ? 0 : 1;
    return leftConnected - rightConnected || (platformByKey.get(left.account.platformKey)?.displayName ?? left.account.platformKey).localeCompare(platformByKey.get(right.account.platformKey)?.displayName ?? right.account.platformKey, "zh-CN") || (left.account.accountAlias || left.account.name).localeCompare(right.account.accountAlias || right.account.name, "zh-CN");
  }), [accounts, platformByKey]);

  const perform = async (key: string, operation: () => Promise<PlatformSelfTestRun | PlatformSelfTestRun[]>): Promise<void> => {
    setBusy(key); setMessage("");
    try {
      const result = await operation();
      const list = Array.isArray(result) ? result : [result];
      const passed = list.filter((item) => item.overallResult === "PASSED").length;
      const waiting = list.filter((item) => item.overallResult === "WAITING_FOR_USER").length;
      const failed = list.filter((item) => item.overallResult === "FAILED").length;
      setMessage(`自测已记录：通过 ${passed}，等待用户 ${waiting}，失败 ${failed}。本地代码测试不会升级 PublishPassed。`);
      load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "平台自测失败"); }
    finally { setBusy(""); }
  };

  const requestPublish = async (view: PlatformSelfTestAccountView): Promise<void> => {
    setBusy(view.account.id); setMessage("");
    try { const run = await window.publisherAPI.platformSelfTest.requestPublish(view.account.platformAccountId ?? view.account.id); setConfirmRun(run); setTestVideoPath(""); load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "无法创建真实发布确认"); }
    finally { setBusy(""); }
  };

  const runControlledPostUploadDiscovery = async (view: PlatformSelfTestAccountView): Promise<void> => {
    const key = view.account.platformAccountId ?? view.account.id;
    const platform = platformByKey.get(view.account.platformKey);
    const connected = view.account.enabled && view.account.loginStatus === "logged_in";
    if (!platform || !supportsControlledPostUploadDiscovery(platform, view.account) || !connected || !controlledEntryGuard.tryAcquire(key)) return;
    try {
      if (!window.confirm(CONTROLLED_SELF_TEST_CONFIRMATION)) return;
      const request = buildControlledSelfTestRequest({ account: view.account, platform, connected, busy: false, confirmed: true });
      if (!request) return;
      setBusy(`${key}:controlled-upload`); setMessage("");
      const result = await window.publisherAPI.platformSelfTest.runPostUploadDiscovery(request);
      setControlledResults((current) => ({ ...current, [key]: result }));
      setMessage(controlledSelfTestResultMessage(result));
    } catch (error) { setMessage(error instanceof Error ? error.message : "受控首次上传后发现失败"); }
    finally { controlledEntryGuard.release(key); setBusy(""); }
  };

  const requestOneShotPublish = async (view: PlatformSelfTestAccountView): Promise<void> => {
    const key = view.account.platformAccountId ?? view.account.id;
    const platform = platformByKey.get(view.account.platformKey);
    const connected = view.account.enabled && view.account.loginStatus === "logged_in";
    const request = platform ? buildOneShotRealPublishRequest({ account: view.account, platform, connected, busy: Boolean(busy), confirmed: true }) : null;
    if (!request || busy) return;
    setBusy(`${key}:one-shot-publish`); setMessage("");
    try {
      const image = imageAssets.find((item) => item.enabled);
      if (!image) throw new Error("ONE_SHOT_CONTENT_IMAGE_BINDING_REQUIRED");
      const run = await window.publisherAPI.platformSelfTest.requestOneShotPublish(request.platformAccountId, { platformKey: "xiaohongshu", accountId: view.account.id, creatorId: view.account.externalAccountId ?? "", title: "GMP发布验收2｜请忽略", body: "GEO Media Publisher 小红书自动发布最终验收测试。本内容仅用于验证上传、正文回读、发布事务与平台确认流程，请忽略。", imageAssetId: image.id });
      setOneShotConfirmationError(""); setOneShotConfirmRun(run); load();
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "无法创建一次性真实发布确认"); }
    finally { setBusy(""); }
  };

  const runXhsCanonicalProbe = async (view: PlatformSelfTestAccountView): Promise<void> => {
    const key = view.account.platformAccountId ?? view.account.id;
    if (view.account.platformKey !== "xiaohongshu" || busy) return;
    setBusy(`${key}:canonical-probe`); setMessage("");
    try {
      const result = await window.publisherAPI.platformSelfTest.probeXhsCanonicalPage(key);
      setCanonicalProbeResults((current) => ({ ...current, [key]: result }));
      setMessage(result.probeStatus === "PASS" ? "小红书 canonical Page 只读身份 probe 已完成；未执行授权收敛、未上传、未发布。" : `小红书 canonical Page 只读 probe 安全停止：${result.failureStage ?? "UNKNOWN"} / ${result.failureErrorClass ?? result.failureCode ?? "UNKNOWN"}。未执行授权收敛、未上传、未发布。`);
    } catch {
      setMessage("小红书 canonical Page 只读 probe 调用失败；未执行授权收敛、未上传、未发布。请查看结构化日志。");
    }
    finally { setBusy(""); }
  };

  const verifyXhsIdentity = async (view: PlatformSelfTestAccountView): Promise<void> => {
    const key = view.account.platformAccountId ?? view.account.id;
    const platform = platformByKey.get(view.account.platformKey);
    const connected = view.account.enabled && view.account.loginStatus === "logged_in";
    if (!platform || !supportsOneShotRealPublishAcceptance(platform, view.account) || !connected || busy) return;
    setBusy(`${key}:identity`); setMessage("");
    try {
      const result = await window.publisherAPI.platformSelfTest.verifyAndConvergeXhsIdentity(key);
      setIdentityResults((current) => ({ ...current, [key]: result }));
      setMessage(result.verification.verified ? `小红书账号身份已验证；当前可复用一次性授权：${result.convergence.reusableOperationId ?? "无"}。` : "当前登录的小红书账号与已绑定账号不一致或身份未取得。未上传、未发布。");
      load();
    } catch (error) {
      setMessage(error instanceof Error && error.message.trim() ? error.message : "小红书账号身份验证失败；未上传、未发布。未创建新的授权。");
    }
    finally { setBusy(""); }
  };

  const runPublishFlowExploration = async (view: PlatformSelfTestAccountView): Promise<void> => {
    const key = view.account.platformAccountId ?? view.account.id;
    const platform = platformByKey.get(view.account.platformKey);
    const connected = view.account.enabled && view.account.loginStatus === "logged_in";
    if (view.account.platformKey !== "xiaohongshu" || !platform || !supportsPublishFlowExploration(platform, view.account) || !connected || busy || !controlledEntryGuard.tryAcquire(key)) return;
    try {
      if (!window.confirm(PUBLISH_FLOW_EXPLORATION_CONFIRMATION)) return;
      const request = buildPublishFlowExplorationRequest({ account: view.account, platform, connected, busy: false, confirmed: true });
      if (!request) return;
      setBusy(`${key}:publish-flow-exploration`); setMessage("");
      const result = await window.publisherAPI.platformSelfTest.runPublishFlowExploration(request);
      setExplorationResults((current) => ({ ...current, [key]: result }));
      setMessage(publishFlowExplorationResultMessage(result));
    } catch (error) { setMessage(error instanceof Error ? error.message : "小红书发布流程探索失败"); }
    finally { controlledEntryGuard.release(key); setBusy(""); }
  };

  const confirmPublish = async (): Promise<void> => {
    if (!confirmRun) return;
    const id = confirmRun.testRunId;
    setBusy(id);
    try { const run = await window.publisherAPI.platformSelfTest.confirmPublish(id, testVideoPath || undefined); setMessage(run.overallResult === "PASSED" ? `真实发布与回查通过：${run.externalUrl ?? "未返回 URL"}` : "真实发布测试已按当前证据停止；请查看步骤中的等待/失败原因。"); setConfirmRun(null); load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "真实发布测试失败"); }
    finally { setBusy(""); }
  };

  const continueSelfTest = async (run: PlatformSelfTestRun): Promise<void> => {
    await perform(run.testRunId, () => window.publisherAPI.platformSelfTest.continue(run.testRunId));
  };

  const cancelPublish = async (): Promise<void> => {
    if (!confirmRun) return;
    await window.publisherAPI.platformSelfTest.cancelPublish(confirmRun.testRunId);
    setConfirmRun(null); setMessage("已取消，未创建真实发布任务。用于 L1–L3 的测试内容不会进入 Production 文章库。"); load();
  };

  const confirmOneShotPublish = async (): Promise<void> => {
    if (!oneShotConfirmRun) return;
    if (!oneShotConfirmationGuard.tryAcquire()) return;
    const id = oneShotConfirmRun.testRunId;
    setBusy(id);
    try {
      const run = await window.publisherAPI.platformSelfTest.confirmOneShotPublish(id);
      setMessage(run.overallResult === "PASSED" ? `一次性测试发布与回查通过：${run.externalUrl ?? "未返回 URL"}` : "一次性真实发布测试已按当前证据停止；请查看步骤中的等待/失败原因。只允许一次提交，不会自动重试。");
      setOneShotConfirmationError(""); setOneShotConfirmRun(null); load();
    } catch (error) { const message = oneShotConfirmationErrorMessage(error); setOneShotConfirmationError(message); setMessage(message); }
    finally { oneShotConfirmationGuard.release(); setBusy(""); }
  };

  const cancelOneShotPublish = async (): Promise<void> => {
    if (!oneShotConfirmRun) return;
    await window.publisherAPI.platformSelfTest.cancelOneShotPublish(oneShotConfirmRun.testRunId);
    setOneShotConfirmRun(null); setMessage("已取消一次性真实发布测试，未生成授权、未创建发布任务。"); load();
  };

  const reconcileFailedOneShotConfirmation = async (run: PlatformSelfTestRun): Promise<void> => {
    if (run.platformKey !== "xiaohongshu" || !run.accountId || !run.publishConfirmedAt) return;
    const key = `${run.testRunId}:reconcile`;
    setBusy(key); setMessage("");
    try {
      const result = await window.publisherAPI.platformSelfTest.reconcileFailedOneShotConfirmation({ testRunId: run.testRunId, platformKey: "xiaohongshu", accountId: run.accountId });
      setMessage(result.status === "RECONCILED_RETRYABLE" ? "一次性确认资格已恢复；未创建授权、发布任务或发布记录。" : "一次性确认资格已处于可重试状态；未重复修改。");
      const refreshed = await window.publisherAPI.platformSelfTest.get(run.testRunId);
      setDetailRun(refreshed);
      load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "一次性确认状态恢复失败"); }
    finally { setBusy(""); }
  };

  const cleanup = async (run: PlatformSelfTestRun): Promise<void> => {
    if (!window.confirm(`确认删除平台上的测试内容？\n${run.externalUrl ?? run.externalId ?? ""}\n删除操作不可撤销。`)) return;
    await perform(run.testRunId, () => window.publisherAPI.platformSelfTest.confirmDelete(run.testRunId));
  };

  return <>
    <div className="page-title"><div><div className="eyebrow">高级功能</div><h2>平台自测中心</h2><p>逐账号验证真实连接、编辑器、内容填充、草稿、发布和回查。默认自测只执行 L1–L3，不会真实发帖。</p></div><div className="row-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void perform("health", () => window.publisherAPI.platformSelfTest.healthCheck())}>{busy === "health" ? "检查中…" : "检查全部已连接账号"}</button><button className="mini-button" onClick={() => onNavigate("accounts")}>账号中心</button></div></div>
    {message && <div className="notice">{message}</div>}
    <section className="panel self-test-safety"><strong>安全边界</strong><span>L1 登录、L2 编辑器、L3 内容填充不会点击最终发布。L4 可能创建真实草稿。L5 必须单账号再次确认；列举网不会自动选择 13 个账号。</span></section>
    <section className="panel table-panel self-test-table-wrap"><div className="self-test-table"><div className="self-test-table-head">{PLATFORM_SELF_TEST_COLUMNS.map((column) => <span key={column}>{column}</span>)}</div>{rows.map((view) => {
      const run = view.latestRun; const rawPlatform = platformByKey.get(view.account.platformKey); const platform = rawPlatform ? { ...rawPlatform, integrationMode: rawPlatform.accountConnectionMode ?? rawPlatform.integrationMode } : undefined; const key = view.account.platformAccountId ?? view.account.id; const connected = view.account.enabled && view.account.loginStatus === "logged_in";
      const backgroundStatus = platform?.backgroundAutomationStatus ?? "UNKNOWN"; const backgroundLabel = backgroundStatus === "PASSED" ? "后台通过" : backgroundStatus === "REQUIRES_VISIBLE_BROWSER" ? "需要可见" : backgroundStatus === "FAILED" ? "后台失败" : "未测试"; const backgroundTone = backgroundStatus === "PASSED" ? "success" : backgroundStatus === "UNKNOWN" ? "muted" : "warning";
      const controlled = controlledResults[key];
      const exploration = explorationResults[key];
      const identity = identityResults[key];
      const canonicalProbe = canonicalProbeResults[key];
      const controlledAvailable = Boolean(platform && supportsControlledPostUploadDiscovery(platform, view.account));
      const explorationAvailable = Boolean(platform && supportsPublishFlowExploration(platform, view.account));
      const oneShotAvailable = Boolean(platform && supportsOneShotRealPublishAcceptance(platform, view.account));
      return <div className="self-test-table-row" key={view.account.id}><div><strong>{platform?.displayName ?? view.account.platformKey}</strong><small>{platform?.integrationMode ?? "Manual"}</small></div><div><strong>{view.account.accountAlias || view.account.name}</strong><small>{view.account.loginStatus === "logged_in" ? "当前标记已连接" : "需要连接/验证"}</small></div><div className="self-test-progress"><ProgressChip label="登录" run={run} keys={["ACCOUNT_CONNECTION", "SESSION_OR_OAUTH"]} /><ProgressChip label="编辑器" run={run} keys={["EDITOR_OPEN"]} /><ProgressChip label="内容" run={run} keys={["TITLE_FILL", "BODY_FILL"]} /><ProgressChip label="图片" run={run} keys={["IMAGE_FILL"]} /><ProgressChip label="草稿" run={run} keys={["DRAFT_SAVE"]} /><ProgressChip label="发布" run={run} keys={["PUBLISH_SUBMIT", "EXTERNAL_EVIDENCE"]} /><ProgressChip label="回查" run={run} keys={["STATUS_RECONCILIATION"]} /></div><div><span className={`status-chip ${run ? resultTone(run.overallResult) : "muted"}`}>{run ? resultLabel[run.overallResult] : "未测试"}</span><span className={`self-test-result ${backgroundTone}`} title={platform?.backgroundAutomationReason ?? "尚无后台真实自测证据"}>{backgroundStatus === "PASSED" ? "后台 ✓" : backgroundStatus === "UNKNOWN" ? "后台 —" : backgroundLabel}</span>{canonicalProbe && <small>Canonical probe：{canonicalProbe.probeStatus}；PAGE_URL：{canonicalProbe.playwrightPageUrl ?? "未取得"}；DOM_LOCATION_HREF：{canonicalProbe.domLocationHref ?? "未取得"}；URL 一致性：{canonicalProbe.pageUrlConsistency}；Expected：{view.account.externalAccountId ?? "未取得"}；Observed：{canonicalProbe.observedCreatorIdNormalized ?? "未取得"}；Match：待 Main identity service；Identity：待 Main identity service</small>}{identity && <small>身份：{identity.verification.verified ? `已验证 ${identity.verification.observed.externalCreatorId ?? ""}` : "未验证"}；未消费授权 {identity.convergence.activeUnusedAuthorizationCount}</small>}{controlled && <small>受控上传：{controlled.status === "PASS" ? "上传后编辑器检查完成" : `安全停止（${controlled.failureCode ?? "未知"}）`}</small>}{exploration && <small>流程探索：{exploration.readyForFinalSubmit ? "最终控件已就绪（未发布）" : `安全停止（${exploration.blocker ?? "未知"}）`}</small>}<small>{run ? new Date(run.lastTestedAt).toLocaleString("zh-CN") : "尚未执行"}</small></div><div className="self-test-actions"><button className="primary-button" disabled={Boolean(busy)} onClick={() => void perform(key, () => window.publisherAPI.platformSelfTest.runSafe(key))}>{busy === key ? "测试中…" : "自测 L1–L3"}</button>{view.account.platformKey === "xiaohongshu" && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void runXhsCanonicalProbe(view)}>{busy === `${key}:canonical-probe` ? "只读验证中…" : "只读身份验证"}</button>}{controlledAvailable && <button className="secondary-button" disabled={Boolean(busy) || !view.account.enabled || Boolean(view.account.archivedAt) || !connected} onClick={() => void runControlledPostUploadDiscovery(view)}>{busy === `${key}:controlled-upload` ? "受控发现中…" : "首次上传后发现"}</button>}{explorationAvailable && <button className="secondary-button" disabled={Boolean(busy) || !view.account.enabled || Boolean(view.account.archivedAt) || !connected} onClick={() => void runPublishFlowExploration(view)}>{busy === `${key}:publish-flow-exploration` ? "探索中…" : "探索发布流程（不发布）"}</button>}{oneShotAvailable && <button className="secondary-button" disabled={Boolean(busy) || !connected} onClick={() => void verifyXhsIdentity(view)}>{busy === `${key}:identity` ? "确认身份中…" : "确认账号身份并收敛授权"}</button>}{run?.overallResult === "WAITING_FOR_USER" && <button className="mini-button" disabled={Boolean(busy)} onClick={() => void continueSelfTest(run)}>继续当前测试</button>}<button className="mini-button" disabled={Boolean(busy)} onClick={() => void perform(`${key}:draft`, () => window.publisherAPI.platformSelfTest.runLevel(key, "L4_DRAFT"))}>草稿测试</button>{oneShotAvailable ? <button className="secondary-button" disabled={Boolean(busy) || !connected} onClick={() => void requestOneShotPublish(view)}>{busy === `${key}:one-shot-publish` ? "准备确认中…" : "一次性真实发布测试"}</button> : <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void requestPublish(view)}>真实发布测试</button>}<button className="mini-button" disabled={!run} onClick={() => run && setDetailRun(run)}>查看详情</button>{run?.cleanupStatus === "AVAILABLE" && <button className="mini-button danger-mini" onClick={() => void cleanup(run)}>清理测试内容</button>}</div></div>;
    })}{rows.length === 0 && <div className="empty-state"><h3>还没有平台账号</h3><p>先到账号中心添加账号，再逐账号执行自测。</p></div>}</div></section>
    {detailRun && <div className="drawer-backdrop" onClick={() => setDetailRun(null)}><aside className="drawer v11-drawer self-test-detail-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">技术证据</span><h2>{platformByKey.get(detailRun.platformKey)?.displayName ?? detailRun.platformKey} · {detailRun.platformAccountId}</h2></div><button className="icon-button" onClick={() => setDetailRun(null)}>×</button></div><div className="self-test-detail-summary"><span>最终结果：<b className={resultTone(detailRun.overallResult)}>{resultLabel[detailRun.overallResult]}</b></span><span>测试时间：{new Date(detailRun.lastTestedAt).toLocaleString("zh-CN")}</span><span>External ID：{detailRun.externalId ?? "未取得"}</span><span>External URL：{detailRun.externalUrl ? <a href={detailRun.externalUrl} target="_blank" rel="noreferrer">{detailRun.externalUrl}</a> : "未取得"}</span></div><div className="self-test-evidence-list">{detailRun.steps.map((item) => <div className="self-test-evidence" key={item.id}><div><strong>{item.testLevel}</strong><span>{item.stepKey}</span><b className={resultTone(item.result)}>{resultIcon[item.result]} {resultLabel[item.result]}</b></div><p>{item.message ?? "暂无说明"}</p>{item.errorCode && <small>errorCode：{item.errorCode}</small>}{item.verificationSignal && <code>verificationSignal：{item.verificationSignal}</code>}{item.externalId && <small>External ID：{item.externalId}</small>}{item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer">External URL：{item.externalUrl}</a>}</div>)}</div><div className="drawer-footer">{detailRun.platformKey === "xiaohongshu" && Boolean(detailRun.accountId) && Boolean(detailRun.publishConfirmedAt) && step(detailRun, "PUBLISH_CONFIRMATION")?.errorCode === "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED" && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void reconcileFailedOneShotConfirmation(detailRun)}>{busy === `${detailRun.testRunId}:reconcile` ? "恢复中…" : "恢复一次性确认资格"}</button>}<button className="primary-button" onClick={() => setDetailRun(null)}>关闭</button></div></aside></div>}
    {confirmRun && <div className="drawer-backdrop" onClick={() => void cancelPublish()}><aside className="drawer v11-drawer self-test-confirm" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">真实发布确认</span><h2>确认测试发布</h2></div><button className="icon-button" onClick={() => void cancelPublish()}>×</button></div><div className="notice warning"><strong>{step(confirmRun, "PUBLISH_CONFIRMATION")?.message ?? "即将真实发布一条透明测试内容，是否继续？"}</strong><span>每个平台/账号本次最多 1 条；不会批量选择列举网账号。</span></div><section className="panel self-test-content-preview"><strong>Geo Media Publisher 发布链路测试</strong><p>本内容用于公司内部 Geo Media Publisher 发布系统功能验证，用于确认账号登录、编辑器填充和发布回查是否正常。无商业推广用途，可忽略。</p></section>{["douyin", "tiktok", "youtube", "bilibili"].includes(confirmRun.platformKey) && <label>本地测试视频（可选）<div className="row-actions"><input readOnly value={testVideoPath} placeholder="未选择时将标记 WAITING_FOR_TEST_MEDIA" /><button className="secondary-button" onClick={() => void window.publisherAPI.videoAssets.pickVideo().then((path) => setTestVideoPath(path ?? ""))}>选择测试视频</button><button className="mini-button" onClick={() => onNavigate("assets")}>视频素材中心</button></div></label>}<div className="drawer-footer"><button className="secondary-button" disabled={busy === confirmRun.testRunId} onClick={() => void cancelPublish()}>取消</button><button className="primary-button" disabled={busy === confirmRun.testRunId} onClick={() => void confirmPublish()}>{busy === confirmRun.testRunId ? "执行中…" : "确认测试发布"}</button></div></aside></div>}
    {oneShotConfirmRun && <div className="drawer-backdrop" onClick={() => { if (!busy) void cancelOneShotPublish(); }}><aside className="drawer v11-drawer self-test-confirm" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">Owner 授权的一次性测试</span><h2>确认小红书真实发布</h2></div><button className="icon-button" disabled={Boolean(busy)} onClick={() => void cancelOneShotPublish()}>×</button></div><div className="notice warning"><strong>{ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_CONFIRMATION}</strong><span>仅限指定小红书测试账号；最多提交一次。第一次提交开始后即消费授权，失败或结果不明确也不会重试。</span></div>{oneShotConfirmationError && <div className="notice error" role="alert"><strong>{oneShotConfirmationError}</strong></div>}<section className="panel self-test-content-preview"><strong>GMP发布验收2｜请忽略</strong><p>GEO Media Publisher 小红书自动发布最终验收测试。本内容仅用于验证上传、正文回读、发布事务与平台确认流程，请忽略。</p><small>图片：显式绑定的测试图片</small></section><div className="drawer-footer"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void cancelOneShotPublish()}>取消</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void confirmOneShotPublish()}>{busy === oneShotConfirmRun.testRunId ? "确认中…" : "确认并最多发布一次"}</button></div></aside></div>}
  </>;
}
