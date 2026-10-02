import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const git=['-c',`safe.directory=${resolve('.').replaceAll('\\','/')}`],start='d00b5d60c75e2d121986f6b1c0679ce64c97e9f1';
const changed=execFileSync('git',[...git,'diff','--name-only',start],{encoding:'utf8'}).trim().split(/\r?\n/u),untracked=execFileSync('git',[...git,'ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/u);
const files=new Set([...changed,...untracked].filter(Boolean));
function walk(directory){if(!existsSync(directory))return;for(const item of readdirSync(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())walk(path);else if(/\.(?:js|css|html|sql|csv)$/iu.test(path))files.add(path);}}
walk('out');walk('packages/db/migrations');files.add('PLATFORMS.csv');
const patterns=[/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/gu,/\bgh[pousr]_[A-Za-z0-9_]{20,}/gu,/\bAKIA[A-Z0-9]{16}\b/gu,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{40,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu];
const suspicious=[];let checked=0;
for(const path of files){if(!existsSync(path))continue;const bytes=readFileSync(path);if(bytes.includes(0))continue;checked++;const content=bytes.toString('utf8');if(patterns.some(pattern=>{pattern.lastIndex=0;return pattern.test(content);})){suspicious.push({path:path.replaceAll('\\','/'),reason:'HIGH_CONFIDENCE_CREDENTIAL_LITERAL'});}}
const result={kind:'G_CHANGED_SOURCE_DOCS_AND_COMPILED_RESOURCES',status:suspicious.length?'FAIL_REVIEW_REQUIRED':'PASS',filesChecked:checked,highConfidenceCredentialLiteralFiles:suspicious.length,findings:suspicious,rawMatchesPrinted:false,scopeIncludesChangedTrackedAndUntrackedFiles:true,compiledResourcesScanned:true,originalCredentialsNeverScannedAsPlaintext:true};mkdirSync('output/r115-g-execution-20261002',{recursive:true});writeFileSync('output/r115-g-execution-20261002/secret-scan.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(suspicious.length)process.exitCode=1;
