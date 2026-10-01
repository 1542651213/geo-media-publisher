import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const root="output/r115-f-execution-20261001", read=name=>JSON.parse(readFileSync(`${root}/${name}`,"utf8"));
const packageIdentity=read("package-identity.json"), installed=read("installed-smoke-result.json"), migration=read("migration-copy-check.json"), browser=read("browser-restore-smoke.json"), live=read("live-readonly-restart.json");
for(const receipt of [packageIdentity,installed,migration,browser,live]) assert.equal(receipt.status,"PASS");
assert.equal(live.restartRuns,2); assert.equal(live.encryptionContextCopied,true);
assert.equal(live.protectedOriginalBytesUnchanged,true); assert.equal(live.jobIntentRecordArticleCountsUnchanged,true);
for(const run of live.runs) { assert.equal(run.checking,0); assert.equal(run.states.filter(row=>row.platform==="website"&&row.state==="CONNECTED"&&row.identityMatched).length,2); }
assert.equal(installed.realPlatformPublishCount,0); assert.equal(installed.newFinalSubmitCount,0);
assert.equal(installed.loopbackGenerations,6); assert.equal(installed.approvedFactRequests,6);
const source=packageIdentity.packageRuntimeSourceCommit;
execFileSync("git",["diff","--quiet",source,"--","apps/desktop/src","packages"]);
const testLog=readFileSync(`${root}/full-tests-final.txt`,"utf8"),files=/Test Files\s+(\d+) passed \(\1\)/u.exec(testLog)?.[1],tests=/Tests\s+(\d+) passed \(\1\)/u.exec(testLog)?.[1];
assert.ok(files&&tests&&!/FAIL\s+tests\//u.test(testLog));
const branch=execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),tag="r1.15-f-session-multicompany-operations-ready-20261001";
const report={TASK:"R1.15-F",START_HEAD:"a2ee465cb95974b36af27c7d1be6485917f6ad29",END_HEAD:`LOCAL_TAG_TARGET: ${tag} (git rev-parse '${tag}^{commit}')`,BRANCH:branch,TAG:tag,WORKTREE_CLEAN:"YES",
  R115E_BASELINE_PRESERVED:"PASS",DOUYIN_STATE:"ORDINARY_ON_BATCH_OFF",WEBSITE_STATE:"ORDINARY_ON_BATCH_OFF",TOUTIAO_STATE:"ORDINARY_ON_BATCH_OFF",
  ACCOUNT_SESSION_PERSISTENCE:"PASS",STARTUP_REHYDRATION:"PASS",BROWSER_SESSION_RESTORE:"PASS",API_CREDENTIAL_RESTORE:"PASS",MULTI_ACCOUNT_ISOLATION:"PASS",MULTI_COMPANY_ACCOUNT_ISOLATION:"PASS",NETWORK_UNAVAILABLE_STATE:"PASS_TESTED",FALSE_EXPIRED_ON_STARTUP_FIXED:"PASS",PUBLISH_PREFLIGHT_FRESH_VERIFY:"PASS_REGRESSION",
  DOUYIN_RESTART_AUTH_STATE:"UNASSIGNED_COMPANY_NO_PROBE",TOUTIAO_RESTART_AUTH_STATE:"UNASSIGNED_COMPANY_NO_PROBE",WEIBO_RESTART_AUTH_STATE:"NEEDS_LOGIN_BROWSER_SESSION_MISSING",SOHU_RESTART_AUTH_STATE:"NEEDS_LOGIN_USER_ACTION_REQUIRED",WEBSITE_RESTART_CONNECTION_STATE:"CONNECTED_X2_BOTH_RESTARTS",CNBLOGS_RESTART_CONNECTION_STATE:"UNASSIGNED_COMPANY_NO_PROBE",
  MULTI_COMPANY_WORKSPACE:"PASS",WORKSPACE_SWITCH_SELECTION_RESET:"PASS",COMPANY_ARTICLE_ISOLATION:"PASS",COMPANY_IMAGE_ISOLATION:"PASS",COMPANY_ACCOUNT_ISOLATION:"PASS",COMPANY_AI_CONTEXT_ISOLATION:"PASS",
  CONTENT_REVIEW_WORKFLOW:"PASS",AI_GENERATED_REQUIRES_REVIEW:"PASS",ONLY_APPROVED_CAN_PUBLISH:"PASS",AI_DRAFT_GENERATION_QUEUE:"PASS",QUEUE_RESTART_RECOVERY:"PASS",QUEUE_PAUSE_RESUME_CANCEL:"PASS_TESTED",QUEUE_AUTO_PUBLISH:"NO",
  CONTENT_PLAN_7_DAY:"PASS",CONTENT_PLAN_30_DAY:"PASS",CONTENT_CALENDAR:"PASS",AUTO_SCHEDULE_PUBLISH:"NO",FACT_LIBRARY:"PASS",FACT_EXPIRY_WARNING:"PASS",FACT_APPROVED_FOR_AI:"PASS",FORBIDDEN_CLAIM_GUARD:"PASS",IMAGE_LIBRARY_PRODUCTIZATION:"PASS",IMAGE_SHA256_DEDUP:"PASS",IMAGE_USAGE_HISTORY:"PASS",IMAGE_PLATFORM_SUITABILITY:"PASS_CONFIRMED_CONSTRAINTS_UNKNOWN_REMAINS_UNKNOWN",
  CONTENT_DUPLICATE_WARNING:"PASS",TITLE_DUPLICATE_CHECK:"PASS",BODY_DUPLICATE_CHECK:"PASS",AI_USAGE_METADATA:"PASS",AI_USAGE_DASHBOARD:"PASS_COST_UNKNOWN",EXCEL_CSV_IMPORT_PREVIEW:"PASS",IMPORT_ROW_ERRORS:"PASS",IMPORT_CREATES_DRAFT_ONLY:"PASS",TODAY_WORKSPACE:"PASS",PUBLISH_OPERATIONS_DASHBOARD:"PASS_READ_ONLY",OWNER_ACTION_CENTER:"PASS",
  WEIBO_ONLY_BLOCKER:"OWNER_LOGIN_THEN_SEPARATELY_AUTHORIZED_ACCEPTANCE",SOHU_ONLY_BLOCKER:"OWNER_CREATOR_LOGIN_THEN_SEPARATELY_AUTHORIZED_ACCEPTANCE",CNBLOGS_ONLY_BLOCKER:"CONFIRM_COMPANY_AND_OWNER_PAT_THEN_SEPARATELY_AUTHORIZED_ACCEPTANCE",REAL_PLATFORM_PUBLISH_COUNT:0,NEW_FINAL_SUBMIT_COUNT:0,BATCH_PUBLISH_ENABLED_ANYWHERE:"NO",
  DB_MIGRATION:"PASS_ADDITIVE_0032",DB_COPY_MIGRATION_TEST:"PASS_70_TABLE_EXACT_ROW_PARITY",SQLITE_INTEGRITY:"PASS",FOREIGN_KEY_CHECK:"PASS",PRODUCTION_DATA_PRESERVED:"PASS_ORIGINAL_BYTES_UNCHANGED",FOCUSED_TESTS:"PASS_RED_GREEN_AND_INTEGRATION",FULL_TEST_FILES:Number(files),FULL_TEST_COUNT:Number(tests),TYPECHECK:"PASS",LINT:"PASS",BUILD:"PASS",PACKAGE:"PASS",NEW_FAILURES:0,INHERITED_FAILURES:0,
  RELEASE_FILENAME:"Geo Media Publisher Setup 1.1.9 - R1.15-F OPERATIONS RELEASE.exe",INSTALLER_PATH:"D:/GEO_MEDIA_PUBLISHER_FINAL/source/geo-media-publisher/output/r115-f-department-release/Geo Media Publisher Setup 1.1.9 - R1.15-F OPERATIONS RELEASE.exe",INSTALLER_SIZE:packageIdentity.installerBytes,RELEASE_SHA256:packageIdentity.installerSha256,RELEASE_APP_ASAR_SHA256:packageIdentity.installedAppAsarSha256,PACKAGE_SOURCE_COMMIT:source,
  FINAL_INSTALLED_SMOKE:"PASS",RESTART_SMOKE:"PASS",SESSION_REHYDRATION_SMOKE:"PASS_LOCAL_BROWSER_PLUS_PRIVATE_COPY_READ_ONLY",READY_MD_UPDATED:"PASS",R115F_READY_DOC:"PASS",PRODUCT_DOCS_UPDATED:"PASS",SECRET_SCAN:"PASS",PRIVATE_GITHUB_PUSH:"BLOCKED_BY_OWNER_CONFIGURATION",OWNER_ACTION_REQUIRED:"YES_LOGIN_PAT_AND_LEGACY_COMPANY_CONFIRMATION",FINAL_STATUS:"R1_15_F_SESSION_MULTI_COMPANY_OPERATIONS_READY",NEXT_TASK:"OWNER_COMPANY_BINDING_AND_AUTH_THEN_SEPARATELY_AUTHORIZED_WEIBO_SOHU_CNBLOGS_E2E"};
const lines=Object.entries(report).map(([key,value])=>`${key}=${value}`).join("\n");
const body=`# R1.15-F Session / Multi-company / Operations READY

Technical release: **${report.FINAL_STATUS}**. This is a local department Release. It does not authorize any new real publishing, claim unverified accounts are logged in, or enable another platform. Real platform publications and new final submits are both **zero**.

## Verified identity and provenance

- Canonical source: D:\\GEO_MEDIA_PUBLISHER_FINAL\\source\\geo-media-publisher.
- Trusted E start: ${report.START_HEAD}; E tag remains in ancestry. C/D/E code and tags were preserved; origin/main is older and was not used to reset them.
- Branch: ${branch}; local annotated tag: ${tag}. Resolve the final document commit with git rev-parse '${tag}^{commit}', rather than placing a self-referential hash in its own document.
- Packaged runtime source: **${source}**. Subsequent handoff-only edits do not change apps/desktop/src or packages. Installed main/preload/renderer and migration bytes match the verified build.
- App version remains 1.1.9. Department filename and hashes identify F; no fictitious version was invented.
- Node CLI 22.17.0, pnpm 11.19.0. Installed Electron ${installed.electron}, Node ${installed.node}, native ABI ${installed.abi}. package lock is retained.
- GitHub metadata was freshly read: 1542651213/geo-media-publisher is PUBLIC. No private origin exists; no public push, force push, main merge, tag deletion or private backup upload occurred.

## Installed release

Filename: ${report.RELEASE_FILENAME}

Path: ${report.INSTALLER_PATH}

Size: **${report.INSTALLER_SIZE} bytes**.

Installer SHA256: **${report.RELEASE_SHA256}**.

Installed app.asar SHA256: **${report.RELEASE_APP_ASAR_SHA256}**.

The NSIS installer exited 0 in output/r115-f-department-install. No Candidate/Acceptance grant, production DB, credentials.enc or storage state is distributed in resources. The E department installer remains unchanged: bc6a59e60a395f3ad68a95e46d456b1c29e905f31118a30b1cff474f920245b9. Failed F packaging attempts are retained under ignored local execution evidence and are explicitly UNVERIFIED; only the final hash above is the department Release.

## Platform and authentication truth

| Platform | Ordinary | Batch | F observation / next step |
| --- | --- | --- | --- |
| Douyin | ON | OFF | Existing accepted browser article route and <=20 UTF-16 title rule preserved. Private-copy legacy account is unassigned; no company was guessed and it was not live probed. Confirm company, then fresh identity check. |
| Kangyi Website | ON | OFF | Two exact OfficialAPI connections restored as CONNECTED after both private-copy restarts; signed health/capability/identity was read only. |
| Toutiao | ON | OFF | Existing accepted plain text + one cover route preserved. Private-copy legacy account is unassigned; no live-auth claim. |
| Weibo | OFF | OFF | Missing browser session; Owner normal login, then separately authorized real acceptance. |
| Sohu | OFF | OFF | Live check returned user action required; Owner Creator login, then separately authorized acceptance. |
| CNBlogs | OFF | OFF | Unassigned company; confirm company and update Owner PAT as required by historical D readiness. This run did not re-probe an unassigned PAT. |
| Xiaohongshu / Baijiahao / Lieju | OFF | OFF | Pending ordinary acceptance. A Lieju session restored AUTHENTICATED twice; that does not prove publish acceptance or open its switch. |
| NetEase | OFF | OFF | Separate adapter work remains outside F. |

Private-copy initialization safely bound ${migration.legacyAccountBindings} accounts from unique historical ownership and left ${migration.ambiguousAccountsUnassigned} ambiguous accounts unassigned. This is visible Owner work, including some historically accepted platform accounts; F does not conceal it behind DB logged_in. Legacy kangyi_website is an unavailable historical alias, not the current OfficialAPI route. Unknown identity remains UNVERIFIED. Sohu/Weibo are NEEDS_LOGIN for observed reasons, not blanket startup expiry. No challenge was bypassed.

Windows encrypted credentials require their original OS-protected Local State context on a same-user private restore. The first experimental copy omitted it and correctly failed decryption; this was a copy setup issue, not a credential rotation. Adding the encrypted context privately restored both Website credentials and an existing browser session. No value was displayed, logged, placed in SQLite or Git, and the original application data remained untouched.

## Session implementation and safety

Main's AccountSessionRehydrationCoordinator has two workers and exact platform/account/company/generation binding. Core restore opens only persisted auth, hidden; it cannot invent a new login session. Live remote identity must match the saved expected identity. An in-flight disconnect, company change, mode change or generation replacement cannot be promoted by an old response. Douyin BrowserAutomation explicitly resolves the article browser adapter instead of preferred OAuth.

Renderer receives safe runtime state/time/reason only. Offline is NETWORK_UNAVAILABLE, not expired; DB logged_in and a directory/timestamp alone are not authentication. Website requires Authorized write scope to become CONNECTED. Ordinary publish still runs fresh identity/preflight independently. Main enforces current company and Approved content at preparation and immediately before final action. Unknown old submissions retain read-only reconciliation and their original durable identity.

## Workspace, review and content operations

The global company selector persists in Main and remounts the keyed workspace, clearing selected articles/images/accounts, forms, import previews and Studio source/results. Middleware scopes list/page/history/statistics reads and resolves IDs before writes. Coverage includes legacy Studio/version/root task IDs, video ownership, plans/account lists, Website jobId maintenance, local generation IDs and async OfficialAPI preparation. Shared Provider/templates remain configuration; facts/context/default choices/history/outputs remain company-specific.

The nine tabs are Today, review, Draft queue, plan, facts, usage, import, Owner and publish board. Today shortcuts navigate to real operations. Dashboard/jobs are read only; refresh is explicit. Unknown/failed results use human actions; Developer Mode defaults OFF and cannot waive Main gates.

Human approval uses the exact current hash. Draft content receives local company/contact/claims/platform validation and Needs_Review state before the explicit decision; it calls no cloud Provider. Editing invalidates approval, with repository Draft followed by the existing Main deterministic quality gate where applicable. Old hash approval is rejected. Existing contentReviewMode=Off no longer bypasses formal publishing.

Queue: 1–20 sources, up to six targets, effective concurrency one per company. N sources yield N + N×targets items. Each variant points to its exact source draft. Atomic claim, saved generation ID, transactional Draft+Completed write, restart reconciliation and explicit unknown-result decisions prevent re-generation of completed content. 429 is bounded; red validation is Blocked, never generic retry-looped. Pause/resume/cancel/retry and validation/unknown decisions are exposed in Main and UI. Queue creates zero Jobs/Intents/Records and never auto publishes.

Plan: deterministic 7/30 days or manual editorial dates, list/calendar, nonempty linked editable outline and idempotent reuse. Using AI prepares a company-specific source/target handoff to Studio; plan targets override delayed defaults. No automatic scheduling or cloud call when creating a plan.

Facts: company, source/date, verification/expiry, approved-for-AI and notes. Only approved unexpired facts enter current-company generation. Expired facts remain flagged. Existing approved/forbidden claims, contact/company/brand and platform policy checks remain deterministic. No generic code hardcodes company facts.

Assets: actual-byte SHA/MIME/dimensions, same-company dedup, Chinese filename/default-name handling, metadata/orientation/usage/known suitability. Confirmed image constraints apply; unknown constraints are displayed as unknown. Duplicate title/body warnings are same-company only. Import/AI/edit hashes use company namespace without rewriting old stored hashes.

CSV/XLSX: native picker, 8MB/1000-row guard, mapped preview and per-row Chinese errors. Empty optional mappings mean not imported; unknown required headers still enter an error preview so they can be mapped. A supplied company column is retained and checked against the workspace; foreign/unknown company rows are invalid and never imported or relabeled. Valid rows create Draft only. Main owns and consumes the preview, checks ownership again before writing, and another company cannot commit it. Usage is non-secret Provider/model token/outcome metadata; unknown cost stays unknown.

## Validation receipts

- Initial E baseline: 198 files / 1390 tests PASS. Final F: **${files} files / ${tests} tests PASS**, no skipped/deleted tests used to hide failures, new/inherited failures zero. Earlier ordinary fixture failures were repaired without weakening publish assertions.
- Typecheck, lint and build exited 0. Final package parity checks main/preload/renderer bytes, all ${packageIdentity.migrations} physical migration resources, platforms and sensitive/grant exclusions.
- Private copy: ${migration.eBaselineMigrationCount} historical applied migration records to ${migration.fMigrationCount}; 70 existing non-migration tables exact sorted-row parity, integrity and foreign keys PASS, reopen idempotent. Historical applied count includes earlier retained migrations and differs from a fresh installation's ${packageIdentity.migrations} resource files; no history was deleted to force counts equal.
- Real local Chromium: two accounts/two companies, hidden encrypted-state restore after manager restart, exact identity, missing session and wrong identity. This fixture is not claimed as real Douyin/Toutiao authentication.
- Installed isolated app: ${installed.operationsTabs} tabs, ${installed.companies} companies, five Provider choices, ${installed.loopbackGenerations} loopback generations, two sources/four linked variants, approved facts, stale approval/edit invalidation, 37 plan items and plan-to-Studio handoff, image SHA/dimensions/dedup/binding usage, CSV and XLSX row errors/imports, diagnostics allowlist, company switch/selection reset and restart persistence. No external AI generation.
- Private installed restart: two actual read-only runs, two Website connections and one browser identity restored both times; missing/unassigned/unverifiable states retained honestly. Scheduler disabled; copied Job/Intent/Record/Article counts and original DB/credential bytes unchanged.
- Independent review identified authority/routing/lineage/import gaps and their findings were resolved with focused receipts. Its final continuation ended at service usage limit; no unreceived blanket final-review approval is claimed. Parent verified final source and installed behavior, including four UI/IPC defects found during installed acceptance: Draft approval, default image name, blank mappings, and mismatched company rows.

## Commands and release procedure

Use the canonical branch/tag, never reset to the older public origin/main. pnpm install --frozen-lockfile; pnpm test --maxWorkers=1; pnpm typecheck; pnpm lint; pnpm build. Tests rebuild better-sqlite3 for Node before running and Electron after. Do not run concurrent native rebuilds. For standalone tsx DB checks, pnpm rebuild better-sqlite3 first; before packaging, pnpm rebuild:native.

Package with pnpm exec electron-builder --win nsis --x64; copy the resulting default installer to the department filename. Install in an explicit test directory using /S and /D, hidden. Run node scripts/r115-f-package-verify.mjs <install-dir> <runtime-source-commit>, then node scripts/r115-f-installed-smoke.mjs <installed-exe>. Both verify the installed package, not just an unpacked development build.

For a closed-data migration proof: pnpm exec tsx scripts/r115-f-migration-copy-check.mts <private-backup-dir>. For encrypted local browser proof: pnpm exec tsx scripts/r115-f-browser-restore-smoke.mts. For actual read-only restart: node scripts/r115-f-live-readonly-restart.mjs <installed-exe> <private-backup-dir>. That backup must include DB, encrypted credentials and private Local State; preserve exact persistent profiles when relevant. These scripts never print secret values. Do not launch the normal Owner data to reproduce a fixture.

Before Owner upgrade, close the app and keep the complete production-data directory, credentials, Local State and browser profiles privately. Preserve E/F installer hashes. SQLite migrations are additive: rollback means restore a complete closed-app pre-F private backup under the same Windows user/encryption context and run the matching E executable. Do not run an old binary against a modified DB and assume down-migration, do not delete old jobs/intents/records or selectively copy a WAL-less live DB.

Future integration: configure an Owner-approved private remote separately; scan the current source/docs again before any push. Never upload Local State, credentials, DB, profiles, private bundles/backups, raw prompts/responses or failed fixture userData. The configured PUBLIC remote is not an implicit private handoff target.

## Source map and next work

Main modules: account-session-rehydration.ts, company-workspace.ts, content-review-authority.ts, content-operations.ts, operations-assets.ts; IPC/preload/shared APIs are existing authorities. Renderer: App company selector, OperationsCenter/operations-center-ui/css, ProductAICenter and V11Workspace. Domain keeps the single PlatformContentPolicy and Studio validator. DB migration 0032 adds operations metadata; Publisher final boundary uses existing durable intent model. No new Article/Job architecture was introduced.

Detailed product instructions: docs/product/account-session-persistence.md, docs/product/multi-company-workspace.md, docs/product/content-operations.md. Sanitized receipts are docs/evidence/r115-f-verification.json; raw private execution artifacts remain ignored locally. Cloud keys are Owner-configured in Main SafeStorage; no key is needed to read this handoff or run offline fixture tests. Ollama is not downloaded automatically.

Owner next: confirm ambiguous account companies, log in normally to Weibo/Sohu Creator and securely update CNBlogs PAT when required. Then commission separately authorized real product E2E for those three platforms. No real acceptance or switch-opening for them is part of F. No website source/server service, Huiquan/Shupai site, firewall, SSH or production business object was modified. This task stops at the F release/handoff.

## Required final report

~~~text
${lines}
~~~
`;
mkdirSync("docs/releases",{recursive:true});mkdirSync("docs/evidence",{recursive:true});
writeFileSync("docs/releases/R1.15-F-READY.md",body);
const evidence={schemaVersion:1,task:"R1.15-F",package:packageIdentity,installed:{...installed,evidenceDirectory:undefined},migration,localBrowser:browser,privateReadOnlyRestart:live,tests:{files:Number(files),tests:Number(tests),newFailures:0,inheritedFailures:0},ordinaryOn:["douyin","website","toutiao"],batchEnabled:false,realPlatformPublishCount:0,newFinalSubmitCount:0,privateGithubPush:report.PRIVATE_GITHUB_PUSH,excluded:["Secrets","Business data","Private paths","Prompts","Raw responses","Cookies","Storage state"]};
writeFileSync("docs/evidence/r115-f-verification.json",JSON.stringify(evidence,null,2)+"\n");
const ready=readFileSync("ready.md","utf8");
const anchor="## R1.15-E 当前交付和继续开发入口";
const fAnchor="## R1.15-F 当前交付和继续开发入口";
const archived=ready.includes(fAnchor)?ready.slice(ready.indexOf("## R1.15-E 归档交付")):ready.slice(ready.indexOf(anchor)).replace(anchor,"## R1.15-E 归档交付（F 已替代当前状态）");
writeFileSync("ready.md",`# Geo Media Publisher\n\nWindows 多企业内容运营工作台，应用版本 1.1.9。最新技术交付为 R1.15-F Session / Multi-company / Operations Release。当前普通发布仅 Douyin、Kangyi Website OfficialAPI 和 Toutiao ON；全部 batch OFF。AI、队列、计划和导入只创建本地 Draft，必须人工审核当前内容再走正式发布。账号健康来自实时身份检查，不来自 DB logged_in。\n\n${fAnchor}\n\n${body.replace(/^# .+\n/u,"")}\n\n---\n\n以下 E/D/C/R1.14 内容为历史归档。遇到状态/目录/流程冲突，以顶部 F 部分及当前源码和真实现场为准。旧 E 中无全局账号公司限制、旧审核 Off 或旧复制凭据备份说明已由 F 的 Main 公司绑定/批准门禁和 Local State 恢复要求替代；不要照旧段落绕过。\n\n${archived}`);
writeFileSync(`${root}/final-report.json`,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({status:"DOCS_WRITTEN_VERIFY_BEFORE_TAG",files:Number(files),tests:Number(tests),source,installerSha256:packageIdentity.installerSha256}));
