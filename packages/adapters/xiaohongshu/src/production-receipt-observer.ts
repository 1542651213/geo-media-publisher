import { createHash } from "node:crypto";
import type { Page, Request, Response } from "playwright-core";

export interface XhsReceiptMeta { accountId:string; creatorId:string; jobId:string; intentId:string; snapshotId:string; buildSha256:string; contextId:string; pageId:string }
export type XhsReceiptEvent = {phase:"OBSERVER_READY"|"ARMED"|"REQUEST"|"RESPONSE"|"CAPTURE_ERROR"; at:string; meta:XhsReceiptMeta; requestSequence?:number; origin?:string; pathSha256?:string; method?:string; resourceType?:string; httpStatus?:number; bodySha256?:string; projectedBody?:unknown; errorCode?:string};
const hash=(value:string):string=>createHash("sha256").update(value).digest("hex");
const allowed=new Set(["data","result","id","note_id","noteid","post_id","postid","item_id","itemid","status","state","success","code","url","note_url","publish_url","type","review_status","audit_status"]);
function allowedOrigin(url:URL):boolean{return url.protocol==="https:"&&(url.hostname==="xiaohongshu.com"||url.hostname.endsWith(".xiaohongshu.com"))||url.protocol==="http:"&&url.hostname==="127.0.0.1";}
function safeUrl(value:string):string|null{try{const url=new URL(value);if(url.protocol!=="https:" && url.protocol!=="http:")return null;return url.origin+url.pathname;}catch{return null;}}
function project(value:unknown,depth:number):unknown {
  if(depth>5)return undefined;
  if(Array.isArray(value))return value.slice(0,8).map(item=>project(item,depth+1));
  if(typeof value!=="object"||value===null)return undefined;
  const result:Record<string,unknown>={};
  for(const [key,item] of Object.entries(value)){
    if(!allowed.has(key.toLowerCase()) || Object.keys(result).length>=24)continue;
    let projected:unknown;
    if(typeof item==="string")projected=key.toLowerCase().endsWith("url")||key.toLowerCase()==="url"?safeUrl(item):item.slice(0,200);
    else if(typeof item==="number"||typeof item==="boolean")projected=item;
    else projected=project(item,depth+1);
    if(projected!==undefined && projected!==null)result[key]=projected;
  }
  return result;
}
/** Only allowlisted fields are persisted. Raw response bytes are hashed, never written. */
export function projectSafeResponse(body:string):unknown {
  try{return project(JSON.parse(body) as unknown,0)??{format:"NO_ALLOWED_FIELDS"};}
  catch{return {format:"NON_JSON"};}
}

/** Captures this Page's own network events; no response schema is assumed. */
export class XhsProductionReceiptObserver {
  private ready=false;
  private armed=false;
  private stopped=false;
  private sequence=0;
  private pending=new Set<Promise<void>>();
  private firstFailure:Error|null=null;
  private requests=new WeakMap<Request,{sequence:number;pathSha256:string;origin:string}>();
  constructor(private readonly page:Page,private readonly meta:XhsReceiptMeta,private readonly persist:(event:XhsReceiptEvent)=>void){}
  private write(event:Omit<XhsReceiptEvent,"at"|"meta">):void {this.persist({...event,at:new Date().toISOString(),meta:this.meta});}
  start():void {
    if(this.ready||this.stopped||this.page.isClosed())throw new Error("XHS_RECEIPT_OBSERVER_NOT_READY");
    this.page.on("request",this.onRequest);this.page.on("response",this.onResponse);
    try{this.write({phase:"OBSERVER_READY"});this.ready=true;}
    catch(error){this.page.off("request",this.onRequest);this.page.off("response",this.onResponse);throw error;}
  }
  arm():void {
    if(!this.ready||this.armed||this.stopped||this.page.isClosed())throw new Error("XHS_RECEIPT_OBSERVER_NOT_READY");
    this.write({phase:"ARMED"});this.armed=true;
  }
  private readonly onRequest=(request:Request):void=>{
    if(!this.armed||this.stopped)return;
    let url:URL;try{url=new URL(request.url());}catch{return;}
    if(!allowedOrigin(url))return;
    const sequence=++this.sequence;const pathSha256=hash(url.pathname);this.requests.set(request,{sequence,pathSha256,origin:url.origin});
    try{this.write({phase:"REQUEST",requestSequence:sequence,origin:url.origin,pathSha256,method:request.method(),resourceType:request.resourceType()});}
    catch(error){this.firstFailure=error instanceof Error?error:new Error(String(error));}
  };
  private readonly onResponse=(response:Response):void=>{
    const reference=this.requests.get(response.request());if(!reference||this.stopped)return;
    const task=(async()=>{
      try{
        const body=await response.text();
        this.write({phase:"RESPONSE",requestSequence:reference.sequence,origin:reference.origin,pathSha256:reference.pathSha256,httpStatus:response.status(),bodySha256:hash(body),projectedBody:projectSafeResponse(body.slice(0,1_000_000))});
      }catch(error){this.firstFailure=error instanceof Error?error:new Error(String(error));try{this.write({phase:"CAPTURE_ERROR",requestSequence:reference.sequence,errorCode:"RESPONSE_READ_OR_PERSIST_FAILED"});}catch{/* preserve first failure */}}
    })();this.pending.add(task);void task.finally(()=>this.pending.delete(task));
  };
  async flush():Promise<void>{await Promise.allSettled([...this.pending]);if(this.firstFailure)throw this.firstFailure;}
  result():{status:"UNKNOWN_SCHEMA";accepted:false;published:false;requestCount:number}{return {status:"UNKNOWN_SCHEMA",accepted:false,published:false,requestCount:this.sequence};}
  stop():void{if(this.stopped)return;this.stopped=true;this.page.off("request",this.onRequest);this.page.off("response",this.onResponse);}
}

/** Keep the observer alive after an uncertain click error so late same-page responses can be saved. */
export async function settleReceiptCapture<T>(observer:XhsProductionReceiptObserver,action:()=>Promise<T>,potentiallySubmitted:()=>boolean,settleMs=5000):Promise<T>{
  observer.start();
  let result:T|undefined;
  let failure:unknown=null;
  try{result=await action();}catch(error){failure=error;}
  try{
    if(potentiallySubmitted())await new Promise<void>(resolve=>setTimeout(resolve,settleMs));
    await observer.flush();
  }catch(error){if(failure===null)failure=error;}
  finally{observer.stop();}
  if(failure!==null)throw failure;
  return result as T;
}
