import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync,readFileSync,readdirSync,statSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const install=resolve(process.argv[2]??'output/r115-i-isolated-install'),installer=resolve(process.argv[3]??''),source=process.argv[4];
assert.match(source??'',/^[a-f0-9]{40}$/u);assert.ok(existsSync(installer));
const git=['-c',`safe.directory=${resolve('.').replaceAll('\\','/')}`];
execFileSync('git',[...git,'diff','--quiet',source,'--','apps/desktop/src','packages','electron.vite.config.ts','package.json','pnpm-lock.yaml','PLATFORMS.csv']);
const folder=readdirSync('node_modules/.pnpm').find(name=>name.startsWith('@electron+asar@3.4.1'));assert.ok(folder);
const asar=(await import(pathToFileURL(resolve('node_modules/.pnpm',folder,'node_modules/@electron/asar/lib/asar.js')).href)).default;
const archive=join(install,'resources/app.asar'),paths=asar.listPackage(archive),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const mainFiles=readdirSync('out/main',{recursive:true}).filter(name=>/\.(?:js|cjs)$/u.test(name)).map(name=>'out/main/'+name.replaceAll('\\','/'));
for(const path of [...mainFiles,'out/preload/preload.js'])assert.ok(asar.extractFile(archive,path.replaceAll('/','\\')).equals(readFileSync(path)));
assert.ok(paths.some(path=>path.endsWith('closed-snapshot-worker.cjs')));
for(const path of paths.filter(name=>/out[\\/]renderer[\\/]assets[\\/].+\.(js|css)$/u.test(name))){const local=path.replace(/^[\\/]/u,'');assert.ok(asar.extractFile(archive,local).equals(readFileSync(local)));}
const main=mainFiles.map(name=>asar.extractFile(archive,name.replaceAll('/','\\')).toString('utf8')).join('\n');
for(const marker of ['R1.15-I',source,'operations_generation_items','COMPANY_BINDING_MISMATCH','CONTENT_VALIDATION_REQUIRED','restore-pending-owner-review','AI_BUDGET_EXHAUSTED','draft_working_copies'])assert.ok(main.includes(marker),marker);
for(const file of readdirSync('packages/db/migrations'))assert.ok(readFileSync(join(install,'resources/packages/db/migrations',file)).equals(readFileSync(join('packages/db/migrations',file))));
assert.ok(readFileSync('PLATFORMS.csv').equals(readFileSync(join(install,'resources/PLATFORMS.csv'))));
for(const file of ['r115-d-sprint-acceptance.json','r115-c-official-api-acceptance.json','b01-acceptance.json'])assert.equal(existsSync(join(install,'resources',file)),false);
assert.equal(paths.some(path=>/credentials\.enc|publisher\.db|storage[-_]state\.json$|[\\/]\.env$|http-auth\.secret/iu.test(path)),false);
const result={status:'PASS',installerBytes:statSync(installer).size,installerSha256:hash(readFileSync(installer)),installedAppAsarSha256:hash(readFileSync(archive)),packageRuntimeSourceCommit:source,byteParityMainPreloadRendererCSS:true,closedSnapshotWorkerParity:true,migrationAndPlatformResourceParity:true,migrations:readdirSync('packages/db/migrations').filter(n=>n.endsWith('.sql')).length,candidateGrantsAbsent:true,sensitiveResourcesAbsent:true};
mkdirSync('output/r115-i-execution-20261003',{recursive:true});writeFileSync('output/r115-i-execution-20261003/package-identity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

