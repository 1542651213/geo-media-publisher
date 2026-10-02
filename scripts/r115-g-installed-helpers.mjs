/* global window */
import assert from 'node:assert/strict';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

export const evidenceRoot=resolve('output/r115-g-execution-20261002');
export function freshRoot(label){const root=join(evidenceRoot,`${label}-${Date.now()}`);mkdirSync(join(root,'b01-isolated-user-data'),{recursive:true});return root;}
export function isolatedEnv(userData,extra={}){const env={...process.env};for(const key of Object.keys(env))if(/^(?:TOUTIAO_|DOUYIN_|REAL_PUBLISH_|ELECTRON_RUN_AS_NODE)|ACCEPTANCE/iu.test(key))delete env[key];return{...env,GMP_B01_ISOLATED_USER_DATA_DIR:userData,PUBLISHER_DATA_MODE:'production',PUBLISHER_ENV:'production',ELECTRON_RENDERER_URL:'',...extra};}
const installDeny=new Function('electron','input',`
  const require=process.mainModule.require.bind(process.mainModule),http=require('node:http'),https=require('node:https');
  if(electron.app.getPath('userData')!==input.userData)throw new Error('TEST_USERDATA_MISMATCH');
  const allowed=new Set(input.origins),events={blocked:0,loopback:0};globalThis.__r115gNetwork=events;
  const check=(raw)=>{const url=new URL(String(raw));if(allowed.has(url.origin)){events.loopback++;return;}events.blocked++;throw new Error('R115_G_TEST_EXTERNAL_NETWORK_DENIED');};
  const fetch=globalThis.fetch;globalThis.fetch=(url,options)=>{check(url?.url??url);return fetch(url,options);};
  for(const module of [http,https])for(const name of ['request','get']){const original=module[name];module[name]=function(...args){let raw=args[0];if(raw&&typeof raw==='object'&&!(raw instanceof URL))raw=(raw.protocol??(module===https?'https:':'http:'))+'//'+(raw.hostname??raw.host??'localhost')+(raw.port?':'+raw.port:'')+(raw.path??'/');check(raw);return original.apply(this,args);};}
  electron.session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{try{check(details.url);callback({cancel:false});}catch{callback({cancel:true});}});
  let rejected=false;try{globalThis.fetch('https://r115-g-deny-proof.invalid/probe');}catch{rejected=true;}if(!rejected)throw new Error('NETWORK_DENY_NOT_ACTIVE');
  return{packaged:electron.app.isPackaged,userDataMatched:true,denyProof:rejected,electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules};
`);
export const nav=(page,name)=>page.locator('.sidebar .nav-item').filter({hasText:name}).click();
export const tab=(page,name)=>page.getByRole('button',{name,exact:true}).first().click();
export const pickFile=new Function('electron','path',`electron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});`);
export const mainDatabase=new Function('electron','input',`
  const require=process.mainModule.require.bind(process.mainModule),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
  if(electron.app.getPath('userData')!==input.userData||!input.userData.endsWith('b01-isolated-user-data'))throw new Error('TEST_DB_SCOPE_INVALID');
  const Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3')),db=new Database(path.join(input.userData,'production-data','publisher.db'),{readonly:true});
  try{const tables=['accounts','publish_jobs','submission_intents','publish_records'];return{counts:Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT COUNT(*) n FROM '+t).get().n])),frozenHash:crypto.createHash('sha256').update(JSON.stringify(tables.slice(1).map(t=>db.prepare('SELECT * FROM '+t+' ORDER BY id').all()))).digest('hex'),integrity:db.pragma('integrity_check',{simple:true}),foreignKeys:db.pragma('foreign_key_check').length,migrations:db.prepare('SELECT COUNT(*) n FROM migrations').get().n,credentialEncrypted:!fs.existsSync(path.join(input.userData,'production-data','credentials.enc'))||!fs.readFileSync(path.join(input.userData,'production-data','credentials.enc')).includes(input.fixture??'no-key-fixture')};}finally{db.close();}
`);
export async function launchInstalled(executablePath,userData,{origins=[],extra={},identity=true}={}){
  assert.ok(existsSync(executablePath));assert.ok(existsSync(userData));const started=performance.now();
  const app=await electron.launch({executablePath,timeout:30000,env:isolatedEnv(userData,extra)});
  const guard=await app.evaluate(installDeny,{userData,origins});assert.equal(guard.packaged,true);
  const page=await app.firstWindow();page.setDefaultTimeout(12000);
  await page.route('**/*',route=>{const url=route.request().url();if(!/^https?:/u.test(url)||origins.includes(new URL(url).origin))return route.continue();return route.abort('blockedbyclient');});
  await page.getByLabel('当前企业工作区').waitFor();
  const build=identity?await page.evaluate(()=>window.publisherAPI.product.buildIdentity()):null;
  if(build){assert.equal(build.deliveryId,'R1.15-G');assert.equal(build.packaged,true);assert.equal(build.runtimeAppVersion,build.appVersion);assert.match(build.sourceCommit,/^[a-f0-9]{40}$/u);}
  return{app,page,userData,guard,build,startMs:Math.round(performance.now()-started)};
}
export async function screenshot(page,root,name,locator){const path=join(root,name+'.png');await(locator??page).screenshot({path,fullPage:!locator});return path;}
export function saveEvidence(root,name,data){writeFileSync(join(root,name+'.json'),JSON.stringify(data,null,2));}
export async function closeInstalled(run){if(run)await run.app.close();}
