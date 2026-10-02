import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import Database from 'better-sqlite3';
import { createClosedSnapshot, restoreFullSnapshot, validateFullSnapshot } from '../apps/desktop/src/main/backup-restore';

interface Request {mode:'relocate'|'snapshot'|'restore';privateRoot:string;userData:string;destination:string;originalRoot?:string;identity?:{appVersion:string;sourceCommit:string;deliveryId:string;builtAt:string;migrations:string[]};receipt:string}
const input=JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Request;
assert.ok(process.versions.electron, 'ELECTRON_NATIVE_RUNTIME_REQUIRED');
const privateRoot=resolve(input.privateRoot),inside=(p:string)=>resolve(p).toLowerCase().startsWith(privateRoot.toLowerCase()+'\\');
assert.ok(!privateRoot.toLowerCase().startsWith(resolve('.').toLowerCase())&&/r115-h-private-/u.test(privateRoot));
assert.ok(inside(input.userData)&&inside(input.destination)&&inside(input.receipt),'PRIVATE_SCOPE');
if(input.mode==='relocate'){
  assert.ok(input.originalRoot&&existsSync(join(input.userData,'restore-pending-owner-review.json')));
  const db=new Database(join(input.userData,'production-data/publisher.db'));
  try{
    const remap=(path:string):string=>{
      const suffix=relative(input.originalRoot!,path);
      if(suffix.startsWith('..')||resolve(path).toLowerCase()===resolve(input.originalRoot!).toLowerCase())throw Error('PRIVATE_ASSET_OUTSIDE_CLOSED_USERDATA');
      const target=join(input.userData,suffix);assert.ok(inside(target)&&existsSync(target),'PRIVATE_ASSET_COPY_MISSING');return target;
    };
    let remapped=0;
    db.transaction(()=>{
      for(const [table,column] of [['media_assets','file_path'],['brand_assets','file_path'],['video_assets','local_path']]){
        if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
        for(const row of db.prepare(`SELECT id,${column} AS path FROM ${table}`).all() as {id:string;path:string}[]){db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(remap(row.path),row.id);remapped++;}
      }
      for(const row of db.prepare('SELECT id,metadata_json FROM media_assets').all() as {id:string;metadata_json:string}[]){const metadata=JSON.parse(row.metadata_json) as Record<string,unknown>;if(typeof metadata.coverPath==='string'&&metadata.coverPath){metadata.coverPath=remap(metadata.coverPath);db.prepare('UPDATE media_assets SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata),row.id);}}
    })();
    const migrations=(db.prepare('SELECT id FROM migrations ORDER BY id').all() as {id:string}[]).map(r=>r.id);
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal((db.pragma('foreign_key_check') as unknown[]).length,0);
    db.pragma('wal_checkpoint(TRUNCATE)');
    writeFileSync(input.receipt,JSON.stringify({status:'PASS',remappedAssets:remapped,originalMigrations:migrations,originalProductionWrites:0}));
  }finally{db.close();}
}else if(input.mode==='snapshot'){
  assert.ok(input.identity);
  const manifest=createClosedSnapshot(input.userData,input.destination,input.identity,()=>true);
  const before=createHash('sha256').update(readFileSync(join(input.destination,'manifest.json'))).digest('hex');
  assert.equal(validateFullSnapshot(input.destination,input.identity.appVersion).valid,true);
  assert.equal(createHash('sha256').update(readFileSync(join(input.destination,'manifest.json'))).digest('hex'),before);
  writeFileSync(input.receipt,JSON.stringify({status:'PASS',files:manifest.files.length,totalBytes:manifest.totalBytes,migrations:manifest.migrations.length,secureContext:manifest.secureContext?{sameWindowsUserRequired:true,fileCount:manifest.secureContext.files.length,browserProfileRootCount:manifest.secureContext.browserProfileRoots.length}:null}));
}else{
  const result=restoreFullSnapshot(input.userData,input.destination,'1.1.9',[join(process.env.APPDATA!,'codex-media-publisher')]);
  writeFileSync(input.receipt,JSON.stringify({status:'PASS',automaticExecutionDisabled:result.automaticExecutionDisabled}));
}
