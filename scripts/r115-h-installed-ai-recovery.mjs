/* global window */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {freshRoot,launchInstalled,closeInstalled,nav,tab,selectCompany,waitForIpcCondition,saveEvidence} from './r115-h-installed-helpers.mjs';
const executable=resolve(process.argv[2]??'output/r115-h-isolated-install/Geo Media Publisher.exe');
const root=freshRoot('ai-unknown-recovery'),userData=join(root,'b01-isolated-user-data'),key='r115-h-synthetic-recovery-only';
let requests=0,holdNext=false,lateResponses=0;
const body='本机隔离合成资料：先确认资料，编辑后由员工审核，结果不确定时交由人工核对。'.repeat(20);
const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  assert.equal(req.headers.authorization,'Bearer '+key);const chunks=[];for await(const c of req)chunks.push(c);
  const input=JSON.parse(Buffer.concat(chunks).toString()),repair=input.messages.some(m=>m.role==='system'&&String(m.content).includes('仅修复标题长度和格式'));
  const number=++requests;if(repair&&number===2){req.socket.destroy();return;}
  if(holdNext){holdNext=false;await new Promise(done=>setTimeout(done,1600));lateResponses++;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:number===1?'合'.repeat(21):'合成恢复流程',body})}}]}));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
let run,companyId;const result={kind:'INSTALLED_LOOPBACK_UNKNOWN_MANUAL_UI_RECOVERY',root,realPlatformWrites:0,cloudRequests:0,stages:{}};
const mark=name=>{result.stages[name]='PASS';saveEvidence(root,'ai-recovery',result);console.log(JSON.stringify({stage:name,status:'PASS'}));};
const journal=new Function('electron','input',`const require=process.mainModule.require.bind(process.mainModule),path=require('node:path'),Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3'));if(electron.app.getPath('userData')!==input.userData)throw Error('SCOPE');const db=new Database(path.join(input.userData,'production-data','publisher.db'),{readonly:true});try{return db.prepare('SELECT purpose,status FROM ai_request_journal ORDER BY rowid').all();}finally{db.close();}`);
try{
  run=await launchInstalled(executable,userData,{origins:[origin]});let {page,app}=run;
  const company=await page.evaluate(()=>window.publisherAPI.brands.create({name:'恢复合成企业',companyName:'恢复合成企业有限公司'}));companyId=company.id;
  await page.evaluate(async({companyId,baseUrl,key})=>{const profile=await window.publisherAPI.aiCenter.saveProfile({provider:'custom',displayName:'本机恢复夹具',baseUrl,defaultModel:'offline-fixture',isDefault:true});await window.publisherAPI.aiCenter.setCredential(profile.id,key);await window.publisherAPI.workspace.select(companyId);await window.publisherAPI.operations.saveStudioDefaults({companyId,profileId:profile.id,model:'offline-fixture',templateId:'industry',templateVersion:1,purpose:'生成文章',targetPlatforms:['douyin']});},{companyId,baseUrl:origin+'/v1',key});
  await page.reload();await selectCompany(page,companyId);await nav(page,'内容运营');await tab(page,'草稿生成队列');
  await page.getByLabel('主题',{exact:true}).fill('未知修复与手动对账');await tab(page,'预览 AI 工作量');await page.getByText('本次 AI 工作量预览',{exact:true}).waitFor();await tab(page,'确认预算并开始生成草稿');
  await waitForIpcCondition(page,id=>window.publisherAPI.operations.snapshot(id).then(s=>s.generationItems.some(i=>i.status==='Recoverable')),companyId,{timeout:15000});assert.equal(requests,2);
  const source=(await page.evaluate(id=>window.publisherAPI.operations.snapshot(id),companyId)).generationItems.find(i=>i.itemKind==='Source');assert.ok(source?.generationId);mark('repairUnknownRetainsSource');
  await closeInstalled(run);run=null;run=await launchInstalled(executable,userData,{origins:[origin]});({page,app}=run);await new Promise(done=>setTimeout(done,600));assert.equal(requests,2);mark('restartDoesNotReplayUnknown');
  await nav(page,'内容生产');await tab(page,'生成历史');const unknown=page.locator('.table-row').filter({hasText:'结果无法确认'}).first();await unknown.getByRole('button',{name:'查看草稿',exact:true}).click();const title=page.getByLabel('douyin 草稿标题');assert.equal(await title.inputValue(),'合'.repeat(21));assert.equal(await page.getByLabel('douyin 草稿正文').inputValue(),body);
  await title.fill('人工核对后的恢复稿');const section=page.locator('section').filter({has:title}).last();await section.getByRole('button',{name:'Validate 内容',exact:true}).click();await section.getByRole('button',{name:'保存 Draft',exact:true}).click();await page.getByText('已保存内容库 Draft，提交修改后还需人工审核。').waitFor();assert.equal(requests,2);mark('knownSourceManualEditAndSave');
  await nav(page,'内容运营');await tab(page,'草稿生成队列');await tab(page,'已在 AI Studio 修正并保存，重新对账');await page.getByRole('button',{name:'继续剩余预算生成',exact:true}).waitFor();await new Promise(done=>setTimeout(done,500));assert.equal(requests,2);
  const reconciled=await page.evaluate(id=>window.publisherAPI.operations.snapshot(id),companyId);assert.equal(reconciled.generationItems.find(i=>i.id===source.id).status,'Completed');assert.equal(reconciled.generationQueues[0].status,'Pending');assert.deepEqual((await app.evaluate(journal,{userData})).find(j=>j.purpose==='TitleRepair'),{purpose:'TitleRepair',status:'Unknown'});mark('reconcileIssuesZeroRequestsAndPreservesUnknownJournal');
  holdNext=true;await tab(page,'继续剩余预算生成');await waitForIpcCondition(page,id=>window.publisherAPI.operations.snapshot(id).then(s=>s.generationQueues[0]?.status==='Running'&&s.generationQueues[0]?.issuedRequests===3),companyId);
  const pause=page.getByRole('button',{name:'暂停',exact:true});await pause.click();await page.getByText('队列已暂停。',{exact:true}).waitFor();await new Promise(done=>setTimeout(done,1800));assert.equal(requests,3);mark('explicitContinueKeepsPauseAvailable');
  await tab(page,'取消');await page.getByText('队列已取消。',{exact:true}).waitFor();const beforeRestart=requests;await closeInstalled(run);run=null;run=await launchInstalled(executable,userData,{origins:[origin]});await new Promise(done=>setTimeout(done,500));assert.equal(requests,beforeRestart);
  result.requestJournal=await run.app.evaluate(journal,{userData});assert.equal(result.requestJournal.filter(j=>j.purpose==='TitleRepair'&&j.status==='Unknown').length,1);result.requests=requests;result.lateMockResponses=lateResponses;result.build=run.build;result.status='PASS';mark('cancelAndSecondRestartNoReplay');await closeInstalled(run);run=null;saveEvidence(root,'ai-recovery',result);console.log(JSON.stringify({status:'PASS',evidence:join(root,'ai-recovery.json'),requests}));
}catch(error){result.status='FAIL';result.error=String(error).slice(0,1200);if(run){await run.page.screenshot({path:join(root,'failure.png'),fullPage:false}).catch(()=>{});await closeInstalled(run).catch(()=>{});run=null;}saveEvidence(root,'ai-recovery',result);throw error;}finally{await new Promise(done=>server.close(done));}
