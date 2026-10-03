/* global window */
import { cpSync,mkdirSync,writeFileSync } from 'node:fs';
import {resolve,join} from 'node:path';
import {earlyInstalled} from './r115-h-early-installed.mjs';
import {nav,selectCompany} from './r115-h-installed-helpers.mjs';
const root=resolve(`output/r115-h2-execution-20261003/dialog-visual-${Date.now()}`);
mkdirSync(root,{recursive:true});const data=join(root,'b01-isolated-user-data');
cpSync('output/r115-h1-execution-20261003/visual-fixture-v4/b01-isolated-user-data',data,{recursive:true,errorOnExist:true});
const run=await earlyInstalled(resolve(process.argv[2]),data);
try {
 await selectCompany(run.page,'848b2945-1278-4ed9-ac2b-9a029eb837a2');
 await run.evaluate(new Function('electron','unused','const w=electron.BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1440,900);w.webContents.setZoomFactor(1);'),{});
 await nav(run.page,'文章库');await run.page.locator('.v11-article-row').first().getByRole('button',{name:'修改',exact:true}).click();
 await run.page.locator('.drawer').waitFor();await run.page.screenshot({path:join(root,'article-edit.png')});
 const edit=await run.page.locator('.drawer').evaluate(el=>({text:el.innerText,children:[...el.children].map(n=>({tag:n.tagName,cls:n.className,height:n.getBoundingClientRect().height,top:n.getBoundingClientRect().top,display:getComputedStyle(n).display,gap:getComputedStyle(n).gap}))}));
 await run.page.keyboard.press('Escape');await nav(run.page,'发布中心');await run.page.getByRole('button',{name:'选择文章发布',exact:true}).click();await run.page.locator('.drawer').waitFor();await run.page.screenshot({path:join(root,'publish-dialog.png')});
 writeFileSync(join(root,'receipt.json'),JSON.stringify({kind:'REAL_INSTALLED_SYNTHETIC_DIALOG_INSPECTION',build:run.build,edit,realRemoteWrite:0,cloudAI:0},null,2));
 console.log(JSON.stringify({root,status:'PASS'}));
} finally {await run.close();}
