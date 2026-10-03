/* global document,window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
const root = resolve(process.argv[2]); let external = 0;
const server = createServer((req, res) => { const name = req.url === '/' ? 'index.html' : req.url.slice(1); if (!/^(?:index\.html|\d{2}-[a-z-]+-(?:before|after)\.png)$/u.test(name)) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : 'text/html;charset=utf-8'); res.end(readFileSync(join(root, name))); });
await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser; const result = { kind: 'PHONE_BROWSER_PREVIEW', layouts: [] };
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [390, 760]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    await page.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); external++; return route.abort(); });
    await page.goto(origin + '/');
    for (const img of await page.locator('img').all()) { await img.scrollIntoViewIfNeeded(); await img.evaluate(el => el.loading = 'eager'); }
    await page.waitForFunction(() => [...document.images].length === 22 && [...document.images].every(img => img.complete && img.naturalWidth === 1440));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.evaluate(() => Number.parseFloat(window.getComputedStyle(document.body).fontSize)), 17);
    await page.getByRole('button', { name: '只看 AFTER', exact: true }).click(); assert.equal(await page.locator('figure:visible').count(), 11);
    await page.getByRole('button', { name: '只看 BEFORE', exact: true }).click(); assert.equal(await page.locator('figure:visible').count(), 11);
    await page.getByRole('button', { name: '并排 / 上下对比', exact: true }).click(); assert.equal(await page.locator('figure:visible').count(), 22);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(root, `phone-${width}.png`), fullPage: false });
    result.layouts.push({ width, imagesLoaded: 22, beforeAfterToggle: 'PASS', horizontalOverflow: false, bodyFontPx: 17 }); await page.close();
  }
  assert.equal(external, 0); result.externalRequests = external; result.status = 'PASS';
} catch (error) { result.status = 'FAIL'; result.error = String(error); throw error; }
finally { await browser?.close(); await new Promise(done => server.close(done)); writeFileSync(join(root, 'phone-check.json'), JSON.stringify(result, null, 2)); }
console.log(JSON.stringify(result));
