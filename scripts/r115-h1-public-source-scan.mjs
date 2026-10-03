import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repository=resolve('.'),privateRoot=resolve(process.argv[2]??'');
assert.ok(process.argv[2]&&!privateRoot.toLowerCase().startsWith(repository.toLowerCase())&&existsSync(privateRoot));
const git=['-c',`safe.directory=${repository.replaceAll('\\','/')}`];
const gitText=(...args)=>execFileSync('git',[...git,...args],{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const head=gitText('rev-parse','HEAD'),base=gitText('rev-parse','origin/main'),stamp=Date.now();
const root=resolve(`output/r115-h1-execution-20261003/public-scan-${stamp}`),tree=join(root,'public-tree');mkdirSync(tree,{recursive:true});
const archive=join(root,'public-tree.tar');execFileSync('git',[...git,'archive','--format=tar','-o',archive,'HEAD']);execFileSync('tar',['-xf',archive,'-C',tree]);
const outgoing=gitText('rev-list','--objects','origin/main..HEAD').split(/\r?\n/u).map(line=>line.slice(line.indexOf(' ')+1));
const tracked=gitText('ls-tree','-r','--name-only','HEAD').split(/\r?\n/u);
const forbidden=/(?:^|\/)(?:publisher\.db(?:-(?:wal|shm))?|credentials\.enc|Local State|Cookie(?:s)?|StorageState\.json|storage[-_]state\.json|browser-profiles|production-data|\.codex-remote-attachments)(?:\/|$)|\.(?:pfx|p12|pem|secret|db|sqlite)(?:-(?:wal|shm))?$/iu;
const pathFindings=[...new Set([...outgoing,...tracked].filter(path=>forbidden.test(path)))];
// Exact existing public test vectors, independently reviewed with their mock call sites.
// Do not allowlist a directory, a rule, or an arbitrary future annotation.
const reviewed=new Set([
 '9cc642f428477bb4ad9023a9fc19c98205e0933d:tests/official-api-main-controller.test.ts:generic-api-key:21',
 '9cc642f428477bb4ad9023a9fc19c98205e0933d:tests/official-api-main-controller.test.ts:generic-api-key:75',
 '47ec8137c6aca79882fd6d7b5ca7cd18be61c8ab:packages/cms-v2-client/src/private-media.test.ts:generic-api-key:9',
 '30acabdd6ca13e371145dd55153698608c41bfff:packages/cms-v2-client/src/client.test.ts:generic-api-key:7',
 '30acabdd6ca13e371145dd55153698608c41bfff:tests/official-api-connection.test.ts:generic-api-key:10'
]);
const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:repository.replaceAll('\\','/')};
function scan(label,args){
 const report=join(privateRoot,`secret-scan-${stamp}-${label}.json`),log=join(privateRoot,`secret-scan-${stamp}-${label}.log`);
 const result=spawnSync('gitleaks',[...args,'--redact=100','--no-banner','--report-format=json','--report-path='+report],{env,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
 writeFileSync(log,(result.stdout??'')+(result.stderr??''));assert.ok([0,1].includes(result.status),'SECRET_SCAN_EXECUTION_FAILED');
 assert.ok(existsSync(report),'SECRET_SCAN_REPORT_MISSING');return JSON.parse(readFileSync(report,'utf8'));
}
const strictHistory=scan('history-strict',['git',repository,'--ignore-gitleaks-allow','--log-opts=origin/main..HEAD']);
const unreviewed=strictHistory.filter(row=>!reviewed.has(row.Fingerprint));
const currentTree=scan('current-tree',['dir',tree]);
const result={status:pathFindings.length||unreviewed.length||currentTree.length?'FAIL_REVIEW_REQUIRED':'PASS',head,remoteBase:base,outgoingCommits:Number(gitText('rev-list','--count','origin/main..HEAD')),trackedFiles:tracked.length,forbiddenPathCount:pathFindings.length,strictHistoryFindings:strictHistory.length,reviewedPublicTestVectorFindings:strictHistory.length-unreviewed.length,unreviewedHistoryFindings:unreviewed.length,currentTreeFindings:currentTree.length,rawSecretMatchesPrinted:false,privateArtifactsIncluded:false};
writeFileSync(join(privateRoot,`secret-scan-${stamp}-path-findings.json`),JSON.stringify(pathFindings));writeFileSync(join(root,'secret-scan.json'),JSON.stringify(result,null,2));writeFileSync(resolve('output/r115-h1-execution-20261003/latest-public-secret-scan.json'),JSON.stringify({receipt:join(root,'secret-scan.json')}));console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;
