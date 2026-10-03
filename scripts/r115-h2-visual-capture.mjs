/* global window,document */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { earlyInstalled } from './r115-h-early-installed.mjs';
import { nav, tab, selectCompany, mainDatabase } from './r115-h-installed-helpers.mjs';

const phase = process.argv[2];
assert.ok(['before', 'first', 'after'].includes(phase));
const executable = resolve(process.argv[3]);
const root = resolve('output/r115-h2-execution-20261003');
const fixtureRoot = resolve('output/r115-h1-execution-20261003/visual-fixture-v4');
const fixture = join(fixtureRoot, 'b01-isolated-user-data');
const out = join(root, `visual-${phase}-${Date.now()}`), userData = join(out, 'b01-isolated-user-data');
assert.ok(!existsSync(userData), 'Capture must use a fresh copy of the immutable fixture');
mkdirSync(out, { recursive: true });
let run;
assert.ok(existsSync(fixture), 'H1 immutable synthetic fixture required; never reseed it');
cpSync(fixture, userData, { recursive: true, errorOnExist: true });
const meta = JSON.parse(readFileSync(join(fixtureRoot, 'fixture.json'), 'utf8'));
const result = { phase, kind: 'REAL_INSTALLED_SOFTWARE_SYNTHETIC_DATA', realPlatformWrites: 0, realCloudRequests: 0, screenshots: [], layouts: [], companyId: meta.companyId };
try {
  run = await earlyInstalled(executable, userData);
  result.build = run.build; assert.equal(run.build.deliveryId, phase === 'before' ? 'R1.15-H.1' : 'R1.15-H.2');
  const page = run.page; await selectCompany(page, meta.companyId);
  result.frozenBefore = await run.evaluate(mainDatabase, { userData });
  const bounds = { width: 1440, height: 900 };
  await run.evaluate(new Function('electron', 'bounds', `const w=electron.BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(bounds.width,bounds.height);w.webContents.setZoomFactor(1);`), bounds);
  const routes = [
    ['01-home', async () => { await nav(page, '首页'); await tab(page, '今日工作台'); }],
    ['02-ai', async () => { await nav(page, '内容生产'); }],
    ['03-articles', async () => { await nav(page, '文章库'); await page.locator('.v11-article-row').first().waitFor(); }],
    ['04-enterprise', async () => { await nav(page, '内容生产'); await tab(page, '企业 AI 资料'); }],
    ['05-accounts', async () => { await nav(page, '账号中心'); await page.locator('.v11-account-card').first().waitFor(); }],
    ['06-account-ownership', async () => { await nav(page, '内容运营'); await tab(page, 'Owner 处理'); await page.locator('.owner-account-card').first().waitFor(); await page.getByRole('region', { name: '账号归属一页确认' }).evaluate(element => element.scrollIntoView({ block: 'start' })); }],
    ['07-publish', async () => { await nav(page, '发布中心'); }],
    ['08-jobs', async () => { await nav(page, '内容运营'); await tab(page, '发布看板'); await page.getByText('共 1 条 · 第 1 / 1 页', { exact: true }).waitFor(); }],
    ['09-owner', async () => { await nav(page, '内容运营'); await tab(page, 'Owner 处理'); await page.locator('.owner-account-card').first().waitFor(); }],
    ['10-backup', async () => { await nav(page, '高级功能'); await page.locator('.v11-advanced-grid button').filter({ hasText: '数据备份' }).click(); await page.getByRole('heading', { name: '备份与隔离恢复', exact: true }).waitFor(); await page.getByRole('heading', { name: '备份与隔离恢复', exact: true }).evaluate(element => element.closest('.page-title').scrollIntoView({ block: 'start' })); }],
    ['11-settings', async () => { await nav(page, '设置'); await page.getByRole('heading', { name: '关于此版本', exact: true }).waitFor(); }],
  ];
  for (const [name, open] of routes) {
    await open();
    if (!['06-account-ownership', '10-backup'].includes(name)) await page.evaluate(() => { document.querySelector('.content-area').scrollTop = 0; window.scrollTo(0, 0); });
    await page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth }));
    assert.equal(dimensions.width, bounds.width); assert.equal(dimensions.height, bounds.height);
    const file = join(out, `${name}-${phase}.png`); await page.screenshot({ path: file });
    result.screenshots.push({ name, file, ...dimensions });
    console.log(JSON.stringify({ phase, view: name, captured: true }));
  }
  result.frozenAfter = await run.evaluate(mainDatabase, { userData }); assert.equal(result.frozenAfter.frozenHash, result.frozenBefore.frozenHash);
  result.network = await run.evaluate(() => globalThis.__hNetwork);
  assert.equal(result.network.beforeMain, true); assert.equal(result.network.loopback, 0);
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error);
  if (run) await run.page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  if (run) await run.close();
  writeFileSync(join(out, 'capture.json'), JSON.stringify(result, null, 2));
  if (result.status === 'PASS') writeFileSync(join(root, `visual-${phase}-latest.json`), JSON.stringify({ directory: out, receipt: join(out, 'capture.json') }, null, 2));
}
console.log(JSON.stringify({ status: result.status, screenshots: result.screenshots.length, evidence: join(out, 'capture.json') }));
