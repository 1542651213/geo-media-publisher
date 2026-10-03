import { normalizeContentReviewMode,selectRelevantBrandFacts,type Account,type Article,type Brand,type ContentReviewMode,type ContentStudioPlatformKey,type ExcelImportPreview,type ImageAsset,type PublishJob } from "@publisher/domain";
import type { Dispatch,JSX,SetStateAction } from "react";
import { useCallback,useEffect,useRef,useState } from "react";
import type { ContentStudioTaskView } from "../shared/api";
import { PRODUCT_PLATFORM_POLICY,operatorAccounts,operatorContentStudioTargets,operatorOverviewJobs,operatorStatisticsRows,productErrorMessage,productPlatform } from "../shared/product-platform-policy";
import { DraftRecoveryNotice,useWorkingDraft } from "./use-working-draft";
import { articleListStatusLabel,articleReviewLabel,articleReviewTone,contentReviewModeLabel,isOnlineAccount,platformLabel,publishStatusLabel,publishStatusTone,type V11NavigationTarget } from "./v11-ui-model";

import { EmptyState as EmptyWorkspace,StatCard as MetricCard,StatusBadge as Status,PageHeader as WorkspaceTitle } from "./design/WorkspacePrimitives";
import { V11PublishModal } from "./workspace/PublishWorkspace";
import { businessTagDefaults,cityTagDefaults,formatWorkspaceDate,imageCategories,isProductionArticle,isToday,latestEnterpriseUpdate,splitEnterpriseList,splitLabels,usageTagDefaults,type QualityStatusByArticle } from "./workspace/workspace-utils";
export { V11AccountsCenter } from "./workspace/AccountsWorkspace";
export { V11PublishCenter,V11PublishModal } from "./workspace/PublishWorkspace";
export { classifyBrowserLoginResult,type BrowserLoginResultClassification } from "./workspace/workspace-utils";

export function V11Dashboard({ refreshKey, onNavigate }: { refreshKey: number; onNavigate: (route: V11NavigationTarget) => void }): JSX.Element {
  const [articles, setArticles] = useState<Article[]>([]);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [quality, setQuality] = useState<Awaited<ReturnType<typeof window.publisherAPI.quality.items>>>([]);
  useEffect(() => {
    void Promise.all([window.publisherAPI.articles.list(), window.publisherAPI.jobs.list(), window.publisherAPI.accounts.list(), window.publisherAPI.quality.items()]).then(([nextArticles, nextJobs, nextAccounts, nextQuality]) => {
      const operatingArticles = nextArticles.filter(isProductionArticle);
      const operatingIds = new Set(operatingArticles.map((article) => article.id));
      setArticles(operatingArticles); setJobs(operatorOverviewJobs(nextJobs.filter((job) => operatingIds.has(job.articleId)))); setAccounts(operatorAccounts(nextAccounts)); setQuality(nextQuality.filter((item) => item.contentType === "article" && operatingIds.has(item.contentId)));
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
    <section className="panel table-panel"><div className="panel-heading"><div><h3>运营平台概览</h3><span>按当前产品范围展示；历史验收不代表普通发布已开放。</span></div></div><div className="v11-platform-overview">{PRODUCT_PLATFORM_POLICY.filter((item) => item.dashboardVisible).map((item) => <div key={item.platformKey}><strong>{item.displayName}</strong><span>{accounts.filter((account) => account.platformKey === item.platformKey && isOnlineAccount(account)).length} 个在线账号</span><small>{item.statusLabel}</small></div>)}</div></section>
    <div className="v11-dashboard-grid v11-dashboard-bottom">
      <section className="panel table-panel"><div className="panel-heading"><div><h3>最近文章</h3><span>从内容生产、导入和人工编辑进入文章库。</span></div><button className="text-button" onClick={() => onNavigate("articles")}>查看全部 →</button></div>
        {articles.length === 0 ? <EmptyWorkspace title="还没有运营内容" description="先生成一篇文章，或用简易模板导入标题和内容。" action={<button className="secondary-button" onClick={() => onNavigate("production")}>生成内容</button>} /> : <div className="v11-recent-list">{articles.slice(0, 5).map((article) => <button key={article.id} onClick={() => onNavigate("articles")}><div className="cover-thumb">{article.coverAssetId ? "▧" : "—"}</div><div><strong>{article.title}</strong><span>{article.business || article.keyword || "未填写业务"} · {article.city || "未填写城市"}</span></div><em>{article.targetPlatforms?.filter((key) => productPlatform(key)?.dashboardVisible).map(platformLabel).join("、") || "待选择渠道"}</em></button>)}</div>}
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
  const [selectedTargetPlatform, setSelectedTargetPlatform] = useState<ContentStudioPlatformKey | "">("");
  const [taskTargetPlatform, setTaskTargetPlatform] = useState<ContentStudioPlatformKey | "">("");
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
            window.publisherAPI.articles.attachRecommendedImage({ articleId: task.sourceArticleId as string, platformKey: taskTargetPlatform }),
            window.publisherAPI.quality.recheck("article", task.sourceArticleId as string)
          ]).then(() => refresh()).catch(() => refresh());
        });
      });
    };
    poll(); const timer = window.setInterval(poll, 1000); return () => window.clearInterval(timer);
  }, [refresh, taskIds, taskTargetPlatform]);

  const start = async (): Promise<void> => {
    if (!brandId || !business.trim() || !city.trim() || !keyword.trim() || !selectedTargetPlatform) return;
    setBusy(true); setMessage("正在准备企业资料…"); finalised.current.clear();
    try {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const topic = count === 1 ? `${city}${keyword}` : `${city}${keyword} · 内容角度 ${index + 1}`;
        ids.push(await window.publisherAPI.contentStudio.start({ brandId, industry: selectedBrand?.industry?.trim() || business.trim(), cities: [city.trim()], keywords: [keyword.trim()], targetPlatforms: [selectedTargetPlatform], mediaAssetIds: [], videoAssetIds: [], concurrency: 1, business: business.trim(), city: city.trim(), keyword: keyword.trim(), topic, contentGoal: "BrandPromotion", promotionStrength: "Balanced" }));
      }
      setTaskTargetPlatform(selectedTargetPlatform); setTaskIds(ids); setMessage("正在生成内容…"); refresh();
    } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "内容生成未能启动"); }
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
      <label>内容目标平台<select value={selectedTargetPlatform} onChange={(event) => setSelectedTargetPlatform(event.target.value as ContentStudioPlatformKey | "")}><option value="">请选择平台</option>{operatorContentStudioTargets.map((platform) => <option key={platform.key} value={platform.key}>{productPlatform(platform.key)?.displayName ?? platform.displayName}</option>)}</select></label>
      <div className="two-fields"><label>关键词<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例如：新房除甲醛" /></label><label>生成数量<input type="number" min="1" max="10" value={count} onChange={(event) => setCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label></div>
      <button className="text-button v11-advanced-toggle" onClick={() => setAdvanced((value) => !value)}>{advanced ? "收起高级选项" : "高级选项"}</button>
      {advanced && <div className="v11-advanced-inline"><strong>内容设置</strong><span>默认按企业推广场景生成，并为后续发布准备一份图文内容。图片将优先匹配业务、城市和关键词。</span></div>}
      <button className="primary-button wide" disabled={busy || !brandId || !business.trim() || !city.trim() || !keyword.trim() || !selectedTargetPlatform} onClick={() => void start()}>{busy ? "正在创建内容…" : "开始生成"}</button>
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
  const [pageNumber, setPageNumber] = useState(1), [total, setTotal] = useState(0), [totalPages, setTotalPages] = useState(1), [loading, setLoading] = useState(true);
  const requestNumber = useRef(0);
  const load = useCallback((): (() => void) => {
    const request = ++requestNumber.current; let active = true; setLoading(true);
    void window.publisherAPI.articles.page({ search: search || undefined, page: pageNumber, pageSize: 50 }).then(result => {
      if (!active || request !== requestNumber.current) return;
      if (pageNumber > result.totalPages) { setPageNumber(result.totalPages); return; }
      setArticles(result.items.filter(isProductionArticle)); setQuality(result.qualityStatuses); setTotal(result.total); setTotalPages(result.totalPages);
    }).catch(error => { if (active && request === requestNumber.current) setNotice(error instanceof Error ? productErrorMessage(error) : "文章暂时无法读取，请重试"); })
      .finally(() => { if (active && request === requestNumber.current) setLoading(false); });
    return () => { active = false; };
  }, [search, pageNumber]);
  useEffect(() => { let cancel = (): void => {}; const timer = setTimeout(() => { cancel = load(); }, search ? 180 : 0); return () => { clearTimeout(timer); cancel(); }; }, [load, refreshKey, search]);
  useEffect(() => { void window.publisherAPI.brands.list().then((items) => { setBrands(items); setImportBrandId((current) => current || items[0]?.id || ""); }); }, [refreshKey]);
  useEffect(() => { void window.publisherAPI.settings.get().then((settings) => setReviewMode(normalizeContentReviewMode(settings.contentReviewMode))); }, [refreshKey]);
  const importExcel = async (): Promise<void> => { try { const next = await window.publisherAPI.articles.importExcel(importBrandId || null); if (next) setPreview(next); } catch (error) { setNotice(error instanceof Error ? error.message : "Excel 文件读取失败"); } };
  const download = async (kind: "simple" | "advanced"): Promise<void> => { const result = kind === "simple" ? await window.publisherAPI.articles.downloadSimpleTemplate() : await window.publisherAPI.articles.downloadAdvancedTemplate(); if (result) setNotice(`${kind === "simple" ? "简易" : "高级"}模板已保存：${result.fileName}`); };
  return <>
    <WorkspaceTitle eyebrow="文章库" title="管理可发布的文章" description={`默认只显示日常运营内容；当前内容审核模式：${contentReviewModeLabel(reviewMode)}。`} action={<div className="row-actions v114-import-actions">{brands.length > 0 && <label>导入到企业<select value={importBrandId} onChange={(event) => setImportBrandId(event.target.value)}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.companyName || brand.name}</option>)}</select></label>}<button className="secondary-button" onClick={() => void download("simple")}>下载模板</button><button className="primary-button" disabled={!importBrandId} onClick={() => void importExcel()}>Excel 导入</button></div>} />
    {notice && <div className="notice success">{notice}</div>}
    <div className="toolbar panel v11-toolbar"><div className="search-box">⌕<input placeholder="搜索标题、业务或城市" value={search} onChange={(event) => { setSearch(event.target.value); setPageNumber(1); setLoading(true); }} /></div><button className="text-button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "收起高级筛选" : "高级筛选"}</button>{advanced && <div className="v11-toolbar-advanced"><span>高级来源筛选仅用于查看非运营内容。</span><button className="mini-button" onClick={() => onNavigate("advanced")}>打开高级功能</button><button className="mini-button" onClick={() => void download("advanced")}>下载高级模板</button></div>}</div>
    <section className="panel table-panel"><div className="table-summary"><span>共 {total} 篇运营文章 · 第 {pageNumber}/{totalPages} 页 · 每页 50 篇{loading ? " · 正在加载…" : ""}</span><div className="row-actions"><button className="mini-button" aria-label="文章上一页" disabled={loading || pageNumber <= 1} onClick={() => setPageNumber(value => value - 1)}>上一页</button><button className="mini-button" aria-label="文章下一页" disabled={loading || pageNumber >= totalPages} onClick={() => setPageNumber(value => value + 1)}>下一页</button><button className="text-button" onClick={() => onNavigate("production")}>生成新内容 →</button></div></div>
      {articles.length === 0 ? <EmptyWorkspace title="暂无文章" description="可以下载简易模板（标题、内容）导入，或立即生成内容。" action={<button className="secondary-button" onClick={() => onNavigate("production")}>开始生成</button>} /> : <div className="data-table v11-article-table"><div className="table-head v11-article-head"><span>文章</span><span>业务 / 城市</span><span>发布状态</span><span>发布渠道</span><span>更新时间</span><span>操作</span></div>{articles.map((article) => { const simpleStatus = articleListStatusLabel(article, quality[article.id], reviewMode); return <div className="table-row v11-article-row" key={article.id}><div className="article-title"><div className="cover-thumb">{article.coverAssetId ? "▧" : "—"}</div><div><strong>{article.title}</strong><span>{article.keyword || "未设置关键词"}</span></div></div><span>{article.business || "未填写业务"}<small>{article.city || "未填写城市"}</small></span><Status label={simpleStatus} tone={simpleStatus === "已发布" || simpleStatus === "可发布" ? "success" : simpleStatus === "有提醒" ? "warning" : "danger"} /><span>{article.targetPlatforms?.filter((key) => productPlatform(key)?.visibleInOperatorUi).map(platformLabel).join("、") || "暂未选择"}</span><span>{new Date(article.updatedAt).toLocaleDateString("zh-CN")}</span><div className="row-actions"><button className="mini-button" onClick={() => setDetail({ article, editable: false })}>查看</button><button className="mini-button" onClick={() => setDetail({ article, editable: true })}>修改</button><button className="mini-button" onClick={() => setReviewArticle(article)}>审核详情</button><button className="mini-button" onClick={() => setPublishArticle(article)}>发布</button></div></div>; })}</div>}
    </section>
    {detail && <ArticleEditor article={detail.article} editable={detail.editable} onClose={() => setDetail(null)} onSaved={() => { setDetail(null); load(); refresh(); }} />}
    {reviewArticle && <ArticleReview article={reviewArticle} onClose={() => setReviewArticle(null)} onChanged={() => { setReviewArticle(null); load(); refresh(); }} />}
    {publishArticle && <V11PublishModal initialArticle={publishArticle} onClose={() => setPublishArticle(null)} onDone={() => { load(); refresh(); }} onNavigate={onNavigate} />}
    {preview && <ExcelImportDialog preview={preview} onClose={() => setPreview(null)} onDone={() => { setPreview(null); load(); refresh(); }} />}
  </>;
}

function ArticleEditor({ article, editable, onClose, onSaved }: { article: Article; editable: boolean; onClose: () => void; onSaved: () => void }): JSX.Element {
  const [title, setTitle] = useState(article.title), [body, setBody] = useState(article.body), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const draft = useWorkingDraft({ companyId: article.brandId, documentKind: "Article", documentId: article.id }, editable, snapshot => { setTitle(snapshot.title); setBody(snapshot.body); });
  const close = async (): Promise<void> => {if(busy||draft.locked)return;setBusy(true); try { await draft.leave(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存未完成，请留在编辑页重试"); }finally{setBusy(false);} };
  const save = async (): Promise<void> => { setBusy(true); try { await draft.commit(); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "提交失败，恢复草稿已保留"); } finally { setBusy(false); } };
  return <div className="drawer-backdrop" onClick={() => void close()}><aside className="drawer v11-drawer" onClick={event => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">内容编辑</span><h2>{editable ? "修改草稿" : "查看文章"}</h2></div><button className="icon-button" aria-label="关闭草稿编辑" onClick={() => void close()}>×</button></div>
    {editable && <DraftRecoveryNotice draft={draft} />}{error && <p className="notice error">{error}</p>}
    <label>标题<input aria-label="编辑文章标题" value={title} readOnly={!editable} disabled={editable && (!draft.ready||busy||draft.locked)} onCompositionStart={() => draft.composition(true)} onCompositionEnd={() => draft.composition(false)} onChange={event => { draft.capture({ title: event.target.value, body });setTitle(event.target.value); }} /></label>
    <label>正文<textarea aria-label="编辑文章正文" rows={16} value={body} readOnly={!editable} disabled={editable && (!draft.ready||busy||draft.locked)} onCompositionStart={() => draft.composition(true)} onCompositionEnd={() => draft.composition(false)} onChange={event => { draft.capture({ title, body: event.target.value });setBody(event.target.value); }} /></label>
    <div className="drawer-footer"><button className="secondary-button" onClick={() => void close()}>{editable ? "保留工作副本并关闭" : "关闭"}</button>{editable && <button className="primary-button" disabled={busy || !draft.ready} onClick={() => void save()}>{busy ? "提交中…" : "提交修改并重新审核"}</button>}</div>
  </aside></div>;
}

function ArticleReview({ article, onClose, onChanged }: { article: Article; onClose: () => void; onChanged: () => void }): JSX.Element {
  const [status, setStatus] = useState("Draft"); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback((): void => { void window.publisherAPI.quality.status("article", article.id).then((state) => setStatus(state?.status ?? "Draft")); }, [article.id]);
  useEffect(load, [load]);
  const check = async (): Promise<void> => { setBusy(true); try { await window.publisherAPI.quality.recheck("article", article.id); await window.publisherAPI.quality.status("article", article.id).then((state) => setStatus(state?.status ?? "Draft")); setMessage("已完成内容检查，请确认是否通过。"); } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "内容检查失败"); } finally { setBusy(false); } };
  const decide = async (next: "Approved" | "Rejected"): Promise<void> => { setBusy(true); try { await window.publisherAPI.quality.decide("article", article.id, next, next === "Approved" ? "运营审核通过" : "运营审核未通过"); onChanged(); } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "审核结果保存失败"); } finally { setBusy(false); } };
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer v11-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">内容审核</span><h2>{article.title}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="v11-review-status"><span>当前状态</span><Status label={articleReviewLabel(status)} tone={articleReviewTone(status)} /></div><p className="v11-review-copy">确认标题、内容和企业表达无误后，再允许这篇文章进入发布。</p>{message && <div className="notice">{message}</div>}<div className="v11-review-actions"><button className="secondary-button" disabled={busy} onClick={() => void check()}>{busy ? "检查中…" : "重新检查"}</button><button className="secondary-button" disabled={busy} onClick={() => void decide("Rejected")}>需要修改</button><button className="primary-button" disabled={busy} onClick={() => void decide("Approved")}>审核通过</button></div></aside></div>;
}

function ExcelImportDialog({ preview, onClose, onDone }: { preview: ExcelImportPreview; onClose: () => void; onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [filter, setFilter] = useState<"ALL" | "VALID" | "DUPLICATE" | "ERROR" | "WARNING">("ALL");
  const confirm = async (): Promise<void> => { setBusy(true); try { const result = await window.publisherAPI.articles.confirmExcelImport(preview); setMessage(`已导入 ${result.imported} 篇文章${result.skippedDuplicates ? `，跳过 ${result.skippedDuplicates} 篇重复内容` : ""}`); onDone(); } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "导入未完成"); } finally { setBusy(false); } };
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
  const [assetReload, setAssetReload] = useState(0);
  const load = useCallback((): void => setAssetReload((current) => current + 1), []);
  useEffect(() => { let active = true; void window.publisherAPI.brands.list().then((items) => { if (!active) return; setBrands(items); setBrandId((current) => items.some((item) => item.id === current) ? current : (items[0]?.id ?? "")); }); return () => { active = false; }; }, [refreshKey]);
  useEffect(() => { if (!brandId) { setAssets([]); return; } let active = true; void window.publisherAPI.imageAssets.list({ brandId }).then((items) => { if (active) setAssets(items); }); return () => { active = false; }; }, [brandId, refreshKey, assetReload]);
  const resetEditor = (): void => { setFiles([]); setName(""); setBusiness([]); setCity([]); setUsage(["通用"]); setCustomTags([]); setCustomInput(""); setEditingAssetId(null); };
  const pick = async (): Promise<void> => { const selected = await window.publisherAPI.imageAssets.pickFiles(); if (selected.length) { resetEditor(); setFiles(selected); setName(selected.length === 1 ? (selected[0]?.split(/[\\/]/u).pop()?.replace(/\.[^.]+$/u, "") ?? "") : "批量图片"); } };
  const edit = (asset: ImageAsset): void => { setFiles([]); setEditingAssetId(asset.id); setName(asset.name); setBusiness(asset.business); setCity(asset.city); setUsage(asset.usage.length ? asset.usage : asset.tags.filter((tag) => usageTagDefaults.includes(tag))); setCustomTags(asset.tags.filter((tag) => !usageTagDefaults.includes(tag))); setCustomInput(""); };
  const save = async (): Promise<void> => { if (!brandId || (!files.length && !editingAssetId)) return; setBusy(true); try { if (editingAssetId) { await window.publisherAPI.imageAssets.update(editingAssetId, { name, tags: customTags, business, city, usage, universal: usage.includes("通用") }); setMessage("图片标签已保存，以后可继续选择这些自定义标签。"); } else { const imported = await window.publisherAPI.imageAssets.import({ brandId, sourcePaths: files, name: name.trim() || undefined, tags: customTags, business, city, usage, platform: [], universal: usage.includes("通用") }); setMessage(imported.some(asset => asset.duplicate) ? `该素材已存在；已复用 ${imported.filter(asset => asset.duplicate).length} 张，新增 ${imported.filter(asset => !asset.duplicate).length} 张` : `已上传并保存 ${imported.length} 张图片`); } resetEditor(); load(); refresh(); } catch (error) { setMessage(error instanceof Error ? productErrorMessage(error) : "图片保存失败"); } finally { setBusy(false); } };
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
    <section className="panel v11-image-upload"><div className="v11-image-upload-main"><label>企业<select value={brandId} disabled={busy} onChange={(event) => { setBrandId(event.target.value); resetEditor(); }}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.companyName || brand.name}</option>)}</select></label><span>已入库 {assets.length} 张图片</span></div></section>
    {(files.length > 0 || editorAsset) && <section className="panel v111-image-editor"><div className="v111-image-editor-preview">{editorAsset?.previewUrl || rawPreview ? <img src={editorAsset?.previewUrl || rawPreview} alt={name || "图片预览"} /> : <span>▧</span>}</div><div className="v111-image-editor-fields"><div className="panel-heading"><div><h3>{editorAsset ? "编辑图片标签" : `编辑待上传图片${files.length > 1 ? `（${files.length} 张）` : ""}`}</h3><span>不需要编辑 JSON；点击标签即可选择或取消。</span></div></div><label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="图片名称" /></label><TagPicker title="业务" options={businessOptions} selected={business} onToggle={(value) => toggleTag(setBusiness, value)} /><TagPicker title="地区" options={cityOptions} selected={city} onToggle={(value) => toggleTag(setCity, value)} /><TagPicker title="用途" options={usageOptions} selected={usage} onToggle={(value) => toggleTag(setUsage, value)} />{customOptions.length > 0 && <TagPicker title="自定义标签" options={customOptions} selected={customTags} onToggle={(value) => toggleTag(setCustomTags, value)} />}<div className="v111-custom-tag"><input value={customInput} onChange={(event) => setCustomInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomTag(); } }} placeholder="办公室、酒店、学校、新房、工厂" /><button className="secondary-button" type="button" onClick={addCustomTag}>+ 添加标签</button></div>{customTags.length > 0 && <div className="chip-select">{customTags.map((tag) => <button type="button" className="choice-chip selected" key={tag} onClick={() => toggleTag(setCustomTags, tag)}>{tag} ×</button>)}</div>}<div className="row-actions"><button className="secondary-button" onClick={resetEditor}>取消</button><button className="primary-button" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button></div></div></section>}
    <div className="v11-category-tabs">{imageCategories.map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {shown.length === 0 ? <section className="panel"><EmptyWorkspace title="图片库还是空的" description="先上传治理现场、检测设备或办公环境等企业图片。" action={<button className="secondary-button" onClick={() => void pick()}>选择图片</button>} /></section> : <section className="image-asset-grid v11-image-grid">{shown.map((asset) => <article className={`image-asset-card ${asset.enabled ? "" : "disabled"}`} key={asset.id}><div className="image-preview">{asset.previewUrl ? <img src={asset.previewUrl} alt={asset.name} /> : <span>▧</span>}</div><div className="image-asset-body"><strong>{asset.name}</strong><span>{[...asset.business, ...asset.city, ...asset.usage].slice(0, 4).join(" · ") || (asset.universal ? "通用图片" : "企业图片")}</span><small>{asset.width ?? "未知"} × {asset.height ?? "未知"} · {asset.mimeType} · {asset.usedByArticleCount ?? asset.useCount} 篇文章 / {asset.usedByJobCount ?? 0} 个任务 · {asset.enabled ? "可使用" : "已停用"}</small><small>平台尺寸合同未确认时显示未知；不推断最佳尺寸</small></div><div className="row-actions"><button className="mini-button" onClick={() => edit(asset)}>编辑</button><button className="mini-button" onClick={() => void toggle(asset)}>{asset.enabled ? "停用" : "启用"}</button><button className="mini-button danger-mini" onClick={() => void remove(asset)}>删除</button></div></article>)}</section>}
  </>;
}

export function V11Statistics({ refreshKey }: { refreshKey: number }): JSX.Element {
  const [articles, setArticles] = useState<Article[]>([]); const [jobs, setJobs] = useState<PublishJob[]>([]); const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { void Promise.all([window.publisherAPI.jobs.list(), window.publisherAPI.articles.list(), window.publisherAPI.accounts.list()]).then(([nextJobs, nextArticles, nextAccounts]) => { const operatingArticles = nextArticles.filter(isProductionArticle); const operatingIds = new Set(operatingArticles.map((article) => article.id)); setArticles(operatingArticles); setJobs(operatorOverviewJobs(nextJobs.filter((job) => operatingIds.has(job.articleId)))); setAccounts(operatorAccounts(nextAccounts)); }); }, [refreshKey]);
  const published = jobs.filter((job) => publishStatusLabel(job.status) === "已发布"); const needsAction = jobs.filter((job) => publishStatusLabel(job.status) === "需要处理");
  const platformRows = operatorStatisticsRows(jobs);
  return <><WorkspaceTitle eyebrow="数据统计" title="查看内容运营结果" description="用简单指标关注内容产出、账号状态和发布进度。" /><div className="stat-grid"><MetricCard label="今日已发布" value={published.filter((job) => isToday(job.finishedAt ?? job.createdAt)).length} hint="完成的平台发布" tone="green" icon="●" /><MetricCard label="待发布" value={jobs.filter((job) => ["待发布", "等待确认"].includes(publishStatusLabel(job.status))).length} hint="等待你确认或安排" tone="purple" icon="↗" /><MetricCard label="需要处理" value={needsAction.length} hint="建议优先检查" tone="orange" icon="!" /><MetricCard label="在线账号" value={accounts.filter(isOnlineAccount).length} hint={`今日内容 ${articles.filter((article) => isToday(article.generatedAt || article.createdAt)).length} 篇`} icon="◎" /></div><section className="panel table-panel"><div className="panel-heading"><div><h3>运营平台统计</h3><span>按产品平台顺序展示；历史隐藏平台仍保留在任务审计中。</span></div></div><div className="v11-platform-overview">{platformRows.map((row) => <div key={row.platformKey}><strong>{row.displayName}</strong><span>已发布 {row.publishedCount}</span><small>{row.statusLabel}</small></div>)}</div></section><section className="panel table-panel"><div className="panel-heading"><div><h3>最近完成的发布</h3><span>查看内容在各渠道的最新结果。</span></div></div>{published.length === 0 ? <EmptyWorkspace title="还没有完成的发布" description="审核通过后，在发布中心选择渠道即可开始。" /> : <div className="v11-recent-list">{published.slice(0, 12).map((job) => <div key={job.id}><strong>{platformLabel(job.platformKey)}</strong><span>{new Date(job.finishedAt ?? job.createdAt).toLocaleString("zh-CN")}</span><Status label="已发布" tone="success" /></div>)}</div>}</section></>;
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

export function V11AdvancedSettings({ onNavigate, developerMode, toggleDeveloperMode }: { onNavigate: (route: V11NavigationTarget) => void; developerMode: boolean; toggleDeveloperMode: () => Promise<void> }): JSX.Element {
  const items: Array<{ route: V11NavigationTarget; title: string; description: string }> = [
    { route: "platforms", title: "平台能力", description: "查看平台接入、能力状态和连接说明。" },
    { route: "self-test", title: "平台自测", description: "逐账号验证登录、编辑器、内容填充、草稿、真实发布与状态回查。" },
    { route: "logs", title: "运行日志", description: "排查错误并导出诊断信息。" },
    { route: "ai-center", title: "AI Provider Center", description: "管理服务商、模型和安全凭据。" },
    { route: "backups", title: "数据备份", description: "创建、校验和恢复本地数据备份。" },
    { route: "quality", title: "高级审核规则", description: "查看审核明细、规则和人工校准。" },
    { route: "assets", title: "视频素材", description: "管理视频文件及其发布前检查。" },
    { route: "queue", title: "发布任务与技术诊断", description: "查看发布任务、重试和异常处理。" },
    { route: "plans", title: "发布计划", description: "配置定时发布和内容排期。" },
    { route: "images-advanced", title: "图片高级标签", description: "按业务、城市和渠道维护图片匹配标签。" }
  ];
  return <><WorkspaceTitle eyebrow="高级功能" title="高级设置" description="日常运营不需要进入这里；这里只保留配置、诊断和专业管理工具。" /><button className="secondary-button" onClick={() => void window.publisherAPI.product.exportDiagnostics()}>导出脱敏 Diagnostic Bundle</button><label className="check-row"><input type="checkbox" checked={developerMode} onChange={() => void toggleDeveloperMode()} />Developer / Diagnostics Mode（默认关闭，仍受 Main 发布门禁约束）</label><section className="v11-advanced-grid">{items.filter(item => developerMode || ["ai-center", "backups", "images-advanced"].includes(item.route)).map((item) => <button className="panel v11-advanced-card" key={item.route} onClick={() => onNavigate(item.route)}><strong>{item.title}</strong><span>{item.description}</span><em>打开 →</em></button>)}</section></>;
}

