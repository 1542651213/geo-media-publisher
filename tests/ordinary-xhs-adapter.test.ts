import { expect, it } from "vitest";
import { XiaohongshuBrowserAdapter } from "../packages/adapters/xiaohongshu/src/browser";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";
import type { BrowserPublishAttemptContext } from "@publisher/adapters-core";
it("ordinary XHS routes a PRODUCTION guard without inventing a one-shot authorization",async()=>{
 const calls:string[]=[];
 const adapter={
  accountOperationMutex:{run:async(_key:string,task:()=>Promise<unknown>)=>task()},
  performProductionFinalSubmit:async()=>{calls.push("production");return {success:true,response:{controlledBoundary:true}};}
 } as unknown as XiaohongshuBrowserAdapter;
 const attempt:BrowserPublishAttemptContext={jobId:"job",submissionIntentId:"intent",attempt:1,productionPublicationGuard:{accountId:"account",contentSnapshotId:"snapshot",claim:()=>{throw Error("boundary replacement must own this call");}}};
 const result=await XiaohongshuBrowserAdapter.prototype.finalSubmit.call(adapter,{accountId:"account",accountName:"account",platformKey:"xiaohongshu",settings:{}} as AccountContext,{articleId:"article",title:"title",body:"body",summary:"",tags:[],contentSnapshotId:"snapshot"} as PublishArticleInput,attempt);
 expect(result.success).toBe(true);expect(calls).toEqual(["production"]);expect(attempt.oneShotPublicationGuard).toBeUndefined();
});
it("ordinary reconciliation cannot infer this operation from historical title, display name or wait time",async()=>{
 const page={url:()=>"https://www.xiaohongshu.com/explore/old",locator:()=>({innerText:async()=>"same title same display name"})};
 const adapter={activeCanonicalPage:async()=>({page}),publicResultFromUrl:()=>({externalId:"old",publishedUrl:"https://www.xiaohongshu.com/explore/old"})} as unknown as XiaohongshuBrowserAdapter;
 const result=await XiaohongshuBrowserAdapter.prototype.reconcile.call(adapter,{accountId:"account",accountName:"same display name",platformKey:"xiaohongshu",settings:{ordinaryProduction:true}} as AccountContext,{jobId:"new",articleId:"article",title:"same title",accountName:"same display name",windowStart:new Date().toISOString(),windowEnd:new Date().toISOString(),waitWindowSatisfied:true,submissionIntentState:"Submitted",finalSubmitCount:1,expectedExternalId:null});
 expect(result.status).toBe("STILL_UNCERTAIN");
});
