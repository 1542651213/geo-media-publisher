/* global window,document */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { earlyInstalled } from './r115-h-early-installed.mjs';
import { selectCompany, mainDatabase } from './r115-h-installed-helpers.mjs';
import { visualRoutes } from './r115-h2-visual-routes.mjs';

const evidence = resolve('output/r115-h2-execution-20261003');
const root = join(evidence, `viewports-${Date.now()}`), userData = join(root, 'b01-isolated-user-data'); mkdirSync(root, { recursive: true });
const fixture = resolve('output/r115-h1-execution-20261003/visual-fixture-v4'); cpSync(join(fixture, 'b01-isolated-user-data'), userData, { recursive: true, errorOnExist: true });
const meta = JSON.parse(readFileSync(join(fixture, 'fixture.json'), 'utf8'));
const result = { kind: 'PACKAGED_SYNTHETIC_VIEWPORT_MATRIX', layouts: [], appZoomTested: true, realWindowsDpi: 'NOT_RUN', realPlatformWrites: 0, realCloudRequests: 0 };
let run;
try {
  run = await earlyInstalled(resolve(process.argv[2]), userData); assert.equal(run.build.deliveryId, 'R1.15-H.2');
  await selectCompany(run.page, meta.companyId); const frozenBefore = await run.evaluate(mainDatabase, { userData });
  for (const [name, open] of visualRoutes(run.page)) {
    await open();
    for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440]]) for (const zoom of [1, 1.25, 1.5]) {
      await run.evaluate(new Function('electron', 'input', 'const w=electron.BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(input.width,input.height);w.webContents.setZoomFactor(input.zoom);'), { width, height, zoom });
      await run.page.waitForFunction(input => Math.abs(window.innerWidth - input.width / input.zoom) <= 2, { width, zoom });
      await run.page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
      const layout = await run.page.evaluate(() => {
        const content = document.querySelector('.content-area');
        const elements = [...document.querySelectorAll('.sidebar button, .sidebar select, .content-area button, .content-area input, .content-area select, .content-area textarea')].filter(el => el.getClientRects().length && !el.disabled);
        const overflow = elements.map(el => ({ text: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 80), x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right })).filter(el => el.x < -2 || el.right > window.innerWidth + 2);
        return { cssWidth: window.innerWidth, cssHeight: window.innerHeight, rootScrollWidth: document.documentElement.scrollWidth, contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth, controls: elements.length, unreachableHorizontally: overflow };
      });
      const entry = { name, width, height, zoom, ...layout }; result.layouts.push(entry);
      writeFileSync(join(root, 'viewports.json'), JSON.stringify(result, null, 2));
      assert.ok(layout.rootScrollWidth <= layout.cssWidth + 2, JSON.stringify(entry));
      assert.ok(layout.contentScrollWidth <= layout.contentWidth + 2, JSON.stringify(entry));
      assert.equal(layout.unreachableHorizontally.length, 0, JSON.stringify(entry));
      if (width === 1366 && zoom === 1.5) await run.page.screenshot({ path: join(root, `${name}-1366-150.png`) });
    }
    console.log(JSON.stringify({ view: name, matrix: '9/9 PASS' }));
  }
  assert.equal(result.layouts.length, 99); assert.equal((await run.evaluate(mainDatabase, { userData })).frozenHash, frozenBefore.frozenHash);
  result.network = await run.evaluate(() => globalThis.__hNetwork); assert.equal(result.network.beforeMain, true); assert.equal(result.network.loopback, 0);
  result.status = 'PASS';
} catch (error) { result.status = 'FAIL'; result.error = String(error).slice(0, 3000); if (run) await run.page.screenshot({ path: join(root, 'failure.png') }).catch(() => {}); throw error; }
finally { if (run) await run.close(); writeFileSync(join(root, 'viewports.json'), JSON.stringify(result, null, 2)); }
console.log(JSON.stringify({ status: result.status, count: result.layouts.length, evidence: join(root, 'viewports.json') }));
