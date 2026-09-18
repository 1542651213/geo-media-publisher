import {app} from "electron";
import {createHash} from "node:crypto";
import {closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,realpathSync,writeFileSync,writeSync} from "node:fs";
import {readFileSync as readPhysicalFileSync} from "node:original-fs";
import {join,win32} from "node:path";
import type {AppRepository} from "@publisher/db";
import type {ContentSnapshot,PublishJob,XhsContextIdentityAttestation} from "@publisher/domain";
import {XhsProductionReceiptObserver,type XhsReceiptEvent,type XhsReceiptMeta} from "@publisher/adapters-xiaohongshu/browser";
import type {Page} from "playwright-core";
import {authorizeXhsMax3Config,parseXhsMax3Config,readXhsMax3Gate,type XhsMax3Config} from "./xhs-max3-config";
import {ScopedXhsCampaignLedger,type ScopedCampaignConfig} from "./xhs-max3-ledger";
const hash=(bytes:Uint8Array|string):string=>createHash("sha256").update(bytes).digest("hex");
const same=(a:string,b:string):boolean=>win32.resolve(a).toLowerCase()===win32.resolve(b).toLowerCase();
type ApprovedItem={slot:string;title:string;body:string;title_sha256_utf8:string;body_sha256_utf8_lf:string;cover:{eyebrow:string;headline:string;items:string[];footer:string}};
type ApprovedManifest={campaign_id:string;scope:{local_account_id:string;expected_creator_id:string;brand:string};items:ApprovedItem[]};

export interface XhsMax3LiveContext {
  config:XhsMax3Config;dataDirectory:string;buildSha256:string;
  productionReceiptFactory:(page:Page,meta:XhsReceiptMeta)=>XhsProductionReceiptObserver;
  onBoundary:(input:{stage:"beforeClaim"|"afterClaim";job:PublishJob;intentId:string;snapshot:ContentSnapshot;subject:XhsContextIdentityAttestation})=>void;
  onUnknown:(jobId:string)=>void;
  ensureAccountAndLedger:(repo:AppRepository)=>void;
  assertIpc:(channel:string,payload:unknown,repo:AppRepository)=>void;
  close:()=>void;
}

/** Read and pin package identity before the first default userData/log/DB access. */
export function initializeXhsMax3Live():XhsMax3LiveContext|null{
  const configPath=readXhsMax3Gate(process.env);if(!configPath)return null;
  if(process.env.ORDINARY_XHS_PILOT || process.env.ORDINARY_XHS_PILOT_CONFIG)throw new Error("XHS_MAX3_SYNTHETIC_MODE_CONFLICT");
  const config=parseXhsMax3Config(JSON.parse(readFileSync(configPath,"utf8")) as unknown,configPath);
  authorizeXhsMax3Config(config,process.env.GEO_XHS_MAX3);
  if(!app.isPackaged||!same(process.execPath,config.executablePath)||!same(app.getAppPath(),config.appAsarPath))throw new Error("XHS_MAX3_PACKAGE_PATH_MISMATCH");
  if(hash(readPhysicalFileSync(process.execPath))!==config.executableSha256||hash(readPhysicalFileSync(app.getAppPath()))!==config.appAsarSha256)throw new Error("XHS_MAX3_PACKAGE_HASH_MISMATCH");
  if(hash(readFileSync(config.manifestPath))!==config.manifestSha256)throw new Error("XHS_MAX3_MANIFEST_HASH_MISMATCH");
  const manifest=JSON.parse(readFileSync(config.manifestPath,"utf8")) as ApprovedManifest;
  if(manifest.campaign_id!==config.campaignId||manifest.scope.local_account_id!==config.accountId||manifest.scope.expected_creator_id!==config.creatorId||manifest.items?.length!==3)throw new Error("XHS_MAX3_MANIFEST_SCOPE_MISMATCH");
  const content:ScopedCampaignConfig["content"]=manifest.items.map((item,index)=>{
    const cover=config.covers[index];
    if(!cover||cover.slot!==item.slot||item.slot!==`XHS-0${index+1}`||hash(item.title)!==item.title_sha256_utf8||hash(item.body)!==item.body_sha256_utf8_lf)throw new Error("XHS_MAX3_CONTENT_HASH_MISMATCH");
    const image=join(win32.dirname(config.manifestPath),"assets",`${item.slot}.png`);
    if(hash(readFileSync(image))!==cover.sha256.toLowerCase())throw new Error("XHS_MAX3_COVER_BYTES_MISMATCH");
    return {slot:item.slot,titleSha256:item.title_sha256_utf8,bodySha256:item.body_sha256_utf8_lf,imageSha256:cover.sha256.toLowerCase()};
  });
  const liveRoot=join(config.runDirectory,"live");mkdirSync(liveRoot,{recursive:true});
  if(!same(realpathSync(liveRoot),liveRoot))throw new Error("XHS_MAX3_RUN_ROOT_REPARSE_DENIED");
  const markerPath=join(liveRoot,"campaign-owner.json");const marker={campaignId:config.campaignId,manifestSha256:config.manifestSha256,accountId:config.accountId,creatorId:config.creatorId};
  if(existsSync(markerPath)){
    if(JSON.stringify(JSON.parse(readFileSync(markerPath,"utf8")) as unknown)!==JSON.stringify(marker))throw new Error("XHS_MAX3_EXISTING_OWNER_MISMATCH");
  }else{writeFileSync(markerPath,JSON.stringify(marker),{flag:"wx",mode:0o600});}
  for(const name of ["userData","sessionData","data","campaign"]){const p=join(liveRoot,name);mkdirSync(p,{recursive:true});if(!same(realpathSync(p),p))throw new Error("XHS_MAX3_CHILD_REPARSE_DENIED");}
  app.setPath("userData",join(liveRoot,"userData"));app.setPath("sessionData",join(liveRoot,"sessionData"));
  const ledger=ScopedXhsCampaignLedger.open(join(liveRoot,"campaign"),{campaignId:config.campaignId,accountId:config.accountId,creatorId:config.creatorId,expiresAtUtc:config.expiresAtUtc,content});
  const dataDirectory=join(liveRoot,"data");const receiptDir=join(dataDirectory,"receipt-evidence");mkdirSync(receiptDir,{recursive:true});
  const assertTime=():void=>{if(Date.now()>=Date.parse(config.expiresAtUtc))throw new Error("XHS_MAX3_AUTHORIZATION_EXPIRED");};
  const itemFor=(snapshot:ContentSnapshot):string=>{
    const match=content.filter(item=>item.titleSha256===snapshot.rawTitleSha256&&item.bodySha256===snapshot.rawBodySha256&&snapshot.images.length===1&&item.imageSha256===snapshot.images[0]?.sha256.toLowerCase());
    if(match.length!==1||snapshot.purpose!=="PRODUCTION"||snapshot.accountId!==config.accountId||snapshot.creatorId!==config.creatorId)return (()=>{throw new Error("XHS_MAX3_APPROVED_CONTENT_MISMATCH")})();
    return match[0]!.slot;
  };
  const productionReceiptFactory=(page:Page,meta:XhsReceiptMeta):XhsProductionReceiptObserver=>{
    assertTime();if(meta.accountId!==config.accountId||meta.creatorId!==config.creatorId||meta.buildSha256!==config.appAsarSha256||!meta.contextId||!meta.pageId||!/^[0-9a-f-]{36}$/iu.test(meta.intentId))throw new Error("XHS_MAX3_RECEIPT_SUBJECT_MISMATCH");
    const file=join(receiptDir,`${meta.intentId}.jsonl`);
    const persist=(event:XhsReceiptEvent):void=>{const fd=openSync(file,"a",0o600);try{writeSync(fd,JSON.stringify(event)+"\n");fsyncSync(fd);}finally{closeSync(fd);}};
    return new XhsProductionReceiptObserver(page,meta,persist);
  };
  return {config,dataDirectory,buildSha256:config.appAsarSha256,productionReceiptFactory,
    onBoundary(input){assertTime();const slot=itemFor(input.snapshot);if(input.subject.accountId!==config.accountId||input.subject.observedExternalCreatorId!==config.creatorId||input.job.accountId!==config.accountId)throw new Error("XHS_MAX3_RUNTIME_CREATOR_MISMATCH");
      if(input.stage==="beforeClaim")ledger.reserve({slot,accountId:config.accountId,creatorId:config.creatorId,jobId:input.job.id,intentId:input.intentId,snapshotId:input.snapshot.id,titleSha256:input.snapshot.rawTitleSha256,bodySha256:input.snapshot.rawBodySha256,imageSha256:input.snapshot.images[0]!.sha256.toLowerCase(),buildSha256:config.appAsarSha256});
      else ledger.mark(slot,"finalBoundaryClaimed");
    },
    onUnknown(jobId){const slot=Object.entries(ledger.snapshot().slots).find(([,entry])=>entry.binding.jobId===jobId)?.[0];if(slot)ledger.mark(slot,"unknown");},
    ensureAccountAndLedger(repo){repo.registerScopedBrowserAccount({id:config.accountId,platformKey:"xiaohongshu",name:manifest.scope.brand});const intents=repo.listJobs().filter(j=>j.platformKey==="xiaohongshu").map(j=>repo.getSubmissionIntentByJob(j.id)).filter((i):i is NonNullable<typeof i>=>i!==null);ledger.assertDatabaseConsistency(intents.map(i=>({jobId:i.jobId,intentId:i.id,finalSubmitCount:i.finalSubmitCount})));},
    assertIpc(channel,payload,repo){
      const readOnly=["accounts:list","accounts:overview","accounts:credential-status","articles:get","articles:list","articles:page","articles:history","articles:variants","brands:list","image-assets:list","image-assets:select-for-article","jobs:list","jobs:preview","platforms:list","platforms:profiles","platforms:content-rules","quality:items","quality:status","quality:history","dashboard:get","logs:list","notifications:list","settings:get"];
      const online=["accounts:begin-login","accounts:complete-login","accounts:cancel-login","accounts:refresh-login","accounts:check-login","accounts:open-backend","accounts:session-heartbeat","accounts:pre-submit-gate","articles:prepare-publish","jobs:confirm","jobs:run","jobs:reconcile-browser"];
      if(!readOnly.includes(channel)&&!online.includes(channel)&&channel!=="quality:recheck")throw new Error("XHS_MAX3_SCOPE_CHANNEL_DENIED");
      if(online.includes(channel))assertTime();
      const request=typeof payload==="object"&&payload!==null?payload as Record<string,unknown>:{};
      if(channel==="quality:recheck"){
        const article=typeof request.contentId==="string"?repo.getArticle(request.contentId):null;
        if(request.contentType!=="article"||!article||!content.some(x=>x.titleSha256===hash(article.title)&&x.bodySha256===hash(article.body)))throw new Error("XHS_MAX3_QUALITY_CONTENT_MISMATCH");
      }
      if(channel.startsWith("accounts:")&&online.includes(channel)&&(request.accountId!==config.accountId||request.platformKey!=="xiaohongshu"))throw new Error("XHS_MAX3_ACCOUNT_MISMATCH");
      if(channel==="articles:prepare-publish"){
        if(request.platformKey!=="xiaohongshu"||request.platformAccountId!==config.accountId||request.imageSelectionMode!=="manual"||request.finalPublishMode!=="CONFIRM_BEFORE_PUBLISH"||typeof request.articleId!=="string"||typeof request.selectedImageAssetId!=="string"||request.articleVariantId)throw new Error("XHS_MAX3_PREPARE_SCOPE_MISMATCH");
        const article=repo.getArticle(request.articleId), image=repo.getImageAsset(request.selectedImageAssetId);
        if(!article||!image||!content.some(x=>x.titleSha256===hash(article.title)&&x.bodySha256===hash(article.body)&&x.imageSha256===hash(readFileSync(image.filePath))))throw new Error("XHS_MAX3_PREPARE_CONTENT_MISMATCH");
      }
      if(["jobs:run","jobs:confirm","jobs:reconcile-browser"].includes(channel)){
        const job=typeof request.id==="string"?repo.getJob(request.id):null;
        if(!job||job.accountId!==config.accountId||job.platformKey!=="xiaohongshu"||!job.contentBindingId)throw new Error("XHS_MAX3_JOB_SCOPE_MISMATCH");
        const snapshot=repo.contentSnapshots.get(job.contentBindingId);
        if(snapshot.purpose!=="PRODUCTION"||snapshot.accountId!==config.accountId||snapshot.creatorId!==config.creatorId||!content.some(x=>x.titleSha256===snapshot.rawTitleSha256&&x.bodySha256===snapshot.rawBodySha256&&snapshot.images.length===1&&x.imageSha256===snapshot.images[0]?.sha256.toLowerCase()))throw new Error("XHS_MAX3_JOB_CONTENT_MISMATCH");
        if(channel==="jobs:reconcile-browser"&&!Object.values(ledger.snapshot().slots).some(x=>x.binding.jobId===job.id))throw new Error("XHS_MAX3_READONLY_JOB_NOT_RESERVED");
      }
    },
    close(){ledger.close();}
  };
}
