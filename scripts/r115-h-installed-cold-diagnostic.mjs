/* global window, document */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchInstalled, closeInstalled, nav, tab } from './r115-h-installed-helpers.mjs';

const executable=resolve(process.argv[2]),baseline=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));
assert.equal(baseline.status,'PASS');assert.deepEqual(baseline.dataset,{articles:3000,images:1000,jobs:10000,executableJobs:0});
const root=resolve('output/r115-h-execution-20261003/cold-diagnostic-'+Date.now()),userData=join(root,'b01-isolated-user-data');
mkdirSync(userData,{recursive:true});cpSync(baseline.userData,userData,{recursive:true});
const result={kind:'INSTALLED_SYNTHETIC_COLD_NAVIGATION_DIAGNOSTIC',samples:[],realPlatformWrites:0,cloudRequests:0};let run;
try{
 for(let sample=1;sample<=5;sample++){
  run=await launchInstalled(executable,userData);const {page,app}=run;
  await page.evaluate(id=>window.publisherAPI.workspace.select(id),baseline.companyIds[0]);
  await page.evaluate(()=>{
   window.__hCold={events:[],longTasks:[]};
   document.addEventListener('click',event=>window.__hCold.events.push({name:event.target?.textContent?.slice(0,30),time:Date.now()}),true);
   new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__hCold.longTasks.push({time:performance.timeOrigin+entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:false});
  });
  await app.evaluate(new Function('electron',`globalThis.__hColdIpc=[];for(const [name,handler] of electron.ipcMain._invokeHandlers){electron.ipcMain._invokeHandlers.set(name,async(...args)=>{const start=Date.now();try{return await handler(...args);}finally{globalThis.__hColdIpc.push({name,start,end:Date.now()});}});}`));
  await nav(page,'图片库');await page.waitForFunction(()=>document.querySelectorAll('.image-asset-card').length===500);
  const startedAt=Date.now();await nav(page,'内容运营');const navReturnedAt=Date.now();await tab(page,'发布看板');const tabReturnedAt=Date.now();
  await page.getByText('共 5000 条 · 第 1 / 100 页',{exact:true}).waitFor();const visibleAt=Date.now();
  await page.evaluate(()=>new Promise(done=>window.requestAnimationFrame(()=>window.requestAnimationFrame(done))));
  const row={sample,startedAt,navMs:navReturnedAt-startedAt,tabMs:tabReturnedAt-navReturnedAt,visibleMs:visibleAt-tabReturnedAt,paintMs:Date.now()-visibleAt,renderer:await page.evaluate(()=>window.__hCold),ipc:await app.evaluate(new Function('return globalThis.__hColdIpc;'))};
  result.samples.push(row);writeFileSync(join(root,'diagnostic.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({sample,navMs:row.navMs,tabMs:row.tabMs,visibleMs:row.visibleMs,paintMs:row.paintMs,longTasks:row.renderer.longTasks.filter(t=>t.time>=startedAt).map(t=>t.duration)}));
  await closeInstalled(run);run=null;
 }
 result.status='PASS_DIAGNOSTIC_COMPLETE';writeFileSync(join(root,'diagnostic.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,root}));
}finally{if(run)await closeInstalled(run);}
