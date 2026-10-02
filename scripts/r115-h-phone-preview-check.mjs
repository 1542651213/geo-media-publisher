/* global window,document,getComputedStyle */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
const root = resolve(process.argv[2]), checks = [];
let blocked = 0;
const server = createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : basename(decodeURIComponent(req.url.split('?')[0]));
  if (!/^(?:index\.html|(?:0[1-9]|1[01])-[\w-]+\.png)$/u.test(name) || !existsSync(join(root, name))) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8'); res.end(readFileSync(join(root, name)));
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'] });
  const context = await browser.newContext(); await context.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); blocked++; return route.abort(); });
  const page = await context.newPage();
  for (const width of [390, 760]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(origin); await page.getByText('实测范围与身份', { exact: true }).scrollIntoViewIfNeeded();
    for (const image of await page.locator('img').all()) { await image.scrollIntoViewIfNeeded(); assert.ok(await image.evaluate(node => node.complete && node.naturalWidth > 0)); }
    const measured = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, fontSize: getComputedStyle(document.body).fontSize }));
    assert.ok(measured.scrollWidth <= width + 2); assert.equal(await page.locator('img').count(), 11);
    await page.getByText('展开 28 个匿名待确认项', { exact: true }).click(); assert.equal(await page.locator('.pending li').count(), 28);
    await page.screenshot({ path: join(root, `phone-guide-${width}.png`), fullPage: true }); checks.push({ width, measured, originalScreenshotsLoaded: await page.locator("img").count(), anonymousAccounts: 28 });
  }
  assert.equal(blocked, 0); writeFileSync(join(root, 'phone-guide-check.json'), JSON.stringify({ status: 'PASS', kind: 'PHONE_INDEX_LOCAL_BROWSER', checks, blockedExternalRequests: blocked, realPlatformRequests: 0 }, null, 2)); console.log(JSON.stringify({ status: 'PASS', checks: checks.length, evidence: join(root, 'phone-guide-check.json') }));
} finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }
