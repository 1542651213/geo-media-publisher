import { createHash } from 'node:crypto';
import { copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { isAbsolute,join,resolve } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../packages/db/src/index';
import { AccountOnboarding } from '../apps/desktop/src/main/account-onboarding';
const privateRoot=process.argv[2],closedBackupRoot=process.argv[3];
if(!privateRoot||!closedBackupRoot||!isAbsolute(privateRoot)||!isAbsolute(closedBackupRoot)||!process.versions.electron)throw new Error('EXPLICIT_PRIVATE_COPY_ELECTRON_REQUIRED');
if(resolve(privateRoot).toLowerCase().startsWith(resolve('.').toLowerCase())||resolve(privateRoot).toLowerCase().includes('codex-media-publisher'))throw new Error('PRIVATE_AUDIT_DESTINATION_INVALID');
const source=join(closedBackupRoot,'publisher.db'),stage=join(privateRoot,`closed-copy-audit-${Date.now()}`);
if(!existsSync(source))throw new Error('CLOSED_BACKUP_NOT_FOUND');
mkdirSync(stage,{recursive:true});const databaseFile=join(stage,'publisher.db');copyFileSync(source,databaseFile);
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const sourceHash=createHash('sha256').update(readFileSync(source)).digest('hex');
const bindingsHash=(db:Database.Database)=>hash(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='operations_account_company_bindings'").get()?db.prepare('SELECT account_id,company_id,bound_at,updated_at FROM operations_account_company_bindings ORDER BY account_id').all():[]);
const frozen=(db:Database.Database)=>Object.fromEntries(['accounts','publish_jobs','submission_intents','publish_records'].map(table=>[table,hash(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())]));
const closed=new Database(databaseFile,{readonly:true});let before:ReturnType<typeof frozen>,bindings:string;
try{if(closed.pragma('integrity_check',{simple:true})!=='ok'||(closed.pragma('foreign_key_check') as unknown[]).length)throw new Error('PRIVATE_SOURCE_DATABASE_INVALID');before=frozen(closed);bindings=bindingsHash(closed);}finally{closed.close();}
const {repository,db}=openDatabase(databaseFile,resolve('packages/db/migrations'));
try{
  const service=new AccountOnboarding(repository,{invalidateAuthentication:()=>{throw new Error('READONLY_PREVIEW_MUST_NOT_INVALIDATE');}}),accounts=service.preview();
  writeFileSync(join(stage,'private-account-owner-preview.json'),JSON.stringify(accounts,null,2));
  const after=frozen(db),bindingsAfter=bindingsHash(db);
  if(JSON.stringify(before)!==JSON.stringify(after)||bindings!==bindingsAfter||sourceHash!==createHash('sha256').update(readFileSync(source)).digest('hex'))throw new Error('PRIVATE_COPY_FROZEN_DATA_CHANGED');
  const counts=Object.fromEntries(['Confirmed','Unique','Conflict','NoEvidence'].map(state=>[state,accounts.filter(account=>account.evidenceState===state).length]));
  const summary={kind:'PRIVATE_CLOSED_COPY_METADATA_ONLY',sourceClosedCopyUnchanged:true,productionWrites:0,accountCount:accounts.length,unassignedCount:accounts.filter(account=>!account.currentCompanyId).length,evidenceCounts:counts,ownerAssignmentsPerformed:0,privateDetailsOutsideRepository:true,migrations:db.prepare('SELECT COUNT(*) AS count FROM migrations').get(),sqliteIntegrity:db.pragma('integrity_check',{simple:true}),foreignKeyErrors:(db.pragma('foreign_key_check') as unknown[]).length,frozenRowsAndBindingsUnchanged:true};
  writeFileSync(join(stage,'redacted-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{db.pragma('wal_checkpoint(TRUNCATE)');db.close();}
