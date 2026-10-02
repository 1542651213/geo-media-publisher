# Geo Media Publisher

Windows 多企业内容运营工作台，应用版本 1.1.9。最新技术交付为 R1.15-F Session / Multi-company / Operations Release。当前普通发布仅 Douyin、Kangyi Website OfficialAPI 和 Toutiao ON；全部 batch OFF。AI、队列、计划和导入只创建本地 Draft，必须人工审核当前内容再走正式发布。账号健康来自实时身份检查，不来自 DB logged_in。

## R1.15-F 当前交付和继续开发入口


Technical release: **R1_15_F_SESSION_MULTI_COMPANY_OPERATIONS_READY**. This is a local department Release. It does not authorize any new real publishing, claim unverified accounts are logged in, or enable another platform. Real platform publications and new final submits are both **zero**.

## Verified identity and provenance

- Canonical source: D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher.
- Trusted E start: a2ee465cb95974b36af27c7d1be6485917f6ad29; E tag remains in ancestry. C/D/E code and tags were preserved; origin/main is older and was not used to reset them.
- Branch: release/2026-10-01-r1.15-f-session-multicompany-operations; local annotated tag: r1.15-f-session-multicompany-operations-ready-20261001. Resolve the final document commit with git rev-parse 'r1.15-f-session-multicompany-operations-ready-20261001^{commit}', rather than placing a self-referential hash in its own document.
- Packaged runtime source: **1649aff2b9f3066fd313ad64e0ce3a6244724a1b**. Subsequent handoff-only edits do not change apps/desktop/src or packages. Installed main/preload/renderer and migration bytes match the verified build.
- App version remains 1.1.9. Department filename and hashes identify F; no fictitious version was invented.
- Node CLI 22.17.0, pnpm 11.19.0. Installed Electron 37.10.3, Node 22.21.1, native ABI 136. package lock is retained.
- GitHub metadata was freshly read: 1542651213/geo-media-publisher is PUBLIC. No private origin exists; no public push, force push, main merge, tag deletion or private backup upload occurred.

## Installed release

Filename: Geo Media Publisher Setup 1.1.9 - R1.15-F OPERATIONS RELEASE.exe

Path: D:/GEO_MEDIA_PUBLISHER_FINAL/source/geo-media-publisher/output/r115-f-department-release/Geo Media Publisher Setup 1.1.9 - R1.15-F OPERATIONS RELEASE.exe

Size: **101270018 bytes**.

Installer SHA256: **503bb5b7f208b087c41a23161efb2d24bb473cabf69902cc4d78b724d0bc5afb**.

Installed app.asar SHA256: **f98018a24fc2f6825ed3690a922eb15ff606a21eaefae6ee24547e7c34b9a87d**.

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

Private-copy initialization safely bound 7 accounts from unique historical ownership and left 13 ambiguous accounts unassigned. This is visible Owner work, including some historically accepted platform accounts; F does not conceal it behind DB logged_in. Legacy kangyi_website is an unavailable historical alias, not the current OfficialAPI route. Unknown identity remains UNVERIFIED. Sohu/Weibo are NEEDS_LOGIN for observed reasons, not blanket startup expiry. No challenge was bypassed.

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

- Initial E baseline: 198 files / 1390 tests PASS. Final F: **207 files / 1462 tests PASS**, no skipped/deleted tests used to hide failures, new/inherited failures zero. Earlier ordinary fixture failures were repaired without weakening publish assertions.
- Typecheck, lint and build exited 0. Final package parity checks main/preload/renderer bytes, all 33 physical migration resources, platforms and sensitive/grant exclusions.
- Private copy: 39 historical applied migration records to 40; 70 existing non-migration tables exact sorted-row parity, integrity and foreign keys PASS, reopen idempotent. Historical applied count includes earlier retained migrations and differs from a fresh installation's 33 resource files; no history was deleted to force counts equal.
- Real local Chromium: two accounts/two companies, hidden encrypted-state restore after manager restart, exact identity, missing session and wrong identity. This fixture is not claimed as real Douyin/Toutiao authentication.
- Installed isolated app: 9 tabs, 2 companies, five Provider choices, 6 loopback generations, two sources/four linked variants, approved facts, stale approval/edit invalidation, 37 plan items and plan-to-Studio handoff, image SHA/dimensions/dedup/binding usage, CSV and XLSX row errors/imports, diagnostics allowlist, company switch/selection reset and restart persistence. No external AI generation.
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
TASK=R1.15-F
START_HEAD=a2ee465cb95974b36af27c7d1be6485917f6ad29
END_HEAD=LOCAL_TAG_TARGET: r1.15-f-session-multicompany-operations-ready-20261001 (git rev-parse 'r1.15-f-session-multicompany-operations-ready-20261001^{commit}')
BRANCH=release/2026-10-01-r1.15-f-session-multicompany-operations
TAG=r1.15-f-session-multicompany-operations-ready-20261001
WORKTREE_CLEAN=YES
R115E_BASELINE_PRESERVED=PASS
DOUYIN_STATE=ORDINARY_ON_BATCH_OFF
WEBSITE_STATE=ORDINARY_ON_BATCH_OFF
TOUTIAO_STATE=ORDINARY_ON_BATCH_OFF
ACCOUNT_SESSION_PERSISTENCE=PASS
STARTUP_REHYDRATION=PASS
BROWSER_SESSION_RESTORE=PASS
API_CREDENTIAL_RESTORE=PASS
MULTI_ACCOUNT_ISOLATION=PASS
MULTI_COMPANY_ACCOUNT_ISOLATION=PASS
NETWORK_UNAVAILABLE_STATE=PASS_TESTED
FALSE_EXPIRED_ON_STARTUP_FIXED=PASS
PUBLISH_PREFLIGHT_FRESH_VERIFY=PASS_REGRESSION
DOUYIN_RESTART_AUTH_STATE=UNASSIGNED_COMPANY_NO_PROBE
TOUTIAO_RESTART_AUTH_STATE=UNASSIGNED_COMPANY_NO_PROBE
WEIBO_RESTART_AUTH_STATE=NEEDS_LOGIN_BROWSER_SESSION_MISSING
SOHU_RESTART_AUTH_STATE=NEEDS_LOGIN_USER_ACTION_REQUIRED
WEBSITE_RESTART_CONNECTION_STATE=CONNECTED_X2_BOTH_RESTARTS
CNBLOGS_RESTART_CONNECTION_STATE=UNASSIGNED_COMPANY_NO_PROBE
MULTI_COMPANY_WORKSPACE=PASS
WORKSPACE_SWITCH_SELECTION_RESET=PASS
COMPANY_ARTICLE_ISOLATION=PASS
COMPANY_IMAGE_ISOLATION=PASS
COMPANY_ACCOUNT_ISOLATION=PASS
COMPANY_AI_CONTEXT_ISOLATION=PASS
CONTENT_REVIEW_WORKFLOW=PASS
AI_GENERATED_REQUIRES_REVIEW=PASS
ONLY_APPROVED_CAN_PUBLISH=PASS
AI_DRAFT_GENERATION_QUEUE=PASS
QUEUE_RESTART_RECOVERY=PASS
QUEUE_PAUSE_RESUME_CANCEL=PASS_TESTED
QUEUE_AUTO_PUBLISH=NO
CONTENT_PLAN_7_DAY=PASS
CONTENT_PLAN_30_DAY=PASS
CONTENT_CALENDAR=PASS
AUTO_SCHEDULE_PUBLISH=NO
FACT_LIBRARY=PASS
FACT_EXPIRY_WARNING=PASS
FACT_APPROVED_FOR_AI=PASS
FORBIDDEN_CLAIM_GUARD=PASS
IMAGE_LIBRARY_PRODUCTIZATION=PASS
IMAGE_SHA256_DEDUP=PASS
IMAGE_USAGE_HISTORY=PASS
IMAGE_PLATFORM_SUITABILITY=PASS_CONFIRMED_CONSTRAINTS_UNKNOWN_REMAINS_UNKNOWN
CONTENT_DUPLICATE_WARNING=PASS
TITLE_DUPLICATE_CHECK=PASS
BODY_DUPLICATE_CHECK=PASS
AI_USAGE_METADATA=PASS
AI_USAGE_DASHBOARD=PASS_COST_UNKNOWN
EXCEL_CSV_IMPORT_PREVIEW=PASS
IMPORT_ROW_ERRORS=PASS
IMPORT_CREATES_DRAFT_ONLY=PASS
TODAY_WORKSPACE=PASS
PUBLISH_OPERATIONS_DASHBOARD=PASS_READ_ONLY
OWNER_ACTION_CENTER=PASS
WEIBO_ONLY_BLOCKER=OWNER_LOGIN_THEN_SEPARATELY_AUTHORIZED_ACCEPTANCE
SOHU_ONLY_BLOCKER=OWNER_CREATOR_LOGIN_THEN_SEPARATELY_AUTHORIZED_ACCEPTANCE
CNBLOGS_ONLY_BLOCKER=CONFIRM_COMPANY_AND_OWNER_PAT_THEN_SEPARATELY_AUTHORIZED_ACCEPTANCE
REAL_PLATFORM_PUBLISH_COUNT=0
NEW_FINAL_SUBMIT_COUNT=0
BATCH_PUBLISH_ENABLED_ANYWHERE=NO
DB_MIGRATION=PASS_ADDITIVE_0032
DB_COPY_MIGRATION_TEST=PASS_70_TABLE_EXACT_ROW_PARITY
SQLITE_INTEGRITY=PASS
FOREIGN_KEY_CHECK=PASS
PRODUCTION_DATA_PRESERVED=PASS_ORIGINAL_BYTES_UNCHANGED
FOCUSED_TESTS=PASS_RED_GREEN_AND_INTEGRATION
FULL_TEST_FILES=207
FULL_TEST_COUNT=1462
TYPECHECK=PASS
LINT=PASS
BUILD=PASS
PACKAGE=PASS
NEW_FAILURES=0
INHERITED_FAILURES=0
RELEASE_FILENAME=Geo Media Publisher Setup 1.1.9 - R1.15-F OPERATIONS RELEASE.exe
INSTALLER_PATH=D:/GEO_MEDIA_PUBLISHER_FINAL/source/geo-media-publisher/output/r115-f-department-release/Geo Media Publisher Setup 1.1.9 - R1.15-F OPERATIONS RELEASE.exe
INSTALLER_SIZE=101270018
RELEASE_SHA256=503bb5b7f208b087c41a23161efb2d24bb473cabf69902cc4d78b724d0bc5afb
RELEASE_APP_ASAR_SHA256=f98018a24fc2f6825ed3690a922eb15ff606a21eaefae6ee24547e7c34b9a87d
PACKAGE_SOURCE_COMMIT=1649aff2b9f3066fd313ad64e0ce3a6244724a1b
FINAL_INSTALLED_SMOKE=PASS
RESTART_SMOKE=PASS
SESSION_REHYDRATION_SMOKE=PASS_LOCAL_BROWSER_PLUS_PRIVATE_COPY_READ_ONLY
READY_MD_UPDATED=PASS
R115F_READY_DOC=PASS
PRODUCT_DOCS_UPDATED=PASS
SECRET_SCAN=PASS
PRIVATE_GITHUB_PUSH=BLOCKED_BY_OWNER_CONFIGURATION
OWNER_ACTION_REQUIRED=YES_LOGIN_PAT_AND_LEGACY_COMPANY_CONFIRMATION
FINAL_STATUS=R1_15_F_SESSION_MULTI_COMPANY_OPERATIONS_READY
NEXT_TASK=OWNER_COMPANY_BINDING_AND_AUTH_THEN_SEPARATELY_AUTHORIZED_WEIBO_SOHU_CNBLOGS_E2E
~~~


---

以下 E/D/C/R1.14 内容为历史归档。遇到状态/目录/流程冲突，以顶部 F 部分及当前源码和真实现场为准。旧 E 中无全局账号公司限制、旧审核 Off 或旧复制凭据备份说明已由 F 的 Main 公司绑定/批准门禁和 Local State 恢复要求替代；不要照旧段落绕过。

## R1.15-E 归档交付（F 已替代当前状态）


Final state: **R1_15_E_PRODUCTIZATION_AI_CENTER_READY**.
Product framework, local Draft workflow, full regression, copied-data migration,
installed UI and restart, package parity and secret scans passed. Missing cloud keys
and Owner-only platform authentication remain explicit; no real E publication was
performed and no additional platform ordinary switch was opened.

### Identity and scope

Canonical source: `D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher`.
Branch: `release/2026-10-01-r1.15-e-productization-ai-center`.
Trusted R1.15-D start HEAD and tag: `4de6c2796d8efe04ab12f81aad07ddadc9d0f89d` /
`r1.15-d-multiplatform-ready-20261001`. `origin/main` was older
(`d2aa3c3f2c173c186c567421bbc4657ae32eec45`); no reset, force push, main merge,
tag deletion, or overwrite of C/D/Douyin was performed. Current delivery is local;
the configured GitHub origin is public and this task does not authorize a public push.

App version remains 1.1.9. Department identity is the R1.15-E filename, source
commit, artifact hashes and local tag, rather than a fabricated application version.
Runtime source commit and package hashes are recorded in the final identity below.

Only GEO productization and the named AI/platform readiness work were performed.
No Kangyi website source, staging/production service, Huiquan, Shupai or server
business object was changed. No SSH credential was used. No live platform submission
or paid cloud generation was performed. Existing D evidence is historical, not new E
live acceptance.

### Product switches

| Platform | Ordinary | Batch | E state / next action |
| --- | --- | --- | --- |
| Douyin | ON | OFF | Existing accepted single-image article route; <=20 UTF-16 title units; fresh owned Creator identity required |
| Kangyi Website | ON | OFF | Existing accepted OfficialAPI ARTICLE/CASE route; signed current environment/revision/media preflight |
| Toutiao | ON | OFF | Existing accepted plain-text article / one-cover route; fresh owned identity and single final claim |
| Weibo | OFF | OFF | Owner login required; dedicated ordinary-post adapter restored offline; current live editor still unverified |
| Sohu | OFF | OFF | Owner must log in to the Creator backend; later ordinary product acceptance required |
| CNBlogs | OFF | OFF | Owner must update PAT securely; later identity/review/public readback acceptance required |
| Xiaohongshu | OFF | OFF | Pending ordinary acceptance |
| Baijiahao | OFF | OFF | Pending editor/ordinary acceptance |
| Lieju | OFF | OFF | Owner normal platform verification / acceptance pending |
| NetEase | OFF | OFF | Independent adapter not implemented |

`REAL_PLATFORM_PUBLISH_COUNT=0`, `NEW_FINAL_SUBMIT_COUNT=0`. Browser final actions
inside offline fixture tests are not real platform submissions. Developer Mode
cannot enable ordinary/batch gates or waive the durable submit claim.

### Ordinary product UI

Normal navigation is home, content production, AI providers, articles, images,
accounts, publish center and statistics. Content production opens the new local
AI Studio. Candidate/B01/self-test/controlled-discovery controls are hidden while
Developer Mode is OFF, including the account-center header entry caught by installed
acceptance. Advanced settings offers a safe diagnostic export, AI providers, local
backups and image tag management. Developer Mode is persisted as a setting, defaults
to false, and only shows advanced tools. Main still rejects alternate final-submit
paths and L5 for an unopened platform; known L1–L4 are developer-only safe handlers.

Account health is a Main result with platform, account label, connection method,
status, last verification and Owner action. ON platforms re-read signed/owned
identity; cached DB `logged_in` does not make an account publishable. A saved login
on a legacy card is labeled “登录信息已保存”; it is not remote identity proof. Account
company applicability is derived from the article, not fabricated as a global
account-to-company restriction. No account on the isolated fixture is treated as
connected to a real service.

Main Product Preflight checks enterprise/article ownership, exact platform/account,
enabled/not archived state, actual identity, title/body, physical enabled same-brand
images, content type, known platform limits and confirmation mode. Renderer displays
the resulting items/blockers and disables Job creation when any red item remains.
Main recomputes the decision before creating a Job or beginning website preparation.
Normal errors use Chinese messages; technical codes remain in details/metadata.

### Provider Center and credentials

The shared abstraction supports ProviderDefinition/ProviderConfig/CredentialRef,
ModelDescriptor/GenerationRequest/GenerationResult, connection test, model discovery
where supported and text generation. Models may always be entered manually; listing
a model is not evidence that the model supports every request. Text only: no image,
speech, embedding system, autonomous agent or automatic publication.

| Provider | Reviewed request contract | Discovery / connection test |
| --- | --- | --- |
| Xiaomi MiMo | `https://api.xiaomimimo.com/v1/chat/completions`, `api-key`, messages, `max_completion_tokens`, nonstream choices.message.content | Model listing not established; verified preset `mimo-v2.6-pro` plus manual ID. Connection test sends one minimal completion and may incur cost |
| OpenAI | `https://api.openai.com/v1/chat/completions`, Bearer, `max_completion_tokens` | `/v1/models`; no sole hardcoded model |
| DeepSeek | `https://api.deepseek.com/chat/completions`, Bearer, `max_tokens` | `/models`; reviewed presets plus manual ID |
| Ollama | Loopback `http://127.0.0.1:11434/api/chat`, stream=false, options.num_predict, message.content, done=true | `/api/tags`, existing models only; no key, no downloads |
| Custom compatible | Operator-entered HTTPS base or loopback HTTP base; Bearer and compatible `/chat/completions` | `/models`; manual IDs remain available when listing fails |

Official sources:
[MiMo](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call),
[OpenAI completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
[OpenAI models](https://developers.openai.com/api/reference/resources/models/methods/list),
[DeepSeek](https://api-docs.deepseek.com/),
[DeepSeek models](https://api-docs.deepseek.com/api/list-models/),
[Ollama tags](https://docs.ollama.com/api/tags),
[Ollama chat](https://docs.ollama.com/api/chat).
Contract verification is distinct from authenticated live model verification.
Cloud keys were not supplied/tested in this task. Current local Ollama tags request
was unavailable; the UI can show unavailable and no models were downloaded.
Custom compatibility describes the expected contract, not certification of any
arbitrary third-party host.

Keys enter a transient password field and a write-only Preload IPC, then Main
SafeStorage/Windows encryption. Provider metadata DTOs omit credential references;
SQLite stores metadata/ref, never key values. Product membership and defaults are
separate from historical AI profiles. Main owns exact `ai:provider:<id>` / legacy
per-profile references and ignores renderer-supplied refs. Endpoint changes delete
that profile's credential and require deliberate re-entry. A legacy Custom endpoint
cannot reuse the historical global official-provider key. Product defaults cannot
silently become the legacy batch default. Full key readback IPC does not exist.

Response redirects are rejected; official providers enforce reviewed hosts; custom
URLs cannot embed user/password/query/hash. Timeout is bounded, response reading
stops above 2 MB, model list is bounded at 1000 entries / ID length 200. Errors omit
raw bodies, prompts and keys. Cloud output needs explicit stop/eos finish_reason;
missing/null/empty/length/filtered outputs fail closed. Ollama needs done=true.
No transport retry is performed. Unknown outcomes become Unknown rather than an
automatic request replay.

### Studio operating procedure

1. Configure a Provider/model in AI Provider Center, enter its key only in the
   password field, save, optionally discover models and test connection. Without a
   key the provider is unconfigured and generation is disabled; other work continues.
2. Select the enterprise, same-company source Article or paste source materials,
   purpose, six target-platform choices, Provider/model and enabled template version.
3. Generate local drafts. Nine purposes include article/title generation, rewriting,
   shortening/expansion, tone, SEO/GEO, adaptation and multiple draft variants. Title
   generation retains the original source body. OFF publishing platforms can produce
   drafts; the UI says publishing is not yet open.
4. Each platform has an independent history outcome. The same Provider/model client,
   context/source snapshots and template version remain bound across the request.
   No job is created by generation. Concurrent generation for the same company is
   rejected; UI in-flight actions use a synchronous mutex and disabled controls.
5. A title above the shared platform limit receives at most one same-Provider/model
   title-only repair. The body is retained. Failed repair retains the original draft
   with NeedsUserAction and allows manual correction. Never silently truncate.
6. Edit the result, click Validate, fix red items, then Save Draft. Save revalidates in
   Main against the current enterprise context and immutable source evidence. Exact
   same-company title/body duplicate warnings do not mutate text. Unknown platform
   limits remain unknown.
7. Every saved target becomes its own local `content_studio` Article visible to the
   ordinary article/publish drawer. If a source Article was selected, a Variant linked
   to that source is also stored as provenance; the source text remains unchanged.
   Saving again returns the original output ID. Job/Intent/Record remain untouched.
8. Generation history survives restart. Generated text is retained locally, including
   repair-failed drafts; Running rows found at restart become Unknown with an error
   code, never restart a network request automatically. Save manual edits before
   navigating away; current UI does not autosave every keystroke.
9. Publication is a separate reviewed ordinary workflow with images, actual account,
   Main Preflight and one explicit final confirmation. AI cannot publish directly.

Enterprise Context reuses Brand and is editable per company: company/name/brands,
areas/services/contact/selling points/approved and forbidden claims/SEO and GEO
keywords/tone/website. Main injects the factual context and policy even when a prompt
template has been edited. Switching company clears source/result selections. The
12 distinct versioned templates cover industry, actual field case, company, FAQ,
GEO/SEO, Douyin, Weibo, Toutiao, Sohu, website ARTICLE/CASE and CNBlogs. New versions
retain old rows; history records the exact version used.

Deterministic checks cover blank title/body, known length/type limits, other known
enterprise/brand names, mobile/landline/400/email/explicit official website mismatch,
forbidden claims, common unsupported certification/ranking/CMA/customer/case/test/
numeric-result statements and recent same-company exact duplicates. Provided source
evidence or approved claims can support a recognized fact; a forbidden claim remains
blocked even if present in source. This is a bounded rule check, not semantic truth
verification of every possible paraphrase or unknown company. Operators must still
fact-check output and source. Latest 100 same-company Articles are the duplicate
window because the received task text did not specify a completed window.

### Storage, recovery and diagnostics

Migration `0031_ai_product_center.sql` adds six tables without altering the existing
business schema: contexts, immutable templates, metadata history, local drafts,
provider verification/default ownership and immutable generation input snapshots.
The current package contains 32 SQL migration files. A fresh database applies 32;
the protected historical D database preserves 38 applied IDs and upgrades to 39
by adding 0031. Historical migration ledger IDs are not rewritten or forged.
Input snapshots contain local
source text/context and hashes, never credentials; they are content data and are
excluded from diagnostics and ordinary logs. Complete raw transport responses and
complete compiled prompt strings are not logged.

Diagnostics exports a JSON allowlist: application version, migration count, ordinary/
batch switches, provider configured/verification status, recent generation status
counts and job count. It excludes credentials, prompts/responses, article bodies,
company/account identity, private paths and raw logs. The existing log-export action
uses the same safe bundle. It is not a full database/history export.

Copied-D-database validation proved all 64 previous nonmigration tables have identical
rows, 65→71 total tables and 38→39 migrations, integrity/FK PASS, reopen idempotence
and interrupted-generation Unknown recovery. Original normal publisher.db and
credentials.enc bytes remained unchanged. Normal Owner data has deliberately not
been opened in E. Only private copies and synthetic isolated installed data were used.

Before upgrading normal data, close the app and privately back up DB/WAL/SHM and
encrypted credential files together. SafeStorage remains tied to the Windows user.
Do not copy private content or credentials into source, Git, evidence or releases.
Rollback uses the prior installer/release with a coherent pre-upgrade data backup;
never overwrite a newly changed business database with an old backup without deciding
how to preserve newer records. Do not hand-edit/drop migrations or delete old releases.

### Platform readiness limitations

Weibo now has dedicated preparation, exact owned UID/compose/button uniqueness,
body readback, frozen image bytes/preview fingerprints, durable before-click callback,
single attempt, strict author-owned HTTPS mid/URL and independent public body read.
Alphanumeric mids reconcile through Publisher. Offline tests cover the binding and
durable result chain; no current real editor/final/public flow was exercised. Its
conservative post timestamp/DOM requirements may require minimal adjustment after
Owner normal login. Login is the next Owner action, not proof that every live selector
is already accepted. Ordinary stays OFF until a separately authorized one-shot E2E.

Sohu's D Creator login classifier and prepared/final/reconcile implementation are
retained. A public recommendation feed is not Creator authentication. Owner normal
login is required before a later one-shot ordinary E2E. No E Sohu business adapter
change or remote publication was performed.

CNBlogs preparation no longer creates a remote post/draft. Its documented formal
API creates one `IsPublished:true` post and reports review pending; approval is checked
on `/posts/reviewStatus:check`. `HTTP 200` or accepted post is not published proof.
Identity comes from `/corp/info` success and a trusted blogUrl, not a locally entered
blog name. Main forces confirmation and cannot auto-confirm this route. The official
contract has no proven draft-update or unknown-create/idempotency lookup; no blind
second create is permitted. Owner PAT is the next action, then contract/identity/
review/public readback acceptance. See [official contract](https://www.cnblogs.com/cmt/articles/19246558).

### Verification and package identity

- Baseline: 188 files / 1348 tests PASS.
- Final full regression: 198 files / 1390 tests PASS, no skipped/deleted tests.
- Initial E failures: Developer fixtures, migration/nav assertions and a concurrent
  existing browser timeout. Corrected expected product fixtures; bounded workers,
  without increasing timeout, resolved the browser concurrency failure.
- Typecheck/lint/build: PASS at the final runtime tree.
- Independent static review: no Critical/Important findings remain. This is not live
  provider or platform acceptance.
- Installed ordinary UI and restart: PASS. Five provider choices; local compatible
  `/models` discovery/connection test; context version 1 and template version 2 bound
  to all seven generations; seven saved Articles and six source-linked Variants;
  one title repair; foreign-company output blocked; SafeStorage encrypted; no plaintext
  credential in SQLite; Developer OFF by default and unable to final-submit; allowlisted
  diagnostic verified. Zero Job/Intent/Record and zero external generation/final actions.
- Installed Main/Preload/Renderer JS+CSS byte parity, 32 migration resources and platform
  resource parity: PASS. Candidate grants/private data absent. Final Provider/Studio/
  History screenshots were visually inspected after layout correction.

Commands from canonical source, with the configured Node runtime on PATH:

```powershell
pnpm install --frozen-lockfile
pnpm test --maxWorkers=2
pnpm typecheck
pnpm lint
pnpm build
pnpm rebuild:native
pnpm exec electron-builder --win nsis --x64 --config.directories.output=output/r115-e-department-release '--config.artifactName=Geo Media Publisher Setup 1.1.9 - R1.15-E AI CONTENT STUDIO RELEASE.exe' --config.nsis.createDesktopShortcut=false --config.nsis.createStartMenuShortcut=false --config.nsis.runAfterFinish=false
node scripts/r115-e-package-verify.mjs
node scripts/r115-e-installed-smoke.mjs
```

| Final identity | Value |
| --- | --- |
| Runtime source commit | `0b25e887e04aa56a130596882236ce600ac6b187` |
| Installer | `output/r115-e-department-release/Geo Media Publisher Setup 1.1.9 - R1.15-E AI CONTENT STUDIO RELEASE.exe` |
| Installer bytes | 101236741 |
| Installer SHA256 | `bc6a59e60a395f3ad68a95e46d456b1c29e905f31118a30b1cff474f920245b9` |
| Installed EXE | `output/r115-e-department-install/Geo Media Publisher.exe` |
| Installed app.asar SHA256 | `01641398ca62d99ad0f7f6ff728ba5c03d1ff0b0bf08f1dcea5154ff46144701` |
| Installed runtime | Electron 37.10.3 / Node 22.21.1 / native ABI 136 |
| Build/test runtime | Node 24.19.0 / pnpm 11.19.0 |
| Sanitized verification summary | `docs/evidence/r115-e-verification.json` |
| Local raw logs and synthetic screenshots | Ignored `output/r115-e-execution-20261001/` |
| Private closed-app data backup location | Local-only `output/r115-e-execution-20261001/backup-location.txt`; actual files outside repository |
| Remote policy | Current configured origin PUBLIC; push NOT_RUN, main NOT_MERGED |

Tag: `r1.15-e-productization-ai-center-ready-20261001`, created only after acceptance.
Source scripts/documentation can have a later handoff commit than packaged runtime;
the runtime commit is recorded separately. Do not rebuild an accepted installer and
reuse its old hash. Prior D/C installers, local tags and known-good releases remain.

### Owner actions and deferred work

Configure desired Provider API keys through the UI; local fixture success is not a
claim of paid cloud model success. Start an existing Ollama service if desired; the
release does not download models. Log into Weibo/Creator and Sohu Creator normally,
and update CNBlogs PAT through the secure input. Their switches remain OFF until
separately authorized current ordinary UI acceptance. No CAPTCHA/QR/real-name bypass.

Prompt variants are local text drafts. No autonomous publishing, batch publishing,
video/speech/image generation, large AI review agent, semantic factual guarantee,
remote automatic deletion or new website deployment was added. Current script
smokes intentionally use isolated data and local HTTP; production data and real
platforms remain outside the unattended test. No scheduled continuation exists.

No task-end dependency on the temporary Kangyi server account remains.
`SERVER_TEMP_ACCOUNT_CAN_BE_REVOKED=YES`. No server credential was used or reproduced
in E artifacts. Owner can revoke/rotate the earlier temporary access independently.


## 历史已验收发布能力与开关（本轮 E 不重复真实发布）

- Douyin 图文：普通 UI B01 已完成一次真实发布（Remote Work ID `7691247987888016655`），可信 ID 与唯一管理页 Published 确认后为 PUBLISHED_CONFIRMED；公开内容一致性独立为 FAIL（旧正文换行显示成字面 `*`）。Release 已改为逐段输入并保留严格正文回读，离线隔离编辑器测试通过；禁止为验证修复再发第二条。普通图文发布 ON，批量 OFF；支持每 Job 一个明确选择的账号、一张图片、标题最多 20 个 UTF-16 计数单位、公开、立即、无音乐。Smart Music deferred。
- Toutiao 图文：R1.15-D 普通安装版文章库 → 明确账号 → 手选同品牌封面 → 准备 → 发布中心确认完成一次真实发布。远端 ID `7691493900585910827`，唯一管理页 Published 和公开标题/正文均 PASS，重启保留原 Job/count=1。普通文章 ON、批量 OFF、视频创建和执行 OFF；只读历史回查保留。
- Weibo：历史真实发布证据保留；2026-10-01 当前应用自有浏览器停在 passport visitor 页面，无有效当前账号身份。Owner 登录阻塞，普通 OFF；本轮没有创建 Job 或提交。
- Sohu：历史 Published 证据保留；2026-10-01 当前页面是带登录入口的公开推荐流，不能当 Creator 登录。已修复 SPA 早期登录误判及后台页面释放顺序；Owner 登录阻塞，普通 OFF，本轮没有创建 Job 或提交。
- CNBlogs：Main 使用既有 SafeStorage 凭据执行官方 `/openapi/v1/corp/info` 返回 401。Owner 需安全更新 PAT；身份、额度及原帖更新/未知结果恢复合同仍需验证，普通 OFF，本轮没有远端草稿、Job 或提交。
- Website：康一 OfficialAPI V2 已完成 staging ARTICLE / CASE、真实响应丢失恢复，以及唯一 production 测试对象的普通安装版 UI 发布和重启验收。普通发布 ON，批量 OFF；支持封面、正文图、CASE 图库。SSR/图片保真独立于原发布 Job 成功状态，告警不触发重发。
- 其它平台按下表逐项开放。任何真实发布都需要精确账号、内容和一次提交范围的 Owner 授权。

## 技术栈与目录

- Electron 37 桌面应用，Main 管理敏感状态、持久化 Job、IPC、BrowserSession 和发布边界；Renderer（React）提供运营界面，不得直接读取数据库或完整 secret。
- TypeScript 严格模式；pnpm 工作区及锁文件；electron-vite 构建；ESLint、Vitest；Playwright Core 驱动应用自有浏览器；SQLite / better-sqlite3 与迁移；SafeStorage 保存敏感凭据。
- apps/desktop/src/main、renderer、preload：桌面主进程、界面和受控桥接。
- packages/domain：Article、Job 和发布领域模型；packages/db：Repository 和 migrations；packages/publisher：队列、准备、一次性提交及回查。
- packages/adapters：各平台 PlatformAdapter；packages/security：敏感信息与边界；packages/ai、image、logger：配套能力。
- tests/ 与各模块独立测试记录核心不变量。package.json 定义准确的脚本和打包资源。

better-sqlite3 是原生模块：普通 host Node 与 Electron 的 ABI 可能不同。生产 Repository 写入及验收任务应由项目认可的 Electron 兼容运行时执行，不要让临时 host Node 脚本直接写 production publisher.db。schema 改动必须以 migration 完成。

## R1.15-D 当前交付与继续开发入口

canonical checkout 是 `D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher`。交付分支 `release/2026-10-01-r1.15-d-multiplatform-sprint` 从 R1.15-C 最终 tag/HEAD `9b8bf10eae6edd8746cd32e3dd9dc9cd9c7b51e0` 开始；本轮 fetch 后 `origin/main=d2aa3c3f2c173c186c567421bbc4657ae32eec45`，没有 reset 或覆盖后续抖音和官网开发。最后运行时代码与正式包 source commit 为 `9b7232114ca33ad47a463c374472224d3699d79e`；最终文档提交与 local tag 的 HEAD 用 `git rev-parse r1.15-d-multiplatform-ready-20261001` 查询，不冒充运行时代码 SHA。

完整状态和阻塞项见 `docs/releases/R1.15-D-READY.md`。正式安装包为 `output/r115-d-department-release/Geo Media Publisher Setup 1.1.9 - R1.15-D MULTI-PLATFORM RELEASE.exe`，101219536 bytes，SHA256 `6584455e22ced2cab3e9554272ed63760ba56fe06a77cf8785f43e62cabf7d2c`；安装版 app.asar SHA256 `42ca1b6c75871afafa7b263674158803d0ba6fa77751ac9bad109e7792f1b1bb`。最终串行全量 188 文件 / 1348 测试 PASS，typecheck/lint/build PASS；正式包字节一致性、grant/敏感资源缺席、两次普通启动和重启 smoke PASS。当前为部分平台就绪：新增今日头条 ON，其余三个平台保持 OFF。本轮没有网站/server 部署，不触碰汇泉、树派、其它平台 Adapter 业务代码；公共 BrowserSession 默认行为不变。

### 今日头条普通运营 SOP

1. 使用本轮正式安装包，在普通 production-data 启动，不设置实验 submit、capture、readonly-preflight 或 Candidate 环境变量。账号中心通过正常登录检查，当前 Creator ID 必须与 Main 持久身份一致；数据库的旧 logged_in 不是充分证据。
2. 在正确企业的文章库选择已经审核的纯文本文章。打开发布抽屉，选择今日头条，明确选择账号；即使只有一个账号也不自动代选。手动选择一张启用、文件存在、同品牌 ImageAsset。当前支持普通段落与一张封面，不推广 HTML、视频、tags、定时或批量能力。
3. Main 在创建 Job 前校验标题/正文、图片归属和当前 Creator 页面/权限。Publisher 使用所选 ImageAsset 作为唯一图片来源，旧 Article/Variant coverAssetId 不覆盖手选图片。准备阶段实读编辑器标题、正文和上传完成证据，冻结 ARTICLE_BROWSER、preparedInputHash、expectedCreatorId。
4. 发布中心对 AwaitingConfirmation 的原 Job 显示“确认并继续发布”。实际最后动作之前重新校验冻结绑定，通过既有原子 claim 记录 final_submit_count=1。发布期间不要切换进程、账号、素材或 transport。
5. 如果返回未知结果，只在原任务使用只读查询。当前账号的唯一 Published 管理行、可信数字 ID、可信公开 URL 和目标匹配证据确认 PUBLISHED_CONFIRMED。公开标题、正文、可达性单独记录 PASS/FAIL/LIMITED；保真失败不能触发再次发布。
6. 提交前重启可在相同原 Job/Record、相同冻结内容/账号/transport 和 count=0 下显式恢复准备；成功后返回 AwaitingConfirmation。提交后重启只能只读恢复。旧视频和 ARTICLE_WEB_API 任务不可借新文章开关执行。

### 本轮唯一已完成作品

Main Job `7a3d52b5-c0aa-41dd-8f93-2fd11e2d4a3a`；Record `8b1f833e-cfb5-4a72-97be-7569417ea301`；远端 `7691493900585910827`，`https://www.toutiao.com/item/7691493900585910827/`。Job Success、Record Published、remote_status=PUBLISHED_CONFIRMED；SubmissionIntent 沿现有合同保留 Submitted、final_submit_count=1。公开标题和正文 PASS，安装版重启 PASS。禁止再次执行、创建替代 Job 或借其重复验收。

### 当前 Owner 阻塞与后续动作

- 微博：在账号中心进行正常登录/验证，取得当前稳定身份；历史专属普通帖子实现须按当前页面最小恢复，再做新的独立一次验收任务。
- 搜狐号：正常登录到 Creator 管理后台并完成必要验证，核对当前身份；公开推荐流不能当登录成功。之后按原 prepare/final/reconcile 合同进行新的独立验收。
- 博客园：通过 Main 的安全 credential 输入更新 PAT，先验证官方 corp/info、blogUrl/额度和稳定身份；再确认单一原 post 更新/发布、未知 create 结果恢复的正式合同。现有 prepare=create draft、final=create post 路径不得直接推广为普通发布。
- 私有 GitHub：本机只有 PUBLIC origin。源代码、tag 和 Release 在本地完成；未 push、未修改仓库可见性。Owner 配置明确私有 remote 后才可推送并按流程集成，不能向现有 public origin 自动上传。

### 验收授权与数据保护

R1.15-D Candidate 曾包含短期、精确 account/article/image/hash 的 package-owned 单次 grant，仅用于上述一个 Product E2E。正式包不含 grant 文件；它使用已验收的普通开关。Main 在最终异步边界再次检查临时授权过期，视频拒绝发生在任何 Candidate 例外之前。Scheduler 不获得批量权限。

正常数据备份在仓库外 `%LOCALAPPDATA%\GEO-Private-Backup\R115D-20261001-075618`，访问仅限本机受控用户。该位置含私有 DB/加密 credential，不提交、不上传、不自动删除。最终保护报告比较 65 表，integrity/foreign keys PASS，15 个明确预期元数据变化，非预期变化/删除=0；旧 Job/Record/Intent 不变，文章和图片行数不变，唯一新 Job 是本轮头条作品，既有加密 credential entries 全部不变。正常账号检查、所选文章审核/发布和所选图片使用元数据属于明确预期变化。

现有 Scheduler 的普通登录扫查会暂停旧 OAuth login_status=expired 的 Douyin 账号；本轮通过既有 Main IPC 恢复其原 enabled 开关，保持 expired 字段事实，不改 OAuth/Creator 登录状态、不写 DB 文件。该既有行为没有作为本轮无关优化修改。当前应用均正常关闭；以后真实发布仍需重新验证实际 Creator 会话。

## R1.15-C 康一官网继续开发入口（保留的已验收基线）

项目 canonical checkout 是 `D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher`。当前交付分支 `release/2026-09-30-r1.15-c-kangyi-officialapi` 从已有连接实现 `30acabdd6ca13e371145dd55153698608c41bfff` 续做，其父提交/可信 main 基线是 `d2aa3c3f2c173c186c567421bbc4657ae32eec45`。没有 reset 旧 HEAD 或覆盖后续抖音工作。最终 local tag 为 `r1.15-c-kangyi-officialapi-ready-20261001`；运行 `git show --no-patch <tag>` 获取文档交付 HEAD。main 没有自动合并，PUBLIC origin 没有自动 push；配置 Owner 私有 remote 后再正常推送此分支/tag，并按项目流程集成。

核心入口：`packages/adapters/official-api/src/` 包含 frozen mapping、durable runtime 和 generic OfficialApiAdapter；`packages/cms-v2-client/src/` 包含当前合同、签名、精确请求 bytes、private media 校验及原发布响应恢复；`apps/desktop/src/main/official-api-*` 管理安全账号导入、内容/图片冻结、SQLite journal、Main 控制器和独立公开内容校验。Renderer 的 `OfficialApiConnections`、`OfficialApiPublishSettings`、`OfficialApiJobControls` 通过 strict IPC 调用 Main，不能读 secret、任意远端 contentId 或 exact request。

当前安装依赖实际版本：Electron 37.10.3、React 19.2.8、TypeScript 5.9.3、better-sqlite3 12.11.1、Vitest 3.2.7、electron-vite 4.0.1、electron-builder 26.15.3、Playwright Core 1.62.1、image-size 2.0.4；开发验证 Node 24.19.0、pnpm 11.19.0。以 lockfile、已安装 package 和安装版 `process.versions` 为后续核验来源。

### 正式服务器合同与环境

| 项目 | staging | production |
| --- | --- | --- |
| 网站 | https://staging.kangyihb.com | https://xn--4gq502b.com |
| siteId / environment | kangyi / staging | kangyi / production |
| Publishing API prefix | `/_publish-api/v2` | 同左 |
| root | `/www/kangyi/cms/staging` | `/www/kangyi/cms/production` |
| 可写 keyId | staging-editor | production-admin |
| GEO account ID | 6894966b-7e69-4740-834f-ca8842fe9466 | 54fde62d-68e0-4aa3-91a9-8afb8217c70d |
| CMS / Site port | 19230 / 19231 | 19240 / 19241 |
| CMS unit | kangyi-cms-r2-staging.service | kangyi-cms-r2-production.service |
| Site unit | kangyi-cms-r2-staging-site.service | kangyi-cms-r2-production-site.service |

两环境 current 均指向 `releases/fcc39c01d38211ecde42c95665b1272f8773ab1efa3e7328988fe737cb208406`；实际 runtime/package source commit 均为 `8ac541c5518e44e3b1f23c0b9d9169ba0d0460fd`。OpenAPI 3.1.0 / info.version 2.0.0，health protocolVersion 2，OpenAPI 文件 SHA256 `a1c562a796ac1793b1fbf1448db1a754e4753d076f2af7167516ba5c22c5a3c4`。本任务不部署 CMS，不改 schema、revision model、HMAC、Nginx、site release 或 production-editor 的只读权限。服务路径和端口不是永久假设，下次操作前仍需重新读取当前配置、systemd 和 symlink。

HMAC secret 来源是服务器各环境保护配置 `r2-admin.json`，GEO 通过 Main 原生文件选择导入到 `%APPDATA%\codex-media-publisher\production-data\credentials.enc`，由 Windows 当前用户的 Electron SafeStorage 加密。受限中转文件在仓库外，导入后立即删除。Renderer、SQLite、source、logs、ready.md 和 Git 不存 secret。已有临时 SSH 访问只用于本次现场核验，部门 Release 运行不依赖 SSH；Owner 可撤销该临时访问。不要把本机私有备份或加密凭据文件加入 Git。

HMAC 为8项 LF canonical fields、原始 UTF-8 secret，不能尝试 base64 解码 secret 或更改服务端协议。nonce 每次签名生成；写请求 key/exact body 则绑定原 operation 不变。JSON 上限1 MiB；media 上限8 MiB、40,000,000 pixels、最大边10,000，仅 JPEG/PNG/WebP。具体字段和 endpoint 用 integration contract 文档与真实 OpenAPI 对照。

### 员工普通 UI 操作

1. 账号中心查看“康一官网 OfficialAPI 连接”，明确区分测试与正式环境。已保存凭据在重新打开应用后需要重新验证；Main 校验 `siteId=kangyi`、精确 environment/keyId、protocol 2、支持的 article/case 与 writesEnabled。不得把只读或失效账号当可发布。
2. 从康一企业的普通文章库进入发布，选择官网及明确账号。填写摘要、可选 slug/category/keywords，选择封面、正文图片；CASE 还需地点、导语、服务重点和至少2张图库图片。其它企业的非通用素材不得混入。
3. 点击“准备官网内容”。Main 实读图片 MIME、尺寸、byte count 和 SHA256，冻结原文、设置、账号与素材 bytes；按媒体→create draft→update draft→latest readback→Validate 执行。cover/body/gallery 引用同一图片时去重上传，不用 URL hotlink。
4. PREPARED 后仍需一次“确认并发布官网”。Publisher 使用原 Job/SubmissionIntent/PublishRecord，原子 claim `final_submit_count=1`；publish 前重新校验 live health/caps、完整 revision/hash/rowVersion 与 private media。202 表示 Publishing。
5. 在发布中心“查看详情”按原操作恢复，轮询原 remote Job。只有原 Job succeeded 且可信同 scope publicUrl 才记 Publish Success。raw SSR HTML、正文、图片 HTTP/SHA 为独立 fidelity 结果；告警永远不允许第二次发布。
6. 维护只能由本地原 Job 驱动。普通生产可下线、移入回收站、恢复；永久清除要求 staging 的显式 test-only run/purge 权限，生产普通内容不具备此授权。每个202维护 Job 必须按原 Job 查询并做 content/tombstone readback。

### 不确定结果与恢复边界

0030 migration 新增 `official_api_operations`，以本地 job_id 唯一绑定原 source/account/scope/content hash；每步先持久 exact bytes/body SHA/operation key 和 DISPATCHING，再请求。CAS 防止并发覆盖，Publisher 全局正式并发仍为1。prepare 重复调用只能复用原 journal；内容变化后拒绝自动创建替代远端对象。

- 有 mediaId 的 private verify 失败：保留上传身份，只读 signed GET 恢复，不能再上传。
- media POST 丢失且无 mediaId：当前合同缺少 operation/media-by-idempotency 查询，明确 `ARCHITECTURE_GAP`，保持 NeedsReconciliation，不盲目重传。
- create 未知：以完整 site/environment/principal/externalId 和冻结 draft 的唯一匹配寻找原对象；draft 未知：读回精确内容与更高 rowVersion，不能直接重写。
- publish 响应丢失：先 GET 核对原内容、revision/hash，只有当前 rowVersion 严格超过原 publish body 的旧值，才允许以原 key/same exact bytes 读取原48h幂等缓存202。实际部署代码在 cache miss 时先拒绝旧 rowVersion；缓存过期409不能产生第二 Job。身份不符、版本未前进、证据缺失均停止，禁止换 key 重发。
- final preflight 在 claim/publish-step 前失败：只允许无任何远端提交身份、final counter0、原 operation PREPARED 的同一 intent 恢复 Prepared，保留原 attempt 和 Job；一旦 claim或publish-step存在，绝不清零重来。
- 维护 Job 当前 revisionId/contentHash 是 null/null；202和后续GET都校验保存的 exact nullable binding。只有本地 step SUCCEEDED、remote succeeded 和状态读回全部完成才显示 DELETED/CLEANED；失败显示原维护错误，needs_attention 保持可恢复。
- 临时 Candidate grant 有进程内过期检查，异步读图/最终 preflight 后再次检查；正式 Release 不含 Candidate marker。

### 本轮真实验收和清理状态

| 对象 | local Job | remote content | 原 publish Job | 最终状态 |
| --- | --- | --- | --- | --- |
| staging ARTICLE | e978a8c5-46b5-4f81-b7f9-46f16e800ab0 | de42cf4d-9c2d-4d14-9fe5-455096c9ef8b | e9a08e47-09c2-4106-843a-f2ce14ca4f3e | CLEANED，公开404，三媒体删除 |
| staging CASE | 77e10f29-264f-4741-9168-830168f31762 | e8d20256-3587-4e44-ab11-f51d49b70c1e | 885bb17a-2b8d-4b8d-9bba-a47a76f3dac0 | CLEANED，公开404，三媒体删除 |
| production ARTICLE | 7c64dca3-c30f-4f35-b029-161c284a5f38 | 6a81e7ff-d239-47b2-99b5-aa09e28337df | efd97474-7572-4606-b046-2d03200cc848 | soft-deleted，公开404，三媒体按现有策略保留 |

全部使用 normal production userData 的真实安装版 Main/Preload/普通 UI。staging ARTICLE 在真实202返回后丢弃响应，应用重启从原请求恢复同一 Job；每个对象只有一次 logical publish，重复 content=0。CASE cover+body+gallery 去重为3张，raw SSR和图片校验通过。两条新 staging acceptance run 各1 content/3 media；清理后使用现有 sweeper 删除仅本任务媒体，移除仅本任务新增 keys，原配置 bytes/owner/mode恢复，旧 run/key不变，业务10 article+48 case恢复。

staging 保留既有 Nginx Basic Auth；GEO 匿名公开 fidelity 返回 `PUBLIC_PAGE_UNAVAILABLE`，原 Job Success仍保留。服务器进程内安全使用既有 HTTP auth，独立实际 HTTPS raw SSR/cover/body/gallery 全部200；没有为测试修改 Nginx 或关闭 verifier。production 无这一屏障，原始 SSR、实际浏览器 URL/DOM和3张media均PASS，publicContentVerified=true。

production 只用一个明确系统验收 ARTICLE、一个3媒体组和一次 logical publish，共用普通 UI E2E。维护顺序 unpublish→delete→restore→delete；最终公开404、active published 25 article+59 case=84，与验收前一致。当前生产对象 is_test=0，不能 purge；其封面 `ee085180-27b4-4cd0-abe1-5da4e30515f0`、正文 `cdbae25f-1c0b-4833-a865-9039612de5c0` / `d651dc8e-bad6-407d-a6e7-840aafe462c5` 为合成验收图片，按现有孤儿媒体策略保留，公开 media/cache 可能仍200。这是明确的清理限制；不得伪造 test-run、改权限或手工删除服务器 media。

### 当前部门安装包身份

FINAL_STATUS=R1_15_C_KANGYI_OFFICIALAPI_READY。文件：`output/r115-c-department-release/Geo Media Publisher Setup 1.1.9 - R1.15 KANGYI WEBSITE RELEASE.exe`，101217340 bytes，SHA256 `31b3729b616faa3572e59ad3be5b74896c046a9b2a6ffd22f45f0f1f1bb0e24f`。安装版 app.asar SHA256 `7efc90afd43fe5f7377acd2c7e4d70bb0c46a2c06f42c2128b67db9f191ec34f`；运行时代码 source commit `86727b9250135282ab2fa247fe1a5dc3f5f791b5`。安装版1.1.9 / Electron 37.10.3 / Node 22.21.1 / ABI 136。两次正常 production-data smoke、双环境真实连接和历史任务终态 PASS，无新增远端写。全量184files1332tests serial PASS，typecheck/lint/build PASS，秘密扫描PASS。local tag `r1.15-c-kangyi-officialapi-ready-20261001` 解析最终文档 commit；private Git push=BLOCKED_BY_OWNER_CONFIGURATION。

### 验证、安装包和继续开发

最终验证状态和安装包身份以 `docs/releases/R1.15-C-READY.md` 为准。本轮 focused client/runtime/Main/UI/mapping/IPC/policy 和全量测试均保留原断言。并行运行观测过1项既有 Douyin popup fixture 和5项新 private-media HTTP fixture 失败；各自 standalone PASS，最终 serial 全套1332 PASS。未证明这些并行不稳定观测的具体根因，不能冒称全部默认并行执行稳定；没有删/skip或修改 Douyin。建议验证命令：

```powershell
pnpm install --frozen-lockfile
pnpm rebuild better-sqlite3
pnpm exec vitest run --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm build
pnpm rebuild:native
pnpm exec electron-builder --win nsis --x64
```

先完成 host Node tests，再把 better-sqlite3 编译为 Electron ABI。安装版只读 smoke 用实际正常 production-data；宿主脚本读取保护副本或原始文件字节，不直接写生产数据库。新安装包单独命名 `Geo Media Publisher Setup 1.1.9 - R1.15 KANGYI WEBSITE RELEASE.exe`，保留此前所有 release/candidate。正式包无 Candidate marker、无 secret/业务 DB/StorageState。回退桌面应用需关闭所有实例、保留当前 DB+WAL+SHM+credentials 受控备份，再选旧安装包；0030为 additive，不能直接删除业务数据或回滚到不能理解新 journal 的流程后重发旧任务。

继续开发按 `docs/integrations/official-api-site-template.md` 使用 `OfficialApiAdapter + SiteConfig`；目前正式支持仅康一，汇泉/树派需单独现场合同、品牌、账号和验收，不能复制代码就开启。媒体无身份查询、无完整 media library 和 production orphan-retention 是当前已知限制；涉及服务端合同扩展需要另行明确范围。下一项平台工作另由 Owner 授权，本任务完成后停止。

## 普通运营平台定位

R1.15-C 当前 durable milestone：康一 OfficialAPI V2 的真实部署合同、Main 文件导入 SafeStorage、双环境账号、冻结 ARTICLE / CASE 映射、媒体与草稿准备、一次确认提交、原 Job 查询、重启恢复和受控维护均已实现并通过真实验收。Website ordinary=ON / batch=OFF；Douyin ordinary=ON / batch=OFF；其它门禁及10平台顺序不变。正式部门安装包、source commit、SHA256 和完整状态字段见下方及 `docs/releases/R1.15-C-READY.md`。当前 PUBLIC origin 仍未推送本轮；`PRIVATE_GITHUB_PUSH=BLOCKED_BY_OWNER_CONFIGURATION`，只阻塞私有 GitHub 交付，不阻塞已验证的技术 Release。

GEO 正常 production-data 新增两条 Website 账号、三条系统验收源文章及其原始 Job/journal；0030 migration 由安装版 Main 应用。对验收前受保护快照的64张既有业务表逐项比较，旧业务字段保留；一条 Douyin enabled 开关恢复到原值，普通 Main 更新留下两项真实时间戳变动。既有加密凭据条目完全相同；新官网凭据只存 SafeStorage 加密文件。没有重发 Douyin、改写其历史 Job/Intent/Record 或伪造登录状态。

HISTORICAL PRODUCT UI STATE（R1.15-C Website Release）：当时 Douyin 和 Website ordinaryPublishEnabled=true，其它八个平台 ordinary=false。R1.15-D 当前新增 Toutiao 普通文章 ON，完整当前状态以本文件顶部和 R1.15-D READY 为准。首页、账号中心、发布抽屉、发布中心和统计继续使用相同十平台顺序；所有 batch=false。显示不等于可发布，正式包不含 Candidate grant。员工从内容库选择明确账号和图片，准备后确认一次提交；DB logged_in 不能代替当前远端身份。历史 B01 任务仍保留原门禁。

保留的 R1.15 Douyin milestone（历史，不是本轮下一任务）：已将 Douyin Publish Success 与 Public Content Fidelity 分离。发布成功必须有持久 final_submit_count=1、可信 Remote Work ID、唯一且同一目标的 Published 管理证据；公开内容另记 PASS / FAIL / LIMITED。公开内容失败只告警，不触发 retry、第二次点击、替代 Job、Node/API replay 或 transport fallback。正文输入不再 bulk fill 多行，而通过编辑器 Enter 创建段落、逐段插入，再严格回读完整正文；不会把 `*` 忽略或归一化为换行。三段隔离 Slate 事件/DOM fixture 通过；本轮没有第二次真实发布，因此修复后的公开平台序列化未另行实发复验。

当前 B01：PUBLISH_RESULT=PUBLISHED_CONFIRMED，MANAGEMENT_PAGE_VERIFIED=PASS，PUBLIC_CONTENT_VERIFIED=FAIL，质量告警 BODY_LINEBREAK_RENDERED_AS_LITERAL_ASTERISK。Article `11c657d8-157a-47f9-97ae-071391c30ba7`，短 marker `B01-E30344`；Image `19e321db-6fb0-4f8b-ba40-255e19cc4d6c`，Main 实读 SHA256 `9427f88b5c190102dfcc1a03a9dc9031540dbdb3a0c26bda22ceaaadbf9a66aa`。授权 `74c08921-5278-475a-aab3-d840687d60bb` Consumed；Job `ee500df1-8dd7-4cae-b047-dece77884874` Success；Intent `5f2f0c33-0f8b-4c2b-b068-78eaa88cbbcc`；Record `f79087cb-b574-4c46-b22e-f6311106f54d` Published。Remote Work ID `7691247987888016655`，实际观察的公开 URL https://www.douyin.com/note/7691247987888016655 。一次 final claim、一次 BrowserNative final action、一次真实发布，Node replay=0，重启持久化正常。

迁移 `0029_douyin_publish_content_outcome.sql` 仅新增独立结果/质量表，为这个精确已发布作品追加解释；原 Job / SubmissionIntent / PublishRecord、Remote Work ID、冻结内容和 final_submit_count 不变。原 Intent.remote_status=PUBLISHED_MANAGEMENT、Record.verification_status=WaitingUser、原公开证据仍原样保留，不篡改成正文保真 PASS。Repository/UI 读取独立结果层显示“已发布 / 公开内容不一致”，禁止重发。迁移在受保护生产副本上首次应用及重启通过，原既有业务表逐表内容未变；生产快照只留本机，不上传。

Release identity / validation：`Geo Media Publisher Setup 1.1.9 - R1.15 DOUYIN RELEASE.exe`，SHA256 `CCD6BBFC1C0129B6F7B46997F906197868881FC3A93BD47B45723E7AB964C021`；`app.asar` SHA256 `BF66B578639E5AF6C8376838E1C381F6F85E797A41D51C00160FDBD5F3D4D2A1`。typecheck / lint / build 全部 PASS；full suite 170 files / 1165 tests PASS，无 skip。NSIS 安装和 Main/Renderer 包内字节一致性通过；显式隔离 userData 与正常 production userData 的首页、文章、图片、账号、发布详情、统计及重启 smoke 通过，B01 入口隐藏，未验证账号仍禁用。实际生产迁移后逐表对照保护快照，原 62 个业务表完全未变；当前及历史 unresolved Job/Intent/Record 未变、提交总计数不变，integrity / foreign_key check PASS，独立 outcome 表一行。本轮 REAL_PUBLISH=0、FINAL_CLAIM=0，不访问真实 Douyin。历史 R1.14 FINAL、Candidate R2/R3/R4 和 HOTFIX 不覆盖、不删除。B01 Product E2E 的发布成功已由 Owner 按两层契约接受；旧作品公开内容 FAIL 将永久保留。HISTORICAL_NEXT_TASK=R1.15-B02_WEIBO_NORMAL_UI_PRODUCT_E2E；本轮不授权执行。

旧未提交 Job `76748f23-d2d5-4a18-baf8-4770e1b39118` 已经普通 UI/Main 永久取消，旧授权 `R1.15-B01` 为 Revoked；旧冻结内容/绑定保留且未改变。历史 unresolved Job `fc78bf51-812a-490e-91eb-a9320793adc2` 与其 Intent/Record 再次逐行对照受控快照确认完全未变；生产 integrity_check / foreign_key_check 通过。所有凭据、browser-profiles、受控快照、Git Bundle 和历史安装包继续保护。

暂时隐藏：视频号、公众号、腾讯新闻、闲鱼、58 同城、地方新媒体、权威媒体及其它当前没有业务需求的平台。隐藏是产品展示决定，不删除历史数据、账号、Job 或 Adapter；有新业务需求时重新评估能力与验收。

| 平台 | 最新已验证的证据范围 | 下一门禁 |
| --- | --- | --- |
| Douyin image/text | PUBLISHED_CONFIRMED；一个账号、一图、普通标题/正文、公开、立即、无音乐 | 普通 UI 发布成功已接受；普通图文 ON、批量 OFF；Smart Music deferred |
| Toutiao article | R1.15-D 普通 UI Product E2E PUBLISHED_CONFIRMED；公开标题/正文 PASS | 普通文章 ON，视频和批量 OFF；单账号纯文本单封面 |
| Weibo | 历史真实 PublishPassed=PASS；当前 visitor 页面 | Owner 登录和普通 UI 产品复验；OFF |
| Sohu | 历史 Published / Verified；当前公开推荐页 | Owner Creator 登录和普通 UI 产品复验；OFF |
| Website | R1.15-C 康一 staging ARTICLE/CASE、production 唯一对象与普通 UI Product E2E PASS | 普通 OfficialAPI ON，批量 OFF；汇泉/树派另行验收 |
| Xiaohongshu | 部分实现和测试；普通生产全链路验收未完成 | 保持门禁 |
| Baijiahao | CONTENT_EDITOR_NOT_VERIFIED | 编辑器与完整发布验收 |
| Zhihu | 历史 NeedsReconciliation | 旧未知 Job 只读回查，禁止重试 |
| Lieju | 风控/验证阶段，非最终 product-ready | Owner 验证与独立能力门禁 |
| CNBlogs | 现有 API 基础；当前 corp/info HTTP401 | Owner 安全更新 PAT，身份/更新/未知结果合同和普通产品 E2E；OFF |
| NetEase | 下一新增平台的计划 | 独立 Adapter 和独立测试 |

这些是截至归档时的状态，不是当前登录态。平台是否已登录必须重新由应用自有会话验证。

## 永久发布安全规则

全局正式发布并发为 1。每一次正式发布必须有持久化 Article/Job、SubmissionIntent 和 PublishRecord，且 Job Queue 可审计、可在崩溃或重启后安全恢复。平台专用 selector、登录判断、编辑器填写、设置、最终动作和回查必须封装在该平台的 PlatformAdapter；不要让某平台修复污染共享 Publisher 或其它 Adapter。

最终不可逆浏览器动作之前，Main 必须原子地把 final_submit_count 从 0 claim 到 1，并记录 submission attempt。claim 失败时不点击。claim 成功后，只允许该任务的一次最终动作；禁止再次点击、Node replay、API fallback、换 transport 或创建替代 Job 再投一次。超时、响应丢失、页面关闭和未知结果都进入 NeedsReconciliation，之后仅做只读管理页/公开页回查。HTTP 200、success toast 或页面跳转本身都不等于 Published。Douyin 必须有可信作品 ID 与唯一 Published 管理页确认才能 PUBLISHED_CONFIRMED；公开内容一致性为独立 PASS / FAIL / LIMITED 质量状态，不能触发重试。其它平台按其独立已验收契约执行。

准备阶段的内容与设置要严格回读，并与冻结的 account、Article、Job、标题、正文、图片、可见性、时机和已启用的附加功能绑定。失败在 final claim 之前应停在安全的 pre-boundary 状态；不要把未提交误记成 NeedsReconciliation，也不要为了赶进度跳过门禁。

## 浏览器、账号与安全验证

BrowserSession、BrowserContext、canonical app-owned Playwright Page 和稳定远端账号身份必须相互对应。DB 中的 logged_in 只是本地记录，不是当前平台身份或会话有效的证明。以应用自有 Page 的真实 URL、DOM、作品管理页和公开页作为平台事实来源；桌面窗口标题、无关浏览器标签、猜测的 public URL 和截图推断不能单独作为正式证据。

二维码、短信、CAPTCHA、滑块、设备确认、实名和风控挑战由 Owner 在平台正常流程中完成。自动化不得绕过、识别代填、伪造或破解。登录失效时暂停相应账号，不得无限重试。

禁止输出或保存明文 Cookie、Token、签名、StorageState、credentials 或 API Key；日志只保留有界脱敏摘要。未来 AI Provider Key 由 Main + SafeStorage 管理；Renderer 只取得 configured / not configured、遮罩显示与受控连接测试结果，绝不读取完整 secret。

## 一次正式发布的生命周期

1. 从内容库读取批准 Article，明确账号、平台、内容与素材；创建持久 Job，并做能力/授权/preflight。
2. 激活该账号的 BrowserSession，验证 Context 与 canonical Page 归属、平台 host、远端账号身份和登录代数。
3. 进入空白编辑器；在当前 Job 的唯一操作额度内上传素材、填写标题/正文/设置。对图片数量与加载、标题、语义正文、可见性和时机做严格 readback。
4. 只有被本任务明确启用的附加功能才进入其独立准备与回读；未启用音乐的 Core NO-MUSIC 路径不运行音乐 DOM 自动化。
5. Douyin B01 准备门禁通过后先持久化 Prepared PublishRecord，授权保持 Prepared（等待 Owner 最终批准）；此时尚无 SubmissionIntent。Main 在另一次 Owner 批准请求中重核冻结绑定、应用自有远端身份及编辑器严格回读，然后才可进入 FinalApproved。
6. 正式执行阶段才创建现有 SubmissionIntent；Main 在不可逆动作前原子 claim final_submit_count 0→1，同时消费 B01 授权。只在成功后执行一次 BrowserNative 最终动作。被动观察真实 Browser 响应，不重放请求。
7. 最终动作后只读 reconcile：Douyin 可信 Remote ID 与唯一管理页 Published 匹配后为 PUBLISHED_CONFIRMED；公开页完整标题/正文/图片回读单独记录 Public Content Fidelity。审核中、未通过、结果未知不得提前记成功。
8. 无论结果如何，保留 Job/Intent/Record、操作次数和证据。NeedsUserAction、NeedsReconciliation、Failed、Published/Verified 的区别不能用乐观猜测抹平。

## 本地开发与验证

Repository: https://github.com/1542651213/geo-media-publisher
Canonical branch: main
推荐 Windows 本地工作区：D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher。不同环境可在其它位置重新 clone；不要把用户名路径写入业务代码。

准备 Node.js 与项目锁定的 pnpm 11.19.0（可用 Corepack），再按仓库 package.json / pnpm-lock.yaml 安装。Windows 打包使用 Electron 对应的 better-sqlite3 native rebuild；不要把 host Node 的 native 产物覆盖正在运行的 Electron 安装版。

    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm lint
    pnpm build
    pnpm rebuild better-sqlite3
    pnpm exec vitest run --maxWorkers=1

纯源码仓库可能不跟踪 output/。若测试依赖这个目录，先在仓库根目录创建空 output/，再运行完整测试；不得删测试、skip 或降低断言。R1.14 纯源码基线在受限并发下通过 158 个测试文件、1110 项测试，typecheck、lint、build 均通过。修改平台 Adapter 后运行其独立测试及完整回归。真实平台验收与离线测试是两种证据，不能互相冒充。

生产数据位于 %APPDATA%\codex-media-publisher，可能包含 publisher.db、credentials.enc、browser-profiles、media 和 Session 状态。DO NOT DELETE；DO NOT COMMIT；DO NOT UPLOAD。开发测试使用隔离数据，不把 production-data 带入源码或公开 Release。

## 正式 Release 与历史恢复

历史安装包（继续保护）：Geo Media Publisher Setup 1.1.9 - R1.14 FINAL.exe。SHA-256：417D94CD4CD47569C40E5F0B55339A2069F3DA1618785AAD6A048A5D4BBE6214。GitHub Release Tag：geo-media-publisher-r1.14-20260928。安装包是 Release Asset，不加入 Git 源码历史；R1.15 使用独立新安装包，不覆盖这个历史文件。

| 保留 Tag | 指向的提交 | 原分支/用途 |
| --- | --- | --- |
| geo-media-publisher-r1.14-20260928 | 85707e7bec68c01f3959d8447e61ab0b359b133f | R1.14 纯源码 Release |
| archive-website-adapters-20260928 | 901e2ea7f97c451aa1efc5fdd7bbe53ec8f71aca | Website Adapter |
| archive-toutiao-r1-20260928 | eb73b62e76ab2486fadbd09a074bbe22ed12d630 | Toutiao BrowserNative R1 |
| archive-xhs-task10w-20260928 | 8782e6cc4f70067ebb00746d21aaa7cd1c2fc261 | Xiaohongshu Task10W |
| archive-r67-docs-20260928 | 29efcb6da7881232fe97d22447410c9cb1e789c0 | R67 文档 |
| archive-sohu-k2-residual-20260928 | 1ac96b5bade1dd2116c0d9d5587d26360438e1e2 | Sohu/K2 残余源码 |

已有的 XHS 历史 Release/Pilot Tags 同样保留。Tag 让已退休分支的确切公开提交可恢复。完整原始 all-refs Git Bundle 只保存在受控的本地私有归档，可能含历史 private material；不要上传 GitHub、附件或工单。详细历史见 Git history、Tags、PROJECT_STATE.md 和平台 runbook；不要把 ready.md 改成流水账。

## 下一阶段路线

- Phase A：R1.15-A01 已完成普通运营平台白名单和 UI 收口；隐藏不再需要的平台入口，同时保留历史数据。
- Phase B：正式安装版普通用户路径 Product E2E，优先 Douyin、Weibo、Toutiao、Sohu、Website。测试真实 UI/IPC/账户选择/Job/回查，不以独立 runner 成功代替产品验收。
- Phase C：分别完成 Xiaohongshu、Baijiahao、Lieju、CNBlogs 的身份、编辑器、内容、唯一 final submit、回查及普通 UI E2E。
- Phase D：新增 NetEase 独立 Adapter 和独立测试，复用既有 Job、Intent、Record、BrowserSession 与一次性边界；不另造发布框架。
- Phase E：AI Provider Center，优先 Xiaomi MiMo。提供 Provider/Model 下拉、Default Model、API Key 的 Main/SafeStorage 管理和 Test Connection，再支持 OpenAI、DeepSeek、Ollama、Custom OpenAI-Compatible。数据库仅持久化 provider、model、baseUrl、configured 等非秘密元数据，不存明文 Key。

路线图是计划，不是当前能力声明。

## DO NOT

- DO NOT second-submit 结果未知或已 claim 的作品；不以替代 Job 重发。
- DO NOT 绕过 CAPTCHA、短信、扫码或实名验证。
- DO NOT 记录或上传 raw Cookie、Token、签名、StorageState、凭据、API Key。
- DO NOT 用 DB logged_in 代替当前远端账号身份。
- DO NOT 拼猜公开 URL 或只凭 toast / HTTP 200 写 Published。
- DO NOT 在普通 UI Product E2E 前打开批量或普通正式提交开关。
- DO NOT 因 Adapter 单测通过就宣称平台生产可用。
- DO NOT 删除或上传 %APPDATA%\codex-media-publisher。
- DO NOT 上传本地原始 Git Bundle 或历史私有备份。
- DO NOT 无产品需求地恢复隐藏平台入口。

## 接手 Checklist

1. 先读本 ready.md、AGENTS.md、当前平台 runbook 与目标模块源码。
2. 运行 git status 和 git rev-parse HEAD；核对当前 main、工作区是否干净及是否有用户未提交改动。
3. 查目标平台最新的持久状态、能力边界与账号授权；旧日志不能代表当前登录态。
4. 设计任何真实发布前先明确唯一 Article/Job、素材、内容、账号和提交额度；保护 final_submit_count 一次性边界。
5. 改动只在相应 PlatformAdapter 与必要公共模块中进行；用独立测试、typecheck、lint、完整测试和 build 验证。
6. 将新里程碑的 CURRENT STATE、长期架构规则、最新已验证平台状态与 NEXT ACTION 更新到 ready.md；详细过程放入 Git 提交、Tag、证据和平台 runbook，不堆积流水账。
