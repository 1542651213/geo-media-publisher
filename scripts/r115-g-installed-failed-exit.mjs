/* global window */
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { freshRoot, launchInstalled, closeInstalled, waitForInstalledExit, nav, selectCompany, waitForIpcCondition, saveEvidence } from './r115-g-installed-helpers.mjs';
const executable = resolve(process.argv[2] ?? ''), root = freshRoot('failed-exit'), userData = join(root, 'b01-isolated-user-data');
const result = { kind: 'INSTALLED_FAILED_SHUTDOWN_DRAFT_FLUSH', root, realPlatformWrites: 0, cloudRequests: 0 };
let run;
const fault = new Function('electron', 'input', `
  if(electron.app.getPath('userData')!==input.userData)throw Error('TEST_SCOPE');
  const require=process.mainModule.require.bind(process.mainModule),path=require('node:path'),Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3'));
  if(!globalThis.__gPragmaOriginal){globalThis.__gPragmaOriginal=Database.prototype.pragma;Database.prototype.pragma=function(sql,...args){if(globalThis.__gExitFault&&sql==='wal_checkpoint(TRUNCATE)'){globalThis.__gExitFaultCount=(globalThis.__gExitFaultCount??0)+1;throw Error('SYNTHETIC_SHUTDOWN_FAILURE');}return globalThis.__gPragmaOriginal.call(this,sql,...args);};}
  globalThis.__gExitFault=input.enabled;
`);
try {
  run = await launchInstalled(executable, userData); result.build = run.build;
  let { app, page } = run;
  const company = (await page.evaluate(() => window.publisherAPI.brands.create({ name: '退出恢复合成', companyName: '退出恢复合成有限公司' }))).id;
  await page.evaluate(async id => {
    await window.publisherAPI.workspace.select(id);
    const plan = await window.publisherAPI.operations.createPlanItem({ companyId: id, date: '2026-10-02', topic: '合成退出恢复稿', contentType: 'article', targetPlatforms: ['weibo'] });
    await window.publisherAPI.operations.createDraftFromPlan({ companyId: id, planId: plan.id, title: '合成退出恢复稿', body: '合成退出流程正文。'.repeat(30) });
  }, company);
  await page.reload(); await selectCompany(page, company); await nav(page, '文章库');
  await page.locator('.v11-article-row').filter({ hasText: '合成退出恢复稿' }).getByRole('button', { name: '修改', exact: true }).click();
  const input = page.getByLabel('编辑文章正文'); await input.waitFor();
  const baseline = '关闭失败之前已确认持久化的合成正文。'.repeat(30);
  await input.fill(baseline);
  await waitForIpcCondition(page, ({ company, baseline }) => window.publisherAPI.drafts.listRecovery({ companyId: company }).then(rows => rows.some(row => row.snapshot.body === baseline)), { company, baseline });
  await app.evaluate(fault, { userData, enabled: true }); await app.evaluate(electron => electron.app.quit());
  const failedAt = performance.now(); while (performance.now() - failedAt < 5000) { if (await app.evaluate(new Function('return globalThis.__gExitFaultCount>0;'))) break; await new Promise(done => setTimeout(done, 50)); }
  assert.ok(await app.evaluate(new Function('return globalThis.__gExitFaultCount>0;'))); assert.equal(await input.inputValue(), baseline);
  await app.evaluate(fault, { userData, enabled: false });
  const latest = baseline + '\n失败退出之后立即关闭也必须保留这段编辑。', closed = app.waitForEvent('close', { timeout: 20000 });
  await input.fill(latest); const editedAt = performance.now(); await app.evaluate(electron => electron.app.quit());
  result.quitRequestAfterEditMs = Math.round(performance.now() - editedAt); assert.ok(result.quitRequestAfterEditMs < 350, 'Must exercise the actual autosave debounce interval');
  await closed; await waitForInstalledExit(run); run = null;
  run = await launchInstalled(executable, userData); ({ app, page } = run);
  const recovered = await page.evaluate(id => window.publisherAPI.drafts.listRecovery({ companyId: id }), company);
  assert.ok(recovered.some(row => row.snapshot.body === latest), 'FAILED_SHUTDOWN_MUST_NOT_REUSE_OLD_FLUSH_APPROVAL');
  result.failedShutdownRetainedEditor = true; result.immediateRequitFlushedNewText = true; result.status = 'PASS';
  await closeInstalled(run); run = null; saveEvidence(root, 'failed-exit', result); console.log(JSON.stringify({ status: 'PASS', evidence: join(root, 'failed-exit.json'), quitRequestAfterEditMs: result.quitRequestAfterEditMs }));
} catch (error) {
  result.status = 'FAIL'; result.error = String(error); if (run) { await run.app.evaluate(fault, { userData, enabled: false }).catch(() => {}); await closeInstalled(run).catch(() => {}); }
  saveEvidence(root, 'failed-exit', result); throw error;
}
