import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { earlyInstalled } from './r115-h-early-installed.mjs';

const hExe=resolve(process.argv[2]??''),gExe=resolve(process.argv[3]??''),privateRoot=resolve(process.argv[4]??'');
assert.ok(process.argv[4]&&!privateRoot.toLowerCase().startsWith(resolve('.').toLowerCase())&&/r115-h-private-/u.test(privateRoot));
const prior=JSON.parse(readFileSync(join(privateRoot,'latest-credential-audit.json'),'utf8'));
const root=join(privateRoot,'upgrade-'+Date.now()),before=join(root,'pre-h','b01-isolated-user-data'),backup=join(root,'closed-g-backup'),upgraded=join(root,'upgrade','b01-isolated-user-data'),rollback=join(root,'rollback','b01-isolated-user-data');
mkdirSync(before,{recursive:true});cpSync(prior.closed,before,{recursive:true,errorOnExist:true});
writeFileSync(join(before,'restore-pending-owner-review.json'),JSON.stringify({automaticExecutionDisabled:true,reason:'Private H upgrade drill; original not opened'}));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),credentialHash=hash(join(before,'production-data/credentials.enc'));
const result={kind:'FULL_PRODUCTION_PRIVATE_COPY_G_H_UPGRADE_ROLLBACK',productionWrites:0,realPlatformWrites:0,cloudRequests:0,realOwnershipAssignments:0,oldExecutableOpenedHDatabase:false,stages:{},status:'IN_PROGRESS'};
const save=()=>writeFileSync(join(root,'redacted-upgrade.json'),JSON.stringify(result,null,2));
const tool=(mode,userData,destination,identity)=>{
  const receipt=join(root,`${mode}-${Date.now()}.receipt.json`),request=receipt+'.request.json';
  writeFileSync(request,JSON.stringify({mode,privateRoot,userData,destination,originalRoot:join(process.env.APPDATA,'codex-media-publisher'),identity,receipt}));
  const child=spawnSync(resolve('node_modules/electron/dist/electron.exe'),['--import','tsx','scripts/r115-h-private-upgrade-tools.mts',request],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8',timeout:180000});
  assert.equal(child.status,0,'PRIVATE_UPGRADE_TOOL_FAILED_'+mode);assert.ok(existsSync(receipt));return JSON.parse(readFileSync(receipt,'utf8'));
};
const probe=new Function('electron','input',`
 const require=process.mainModule.require.bind(process.mainModule),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
 if(electron.app.getPath('userData')!==input.userData)throw Error('PRIVATE_UPGRADE_SCOPE');
 const Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3')),db=new Database(path.join(input.userData,'production-data/publisher.db'),{readonly:true});
 try{
  const migrations=db.prepare('SELECT id FROM migrations ORDER BY id').all().map(r=>r.id),tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const summaries={};for(const table of tables){if(!/^[a-zA-Z0-9_]+$/u.test(table))throw Error('TABLE_NAME');let rows=JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());for(const root of input.roots){rows=rows.replaceAll(JSON.stringify(root).slice(1,-1),'$USERDATA').replaceAll(root,'$USERDATA');}summaries[table]={count:db.prepare('SELECT COUNT(*) n FROM '+table).get().n,sha256:crypto.createHash('sha256').update(rows).digest('hex')};}
  const raw=JSON.parse(fs.readFileSync(path.join(input.userData,'production-data/credentials.enc'),'utf8'));let decryptPass=0,decryptFail=0;for(const value of Object.values(raw)){try{electron.safeStorage.decryptString(Buffer.from(value,'base64'));decryptPass++;}catch{decryptFail++;}}
  return{migrations,tables:summaries,integrity:db.pragma('integrity_check',{simple:true}),foreignKeys:db.pragma('foreign_key_check').length,decryptPass,decryptFail,credentialCount:Object.keys(raw).length,bindings:db.prepare('SELECT COUNT(*) n FROM operations_account_company_bindings').get().n,network:globalThis.__hNetwork};
 }finally{db.close();}
`);
let run;
async function inspect(executable,userData,delivery){
 run=await earlyInstalled(executable,userData);assert.equal(run.build.deliveryId,delivery);assert.equal(run.build.automaticExecutionDisabled,true);
 const value=await run.evaluate(probe,{userData,roots:[before,upgraded,rollback,join(process.env.APPDATA,'codex-media-publisher')]});value.build=run.build;
 assert.equal(value.integrity,'ok');assert.equal(value.foreignKeys,0);assert.equal(value.decryptPass,21);assert.equal(value.decryptFail,5);assert.equal(value.bindings,0);assert.equal(value.network.loopback,0);
 await run.close();run=null;assert.equal(hash(join(userData,'production-data/credentials.enc')),credentialHash);return value;
}
function parity(a,b){
 const excluded=['migrations','logs','app_settings'];
 const changed=Object.keys(a.tables).filter(table=>!excluded.includes(table)&&JSON.stringify(a.tables[table])!==JSON.stringify(b.tables[table]));
 assert.deepEqual(changed,[],'PRIVATE_CRITICAL_ROW_PARITY_FAILED');return{comparedTables:Object.keys(a.tables).length-excluded.filter(t=>a.tables[t]).length,changedTables:changed,excluded};
}
try{
 result.stages.relocated=tool('relocate',before,join(root,'unused'));save();
 result.before=await inspect(gExe,before,'R1.15-G');save();
 result.stages.snapshot=tool('snapshot',before,backup,{appVersion:result.before.build.appVersion,sourceCommit:result.before.build.sourceCommit,deliveryId:result.before.build.deliveryId,builtAt:result.before.build.builtAt,migrations:result.before.migrations});save();
 result.stages.restoreForH=tool('restore',backup,upgraded);result.after=await inspect(hExe,upgraded,'R1.15-H');save();
 result.hParity=parity(result.before,result.after);assert.deepEqual(result.after.migrations.filter(id=>!result.before.migrations.includes(id)),['0037_jobs_company_page_index.sql']);
 result.restart=await inspect(hExe,upgraded,'R1.15-H');result.restartParity=parity(result.after,result.restart);save();
 result.stages.restoreForRollback=tool('restore',backup,rollback);result.rollback=await inspect(gExe,rollback,'R1.15-G');result.rollbackParity=parity(result.before,result.rollback);assert.deepEqual(result.rollback.migrations,result.before.migrations);
 result.credentialsUnchanged=true;result.status='PASS';save();
 writeFileSync(join(privateRoot,'latest-upgrade.json'),JSON.stringify({root,receipt:join(root,'redacted-upgrade.json'),backup,upgraded,rollback}));
 const publicResult={...result,before:{...result.before,build:{...result.before.build}},originalClosedSnapshotHashMatched:credentialHash===prior.credentialSha256};
 writeFileSync(resolve('output/r115-h-execution-20261003/private-upgrade-redacted.json'),JSON.stringify(publicResult,null,2));
 console.log(JSON.stringify({status:'PASS',migrations:[result.stages.relocated.originalMigrations.length,result.before.migrations.length,result.after.migrations.length,result.rollback.migrations.length],tablesCompared:result.hParity.comparedTables,decryptPass:result.after.decryptPass,decryptFail:result.after.decryptFail,originalProductionWrites:0}));
}catch(error){result.status='FAIL';result.error=String(error).slice(0,2000);save();console.error(JSON.stringify({status:'FAIL',message:result.error,privateEvidenceRetained:true}));process.exitCode=1;}finally{if(run)await run.close();}
