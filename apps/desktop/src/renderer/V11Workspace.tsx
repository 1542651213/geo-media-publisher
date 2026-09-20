import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import type { ControlledPostUploadDiscoveryResult, PublishFlowExplorationResult } from "@publisher/adapters-core";
import { defaultAccountSelection, normalizeContentReviewMode, selectRelevantBrandFacts, type Account, type Article, type Brand, type ContentQualityIssue, type ContentReviewMode, type ExcelImportPreview, type ImageAsset, type Platform, type PlatformSelfTestRun, type PublishJob } from "@publisher/domain";
import type { AccountManagementRow, ContentStudioTaskView, PublishJobPreview } from "../shared/api";
import { accountCapabilityText, accountCenterPriority, accountConnectionTarget, accountStatusLabel, articleListStatusLabel, articleReviewLabel, articleReviewTone, canPublishWithReviewMode, connectedAccountsForPlatform, contentReviewModeLabel, imageMatchReason, isOnlineAccount, loadAccountCenterData, orderPlatformCatalog, platformAvailability, platformCapabilityText, platformConnectionModeLabel, platformLabel, publishStatusLabel, publishStatusTone, searchOrderedPlatforms, type V11NavigationTarget } from "./v11-ui-model";
import { disconnectFeedbackMessage } from "./platform-connection-ui";
import { beginPostLoginHeartbeat, runCheckLoginWithHeartbeats, runPreSubmitGateWithHeartbeats } from "./session-heartbeat";
import { CONTROLLED_SELF_TEST_CONFIRMATION, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_CONFIRMATION, PUBLISH_FLOW_EXPLORATION_CONFIRMATION, ControlledSelfTestEntryGuard, buildControlledSelfTestRequest, buildOneShotRealPublishRequest, buildPublishFlowExplorationRequest, canLaunchOneShotRealPublishFromAccountCard, controlledSelfTestResultMessage, publishFlowExplorationResultMessage, supportsControlledPostUploadDiscovery, supportsOneShotRealPublishAcceptance, supportsPublishFlowExploration } from "../shared/controlled-self-test-entry";
import { OneShotConfirmationUiGuard, oneShotConfirmationErrorMessage } from "./one-shot-confirmation-ui";

type QualityStatusByArticle = Record<string, string>;

const productionSources = new Set(["production", "content_studio", "excel_import"]);
const businessTagDefaults = ["甲醛治理", "定期消杀", "灭四害", "白蚁防治", "病媒生物防制", "企业通用"];
const cityTagDefaults = ["江苏", "苏州", "木渎", "吴中", "通用"];
const usageTagDefaults = ["治理现场", "检测设备", "消杀现场", "白蚁现场", "办公环境", "企业形象", "团队", "门店", "资质证书", "营业资料", "通用"];
const imageCategories = ["全部", ...usageTagDefaults];
const standardPlatforms = ["zhihu", "weibo", "toutiao", "douyin", "lieju", "cnblogs"];

export type BrowserLoginResultClassification = "SUCCESS" | "NEEDS_USER_ACTION" | "CONTRACT_MISMATCH";

export function classifyBrowserLoginResult(result: { accountStatus?: unknown }): BrowserLoginResultClassification {
  if (result.accountStatus === "Connected") return "SUCCESS";
  if (result.accountStatus === "NeedsLogin") return "NEEDS_USER_ACTION";
  return "CONTRACT_MISMATCH";
}

function isProductionArticle(article: Article): boolean {
  return productionSources.has(article.source ?? "production");
}

function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  return new Date(value).toDateString() === new Date().toDateString();
}

function Status({ label, tone = "muted" }: { label: string; tone?: string }): JSX.Element {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function WorkspaceTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: JSX.Element }): JSX.Element {
  return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function EmptyWorkspace({ title, description, action }: { title: string; description: string; action?: JSX.Element }): JSX.Element {
  return <div className="empty-state"><div className="empty-icon">○</div><strong>{title}</strong><p>{description}</p>{action}</div>;
}

function MetricCard({ label, value, hint, tone = "blue", icon }: { label: string; value: number | string; hint: string; tone?: string; icon: string }): JSX.Element {
  return <div className={`stat-card ${tone}`}><div className="stat-icon">{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;
}

export function V11Dashboard({ refreshKey, onNavigate }: { refreshKey: number; onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const [articles, setArticles] = useState<Article[]>([]);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [quality, setQuality] = useState<Awaited<ReturnType<typeof window.publisherAPI.quality.items>>>([]);
  useEffect(() => {
    void Promise.all([window.publisherAPI.articles.list(), window.publisherAPI.jobs.list(), window.publisherAPI.accounts.list(), window.publisherAPI.quality.items()]).then(([nextArticles, nextJobs, nextAccounts, nextQuality]) => {
      const operatingArticles = nextArticles.filter(isProductionArticle);
      const operatingIds = new Set(operatingArticles.map((article) => article.id));
      setArticles(operatingArticles); setJobs(nextJobs.filter((job) => operatingIds.has(job.articleId))); setAccounts(nextAccounts.filter((account) => standardPlatforms.includes(account.platformKey))); setQuality(nextQuality.filter((item) => item.contentType === "article" && operatingIds.has(item.contentId)));
    });
  }, [refreshKey]);
  const pendingReview = quality.filter((item) => item.contentType === "article" && item.status !== "Approved" && item.status !== "Rejected").length;
  const pendingPublish = jobs.filter((job) => ["Pending", "Scheduled", "Retry", "AwaitingConfirmation", "ReadyToSubmit"].includes(job.status)).length;
  const pendingUserJobs = jobs.filter((job) => job.status === "NeedsUserAction");
  const reloginAccounts = accounts.filter((account) => ["expired", "logged_out", "needs_user_action"].includes(account.loginStatus));
  const needsAction = jobs.filter((job) => publishStatusLabel(job.status) === "需要处理").length + accounts.filter((account) => !isOnlineAccount(account)).length;
  const articleById = new Map(articles.map((article) => [article.id, article]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  return <>
    <WorkspaceTitle eyebrow="内容运营工作台" title="今天的内容运营" description="一眼查看可发布内容、待处理事项和已登录账号。" action={<button className="primary-button" onClick={() => onNavigate("production")}>开始生成内容</button>} />
    {pendingUserJobs.length > 0 && <div className="notice warning v114-startup-reminder"><div><strong>有 {pendingUserJobs.length} 个任务需要继续</strong><span>应用启动不会自动打开平台；只有点击继续后才会进入处理流程。</span></div><button className="primary-button" onClick={() => onNavigate("publishing")}>继续</button></div>}
    {reloginAccounts.length > 0 && <div className="notice warning v114-startup-reminder"><div><strong>{reloginAccounts.map((account) => platformLabel(account.platformKey)).filter((value, index, values) => values.indexOf(value) === index).join("、")}需要重新登录</strong><span>平台页面不会自动打开。</span></div><button className="secondary-button" onClick={() => onNavigate("accounts")}>重新登录</button></div>}
    <div className="stat-grid v11-stat-grid">
      <MetricCard label="今日内容" value={articles.filter((article) => isToday(article.generatedAt || article.createdAt)).length} hint="新生成和新导入的内容" icon="✦" />
      <MetricCard label="内容提醒" value={pendingReview} hint="查看 AI 发现的问题" tone="purple" icon="✓" />
      <MetricCard label="待发布" value={pendingPublish} hint="已安排或等待你确认" tone="orange" icon="↗" />
      <MetricCard label="已发布" value={jobs.filter((job) => publishStatusLabel(job.status) === "已发布" && isToday(job.finishedAt ?? job.createdAt)).length} hint="今天完成的平台发布" tone="green" icon="●" />
      <MetricCard label="在线账号" value={accounts.filter(isOnlineAccount).length} hint={`共 ${accounts.length} 个已添加账号`} tone="blue" icon="◎" />
    </div>
    <div className="v11-dashboard-grid">
      <section className="panel v11-panel"><div className="panel-heading"><div><h3>需要关注</h3><span>这些提醒帮助你检查内容，但是否阻止发布由审核模式决定。</span></div></div>
        <div className="v11-attention-list">
          <button onClick={() => onNavigate("articles")}><span>内容提醒</span><b>{pendingReview ? `${pendingReview} 篇有 AI 检查结果` : "暂时没有内容提醒"}</b><em>→</em></button>
          <button onClick={() => onNavigate("publishing")}><span>发布安排</span><b>{pendingPublish ? `${pendingPublish} 个内容等待发布` : "暂无待发布内容"}</b><em>→</em></button>
          <button onClick={() => onNavigate("accounts")}><span>账号登录</span><b>{needsAction ? `${needsAction} 项需要关注` : "所有账号状态正常"}</b><em>→</em></button>
        </div>
      </section>
      <section className="panel v11-panel"><div className="panel-heading"><div><h3>快捷操作</h3><span>常用动作都在这里。</span></div></div>
        <div className="v11-quick-actions"><button onClick={() => onNavigate("production")}>✦<span>生成内容</span></button><button onClick={() => onNavigate("articles")}>▤<span>导入文章</span></button><button onClick={() => onNavigate("images")}>▧<span>上传图片</span></button><button onClick={() => onNavigate("publishing")}>↗<span>发布内容</span></button><button onClick={() => onNavigate("accounts")}>◎<span>连接账号</span></button></div>
      </section>
    </div>
    <div className="v11-dashboard-grid v11-dashboard-bottom">
      <section className="panel table-panel"><div className="panel-heading"><div><h3>最近文章</h3><span>从内容生产、导入和人工编辑进入文章库。</span></div><button className="text-button" onClick={() => onNavigate("articles")}>查看全部 →</button></div>
        {articles.length === 0 ? <EmptyWorkspace title="还没有运营内容" description="先生成一篇文章，或用简易模板导入标题和内容。" action={<button className="secondary-button" onClick={() => onNavigate("production")}>生成内容</button>} /> : <div className="v11-recent-list">{articles.slice(0, 5).map((article) => <button key={article.id} onClick={() => onNavigate("articles")}><div className="cover-thumb">{article.coverAssetId ? "▧" : "—"}</div><div><strong>{article.title}</strong><span>{article.business || article.keyword || "未填写业务"} · {article.city || "未填写城市"}</span></div><em>{article.targetPlatforms?.map(platformLabel).join("、") || "待选择渠道"}</em></button>)}</div>}
      </section>
      <section className="panel table-panel"><div className="panel-heading"><div><h3>最近发布结果</h3><span>发布后会在这里更新进度。</span></div><button className="text-button" onClick={() => onNavigate("publishing")}>前往发布中心 →</button></div>
        {jobs.length === 0 ? <EmptyWorkspace title="尚未开始发布" description="内容审核通过后，就可以选择渠道并开始发布。" /> : <div className="v11-recent-list">{jobs.slice(0, 5).map((job) => <button key={job.id} onClick={() => onNavigate("publishing")}><div className="platform-avatar">{platformLabel(job.platformKey).slice(0, 1)}</div><div><strong>{articleById.get(job.articleId)?.title ?? "文章内容"}</strong><span>{platformLabel(job.platformKey)} · {accountById.get(job.accountId)?.name ?? "已选账号"}</span></div><Status label={publishStatusLabel(job.status)} tone={publishStatusTone(job.status)} /></button>)}</div>}
      </section>
    </div>
  </>;
}

export function V11ContentProduction({ refresh, onNavigate }: { refresh: () => void; onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState("");
  const [business, setBusiness] = useState("");
  const [city, setCity] = useState("");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [tasks, setTasks] = useState<ContentStudioTaskView[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const [showBrandSwitcher, setShowBrandSwitcher] = useState(false);
  const finalised = useRef(new Set<string>());
  const selectedBrand = brands.find((brand) => brand.id === brandId);
  const businessOptions = splitEnterpriseList(selectedBrand?.mainBusiness ?? "");
  const regionOptions = selectedBrand?.serviceRegions ?? [];
  const enabledKnowledge = selectedBrand?.knowledgeEntries?.filter((entry) => entry.enabled) ?? [];
  const profileComplete = Boolean(selectedBrand?.description.trim() && businessOptions.length > 0);
  const previewSnapshot = selectedBrand ? selectRelevantBrandFacts(selectedBrand, { business, city, keyword, topic: `${city}${keyword}` }) : null;

  useEffect(() => { void window.publisherAPI.brands.list().then((items) => { setBrands(items); const first = items[0]; if (first) { setBrandId(first.id); setBusiness(splitEnterpriseList(first.mainBusiness)[0] ?? ""); setCity(first.serviceRegions[0] ?? ""); } }); }, []);
  useEffect(() => {
    if (taskIds.length === 0) return;
    const poll = (): void => {
      void Promise.all(taskIds.map((id) => window.publisherAPI.contentStudio.task(id))).then((next) => {
        const current = next.filter((task): task is ContentStudioTaskView => task !== null);
        setTasks(current);
        current.filter((task) => ["completed", "partial"].includes(task.status) && task.sourceArticleId && !finalised.current.has(task.id)).forEach((task) => {
          finalised.current.add(task.id);
          void Promise.all([
            window.publisherAPI.articles.attachRecommendedImage({ articleId: task.sourceArticleId as string, platformKey: "zhihu" }),
            window.publisherAPI.quality.recheck("article", task.sourceArticleId as string)
          ]).then(() => refresh()).catch(() => refresh());
        });
      });
    };
    poll(); const timer = window.setInterval(poll, 1000); return () => window.clearInterval(timer);
  }, [refresh, taskIds]);

  const start = async (): Promise<void> => {
    if (!brandId || !business.trim() || !city.trim() || !keyword.trim()) return;
    setBusy(true); setMessage("正在准备企业资料…"); finalised.current.clear();
    try {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const topic = count === 1 ? `${city}${keyword}` : `${city}${keyword} · 内容角度 ${index + 1}`;
        ids.push(await window.publisherAPI.contentStudio.start({ brandId, industry: selectedBrand?.industry?.trim() || business.trim(), cities: [city.trim()], keywords: [keyword.trim()], targetPlatforms: ["zhihu"], mediaAssetIds: [], videoAssetIds: [], concurrency: 1, business: business.trim(), city: city.trim(), keyword: keyword.trim(), topic, contentGoal: "BrandPromotion", promotionStrength: "Balanced" }));
      }
      setTaskIds(ids); setMessage("正在生成内容…"); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "内容生成未能启动"); }
    finally { setBusy(false); }
  };
  const completed = tasks.filter((task) => ["completed", "partial"].includes(task.status)).length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const progressText = taskIds.length === 0 ? "准备企业资料" : completed === taskIds.length ? "已完成内容生成、图片匹配和内容检查" : tasks.some((task) => task.completed > 0) ? "正在匹配图片并检查内容" : "正在生成内容";
  return <>
    <WorkspaceTitle eyebrow="内容生产" title="把企业资料变成可发布内容" description="填写业务和城市，系统会生成文章、匹配图片并完成内容检查。" />
    {selectedBrand && <section className="panel current-enterprise-card"><div className="current-enterprise-heading"><div><span className="eyebrow">当前企业</span><h3>{selectedBrand.companyName || selectedBrand.name}</h3></div><div className="current-enterprise-actions"><button className="secondary-button" onClick={() => onNavigate("brand")}>编辑企业资料</button><button className="secondary-button" onClick={() => onNavigate("knowledge")}>管理企业知识库</button>{brands.length > 1 && <button className="text-button" onClick={() => setShowBrandSwitcher((value) => !value)}>切换企业</button>}</div></div><div className="current-enterprise-meta"><span>企业资料：<strong>{profileComplete ? "已完善" : "待完善"}</strong></span><span>知识资料：<strong>{enabledKnowledge.length} 条</strong></span><span>最近更新：<strong>{formatWorkspaceDate(latestEnterpriseUpdate(selectedBrand))}</strong></span></div>{showBrandSwitcher && brands.length > 1 && <label className="enterprise-switcher">选择企业<select value={brandId} onChange={(event) => { const next = brands.find((brand) => brand.id === event.target.value); setBrandId(event.target.value); setShowFacts(false); if (next) { setBusiness(splitEnterpriseList(next.mainBusiness)[0] ?? ""); setCity(next.serviceRegions[0] ?? ""); } }}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.companyName || brand.name}</option>)}</select></label>}<button className="text-button facts-preview-button" onClick={() => setShowFacts((value) => !value)}>{showFacts ? "收起将使用的资料" : "查看将使用的资料"}</button>{showFacts && previewSnapshot && <div className="enterprise-facts-preview"><strong>本次生成匹配到的企业事实摘要</strong>{previewSnapshot.facts.length === 0 ? <span>当前没有可匹配的企业事实。</span> : previewSnapshot.facts.map((fact) => <span key={fact.id}>{fact.label}：{fact.content}</span>)}</div>}</section>}
    {selectedBrand && !profileComplete && <div className="notice enterprise-profile-warning"><div><strong>当前企业资料较少，AI生成内容可能偏通用。</strong><span>可以继续生成，也可以先补充企业介绍和主营业务。</span></div><button className="secondary-button" onClick={() => onNavigate("brand")}>完善企业资料</button></div>}
    <div className="v11-production-layout"><section className="panel form-panel v11-production-form"><div className="panel-heading"><div><h3>生成一批内容</h3><span>默认只需要这五项信息。</span></div></div>
      <label>企业资料<select value={brandId} onChange={(event) => { const next = brands.find((brand) => brand.id === event.target.value); setBrandId(event.target.value); if (next) { setBusiness(splitEnterpriseList(next.mainBusiness)[0] ?? ""); setCity(next.serviceRegions[0] ?? ""); } }}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.companyName || brand.name}</option>)}</select></label>
      <div className="two-fields"><label>业务<select value={business} onChange={(event) => setBusiness(event.target.value)}><option value="">请选择业务</option>{businessOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label>区域 / 城市<select value={city} onChange={(event) => setCity(event.target.value)}><option value="">请选择地区</option>{regionOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label></div>
      <div className="two-fields"><label>关键词<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例如：新房除甲醛" /></label><label>生成数量<input type="number" min="1" max="10" value={count} onChange={(event) => setCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label></div>
      <button className="text-button v11-advanced-toggle" onClick={() => setAdvanced((value) => !value)}>{advanced ? "收起高级选项" : "高级选项"}</button>
      {advanced && <div className="v11-advanced-inline"><strong>内容设置</strong><span>默认按企业推广场景生成，并为后续发布准备一份图文内容。图片将优先匹配业务、城市和关键词。</span></div>}
      <button className="primary-button wide" disabled={busy || !brandId || !business.trim() || !city.trim() || !keyword.trim()} onClick={() => void start()}>{busy ? "正在创建内容…" : "开始生成"}</button>
    </section>
    <section className="panel v11-production-progress"><div className="panel-heading"><div><h3>本次进度</h3><span>{progressText}</span></div></div><div className="v11-process-steps"><span className={taskIds.length ? "done" : "active"}>1. 准备企业资料</span><span className={tasks.length ? "done" : ""}>2. 生成文章</span><span className={tasks.some((task) => task.completed > 0) ? "done" : ""}>3. 匹配图片</span><span className={completed ? "done" : ""}>4. 内容检查</span></div>
      {taskIds.length === 0 ? <EmptyWorkspace title="等待开始生成" description="系统会使用已保存的企业资料，避免无关内容和无关图片。" /> : <><div className="v11-progress-number"><strong>{completed + failed} / {taskIds.length}</strong><span>已完成</span></div><div className="progress-track"><span style={{ width: `${taskIds.length ? ((completed + failed) / taskIds.length) * 100 : 0}%` }} /></div><div className="progress-meta"><span>已生成 {completed}</span><span>未完成 {failed}</span></div>{completed === taskIds.length && <div className="v11-success-actions"><strong>已生成 {completed} 篇内容</strong><div><button className="secondary-button" onClick={() => onNavigate("articles")}>查看文章</button><button className="primary-button" onClick={() => { setTaskIds([]); setTasks([]); setKeyword(""); }}>继续生成</button></div></div>}</>}</section></div>
    {message && <div className="notice success">{message}</div>}
    {selectedBrand && <div className="v11-production-note">当前将使用：{selectedBrand.companyName || selectedBrand.name} · {business || "未填写业务"} · {city || "未填写城市"}</div>}
  </>;
}

export function V11ArticleLibrary({ refresh, refreshKey, onNavigate }: { refresh: () => void; refreshKey: number; onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const [articles, setArticles] = useState<Article[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [importBrandId, setImportBrandId] = useState("");
  const [quality, setQuality] = useState<QualityStatusByArticle>({});
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [detail, setDetail] = useState<{ article: Article; editable: boolean } | null>(null);
  const [reviewArticle, setReviewArticle] = useState<Article | null>(null);
  const [publishArticle, setPublishArticle] = useState<Article | null>(null);
  const [preview, setPreview] = useState<ExcelImportPreview | null>(null);
  const [reviewMode, setReviewMode] = useState<ContentReviewMode>("WarningOnly");
  const load = useCallback((): void => { void window.publisherAPI.articles.list({ search: search || undefined }).then(async (items) => { const visible = items.filter(isProductionArticle); const states = await Promise.all(visible.map((article) => window.publisherAPI.quality.status("article", article.id))); setArticles(visible); setQuality(Object.fromEntries(visible.map((article, index) => [article.id, states[index]?.status ?? "Draft"]))); }); }, [search]);
  useEffect(load, [load, refreshKey]);
  useEffect(() => { void window.publisherAPI.brands.list().then((items) => { setBrands(items); setImportBrandId((current) => current || items[0]?.id || ""); }); }, [refreshKey]);
  useEffect(() => { void window.publisherAPI.settings.get().then((settings) => setReviewMode(normalizeContentReviewMode(settings.contentReviewMode))); }, [refreshKey]);
  const importExcel = async (): Promise<void> => { try { const next = await window.publisherAPI.articles.importExcel(importBrandId || null); if (next) setPreview(next); } catch (error) { setNotice(error instanceof Error ? error.message : "Excel 文件读取失败"); } };
  const download = async (kind: "simple" | "advanced"): Promise<void> => { const result = kind === "simple" ? await window.publisherAPI.articles.downloadSimpleTemplate() : await window.publisherAPI.articles.downloadAdvancedTemplate(); if (result) setNotice(`${kind === "simple" ? "简易" : "高级"}模板已保存：${result.fileName}`); };
  return <>
    <WorkspaceTitle eyebrow="文章库" title="管理可发布的文章" description={`默认只显示日常运营内容；当前内容审核模式：${contentReviewModeLabel(reviewMode)}。`} action={<div className="row-actions v114-import-actions">{brands.length > 0 && <label>导入到企业<select value={importBrandId} onChange={(event) => setImportBrandId(event.target.value)}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.companyName || brand.name} · {brand.id.slice(0, 8)}</option>)}</select></label>}<button className="secondary-button" onClick={() => void download("simple")}>下载模板</button><button className="primary-button" disabled={!importBrandId} onClick={() => void importExcel()}>Excel 导入</button></div>} />
    {notice && <div className="notice success">{notice}</div>}
    <div className="toolbar panel v11-toolbar"><div className="search-box">⌕<input placeholder="搜索标题、业务或城市" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="text-button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "收起高级筛选" : "高级筛选"}</button>{advanced && <div className="v11-toolbar-advanced"><span>高级来源筛选仅用于查看非运营内容。</span><button className="mini-button" onClick={() => onNavigate("advanced")}>打开高级功能</button><button className="mini-button" onClick={() => void download("advanced")}>下载高级模板</button></div>}</div>
    <section className="panel table-panel"><div className="table-summary"><span>共 {articles.length} 篇运营文章</span><button className="text-button" onClick={() => onNavigate("production")}>生成新内容 →</button></div>
      {articles.length === 0 ? <EmptyWorkspace title="暂无文章" description="可以下载简易模板（标题、内容）导入，或立即生成内容。" action={<button className="secondary-button" onClick={() => onNavigate("production")}>开始生成</button>} /> : <div className="data-table v11-article-table"><div className="table-head v11-article-head"><span>文章</span><span>业务 / 城市</span><span>发布状态</span><span>发布渠道</span><span>更新时间</span><span>操作</span></div>{articles.map((article) => { const simpleStatus = articleListStatusLabel(article, quality[article.id], reviewMode); return <div className="table-row v11-article-row" key={article.id}><div className="article-title"><div className="cover-thumb">{article.coverAssetId ? "▧" : "—"}</div><div><strong>{article.title}</strong><span>{article.keyword || "未设置关键词"}</span></div></div><span>{article.business || "未填写业务"}<small>{article.city || "未填写城市"}</small></span><Status label={simpleStatus} tone={simpleStatus === "已发布" || simpleStatus === "可发布" ? "success" : simpleStatus === "有提醒" ? "warning" : "danger"} /><span>{article.targetPlatforms?.map(platformLabel).join("、") || "暂未选择"}</span><span>{new Date(article.updatedAt).toLocaleDateString("zh-CN")}</span><div className="row-actions"><button className="mini-button" onClick={() => setDetail({ article, editable: false })}>查看</button><button className="mini-button" onClick={() => setDetail({ article, editable: true })}>修改</button><button className="mini-button" onClick={() => setReviewArticle(article)}>审核详情</button><button className="mini-button" onClick={() => setPublishArticle(article)}>发布</button></div></div>; })}</div>}
    </section>
    {detail && <ArticleEditor article={detail.article} editable={detail.editable} onClose={() => setDetail(null)} onSaved={() => { setDetail(null); load(); refresh(); }} />}
    {reviewArticle && <ArticleReview article={reviewArticle} onClose={() => setReviewArticle(null)} onChanged={() => { setReviewArticle(null); load(); refresh(); }} />}
    {publishArticle && <V11PublishModal initialArticle={publishArticle} onClose={() => setPublishArticle(null)} onDone={() => { load(); refresh(); }} onNavigate={onNavigate} />}
    {preview && <ExcelImportDialog preview={preview} onClose={() => setPreview(null)} onDone={() => { setPreview(null); load(); refresh(); }} />}
  </>;
}

function ArticleEditor({ article, editable, onClose, onSaved }: { article: Article; editable: boolean; onClose: () => void; onSaved: () => void }): JSX.Element {
  const [title, setTitle] = useState(article.title); const [body, setBody] = useState(article.body); const [tagsText, setTagsText] = useState(article.tags.join("\n")); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const save = async (): Promise<void> => { setBusy(true); setMessage(""); try { await window.publisherAPI.articles.update(article.id, { title, body, tags: splitLabels(tagsText) }); onSaved(); } catch (error) { setMessage(error instanceof Error ? error.message : "文章保存失败"); } finally { setBusy(false); } };
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer v11-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">文章内容</span><h2>{editable ? "修改文章" : "查看文章"}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><label>标题<input value={title} readOnly={!editable} onChange={(event) => setTitle(event.target.value)} /></label><label>内容<textarea rows={16} value={body} readOnly={!editable} onChange={(event) => setBody(event.target.value)} /></label><label>标签（每行一个；留空即清空）<textarea rows={3} value={tagsText} readOnly={!editable} onChange={(event) => setTagsText(event.target.value)} /></label>{message && <div className="notice error">{message}</div>}<div className="drawer-footer"><button className="secondary-button" onClick={onClose}>{editable ? "取消" : "关闭"}</button>{editable && <button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存修改"}</button>}</div></aside></div>;
}

function ArticleReview({ article, onClose, onChanged }: { article: Article; onClose: () => void; onChanged: () => void }): JSX.Element {
  const [status, setStatus] = useState("Draft"); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback((): void => { void window.publisherAPI.quality.status("article", article.id).then((state) => setStatus(state?.status ?? "Draft")); }, [article.id]);
  useEffect(load, [load]);
  const check = async (): Promise<void> => { setBusy(true); try { await window.publisherAPI.quality.recheck("article", article.id); await window.publisherAPI.quality.status("article", article.id).then((state) => setStatus(state?.status ?? "Draft")); setMessage("已完成内容检查，请确认是否通过。"); } catch (error) { setMessage(error instanceof Error ? error.message : "内容检查失败"); } finally { setBusy(false); } };
  const decide = async (next: "Approved" | "Rejected"): Promise<void> => { setBusy(true); try { await window.publisherAPI.quality.decide("article", article.id, next, next === "Approved" ? "运营审核通过" : "运营审核未通过"); onChanged(); } catch (error) { setMessage(error instanceof Error ? error.message : "审核结果保存失败"); } finally { setBusy(false); } };
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer v11-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">内容审核</span><h2>{article.title}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="v11-review-status"><span>当前状态</span><Status label={articleReviewLabel(status)} tone={articleReviewTone(status)} /></div><p className="v11-review-copy">确认标题、内容和企业表达无误后，再允许这篇文章进入发布。</p>{message && <div className="notice">{message}</div>}<div className="v11-review-actions"><button className="secondary-button" disabled={busy} onClick={() => void check()}>{busy ? "检查中…" : "重新检查"}</button><button className="secondary-button" disabled={busy} onClick={() => void decide("Rejected")}>需要修改</button><button className="primary-button" disabled={busy} onClick={() => void decide("Approved")}>审核通过</button></div></aside></div>;
}

function ExcelImportDialog({ preview, onClose, onDone }: { preview: ExcelImportPreview; onClose: () => void; onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [filter, setFilter] = useState<"ALL" | "VALID" | "DUPLICATE" | "ERROR" | "WARNING">("ALL");
  const confirm = async (): Promise<void> => { setBusy(true); try { const result = await window.publisherAPI.articles.confirmExcelImport(preview); setMessage(`已导入 ${result.imported} 篇文章${result.skippedDuplicates ? `，跳过 ${result.skippedDuplicates} 篇重复内容` : ""}`); onDone(); } catch (error) { setMessage(error instanceof Error ? error.message : "导入未完成"); } finally { setBusy(false); } };
  const filteredRows = preview.rows.filter((row) => filter === "ALL" || row.status === filter || (filter === "ERROR" && ["INVALID", "UNKNOWN_BRAND"].includes(row.status)));
  const exportErrors = async (): Promise<void> => { const path = await window.publisherAPI.articles.exportExcelErrors(preview); if (path) setMessage(`错误报告已导出：${path}`); };
  const statusView = (status: (typeof preview.rows)[number]["status"]): { icon: string; label: string; tone: string } => {
    if (status === "VALID") return { icon: "✓", label: "可导入", tone: "success" };
    if (status === "DUPLICATE") return { icon: "⚠", label: "重复", tone: "warning" };
    if (status === "WARNING") return { icon: "⚠", label: "警告", tone: "warning" };
    return { icon: "✕", label: "错误", tone: "danger" };
  };
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer v11-drawer v114-import-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">Excel 导入</span><h2>确认导入文章</h2><small>{preview.selectedSheetName ? `工作表：${preview.selectedSheetName}` : "未识别到可导入工作表"}</small></div><button className="icon-button" onClick={onClose}>×</button></div><div className="v11-import-summary v114-import-summary"><button className={filter === "ALL" ? "active" : ""} onClick={() => setFilter("ALL")}><span>总计</span><strong>{preview.totalRows}</strong></button><button className={filter === "VALID" ? "active" : ""} onClick={() => setFilter("VALID")}><span>可导入</span><strong>{preview.validRows}</strong></button><button className={filter === "DUPLICATE" ? "active" : ""} onClick={() => setFilter("DUPLICATE")}><span>重复</span><strong>{preview.duplicateRows}</strong></button><button className={filter === "ERROR" ? "active" : ""} onClick={() => setFilter("ERROR")}><span>错误</span><strong>{preview.errorRows}</strong></button><button className={filter === "WARNING" ? "active" : ""} onClick={() => setFilter("WARNING")}><span>警告</span><strong>{preview.warningRows}</strong></button></div><p className="v11-review-copy">简易模式唯一必填项是“标题”和“内容”。导入只会进入文章库，不会自动创建发布任务。</p>{preview.diagnostics.length > 0 && <div className="v114-workbook-diagnostics">{preview.diagnostics.map((diagnostic, index) => <div className={`notice ${diagnostic.severity === "ERROR" ? "error" : "warning"}`} key={`${diagnostic.code}-${diagnostic.rowNumber ?? "workbook"}-${index}`}><strong>{diagnostic.code}</strong><span>{diagnostic.message}</span></div>)}</div>}<div className="v114-import-rows">{filteredRows.length === 0 ? <div className="empty-state compact"><strong>该分类没有数据</strong></div> : filteredRows.map((row) => { const view = statusView(row.status); return <div className={`v114-import-row ${view.tone}`} key={row.rowNumber}><span className="v114-row-number">第 {row.rowNumber} 行</span><span className="v114-row-status">{view.icon} {view.label}</span><div><strong>{row.title || "（无标题）"}</strong><small>{row.status === "VALID" ? "可导入" : row.errorReason || row.diagnosticCodes.join("；")}</small></div>{row.diagnosticCodes.length > 0 && <code>{row.diagnosticCodes.join(" · ")}</code>}</div>; })}</div>{message && <div className="notice success">{message}</div>}<div className="drawer-footer"><button className="secondary-button" disabled={preview.errorRows + preview.duplicateRows + preview.warningRows + preview.diagnostics.length === 0} onClick={() => void exportErrors()}>导出错误报告</button><span className="drawer-spacer" /><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || preview.validRows === 0 || preview.requiresSheetSelection} onClick={() => void confirm()}>{busy ? "导入中…" : `确认导入 ${preview.validRows} 篇`}</button></div></aside></div>;
}

function TagPicker({ title, options, selected, onToggle }: { title: string; options: string[]; selected: string[]; onToggle: (value: string) => void }): JSX.Element {
  return <div className="v111-tag-group"><strong>{title}</strong><div className="chip-select">{options.map((option) => <button type="button" className={`choice-chip ${selected.includes(option) ? "selected" : ""}`} key={option} onClick={() => onToggle(option)}>{option}</button>)}</div></div>;
}

export function V11ImageLibrary({ refresh, refreshKey }: { refresh: () => void; refreshKey: number }): JSX.Element {
  const [brands, setBrands] = useState<Brand[]>([]); const [brandId, setBrandId] = useState(""); const [assets, setAssets] = useState<ImageAsset[]>([]); const [files, setFiles] = useState<string[]>([]); const [filter, setFilter] = useState("全部"); const [name, setName] = useState(""); const [business, setBusiness] = useState<string[]>([]); const [city, setCity] = useState<string[]>([]); const [usage, setUsage] = useState<string[]>(["通用"]); const [customTags, setCustomTags] = useState<string[]>([]); const [customInput, setCustomInput] = useState(""); const [editingAssetId, setEditingAssetId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const load = useCallback((id = brandId): void => { void window.publisherAPI.imageAssets.list({ brandId: id || undefined }).then(setAssets); }, [brandId]);
  useEffect(() => { void window.publisherAPI.brands.list().then((items) => { setBrands(items); const id = items[0]?.id ?? ""; setBrandId(id); load(id); }); }, [load, refreshKey]);
  const resetEditor = (): void => { setFiles([]); setName(""); setBusiness([]); setCity([]); setUsage(["通用"]); setCustomTags([]); setCustomInput(""); setEditingAssetId(null); };
  const pick = async (): Promise<void> => { const selected = await window.publisherAPI.imageAssets.pickFiles(); if (selected.length) { resetEditor(); setFiles(selected); setName(selected.length === 1 ? (selected[0]?.split(/[\\/]/u).pop()?.replace(/\.[^.]+$/u, "") ?? "") : "批量图片"); } };
  const edit = (asset: ImageAsset): void => { setFiles([]); setEditingAssetId(asset.id); setName(asset.name); setBusiness(asset.business); setCity(asset.city); setUsage(asset.usage.length ? asset.usage : asset.tags.filter((tag) => usageTagDefaults.includes(tag))); setCustomTags(asset.tags.filter((tag) => !usageTagDefaults.includes(tag))); setCustomInput(""); };
  const save = async (): Promise<void> => { if (!brandId || (!files.length && !editingAssetId)) return; setBusy(true); try { if (editingAssetId) { await window.publisherAPI.imageAssets.update(editingAssetId, { name, tags: customTags, business, city, usage, universal: usage.includes("通用") }); setMessage("图片标签已保存，以后可继续选择这些自定义标签。"); } else { const imported = await window.publisherAPI.imageAssets.import({ brandId, sourcePaths: files, name: name.trim() || undefined, tags: customTags, business, city, usage, platform: [], universal: usage.includes("通用") }); setMessage(`已上传并保存 ${imported.length} 张图片`); } resetEditor(); load(); refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "图片保存失败"); } finally { setBusy(false); } };
  const toggle = async (asset: ImageAsset): Promise<void> => { await window.publisherAPI.imageAssets.update(asset.id, { enabled: !asset.enabled }); load(); };
  const remove = async (asset: ImageAsset): Promise<void> => { if (!window.confirm(`确定删除“${asset.name}”吗？`)) return; await window.publisherAPI.imageAssets.delete(asset.id); load(); refresh(); };
  const toggleTag = (setter: Dispatch<SetStateAction<string[]>>, value: string): void => setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const addCustomTag = (): void => { const values = splitLabels(customInput); if (!values.length) return; setCustomTags((current) => [...new Set([...current, ...values])]); setCustomInput(""); };
  const businessOptions = [...new Set([...businessTagDefaults, ...assets.flatMap((asset) => asset.business)])];
  const cityOptions = [...new Set([...cityTagDefaults, ...assets.flatMap((asset) => asset.city)])];
  const usageOptions = [...new Set([...usageTagDefaults, ...assets.flatMap((asset) => asset.usage)])];
  const customOptions = [...new Set(assets.flatMap((asset) => asset.tags).filter((tag) => !usageTagDefaults.includes(tag)))];
  const shown = assets.filter((asset) => filter === "全部" || (filter === "通用" ? asset.universal || asset.usage.includes("通用") || asset.tags.includes("通用") : asset.usage.includes(filter) || asset.tags.includes(filter)));
  const editorAsset = editingAssetId ? assets.find((asset) => asset.id === editingAssetId) ?? null : null;
  const rawPreview = files[0] ? `file:///${encodeURI(files[0].replace(/\\/gu, "/"))}` : "";
  return <>
    <WorkspaceTitle eyebrow="图片库" title="让文章使用相关图片" description="上传后直接在编辑卡片里点选业务、地区和用途；再次点击即可取消，支持多选。" action={<button className="primary-button" onClick={() => void pick()}>上传图片</button>} />
    {message && <div className="notice success">{message}</div>}
    <section className="panel v11-image-upload"><div className="v11-image-upload-main"><label>企业<select value={brandId} onChange={(event) => { setBrandId(event.target.value); load(event.target.value); }}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.companyName || brand.name}</option>)}</select></label><span>已入库 {assets.length} 张图片</span></div></section>
    {(files.length > 0 || editorAsset) && <section className="panel v111-image-editor"><div className="v111-image-editor-preview">{editorAsset?.previewUrl || rawPreview ? <img src={editorAsset?.previewUrl || rawPreview} alt={name || "图片预览"} /> : <span>▧</span>}</div><div className="v111-image-editor-fields"><div className="panel-heading"><div><h3>{editorAsset ? "编辑图片标签" : `编辑待上传图片${files.length > 1 ? `（${files.length} 张）` : ""}`}</h3><span>不需要编辑 JSON；点击标签即可选择或取消。</span></div></div><label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="图片名称" /></label><TagPicker title="业务" options={businessOptions} selected={business} onToggle={(value) => toggleTag(setBusiness, value)} /><TagPicker title="地区" options={cityOptions} selected={city} onToggle={(value) => toggleTag(setCity, value)} /><TagPicker title="用途" options={usageOptions} selected={usage} onToggle={(value) => toggleTag(setUsage, value)} />{customOptions.length > 0 && <TagPicker title="自定义标签" options={customOptions} selected={customTags} onToggle={(value) => toggleTag(setCustomTags, value)} />}<div className="v111-custom-tag"><input value={customInput} onChange={(event) => setCustomInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomTag(); } }} placeholder="办公室、酒店、学校、新房、工厂" /><button className="secondary-button" type="button" onClick={addCustomTag}>+ 添加标签</button></div>{customTags.length > 0 && <div className="chip-select">{customTags.map((tag) => <button type="button" className="choice-chip selected" key={tag} onClick={() => toggleTag(setCustomTags, tag)}>{tag} ×</button>)}</div>}<div className="row-actions"><button className="secondary-button" onClick={resetEditor}>取消</button><button className="primary-button" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button></div></div></section>}
    <div className="v11-category-tabs">{imageCategories.map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {shown.length === 0 ? <section className="panel"><EmptyWorkspace title="图片库还是空的" description="先上传治理现场、检测设备或办公环境等企业图片。" action={<button className="secondary-button" onClick={() => void pick()}>选择图片</button>} /></section> : <section className="image-asset-grid v11-image-grid">{shown.map((asset) => <article className={`image-asset-card ${asset.enabled ? "" : "disabled"}`} key={asset.id}><div className="image-preview">{asset.previewUrl ? <img src={asset.previewUrl} alt={asset.name} /> : <span>▧</span>}</div><div className="image-asset-body"><strong>{asset.name}</strong><span>{[...asset.business, ...asset.city, ...asset.usage].slice(0, 4).join(" · ") || (asset.universal ? "通用图片" : "企业图片")}</span><small>{asset.useCount} 次用于文章 · {asset.enabled ? "可使用" : "已停用"}</small></div><div className="row-actions"><button className="mini-button" onClick={() => edit(asset)}>编辑</button><button className="mini-button" onClick={() => void toggle(asset)}>{asset.enabled ? "停用" : "启用"}</button><button className="mini-button danger-mini" onClick={() => void remove(asset)}>删除</button></div></article>)}</section>}
  </>;
}

export function V11AccountsCenter({ refresh, refreshKey, onNavigate }: { refresh: () => void; refreshKey: number; onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<AccountManagementRow[]>([]); const [platforms, setPlatforms] = useState<Platform[]>([]); const [tab, setTab] = useState<"connected" | "available" | "all">("all"); const [search, setSearch] = useState(""); const [favorites, setFavorites] = useState<string[]>([]); const [message, setMessage] = useState(""); const [loadError, setLoadError] = useState(""); const [busy, setBusy] = useState(""); const [controlledResults, setControlledResults] = useState<Record<string, ControlledPostUploadDiscoveryResult>>({}); const [explorationResults, setExplorationResults] = useState<Record<string, PublishFlowExplorationResult>>({}); const controlledEntryGuard = useRef(new ControlledSelfTestEntryGuard()).current; const [detailsKey, setDetailsKey] = useState<string | null>(null); const [pendingLogin, setPendingLogin] = useState<{ accountId: string; platformKey: string } | null>(null); const [loginSucceeded, setLoginSucceeded] = useState(false); const [loginHint, setLoginHint] = useState("");
  const [oneShotConfirmRun, setOneShotConfirmRun] = useState<PlatformSelfTestRun | null>(null);
  const [oneShotConfirmationError, setOneShotConfirmationError] = useState("");
  const oneShotConfirmationGuard = useRef(new OneShotConfirmationUiGuard()).current;
  const load = useCallback((): void => {
    setLoading(true);
    void loadAccountCenterData({ overview: () => window.publisherAPI.accounts.overview(), platforms: () => window.publisherAPI.platforms.list(), settings: () => window.publisherAPI.settings.get() }).then(({ overview: nextOverview, platforms: nextPlatforms, favoritePlatformKeys, errors }) => {
      setOverview(nextOverview);
      setPlatforms(nextPlatforms);
      setFavorites(favoritePlatformKeys);
      setLoading(false);
      setLoadError(errors.length > 0 ? "账号中心部分数据暂时未加载，已保留可用数据；请点击“重试”。" : "");
    }).catch(() => {
      setLoadError("账号中心暂时无法加载，请点击“重试”。");
      setLoading(false);
    });
  }, []);
  useEffect(load, [load, refreshKey]);
  const rowsFor = (platformKey: string): AccountManagementRow[] => overview.filter((row) => row.account.platformKey === platformKey);
  const beginAccountLogin = async (platformKey: string, intent: "connect" | "add" | "relogin", selectedAccountId?: string): Promise<void> => {
    const displayName = platforms.find((platform) => platform.platformKey === platformKey)?.displayName ?? platformLabel(platformKey);
    if (platformKey === "cnblogs") { setDetailsKey("cnblogs"); return; }
    setBusy(selectedAccountId ?? `${platformKey}:${intent}`); setLoginSucceeded(false); setLoginHint("");
    try {
      const rows = rowsFor(platformKey);
      const target = selectedAccountId ? { accountId: selectedAccountId, createAccount: false } : accountConnectionTarget(rows, intent);
      let account = target.accountId ? overview.find((item) => item.account.id === target.accountId && item.account.platformKey === platformKey)?.account : undefined;
      if (selectedAccountId && !account) throw new Error("未找到指定的平台账号，已拒绝替换或回退到其他账号");
      if (!account && target.createAccount) {
        const alias = platformKey === "lieju" ? `列举网-${String(rows.length + 1).padStart(2, "0")}` : `${displayName}账号 ${rows.length + 1}`;
        account = await window.publisherAPI.accounts.create({ platformKey, name: alias, accountAlias: alias, publishMode: "assisted" });
      }
      if (!account) throw new Error("未选择可连接的账号");
      const result = await window.publisherAPI.accounts.beginLogin(account.id, platformKey);
      if (!result.opened) throw new Error(result.message || `暂时无法打开${displayName}登录页`);
      setPendingLogin({ accountId: account.id, platformKey });
      if (platformKey === "lieju") setDetailsKey(platformKey);
      setMessage(`已打开${displayName}官方登录页。`);
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法开始连接，请稍后重试"); }
    finally { setBusy(""); }
  };
  const runAccountSelfTest = async (row: AccountManagementRow): Promise<void> => {
    const accountId = row.account.id;
    setBusy(accountId);
    try {
      const run = await window.publisherAPI.platformSelfTest.runSafe(accountId);
      setMessage(`${row.account.accountAlias || row.account.name} 自测结果：${run.overallResult}；已携带明确账号 ID。`);
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "平台自测失败"); }
    finally { setBusy(""); }
  };
  const runControlledPostUploadDiscovery = async (row: AccountManagementRow, platform: Platform): Promise<void> => {
    const accountId = row.account.id;
    const connected = isOnlineAccount({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState });
    if (!supportsControlledPostUploadDiscovery(platform, row.account) || !connected || !controlledEntryGuard.tryAcquire(accountId)) return;
    try {
      if (!window.confirm(CONTROLLED_SELF_TEST_CONFIRMATION)) return;
      const request = buildControlledSelfTestRequest({ account: row.account, platform, connected, busy: false, confirmed: true });
      if (!request) return;
      setBusy(`${accountId}:controlled-upload`); setMessage("");
      const result = await window.publisherAPI.platformSelfTest.runPostUploadDiscovery(request);
      setControlledResults((current) => ({ ...current, [accountId]: result }));
      setMessage(controlledSelfTestResultMessage(result));
    } catch (error) { setMessage(error instanceof Error ? error.message : "受控首次上传后发现失败"); }
    finally { controlledEntryGuard.release(accountId); setBusy(""); }
  };
  const runPublishFlowExploration = async (row: AccountManagementRow, platform: Platform): Promise<void> => {
    const accountId = row.account.id;
    const connected = isOnlineAccount({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState });
    if (row.account.platformKey !== "xiaohongshu" || !supportsPublishFlowExploration(platform, row.account) || !connected || busy || !controlledEntryGuard.tryAcquire(accountId)) return;
    try {
      if (!window.confirm(PUBLISH_FLOW_EXPLORATION_CONFIRMATION)) return;
      const request = buildPublishFlowExplorationRequest({ account: row.account, platform, connected, busy: false, confirmed: true });
      if (!request) return;
      setBusy(`${accountId}:publish-flow-exploration`); setMessage("");
      const result = await window.publisherAPI.platformSelfTest.runPublishFlowExploration(request);
      setExplorationResults((current) => ({ ...current, [accountId]: result }));
      setMessage(publishFlowExplorationResultMessage(result));
    } catch (error) { setMessage(error instanceof Error ? error.message : "小红书发布流程探索失败"); }
    finally { controlledEntryGuard.release(accountId); setBusy(""); }
  };
  const requestOneShotPublish = async (row: AccountManagementRow, platform: Platform): Promise<void> => {
    const accountId = row.account.id;
    const connected = isOnlineAccount({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState });
    const request = buildOneShotRealPublishRequest({ account: row.account, platform, connected, busy: Boolean(busy), confirmed: true });
    if (!request || busy || !canLaunchOneShotRealPublishFromAccountCard({ account: row.account, platform, connected, busy: Boolean(busy) })) return;
    setBusy(`${accountId}:one-shot-publish`); setMessage("");
    try {
      const images = await window.publisherAPI.imageAssets.list({ enabledOnly: true });
      const image = images.find((item) => item.enabled);
      if (!image) throw new Error("ONE_SHOT_CONTENT_IMAGE_BINDING_REQUIRED");
      const run = await window.publisherAPI.platformSelfTest.requestOneShotPublish(request.platformAccountId, { platformKey: "xiaohongshu", accountId: row.account.id, creatorId: row.account.externalAccountId ?? "", title: "GMP发布验收2｜请忽略", body: "GEO Media Publisher 小红书自动发布最终验收测试。本内容仅用于验证上传、正文回读、发布事务与平台确认流程，请忽略。", imageAssetId: image.id });
      setOneShotConfirmationError("");
      setOneShotConfirmRun(run);
      load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法创建一次性真实发布确认");
    } finally { setBusy(""); }
  };
  const confirmOneShotPublish = async (): Promise<void> => {
    if (!oneShotConfirmRun || !oneShotConfirmationGuard.tryAcquire()) return;
    const testRunId = oneShotConfirmRun.testRunId;
    setBusy(testRunId); setMessage("");
    try {
      const run = await window.publisherAPI.platformSelfTest.confirmOneShotPublish(testRunId);
      setMessage(run.overallResult === "PASSED" ? `一次性测试发布与回查通过：${run.externalUrl ?? "未返回 URL"}` : "一次性真实发布测试已按当前证据停止；只允许一次提交，不会自动重试。");
      setOneShotConfirmationError(""); setOneShotConfirmRun(null); load(); refresh();
    } catch (error) {
      const errorMessage = oneShotConfirmationErrorMessage(error);
      setOneShotConfirmationError(errorMessage); setMessage(errorMessage);
    } finally { oneShotConfirmationGuard.release(); setBusy(""); }
  };
  const cancelOneShotPublish = async (): Promise<void> => {
    if (!oneShotConfirmRun || busy) return;
    try {
      await window.publisherAPI.platformSelfTest.cancelOneShotPublish(oneShotConfirmRun.testRunId);
      setOneShotConfirmRun(null); setMessage("已取消一次性真实发布测试，未生成授权、未创建发布任务。"); load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "取消一次性真实发布测试失败"); }
  };
  const completeLogin = async (): Promise<void> => { if (!pendingLogin) return; setBusy(pendingLogin.accountId); setLoginHint(""); try { const result = await window.publisherAPI.accounts.completeLogin(pendingLogin.accountId, pendingLogin.platformKey, ""); const classification = classifyBrowserLoginResult(result); if (classification === "CONTRACT_MISMATCH") throw new Error("LOGIN_RESULT_CONTRACT_MISMATCH: accounts:complete-login 返回了未知 accountStatus"); if (classification === "NEEDS_USER_ACTION") { setLoginHint("暂未检测到登录成功，请继续在浏览器完成登录。"); return; } beginPostLoginHeartbeat(pendingLogin.accountId, pendingLogin.platformKey); setLoginSucceeded(true); setMessage(""); load(); refresh(); } catch (error) { setLoginHint(error instanceof Error ? error.message : "登录完成检查失败"); } finally { setBusy(""); } };
  const cancelPendingLogin = async (): Promise<void> => { if (!pendingLogin) return; setBusy(pendingLogin.accountId); try { await window.publisherAPI.accounts.cancelLogin(pendingLogin.accountId, pendingLogin.platformKey); } finally { setPendingLogin(null); setLoginSucceeded(false); setLoginHint(""); setBusy(""); load(); } };
  const finishLogin = (): void => { setPendingLogin(null); setLoginSucceeded(false); setLoginHint(""); setDetailsKey(null); load(); };
  const openPlatform = async (platform: Platform, row?: AccountManagementRow): Promise<void> => { setBusy(row?.account.id ?? platform.platformKey); try { if (row && (platform.accountConnectionMode ?? platform.integrationMode) === "BrowserAutomation") await window.publisherAPI.accounts.openBackend(row.account.id, platform.platformKey); else await window.publisherAPI.platforms.open(platform.platformKey); setMessage(`已打开${platform.displayName}官方入口。`); load(); } catch (error) { setMessage(error instanceof Error ? error.message : "平台入口暂时无法打开"); } finally { setBusy(""); } };
  const checkLogin = async (row: AccountManagementRow): Promise<void> => { setBusy(row.account.id); try { const result = await runCheckLoginWithHeartbeats(row.account.id, row.account.platformKey, () => window.publisherAPI.accounts.checkLogin(row.account.id, row.account.platformKey)); setMessage(result.loginStatus === "logged_in" ? `${row.account.accountAlias || row.account.name} 登录有效。` : `${row.account.accountAlias || row.account.name} 需要重新登录或完成验证。`); load(); refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "登录检查失败"); } finally { setBusy(""); } };
  const inspectPublishEditor = async (row: AccountManagementRow): Promise<void> => { setBusy(row.account.id); try { const result = await runPreSubmitGateWithHeartbeats(row.account.id, row.account.platformKey, () => window.publisherAPI.accounts.inspectPublishEditor(row.account.id, row.account.platformKey)); setMessage(result.status === "ready" ? `${row.account.accountAlias || row.account.name} 图文编辑器已通过只读 Gate。` : `${row.account.accountAlias || row.account.name} 图文编辑器 Gate：${result.status}。`); } catch (error) { setMessage(error instanceof Error ? error.message : "图文编辑器 Gate 失败"); } finally { setBusy(""); } };
  const disconnect = async (row: AccountManagementRow): Promise<void> => { if (!window.confirm("移除后会清除此账号的登录状态和本地会话，但不会删除历史发布记录。确定继续吗？")) return; setBusy(row.account.id); try { const result = await window.publisherAPI.accounts.disconnect(row.account.id, row.account.platformKey); setMessage(disconnectFeedbackMessage(result, row.account.accountAlias || row.account.name)); load(); refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "移除失败"); } finally { setBusy(""); } };
  const rename = async (row: AccountManagementRow, alias: string): Promise<void> => { if (!alias.trim()) return; await window.publisherAPI.accounts.update(row.account.id, { accountAlias: alias.trim() }); load(); refresh(); };
  const toggleFavorite = (platformKey: string): void => { const next = favorites.includes(platformKey) ? favorites.filter((key) => key !== platformKey) : [...favorites, platformKey]; setFavorites(next); void window.publisherAPI.settings.update("favoritePlatformKeys", next.join(",")); };
  const accounts = overview.map((row) => ({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState }));
  const ordered = orderPlatformCatalog(platforms, favorites, accounts);
  const catalog = searchOrderedPlatforms(ordered.filter((platform) => { const priority = accountCenterPriority(platform, accounts); if (tab === "connected") return priority === "CONNECTED"; if (tab === "available") return priority === "CONNECTABLE"; return true; }), search);
  return <>
    <WorkspaceTitle eyebrow="账号中心" title="管理全部发布平台" description={loading ? "正在读取平台目录…" : `已连接、可立即连接的平台排在前面；全部 ${platforms.length} 个平台始终可查。`} action={<button className="secondary-button" onClick={() => onNavigate("self-test")}>平台自测</button>} />
    {message && <div className="notice">{message}</div>}
    {loadError && <div className="notice warning"><span>{loadError}</span><button className="mini-button" onClick={load}>重试</button></div>}
    <div className="panel v111-account-toolbar"><div className="v11-category-tabs"><button className={tab === "connected" ? "active" : ""} onClick={() => setTab("connected")}>已连接</button><button className={tab === "available" ? "active" : ""} onClick={() => setTab("available")}>可连接</button><button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>全部平台</button></div><div className="search-box">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索平台" /></div><strong>{loading ? "加载中…" : `${catalog.length} / ${platforms.length}`}</strong></div>
    {favorites.length > 0 && tab === "all" && !search && <div className="v111-favorite-summary"><strong>常用平台</strong><span>{orderPlatformCatalog(platforms.filter((platform) => favorites.includes(platform.platformKey)), favorites, accounts).map((platform) => platform.displayName).join("、")}</span></div>}
    <AccountPlatformGrid catalog={catalog} accounts={accounts} favorites={favorites} busy={busy} controlledResults={controlledResults} explorationResults={explorationResults} rowsFor={rowsFor} onNavigate={onNavigate} onFavorite={toggleFavorite} onDetails={setDetailsKey} beginAccountLogin={beginAccountLogin} runAccountSelfTest={runAccountSelfTest} runControlledPostUploadDiscovery={runControlledPostUploadDiscovery} runPublishFlowExploration={runPublishFlowExploration} requestOneShotPublish={requestOneShotPublish} openPlatform={openPlatform} checkLogin={checkLogin} inspectPublishEditor={inspectPublishEditor} disconnect={disconnect} />
    {detailsKey === "lieju" && <LiejuAccountDrawer rows={rowsFor("lieju")} busy={busy} pendingLogin={pendingLogin?.platformKey === "lieju" ? pendingLogin : null} onClose={() => setDetailsKey(null)} onAdd={() => void beginAccountLogin("lieju", "add")} onOpen={(row) => void openPlatform(platforms.find((item) => item.platformKey === "lieju") as Platform, row)} onCheck={(row) => void checkLogin(row)} onRelogin={(row) => void beginAccountLogin("lieju", "relogin", row.account.id)} onComplete={() => void completeLogin()} onRename={(row, alias) => void rename(row, alias)} onDisconnect={(row) => void disconnect(row)} onPublish={() => onNavigate("publishing")} />}
    {detailsKey === "cnblogs" && <CnblogsAccountDrawer rows={rowsFor("cnblogs")} busy={busy} onClose={() => setDetailsKey(null)} onEnsureAccount={async () => rowsFor("cnblogs")[0]?.account ?? window.publisherAPI.accounts.create({ platformKey: "cnblogs", name: "博客园账号", accountAlias: "博客园账号", publishMode: "assisted" })} onSaved={() => { load(); refresh(); }} onMessage={setMessage} onCheck={(row) => void checkLogin(row)} onPublish={() => onNavigate("publishing")} />}
    {pendingLogin && (pendingLogin.platformKey !== "lieju" || loginSucceeded) && <BrowserLoginLifecycleDialog platformName={platforms.find((item) => item.platformKey === pendingLogin.platformKey)?.displayName ?? platformLabel(pendingLogin.platformKey)} succeeded={loginSucceeded} busy={busy === pendingLogin.accountId} hint={loginHint} onComplete={() => void completeLogin()} onCancel={() => void cancelPendingLogin()} onFinish={finishLogin} />}
    {oneShotConfirmRun && <div className="drawer-backdrop" onClick={() => void cancelOneShotPublish()}><aside className="drawer v11-drawer self-test-confirm" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">Owner 授权的一次性测试</span><h2>确认小红书真实发布</h2></div><button className="icon-button" disabled={Boolean(busy)} onClick={() => void cancelOneShotPublish()}>×</button></div><div className="notice warning"><strong>{ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_CONFIRMATION}</strong><span>仅限指定小红书测试账号；最多提交一次。第一次提交开始后即消费授权，失败或结果不明确也不会重试。</span></div>{oneShotConfirmationError && <div className="notice error" role="alert"><strong>{oneShotConfirmationError}</strong></div>}<section className="panel self-test-content-preview"><strong>GMP发布验收2｜请忽略</strong><p>GEO Media Publisher 小红书自动发布最终验收测试。本内容仅用于验证上传、正文回读、发布事务与平台确认流程，请忽略。</p><small>图片：显式绑定的测试图片</small></section><div className="drawer-footer"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void cancelOneShotPublish()}>取消</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void confirmOneShotPublish()}>{busy === oneShotConfirmRun.testRunId ? "确认中…" : "确认并最多发布一次"}</button></div></aside></div>}
  </>;
}

interface AccountPlatformGridProps {
  catalog: Platform[];
  accounts: Account[];
  favorites: string[];
  busy: string;
  controlledResults: Record<string, ControlledPostUploadDiscoveryResult>;
  explorationResults: Record<string, PublishFlowExplorationResult>;
  rowsFor: (platformKey: string) => AccountManagementRow[];
  onNavigate: (route: V11NavigationTarget) => void;
  onFavorite: (platformKey: string) => void;
  onDetails: (platformKey: string | null) => void;
  beginAccountLogin: (platformKey: string, intent: "connect" | "add" | "relogin", selectedAccountId?: string) => Promise<void>;
  runAccountSelfTest: (row: AccountManagementRow) => Promise<void>;
  runControlledPostUploadDiscovery: (row: AccountManagementRow, platform: Platform) => Promise<void>;
  runPublishFlowExploration: (row: AccountManagementRow, platform: Platform) => Promise<void>;
  requestOneShotPublish: (row: AccountManagementRow, platform: Platform) => Promise<void>;
  openPlatform: (platform: Platform, row?: AccountManagementRow) => Promise<void>;
  checkLogin: (row: AccountManagementRow) => Promise<void>;
  inspectPublishEditor: (row: AccountManagementRow) => Promise<void>;
  disconnect: (row: AccountManagementRow) => Promise<void>;
}

function BrowserAccountRow({ row, platform, busy, controlledResults, explorationResults, runAccountSelfTest, runControlledPostUploadDiscovery, runPublishFlowExploration, requestOneShotPublish, openPlatform, checkLogin, inspectPublishEditor, beginAccountLogin, disconnect }: { row: AccountManagementRow; platform: Platform; busy: string; controlledResults: Record<string, ControlledPostUploadDiscoveryResult>; explorationResults: Record<string, PublishFlowExplorationResult>; runAccountSelfTest: (row: AccountManagementRow) => Promise<void>; runControlledPostUploadDiscovery: (row: AccountManagementRow, platform: Platform) => Promise<void>; runPublishFlowExploration: (row: AccountManagementRow, platform: Platform) => Promise<void>; requestOneShotPublish: (row: AccountManagementRow, platform: Platform) => Promise<void>; openPlatform: (platform: Platform, row?: AccountManagementRow) => Promise<void>; checkLogin: (row: AccountManagementRow) => Promise<void>; inspectPublishEditor: (row: AccountManagementRow) => Promise<void>; beginAccountLogin: (platformKey: string, intent: "connect" | "add" | "relogin", selectedAccountId?: string) => Promise<void>; disconnect: (row: AccountManagementRow) => Promise<void> }): JSX.Element {
  const accountBusy = busy === row.account.id;
  const connected = isOnlineAccount({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState });
  const controlledBusy = busy === `${row.account.id}:controlled-upload`;
  const explorationBusy = busy === `${row.account.id}:publish-flow-exploration`;
  const oneShotBusy = busy === `${row.account.id}:one-shot-publish`;
  const controlledAvailable = supportsControlledPostUploadDiscovery(platform, row.account);
  const explorationAvailable = supportsPublishFlowExploration(platform, row.account);
  const oneShotAvailable = supportsOneShotRealPublishAcceptance(platform, row.account);
  const controlledResult = controlledResults[row.account.id];
  const explorationResult = explorationResults[row.account.id];
  const accountActionBusy = accountBusy || controlledBusy || explorationBusy || oneShotBusy;
  return <div className="v11-browser-account-item"><div><strong>{row.account.accountName || row.providerAccountName || row.account.accountAlias || row.account.name}</strong><span>内部账号 ID：{row.account.id} · {accountStatusLabel({ ...row.account, accountStatus: row.accountStatus })}</span>{controlledResult && <small>首次上传后发现：{controlledResult.status === "PASS" ? "上传后编辑器检查完成" : `安全停止（${controlledResult.failureCode ?? "未知"}）`}</small>}{explorationResult && <small>流程探索：{explorationResult.readyForFinalSubmit ? "最终控件已就绪（未发布）" : `安全停止（${explorationResult.blocker ?? "未知"}）`}</small>}</div><div className="row-actions"><button className="mini-button" disabled={accountActionBusy} onClick={() => void runAccountSelfTest(row)}>自测</button><button className="mini-button" disabled={accountActionBusy || !connected} onClick={() => void openPlatform(platform, row)}>打开后台</button><button className="mini-button" disabled={accountActionBusy} onClick={() => void checkLogin(row)}>检查登录</button>{platform.platformKey === "xiaohongshu" && <button className="mini-button" disabled={accountActionBusy || !connected} onClick={() => void inspectPublishEditor(row)}>检查图文编辑器</button>}{controlledAvailable && <button className="secondary-button" disabled={accountActionBusy || !connected || !row.account.enabled || Boolean(row.account.archivedAt)} onClick={() => void runControlledPostUploadDiscovery(row, platform)}>{controlledBusy ? "检查中…" : "首次上传后发现"}</button>}{explorationAvailable && <button className="secondary-button" disabled={accountActionBusy || !connected || !row.account.enabled || Boolean(row.account.archivedAt)} onClick={() => void runPublishFlowExploration(row, platform)}>{explorationBusy ? "探索中…" : "探索发布流程（不发布）"}</button>}{oneShotAvailable && <button className="secondary-button" disabled={accountActionBusy || !connected} onClick={() => void requestOneShotPublish(row, platform)}>{oneShotBusy ? "准备确认中…" : "一次性真实发布测试"}</button>}<button className="mini-button" disabled={accountActionBusy} onClick={() => void beginAccountLogin(platform.platformKey, "relogin", row.account.id)}>重新登录</button><button className="mini-button danger-mini" disabled={accountActionBusy} onClick={() => void disconnect(row)}>移除</button></div></div>;
}

function AccountPlatformGrid({ catalog, accounts, favorites, busy, controlledResults, explorationResults, rowsFor, onNavigate, onFavorite, onDetails, beginAccountLogin, runAccountSelfTest, runControlledPostUploadDiscovery, runPublishFlowExploration, requestOneShotPublish, openPlatform, checkLogin, inspectPublishEditor, disconnect }: AccountPlatformGridProps): JSX.Element {
  return <section className="v11-account-grid v111-platform-grid">{catalog.map((platform) => {
    const rows = rowsFor(platform.platformKey);
    const connectedRows = rows.filter((row) => isOnlineAccount({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState }));
    const attentionRows = rows.filter((row) => row.accountStatus === "Expired" || row.accountStatus === "NeedsLogin");
    const connected = connectedRows.length > 0;
    const availability = platformAvailability(platform);
    const mode = platform.accountConnectionMode ?? platform.integrationMode;
    const browser = mode === "BrowserAutomation";
    const onlyRow = rows.length === 1 ? rows[0] : null;
    const publishVerification = connectedRows.find((row) => row.publishVerification !== "NotTested")?.publishVerification ?? "NotTested";
    const status = connected ? connectedRows.length > 1 ? `已连接 ${connectedRows.length} 个账号` : "已连接" : rows.some((row) => row.accountStatus === "Unverified") ? "待验证" : availability === "blocked" ? "暂不可用" : availability === "developing" ? "开发中" : accountCenterPriority(platform, accounts) === "CONFIG_REQUIRED" ? "需要配置" : "未连接";
    const capabilityText = connected ? accountCapabilityText(platform, publishVerification) : platformCapabilityText(platform);
    return <article className={`panel v11-account-card ${platform.platformKey === "lieju" || platform.platformKey === "cnblogs" ? "clickable" : ""}`} key={platform.platformKey} onClick={() => (platform.platformKey === "lieju" || platform.platformKey === "cnblogs") && onDetails(platform.platformKey)}>
      <button className={`v111-favorite ${favorites.includes(platform.platformKey) ? "active" : ""}`} title="设为常用" onClick={(event) => { event.stopPropagation(); onFavorite(platform.platformKey); }}>★</button>
      <div className="v11-account-head"><div className="platform-avatar">{platform.displayName.slice(0, 1)}</div><div><strong>{platform.displayName}</strong><span>{capabilityText}</span><small className="v11-connection-mode">连接方式：{platformConnectionModeLabel(platform)}</small></div><Status label={status} tone={connected ? "success" : availability === "blocked" || availability === "developing" ? "muted" : "warning"} /></div>
      <div className="v11-account-brief"><span>{platform.platformKey === "lieju" ? `列举网账号：${connectedRows.length} / 13 已连接` : rows.length > 0 ? `${rows.length} 个账号容器` : "尚未添加账号"}</span><span>{rows.some((row) => row.account.lastPublishAt) ? `最近发布 ${new Date(Math.max(...rows.map((row) => Date.parse(row.account.lastPublishAt ?? "") || 0))).toLocaleDateString("zh-CN")}` : "还没有发布记录"}</span></div>
      {browser && platform.platformKey !== "lieju" && rows.length > 0 && <div className="v11-browser-account-list" onClick={(event) => event.stopPropagation()}>{rows.map((row) => <BrowserAccountRow key={row.account.id} row={row} platform={platform} busy={busy} controlledResults={controlledResults} explorationResults={explorationResults} runAccountSelfTest={runAccountSelfTest} runControlledPostUploadDiscovery={runControlledPostUploadDiscovery} runPublishFlowExploration={runPublishFlowExploration} requestOneShotPublish={requestOneShotPublish} openPlatform={openPlatform} checkLogin={checkLogin} inspectPublishEditor={inspectPublishEditor} beginAccountLogin={beginAccountLogin} disconnect={disconnect} />)}</div>}
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>{connected && !browser && <button className="primary-button" onClick={() => onNavigate("publishing")}>发布文章</button>}{browser && !connected && rows.length === 0 && <button className="primary-button" disabled={busy === platform.platformKey} onClick={() => void beginAccountLogin(platform.platformKey, "connect")}>{attentionRows.length > 0 ? "重新登录" : "连接账号"}</button>}{browser && platform.platformKey !== "lieju" && <button className={connected ? "secondary-button" : "primary-button"} disabled={busy === platform.platformKey} onClick={() => void beginAccountLogin(platform.platformKey, "add")}>+ 添加账号</button>}{platform.platformKey === "lieju" && <button className="secondary-button" onClick={() => onDetails("lieju")}>{rows.length ? "管理账号" : "+ 添加账号"}</button>}{platform.platformKey === "cnblogs" && <button className="primary-button" onClick={() => onDetails("cnblogs")}>{connected ? "管理博客园" : "连接博客园"}</button>}{!browser && platform.platformKey !== "lieju" && platform.platformKey !== "cnblogs" && connected && onlyRow && <><button className="secondary-button" disabled={busy === onlyRow.account.id} onClick={() => void openPlatform(platform, onlyRow)}>打开后台</button><button className="mini-button" disabled={busy === onlyRow.account.id} onClick={() => void beginAccountLogin(platform.platformKey, "relogin", onlyRow.account.id)}>重新登录</button></>}{!connected && !browser && mode === "SemiAuto" && <><button className="secondary-button" onClick={() => void openPlatform(platform)}>打开平台</button><button className="mini-button" onClick={() => onNavigate("articles")}>准备内容</button></>}{!connected && !browser && availability === "manual" && <button className="secondary-button" onClick={() => void openPlatform(platform)}>打开平台</button>}{!connected && availability === "blocked" && <span className="v111-unavailable">暂不可用</span>}{!connected && availability === "developing" && <span className="v111-unavailable">开发中</span>}</div>
    </article>;
  })}</section>;
}

function BrowserLoginLifecycleDialog({ platformName, succeeded, busy, hint, onComplete, onCancel, onFinish }: { platformName: string; succeeded: boolean; busy: boolean; hint: string; onComplete: () => void; onCancel: () => void; onFinish: () => void }): JSX.Element {
  return <div className="drawer-backdrop"><aside className="drawer v11-drawer v114-login-dialog" onClick={(event) => event.stopPropagation()}>{succeeded ? <><div className="v114-login-success"><span>✓</span><div><h2>登录成功</h2><strong>{platformName}账号已连接</strong><p>登录状态已安全保存。</p></div></div><div className="drawer-footer"><button className="primary-button" onClick={onFinish}>完成</button></div></> : <><div className="drawer-head"><div><span className="eyebrow">连接账号</span><h2>完成{platformName}登录</h2></div></div><div className="notice warning"><strong>官方登录页已打开</strong><span>请在专用浏览器中正常完成登录、验证码或安全验证；系统不会绕过平台验证。</span></div>{hint && <div className="notice error">{hint}</div>}<div className="drawer-footer"><button className="secondary-button" disabled={busy} onClick={onCancel}>取消连接</button><button className="primary-button" disabled={busy} onClick={onComplete}>{busy ? "正在检查…" : "我已完成登录"}</button></div></>}</aside></div>;
}

function LiejuAccountDrawer({ rows, busy, pendingLogin, onClose, onAdd, onOpen, onCheck, onRelogin, onComplete, onRename, onDisconnect, onPublish }: { rows: AccountManagementRow[]; busy: string; pendingLogin: { accountId: string; platformKey: string } | null; onClose: () => void; onAdd: () => void; onOpen: (row: AccountManagementRow) => void; onCheck: (row: AccountManagementRow) => void; onRelogin: (row: AccountManagementRow) => void; onComplete: () => void; onRename: (row: AccountManagementRow, alias: string) => void; onDisconnect: (row: AccountManagementRow) => void; onPublish: () => void }): JSX.Element {
  const connected = rows.filter((row) => row.account.loginStatus === "logged_in").length;
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer v11-drawer v112-account-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">列举网账号</span><h2>{connected >= 13 ? "13 个账号已连接" : `${connected} / 13 已连接`}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="notice">每个账号使用独立 Browser Session。分类、地区、联系方式、拼图/验证码和最终提交由你在官方页面确认。</div><button className="primary-button" onClick={onAdd}>+ 添加账号</button>{pendingLogin && <div className="notice warning"><strong>官方登录页已打开</strong><span>完成正常登录和平台验证后再继续。</span><button className="primary-button" disabled={busy === pendingLogin.accountId} onClick={onComplete}>我已完成登录</button></div>}<div className="v112-account-list">{rows.length === 0 ? <EmptyWorkspace title="还没有列举网账号" description="逐个添加即可，不需要一次连接 13 个。" /> : rows.map((row) => <LiejuAccountRow key={row.account.id} row={row} busy={busy === row.account.id} onOpen={() => onOpen(row)} onCheck={() => onCheck(row)} onRelogin={() => onRelogin(row)} onRename={(alias) => onRename(row, alias)} onDisconnect={() => onDisconnect(row)} onPublish={onPublish} />)}</div></aside></div>;
}

function LiejuAccountRow({ row, busy, onOpen, onCheck, onRelogin, onRename, onDisconnect, onPublish }: { row: AccountManagementRow; busy: boolean; onOpen: () => void; onCheck: () => void; onRelogin: () => void; onRename: (alias: string) => void; onDisconnect: () => void; onPublish: () => void }): JSX.Element {
  const [alias, setAlias] = useState(row.account.accountAlias || row.account.name);
  return <article className="panel v112-account-row"><div className="v112-account-row-head"><input aria-label="账号别名" value={alias} onChange={(event) => setAlias(event.target.value)} onBlur={() => alias.trim() !== (row.account.accountAlias || row.account.name) && onRename(alias)} /><Status label={accountStatusLabel(row.account)} tone={row.account.loginStatus === "logged_in" ? "success" : "warning"} /></div><div className="v112-account-meta"><span>平台账号名：{row.account.accountName || row.providerAccountName || "登录后获取"}</span><span>Session：{row.account.browserSessionId ? "已安全保存" : "未保存"}</span><span>今日发布：{row.account.todayPublishCount}</span><span>最近发布时间：{row.account.lastPublishAt ? new Date(row.account.lastPublishAt).toLocaleString("zh-CN") : "暂无"}</span></div><div className="row-actions"><button className="secondary-button" disabled={busy || row.account.loginStatus !== "logged_in"} onClick={onOpen}>打开后台</button><button className="mini-button" disabled={busy} onClick={onCheck}>检查登录</button><button className="mini-button" disabled={busy} onClick={onRelogin}>重新登录</button><button className="primary-button" disabled={row.account.loginStatus !== "logged_in"} onClick={onPublish}>发布文章</button><button className="mini-button danger-mini" disabled={busy} onClick={onDisconnect}>移除</button></div></article>;
}

function CnblogsAccountDrawer({ rows, busy, onClose, onEnsureAccount, onSaved, onMessage, onCheck, onPublish }: { rows: AccountManagementRow[]; busy: string; onClose: () => void; onEnsureAccount: () => Promise<Account>; onSaved: () => void; onMessage: (message: string) => void; onCheck: (row: AccountManagementRow) => void; onPublish: () => void }): JSX.Element {
  const [blogUrl, setBlogUrl] = useState(""); const [blogApp, setBlogApp] = useState(""); const [pat, setPat] = useState(""); const [saving, setSaving] = useState(false); const row = rows[0];
  const save = async (): Promise<void> => { setSaving(true); try { const account = row?.account ?? await onEnsureAccount(); const values: Record<string, string> = {}; if (blogUrl.trim()) values.blogUrl = blogUrl.trim(); if (blogApp.trim()) values.blogApp = blogApp.trim(); if (pat.trim()) values.pat = pat.trim(); if (!row?.credentialStatus.configured && !values.pat) throw new Error("请填写 Personal Access Token"); await window.publisherAPI.accounts.setCredentials({ accountId: account.id, platformKey: "cnblogs", values }); setPat(""); const result = await window.publisherAPI.accounts.checkLogin(account.id, "cnblogs"); onMessage(result.loginStatus === "logged_in" ? "博客园官方 API 连接验证通过；这不等于 PublishPassed。" : "凭据已安全保存，但官方 API 连接验证未通过。"); onSaved(); } catch (error) { onMessage(error instanceof Error ? error.message : "博客园配置保存失败"); } finally { setSaving(false); } };
  const stage = row?.connectionStage ?? (row?.credentialStatus.configured ? "CredentialConfigured" : "NotConfigured");
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer v11-drawer v112-account-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">博客园</span><h2>官方 API 连接</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="v112-stage"><Status label={stage} tone={stage === "ConnectionPassed" || stage === "PublishReady" || stage === "PublishPassed" ? "success" : "warning"} /><span>{row?.account.lastVerifiedAt ? `最后验证 ${new Date(row.account.lastVerifiedAt).toLocaleString("zh-CN")}` : "尚未完成真实连接验证"}</span></div><label>博客地址<input value={blogUrl} onChange={(event) => setBlogUrl(event.target.value)} placeholder={row?.credentialStatus.fields.find((field) => field.key === "blogUrl")?.configured ? "已配置；留空保持不变" : "https://www.cnblogs.com/your-blog/"} /></label><label>Blog App（可选）<input value={blogApp} onChange={(event) => setBlogApp(event.target.value)} placeholder={row?.credentialStatus.fields.find((field) => field.key === "blogApp")?.configured ? "已配置；留空保持不变" : "仅后台明确要求时填写"} /></label><label>Personal Access Token<input type="password" autoComplete="new-password" value={pat} onChange={(event) => setPat(event.target.value)} placeholder={row?.credentialStatus.fields.find((field) => field.key === "pat")?.configured ? "已配置；不会回显" : "粘贴 PAT"} /></label><div className="notice">PAT 由主进程 safeStorage 加密保存；Renderer 只能看到“已配置”，无法读取完整 PAT。默认发布流程先创建未发布草稿。</div><div className="row-actions"><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "验证中…" : row ? "保存并验证连接" : "连接博客园"}</button>{row && <button className="secondary-button" disabled={busy === row.account.id} onClick={() => onCheck(row)}>重新验证</button>}{row?.account.loginStatus === "logged_in" && <button className="secondary-button" onClick={onPublish}>发布文章</button>}</div></aside></div>;
}

function XhsPublishConfirmation({ preview, onClose, onResult }: { preview: PublishJobPreview; onClose: () => void; onResult: (message: string) => void }): JSX.Element {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const confirm = async (): Promise<void> => {
    if (inFlight.current || attempted) return;
    inFlight.current = true; setBusy(true); setAttempted(true);
    try {
      await window.publisherAPI.jobs.confirm(preview.jobId, false, preview.contentBindingId);
      const result = await window.publisherAPI.jobs.run(preview.jobId);
      const outcome = `${publishStatusLabel(result.job.status)}：${result.message}`;
      setMessage(outcome); setCompleted(true); onResult(outcome);
    } catch (error) {
      const failure = `${error instanceof Error ? error.message : "确认或提交未完成"}。请到发布中心查看本次任务；结果未知时只能查询状态，不能重复提交。`;
      setMessage(failure); onResult(failure);
    } finally { inFlight.current = false; setBusy(false); }
  };
  const cancel = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { const result = await window.publisherAPI.jobs.cancel(preview.jobId); onResult(result.message); onClose(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "取消失败，任务仍保留"); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="drawer-backdrop"><aside className="drawer v11-drawer v11-publish-drawer" role="dialog" aria-label="小红书发布前确认">
    <div className="drawer-head"><h2>小红书发布前确认</h2></div>
    <div className="notice">{attempted ? "已处理本次确认，请以以下任务结果为准。" : "准备完成，尚未提交。请核对本次内容与账号，再明确确认发布。"}</div>
    <p>目标账号：{preview.accountName}</p><h3>{preview.title}</h3>
    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.body}</div>
    {preview.image && <div className="v111-selected-image"><div className="image-preview"><img src={preview.image.previewUrl} alt={preview.image.name} /></div><strong>{preview.image.name}</strong></div>}
    <p>{preview.rules.message}</p>{message && <div className="notice warning">{message}</div>}
    <div className="drawer-footer">{!attempted && <button className="secondary-button" disabled={busy} onClick={() => void cancel()}>取消本次准备</button>}{attempted && <button className="secondary-button" disabled={busy} onClick={onClose}>{completed ? "关闭" : "保留任务并关闭"}</button>}{!attempted && <button className="primary-button" disabled={busy || !preview.image} onClick={() => void confirm()}>{busy ? "处理中…" : "确认发布这篇内容"}</button>}</div>
  </aside></div>;
}

export function V11PublishCenter({ refresh, refreshKey, onNavigate }: { refresh: () => void; refreshKey: number; onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const [confirmation, setConfirmation] = useState<PublishJobPreview | null>(null);
  const [jobs, setJobs] = useState<PublishJob[]>([]); const [articles, setArticles] = useState<Article[]>([]); const [accounts, setAccounts] = useState<Account[]>([]); const [images, setImages] = useState<ImageAsset[]>([]); const [message, setMessage] = useState(""); const [running, setRunning] = useState(""); const [open, setOpen] = useState(false); const [detailsJob, setDetailsJob] = useState<PublishJob | null>(null);
  const load = useCallback((): void => { void Promise.all([window.publisherAPI.jobs.list(), window.publisherAPI.articles.list(), window.publisherAPI.accounts.list(), window.publisherAPI.imageAssets.list()]).then(([nextJobs, nextArticles, nextAccounts, nextImages]) => { const operatingArticles = nextArticles.filter(isProductionArticle); const operatingIds = new Set(operatingArticles.map((article) => article.id)); setJobs(nextJobs.filter((job) => operatingIds.has(job.articleId))); setArticles(operatingArticles); setAccounts(nextAccounts); setImages(nextImages); }); }, []);
  useEffect(load, [load, refreshKey]);
  const articleById = new Map(articles.map((article) => [article.id, article])); const accountById = new Map(accounts.map((account) => [account.id, account])); const imageById = new Map(images.map((image) => [image.id, image]));
  const continueJob = async (job: PublishJob): Promise<void> => {
    setRunning(job.id);
    try {
      if (job.status === "NeedsReconciliation" || job.status === "Publishing") {
        const result = await (["zhihu", "xiaohongshu"].includes(job.platformKey) ? window.publisherAPI.jobs.reconcileBrowser(job.id) : window.publisherAPI.jobs.reconcile(job.id));
        setMessage(`${publishStatusLabel(result.job.status)}：${result.message}`);
      } else if (job.platformKey === "xiaohongshu") {
        setConfirmation(await window.publisherAPI.jobs.preview(job.id));
      } else {
        if (job.finalPublishMode === "PREPARE_ONLY" && ["AwaitingConfirmation", "DryRunPassed"].includes(job.status)) { setMessage("这条任务只准备内容，不会执行最终发布；如需发布请重新选择“发布前确认”。"); return; }
        if (["AwaitingConfirmation", "DryRunPassed"].includes(job.status)) await window.publisherAPI.jobs.confirm(job.id, false);
        const result = await window.publisherAPI.jobs.run(job.id);
        setMessage(`${publishStatusLabel(result.job.status)}：${result.message}`);
      }
      load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "暂时无法继续发布"); }
    finally { setRunning(""); }
  };
  const cancelPreparation = async (job: PublishJob): Promise<void> => {
    if (running) return;
    setRunning(job.id);
    try {
      const result = await window.publisherAPI.jobs.cancel(job.id);
      setMessage(`${result.message}。如需重新准备，请从文章库重新选择内容、账号和图片。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "取消准备失败；任务已保留"); }
    finally { setRunning(""); load(); refresh(); }
  };
  const modeLabel = (job: PublishJob): string => job.finalPublishMode === "PREPARE_ONLY" ? "只准备内容" : job.finalPublishMode === "AUTO_PUBLISH" ? "自动发布" : "发布前确认";
  return <>
    <WorkspaceTitle eyebrow="发布中心" title="安排并开始发布" description="选择文章和渠道；内容审核是否阻止发布由当前审核模式决定，最终发布仍由你确认。" action={<button className="primary-button" onClick={() => setOpen(true)}>选择文章发布</button>} />
    {message && <div className="notice">{message}</div>}
    <section className="panel table-panel"><div className="table-summary"><span>共 {jobs.length} 条发布安排</span><button className="text-button" onClick={() => onNavigate("accounts")}>管理账号 →</button></div>{jobs.length === 0 ? <EmptyWorkspace title="还没有发布安排" description="文章审核通过后，选择渠道和账号就可以立即开始发布。" action={<button className="secondary-button" onClick={() => setOpen(true)}>选择文章</button>} /> : <div className="data-table v11-publish-table"><div className="table-head v11-publish-head"><span>文章</span><span>发布渠道</span><span>账号</span><span>图片</span><span>发布模式</span><span>状态</span><span>创建时间</span><span>操作</span></div>{jobs.map((job) => <div className="table-row v11-publish-row" key={job.id}><strong>{articleById.get(job.articleId)?.title ?? "文章内容"}</strong><span>{platformLabel(job.platformKey)}</span><span>{accountById.get(job.accountId)?.accountAlias || accountById.get(job.accountId)?.name || "已选账号"}</span><span>{job.selectedImageAssetId ? imageById.get(job.selectedImageAssetId)?.name || "已选图片" : "未使用"}</span><span>{modeLabel(job)}</span><Status label={publishStatusLabel(job.status)} tone={publishStatusTone(job.status)} /><span>{new Date(job.createdAt).toLocaleString("zh-CN")}</span><div className="row-actions">{["Pending", "Scheduled", "Retry", "NeedsUserAction", "AwaitingConfirmation", "DryRunPassed", "NeedsReconciliation", "Publishing"].includes(job.status) && <button className="mini-button" disabled={running === job.id} onClick={() => void continueJob(job)}>{running === job.id ? "处理中…" : (job.status === "NeedsReconciliation" || job.status === "Publishing") ? "只读查询状态" : job.status === "AwaitingConfirmation" || job.status === "DryRunPassed" ? "确认并继续" : "继续"}</button>}<button className="mini-button" onClick={() => setDetailsJob(job)}>查看详情</button>{job.platformKey === "xiaohongshu" && ["AwaitingConfirmation", "NeedsUserAction", "DryRunPassed", "Scheduled"].includes(job.status) && <button className="mini-button" disabled={Boolean(running)} onClick={() => void cancelPreparation(job)}>取消准备</button>}</div></div>)}</div>}</section>
    {open && <V11PublishModal onClose={() => setOpen(false)} onDone={() => { load(); refresh(); }} onNavigate={onNavigate} />}
    {confirmation && <XhsPublishConfirmation preview={confirmation} onClose={() => { setConfirmation(null); load(); refresh(); }} onResult={setMessage} />}
    {detailsJob && <div className="drawer-backdrop" onClick={() => setDetailsJob(null)}><aside className="drawer v11-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">发布任务</span><h2>任务详情</h2></div><button className="icon-button" onClick={() => setDetailsJob(null)}>×</button></div><div className="v11-job-detail"><strong>{articleById.get(detailsJob.articleId)?.title ?? "文章内容"}</strong><span>平台：{platformLabel(detailsJob.platformKey)}</span><span>账号：{accountById.get(detailsJob.accountId)?.accountAlias || accountById.get(detailsJob.accountId)?.name || "已选账号"}</span><span>图片：{detailsJob.selectedImageAssetId ? imageById.get(detailsJob.selectedImageAssetId)?.name || "已选图片" : "未使用"}</span><span>发布模式：{modeLabel(detailsJob)}</span><span>当前状态：{publishStatusLabel(detailsJob.status)}</span><span>创建时间：{new Date(detailsJob.createdAt).toLocaleString("zh-CN")}</span>{detailsJob.lastErrorMessage && <div className="notice warning">{detailsJob.lastErrorMessage}</div>}</div><div className="drawer-footer"><button className="primary-button" onClick={() => setDetailsJob(null)}>关闭</button></div></aside></div>}
  </>;
}

export function V11PublishModal({ initialArticle, onClose, onDone, onNavigate }: { initialArticle?: Article; onClose: () => void; onDone: () => void; onNavigate?: (route: V11NavigationTarget) => void }): JSX.Element {
  const [articles, setArticles] = useState<Article[]>(initialArticle ? [initialArticle] : []); const [articleId, setArticleId] = useState(initialArticle?.id ?? ""); const [accounts, setAccounts] = useState<Array<Account & { accountStatus?: string; runtimeAuthState?: string | null }>>([]); const [platforms, setPlatforms] = useState<Platform[]>([]); const [reviewMode, setReviewMode] = useState<ContentReviewMode>("WarningOnly"); const [finalPublishMode, setFinalPublishMode] = useState<"prepare_only" | "confirm_before_publish" | "auto_publish">("confirm_before_publish"); const [qualityStatus, setQualityStatus] = useState("Draft"); const [qualityIssues, setQualityIssues] = useState<ContentQualityIssue[]>([]); const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]); const [accountChoices, setAccountChoices] = useState<Record<string, string>>({}); const [images, setImages] = useState<ImageAsset[]>([]); const [selectedImage, setSelectedImage] = useState<ImageAsset | null>(null); const [imageMode, setImageMode] = useState<"random" | "manual" | "none">("random"); const [manualImagesOpen, setManualImagesOpen] = useState(false); const [seenImageIds, setSeenImageIds] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [liejuAccountChoices, setLiejuAccountChoices] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<PublishJobPreview | null>(null);
  const [preparedJobId, setPreparedJobId] = useState<string | null>(null);
  const starting = useRef(false);
  const xhsSelected = selectedPlatforms.includes("xiaohongshu");
  const candidatesForPlatform = useCallback((rows: typeof accounts, key: string): typeof accounts => key === "xiaohongshu"
    ? rows.filter((account) => account.platformKey === key && account.enabled && !account.archivedAt && Boolean(account.externalAccountId))
    : connectedAccountsForPlatform(rows, key), []);
  const article = articles.find((item) => item.id === articleId) ?? initialArticle;
  useEffect(() => { void Promise.all([initialArticle ? Promise.resolve([initialArticle]) : window.publisherAPI.articles.list(), window.publisherAPI.accounts.overview(), window.publisherAPI.platforms.list(), window.publisherAPI.settings.get()]).then(([nextArticles, nextAccountRows, nextPlatforms, settings]) => { const nextAccounts = nextAccountRows.map((row) => ({ ...row.account, accountStatus: row.accountStatus, runtimeAuthState: row.runtimeAuthState })); setArticles(nextArticles.filter(isProductionArticle)); setAccounts(nextAccounts); setPlatforms(nextPlatforms.filter((platform) => platform.platformKey !== "test")); setReviewMode(normalizeContentReviewMode(settings.contentReviewMode)); setFinalPublishMode(settings.finalPublishMode === "prepare_only" || settings.finalPublishMode === "auto_publish" ? settings.finalPublishMode : "confirm_before_publish"); const keys = [...new Set(nextAccounts.filter((account) => isOnlineAccount(account) || (account.platformKey === "xiaohongshu" && account.enabled && !account.archivedAt && Boolean(account.externalAccountId))).map((account) => account.platformKey))]; setSelectedPlatforms(keys.includes("zhihu") ? ["zhihu"] : keys.slice(0, 1)); }); }, [initialArticle]);
  useEffect(() => { if (!article?.id) return; void (async () => { try { let state = await window.publisherAPI.quality.status("article", article.id); if (reviewMode === "WarningOnly" && (!state || state.status === "Draft")) { await window.publisherAPI.quality.recheck("article", article.id); state = await window.publisherAPI.quality.status("article", article.id); } setQualityStatus(state?.status ?? "Draft"); const history = await window.publisherAPI.quality.history("article", article.id); setQualityIssues(history.reviews[0]?.issues ?? []); } catch (error) { setMessage(error instanceof Error ? error.message : "内容检查暂时无法完成；仅提醒模式仍允许你本人决定。"); } })(); }, [article?.id, reviewMode]);
  useEffect(() => { const next: Record<string, string> = {}; selectedPlatforms.forEach((key) => { const candidates = candidatesForPlatform(accounts, key); const selected = defaultAccountSelection(candidates); if (selected.selectedAccountId) next[key] = selected.selectedAccountId; if (key === "lieju" && liejuAccountChoices.length === 0 && candidates[0]) setLiejuAccountChoices([candidates[0].platformAccountId ?? candidates[0].id]); }); setAccountChoices((current) => ({ ...current, ...next })); }, [accounts, selectedPlatforms, liejuAccountChoices.length, candidatesForPlatform]);
  const togglePlatform = (key: string): void => setSelectedPlatforms((current) => current.includes(key) ? current.filter((item) => item !== key) : key === "xiaohongshu" ? [key] : [...current.filter((item) => item !== "xiaohongshu"), key]);
  const connectedPlatformKeys = [...new Set(accounts.filter((account) => isOnlineAccount(account)).map((account) => account.platformKey))];
  const channels = orderPlatformCatalog(platforms, [], accounts).filter((platform) => platform.enabled && platform.capabilities.article && !["blocked", "developing"].includes(platformAvailability(platform)));
  const primaryPlatformKey = selectedPlatforms[0] ?? connectedPlatformKeys[0] ?? channels[0]?.platformKey ?? "zhihu";
  useEffect(() => {
    if (!article?.id || !primaryPlatformKey) return;
    let cancelled = false;
    setSelectedImage(null); setImageMode("none");
    void Promise.all([window.publisherAPI.imageAssets.list({ articleId: article.id, brandId: article.brandId, enabledOnly: true }), primaryPlatformKey === "xiaohongshu" ? Promise.resolve(null) : window.publisherAPI.imageAssets.selectForArticle({ articleId: article.id, platformKey: primaryPlatformKey })])
      .then(([nextImages, image]) => { if (cancelled) return; setImages(nextImages); setSelectedImage(image); setSeenImageIds(image ? [image.id] : []); setImageMode(image ? "random" : "none"); })
      .catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "配图加载失败"); });
    return () => { cancelled = true; };
  }, [article?.id, article?.brandId, primaryPlatformKey]);
  const swapImage = async (): Promise<void> => { if (!article) return; const next = await window.publisherAPI.imageAssets.selectForArticle({ articleId: article.id, platformKey: primaryPlatformKey, excludeImageAssetIds: seenImageIds }); setSelectedImage(next); if (next) { setSeenImageIds((current) => [...new Set([...current, next.id])]); setImageMode("random"); setMessage(""); } else setMessage("没有更多匹配图片，可以手动选择或不使用图片。"); };
  useEffect(() => { if (xhsSelected) setFinalPublishMode("confirm_before_publish"); }, [xhsSelected]);
  const allowed = canPublishWithReviewMode(qualityStatus, reviewMode);
  const highRisk = qualityIssues.some((issue) => issue.severity === "error");
  const startOtherPlatforms = async (): Promise<void> => { if (!article || !allowed || selectedPlatforms.length === 0) return; setBusy(true); try { const done: string[] = []; let jobCount = 0; const persistedFinalMode = finalPublishMode === "prepare_only" ? "PREPARE_ONLY" : finalPublishMode === "auto_publish" ? "AUTO_PUBLISH" : "CONFIRM_BEFORE_PUBLISH"; for (const platformKey of selectedPlatforms) { const accountIds = platformKey === "lieju" ? liejuAccountChoices : accountChoices[platformKey] ? [accountChoices[platformKey]] : []; if (accountIds.length === 0) throw new Error(`请选择${platformLabel(platformKey)}账号`); for (const accountId of accountIds) { let image = platformKey === "cnblogs" || imageMode === "none" ? null : selectedImage; if (imageMode === "random" && platformKey !== primaryPlatformKey && platformKey !== "cnblogs") image = await window.publisherAPI.imageAssets.selectForArticle({ articleId: article.id, platformKey, excludeImageAssetIds: image ? [image.id] : [] }); await window.publisherAPI.articles.preparePublish({ articleId: article.id, platformKey, platformAccountId: accountId, publishMode: finalPublishMode === "prepare_only" ? "MANUAL" : "ASSISTED", finalPublishMode: persistedFinalMode, selectedImageAssetId: image?.id ?? null, imageSelectionMode: image ? imageMode : "none" }); jobCount += 1; } done.push(platformLabel(platformKey)); } const outcome = finalPublishMode === "prepare_only" ? "内容已准备，未执行最终提交。" : finalPublishMode === "auto_publish" ? "已按自动发布设置进入任务；未验证最终提交能力的浏览器平台会降级到发布前确认。" : "内容已准备，正在等待发布前确认。"; setMessage(jobCount > selectedPlatforms.length ? `已创建 ${jobCount} 个独立发布任务。${outcome}` : `${done.join("、")}：${outcome}`); onDone(); } catch (error) { setMessage(error instanceof Error ? error.message : "开始发布失败"); } finally { setBusy(false); } };
  const closeModal = async (): Promise<void> => {
    if (starting.current || busy) return;
    if (preparedJobId) {
      setBusy(true);
      try { const result = await window.publisherAPI.jobs.cancel(preparedJobId); setMessage(result.message); onDone(); onClose(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "取消失败，准备任务仍保留"); }
      finally { setBusy(false); }
    } else onClose();
  };
  const start = async (): Promise<void> => {
    if (starting.current || busy) return;
    if (!xhsSelected) { await startOtherPlatforms(); return; }
    if (!article || !allowed) return;
    if (selectedPlatforms.length !== 1 || imageMode !== "manual" || !selectedImage) { setMessage("小红书当前只支持单账号和一张手动明确选择的图片；不支持多图或视频。"); return; }
    const accountId = accountChoices.xiaohongshu;
    if (!accountId) { setMessage("请选择小红书账号"); return; }
    starting.current = true; setBusy(true); setMessage("");
    try {
      const result = await window.publisherAPI.articles.preparePublish({ articleId: article.id, platformKey: "xiaohongshu", platformAccountId: accountId, publishMode: "ASSISTED", finalPublishMode: "CONFIRM_BEFORE_PUBLISH", selectedImageAssetId: selectedImage.id, imageSelectionMode: "manual" });
      setMessage(`${result.record?.status === "Prepared" ? "准备完成" : "未准备完成"}：${result.message}`);
      setPreparedJobId(result.job.id);
      if (result.record?.status === "Prepared") setConfirmation(await window.publisherAPI.jobs.preview(result.job.id));
      onDone();
    } catch (error) { setMessage(error instanceof Error ? error.message : "准备未完成，请完成平台正常验证后查看任务"); }
    finally { starting.current = false; setBusy(false); }
  };
  if (confirmation) return <XhsPublishConfirmation preview={confirmation} onClose={() => { setConfirmation(null); setPreparedJobId(null); onDone(); onClose(); }} onResult={(result) => { setMessage(result); onDone(); }} />;
  return <div className="drawer-backdrop" onClick={() => void closeModal()}>
    <aside className="drawer v11-drawer v11-publish-drawer" onClick={(event) => event.stopPropagation()}>
      <div className="drawer-head"><div><span className="eyebrow">发布文章</span><h2>选择发布渠道</h2></div><button className="icon-button" onClick={() => void closeModal()}>×</button></div>
      {!initialArticle && <label>文章<select value={articleId} onChange={(event) => setArticleId(event.target.value)}><option value="">请选择文章</option>{articles.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}
      {article && <div className="v11-publish-article"><strong>{article.title}</strong><span>{article.business || article.keyword || "文章内容"} · {article.city || "未填写城市"}</span></div>}
      <div className="v11-review-status"><span>内容审核：{contentReviewModeLabel(reviewMode)}</span><Status label={articleReviewLabel(qualityStatus)} tone={articleReviewTone(qualityStatus)} /></div>
      {reviewMode === "Strict" && !allowed && article && <div className="notice error">严格审核模式要求文章达到“已通过”后才能发布。</div>}
      {reviewMode === "WarningOnly" && qualityStatus !== "Approved" && article && <div className={`v111-quality-warning ${highRisk ? "high-risk" : ""}`}><strong>{highRisk ? "高风险内容提醒：请本人确认后决定" : `系统发现 ${qualityIssues.length || 1} 项内容提醒`}</strong>{qualityIssues.length > 0 ? <ul>{qualityIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : <p>内容尚未人工批准；仅提醒模式不会强制阻止发布。</p>}</div>}
      {reviewMode === "Off" && <div className="notice">内容审核已关闭；Quality Gate 历史仍保留在高级详情中。</div>}
      <div className="v11-publish-method"><strong>发布方式：{finalPublishMode === "prepare_only" ? "只准备内容" : finalPublishMode === "auto_publish" ? "自动发布" : "发布前确认"}</strong><span>{finalPublishMode === "auto_publish" ? "只有已验证能力的平台会自动继续；登录失效、安全验证或风险控制会立即暂停。" : finalPublishMode === "prepare_only" ? "系统填写内容和图片后停止，不点击平台最终发布。" : "系统准备内容后等待你的最终确认。"}</span></div>
      <div className="v114-publish-steps"><span>1. 准备内容</span><span>2. 上传图片</span><span>3. 提交平台</span><span>4. 确认结果</span></div>
      <div className="v11-channel-list">{channels.map((platform) => {
        const candidates = candidatesForPlatform(accounts, platform.platformKey);
        const connected = candidates.length > 0;
        return <div key={platform.platformKey}>
          <label className={`check-row ${connected ? "" : "disabled"}`}><input type="checkbox" disabled={!connected} checked={selectedPlatforms.includes(platform.platformKey)} onChange={() => togglePlatform(platform.platformKey)} /><span>{platform.displayName}</span><em>{connected ? candidates.length === 1 ? "已自动选择账号" : `${candidates.length} 个账号` : <button type="button" className="text-button" onClick={() => { onClose(); onNavigate?.("accounts"); }}>连接</button>}</em></label>
          {selectedPlatforms.includes(platform.platformKey) && platform.platformKey === "lieju" && candidates.length > 1 && <div className="v112-account-multiselect"><strong>默认单选；多选会创建 {liejuAccountChoices.length} 个独立任务</strong>{candidates.map((account) => { const id = account.platformAccountId ?? account.id; return <label className="check-row" key={id}><input type="checkbox" checked={liejuAccountChoices.includes(id)} onChange={() => setLiejuAccountChoices((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])} /><span>{account.accountAlias || account.name}</span><em>独立 Session</em></label>; })}</div>}
          {selectedPlatforms.includes(platform.platformKey) && platform.platformKey !== "lieju" && candidates.length > 1 && <select value={accountChoices[platform.platformKey] ?? ""} onChange={(event) => setAccountChoices((current) => ({ ...current, [platform.platformKey]: event.target.value }))}><option value="">请选择账号</option>{candidates.map((account) => <option value={account.platformAccountId ?? account.id} key={account.id}>{account.accountAlias || account.name}</option>)}</select>}
        </div>;
      })}</div>
      {xhsSelected && <div className="notice">小红书仅支持单账号、单张明确图片和可见浏览器人工确认。已绑定账号仍需在准备时验证真实身份和当前页面；如需登录或安全验证，请在官方页面正常完成。</div>}
      {article && <section className="v111-publish-image"><div className="panel-heading"><div><h3>配图</h3><span>列举网仅准备已选且符合官方限制的图片；博客园首版不调用未验证的图片上传接口。</span></div></div>{imageMode !== "none" && selectedImage ? <div className="v111-selected-image"><div className="image-preview">{selectedImage.previewUrl ? <img src={selectedImage.previewUrl} alt={selectedImage.name} /> : <span>▧</span>}</div><div><strong>{selectedImage.name}</strong><span>匹配原因：{imageMatchReason(article, selectedImage)}</span></div></div> : <div className="notice">{xhsSelected ? "请手动选择本次唯一图片。" : "本次不使用图片。"}</div>}<div className="row-actions"><button className="secondary-button" disabled={xhsSelected || images.length < 2} onClick={() => void swapImage()}>换一张</button><button className="secondary-button" onClick={() => setManualImagesOpen((value) => !value)}>手动选择</button><button className="mini-button" disabled={xhsSelected} onClick={() => { setImageMode("none"); setSelectedImage(null); }}>不使用图片</button></div>{manualImagesOpen && <div className="v111-manual-images">{images.map((image) => <button className={selectedImage?.id === image.id ? "selected" : ""} key={image.id} onClick={() => { setSelectedImage(image); setImageMode("manual"); setManualImagesOpen(false); }}><div className="image-preview">{image.previewUrl ? <img src={image.previewUrl} alt={image.name} /> : <span>▧</span>}</div><span>{image.name}</span></button>)}</div>}</section>}
      {message && <div className="notice">{message}</div>}
      <div className="drawer-footer"><button className="secondary-button" onClick={() => void closeModal()}>{reviewMode === "WarningOnly" && qualityStatus !== "Approved" ? "返回修改" : "取消"}</button><button className="primary-button" disabled={busy || Boolean(preparedJobId) || !article || !allowed || selectedPlatforms.length === 0 || (xhsSelected && (imageMode !== "manual" || !selectedImage))} onClick={() => void start()}>{busy ? "正在准备…" : xhsSelected ? "准备小红书内容" : finalPublishMode === "prepare_only" ? "准备内容" : finalPublishMode === "auto_publish" ? "开始自动发布" : reviewMode === "WarningOnly" && qualityStatus !== "Approved" ? "仍然发布" : "开始发布"}</button></div>
    </aside>
  </div>;
}

export function V11Statistics({ refreshKey }: { refreshKey: number }): JSX.Element {
  const [articles, setArticles] = useState<Article[]>([]); const [jobs, setJobs] = useState<PublishJob[]>([]); const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { void Promise.all([window.publisherAPI.jobs.list(), window.publisherAPI.articles.list(), window.publisherAPI.accounts.list()]).then(([nextJobs, nextArticles, nextAccounts]) => { const operatingArticles = nextArticles.filter(isProductionArticle); const operatingIds = new Set(operatingArticles.map((article) => article.id)); setArticles(operatingArticles); setJobs(nextJobs.filter((job) => operatingIds.has(job.articleId))); setAccounts(nextAccounts.filter((account) => standardPlatforms.includes(account.platformKey))); }); }, [refreshKey]);
  const published = jobs.filter((job) => publishStatusLabel(job.status) === "已发布"); const needsAction = jobs.filter((job) => publishStatusLabel(job.status) === "需要处理");
  return <><WorkspaceTitle eyebrow="数据统计" title="查看内容运营结果" description="用简单指标关注内容产出、账号状态和发布进度。" /><div className="stat-grid"><MetricCard label="今日已发布" value={published.filter((job) => isToday(job.finishedAt ?? job.createdAt)).length} hint="完成的平台发布" tone="green" icon="●" /><MetricCard label="待发布" value={jobs.filter((job) => ["待发布", "等待确认"].includes(publishStatusLabel(job.status))).length} hint="等待你确认或安排" tone="purple" icon="↗" /><MetricCard label="需要处理" value={needsAction.length} hint="建议优先检查" tone="orange" icon="!" /><MetricCard label="在线账号" value={accounts.filter(isOnlineAccount).length} hint={`今日内容 ${articles.filter((article) => isToday(article.generatedAt || article.createdAt)).length} 篇`} icon="◎" /></div><section className="panel table-panel"><div className="panel-heading"><div><h3>最近完成的发布</h3><span>查看内容在各渠道的最新结果。</span></div></div>{published.length === 0 ? <EmptyWorkspace title="还没有完成的发布" description="审核通过后，在发布中心选择渠道即可开始。" /> : <div className="v11-recent-list">{published.slice(0, 12).map((job) => <div key={job.id}><strong>{platformLabel(job.platformKey)}</strong><span>{new Date(job.finishedAt ?? job.createdAt).toLocaleString("zh-CN")}</span><Status label="已发布" tone="success" /></div>)}</div>}</section></>;
}

export function V11Preferences(): JSX.Element {
  const [mode, setMode] = useState<ContentReviewMode>("WarningOnly");
  const [browserMode, setBrowserMode] = useState<"background" | "visible">("background");
  const [finalPublishMode, setFinalPublishMode] = useState<"prepare_only" | "confirm_before_publish" | "auto_publish">("confirm_before_publish");
  const [message, setMessage] = useState("");
  useEffect(() => { void window.publisherAPI.settings.get().then((settings) => { setMode(normalizeContentReviewMode(settings.contentReviewMode)); setBrowserMode(settings.browserPublishMode === "visible" ? "visible" : "background"); setFinalPublishMode(settings.finalPublishMode === "prepare_only" || settings.finalPublishMode === "auto_publish" ? settings.finalPublishMode : "confirm_before_publish"); }); }, []);
  const save = async (next: ContentReviewMode): Promise<void> => { setMode(next); await window.publisherAPI.settings.update("contentReviewMode", next); setMessage(`内容审核模式已保存为“${contentReviewModeLabel(next)}”`); };
  const saveBrowserMode = async (next: "background" | "visible"): Promise<void> => { setBrowserMode(next); await window.publisherAPI.settings.update("browserPublishMode", next); setMessage(`浏览器平台发布方式已保存为“${next === "background" ? "后台自动" : "可见辅助"}”`); };
  const saveFinalPublishMode = async (next: "prepare_only" | "confirm_before_publish" | "auto_publish"): Promise<void> => { setFinalPublishMode(next); await window.publisherAPI.settings.update("finalPublishMode", next); setMessage(next === "auto_publish" ? "已由你主动开启自动发布；仍会遵守平台能力、安全验证和账号权限边界。" : "最终发布模式已保存。"); };
  const options: Array<{ mode: ContentReviewMode; title: string; description: string }> = [
    { mode: "Off", title: "关闭审核", description: "Production 和 Excel 文章可以直接进入发布流程；历史检查结果仍保留。" },
    { mode: "WarningOnly", title: "仅提醒", description: "默认模式。继续执行 Quality Gate，显示风险提醒，但由你本人决定是否仍然发布。" },
    { mode: "Strict", title: "严格审核", description: "只有达到 Approved 的文章才能创建正式发布任务。" }
  ];
  const browserOptions = [{ value: "background" as const, title: "后台自动", description: "仅对已通过后台模式真实自测的平台启用；未通过的平台会自动使用可见辅助。" }, { value: "visible" as const, title: "可见辅助", description: "显示平台浏览器，便于人工核对页面和处理平台验证。" }];
  const publishOptions = [{ value: "prepare_only" as const, title: "只准备内容", description: "填写标题、正文和图片后停止，不执行最终提交。" }, { value: "confirm_before_publish" as const, title: "发布前确认", description: "默认模式。准备完成后等待你确认，再执行平台提交。" }, { value: "auto_publish" as const, title: "自动发布", description: "只有你主动开启后生效；遇登录失效或安全验证会立即暂停。" }];
  return <><WorkspaceTitle eyebrow="设置" title="发布与审核方式" description="设置浏览器运行方式、最终提交方式和内容审核门槛。" />{message && <div className="notice success">{message}</div>}<section className="panel v114-preference-section"><div className="panel-heading"><div><h3>浏览器平台发布方式</h3><span>后台结论按平台单独记录；UNKNOWN / FAILED / 需要可见浏览器时不会强行隐藏。</span></div></div><div className="v111-review-mode-settings compact">{browserOptions.map((option) => <button className={browserMode === option.value ? "selected" : ""} key={option.value} onClick={() => void saveBrowserMode(option.value)}><span className="v111-radio">{browserMode === option.value ? "●" : "○"}</span><div><strong>{option.title}{option.value === "background" ? "（默认偏好）" : ""}</strong><p>{option.description}</p></div></button>)}</div></section><section className="panel v114-preference-section"><div className="panel-heading"><div><h3>最终发布模式</h3><span>自动发布不会绕过验证码、短信、安全验证或风险控制。</span></div></div><div className="v111-review-mode-settings compact">{publishOptions.map((option) => <button className={finalPublishMode === option.value ? "selected" : ""} key={option.value} onClick={() => void saveFinalPublishMode(option.value)}><span className="v111-radio">{finalPublishMode === option.value ? "●" : "○"}</span><div><strong>{option.title}{option.value === "confirm_before_publish" ? "（默认）" : ""}</strong><p>{option.description}</p></div></button>)}</div></section><section className="panel v114-preference-section"><div className="panel-heading"><div><h3>内容审核模式</h3><span>高级审核规则和历史记录不会被删除。</span></div></div><div className="v111-review-mode-settings compact">{options.map((option) => <button className={mode === option.mode ? "selected" : ""} key={option.mode} onClick={() => void save(option.mode)}><span className="v111-radio">{mode === option.mode ? "●" : "○"}</span><div><strong>{option.title}{option.mode === "WarningOnly" ? "（默认）" : ""}</strong><p>{option.description}</p></div></button>)}</div></section><div className="notice">完整 Quality Gate 配置、风险检测和审核历史继续保留在“高级功能 → 高级审核规则”。</div></>;
}

export function V11AdvancedSettings({ onNavigate }: { onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const items: Array<{ route: V11NavigationTarget; title: string; description: string }> = [
    { route: "platforms", title: "平台能力", description: "查看平台接入、能力状态和连接说明。" },
    { route: "self-test", title: "平台自测", description: "逐账号验证登录、编辑器、内容填充、草稿、真实发布与状态回查。" },
    { route: "logs", title: "运行日志", description: "排查错误并导出诊断信息。" },
    { route: "settings", title: "AI 与模型设置", description: "管理内容生成服务和安全凭据。" },
    { route: "backups", title: "数据备份", description: "创建、校验和恢复本地数据备份。" },
    { route: "quality", title: "高级审核规则", description: "查看审核明细、规则和人工校准。" },
    { route: "assets", title: "视频素材", description: "管理视频文件及其发布前检查。" },
    { route: "queue", title: "发布任务与技术诊断", description: "查看发布任务、重试和异常处理。" },
    { route: "plans", title: "发布计划", description: "配置定时发布和内容排期。" },
    { route: "images-advanced", title: "图片高级标签", description: "按业务、城市和渠道维护图片匹配标签。" }
  ];
  return <><WorkspaceTitle eyebrow="高级功能" title="高级设置" description="日常运营不需要进入这里；这里只保留配置、诊断和专业管理工具。" /><section className="v11-advanced-grid">{items.map((item) => <button className="panel v11-advanced-card" key={item.route} onClick={() => onNavigate(item.route)}><strong>{item.title}</strong><span>{item.description}</span><em>打开 →</em></button>)}</section></>;
}

function splitEnterpriseList(value: string): string[] { return [...new Set(value.split(/[、,，;；|\n]+/u).map((item) => item.trim()).filter(Boolean))]; }
function latestEnterpriseUpdate(brand: Brand): string { return [brand.updatedAt, ...(brand.knowledgeEntries ?? []).map((entry) => entry.updatedAt)].sort().at(-1) ?? brand.updatedAt; }
function formatWorkspaceDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "暂无" : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function splitLabels(value: string): string[] { return [...new Set(value.split(/[、,，;；\s]+/u).map((item) => item.trim()).filter(Boolean))]; }
