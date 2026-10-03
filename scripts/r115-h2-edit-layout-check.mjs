/* global document,window */
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {earlyInstalled} from './r115-h-early-installed.mjs';
import {nav,selectCompany,mainDatabase} from './r115-h-installed-helpers.mjs';
const root=resolve(`output/r115-h2-execution-20261003/edit-layout-${Date.now()}`),userData=join(root,'b01-isolated-user-data');mkdirSync(root,{recursive:true});
cpSync('output/r115-h1-execution-20261003/visual-fixture-v4/b01-isolated-user-data',userData,{recursive:true,errorOnExist:true});
const run=await earlyInstalled(resolve(process.argv[2]),userData);
const result={kind:'REAL_INSTALLED_READ_ONLY_EDIT_LAYOUT',status:'RUNNING',checks:[],build:run.build,realRemoteWrites:0,cloudRequests:0};
try {
 await selectCompany(run.page,'848b2945-1278-4ed9-ac2b-9a029eb837a2');const frozen=await run.evaluate(mainDatabase,{userData});await nav(run.page,'文章库');
 await run.page.locator('.v11-article-row').first().getByRole('button',{name:'修改',exact:true}).click();await run.page.getByLabel('编辑文章正文').waitFor();
 for(const [width,height,zoom] of [[1440,900,1],[1366,768,1.5]]) {
  await run.evaluate(new Function('electron','s','const w=electron.BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(s.width,s.height);w.webContents.setZoomFactor(s.zoom);'),{width,height,zoom});
  await run.page.waitForFunction(s=>Math.abs(window.innerWidth-s.width/s.zoom)<2,{width,zoom});
  const layout=await run.page.evaluate(()=>{const title=document.querySelector('[aria-label="编辑文章标题"]').closest('label').getBoundingClientRect(),body=document.querySelector('[aria-label="编辑文章正文"]').closest('label').getBoundingClientRect();return{titleHeight:title.height,bodyHeight:body.height,gap:body.top-title.bottom};});
  result.checks.push({width,height,zoom,...layout});await run.page.screenshot({path:join(root,`edit-${width}-${zoom}.png`)});
  assert.ok(layout.titleHeight<95,'Title label must not stretch into blank space');assert.ok(layout.gap<48,'Body must immediately follow title');assert.ok(layout.bodyHeight>=240,'Body retains usable editing space');
 }
 assert.equal((await run.evaluate(mainDatabase,{userData})).frozenHash,frozen.frozenHash);result.status='PASS';
}catch(error){result.status='FAIL';result.error=String(error);throw error;}finally{await run.close();writeFileSync(join(root,'edit-layout.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({root,status:result.status,checks:result.checks}));}
