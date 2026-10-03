import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {launchInstalled,closeInstalled} from './r115-h2-installed-helpers.mjs';
import {earlyInstalled} from './r115-h2-early-installed.mjs';
const root=resolve(`output/r115-h2-execution-20261003/startup-guard-${Date.now()}`),userData=join(root,'b01-isolated-user-data');mkdirSync(userData,{recursive:true});
let run;const result={kind:'REAL_INSTALLED_EMPTY_DATA_STARTUP_CANARY',status:'RUNNING',realRemoteWrite:0,cloudRequests:0};
try {
 run=await launchInstalled(resolve(process.argv[2]),userData);result.guard=run.guard;
 assert.equal(run.guard.beforeMain,true,'Acceptance must block external network before product Main starts');
 const network=await run.app.evaluate(()=>globalThis.__hNetwork);assert.equal(network.beforeMain,true);assert.equal(network.loopback,0);assert.ok(network.blocked>=1);
 result.network=network;result.status='PASS';
 const second=await earlyInstalled(resolve(process.argv[2]),userData,{expectNoWindowExit:true});assert.equal(second.exitCode,0);assert.equal(second.guard.beforeMain,true);result.secondInstance=second;
} catch(error){result.status='FAIL';result.error=String(error);throw error;}finally{await closeInstalled(run);writeFileSync(join(root,'startup-guard.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({root,status:result.status}));}
