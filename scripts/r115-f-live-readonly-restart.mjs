/* global window */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright-core";

// Closed-app private copies only. The scheduler is disabled and no Job, prepare, or submit IPC is invoked.
// Credentials remain encrypted in Main; output contains only aggregate platform states/counts.
const executablePath=resolve(process.argv[2]??"output/r115-f-department-install/Geo Media Publisher.exe");
const backup=resolve(process.argv[3]??""); assert.ok(process.argv[3]&&existsSync(join(backup,"publisher.db")));
const root=join(backup,`f-live-readonly-${Date.now()}`),userData=join(root,"b01-isolated-user-data"),data=join(userData,"production-data");mkdirSync(data,{recursive:true});
for(const name of ["publisher.db","credentials.enc"]) copyFileSync(join(backup,name),join(data,name));
const protectedRoot=join(process.env.APPDATA??"","codex-media-publisher/production-data"),hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const protectedBytes=()=>Object.fromEntries(["publisher.db","publisher.db-wal","publisher.db-shm","credentials.enc"].map(name=>[name,existsSync(join(protectedRoot,name))?hash(readFileSync(join(protectedRoot,name))):null]));
const before=protectedBytes();
const counts=new Function("electron","userData",`
  const require=process.mainModule.require.bind(process.mainModule),path=require('node:path');
  const Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3'));
  const db=new Database(path.join(userData,'production-data','publisher.db'),{readonly:true});
  const result=Object.fromEntries(['publish_jobs','submission_intents','publish_records','articles'].map(name=>[name,db.prepare('SELECT COUNT(*) n FROM '+name).get().n]));db.close();return result;
`);
const runs=[];let originalCounts;
for(let run=0;run<2;run++) {
  const app=await electron.launch({executablePath,timeout:30000,env:{...process.env,GMP_B01_ISOLATED_USER_DATA_DIR:userData,TOUTIAO_READONLY_PREFLIGHT:"true",PUBLISHER_DATA_MODE:"production",ELECTRON_RENDERER_URL:"",REAL_PUBLISH_TEST_BATCH_CONFIRMED:"false"}});
  try {
    const page=await app.firstWindow();await page.getByLabel("当前企业工作区").waitFor();
    const start=await app.evaluate(counts,userData);originalCounts??=start;assert.deepEqual(start,originalCounts);
    const companies=await page.evaluate(()=>window.publisherAPI.workspace.companies());
    const snapshots=[];let unassigned=[];
    for(const company of companies) {
      await page.evaluate(id=>window.publisherAPI.workspace.select(id),company.id);
      const expected=await page.evaluate(()=>window.publisherAPI.accounts.list().then(rows=>rows.filter(row=>!row.archivedAt).length));
      const limit=Date.now()+45000;
      let state=[];
      do {state=await page.evaluate(()=>window.publisherAPI.sessions.snapshots());if(state.length>=expected&&state.every(row=>row.state!=="CHECKING"))break;await new Promise(done=>setTimeout(done,500));} while(Date.now()<limit);
      snapshots.push(...state.map(({platformKey,state,identityMatched,reasonCode})=>({platform:platformKey,state,identityMatched,reasonCode})));
      if(!run&&!unassigned.length)unassigned=await page.evaluate(()=>window.publisherAPI.operations.listUnboundAccounts().then(rows=>rows.map(({platformKey})=>({platform:platformKey,state:"UNASSIGNED_COMPANY_NO_PROBE"}))));
    }
    assert.ok(snapshots.every(row=>!["AUTHENTICATED","CONNECTED"].includes(row.state)||row.identityMatched));
    assert.deepEqual(await app.evaluate(counts,userData),originalCounts);
    runs.push({run:run+1,states:snapshots,unassigned,connected:snapshots.filter(row=>["AUTHENTICATED","CONNECTED"].includes(row.state)).length,checking:snapshots.filter(row=>row.state==="CHECKING").length});
  } finally {await app.close();}
}
assert.deepEqual(protectedBytes(),before);
const result={status:"PASS",scope:"PRIVATE_COPY_READ_ONLY_IDENTITY",restartRuns:2,runs,schedulerDisabled:true,jobIntentRecordArticleCountsUnchanged:true,protectedOriginalBytesUnchanged:true,secretsExposed:false,realPlatformPublishCount:0,newFinalSubmitCount:0};
writeFileSync("output/r115-f-execution-20261001/live-readonly-restart.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result));
