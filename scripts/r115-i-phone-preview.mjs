/* global document */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { freshProfile, saveEvidence } from './r115-i-installed-helpers.mjs';
const input = resolve(process.argv[2] ?? 'docs/product/r115-i-pilot-preview/index.html');
const profile = freshProfile('offline-phone-viewer'); let context, selected;
for (const channel of ['chrome', 'msedge']) {
 try {
  const browserProfile = join(profile.root, 'viewer-browser'); mkdirSync(browserProfile, { recursive: true });
  context = await chromium.launchPersistentContext(browserProfile, { channel, headless: true, viewport: { width: 412, height: 915 },
   env: { ...process.env, TEMP: join(profile.root, 'temp'), TMP: join(profile.root, 'temp') },
   args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] }); selected = channel; break;
 } catch { /* Supported system browser fallback; never download a runtime. */ }
}
assert.ok(context, 'SYSTEM_BROWSER_REQUIRED_FOR_LOCAL_PREVIEW');
let blocked = 0;
try {
 await context.route('**/*', route => {
  if (/^(?:file|data):/u.test(route.request().url())) return route.continue();
  blocked++; return route.abort('blockedbyclient');
 });
 const page = context.pages()[0]; await page.goto(pathToFileURL(input).href); await page.locator('article').last().waitFor();
 const actual = await page.evaluate(() => ({ images: [...document.images].map(img => ({ complete: img.complete, width: img.naturalWidth, height: img.naturalHeight })),
  bodyWidth: document.body.scrollWidth, viewport: innerWidth, text: document.body.innerText }));
 assert.equal(actual.images.length, 13); assert.ok(actual.images.every(img => img.complete && img.width > 0 && img.height > 0));
 assert.equal(actual.bodyWidth, actual.viewport); assert.match(actual.text, /不是|桌面原图/u);
 assert.equal(blocked, 0, 'Offline guide must not request network resources');
 const target = resolve('docs/product/r115-i-pilot-preview/phone-preview.png');
 await page.screenshot({ path: target, fullPage: false });
 saveEvidence('phone-preview', { status: 'PASS', kind: 'RESPONSIVE_OFFLINE_GUIDE_WITH_ACTUAL_DESKTOP_IMAGES', width: 412, height: 915,
  desktopImages: actual.images.length, allImagesLoaded: true, horizontalPageOverflow: false, networkRequests: 0, systemBrowser: selected, mobileApplicationClaimed: false });
 console.log(JSON.stringify({ status: 'PASS', images: actual.images.length, viewport: '412x915', networkRequests: 0 }));
} finally { await context.close(); }
