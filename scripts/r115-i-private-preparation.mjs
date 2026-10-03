import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, isAbsolute } from 'node:path';
import { freshProfile, launchPilot, saveEvidence } from './r115-i-installed-helpers.mjs';
const privateRoot = resolve(process.argv[3] ?? '');
assert.ok(process.argv[3] && isAbsolute(process.argv[3]) && existsSync(privateRoot));
assert.ok(!privateRoot.toLowerCase().startsWith(resolve('.').toLowerCase()));
const hRoot = 'D:/GEO_MEDIA_PUBLISHER_FINAL/backup/r115-h-private-20261003';
const closed = join(hRoot, 'upgrade-1790971313236/pre-h/b01-isolated-user-data');
const source = join(closed, 'production-data/publisher.db');
const baseline = JSON.parse(readFileSync(join(privateRoot, 'production-before.json'), 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(sha(source), baseline.files['production-data\\publisher.db'].sha256, 'Protected closed copy must match current production fingerprint');
assert.ok(!existsSync(source + '-wal') || statSync(source + '-wal').size === 0, 'Source must have no uncheckpointed WAL bytes');
const destination = join(privateRoot, 'read-only-owner-preparation-' + Date.now()); mkdirSync(destination);
const databaseFile = join(destination, 'publisher.db'); copyFileSync(source, databaseFile);
const originalHash = sha(databaseFile);
const profile = freshProfile('private-metadata-reader'); let run;
const inspect = new Function('electron', 'input', `
 const require=process.mainModule.require.bind(process.mainModule),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Database=require(path.join(electron.app.getAppPath(),'node_modules/better-sqlite3'));
 if(!input.destination.includes('r115-i-private-')||input.databaseFile!==path.join(input.destination,'publisher.db'))throw Error('PRIVATE_READER_SCOPE_REQUIRED');
 const db=new Database(input.databaseFile,{readonly:true,fileMustExist:true}),quote=value=>'"'+String(value).replaceAll('"','""')+'"';
 try{
  if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length)throw Error('PRIVATE_COPY_INTEGRITY_FAILURE');
  const inventory=JSON.parse(fs.readFileSync(input.inventory,'utf8')),missing=inventory.filter(row=>!row.exists),tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
  const columns=tables.flatMap(table=>db.prepare('PRAGMA table_info('+quote(table)+')').all().map(column=>({table,column:column.name,type:column.type})));
  const missingRows=[];
  for(const file of missing){
   const rows=db.prepare('SELECT id,file_path,metadata_json FROM media_assets WHERE file_path=?').all(file.path);
   for(const row of rows){
    const references=[];
    for(const field of columns){if(field.table==='media_assets')continue;const hits=db.prepare('SELECT COUNT(*) n FROM '+quote(field.table)+' WHERE instr(CAST('+quote(field.column)+' AS TEXT),?)>0 OR instr(CAST('+quote(field.column)+' AS TEXT),?)>0').get(row.id,row.file_path).n;if(hits)references.push({table:field.table,column:field.column,rows:hits});}
    missingRows.push({id:row.id,filePath:row.file_path,metadata:JSON.parse(row.metadata_json),references,jobReferences:db.prepare('SELECT id,status,article_id,account_id,selected_image_asset_id FROM publish_jobs WHERE selected_image_asset_id=?').all(row.id),recordReferences:db.prepare('SELECT id,job_id,status,selected_image_asset_id FROM publish_records WHERE selected_image_asset_id=? OR instr(response_json,?)>0 OR instr(response_json,?)>0').all(row.id,row.id,row.file_path),declaredForeignKeys:tables.flatMap(table=>db.prepare('PRAGMA foreign_key_list('+quote(table)+')').all().filter(key=>key.table==='media_assets').map(key=>({table,from:key.from,to:key.to})))});
   }
  }
  fs.writeFileSync(path.join(input.destination,'missing-media-full-reference-review.json'),JSON.stringify({missingFileCount:missing.length,missingRows,scannedTables:tables,scannedColumns:columns.length,opaqueCredentialsComparedOnlyNoDecoding:true,authenticOriginalDigestRequired:true,retirementExecuted:false},null,2));
  const previews=JSON.parse(fs.readFileSync(input.ownerPreview,'utf8')),accounts=db.prepare('SELECT id,name,platform_account_name,account_alias,platform_key,connection_mode,login_status,external_account_id FROM accounts ORDER BY id').all();
  if(accounts.length!==previews.length||previews.some(row=>!accounts.some(account=>account.id===row.accountId&&account.platform_key===row.platformKey&&(account.platform_account_name||account.account_alias||account.name)===row.accountName)))throw Error('INHERITED_ACCOUNT_METADATA_STALE');
  const bindings=tables.includes('operations_account_company_bindings')?db.prepare('SELECT account_id,company_id FROM operations_account_company_bindings').all():[];
  if(previews.some(row=>(bindings.find(binding=>binding.account_id===row.accountId)?.company_id??null)!==(row.currentCompanyId??null)))throw Error('INHERITED_BINDING_METADATA_STALE');
  const priorityPlatforms=['douyin','toutiao','website'];
  const candidates=previews.filter(row=>priorityPlatforms.includes(row.platformKey)&&!row.archived).map(row=>{const metadata=accounts.find(account=>account.id===row.accountId);return {...row,connectionMode:metadata.connection_mode,storedLoginStatus:metadata.login_status,externalAccountId:metadata.external_account_id,ownerDecisionRequired:true,nicknameIsNotOwnershipProof:true,liveLoginNotPerformed:true,credentialExportIncluded:false,ordinaryUiEntry:row.platformKey==='website'?'账号中心 → 正式官网连接 → Main 安全导入凭据':'内容运营 → Owner 处理 → 历史账号归属；账号中心 → 正常平台登录'};});
  fs.writeFileSync(path.join(input.destination,'first-account-candidates-private.json'),JSON.stringify({scope:'候选证据，不是绑定授权；只选择首批所需账号，其余继续未确认',sourceCurrentClosedCopyMatched:true,legacyRetiredCredentialsMayNotBeReused:true,candidates},null,2));
  const companies=db.prepare("SELECT id,name,company_name FROM brands WHERE company_name LIKE '%康一%' OR name LIKE '%康一%'").all();
  const articleCandidates=companies.flatMap(company=>db.prepare('SELECT id,brand_id,title,body,summary FROM articles WHERE brand_id=? LIMIT 3').all(company.id).map(article=>({...article,ownerContentSelectionRequired:true,originalApprovalStateUnchanged:true})));
  const imageCandidates=db.prepare("SELECT id,brand_id,file_path FROM media_assets WHERE lower(type)='image'").all().filter(row=>!missingRows.some(missing=>missing.id===row.id)&&fs.existsSync(row.file_path)&&companies.some(company=>row.brand_id===company.id)).slice(0,3).map(row=>({id:row.id,path:row.file_path,exists:true,sha256:crypto.createHash('sha256').update(fs.readFileSync(row.file_path)).digest('hex'),ownerSelectionRequired:true}));
  fs.writeFileSync(path.join(input.destination,'business-content-candidates-private.json'),JSON.stringify({companies,articleCandidates,imageCandidates,importPerformed:false,newApprovalGranted:false,status:'OWNER_CONTENT_SELECTION_REQUIRED'},null,2));
  const referenceFields={};for(const row of missingRows)for(const ref of row.references){const key=ref.table+'.'+ref.column;referenceFields[key]=(referenceFields[key]??0)+ref.rows;}
  return {kind:'CURRENT_MATCHING_PROTECTED_CLOSED_COPY_READ_ONLY',status:'PASS',sourceMatchesCurrentProductionFingerprint:true,integrity:'ok',foreignKeyErrors:0,productionBindingTablePresent:tables.includes('operations_account_company_bindings'),accountCount:accounts.length,unassignedCount:previews.filter(row=>!row.currentCompanyId).length,priorityCandidateCount:candidates.length,priorityPlatformCounts:Object.fromEntries(priorityPlatforms.map(key=>[key,candidates.filter(row=>row.platformKey===key).length])),ownershipAssignments:0,missingFileCount:missing.length,missingAssetRows:missingRows.length,allOtherTableReferenceMatches:missingRows.reduce((sum,row)=>sum+row.references.reduce((n,ref)=>n+ref.rows,0),0),referenceFields,referenceTablesScanned:tables.length,referenceColumnsScanned:columns.length,declaredMediaReferenceColumns:[...new Set(missingRows.flatMap(row=>row.declaredForeignKeys.map(key=>key.table+'.'+key.from)))],privateCompanyCandidateCount:companies.length,privateArticleCandidateCount:articleCandidates.length,privateExistingImageCandidateCount:imageCandidates.length,contentSelection:'OWNER_CONTENT_SELECTION_REQUIRED',fullPrivateRestore:'BLOCKED_MISSING_FILES',retirementProposal:'BLOCKED_REFERENCED_PUBLISH_HISTORY',retirementExecuted:false,retiredCredentialMaterialReadOrChanged:false,privateDetailsOutsideRepository:true,productionWrites:0};
 }catch(error){fs.writeFileSync(path.join(input.destination,'private-reader-error.txt'),String(error));throw Error('PRIVATE_REVIEW_FAILED_DETAILS_SAVED_OUTSIDE_REPOSITORY');}finally{db.close();}
`);
try {
 run = await launchPilot(resolve(process.argv[2]), profile.userData);
 const result = await run.evaluate(inspect, { destination, databaseFile, inventory: join(closed, 'h-private-asset-inventory.json'), ownerPreview: join(hRoot, 'h-owner-audit-1790967188625/private-account-owner-preview.json') });
 assert.equal(sha(source), originalHash); assert.equal(sha(databaseFile), originalHash);
 result.closedSourceAndReadonlyCopyUnchanged = true; result.network = await run.evaluate(() => globalThis.__hNetwork); result.privateReviewDirectory = destination;
 saveEvidence('private-preparation-summary', result); writeFileSync(join(destination, 'public-summary.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await run?.close(); }
