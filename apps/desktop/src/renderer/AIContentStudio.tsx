import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { CONTENT_GOALS, CONTENT_INTENTS, CONTENT_STUDIO_PLATFORMS, PROMOTION_STRENGTHS, SEARCH_INTENTS, inferContentIntent, inferSearchIntent, selectRelevantBrandFacts, type ContentGoal, type ContentIntent, type ContentStudioPlatformKey, type ContentStudioTopicPlan, type PromotionStrength, type SearchIntent } from "@publisher/domain";
import type { Brand } from "@publisher/domain";
import type { ContentStudioGenerationInput, ContentStudioMediaAssetView, ContentStudioTaskView, ContentStudioVersionView, ManagedVideoAsset } from "../shared/api";

const splitValues = (value: string): string[] => [...new Set(value.split(/[\n,，、]+/u).map((item) => item.trim()).filter(Boolean))];

export function AIContentStudio({ refresh }: { refresh: () => void }): JSX.Element {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState("");
  const [industry, setIndustry] = useState("");
  const [cityText, setCityText] = useState("");
  const [keywordText, setKeywordText] = useState("");
  const [contentGoal, setContentGoal] = useState<ContentGoal>("BrandPromotion");
  const [contentIntent, setContentIntent] = useState<ContentIntent>("LocalService");
  const [searchIntent, setSearchIntent] = useState<SearchIntent>("Commercial");
  const [promotionStrength, setPromotionStrength] = useState<PromotionStrength>("Balanced");
  const [selectedPlatforms, setSelectedPlatforms] = useState<ContentStudioPlatformKey[]>([...CONTENT_STUDIO_PLATFORMS.map((platform) => platform.key)]);
  const [mediaAssets, setMediaAssets] = useState<ContentStudioMediaAssetView[]>([]);
  const [videoAssets, setVideoAssets] = useState<ManagedVideoAsset[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [topicPlan, setTopicPlan] = useState<ContentStudioTopicPlan | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<ContentStudioTaskView | null>(null);
  const [versions, setVersions] = useState<ContentStudioVersionView[]>([]);
  const [history, setHistory] = useState<ContentStudioTaskView[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"expand" | "plan" | "start" | null>(null);

  const loadBrandData = (id: string): void => {
    setBrandId(id);
    void Promise.all([window.publisherAPI.contentStudio.mediaAssets(id), window.publisherAPI.videoAssets.list({ brandId: id }), window.publisherAPI.contentStudio.tasks(id)]).then(([assets, videos, tasks]) => { setMediaAssets(assets); setVideoAssets(videos); setHistory(tasks); });
  };
  useEffect(() => { void window.publisherAPI.brands.list().then((items) => { setBrands(items); if (items[0]) loadBrandData(items[0].id); }); }, []);
  useEffect(() => {
    if (!taskId) return;
    const poll = (): void => { void window.publisherAPI.contentStudio.task(taskId).then((next) => { setTask(next); if (next) void window.publisherAPI.contentStudio.versions(next.rootTaskId).then(setVersions); if (next && ["completed", "partial", "failed", "cancelled"].includes(next.status)) { void window.publisherAPI.contentStudio.tasks(next.brandId).then(setHistory); } }); };
    poll();
    const timer = window.setInterval(poll, 900);
    return () => window.clearInterval(timer);
  }, [taskId]);

  const input = useMemo<ContentStudioGenerationInput>(() => ({ brandId, industry: industry.trim(), cities: splitValues(cityText), keywords: splitValues(keywordText), targetPlatforms: selectedPlatforms, topicPlan, mediaAssetIds: selectedMediaIds, videoAssetIds: selectedVideoIds, concurrency: 3, city: splitValues(cityText)[0], keyword: splitValues(keywordText)[0], business: splitValues(keywordText)[0], contentGoal, contentIntent, searchIntent, promotionStrength }), [brandId, cityText, contentGoal, contentIntent, industry, keywordText, promotionStrength, searchIntent, selectedMediaIds, selectedPlatforms, selectedVideoIds, topicPlan]);
  const resolvedContentIntent = input.contentIntent ?? inferContentIntent({ contentGoal, city: input.city, keyword: input.keyword, business: input.business });
  const resolvedSearchIntent = input.searchIntent ?? inferSearchIntent({ contentGoal, contentIntent: resolvedContentIntent, keyword: input.keyword });
  const selectedBrand = brands.find((brand) => brand.id === brandId);
  const previewSnapshot = useMemo(() => selectedBrand ? selectRelevantBrandFacts(selectedBrand, { business: input.business ?? "", city: input.city ?? "", keyword: input.keyword ?? "", topic: input.topic ?? "" }) : null, [input.business, input.city, input.keyword, input.topic, selectedBrand]);
  const currentVersions = versions.filter((version) => version.isCurrent);

  const expandKeywords = async (): Promise<void> => {
    setBusy("expand");
    try {
      const result = await window.publisherAPI.contentStudio.expandKeywords({ brandId, cities: input.cities, keywords: input.keywords, industry: input.industry });
      const expanded = [...new Set(result.items.map((item) => item.keyword))];
      if (expanded.length > 0) setKeywordText(expanded.join("\n"));
      setMessage(`已扩展 ${result.items.length} 个城市关键词${result.duplicates ? `，跳过重复 ${result.duplicates} 个` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "关键词扩展失败"); }
    finally { setBusy(null); }
  };
  const planTopics = async (): Promise<void> => {
    setBusy("plan");
    try { setTopicPlan(await window.publisherAPI.contentStudio.planTopics(input)); setMessage("主题规划已生成，可继续调整输入后重新规划。"); void window.publisherAPI.contentStudio.tasks(brandId).then(setHistory); }
    catch (error) { setMessage(error instanceof Error ? error.message : "主题规划失败"); }
    finally { setBusy(null); }
  };
  const start = async (): Promise<void> => {
    setBusy("start");
    try { const id = await window.publisherAPI.contentStudio.start(input); setTaskId(id); setMessage("内容生产任务已进入本地持久化记录。"); refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Content Studio 启动失败"); }
    finally { setBusy(null); }
  };
  const regenerate = async (platformKey: ContentStudioPlatformKey): Promise<void> => {
    if (!task || task.status === "running") return;
    try { const id = await window.publisherAPI.contentStudio.regenerate(task.rootTaskId, platformKey); setTaskId(id); setMessage(`${platformName(platformKey)} 已创建重新生成任务。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "重新生成失败"); }
  };

  return <>
    <div className="studio-hero"><div><div className="eyebrow">V0.8 / AI 内容生产中心</div><h2>AI Content Studio</h2><p>把企业资料、城市关键词、主题规划和平台内容版本串成可追溯的生产流水线。</p></div><div className="studio-hero-badge">DeepSeek Provider<br /><small>文章库 · 视频素材 · Media Assets</small></div></div>
    {message && <div className="notice success">{message}</div>}
    <div className="studio-layout">
      <section className="panel form-panel studio-form">
        <div className="panel-heading"><div><h3>生产输入</h3><span>每次任务保存输入快照，便于复现、审计和重新生成</span></div></div>
        <label>品牌<select value={brandId} onChange={(event) => { setTopicPlan(null); loadBrandData(event.target.value); }}>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name} · {brand.companyName}</option>)}</select></label>
        <div className="two-fields"><label>行业<input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="例如：家装服务" /></label><label>并发数<input type="number" min="1" max="10" value={3} readOnly /></label></div>
        <div className="two-fields"><label>内容目的<select value={contentGoal} onChange={(event) => setContentGoal(event.target.value as ContentGoal)}>{CONTENT_GOALS.map((goal) => <option key={goal} value={goal}>{goal}</option>)}</select></label><label>Promotion Strength<select value={promotionStrength} onChange={(event) => setPromotionStrength(event.target.value as PromotionStrength)}>{PROMOTION_STRENGTHS.map((strength) => <option key={strength} value={strength}>{strength}</option>)}</select></label></div>
        <div className="two-fields"><label>文章类型 / Content Intent<select value={contentIntent} onChange={(event) => setContentIntent(event.target.value as ContentIntent)}>{CONTENT_INTENTS.map((intent) => <option key={intent} value={intent}>{intent}</option>)}</select></label><label>Search Intent<select value={searchIntent} onChange={(event) => setSearchIntent(event.target.value as SearchIntent)}>{SEARCH_INTENTS.map((intent) => <option key={intent} value={intent}>{intent}</option>)}</select></label></div>
        <label>城市（可批量）<textarea rows={3} value={cityText} onChange={(event) => setCityText(event.target.value)} placeholder="南京\n苏州\n无锡" /></label>
        <label>关键词（可批量）<textarea rows={3} value={keywordText} onChange={(event) => setKeywordText(event.target.value)} placeholder="旧房翻新\n装修设计" /></label>
        <div className="hint-box">当前聚焦：{input.city || "未选城市"} · {input.business || "未选业务"} · {resolvedContentIntent} · {resolvedSearchIntent} · {promotionStrength}</div>
        <div className="studio-action-row"><button className="secondary-button" onClick={() => void expandKeywords()} disabled={busy !== null || !brandId}> {busy === "expand" ? "扩展中…" : "扩展城市关键词"}</button><span>结果会写入已有关键词库</span></div>
        <label>目标平台<div className="studio-platform-grid">{CONTENT_STUDIO_PLATFORMS.map((platform) => <button type="button" key={platform.key} className={`studio-platform-chip ${selectedPlatforms.includes(platform.key) ? "selected" : ""}`} onClick={() => setSelectedPlatforms((current) => current.includes(platform.key) ? current.filter((key) => key !== platform.key) : [...current, platform.key])}><strong>{platform.displayName}</strong><small>{platform.contentType === "article" ? "图文" : "视频脚本"}</small></button>)}</div></label>
        <div className="studio-action-row"><button className="secondary-button" onClick={() => void planTopics()} disabled={busy !== null || !brandId || input.cities.length === 0 || input.keywords.length === 0}>{busy === "plan" ? "规划中…" : "生成主题规划"}</button><span>{topicPlan ? `${topicPlan.topics.length} 个主题已准备` : "建议先规划主题再生产"}</span></div>
        <div className="studio-selection"><strong>Media Assets</strong>{mediaAssets.length === 0 ? <small>暂无品牌 Media Assets</small> : mediaAssets.map((asset) => <label key={asset.id}><input type="checkbox" checked={selectedMediaIds.includes(asset.id)} onChange={() => setSelectedMediaIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id])} />{asset.title}<em>{asset.type}</em></label>)}</div>
        <div className="studio-selection"><strong>视频素材</strong>{videoAssets.length === 0 ? <small>暂无品牌视频素材</small> : videoAssets.map((asset) => <label key={asset.id}><input type="checkbox" checked={selectedVideoIds.includes(asset.id)} onChange={() => setSelectedVideoIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id])} />{asset.title}<em>{asset.fileName}</em></label>)}</div>
        <button className="primary-button wide" onClick={() => void start()} disabled={busy !== null || !brandId || input.cities.length === 0 || input.keywords.length === 0 || selectedPlatforms.length === 0}>{busy === "start" ? "任务创建中…" : "一次生成多平台内容"}</button>
      </section>
      <section className="studio-side">
        <section className="panel form-panel"><div className="panel-heading"><div><h3>生成上下文</h3><span>真正调用 Provider 前确认企业事实范围</span></div></div><div className="studio-plan-summary">企业：{selectedBrand?.companyName || "未选择"}<br />业务：{input.business || "未选择"}<br />城市：{input.city || "未选择"}<br />关键词：{input.keyword || "未选择"}<br />平台：{selectedPlatforms.map(platformName).join("、") || "未选择"}<br />内容目的：{contentGoal}<br />Content Intent：{resolvedContentIntent}<br />Search Intent：{resolvedSearchIntent}<br />Promotion Strength：{promotionStrength}<br />选中的企业事实：{previewSnapshot?.factCount ?? 0} 条</div>{previewSnapshot && <div className="studio-selection"><strong>将使用哪些企业资料</strong>{previewSnapshot.facts.map((fact) => <small key={fact.id}>[{fact.type}] {fact.label}：{fact.content}</small>)}</div>}</section>
        <section className="panel form-panel"><div className="panel-heading"><div><h3>主题规划</h3><span>作为所有平台版本的共同编辑上下文</span></div></div>{topicPlan ? <><p className="studio-plan-summary">{topicPlan.summary}</p><div className="studio-topic-list">{topicPlan.topics.map((topic) => <div key={topic.title}><strong>{topic.title}</strong><span>{topic.angle}</span><small>{topic.keyPoints.join(" · ")}</small></div>)}</div></> : <div className="empty-state compact"><strong>尚未生成主题规划</strong><p>输入行业、城市和关键词后生成。</p></div>}</section>
        <section className="panel form-panel"><div className="panel-heading"><div><h3>任务进度</h3><span>{task ? `${task.provider} / ${task.model}` : "等待创建任务"}</span></div>{task && <StatusPill status={task.status} />}</div>{task ? <><div className="studio-progress"><strong>{task.completed} / {task.total}</strong><div className="progress-track"><span style={{ width: `${task.total ? Math.min(100, task.completed / task.total * 100) : 0}%` }} /></div><small>成功 {task.success} · 失败 {task.failed} · 耗时 {task.durationMs} ms</small></div>{task.output.knowledgeSnapshot && <div className="hint-box">Knowledge Snapshot：{task.output.knowledgeSnapshot.factCount} 条事实 · {task.output.knowledgeSnapshot.selectedFactTypes.join("、")}</div>}{task.errorMessage && <div className="notice error">{task.errorMessage}</div>}</> : <div className="empty-state compact"><strong>暂无运行中的任务</strong><p>生产任务和 AI provider/model 会持久化到本地。</p></div>}</section>
      </section>
    </div>
    <section className="panel form-panel studio-output-panel"><div className="panel-heading"><div><h3>平台独立内容</h3><span>每个平台拥有独立标题、结构、关键词布局和语气；视频脚本不会自动创建发布任务</span></div></div>{currentVersions.length === 0 ? <div className="empty-state"><strong>等待内容产出</strong><p>完成任务后，这里会显示微信公众号、知乎、头条、微博、抖音和 B 站的当前版本。</p></div> : <div className="studio-output-grid">{currentVersions.map((version) => <article className="studio-output-card" key={version.id}><div className="studio-output-head"><div><strong>{platformName(version.platformKey)}</strong><span>V{version.versionNumber} · {version.contentType === "video_script" ? "视频脚本" : "图文版本"} · <QualityStatus status={version.qualityStatus} /></span></div><button className="mini-button" disabled={task?.status === "running"} onClick={() => void regenerate(version.platformKey)}>重新生成</button></div><h4>{version.title}</h4><div className="studio-output-meta"><span>{version.tone}</span><span>关键词：{version.keywordLayout.primary}</span></div><p>{version.body.slice(0, 280)}{version.body.length > 280 ? "…" : ""}</p><small>Provider：{version.provider} · Model：{version.model} · {new Date(version.createdAt).toLocaleString("zh-CN")}</small></article>)}</div>}</section>
    <section className="panel form-panel studio-history-panel"><div className="panel-heading"><div><h3>生成历史与版本</h3><span>可回看每次任务输入和平台版本，重新生成会形成新版本</span></div></div>{history.length === 0 ? <div className="empty-state compact"><strong>暂无历史任务</strong></div> : <div className="studio-history-list">{history.slice(0, 12).map((item) => <button key={item.id} className={`studio-history-row ${item.id === taskId ? "selected" : ""}`} onClick={() => { setTaskId(item.id); setTask(item); }}><span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span><strong>{item.type === "regenerate_platform" ? "平台重新生成" : item.type === "topic_plan" ? "主题规划" : "多平台生产"}</strong><em>{item.success}/{item.total} 成功 · {item.provider}/{item.model}</em><StatusPill status={item.status} /></button>)}</div>}</section>
  </>;
}

function platformName(key: ContentStudioPlatformKey): string { return CONTENT_STUDIO_PLATFORMS.find((platform) => platform.key === key)?.displayName ?? key; }
function StatusPill({ status }: { status: string }): JSX.Element { const tone = status === "completed" ? "success" : status === "partial" ? "warning" : status === "failed" ? "danger" : status === "running" ? "purple" : "muted"; return <span className={`status-pill ${tone}`}>{status}</span>; }
function QualityStatus({ status }: { status: string }): JSX.Element { const tone = status === "Approved" ? "success" : status === "Rejected" ? "danger" : status === "Needs_Review" ? "warning" : status === "AI_Checked" ? "purple" : "muted"; return <span className={`status-pill ${tone}`}>{status}</span>; }
