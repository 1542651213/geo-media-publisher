import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { DraftDocumentRef, DraftEditSnapshot, DraftWorkingCopy } from "../shared/draft-working-copies";
import { DraftAutosaveController, registerDraftFlusher, type AutosaveState } from "./draft-autosave-controller";

export function useWorkingDraft(document:DraftDocumentRef,enabled:boolean,onRecovered:(snapshot:DraftEditSnapshot)=>void){
  const {companyId,documentKind,documentId}=document;
  const controller=useRef<DraftAutosaveController|null>(null),recoveredCallback=useRef(onRecovered);
  recoveredCallback.current=onRecovered;
  const [state,setState]=useState<AutosaveState>({phase:'Saving',message:'正在打开本机编辑工作副本…'});
  const [ready,setReady]=useState(false),[recovery,setRecovery]=useState<DraftWorkingCopy[]>([]);
  useEffect(()=>{if(!enabled)return;let active=true;let unregister:(()=>void)|undefined;
    void (async()=>{try{const api=window.publisherAPI.drafts;const copies=await api.listRecovery({companyId});const copy=await api.open({companyId,documentKind,documentId});
      if(!active){await api.release({companyId:copy.companyId,copyId:copy.copyId,localVersion:copy.localVersion});return;}
      const session=new DraftAutosaveController(copy,api,()=>{if(active)setState({...session.state});});controller.current=session;
      setRecovery(copies.filter(item=>item.canonicalMissing||item.documentKind===documentKind&&item.documentId===documentId));setReady(true);setState({...session.state});
      unregister=registerDraftFlusher(()=>controller.current?.leave()??Promise.resolve());
    }catch(error){if(active)setState({phase:'Failed',message:error instanceof Error?error.message:'无法打开本机草稿，请保留当前页面'});}})();
    return()=>{active=false;unregister?.();const session=controller.current;controller.current=null;if(session)void session.leave().catch(()=>{});};
  },[companyId,documentKind,documentId,enabled]);
  const capture=(snapshot:DraftEditSnapshot):void=>{controller.current?.capture(snapshot);};
  const composition=(value:boolean):void=>{controller.current?.composition(value);};
  const leave=async():Promise<void>=>{if(enabled&&!controller.current)throw new Error('编辑工作副本尚未打开，不能静默关闭');await controller.current?.leave();};
  const commit=async()=>{if(!controller.current)throw new Error('请等待本机草稿就绪');return controller.current.commit();};
  const resolve=async(copy:DraftWorkingCopy,choice:'current'|'recovered'):Promise<void>=>{
    const api=window.publisherAPI.drafts;
    const latest=await api.get({companyId:copy.companyId,copyId:copy.copyId});
    if(choice==='current'){await api.discard({companyId:copy.companyId,copyId:copy.copyId,localVersion:latest.localVersion});setRecovery(current=>current.filter(item=>item.copyId!==copy.copyId));return;}
    await controller.current?.discard();
    const restored=await api.resolve({companyId:copy.companyId,copyId:copy.copyId,localVersion:latest.localVersion,choice,expectedCurrentVersion:latest.currentVersion});
    const session=new DraftAutosaveController(restored,api,()=>setState({...session.state}));controller.current=session;recoveredCallback.current(restored.snapshot);setState({...session.state});setRecovery(current=>current.filter(item=>item.copyId!==copy.copyId));
  };
  return{ready,locked:controller.current?.locked??false,state,recovery,capture,composition,leave,commit,resolve};
}
export function DraftRecoveryNotice({draft}:{draft:ReturnType<typeof useWorkingDraft>}):JSX.Element{
  const [difference,setDifference]=useState<string|null>(null),[error,setError]=useState('');
  const act=(copy:DraftWorkingCopy,choice:'current'|'recovered'):void=>{if(copy.canonicalMissing&&choice==='recovered'){setDifference(copy.copyId);setError('原文已删除，不能覆盖其他文档。恢复文本仍保留，可从差异区复制到新草稿。');return;}void draft.resolve(copy,choice).catch(reason=>setError(reason instanceof Error?reason.message:'恢复失败；文本仍保留'));};
  return <div className="draft-save-status" aria-live="polite"><strong>{draft.state.phase==='Failed'?'保存失败':draft.state.phase==='Conflict'?'存在冲突':draft.state.phase==='Saving'?'保存中':'已保存'}</strong><span>{draft.state.message}；工作副本提交后还需重新审核。</span>{error&&<p className="notice error">{error}</p>}{draft.recovery.map(copy=><section key={copy.copyId} className="notice"><p>发现上次编辑 · {new Date(copy.updatedAt).toLocaleString()} {copy.status==='Conflict'?'· 当前内容已有新版本':''}</p><div className="row-actions"><button className="secondary-button" onClick={()=>act(copy,'recovered')}>恢复上次编辑</button><button className="secondary-button" onClick={()=>setDifference(difference===copy.copyId?null:copy.copyId)}>查看差异</button><button className="secondary-button" onClick={()=>act(copy,'current')}>保留当前版本</button></div>{difference===copy.copyId&&<div className="draft-diff"><label>当前版本<textarea readOnly value={copy.currentSnapshot.title+'\n'+copy.currentSnapshot.body} rows={5}/></label><label>恢复草稿<textarea readOnly value={copy.snapshot.title+'\n'+copy.snapshot.body} rows={5}/></label></div>}</section>)}</div>;
}
