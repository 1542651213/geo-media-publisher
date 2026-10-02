/* global window, document */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus, totalmem, release } from 'node:os';
import { launchInstalled, closeInstalled, nav, tab, selectCompany } from './r115-g-installed-helpers.mjs';
import { seed } from './r115-h-performance-seed.mjs';

const executable = resolve(process.argv[2] ?? ''), label = process.argv[3] ?? 'before';
assert.ok(['before', 'after'].includes(label));
const root = resolve('output/r115-h-execution-20261003/performance-' + label + '-' + Date.now()), userData = join(root, 'b01-isolated-user-data');
mkdirSync(userData, { recursive: true });
const save = () => writeFileSync(join(root, 'performance.json'), JSON.stringify(result, null, 2));
const result = { kind: 'INSTALLED_SYNTHETIC_JOBS_PROFILE', root, userData, label, samples: [], dataset: null, environment: { windowsRelease: release(), logicalCpus: cpus().length, memoryBytes: totalmem() }, osCacheFlushed: false, instrumentation: 'DB prepare/query measured; mapping+domain remainder; JSON serialization probe; IPC+Renderer+automation settle remainder (not pure React time)', realPlatformWrites: 0, cloudRequests: 0 };
const instrument = new Function('electron', `
 const require=process.mainModule.require.bind(process.mainModule),path=require('node:path'),Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3')),ALS=require('node:async_hooks').AsyncLocalStorage,context=new ALS();
 globalThis.__hProfile=[];const handlers=electron.ipcMain._invokeHandlers;if(!(handlers instanceof Map))throw Error('PROFILE_IPC_PORT_UNAVAILABLE');
 const original=Database.prototype.prepare;Database.prototype.prepare=function(sql,...args){const started=performance.now(),statement=original.call(this,sql,...args),record=context.getStore();if(record){record.prepareMs+=performance.now()-started;record.prepareCount++;}for(const method of ['all','get','run']){const fn=statement[method];statement[method]=function(...values){const row=context.getStore(),start=performance.now();try{return fn.apply(this,values);}finally{if(row){row.queryMs+=performance.now()-start;row.queryCount++;const name=/\\bFROM\\s+([a-z_]+)/iu.exec(sql)?.[1]??'other';row.tables[name]=(row.tables[name]??0)+1;}}};}return statement;};
 for(const [channel,fn] of handlers){handlers.set(channel,(...args)=>{const record={channel,prepareMs:0,prepareCount:0,queryMs:0,queryCount:0,tables:{},mainMs:0,jsonProbeMs:0,payloadBytes:0};const start=performance.now();return context.run(record,async()=>{try{const value=await fn(...args);record.mainMs=performance.now()-start;const probe=performance.now(),json=JSON.stringify(value);record.jsonProbeMs=performance.now()-probe;record.payloadBytes=json?Buffer.byteLength(json):0;return value;}finally{record.completedAt=Date.now();globalThis.__hProfile.push(record);}});});}
 return true;
`);
const collect = new Function('electron', `return {ipc:globalThis.__hProfile,memory:electron.app.getAppMetrics().map(m=>({type:m.type,workingSetKB:m.memory.workingSetSize,peakWorkingSetKB:m.memory.peakWorkingSetSize})),network:globalThis.__r115gNetwork};`);
let run, ids;
const paint = async page => { await page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done)))); };
async function measure(name, action, visible) {
  await run.app.evaluate(() => { globalThis.__hProfile = []; });
  const started = performance.now(); await action(); await visible(); await paint(run.page);
  const elapsedMs = performance.now() - started, endedAt = Date.now(), detail = await run.app.evaluate(collect);
  const lastMainAt = Math.max(0, ...detail.ipc.map(item => item.completedAt));
  return { name, elapsedMs: Math.round(elapsedMs), ipcCallCount: detail.ipc.length, queryCount: detail.ipc.reduce((n, item) => n + item.queryCount, 0), queryMs: detail.ipc.reduce((n, item) => n + item.queryMs, 0), mappingAndDomainMs: detail.ipc.reduce((n, item) => n + Math.max(0, item.mainMs - item.queryMs - item.prepareMs), 0), ipcRendererSettleMs: lastMainAt ? Math.max(0, endedAt - lastMainAt) : Math.round(elapsedMs), ...detail };
}
try {
  if (process.argv[4]) {
    const baseline = JSON.parse(readFileSync(resolve(process.argv[4]), 'utf8')); assert.equal(baseline.status, 'PASS'); assert.equal(baseline.kind, result.kind);
    assert.deepEqual(baseline.dataset, { articles: 3000, images: 1000, jobs: 10000, executableJobs: 0 });
    assert.ok(existsSync(join(baseline.userData, 'h-synthetic-performance-fixture.json')));
    cpSync(baseline.userData, userData, { recursive: true }); ids = baseline.companyIds; result.dataset = baseline.dataset;
  } else {
    run = await launchInstalled(executable, userData, { identity: false });
    const companies = await run.page.evaluate(async () => [await window.publisherAPI.brands.create({ name: '性能甲', companyName: '性能合成甲有限公司' }), await window.publisherAPI.brands.create({ name: '性能乙', companyName: '性能合成乙有限公司' })]); ids = companies.map(company => company.id);
    const accounts = [];
    for (const companyId of ids) { await run.page.evaluate(id => window.publisherAPI.workspace.select(id), companyId); const account = await run.page.evaluate(() => window.publisherAPI.accounts.create({ platformKey: 'weibo', name: '合成停用性能账号' })); await run.page.evaluate(id => window.publisherAPI.accounts.update(id, { enabled: false }), account.id); accounts.push(account.id); }
    await run.page.evaluate(id => window.publisherAPI.workspace.select(id), ids[0]);
    const media = join(userData, 'production-data', 'media'); mkdirSync(media, { recursive: true }); const image = join(media, 'synthetic.png');
    writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rZsAAAAASUVORK5CYII=', 'base64'));
    result.dataset = await run.app.evaluate(seed, { userData, companies: ids, accounts, image });
    writeFileSync(join(userData, 'h-synthetic-performance-fixture.json'), JSON.stringify({ synthetic: true, dataset: result.dataset }));
    await closeInstalled(run); run = null;
  }
  assert.deepEqual(result.dataset, { articles: 3000, images: 1000, jobs: 10000, executableJobs: 0 }); result.companyIds = ids;
  for (let sample = 0; sample < 5; sample++) {
    run = await launchInstalled(executable, userData, { identity: false }); result.build = await run.page.evaluate(() => window.publisherAPI.product.buildIdentity()); assert.equal(result.build.deliveryId, label === 'before' ? 'R1.15-G' : 'R1.15-H');
    await run.page.evaluate(id => window.publisherAPI.workspace.select(id), ids[0]); await run.app.evaluate(instrument);
    const page = run.page, visible = () => page.getByText('共 5000 条 · 第 1 / 100 页', { exact: true }).waitFor();
    await nav(page, '图片库'); await page.waitForFunction(() => document.querySelectorAll('.image-asset-card').length === 500);
    const entry = { sample: sample + 1, processStartMs: run.startMs, measurements: [] }; result.samples.push(entry);
    entry.measurements.push(await measure('cold-process-first-jobs-page', async () => { await nav(page, '内容运营'); await tab(page, '发布看板'); }, visible));
    await nav(page, '文章库'); await page.locator('.v11-article-row').first().waitFor();
    entry.measurements.push(await measure('warm-jobs-page', async () => { await nav(page, '内容运营'); await tab(page, '发布看板'); }, visible));
    entry.measurements.push(await measure('filter', () => page.getByLabel('只看 Owner 处理项').check(), () => page.getByText('当前筛选没有记录', { exact: true }).waitFor()));
    await page.getByLabel('只看 Owner 处理项').uncheck(); await visible();
    entry.measurements.push(await measure('pagination', () => page.getByRole('navigation', { name: '运营记录分页' }).getByRole('button', { name: '下一页', exact: true }).click(), () => page.getByText('共 5000 条 · 第 2 / 100 页', { exact: true }).waitFor()));
    entry.measurements.push(await measure('company-switch', async () => { await selectCompany(page, ids[1]); await tab(page, '发布看板'); }, visible));
    assert.ok(await page.locator('.operations-publish-table .operations-table-row').count() <= 50);
    save(); console.log(JSON.stringify({ sample: sample + 1, timings: entry.measurements.map(item => ({ name: item.name, ms: item.elapsedMs, queries: item.queryCount, ipc: item.ipcCallCount })) }));
    await selectCompany(page, ids[0]); await nav(page, '文章库'); await page.locator('.v11-article-row').first().waitFor();
    await closeInstalled(run); run = null;
  }
  run = await launchInstalled(executable, userData, { identity: false }); result.database = await run.app.evaluate(new Function('electron', 'input', `const require=process.mainModule.require.bind(process.mainModule),path=require('node:path'),Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3'));if(electron.app.getPath('userData')!==input.userData)throw Error('SCOPE');const db=new Database(path.join(input.userData,'production-data','publisher.db'),{readonly:true});try{return{integrity:db.pragma('integrity_check',{simple:true}),foreignKeys:db.pragma('foreign_key_check').length,jobs:db.prepare('SELECT COUNT(*) n FROM publish_jobs').get().n};}finally{db.close();}`), { userData }); await closeInstalled(run); run = null;
  assert.equal(result.database.integrity, 'ok'); assert.equal(result.database.foreignKeys, 0);
  result.statistics = Object.fromEntries(result.samples[0].measurements.map(item => { const values = result.samples.map(sample => sample.measurements.find(m => m.name === item.name).elapsedMs).sort((a, b) => a - b); return [item.name, { samples: values.length, medianMs: values[2], p95NearestRankMs: values[4], minMs: values[0], maxMs: values[4] }]; }));
  result.status = 'PASS'; save(); writeFileSync(resolve('output/r115-h-execution-20261003/latest-performance-' + label + '.json'), JSON.stringify({ receipt: join(root, 'performance.json') }));
  console.log(JSON.stringify({ status: 'PASS', statistics: result.statistics, receipt: join(root, 'performance.json') }));
} catch (error) {
  if (run) { result.failureUi = await run.page.evaluate(() => ({ heading: document.querySelector('.operations-title h2')?.textContent, selected: document.querySelector('[aria-label="当前企业工作区"]')?.value, alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent), operations: document.querySelector('.operations-center')?.textContent?.slice(0, 1500) })); await run.page.screenshot({ path: join(root, 'failure.png') }); }
  result.status = 'FAIL'; result.error = String(error); save(); throw error;
}
finally { if (run) await closeInstalled(run); }
