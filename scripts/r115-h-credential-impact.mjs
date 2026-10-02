import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { classifyCredential } from '../packages/security/src/credential-classification.ts';
import { earlyInstalled } from './r115-h-early-installed.mjs';

const executable = resolve(process.argv[2] ?? ''), privateRoot = resolve(process.argv[3] ?? '');
assert.ok(process.argv[3] && !privateRoot.toLowerCase().startsWith(resolve('.').toLowerCase()));
const location = JSON.parse(readFileSync(join(privateRoot, 'latest-credential-audit.json'), 'utf8'));
const inventory = JSON.parse(readFileSync(join(location.root, 'redacted-inventory.json'), 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const credentialFile = join(location.userData, 'production-data', 'credentials.enc');
assert.equal(hash(credentialFile), location.credentialSha256);
let run;
try {
  run = await earlyInstalled(executable, location.userData); assert.equal(run.build.automaticExecutionDisabled, true);
  const graph = await run.evaluate(new Function('electron', 'input', `
    const require=process.mainModule.require.bind(process.mainModule),fs=require('node:fs'),path=require('node:path');
    if(electron.app.getPath('userData')!==input.userData)throw Error('SCOPE');
    const rows=JSON.parse(fs.readFileSync(path.join(input.root,'private-reference-metadata.json'),'utf8')),Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3')),db=new Database(path.join(input.userData,'production-data','publisher.db'),{readonly:true});
    try{
      const failures=rows.filter(row=>row.public.decrypt==='FAIL'),ids=[...new Set(failures.map(row=>row.private.accountId))];
      if(failures.length!==5||ids.length!==1||!failures.every(row=>row.private.key.startsWith('account:'+ids[0]+':kangyi_website:')))throw Error('EXPECTED_REFERENCE_GRAPH_CHANGED');
      const account=db.prepare('SELECT platform_key,enabled,archived_at FROM accounts WHERE id=?').get(ids[0]);
      const platform=db.prepare('SELECT adapter_status,enabled,integration_mode FROM platforms WHERE platform_key=?').get('kangyi_website');
      const jobs=db.prepare('SELECT status,COUNT(*) count FROM publish_jobs WHERE account_id=? GROUP BY status').all(ids[0]);
      const last=db.prepare('SELECT MAX(created_at) lastKnownJobAt FROM publish_jobs WHERE account_id=?').get(ids[0]);
      const settings=db.prepare('SELECT key,value_json FROM app_settings').all();
      const matchingSettings=settings.filter(row=>row.value_json.includes(ids[0])||failures.some(f=>row.value_json.includes(f.private.key)));const activeSettingReferences=matchingSettings.length;const settingKeys=matchingSettings.map(row=>/^[a-zA-Z0-9:_-]{1,100}$/u.test(row.key)?row.key:'REDACTED');
      const officialOperations=db.prepare('SELECT COUNT(*) n FROM official_api_operations WHERE account_id=?').get(ids[0]).n;
      const intents=db.prepare('SELECT COUNT(*) count,COALESCE(SUM(final_submit_count),0) finalSubmits FROM submission_intents WHERE account_id=?').get(ids[0]);
      return {legacyPlatform:'kangyi_website',failedRecords:failures.length,failedAccounts:ids.length,accountEnabled:account.enabled===1,archived:Boolean(account.archived_at),platform,jobStatuses:jobs,intents,lastKnownJobAt:last.lastKnownJobAt,activeSettingReferences,settingKeys,officialOperations,providerReferences:failures.reduce((n,r)=>n+r.public.providerReferences,0),unresolved:failures[0].public.unresolved,fields:failures.map(r=>r.private.field),currentWebsiteAccountCount:db.prepare("SELECT COUNT(*) n FROM accounts WHERE platform_key='website'").get().n,network:globalThis.__hNetwork};
    }finally{db.close();}
  `), location);
  await run.close(); run = null;
  assert.equal(hash(credentialFile), location.credentialSha256);
  writeFileSync(join(location.root, 'redacted-reference-graph.json'), JSON.stringify(graph, null, 2)); console.log(JSON.stringify(graph));
  assert.equal(graph.activeSettingReferences, 0); assert.equal(graph.officialOperations, 0); assert.equal(graph.providerReferences, 0); assert.equal(graph.unresolved, 0);
  // Legacy DB enabled flags are retained. Runtime adapter registration and product
  // gates, proven by the scope tests, are the authority; do not rewrite history.
  assert.equal(graph.platform.adapter_status, 'not_implemented'); assert.equal(graph.intents.finalSubmits, 0);
  const failures = inventory.records.filter(row => row.decrypt === 'FAIL').map(row => ({ id: row.id, platform: graph.legacyPlatform,
    field: graph.fields[inventory.records.filter(row => row.decrypt === 'FAIL').indexOf(row)],
    ...classifyCredential({ decrypt: 'FAIL', format: row.format, byteLength: row.bytes, failureStage: 'NativeDecrypt', cause: 'NATIVE_DECRYPT_FAILED_CAUSE_UNDETERMINED' },
      { auditComplete: true, currentCapabilityRequired: false, liveConsumerCount: 0, unresolvedOperationCount: graph.unresolved, referenceExists: true, retiredRouteVerified: true }) }));
  const report = { kind: 'PRIVATE_CLOSED_COPY_CREDENTIAL_REFERENCE_CLASSIFICATION', encrypted: inventory.records.length,
    readable: inventory.records.filter(row => row.decrypt === 'PASS').length, failed: failures, graph,
    currentReleaseCredentialsAllReadable: inventory.records.filter(row => row.productOrdinaryOn).every(row => row.decrypt === 'PASS'),
    activeCredentialSafetyUnknown: 0, failedCiphertextUnchanged: true, originalProductionWrites: 0, ownerAssignments: 0,
    cryptoCause: 'The native decrypt cause remains undetermined; legacy release impact is proven independently.',
    sourceGuards: ['Runtime registry has no kangyi_website adapter', 'Product whitelist has no kangyi_website ordinary or batch route', 'OfficialAPI uses exact website account and credential namespace; no alias fallback', 'Normal scheduler requires batch-enabled product policy; all batch remains OFF'] };
  writeFileSync(join(location.root, 'redacted-classification.json'), JSON.stringify(report, null, 2));
  writeFileSync('output/r115-h-execution-20261003/credential-classification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { if (run) await run.close(); }
