import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { Article, Account, Platform, PublishJob } from "@publisher/domain";
import type { ManagedVideoAsset } from "../shared/api";

interface VideoAssetCenterProps {
  refresh: () => void;
}

export function VideoAssetCenter({ refresh }: VideoAssetCenterProps): JSX.Element {
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [assets, setAssets] = useState<ManagedVideoAsset[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [brandId, setBrandId] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [platformKey, setPlatformKey] = useState("douyin");
  const [accountId, setAccountId] = useState("");
  const [articleId, setArticleId] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [coverSourcePath, setCoverSourcePath] = useState("");
  const [removeCover, setRemoveCover] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [platformFieldsText, setPlatformFieldsText] = useState("{}");
  const [preflight, setPreflight] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const [nextBrands, nextAssets, nextPlatforms, nextAccounts, nextArticles, nextJobs] = await Promise.all([
      window.publisherAPI.brands.list(),
      window.publisherAPI.videoAssets.list(),
      window.publisherAPI.platforms.list(),
      window.publisherAPI.accounts.list(),
      window.publisherAPI.articles.list(),
      window.publisherAPI.jobs.list()
    ]);
    setBrands(nextBrands.map((brand) => ({ id: brand.id, name: brand.name })));
    setAssets(nextAssets);
    setPlatforms(nextPlatforms);
    setAccounts(nextAccounts);
    setArticles(nextArticles.filter((article) => article.status !== "archived"));
    setJobs(nextJobs.filter((job) => job.contentKind === "video"));
    setBrandId((current) => current || nextBrands[0]?.id || "");
    setSelectedAssetId((current) => current || nextAssets[0]?.id || "");
    setPlatformKey((current) => current === "douyin" || nextPlatforms.some((platform) => platform.platformKey === current && platform.capabilities.video) ? current : nextPlatforms.find((platform) => platform.capabilities.video)?.platformKey ?? "");
  };

  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "视频素材加载失败")); }, [refresh]);

  const videoPlatforms = useMemo(() => platforms.filter((platform) => platform.capabilities.video), [platforms]);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const selectedPlatform = videoPlatforms.find((platform) => platform.platformKey === platformKey) ?? null;
  const platformAccounts = accounts.filter((account) => account.platformKey === platformKey && account.enabled);
  const brandArticles = articles.filter((article) => !brandId || article.brandId === brandId);
  const selectedAssetJobs = jobs.filter((job) => job.videoAssetId === selectedAssetId);

  useEffect(() => {
    if (!selectedAsset) return;
    setBrandId(selectedAsset.brandId ?? "");
    setSourcePath("");
    setCoverSourcePath("");
    setRemoveCover(false);
    setTitle(selectedAsset.title);
    setDescription(selectedAsset.description);
    setTagsText(selectedAsset.tags.join(", "));
    setDurationSeconds(selectedAsset.durationMs ? String(Math.round(selectedAsset.durationMs / 1000)) : "");
    setWidth(selectedAsset.width ? String(selectedAsset.width) : "");
    setHeight(selectedAsset.height ? String(selectedAsset.height) : "");
    setPlatformFieldsText(JSON.stringify(selectedAsset.platformFields, null, 2));
    setPreflight(null);
  }, [selectedAsset]);

  useEffect(() => {
    if (!platformAccounts.some((account) => account.id === accountId)) setAccountId(platformAccounts[0]?.id ?? "");
  }, [platformAccounts, accountId]);

  useEffect(() => {
    if (!brandArticles.some((article) => article.id === articleId)) setArticleId(brandArticles[0]?.id ?? "");
  }, [brandArticles, articleId]);

  const chooseVideo = async (): Promise<void> => {
    const path = await window.publisherAPI.videoAssets.pickVideo();
    if (path) setSourcePath(path);
  };

  const chooseCover = async (): Promise<void> => {
    const path = await window.publisherAPI.videoAssets.pickCover();
    if (path) { setCoverSourcePath(path); setRemoveCover(false); }
  };

  const saveAsset = async (): Promise<void> => {
    setBusy("save"); setError(""); setMessage("");
    try {
      const platformFields = parsePlatformFields(platformFieldsText);
      const tags = parseTags(tagsText);
      const dimensions = { durationMs: parseOptionalNumber(durationSeconds) === undefined ? undefined : (parseOptionalNumber(durationSeconds) as number) * 1000, width: parseOptionalNumber(width), height: parseOptionalNumber(height) };
      const saved = selectedAsset && !sourcePath
        ? await window.publisherAPI.videoAssets.update(selectedAsset.id, { title: title.trim(), description: description.trim(), tags, ...dimensions, platformFields, ...(removeCover ? { coverSourcePath: null } : coverSourcePath ? { coverSourcePath } : {}) })
        : await window.publisherAPI.videoAssets.create({ brandId, sourcePath, title: title.trim(), description: description.trim(), tags, ...dimensions, platformFields, ...(coverSourcePath ? { coverSourcePath } : {}) });
      setSelectedAssetId(saved.id);
      setSourcePath(""); setCoverSourcePath(""); setRemoveCover(false);
      setMessage(selectedAsset ? "视频素材元数据已保存" : "视频素材已上传并保存到本地媒体库");
      await load();
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "视频素材保存失败"); }
    finally { setBusy(null); }
  };

  const runPreflight = async (): Promise<void> => {
    if (!selectedAsset || !platformKey) { setError("请先选择视频素材和视频平台"); return; }
    setBusy("preflight"); setError(""); setMessage("");
    try {
      const result = await window.publisherAPI.videoAssets.preflight({ id: selectedAsset.id, platformKey });
      setPreflight(result);
      setMessage(result.valid ? "发布前检查通过；尚未创建或执行发布任务" : "发布前检查未通过；未创建发布任务");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "发布前检查失败"); }
    finally { setBusy(null); }
  };

  const createJob = async (): Promise<void> => {
    if (!selectedAsset || !accountId || !articleId || !platformKey) { setError("请先选择视频素材、平台账号和文章"); return; }
    setBusy("job"); setError(""); setMessage("");
    try {
      const check = await window.publisherAPI.videoAssets.preflight({ id: selectedAsset.id, platformKey });
      setPreflight(check);
      if (!check.valid) { setError(`发布任务未创建：${check.errors.join("；")}`); return; }
      const job = await window.publisherAPI.jobs.createVideo({ accountId, platformKey, articleId, videoAssetId: selectedAsset.id, scheduledAt: new Date().toISOString() });
      setMessage(`视频发布任务已进入 Job Queue：${job.id.slice(0, 12)}；当前状态 ${job.status}`);
      await load();
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "视频发布任务创建失败"); }
    finally { setBusy(null); }
  };

  return <><PageTitle title="视频素材中心" eyebrow="V0.7.2 / 内容管理" description="视频素材、封面、平台适配字段和发布任务统一管理；所有正式发布仍经过现有持久化 Job Queue。" action={<span className="status-chip success">媒体资产本地持久化</span>} />{error && <div className="notice error">{error}</div>}{message && <div className="notice success">{message}</div>}<div className="video-center-layout"><section className="panel form-panel"><div className="panel-heading"><div><h3>{selectedAsset ? "编辑视频素材" : "新增视频素材"}</h3><span>视频文件会复制到应用媒体目录；源路径不会上传到外部平台。</span></div></div><label>所属品牌<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select></label><div className="video-file-row"><div><span>视频文件</span><b>{sourcePath || selectedAsset?.fileName || "尚未选择"}</b></div><button className="secondary-button" onClick={() => void chooseVideo()}>选择视频</button></div><label>视频标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="抖音视频标题" /></label><label>视频描述<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="视频描述" /></label><label>标签管理<input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="用逗号或空格分隔，例如：环保,装修,南京" /></label><div className="two-fields"><label>时长（秒）<input type="number" min="0" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} /></label><label>宽度<input type="number" min="1" value={width} onChange={(event) => setWidth(event.target.value)} /></label><label>高度<input type="number" min="1" value={height} onChange={(event) => setHeight(event.target.value)} /></label></div><div className="video-file-row"><div><span>封面图片</span><b>{coverSourcePath || selectedAsset?.coverPath || "未设置封面"}</b></div><div className="row-actions"><button className="secondary-button" onClick={() => void chooseCover()}>选择封面</button>{selectedAsset?.coverPath && <button className="mini-button" onClick={() => { setRemoveCover(true); setCoverSourcePath(""); }}>移除封面</button>}</div></div><label>平台适配字段（JSON）<textarea rows={5} value={platformFieldsText} onChange={(event) => setPlatformFieldsText(event.target.value)} placeholder={'{"douyin":{"visibility":"public"}}'} /></label><div className="wizard-actions"><button className="primary-button" disabled={busy !== null || !brandId || !title.trim() || (!selectedAsset && !sourcePath)} onClick={() => void saveAsset()}>{selectedAsset ? "保存素材元数据" : "上传并保存视频"}</button>{selectedAsset && <button className="secondary-button" onClick={() => { setSelectedAssetId(""); setTitle(""); setDescription(""); setTagsText(""); setSourcePath(""); setCoverSourcePath(""); setPlatformFieldsText("{}"); }}>新建素材</button>}</div></section><section className="panel table-panel"><div className="panel-heading"><div><h3>视频素材列表</h3><span>状态由素材、Dry Run、PublishRecord 和任务结果派生。</span></div><b className="metric-highlight">{assets.length}<small>个视频资产</small></b></div><div className="video-asset-list">{assets.length === 0 ? <EmptyState compact title="暂无视频素材" description="选择本地视频后保存为第一条视频素材。" /> : assets.map((asset) => <button className={`video-asset-card ${asset.id === selectedAssetId ? "selected" : ""}`} key={asset.id} onClick={() => setSelectedAssetId(asset.id)}><div className="video-asset-icon">▶</div><div><strong>{asset.title}</strong><span>{asset.fileName} · {formatBytes(asset.size)}</span><small>{asset.description || "暂无描述"}</small></div><StatusPill status={asset.status} /></button>)}</div></section></div><section className="panel verification-panel video-publish-panel"><div className="panel-heading"><div><h3>平台选择 → 发布任务</h3><span>只显示现有且声明视频能力的平台；不会新增平台，也不会绕过 Adapter。</span></div></div><div className="video-publish-grid"><label>平台<select value={platformKey} onChange={(event) => { setPlatformKey(event.target.value); setPreflight(null); }}>{videoPlatforms.length === 0 ? <option value="">暂无视频平台</option> : videoPlatforms.map((platform) => <option value={platform.platformKey} key={platform.platformKey}>{platform.displayName}</option>)}</select></label><label>账号<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{platformAccounts.length === 0 ? <option value="">暂无已启用账号</option> : platformAccounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.loginStatus}</option>)}</select></label><label>关联文章<select value={articleId} onChange={(event) => setArticleId(event.target.value)}>{brandArticles.length === 0 ? <option value="">暂无文章</option> : brandArticles.map((article) => <option value={article.id} key={article.id}>{article.title}</option>)}</select></label></div><div className="verification-facts"><div><span>素材状态</span><b>{selectedAsset?.status ?? "未选择"}</b></div><div><span>平台能力</span><b>{selectedPlatform ? `${selectedPlatform.displayName} / video=${selectedPlatform.capabilities.video ? "true" : "false"}` : "未选择"}</b></div><div><span>封面</span><b>{selectedAsset?.coverPath ? "已管理" : "未设置"}</b></div><div><span>关联任务</span><b>{selectedAssetJobs.length ? `${selectedAssetJobs.length} 个` : "暂无"}</b></div></div>{preflight && <div className={`video-preflight ${preflight.valid ? "valid" : "invalid"}`}><strong>{preflight.valid ? "发布前检查通过" : "发布前检查未通过"}</strong>{preflight.errors.map((item) => <span key={item}>错误：{item}</span>)}{preflight.warnings.map((item) => <span key={item}>提示：{item}</span>)}</div>}<div className="wizard-actions"><button className="secondary-button" disabled={busy !== null || !selectedAsset || !platformKey} onClick={() => void runPreflight()}>发布前检查</button><button className="primary-button" disabled={busy !== null || !selectedAsset || !accountId || !articleId || !platformKey} onClick={() => void createJob()}>创建视频发布任务</button></div>{selectedAssetJobs.length > 0 && <div className="video-job-list">{selectedAssetJobs.map((job) => <div key={job.id}><span>{job.id.slice(0, 12)}</span><StatusPill status={job.status} /><small>{new Date(job.createdAt).toLocaleString("zh-CN")}</small></div>)}</div>}</section></>;
}

function parseTags(value: string): string[] {
  return value.split(/[\s,，、]+/u).map((item) => item.trim()).filter(Boolean);
}

function parsePlatformFields(value: string): Record<string, Record<string, string>> {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("平台适配字段必须是 JSON 对象");
  const result: Record<string, Record<string, string>> = {};
  for (const [platformKey, fields] of Object.entries(parsed)) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error(`平台字段 ${platformKey} 必须是对象`);
    result[platformKey] = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, String(field)]));
  }
  return result;
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("视频元数据数值无效");
  return Math.floor(parsed);
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }): JSX.Element {
  return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

function StatusPill({ status }: { status: string }): JSX.Element {
  return <span className={`status-pill ${status === "Published" || status === "Ready" ? "success" : status === "Failed" ? "danger" : status === "DryRun" ? "purple" : "muted"}`}>{status}</span>;
}

function EmptyState({ title, description, compact = false }: { title: string; description: string; compact?: boolean }): JSX.Element {
  return <div className={`empty-state ${compact ? "compact" : ""}`}><div className="empty-icon">▧</div><strong>{title}</strong><p>{description}</p></div>;
}
