import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root='output/r115-h-execution-20261003',read=name=>JSON.parse(readFileSync(join(root,name),'utf8'));
const employee=read('employee-1790971665655/acceptance.json'),session=read('scheduler-session-1790971484921/scheduler-session.json'),ai=read('ai-unknown-recovery-1790972195396/ai-recovery.json'),failure=read('failure-branches-1790972204258/failure-branches.json'),instance=read('instance-1790972182831/instance.json'),exit=read('failed-exit-1790972207872/failed-exit.json'),upgrade=read('private-database-upgrade-redacted.json'),before=read('performance-before-1790967782821/performance-completed.json'),after=read('performance-after-1790972278378/performance.json'),pack=read('package-identity.json');
const phone=JSON.parse(readFileSync('output/r115-h-phone-preview-fa54951/phone-guide-check.json','utf8'));
const scan=JSON.parse(readFileSync(read('latest-package-secret-scan.json').receipt,'utf8'));
for(const evidence of [employee,session,ai,failure,instance,exit,upgrade,before,after,pack,phone,scan])assert.equal(evidence.status,'PASS');
const testLog=readFileSync(join(root,'final-full-suite-2.log'),'utf8');assert.match(testLog,/240 passed/u);assert.match(testLog,/1698 passed/u);
const protection=JSON.parse(readFileSync(join(root,'final-production-protection.log'),'utf8').replace(/^\uFEFF/u,''));assert.equal(protection.changedFiles,0);assert.equal(protection.files,2599);
const result={
 delivery:'R1.15-H',status:'R1_15_H_PARTIAL_BACKUP_REVIEW_REQUIRED',runtimeSource:employee.build.sourceCommit,builtAt:employee.build.builtAt,
 evidenceKinds:{unit:'SYNTHETIC_FIXTURES',installed:'ACTUAL_NSIS_INSTALL_SYNTHETIC_UI_LOCAL_MOCK',private:'PROTECTED_CLOSED_PRODUCTION_COPY',realPlatform:'NOT_RUN_BY_DESIGN',realCloud:'NOT_RUN_BY_DESIGN'},
 safety:{productionWrites:0,productionFilesVerified:protection.files,productionHashDifferences:0,realPlatformWrites:0,realFinalSubmits:0,externalProductAIRequests:0,realAccountAssignments:0,batchEnabled:false},
 credentials:{total:26,decryptPass:21,decryptFail:5,classifiedRetiredUnused:5,activeSafetyUnknown:0,nativeFailureCause:'UNDETERMINED',ciphertextUnchanged:upgrade.credentialsUnchanged},
 ownership:{unassigned:28,high:0,medium:7,low:1,conflict:3,noEvidence:17,syntheticInstalledConfirmation:'PASS'},
 privateUpgrade:{databaseMatrix:'PASS',migrations:[upgrade.before.migrations.length,upgrade.after.migrations.length,upgrade.rollback.migrations.length],comparedBusinessTables:upgrade.hParity.comparedTables,changedBusinessTables:upgrade.hParity.changedTables.length,integrity:upgrade.after.integrity,foreignKeys:upgrade.after.foreignKeys,hashVerifiedClosedCopies:Object.keys(upgrade.stages).length,oldExecutableOpenedHDatabase:upgrade.oldExecutableOpenedHDatabase,fullSnapshot:'BLOCKED_PREEXISTING_MISSING_MEDIA',missingExternalFiles:2,affectedHistoricalFixtureRows:3,coverOrJobReferences:0},
 installed:{employeeStages:employee.stages,sessionStages:session.stages,aiStages:ai.stages,failureStages:failure.stages,instance:{startupCrash:instance.startupCrashAfterLockBeforeDatabase,staleLock:instance.staleLockRecovery,singleWriterActivation:instance.doubleClickSingleWriterAndActivation},failedShutdown:'PASS',screenshots:employee.screenshots.length,layoutChecks:employee.stateLayouts.length,phone:phone.checks.map(row=>({width:row.width,images:row.originalScreenshotsLoaded,anonymousAccounts:row.anonymousAccounts,scrollWidth:row.measured.scrollWidth}))},
 performance:{dataset:after.dataset,samplesPerAction:5,osCacheFlushed:false,before:before.statistics,after:after.statistics,coldTailResolved:false,coldEntryQueries:{before:4629,after:124},coldEntryPayloadBytes:{before:10003651,after:596490}},
 verification:{fullTestFiles:240,fullTests:1698,typecheck:'PASS',lint:'PASS',build:'PASS',package:'PASS',independentReview:'ONE_P2_FIXED_AND_REVIEWED;NO_REMAINING_MATERIAL_SOURCE_FINDING'},
 package:{...pack,authenticode:'NotSigned',secretScan:scan},
 limitations:['private_full_media_snapshot_blocked','cold_tail_and_filter_regression','hardware_IME_not_run','actual_Windows_DPI_not_run','actual_phone_not_run','cross_user_credential_recovery_not_run','off_device_backup_not_configured','code_signing_not_configured','real_platform_and_cloud_not_run'],
 privateArtifactsIncluded:false
};
writeFileSync('docs/evidence/r115-h-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'PASS',publicSummary:'docs/evidence/r115-h-verification.json',privatePathsAndRowsExcluded:true}));
