/* global document,KeyboardEvent */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { earlyInstalled } from './r115-h-early-installed.mjs';

// Real packaged Renderer hook, with local DOM fixtures. No login or remote call.
const root = resolve(`output/r115-h1-execution-20261003/dialog-${Date.now()}`);
const userData = join(root, 'b01-isolated-user-data'); mkdirSync(root, { recursive: true });
cpSync(resolve('output/r115-h1-execution-20261003/visual-fixture-v4/b01-isolated-user-data'), userData, { recursive: true, errorOnExist: true });
let run;
const result = { kind: 'PACKAGED_RENDERER_DOM_FIXTURE', realLoginRequests: 0, realPlatformWrites: 0, checks: [] };
try {
  run = await earlyInstalled(resolve(process.argv[2]), userData);
  const page = run.page;
  await page.evaluate(() => {
    const root = document.createElement('div'); root.id = 'h1-dialog-fixture'; document.body.append(root);
    const trigger = document.createElement('button'); trigger.id = 'fixture-trigger'; trigger.textContent = 'Fixture trigger'; root.append(trigger); trigger.focus();
    const outer = document.createElement('aside'); outer.className = 'drawer'; outer.id = 'fixture-outer';
    outer.innerHTML = '<div class="drawer-head"><h2>Outer fixture</h2><button class="icon-button">×</button></div><button id="fixture-nested-trigger">Open nested fixture</button>';
    outer.querySelector('.icon-button').onclick = () => outer.remove(); root.append(outer);
  });
  await page.waitForFunction(() => document.activeElement?.matches('#fixture-outer .icon-button'));
  await page.locator('#fixture-nested-trigger').focus();
  await page.evaluate(() => {
    const dialog = document.createElement('aside'); dialog.className = 'drawer'; dialog.id = 'fixture-login';
    dialog.innerHTML = '<div class="drawer-head"><h2>Waiting login fixture</h2></div><div class="drawer-footer"><button id="fixture-cancel" data-dialog-close>Cancel</button><button id="fixture-complete">Complete</button></div>';
    dialog.querySelector('#fixture-cancel').onclick = () => dialog.remove(); document.getElementById('h1-dialog-fixture').append(dialog);
  });
  await page.locator('#fixture-login[aria-modal="true"]').waitFor();
  await page.locator('#fixture-cancel').evaluate(el => { el.disabled = true; });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#fixture-login').count(), 1, 'Busy cancellation must stay disabled');
  await page.locator('#fixture-cancel').evaluate(el => { el.disabled = false; });
  result.checks.push('busyEscapeDoesNotCancel');
  await page.keyboard.press('Escape');
  await page.locator('#fixture-login').waitFor({ state: 'detached', timeout: 3000 });
  assert.equal(await page.locator('#fixture-nested-trigger').evaluate(el => document.activeElement === el), true);
  result.checks.push('waitingEscapeUsesExistingCancel', 'nestedFocusReturnsToTrigger');
  await page.evaluate(() => {
    const dialog = document.createElement('aside'); dialog.className = 'drawer'; dialog.id = 'fixture-login';
    dialog.innerHTML = '<h2>Waiting login fixture</h2><button id="fixture-cancel" data-dialog-close>Cancel</button><button id="fixture-complete">Complete</button>';
    document.getElementById('h1-dialog-fixture').append(dialog);
  });
  await page.locator('#fixture-login[aria-labelledby]').waitFor();
  await page.locator('#fixture-complete').focus();
  await page.evaluate(() => {
    const dialog = document.getElementById('fixture-login');
    dialog.innerHTML = '<div class="v114-login-success"><h2>Success login fixture</h2></div><div class="drawer-footer"><button id="fixture-finish" data-dialog-close>Finish</button></div>';
    dialog.querySelector('#fixture-finish').onclick = () => dialog.remove();
  });
  await page.waitForFunction(() => document.activeElement?.id === 'fixture-finish');
  assert.equal(await page.locator('#fixture-login').evaluate(el => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent), 'Success login fixture');
  await page.keyboard.press('Tab'); assert.equal(await page.locator('#fixture-finish').evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Shift+Tab'); assert.equal(await page.locator('#fixture-finish').evaluate(el => document.activeElement === el), true);
  await page.evaluate(() => document.getElementById('fixture-finish').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true })));
  assert.equal(await page.locator('#fixture-login').count(), 1, 'IME Escape must not close');
  await page.keyboard.press('Escape'); await page.locator('#fixture-login').waitFor({ state: 'detached' });
  await page.keyboard.press('Escape'); await page.locator('#fixture-outer').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#fixture-trigger').evaluate(el => document.activeElement === el), true);
  result.checks.push('sameContainerSuccessRefreshesLabelAndFocus', 'tabWrapBothDirections', 'imeEscapeIgnored', 'successEscapeUsesExistingFinish', 'rootFocusRestored');
  result.network = await run.evaluate(() => globalThis.__hNetwork); assert.equal(result.network.loopback, 0);
  result.status = 'PASS';
} catch (error) { result.status = 'FAIL'; result.error = String(error); throw error; }
finally { if (run) await run.close(); writeFileSync(join(root, 'dialog-check.json'), JSON.stringify(result, null, 2)); }
console.log(JSON.stringify({ ...result, evidence: join(root, 'dialog-check.json') }));
