import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import type { CredentialStore } from "@publisher/security";
import { OfficialApiController } from "../apps/desktop/src/main/official-api-controller";
import { SqliteOfficialApiOperationStore } from "../apps/desktop/src/main/official-api-operation-store";
import type { OfficialApiOperation } from "../packages/adapters/official-api/src/runtime";
import type { OfficialApiPreparedContent } from "../packages/adapters/official-api/src/mapping";
const callbacks: Array<() => void> = [];
afterEach(() => callbacks.splice(0).reverse().forEach(fn => fn()));
function fixture(companyName = "江苏康一环保科技有限公司") {
  const dir = mkdtempSync(join(tmpdir(), "official-main-controller-"));callbacks.push(()=>rmSync(dir,{recursive:true,force:true}));
  const {db,repository}=openDatabase(join(dir,"fixture.db"),join(process.cwd(),"packages/db/migrations"));callbacks.push(()=>db.close());
  repository.seedPlatformCatalog(join(process.cwd(),"PLATFORMS.csv"));repository.setSetting("contentReviewMode","Off");
  const brand=repository.createBrand({name:"Fixture",companyName});const created=repository.createAccount({platformKey:"website",name:"Fixture"});
  const account=repository.syncOfficialApiAccount({accountId:created.id,platformKey:"website",externalAccountId:"kangyi:staging"});
  const article=repository.createArticle({brandId:brand.id,title:"受控验收",body:"原文",summary:"摘要",tags:["测试"],seoKeywords:["测试"],topic:"测试",keyword:"测试",city:"南京",articleType:"科普",aiProvider:"system",aiModel:"fixture",generatedAt:new Date().toISOString(),reusePolicy:"once",contentHash:randomUUID()});if(!article)throw Error("fixture required");
  const values=new Map(Object.entries({origin:"https://staging.kangyihb.com",siteId:"kangyi",environment:"staging",keyId:"fixture-key",secret:"0123456789abcdef0123456789abcdef"}).map(([key,value])=>[`account:${account.id}:website:${key}`,value])); // gitleaks:allow -- public fixture
  const credentials:CredentialStore={get:key=>values.get(key)??null,has:key=>values.has(key),set:(key,value)=>{values.set(key,value);},delete:key=>{values.delete(key);}};
  const store=new SqliteOfficialApiOperationStore(repository);
  const prepare=vi.fn(async (_ctx:unknown,prepared:OfficialApiPreparedContent,jobId:string)=>{
    const timestamp=new Date().toISOString();const operation:OfficialApiOperation={version:1,revision:0,jobId,accountId:account.id,articleId:article.id,siteId:"kangyi",environment:"staging",keyId:"fixture-key",sourceHash:prepared.sourceHash,contentBindingId:prepared.contentBindingId,externalId:`geo:${jobId}`,prepared,phase:"PREPARED",media:[],maintenance:[],remoteContent:{contentId:"10000000-0000-4000-a000-000000000001",revisionId:"20000000-0000-4000-a000-000000000001",contentHash:"a".repeat(64),rowVersion:1},createdAt:timestamp,updatedAt:timestamp};store.insert(operation);return{status:"prepared" as const,operation};
  });
  const adapter={inspect:async()=>({siteId:"kangyi",environment:"staging" as const,protocolVersion:"2",contentKinds:["article" as const,"case" as const],writesEnabled:true,limits:{jsonBytes:1048576,mediaBytes:8388608,imagePixels:40000000,imageDimension:10000}}),prepare,recoverOriginalOperation:vi.fn(),maintainOwnContent:vi.fn()};
  const controller=new OfficialApiController({repository,credentials,store,adapter,ordinaryEnabled:true,grants:[]});
  const input={articleId:article.id,platformAccountId:account.platformAccountId??account.id,websiteSettings:{version:1,kind:"article",coverAssetId:null,bodyImageAssetIds:[],galleryAssetIds:[]}};
  return{controller,repository,store,adapter,input,account,article,db,credentials};
}
describe("Website Main preparation ownership",()=>{
  it("prepares one durable Job and record, reuses it, and refuses edited replacement content",async()=>{
    const f=fixture();const first=await f.controller.prepare(f.input);const second=await f.controller.prepare(f.input);
    expect(second.job.id).toBe(first.job.id);expect(f.adapter.prepare).toHaveBeenCalledTimes(1);
    expect(f.repository.getPublishRecordByJob(first.job.id)).toMatchObject({status:"Prepared",automationType:"API",success:false});
    expect(f.repository.getJob(first.job.id)).toMatchObject({maxAttempts:1,finalPublishMode:"CONFIRM_BEFORE_PUBLISH"});
    f.repository.updateArticle(f.article.id,{body:"修改后的正文"});await expect(f.controller.prepare(f.input)).rejects.toThrow("BINDING_CHANGED");
    expect(f.repository.listJobs()).toHaveLength(1);expect(f.adapter.prepare).toHaveBeenCalledTimes(1);
  });
  it("refuses other brand material before creating a Job",async()=>{
    const f=fixture("其它公司");await expect(f.controller.prepare(f.input)).rejects.toThrow("KANGYI_BRAND_REQUIRED");
    expect(f.repository.listJobs()).toHaveLength(0);expect(f.adapter.prepare).not.toHaveBeenCalled();
  });
  it("does not disclose frozen file paths or exact request bodies through the job view",async()=>{
    const f=fixture();const prepared=await f.controller.prepare(f.input);const view=f.controller.jobState(prepared.job.id);
    expect(view).toMatchObject({jobId:prepared.job.id,kind:"article",siteId:"kangyi",environment:"staging",canPurge:false});
    expect(view).not.toHaveProperty("prepared");expect(view).not.toHaveProperty("exactJson");expect(view).not.toHaveProperty("secret");
  });
  it("restores Prepared and AwaitingConfirmation on the same unclaimed job after preparation recovery",async()=>{
    const f=fixture();const prepared=await f.controller.prepare(f.input);const operation=f.store.getByJobId(prepared.job.id)!;
    f.repository.updateJobFailure(prepared.job.id,"NeedsReconciliation","REMOTE_STATUS_UNKNOWN","fixture",null);
    f.adapter.recoverOriginalOperation.mockResolvedValue({status:"prepared",operation});
    await f.controller.recover(prepared.job.id);
    expect(f.repository.getJob(prepared.job.id)?.status).toBe("AwaitingConfirmation");
    expect(f.repository.listJobs()).toHaveLength(1);expect(f.repository.getSubmissionIntentByJob(prepared.job.id)).toBeNull();
  });
  it("blocks generic Retry execution until dedicated original-operation recovery, then requires confirm before run",async()=>{
    const f=fixture();const prepared=await f.controller.prepare(f.input);const operation=f.store.getByJobId(prepared.job.id)!;
    expect(f.controller.allowsCandidateRequest("jobs:run",{id:prepared.job.id})).toBe(false);
    f.repository.updateJobFailure(prepared.job.id,"Retry","UNKNOWN","fixture",new Date().toISOString());
    expect(f.controller.allowsCandidateRequest("jobs:run",{id:prepared.job.id})).toBe(false);
    expect(f.controller.allowsCandidateRequest("jobs:confirm",{id:prepared.job.id})).toBe(false);
    f.adapter.recoverOriginalOperation.mockResolvedValue({status:"prepared",operation});await f.controller.recover(prepared.job.id);
    // Dedicated readback may recover the original safe preparation; no final claim is created.
    expect(f.repository.getJob(prepared.job.id)?.status).toBe("AwaitingConfirmation");
    expect(f.controller.allowsCandidateRequest("jobs:confirm",{id:prepared.job.id,dryRun:true})).toBe(false);
    expect(f.controller.allowsCandidateRequest("jobs:confirm",{id:prepared.job.id})).toBe(false);
    expect(f.controller.allowsCandidateRequest("jobs:confirm",{id:prepared.job.id,dryRun:false})).toBe(true);
    f.repository.confirmJob(prepared.job.id,false);
    expect(f.controller.allowsCandidateRequest("jobs:run",{id:prepared.job.id})).toBe(true);
    expect(f.controller.allowsCandidateRequest("jobs:confirm",{id:prepared.job.id})).toBe(false);
  });
  it("blocks credential changes until the exact staging operation has succeeded purge",async()=>{
    const f=fixture();const prepared=await f.controller.prepare(f.input);const next={origin:"https://staging.kangyihb.com",siteId:"kangyi" as const,environment:"staging" as const,keyId:"rotated-key",secret:"0123456789abcdef0123456789abcdef"}; // gitleaks:allow -- public fixture
    expect(()=>f.controller.assertCredentialReconfiguration(f.account.id,next)).toThrow("ORIGINAL_CREDENTIAL_STILL_REQUIRED");
    const operation=f.store.getByJobId(prepared.job.id)!;
    f.store.compareAndSwap(operation.jobId,operation.revision,{...operation,maintenance:[{maintenanceId:"own-purge",operation:"purge",state:"SUCCEEDED",idempotencyKey:"own-purge-key",exactJson:"{}",bodySha256:"a".repeat(64),sourceRowVersion:1,remoteJob:{jobId:"30000000-0000-4000-a000-000000000001",status:"succeeded"}}]});
    expect(()=>f.controller.assertCredentialReconfiguration(f.account.id,next)).not.toThrow();
  });
});
