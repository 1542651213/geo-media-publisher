import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import type { Brand, ImageAsset } from "@publisher/domain";

function splitLabels(value: string): string[] { return [...new Set(value.split(/[、,，;；\s]+/u).map((item) => item.trim()).filter(Boolean))]; }

export function ImageLibraryPage({ refresh }: { refresh: () => void }): JSX.Element {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState("");
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [tags, setTags] = useState("通用");
  const [business, setBusiness] = useState("");
  const [city, setCity] = useState("");
  const [usage, setUsage] = useState("");
  const [platform, setPlatform] = useState("");
  const [universal, setUniversal] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback((nextBrandId = brandId): void => { void window.publisherAPI.imageAssets.list({ brandId: nextBrandId || undefined }).then(setAssets); }, [brandId]);
  useEffect(() => { void window.publisherAPI.brands.list().then((list) => { setBrands(list); const nextBrandId = list[0]?.id ?? ""; setBrandId(nextBrandId); load(nextBrandId); }); }, [load, refresh]);
  const pick = async (): Promise<void> => { const selected = await window.publisherAPI.imageAssets.pickFiles(); if (selected.length > 0) setFiles(selected); };
  const importFiles = async (): Promise<void> => {
    if (!brandId || files.length === 0) return;
    setBusy(true);
    try {
      const imported = await window.publisherAPI.imageAssets.import({ brandId, sourcePaths: files, tags: splitLabels(tags), business: splitLabels(business), city: splitLabels(city), usage: splitLabels(usage), platform: splitLabels(platform), universal });
      setFiles([]); setMessage(`已导入 ${imported.length} 张图片`); load(); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "图片导入失败"); } finally { setBusy(false); }
  };
  const toggle = async (asset: ImageAsset): Promise<void> => { await window.publisherAPI.imageAssets.update(asset.id, { enabled: !asset.enabled }); load(); };
  const remove = async (asset: ImageAsset): Promise<void> => { if (!window.confirm(`确定删除“${asset.name}”吗？`)) return; await window.publisherAPI.imageAssets.delete(asset.id); setMessage(`已删除：${asset.name}`); load(); refresh(); };
  return <>
    <div className="page-title"><div><div className="eyebrow">内容管理 / 素材库</div><h2>图片库</h2><p>管理文章配图；发布时可以按业务、城市和平台自动随机选择。</p></div><div className="row-actions"><button className="secondary-button" onClick={() => void pick()}>选择图片</button><button className="primary-button" disabled={busy || !brandId || files.length === 0} onClick={() => void importFiles()}>{busy ? "导入中…" : `导入 ${files.length || ""} 张图片`}</button></div></div>
    {message && <div className="notice success">{message}</div>}
    <div className="image-library-layout">
      <section className="panel form-panel"><div className="panel-heading"><div><h3>导入图片</h3><span>文件只复制到应用媒体目录，原文件不会被修改。</span></div></div>
        <label>企业<select value={brandId} onChange={(event) => { setBrandId(event.target.value); load(event.target.value); }}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name} · {brand.companyName}</option>)}</select></label>
        <label>业务标签<input value={business} onChange={(event) => setBusiness(event.target.value)} placeholder="甲醛治理；定期消杀" /></label>
        <label>城市标签<input value={city} onChange={(event) => setCity(event.target.value)} placeholder="苏州；木渎" /></label>
        <label>用途标签<input value={usage} onChange={(event) => setUsage(event.target.value)} placeholder="治理现场；办公环境" /></label>
        <label>平台标签<input value={platform} onChange={(event) => setPlatform(event.target.value)} placeholder="知乎；百家号" /></label>
        <label>通用标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="通用；案例" /></label>
        <label className="check-row"><input type="checkbox" checked={universal} onChange={(event) => setUniversal(event.target.checked)} /><span>作为通用图片参与兜底匹配</span></label>
        {files.length > 0 && <div className="hint-box">已选择：{files.map((file) => file.split(/[\\/]/u).pop()).join("、")}</div>}
        <div className="hint-box">匹配优先级：业务 + 城市 + 平台 → 业务 + 平台 → 业务 + 城市 → 业务 → 平台 → 通用。最近使用的图片会尽量避开。</div>
      </section>
      <section className="panel table-panel"><div className="panel-heading"><div><h3>已入库图片</h3><span>{assets.length} 张 · 停用图片不会参与自动配图</span></div></div>
        {assets.length === 0 ? <div className="empty-state compact"><div className="empty-icon">▧</div><strong>还没有图片</strong><p>选择至少 3 张测试图片后导入，发布窗口即可预览配图。</p></div> : <div className="image-asset-grid">{assets.map((asset) => <article className={`image-asset-card ${asset.enabled ? "" : "disabled"}`} key={asset.id}><div className="image-preview">{asset.previewUrl ? <img src={asset.previewUrl} alt={asset.name} /> : <span>▧</span>}</div><div className="image-asset-body"><strong>{asset.name}</strong><span>{asset.originalFileName} · {asset.useCount} 次使用</span><small>{[...asset.business, ...asset.city, ...asset.usage, ...asset.platform, ...asset.tags].join(" · ") || "未设置标签"}</small><small>{asset.universal ? "通用图片" : "定向图片"} · {asset.enabled ? "启用" : "停用"}</small></div><div className="row-actions"><button className="mini-button" onClick={() => void toggle(asset)}>{asset.enabled ? "停用" : "启用"}</button><button className="mini-button danger-mini" onClick={() => void remove(asset)}>删除</button></div></article>)}</div>}
      </section>
    </div>
  </>;
}
