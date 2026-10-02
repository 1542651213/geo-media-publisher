import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
const root=resolve(process.argv[2]!),userData=join(root,'pre-h/b01-isolated-user-data');
assert.ok(process.versions.electron&&root.includes('r115-h-private-')&&!root.startsWith(resolve('.')));
const missing=(JSON.parse(readFileSync(join(userData,'h-private-asset-inventory.json'),'utf8')) as {path:string;exists:boolean}[]).filter(r=>!r.exists);
const db=new Database(join(userData,'production-data/publisher.db'),{readonly:true});
try{
  const result=missing.map(ref=>{
    const rows=db.prepare('SELECT id,metadata_json FROM media_assets WHERE file_path=?').all(ref.path) as {id:string;metadata_json:string}[];
    return{fileName:basename(ref.path),rows:rows.map(row=>{const metadata=JSON.parse(row.metadata_json) as Record<string,unknown>;return{idHash:createHash('sha256').update(row.id).digest('hex'),metadataKeys:Object.keys(metadata),sha256:typeof metadata.sha256==='string'?metadata.sha256:null,size:metadata.size??null,articleCovers:(db.prepare('SELECT COUNT(*) n FROM articles WHERE cover_asset_id=?').get(row.id) as {n:number}).n,jobPayloadRefs:(db.prepare('SELECT COUNT(*) n FROM publish_jobs WHERE publish_payload_json LIKE ?').get('%'+row.id+'%') as {n:number}).n};})};
  });
  writeFileSync(join(root,'redacted-missing-asset-analysis.json'),JSON.stringify(result,null,2));
}finally{db.close();}
