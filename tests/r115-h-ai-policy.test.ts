import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase } from '@publisher/db';
import { AIProductCenter } from '../apps/desktop/src/main/ai-product-center';
import { ContentOperations } from '../apps/desktop/src/main/content-operations';
const cleanup:(()=>void)[]=[];
afterEach(()=>cleanup.splice(0).forEach(close=>close()));
function fixture(transport:typeof fetch){
  const root=mkdtempSync(join(tmpdir(),'r115-h-ai-')),opened=openDatabase(join(root,'publisher.db'),resolve('packages/db/migrations'));
  cleanup.push(()=>{opened.db.close();rmSync(root,{recursive:true,force:true});});
  const keys=new Map<string,string>(),center=new AIProductCenter(opened.repository,{get:key=>keys.get(key)??null,set:(key,value)=>{keys.set(key,value);},delete:key=>{keys.delete(key);},has:key=>keys.has(key)},transport);
  const company=opened.repository.createBrand({name:'合成甲',companyName:'合成甲企业'}),profile=center.saveProfile({provider:'custom',displayName:'隔离本地模型',baseUrl:'http://127.0.0.1:19001/v1',defaultModel:'fixture',isDefault:true});
  center.setCredential(profile.id,'synthetic-h-policy');
  const request={companyId:company.id,sourceArticleId:null,sourceText:'合成甲企业服务流程',purpose:'生成文章',targetPlatforms:['douyin','website'],profileId:profile.id,model:'fixture',templateId:'industry',templateVersion:1};
  return{...opened,center,company,profile,request};
}
const response=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'合成流程',body:'合成甲企业服务流程。'})}}],usage:{prompt_tokens:11,completion_tokens:12}}));
it('refuses disabled providers and invalid output-token limits before preview or dispatch',async()=>{
  const fetchPort=vi.fn<typeof fetch>(async()=>response()),f=fixture(fetchPort);
  f.db.prepare('UPDATE ai_provider_profiles SET enabled=0 WHERE id=?').run(f.profile.id);
  expect(()=>f.center.previewGeneration(f.request)).toThrow('服务商已停用');
  await expect(f.center.generate(f.request)).rejects.toThrow('服务商已停用');
  f.db.prepare('UPDATE ai_provider_profiles SET enabled=1,max_output_tokens=32001 WHERE id=?').run(f.profile.id);
  expect(()=>f.center.previewGeneration(f.request)).toThrow('输出 Token');
  expect(fetchPort).not.toHaveBeenCalled();
});
it('honors output-token policy and rejects a late response after the provider is disabled',async()=>{
  let finish!:(value:Response)=>void;
  const bodies:Record<string,unknown>[]=[];
  const f=fixture(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)) as Record<string,unknown>);return new Promise<Response>(resolve=>{finish=resolve;});});
  f.db.prepare('UPDATE ai_provider_profiles SET max_output_tokens=1024 WHERE id=?').run(f.profile.id);
  const preview=f.center.previewGeneration(f.request);expect(preview.maxOutputTokensPerRequest).toBe(1024);
  const running=f.center.generate({...f.request,previewId:preview.previewId});
  await vi.waitFor(()=>expect(bodies).toHaveLength(1));
  f.db.prepare('UPDATE ai_provider_profiles SET enabled=0 WHERE id=?').run(f.profile.id);
  finish(response());await running;
  expect(bodies[0]?.max_tokens).toBe(1024);expect(bodies).toHaveLength(1);
  expect(f.db.prepare('SELECT status FROM ai_request_journal').all()).toEqual([{status:'Unknown'}]);
  expect(f.center.requestBudget(preview.previewId,f.company.id).issuedRequests).toBe(1);
  expect(f.repository.listArticles()).toHaveLength(0);
});
it('uses separate durable budgets for each 20-source six-target queue without dispatching previews',()=>{
  const fetchPort=vi.fn<typeof fetch>(async()=>response()),f=fixture(fetchPort),operations=new ContentOperations(f.repository,f.center);
  const request={companyId:f.company.id,topic:'合成资料',requestedCount:20,targetPlatforms:['douyin','toutiao','weibo','sohu_media','website','cnblogs'],profileId:f.profile.id,model:'fixture',templateId:'industry',templateVersion:1};
  const a=operations.previewGenerationQueue(request),b=operations.previewGenerationQueue(request);
  expect(a).toMatchObject({sourceCount:20,targetCount:6,workItemCount:140,baseRequests:140,maxRequests:560,globalConcurrency:1});
  expect(a.previewId).not.toBe(b.previewId);expect(fetchPort).not.toHaveBeenCalled();
  expect(f.center.requestBudget(a.previewId,f.company.id).issuedRequests).toBe(0);
});
