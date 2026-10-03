/* global window */
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { freshProfile, launchPilot, beforePilotMain, saveEvidence, nav, tab, mainDatabase } from './r115-i-installed-helpers.mjs';
const profile = freshProfile('offline-ui-faults'), finalRun = process.argv.includes('--final'), captures = resolve(finalRun ? 'docs/product/r115-i-pilot-preview' : 'output/r115-i-execution-20261003/preflight-captures');
mkdirSync(captures, { recursive: true }); let run;
const hook = new Function('electron', 'input', '(' + beforePilotMain.toString() + String.raw`)(electron,input);
 globalThis.__iUiFixture={createFailsOnce:true,companyId:null,delayMs:0,readError:false,simulatedHistory:false,calls:0};
 const handle=electron.ipcMain.handle.bind(electron.ipcMain);
 electron.ipcMain.handle=(channel,listener)=>handle(channel,channel==='brands:create'?async(...args)=>{if(globalThis.__iUiFixture.createFailsOnce){globalThis.__iUiFixture.createFailsOnce=false;throw Error('合成验收：企业创建暂时失败，请保留输入后重试');}return listener(...args);}:channel==='jobs:page'?async(...args)=>{
  const state=globalThis.__iUiFixture;state.calls++;if(state.delayMs)await new Promise(done=>setTimeout(done,state.delayMs));if(state.readError)throw Error('合成验收：历史任务暂时无法读取');
  if(!state.simulatedHistory)return listener(...args);
  return {companyId:state.companyId,items:[{id:'i-simulated-unknown',title:'SIMULATED · 原任务结果未知演示',platform:'toutiao',account:'SIMULATED · 演示账号',accountId:'i-simulated-account',date:'2026-10-03T00:00:00.000Z',status:'NeedsReconciliation',ownerActionRequired:true},{id:'i-simulated-history',title:'SIMULATED · 历史状态显示演示',platform:'douyin',account:'SIMULATED · 演示账号',accountId:'i-simulated-account',date:'2026-10-02T00:00:00.000Z',status:'Published',ownerActionRequired:false}],page:1,pageSize:50,pages:1,total:2,platforms:['toutiao','douyin'],accounts:[{id:'i-simulated-account',label:'SIMULATED · 演示账号'}],statuses:['NeedsReconciliation','Published']};
 }:listener);
`);
const result = { status: 'RUNNING', kind: 'INSTALLED_SYNTHETIC_FAILURE_AND_READONLY_HISTORY_DISPLAY', directSqlMutations: 0, realPlatformPassClaimed: false, cloudRequests: 0, productionWrites: 0, checks: [] };
try {
 run = await launchPilot(resolve(process.argv[2]), profile.userData, { beforeMain: hook, fixture: { userData: profile.userData, canonical: resolve('.') } });
 await run.page.getByRole('button', { name: '创建企业资料', exact: true }).click(); const create = run.page.getByRole('button', { name: '创建企业', exact: true }); assert.equal(await create.isDisabled(), true);
 await run.page.getByLabel('新企业名称', { exact: true }).fill('合成故障企业'); await run.page.getByLabel('新企业简称', { exact: true }).fill('合成故障');
 await create.click(); await run.page.getByRole('status').filter({ hasText: '合成验收：企业创建暂时失败' }).waitFor();
 assert.equal(await run.page.getByLabel('新企业名称', { exact: true }).inputValue(), '合成故障企业'); assert.equal((await run.page.evaluate(() => window.publisherAPI.brands.list())).length, 0); assert.equal(await create.isEnabled(), true); result.checks.push('createFailureKeepsInputAndNoCompanyWritten');
 await create.click(); await run.page.getByRole('heading', { name: '企业资料', exact: true, level: 2 }).waitFor(); const companyId = (await run.page.evaluate(() => window.publisherAPI.workspace.companies()))[0].id; await run.evaluate((electron, id) => { globalThis.__iUiFixture.companyId = id; globalThis.__iUiFixture.delayMs = 2000; }, companyId); result.checks.push('ordinaryUiRetryCreatesExactlyOneCompany');
 await nav(run.page, '内容运营'); await tab(run.page, '发布看板'); await run.page.getByRole('status').filter({ hasText: '正在读取当前企业的任务' }).waitFor(); assert.equal(await run.page.getByLabel('任务筛选平台').isDisabled(), true); result.checks.push('jobsLoadingFeedback');
 await run.page.getByText('当前筛选没有记录', { exact: true }).waitFor(); await run.evaluate(() => { globalThis.__iUiFixture.delayMs = 0; globalThis.__iUiFixture.readError = true; }); await tab(run.page, '刷新任务状态');
 await run.page.getByRole('alert').filter({ hasText: '任务读取失败' }).waitFor(); assert.equal(await run.page.getByText('当前筛选没有记录', { exact: true }).count(), 0); result.checks.push('jobsReadErrorDoesNotClaimEmptyHistory');
 await run.evaluate(() => { globalThis.__iUiFixture.readError = false; }); await tab(run.page, '刷新任务状态'); await run.page.getByText('当前筛选没有记录', { exact: true }).waitFor(); result.checks.push('jobsExplicitRefreshRecovery');
 const before = await run.evaluate(mainDatabase, { userData: profile.userData }); await run.evaluate(() => { globalThis.__iUiFixture.simulatedHistory = true; }); await tab(run.page, '刷新任务状态');
 await run.page.getByText('SIMULATED · 原任务结果未知演示', { exact: true }).waitFor(); assert.match(await run.page.locator('.operations-publish-table').innerText(), /结果未知|请勿重发/u); assert.equal(await run.page.locator('.operations-publish-table button').count(), 0);
 await run.page.screenshot({ path: join(captures, '12-jobs-simulated-readonly.png'), fullPage: false }); const after = await run.evaluate(mainDatabase, { userData: profile.userData }); assert.equal(before.frozenHash, after.frozenHash); assert.equal(after.counts.publish_jobs, 0); assert.equal(after.counts.publish_records, 0); result.checks.push('simulatedUnknownReadonlyUiNoPublishActionsOrPersistedJob');
 result.network = await run.evaluate(() => globalThis.__hNetwork); assert.equal(result.network.beforeMain, true); assert.equal(result.network.blocked, 1); assert.equal(result.network.loopback, 0); result.status = 'PASS';
} catch (error) { result.status = 'FAIL'; result.error = String(error); process.exitCode = 1; }
finally { await run?.close(); saveEvidence(finalRun ? 'final-offline-ui-faults' : 'preflight-offline-ui-faults', result); console.log(JSON.stringify(result)); }
