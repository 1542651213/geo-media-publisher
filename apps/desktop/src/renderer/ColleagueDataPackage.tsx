import { useEffect,useState } from 'react';
import type { JSX } from 'react';
import type { Article,ImageAsset } from '@publisher/domain';
import type { ColleaguePackagePreview } from '../shared/colleague-data-package';

export function ColleagueDataPackage({companyId,onImported}:{companyId:string;onImported:()=>void}):JSX.Element{
  const [articles,setArticles]=useState<Article[]>([]),[assets,setAssets]=useState<ImageAsset[]>([]);
  const [page,setPage]=useState(1),[totalPages,setTotalPages]=useState(1);
  const [articleIds,setArticleIds]=useState<string[]>([]),[assetIds,setAssetIds]=useState<string[]>([]),[includeTemplates,setIncludeTemplates]=useState(false);
  const [includeFacts,setIncludeFacts]=useState(false),[approvedIds,setApprovedIds]=useState<string[]>([]);
  const [preview,setPreview]=useState<(ColleaguePackagePreview&{previewId:string})|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let active=true;if(!companyId)return;
    void Promise.all([window.publisherAPI.articles.page({brandId:companyId,page,pageSize:50}),window.publisherAPI.imageAssets.list({brandId:companyId})])
      .then(([result,images])=>{if(active){setArticles(result.items);setApprovedIds(result.items.filter(item=>result.qualityStatuses[item.id]==='Approved').map(item=>item.id));setTotalPages(result.totalPages);setAssets(images.filter(item=>item.brandId===companyId));}})
      .catch(error=>{if(active)setMessage(error instanceof Error?error.message:'无法读取当前企业资料');});
    return()=>{active=false;};
  },[companyId,page]);
  const toggle=(id:string,current:string[],setter:(next:string[])=>void):void=>setter(current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  const act=async(operation:()=>Promise<void>):Promise<void>=>{setBusy(true);setMessage('');try{await operation();}catch(error){setMessage(error instanceof Error?error.message:'资料包操作失败，现场已保留');}finally{setBusy(false);}};
  return <section className="panel form-grid colleague-package-panel"><h3>同事资料包</h3>
    <p>选择当前企业的业务资料、审核通过的文章、图片及可选模板和事实。导入时创建新企业，文章进入 Draft，事实需要重新核实；同事需要自行确认账号归属并完成平台登录。</p>
    {message&&<p role="status" className="notice">{message}</p>}
    <fieldset disabled={busy||!companyId}><legend>选择导出内容</legend>
      <div className="colleague-package-columns"><div><h4>文章 · 已选 {articleIds.length}</h4>
        <div className="package-selection-list">{articles.map(article=><label className="check-row" key={article.id}><input type="checkbox" disabled={!approvedIds.includes(article.id)} checked={articleIds.includes(article.id)} onChange={()=>toggle(article.id,articleIds,setArticleIds)}/>{article.title}{!approvedIds.includes(article.id)&&' · 待审核'}</label>)}</div>
        <div className="row-actions"><button className="secondary-button" disabled={page<=1} onClick={()=>setPage(page-1)}>上一页</button><span>{page}/{totalPages} 页</span><button className="secondary-button" disabled={page>=totalPages} onClick={()=>setPage(page+1)}>下一页</button></div>
      </div><div><h4>图片 · 已选 {assetIds.length}</h4>
        <div className="package-selection-list">{assets.map(asset=><label className="check-row" key={asset.id}><input type="checkbox" checked={assetIds.includes(asset.id)} onChange={()=>toggle(asset.id,assetIds,setAssetIds)}/>{asset.name}</label>)}</div>
      </div></div>
      <label className="check-row"><input type="checkbox" checked={includeTemplates} onChange={event=>setIncludeTemplates(event.target.checked)}/>包含当前启用及停用的最新 AI 模板（可审阅模板文字后再分享）</label>
      <label className="check-row"><input type="checkbox" checked={includeFacts} onChange={event=>setIncludeFacts(event.target.checked)}/>包含已核实、批准且未过期的事实（不含内部备注）</label>
      <button className="secondary-button" onClick={()=>void act(async()=>{const result=await window.publisherAPI.colleaguePackages.export({companyId,articleIds,assetIds,includeTemplates,includeFacts});setMessage(`资料包已校验：${result.articleCount} 篇文章、${result.assetCount} 张图片、${result.templateCount} 个模板、${result.factCount} 条事实。保存位置：${result.directory}`);})}>导出选定资料包</button>
    </fieldset>
    <div className="row-actions"><button className="secondary-button" disabled={busy} onClick={()=>void act(async()=>{setPreview(await window.publisherAPI.colleaguePackages.pick());})}>选择并预览同事资料包</button></div>
    {preview&&<div className="notice"><strong>{preview.companyName}</strong><p>{preview.articleCount} 篇文章 · {preview.assetCount} 张图片 · {preview.templateCount} 个模板 · {preview.factCount} 条事实。包含企业业务资料；登录授权和发布任务为零。</p>
      <button className="primary-button" disabled={busy} onClick={()=>void act(async()=>{const result=await window.publisherAPI.colleaguePackages.import(preview.previewId);setPreview(null);onImported();setMessage(`已新建企业 ${result.companyName}，导入 ${result.articleCount} 篇 Draft。请在工作区下拉框选择新企业，再完成同事自己的账号设置。`);})}>作为新企业导入 Draft</button>
    </div>}
  </section>;
}
