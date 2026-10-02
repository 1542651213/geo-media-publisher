import { createHash,randomUUID } from 'node:crypto';
import { copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync } from 'node:fs';
import { dirname,extname,join,resolve } from 'node:path';
import { z } from 'zod';
import { STUDIO_TARGETS } from '@publisher/domain';
import { createAICenterStore,type AppRepository } from '@publisher/db';
import type { ColleaguePackagePreview,ColleaguePackageSelection } from '../shared/colleague-data-package';
import { assertCurrentContentApproved } from './content-review-authority';

const text=z.string().max(100000),list=z.array(z.string().max(2000)).max(100),id=z.string().min(1).max(200);
const companySchema=z.strictObject({name:z.string().min(1).max(200),companyName:z.string().min(1).max(200),description:text,industry:text,officialWebsite:text,mainBusiness:text,serviceRegions:list,advantages:list,contact:z.record(z.string().max(100),z.string().max(1000)),establishedAt:text,address:text,serviceProcess:text,afterSales:text,faq:text,certificates:text,patents:text,equipment:text,cases:text,aiForbiddenClaims:list});
const articleSchema=z.strictObject({title:z.string().min(1).max(2000),body:text,topic:text,keyword:text,city:text,summary:text,tags:list,seoKeywords:list,articleType:z.string().max(100)});
const assetSchema=z.strictObject({sourceId:id,name:z.string().max(300),path:z.string().regex(/^assets\/[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|gif)$/u),bytes:z.number().int().nonnegative().max(30_000_000),sha256:z.string().regex(/^[a-f0-9]{64}$/u),mimeType:z.string().max(100),tags:list});
const templateSchema=z.strictObject({templateId:z.string().regex(/^[a-z0-9_-]{1,80}$/u),name:z.string().max(100),version:z.number().int().positive(),targetPlatform:z.enum(STUDIO_TARGETS).nullable(),contentType:z.enum(['article','case']),systemPrompt:text,userPromptTemplate:text,enabled:z.boolean()});
const factSchema=z.strictObject({category:z.string().max(100),statement:text,source:z.enum(['Manual','Company Profile','Internal Document','Published Website','Verified Case']),sourceDate:z.string().nullable(),expiresAt:z.string().nullable()});
const packageSchema=z.strictObject({format:z.literal('GEO_BUSINESS_PACKAGE_V1'),packageId:z.string().uuid(),appVersion:z.string().max(50),deliveryId:z.string().max(100),createdAt:z.string(),company:companySchema,articles:z.array(articleSchema).max(1000),assets:z.array(assetSchema).max(1000),templates:z.array(templateSchema).max(100),facts:z.array(factSchema).max(1000).default([]),authorizationIncluded:z.literal(false),jobsIncluded:z.literal(false)});
function noLinks(path:string):void{let current=resolve(path);for(;;){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('PACKAGE_LINK_REFUSED');const parent=dirname(current);if(parent===current)return;current=parent;}}
const sha=(bytes:Buffer):string=>createHash('sha256').update(bytes).digest('hex');
function secretPattern(data:unknown):void{if(/(?:Bearer\s+[a-zA-Z0-9._-]{20,}|sk-(?:proj-)?[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----)/u.test(JSON.stringify(data)))throw new Error('PACKAGE_SECRET_PATTERN_REFUSED');}
function preview(data:z.infer<typeof packageSchema>):ColleaguePackagePreview{return{packageId:data.packageId,contentFingerprint:sha(Buffer.from(JSON.stringify(data))),companyName:data.company.companyName,articleCount:data.articles.length,assetCount:data.assets.length,templateCount:data.templates.length,factCount:data.facts.length,authorizationIncluded:false,jobsIncluded:false};}
function pathIn(directory:string,name:string):string{noLinks(directory);const path=join(resolve(directory),name);let current=resolve(directory);for(const part of name.split('/')){if(!part||part==='.'||part==='..'||part.includes('\\')||part.includes(':'))throw new Error('PACKAGE_PATH_INVALID');current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('PACKAGE_LINK_REFUSED');}return path;}
export function exportColleaguePackage(repository:AppRepository,input:ColleaguePackageSelection,destination:string,identity:{appVersion:string;deliveryId:string}):ColleaguePackagePreview{
  const selection=z.strictObject({companyId:id,articleIds:z.array(id).max(1000),assetIds:z.array(id).max(1000),includeTemplates:z.boolean(),includeFacts:z.boolean().default(false)}).parse(input),company=repository.getBrand(selection.companyId);if(!company)throw new Error('PACKAGE_COMPANY_NOT_FOUND');
  if(existsSync(destination))throw new Error('PACKAGE_DESTINATION_EXISTS');
  noLinks(destination);
  const articles=[...new Set(selection.articleIds)].map(articleId=>{const article=repository.getArticle(articleId);if(!article||article.brandId!==company.id)throw new Error('PACKAGE_COMPANY_MISMATCH');assertCurrentContentApproved(repository,articleId);const {title,body,topic,keyword,city,summary,tags,seoKeywords,articleType}=article;return{title,body,topic,keyword,city,summary,tags,seoKeywords,articleType};});
  const assets=[...new Set(selection.assetIds)].map(assetId=>{const asset=repository.getImageAsset(assetId);if(!asset||asset.brandId!==company.id)throw new Error('PACKAGE_COMPANY_MISMATCH');noLinks(asset.filePath);if(!lstatSync(asset.filePath).isFile()||statSync(asset.filePath).size>30_000_000)throw new Error('PACKAGE_ASSET_INVALID');const extension=extname(asset.filePath).slice(1).toLowerCase();if(!['png','jpg','jpeg','webp','gif'].includes(extension))throw new Error('PACKAGE_ASSET_TYPE_INVALID');const bytes=readFileSync(asset.filePath);return{sourceId:asset.id,name:asset.name,path:`assets/${asset.id}.${extension}`,bytes:bytes.length,sha256:sha(bytes),mimeType:asset.mimeType,tags:asset.tags};});
  const {name,companyName,description,mainBusiness,serviceRegions,advantages,contact,establishedAt,address,serviceProcess,afterSales,faq,certificates,patents,equipment,cases,aiForbiddenClaims}=company;
  const allTemplates=createAICenterStore(repository).templates();
  const templates=selection.includeTemplates?allTemplates.filter(item=>!allTemplates.some(other=>other.templateId===item.templateId&&other.version>item.version)):[];
  const facts=selection.includeFacts?repository.db.prepare("SELECT category,statement,source,source_date AS sourceDate,expires_at AS expiresAt FROM operations_facts WHERE company_id=? AND approved_for_ai=1 AND verified_at IS NOT NULL AND verified_at<>'' AND (expires_at IS NULL OR expires_at>?) ORDER BY id LIMIT 1001").all(company.id,new Date().toISOString()):[];
  const data=packageSchema.parse({format:'GEO_BUSINESS_PACKAGE_V1',packageId:randomUUID(),...identity,createdAt:new Date().toISOString(),company:{name,companyName,description,industry:company.industry??'',officialWebsite:company.officialWebsite??'',mainBusiness,serviceRegions,advantages,contact,establishedAt,address,serviceProcess,afterSales,faq,certificates,patents,equipment,cases,aiForbiddenClaims},articles,assets,templates,facts,authorizationIncluded:false,jobsIncluded:false});secretPattern(data);
  if(data.assets.reduce((sum,item)=>sum+item.bytes,0)>200_000_000)throw new Error('PACKAGE_SIZE_LIMIT');mkdirSync(destination,{recursive:true});mkdirSync(join(destination,'assets'));
  for(const asset of data.assets){const source=repository.getImageAsset(asset.sourceId);if(!source)throw new Error('PACKAGE_ASSET_MISSING');copyFileSync(source.filePath,pathIn(destination,asset.path));if(sha(readFileSync(pathIn(destination,asset.path)))!==asset.sha256)throw new Error('PACKAGE_ASSET_CHANGED');}
  const manifest=JSON.stringify(data,null,2);if(Buffer.byteLength(manifest)>20_000_000)throw new Error('PACKAGE_MANIFEST_SIZE_LIMIT');writeFileSync(join(destination,'manifest.json'),manifest);return inspectColleaguePackage(destination);
}
function readPackage(directory:string):z.infer<typeof packageSchema>{const manifest=pathIn(directory,'manifest.json');if(statSync(manifest).size>20_000_000)throw new Error('PACKAGE_MANIFEST_SIZE_LIMIT');const data=packageSchema.parse(JSON.parse(readFileSync(manifest,'utf8')));secretPattern(data);if(data.assets.reduce((sum,item)=>sum+item.bytes,0)>200_000_000)throw new Error('PACKAGE_SIZE_LIMIT');const paths=new Set(data.assets.map(item=>item.path));if(paths.size!==data.assets.length)throw new Error('PACKAGE_DUPLICATE_ASSET');for(const asset of data.assets){const path=pathIn(directory,asset.path);if(statSync(path).size!==asset.bytes||sha(readFileSync(path))!==asset.sha256)throw new Error('PACKAGE_ASSET_CHECKSUM');}for(const name of readdirSync(directory))if(!['manifest.json','assets'].includes(name))throw new Error('PACKAGE_UNDECLARED_FILE');for(const name of readdirSync(join(directory,'assets')))if(!paths.has(`assets/${name}`))throw new Error('PACKAGE_UNDECLARED_FILE');return data;}
export function inspectColleaguePackage(directory:string):ColleaguePackagePreview{return preview(readPackage(directory));}
export function importColleaguePackage(repository:AppRepository,directory:string,managedAssetsRoot:string,expectedFingerprint?:string):ColleaguePackagePreview&{companyId:string}{
  const data=readPackage(directory);if(repository.db.prepare('SELECT package_id FROM colleague_package_imports WHERE package_id=?').get(data.packageId))throw new Error('PACKAGE_ALREADY_IMPORTED');
  if(expectedFingerprint&&preview(data).contentFingerprint!==expectedFingerprint)throw new Error('PACKAGE_PREVIEW_STALE');
  noLinks(managedAssetsRoot);
  const assetRoot=join(managedAssetsRoot,data.packageId),stageMarker={format:'GEO_PACKAGE_IMPORT_STAGE_V1',packageId:data.packageId,contentFingerprint:preview(data).contentFingerprint};
  noLinks(assetRoot);
  if(existsSync(assetRoot)){
    const marker=pathIn(assetRoot,'.import-stage.json');
    if(!existsSync(marker)||JSON.stringify(JSON.parse(readFileSync(marker,'utf8')))!==JSON.stringify(stageMarker))throw new Error('PACKAGE_IMPORT_DESTINATION_EXISTS');
    const declared=new Set(data.assets.map(asset=>asset.path.split('/')[1]!));
    for(const name of readdirSync(assetRoot))if(name!=='.import-stage.json'&&!declared.has(name))throw new Error('PACKAGE_IMPORT_STAGE_UNDECLARED_FILE');
  }else{mkdirSync(assetRoot,{recursive:true});writeFileSync(join(assetRoot,'.import-stage.json'),JSON.stringify(stageMarker),{flag:'wx'});}
  for(const asset of data.assets){const destination=pathIn(assetRoot,asset.path.split('/')[1]!);if(!existsSync(destination))copyFileSync(pathIn(directory,asset.path),destination);if(!statSync(destination).isFile()||statSync(destination).size!==asset.bytes||sha(readFileSync(destination))!==asset.sha256)throw new Error('PACKAGE_ASSET_CHECKSUM');}
  return repository.db.transaction(()=>{
    const company=repository.createBrand(data.company);
    for(const article of data.articles){const inserted=repository.createArticle({...article,brandId:company.id,aiProvider:'manual',aiModel:'colleague-import',generatedAt:data.createdAt,reusePolicy:'once',contentHash:sha(Buffer.from(company.id+'\n'+article.title+'\n'+article.body)),source:'excel_import'});if(!inserted)throw new Error('PACKAGE_ARTICLE_IMPORT_FAILED');}
    for(const asset of data.assets)repository.createMediaAsset({brandId:company.id,type:'image',title:asset.name,filePath:pathIn(assetRoot,asset.path.split('/')[1]!),provider:'local',metadata:{originalFileName:asset.name,mimeType:asset.mimeType,size:asset.bytes,sha256:asset.sha256,tags:asset.tags,universal:false,enabled:true}});
    const store=createAICenterStore(repository);for(const template of data.templates)store.saveTemplate({...template,templateId:`pkg_${data.packageId.replaceAll('-','')}_${sha(Buffer.from(template.templateId)).slice(0,32)}`,version:1});
    const now=new Date().toISOString();
    for(const fact of data.facts)repository.db.prepare("INSERT INTO operations_facts(id,company_id,category,statement,source,source_date,verified_at,expires_at,approved_for_ai,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?,0,'Imported content package; owner review required',?,?)").run(randomUUID(),company.id,fact.category,fact.statement,fact.source,fact.sourceDate,fact.expiresAt,now,now);
    repository.db.prepare('INSERT INTO colleague_package_imports(package_id,company_id,article_count,asset_count,imported_at) VALUES(?,?,?,?,?)').run(data.packageId,company.id,data.articles.length,data.assets.length,new Date().toISOString());
    return{...preview(data),companyId:company.id};
  }).immediate();
}
