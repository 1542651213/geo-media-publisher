import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const install=resolve(process.argv[2]),privateRoot=resolve(process.argv[3]);
assert.ok(existsSync(install)&&existsSync(privateRoot)&&!privateRoot.toLowerCase().startsWith(resolve('.').toLowerCase()));
const root=resolve('output/r115-h2-execution-20261003/package-scan-'+Date.now()),tree=join(root,'extracted');mkdirSync(tree,{recursive:true});
const folder=readdirSync('node_modules/.pnpm').find(name=>name.startsWith('@electron+asar@3.4.1'));assert.ok(folder);
const asar=(await import(pathToFileURL(resolve('node_modules/.pnpm',folder,'node_modules/@electron/asar/lib/asar.js')).href)).default;
const paths=asar.listPackage(join(install,'resources/app.asar'));
const forbidden=/(?:^|[\\/])(?:publisher\.db(?:-(?:wal|shm))?|credentials\.enc|Local State|Cookies?|StorageState\.json|storage[-_]state\.json|browser-profiles|production-data|\.env)(?:[\\/]|$)|\.(?:pfx|p12|pem|secret|db|sqlite)(?:-(?:wal|shm))?$/iu;
const findings=paths.filter(path=>forbidden.test(path));
asar.extractAll(join(install,'resources/app.asar'),tree);
for(const name of readdirSync(join(install,'resources'))){if(name==='app.asar'||name==='elevate.exe')continue;cpSync(join(install,'resources',name),join(tree,'packaged-resources',name),{recursive:true});}
const report=join(privateRoot,'package-scan-'+Date.now()+'.json');
const scan=spawnSync('gitleaks',['dir',tree,'--redact=100','--no-banner','--report-format=json','--report-path='+report],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
writeFileSync(report+'.log',(scan.stdout??'')+(scan.stderr??''));assert.ok([0,1].includes(scan.status),'PACKAGE_SECRET_SCAN_EXECUTION_FAILED');
const matches=JSON.parse(readFileSync(report,'utf8'));
const result={status:matches.length||findings.length?'FAIL_REVIEW_REQUIRED':'PASS',archiveEntries:paths.length,forbiddenPathCount:findings.length,secretFindings:matches.length,rawSecretMatchesPrinted:false,scope:'Entire extracted installed app.asar and packaged resources; installer bytes separately verified identical to the installed package'};
writeFileSync(join(root,'package-secret-scan.json'),JSON.stringify(result,null,2));writeFileSync('output/r115-h2-execution-20261003/latest-package-secret-scan.json',JSON.stringify({receipt:join(root,'package-secret-scan.json'),privateReport:report}));console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;
