import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import { AdapterRegistry, type BrowserPublishReconciliationInput, type BrowserPublishAttemptContext } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { PublisherService, PersistentScheduler } from "@publisher/publisher";
import { createConsoleLogger } from "@publisher/logger";
import type { AccountContext, ImageAsset, PublishArticleInput, PublishJob, PublishResult, XhsContextIdentityAttestation } from "@publisher/domain";
import { registerIpc } from "../apps/desktop/src/main/ipc";
import { parseFormalXhsProductionPilotConfig } from "../apps/desktop/src/main/formal-xhs-production-pilot-config";
import * as formalPilot from "../apps/desktop/src/main/formal-xhs-production-pilot";
import { XiaohongshuBrowserAdapter } from "../packages/adapters/xiaohongshu/src/browser";
const transport=vi.hoisted(()=>({handlers:new Map<string,(e:unknown,p:unknown)=>Promise<unknown>>(),openDialog:vi.fn(async()=>({canceled:true,filePaths:[]}))}));
vi.mock("electron",()=>({ipcMain:{removeHandler:(n:string)=>transport.handlers.delete(n),handle:(n:string,h:(e:unknown,p:unknown)=>Promise<unknown>)=>transport.handlers.set(n,h)},dialog:{showOpenDialog:()=>transport.openDialog()},shell:{},app:{getVersion:()=>"isolated"}}));
vi.mock("node:original-fs",()=>({readFileSync}));
vi.mock("../apps/desktop/src/main/ai-batch",()=>({resumePersistentBatches:vi.fn()}));
vi.mock("../apps/desktop/src/main/content-studio",()=>({resumeContentStudioTasks:vi.fn()}));
const close:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const f of close.splice(0))await f();});
async function setup(scopedLive=false,authorized=true,scopedLiveGuard?: (channel: string, payload: unknown, repository: ReturnType<typeof openDatabase>["repository"]) => void,crossBrand?: { permit?: (articleId: string, imageAssetId: string) => { articleId: string; imageAssetId: string } | null; assets?: (articleId: string, brandId: string | undefined) => ImageAsset[] }){
 const dir=mkdtempSync(join(tmpdir(),"ordinary-xhs-"));const {db,repository:repo}=openDatabase(join(dir,"publisher.db"),join(process.cwd(),"packages/db/migrations"));
 repo.seedDevelopment(join(process.cwd(),"PLATFORMS.csv"));repo.setSetting("contentReviewMode","Off");
 const brand=repo.createBrand({name:"Pilot",companyName:"Synthetic"});
 const account=repo.createAccount({platformKey:"xiaohongshu",name:"Synthetic creator"});
 repo.syncBrowserPlatformAccount({accountId:account.id,platformKey:"xiaohongshu",browserSessionId:"synthetic-session",externalAccountId:"synthetic-creator"});
 repo.updateAccount(account.id,{loginStatus:"logged_in",minimumIntervalSeconds:0});
 const article=repo.createArticle({brandId:brand.id,topic:"pilot",keyword:"pilot",city:"",title:"普通文章",body:"明确选中的普通正文",summary:"",tags:[],seoKeywords:[],articleType:"article",aiProvider:"fixture",aiModel:"fixture",generatedAt:new Date().toISOString(),reusePolicy:"always",contentHash:randomUUID(),source:"production"})!;
 const bytes=Buffer.from("synthetic image bytes");const path=join(dir,"image.png");writeFileSync(path,bytes);
 const image=repo.createImageAsset({brandId:brand.id,name:"明确图片",filePath:path,originalFileName:"image.png",mimeType:"image/png",size:bytes.length,universal:true});
 const receipts:Array<Record<string,unknown>>=[];let drop=false;let live=true;let uploads=0;let releases=0;const releasedStatuses:string[]=[];
 const server=createServer((req,res)=>{let body="";req.on("data",b=>body+=String(b));req.on("end",()=>{receipts.push(JSON.parse(body) as Record<string,unknown>);if(drop)req.socket.destroy();else res.end("accepted");});});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const addr=server.address();if(!addr||typeof addr==="string")throw Error("loopback");
 const subject=():XhsContextIdentityAttestation=>({accountId:account.id,platformKey:"xiaohongshu",expectedExternalCreatorId:"synthetic-creator",observedExternalCreatorId:"synthetic-creator",externalAccountId:"synthetic-creator",browserSessionIdentity:"synthetic-session",browserContextIdentity:"synthetic-context",sourcePageIdentity:"synthetic-page",sourceOrigin:"https://creator.xiaohongshu.com",sourcePathname:"/publish/publish",issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),verified:true});
 const base=new TestPlatformAdapter();
 const adapter=Object.assign(base,{platformKey:"xiaohongshu",manifest:{...base.manifest,platformKey:"xiaohongshu",transport:"browser",integrationMode:"BrowserAutomation"},automationType:"BrowserAutomation",supportsBoundImageBuffers:true,
 connectAccount:async()=>({}),checkSession:async()=>"logged_in",checkLogin:async()=>"logged_in",
 validateArticle:async()=>({valid:true,errors:[],warnings:[]}),
 validatePreparedSession:async()=>{if(!live)throw Object.assign(Error("PREPARED_PAGE_UNAVAILABLE"),{code:"USER_ACTION_REQUIRED"});},
 releasePreparedSession:async(ctx:AccountContext)=>{releases++;releasedStatuses.push(repo.getJob(String(ctx.settings.publishJobId))?.status ?? "missing");live=false;},
 preparePublish:async(_ctx:AccountContext,input:PublishArticleInput)=>{uploads++;expect(input.boundImages?.[0]?.buffer).toEqual(bytes);live=true;return {prepared:true,requiresUserAction:true,message:"准备完成，等待确认",titleFilled:true,bodyFilled:true,response:{imageUploaded:true,uploadedImageSha256:createHash("sha256").update(bytes).digest("hex"),titleReadbackValue:input.title,bodyReadbackValue:input.body}};},
 finalSubmit:async(ctx:AccountContext,input:PublishArticleInput,attempt:BrowserPublishAttemptContext):Promise<PublishResult>=>{
  const boundary=attempt as BrowserPublishAttemptContext & {productionPublicationGuard?:{claim:(s:XhsContextIdentityAttestation)=>void}};
  if(!boundary.productionPublicationGuard)return XiaohongshuBrowserAdapter.prototype.finalSubmit.call({} as XiaohongshuBrowserAdapter,ctx,input,attempt);
  boundary.productionPublicationGuard.claim(subject());
  return new Promise((resolve,reject)=>{const r=request({hostname:"127.0.0.1",port:addr.port,method:"POST"},res=>{res.resume();res.on("end",()=>resolve({success:true,status:"published",externalId:"receipt-"+attempt.submissionIntentId,publishedUrl:"http://127.0.0.1/"+attempt.submissionIntentId,response:{imageUploaded:true}}));});r.on("error",reject);r.end(JSON.stringify({articleId:input.articleId,intentId:attempt.submissionIntentId,title:input.title,body:input.body,snapshot:input.contentSnapshotId}));});
 },
 reconcile:async(ctx:AccountContext,input:BrowserPublishReconciliationInput)=>{
  expect(ctx.settings.ordinaryProduction).toBe(true);expect(ctx.settings.publishJobId).toBe(input.jobId);
  const receipt=receipts.find(r=>r.intentId===input.submissionIntentId&&r.snapshot===input.contentSnapshotId&&r.title===input.title&&r.articleId===input.articleId);
  return {status:receipt?"FOUND_PUBLISHED" as const:"STILL_UNCERTAIN" as const,titleMatch:!!receipt,accountMatch:!!receipt,timeWindowMatch:!!receipt,externalId:receipt?"receipt-"+String(receipt.intentId):undefined,publishedUrl:receipt?"http://127.0.0.1/"+String(receipt.intentId):undefined,response:{synthetic:true,receipt},message:"exact server operation receipt only"};
 },verifyPublished:async(_ctx:AccountContext,input:PublishArticleInput,r:Pick<PublishResult,"externalId"|"publishedUrl">)=>({status:receipts.some(receipt=>"receipt-"+String(receipt.intentId)===r.externalId&&receipt.snapshot===input.contentSnapshotId&&receipt.title===input.title&&receipt.body===input.body)?"published" as const:"publishing" as const,...r,response:{mock:true}})});
 const registry=new AdapterRegistry();registry.register(adapter);const logger=createConsoleLogger();const publisher=new PublisherService(repo,registry,logger,{resolveRuntimeIdentityAttestation:subject,...(authorized?{onScopedProductionBoundary:()=>{}}:{})});
 const credentials={get:()=>null,has:()=>false,set:()=>{throw Error("no secrets");},delete:()=>{throw Error("no secrets");}};
 registerIpc({resumeBackgroundTasks:false,scopedLiveGuard:scopedLive ? ((channel, payload) => scopedLiveGuard ? scopedLiveGuard(channel, payload, repo) : undefined) : undefined,crossBrandImageBindingPermit:crossBrand?.permit,crossBrandImageAssetsForArticle:crossBrand?.assets,repository:repo,publisher,registry,scheduler:new PersistentScheduler(repo,publisher,logger),resolveAccountSecrets:()=>({}),credentials,aiCredentials:credentials,dataDirectory:dir,coverDir:dir,appLogPath:join(dir,"log"),databasePath:join(dir,"publisher.db"),logger});
 const handlers=new Map(transport.handlers);const invoke=async(n:string,p:unknown)=>{const h=handlers.get(n);if(!h)throw Error("MISSING_HANDLER "+n);return h({},p);};
 const prepare=(articleId=article.id)=>invoke("articles:prepare-publish",{articleId,platformKey:"xiaohongshu",platformAccountId:account.id,selectedImageAssetId:image.id,imageSelectionMode:"manual",finalPublishMode:"CONFIRM_BEFORE_PUBLISH"}) as Promise<{job:PublishJob}>;
 close.push(async()=>{db.close();await new Promise<void>((r,e)=>server.close(x=>x?e(x):r()));});
 return {adapter,repo,db,article,account,image,prepare,invoke,receipts,publisher,setDead:()=>{live=false;},drop:()=>{drop=true;},counts:()=>({uploads,releases,releasedStatuses}),dir,path};
}
it("formal pilot leaves ordinary article, image, and Excel UI IPC on their normal Repository contracts",async()=>{
 const guard=(formalPilot as typeof formalPilot & {assertFormalXhsProductionPilotIpc?: (config: ReturnType<typeof parseFormalXhsProductionPilotConfig>, channel:string, payload:unknown, repository: ReturnType<typeof openDatabase>["repository"])=>void}).assertFormalXhsProductionPilotIpc;
 expect(typeof guard).toBe("function");
 const f=await setup(true,true,(channel,payload,repository)=>guard!(parseFormalXhsProductionPilotConfig({version:1,pilotId:"GEO_XHS_PRODUCTION_PILOT_MAX3_20260918",expiresAtUtc:"2026-09-18T14:59:59Z",maxFinalSubmissions:3,executablePath:"C:/GMP/Geo Media Publisher.exe",executableSha256:"a".repeat(64),appAsarPath:"C:/GMP/resources/app.asar",appAsarSha256:"a".repeat(64)}),channel,payload,repository));
 await expect(f.invoke("articles:excel-pick",{defaultBrandId:f.article.brandId})).resolves.toBeNull();
 expect(transport.openDialog).toHaveBeenCalled();
 await expect(f.invoke("articles:update",{id:f.article.id,data:{title:"普通编辑后的文章",body:"普通编辑后的正文",tags:[]}})).resolves.toMatchObject({id:f.article.id,title:"普通编辑后的文章",body:"普通编辑后的正文",tags:[]});
 await expect(f.invoke("image-assets:select-for-article",{articleId:f.article.id,platformKey:"xiaohongshu"})).resolves.toBeNull();
 expect(f.repo.listJobs()).toHaveLength(0);expect(f.repo.getPublishRecords(f.article.id)).toHaveLength(0);expect(f.receipts).toHaveLength(0);
});
it("complete-login restores one archived Creator through the real IPC handler before identity persistence",async()=>{
 const guard=(formalPilot as typeof formalPilot & {assertFormalXhsProductionPilotIpc?: (config: ReturnType<typeof parseFormalXhsProductionPilotConfig>, channel:string, payload:unknown, repository: ReturnType<typeof openDatabase>["repository"])=>void}).assertFormalXhsProductionPilotIpc;
 expect(typeof guard).toBe("function");
 let configuredAccountId="";
 const f=await setup(true,true,(channel,payload,repository)=>guard!(parseFormalXhsProductionPilotConfig({version:1,pilotId:"GEO_XHS_PRODUCTION_PILOT_MAX3_20260918",expiresAtUtc:"2026-09-18T14:59:59Z",maxFinalSubmissions:3,executablePath:"C:/GMP/Geo Media Publisher.exe",executableSha256:"a".repeat(64),appAsarPath:"C:/GMP/resources/app.asar",appAsarSha256:"a".repeat(64),xhsAccountId:configuredAccountId}),channel,payload,repository));
 const archived=f.account;
 configuredAccountId=archived.id;
 f.repo.bootstrapXhsCreatorIdentity({accountId:archived.id,observedCreatorId:"synthetic-creator"});
 f.repo.markPlatformAccountDisconnected(archived.id,"xiaohongshu");
 const transient=f.repo.createAccount({platformKey:"xiaohongshu",name:"Temporary login account"});
 const rebound:Array<[string,string]>=[];
 Object.assign(f.adapter,{
   completeConnection:async()=>"logged_in" as const,
   getBrowserRuntimeSnapshot:(context:AccountContext)=>({platformKey:"xiaohongshu",accountId:context.accountId,sessionExists:true,browserConnected:true,contextExists:true,canonicalPageExists:true,canonicalPageClosed:false,canonicalPageContextMatchesSession:true,runtimeAuthState:"UNVERIFIED",browserSessionIdentity:`session-${context.accountId}`,contextDebugId:`context-${context.accountId}`}),
   verifyIdentityOnContextPage:async(context:AccountContext)=>({status:"PASS",proof:{creatorId:"synthetic-creator",browserSessionId:`session-${context.accountId}`,contextId:`context-${context.accountId}`,pageId:`page-${context.accountId}`,pageOrigin:"https://creator.xiaohongshu.com",pagePathname:"/new/home"}}),
   getAccountProfile:async()=>({accountId:"synthetic-creator",accountName:"Synthetic creator"}),
   rebindAccountSession:(from:AccountContext,to:AccountContext)=>{rebound.push([from.accountId,to.accountId]);},
   persistConnectionSession:async()=>{},releaseConnectionPage:async()=>{}
 });
 await expect(f.invoke("accounts:begin-login",{accountId:transient.id,platformKey:"xiaohongshu"})).resolves.toMatchObject({});
 await expect(f.invoke("accounts:check-login",{accountId:transient.id,platformKey:"xiaohongshu"})).rejects.toThrow("FORMAL_XHS_PRODUCTION_PILOT_ACCOUNT_SCOPE_DENIED");
 const completed=await f.invoke("accounts:complete-login",{accountId:transient.id,platformKey:"xiaohongshu",callbackUrl:"",pendingLogin:{accountId:transient.id,platformKey:"xiaohongshu"}}) as {accountId:string};
 expect(completed.accountId).toBe(archived.id);
 expect(rebound).toEqual([[transient.id,archived.id]]);
 expect(f.repo.getAccountById(archived.id,"xiaohongshu")).toMatchObject({id:archived.id,externalAccountId:"synthetic-creator",loginStatus:"logged_in",archivedAt:null});
 expect(f.repo.getPlatformAccountIdentityBinding("xiaohongshu",archived.id)).toMatchObject({accountId:archived.id,externalCreatorId:"synthetic-creator"});
 expect(f.repo.getAccountById(transient.id,"xiaohongshu")).toMatchObject({id:transient.id,externalAccountId:null,archivedAt:expect.any(String)});
});
it("formal pilot still rejects a wrong XHS account, a wrong XHS job, and an unbound final submit",async()=>{
 const guard=(formalPilot as typeof formalPilot & {assertFormalXhsProductionPilotIpc?: (config: ReturnType<typeof parseFormalXhsProductionPilotConfig>, channel:string, payload:unknown, repository: ReturnType<typeof openDatabase>["repository"])=>void}).assertFormalXhsProductionPilotIpc;
 expect(typeof guard).toBe("function");
 let accountId="";
 const f=await setup(true,true,(channel,payload,repository)=>guard!(parseFormalXhsProductionPilotConfig({version:1,pilotId:"GEO_XHS_PRODUCTION_PILOT_MAX3_20260918",expiresAtUtc:"2026-09-18T14:59:59Z",maxFinalSubmissions:3,executablePath:"C:/GMP/Geo Media Publisher.exe",executableSha256:"a".repeat(64),appAsarPath:"C:/GMP/resources/app.asar",appAsarSha256:"a".repeat(64),xhsAccountId:accountId}),channel,payload,repository));
 accountId=f.account.id;
 const wrong=f.repo.createAccount({platformKey:"xiaohongshu",name:"Wrong creator"});
 await expect(f.invoke("accounts:check-login",{accountId:wrong.id,platformKey:"xiaohongshu"})).rejects.toThrow("FORMAL_XHS_PRODUCTION_PILOT_ACCOUNT_SCOPE_DENIED");
 await expect(f.invoke("articles:prepare-publish",{articleId:f.article.id,platformKey:"xiaohongshu",platformAccountId:wrong.id,selectedImageAssetId:f.image.id,imageSelectionMode:"manual",finalPublishMode:"CONFIRM_BEFORE_PUBLISH"})).rejects.toThrow("FORMAL_XHS_PRODUCTION_PILOT_PREPARE_SCOPE_DENIED");
 const unbound=f.repo.createArticlePublishJob({articleId:f.article.id,platformKey:"xiaohongshu",platformAccountId:f.account.id,selectedImageAssetId:f.image.id,imageSelectionMode:"manual"});
 await expect(f.invoke("jobs:confirm",{id:unbound.id,dryRun:false,contentBindingId:"unbound"})).rejects.toThrow("FORMAL_XHS_PRODUCTION_PILOT_JOB_SCOPE_DENIED");
 await expect(f.invoke("jobs:run",{id:unbound.id})).rejects.toThrow("FORMAL_XHS_PRODUCTION_PILOT_JOB_SCOPE_DENIED");
 expect(f.receipts).toHaveLength(0);expect(f.counts().releases).toBe(0);
});
it("ordinary functions cannot reopen an Unknown XHS job for retry",async()=>{
 const guard=(formalPilot as typeof formalPilot & {assertFormalXhsProductionPilotIpc?: (config: ReturnType<typeof parseFormalXhsProductionPilotConfig>, channel:string, payload:unknown, repository: ReturnType<typeof openDatabase>["repository"])=>void}).assertFormalXhsProductionPilotIpc;
 expect(typeof guard).toBe("function");
 let accountId="";
 const f=await setup(true,true,(channel,payload,repository)=>guard!(parseFormalXhsProductionPilotConfig({version:1,pilotId:"GEO_XHS_PRODUCTION_PILOT_MAX3_20260918",expiresAtUtc:"2026-09-18T14:59:59Z",maxFinalSubmissions:3,executablePath:"C:/GMP/Geo Media Publisher.exe",executableSha256:"a".repeat(64),appAsarPath:"C:/GMP/resources/app.asar",appAsarSha256:"a".repeat(64),xhsAccountId:accountId}),channel,payload,repository));
 accountId=f.account.id;
 const unknown=f.repo.createArticlePublishJob({articleId:f.article.id,platformKey:"xiaohongshu",platformAccountId:f.account.id,selectedImageAssetId:f.image.id,imageSelectionMode:"manual"});
 await expect(f.invoke("articles:update",{id:f.article.id,data:{title:"普通功能仍可编辑",body:"普通功能不会重发",tags:[]}})).resolves.toMatchObject({id:f.article.id});
 await expect(f.invoke("jobs:retry",{id:unknown.id})).rejects.toThrow("FORMAL_XHS_PRODUCTION_PILOT_JOB_SCOPE_DENIED");
 await expect(f.invoke("jobs:recover",{})).rejects.toThrow("FORMAL_XHS_PRODUCTION_PILOT_CHANNEL_DENIED");
 expect(f.receipts).toHaveLength(0);expect(f.counts().releases).toBe(0);
});
it("formal pilot exposes and prepares only its hash-pinned cross-brand image through ordinary IPC",async()=>{
 const guard=(formalPilot as typeof formalPilot & {assertFormalXhsProductionPilotIpc?: (config: ReturnType<typeof parseFormalXhsProductionPilotConfig>, channel:string, payload:unknown, repository: ReturnType<typeof openDatabase>["repository"])=>void}).assertFormalXhsProductionPilotIpc;
 expect(typeof guard).toBe("function");
 let config:ReturnType<typeof parseFormalXhsProductionPilotConfig>|null=null;
 let activeRepository:ReturnType<typeof openDatabase>["repository"]|null=null;
 const f=await setup(true,true,(channel,payload,repository)=>{activeRepository=repository;if(config)guard!(config,channel,payload,repository);},{
   permit:(articleId,imageAssetId)=>config&&activeRepository&&formalPilot.isAuthorizedCrossBrandImageBinding(config,activeRepository,articleId,imageAssetId)?{articleId,imageAssetId}:null,
   assets:(articleId,brandId)=>{
     const authorization=config?.crossBrandImageBindingAuthorization;
     if(!config||!activeRepository||!authorization||brandId!==authorization.articleBrandId)return [];
     const image=activeRepository.getImageAsset(authorization.imageAssetId);
     return image&&formalPilot.isAuthorizedCrossBrandImageBinding(config,activeRepository,articleId,image.id)?[image]:[];
   }
 });
 const foreignBrand=f.repo.createBrand({name:"Foreign",companyName:"Synthetic foreign"});
 const foreignPath=join(f.dir,"foreign.png");writeFileSync(foreignPath,Buffer.from("synthetic image bytes"));
 const foreign=f.repo.createImageAsset({brandId:foreignBrand.id,name:"唯一跨品牌图片",filePath:foreignPath,originalFileName:"foreign.png",mimeType:"image/png",size:Buffer.byteLength("synthetic image bytes"),universal:true});
 const hash=createHash("sha256").update(readFileSync(foreignPath)).digest("hex");
 config=parseFormalXhsProductionPilotConfig({version:1,pilotId:"GEO_XHS_PRODUCTION_PILOT_MAX3_20260918",expiresAtUtc:"2026-09-18T14:59:59Z",maxFinalSubmissions:3,executablePath:"C:/GMP/Geo Media Publisher.exe",executableSha256:"a".repeat(64),appAsarPath:"C:/GMP/resources/app.asar",appAsarSha256:"a".repeat(64),crossBrandImageBindingAuthorization:{articleBrandId:f.article.brandId,articleTitleSha256:createHash("sha256").update(f.article.title,"utf8").digest("hex"),articleBodySha256:createHash("sha256").update(f.article.body,"utf8").digest("hex"),imageAssetId:foreign.id,imageBrandId:foreignBrand.id,imageSha256:hash}});
 const choices=await f.invoke("image-assets:list",{articleId:f.article.id,brandId:f.article.brandId,enabledOnly:true}) as ImageAsset[];
 expect(choices.map((image)=>image.id)).toEqual(expect.arrayContaining([f.image.id,foreign.id]));
 const prepared=await f.invoke("articles:prepare-publish",{articleId:f.article.id,platformKey:"xiaohongshu",platformAccountId:f.account.id,selectedImageAssetId:foreign.id,imageSelectionMode:"manual",finalPublishMode:"CONFIRM_BEFORE_PUBLISH"}) as {job:PublishJob;record:{status:string}|null};
 expect(prepared).toMatchObject({job:{selectedImageAssetId:foreign.id},record:{status:"Prepared"}});expect(f.receipts).toHaveLength(0);expect(f.counts().uploads).toBe(1);
 const other=f.repo.createArticle({...f.article,title:"不是已授权文章",body:"不得使用跨品牌图片",contentHash:randomUUID()})!;
 await expect(f.invoke("articles:prepare-publish",{articleId:other.id,platformKey:"xiaohongshu",platformAccountId:f.account.id,selectedImageAssetId:foreign.id,imageSelectionMode:"manual",finalPublishMode:"CONFIRM_BEFORE_PUBLISH"})).rejects.toThrow("FORMAL_XHS_PRODUCTION_PILOT_PREPARE_SCOPE_DENIED");
 expect(()=>f.repo.createArticlePublishJob({articleId:other.id,platformKey:"xiaohongshu",platformAccountId:f.account.id,selectedImageAssetId:foreign.id,imageSelectionMode:"manual"})).toThrow("所选配图不可用或与文章品牌不匹配");
});
it("ordinary IPC prepares production snapshot, confirms exact preview and sends once without a test Run",async()=>{
 const f=await setup();expect(f.receipts).toHaveLength(0);const p=await f.prepare();expect(f.receipts).toHaveLength(0);
 const preview=await f.invoke("jobs:preview",{id:p.job.id}) as {contentBindingId:string,title:string,body:string};
 expect(preview).toMatchObject({title:f.article.title,body:f.article.body,contentBindingId:p.job.contentBindingId});
 await f.invoke("jobs:confirm",{id:p.job.id,dryRun:false,contentBindingId:preview.contentBindingId});
 const out=await f.invoke("jobs:run",{id:p.job.id}) as {job:PublishJob};
 expect(out.job.status).toBe("Success");expect(f.receipts).toHaveLength(1);expect(f.counts().releases).toBe(1);
 await f.invoke("jobs:run",{id:p.job.id});expect(f.receipts).toHaveLength(1);
 expect(f.db.prepare("SELECT * FROM platform_self_test_runs").all()).toHaveLength(0);
});
it("scoped live UI does not auto-select a random cover before explicit manual selection",async()=>{
 const f=await setup(true);
 const picked=await f.invoke("image-assets:select-for-article",{articleId:f.article.id,platformKey:"xiaohongshu"});
 expect(picked).toBeNull();
 expect(f.repo.listImageAssets(f.article.brandId)).toHaveLength(1);
 expect(f.repo.listJobs()).toHaveLength(0);
});
it("ordinary confirmation without the shown snapshot token is refused",async()=>{
 const f=await setup();const p=await f.prepare();
 await expect(f.invoke("jobs:confirm",{id:p.job.id,dryRun:false})).rejects.toThrow("CONTENT_PREVIEW_CONFIRMATION_REQUIRED");expect(f.receipts).toHaveLength(0);
});
it("a normal receipt service never acts as a final-submit authorization",async()=>{
 const f=await setup(false,false);const prepared=await f.prepare();
 await f.invoke("jobs:confirm",{id:prepared.job.id,contentBindingId:prepared.job.contentBindingId});
 await f.invoke("jobs:run",{id:prepared.job.id});
 expect(f.receipts).toHaveLength(0);
 expect(f.repo.getSubmissionIntentByJob(prepared.job.id)).toBeNull();
});
it.each(["连续  空格","包含\u00a0不换行空格","全角｜竖线","末尾换行\n","组合  \u00a0｜\n"])("ordinary prepare validates the raw body readback without silently normalizing %j",async(body)=>{
 const f=await setup();f.repo.updateArticle(f.article.id,{body});
 const original=f.adapter.preparePublish;
 f.adapter.preparePublish=async(ctx,input)=>{
   const prepared=await original(ctx,input);
   return {...prepared,response:{...prepared.response,bodyReadbackValue:String(input.body).replace(/[\u00a0｜]/gu," ").replace(/\s+/gu," ").trim(),bodyReadbackRawValue:input.body}};
 };
 const prepared=await f.prepare();
 expect(f.repo.getPublishRecordByJob(prepared.job.id)).toMatchObject({status:"Prepared"});
 expect(f.repo.getPublishRecordByJob(prepared.job.id)?.response.bodyReadbackRawValue).toBe(body);
});
it("ordinary prepare accepts only the adapter's explicit rich-text blank-line canonicalization",async()=>{
 const f=await setup();
 const body="第一段。\n\n第二段。";
 f.repo.updateArticle(f.article.id,{body});
 const original=f.adapter.preparePublish;
 f.adapter.preparePublish=async(ctx,input)=>{
   const prepared=await original(ctx,input);
   const rawBodyReadbackValue="第一段。\n\n\n\n\n第二段。";
   return {...prepared,response:{...prepared.response,bodyReadbackRawValue:rawBodyReadbackValue,bodyReadbackValue:body,bodyReadbackStatus:"PASS_WITH_NORMALIZATION",bodyReadbackTelemetry:{canonicalizationVersion:"xhs-editor-canonical-v1",normalizationReasons:["BLANK_LINE_RUN_NORMALIZED"]}}};
 };
 const prepared=await f.prepare();
 expect(f.repo.getPublishRecordByJob(prepared.job.id)).toMatchObject({status:"Prepared"});
 expect(f.repo.getPublishRecordByJob(prepared.job.id)?.response).toMatchObject({bodyReadbackRawValue:"第一段。\n\n\n\n\n第二段。",bodyReadbackStatus:"PASS_WITH_NORMALIZATION"});
});
it("dead Prepared page never reports ready from the cached record",async()=>{
 const f=await setup();await f.prepare();f.setDead();expect(await f.prepare()).toMatchObject({record:null,message:"PREPARED_PAGE_UNAVAILABLE"});expect(f.counts().uploads).toBe(1);
});
it("ordinary cancel releases only its preparation and cannot confirm afterward",async()=>{
 const f=await setup();const p=await f.prepare();await f.invoke("jobs:cancel",{id:p.job.id});expect(f.repo.getJob(p.job.id)?.status).toBe("Cancelled");expect(f.counts().releases).toBe(1);expect(f.receipts).toHaveLength(0);
});


it("accepted then lost response retains Unknown across duplicate IPC, retry and replacement Job",async()=>{
 const f=await setup();expect(f.receipts).toHaveLength(0);const p=await f.prepare();
 await f.invoke("jobs:confirm",{id:p.job.id,contentBindingId:p.job.contentBindingId});f.drop();
 const results=await Promise.all([f.invoke("jobs:run",{id:p.job.id}),f.invoke("jobs:run",{id:p.job.id})]);
 expect(results).toHaveLength(2);expect(f.receipts).toHaveLength(1);expect(f.repo.getJob(p.job.id)?.status).toBe("NeedsReconciliation");expect(f.counts().releases).toBe(0);
 await f.invoke("jobs:retry",{id:p.job.id});await f.invoke("jobs:run",{id:p.job.id});
 expect(await f.prepare()).toMatchObject({record:null});
 f.repo.recoverRunningJobs();await f.invoke("jobs:run",{id:p.job.id});expect(f.receipts).toHaveLength(1);
 await expect(f.invoke("jobs:cancel",{id:p.job.id})).rejects.toThrow();
});
it.each(["title","body","image","account"])("old shown snapshot is invalid after %s changes",async(field)=>{
 const f=await setup();const p=await f.prepare();
 if(field==="image")writeFileSync(f.path,"changed actual bytes");
 else if(field==="account")f.repo.syncBrowserPlatformAccount({accountId:f.account.id,platformKey:"xiaohongshu",browserSessionId:"new",externalAccountId:"different-creator"});
 else f.repo.updateArticle(f.article.id,{[field]:"新的内容"});
 await expect(f.invoke("jobs:confirm",{id:p.job.id,contentBindingId:p.job.contentBindingId})).rejects.toThrow();expect(f.receipts).toHaveLength(0);expect(f.counts().uploads).toBe(1);
});
it("local single-image scope rules refuse before upload or dispatch",async()=>{
 const f=await setup();f.repo.updateArticle(f.article.id,{title:"标题".repeat(15)});expect(await f.prepare()).toMatchObject({record:null});expect(f.counts().uploads).toBe(0);expect(f.receipts).toHaveLength(0);
});
it("same account publishes two different ordinary articles under independent confirmations",async()=>{
 const f=await setup();const second=f.repo.createArticle({...f.article,title:"第二篇明确文章",body:"不同的普通正文",contentHash:randomUUID()})!;
 expect(f.receipts).toHaveLength(0);
 for(const id of [f.article.id,second.id]){const p=await f.prepare(id);await f.invoke("jobs:confirm",{id:p.job.id,contentBindingId:p.job.contentBindingId});const r=await f.invoke("jobs:run",{id:p.job.id}) as {job:PublishJob};expect(r.job.status).toBe("Success");}
 expect(f.receipts).toHaveLength(2);expect(new Set(f.receipts.map(r=>r.snapshot)).size).toBe(2);expect(f.counts().releases).toBe(2);
});

it("ordinary prepare stops at current login verification before uploading",async()=>{
 const f=await setup();f.adapter.checkLogin=async()=>"needs_user_action";
 const result=await f.prepare();expect(result).toMatchObject({record:null});expect(f.counts().uploads).toBe(0);expect(f.receipts).toHaveLength(0);
});

it("task page release follows durable terminal result",async()=>{const f=await setup();const p=await f.prepare();await f.invoke("jobs:confirm",{id:p.job.id,contentBindingId:p.job.contentBindingId});await f.invoke("jobs:run",{id:p.job.id});expect(f.counts().releasedStatuses).toEqual(["Success"]);});

it("Unknown reconciliation uses immutable submitted content after source edits and only the matching receipt",async()=>{
 const f=await setup();const p=await f.prepare();await f.invoke("jobs:confirm",{id:p.job.id,contentBindingId:p.job.contentBindingId});f.drop();await f.invoke("jobs:run",{id:p.job.id});expect(f.receipts).toHaveLength(1);
 f.repo.updateArticle(f.article.id,{title:"后续编辑的新标题",body:"新正文"});writeFileSync(f.path,"later image edit");
 const result=await f.publisher.reconcileBrowserJob(p.job.id);expect(result.job.status).toBe("Success");expect(f.receipts).toHaveLength(1);expect(f.counts().releases).toBe(1);expect(f.repo.getPublishRecordByJob(p.job.id)?.publishedExternalId).toBe("receipt-"+String(f.receipts[0]?.intentId));
});
it("accepted awaiting review shows Publishing with an informational notification, never Publish completed",async()=>{
 const f=await setup();const original=f.adapter.finalSubmit;
 f.adapter.finalSubmit=async(ctx,article,attempt)=>{const result=await original(ctx,article,attempt);return {...result,response:{...result.response,submissionAccepted:true}};};
 f.adapter.verifyPublished=async(_ctx,_article,result)=>({status:"publishing" as const,...result,response:{mock:true,review:"pending"}});
 const p=await f.prepare();await f.invoke("jobs:confirm",{id:p.job.id,contentBindingId:p.job.contentBindingId});
 const executed=await f.invoke("jobs:run",{id:p.job.id}) as {job:PublishJob;message:string};
 expect(executed.job.status).toBe("Publishing");expect(executed.message).toContain("waiting");
 expect(f.repo.getPublishRecordByJob(p.job.id)?.status).toBe("Publishing");
 const notices=f.repo.listNotifications().filter(n=>n.relatedId===p.job.id);
 expect(notices).toHaveLength(1);expect(notices[0]).toMatchObject({level:"info",title:"Submission accepted; waiting for platform status"});
 expect(notices[0]?.message).not.toContain("Publish completed");
});
it("scoped live budget refusal happens before durable final claim and before mock server accepts",async()=>{
 const f=await setup();const p=await f.prepare();await f.invoke("jobs:confirm",{id:p.job.id,contentBindingId:p.job.contentBindingId});
 const stages:string[]=[];
 (f.publisher as unknown as {options:{onScopedProductionBoundary?:(value:{stage:string})=>void}}).options.onScopedProductionBoundary=(value)=>{stages.push(value.stage);if(value.stage==="beforeClaim")throw Error("XHS_CAMPAIGN_CLOSED: slot unavailable");};
 await f.invoke("jobs:run",{id:p.job.id});
 expect(stages).toContain("beforeClaim");expect(f.receipts).toHaveLength(0);
 expect(f.repo.getSubmissionIntentByJob(p.job.id)?.finalSubmitCount).toBe(0);
});
it("ordinary context carries the pinned campaign build identity to the real adapter boundary",async()=>{
 const f=await setup();(f.publisher as unknown as {options:{scopedCampaignBuildSha256?:string}}).options.scopedCampaignBuildSha256="pinned-asar";
 const original=f.adapter.finalSubmit;let observed:string|undefined;
 f.adapter.finalSubmit=async(ctx,article,attempt)=>{observed=String(ctx.settings.campaignBuildSha256??"");return original(ctx,article,attempt);};
 const p=await f.prepare();await f.invoke("jobs:confirm",{id:p.job.id,contentBindingId:p.job.contentBindingId});await f.invoke("jobs:run",{id:p.job.id});
 expect(observed).toBe("pinned-asar");
});

it("formal pilot guard registers the ordinary editor and freezes a different article after Unknown",async()=>{
 const f=await setup();
 const pilot={pilotId:"GEO_XHS_PRODUCTION_PILOT_MAX3_20260918",expiresAt:"2099-09-18T14:59:59.000Z",maxFinalSubmissions:3};
 f.repo.ensureProductionPilotAuthorization(pilot);
 const pilotGuard={
   buildSha256:"a".repeat(64),
   registerPrepared:({job,snapshot,recordId}:{job:PublishJob;snapshot:{id:string};recordId:string})=>f.repo.registerProductionPilotPreparedBinding({pilotId:pilot.pilotId,jobId:job.id,snapshotId:snapshot.id,publishRecordId:recordId}),
   claimFinalSubmit:({job,intentId,snapshot,subject}:{job:PublishJob;intentId:string;snapshot:{id:string};subject:XhsContextIdentityAttestation})=>f.repo.claimProductionPilotFinalSubmit({pilotId:pilot.pilotId,buildSha256:"a".repeat(64),jobId:job.id,intentId,snapshotId:snapshot.id,subject}),
   recordAccepted:({job,intentId,externalId,publishedUrl,receiptSha256}:{job:PublishJob;intentId:string;externalId:string;publishedUrl?:string;receiptSha256:string})=>{f.repo.recordProductionPilotAccepted({pilotId:pilot.pilotId,intentId,externalId,publishedUrl,receiptSha256});return f.repo.getJob(job.id)!;},
   markUnknown:({intentId,errorCode}:{intentId:string;errorCode:string})=>f.repo.markProductionPilotSubmissionUnknown({pilotId:pilot.pilotId,intentId,errorCode})
 };
 (f.publisher as unknown as {options:{productionPilotGuard:typeof pilotGuard}}).options.productionPilotGuard=pilotGuard;
 const first=await f.prepare();
 expect(f.repo.getProductionPilotPreparedBinding(pilot.pilotId,first.job.id)).toMatchObject({snapshotId:first.job.contentBindingId});
 await f.invoke("jobs:confirm",{id:first.job.id,contentBindingId:first.job.contentBindingId});
 f.drop();
 await f.invoke("jobs:run",{id:first.job.id});
 expect(f.receipts).toHaveLength(1);
 expect(f.repo.getSubmissionIntentByJob(first.job.id)).toMatchObject({finalSubmitCount:1,state:"Unknown"});
 expect(f.repo.listProductionPilotSlots(pilot.pilotId)).toEqual([expect.objectContaining({intentId:f.repo.getSubmissionIntentByJob(first.job.id)?.id,state:"Unknown"})]);
 const second=f.repo.createArticle({...f.article,title:"试点冻结第二篇",body:"第二篇不得在首篇未知后发送",contentHash:randomUUID()})!;
 const preparedSecond=await f.prepare(second.id);
 await f.invoke("jobs:confirm",{id:preparedSecond.job.id,contentBindingId:preparedSecond.job.contentBindingId});
 await f.invoke("jobs:run",{id:preparedSecond.job.id});
 expect(f.receipts).toHaveLength(1);
 expect(f.repo.getSubmissionIntentByJob(preparedSecond.job.id)).toMatchObject({finalSubmitCount:0,state:"Prepared"});
});

it("a trusted internal receipt closes the claimed ordinary intent as accepted-pending without generic markSubmitted",async()=>{
 const f=await setup();const pilot={pilotId:"GEO_XHS_PRODUCTION_PILOT_MAX3_20260918",expiresAt:"2099-09-18T14:59:59.000Z",maxFinalSubmissions:3};f.repo.ensureProductionPilotAuthorization(pilot);
 const pilotGuard={buildSha256:"a".repeat(64),registerPrepared:({job,snapshot,recordId}:{job:PublishJob;snapshot:{id:string};recordId:string})=>f.repo.registerProductionPilotPreparedBinding({pilotId:pilot.pilotId,jobId:job.id,snapshotId:snapshot.id,publishRecordId:recordId}),claimFinalSubmit:({job,intentId,snapshot,subject}:{job:PublishJob;intentId:string;snapshot:{id:string};subject:XhsContextIdentityAttestation})=>f.repo.claimProductionPilotFinalSubmit({pilotId:pilot.pilotId,buildSha256:"a".repeat(64),jobId:job.id,intentId,snapshotId:snapshot.id,subject}),recordAccepted:({job,intentId,externalId,publishedUrl,receiptSha256}:{job:PublishJob;intentId:string;externalId:string;publishedUrl?:string;receiptSha256:string})=>{f.repo.recordProductionPilotAccepted({pilotId:pilot.pilotId,intentId,externalId,publishedUrl,receiptSha256});return f.repo.getJob(job.id)!;},markUnknown:({intentId,errorCode}:{intentId:string;errorCode:string})=>f.repo.markProductionPilotSubmissionUnknown({pilotId:pilot.pilotId,intentId,errorCode})};
 (f.publisher as unknown as {options:{productionPilotGuard:typeof pilotGuard}}).options.productionPilotGuard=pilotGuard;
 f.adapter.finalSubmit=async(_ctx,_input,attempt)=>{(attempt as BrowserPublishAttemptContext & {productionPublicationGuard:{claim:(subject:XhsContextIdentityAttestation)=>void}}).productionPublicationGuard.claim({accountId:f.account.id,platformKey:"xiaohongshu",expectedExternalCreatorId:"synthetic-creator",observedExternalCreatorId:"synthetic-creator",externalAccountId:"synthetic-creator",browserSessionIdentity:"synthetic-session",browserContextIdentity:"synthetic-context",sourcePageIdentity:"synthetic-page",sourceOrigin:"https://creator.xiaohongshu.com",sourcePathname:"/publish/publish",issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString(),verified:true});return {success:true,status:"publishing",externalId:"receipt-accepted-1",response:{imageUploaded:true,submissionAccepted:true,trustedReceipt:true,receiptSha256:"f".repeat(64)}};};
 const prepared=await f.prepare();await f.invoke("jobs:confirm",{id:prepared.job.id,contentBindingId:prepared.job.contentBindingId});
 const out=await f.invoke("jobs:run",{id:prepared.job.id}) as {job:PublishJob;message:string};
 expect(out).toMatchObject({job:{status:"Publishing"},message:"Submission accepted; waiting for platform status"});
 expect(f.repo.getSubmissionIntentByJob(prepared.job.id)).toMatchObject({state:"Submitted",finalSubmitCount:1,externalId:"receipt-accepted-1"});
 expect(f.repo.getPublishRecordByJob(prepared.job.id)).toMatchObject({status:"Publishing",publishedExternalId:"receipt-accepted-1"});
 expect(f.repo.listProductionPilotSlots(pilot.pilotId)).toEqual([expect.objectContaining({state:"Accepted"})]);
 expect(f.receipts).toHaveLength(0);
});
