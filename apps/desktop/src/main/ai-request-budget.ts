import { createHash, randomUUID } from 'node:crypto';
import type { AppRepository } from '@publisher/db';
import type { AIRequestBudget, AIWorkloadEstimate, AIWorkloadPreview } from '../shared/ai-request-budget';
type BudgetRow={id:string;company_id:string;preview_json:string;max_requests:number;issued_requests:number;status:string;request_fingerprint:string;snapshot_fingerprint:string;created_at:string};
export function requestFingerprint(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function error(code:string):Error{return Object.assign(new Error(code),{code});}
const shared=new WeakMap<AppRepository,AiRequestGovernor>();
export function aiRequestGovernor(repository:AppRepository):AiRequestGovernor{let governor=shared.get(repository);if(!governor){governor=new AiRequestGovernor(repository);shared.set(repository,governor);}return governor;}

/** Main-wide single lane, with a durable claim before each billable generation request. */
export class AiRequestGovernor {
  private tail:Promise<unknown>=Promise.resolve();private waiting=0;
  constructor(private readonly repository:AppRepository){repository.db.prepare("UPDATE ai_request_journal SET status='Unknown',error_code='PROCESS_INTERRUPTED',finished_at=? WHERE status='Started'").run(new Date().toISOString());}
  preview(estimate:AIWorkloadEstimate,fingerprint:string,snapshotFingerprint:string):AIWorkloadPreview{
    if(!Number.isSafeInteger(estimate.maxRequests)||estimate.maxRequests<1||estimate.maxRequests>1000||estimate.baseRequests>estimate.maxRequests)throw error('AI_BUDGET_INVALID');
    const preview={...estimate,previewId:randomUUID(),createdAt:new Date().toISOString()};
    this.repository.db.prepare("INSERT INTO ai_request_budgets(id,company_id,kind,request_fingerprint,snapshot_fingerprint,preview_json,max_requests,issued_requests,status,created_at) VALUES(?,?,?,?,?,?,?,0,'Preview',?)").run(preview.previewId,preview.companyId,preview.kind,fingerprint,snapshotFingerprint,JSON.stringify(preview),preview.maxRequests,preview.createdAt);return preview;
  }
  get(id:string):AIRequestBudget{const row=this.repository.db.prepare('SELECT * FROM ai_request_budgets WHERE id=?').get(id) as BudgetRow|undefined;if(!row)throw error('AI_BUDGET_NOT_FOUND');return{...JSON.parse(row.preview_json) as AIWorkloadPreview,issuedRequests:row.issued_requests,status:row.status,requestFingerprint:row.request_fingerprint,snapshotFingerprint:row.snapshot_fingerprint};}
  activate(id:string,companyId:string,fingerprint:string,snapshotFingerprint:string):AIRequestBudget{
    const budget=this.get(id);if(budget.status!=='Preview'||budget.companyId!==companyId||budget.requestFingerprint!==fingerprint||budget.snapshotFingerprint!==snapshotFingerprint||Date.now()-Date.parse(budget.createdAt)>30*60*1000)throw error('AI_PREVIEW_STALE');
    const updated=this.repository.db.prepare("UPDATE ai_request_budgets SET status='Active' WHERE id=? AND status='Preview'").run(id);if(updated.changes!==1)throw error('AI_PREVIEW_STALE');return this.get(id);
  }
  async read<T>(action:()=>Promise<T>):Promise<T>{if(this.waiting>=32)throw error('AI_GLOBAL_WAIT_LIMIT');this.waiting++;const operation=this.tail.catch(()=>{}).then(async()=>{this.waiting--;return action();});this.tail=operation;return operation;}
  async run<T>(budgetId:string,generationId:string,purpose:'Base'|'TitleRepair',currentSnapshot:()=>string,action:()=>Promise<T>,signal?:AbortSignal,beforeRequest?:()=>void):Promise<T>{
    if(this.waiting>=32)throw error('AI_GLOBAL_WAIT_LIMIT');this.waiting++;
    const operation=this.tail.catch(()=>{}).then(async()=>{
      this.waiting--;
      if(signal?.aborted)throw error('AI_CANCELED');beforeRequest?.();
      const budget=this.get(budgetId);if(budget.status!=='Active'||budget.snapshotFingerprint!==currentSnapshot())throw error('AI_PREVIEW_STALE');
      const ticket=randomUUID(),createdAt=new Date().toISOString();
      this.repository.db.transaction(()=>{
        const claimed=this.repository.db.prepare("UPDATE ai_request_budgets SET issued_requests=issued_requests+1 WHERE id=? AND status='Active' AND issued_requests<max_requests").run(budgetId);if(claimed.changes!==1)throw error('AI_BUDGET_EXHAUSTED');
        this.repository.db.prepare("INSERT INTO ai_request_journal(id,budget_id,generation_id,purpose,status,created_at) VALUES(?,?,?,?,'Started',?)").run(ticket,budgetId,generationId,purpose,createdAt);
      }).immediate();
      try{
        const result=await action();
        if(signal?.aborted)throw error('TRANSPORT_UNKNOWN');
        if(currentSnapshot()!==budget.snapshotFingerprint)throw error('RESULT_CONTEXT_CHANGED');
        try{beforeRequest?.();}catch{throw error('RESULT_CONTEXT_CHANGED');}
        let usage:{input?:number;output?:number}|undefined;
        if(result&&typeof result==='object'&&'tokenUsage' in result)usage=result.tokenUsage as typeof usage;
        const tokens=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.min(10_000_000,Math.floor(value)):null;
        this.repository.db.prepare("UPDATE ai_request_journal SET status='Succeeded',input_tokens=?,output_tokens=?,finished_at=? WHERE id=? AND status='Started'").run(tokens(usage?.input),tokens(usage?.output),new Date().toISOString(),ticket);return result;
      }catch(reason){const code=reason&&typeof reason==='object'&&'code' in reason?String(reason.code):'REQUEST_FAILED';const unknown=['TRANSPORT_UNKNOWN','RESULT_CONTEXT_CHANGED','AI_CANCELED'].includes(code)||signal?.aborted;this.repository.db.prepare("UPDATE ai_request_journal SET status=?,error_code=?,finished_at=? WHERE id=? AND status='Started'").run(unknown?'Unknown':'Failed',code,new Date().toISOString(),ticket);throw reason;}
    });
    this.tail=operation;return operation;
  }
}
