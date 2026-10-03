import { defaultAccountSelection,douyinImageTextTitleError,normalizeContentReviewMode,type Account,type Article,type ContentQualityIssue,type ContentReviewMode,type ImageAsset,type Platform,type PublishJob } from "@publisher/domain";
import type { JSX } from "react";
import { useCallback,useContext,useEffect,useState } from "react";
import type { SprintAcceptanceSelection } from "../../main/sprint-acceptance";
import type { OfficialApiAccountView,OfficialApiAvailability,OfficialApiContentSettings,OfficialApiImageChoice,OfficialApiJobView,OfficialApiMaintenanceOperation } from "../../shared/official-api";
import { operatorAccounts,operatorPlatformCatalog,operatorPublishBlockReason,productErrorMessage,productPlatform,type ProductPreflightResult } from "../../shared/product-platform-policy";
import { OfficialApiJobControls } from "../OfficialApiJobControls";
import { OfficialApiPublishSettings } from "../OfficialApiPublishSettings";
import { DeveloperModeContext } from "../developer-mode";
import { buildWebsitePrepareInput,controlledWebsiteAssets,defaultOfficialApiSettings,preferredWebsiteCandidate,refreshWebsiteConnections,validateOfficialApiSettings,websiteOperationFeedback,websitePublishEligibility } from "../official-api-publish-ui";
import { confirmedProductActionAvailable,sprintUiSelection } from "../sprint-publish-ui";
import { articleReviewLabel,articleReviewTone,canPublishWithReviewMode,connectedAccountsForPlatform,contentReviewModeLabel,imageMatchReason,platformLabel,publishStatusLabel,publishStatusTone,requiresReadOnlyPublishReconciliation,unknownPublishResult,type V11NavigationTarget } from "../v11-ui-model";

import { EmptyState as EmptyWorkspace,StatusBadge as Status,PageHeader as WorkspaceTitle } from "../design/WorkspacePrimitives";
import { isProductionArticle } from "./workspace-utils";
import { PublishWorkflow, StatusBadge } from '../design/WorkspacePrimitives';
import { preflightPresentation } from '../design/presentation';

export function V11PublishCenter({ refresh, refreshKey, onNavigate }: { refresh: () => void; refreshKey: number; onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const developerMode = useContext(DeveloperModeContext);
  const [jobs, setJobs] = useState<PublishJob[]>([]); const [articles, setArticles] = useState<Article[]>([]); const [accounts, setAccounts] = useState<Account[]>([]); const [images, setImages] = useState<ImageAsset[]>([]); const [message, setMessage] = useState(""); const [running, setRunning] = useState(""); const [open, setOpen] = useState(false); const [detailsJob, setDetailsJob] = useState<PublishJob | null>(null);
  const [publishOutcomes, setPublishOutcomes] = useState<Record<string, { publishResult: string; fidelity: string; warning: string | null }>>({});
  const [b01JobStatuses, setB01JobStatuses] = useState<Record<string, { eligible: boolean; status: string; reason: string }>>({});
  const [websiteJobViews, setWebsiteJobViews] = useState<Record<string, OfficialApiJobView>>({});
  const [sprintSelections, setSprintSelections] = useState<SprintAcceptanceSelection[]>([]);
  useEffect(() => { void window.publisherAPI.sprint?.availability().then(setSprintSelections).catch(() => setSprintSelections([])); }, []);
  const load = useCallback((): void => { void Promise.all([window.publisherAPI.jobs.list(), window.publisherAPI.articles.list(), window.publisherAPI.accounts.list(), window.publisherAPI.imageAssets.list()]).then(async ([nextJobs, nextArticles, nextAccounts, nextImages]) => {
    const operatingArticles = nextArticles.filter(isProductionArticle); const operatingIds = new Set(operatingArticles.map((article) => article.id));
    setJobs(nextJobs.filter((job) => operatingIds.has(job.articleId))); setArticles(operatingArticles); setAccounts(nextAccounts); setImages(nextImages);
    const statuses = await Promise.all(nextJobs.filter((job) => job.platformKey === "douyin").map(async (job) =>
      [job.id, await window.publisherAPI.b01.jobStatus(job.id)] as const));
    setB01JobStatuses(Object.fromEntries(statuses));
    const records = await Promise.all(nextJobs.filter((job) => ["douyin", "toutiao"].includes(job.platformKey) && job.status === "Success")
      .map((job) => window.publisherAPI.articles.history(job.articleId)));
    setPublishOutcomes(Object.fromEntries(records.flat().filter((record) => record.response.publishResult === "PUBLISHED_CONFIRMED")
      .map((record) => [record.jobId, { publishResult: "已发布", fidelity: String(record.response.publicContentVerified ?? "LIMITED"),
        warning: typeof record.response.contentFidelityWarning === "string" ? record.response.contentFidelityWarning : null }])));
    const websiteViews = await Promise.all(nextJobs.filter(job => job.platformKey === "website").map(async job =>
      [job.id, await window.publisherAPI.website.jobState(job.id).catch(() => null)] as const));
    setWebsiteJobViews(Object.fromEntries(websiteViews.filter((entry): entry is readonly [string, OfficialApiJobView] => entry[1] !== null)));

  }); }, []);
  useEffect(load, [load, refreshKey]);
  const articleById = new Map(articles.map((article) => [article.id, article])); const accountById = new Map(accounts.map((account) => [account.id, account])); const imageById = new Map(images.map((image) => [image.id, image]));
  const operatorJobs = jobs.filter((job) => productPlatform(job.platformKey)?.visibleInOperatorUi);
  const hiddenHistoryJobs = jobs.filter((job) => !productPlatform(job.platformKey)?.visibleInOperatorUi);
  const isReadOnlyReconciliation = requiresReadOnlyPublishReconciliation;
  const continueJob = async (job: PublishJob): Promise<void> => {
    setRunning(job.id);
    try {
      const readOnly = isReadOnlyReconciliation(job);
      if (!readOnly) {
        const reason = operatorPublishBlockReason(job.platformKey);
        if (job.platformKey === "douyin") {
          const status = await window.publisherAPI.b01.jobStatus(job.id);
          if (status.status !== "Missing" && !status.eligible) throw new Error(status.reason);
          if (!productPlatform("douyin")?.ordinaryPublishEnabled && !status.eligible) throw new Error(status.reason);
        } else if (job.platformKey !== "website" && reason && !sprintUiSelection(sprintSelections, job.platformKey, articleById.get(job.articleId), job.accountId)) throw new Error(reason);
      }
      if (job.finalPublishMode === "PREPARE_ONLY" && ["AwaitingConfirmation", "DryRunPassed"].includes(job.status)) { setMessage("这条任务只准备内容，不会执行最终发布；如需发布请重新选择“发布前确认”。"); return; }
      if (!readOnly && ["AwaitingConfirmation", "DryRunPassed"].includes(job.status)) await window.publisherAPI.jobs.confirm(job.id, false);
      let websiteRecoveryView: OfficialApiJobView | null = null;
      if (readOnly) {
        if (job.platformKey === "website") {
          websiteRecoveryView = await window.publisherAPI.website.recover(job.id);
          setWebsiteJobViews(current => ({ ...current, [job.id]: websiteRecoveryView! }));
        } else await (job.platformKey === "zhihu" ? window.publisherAPI.jobs.reconcileBrowser(job.id) : window.publisherAPI.jobs.reconcile(job.id));
      } else await window.publisherAPI.jobs.run(job.id);
      setMessage(websiteRecoveryView ? websiteOperationFeedback("recover", websiteRecoveryView) : readOnly ? "已发起只读状态回查。" : "已继续处理这条发布任务；如遇验证码或安全验证，请在打开的官方页面完成后再次点击继续。");
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "暂时无法继续发布"); }
    finally { setRunning(""); }
  };
  const requestB01FinalApproval = async (job: PublishJob): Promise<void> => {
    setRunning(job.id);
    try {
      const result = await window.publisherAPI.b01.requestFinalApproval(job.id);
      setMessage(result.reason);
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "B01 最终批准检查未通过"); }
    finally { setRunning(""); }
  };
  const retireB01Preboundary = async (job: PublishJob): Promise<void> => {
    setRunning(job.id);
    try { const result = await window.publisherAPI.b01.retirePreboundary(job.id); setMessage(result.reason); load(); refresh(); }
    catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "此任务不满足未提交撤销条件"); }
    finally { setRunning(""); }
  };
  const runWebsiteOperation = async (jobId: string, operation: "recover" | OfficialApiMaintenanceOperation): Promise<void> => {
    setRunning(jobId); setMessage("");
    try {
      const view = operation === "recover" ? await window.publisherAPI.website.recover(jobId) : await window.publisherAPI.website.maintain({ jobId, operation });
      setWebsiteJobViews(current => ({ ...current, [jobId]: view }));
      setMessage(websiteOperationFeedback(operation, view));
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "官网任务操作未完成"); }
    finally { setRunning(""); }
  };
  const modeLabel = (job: PublishJob): string => job.finalPublishMode === "PREPARE_ONLY" ? "只准备内容" : job.finalPublishMode === "AUTO_PUBLISH" ? "自动发布" : "发布前确认";
  return <>
    <WorkspaceTitle eyebrow="发布中心" title="安排并开始发布" description="选择文章和渠道；内容审核是否阻止发布由当前审核模式决定，最终发布仍由你确认。" action={<div className="row-actions"><button className="secondary-button" onClick={load}>刷新状态</button><button className="primary-button" onClick={() => setOpen(true)}>选择文章发布</button></div>} />
    <PublishWorkflow />
    {message && <div className="notice">{message}</div>}
    <section className="panel table-panel"><div className="table-summary"><span>共 {operatorJobs.length} 条运营平台发布安排</span><button className="text-button" onClick={() => onNavigate("accounts")}>管理账号 →</button></div>{operatorJobs.length === 0 ? <EmptyWorkspace title="还没有发布安排" description="平台完成产品验收后，可在这里选择文章和账号。" action={<button className="secondary-button" onClick={() => setOpen(true)}>查看平台状态</button>} /> : <div className="data-table v11-publish-table"><div className="table-head v11-publish-head"><span>文章</span><span>发布渠道</span><span>账号</span><span>图片</span><span>发布模式</span><span>状态</span><span>创建时间</span><span>操作</span></div>{operatorJobs.map((job) => <div className="table-row v11-publish-row" key={job.id}><strong>{articleById.get(job.articleId)?.title ?? "文章内容"}</strong><span>{platformLabel(job.platformKey)}</span><span>{accountById.get(job.accountId)?.accountAlias || accountById.get(job.accountId)?.name || "已选账号"}</span><span>{job.selectedImageAssetId ? imageById.get(job.selectedImageAssetId)?.name || "已选图片" : "未使用"}</span><span>{modeLabel(job)}</span><div><Status label={publishStatusLabel(job.status)} tone={publishStatusTone(job.status)} />{unknownPublishResult(job.status)&&<small className="operations-warning">结果未知，请勿重发；请先核对原任务。</small>}</div><span>{new Date(job.createdAt).toLocaleString("zh-CN")}</span><div className="row-actions">{isReadOnlyReconciliation(job) && <button className="mini-button" disabled={running === job.id} onClick={() => void continueJob(job)}>{running === job.id ? "查询中…" : job.platformKey === "website" ? "按原操作恢复" : "只读查询状态"}</button>}{!isReadOnlyReconciliation(job)&&confirmedProductActionAvailable(productPlatform(job.platformKey)?.ordinaryPublishEnabled === true, sprintSelections, job, articleById.get(job.articleId)) && <button className="mini-button" disabled={running === job.id} onClick={() => void continueJob(job)}>确认并继续发布</button>}{job.platformKey === "website" && !isReadOnlyReconciliation(job) && ["AwaitingConfirmation", "DryRunPassed"].includes(job.status) && <button className="mini-button" disabled={running === job.id} onClick={() => void continueJob(job)}>确认并发布官网</button>}{job.platformKey === "douyin" && !isReadOnlyReconciliation(job) && !["Success", "Published", "Cancelled", "Failed", "ReconciledNotPublished"].includes(job.status) && (productPlatform("douyin")?.ordinaryPublishEnabled && b01JobStatuses[job.id]?.status === "Missing" ? <button className="mini-button" disabled={running === job.id} onClick={() => void continueJob(job)}>确认并继续发布</button> : developerMode && b01JobStatuses[job.id]?.eligible ? <button className="mini-button" disabled={running === job.id} onClick={() => void continueJob(job)}>B01 单次验收 · 继续</button> : developerMode && b01JobStatuses[job.id]?.status === "Prepared" ? <button className="mini-button" disabled={running === job.id} onClick={() => void requestB01FinalApproval(job)}>请求 Owner 最终批准</button> : <span className="v111-unavailable">{b01JobStatuses[job.id]?.reason ?? "等待 Owner 最终授权"}</span>)}{developerMode && job.status === "NeedsUserAction" && b01JobStatuses[job.id]?.status === "Bound" && <button className="mini-button" disabled={running === job.id} onClick={() => void retireB01Preboundary(job)}>撤销未提交验收</button>}<button className="mini-button" onClick={() => setDetailsJob(job)}>查看详情</button></div></div>)}</div>}</section>
    {hiddenHistoryJobs.length > 0 && <details className="panel"><summary>历史隐藏平台任务（{hiddenHistoryJobs.length}）</summary><div className="v11-recent-list">{hiddenHistoryJobs.map((job) => <div key={job.id}><strong>{platformLabel(job.platformKey)}</strong><span>{articleById.get(job.articleId)?.title ?? "历史文章"} · {publishStatusLabel(job.status)}</span><button className="mini-button" onClick={() => setDetailsJob(job)}>只读查看详情</button></div>)}</div></details>}
    {open && <V11PublishModal onClose={() => setOpen(false)} onDone={() => { load(); refresh(); }} onNavigate={onNavigate} />}
    {detailsJob && <div className="drawer-backdrop" onClick={() => setDetailsJob(null)}><aside className="drawer v11-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">发布任务</span><h2>任务详情</h2></div><button className="icon-button" onClick={() => setDetailsJob(null)}>×</button></div><div className="v11-job-detail"><strong>{articleById.get(detailsJob.articleId)?.title ?? "文章内容"}</strong><span>平台：{platformLabel(detailsJob.platformKey)}</span><span>账号：{accountById.get(detailsJob.accountId)?.accountAlias || accountById.get(detailsJob.accountId)?.name || "已选账号"}</span><span>图片：{detailsJob.selectedImageAssetId ? imageById.get(detailsJob.selectedImageAssetId)?.name || "已选图片" : "未使用"}</span><span>发布模式：{modeLabel(detailsJob)}</span><span>当前状态：{publishStatusLabel(detailsJob.status)}</span>{unknownPublishResult(detailsJob.status)&&<div className="notice warning">结果未知，请勿重发；请先核对原任务。</div>}<span>创建时间：{new Date(detailsJob.createdAt).toLocaleString("zh-CN")}</span>{publishOutcomes[detailsJob.id] && <div className={publishOutcomes[detailsJob.id]?.fidelity === "PASS" ? "notice" : "notice warning"}><strong>发布结果：已发布</strong><span>公开内容一致性：{publishOutcomes[detailsJob.id]?.fidelity === "PASS" ? "通过" : publishOutcomes[detailsJob.id]?.fidelity === "FAIL" ? "不一致" : "暂未完整验证"}</span>{publishOutcomes[detailsJob.id]?.warning && <span>{publishOutcomes[detailsJob.id]?.warning === "BODY_LINEBREAK_RENDERED_AS_LITERAL_ASTERISK" ? "正文换行在公开作品中显示为 *。作品已发布，请勿重发。" : "公开内容质量提醒；请勿重发。"}</span>}</div>}{detailsJob.lastErrorMessage && <div className="notice warning">{detailsJob.lastErrorMessage}</div>}</div>{detailsJob.platformKey === "website" && websiteJobViews[detailsJob.id] && <OfficialApiJobControls view={websiteJobViews[detailsJob.id]} busy={running === detailsJob.id} onRecover={() => void runWebsiteOperation(detailsJob.id, "recover")} onMaintain={operation => void runWebsiteOperation(detailsJob.id, operation)} />}<div className="drawer-footer"><button className="primary-button" onClick={() => setDetailsJob(null)}>关闭</button></div></aside></div>}
  </>;
}

export function V11PublishModal({ initialArticle, onClose, onDone, onNavigate }: { initialArticle?: Article; onClose: () => void; onDone: () => void; onNavigate?: (route: V11NavigationTarget) => void }): JSX.Element {
  const developerMode = useContext(DeveloperModeContext);
  const [productPreflights, setProductPreflights] = useState<Array<{ platformKey: string; result: ProductPreflightResult }>>([]);
  const [articles, setArticles] = useState<Article[]>(initialArticle ? [initialArticle] : []); const [articleId, setArticleId] = useState(initialArticle?.id ?? ""); const [accounts, setAccounts] = useState<Array<Account & { accountStatus?: string; runtimeAuthState?: string | null; imageTextCreatorReady?: boolean }>>([]); const [platforms, setPlatforms] = useState<Platform[]>([]); const [reviewMode, setReviewMode] = useState<ContentReviewMode>("WarningOnly"); const [finalPublishMode, setFinalPublishMode] = useState<"prepare_only" | "confirm_before_publish" | "auto_publish">("confirm_before_publish"); const [qualityStatus, setQualityStatus] = useState("Draft"); const [qualityIssues, setQualityIssues] = useState<ContentQualityIssue[]>([]); const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]); const [accountChoices, setAccountChoices] = useState<Record<string, string>>({}); const [images, setImages] = useState<ImageAsset[]>([]); const [selectedImage, setSelectedImage] = useState<ImageAsset | null>(null); const [imageMode, setImageMode] = useState<"random" | "manual" | "none">("random"); const [douyinVisibility, setDouyinVisibility] = useState<"" | "public">(""); const [manualImagesOpen, setManualImagesOpen] = useState(false); const [seenImageIds, setSeenImageIds] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [liejuAccountChoices, setLiejuAccountChoices] = useState<string[]>([]);
  const douyinOrdinaryEnabled = productPlatform("douyin")?.ordinaryPublishEnabled === true;
  const [b01EligibleAccountId, setB01EligibleAccountId] = useState<string | null>(null);
  const [b01Reason, setB01Reason] = useState("请先选择指定的 B01 文章和图片");
  const [b01Available, setB01Available] = useState(false);
  const [b01SelectedAccountId, setB01SelectedAccountId] = useState("");
  const [websiteAvailability, setWebsiteAvailability] = useState<OfficialApiAvailability>({ ordinaryEnabled: false, candidateSelections: [] });
  const [websiteConnections, setWebsiteConnections] = useState<OfficialApiAccountView[]>([]);
  const [websiteImages, setWebsiteImages] = useState<OfficialApiImageChoice[]>([]);
  const [websiteSettings, setWebsiteSettings] = useState<OfficialApiContentSettings | null>(null);
  const [sprintSelections, setSprintSelections] = useState<SprintAcceptanceSelection[]>([]);
  useEffect(() => { void window.publisherAPI.sprint?.availability().then(setSprintSelections).catch(() => setSprintSelections([])); }, []);
  const article = articles.find((item) => item.id === articleId) ?? initialArticle;
  const sprintReason = (key: string): string | null => {
    const platform = platforms.find(item => item.platformKey === key);
    return sprintUiSelection(sprintSelections, key, article) && platform?.enabled && platform.capabilities.article
      ? null : operatorPublishBlockReason(key, platform);
  };
  const douyinTitleError = article ? douyinImageTextTitleError(article.title) : null;
  useEffect(() => { void window.publisherAPI.b01.availability().then((result) => setB01Available(developerMode && !douyinOrdinaryEnabled && result.enabled)).catch(() => setB01Available(false)); }, [douyinOrdinaryEnabled, developerMode]);
  useEffect(() => { void Promise.all([window.publisherAPI.website.listConnections(), window.publisherAPI.website.availability()])
    .then(async ([connections, availability]) => { const fresh = await refreshWebsiteConnections(connections, id => window.publisherAPI.website.verifyConnection(id)); setWebsiteConnections(fresh); setWebsiteAvailability(availability); })
    .catch(() => { setWebsiteConnections([]); setWebsiteAvailability({ ordinaryEnabled: false, candidateSelections: [] }); }); }, []);
  useEffect(() => { setB01SelectedAccountId(""); setB01EligibleAccountId(null); }, [article?.id]);
  useEffect(() => { if (!article) { setWebsiteSettings(null); return; } const grant = websiteAvailability.ordinaryEnabled ? undefined : websiteAvailability.candidateSelections.find(value => value.articleId === article.id);
    setWebsiteSettings({ ...defaultOfficialApiSettings(article), ...(grant ? { kind: grant.kind } : {}) }); }, [article, websiteAvailability]);
  useEffect(() => { void Promise.all([initialArticle ? Promise.resolve([initialArticle]) : window.publisherAPI.articles.list(), window.publisherAPI.accounts.overview(), window.publisherAPI.platforms.list(), window.publisherAPI.settings.get()]).then(([nextArticles, nextAccountRows, nextPlatforms, settings]) => { const nextAccounts = nextAccountRows.map((row) => ({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState, imageTextCreatorReady: row.imageTextCreatorReady })); setArticles(nextArticles.filter(isProductionArticle)); setAccounts(operatorAccounts(nextAccounts)); setPlatforms(operatorPlatformCatalog(nextPlatforms)); setReviewMode(normalizeContentReviewMode(settings.contentReviewMode)); setFinalPublishMode(settings.finalPublishMode === "prepare_only" || settings.finalPublishMode === "auto_publish" ? settings.finalPublishMode : "confirm_before_publish"); setSelectedPlatforms([]); }); }, [initialArticle]);
  useEffect(() => { if (!article?.id) return; void (async () => { try { let state = await window.publisherAPI.quality.status("article", article.id); if (reviewMode === "WarningOnly" && (!state || state.status === "Draft")) { await window.publisherAPI.quality.recheck("article", article.id); state = await window.publisherAPI.quality.status("article", article.id); } setQualityStatus(state?.status ?? "Draft"); const history = await window.publisherAPI.quality.history("article", article.id); setQualityIssues(history.reviews[0]?.issues ?? []); } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "内容检查暂时无法完成；仅提醒模式仍允许你本人决定。"); } })(); }, [article?.id, reviewMode]);
  useEffect(() => { const next: Record<string, string> = {}; selectedPlatforms.forEach((key) => {
    if (["douyin", "website", "weibo", "toutiao", "sohu_media", "cnblogs"].includes(key)) return;
    const candidates = connectedAccountsForPlatform(accounts, key).filter((account) => key !== "douyin" || account.imageTextCreatorReady && (douyinOrdinaryEnabled || account.id === b01EligibleAccountId));
    const selected = defaultAccountSelection(candidates);
    if (selected.selectedAccountId) next[key] = selected.selectedAccountId;
    if (key === "lieju" && liejuAccountChoices.length === 0 && candidates[0]) setLiejuAccountChoices([candidates[0].platformAccountId ?? candidates[0].id]);
  }); setAccountChoices((current) => ({ ...current, ...next })); }, [accounts, selectedPlatforms, liejuAccountChoices.length, b01EligibleAccountId, douyinOrdinaryEnabled, sprintSelections, article]);
  useEffect(() => {
    if (!article || !websiteSettings) return;
    const preferred = preferredWebsiteCandidate(article.id, websiteAvailability, websiteConnections, websiteSettings.kind);
    setAccountChoices(current => preferred ? { ...current, website: current.website && websitePublishEligibility(article.id, current.website, websiteSettings.kind, websiteAvailability, websiteConnections).eligible ? current.website : preferred.accountId } : { ...current, website: "" });
  }, [article, websiteSettings, websiteAvailability, websiteConnections]);
  useEffect(() => {
    if (!article?.id || !selectedImage?.id || imageMode !== "manual" || !b01SelectedAccountId || !b01Available) { setB01EligibleAccountId(null); return; }
    let active = true;
    void window.publisherAPI.b01.eligibility({ accountId: b01SelectedAccountId, articleId: article.id, imageAssetId: selectedImage.id }).then((result) => {
      if (!active) return;
      setB01EligibleAccountId(result.eligible ? b01SelectedAccountId : null);
      setB01Reason(result.reason);
    }).catch(() => { if (active) { setB01EligibleAccountId(null); setB01Reason("B01 单次验收资格暂不可用"); } });
    return () => { active = false; };
  }, [article?.id, selectedImage?.id, imageMode, b01SelectedAccountId, b01Available]);
  const togglePlatform = (key: string): void => {
    if (key === "website") {
      if (!article || !websiteSettings || !websitePublishEligibility(article.id, accountChoices.website ?? "", websiteSettings.kind, websiteAvailability, websiteConnections).eligible) return;
      setSelectedPlatforms(current => current.includes(key) ? current.filter(item => item !== key) : [key]);
      return;
    }
    if (key === "douyin" && !douyinOrdinaryEnabled) {
      if (!b01EligibleAccountId) return;
      const account = accounts.find((item) => item.id === b01EligibleAccountId);
      if (account) setAccountChoices((current) => ({ ...current, douyin: account.platformAccountId ?? account.id }));
      setSelectedPlatforms((current) => current.includes(key) ? current.filter((item) => item !== key) : [key]);
      return;
    }
    if (sprintReason(key)) return;
    if (sprintUiSelection(sprintSelections, key, article)) { setSelectedPlatforms(current => current.includes(key) ? [] : [key]); return; }
    setSelectedPlatforms((current) => current.includes(key) ? current.filter((item) => item !== key) : current.includes("website") ? [key] : [...current, key]);
  };
  const channels = platforms.filter((platform) => productPlatform(platform.platformKey)?.publishSelectorVisible);
  const primaryPlatformKey = selectedPlatforms[0] ?? "";
  useEffect(() => { if (!article?.id) return; void Promise.all([window.publisherAPI.imageAssets.list({ brandId: article.brandId, enabledOnly: true }), window.publisherAPI.website.imageChoices(article.id).catch(() => [])]).then(([nextImages, allImages]) => {
    setImages(nextImages); setWebsiteImages(allImages); setSelectedImage(null); setSeenImageIds([]); setImageMode("none");
  }); }, [article?.id, article?.brandId]);
  useEffect(() => { if (!article?.id || !primaryPlatformKey || ["douyin", "website"].includes(primaryPlatformKey)) return;
    void window.publisherAPI.imageAssets.selectForArticle({ articleId: article.id, platformKey: primaryPlatformKey }).then((image) => {
      setSelectedImage(image); setSeenImageIds(image ? [image.id] : []); setImageMode(image ? "random" : "none");
    }); }, [article?.id, primaryPlatformKey]);
  const swapImage = async (): Promise<void> => { if (!article) return; const next = await window.publisherAPI.imageAssets.selectForArticle({ articleId: article.id, platformKey: primaryPlatformKey, excludeImageAssetIds: seenImageIds }); setSelectedImage(next); if (next) { setSeenImageIds((current) => [...new Set([...current, next.id])]); setImageMode("random"); setMessage(""); } else setMessage("没有更多匹配图片，可以手动选择或不使用图片。"); };
  const allowed = canPublishWithReviewMode(qualityStatus, reviewMode);
  const highRisk = qualityIssues.some((issue) => issue.severity === "error");
  const controlledOfficialApiImages = article ? controlledWebsiteAssets(article, websiteImages) : [];
  const selectedWebsiteConnection = websiteConnections.find(view => view.accountId === accountChoices.website) ?? null;
  const websiteEligibility = article && websiteSettings ? websitePublishEligibility(article.id, accountChoices.website ?? "", websiteSettings.kind, websiteAvailability, websiteConnections) : { eligible: false, reason: "请先选择文章", connection: null };
  const websiteSettingsError = websiteSettings ? validateOfficialApiSettings(websiteSettings, new Set(controlledOfficialApiImages.map(asset => asset.id))) : "官网发布设置尚未加载";
  const requestB01Authorization = async (): Promise<void> => {
    if (!article || !selectedImage || imageMode !== "manual" || !b01SelectedAccountId) return;
    if (douyinTitleError) { setB01Reason(douyinTitleError); return; }
    setBusy(true);
    try {
      const result = await window.publisherAPI.b01.requestAuthorization({ platformKey: "douyin", accountId: b01SelectedAccountId,
        articleId: article.id, imageAssetId: selectedImage.id });
      setB01Reason(result.reason);
      setB01EligibleAccountId(result.eligible ? b01SelectedAccountId : null);
    } catch (error) { setB01Reason(error instanceof Error ? error.message : "B01 验收授权申请未通过"); }
    finally { setBusy(false); }
  };
  useEffect(() => { setProductPreflights([]); }, [articleId, selectedPlatforms, accountChoices, selectedImage?.id, imageMode, websiteSettings, douyinVisibility]);
  const inspectProductPreflight = async (): Promise<void> => {
    if (!article || busy) return;
    setBusy(true);
    try {
      const results: Array<{ platformKey: string; result: ProductPreflightResult }> = [];
      for (const platformKey of selectedPlatforms) {
        const accountId = accountChoices[platformKey];
        if (!accountId) throw new Error(`请选择${platformLabel(platformKey)}账号`);
        const result = await window.publisherAPI.product.preflight({ articleId: article.id, platformKey, platformAccountId: accountId, selectedImageAssetId: selectedImage?.id ?? null, ...(platformKey === "website" && websiteSettings ? { websiteSettings } : {}) });
        results.push({ platformKey, result });
      }
      setProductPreflights(results); setMessage(results.some(item => !item.result.allowed) ? "发布条件存在阻塞项，请先处理。" : "Main 检查通过，准备时仍会核验最新状态。");
    } catch (error) { setMessage(productErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const start = async (): Promise<void> => {
    if (!article || !allowed || selectedPlatforms.length === 0) return;
    if (productPreflights.length !== selectedPlatforms.length || productPreflights.some(item => !item.result.allowed)) { setMessage("请先检查发布条件并修正阻塞项"); return; }
    if (selectedPlatforms.includes("douyin") && douyinTitleError) { setMessage(douyinTitleError); return; }
    setBusy(true);
    try {
      const done: string[] = [];
      let jobCount = 0;
      const b01 = selectedPlatforms.includes("douyin") && !douyinOrdinaryEnabled;
      const persistedFinalMode = selectedPlatforms.some(key => ["douyin", "website", "weibo", "toutiao", "sohu_media", "cnblogs"].includes(key)) ? "CONFIRM_BEFORE_PUBLISH" : finalPublishMode === "prepare_only" ? "PREPARE_ONLY" : finalPublishMode === "auto_publish" ? "AUTO_PUBLISH" : "CONFIRM_BEFORE_PUBLISH";
      for (const platformKey of selectedPlatforms) {
        const blockReason = platformKey === "website" && websiteEligibility.eligible ? websiteSettingsError
          : platformKey === "douyin" && b01EligibleAccountId ? null
          : sprintReason(platformKey);
        if (blockReason) throw new Error(blockReason);
        if (platformKey === "douyin" && (imageMode !== "manual" || !selectedImage)) throw new Error("抖音图文需要手动选择当前文章的图片");
        if (platformKey === "douyin" && douyinVisibility !== "public") throw new Error("请为抖音图文明确选择可见范围");
        if (platformKey === "website" && (!websiteSettings || websiteSettingsError)) throw new Error(websiteSettingsError ?? "官网发布设置尚未加载");
        const accountIds = platformKey === "lieju" ? liejuAccountChoices : accountChoices[platformKey] ? [accountChoices[platformKey]] : [];
        if (accountIds.length === 0) throw new Error(`请选择${platformLabel(platformKey)}账号`);
        for (const accountId of accountIds) {
          if (platformKey === "website" && websiteSettings) {
            await window.publisherAPI.articles.preparePublish(buildWebsitePrepareInput(article.id, accountId, websiteSettings));
            jobCount += 1;
            continue;
          }
          let image = platformKey === "cnblogs" || imageMode === "none" ? null : selectedImage;
          if (imageMode === "random" && platformKey !== primaryPlatformKey && platformKey !== "cnblogs") image = await window.publisherAPI.imageAssets.selectForArticle({ articleId: article.id, platformKey, excludeImageAssetIds: image ? [image.id] : [] });
          await window.publisherAPI.articles.preparePublish({ articleId: article.id, platformKey, platformAccountId: accountId,
            publishMode: b01 || platformKey === "website" ? "ASSISTED" : finalPublishMode === "prepare_only" ? "MANUAL" : "ASSISTED", finalPublishMode: persistedFinalMode,
            selectedImageAssetId: image?.id ?? null, imageSelectionMode: image ? imageMode : "none",
            ...(platformKey === "douyin" ? { douyinImageTextSettings: { version: 1 as const, visibility: "public" as const, timing: "immediate" as const } } : {}) });
          jobCount += 1;
        }
        done.push(platformLabel(platformKey));
      }
      const outcome = selectedPlatforms.includes("website") ? "官网内容已准备并持久化；请在发布中心确认一次最终提交。"
        : b01 ? "B01 单次产品验收已准备；最终提交仍需 Owner 单独授权。"
        : finalPublishMode === "prepare_only" ? "内容已准备，未执行最终提交。"
          : finalPublishMode === "auto_publish" ? "已按自动发布设置进入任务；未验证最终提交能力的浏览器平台会降级为发布前确认。"
            : "内容已准备，正在等待发布前确认。";
      setMessage(jobCount > selectedPlatforms.length ? `已创建 ${jobCount} 个独立发布任务。${outcome}` : `${done.join("、")}：${outcome}`);
      onDone();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "开始发布失败"); }
    finally { setBusy(false); }
  };
  return <div className="drawer-backdrop" onClick={onClose}>
    <aside className="drawer v11-drawer v11-publish-drawer" onClick={(event) => event.stopPropagation()}>
      <div className="drawer-head"><div><span className="eyebrow">发布文章</span><h2>选择发布渠道</h2></div><button className="icon-button" onClick={onClose}>×</button></div>
      {!initialArticle && <label>文章<select value={articleId} onChange={(event) => setArticleId(event.target.value)}><option value="">请选择文章</option>{articles.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}
      {article && <div className="v11-publish-article"><strong>{article.title}</strong><span>{article.business || article.keyword || "文章内容"} · {article.city || "未填写城市"}</span></div>}
      {douyinTitleError && <div className="notice warning">{douyinTitleError}</div>}
      <div className="v11-review-status"><span>内容审核：{contentReviewModeLabel(reviewMode)}</span><Status label={articleReviewLabel(qualityStatus)} tone={articleReviewTone(qualityStatus)} /></div>
      {reviewMode === "Strict" && !allowed && article && <div className="notice error">严格审核模式要求文章达到“已通过”后才能发布。</div>}
      {reviewMode === "WarningOnly" && qualityStatus !== "Approved" && article && <div className={`v111-quality-warning ${highRisk ? "high-risk" : ""}`}><strong>{highRisk ? "高风险内容提醒：请本人确认后决定" : `系统发现 ${qualityIssues.length || 1} 项内容提醒`}</strong>{qualityIssues.length > 0 ? <ul>{qualityIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : <p>内容尚未人工批准；仅提醒模式不会强制阻止发布。</p>}</div>}
      {reviewMode === "Off" && <div className="notice">内容审核已关闭；Quality Gate 历史仍保留在高级详情中。</div>}
      <div className="v11-publish-method"><strong>发布方式：{selectedPlatforms.includes("website") ? "官网 OfficialAPI · 发布前确认" : selectedPlatforms.includes("douyin") ? douyinOrdinaryEnabled ? "抖音图文 · 发布前确认" : "B01 单次产品验收 · 发布前确认" : finalPublishMode === "prepare_only" ? "只准备内容" : finalPublishMode === "auto_publish" ? "自动发布" : "发布前确认"}</strong><span>{selectedPlatforms.includes("website") ? websiteAvailability.ordinaryEnabled ? "系统核验官网账号、内容版本和已选图片；准备完成后由你确认最终发布。" : "本次仅允许指定验收账号与文章；准备完成后仍需确认最终发布。" : selectedPlatforms.includes("douyin") ? douyinOrdinaryEnabled ? "单账号、单图、公开、立即发布、无音乐；准备完成后由你确认最终提交。" : "仅指定测试账号、文章和图片；准备完成后仍需 Owner 单独批准最终提交。" : finalPublishMode === "auto_publish" ? "只有已验证能力的平台会自动继续；登录失效、安全验证或风险控制会立即暂停。" : finalPublishMode === "prepare_only" ? "系统填写内容和图片后停止，不点击平台最终发布。" : "系统准备内容后等待你的最终确认。"}</span></div>
      {b01Available && article && <div className="notice v11-b01-authorization"><strong>B01 单次产品验收申请 · 普通抖音发布仍关闭</strong>
        <label>唯一测试账号<select aria-label="B01 唯一测试账号" value={b01SelectedAccountId} onChange={(event) => { setB01SelectedAccountId(event.target.value); setB01EligibleAccountId(null); }}>
          <option value="">请明确选择账号</option>{accounts.filter((account) => account.platformKey === "douyin" && !account.archivedAt).map((account) =>
            <option value={account.id} key={account.id}>{account.accountAlias || account.name}</option>)}
        </select></label>
        <span>先手动选择这一篇全新测试文章的一张图片。授权只绑定当前账号、文章及图片；创建授权不等于批准最终提交。</span>
        <button className="secondary-button" disabled={busy || Boolean(douyinTitleError) || !b01SelectedAccountId || !selectedImage || imageMode !== "manual" || Boolean(b01EligibleAccountId)} onClick={() => void requestB01Authorization()}>申请创建 B01 单次验收授权</button>
        <span>{b01Reason}</span></div>}
      <PublishWorkflow />
      <div className="v11-channel-list">{channels.map((platform) => {
        if (platform.platformKey === "website") {
          const candidates = article ? websiteConnections.filter(view => websiteAvailability.ordinaryEnabled || websiteAvailability.candidateSelections.some(candidate => candidate.articleId === article.id && candidate.accountId === view.accountId)) : [];
          const selected = candidates.find(view => view.accountId === accountChoices.website) ?? null;
          const blockReason = websiteEligibility.reason;
          return <div key={platform.platformKey}>
            <label className={`check-row ${selected && !blockReason ? "" : "disabled"}`}><input type="checkbox" disabled={Boolean(blockReason) || !selected} checked={selectedPlatforms.includes("website")} onChange={() => togglePlatform("website")} /><span>{platform.displayName}</span><em>{blockReason ?? "官网账号已连接 · 发布前确认"}</em></label>
            {candidates.length > 0 ? <><select aria-label="官网发布账号" value={accountChoices.website ?? ""} onChange={event => setAccountChoices(current => ({ ...current, website: event.target.value }))}><option value="">请选择官网账号</option>{candidates.map(view => <option value={view.accountId} key={view.accountId}>{view.environment === "production" ? "正式环境 production" : view.environment === "staging" ? "测试环境 staging" : "环境未验证"} · {view.accountId}</option>)}</select>
              {selected && <div className={selected.environment === "staging" ? "notice warning" : "notice"}><strong>{selected.environment === "production" ? "正式环境 production" : selected.environment === "staging" ? "测试环境 staging" : "环境未验证"}</strong><span>站点 {selected.siteId ?? "未验证"} · API {selected.apiVersion ?? "未验证"} · {selected.writesEnabled ? "可写" : "只读"} · {selected.status}</span></div>}</> : <div className="notice warning">当前没有可用于此文章的官网账号，请到账号中心验证连接。</div>}
          </div>;
        }
        const sprintSelection = sprintUiSelection(sprintSelections, platform.platformKey, article);
        const candidates = connectedAccountsForPlatform(accounts, platform.platformKey)
          .filter(account => !sprintSelection || account.id === sprintSelection.accountId)
          .filter((account) => platform.platformKey !== "douyin" || account.imageTextCreatorReady && (douyinOrdinaryEnabled || account.id === b01EligibleAccountId));
        const connected = candidates.length > 0;
        const blockReason = platform.platformKey === "douyin" && douyinTitleError ? douyinTitleError : platform.platformKey === "douyin" && b01EligibleAccountId ? null : platform.platformKey === "douyin" && !douyinOrdinaryEnabled ? b01Reason : sprintReason(platform.platformKey);
        return <div key={platform.platformKey}>
          <label className={`check-row ${connected && !blockReason ? "" : "disabled"}`}><input type="checkbox" disabled={Boolean(blockReason) || !connected} checked={selectedPlatforms.includes(platform.platformKey)} onChange={() => togglePlatform(platform.platformKey)} /><span>{platform.displayName}</span><em>{platform.platformKey === "douyin" && connected && !blockReason ? douyinOrdinaryEnabled ? "图文可发布 · 请明确选择账号" : "B01 单次产品验收" : blockReason ?? (connected ? candidates.length === 1 ? "已自动选择账号" : `${candidates.length} 个账号` : <button type="button" className="text-button" onClick={() => { onClose(); onNavigate?.("accounts"); }}>连接</button>)}</em></label>
          {selectedPlatforms.includes(platform.platformKey) && platform.platformKey === "lieju" && candidates.length > 1 && <div className="v112-account-multiselect"><strong>默认单选；多选会创建 {liejuAccountChoices.length} 个独立任务</strong>{candidates.map((account) => { const id = account.platformAccountId ?? account.id; return <label className="check-row" key={id}><input type="checkbox" checked={liejuAccountChoices.includes(id)} onChange={() => setLiejuAccountChoices((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])} /><span>{account.accountAlias || account.name}</span><em>独立 Session</em></label>; })}</div>}
          {selectedPlatforms.includes(platform.platformKey) && platform.platformKey !== "lieju" && (candidates.length > 1 || ["douyin", "weibo", "toutiao", "sohu_media", "cnblogs"].includes(platform.platformKey)) && <select aria-label={`${platform.displayName}发布账号`} value={accountChoices[platform.platformKey] ?? ""} onChange={(event) => setAccountChoices((current) => ({ ...current, [platform.platformKey]: event.target.value }))}><option value="">请选择账号</option>{candidates.map((account) => <option value={account.platformAccountId ?? account.id} key={account.id}>{account.accountAlias || account.name}</option>)}</select>}
        </div>;
      })}</div>
      {selectedPlatforms.includes("douyin") && <div className="notice"><strong>{douyinOrdinaryEnabled ? "抖音图文" : "B01 单次产品验收 · 抖音图文"}</strong><label>可见范围 <select value={douyinVisibility} onChange={(event) => setDouyinVisibility(event.target.value === "public" ? "public" : "")}><option value="">请选择</option><option value="public">公开可见</option></select></label><span>{douyinOrdinaryEnabled ? "仅发布到明确选择的一个账号，使用一张图片；公开、立即发布、无音乐。准备后确认一次最终提交。" : "仅当前测试账号、文章、图片和一次最终提交；本次操作只准备内容，最终提交需 Owner 另行批准。"}</span></div>}
      {selectedPlatforms.includes("website") && article && selectedWebsiteConnection && websiteSettings && <OfficialApiPublishSettings article={article} connection={selectedWebsiteConnection} assets={controlledOfficialApiImages} value={websiteSettings} onChange={setWebsiteSettings} />}
      {selectedPlatforms.includes("website") && websiteSettingsError && <div className="notice warning">{websiteSettingsError}</div>}
      {article && !selectedPlatforms.includes("website") && <section className="v111-publish-image"><div className="panel-heading"><div><h3>配图</h3><span>列举网仅准备已选且符合官方限制的图片；博客园首版不调用未验证的图片上传接口。</span></div></div>{imageMode !== "none" && selectedImage ? <div className="v111-selected-image"><div className="image-preview">{selectedImage.previewUrl ? <img src={selectedImage.previewUrl} alt={selectedImage.name} /> : <span>▧</span>}</div><div><strong>{selectedImage.name}</strong><span>匹配原因：{imageMatchReason(article, selectedImage)}</span></div></div> : <div className="notice">本次不使用图片。</div>}<div className="row-actions"><button className="secondary-button" disabled={images.length < 2} onClick={() => void swapImage()}>换一张</button><button className="secondary-button" onClick={() => setManualImagesOpen((value) => !value)}>手动选择</button><button className="mini-button" onClick={() => { setImageMode("none"); setSelectedImage(null); }}>不使用图片</button></div>{manualImagesOpen && <div className="v111-manual-images">{images.map((image) => <button className={selectedImage?.id === image.id ? "selected" : ""} key={image.id} onClick={() => { setSelectedImage(image); setImageMode("manual"); setManualImagesOpen(false); }}><div className="image-preview">{image.previewUrl ? <img src={image.previewUrl} alt={image.name} /> : <span>▧</span>}</div><span>{image.name}</span></button>)}</div>}</section>}
      {message && <div className="notice">{message}</div>}
      <section className="panel operations-panel"><div className="panel-heading"><div><h3>Product Preflight · 发布条件</h3><span>先核对已通过项、缺项与下一步。检查本身不会执行最终发布。</span></div></div><button className="secondary-button" disabled={busy || !article || selectedPlatforms.length === 0} onClick={() => void inspectProductPreflight()}>检查发布条件</button>{productPreflights.map(item => { const presentation = preflightPresentation(item.result); return <div className="preflight-results" key={item.platformKey}><div className="panel-heading"><strong>{platformLabel(item.platformKey)}</strong><StatusBadge label={presentation.title} tone={presentation.tone} /></div><p>已通过 {presentation.passed} / {presentation.total} 项检查</p>{item.result.items.map(check => <div className={`preflight-check ${check.passed ? "passed" : "blocked"}`} key={check.label}><span aria-hidden="true">{check.passed ? "✓" : "!"}</span><span>{check.label}：{check.value}</span></div>)}{item.result.blockers.map(reason => <div className="notice warning" key={reason}>{reason}</div>)}{!item.result.allowed && <p className="preflight-next">下一步：按上方缺项核对企业、人工审核、账号身份和素材。修正后重新检查；当前结果不会自动创建发布授权。</p>}</div>; })}</section><div className="drawer-footer"><button className="secondary-button" onClick={onClose}>{reviewMode === "WarningOnly" && qualityStatus !== "Approved" ? "返回修改" : "取消"}</button><button className="primary-button" disabled={busy || !article || !allowed || productPreflights.length !== selectedPlatforms.length || productPreflights.some(item => !item.result.allowed) || selectedPlatforms.length === 0 || selectedPlatforms.includes("website") && (!websiteEligibility.eligible || Boolean(websiteSettingsError))} onClick={() => void start()}>{busy ? "正在准备…" : selectedPlatforms.includes("website") ? "准备官网内容" : selectedPlatforms.includes("douyin") ? douyinOrdinaryEnabled ? "准备抖音图文" : "准备 B01 验收内容" : finalPublishMode === "prepare_only" ? "准备内容" : finalPublishMode === "auto_publish" ? "开始自动发布" : reviewMode === "WarningOnly" && qualityStatus !== "Approved" ? "仍然发布" : "开始发布"}</button></div>
    </aside>
  </div>;
}

