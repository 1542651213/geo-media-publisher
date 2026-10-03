import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { earlyInstalled } from './r115-h-early-installed.mjs';
import { nav, tab, selectCompany, mainDatabase } from './r115-h-installed-helpers.mjs';
const evidence = resolve('output/r115-h2-execution-20261003'), root = join(evidence, `ui-states-${Date.now()}`), userData = join(root, 'b01-isolated-user-data');
mkdirSync(root, { recursive: true }); const fixture = join(evidence, 'visual-fixture-v4'); cpSync(join(fixture, 'b01-isolated-user-data'), userData, { recursive: true, errorOnExist: true });
const meta = JSON.parse(readFileSync(join(fixture, 'fixture.json'), 'utf8'));
const result = { kind: 'INSTALLED_READ_ONLY_IPC_LATENCY_ERROR_FIXTURE', checks: [], realPlatformWrites: 0, cloudRequests: 0 };
let run;
try {
  run = await earlyInstalled(resolve(process.argv[2]), userData, { beforeMain: new Function('electron', `
    globalThis.__h1UiReadFixture={delayMs:0,error:false,readCalls:0};
    const handle=electron.ipcMain.handle.bind(electron.ipcMain);
    electron.ipcMain.handle=(channel,listener)=>handle(channel,channel==='jobs:page'?async(...args)=>{
      const state=globalThis.__h1UiReadFixture;state.readCalls++;
      if(state.delayMs)await new Promise(done=>setTimeout(done,state.delayMs));
      if(state.error)throw Error('合成验收：暂时无法读取任务，请刷新重试');
      return listener(...args);
    }:listener);
  `) });
  assert.equal(run.build.deliveryId, 'R1.15-H.2'); await selectCompany(run.page, meta.companyId);
  const before = await run.evaluate(mainDatabase, { userData });
  await run.evaluate(() => globalThis.__h1UiReadFixture.delayMs = 3000);
  await nav(run.page, '内容运营'); await tab(run.page, '发布看板');
  await run.page.getByRole('status').filter({ hasText: '正在读取当前企业的任务' }).waitFor();
  assert.equal(await run.page.getByLabel('任务筛选平台').isDisabled(), true); assert.equal(await run.page.locator('.skeleton-row').count(), 4);
  await run.page.screenshot({ path: join(root, 'loading.png') });
  await run.page.getByText('共 1 条 · 第 1 / 1 页', { exact: true }).waitFor(); result.checks.push('loadingSkeletonAndDisabledFilters');
  await run.evaluate(() => { globalThis.__h1UiReadFixture.delayMs = 0; globalThis.__h1UiReadFixture.error = true; });
  await tab(run.page, '刷新任务状态'); await run.page.getByRole('alert').filter({ hasText: '合成验收：暂时无法读取任务' }).waitFor();
  assert.equal(await run.page.getByRole('heading', { name: '任务暂未读取成功', exact: true }).count(), 1, 'Read failure must not imply an empty history');
  assert.equal(await run.page.getByRole('heading', { name: '当前筛选没有记录', exact: true }).count(), 0);
  assert.equal(await run.page.getByRole('button', { name: '刷新任务状态', exact: true }).isEnabled(), true);
  await run.page.screenshot({ path: join(root, 'read-error.png') }); result.checks.push('readErrorAlertWithExistingRetry');
  await run.evaluate(() => globalThis.__h1UiReadFixture.error = false); await tab(run.page, '刷新任务状态');
  await run.page.getByText('共 1 条 · 第 1 / 1 页', { exact: true }).waitFor(); assert.equal(await run.page.getByRole('alert').count(), 0); result.checks.push('retryRecoversOriginalRead');
  await run.page.getByLabel('发布日期').fill('2000-01-01'); await run.page.getByRole('heading', { name: '当前筛选没有记录', exact: true }).waitFor();
  await run.page.screenshot({ path: join(root, 'empty-filter.png') }); result.checks.push('emptyFilterExplainsNextStep');
  await nav(run.page, 'AI 服务商'); assert.equal(await run.page.getByLabel('AI API Key').getAttribute('type'), 'password'); assert.equal(await run.page.getByLabel('AI API Key').inputValue(), ''); result.checks.push('credentialInputMaskedAndBlank');
  assert.equal((await run.evaluate(mainDatabase, { userData })).frozenHash, before.frozenHash);
  result.network = await run.evaluate(() => globalThis.__hNetwork); assert.equal(result.network.beforeMain, true); assert.equal(result.network.loopback, 0); result.status = 'PASS';
} catch (error) { result.status = 'FAIL'; result.error = String(error); if (run) await run.page.screenshot({ path: join(root, 'failure.png') }).catch(() => {}); throw error; }
finally { if (run) await run.close(); writeFileSync(join(root, 'ui-states.json'), JSON.stringify(result, null, 2)); }
console.log(JSON.stringify({ ...result, evidence: join(root, 'ui-states.json') }));
