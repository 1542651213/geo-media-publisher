/* global window, document */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright-core";
import XLSX from "xlsx";

// This smoke uses a separate installed executable, separate data, and a loopback-only provider.
// It never calls a platform submit or logs credential/business payloads.
const executablePath = resolve(process.argv[2] ?? "output/r115-f-department-install/Geo Media Publisher.exe");
assert.ok(existsSync(executablePath));
const evidence = resolve("output/r115-f-execution-20261001");
const root = join(evidence, `installed-smoke-${Date.now()}`), userData = join(root, "b01-isolated-user-data");
mkdirSync(userData, { recursive: true });
const original = join(process.env.APPDATA ?? "", "codex-media-publisher/production-data");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const protectedBytes = () => Object.fromEntries(["publisher.db", "publisher.db-wal", "publisher.db-shm", "credentials.enc"].map(name => [name, existsSync(join(original, name)) ? hash(readFileSync(join(original, name))) : null]));
const before = protectedBytes(), fixtureKey = "non-production-local-fixture";
let generations = 0, models = 0, unknownRequests = 0, factRequests = 0;
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET" && request.url === "/v1/models") { models++; response.end(JSON.stringify({ data: [{ id: "offline-fixture" }] })); return; }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") { unknownRequests++; response.writeHead(404); response.end(); return; }
  assert.equal(request.headers.authorization, `Bearer ${fixtureKey}`);
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(input.model, "offline-fixture");
  const prompt = input.messages.map(item => item.content).join("\n");
  if (prompt.includes("已核准本机流程事实")) factRequests++;
  generations++;
  const output = { title: `流程草稿${generations}`, body: `示例甲有限公司的已确认流程资料，第${generations}篇本机草稿。` };
  response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const nav = (page, name) => page.locator(".sidebar .nav-item").filter({ hasText: name }).click();
const tab = (page, name) => page.getByRole("button", { name, exact: true }).first().click();
const pickFile = new Function("electron", "path", "electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });");
const inspectMain = new Function("electron", "input", `
  const require = process.mainModule.require.bind(process.mainModule), fs = require('node:fs'), path = require('node:path');
  const Database = require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3'));
  const dbPath = path.join(input.userData,'production-data','publisher.db');
  const db = new Database(dbPath, {readonly:true});
  const tables = ['publish_jobs','publish_records','submission_intents','articles','article_variants','ai_generation_history','operations_generation_items','operations_content_plans','operations_facts'];
  const counts = Object.fromEntries(tables.map(name => [name,db.prepare('SELECT COUNT(*) n FROM '+name).get().n]));
  const integrity = db.pragma('integrity_check',{simple:true}), foreignKeys = db.pragma('foreign_key_check').length;
  const migrations = db.prepare('SELECT COUNT(*) n FROM migrations').get().n;
  const plaintextAbsent = !fs.readFileSync(dbPath).includes(input.fixture);
  const credentialEncrypted = !fs.readFileSync(path.join(input.userData,'production-data','credentials.enc'),'utf8').includes(input.fixture);
  db.close(); return {counts,integrity,foreignKeys,migrations,plaintextAbsent,credentialEncrypted,packaged:electron.app.isPackaged,electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules};
`);
async function launch(run) {
  const app = await electron.launch({ executablePath, timeout: 30000, env: { ...process.env, GMP_B01_ISOLATED_USER_DATA_DIR: userData, TOUTIAO_READONLY_PREFLIGHT: "true", PUBLISHER_DATA_MODE: "production", ELECTRON_RENDERER_URL: "", REAL_PUBLISH_TEST_BATCH_CONFIRMED: "false" } });
  try { const page = await app.firstWindow();
    try { await page.getByLabel("当前企业工作区").waitFor(); await run(page, app); } catch (error) { await page.screenshot({path:join(root,"failure.png"),fullPage:true}); throw error; }
  } finally { await app.close(); }
}
let companyA, companyB, profileId, queueId, initialInspection, finalInspection, sourceId, accountId;
try {
  await launch(async (page, app) => {
    assert.equal(await page.evaluate(() => window.publisherAPI.settings.get().then(value => value.developerMode === true)), false);
    const brands = await page.evaluate(async () => [await window.publisherAPI.brands.create({name:"示例甲",companyName:"示例甲有限公司"}),await window.publisherAPI.brands.create({name:"示例乙",companyName:"示例乙有限公司"})]);
    companyA = brands[0].id; companyB = brands[1].id;
    await page.reload(); await page.getByLabel("当前企业工作区").selectOption(companyA);
    await page.getByRole("heading",{name:"今日工作台",exact:true}).waitFor();
    for (const name of ["文章库","图片库","账号中心","发布中心","数据统计"]) {
      await nav(page,name); assert.deepEqual(await page.getByRole("button",{name:/Candidate|B01|真实发布验收|自测发布/u}).allTextContents(),[]);
    }
    await nav(page,"AI 服务商"); await page.getByRole("heading",{name:"AI Provider Center",exact:true,level:2}).waitFor();
    assert.equal(await page.getByLabel("AI 服务商").locator("option").count(),5);
    await page.getByLabel("AI 服务商").selectOption("custom"); await page.getByLabel("AI API 地址").fill(baseUrl);
    await page.getByLabel("AI 默认模型").fill("offline-fixture"); await page.getByLabel("AI API Key").fill(fixtureKey);
    await page.getByRole("button",{name:"保存服务商",exact:true}).click(); await page.getByText("配置已保存；凭据由系统安全存储保管。").waitFor();
    assert.equal(await page.getByLabel("AI API Key").inputValue(),"");
    await page.getByRole("button",{name:"Test Connection",exact:true}).click(); await page.getByText("连接和模型列表已验证；生成能力以实际请求为准").waitFor();
    profileId = (await page.evaluate(() => window.publisherAPI.aiCenter.profiles()))[0].id;
    await page.evaluate(async ({companyId,profileId}) => {
      const api = window.publisherAPI;
      const context = await api.aiCenter.context(companyId);
      await api.aiCenter.saveContext({...context,tone:"专业、克制、只引用资料"});
      await api.operations.saveStudioDefaults({companyId,profileId,model:"offline-fixture",templateId:"industry",templateVersion:1,purpose:"生成文章",targetPlatforms:["weibo","toutiao"]});
      await api.operations.saveFact({companyId,category:"公司信息",statement:"已核准本机流程事实",source:"Manual",sourceDate:null,verifiedAt:new Date().toISOString(),expiresAt:null,approvedForAI:true,notes:"本机测试"});
      await api.operations.saveFact({companyId,category:"公司信息",statement:"已过期不能使用",source:"Manual",sourceDate:null,verifiedAt:null,expiresAt:"2000-01-01T00:00:00.000Z",approvedForAI:true,notes:"过期测试"});
    },{companyId:companyA,profileId});
    await nav(page,"内容运营");
    for (const name of ["内容审核","草稿生成队列","内容计划","事实资料库","AI 用量","批量导入","Owner 处理","发布看板","今日工作台"]) await tab(page,name);
    await tab(page,"事实资料库"); await page.getByText("已过期",{exact:true}).waitFor();
    assert.equal((await page.evaluate(id => window.publisherAPI.operations.activeFacts(id),companyA)).length,1);
    await tab(page,"草稿生成队列"); await page.getByLabel("主题",{exact:true}).fill("已确认服务流程"); await page.getByLabel("草稿数量",{exact:true}).fill("2");
    await page.getByRole("button",{name:"开始生成草稿",exact:true}).click();
    await page.waitForFunction(id => window.publisherAPI.operations.snapshot(id).then(value => value.generationQueues.some(queue => queue.status === "Completed")),companyA,{timeout:30000});
    await page.getByRole("button",{name:"刷新",exact:true}).first().click();
    const state = await page.evaluate(id => window.publisherAPI.operations.snapshot(id),companyA);
    assert.equal(state.generationQueues.length,1); queueId = state.generationQueues[0].id;
    assert.equal(state.generationQueues[0].completedCount,6); assert.equal(state.generationItems.length,6);
    assert.ok(state.generationItems.every(item => item.status === "Completed"));
    const sources = state.generationItems.filter(item => item.itemKind === "Source"); sourceId = sources[0].outputArticleId;
    for (const source of sources) assert.equal((await page.evaluate(id => window.publisherAPI.articles.variants(id),source.outputArticleId)).length,2);
    assert.equal(generations,6); assert.equal(factRequests,6);
    assert.ok(state.review.every(item => item.reviewStatus !== "Approved"));
    await tab(page,"内容审核"); await page.getByRole("button",{name:"通过",exact:true}).first().click(); await page.getByText("内容已审核通过。",{exact:true}).waitFor();
    const approved = (await page.evaluate(id => window.publisherAPI.operations.snapshot(id),companyA)).review.find(item => item.reviewStatus === "Approved"); assert.ok(approved);
    await page.evaluate(id => window.publisherAPI.articles.update(id,{body:"示例甲有限公司更新的流程内容。"}),approved.articleId);
    const editedReview=(await page.evaluate(id => window.publisherAPI.operations.snapshot(id),companyA)).review.find(item=>item.articleId===approved.articleId);
    assert.notEqual(editedReview.reviewStatus,"Approved"); assert.notEqual(editedReview.contentHash,approved.contentHash);
    const staleApproval = await page.evaluate(async ({companyId,row}) => {try {await window.publisherAPI.operations.reviewArticle({companyId,articleId:row.articleId,action:"approve",expectedContentHash:row.contentHash});return false;} catch {return true;}},{companyId:companyA,row:approved}); assert.equal(staleApproval,true);
    await tab(page,"内容计划");
    const plans = await page.evaluate(async id => [...await window.publisherAPI.operations.generatePlan({companyId:id,days:7,startDate:"2026-10-01",targetPlatforms:["weibo"]}),...await window.publisherAPI.operations.generatePlan({companyId:id,days:30,startDate:"2026-11-01",targetPlatforms:["weibo"]})],companyA);
    assert.equal(plans.length,37);
    await nav(page,"首页"); await tab(page,"内容计划"); await page.getByRole("button",{name:"使用 AI 生成",exact:true}).first().click();
    await page.getByRole("heading",{name:"AI Content Studio",exact:true,level:2}).waitFor();
    await page.waitForFunction(() => window.publisherAPI.articles.list().then(rows => rows.length === 7));
    await page.waitForFunction(() => Boolean(document.querySelector('[aria-label="AI 源文章"]')?.value));
    assert.notEqual(await page.getByLabel("AI 源文章").inputValue(),"");
    assert.equal(await page.getByRole("checkbox",{name:/^微博/u}).isChecked(),true);
    assert.equal(await page.getByRole("checkbox",{name:/^今日头条/u}).isChecked(),false);
    const file = join(root,"中文 (素材).jpg"); writeFileSync(file,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rZsAAAAASUVORK5CYII=","base64"));
    const importImage = () => page.evaluate(({id,file}) => window.publisherAPI.imageAssets.import({brandId:id,sourcePaths:[file],tags:[],business:[],city:[],usage:[],platform:[],universal:false}),{id:companyA,file});
    const first = (await importImage())[0], second = (await importImage())[0]; assert.equal(first.id,second.id); assert.equal(second.duplicate,true); assert.equal(first.width,1); assert.equal(first.mimeType,"image/png");
    await page.evaluate(id=>window.publisherAPI.imageAssets.update(id,{universal:true}),first.id);
    await page.evaluate(id=>window.publisherAPI.articles.attachRecommendedImage({articleId:id,platformKey:"website"}),sourceId);
    const usedImage=(await page.evaluate(()=>window.publisherAPI.imageAssets.list())).find(row=>row.id===first.id); assert.equal(usedImage.usedByArticleCount,1); assert.equal(usedImage.usedByJobCount,0);
    await nav(page,"图片库"); await page.screenshot({path:join(root,"image-library.png"),fullPage:true});
    accountId = (await page.evaluate(() => window.publisherAPI.accounts.create({platformKey:"weibo",name:"本机无会话账号"}))).id;
    await page.evaluate(id => window.publisherAPI.accounts.update(id,{loginStatus:"logged_in"}),accountId);
    await nav(page,"首页"); await tab(page,"批量导入");
    for (const extension of ["csv","xlsx"]) {
      const path = join(root,`drafts.${extension}`); const rows = [{标题:`本机导入${extension}`,正文:`示例甲有限公司${extension}流程资料`,企业:"示例甲有限公司"},{标题:"",正文:"缺标题测试",企业:"示例甲有限公司"},{标题:"错误企业",正文:"隔离测试",企业:"示例乙有限公司"}];
      if (extension === "csv") writeFileSync(path,"\uFEFF"+XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows))); else {const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),"草稿");XLSX.writeFile(book,path);}
      await app.evaluate(pickFile,path); await page.getByRole("button",{name:"选择 CSV / XLSX",exact:true}).click(); await page.getByRole("heading",{name:"逐行错误",exact:true}).waitFor();
      await page.getByRole("button",{name:"Import as Draft",exact:true}).click(); await page.getByText("已导入 1 条草稿；跳过重复 0 条；失败 2 条。",{exact:true}).waitFor();
    }
    await page.getByLabel("当前企业工作区").selectOption(companyB); await page.waitForFunction(id=>window.publisherAPI.workspace.current().then(value=>value===id),companyB);
    assert.deepEqual(await page.evaluate(()=>window.publisherAPI.articles.list()),[]); assert.deepEqual(await page.evaluate(()=>window.publisherAPI.imageAssets.list()),[]); assert.deepEqual(await page.evaluate(()=>window.publisherAPI.accounts.list()),[]);
    assert.equal((await page.evaluate(id=>window.publisherAPI.operations.snapshot(id),companyB)).facts.length,0);
    const rejected = await page.evaluate(async id => {try {await window.publisherAPI.articles.get(id);return false;} catch {return true;}},sourceId); assert.equal(rejected,true);
    await nav(page,"内容生产"); await page.getByRole("heading",{name:"AI Content Studio",exact:true,level:2}).waitFor(); assert.equal(await page.getByLabel("AI 源文章").inputValue(),""); assert.equal(await page.getByLabel("AI 源稿").inputValue(),"");
    await page.getByLabel("当前企业工作区").selectOption(companyA); await nav(page,"首页"); await page.screenshot({path:join(root,"today-workspace.png"),fullPage:true});
    const bundle = await page.evaluate(()=>window.publisherAPI.product.diagnostics()); const text=JSON.stringify(bundle);
    for(const value of [fixtureKey,"示例甲",baseUrl,root,"userPrompt","systemPrompt"]) assert.equal(text.includes(value),false);
    assert.deepEqual(bundle.platforms.filter(row=>row.ordinaryPublishEnabled).map(row=>row.platform).sort(),["douyin","toutiao","website"]); assert.ok(bundle.platforms.every(row=>row.batchPublishEnabled===false));
    initialInspection=await app.evaluate(inspectMain,{userData,fixture:fixtureKey});
  });
  const requestsBeforeRestart=generations;
  await launch(async (page, app) => {
    assert.equal(await page.evaluate(()=>window.publisherAPI.workspace.current()),companyA);
    assert.equal((await page.evaluate(()=>window.publisherAPI.aiCenter.profiles()))[0].configured,true);
    assert.equal(await page.evaluate(()=>window.publisherAPI.settings.get().then(value=>value.developerMode===true)),false);
    const state=await page.evaluate(id=>window.publisherAPI.operations.snapshot(id),companyA); assert.equal(state.generationQueues.find(row=>row.id===queueId).status,"Completed"); assert.equal(state.plans.length,37); assert.equal(state.facts.length,2);
    assert.equal((await page.evaluate(()=>window.publisherAPI.articles.list())).length,9);
    await nav(page,"账号中心");
    await page.waitForFunction(id=>window.publisherAPI.accounts.overview().then(rows=>{const row=rows.find(value=>value.account.id===id);return row&&row.runtimeAuthState!=="CHECKING";}),accountId);
    const account=(await page.evaluate(()=>window.publisherAPI.accounts.overview())).find(row=>row.account.id===accountId); assert.ok(!["AUTHENTICATED","CONNECTED"].includes(account.runtimeAuthState));
    await page.screenshot({path:join(root,"accounts-restart.png"),fullPage:true});
    finalInspection=await app.evaluate(inspectMain,{userData,fixture:fixtureKey});
    assert.deepEqual(finalInspection.counts,initialInspection.counts);
  });
  assert.equal(generations,requestsBeforeRestart); assert.equal(unknownRequests,0); assert.deepEqual(protectedBytes(),before);
  for(const inspection of [initialInspection,finalInspection]) {assert.equal(inspection.integrity,"ok");assert.equal(inspection.foreignKeys,0);assert.equal(inspection.credentialEncrypted,true);assert.equal(inspection.plaintextAbsent,true);for(const name of ["publish_jobs","publish_records","submission_intents"]) assert.equal(inspection.counts[name],0);}
  const result={status:"PASS",packaged:finalInspection.packaged,electron:finalInspection.electron,node:finalInspection.node,abi:finalInspection.abi,companies:2,operationsTabs:9,providerChoices:5,modelRequests:models,loopbackGenerations:generations,approvedFactRequests:factRequests,queueSources:2,queueVariants:4,queueRecoveryNoReplay:true,planItems:37,planStudioHandoff:true,reviewEditInvalidation:true,staleApprovalBlocked:true,csvAndXlsxDraftImport:true,importRowErrors:true,sha256ImageDedup:true,workspaceIsolationAndSelectionReset:true,dbLoggedInNotAuthentication:true,encryptedCredential:true,plaintextAbsent:true,diagnosticAllowlist:true,integrity:"ok",foreignKeys:0,migrations:finalInspection.migrations,protectedOriginalBytesUnchanged:true,externalAIRequests:0,realPlatformPublishCount:0,newFinalSubmitCount:0,jobIntentRecordCount:0,livePlatformProbe:"NOT_RUN",evidenceDirectory:root};
  writeFileSync(join(root,"result.json"),JSON.stringify(result,null,2)); writeFileSync(join(evidence,"installed-smoke-result.json"),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally {await new Promise(done=>server.close(done));}
