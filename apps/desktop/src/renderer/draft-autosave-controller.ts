import type { DraftCommitResult, DraftEditSnapshot, DraftWorkingCopiesApi, DraftWorkingCopy } from "../shared/draft-working-copies";
export interface AutosaveState { phase: "Saved" | "Saving" | "Failed" | "Conflict"; message: string }
const flushers = new Set<() => Promise<void>>();
export function registerDraftFlusher(flush:()=>Promise<void>):()=>void {flushers.add(flush);return()=>flushers.delete(flush);}
export async function flushDraftEditors():Promise<void>{for(const flush of [...flushers])await flush();}

/** This controller never sets text or selection during ordinary persistence. */
export class DraftAutosaveController {
  confirmed:DraftWorkingCopy;
  snapshot:DraftEditSnapshot;
  state:AutosaveState={phase:"Saved",message:"已保存到本机工作副本"};
  private revision:number;
  private composing=false;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private deadline:ReturnType<typeof setTimeout>|null=null;
  private pending:Promise<void>|null=null;
  constructor(copy:DraftWorkingCopy,private readonly api:DraftWorkingCopiesApi,private readonly changed:()=>void){this.confirmed=copy;this.snapshot={...copy.snapshot};this.revision=copy.localVersion;if(copy.status==='Conflict')this.state={phase:'Conflict',message:'存在版本冲突；恢复文本已保留'};}
  capture(snapshot:DraftEditSnapshot):void {if(snapshot.title===this.snapshot.title&&snapshot.body===this.snapshot.body)return;this.snapshot={...snapshot};this.revision++;this.state={phase:'Saving',message:'保存中…'};this.changed();this.schedule();}
  composition(value:boolean):void {this.composing=value;if(value)this.clearTimers();else if(this.revision>this.confirmed.localVersion)this.schedule();}
  private schedule():void {if(this.composing)return;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush().catch(()=>{});},350);if(!this.deadline)this.deadline=setTimeout(()=>{void this.flush().catch(()=>{});},750);}
  private clearTimers():void {if(this.timer)clearTimeout(this.timer);if(this.deadline)clearTimeout(this.deadline);this.timer=null;this.deadline=null;}
  async flush():Promise<void>{
    this.clearTimers();if(this.composing)throw new Error('中文输入尚未完成，请结束当前输入后再离开');
    while(this.revision>this.confirmed.localVersion){if(this.pending){await this.pending;continue;}
      const version=this.revision,snapshot={...this.snapshot};this.state={phase:'Saving',message:'保存中…'};this.changed();
      this.pending=(async()=>{try{
        if(!this.confirmed.activeEditing)this.confirmed=await this.api.open({companyId:this.confirmed.companyId,documentKind:this.confirmed.documentKind,documentId:this.confirmed.documentId,copyId:this.confirmed.copyId});
        const ack=await this.api.persist({companyId:this.confirmed.companyId,copyId:this.confirmed.copyId,baseVersion:this.confirmed.baseVersion,localVersion:version,snapshot});
        if(ack.localVersion!==version)throw new Error('Main 未确认当前编辑版本，请重新读取草稿');
        this.confirmed=ack;this.state=ack.status==='Conflict'?{phase:'Conflict',message:'存在冲突；文本已保存为恢复草稿'}:version===this.revision?{phase:'Saved',message:'已保存到本机工作副本'}:{phase:'Saving',message:'保存新版本中…'};
      }catch(error){this.state={phase:'Failed',message:error instanceof Error?error.message:'保存失败；最后确认的快照已保留'};throw error;}finally{this.changed();}})();
      try{await this.pending;}finally{this.pending=null;}
    }
  }
  async leave():Promise<void>{await this.flush();this.confirmed=await this.api.release({companyId:this.confirmed.companyId,copyId:this.confirmed.copyId,localVersion:this.confirmed.localVersion});}
  async commit():Promise<DraftCommitResult>{await this.flush();return this.api.commit({companyId:this.confirmed.companyId,copyId:this.confirmed.copyId,baseVersion:this.confirmed.baseVersion,localVersion:this.confirmed.localVersion});}
  async discard():Promise<void>{this.clearTimers();if(this.pending)await this.pending;this.confirmed=await this.api.discard({companyId:this.confirmed.companyId,copyId:this.confirmed.copyId,localVersion:this.confirmed.localVersion});this.snapshot={...this.confirmed.currentSnapshot};this.revision=this.confirmed.localVersion;this.changed();}
}
