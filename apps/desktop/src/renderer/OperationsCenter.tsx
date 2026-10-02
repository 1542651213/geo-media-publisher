import { AIWorkloadNotice } from "./AIWorkloadNotice";
import type { AIWorkloadPreview } from "../shared/ai-request-budget";
import { AccountOwnershipReview } from "./AccountOwnershipReview";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { PublishJob } from "@publisher/domain";
import type {
  ContentPlanItem,
  OperationsApi,
  OperationsFact,
  OperationsGenerationItem,
  OperationsGenerationQueue,
  OperationsImportMapping,
  OperationsImportPreview,
  OperationsOwnerAction,
  OperationsPlanStatus,
  OperationsReviewItem,
  OperationsSnapshot,
  OperationsStudioDefaults,
  OperationsUsageRow,
} from "../shared/content-operations";
import type { ProductHealthStatus } from "../shared/product-platform-policy";
import { platformLabel, publishStatusLabel, publishStatusTone } from "./v11-ui-model";
import {
  advanceWorkspaceRequest,
  startOperationsQueueRefresh, canonicalStudioTargets,
  factExpiryIso,
  generationProgressPercent,
  initialOperationsUiState,
  isValidGenerationCount,
  isCurrentWorkspaceResponse,
  operationsHealthPresentation,
  operationsPage,
  operationsPlatformOptions,
  planMatchesStatus,
  planDraftBody,
  planStatusLabel,
  preparePlanAndNavigate,
  queueActionAvailability,
  transitionAndRunGenerationQueue,
  type OperationsTab,
  type WorkspaceRequestToken,
} from "./operations-center-ui";
import "./operations-center.css";

type DateRange = 1 | 7 | 30;

interface PlatformHealthRow {
  platformKey: string;
  status: ProductHealthStatus;
  message: string;
}

interface PublishBoardRow {
  id: string;
  title: string;
  platform: string;
  account: string;
  date: string;
  status: PublishJob["status"];
  ownerActionRequired: boolean;
}

interface OperationsViewSnapshot extends OperationsSnapshot {
  platformHealth: PlatformHealthRow[];
  publishBoard: PublishBoardRow[];
  providers: Array<{ id: string; name: string; models: string[]; configured: boolean }>;
  templates: Array<{ id: string; name: string }>;
}

type RendererOperationsApi = OperationsApi & {
  pickImportFile(): Promise<{ fileName: string; columns: string[]; rows: Array<Record<string, string>> } | null>;
};

const tabs: Array<{ id: OperationsTab; label: string }> = [
  { id: "today", label: "今日工作台" },
  { id: "review", label: "内容审核" },
  { id: "queue", label: "草稿生成队列" },
  { id: "plan", label: "内容计划" },
  { id: "facts", label: "事实资料库" },
  { id: "usage", label: "AI 用量" },
  { id: "import", label: "批量导入" },
  { id: "owner", label: "Owner 处理" },
  { id: "publish", label: "发布看板" },
];

const emptySnapshot: OperationsViewSnapshot = {
  companyId: "", accounts: [], review: [], plans: [], generationQueues: [], generationItems: [], facts: [], usage: [], ownerActions: [],
  studioDefaults: { companyId: "", profileId: null, model: null, templateId: null, templateVersion: null, purpose: "生成文章", targetPlatforms: ["douyin"], updatedAt: null },
  dashboard: { pendingReview: 0, approved: 0, draftPlansToday: 0, generating: 0, failed: 0, needsOwnerAction: 0, todayPublished: 0 },
  platformHealth: [], publishBoard: [], providers: [], templates: [],
};

const contentTypes = ["行业科普", "FAQ", "现场案例", "公司介绍", "GEO/SEO", "服务流程", "避坑", "季节性内容"];
const factCategories = ["公司信息", "主营业务", "服务地区", "联系方式", "服务承诺", "资质", "案例", "价格规则", "售后政策"];

function operationsApi(): RendererOperationsApi {
  return (window.publisherAPI as unknown as { operations: RendererOperationsApi }).operations;
}

const importFields: Array<{ key: keyof OperationsImportMapping; label: string; required: boolean }> = [
  { key: "title", label: "标题", required: true }, { key: "body", label: "正文", required: true }, { key: "summary", label: "摘要", required: false },
  { key: "company", label: "企业", required: false }, { key: "business", label: "业务", required: false }, { key: "city", label: "城市", required: false },
  { key: "keywords", label: "关键词", required: false }, { key: "tags", label: "标签", required: false }, { key: "targetPlatforms", label: "目标平台", required: false },
  { key: "contentType", label: "内容类型", required: false }, { key: "promotionStrength", label: "推广强度", required: false }, { key: "sourceNote", label: "来源说明", required: false },
  { key: "templateVersion", label: "模板版本", required: false },
];

function guessedImportMapping(columns: string[]): OperationsImportMapping {
  const find = (...names: string[]): string => columns.find(column => names.some(name => column.trim().toLowerCase() === name.toLowerCase())) ?? "";
  return { title: find("title", "标题"), body: find("body", "正文", "内容"), summary: find("summary", "摘要"), company: find("company", "企业", "公司"), business: find("business", "业务"), city: find("city", "城市"), keywords: find("keywords", "关键词"), tags: find("tags", "标签"), targetPlatforms: find("targetPlatforms", "目标平台"), contentType: find("contentType", "内容类型"), promotionStrength: find("promotionStrength", "推广强度"), sourceNote: find("sourceNote", "来源说明"), templateVersion: find("templateVersion", "模板版本") };
}

function dateText(value: string | null): string {
  if (!value) return "尚未记录";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN");
}

function platformNames(values: readonly string[]): string {
  return values.map(platformLabel).join("、");
}

function statusTone(status: string): string {
  const normalized = status.toUpperCase();
  if (["READY", "APPROVED", "COMPLETED", "PUBLISHED", "SUCCESS"].includes(normalized)) return "success";
  if (["FAILED", "CREDENTIAL_INVALID", "NEEDS_LOGIN", "CANCELLED"].includes(normalized)) return "danger";
  if (["RUNNING", "PUBLISHING", "CHECKING"].includes(normalized)) return "purple";
  if (["PAUSED", "NEEDS_REVIEW", "NEEDS_USER_ACTION", "NEEDSRECONCILIATION"].includes(normalized)) return "warning";
  return "muted";
}

function Status({ label, status, tone }: { label: string; status: string; tone?: string }): JSX.Element {
  return <span className={`status-pill ${tone ?? statusTone(status)}`}>{label}</span>;
}

function Empty({ title, description }: { title: string; description: string }): JSX.Element {
  return <div className="operations-empty"><strong>{title}</strong><p>{description}</p></div>;
}

function PlatformChecks({ values, onChange, disabled = false }: { values: string[]; onChange: (next: string[]) => void; disabled?: boolean }): JSX.Element {
  return <div className="operations-checks">{operationsPlatformOptions.map(platform => <label key={platform}>
    <input type="checkbox" disabled={disabled} checked={values.includes(platform)} onChange={event => onChange(event.target.checked ? [...values, platform] : values.filter(item => item !== platform))} />
    <span>{platformLabel(platform)}</span>
  </label>)}</div>;
}

export interface OperationsCenterProps {
  companyId: string;
  initialTab?: OperationsTab;
  onNavigate?: (route: string) => void;
  refresh?: () => void;
}

export function OperationsCenter({ companyId, initialTab = "today", onNavigate, refresh }: OperationsCenterProps): JSX.Element {
  const [tab, setTab] = useState<OperationsTab>(initialTab);
  const [snapshot, setSnapshot] = useState<OperationsViewSnapshot>(emptySnapshot);
  const [uiState, setUiState] = useState(() => initialOperationsUiState(companyId));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [importPreview, setImportPreview] = useState<OperationsImportPreview | null>(null);
  const requestToken = useRef<WorkspaceRequestToken>(advanceWorkspaceRequest(undefined, companyId));

  const load = async (token: WorkspaceRequestToken): Promise<void> => {
    setLoading(true);
    try {
      const [next, profiles, templates, articles, jobs, productHealth] = await Promise.all([
        operationsApi().snapshot(token.companyId),
        window.publisherAPI.aiCenter.profiles(),
        window.publisherAPI.aiCenter.templates(),
        window.publisherAPI.articles.list({ brandId: token.companyId }),
        window.publisherAPI.jobs.list(),
        window.publisherAPI.product.health(),
      ]);
      if (isCurrentWorkspaceResponse(requestToken.current, token)) {
        const articleById = new Map(articles.map(article => [article.id, article]));
        const accountById = new Map(next.accounts.map(account => [account.accountId, account]));
        const boundAccountIds = new Set(next.accounts.map(account => account.accountId));
        const relevantHealth = productHealth.filter(row => row.accountId && boundAccountIds.has(row.accountId));
        const platformHealth: PlatformHealthRow[] = relevantHealth.map(row => ({
          platformKey: row.platformKey,
          status: row.status,
          message: `${row.accountName} · ${row.ownerNextAction}`,
        }));
        const publishBoard = jobs.filter(job => articleById.has(job.articleId)).map(job => ({
          id: job.id,
          title: articleById.get(job.articleId)?.title ?? "未命名内容",
          platform: job.platformKey,
          account: accountById.get(job.accountId)?.accountAlias ?? accountById.get(job.platformAccountId)?.accountAlias ?? "历史账号",
          date: job.finishedAt ?? job.startedAt ?? job.createdAt,
          status: job.status,
          ownerActionRequired: job.status === "NeedsUserAction" || job.status === "NeedsReconciliation",
        }));
        setSnapshot({
          ...next,
          platformHealth,
          publishBoard,
          providers: profiles.map(profile => ({ id: profile.id, name: profile.displayName, models: [profile.defaultModel], configured: profile.configured })),
          templates: templates.filter(template => template.enabled).map(template => ({ id: `${template.templateId}@${template.version}`, name: `${template.name} · v${template.version}` })),
        });
      }
    } catch (error) {
      if (isCurrentWorkspaceResponse(requestToken.current, token)) setMessage(error instanceof Error ? error.message : "运营数据暂时无法读取");
    } finally {
      if (isCurrentWorkspaceResponse(requestToken.current, token)) setLoading(false);
    }
  };

  useEffect(() => {
    const token = advanceWorkspaceRequest(requestToken.current, companyId);
    requestToken.current = token;
    setUiState(initialOperationsUiState(companyId));
    setSnapshot(emptySnapshot);
    setImportPreview(null);
    setMessage("");
    setTab(initialTab);
    if (!companyId) { setLoading(false); return; }
    void load(token);
  }, [companyId, initialTab]);

  const queueRefresh=useRef<()=>Promise<unknown>>(async()=>undefined);
  queueRefresh.current=async()=>{if(!busy)await load(requestToken.current);};
  const activeGeneration=snapshot.generationQueues.some(queue=>queue.status==="Pending"||queue.status==="Running");
  useEffect(()=>{
    if(!activeGeneration)return;
    return startOperationsQueueRefresh(()=>queueRefresh.current());
  },[companyId,activeGeneration]);

  const reload = async (): Promise<void> => {
    const token = advanceWorkspaceRequest(requestToken.current, companyId);
    requestToken.current = token;
    await load(token);
    refresh?.();
  };

  const act = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  };

  if (!companyId) return <div className="operations-center"><Empty title="请先选择当前企业" description="内容运营数据、草稿和账号会按当前企业隔离。" /></div>;

  return <div className="operations-center">
    <header className="operations-title">
      <div><span>内容运营</span><h2>{tabs.find(item => item.id === tab)?.label}</h2><p>当前企业范围内规划、生成并审核草稿；正式发布仍在发布中心逐项确认。</p></div>
      <button className="secondary-button" disabled={loading || busy} onClick={() => void reload()}>{loading ? "正在刷新…" : "刷新"}</button>
    </header>
    <nav className="operations-tabs" aria-label="内容运营功能">{tabs.map(item => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} disabled={busy} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {message && <div className="notice" role="status">{message}</div>}
    {tab === "today" && <TodayTab snapshot={snapshot} onNavigate={onNavigate} onTab={setTab} />}
    {tab === "review" && <ReviewTab rows={snapshot.review} busy={busy} selectedId={uiState.selectedReviewId} onSelect={id => setUiState(current => ({ ...current, selectedReviewId: id }))} onNavigate={onNavigate} onReview={(row, action) => act(() => operationsApi().reviewArticle({ companyId, articleId: row.articleId, action, expectedContentHash: row.contentHash }), action === "approve" ? "内容已审核通过。" : action === "return_to_draft" ? "内容已退回草稿。" : "内容已归档。") } />}
    {tab === "queue" && <QueueTab rows={snapshot.generationQueues} items={snapshot.generationItems} providers={snapshot.providers} templates={snapshot.templates} defaults={snapshot.studioDefaults} busy={busy} companyId={companyId} onAction={act} />}
    {tab === "plan" && <PlanTab rows={snapshot.plans} busy={busy} companyId={companyId} onNavigate={onNavigate} onAction={act} />}
    {tab === "facts" && <FactsTab rows={snapshot.facts} busy={busy} companyId={companyId} onAction={act} />}
    {tab === "usage" && <UsageTab companyId={companyId} initialRows={snapshot.usage} />}
    {tab === "import" && <ImportTab companyId={companyId} busy={busy} preview={importPreview} onPreview={preview => { setImportPreview(preview); setUiState(current => ({ ...current, importFileName: preview?.fileName ?? "", importPreviewReady: Boolean(preview) })); }} onMessage={setMessage} onReload={reload} />}
    {tab === "owner" && <OwnerTab rows={snapshot.ownerActions} companyId={companyId} busy={busy} onNavigate={onNavigate} onAction={act} />}
    {tab === "publish" && <PublishTab rows={snapshot.publishBoard} companyId={companyId} />}
  </div>;
}

function TodayTab({ snapshot, onNavigate, onTab }: { snapshot: OperationsViewSnapshot; onNavigate?: (route: string) => void; onTab: (tab: OperationsTab) => void }): JSX.Element {
  const metrics = [
    ["待审核", snapshot.dashboard.pendingReview, "review"], ["待发布", snapshot.dashboard.approved, "publish"], ["今日已发布", snapshot.dashboard.todayPublished, "publish"],
    ["生成中", snapshot.dashboard.generating, "queue"], ["失败", snapshot.dashboard.failed, "queue"], ["需要 Owner 处理", snapshot.dashboard.needsOwnerAction, "owner"],
  ] as const;
  return <>
    <section className="operations-metrics">{metrics.map(([label, value, target]) => <button type="button" key={label} onClick={() => onTab(target)}><span>{label}</span><strong>{value}</strong><em>查看详情</em></button>)}</section>
    <div className="operations-two-column">
      <section className="panel operations-panel"><div className="panel-heading"><div><h3>平台状态</h3><span>展示最近一次可信检查结果；未知状态不会被当成已登录。</span></div></div>
        {snapshot.platformHealth.length === 0 ? <Empty title="暂无实时平台状态" description="当前企业没有可关联的实时账号健康结果；不会使用持久化登录标记代替身份核验。" /> : <div className="operations-list">{snapshot.platformHealth.map(row => { const presentation = operationsHealthPresentation(row.status); return <div key={`${row.platformKey}-${row.message}`}><div><strong>{platformLabel(row.platformKey)}</strong><span>{row.message}</span></div><Status label={presentation.label} status={row.status} tone={presentation.tone} /></div>; })}</div>}
      </section>
      <section className="panel operations-panel"><div className="panel-heading"><div><h3>快捷操作</h3><span>所有生成和导入操作只产生草稿。</span></div></div><div className="operations-shortcuts">
        <button className="primary-button" onClick={() => onTab("queue")}>生成今日内容</button>
        <button className="secondary-button" onClick={() => onTab("review")}>审核草稿</button>
        <button className="secondary-button" onClick={() => onTab("plan")}>查看内容计划</button>
        <button className="secondary-button" disabled={!onNavigate} title={onNavigate ? "" : "当前容器未提供页面导航"} onClick={() => onNavigate?.("publishing")}>进入发布中心</button>
      </div></section>
    </div>
  </>;
}

function ReviewTab({ rows, busy, selectedId, onSelect, onNavigate, onReview }: { rows: OperationsReviewItem[]; busy: boolean; selectedId: string; onSelect: (id: string) => void; onNavigate?: (route: string) => void; onReview: (row: OperationsReviewItem, action: "approve" | "return_to_draft" | "archive") => Promise<void> }): JSX.Element {
  const [page, setPage] = useState(1);
  const view = operationsPage(rows, page);
  return <section className="panel operations-panel"><div className="panel-heading"><div><h3>内容审核队列</h3><span>AI 草稿必须人工审核；编辑内容后需要重新审核。</span></div></div>
    {rows.length === 0 ? <Empty title="没有待处理内容" description="新生成或退回的草稿会出现在这里。" /> : <div className="operations-table operations-review-table"><div className="operations-table-head"><span>内容</span><span>来源</span><span>目标平台</span><span>状态与提醒</span><span>操作</span></div>{view.items.map(row => <div className={selectedId === row.articleId ? "operations-table-row selected" : "operations-table-row"} key={row.articleId} onClick={() => onSelect(row.articleId)}>
      <div><strong>{row.title}</strong><small>{dateText(row.createdAt)}</small></div><div><span>{row.source}</span><small>{row.aiGenerated ? "AI 生成" : "人工创建"}</small></div><span>{platformNames(row.targetPlatforms) || "尚未指定"}</span><div><Status label={row.reviewStatus} status={row.reviewStatus} />{row.validationWarnings.map(item => <small className="operations-warning" key={item}>{item}</small>)}</div><div className="operations-actions"><button className="mini-button" disabled={busy} onClick={event => { event.stopPropagation(); void onReview(row, "approve"); }}>通过</button><button className="mini-button" disabled={busy} onClick={event => { event.stopPropagation(); void onReview(row, "return_to_draft"); }}>退回草稿</button><button className="mini-button" disabled={busy || !onNavigate} title={onNavigate ? "将在文章库中打开当前企业内容" : "当前容器未提供文章编辑导航"} onClick={event => { event.stopPropagation(); onNavigate?.("articles"); }}>编辑</button><button className="mini-button" disabled={busy} onClick={event => { event.stopPropagation(); void onReview(row, "archive"); }}>归档</button></div>
    </div>)}</div>}
    <OperationsPagination view={view} onPage={setPage} />
  </section>;
}

function QueueTab({ rows, items, providers, templates, defaults, busy, companyId, onAction }: { rows: OperationsGenerationQueue[]; items: OperationsGenerationItem[]; providers: OperationsViewSnapshot["providers"]; templates: OperationsViewSnapshot["templates"]; defaults: OperationsStudioDefaults; busy: boolean; companyId: string; onAction: (action: () => Promise<unknown>, success: string) => Promise<void> }): JSX.Element {
  const [providerId, setProviderId] = useState(""), [model, setModel] = useState(""), [templateId, setTemplateId] = useState(""), [topic, setTopic] = useState(""), [count, setCount] = useState(1), [concurrency, setConcurrency] = useState(1), [targets, setTargets] = useState<string[]>(["douyin"]);
  const defaultTargetsKey = canonicalStudioTargets(defaults.targetPlatforms).join("|");
  useEffect(() => {
    setProviderId(defaults.profileId ?? ""); setModel(defaults.model ?? ""); setTemplateId(defaults.templateId ? `${defaults.templateId}@${defaults.templateVersion ?? 1}` : "");
    setTopic(""); setCount(1); setConcurrency(1); setTargets(defaultTargetsKey ? defaultTargetsKey.split("|") : ["douyin"]);
  }, [companyId, defaults.profileId, defaults.model, defaults.templateId, defaults.templateVersion, defaultTargetsKey, defaults.updatedAt]);
  const [workload,setWorkload]=useState<AIWorkloadPreview|null>(null);
  useEffect(()=>setWorkload(null),[companyId,providerId,model,templateId,topic,count,targets]);
  const queueRequest=()=>{const [templateKey,versionText]=templateId.split("@");return{companyId,profileId:providerId,model:model.trim(),templateId:templateKey||templateId,templateVersion:Number(versionText)||1,topic:topic.trim(),requestedCount:count,targetPlatforms:canonicalStudioTargets(targets),concurrency:1};};
  const provider = providers.find(item => item.id === providerId);
  const canStart = Boolean(provider?.configured && model.trim() && templateId && topic.trim() && targets.length && isValidGenerationCount(count) && concurrency > 0);
  return <div className="operations-stack"><section className="panel operations-panel operations-form"><div className="panel-heading"><div><h3>新建草稿生成队列</h3><span>并发有上限；服务商未配置时不会发起请求，任何结果都不会自动发布。</span></div></div><div className="operations-form-grid">
    <label>服务商<select value={providerId} disabled={busy} onChange={event => { const id = event.target.value; setProviderId(id); setModel(providers.find(item => item.id === id)?.models[0] ?? ""); }}><option value="">请选择</option>{providers.map(item => <option key={item.id} value={item.id}>{item.name}{item.configured ? "" : "（未配置）"}</option>)}</select></label>
    <label>模型<input list="operations-models" value={model} disabled={busy || !providerId} onChange={event => setModel(event.target.value)} /><datalist id="operations-models">{provider?.models.map(item => <option value={item} key={item} />)}</datalist></label>
    <label>模板<select value={templateId} disabled={busy} onChange={event => setTemplateId(event.target.value)}><option value="">请选择</option>{templates.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label>主题<input value={topic} disabled={busy} onChange={event => setTopic(event.target.value)} placeholder="例如：甲醛治理常见问题" /></label>
    <label>草稿数量<input type="number" min={1} max={20} value={count} disabled={busy} onChange={event => setCount(Number(event.target.value))} /></label>
    <label>并发数<input type="number" min={1} max={1} value={concurrency} disabled title="当前版本按企业串行执行，避免重复生成和服务商请求风暴" onChange={event => setConcurrency(Number(event.target.value))} /><small>当前版本按企业串行执行（1）</small></label>
  </div><div><strong className="operations-field-title">目标平台</strong><PlatformChecks values={targets} disabled={busy} onChange={setTargets}/></div><button className="secondary-button" disabled={busy||!provider||!model.trim()||!templateId||!topic.trim()||!targets.length||!isValidGenerationCount(count)} onClick={()=>void onAction(async()=>{setWorkload(await operationsApi().previewGenerationQueue(queueRequest()));},"工作量预览已保存，尚未发起请求。")}>预览 AI 工作量</button>{workload&&<AIWorkloadNotice preview={workload}/>}<button className="primary-button" disabled={busy||!canStart||!workload} onClick={()=>void onAction(async()=>{if(!workload)throw new Error("请先预览工作量");const request=queueRequest();const queue=await operationsApi().createGenerationQueue({...request,previewId:workload.previewId});void operationsApi().runGenerationQueue({companyId,queueId:queue.id}).catch(()=>undefined);setTopic("");setWorkload(null);},"请求预算已确认，草稿队列正在后台启动。")}>确认预算并开始生成草稿</button>
  </section><section className="panel operations-panel"><div className="panel-heading"><div><h3>队列状态</h3><span>失败重试只重新生成失败草稿；结果不确定的请求必须人工选择重试或取消。</span></div></div>{rows.length === 0 ? <Empty title="还没有生成队列" description="填写上方配置后可创建第一个草稿队列。" /> : <div className="operations-card-list">{rows.map(row => { const queueItems = items.filter(item => item.queueId === row.id); const validationBlocked = queueItems.filter(item => item.status === "Blocked" && item.errorCode === "CONTENT_VALIDATION_REQUIRED"); const allowed = queueActionAvailability(row.status, validationBlocked.length > 0); const recoverable = queueItems.filter(item => item.status === "Recoverable"); return <article key={row.id}><div><strong>{row.topic}</strong><span>{row.provider} · {row.model} · {row.templateId}@{row.templateVersion}</span><small>{platformNames(row.targetPlatforms)} · 串行执行 · 更新于 {dateText(row.updatedAt)}</small></div><div className="operations-progress"><span style={{ width: `${generationProgressPercent(row.id, row.completedCount, items)}%` }} /></div><div className="operations-queue-counts"><span>{row.completedCount}/{queueItems.length} 项完成</span><span>{row.failedCount} 失败</span><span>请求 {row.issuedRequests??0}/{row.maxRequests??0} · 全局并发 1</span><Status label={row.status} status={row.status} /></div><div className="operations-actions"><button className="mini-button" disabled={busy || !allowed.pause} title={allowed.pause ? "" : "仅运行中的队列可暂停"} onClick={() => void onAction(() => operationsApi().pauseGenerationQueue({ companyId, queueId: row.id }), "队列已暂停。")} >暂停</button><button className="mini-button" disabled={busy || !allowed.resume} title={allowed.resume ? "" : "仅暂停的队列可恢复"} onClick={() => void onAction(() => transitionAndRunGenerationQueue(() => operationsApi().resumeGenerationQueue({ companyId, queueId: row.id }), () => operationsApi().runGenerationQueue({ companyId, queueId: row.id })), "队列已恢复，正在后台运行。")}>恢复</button><button className="mini-button" disabled={busy || !allowed.cancel} title={allowed.cancel ? "" : "当前状态不能取消"} onClick={() => void onAction(() => operationsApi().cancelGenerationQueue({ companyId, queueId: row.id }), "队列已取消。")}>取消</button><button className="mini-button" disabled={busy || !allowed.retryFailed} title={validationBlocked.length ? "内容校验红项必须单独重新生成或取消" : allowed.retryFailed ? "" : "当前队列没有普通失败项；结果不确定项需单独确认"} onClick={() => void onAction(() => transitionAndRunGenerationQueue(() => operationsApi().retryFailedGeneration({ companyId, queueId: row.id }), () => operationsApi().runGenerationQueue({ companyId, queueId: row.id })), "失败草稿已进入后台重试。")}>重试失败项</button></div>{row.status === "Pending" && <button className="mini-button" disabled={busy} onClick={() => void onAction(() => transitionAndRunGenerationQueue(async () => undefined, () => operationsApi().runGenerationQueue({ companyId, queueId: row.id })), "已按剩余确认预算在后台继续生成；可暂停或取消。")}>继续剩余预算生成</button>}{(validationBlocked.length > 0 || recoverable.length > 0) && <div className="operations-recoverable"><span>已在 AI Studio 修正并保存内容时，可重新核对保存结果。</span><button className="mini-button" disabled={busy} onClick={() => void onAction(() => operationsApi().reconcileGenerationQueue({ companyId, queueId: row.id }), "已重新对账；尚未发起请求。核对剩余预算后可继续生成。")}>已在 AI Studio 修正并保存，重新对账</button></div>}{recoverable.map(item => <div className="operations-recoverable" key={item.id}><span>第 {item.sourceIndex + 1} 条 · {platformLabel(item.targetPlatform)}：上次请求结果不确定</span><div className="operations-actions"><button className="mini-button" disabled={busy} onClick={() => void onAction(() => transitionAndRunGenerationQueue(() => operationsApi().resolveRecoverableGeneration({ companyId, queueId: row.id, itemId: item.id, decision: "retry" }), () => operationsApi().runGenerationQueue({ companyId, queueId: row.id })), "该项已由人工确认并在后台重试。")}>确认重试</button><button className="mini-button" disabled={busy} onClick={() => void onAction(() => operationsApi().resolveRecoverableGeneration({ companyId, queueId: row.id, itemId: item.id, decision: "cancel" }), "该不确定项已取消。")}>取消该项</button></div></div>)}{validationBlocked.map(item => <div className="operations-recoverable operations-validation" key={item.id}><span>第 {item.sourceIndex + 1} 条 · {platformLabel(item.targetPlatform)}：内容校验未通过，需要人工决定</span><div className="operations-actions"><button className="mini-button" disabled={busy} onClick={() => void onAction(() => transitionAndRunGenerationQueue(() => operationsApi().resolveValidationGeneration({ companyId, queueId: row.id, itemId: item.id, decision: "regenerate" }), () => operationsApi().runGenerationQueue({ companyId, queueId: row.id })), "该内容校验项已进入后台重新生成。")}>明确重新生成</button><button className="mini-button" disabled={busy} onClick={() => void onAction(() => operationsApi().resolveValidationGeneration({ companyId, queueId: row.id, itemId: item.id, decision: "cancel" }), "该内容校验项已取消。")}>取消该项</button></div></div>)}</article>; })}</div>}</section></div>;
}

function PlanTab({ rows, busy, companyId, onNavigate, onAction }: { rows: ContentPlanItem[]; busy: boolean; companyId: string; onNavigate?: (route: string) => void; onAction: (action: () => Promise<unknown>, success: string) => Promise<void> }): JSX.Element {
  const [view, setView] = useState<"calendar" | "list">("calendar"), [period, setPeriod] = useState<"today" | "week" | "month">("week"), [platform, setPlatform] = useState(""), [status, setStatus] = useState<OperationsPlanStatus | "">(""), [date, setDate] = useState(new Date().toISOString().slice(0, 10)), [topic, setTopic] = useState(""), [contentType, setContentType] = useState(contentTypes[0]!), [targets, setTargets] = useState<string[]>([]), [planTargets, setPlanTargets] = useState<string[]>(["douyin", "website", "toutiao"]);
  useEffect(() => { setTopic(""); setTargets([]); setPlanTargets(["douyin", "website", "toutiao"]); setPlatform(""); setStatus(""); }, [companyId]);
  const now = new Date(); const today = now.toISOString().slice(0, 10); const end = new Date(now); end.setDate(end.getDate() + (period === "today" ? 0 : period === "week" ? 7 : 31));
  const filtered = rows.filter(row => row.date >= today && row.date <= end.toISOString().slice(0, 10) && (!platform || row.targetPlatforms.includes(platform)) && planMatchesStatus(row.status, status));
  return <div className="operations-stack"><section className="panel operations-panel"><div className="panel-heading"><div><h3>内容日历</h3><span>7/30 天计划只创建计划项和草稿，不创建定时发布任务。</span></div><div className="operations-actions"><button className={view === "calendar" ? "mini-button active" : "mini-button"} onClick={() => setView("calendar")}>日历</button><button className={view === "list" ? "mini-button active" : "mini-button"} onClick={() => setView("list")}>列表</button></div></div><div className="operations-toolbar"><select value={period} onChange={event => setPeriod(event.target.value as typeof period)}><option value="today">今天</option><option value="week">本周</option><option value="month">本月</option></select><select value={platform} onChange={event => setPlatform(event.target.value)}><option value="">全部平台</option>{operationsPlatformOptions.map(item => <option value={item} key={item}>{platformLabel(item)}</option>)}</select><select value={status} onChange={event => setStatus(event.target.value as OperationsPlanStatus | "")}><option value="">全部状态</option>{[...new Set(rows.map(item => item.status))].map(item => <option value={item} key={item}>{planStatusLabel(item)}</option>)}</select><button className="secondary-button" disabled={busy || planTargets.length === 0} title={planTargets.length ? "" : "请先选择计划目标平台"} onClick={() => void onAction(() => operationsApi().generatePlan({ companyId, days: 7, startDate: today, targetPlatforms: planTargets }), "7 天内容计划已生成。")}>生成 7 天计划</button><button className="secondary-button" disabled={busy || planTargets.length === 0} title={planTargets.length ? "" : "请先选择计划目标平台"} onClick={() => void onAction(() => operationsApi().generatePlan({ companyId, days: 30, startDate: today, targetPlatforms: planTargets }), "30 天内容计划已生成。")}>生成 30 天计划</button></div><div><strong className="operations-field-title">计划目标平台</strong><PlatformChecks values={planTargets} onChange={setPlanTargets} disabled={busy} /></div>
    {filtered.length === 0 ? <Empty title="当前范围没有计划" description="可生成 7/30 天计划，或在下方手工新增。" /> : <div className={view === "calendar" ? "operations-calendar" : "operations-card-list"}>{filtered.map(row => <article key={row.id}><time>{row.date}</time><div><strong>{row.topic}</strong><span>{row.contentType} · {platformNames(row.targetPlatforms) || "未指定平台"}</span></div><Status label={planStatusLabel(row.status)} status={row.status} /><div className="operations-actions"><button className="mini-button" disabled={busy || Boolean(row.articleId)} title={row.articleId ? "该计划已有草稿" : ""} onClick={() => void onAction(() => operationsApi().createDraftFromPlan({ companyId, planId: row.id, title: row.topic, body: planDraftBody(row.topic, row.contentType) }), "已创建待编辑草稿。")}>创建草稿</button><button className="mini-button" disabled={busy || !onNavigate} title={!onNavigate ? "当前容器未提供 AI Studio 导航" : row.articleId ? "复用现有计划草稿并进入 AI Content Studio" : "准备计划上下文后进入 AI Content Studio"} onClick={() => void onAction(() => preparePlanAndNavigate(() => operationsApi().preparePlanGeneration({ companyId, planId: row.id }), () => onNavigate?.("production")), "计划已准备到 AI Content Studio。")}>使用 AI 生成</button><button className="mini-button" disabled={!row.articleId || !onNavigate} title={!row.articleId ? "该计划尚未创建草稿" : !onNavigate ? "当前容器未提供文章导航" : "将在文章库中打开当前企业内容"} onClick={() => row.articleId && onNavigate?.("articles")}>打开现有草稿</button></div></article>)}</div>}
  </section><section className="panel operations-panel operations-form"><div className="panel-heading"><div><h3>手工计划项</h3><span>补充一个明确日期、类型和目标平台的内容计划。</span></div></div><div className="operations-form-grid"><label>日期<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>内容类型<select value={contentType} onChange={event => setContentType(event.target.value)}>{contentTypes.map(item => <option key={item}>{item}</option>)}</select></label><label className="operations-span-two">主题<input value={topic} onChange={event => setTopic(event.target.value)} /></label></div><PlatformChecks values={targets} onChange={setTargets} disabled={busy} /><button className="primary-button" disabled={busy || !date || !topic.trim() || targets.length === 0} title={!date || !topic.trim() || targets.length === 0 ? "请填写日期、主题并选择至少一个平台" : ""} onClick={() => void onAction(() => operationsApi().createPlanItem({ companyId, date, topic: topic.trim(), contentType, targetPlatforms: targets }), "计划项已保存。").then(() => setTopic(""))}>保存计划项</button></section></div>;
}

function FactsTab({ rows, busy, companyId, onAction }: { rows: OperationsFact[]; busy: boolean; companyId: string; onAction: (action: () => Promise<unknown>, success: string) => Promise<void> }): JSX.Element {
  const [category, setCategory] = useState(factCategories[0]!), [statement, setStatement] = useState(""), [source, setSource] = useState<OperationsFact["source"]>("Manual"), [sourceDate, setSourceDate] = useState(""), [expiresAt, setExpiresAt] = useState(""), [approvedForAI, setApprovedForAI] = useState(false), [notes, setNotes] = useState("");
  useEffect(() => { setStatement(""); setSource("Manual"); setSourceDate(""); setExpiresAt(""); setApprovedForAI(false); setNotes(""); }, [companyId]);
  return <div className="operations-stack"><section className="panel operations-panel operations-form"><div className="panel-heading"><div><h3>新增事实</h3><span>只有已批准且未过期的事实可注入 AI；过期事实保留并显示提醒。</span></div></div><div className="operations-form-grid"><label>类别<select value={category} onChange={event => setCategory(event.target.value)}>{factCategories.map(item => <option key={item}>{item}</option>)}</select></label><label>来源<select value={source} onChange={event => setSource(event.target.value as OperationsFact["source"])}>{["Manual", "Company Profile", "Internal Document", "Published Website", "Verified Case"].map(item => <option key={item}>{item}</option>)}</select></label><label>来源日期<input type="date" value={sourceDate} onChange={event => setSourceDate(event.target.value)} /></label><label>有效期至<input type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label><label className="operations-span-two">事实陈述<textarea rows={3} value={statement} onChange={event => setStatement(event.target.value)} /></label><label className="operations-span-two">备注<textarea rows={2} value={notes} onChange={event => setNotes(event.target.value)} /></label></div><label className="operations-checkbox"><input type="checkbox" checked={approvedForAI} onChange={event => setApprovedForAI(event.target.checked)} />已核准供 AI 使用</label><button className="primary-button" disabled={busy || !statement.trim()} title={!statement.trim() ? "请填写事实陈述" : ""} onClick={() => void onAction(() => operationsApi().saveFact({ companyId, category, statement: statement.trim(), source, sourceDate: sourceDate || null, verifiedAt: approvedForAI ? new Date().toISOString() : null, expiresAt: factExpiryIso(expiresAt), approvedForAI, notes: notes.trim() }), "事实已保存。").then(() => setStatement(""))}>保存事实</button></section><section className="panel operations-panel"><div className="panel-heading"><div><h3>事实资料库</h3><span>来源、核验日期、有效期和 AI 使用权限均可追溯。</span></div></div>{rows.length === 0 ? <Empty title="还没有企业事实" description="先添加已确认的公司信息、服务范围或资质依据。" /> : <div className="operations-card-list">{rows.map(row => { const expired = Boolean(row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()); return <article key={row.id}><div><strong>{row.statement}</strong><span>{row.category} · {row.source}</span><small>来源日期 {dateText(row.sourceDate)} · 核验 {dateText(row.verifiedAt)} · 有效期 {dateText(row.expiresAt)}</small>{row.notes && <small>{row.notes}</small>}</div><Status label={expired ? "已过期" : row.approvedForAI ? "AI 可用" : "未批准供 AI 使用"} status={expired ? "FAILED" : row.approvedForAI ? "APPROVED" : "PENDING"} /></article>; })}</div>}</section></div>;
}

function UsageTab({ companyId, initialRows }: { companyId: string; initialRows: OperationsUsageRow[] }): JSX.Element {
  const [range, setRange] = useState<DateRange>(7), [provider, setProvider] = useState(""), [model, setModel] = useState(""), [rows, setRows] = useState(initialRows), [loading, setLoading] = useState(false);
  useEffect(() => { let current = true; setProvider(""); setModel(""); setLoading(true); void operationsApi().usage({ companyId, days: range }).then(next => { if (current) setRows(next); }).catch(() => { if (current) setRows([]); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, [companyId, range]);
  const filtered = useMemo(() => rows.filter(row => (!provider || row.provider === provider) && (!model || row.model === model)), [rows, provider, model]);
  const totals = filtered.reduce((sum, row) => ({ requests: sum.requests + row.requestCount, success: sum.success + row.successCount, failed: sum.failed + row.failedCount, tokens: sum.tokens + row.totalTokens }), { requests: 0, success: 0, failed: 0, tokens: 0 });
  return <section className="panel operations-panel"><div className="panel-heading"><div><h3>AI 用量</h3><span>G 生成按实际请求逐次统计，含标题修复与限流重试；历史记录保留原生成次数估计。费用未知时显示 unknown。</span></div></div><div className="operations-toolbar"><select value={range} disabled={loading} onChange={event => setRange(Number(event.target.value) as DateRange)}><option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option></select><select value={provider} onChange={event => setProvider(event.target.value)}><option value="">全部服务商</option>{[...new Set(rows.map(item => item.provider))].map(item => <option key={item}>{item}</option>)}</select><select value={model} onChange={event => setModel(event.target.value)}><option value="">全部模型</option>{[...new Set(rows.map(item => item.model))].map(item => <option key={item}>{item}</option>)}</select></div><div className="operations-usage-summary"><div><span>请求</span><strong>{totals.requests}</strong></div><div><span>成功</span><strong>{totals.success}</strong></div><div><span>失败</span><strong>{totals.failed}</strong></div><div><span>Tokens</span><strong>{totals.tokens.toLocaleString("zh-CN")}</strong></div></div>{filtered.length === 0 ? <Empty title={loading ? "正在读取用量" : "当前范围没有用量记录"} description="生成草稿后会按服务商和模型汇总。" /> : <div className="operations-table operations-usage-table"><div className="operations-table-head"><span>范围</span><span>服务商 / 模型</span><span>请求</span><span>Tokens</span><span>费用</span></div>{filtered.map((row, index) => <div className="operations-table-row" key={`${row.provider}-${row.model}-${index}`}><span>最近 {range} 天</span><div><strong>{row.provider}</strong><small>{row.model}</small></div><span>{row.successCount} 成功 / {row.failedCount} 失败</span><span>{row.inputTokens.toLocaleString("zh-CN")} in / {row.outputTokens.toLocaleString("zh-CN")} out</span><span>{row.cost === null ? "unknown" : `${row.cost} ${row.currency ?? ""}`}</span></div>)}</div>}</section>;
}

function ImportTab({ companyId, busy, preview, onPreview, onMessage, onReload }: { companyId: string; busy: boolean; preview: OperationsImportPreview | null; onPreview: (preview: OperationsImportPreview | null) => void; onMessage: (message: string) => void; onReload: () => Promise<void> }): JSX.Element {
  const [working, setWorking] = useState(false);
  const [fileData, setFileData] = useState<{ fileName: string; columns: string[]; rows: Array<Record<string, string>> } | null>(null);
  const [mapping, setMapping] = useState<OperationsImportMapping>({ title: "", body: "" });
  useEffect(() => { setFileData(null); setMapping({ title: "", body: "" }); }, [companyId]);
  const previewRows = async (nextFile: NonNullable<typeof fileData>, nextMapping: OperationsImportMapping): Promise<void> => { setWorking(true); onMessage(""); try { onPreview(await operationsApi().previewImport({ companyId, fileName: nextFile.fileName, rows: nextFile.rows, mapping: nextMapping })); } catch (error) { onMessage(error instanceof Error ? error.message : "文件预览失败"); } finally { setWorking(false); } };
  const selectFile = async (): Promise<void> => { setWorking(true); onMessage(""); try { const selected = await operationsApi().pickImportFile(); if (!selected) return; const nextMapping = guessedImportMapping(selected.columns); setFileData(selected); setMapping(nextMapping); await previewRows(selected, nextMapping); } catch (error) { onMessage(error instanceof Error ? error.message : "文件无法读取"); } finally { setWorking(false); } };
  const remap = async (key: keyof OperationsImportMapping, sourceColumn: string): Promise<void> => { if (!fileData) return; const nextMapping = { ...mapping, [key]: sourceColumn }; setMapping(nextMapping); await previewRows(fileData, nextMapping); };
  const commit = async (): Promise<void> => { if (!preview) return; setWorking(true); try { const result = await operationsApi().commitImport({ companyId, previewId: preview.previewId }); onMessage(`已导入 ${result.imported} 条草稿；跳过重复 ${result.skippedDuplicates} 条；失败 ${result.failed} 条。`); onPreview(null); setFileData(null); await onReload(); } catch (error) { onMessage(error instanceof Error ? error.message : "导入未完成"); } finally { setWorking(false); } };
  const errors = preview?.rows.flatMap(row => row.errors) ?? [];
  return <section className="panel operations-panel"><div className="panel-heading"><div><h3>Excel / CSV 批量导入</h3><span>Select File → Preview → Column Mapping → Validation → Import as Draft</span></div><button className="primary-button" disabled={busy || working} onClick={() => void selectFile()}>{working ? "正在处理…" : "选择 CSV / XLSX"}</button></div><div className="notice">导入只创建草稿，不创建发布任务，也不会自动提交到平台。</div>{!preview || !fileData ? <Empty title="尚未选择文件" description="选择文件后先预览、映射并查看逐行错误。" /> : <><div className="operations-import-summary"><strong>{preview.fileName}</strong><span>{preview.totalRows} 行 · {preview.validRows} 可导入 · {preview.duplicateRows} 可能重复</span></div><div className="operations-mapping">{importFields.map(field => <label key={field.key}>{field.label}{field.required && <em>必填</em>}<select disabled={working} value={mapping[field.key] ?? ""} onChange={event => void remap(field.key, event.target.value)}><option value="">不导入</option>{fileData.columns.map(column => <option value={column} key={column}>{column}</option>)}</select></label>)}</div>{errors.length > 0 && <div className="operations-errors"><h4>逐行错误</h4>{errors.map((error, index) => <div key={`${error.row}-${error.column}-${index}`}><strong>第 {error.row} 行</strong><span>{error.column}</span><p>{error.reason}</p></div>)}</div>}<button className="primary-button" disabled={working || preview.validRows === 0} title={preview.validRows === 0 ? "没有通过校验的行" : ""} onClick={() => void commit()}>Import as Draft</button></>}</section>;
}

function OwnerTab({ rows, companyId, busy, onNavigate, onAction }: { rows: OperationsOwnerAction[]; companyId: string; busy: boolean; onNavigate?: (route: string) => void; onAction: (action: () => Promise<unknown>, success: string) => Promise<void> }): JSX.Element {
  const routeForAction=(action:string):string=>action.includes("AI")?"ai-center":action.includes("发布")||action.includes("reconcile")?"publishing":"accounts";
  return <div className="operations-stack"><section className="panel operations-panel"><h3>Owner Action Required</h3><p>账号归属、运行时认证和文章发布资格分别核对。历史任务只提供归属线索。</p>{rows.map(row=><article className="owner-action-row" key={row.id}><strong>{row.what}</strong><p>{row.why}</p><small>最近检查：{dateText(row.lastCheckedAt)}</small><button className="secondary-button" disabled={!onNavigate} onClick={()=>onNavigate?.(routeForAction(row.action))}>{row.action}</button></article>)}</section>
    <AccountOwnershipReview companyId={companyId} busy={busy} onAction={onAction} /></div>;
}

function OperationsPagination({ view, onPage }: { view: { page: number; pages: number; total: number }; onPage: (page: number) => void }): JSX.Element {
  return <nav className="operations-toolbar" aria-label="运营记录分页"><span>共 {view.total} 条 · 第 {view.page} / {view.pages} 页</span><button className="secondary-button" disabled={view.page === 1} onClick={() => onPage(view.page - 1)}>上一页</button><button className="secondary-button" disabled={view.page === view.pages} onClick={() => onPage(view.page + 1)}>下一页</button></nav>;
}

function PublishTab({ rows, companyId }: { rows: PublishBoardRow[]; companyId: string }): JSX.Element {
  const [platform, setPlatform] = useState(""), [account, setAccount] = useState(""), [date, setDate] = useState(""), [status, setStatus] = useState(""), [ownerOnly, setOwnerOnly] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [companyId, platform, account, date, status, ownerOnly]);
  useEffect(() => { setPlatform(""); setAccount(""); setDate(""); setStatus(""); setOwnerOnly(false); }, [companyId]);
  const filtered = rows.filter(row => (!platform || row.platform === platform) && (!account || row.account === account) && (!date || row.date.slice(0, 10) === date) && (!status || publishStatusLabel(row.status) === status) && (!ownerOnly || row.ownerActionRequired));
  const view = operationsPage(filtered, page);
  const statusLabels = [...new Set(rows.map(item => publishStatusLabel(item.status)))];
  return <section className="panel operations-panel"><div className="panel-heading"><div><h3>发布看板</h3><span>这里仅查看当前企业的发布状态；正式操作继续在发布中心完成。</span></div></div><div className="operations-toolbar operations-publish-filters"><select value={platform} onChange={event => setPlatform(event.target.value)}><option value="">全部平台</option>{[...new Set(rows.map(item => item.platform))].map(item => <option value={item} key={item}>{platformLabel(item)}</option>)}</select><select value={account} onChange={event => setAccount(event.target.value)}><option value="">全部账号</option>{[...new Set(rows.map(item => item.account))].map(item => <option key={item}>{item}</option>)}</select><input type="date" aria-label="发布日期" value={date} onChange={event => setDate(event.target.value)} /><select value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option>{statusLabels.map(item => <option value={item} key={item}>{item}</option>)}</select><label className="operations-checkbox"><input type="checkbox" checked={ownerOnly} onChange={event => setOwnerOnly(event.target.checked)} />只看 Owner 处理项</label></div>{filtered.length === 0 ? <Empty title="当前筛选没有记录" description="调整平台、账号、日期或状态筛选。" /> : <div className="operations-table operations-publish-table"><div className="operations-table-head"><span>内容</span><span>平台</span><span>账号</span><span>日期</span><span>状态</span></div>{view.items.map(row => <div className="operations-table-row" key={row.id}><strong>{row.title}</strong><span>{platformLabel(row.platform)}</span><span>{row.account}</span><span>{dateText(row.date)}</span><div><Status label={publishStatusLabel(row.status)} status={row.status} tone={publishStatusTone(row.status)} />{row.ownerActionRequired && <small className="operations-warning">需要 Owner 处理</small>}</div></div>)}</div>}<OperationsPagination view={view} onPage={setPage} /></section>;
}
