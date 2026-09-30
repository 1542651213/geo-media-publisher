import type { Article } from "@publisher/domain";
import type { JSX } from "react";
import type { OfficialApiAccountView, OfficialApiContentSettings, OfficialApiImageChoice } from "../shared/official-api";
import { splitOfficialApiList } from "./official-api-publish-ui";

const environmentLabel = (environment: OfficialApiAccountView["environment"]): string =>
  environment === "production" ? "正式环境 production" : environment === "staging" ? "测试环境 staging" : "环境未验证";

function AssetChoices({ label, assets, selected, onChange }: { label: string; assets: readonly OfficialApiImageChoice[]; selected: readonly string[]; onChange(ids: string[]): void }): JSX.Element {
  return <fieldset><legend>{label}</legend><div className="v111-manual-images">{assets.map(asset => <label className="check-row" key={asset.id}>
    <input type="checkbox" value={asset.id} checked={selected.includes(asset.id)} onChange={() => onChange(selected.includes(asset.id) ? selected.filter(id => id !== asset.id) : [...selected, asset.id])} />
    <span>{asset.name}</span><em>{asset.universal ? "通用素材" : "当前品牌"}</em>
  </label>)}</div></fieldset>;
}

export function OfficialApiPublishSettings({ article, connection, assets, value, onChange }: {
  article: Article;
  connection: OfficialApiAccountView;
  assets: readonly OfficialApiImageChoice[];
  value: OfficialApiContentSettings;
  onChange(value: OfficialApiContentSettings): void;
}): JSX.Element {
  const patch = (next: Partial<OfficialApiContentSettings>): void => onChange({ ...value, ...next });
  const optionalList = (raw: string): string[] | undefined => { const items = splitOfficialApiList(raw); return items.length ? items : undefined; };
  return <section className="panel v114-preference-section" aria-label="官网 OfficialAPI 发布设置">
    <div className="panel-heading"><div><h3>官网 OfficialAPI</h3><span>账号 {connection.accountId} · 站点 {connection.siteId ?? "未验证"} · API {connection.apiVersion ?? "未验证"} · {connection.writesEnabled ? "可写" : "只读"}</span></div></div>
    <div className={connection.environment === "staging" ? "notice warning" : "notice success"}><strong>{environmentLabel(connection.environment)}</strong><span>本次只绑定当前账号、文章与已选素材；准备完成后仍需在标准任务中确认最终发布。</span></div>
    <label>内容类型<select value={value.kind} onChange={event => patch({ kind: event.target.value === "case" ? "case" : "article", galleryAssetIds: [] })}><option value="article">行业科普 ARTICLE</option><option value="case">现场案例 CASE</option></select></label>
    <label>摘要<textarea value={value.summary ?? article.summary} onChange={event => patch({ summary: event.target.value || undefined })} placeholder="请填写官网列表摘要；不会自动改写正文" /></label>
    <label>Slug（可选）<input value={value.slug ?? ""} onChange={event => patch({ slug: event.target.value.trim() || undefined })} placeholder="留空由系统生成" /></label>
    <label>分类（可选）<input value={value.category ?? ""} onChange={event => patch({ category: event.target.value || undefined })} placeholder={article.articleType || "使用文章分类"} /></label>
    <label>SEO 标题（可选）<input value={value.seoTitle ?? ""} onChange={event => patch({ seoTitle: event.target.value || undefined })} placeholder={article.title} /></label>
    <label>SEO 描述（可选）<textarea value={value.seoDescription ?? ""} onChange={event => patch({ seoDescription: event.target.value || undefined })} placeholder={article.summary} /></label>
    <label>关键词（逗号或换行分隔）<textarea value={(value.keywords ?? []).join("\n")} onChange={event => patch({ keywords: optionalList(event.target.value) })} /></label>
    {value.kind === "article" ? <label>核心要点（逗号或换行分隔，可选）<textarea value={(value.takeaways ?? []).join("\n")} onChange={event => patch({ takeaways: optionalList(event.target.value) })} /></label> : <>
      <label>案例地点<input value={value.location ?? ""} onChange={event => patch({ location: event.target.value || undefined })} placeholder={article.city || "请填写案例地点"} /></label>
      <label>案例详情导语<textarea value={value.detailIntro ?? ""} onChange={event => patch({ detailIntro: event.target.value || undefined })} placeholder={article.summary || "请填写案例详情导语"} /></label>
      <label>服务重点（逗号或换行分隔）<textarea value={(value.serviceFocus ?? []).join("\n")} onChange={event => patch({ serviceFocus: optionalList(event.target.value) })} /></label>
    </>}
    <label>封面素材<select value={value.coverAssetId ?? ""} onChange={event => patch({ coverAssetId: event.target.value || null })}><option value="">不设置封面</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
    <AssetChoices label="正文图片" assets={assets} selected={value.bodyImageAssetIds} onChange={bodyImageAssetIds => patch({ bodyImageAssetIds })} />
    {value.kind === "case" && <AssetChoices label="案例图库（至少 2 张）" assets={assets} selected={value.galleryAssetIds} onChange={galleryAssetIds => patch({ galleryAssetIds })} />}
  </section>;
}
