import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, lstatSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
const privateRoot=resolve(process.argv[2]??"");
if(!process.argv[2]||privateRoot.startsWith(resolve('.')))throw Error('Repository-private evidence forbidden');
mkdirSync(privateRoot,{recursive:true});
const root=join(process.env.APPDATA??'', 'codex-media-publisher');
const files={};
async function scan(dir){if(!existsSync(dir))return;for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name),stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('Protected reparse point needs manual verification');if(item.isDirectory())await scan(path);else {const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);files[relative(root,path)]={bytes:stat.size,sha256:hash.digest('hex')};}}}
await scan(root);
const baseline=join(privateRoot,'production-before.json');
if(!existsSync(baseline)){writeFileSync(baseline,JSON.stringify({createdAt:new Date().toISOString(),files},null,2));console.log(JSON.stringify({phase:'before',files:Object.keys(files).length,rawManifestOutsideRepository:true}));}
else {const previous=JSON.parse(readFileSync(baseline,'utf8')).files;const keys=new Set([...Object.keys(files),...Object.keys(previous)]);const changed=[...keys].filter(key=>JSON.stringify(previous[key])!==JSON.stringify(files[key]));writeFileSync(join(privateRoot,'production-after.json'),JSON.stringify({createdAt:new Date().toISOString(),files,changed},null,2));console.log(JSON.stringify({phase:'after',files:Object.keys(files).length,changedFiles:changed.length,comparison:changed.length?'DIFFERENCE_REQUIRES_EXPLANATION':'PASS_BYTES_UNCHANGED'}));}
