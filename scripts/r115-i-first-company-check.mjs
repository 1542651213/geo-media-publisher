/* global window */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { freshProfile, launchPilot, saveEvidence } from './r115-i-installed-helpers.mjs';
const profile = freshProfile('first-company');
const result = { kind: 'ORDINARY_UI_FRESH_FIRST_COMPANY', status: 'RUNNING', productionWrites: 0, platformWrites: 0, cloudRequests: 0 };
let run;
try {
  run = await launchPilot(resolve(process.argv[2]), profile.userData);
  assert.equal((await run.page.evaluate(() => window.publisherAPI.brands.list())).length, 0);
  await run.page.getByRole('button', { name: '创建企业资料', exact: true }).click();
  const create = run.page.getByRole('button', { name: '创建企业', exact: true });
  await create.waitFor({ timeout: 2500 });
  await run.page.getByLabel('新企业名称', { exact: true }).fill('合成试用企业');
  await run.page.getByLabel('新企业简称', { exact: true }).fill('合成试用');
  await create.click();
  await run.page.getByRole('heading', { name: '企业资料', exact: true }).waitFor();
  const companies = await run.page.evaluate(() => window.publisherAPI.brands.list());
  assert.equal(companies.length, 1); assert.equal(companies[0].companyName, '合成试用企业');
  assert.equal((await run.page.evaluate(() => window.publisherAPI.settings.get())).developerMode, false);
  result.status = 'PASS'; result.normalUiCreation = true;
} catch (error) { result.status = 'FAIL'; result.error = String(error); process.exitCode = 1; }
finally { if (run) { result.network = await run.evaluate(() => globalThis.__hNetwork); result.independence = await run.evaluate(() => globalThis.__iIndependent); await run.close(); } saveEvidence('first-company-' + (result.status === 'PASS' ? 'green' : 'red'), result); console.log(JSON.stringify(result)); }
