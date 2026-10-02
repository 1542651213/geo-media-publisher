import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { z } from "zod";
import { BUILD_IDENTITY } from '../shared/build-identity';
import { RETIRED_MIGRATION_PROVENANCE } from './retired-migration-provenance';

export interface SnapshotIdentity { appVersion: string; sourceCommit: string; deliveryId: string; builtAt?:string; migrations: string[] }
const fileSchema=z.strictObject({path:z.string().min(1).max(1000),bytes:z.number().int().nonnegative().max(2_000_000_000),sha256:z.string().regex(/^[a-f0-9]{64}$/u)});
const manifestSchema=z.strictObject({format:z.literal('GEO_CLOSED_USERDATA_V1'),status:z.enum(['Incomplete','Complete']),createdAt:z.string(),appVersion:z.string(),sourceCommit:z.string(),deliveryId:z.string(),builtAt:z.string().optional(),dataSchemaVersion:z.string().optional(),secureContext:z.strictObject({sameWindowsUserRequired:z.literal(true),files:z.array(z.string()).max(1000),browserProfileRoots:z.array(z.string()).max(1000)}).optional(),migrations:z.array(z.string()).max(1000),sourceRoot:z.string(),files:z.array(fileSchema).max(100000),totalBytes:z.number().nonnegative().max(10_000_000_000)});
export type FullSnapshotManifest=z.infer<typeof manifestSchema>;
const MAX_BYTES=10_000_000_000;
function supportedMigrations():string[]{return BUILD_IDENTITY.migrations.length?BUILD_IDENTITY.migrations:readdirSync(resolve('packages/db/migrations')).filter(name=>name.endsWith('.sql')).sort();}
function assetReferences(db:Database.Database):string[]{
  const paths=(db.prepare('SELECT file_path AS path FROM media_assets UNION SELECT file_path AS path FROM brand_assets UNION SELECT local_path AS path FROM video_assets').all() as {path:string}[]).map(row=>row.path);
  for(const row of db.prepare('SELECT metadata_json FROM media_assets').all() as {metadata_json:string}[]){const metadata=JSON.parse(row.metadata_json) as Record<string,unknown>;if(typeof metadata.coverPath==='string'&&metadata.coverPath)paths.push(metadata.coverPath);}
  return [...new Set(paths)];
}
function digest(path:string):string { const hash=createHash('sha256'),fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024);try{let count:number;while((count=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{closeSync(fd);} }
function canonical(path:string):string { const absolute=resolve(path);if(existsSync(absolute))return realpathSync(absolute);return join(canonical(dirname(absolute)),relative(dirname(absolute),absolute)); }
function within(path:string,root:string):boolean {const p=canonical(path).toLowerCase(),r=canonical(root).toLowerCase();return p===r||p.startsWith(r+'\\')||p.startsWith(r+'/');}
function assertEmpty(path:string):void {if(existsSync(path)&&(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()||readdirSync(path).length))throw new Error('DESTINATION_NOT_EMPTY');}
function entries(root:string):string[]{const result:string[]=[];function scan(dir:string){for(const name of readdirSync(dir)){const path=join(dir,name),stat=lstatSync(path);if(stat.isSymbolicLink())throw new Error('SNAPSHOT_LINK_REFUSED');if(stat.isDirectory())scan(path);else if(stat.isFile())result.push(relative(root,path).replaceAll('\\','/'));else throw new Error('SNAPSHOT_FILE_INVALID');if(result.length>100000)throw new Error('SNAPSHOT_FILE_LIMIT');}}scan(root);return result.sort();}
function safeFile(root:string,path:string):string {if(isAbsolute(path)||path.includes('\\')||path.includes(':')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('SNAPSHOT_PATH_INVALID');const target=join(root,path);if(!within(target,root))throw new Error('SNAPSHOT_PATH_INVALID');let cursor=root;for(const part of path.split('/')){cursor=join(cursor,part);if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw new Error('SNAPSHOT_LINK_REFUSED');}return target;}

/** Caller is Main after DB and all owned browser contexts have closed, or a closed-copy tool. */
export function createClosedSnapshot(sourceRoot:string,destination:string,identity:SnapshotIdentity,sourceIsClosed:()=>boolean):FullSnapshotManifest {
  if(!sourceIsClosed())throw new Error('SOURCE_NOT_CLOSED');
  if(!existsSync(sourceRoot)||lstatSync(sourceRoot).isSymbolicLink()||(within(destination,sourceRoot)||within(sourceRoot,destination)))throw new Error('SNAPSHOT_SOURCE_INVALID');
  assertEmpty(destination);mkdirSync(destination,{recursive:true});
  const names=entries(sourceRoot);
  const manifest:FullSnapshotManifest={format:'GEO_CLOSED_USERDATA_V1',status:'Incomplete',createdAt:new Date().toISOString(),...identity,dataSchemaVersion:[...identity.migrations].sort().at(-1)??'none',secureContext:{sameWindowsUserRequired:true,files:names.filter(path=>path==='Local State'||path==='production-data/credentials.enc'),browserProfileRoots:[...new Set(names.filter(path=>/(?:^|\/)browser-profiles\//u.test(path)).map(path=>path.split('/').slice(0,path.split('/').indexOf('browser-profiles')+2).join('/')))]},sourceRoot:canonical(sourceRoot),files:[],totalBytes:0};
  const manifestPath=join(destination,'manifest.json');
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
  try {
    for(const path of entries(sourceRoot)){
      if(!sourceIsClosed())throw new Error('SOURCE_NOT_CLOSED');
      const source=safeFile(sourceRoot,path),before=statSync(source);manifest.totalBytes+=before.size;
      if(before.size>2_000_000_000||manifest.totalBytes>MAX_BYTES)throw new Error('SNAPSHOT_SIZE_LIMIT');
      const sha256=digest(source),target=safeFile(destination,path);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
      if(digest(target)!==sha256||digest(source)!==sha256||statSync(source).size!==before.size)throw new Error('SOURCE_CHANGED_DURING_BACKUP');
      manifest.files.push({path,bytes:before.size,sha256});
    }
    // Validate all copied bytes while the public manifest still says Incomplete.
    writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    const check=validateFullSnapshot(destination,identity.appVersion,true);
    if(!check.valid)throw new Error(check.message);
    if(!sourceIsClosed())throw new Error('SOURCE_NOT_CLOSED');
    manifest.status='Complete';
    const temporary=join(destination,'manifest.complete.tmp');writeFileSync(temporary,JSON.stringify(manifest,null,2));renameSync(temporary,manifestPath);
    return manifest;
  } catch(error){manifest.status='Incomplete';writeFileSync(manifestPath,JSON.stringify(manifest,null,2));throw error;}
}

export function fullSnapshotSummary(directory:string):{directory:string;status:string;createdAt:string;totalBytes:number} {
  try {
    const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')) as {status?:string;createdAt?:string;totalBytes?:number};
    const statusFile=directory+'.status.json';
    const handoffFinished=!existsSync(statusFile)||(JSON.parse(readFileSync(statusFile,'utf8')) as {status?:string}).status==='Complete';
    return{directory,status:handoffFinished?(manifest.status??'Incomplete'):'Incomplete',createdAt:manifest.createdAt??'',totalBytes:manifest.totalBytes??0};
  }catch{return{directory,status:'Incomplete',createdAt:'',totalBytes:0};}
}

export function validateFullSnapshot(directory:string,appVersion:string,internalCreation=false):{valid:boolean;message:string;manifest?:FullSnapshotManifest} {
  try{
    const root=resolve(directory);if(!existsSync(root)||lstatSync(root).isSymbolicLink())throw new Error('SNAPSHOT_DIRECTORY_INVALID');
    const statusFile=root+'.status.json';
    if(!internalCreation&&existsSync(statusFile)&&(JSON.parse(readFileSync(statusFile,'utf8')) as {status?:string}).status!=='Complete')throw new Error('SNAPSHOT_HANDOFF_NOT_COMPLETE');
    const path=join(root,'manifest.json');if(!existsSync(path)||statSync(path).size>2_000_000)throw new Error('SNAPSHOT_MANIFEST_MISSING_OR_OVERSIZE');
    const manifest=manifestSchema.parse(JSON.parse(readFileSync(path,'utf8')));
    if(manifest.status!=='Complete'&&!internalCreation)throw new Error('SNAPSHOT_INCOMPLETE');
    if(manifest.appVersion!==appVersion)throw new Error('SNAPSHOT_VERSION_INCOMPATIBLE');
    const names=new Set(manifest.files.map(file=>file.path));if(names.size!==manifest.files.length)throw new Error('SNAPSHOT_DUPLICATE_PATH');
    if(!names.has('production-data/publisher.db'))throw new Error('SNAPSHOT_DATABASE_MISSING');
    if(names.has('production-data/credentials.enc')&&(!names.has('Local State')||!existsSync(join(root,'Local State'))))throw new Error('SNAPSHOT_LOCAL_STATE_MISSING');
    let total=0;for(const file of manifest.files){const source=safeFile(root,file.path);if(!existsSync(source)||!statSync(source).isFile())throw new Error('SNAPSHOT_FILE_MISSING');if(statSync(source).size!==file.bytes||digest(source)!==file.sha256)throw new Error('SNAPSHOT_FILE_CHECKSUM_FAILED');total+=file.bytes;}
    if(total!==manifest.totalBytes||total>MAX_BYTES)throw new Error('SNAPSHOT_SIZE_INVALID');
    const unexpected=entries(root).filter(path=>path!=='manifest.json'&&!names.has(path));if(unexpected.length)throw new Error('SNAPSHOT_UNDECLARED_FILE');
    const databaseFile=join(root,'production-data','publisher.db');
    if(statSync(databaseFile).size>256_000_000)throw new Error('SNAPSHOT_DATABASE_VALIDATION_SIZE_LIMIT');
    if(manifest.files.some(file=>file.path==='production-data/publisher.db-wal'&&file.bytes>0))throw new Error('SNAPSHOT_WAL_NOT_CHECKPOINTED');
    // SQLite WAL-mode reads may create sidecars; verify an owned copy, never the archive.
    const validationRoot=mkdtempSync(join(tmpdir(),"geo-backup-check-"));
    const validationFile=join(validationRoot,"publisher.db");copyFileSync(databaseFile,validationFile);
    const db=new Database(validationFile,{readonly:true});
    try{
      if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('SNAPSHOT_DATABASE_INVALID');
      const migrations=(db.prepare("SELECT id FROM migrations ORDER BY id").all() as {id:string}[]).map(row=>row.id);
      if(JSON.stringify(migrations)!==JSON.stringify([...manifest.migrations].sort()))throw new Error('SNAPSHOT_MIGRATIONS_MISMATCH');
      const supported=supportedMigrations(),retired=new Set<string>(RETIRED_MIGRATION_PROVENANCE.map(row=>row.id));
      const current=migrations.filter(name=>!retired.has(name));
      if(current.some((name,index)=>supported[index]!==name))throw new Error('SNAPSHOT_SCHEMA_INCOMPATIBLE');
      for(const path of assetReferences(db)){if(!within(path,manifest.sourceRoot))throw new Error('SNAPSHOT_ASSET_OUTSIDE_SOURCE');const assetPath=relative(manifest.sourceRoot,path).replaceAll('\\','/');if(!names.has(assetPath))throw new Error('SNAPSHOT_ASSET_MISSING');}
    }finally{db.close();}
    return{valid:true,message:'完整快照清单、文件校验、SQLite 完整性和外键通过；凭据仍需同一 Windows 用户的 Main 验证。',manifest};
  }catch(error){return{valid:false,message:error instanceof Error&&!(error instanceof z.ZodError)?error.message:'SNAPSHOT_MANIFEST_INVALID'};}
}

export function restoreFullSnapshot(directory:string,destination:string,appVersion:string,protectedRoots:readonly string[]):{directory:string;automaticExecutionDisabled:true} {
  if(protectedRoots.some(root=>within(destination,root)||within(root,destination))||within(destination,directory)||within(directory,destination))throw new Error('PROTECTED_DESTINATION');
  assertEmpty(destination);const check=validateFullSnapshot(directory,appVersion);if(!check.valid||!check.manifest)throw new Error('SNAPSHOT_INVALID: '+check.message);
  mkdirSync(destination,{recursive:true});
  // Marker goes first: interrupted restore also cannot resume external execution.
  writeFileSync(join(destination,'restore-pending-owner-review.json'),JSON.stringify({automaticExecutionDisabled:true,appVersion,deliveryId:check.manifest.deliveryId,createdAt:new Date().toISOString()}));
  for(const file of check.manifest.files){if(file.path==='restore-pending-owner-review.json')continue;const target=safeFile(destination,file.path);mkdirSync(dirname(target),{recursive:true});copyFileSync(safeFile(directory,file.path),target);if(digest(target)!==file.sha256)throw new Error('RESTORE_CHECKSUM_FAILED');}
  // Remap managed asset references in this new copy. Frozen jobs/intents/records are never rewritten.
  const db=new Database(join(destination,'production-data','publisher.db'));
  try{db.transaction(()=>{
    const remap=(path:string):string=>{if(!within(path,check.manifest!.sourceRoot))throw new Error('RESTORE_ASSET_OUTSIDE_SOURCE');const target=join(destination,relative(check.manifest!.sourceRoot,path));if(!existsSync(target))throw new Error('RESTORE_ASSET_MISSING');return target;};
    for(const [table,column] of [['media_assets','file_path'],['brand_assets','file_path'],['video_assets','local_path']]){
      const assets=db.prepare(`SELECT id,${column} AS path FROM ${table}`).all() as {id:string;path:string}[];
      for(const asset of assets)db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(remap(asset.path),asset.id);
    }
    for(const row of db.prepare('SELECT id,metadata_json FROM media_assets').all() as {id:string;metadata_json:string}[]){const metadata=JSON.parse(row.metadata_json) as Record<string,unknown>;if(typeof metadata.coverPath==='string'&&metadata.coverPath){metadata.coverPath=remap(metadata.coverPath);db.prepare('UPDATE media_assets SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata),row.id);}}
  })();db.pragma('wal_checkpoint(TRUNCATE)');}finally{db.close();}
  return{directory:destination,automaticExecutionDisabled:true};
}
