import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { earlyInstalled } from './r115-h-early-installed.mjs';

const executable = resolve(process.argv[2] ?? ''), privateRoot = resolve(process.argv[3] ?? '');
assert.ok(process.argv[3] && isAbsolute(process.argv[3]) && !privateRoot.toLowerCase().startsWith(resolve('.').toLowerCase()), 'EXTERNAL_PRIVATE_ROOT_REQUIRED');
const baseline = JSON.parse(readFileSync(join(privateRoot, 'production-before.json'), 'utf8')).files;
const source = join(process.env.APPDATA, 'codex-media-publisher'), root = join(privateRoot, 'credential-audit-' + Date.now());
const closed = join(root, 'closed-pre-h-full-userdata'), userData = join(root, 'b01-isolated-user-data');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function inventory(directory, base = directory, files = []) { for (const name of readdirSync(directory)) { const path = join(directory, name), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false, 'REPARSE_NOT_ALLOWED'); if (stat.isDirectory()) inventory(path, base, files); else files.push(relative(base, path)); } return files; }
const wal = join(source, 'production-data', 'publisher.db-wal'); assert.ok(!existsSync(wal) || readFileSync(wal).length === 0, 'SOURCE_MUST_BE_CLOSED');
assert.deepEqual(inventory(source).sort(), Object.keys(baseline).sort());
assert.ok(Object.entries(baseline).every(([name, entry]) => hash(join(source, name)) === entry.sha256), 'SOURCE_BASELINE_CHANGED');
mkdirSync(root); cpSync(source, closed, { recursive: true, errorOnExist: true });
assert.ok(Object.entries(baseline).every(([name, entry]) => hash(join(closed, name)) === entry.sha256));
mkdirSync(userData); writeFileSync(join(userData, 'restore-pending-owner-review.json'), JSON.stringify({ format: 'GEO_ISOLATED_RESTORE_V1', automaticExecutionDisabled: true, reason: 'H closed private copy audit' }));
cpSync(closed, userData, { recursive: true });
const credentialFile = join(userData, 'production-data', 'credentials.enc'), before = hash(credentialFile);
const audit = new Function('electron', 'input', `
 const require=process.mainModule.require.bind(process.mainModule),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
 if(electron.app.getPath('userData')!==input.userData)throw Error('PRIVATE_SCOPE');
 const Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3')),db=new Database(path.join(input.userData,'production-data','publisher.db'),{readonly:true});
 try{
 const raw=JSON.parse(fs.readFileSync(path.join(input.userData,'production-data','credentials.enc'),'utf8'));
 const accounts=db.prepare('SELECT id,platform_key,enabled,archived_at FROM accounts').all(),profiles=db.prepare('SELECT id,provider,credential_ref,enabled,is_default,is_fallback FROM ai_provider_profiles').all();
 const platforms=['douyin','website','toutiao','sohu_media','weibo','xiaohongshu','netease_media','baijiahao','lieju','cnblogs'];
 const result=[];let index=0;
 for(const [key,value] of Object.entries(raw)){
  index++;const id='C'+String(index).padStart(2,'0');let kind='Unrecognized',accountId=null,platformKey=null,field=null;
  let match=/^session:([^:]+):(.+)$/u.exec(key);if(match){kind='BrowserSession';platformKey=match[1];accountId=match[2];}
  match=/^account:([^:]+):([^:]+):(.+)$/u.exec(key);if(match){kind='AccountField';accountId=match[1];platformKey=match[2];field=match[3];}
  match=/^oauth:([^:]+):([^:]+):(token|pending)$/u.exec(key);if(match){kind='OAuth';platformKey=match[1];accountId=match[2];}
  match=/^toutiao:article-api:credential-bundle:(.+)$/u.exec(key);if(match){kind='ToutiaoArticleBundle';platformKey='toutiao';accountId=match[1];}
  if(key==='ai:apiKey')kind='LegacyGlobalAI';else if(key==='image:apiKey')kind='LegacyImageAI';else if(/^ai:(provider|legacy):/u.test(key))kind='ProviderAI';
  const account=accounts.find(row=>row.id===accountId),providerRefs=profiles.filter(row=>row.credential_ref===key),binding=account?db.prepare('SELECT company_id FROM operations_account_company_bindings WHERE account_id=?').get(account.id):null;
  const counts=account?{jobs:db.prepare('SELECT COUNT(*) n FROM publish_jobs WHERE account_id=?').get(account.id).n,records:db.prepare('SELECT COUNT(*) n FROM publish_records WHERE account_id=?').get(account.id).n,unresolved:db.prepare("SELECT COUNT(*) n FROM publish_jobs WHERE account_id=? AND status IN ('Pending','Scheduled','Retry','Running','Preparing','ReadyToSubmit','Submitting','Submitted','Publishing','NeedsReconciliation','Unknown')").get(account.id).n}:{jobs:0,records:0,unresolved:0};
  const bytes=typeof value==='string'?Buffer.from(value,'base64'):Buffer.alloc(0),validBase64=typeof value==='string'&&value.length>0&&bytes.toString('base64')===value;
  let decrypt='FAIL';try{if(typeof value==='string'&&typeof electron.safeStorage.decryptString(bytes)==='string')decrypt='PASS';}catch{/* Never return native message or plaintext. */}
  const format=bytes.subarray(0,3).equals(Buffer.from('v10'))?'ElectronV10':bytes.subarray(0,3).equals(Buffer.from('v11'))?'ElectronV11':'Other';
  const row={id,kind,platform:platforms.includes(platformKey)?platformKey:platformKey?'OTHER':null,decrypt,format,validBase64,bytes:bytes.length,metadataType:typeof value,accountExists:Boolean(account),accountPlatformMatches:Boolean(account&&account.platform_key===platformKey),accountEnabled:account?.enabled===1,accountArchived:Boolean(account?.archived_at),companyAssigned:Boolean(binding),productOrdinaryOn:['douyin','website','toutiao'].includes(platformKey),providerReferences:providerRefs.length,enabledProviderReferences:providerRefs.filter(p=>p.enabled===1).length,defaultProviderReferences:providerRefs.filter(p=>p.is_default===1).length,...counts};
  result.push({public:row,private:{key,accountId,field,companyId:binding?.company_id??null,providerIds:providerRefs.map(p=>p.id),ciphertextSha256:crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')}});
 }
 const roundtrip='H synthetic context probe';let currentContextRoundtrip=false;try{currentContextRoundtrip=electron.safeStorage.decryptString(electron.safeStorage.encryptString(roundtrip))===roundtrip;}catch{}
 fs.writeFileSync(path.join(input.root,'private-reference-metadata.json'),JSON.stringify(result,null,2),{mode:0o600});
 return{records:result.map(r=>r.public),encryptionAvailable:electron.safeStorage.isEncryptionAvailable(),currentContextRoundtrip,localStatePresent:fs.existsSync(path.join(input.userData,'Local State')),accountCount:accounts.length,bindingCount:db.prepare('SELECT COUNT(*) n FROM operations_account_company_bindings').get().n,integrity:db.pragma('integrity_check',{simple:true}),foreignKeys:db.pragma('foreign_key_check').length,migrations:db.prepare('SELECT id FROM migrations ORDER BY id').all().map(r=>r.id),network:globalThis.__hNetwork,plaintextReturned:false};
 }finally{db.close();}
`);
let run;
try {
  run = await earlyInstalled(executable, userData); assert.equal(run.build.automaticExecutionDisabled, true);
  const report = await run.evaluate(audit, { userData, root }); await run.close(); run = null;
  assert.equal(hash(credentialFile), before, 'PRIVATE_CREDENTIAL_CHANGED'); assert.ok(Object.entries(baseline).every(([name, entry]) => hash(join(source, name)) === entry.sha256));
  const summary = { ...report, originalFilesUnchanged: Object.keys(baseline).length, closedCopyHashesVerified: true, privateCredentialsUnchanged: true, productionWrites: 0, realPlatformWrites: 0, cloudRequests: 0, ownerAssignments: 0 };
  writeFileSync(join(root, 'redacted-inventory.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(privateRoot, 'latest-credential-audit.json'), JSON.stringify({ root, closed, userData, credentialSha256: before }));
  console.log(JSON.stringify(summary));
} finally { if (run) await run.close(); }
