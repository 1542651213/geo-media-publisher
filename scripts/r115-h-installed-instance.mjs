import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { earlyInstalled } from './r115-h-early-installed.mjs';
import { isolatedEnv } from './r115-h-installed-helpers.mjs';
const executable=resolve(process.argv[2]??''),root=resolve('output/r115-h-execution-20261003/instance-'+Date.now()),userData=join(root,'b01-isolated-user-data');
mkdirSync(userData,{recursive:true});
const receipt={kind:'INSTALLED_SYNTHETIC_STARTUP_LOCK_CRASH',realPlatformWrites:0,cloudRequests:0,status:'IN_PROGRESS'};
const fault=new Function('electron','input',`
 const require=process.mainModule.require.bind(process.mainModule),fs=require('node:fs'),path=require('node:path');
 if(process.env.GMP_B01_ISOLATED_USER_DATA_DIR!==input.userData)throw Error('INSTANCE_SCOPE');
 const lock=electron.app.requestSingleInstanceLock.bind(electron.app);electron.app.requestSingleInstanceLock=(...args)=>{const acquired=lock(...args);if(acquired){fs.writeFileSync(path.join(input.userData,'h-lock-acquired.json'),JSON.stringify({acquired:true,databaseExists:fs.existsSync(path.join(input.userData,'production-data/publisher.db'))}));process.exit(53);}return acquired;};
`);
let run;
try{
 let expectedFailure=false;try{run=await earlyInstalled(executable,userData,{beforeMain:fault,fixture:{userData}});}catch{expectedFailure=true;}
 assert.equal(expectedFailure,true);assert.equal(existsSync(join(userData,'production-data/publisher.db')),false);
 assert.deepEqual(JSON.parse(readFileSync(join(userData,'h-lock-acquired.json'),'utf8')),{acquired:true,databaseExists:false});receipt.startupCrashAfterLockBeforeDatabase='PASS';
 run=await earlyInstalled(executable,userData);assert.equal(run.build.deliveryId,'R1.15-H');receipt.staleLockRecovery='PASS';
 await run.evaluate(electron=>{globalThis.__hSecondInstanceCount=0;electron.app.on('second-instance',()=>{globalThis.__hSecondInstanceCount++;});electron.BrowserWindow.getAllWindows()[0].minimize();});
 const launch=()=>new Promise((done,reject)=>{const child=spawn(executable,[],{env:isolatedEnv(userData),windowsHide:true,stdio:'ignore'});const timer=setTimeout(()=>{child.kill();reject(Error('SECOND_INSTANCE_TIMEOUT'));},15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);done(code);});});
 assert.deepEqual(await Promise.all([launch(),launch()]),[0,0]);
 const state=await run.evaluate(electron=>({activated:globalThis.__hSecondInstanceCount,minimized:electron.BrowserWindow.getAllWindows()[0].isMinimized(),network:globalThis.__hNetwork}));
 assert.equal(state.activated,2);assert.equal(state.minimized,false);receipt.doubleClickSingleWriterAndActivation='PASS';receipt.network=state.network;
 await run.close();run=null;receipt.status='PASS';
}catch(error){receipt.status='FAIL';receipt.error=String(error);process.exitCode=1;}finally{if(run)await run.close();writeFileSync(join(root,'instance.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:receipt.status,receipt:join(root,'instance.json'),error:receipt.error}));}
