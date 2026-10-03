/* global window */
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { freshProfile, launchPilot, beforePilotMain, saveEvidence, selectCompany, waitForIpcCondition, mainDatabase } from './r115-i-installed-helpers.mjs';

// Real Main creates synthetic companies. Only the first read AFTER its ACK is faulted.
// Removing workspace selection or allowing another create after ACK must fail these cases.
const hook = new Function('electron', 'input', '(' + beforePilotMain.toString() + String.raw`)(electron,input);
 globalThis.__iCreateRecovery={armed:false,fault:null,createCalls:0,acknowledgedIds:[],readFailures:0};
 const handle=electron.ipcMain.handle.bind(electron.ipcMain);
 electron.ipcMain.handle=(channel,listener)=>handle(channel,async(...args)=>{
  const state=globalThis.__iCreateRecovery;
  if(channel==='brands:create'){
   state.createCalls++;const created=await listener(...args);state.acknowledgedIds.push(created.id);
   if(state.armed){state.armed=false;state.fault=input.fault;}
   return created;
  }
  if(state.fault===channel){state.fault=null;state.readFailures++;throw Error('合成验收：已创建企业的资料读取失败');}
  return listener(...args);
 });
`);
const finalRun = process.argv.includes('--final');
const cases = [];

async function createThroughUi(page, companyName) {
  const entry = page.getByRole('button', { name: '新建企业', exact: true });
  const companies = await page.evaluate(() => window.publisherAPI.workspace.companies());
  if (companies.length) { await entry.waitFor(); await entry.click(); }
  else await page.getByRole('button', { name: '创建企业资料', exact: true }).click();
  await page.getByLabel('新企业名称', { exact: true }).fill(companyName);
  await page.getByLabel('新企业简称', { exact: true }).fill(companyName);
  await page.getByRole('button', { name: '创建企业', exact: true }).click();
}

for (const name of ['persisted-workspace', 'brands:list', 'brand-knowledge:list']) {
  const profile = freshProfile('create-recovery-' + name.replaceAll(':', '-'));
  const result = { name, status: 'RUNNING', kind: 'INSTALLED_ORDINARY_UI_SYNTHETIC_CREATION_RECOVERY', directSqlMutations: 0, productionWrites: 0, platformWrites: 0, cloudRequests: 0, checks: [] };
  let run;
  try {
    run = await launchPilot(resolve(process.argv[2]), profile.userData, { beforeMain: hook, fixture: { userData: profile.userData, canonical: resolve('.'), fault: name } });
    result.build = run.build;
    if (name === 'persisted-workspace') {
      await createThroughUi(run.page, '合成隔离企业A');
      await run.page.getByRole('heading', { name: '企业资料', exact: true, level: 2 }).waitFor();
      await createThroughUi(run.page, '合成隔离企业B');
      await run.page.getByRole('heading', { name: '企业资料', exact: true, level: 2 }).waitFor();
      await waitForIpcCondition(run.page, () => window.publisherAPI.workspace.companies().then(items => items.length === 2));
      const companies = await run.page.evaluate(() => window.publisherAPI.workspace.companies());
      const a = companies.find(item => item.companyName === '合成隔离企业A'), b = companies.find(item => item.companyName === '合成隔离企业B');
      // B -> A causes the existing Main settings write even when A was the default.
      await selectCompany(run.page, b.id); await selectCompany(run.page, a.id);
      const before = (await run.page.evaluate(() => window.publisherAPI.brands.list()))[0];
      await createThroughUi(run.page, '合成隔离企业C');
      await run.page.getByRole('heading', { name: '企业资料', exact: true, level: 2 }).waitFor();
      const afterCreate = await run.page.evaluate(() => window.publisherAPI.workspace.companies());
      const c = afterCreate.find(item => item.companyName === '合成隔离企业C'); assert.ok(c);
      result.observedEditorCompany = await run.page.getByLabel('企业名称', { exact: true }).inputValue();
      result.observedWorkspace = await run.page.evaluate(() => window.publisherAPI.workspace.current());
      assert.equal(result.observedEditorCompany, '合成隔离企业C', 'New company must be the editor target after an explicitly saved old workspace');
      await selectCompany(run.page, c.id);
      assert.equal(result.observedWorkspace, c.id, 'Creation must select the acknowledged company before loading its editor');
      await run.page.getByLabel('企业介绍', { exact: true }).fill('仅属于合成隔离企业C的说明');
      await run.page.getByRole('button', { name: '保存', exact: true }).click();
      await run.page.getByText('企业资料已保存', { exact: true }).waitFor();
      assert.equal((await run.page.evaluate(() => window.publisherAPI.brands.list()))[0].description, '仅属于合成隔离企业C的说明');
      await selectCompany(run.page, a.id);
      const after = (await run.page.evaluate(() => window.publisherAPI.brands.list()))[0];
      assert.deepEqual(after, before, 'Saving the new company must not mutate the previously selected company');
      result.checks.push('explicitlySelectedCompanyIsNotUsedForNewCompanyEditor', 'normalUiSaveTargetsNewCompanyAndOldCompanyUnchanged');
    } else {
      await run.evaluate(() => { globalThis.__iCreateRecovery.armed = true; });
      await createThroughUi(run.page, '合成读取恢复企业');
      await run.page.getByRole('status').filter({ hasText: '合成验收：已创建企业的资料读取失败' }).waitFor();
      result.afterAcknowledgement = await run.evaluate(() => globalThis.__iCreateRecovery);
      assert.equal((await run.page.evaluate(() => window.publisherAPI.workspace.companies())).length, 1, 'Create ACK must correspond to one durable company');
      const recovery = run.page.getByRole('button', { name: '重新读取已创建企业', exact: true });
      result.recoveryActionVisible = await recovery.count() === 1;
      result.createActionVisible = await run.page.getByRole('button', { name: '创建企业', exact: true }).count() === 1;
      assert.equal(result.recoveryActionVisible, true, 'A successful create followed by a read failure must offer read recovery, not another create');
      assert.equal(result.createActionVisible, false, 'The acknowledged company must be retained until read recovery');
      await recovery.click();
      await run.page.getByRole('heading', { name: '企业资料', exact: true, level: 2 }).waitFor();
      const state = await run.evaluate(() => globalThis.__iCreateRecovery);
      assert.equal(state.createCalls, 1); assert.equal(state.acknowledgedIds.length, 1); assert.equal(state.readFailures, 1);
      assert.equal((await run.page.evaluate(() => window.publisherAPI.workspace.companies())).length, 1);
      assert.equal(await run.page.evaluate(() => window.publisherAPI.workspace.current()), state.acknowledgedIds[0]);
      assert.equal(await run.page.getByLabel('企业名称', { exact: true }).inputValue(), '合成读取恢复企业');
      result.checks.push('acknowledgedCompanyRemainsDurableDuringReadFailure', 'retryOnlyReadsSameCompanyWithoutSecondCreate');
    }
    result.database = await run.evaluate(mainDatabase, { userData: profile.userData });
    for (const count of Object.values(result.database.counts)) assert.equal(count, 0);
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.error = String(error); process.exitCode = 1;
    if (run?.page) await run.page.screenshot({ path: join(profile.root, 'failure-preserved.png'), fullPage: false });
  } finally {
    if (run) {
      result.network = await run.evaluate(() => globalThis.__hNetwork);
      result.independence = await run.evaluate(() => globalThis.__iIndependent);
      await run.close(); result.networkExit = run.networkExit();
      assert.equal(result.networkExit.beforeMain, true); assert.equal(result.networkExit.blocked, 1); assert.equal(result.networkExit.loopback, 0);
      assert.equal(result.independence.sourceReads, 0); assert.equal(result.independence.sourceModules, 0);
    }
    cases.push(result);
  }
}
const result = { status: cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', cases };
saveEvidence(finalRun ? 'final-company-creation-recovery' : 'company-creation-recovery-' + Date.now(), result);
console.log(JSON.stringify(result));
