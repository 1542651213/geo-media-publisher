# Project State

## Task 10G Creator Home readiness / DOM topology diagnostics — DIAGNOSTICS PASS / DEPLOYMENT BLOCKED - 2026-08-31

本轮仅围绕 `platformKey=xiaohongshu`、`accountId=54b390ac-d81e-440a-baeb-d00f9f346cc3` 完成离线 diagnostics hardening。没有登录、checkLogin、live PRE-SUBMIT Gate、SELF_TEST、preparePublish、标题/正文/图片 mutation、草稿保存、发布设置修改、final submit 或真实发布；没有创建 Job、SubmissionIntent 或 PublishRecord。

### Task 10G status

| Item | Result |
| --- | --- |
| Task 9C / single canonical XHS session | `PASS` / `LIVE VERIFIED`（既有 evidence；本轮未改生命周期架构） |
| Task 10B | `PASS` |
| Task 10C | `PASS` |
| Task 10D implementation | `PASS` |
| Task 10F | `PASS_DIAGNOSTICS_ONLY`; publish resolver behavior unchanged; selector fix not applied |
| `CREATOR_HOME_READY` | 当前仍是 Creator host/path + 非 login/verification URL 判定；不要求 DOM shell，confidence `LOW`，`POSSIBLE_FALSE_READINESS=YES` |
| Task 10G | `PASS_DIAGNOSTICS_ONLY` |
| Task 10A live Gate | `NOT_RUN`（本轮明确禁止） |
| `TASK_10A_RETRY_READY` | `NO`；Task 10G staging 未部署，等待活动 XHS profile 正常关闭 |
| `XIAOHONGSHU_RUNTIME_SESSION_READY` | `NOT_VERIFIED_AFTER_DEPLOYMENT` |
| `READY_FOR_REAL_SELF_TEST` | `NO` |

Task 10G 新增了 bounded `inspectCreatorHomeReadiness` / readiness observation、Creator Home topology、publish semantic node 与 nearest interactive ancestor、same-origin/cross-origin iframe metadata、open shadow-root metadata、bounded accessibility signals，以及 operation-correlated diagnostics events。diagnostics 只读，不改变既有 `findPublishEntry` 的实际选择或点击策略；下一次 live Gate 才会取得真实的 `PUBLISH_SEMANTIC_NODES_OBSERVED` 内容。

### Verification and package

| Check | Result |
| --- | --- |
| XHS focused diagnostics/Gate/editor/canonical/mutex/heartbeat/analyzer tests | `6 files / 127 passed` |
| Full tests | `85 files / 604 passed` |
| Typecheck | `PASS` |
| Lint | `PASS` |
| Build | `PASS` |
| Staging packaged diagnostics | `PASS` |
| Staging app.asar | `release-task10g-20260831-final2/win-unpacked/resources/app.asar` |
| Staging app.asar SHA256 | `135FE293ACCA1A7F6F76131708A796D07749F0FD2F61A51EC5C7630825BA71F8` |

The staging package contains the Task 10G readiness/topology/semantic/frame/shadow markers plus the existing Task 10D candidate/editor/failure markers. It targets Electron `37.10.3` / native ABI `136`.

### Deployment boundary and production safety

```text
DEPLOYMENT                         = BLOCKED_ACTIVE_XHS_PROFILE_SESSION
INSTALLED_PROCESS_COUNT            = 4
XHS_PROFILE_PROCESS_COUNT          = 9
XHS_PROFILE_LOCK_OWNED_BY_PROCESS  = YES
INSTALLED_APP_ASAR_SHA256          = ED6196B824A2350F803203B1445C46E86980510C133C719E981C2144B9AA8074
ROLLBACK                           = NOT_CREATED

DB_BEFORE                          = publish_jobs 15 / submission_intents 12 / publish_records 9
DB_AFTER                           = publish_jobs 15 / submission_intents 12 / publish_records 9
PUBLISH_DOMAIN_UNCHANGED           = YES
FINAL_SUBMIT_COUNT                 = 0
JOB_CREATED                        = NO
INTENT_CREATED                     = NO
PUBLISH_RECORD_CREATED             = NO
LIVE_PRE_SUBMIT_GATE               = NOT_RUN
SELF_TEST                          = NOT_RUN
REAL_PREPARE_PUBLISH               = NOT_CALLED
```

Owner 下一步只需正常关闭 installed app 与 XHS BrowserSession；之后可部署此 staging package，再由 Owner 登录一次、等待 heartbeat、点击一次 Gate 取得真实 DOM topology evidence。

## Task 10D hardening / Task 10A evidence readiness — IMPLEMENTATION PASS / DEPLOYMENT BLOCKED - 2026-08-30

本轮严格限定在 `platformKey=xiaohongshu`、`accountId=54b390ac-d81e-440a-baeb-d00f9f346cc3` 的离线源码、fixture、只读日志分析和 staging package。没有 Owner login、XHS checkLogin、live PRE-SUBMIT Gate、SELF_TEST、真实 `preparePublish`、标题/正文/图片 mutation、草稿/保存、final submit 或真实发布；没有创建 Job、SubmissionIntent 或 PublishRecord。

### Readiness status

| Item | Result |
| --- | --- |
| Task 9C | `PASS`; single canonical Context/Page、session reuse、live status sync 已由既有证据验证，本轮未重新打开该架构问题 |
| XIAOHONGSHU single canonical session | `LIVE VERIFIED`（既有 Task 9C evidence） |
| Task 10B | `PASS` |
| Task 10C | `PASS` |
| Task 10D implementation | `PASS` |
| Task 10D deployment | `BLOCKED_ACTIVE_XHS_PROFILE_SESSION` |
| Task 10A live Gate | `NOT_RUN`; remains pending Owner-controlled retry |
| `TASK_10A_RETRY_READY` | `NO` because Task 10D was not deployed |
| `XIAOHONGSHU_RUNTIME_SESSION_READY` | `NOT_VERIFIED_AFTER_RESTART` |
| `READY_FOR_REAL_SELF_TEST` | `NO` |

### Task 10D review and diagnostics

The verified Gate call chain is:

```text
Renderer button
→ V11Workspace.inspectPublishEditor
→ runPreSubmitGateWithHeartbeats
→ preload accounts.inspectPublishEditor
→ IPC accounts:pre-submit-gate
→ adapter.inspectPublishEditor
→ accountOperationMutex.run
→ inspectPublishEditorOnCanonicalPage
→ assertProfilePageCanBeRead
→ navigateToImagePostEditor
```

`inspectPublishEditorOnCanonicalPage` now creates the operation correlation ID before canonical lookup and records structured failures for unavailable/closed/disconnected/foreign Context cases. Browser/page lifecycle early returns emit both inspection-start and navigation-failed diagnostics; ownership and lifecycle failures are not silently converted to a generic `needs_user_action` result. `assertProfilePageCanBeRead` remains fail-closed: Creator host plus at least two unique positive signals are required, login/security blockers have priority, and unreadable page evidence no longer silently proceeds through the Gate.

`AUTHENTICATED_PAGE_SIGNAL_SOURCES` are: sanitized Creator URL classification, visible Creator DOM positive signals (`发布笔记`, `笔记管理`, `数据看板`, platform title, account-status text), and visible account identity markers derived from stable profile URLs/account fields/nickname areas. The classifier uses an `AND` strategy for Creator host plus two unique positive signals, with login/security blocker priority; URL alone is never accepted. Account isolation continues to rely on account-scoped Session/Context ownership and real `Page.context()` matching, including foreign-context and account A/B regression coverage.

`navigateToImagePostEditor` now covers already-reached `/publish/publish`, Creator root and `/new/home`, direct image entry, generic publish-menu plus content-type selection, missing/click-failed entries, route timeout, route-not-reached, login redirect, security verification, and final `UNKNOWN_UI_STATE` fallback. All entry steps retain operationId, platformKey, accountId and sanitized URL transition data.

`PRE_NAVIGATION_EARLY_RETURN_PATHS` are: canonical lookup exception; no active canonical Page; Page/Context ownership mismatch; disconnected BrowserSession; closed canonical Page; and authentication evidence rejection. Each path now leaves correlated structured diagnostics; the editor helper is not invoked on any of them.

### Task 10A evidence analyzer

Added [scripts/v143-xiaohongshu-task10a-evidence.mts](C:/Users/Administrator/Desktop/codex_media_publisher_starter/scripts/v143-xiaohongshu-task10a-evidence.mts) and its pure parser at `scripts/v143-xiaohongshu-task10a-evidence.helpers.ts`. It reads JSONL `app.log` plus a production SQLite database through a readonly URI, correlates the latest Gate by `platformKey + accountId + operationId + timestamp`, reports `EVIDENCE_AMBIGUOUS=YES` when selection is not unique, and writes `output/v143-xiaohongshu-task10a-latest-evidence.json`. It does not import or invoke IPC, Browser, Page, Gate, checkLogin, or preparePublish. Current readonly analysis found the historical latest operation `71c65ac2-5ff1-43a0-bc64-a4729dd97671` with `gateResult=needs_user_action`; no live run was started.

### Verification

| Check | Result |
| --- | --- |
| Focused XHS/Core/Gate/heartbeat/analyzer tests | `7 files / 134 passed` |
| Full tests | `83 files / 568 passed` |
| Typecheck | `PASS` |
| Lint | `PASS` |
| Build | `PASS` |
| Staging packaged diagnostics | `PASS` |
| Staging app.asar | `release-task10d-hardening-20260830-final/win-unpacked/resources/app.asar` |
| Staging app.asar SHA256 | `A660B2AFF79F0FF4F8D0AF4732AEC6D0C67A8A345D7E070C7F0D7640944C4B7D` |

The staging `app.asar` contains `PRE_SUBMIT_GATE_INSPECTION_STARTED`, `EDITOR_NAVIGATION_HELPER_INVOCATION_STARTED`, `EDITOR_ENTRY_STARTED`, `EDITOR_ENTRY_STEP`, `AUTHENTICATED_PAGE_SIGNAL_NOT_FOUND`, `failureCode`, `failureStage`, `missingSignal`, and the real Gate call-chain symbols. It was built for Electron `37.10.3` / native ABI `136` and was not copied over the installed app.

### Production safety and deployment boundary

```text
LONG_TASK_DB_BEFORE       = publish_jobs 15 / submission_intents 12 / publish_records 9
LONG_TASK_DB_AFTER_TESTS  = publish_jobs 15 / submission_intents 12 / publish_records 9
LONG_TASK_DB_FINAL        = publish_jobs 15 / submission_intents 12 / publish_records 9
PUBLISH_DOMAIN_UNCHANGED  = YES
FINAL_SUBMIT_COUNT        = 0
JOB_CREATED               = NO
INTENT_CREATED            = NO
PUBLISH_RECORD_CREATED    = NO
LIVE_PRE_SUBMIT_GATE      = NOT_RUN
SELF_TEST                 = NOT_RUN
REAL_PREPARE_PUBLISH      = NOT_CALLED
```

Final readonly process inspection: installed main PID `28636`; target XHS profile Chrome process count `9`; profile `lockfile` remains present. Deployment was therefore not attempted. No process was killed, no Owner browser session was closed, no profile/credential was cleared, and no rollback directory was created for this blocked deployment.

Code commits: `67600f1` (`test: harden xiaohongshu editor gate diagnostics`) and `eda0637` (`feat: add xiaohongshu task10a evidence analyzer`). Existing Sohu, Toutiao, release, historical output, and other unrelated dirty/untracked changes were not staged or reverted.

Owner next step: tomorrow close the installed app / XHS BrowserSession normally; then deploy the staging build, restart the installed app, perform one Owner-controlled login if needed, wait for heartbeat, and click “检查图文编辑器” once. Do not run self-test or real publish until the new evidence analyzer returns an attributable Gate result.

## Task 9A — Xiaohongshu canonical Context disconnect root cause — FIXED / DEPLOYED - 2026-08-30

本轮没有重新执行 Owner login，没有访问真实小红书页面，没有执行 cold restore、PRE-SUBMIT、SELF_TEST、真实 `preparePublish` 或任何发布动作。目标账号范围仍为 `platformKey=xiaohongshu`、`accountId=54b390ac-d81e-440a-baeb-d00f9f346cc3`，profile 为 `C:\Users\Administrator\AppData\Roaming\codex-media-publisher\browser-profiles\xiaohongshu\54b390ac-d81e-440a-baeb-d00f9f346cc3`。

本轮生产实现与测试提交为 `878d182`；Task 1–7 的既有提交不变，完整列表见下方 Task 8 implementation commits 表。

### Root-cause evidence

本地临时 profile、`about:blank`、Chrome channel、headed `launchPersistentContext` 对照实验确认了 CASE B：关闭唯一 Page 后没有任何 app-level `context.close()` / `browser.close()`，等待 8 秒后 Browser disconnected 且 Context Page 数为 0；保留第二个 Page 时，关闭 Page A 后等待 8 秒 Browser 仍 connected，Page B 仍在 Context 中。证据文件为 `output/v143-xiaohongshu-last-page-close-smoke.json` 及汇总 `output/v143-xiaohongshu-task-9a-root-cause.json`。

| Item | Result |
| --- | --- |
| `LAST_PAGE_CLOSE_CAUSES_BROWSER_EXIT` | `YES` |
| `SECOND_PAGE_PREVENTS_BROWSER_EXIT` | `YES` |
| `EXPLICIT_CONTEXT_CLOSE_CALL_FOUND` | `NO` on the target login-page release path; explicit close callers exist for logout/remove/shutdown/replacement/error cleanup and are listed in the evidence JSON |
| `DISCONNECT_TRIGGER_CALLER` | Headed Chromium exits when the last persistent-context Page is closed; Playwright emits Browser disconnected |

### Lifecycle fix

在 retained-context policy 下，XHS authenticated canonical Page 现在作为 account-owned session Page 保留；login release 不再关闭最后一个 Page。checkLogin 继续创建独立 operation Page，operation Page 关闭不会关闭 Context；只有显式 logout、account removal、app shutdown、execution-mode replacement 或 cleanup 才关闭 account-owned session。没有新增空白 keeper Page、轮询或平台网络请求；保留的是已有 authenticated Page。

Core lifecycle diagnostics now record explicit close reason/caller and disconnect classification, including `explicitCloseInProgress`, `lastExplicitCloseReason`, `activePageCountBeforeDisconnect`, and `browserConnectedBeforeEvent`. No unsupported Playwright Browser process API was invented.

### Task 9A verification and deployment

| Check | Result |
| --- | --- |
| Focused tests | `PASS` — 7 files / 116 passed / 0 failed / 0 skipped |
| Full tests | `PASS` — 77 files / 503 passed / 0 failed / 0 skipped |
| Typecheck | `PASS` |
| Lint | `PASS` |
| Build | `PASS` |
| Installed deployment | `PASS` |
| Installed process | `Responding=true`, window `矩阵发布工作台` |
| Native ABI | Electron `37.10.3` / module ABI `136`; staging/installed native binary hash matched |
| `app.asar` hash | staging and installed `BB2EDCDBE7CE9ECDFD50422262119BBFCA978A2365064C000BDF1144CD1C620C` |
| Rollback | `C:\GMP116ZhihuL5\Geo Media Publisher.pre-xhs-context-disconnect-fix-20260830-104700` |

The deployment was performed only after closing the previous installed process normally with `Alt+F4`. Production data, credentials, and the account-scoped XHS profile were outside the copied installed payload and were not copied or modified.

### Production DB and safety boundary

All DB reads used readonly SQLite connections. Counts remained unchanged through tests and deployment:

```text
TASK9A_DB_BEFORE       = publish_jobs 15 / submission_intents 12 / publish_records 9
TASK9A_DB_AFTER_TESTS  = publish_jobs 15 / submission_intents 12 / publish_records 9
TASK9A_DB_FINAL        = publish_jobs 15 / submission_intents 12 / publish_records 9
PUBLISH_DOMAIN_UNCHANGED = YES
```

```text
PRE_SUBMIT_GATE        = NOT_RUN
SELF_TEST              = NOT_RUN
REAL_PREPARE_PUBLISH   = NOT_CALLED
FINAL_SUBMIT_COUNT     = 0
JOB_CREATED            = NO
INTENT_CREATED         = NO
PUBLISH_RECORD_CREATED = NO
```

Task 9 retry was not started. The live same-context Check 1/2 remains Owner-controlled and pending; `XIAOHONGSHU_RUNTIME_SESSION_READY = NOT_VERIFIED` and `READY_FOR_REAL_SELF_TEST = NO`. The deployed fix is ready for a later explicit Owner-controlled retry: `TASK9_RETRY_READY = YES`.

## Task 9 — Xiaohongshu owner-controlled live same-context verification — BLOCKED - 2026-08-30

本轮仅针对 `platformKey=xiaohongshu`、`accountId=54b390ac-d81e-440a-baeb-d00f9f346cc3` 执行 Owner login 后的 live 生命周期观察；未修改源码，未重新执行 Task 1–8，也未进入 Task 9 的 Check 1/2 之后步骤。

### Owner login and release evidence

| Item | Result |
| --- | --- |
| Profile | `C:\Users\Administrator\AppData\Roaming\codex-media-publisher\browser-profiles\xiaohongshu\54b390ac-d81e-440a-baeb-d00f9f346cc3` |
| `ACCOUNT_SESSION_RETAINED_AFTER_LOGIN` | `YES` |
| `LOGIN_PAGE_CLOSE_PRESERVES_CONTEXT` | `PASS_AT_RELEASE` |
| `LOGIN_CONTEXT_ID` | `34e507c7-27f9-44b7-9e8a-1a95185fba10` |
| `LOGIN_PAGE_ID` | `2e0390ac-0812-4d73-a11d-824db8194027` |
| Login classification | `logged_in`; stable observation passed; no login form, QR, CAPTCHA, slider, SMS, or security modal |
| Release evidence | `contextCount=1`, `pageCount=1`, `pageClosed=true`, `sessionRetainedAfterPageClose=true` |

### Live blocker and stopped boundary

After the successful login-page release, the installed app logged `XHS_BROWSER_SESSION_CONTEXT_DISCONNECTED` at `2026-08-30T02:16:00.839Z` for the same canonical context, with `browserConnected=false`. No relogin, cold restore, Context recreation, or retry was attempted after this blocker.

| Check | Result |
| --- | --- |
| `CHECK_LOGIN_SAME_CONTEXT_1` | `BLOCKED` — Context disconnected before the check could be run |
| `CHECK_CONTEXT_ID_1` / `CHECK_PAGE_ID_1` | `NOT_OBSERVED` |
| `CHECK_LOGIN_SAME_CONTEXT_2` | `NOT_RUN` |
| `CHECK_CONTEXT_ID_2` / `CHECK_PAGE_ID_2` | `NOT_RUN` |
| `ACCOUNT_SESSION_REUSED` | `BLOCKED` |
| `CANONICAL_CONTEXT_SINGLETON` | `BLOCKED` |
| `CONCURRENT_CONTEXT_CREATION_GUARD` | `NOT_PROVEN_LIVE` |
| `SIBLING_CONTEXT_ISOLATION` | `NOT_RUN` |
| `ACCOUNT_STATUS_LIVE_SYNC` | `BLOCKED` |
| `COLD_RESTORE_LIMITATION_DOCUMENTED` | `YES` |
| `XIAOHONGSHU_RUNTIME_SESSION_READY` | `NO` |
| `READY_FOR_REAL_SELF_TEST` | `NO` |

### Task 9 side-effect evidence

Readonly production SQLite observations were `publish_jobs=15 / submission_intents=12 / publish_records=9` after the stopped flow, matching the Task 8 final baseline. A separate Task 9 pre-owner-action snapshot was not captured, so strict Task 9 before/after equality is not claimed; no Job, SubmissionIntent, PublishRecord, final submit, PRE-SUBMIT, SELF_TEST, or real `preparePublish` was executed.

```text
PRE_SUBMIT_GATE       = NOT_RUN
SELF_TEST             = NOT_RUN
REAL_PREPARE_PUBLISH  = NOT_CALLED
FINAL_SUBMIT_COUNT    = 0
JOB_CREATED           = NO
INTENT_CREATED       = NO
PUBLISH_RECORD_CREATED = NO
```

Task 9 stopped at the Context disconnect blocker. Check 1 and Check 2 must not be represented as successful, and no further live action was started.

## Task 8 — Xiaohongshu long-lived browser session full verification and installed deployment — PASS / LIVE NOT_VERIFIED - 2026-08-30

Task 8 完成；本轮没有执行 Task 9。Task 1–7 的实现未重做、未回滚。完整测试中的 `preparePublish` 调用均审计为 isolated Vitest/unit/integration fixture：使用 fake Page/Browser/Adapter 或临时数据库，不使用 production `publisher.db`、owner credential/profile 或真实平台；因此允许执行 full suite。测试 fixture 修正已单独提交为 `5d59921`，不包含生产行为改动。

### Task 8 implementation commits

| Task | Commit |
| --- | --- |
| Task 1 | `f123ec7` |
| Task 2 | `5e5bb18`；follow-up fixes `1aa43ff`, `469c98f`, `cc208a5`, `ac32a56` |
| Task 3 | `898c92b` |
| Task 4 | `21591bd` |
| Task 5 | `628cbac` |
| Regression Fix | `c8ee20a` |
| Task 6 | `f1b1faf` |
| Task 7 | `96d011b` |
| Task 8 test-fixture correction | `5d59921` |

### Verification evidence

| Check | Result |
| --- | --- |
| `FULL_TEST_SAFETY_AUDIT` | `PASS` |
| `PREPARE_PUBLISH_TEST_CLASSIFICATION` | `SAFE_TEST_ONLY` |
| Focused tests | `PASS` — 7 files / 115 passed / 0 failed / 0 skipped |
| Full tests | `PASS` — 77 files / 502 passed / 0 failed |
| `TYPECHECK` | `PASS` |
| `LINT` | `PASS` |
| `BUILD` | `PASS` |
| `REAL_PREPARE_PUBLISH` | `NOT_CALLED` — only safe test doubles/isolated test adapters executed |
| `PRE_SUBMIT_GATE` | `NOT_RUN` |
| `SELF_TEST` | `NOT_RUN` |
| `FINAL_SUBMIT_COUNT` | `0` |

### Installed deployment evidence

Source build was packaged to `C:\GMP116ZhihuL5\Geo Media Publisher.staging-xhs-long-lived-session-20260830-100559\win-unpacked` using Electron-target native dependencies. The existing installed process was not running at replacement time; only the exact installed executable path was targeted. The application was then started from the installed path without clicking any UI.

| Item | Evidence |
| --- | --- |
| `INSTALLED_DEPLOYMENT` | `PASS` |
| Installed executable | `C:\GMP116ZhihuL5\Geo Media Publisher\Geo Media Publisher.exe` |
| `OLD_APP_ASAR_SHA256` | `E744084D064565A180B45378E0914438252059F4C93EEC043AB6D79A9F0CE3CA` |
| `NEW_APP_ASAR_SHA256` | `F0DC0DA966B6C98019B643C84C28137514424BFBCEC27063DFAFBEF46B6C402E` |
| `INSTALLED_APP_ASAR_SHA256` | `F0DC0DA966B6C98019B643C84C28137514424BFBCEC27063DFAFBEF46B6C402E` |
| `APP_ASAR_HASH_MATCH` | `YES` |
| `NATIVE_ABI` | Electron `37.10.3`, module ABI `136`; installed `better_sqlite3.node` loaded successfully |
| `PROCESS_RESPONDING` | `YES`; main PID `10192`; window title `矩阵发布工作台` |
| Production data path | `C:\Users\Administrator\AppData\Roaming\codex-media-publisher\production-data` — not copied or replaced |
| XHS account-scoped profile | `C:\Users\Administrator\AppData\Roaming\codex-media-publisher\browser-profiles\xiaohongshu\54b390ac-d81e-440a-baeb-d00f9f346cc3` — not copied or replaced |
| Credential file | `production-data\credentials.enc` remained outside the installed payload and was not read/copied |

### Production DB side-effect evidence

All reads used a readonly SQLite connection. Counts before full tests, after full tests, and after installed deployment are identical:

```text
TASK8_DB_BEFORE        = publish_jobs 15 / submission_intents 12 / publish_records 9
TASK8_DB_AFTER_TESTS   = publish_jobs 15 / submission_intents 12 / publish_records 9
TASK8_DB_FINAL         = publish_jobs 15 / submission_intents 12 / publish_records 9
PUBLISH_DOMAIN_UNCHANGED = YES
JOB_CREATED            = NO
INTENT_CREATED         = NO
PUBLISH_RECORD_CREATED = NO
```

No real platform prepare, image upload, title/body operation, PRE-SUBMIT, SELF_TEST, final CTA, Job, SubmissionIntent, or PublishRecord was executed in Task 8.

### Rollback and owner boundary

`ROLLBACK_PATH = C:\GMP116ZhihuL5\Geo Media Publisher.pre-xhs-long-lived-session-20260830-100746`. This new directory contains the deployment-before executable, app.asar, PLATFORMS catalog, and native payload; historical rollback directories were preserved. `Task 9 = NOT_EXECUTED`. Live Xiaohongshu Context reuse and owner-controlled login/security verification remain unverified.

```text
XIAOHONGSHU_RUNTIME_SESSION_READY = NOT_VERIFIED
READY_FOR_REAL_SELF_TEST          = NO
OWNER_ACTION_REQUIRED             = YES_FOR_TASK_9
```

Task 8 documentation was recorded after all evidence was obtained. The final documentation commit is the commit containing this section.

## V1.4.3 Account Disconnect Archive Lifecycle — CODE PASS / INSTALLED PASS / GATE NOT_RUN / REAL PUBLISH NOT_RUN - 2026-08-28

本轮将账号“断开”收口为“移除活动账号容器”：精确清理目标 `platformKey + accountId` 的 BrowserSession 和 Credential，设置 `logged_out`，写入 `archived_at`，并让该 row 从活动账号中心消失；不物理删除 account，不破坏历史 Job、SubmissionIntent 或 PublishRecord 引用。本轮没有断开生产小红书账号 1，没有执行小红书 gate，没有创建 SELF_TEST，没有点击最终发布。

### 本轮验收状态

| 状态 | Result | 证据/边界 |
| --- | --- | --- |
| `ACCOUNT_DISCONNECT_REMOVES_ACTIVE_ROW` | `PASS` | controlled test DB 中目标 row 从默认 `listAccounts()` 消失；历史查询仍可按原 accountId 读取。 |
| `ACCOUNT_HISTORY_PRESERVED` | `PASS` | `publish_jobs.account_id`、`submission_intents.account_id`、`publish_records.account_id` 保持原引用；测试中的 PublishRecord 可继续读取。 |
| `ACCOUNT_SOFT_DELETE_IMPLEMENTED` | `PASS` | migration `0022_v143_account_archive.sql` 新增 `accounts.archived_at` 与索引；无 account DELETE IPC/Repository 行为。 |
| `SIBLING_ACCOUNT_ISOLATION` | `PASS` | A/B controlled regression 覆盖目标 archive 不改变 sibling login state、active row、Session 或 Credential。 |
| `CREDENTIAL_ISOLATION` | `PASS` | 只清理 `session:{platformKey}:{accountId}` 的 exact key；sibling key 保留。 |
| `SESSION_ISOLATION` | `PASS` | 只关闭目标 BrowserSession；BrowserSessionManager rebind/disconnect 均按 exact composite key。 |
| `IDEMPOTENT_DISCONNECT` | `PASS` | archived 或已 logged_out 且无 Session/Credential 的目标返回 `ALREADY_DISCONNECTED`，不抛异常。 |
| `READD_SAME_ACCOUNT_BEHAVIOR` | `PASS_WITH_FAIL_CLOSED_BOUNDARY` | adapter 提供唯一稳定 external identity 时恢复原 archived container 并 rebind Session；无身份、冲突或身份不唯一时拒绝 dedupe，不猜测。 |
| `PHYSICAL_DELETE_USED` | `NO` | 没有新增 `accounts:delete/remove`，没有物理 DELETE。 |
| `FINAL_SUBMIT_COUNT` | `0` | 本轮 gate 未执行；最终发布按钮没有点击。 |
| `CODE PASS` | `PASS` | 13 focused files / 110 tests、73 files / 453 full tests、typecheck、lint、build fresh 通过。 |
| `INSTALLED PASS` | `PASS` | 独立 v143 包已部署；migration resource 补齐后 fresh restart 应用 0022，进程 Responding=true，发布域计数不变。账号动作未在安装版点击。 |
| `LIVE SESSION PASS` | `NOT_CLAIMED` | 本轮没有执行小红书 live Session restore；生产 account 1 的 session key 只做存在性检查。 |
| `GATE PASS` | `NOT_RUN` | 按本轮要求，lifecycle 修复前不继续 Xiaohongshu gate。 |
| `REAL PUBLISH PASS` | `NOT_RUN` | 严格禁止真实发布。 |
| `XIAOHONGSHU_READY_FOR_REAL_SELF_TEST` | `NO` | 本轮没有运行 gate，不满足 READY 判定。 |

### 生产数据库只读基线与安装版 smoke

部署前只读基线：普通 `platformKey=xiaohongshu` 有 2 个 account rows；`publish_jobs=15`、`submission_intents=12`、`publish_records=9`。本轮没有在生产库调用 disconnect，也没有修改账号、Job、Intent 或 PublishRecord。

安装版部署初次 smoke 发现旧安装目录缺少 Electron `extraResources` 中的 0022 文件；已停止 exact installed executable，备份旧 migration 目录，补拷贝唯一 `0022_v143_account_archive.sql` 后重启。fresh smoke 现在确认 `accounts.archived_at` 存在、最新 migration 为 `0022_v143_account_archive.sql`、两个小红书 row 仍分别存在且未归档、三类发布数据仍为 `15 / 12 / 9`。安装版 exe、app.asar、better-sqlite3 native 与 v143 构建包 hash 一致。

当前生产小红书账号（只输出非敏感状态）：

| accountId | loginStatus | enabled | authorizationStatus | browserSessionId | credential key | archivedAt |
| --- | --- | --- | --- | --- | --- | --- |
| `54b390ac-d81e-440a-baeb-d00f9f346cc3` | `logged_in` | `true` | `Authorized` | present | present | `null` |
| `88c590d9-4c4f-46c9-b1c5-61e2eac43b2d` | `logged_out` | `true` | `NotAuthorized` | absent | absent | `null` |

`credentials.enc` 只做 key presence 检查，没有读取、解密或输出任何 credential value。安装版 smoke 没有执行账号操作；账号中心 Chromium DOM 没有在 owner 不在场时独立点击观察，因此不把 UI 操作冒充为已实测。

### 断开无反馈的根因与实现

精确根因是旧 lifecycle 合约只实现了“断开连接”，没有实现“从活动账号中心移除”：`markPlatformAccountDisconnected` 仅更新 logged-out/session 字段，`listAccounts()` 无 archived 过滤，所以 row 永久留在活动列表。账号 2 本来已 `logged_out`、无 active Session、无 Credential 时还命中 B4 后端幂等清理；旧 IPC/Renderer 只暴露通用成功，形成 B5 的“无反馈”。

现在 IPC 先用 `repository.getAccountById(accountId, platformKey)` 精确寻址，BrowserAutomation 关闭 exact Session、清理 exact credential，Repository 在事务中写 `logged_out`、`NotAuthorized`、`browser_session_id=NULL`、`archived_at=timestamp`；默认 `listAccounts()` 过滤 `archived_at IS NULL`，`includeArchived`/`getAccountById` 保留历史访问。Renderer 显示“已移除……历史发布记录保留”或“当前已处于未连接状态；活动账号已移除”，随后立即 refresh；按钮改为“移除”，确认文案为“移除后会清除此账号的登录状态和本地会话，但不会删除历史发布记录。确定继续吗？”。

当前没有安全、测试覆盖的物理 account delete 能力：`ACCOUNT_CONTAINER_DELETE_AVAILABLE = NO`。本轮没有把 disconnect 改成 DELETE。

### 证据与回滚

证据见 [output/v143-xiaohongshu-multi-account-hardening.json](C:/Users/Administrator/Desktop/codex_media_publisher_starter/output/v143-xiaohongshu-multi-account-hardening.json)。安装包目录为 `C:\Users\Administrator\Desktop\codex_media_publisher_starter\release\win-unpacked-xiaohongshu-account-archive-v143\win-unpacked`；安装路径为 `C:\GMP116ZhihuL5\Geo Media Publisher\Geo Media Publisher.exe`；本轮 rollback 为 `C:\GMP116ZhihuL5\Geo Media Publisher.previous-20260828-xiaohongshu-account-archive-v143`。production-data 与 `credentials.enc` 均保留。

本轮源码/测试修改文件及 evidence 只涉及账号 archive lifecycle、精确 Session rebind、Xiaohongshu account-center/UI regression、迁移、PROJECT_STATE 与 v143 evidence；未修改 Sohu/Toutiao/release 的业务实现。工作区已有的 Sohu 与 release dirty changes 未 stage、未覆盖、未回滚。

## V1.4.3 Xiaohongshu multi-account hardening — CODE PASS / INSTALLED PASS / LIVE SESSION BLOCKED / GATE BLOCKED / REAL PUBLISH NOT_RUN - 2026-08-27

本轮继续收口普通 `xiaohongshu` BrowserAutomation 的多账号管理与断开 UX。没有真实发布小红书笔记，没有点击最终发布，没有创建或重建 Job，也没有修改已 PASS 的微博、今日头条或搜狐发布业务实现。生产库只读审计确认普通小红书有两个独立 account rows；本轮没有在生产库调用账号 2 的断开动作，以保留 owner 原有账号状态，断开行为由精确 accountId 的源码回归覆盖。

### 本轮状态边界

| 状态 | Result | 说明 |
| --- | --- | --- |
| `XIAOHONGSHU_ACCOUNT_MANAGEMENT` | `VERIFIED`（代码/隔离回归） | 每个账号动作携带 exact `platformKey + accountId`；账号容器保留；删除账号能力不存在；缺失账号 fail-closed。 |
| `CODE PASS` | `PASS` | 断开结果契约、幂等语义、凭据/Session 隔离、Renderer feedback 与刷新均通过回归。 |
| `INSTALLED PASS` | `PASS` | r7 Electron 37.10.3/x64 包已替换并启动；exe、app.asar、better-sqlite3 native 与本轮包 hash 一致；保留新 rollback backup。UIA 可读到安装版窗口和 shell，但 Chromium 内容树仅暴露有限菜单，因此未把未独立观察到的账号 DOM 冒充为 UI PASS。 |
| `LIVE SESSION PASS` | `NOT_PASS` | 账号 1 的持久化 Session key 存在，但只读 gate 检测到平台正常安全验证阻塞。 |
| `GATE PASS` | `NOT_PASS` | gate-only 在 Login / Session 停止，未进入身份和编辑器 gates。 |
| `REAL PUBLISH PASS` | `NOT_RUN` | 本轮明确禁止真实最终发布。 |
| `XIAOHONGSHU_READY_FOR_REAL_SELF_TEST` | `NO` | 安全验证完成前不满足 READY 条件。 |

### 生产账号审计

从 production repository 精确读取到 2 个 `platformKey=xiaohongshu` account rows：

| accountId | accountAlias | accountName | externalAccountId | loginStatus | enabled | authorizationStatus | browserSessionId | pausedReason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `54b390ac-d81e-440a-baeb-d00f9f346cc3` | 小红书账号 1 | 小红书账号 1 | `960803317` | `needs_user_action` | `true` | `Authorized` | present | 等待用户完成平台正常验证 |
| `88c590d9-4c4f-46c9-b1c5-61e2eac43b2d` | 小红书账号 2 | `null` | `null` | `logged_out` | `true` | `NotAuthorized` | absent | 连接已取消 |

credentials 只做 key presence 检查，没有读取或输出内容：账号 1 的 `session:xiaohongshu:54b390ac-d81e-440a-baeb-d00f9f346cc3` 存在，账号 2 对应 key 不存在。账号 1 没有重新创建；账号 2 的精确 ID 来自 Repository，没有根据 UI 截图猜测。

### 账号 2 断开无反馈：精确根因与修复

根因是 `B4 + B5`：账号 2 原本就是 `logged_out`、没有 active BrowserSession、没有 credential，旧 IPC 仍执行后端清理并返回一个无区分的通用成功结果；Renderer 也只显示通用“已断开”，所以用户看不到“本来已经断开”的明确反馈。不是 Renderer handler 未触发、错误 accountId 或 IPC 未调用，也不是删除语义。

本轮新增 `DISCONNECTED` / `ALREADY_DISCONNECTED` 结果契约。IPC 先按 `accountId + platformKey` 精确校验，未知账号直接 fail-closed；BrowserAutomation 只清理目标账号的 Session key/active Session，Repository 将目标行置为 logged out 并清除 stale paused reason，保留 account row。Renderer 显示明确结果后刷新 overview；没有新增 `accounts:delete` 或 `accounts:remove`，因此 `ACCOUNT_CONTAINER_DELETE_AVAILABLE = NO`。

### 多账号回归与 gate-only

回归覆盖了 account A/B 的 credential、active Session、login state 和 account row 隔离；B 断开不改变 A，A relogin 不覆盖 B，缺失 account 不 fallback 到 A，gate-only 必须显式使用 `XIAOHONGSHU_ACCOUNT_ID`。修正了 gate runner 中的环境变量拼写，并保持 Login / Session 先于身份读取与持久化。

账号 1 gate-only 使用 exact accountId 单次执行，结果为 `FAILED_CLOSED`，error code 为 `SECURITY_VERIFICATION_REQUIRED`。数据库发布域保持不变：`publish_jobs 15 -> 15`、`submission_intents 12 -> 12`、`publish_records 9 -> 9`；`finalSubmitCount=0`，Job/Intent/PublishRecord 均未创建，`PublishPassed=NOT_PASS`。证据见 [output/v142-xiaohongshu-gate-only.json](C:/Users/Administrator/Desktop/codex_media_publisher_starter/output/v142-xiaohongshu-gate-only.json) 和 [output/v143-xiaohongshu-multi-account-hardening.json](C:/Users/Administrator/Desktop/codex_media_publisher_starter/output/v143-xiaohongshu-multi-account-hardening.json)。

### 源码、安装版与 owner 边界

当前源码新鲜验证为：focused 15 files / 124 tests PASS；`pnpm test` 72 files / 445 tests PASS；`pnpm typecheck` PASS；`pnpm lint` PASS；`pnpm build` PASS。安装版 r7 已部署到 `C:\GMP116ZhihuL5\Geo Media Publisher\Geo Media Publisher.exe`，新 rollback backup 为 `C:\GMP116ZhihuL5\Geo Media Publisher.previous-20260827-xiaohongshu-account-connection-r7`；production-data 与 credentials.enc 保留。

`OWNER_ACTION_REQUIRED`：平台为小红书，`accountId=54b390ac-d81e-440a-baeb-d00f9f346cc3`。owner 回来后在已重启安装版普通“小红书”卡片中点击该已有账号的“重新登录/连接现有账号”，在应用拥有的可见 BrowserSession 中完成平台正常登录和安全验证，再点击“我已完成登录”。不要点击“+ 添加账号”、不要切换账号 2、不要点击最终发布。完成后才能继续同一 accountId 的 Login → Account Identity → Identity Persistence → gate-only。

## V1.4.2 Xiaohongshu login false-negative bounded bugfix — SOURCE_FIXED / INSTALLED_DEPLOYED / WAITING_OWNER_LOGIN - 2026-08-27

本轮严格只修复普通 `xiaohongshu` BrowserAutomation 的登录误判与账号连接 Session 生命周期，没有创建新账号、没有切换账号、没有使用 Computer Use，也没有修改 Publisher、Scheduler、SubmissionIntent、PublishRecord 或其他平台 Adapter。修复后的 Electron-target 安装包已完成受控替换并重启；owner 的既有账号记录和生产数据保持不变。

### 根因与修复

| 项目 | Result | 说明 |
| --- | --- | --- |
| 旧登录误判根因 | `CONFIRMED` | 旧逻辑把整页 body 文本中的“登录/验证码/安全验证/二维码”等宽泛关键词当作阻塞证据，Creator 首页普通文案因此可能覆盖已登录正向信号。 |
| 登录正向证据 | `FIXED` | 仅在没有明确登录页/可见登录表单/可见阻塞验证时，使用 Creator host 与至少两个正向信号（发布笔记、笔记管理、数据看板、创作服务平台、账号状态正常、账号身份）判定 `logged_in`。 |
| 安全验证证据 | `FIXED` | 必须是当前可见、阻塞操作且具有表单/二维码/CAPTCHA/滑块/安全 modal 语义；隐藏 DOM、脚本文本、帮助文案、导航中的普通关键词不再阻塞。 |
| Session/Page 绑定 | `FIXED` | `completeConnection`、identity readback 和 `getBrowserSessionEvidence` 使用同一 exact account-scoped Page；真实 Context/Page 不一致时 fail-closed，禁止用新 Page 替代 owner Page。 |
| 连接生命周期 | `FIXED` | XHS 登录完成后先保留 owner Page；IPC 完成身份读取与 account persistence 后才调用 `releaseConnectionSession`。 |
| 身份保存 | `FIXED` | 可靠昵称可保存；`externalAccountId` 仅来自稳定“小红书账号”字段或稳定 profile URL，不能证明时保持 `null`。 |

### 本轮源码验证与真实边界

测试先 RED 后 GREEN：XHS false-negative、隐藏验证文案、可见验证码/滑块、真实登录页、稳定账号字段、同一 Page 生命周期、Session/Page mismatch、无 stored Session 不新建 Context/Page、显式 accountId 与零副作用均有回归覆盖。最终 focused suite 为 4 files / 47 tests PASS；`pnpm test` 为 72 files / 424 tests PASS；`pnpm typecheck`、`pnpm lint`、`pnpm build` 均 PASS。

使用唯一既有 accountId `54b390ac-d81e-440a-baeb-d00f9f346cc3` 重新执行 source gate-only：platform/route 与 accountId 通过，期望 Session key 为 `session:xiaohongshu:54b390ac-d81e-440a-baeb-d00f9f346cc3`；在安装包替换前，生产 account row 的 `browserSessionIdPresent=false`，因此 Login / Session 安全停止为 `LOGIN_REQUIRED`。本轮不把缺失持久化 Session 误记为 `SECURITY_VERIFICATION_REQUIRED`，不新建 Context/Page 来替代 owner 当前页面，也不创建新账号或切换账号。

真实 gate 结果为 `FAILED_CLOSED`，没有进入 Account Identity 或编辑器 gates。`finalSubmitCount=0`；`publish_jobs 15 -> 15`、`submission_intents 12 -> 12`、`publish_records 9 -> 9`；Job/Intent/PublishRecord 均未创建，`PublishPassed=NOT_PASS`，`XIAOHONGSHU_READY_FOR_REAL_SELF_TEST=NO`。随后已用 r6 安装包完成 Electron 37.10.3/x64 目标替换并重启同一安装程序（主 PID `23176`），exe/app.asar/native 与构建包 hash 一致，生产 `publisher.db` 与 `credentials.enc` 均保留；当前停止在 owner 人工登录边界，尚未宣称 Login/Identity/Gate 通过。证据见 [output/v142-xiaohongshu-account-connection.json](output/v142-xiaohongshu-account-connection.json) 与 [output/v142-xiaohongshu-gate-only.json](output/v142-xiaohongshu-gate-only.json)。

### Installed-app handoff boundary

安装版已运行于 `C:\GMP116ZhihuL5\Geo Media Publisher\Geo Media Publisher.exe`，主 PID `23176`，窗口正常响应。原 accountId `54b390ac-d81e-440a-baeb-d00f9f346cc3` 已在保留的生产数据库中核验，期望 Session key 仍为 `session:xiaohongshu:54b390ac-d81e-440a-baeb-d00f9f346cc3`。请 owner 在该安装版窗口的普通“小红书”账号卡片中，对这个已有账号执行“重新登录/连接现有账号”动作；不要点击“+ 添加账号”，不要创建第二个账号。完成平台正常登录与安全验证后，点击“我已完成登录”，再由同一 accountId 继续 Login → Account Identity → Identity Persistence；只有这些通过后才会执行 gate-only。当前尚未运行安装版 post-login gate。

## V1.4.2 Xiaohongshu desktop account connection — IMPLEMENTED / ACCOUNT_CREATED / GATE_BLOCKED - 2026-08-27 (historical milestone)

本轮已将普通 `xiaohongshu` BrowserAutomation 接入桌面端真实账号链路。`xiaohongshu_business`（小红书商家号）和 `xiaohongshu_private`（小红书私信版）仍为独立历史平台 key，没有被改名或复用。运行时 `platforms:list` 通过现有 `accountConnectionMode` overlay 暴露 `BrowserAutomation`，不改变发布 transport。

### 连接、添加账号和身份验收语义

| 项目 | Result | 规则/证据 |
| --- | --- | --- |
| 普通平台卡片 | `IMPLEMENTED` | `platformKey=xiaohongshu`，`displayName=小红书`，图文/文章 BrowserAutomation；旧商家号、私信版保留 |
| 连接账号 | `IMPLEMENTED` | 无账号时创建首个 record；恰有一个未完成账号时复用它；多个未完成账号时要求明确选择，绝不选第一项 |
| `+ 添加账号` | `IMPLEMENTED` | 始终先调用 `accounts.create` 生成新的 UUID，再以该 UUID 打开登录；已有已登录账号也不覆盖 |
| 登录 vs Identity | `IMPLEMENTED` | 先验收 BrowserAutomation 登录状态，再单独执行身份侦察和回写；昵称只能保存为 `accountName`，不猜 `externalAccountId` |
| 账号级动作 | `IMPLEMENTED` | login/relogin/check/open/disconnect/self-test/gate-only 均显式携带内部 `accountId`；缺失或歧义时 fail-closed，禁止 fallback 到第一个账号 |
| 多账号 Session | `PASS`（代码/测试） | Session 以 `platformKey + accountId` 隔离；A/B 记录、身份冲突和单账号失效互不覆盖 |
| gate-only | `PASS`（代码/测试） | 只读停在 final-submit discovery；不创建 Job、SubmissionIntent、PublishRecord，不写 `PublishPassed=PASS` |

### Installed app deployment

该历史阶段曾按“source focused tests/build → Electron-target native/package → 停止 exact installed process → 备份 exe/app.asar/catalog/app.asar.unpacked → 替换 → 重启同一 installed executable”完成部署。当前最新安装状态见上方 `Installed-app handoff boundary`；r5 可恢复备份位于 `C:\GMP116ZhihuL5\Geo Media Publisher.previous-20260827-xiaohongshu-account-connection-r5`。r4 曾因 host/Electron native ABI 不匹配退出，已通过 Electron 37.10.3 target prebuild 重新打包并由 r5 修复。

### Owner continuation result

已确认桌面端普通“小红书”卡片可见，并且现有唯一账号记录为 `54b390ac-d81e-440a-baeb-d00f9f346cc3`；本轮没有创建新账号，也没有切换账号。历史运行曾因旧检测器误报安全验证而停止；本轮修复后的 source gate-only 重新检查到该 exact account 没有可用持久化 BrowserSession，因此准确返回 `LOGIN_REQUIRED`，没有继续身份读取、身份持久化或编辑器操作。

按安全边界已立即停止：没有绕过验证码、二维码、短信、滑块或风控验证。本轮不要求 owner 再次登录；后续只能由修复后的运行实例复用该 exact accountId 的 owner Page 完成 Login → Account Identity → Identity Persistence，再继续同一 accountId 的 gate-only。不要创建新账号、切换账号或点击最终发布。

### 本轮真实执行与验证

Focused Xiaohongshu/account/desktop routing：9 个文件 / 54 tests PASS；`pnpm test`：72 个文件 / 412 tests PASS；`pnpm typecheck` PASS；`pnpm lint` PASS；`pnpm build` PASS。installed app 仍为同一 r5 可执行文件，PID 6588，窗口“矩阵发布工作台”，Responding=True。实际 gate-only 数据库计数保持 `publish_jobs 15 -> 15`、`submission_intents 12 -> 12`、`publish_records 9 -> 9`，最终提交次数为 `0`。

证据文件：[output/v142-xiaohongshu-account-connection.json](output/v142-xiaohongshu-account-connection.json)。实施计划：[docs/superpowers/plans/2026-08-27-xiaohongshu-account-connection.md](docs/superpowers/plans/2026-08-27-xiaohongshu-account-connection.md)。

## V1.4.2 Xiaohongshu BrowserAutomation gate-only - CODE_COMPLETE / GATE_BLOCKED - 2026-08-27

本轮已在正式 `xiaohongshu` key 下接入独立 BrowserAutomation 图文能力和 `scripts/v142-xiaohongshu-gate-only.mts` runner。现有 `account`、Adapter Registry、Repository、BrowserSessionManager 和 `platformKey + accountId` Session 隔离均被复用；没有修改多账号架构，也没有新增 migration、Job、SubmissionIntent 或 PublishRecord 模型。

### 代码与安全边界

| Gate | Result | Evidence |
| --- | --- | --- |
| Platform Registered | `PASS`（代码） | `xiaohongshu -> XiaohongshuBrowserAdapter`；transport=`browser`；integrationMode=`BrowserAutomation`；article/image-post only；video=`false` |
| Account ID | `PASS` | runner 使用显式 `XIAOHONGSHU_ACCOUNT_ID=54b390ac-d81e-440a-baeb-d00f9f346cc3`，禁止 fallback |
| Account Identity | `NOT_RUN` | Login / Session gate 先行命中 `SECURITY_VERIFICATION_REQUIRED`，未读取页面身份；adapter 仍只在有稳定 profile URL/ID 时保存 external ID，不猜测 |
| Browser Session Isolation | `PASS`（代码/测试） | `session:xiaohongshu:{accountId}`；A/B、缺失账号、A 失效不切换 B 的测试通过 |
| Login / Session | `FAIL_CLOSED` | 同一 exact accountId 的 BrowserSession 检测到安全验证状态；未绕过、未继续 |
| Image-post / Upload / Title / Body / Required / Settings / Final Control | `NOT_RUN` | Login / Session 未通过，按 fail-closed 停止 |
| Final Submit Count | `0` | runner 和 adapter 均禁止点击最终发布控件 |
| Job Created | `NO` | 独立 runner 不调用 Job Queue |
| Intent Created | `NO` | 独立 runner 不创建 SubmissionIntent |
| PublishRecord Created | `NO` | 独立 runner 不创建 PublishRecord |
| PublishPassed | `NOT_PASS` | gate-only 永不写成发布通过 |
| Ready for Real SELF_TEST | `NO` | 真实 gate-only 在 Login / Session 阶段被安全验证阻断 |

### Runner evidence

`output/v142-xiaohongshu-gate-only.json` 已生成，结果为 `FAILED_CLOSED`，真实原因是 `SECURITY_VERIFICATION_REQUIRED`；使用了明确 accountId `54b390ac-d81e-440a-baeb-d00f9f346cc3`，没有 fallback。数据库计数保持不变：`publish_jobs 15 -> 15`、`submission_intents 12 -> 12`、`publish_records 9 -> 9`；`finalSubmitCount=0`。没有联网下载素材，没有执行任何平台发布，身份也没有在未通过登录验收时被猜测或写回。

真实运行命令（仅当同一 owner 在同一 accountId 上完成正常验证并点击“已完成登录”后）：

`$env:XIAOHONGSHU_ACCOUNT_ID="<explicit-account-id>"; pnpm exec electron scripts/v142-xiaohongshu-gate-only-entry.mjs`

本轮额外修正 runner 顺序为 `Login / Session → Account Identity → Identity Persistence`。即使后续所有 gate 通过，也只输出 `XIAOHONGSHU_READY_FOR_REAL_SELF_TEST = YES`，随后停止；本轮不执行真实发布。

## V1.4.1 Sohu reconciliation parser 修正 - PUBLISHED / VERIFIED / PASS - 2026-08-27

本轮仅修正搜狐 reconciliation/content-list 状态解析并复用历史 Job 做一次只读回收；绝对没有重新发布，没有调用 `finalSubmit`，没有点击发布/提交控件，也没有创建替代 Job、SubmissionIntent 或 PublishRecord。v140 的 `Rejected` 结论已保留为历史 evidence，但已明确标注为 reconciliation parser false positive：上一版从过大的页面/内容管理容器读取状态，顶部统计“未通过 0”混入目标文章上下文，并在单篇状态判断中优先命中 `未通过`；本轮改为目标文章行自身状态文本优先，列表统计只作为唯一匹配时的辅助证据。

### 本轮 Sohu reconciliation 结果

| 项目 | Result | Evidence |
| --- | --- | --- |
| Article Unique Match | `YES` | 精确标题 `Geo Media Publisher 发布链路测试`；时间 `2026-08-25 13:58`；当前账号唯一匹配；内容管理行取得公开链接 |
| Platform Status | `Published` | 目标文章行自身未显示拒稿；“全部 1 / 已发布 1 / 审核中 0 / 未通过 0 / 草稿 0 / 定时发布 0”只作为列表级辅助证据；唯一目标行被收口为 Published |
| Previous Rejected Was False Positive | `YES` | v140 的 `SOHU_REAL_PUBLISH_REJECTED` 是 parser false positive；历史文件未篡改 |
| External ID | `1067296027` | 从真实搜狐内容管理行公开 href 回收 |
| External URL | `https://www.sohu.com/a/1067296027_122970301` | 从真实管理行 href 回收，未猜测 URL |
| Public Verification | `PASS / Verified` | 公开页正常加载，标题一致，不是 404、删除或审核页 |
| Existing Job Reused | `YES` | `6fb37664-4340-4e1a-accd-865987e907df`：`NeedsReconciliation -> Success` |
| Existing Intent Reused | `YES` | `5fcfbc88-5719-415d-b6b0-d992cbe9cfa5`：`Unknown -> Submitted`；External ID 已回填 |
| Existing PublishRecord Reused | `YES` | `0fa3c07a-d854-4680-b39b-2b52fa12f64e`：`Prepared/WaitingUser -> Published/Verified` |
| Historical Final Submit Count | `1` | reconciliation 前后均为 `1` |
| New Final Submit Count | `0` | 本轮无 final submit、无发布控件点击 |
| PublishPassed | `PASS` | 已发布列表唯一匹配 + 公开页严格验证 |
| Final Result | `SOHU_REAL_PUBLISH=PASS` | 证据：`output/v141-sohu-published-reconciliation.json` |

### 本轮数据库变化

| 表 | Before -> After | 本轮新增 |
| --- | ---: | ---: |
| `publish_jobs` | `15 -> 15` | 0 |
| `submission_intents` | `12 -> 12` | 0 |
| `publish_records` | `9 -> 9` | 0 |

本轮保留原 v140 evidence，并新增独立 v141 evidence；没有删除或改写历史结论。后续不得再次提交或为获得 PASS 重发同一文章。

### 本轮验证

Focused Sohu（`packages/adapters/sohu-media/src/browser.test.ts` + `tests/v119-sohu-reconciliation.test.ts`）PASS（33 tests）；`pnpm test` PASS（68 个 test files / 377 个 tests）；`pnpm typecheck` PASS；`pnpm lint` PASS；`pnpm build` PASS。

## V1.4.0 Sohu 历史真实提交只读 reconciliation - REJECTED / NO REPUBLISH - 2026-08-27

本轮只复用历史搜狐 Job 做一次真实只读回查：未创建新 Job、SubmissionIntent 或 PublishRecord，未点击任何发布/提交控件，未重试，也未访问或修改头条、知乎、百家号、微博流程。历史文章 `Geo Media Publisher 发布链路测试` 在搜狐内容管理页被标题唯一匹配，页面状态明确为 `未通过 / Rejected`；因此按 fail-closed 规则返回 `STILL_UNCERTAIN`，记录平台审核失败证据并禁止重发。由于当前核心状态机不把平台审核状态映射为新的闭环状态，旧 Job 继续保持 `NeedsReconciliation`，没有伪造 `Published` 或 `ConfirmedNotPublished`。

### 本轮 Sohu reconciliation 结果

| 项目 | Result | Evidence |
| --- | --- | --- |
| Evidence | `output/v140-sohu-reconciliation.json` | 真实 Electron + 应用自有 BrowserSession；仅调用旧 Job reconciliation API |
| Account | PASS | `33418593-16eb-4ba4-8d61-0a0189cccd2e`；与历史 Job 账号一致 |
| Management URL | PASS | `https://mp.sohu.com/mpfe/v4/contentManagement/first/page?newsType=1` |
| Article match | UNIQUE | 标题出现次数 `1`；唯一匹配公开链接 `https://www.sohu.com/a/1067296027_122970301`；External ID `1067296027` |
| Platform status | `Rejected` | 搜狐内容管理行明确显示 `未通过`；返回 `SOHU_REAL_PUBLISH_REJECTED`，禁止重发 |
| Read-only verification | PASS | 仅导航、读取管理页 DOM、读取旧持久化状态；没有发布控件点击 |
| Final submit count | `1 -> 1` | 历史真实最终提交仍为唯一一次；本轮新增 `0` |
| Job | unchanged | `6fb37664-4340-4e1a-accd-865987e907df` 仍为 `NeedsReconciliation` |
| SubmissionIntent | unchanged | `5fcfbc88-5719-415d-b6b0-d992cbe9cfa5` 仍为 `Unknown`，`final_submit_count=1` |
| PublishRecord | unchanged | `0fa3c07a-d854-4680-b39b-2b52fa12f64e` 仍为 `Prepared / WaitingUser`，无 URL/External ID |

### 本轮数据库变化

| 表 | Before -> After | 本轮新增 |
| --- | ---: | ---: |
| `publish_jobs` | `15 -> 15` | 0 |
| `submission_intents` | `12 -> 12` | 0 |
| `publish_records` | `9 -> 9` | 0 |

本轮没有调用 `verifyPublished`，因为平台明确返回 `Rejected`；没有把管理页链接误记为成功发布证据。`totalContentCount` 的 icon 字体类名 `mp-iconnumber_1` 未被误解析为数字，保持 `null`，不参与错误的负向结论。

## V1.3.9 Toutiao 只读 reconciliation - PUBLISHED / PASS - 2026-08-26

本轮全程为只读平台核验和既有记录收口：没有点击任何发布控件、没有创建第二篇文章、没有重试，也没有创建新的 Job、SubmissionIntent 或 PublishRecord。应用自有 BrowserSession 确认当前账号为 `3841036825934266 / 潭底观鱼`，Login 为 `logged_in`，`ACCOUNT_COMPLETION_PROMPT` 仅作为 warning。作品管理页真实 DOM 为 `https://mp.toutiao.com/profile_v4/manage/content/all`，以标题、提交分钟、当前账号唯一匹配本次文章。首次回查看到 `08-26 15:38 / 审核中` 并将不确定状态收口为 `Submitted`；后续只读复查看到同一行变为 `已发布`，因此继续回收公开证据并完成验证。

### 本轮 Toutiao reconciliation 结果

| 项目 | Result | Evidence |
| --- | --- | --- |
| Account | PASS | `3841036825934266 / 潭底观鱼`；唯一 profile anchor `https://www.toutiao.com/c/user/3841036825934266/` |
| Login / Session | PASS | `logged_in`；应用拥有的 BrowserSession；仅导航、读取和验证 |
| Runtime Routing | PASS | `ToutiaoArticleBrowserAdapter`；`toutiao + article` 路由未改变 |
| Title + time + account + status | UNIQUE MATCH | 标题完全一致；行内时间 `08-26 15:38`；当前账号匹配；状态先为 `审核中`、后为 `已发布` |
| Platform accepted | YES | 作品管理页出现唯一文章行，先证明提交被接受，后证明已公开发布 |
| Platform Article ID | `7678241442350891547` | 真实 DOM item/preview href 与公开页 ID 一致 |
| Management URL | `https://mp.toutiao.com/profile_v4/manage/content/all` | 从当前账号真实页面导航得到 |
| External ID | `7678241442350891547` | 公开页稳定 ID；与 URL 路径一致 |
| External URL | `https://www.toutiao.com/article/7678241442350891547/` | 从作品行 `item` 链接进入公开页后读取实际 `page.url()`；未猜测 URL |
| Read-only Verification | PASS | 公开页 `urlReachable=true`、`titleMatch=true`、`bodyMatch=true`、`verificationStatus=Verified` |
| Run | `PASSED` | `18d0cb95-770c-4ac1-a59d-4ee962679c4d` 已链接原 PublishRecord、External ID/URL 并完成 self-test |
| Job | `Success` | `f2e31cfc-176c-488b-8ca9-e6fd3d769ab7`：`NeedsReconciliation -> Submitted -> Success`；`attemptCount=1`、`maxAttempts=1` |
| SubmissionIntent | `Submitted` | `fe2e81e7-1ec2-4ba1-a080-7a2b4206a6d3`：`Unknown -> Submitted`；`finalSubmitCount=1` 保留；External ID 已回收 |
| PublishRecord | `Published / Verified` | `8500aae4-f2d1-49a3-a3db-b55e7336b3f3`：`Prepared -> Submitted/WaitingUser -> Published/Verified`；`success=true` |
| PublishPassed | `PASS` | 作品管理页和公开文章页均唯一验证本篇文章 |
| Final submit count | `1` | 历史真实最终确认动作仍为唯一一次；本轮所有发布控件点击 `0` |
| Final Result | `TOUTIAO_REAL_PUBLISH_PASS` | 只读 reconciliation 完成，无任何第二次提交 |

### 本轮数据库变化

| 表 | Before -> After | 本轮新增 |
| --- | ---: | ---: |
| `publish_jobs`（Toutiao/当前账号） | `2 -> 2` | 0 |
| `submission_intents`（Toutiao/当前账号） | `2 -> 2` | 0 |
| `publish_records`（Toutiao/当前账号） | `2 -> 2` | 0 |

本轮只更新原有 Job/Intent/PublishRecord，并将原 SELF_TEST Run 关联到原 Record；没有新增记录。旧禁言账号 Job/Intent/Record 未复用、未修改。证据保存于 `output/v139-toutiao-reconciliation.json`，包含首次审核中收口、后续已发布匹配、公开页严格回读、External ID/URL 和最终只读复查。后续不得再次提交或为获得 PASS 重发。

### 本轮验证

Focused `tests/v139-toutiao-reconciliation.test.ts` 与 Toutiao adapter tests PASS；`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 均 PASS。

## V1.3.8 Toutiao 新账号真实文章 SELF_TEST - NEEDS_RECONCILIATION - 2026-08-26

本轮在 owner 明确授权下，使用账号 `3841036825934266 / 潭底观鱼` 执行了唯一一次真实文章 SELF_TEST。提交前重新确认了账号身份、`ToutiaoArticleBrowserAdapter` 路由、登录状态、标题/正文严格回读、封面、必填字段和无安全验证；`ACCOUNT_COMPLETION_PROMPT` 仍仅作为 warning。所有副作用均经现有 Publisher、Job、SubmissionIntent 和 PublishRecord 状态机完成。

### 今日头条真实发布结果

| 项目 | Result | Evidence |
| --- | --- | --- |
| Account | PASS | `3841036825934266 / 潭底观鱼`；profile `https://www.toutiao.com/c/user/3841036825934266/`，与旧禁言账号 `578791878688868` 不同 |
| Runtime Routing | PASS | 本次文章 Job 通过 `ToutiaoArticleBrowserAdapter`（BrowserAutomation）执行；视频 API 路由未触碰 |
| Login | PASS | `logged_in`，应用拥有的 BrowserSession 创作中心可用 |
| Pre-submit Gates | PASS | Account Identity、Publish Permission、Article Editor、Title/Body、Strict Readback、Cover、Required Fields、Final Submit Control 均通过；弱提示记录为 `ACCOUNT_COMPLETION_PROMPT` |
| Job | CREATED | Job `f2e31cfc-176c-488b-8ca9-e6fd3d769ab7`；最终状态 `NeedsReconciliation`，`attemptCount=1`、`maxAttempts=1` |
| SubmissionIntent persisted before side effect | YES | Intent `fe2e81e7-1ec2-4ba1-a080-7a2b4206a6d3`；最终 `state=Unknown`、`finalSubmitCount=1`、`errorCode=SUBMISSION_UNCERTAIN` |
| PublishRecord | CREATED | Record `8500aae4-f2d1-49a3-a3db-b55e7336b3f3`；`status=Prepared`、`success=false`、`verificationStatus=WaitingUser` |
| Preview Action | COMPLETED | `预览并发布` 作为预览/确认导航；未将其单独计为最终副作用 |
| Actual Final Submit Action | EXECUTED_ONCE | 在确认层执行唯一一次真实最终发布副作用；之后未再次点击 |
| `finalSubmitClickCount` | 1 | `finalSubmitAction=CLICKED_ONCE`；Intent 同步为 `finalSubmitCount=1` |
| Platform Response | SUBMISSION_UNCERTAIN | `Toutiao final submit was triggered but no reliable public article ID and URL were observed; retry is forbidden` |
| Reconciliation | STILL_UNCERTAIN | 已执行只读 reconciliation；当前页面仍为 `https://mp.toutiao.com/profile_v4/graphic/publish`，未同时取得唯一标题、账号和时间窗口证据 |
| External ID | null | 平台未返回可靠 ID |
| External URL | null | 未猜测或构造 URL |
| Verification | NOT_VERIFIED | 没有可靠公开文章证据，未升级为 Published/Verified |
| PublishPassed | NOT_PASS | 结果不明确，保持项目安全状态 |
| Final Result | `NeedsReconciliation` | 平台是否接受提交尚未可靠确认；禁止重试或重新发布 |
| Failure Reason | `SUBMISSION_UNCERTAIN` | 非明确平台拒绝；缺少稳定 External ID/URL 和只读唯一匹配证据 |

测试文章：`GMP 今日头条真实发布测试 2026-08-26 15:37:41`；Article `47b0bc80-2064-4cf8-a913-35a66ab8dc49`。SELF_TEST Run `18d0cb95-770c-4ac1-a59d-4ee962679c4d` 最终为 `WAITING_FOR_USER`，记录了 `PUBLISH_SUBMIT=PARTIAL_PASSED / RESULT_UNKNOWN`；没有创建第二篇文章、没有换账号、没有重试。

### 数据库变化

| 表 | Before → After | 本轮新增 |
| --- | ---: | --- |
| `publish_jobs` | `1 → 2` | `f2e31cfc-176c-488b-8ca9-e6fd3d769ab7` |
| `submission_intents` | `1 → 2` | `fe2e81e7-1ec2-4ba1-a080-7a2b4206a6d3` |
| `publish_records` | `1 → 2` | `8500aae4-f2d1-49a3-a3db-b55e7336b3f3` |

旧头条 Job `84aebddc-aa54-43cf-a4f8-2269c706a0d7`、Intent `5c2200e7-0c22-4b4e-b52c-318a98a5897a`、Record `8776b6d2-be6f-4fee-84bf-aecdc15e700a` 保持原有状态，未复用旧账号结果。搜狐、百家号、微博未修改。

本轮真实发布证据：`output/v138-toutiao-real-publish.json`。提交后的动作严格限定为观察和只读 reconciliation；任何后续结果确认都不得再次提交。

### 本轮验证

真实提交后执行：`pnpm test` PASS（67 个 test files / 357 个 tests）；`pnpm typecheck` PASS；`pnpm lint` PASS；`pnpm build` PASS。

## V1.3.7 Toutiao gate-only capability preflight - READY_FOR_FINAL_SUBMIT / STOP BEFORE SUBMIT - 2026-08-26

本轮仅修复并重新执行 Toutiao publish-permission gate。账号 `3841036825934266`（“潭底观鱼”）在应用拥有的 BrowserSession 中已唯一确认并成功登录；页面仍显示“请完善账号信息，解锁发布文章、视频等权益功能”，但该文案仅作为弱信号记录为 `ACCOUNT_COMPLETION_PROMPT`，不再单独阻塞发布权限。真实文章编辑器、标题/正文可编辑性、严格回读、封面、必填字段和最终提交控件均通过；按本轮授权仍停止在最终提交之前。

### 今日头条 Gate 结果

| Gate / 项目 | Result | Evidence |
| --- | --- | --- |
| Account Identity | PASS / VERIFIED | `output/v137-toutiao-account-gates.json`；profile `https://www.toutiao.com/c/user/3841036825934266/`，与旧账号 `578791878688868` 不同 |
| Login / Session | PASS | `login.status=logged_in`；创作中心真实页面 `https://mp.toutiao.com/profile_v4/index` |
| Publish Permission | PASS | `articlePublishPermission=true`；文章入口、编辑器及发布控件能力证明通过；`warnings=[ACCOUNT_COMPLETION_PROMPT]` 仅为弱信号 |
| Security Verification | NONE | `noSecurityVerification=true`；未自动处理验证码、滑块、短信或风控 |
| Article Editor | PASS | 真实文章编辑页 `https://mp.toutiao.com/profile_v4/graphic/publish` 已打开 |
| Title / Body | PASS | 标题与正文均真实可编辑 |
| Strict Readback | PASS | `titleReadback=true`、`bodyReadback=true` |
| Cover | PASS | 既有图片素材真实上传验证通过 |
| Required Fields | PASS | `requiredFieldsVerified=true` |
| Final Submit Control | VERIFIED | 唯一可用控件“预览并发布”，`verified=true`、`enabled=true`；未点击 |
| SubmissionIntent / Job / PublishRecord | NO / NO / NO | DB 计数前后均为 `Job=1 / Intent=1 / Record=1` |
| Final Submit Count | 0 | `finalSubmitAction=FORBIDDEN`、`finalSubmitClickCount=0` |
| PublishPassed | NOT_PASS | 本轮是 gate-only，未产生真实发布结果 |
| Result | `READY_FOR_FINAL_SUBMIT=YES` | 所有 11 个 gate 均为 true；等待 owner 对唯一一次真实最终提交再次明确授权 |

旧头条 Job `84aebddc-aa54-43cf-a4f8-2269c706a0d7`、SubmissionIntent `5c2200e7-0c22-4b4e-b52c-318a98a5897a`、PublishRecord `8776b6d2-be6f-4fee-84bf-aecdc15e700a` 保持原有 `NeedsReconciliation` / `Unknown(final_submit_count=1)` / `Prepared` 状态，未复用旧账号结果。搜狐、百家号、微博未修改。

本轮代码变更仅限 `packages/adapters/toutiao/src/browser.ts` 的权限弱信号/明确阻塞判定与 Toutiao 独立回归测试；最终提交路径和共享发布状态机未改动。证据：`output/v137-toutiao-account-gates.json`。

### 本轮验证

Focused Toutiao suite PASS（22 tests）；`pnpm test` PASS（67 个 test files / 357 个 tests）；`pnpm typecheck` PASS；`pnpm lint` PASS；`pnpm build` PASS。

## V1.3.6 Toutiao 新账号 gate-only preflight - BLOCKED / PUBLISH_PERMISSION_DENIED - 2026-08-26

本轮按 owner 最新指示，仅在应用拥有的 BrowserSession 执行 Toutiao gate-only。账号身份已从真实创作中心 DOM 唯一确认，但文章发布权限仍被平台明确阻塞；按 fail-closed 规则立即停止，没有继续执行 Login、Security Verification、Article Editor、Title/Body、Readback、Cover、Required Fields 或 Final Submit Control，也没有创建任何新 Job、SubmissionIntent、PublishRecord，未点击最终提交控件。

### 今日头条

| Gate / 项目 | Result | Evidence |
| --- | --- | --- |
| Account Identity | PASS / VERIFIED | `output/v136-toutiao-account-gates.json`；`page.url()=https://mp.toutiao.com/profile_v4/index`；真实 profile `https://www.toutiao.com/c/user/3841036825934266/`，账号 `3841036825934266`、显示名 `潭底观鱼`，与旧账号 `578791878688868` 不同 |
| Login / Session | NOT_REACHED | 按顺序在 Publish Permission 阶段先行停止；未把未执行的 Login gate 记为 PASS |
| Publish Permission | FAIL | `articlePublishPermission=false`，失败码 `PUBLISH_PERMISSION_DENIED`；页面真实文本为“请完善账号信息，解锁发布文章、视频等权益功能” |
| Security Verification | NOT_REACHED | 权限阻塞前的真实页面未见验证码、滑块、短信或其他安全验证提示；未自动处理任何验证 |
| Article Editor / Title / Body | NOT_REACHED | 账号权限门禁失败，未进入文章编辑页 |
| Title / Body strict readback | NOT_REACHED | 未写入或回读新的测试内容 |
| Cover | NOT_REACHED | 未执行素材选择或封面上传 |
| Required Fields | NOT_REACHED | 未进入最终表单检查 |
| Final Submit Control | NOT_REACHED | 未定位或点击最终提交控件 |
| SubmissionIntent / Job / PublishRecord | NO / NO / NO | DB 计数前后均为 `Job=1 / Intent=1 / Record=1`，无任何新增写入 |
| Final Submit Count | 0 | `finalSubmitAction=NOT_STARTED`、`finalSubmitClickCount=0` |
| External ID / URL | null / null | 没有真实文章提交 |
| PublishPassed | NOT_PASS | 发布权限 gate 失败；未创建新发布记录 |
| Result | `TOUTIAO_ACCOUNT_PREFLIGHT_BLOCKED` | 真实失败原因为 `PUBLISH_PERMISSION_DENIED`；等待 owner 在同一应用 BrowserSession 完成平台要求的账号信息完善 |

旧头条 Job `84aebddc-aa54-43cf-a4f8-2269c706a0d7`、SubmissionIntent `5c2200e7-0c22-4b4e-b52c-318a98a5897a`、PublishRecord `8776b6d2-be6f-4fee-84bf-aecdc15e700a` 保持原有 `NeedsReconciliation` / `Unknown(final_submit_count=1)` / `Prepared` 状态；未复用旧 Run `69fe2493-631d-4ede-a659-dc381a97229e`，也未修改 `output/v135-toutiao-account-gates.json` 或旧真实发布证据。搜狐仍保持既有只读 `STILL_UNCERTAIN` reconciliation，百家号继续冻结，微博未修改。

本轮证据：`output/v136-toutiao-account-gates.json`。后续只有在 owner 完成账号信息后，才可在同一 BrowserSession 重新执行 gate-only；即使所有 gate 最终通过，也必须等待 owner 再次明确授权，才允许考虑唯一一次真实最终提交。

### 本轮验证

`pnpm test` PASS（67 个 test files / 355 个 tests）；`pnpm typecheck` PASS；`pnpm lint` PASS；`pnpm build` PASS。测试过程未改变本轮 Toutiao gate-only evidence 或生产旧 Job/Intent/Record。

## V1.3.5 Toutiao 新账号 gate-only preflight - BLOCKED / SECURITY_VERIFICATION_REQUIRED - 2026-08-26

本轮按 owner 指示重新执行了应用拥有的 BrowserSession 账号身份与文章发文权限 preflight；真实页面已跳转到登录/安全校验页，因此未恢复 Article Editor、Title/Body、Readback、Cover、Required Fields 或 Final Submit Gate，也没有创建新的 SubmissionIntent、Job、PublishRecord 或点击最终提交。

### 今日头条

| 项目 | Result | Evidence |
| --- | --- | --- |
| Account Identity | FAIL | `output/v135-toutiao-account-gates.json`；`page.url()=https://mp.toutiao.com/auth/page/login?redirect_url=JTJGcHJvZmlsZV92NCUyRg==`，无 profile anchor/External Account ID |
| Login | NOT_REACHED | preflight 已先识别登录/安全页面并停止 |
| Publish Permission | FAIL / NOT_VERIFIED | `articlePublishPermission=false`；页面为登录安全校验页，不证明发文权限 |
| Security Verification | BLOCKED | 页面真实 DOM 含“验证码登录”“获取验证码”“滑动查看更多”，返回 `SECURITY_VERIFICATION_REQUIRED` |
| Article Editor / Title / Body | NOT_REACHED | 未满足身份、权限及安全 gate |
| Strict Readback / Cover / Required Fields | NOT_REACHED | 未打开文章编辑器 |
| Final Submit Gate | NOT_REACHED | 未进入最终控件验证 |
| SubmissionIntent persisted | NO | DB 计数前后均为 Job=1 / Intent=1 / Record=1 |
| Final Submit Count | 0 | `finalSubmitAction=NOT_STARTED`、`finalSubmitClickCount=0` |
| External ID / URL | null / null | 没有真实文章提交 |
| PublishPassed | NOT_PASS | 未满足安全前置条件 |
| Result | `TOUTIAO_ACCOUNT_PREFLIGHT_BLOCKED` | fail-closed 停止，等待 owner 在同一应用 BrowserSession 完成正常登录/安全验证 |

旧头条 Job `84aebddc-aa54-43cf-a4f8-2269c706a0d7`、SubmissionIntent `5c2200e7-0c22-4b4e-b52c-318a98a5897a`、PublishRecord `8776b6d2-be6f-4fee-84bf-aecdc15e700a` 保持原有 `NeedsReconciliation` / `Unknown(final_submit_count=1)` / `Prepared` 状态；未复用旧 Run `69fe2493-631d-4ede-a659-dc381a97229e`。搜狐、百家号、微博本轮未修改。

## V1.3.4 Toutiao 新账号 account identity preflight-only - BLOCKED / NO SELF_TEST - 2026-08-26

本轮按最新授权只执行应用拥有的 Playwright BrowserSession 账号身份 preflight；由于页面暴露明确的发文权限阻塞，未恢复 SELF_TEST，也未创建新的 Run、Job、SubmissionIntent 或 PublishRecord。搜狐、百家号、微博均未触碰。

### 今日头条

| 项目 | Result | Evidence |
| --- | --- | --- |
| New Account Confirmed | YES | `output/v134-toutiao-account-preflight.json`；唯一 profile `https://www.toutiao.com/c/user/2732723872994553/`，display name `在沙滩作画的画家`，与旧账号 profile `578791878688868` 不同 |
| Login / Session | PASS（preflight） | `page.url()=https://mp.toutiao.com/profile_v4/index`，创作中心真实 DOM 可读；本轮未额外执行发布流程 Login gate |
| Publish Permission | FAIL | `articlePublishPermission=false`，页面真实文本为“请完善账号信息，解锁发布文章、视频等权益功能” |
| Title / Body | NOT_REACHED | 权限门禁失败，未打开文章编辑器 |
| Strict Readback | NOT_REACHED | 未创建新 Run/Job |
| Cover | NOT_REACHED | 未创建新 Run/Job |
| Required Fields | NOT_REACHED | 未创建新 Run/Job |
| SubmissionIntent persisted | NO | preflight-only 分支在任何新 DB 写入之前停止；头条计数前后均为 Job=1 / Intent=1 / Record=1 |
| Final Submit Count | 0 | `finalSubmitAction=NOT_STARTED`、`finalSubmitClickCount=0` |
| Platform Response | `PUBLISH_PERMISSION_DENIED` | 页面要求先完善账号信息，未绕过任何验证或权限限制 |
| External ID / URL | null / null | 没有真实文章提交 |
| PublishPassed | NOT_PASS | 未满足发布权限 gate |
| Result | `TOUTIAO_ACCOUNT_PREFLIGHT_BLOCKED` | 按安全要求立即停止；旧账号 Job/Intent/Record 未修改 |

旧头条 Job `84aebddc-aa54-43cf-a4f8-2269c706a0d7`、SubmissionIntent `5c2200e7-0c22-4b4e-b52c-318a98a5897a`、PublishRecord `8776b6d2-be6f-4fee-84bf-aecdc15e700a` 的原有 `NeedsReconciliation` / `Unknown(final_submit_count=1)` / `Prepared` 状态保持不变；旧 Run `69fe2493-631d-4ede-a659-dc381a97229e` 未复用。本轮只读 evidence 另含页面截图 `output/v134-toutiao-account-preflight.png`。

### 验证

适配器新增了账号完善导致的 `PUBLISH_PERMISSION_DENIED` 分类，并使用 `a[href]` 过滤真实 profile anchor、去重候选身份；回归覆盖该限制且不点击发布控件。`pnpm test` PASS（66 files / 353 tests）、`pnpm typecheck` PASS、`pnpm lint` PASS、`pnpm build` PASS。

## V1.3.3 Toutiao 新账号前置门禁 + Sohu 只读 reconciliation - BLOCKED / STILL_UNCERTAIN - 2026-08-26

本轮严格按一次性真实提交安全边界执行。今日头条先进行应用拥有的 Playwright BrowserSession 只读账号检查；搜狐只运行既有 Job 的只读 reconciliation，没有创建新文章或重发。

### 今日头条

| 项目 | Result | Evidence |
| --- | --- | --- |
| New Account Confirmed | NO | `output/v133-toutiao-new-account-real-publish.json`；页面标题为“头条号”，但 `page.url()` 为 `https://mp.toutiao.com/profile_v4/`，真实 DOM body 为空，没有唯一 profile anchor 或 display name |
| Login | NOT_REACHED | 账号身份前置门禁失败，未进入 Login/Editor 流程 |
| Publish Permission | NOT_VERIFIED | `creatorCenterAccessible=false`、`articlePublishPermission=false` |
| Title / Body | NOT_REACHED | 未创建新 Run/Job |
| Strict Readback | NOT_REACHED | 未创建新 Run/Job |
| Cover | NOT_REACHED | 未创建新 Run/Job |
| Required Fields | NOT_REACHED | 未创建新 Run/Job |
| SubmissionIntent persisted | NO | 前置身份门禁失败，DB 中新计数未增加 |
| Final Submit Count | 0 | `finalSubmitAction=NOT_STARTED`、`finalSubmitClickCount=0` |
| Platform Response | `ACCOUNT_IDENTITY_UNVERIFIED` | 无法从当前应用拥有 DOM 唯一确认当前账号；没有绕过登录/验证码/风控 |
| External ID / URL | null / null | 没有真实提交 |
| PublishPassed | NOT_PASS | 未满足发布条件 |
| Result | `TOUTIAO_ACCOUNT_PREFLIGHT_BLOCKED` | 按要求立即停止；旧账号/旧 Job/Intent/Record 未修改 |

旧头条 Job `84aebddc-aa54-43cf-a4f8-2269c706a0d7`、SubmissionIntent `5c2200e7-0c22-4b4e-b52c-318a98a5897a`、PublishRecord `8776b6d2-be6f-4fee-84bf-aecdc15e700a` 仍保持原有 `NeedsReconciliation` / `Unknown(final_submit_count=1)` / `Prepared` 状态；本轮未复用旧 Run `69fe2493-631d-4ede-a659-dc381a97229e`，也未创建新的 L5 Run。

### 搜狐

| 项目 | Result | Evidence |
| --- | --- | --- |
| Old Job Found | YES | Job `6fb37664-4340-4e1a-accd-865987e907df`，账号 `33418593-16eb-4ba4-8d61-0a0189cccd2e` |
| Old Article Found | NO | 内容管理页未取得可用真实 DOM 入口/唯一文章行；不据此推断未发布 |
| Platform Status | Unknown / NeedsReconciliation | `STILL_UNCERTAIN`，保持原 Job `NeedsReconciliation` |
| External ID / URL | null / null | 未获得可靠公开文章证据 |
| Read-only Verification | PASS（只读动作完成） | `output/v129-sohu-reconciliation-current.json`，`finalSubmitCalled=false`、`secondSubmitCalled=false` |
| PublishPassed | NOT_PASS | 未满足标题、时间、正文摘要、账号和状态的唯一匹配条件 |
| New Final Submit Count | 0 | 本轮没有调用搜狐最终提交 |

本轮新增 Toutiao 账号前置检查及回归测试，覆盖 `ACCOUNT_MUTED` 和提交后禁言分类；不会绕过验证码、滑块、短信或实名验证。证据文件：`output/v133-toutiao-new-account-real-publish.json`、`output/v129-sohu-reconciliation-current.json`。完整验证：`pnpm test` PASS（66 files / 352 tests，含 better-sqlite3 native rebuild）、`pnpm typecheck` PASS、`pnpm lint` PASS、`pnpm build` PASS。

Sohu evidence was refreshed once more after the harness update: the real page reached `https://mp.sohu.com/mpfe/v4/contentManagement/first/page?newsType=1` and exposed the authenticated account, all status categories, and no exact-title row. The management evidence still reports `totalContentCount=1` because one icon-backed value is not numerically resolved, so the negative contract is incomplete and the old Job remains `NeedsReconciliation`; no final-submit action occurred.

## V1.3.2 Toutiao Article BrowserAutomation 真实最终提交 SELF_TEST - NEEDS_RECONCILIATION - 2026-08-26

本轮已按用户授权执行唯一一次真实最终提交动作。提交路径为 `预览并发布`（预览导航）→ `确认发布`（产生发布副作用的最终确认），真实最终确认点击次数为 `1`，之后未重试、未使用新账号、未创建第二篇测试文章。

- Evidence：`output/v132-toutiao-real-publish.json`，`finalSubmitAction=CLICKED_ONCE`，`finalSubmitClickCount=1`，`publishPassed=NOT_PASS`。
- 平台最终响应：`账号已被禁言无法发布文章，请先保存草稿`；当前页面未返回稳定 External ID 或 External URL。
- 只读回查未找到唯一可验证的公开文章链接，因此保持 `TOUTIAO_REAL_PUBLISH=NEEDS_RECONCILIATION`，不写入 `PublishPassed=PASS`。
- `Job=84aebddc-aa54-43cf-a4f8-2269c706a0d7`：`NeedsReconciliation`。
- `SubmissionIntent=5c2200e7-0c22-4b4e-b52c-318a98a5897a`：`Unknown`，`final_submit_count=1`。
- `PublishRecord=8776b6d2-be6f-4fee-84bf-aecdc15e700a`：`Prepared`，`success=0`，无 External ID/URL，`verification_status=WaitingUser`。
- L5 Run：`1595795e-f11c-4544-91ad-8e503124042c`；Article：`337b6b71-98f4-45b4-97b8-782180d7fe83`。
- 本轮最初数据库基线到最终：`publish_jobs 13→14`、`submission_intents 10→11`、`publish_records 7→8`。仅复用了同一 Job/Article/PublishRecord，未因前置安全失败创建额外文章。
- 验证：`pnpm test`（66 files / 350 tests PASS）、`pnpm typecheck` PASS、`pnpm lint` PASS、`pnpm build` PASS。


## V1.3.1 Toutiao Article BrowserAutomation 真实 pre-submit SELF_TEST — PASS / STOP BEFORE SUBMIT — 2026-08-26

本轮严格停止在最终发布按钮之前，未执行 click、dispatchEvent、键盘提交、JS submit 或任何等效发布行为。

- 最终真实 L3 run：`69fe2493-631d-4ede-a659-dc381a97229e`，`overallResult=PASSED`。
- 独立页面证据：`output/v131-toutiao-pre-submit-evidence.json`，`result=PREPARED`。
- 页面 URL：`https://mp.toutiao.com/profile_v4/graphic/publish`。
- 账号：`3ffa4368-e8cd-4725-8658-846ad35b1980`；最终数据库状态仍为 `enabled=1`、`login_status=logged_in`、`authorization_status=Authorized`、`connection_mode=BrowserAutomation`，BrowserAutomation session 存在。
- Runtime routing：`toutiao + article -> ToutiaoArticleBrowserAdapter`；`toutiao + video -> ToutiaoAdapter`（官方 API 路由保持不变）。
- Title、Body 均完成真实页面 round-trip readback；头条封面要求已满足：单图封面上传成功，使用真实 file input，`coverInputVerified=true`，`imageRequirement=cover_uploaded`。
- 最终发布控件已定位并验证为唯一符合条件的可见、启用控件，标签为 `预览并发布`；`定时发布` 被排除，不执行点击。

### Gate 结果

| Gate | Result | Evidence / Failure |
| --- | --- | --- |
| Runtime routing | PASS | Article 使用 `ToutiaoArticleBrowserAdapter`；video 仍使用官方 API `ToutiaoAdapter`。 |
| Login / Session | PASS | `logged_in`、`Authorized`、BrowserAutomation session 存在；页面可进入已登录创作环境。 |
| Article editor | PASS | `https://mp.toutiao.com/profile_v4/graphic/publish`，真实 DOM editor 已发现。 |
| Title | PASS | `title_value_round_trip_match`。 |
| Body | PASS | `body_value_round_trip_match`。 |
| Strict readback | PASS | Title 与 Body 均严格回读匹配。 |
| Required fields | PASS | 页面必填字段检查通过，未发现 blocker。 |
| Cover | PASS | 单图封面真实上传；`cover_upload:file_input`；头条封面必填要求满足。 |
| Final submit discovery | PASS | 唯一可见且 enabled 的符合条件控件：`预览并发布`；未点击。 |
| Final submit clicks | 必须 0 | `finalSubmitClickCount=0`；`finalSubmitAction=FORBIDDEN`。 |
| Pre-submit readiness | PASS | `READY_FOR_FINAL_SUBMIT=YES`。 |

### 发布数据副作用

| 数据项 | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `publish_jobs` | 13 | 13 | 0 |
| `submission_intents` | 10 | 10 | 0 |
| `publish_records` | 7 | 7 | 0 |

- `publishJobId=null`、`publishRecordId=null`、`externalId=null`、`externalUrl=null`、`publish_confirmed_at=null`。
- 本轮没有真实 Published 结果，也没有将 pre-submit 验证标记为 `Published` 或 `PublishPassed=PASS`。

### 本轮最小修复与回归验证

- 修复头条文章封面证据的严格契约：只有真实封面上传证据才可通过 Image Gate。
- 修复登录 sweep 不应使用 Toutiao 官方 API 默认适配器检查 BrowserAutomation 文章账号的问题，避免成功自测后账号被错误置为 expired；视频 API 路由未改动。
- Final Submit discovery 增加唯一性、visible、enabled 和 blocker 的 fail-closed 检查。
- 回归测试：`packages/adapters/toutiao/src/browser.test.ts` 13/13；`tests/v114-background-automation-status.test.ts` 8/8；`tests/v114-browser-lifecycle.test.ts` 7/7。
- 全量验证：`pnpm test` 66 个 test files、348 个 tests 全部通过；`pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过。

**READY_FOR_FINAL_SUBMIT=YES**（仅表示已准备好；本轮已停止，未继续真实发布。）

### Toutiao account center runtime-package mismatch - DEPLOYED / UI ATTENTION VERIFIED / NO LOGIN OR PUBLISH - 2026-08-25

- Root cause was the launched installed package, not the current source chain: the running `C:\GMP116ZhihuL5\Geo Media Publisher\resources\app.asar` was the older package whose `platforms:list` handler returned `repository.listPlatforms()` and whose V11 renderer read `platform.integrationMode` directly. The persisted Toutiao row is `integration_mode=OAuth`, so that runtime could only render `自测`.
- The current chain is present in the rebuilt package: AdapterRegistry resolves Toutiao account lifecycle through the unique `ToutiaoArticleBrowserAdapter` (`BrowserAutomation`), IPC `platforms:list` calls `listPlatformViews()` and overlays `accountConnectionMode`, and the renderer uses `accountConnectionMode ?? integrationMode` plus the existing expired/needs-login rows for `重新登录`.
- Rebuilt `release/win-unpacked`, backed up the two old installed binaries under `C:\GMP116ZhihuL5\Geo Media Publisher.previous-20260825-account-connection`, and replaced only the installed executable and `resources\app.asar`. The running renderer command line now points to the corrected installed asar; its hashes match the rebuilt package.
- Real installed-app accessibility verification after restart shows `博客园、抖音、头条需要重新登录`, `重新登录`, and `连接账号`. No account login, SELF_TEST, Job, PublishRecord, SubmissionIntent, external ID, or external URL was created. Account-center card-level click inspection was blocked by the Computer Use host screenshot/coordinate guard; this is not treated as a passed card-level visual check.

### Toutiao account connection lifecycle - CODE COMPLETE / READY_FOR_TOUTIAO_LOGIN / NO REAL SELF_TEST - 2026-08-25

- Account Center now exposes the existing Toutiao platform with a runtime-derived `accountConnectionMode=BrowserAutomation`; the Connect Account and relogin code paths are implemented and test-covered.
- Toutiao account lifecycle IPC uses the existing article BrowserAutomation adapter for visible manual login, completion, relogin, dashboard opening, session checks, cancellation, and disconnect. The owner must still complete the normal official login and any QR, password, SMS, CAPTCHA, or security verification in the visible browser; the system does not automate or bypass those steps.
- Browser connection completion persists through the existing encrypted Session boundary and reload path. Save failure closes only the newly owned temporary session, preserves existing stored Session data, and never calls Session clear from the save-failure path.
- The official Toutiao video API adapter, `toutiao + video` content routing, credentials path, and video capability remain unchanged. The article BrowserAutomation test path keeps `finalSubmitClickCount=0` and does not click the final submit control.
- This implementation did not create a Job, PublishRecord, SubmissionIntent, external ID, or external URL; no Toutiao account login, Article SELF_TEST, Dry Run, or publish was run. Live manual login remains a user action and real publish gates remain pending.
- Verification: focused connection/UI suite PASS (27 tests); full `pnpm test` PASS (66 files / 338 tests, including native rebuild); `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm build` PASS.

### V1.2.5 content-kind runtime routing + Toutiao article dry-run gate - CODE COMPLETE / LOGIN_REQUIRED / NO REAL SELF_TEST - 2026-08-25

- Runtime registration now keeps the existing official API `ToutiaoAdapter` for `toutiao + video` and registers `ToutiaoArticleBrowserAdapter` for `toutiao + article`. `AdapterRegistry.getForContent()` routes by the persisted `PublishJob.contentKind`; unsupported content kinds, missing capabilities, and ambiguous registrations fail closed. There is no registration-order fallback.
- `PublisherService`, `PersistentScheduler`, and the desktop SELF_TEST path now resolve the content-specific adapter. The existing video route and official API adapter behavior remain unchanged. Owned browser-session shutdown now closes all registered adapter instances, including the Toutiao article instance.
- Read-only production boundary check for Toutiao account `3ffa4368-e8cd-4725-8658-846ad35b1980`: `enabled=0`, `login_status=expired`, `browser_session_id=NULL`, paused because login expired, and the encrypted credential store has no `session:toutiao:<accountId>` record. The Login gate is therefore `LOGIN_REQUIRED`; the real page dry-run stopped before opening the article editor. Editor entry, title/body fill/readback, required fields, cover, and final-control gates were not attempted. `finalSubmitClicks=0`.
- No Toutiao Job, SubmissionIntent, PublishRecord, External ID, or External URL was created. `PublishPassed` remains unchanged and must not be upgraded. The next action requires the owner to re-enable/reconnect this account and complete the normal Toutiao login/security verification, after which a separately approved real SELF_TEST can resume at the Login gate.
- Verification for this routing change: focused adapter/runtime/Publisher/SELF_TEST suite PASS (10 files / 55 tests); full `pnpm test` PASS (65 files / 331 tests, including native rebuild), `pnpm typecheck` PASS, `pnpm lint` PASS, and `pnpm build` PASS.

### V1.2.5 Revised Zhihu + Toutiao article BrowserAutomation scope - CODE COMPLETE / NO REAL SELF_TEST - 2026-08-25

- This pass followed the revised owner boundary. Zhihu changes are confined to `packages/adapters/zhihu/**` and its tests. The adapter now discovers title/body editors with multiple semantic and structural signals, fails closed on ambiguous candidates, uses specific `CONTENT_EDITOR_AMBIGUOUS`, `CONTENT_TITLE_NOT_VERIFIED`, and `CONTENT_BODY_NOT_VERIFIED` details under the existing `CONTENT_REJECTED` boundary, and performs normalized strict readback.
- Zhihu now exposes a platform-specific `prepareFinalSubmit` preflight that verifies the current editor, title/body readback, and final-submit control without clicking. Existing read-only `reconcile` behavior remains available; this pass did not create a Job, retry an old `NeedsReconciliation` Job, or republish any old record.
- The existing official API `ToutiaoAdapter` remains the registered video adapter with `supportsArticle=false`; its OAuth/video behavior and rejection semantics were not changed. A separate exported `ToutiaoArticleBrowserAdapter` in `packages/adapters/toutiao/src/browser.ts` keeps the formal platform ID `toutiao` and adds a browser-only article preflight module: owned Session login check, creator article entry discovery, title/body DOM discovery, required-field validation, cover input inspection/upload, strict readback, and final-submit control recognition.
- The Toutiao article module has no final-submit method and never clicks the final control. Its response explicitly reports `finalSubmitClickCount=0` and `finalSubmit=user_action_required`. The current runtime registry continues to register the official video adapter, so the article module is code-complete and locally tested but is not claimed as runtime `READY_FOR_REAL_SELF_TEST` until an owner-approved runtime routing/session path is available.
- No live platform session was used for this pass. There is no new real Login PASS, no real external title/body/required-field/final-control evidence, no Publish Job, SubmissionIntent, PublishRecord, External ID, or External URL. `PublishPassed` remains unchanged and must not be upgraded.
- The approved read-only Zhihu reconciliation entry was reused for the three existing Jobs `1bf90421-fa31-4a1f-b5a0-6639e671392b`, `ea8c6507-ebb3-449a-9b01-227272ba4b77`, and `4b7cd010-ad60-4eb5-8290-0d63e0b28bbe`. All three remained `NeedsReconciliation`; the creator contents page returned a 404-style state with no reliable title/account/time-window evidence. No second submit or retry occurred. Evidence was refreshed at `output/v129-zhihu-reconciliation-all.json`.
- Verification: focused Zhihu/Toutiao tests PASS (11/11); `pnpm lint` PASS; `pnpm typecheck` PASS; `pnpm test` PASS (64 files / 327 tests, including native rebuild); `pnpm build` PASS. No shared `Publisher`, `Scheduler`, `BrowserSessionManager`, `SubmissionIntent`, or `PublishRecord` implementation was modified. Baijiahao, Weibo, and Sohu business implementations were not touched.

### V1.2.4 Baijiahao one-time real L5 SELF_TEST - FAILED / NO FINAL SUBMIT - 2026-08-25

- This pass read the latest `PROJECT_STATE.md` first and lifted Baijiahao from `SKIPPED_BY_OWNER` only for one controlled real test. The target was the current enabled/logged-in/Authorized BrowserAutomation account `63a5c93c-e62f-4f6b-b2ae-58c1e1e01b38`, with saved Browser Session present. The preflight passed; the application-owned Visible Browser reached the platform login check.
- The app persisted L5 confirmation Run `203be3e0-91a2-4ebc-b968-20775357daf7` and `confirmPublish` was called exactly once. Login and Session steps passed. The intended unique article marker was `GMP 百家号真实发布测试 2026-08-25 15:07:27` with a short matching body, but the live page did not expose a reliably detectable title/body editor after backend entry discovery. `EDITOR_OPEN`, `TITLE_FILL`, and `BODY_FILL` therefore failed with `CONTENT_REJECTED`; the run stopped at `PUBLISH_SUBMIT=FAILED / CONTENT_NOT_VERIFIED` before creating a Job.
- Safety evidence: `publishJobId=null`, `publishRecordId=null`, `externalId=null`, `externalUrl=null`; no submission intent was created, `final_submit_count=0`, and no final publish control was clicked. No CAPTCHA/SMS/QR/security challenge was bypassed or encountered. This result is not a successful publish and must not be promoted to `PublishPassed=PASS`.
- Result: Baijiahao is now explicitly `FAILED / CONTENT_EDITOR_NOT_VERIFIED` for this one-time run, not `SKIPPED_BY_OWNER`. The next action, if authorized in a later pass, must be a separately approved selector/editor investigation; this pass does not retry. Evidence: [v130 one-time Baijiahao run](output/v130-baijiahao-real-publish.json) and [read-only production snapshot](output/v129-production-state-snapshot.json).
- Weibo remains the frozen `PublishPassed=PASS` baseline and was not touched. Sohu remains read-only with historical `final_submit_count=1` and `NeedsReconciliation`; Zhihu remains old `NeedsReconciliation` with no new SELF_TEST; Bilibili remains `SKIPPED_MEDIA_REQUIRED`; Lieju remains `DEFERRED / RISK_CONTROL`; TestPlatform remains untested.
- Code scope stayed limited to the Baijiahao adapter/self-test path and its focused tests. Publisher, Scheduler, BrowserSessionManager, and the successful Weibo Adapter were not refactored or modified.

### V1.2.3 Current app account-center check + connected-platform re-filter - NO NEW SELF_TEST - 2026-08-25

- This pass read the latest `PROJECT_STATE.md` first and resumed only the requested real-platform screening. The current application was launched through the registered `com.geo.mediapublisher` app. Its live UI accessibility state showed the `账号中心` entry and `在线账号 4 / 共 6 个已添加账号`; it did not show the previous `0 / 0` state. No login, logout, account mutation, or platform publish action was performed.
- Production SQLite was read-only checked. It contains `17` accounts and `10` accounts with `enabled=1` and `login_status=logged_in`: Baijiahao `63a5c93c-e62f-4f6b-b2ae-58c1e1e01b38`, Bilibili `9b11ca84-5824-4ed8-aadb-fa204b39c249`, Lieju `c1b2fea4-b783-4c60-9db0-392e09edd16b` and `e8f7c0b4-3aef-48ee-bced-2916e951435f`, Sohu `33418593-16eb-4ba4-8d61-0a0189cccd2e`, Weibo `28fc11e7-ba6b-4b35-b13e-fe2ad1b1a1ef`, Zhihu `8f666025-1776-41d5-8295-3bab150f615c`, plus three legacy `platform_key=test` accounts. The enabled/login rows expose no second real platform outside the explicit exclusions.
- Screening result: Weibo remains the already verified `PublishPassed=PASS` baseline and was not repeated; Bilibili remains `SKIPPED_MEDIA_REQUIRED`; both Lieju accounts remain `DEFERRED / RISK_CONTROL`; Baijiahao remains `SKIPPED_BY_OWNER`; Sohu remains read-only because Job `6fb37664-4340-4e1a-accd-865987e907df` has `final_submit_count=1` and `NeedsReconciliation`; Zhihu remains read-only because old `NeedsReconciliation` Jobs `1bf90421-fa31-4a1f-b5a0-6639e671392b`, `ea8c6507-ebb3-449a-9b01-227272ba4b77`, and `4b7cd010-ad60-4eb5-8290-0d63e0b28bbe` have not all been reliably closed. The three `test` accounts are not production platforms: the catalog marks them `not_implemented` and the current runtime has no registered Adapter.
- No new real SELF_TEST, submission intent, Publish Job, PublishRecord, external ID, or external URL was created in this pass. No Sohu or Zhihu reconciliation action was repeated, and no unknown-platform compatibility logic, Weibo Adapter, Publisher, Scheduler, or BrowserSessionManager code was changed. There is therefore no second real `PublishPassed=PASS` platform yet.
- Existing Weibo evidence remains unchanged: PublishRecord `4a46a856-0beb-4d13-9855-09e41201ef39`, External ID `Rf17LuR6n`, External URL `https://weibo.com/4020073566/Rf17LuR6n`.

### Main process EPIPE / account center 0/0 - ROOT_CAUSE FIXED - NO REAL PUBLISH - 2026-08-25

- This pass read the latest state first and froze all real platform publishing. No Zhihu, Sohu, Weibo, Bilibili, Lieju, or Baijiahao SELF_TEST was run; no new production Publish Job or PublishRecord was created; Weibo business implementation and its existing successful record were not changed.
- ROOT_CAUSE: production SQLite still contains three enabled + `logged_in` legacy `platform_key=test` accounts, while the runtime registry intentionally has no `test` Adapter. `PersistentScheduler` called `AdapterRegistry.get("test")` from its timer login sweep, producing an unhandled rejection. `accounts:overview` independently called the same throwing lookup; the Renderer uses that request in an uncaught `Promise.all`, so the account-center state stayed at its initial `0 / 0`. The Electron `replyWithError` / `console.error` EPIPE was a secondary reporting failure when output was no longer writable, not the first business exception.
- A direct Electron launch (A) reproduced the original first error as `No adapter registered for platform: test` with no EPIPE. The recent Sohu runner (B) was run read-only against the existing waiting state; its stderr and the local diagnostics contained no new EPIPE after the fix. A task-owned forced runner termination separately demonstrated the suspected orphan risk, and the Electron process tree was then closed and verified empty. Recent v12x runners do not use a child `spawn`/`exec` lifecycle for the app; the Playwright runner has `finally { electronApp.close() }`, while the direct Electron reconciliation scripts call `app.quit()` in the same process.
- Temporary local diagnostics now record `UNCAUGHT_EXCEPTION`, `UNHANDLED_REJECTION`, IPC channel name, raw error name/message/stack, pid/ppid, and stdout/stderr writable/destroyed state. Diagnostic strings and sensitive-key-shaped values are redacted; no Cookie, Token, Session, or Secret value is recorded. IPC errors are rethrown after recording, so errors are not swallowed.
- Minimal fix: `AdapterRegistry.tryGet()` and safe registered-platform checks in Publisher/Scheduler; unknown accounts/jobs are skipped without invoking an unregistered Adapter. `accounts:overview` preserves unknown-platform accounts as unconfigured rows instead of rejecting. Startup failure reporting and IPC handler failures use the local diagnostic file. No database reset, account deletion, logout, relogin, or runner/platform business rewrite was performed.
- Production read-only evidence after verification: platform catalog `42`; accounts `17`; enabled + `logged_in` accounts `10`; `accounts:overview` returned `17` rows. Weibo Job `d9582333-7b4f-4957-a3a3-ad5abf1c0300`, PublishRecord `4a46a856-0beb-4d13-9855-09e41201ef39`, External ID `Rf17LuR6n`, and URL `https://weibo.com/4020073566/Rf17LuR6n` are unchanged. `credentials.enc` remains present with the same size/hash (`140148` bytes / `fa169bd4ebb8692224d08e8ea48ec18e40ccbabe08562b7cd06950c3190a0035`).
- Verification: three direct cold starts had no main-process error markers; the rebuilt `release/win-unpacked/Geo Media Publisher.exe` also started and closed cleanly; the read-only IPC check returned `platforms=42`, `accounts=17`, `overview=17`; the runner cleanup left no task-owned Electron process; `pnpm lint` PASS, `pnpm typecheck` PASS, `pnpm test` PASS (`61` files / `305` tests), and `pnpm build` PASS. Evidence logs are under `output/electron-crash-diagnostics/`; the main-process diagnostic file is `C:\Users\Administrator\AppData\Roaming\codex-media-publisher\production-data\logs\main-process-diagnostics.log`.

### V1.2.2 Sohu/Zhihu read-only reconciliation - NO NEW SUBMIT - 2026-08-25

- This pass read the latest `PROJECT_STATE.md` first. The frozen Weibo real-publish PASS and regression baseline were left unchanged. No Sohu second submit, no Zhihu new SELF_TEST, no Bilibili action, no Lieju action, no Baijiahao action, and no existing Zhihu `NeedsReconciliation` Job was resubmitted.
- Sohu only reused the current Job `6fb37664-4340-4e1a-accd-865987e907df`, account `33418593-16eb-4ba4-8d61-0a0189cccd2e`, Article `58c1c7ee-c763-4cd7-892b-15b550be5923`, and existing PublishRecord `0fa3c07a-d854-4680-b39b-2b52fa12f64e`. The application-owned visible Browser entered the same account's article-management page and searched the exact title `Geo Media Publisher 发布链路测试`; title occurrence was `0`, while the page showed `已发布=0`, `草稿=0`, and inconsistent total-content/category evidence. The reconciler therefore correctly returned `STILL_UNCERTAIN` and kept Job=`NeedsReconciliation`; `final_submit_count=1`, PublishRecord=`Prepared`/`WaitingUser`, External ID/URL remain null. No publish control was clicked and Sohu PublishPassed is not `PASS`.
- The complete current Zhihu `NeedsReconciliation` set was enumerated and reconciled read-only with the saved account Session `0b4d0ea23a16330d8162eae0f8cb6d7353854757e58a008d7f42bebea60d1ffd` in the application-owned visible Browser:
  - Job `1bf90421-fa31-4a1f-b5a0-6639e671392b`, exact title `Geo Media Publisher 知乎发布测试 2026-08-24 15:56:58`, existing PublishRecord `c9a537d5-51e8-4b04-8261-103a99bca082`, `final_submit_count=1`: `STILL_UNCERTAIN`, unchanged `NeedsReconciliation`.
  - Job `ea8c6507-ebb3-449a-9b01-227272ba4b77`, exact title `Geo Media Publisher 发布链路测试`, no PublishRecord, `final_submit_count=0`: `STILL_UNCERTAIN`, unchanged `NeedsReconciliation`.
  - Job `4b7cd010-ad60-4eb5-8290-0d63e0b28bbe`, exact title `木渎园林绿化区白蚁防治常见问题：一次处理还是定期管理？`, no PublishRecord, `final_submit_count=0`: `STILL_UNCERTAIN`, unchanged `NeedsReconciliation`.
- All three Zhihu checks reached `https://www.zhihu.com/creator/manage/contents`, but the saved session returned a 404-style page (`你似乎来到了没有知识存在的荒原`). No reliable exact-title, account, time-window, published URL, or draft evidence was available. Because none could be safely classified `CONFIRMED_NOT_PUBLISHED`, the conditional new Zhihu L5 creation gate was not opened. No final publish control was clicked.
- The production snapshot found no other eligible enabled + logged-in `BrowserAutomation` platform outside the explicit exclusions: enabled sessions were Baijiahao, Bilibili, Lieju, Sohu, Weibo, and Zhihu. Therefore no additional platform SELF_TEST was created. Weibo remains the only verified real publish in the project.
- Evidence: [production account/job snapshot](output/v129-production-state-snapshot.json), [Sohu read-only reconciliation](output/v129-sohu-reconciliation-current.json), [all Zhihu read-only reconciliations](output/v129-zhihu-reconciliation-all.json), [Sohu DB state](output/v119-sohu-db-state-v129-6fb37664.json), [Zhihu 1bf DB state](output/v119-sohu-db-state-v129-1bf90421.json), [Zhihu ea8 DB state](output/v119-sohu-db-state-v129-ea8c6507.json), and [Zhihu 4b7 DB state](output/v119-sohu-db-state-v129-4b7cd010.json).
- Validation: `pnpm typecheck` PASS. This pass added only bounded read-only evidence harnesses; no Adapter, Publisher, Scheduler, BrowserSessionManager, or platform business implementation was modified.

### V1.2.1 Weibo regression frozen + Sohu same-Job one-submit attempt - NEEDS_RECONCILIATION - 2026-08-25

- This pass read the latest `PROJECT_STATE.md` first and stayed within the requested boundary: Weibo business implementation was not changed, Bilibili was not touched, the existing Zhihu `NeedsReconciliation` Job was not touched, and no new Sohu Job, Article, Session, submission intent, or PublishRecord was created.
- Weibo is frozen as the real-publish baseline. The existing successful Job `d9582333-7b4f-4957-a3a3-ad5abf1c0300`, PublishRecord `4a46a856-0beb-4d13-9855-09e41201ef39`, submission intent `e090aaf4-e53c-49bd-9000-300524159bb3`, External ID `Rf17LuR6n`, and URL `https://weibo.com/4020073566/Rf17LuR6n` remain unchanged. Added read-only regression baseline `scripts/v127-weibo-real-publish-baseline.json` and `tests/v127-weibo-real-publish-regression.test.ts`; the baseline asserts one click, `final_submit_count=1`, body/image evidence, reachable URL, and verified Job/Intent/PublishRecord state.
- Sohu reused the exact existing Run `3e58a669-072f-4373-bff1-d1dcccaa5f17`, Job `6fb37664-4340-4e1a-accd-865987e907df`, Article `58c1c7ee-c763-4cd7-892b-15b550be5923`, Session, submission intent `5fcfbc88-5719-415d-b6b0-d992cbe9cfa5`, and PublishRecord `0fa3c07a-d854-4680-b39b-2b52fa12f64e`. The owner-confirmed visible yellow `发布` control was used for the single real final-submit attempt; no CAPTCHA or security verification was bypassed.
- The Sohu final submit side effect was executed exactly once. The Browser navigated from `https://mp.sohu.com/mpfe/v4/contentManagement/news/addmoment` to `https://mp.sohu.com/mpfe/v4/contentManagement/first/page` and captured an `已发布` toast, but the adapter could not obtain a reliable published External ID/URL or complete external verification (`RESULT_URL_NOT_FOUND`). The exact DB snapshot is [v128 final Sohu state](output/v119-sohu-db-state-v128-final.json): Job=`NeedsReconciliation`, `last_error_code=SUBMISSION_UNCERTAIN`, submission intent=`Unknown`, `final_submit_count=1`, PublishRecord=`Prepared`/`WaitingUser`, External ID/URL=null. No retry is permitted. Sohu `PublishPassed` is not `PASS`; result=`NEEDS_RECONCILIATION`.
- The Sohu-only code change was limited to recognizing the real custom `div` publish control and allowing direct-submit preflight only for the explicit same-Job `CONTINUE_PENDING_ACTION` trigger. Added regression coverage in `packages/adapters/sohu-media/src/browser.test.ts`; Weibo, Bilibili, and shared Publisher/Scheduler/BrowserSessionManager business implementations were not changed. The Sohu runner was stopped immediately after the uncertain result.
- Evidence: [frozen Weibo baseline](scripts/v127-weibo-real-publish-baseline.json), [Weibo regression test](tests/v127-weibo-real-publish-regression.test.ts), [Sohu live resume log](output/v128-sohu-resume-frozen-weibo.log), and [Sohu final DB state](output/v119-sohu-db-state-v128-final.json).
- Validation: `pnpm lint` PASS; `pnpm typecheck` PASS; `pnpm test` PASS (`60` files / `301` tests); `pnpm build` PASS. The first test attempt hit a Windows `better-sqlite3` file lock from leftover app processes; after stopping only the two task-owned duplicate Electron app roots, native rebuild and the full test suite passed. No installer was generated.

### V1.2.0 Weibo real publish PASS + Bilibili capability gate + Sohu CAPTCHA WAITING_FOR_USER - 2026-08-25

- This round read the latest state first and followed the requested live-test order: Weibo, Bilibili, then Sohu. Zhihu's existing `NeedsReconciliation` Job, Lieju, and Baijiahao were not touched. No generic Publisher, Scheduler, BrowserSessionManager, or other platform Adapter business implementation was changed.
- Weibo completed one real low-volume SELF_TEST through the application-owned `VISIBLE` Browser and the saved Session. Existing Run `cd6d0418-567e-4dd9-976b-4b52630050ef` was reused. The only Weibo Job is `d9582333-7b4f-4957-a3a3-ad5abf1c0300`; the one unique body was `GMP 新浪微博真实发布测试 2026-08-25 13:24:24`, with one existing test image `a9de9c2f-44c1-4f9e-a3e6-192a4d73e3c2`. The ordinary composer showed the body and image, and the orange `发送` control was clicked exactly once. `final_submit_count=1`.
- Weibo's post was visible after submission. Read-only verification of the exact post page confirmed the body and reachable URL: External ID=`Rf17LuR6n`, External URL=`https://weibo.com/4020073566/Rf17LuR6n`. PublishRecord `4a46a856-0beb-4d13-9855-09e41201ef39` is `Published`/`Verified`, Job is `Success`, and the Weibo real-publish gate is `PublishPassed=PASS`. The initial test-source guard caused no side effect; the same already-created Job was reused and no duplicate Job or second submit was created.
- Bilibili reused the current saved Session in the application-owned `VISIBLE` Browser. The account's dynamic page was checked read-only and exposed the platform message `等级不足无法发送`; there was no usable dynamic/image submission permission and no test video was available. No Bilibili Job, PublishRecord, click, or submission was created. Result=`SKIPPED_MEDIA_REQUIRED`.
- Sohu reused the exact existing Run `3e58a669-072f-4373-bff1-d1dcccaa5f17`, Job `6fb37664-4340-4e1a-accd-865987e907df`, Article `58c1c7ee-c763-4cd7-892b-15b550be5923`, Session, Intent, and PublishRecord `0fa3c07a-d854-4680-b39b-2b52fa12f64e`. The existing editor/title/body/image evidence remains valid. The live visible Browser is left open at the Sohu editor; the Tencent Turing CAPTCHA frame is present. No CAPTCHA was bypassed, no final control was clicked, `final_submit_count=0`, Job=`NeedsUserAction`, Intent=`Prepared`, and PublishRecord=`Prepared`/`WaitingUser`. Sohu has no External ID/URL and is not `PublishPassed`.
- Evidence: [Weibo before submit](output/v123-weibo-before-final-submit.png), [Weibo after submit](output/v123-weibo-after-final-submit.png), [Weibo verified evidence](output/v125-weibo-correct-external-evidence.json), [Bilibili capability check](output/v126-bilibili-capability-check.json), [Bilibili dynamic screenshot](output/v126-bilibili-dynamic-capability-check.png), [Sohu live log](output/v127-sohu-resume-live.log), and [Sohu DB state](output/v119-sohu-db-state-v127-reopened.json).
- Validation after this round: `pnpm lint` PASS, `pnpm typecheck` PASS, and `pnpm test` PASS (`59` files / `298` tests). The Sohu waiting process remains active so the owner can complete normal CAPTCHA/security verification and continue only the same Job; no additional submit is permitted after the current boundary.

### V1.1.9 Sohu same-Job live retry + Weibo/Bilibili uniqueness guard - WAITING_FOR_USER / NO SUBMISSION - 2026-08-25

- The latest `PROJECT_STATE.md` was read before work. The only Sohu continuation reused Run `3e58a669-072f-4373-bff1-d1dcccaa5f17`, Job `6fb37664-4340-4e1a-accd-865987e907df`, Article `58c1c7ee-c763-4cd7-892b-15b550be5923`, submission intent `5fcfbc88-5719-415d-b6b0-d992cbe9cfa5`, and prepared PublishRecord `0fa3c07a-d854-4680-b39b-2b52fa12f64e`. No Sohu Job, Article, Intent, PublishRecord, or content was created.
- The first resume attempt was blocked before Browser launch by a native ABI mismatch after the host Node rebuild (`better-sqlite3` ABI 127 versus Electron 37.10.3 ABI 136). The repository-owned `pnpm run rebuild:native` repaired only the local Electron native dependency; it did not touch production data, saved credentials, or browser sessions.
- The repaired application launched the application-owned `VISIBLE` Browser and reopened the same Sohu editor/session. Login, editor, title, body, and image evidence were reused from the same article. The single final-submit preflight again classified the real page as `CONTROL_NOT_FOUND`; no CAPTCHA/security challenge was surfaced in this attempt, no side-effecting control was clicked, and no final submit was claimed or executed.
- Sohu safety state remains fail-closed: Job=`NeedsUserAction`, `last_error_code=FINAL_SUBMIT_CONTROL_NOT_FOUND`; SELF_TEST=`WAITING_FOR_USER`; submission intent=`Prepared`, `final_submit_count=0`, no External ID/URL; PublishRecord=`Prepared`/`WaitingUser`, `success=0`. `NeedsReconciliation` was not entered because the final submit side effect never occurred, and Sohu `PublishPassed` is not `PASS`.
- Because Sohu produced no unknown submission, the next-platform boundary was checked in order through the application API. The read-only evidence is [v122 platform snapshot](output/v122-platform-real-test-snapshot.json). Weibo already has its one existing L5 `cd6d0418-567e-4dd9-976b-4b52630050ef` and Bilibili already has its one existing L5 `d84f031c-6a1f-4f83-8795-820646b826d0`; neither has a publish Job, PublishRecord, External ID, or External URL. No second SELF_TEST or duplicate real-post attempt was created.
- Existing Weibo evidence remains `PARTIAL_PASSED`: Login=`PASS`, backend=`https://weibo.com/`, editor/content/image evidence incomplete (`EDITOR_NOT_VERIFIED`, `IMAGE_UPLOAD_FAILED`), and the current generic Browser Adapter has no platform-specific `finalSubmit`; final submit count is `0` and no publish side effect occurred. Existing Bilibili evidence remains `FAILED`: Login=`PASS`, backend=`https://member.bilibili.com/platform/home`, no verified article editor/content/image DOM (`EDITOR_NOT_VERIFIED`, `IMAGE_UPLOAD_FAILED`), no final submit, and no publish side effect. The existing records were preserved rather than rerun or duplicated.
- Baijiahao, Zhihu, Lieju, and the existing Zhihu `NeedsReconciliation` Job were not touched. The temporary Sohu resume process was closed after the no-submit result; no user-owned Chrome session was logged out or closed.
- Validation after the continuation harness update: `pnpm lint` PASS; `pnpm typecheck` PASS; `pnpm test` PASS (`59` files / `298` tests); `pnpm build` PASS. Version remains `1.1.9`; no Installer was generated.

### V1.1.9 Sohu SELF_TEST L5 deep final-control discovery - CONTROL_NOT_FOUND / WAITING_FOR_USER - 2026-08-25

- This pass remained strictly Sohu-only and reused the latest existing SELF_TEST Run `3e58a669-072f-4373-bff1-d1dcccaa5f17`, Job `6fb37664-4340-4e1a-accd-865987e907df`, article `58c1c7ee-c763-4cd7-892b-15b550be5923`, submission intent `5fcfbc88-5719-415d-b6b0-d992cbe9cfa5`, and existing prepared PublishRecord `0fa3c07a-d854-4680-b39b-2b52fa12f64e`. No new Job, article, PublishRecord, or content was created; Weibo, Bilibili, Lieju, Zhihu, and Baijiahao were not touched.
- The saved encrypted Session and existing article were reopened in the application-owned visible Browser at `https://mp.sohu.com/mpfe/v4/contentManagement/news/addmoment`. Existing matching title/body/image content was reused; the run did not create a second article or refill a second test item.
- Sohu-only discovery was expanded to repeated top-to-bottom page scrolling, every `page.frames()` URL, frame-local scans, open shadow roots, body-level portal/fixed/sticky/footer summaries, and visible/invisible `button`, `[role=button]`, `a`, `input`, `select`, and `div` candidates. The final artifact recorded `201` candidates (`168` div, `6` button, `18` a, `9` input), `34` interactive candidates, `109` CSS-visible candidates, `82` in-viewport candidates, `0` disabled candidates, `0` open shadow roots, and no frame scan errors.
- Scanned frame URLs were the editor URL above and `https://turing.captcha.gtimg.com/1/template/drag_ele.html`. The CAPTCHA frame was observed and recorded only; it was not bypassed or clicked. It contained no publish-semantic final control. Generic `div`/body text in persisted diagnostics is redacted; interactive candidate records retain bounded text, selector, frame URL, visibility, disabled/aria-disabled, bounding box, computed display/visibility/opacity, surface/region, and keyword matches.
- Final classification is `CONTROL_NOT_FOUND`: `FINAL_SUBMIT_DIRECT=0`, `NEXT_STEP_TO_CONFIRMATION=0`, `PREVIEW_ONLY=0`, `CONTROL_HIDDEN_BY_REQUIRED_STATE=0`, `CONTROL_IN_IFRAME=0`, and `CONTROL_IN_PORTAL=0` for publish-semantic candidates. No final publish control, safe next-step/preview transition, modal/drawer confirmation, or reliable required-field control for Sohu AI-generated-content declaration, category/domain, cover, or originality was exposed. No potentially side-effecting control was clicked.
- A before/after content DOM comparison was captured around the reuse path. The comparison records dynamic DOM changes while preserving the same article content; no safe transition was available to click. Full-page screenshots, frame URLs, candidate JSON, bottom DOM, portal/fixed/sticky/footer summaries, and the run evidence are saved at [before-final JSON](output/v121-sohu-deep-discovery-before_final_submit.json), [before-final screenshot](output/v121-sohu-deep-discovery-before_final_submit.png), [content-reuse diff JSON](output/v121-sohu-deep-discovery-content_reuse.json), [content-reuse screenshot](output/v121-sohu-deep-discovery-content_reuse.png), [SELF_TEST run evidence](output/v121-sohu-deep-discovery-run.json), and [live run log](output/v121-sohu-deep-discovery-live-4.log).
- Safety state is unchanged and fail-closed: Job=`NeedsUserAction`, `last_error_code=FINAL_SUBMIT_CONTROL_NOT_FOUND`; SELF_TEST=`WAITING_FOR_USER`; intent=`Prepared`, `final_submit_count=0`; PublishRecord=`Prepared`/`WaitingUser`, `success=0`; External ID/URL are null. No `finalSubmit` claim/click or external publish side effect occurred, so `NeedsReconciliation` was not entered and Sohu `PublishPassed` is not `PASS`.
- Only the Sohu Adapter/diagnostic logic, Sohu adapter tests, and the Sohu resume evidence harness were changed in this pass. Shared Publisher, Scheduler, OAuth, and other platform Adapter business implementations were not changed. Version remains `1.1.9`; no new Installer was generated or existing Installer overwritten.
- Validation completed: `pnpm lint` PASS; `pnpm typecheck` PASS; Sohu adapter tests PASS (`11` tests); full `pnpm test` PASS (`59` files / `298` tests); `pnpm build` PASS. The safe continuation boundary remains: wait for Sohu to expose a real usable final-publish control and reliable prerequisites, then continue only this Job, persist/use its unique submission intent, and allow at most one final submission.

### V1.1.9 Sohu SELF_TEST L5 submit-state repair + redacted DOM discovery - WAITING_FOR_USER / NO FINAL SUBMIT - 2026-08-25

- This pass is Sohu-only. It continued the latest existing SELF_TEST Run `3e58a669-072f-4373-bff1-d1dcccaa5f17`, Job `6fb37664-4340-4e1a-accd-865987e907df`, article `58c1c7ee-c763-4cd7-892b-15b550be5923`, submission intent `5fcfbc88-5719-415d-b6b0-d992cbe9cfa5`, and existing prepared PublishRecord `0fa3c07a-d854-4680-b39b-2b52fa12f64e`. No new Sohu Job, article, PublishRecord, content, or other-platform execution was created.
- Browser final-submit state machine invariant is now enforced: `FINAL_SUBMIT_CONTROL_NOT_FOUND`, `REQUIRED_FIELD_MISSING`, and pre-submit `USER_ACTION_REQUIRED` remain resumable `NeedsUserAction` when `final_submit_count=0` and no final-submit side effect was triggered. `NeedsReconciliation` is reserved for an intent that has claimed/executed final submission and then has an uncertain platform result. Added `tests/v119-browser-submit-state.test.ts` covering all three pre-submit codes and the post-side-effect uncertainty path.
- The adapter now performs a no-click final-submit preflight before claiming the one-click gate, records a submission-side-effect marker immediately before the actual click, and exposes Sohu-specific redacted DOM discovery. No platform selector or business implementation outside Sohu was changed.
- Live application-owned visible Browser resumed the saved encrypted Session and the existing article in the real editor at `https://mp.sohu.com/mpfe/v4/contentManagement/news/addmoment`. Discovery enumerated visible `button`, `[role=button]`, `a`, checkbox, radio, and select controls with redacted label/hint, disabled state, surface, and keyword matches. Observed controls were the page-level `实名认证` button and links `文章`, `图集`, `视频`, `动态`, `搜狐号发文规范`, and `问题反馈`; no visible checkbox, radio, or select was present.
- Current final-publish judgment: the final-publish control is absent (`finalPublish.state=absent`, `candidateCount=0`, `enabledCount=0`, `surfaces=[]`). It is not a present-disabled control; no final-publish candidate was found. No modal, drawer, or confirmation surface was discovered. No reliable visible prerequisite for Sohu AI-generated-content declaration, category/domain, cover, or originality was exposed, so none was guessed or filled. A conditional-after-required-fields path is not evidenced by this DOM snapshot and remains unproven pending a real platform control becoming visible.
- Safety state after the same-Job run: Job=`NeedsUserAction`, `last_error_code=FINAL_SUBMIT_CONTROL_NOT_FOUND`; SELF_TEST=`WAITING_FOR_USER`; intent=`Prepared`, `final_submit_count=0`; PublishRecord=`Prepared`/`WaitingUser`, `success=0`; External ID/URL are null. No `finalSubmit` click occurred, no external side effect occurred, and Sohu `PublishPassed` is not `PASS`.
- Evidence was refreshed in `output/v120-sohu-resume-existing.json` and `output/v120-sohu-resume-live.log`; the final-submit step stores the redacted discovery and `page.url()` above. The application-owned Browser process was closed after read-only discovery; the saved Session remains available for the same Job.
- Validation: `pnpm lint` PASS; `pnpm typecheck` PASS; `pnpm test` PASS (`59` files / `292` tests); `pnpm build` PASS. Version remains `1.1.9`; no Installer was generated or overwritten. Production DB backup before the state repair: `output/v120-sohu-l5-before-state-repair-20260825.db`.
- Safe continuation boundary: wait for the real Sohu editor to expose a usable final-publish control and all reliable prerequisites. Then continue only this Job, persist/use its single submission intent, and allow at most one `finalSubmit`; only verified External ID, External URL, reachable URL, exact title match, and the correct successful PublishRecord can promote Sohu PublishPassed to `PASS`.

### V1.1.9 Sohu negative reconciliation contract + new SELF_TEST L5 gate — OLD JOB CLOSED / NEW L5 BLOCKED — 2026-08-25

- 本轮只处理搜狐。未触碰微博、B站、列举网、知乎或百家号的 Adapter、Job、PublishRecord、状态或自测流程。
- 旧 Job `3993bc2f-73f8-4738-a321-2baf73e9d6cd`（账号 `33418593-16eb-4ba4-8d61-0a0189cccd2e`、标题“Geo Media Publisher 发布链路测试”）已完成只读 reconciliation：真实同账号文章管理页 `newsType=1` 完整加载，DOM 证据显示 `全部0、已发布0、审核中0、未通过0、草稿0、定时发布0`，统计卡片中的真实 `mp-iconnumber_0` DOM 类确认总内容量为 `0`；账号身份可见，无匹配标题、External ID 或 URL；等待窗口已满足；旧 `SubmissionIntent` 为 `Unknown` 且 `final_submit_count=1`，没有第二次 submit。
- 旧 Job 当前数据库状态为 `ReconciledNotPublished`，`last_error_code=CONFIRMED_NOT_PUBLISHED`；SubmissionIntent 已收口为 `NotSubmitted`，旧 PublishRecord `56b19d1a-ab9c-4b5b-a885-29031d40615b` 为 `Failed`，无 External ID/URL。该结果不是由 DOM 缺失或入口缺失推断而来；入口/分类/总内容量任一缺失时仍返回 `STILL_UNCERTAIN`。
- 负向证据实现覆盖：完整正向候选返回 `FOUND_PUBLISHED`；严格闸门返回 `CONFIRMED_NOT_PUBLISHED`；DOM 不完整返回 `STILL_UNCERTAIN`。证据文件：[旧 Job reconciliation](output/v119-sohu-reconcile-existing.json)、[旧 Job 前状态](output/v119-sohu-db-state-before.json)、[旧 Job 收口状态与 PublishRecord](output/v119-sohu-db-state-after.json)。
- 已按要求创建新的搜狐 SELF_TEST L5。首次新 run `182db0b1-a1f8-4a5c-94c4-cafa519a790c` 在编辑器弹层遮挡时安全停止，未创建 publish Job；随后新 Job `58a42f7f-1d01-4c17-b4f1-77bfe9957700` 和最终最新 Job `6fb37664-4340-4e1a-accd-865987e907df` 均完成 Login、Editor、Title、Body、Image 的真实 DOM 证据，但 Sohu 当前已校验编辑器 DOM 未暴露可验证最终发布控件，均在点击前停止。最新 run 为 `3e58a669-072f-4373-bff1-d1dcccaa5f17`，结果 `FAILED / PLATFORM_CHANGED`，Job 保持 `NeedsReconciliation`，最新 PublishRecord `0fa3c07a-d854-4680-b39b-2b52fa12f64e` 仍为 `Prepared / WaitingUser`，无 External ID/URL。
- 最新新 Job 的 `final_submit_count=1` 是一次性提交闸门的尝试计数；实际 `finalSubmit` 点击次数为 `0`，没有发生外部提交副作用。由于没有取得可点击的最终发布控件，没有伪造提交前后 URL、toast/modal/状态 DOM，也没有执行二次尝试；其失败证据保存在 [最新 SELF_TEST](output/v119-sohu-real-acceptance.json) 和 [最新 Job DB 状态](output/v119-sohu-db-state-new.json)。
- Sohu `PublishPassed` 仍不是 `PASS`：没有真实 External ID、公开 URL 可访问性、标题匹配或成功 PublishRecord。代码已记录成功路径的提交前后 URL 与 toast/modal/status DOM 证据结构，但本次未到达成功点击阶段。
- 本轮搜狐代码包含负向 reconciliation 合同、`ReconciledNotPublished` 收口、一次性提交闸门传递、真实 DOM 提交证据结构，以及为 L5 所需的搜狐 AI 声明/发布控件 DOM 处理；未修改其他平台实现。验证：`pnpm test` PASS（58 个测试文件 / 288 个测试），`pnpm lint` PASS，`pnpm typecheck` PASS，`pnpm build` PASS。应用版本仍为 `1.1.9`，未重建 Installer。

### V1.1.9 Sohu read-only navigation discovery + reconciliation - STILL_UNCERTAIN - 2026-08-25

- 本轮仅复用现有搜狐 `NeedsReconciliation` Job `3993bc2f-73f8-4738-a321-2baf73e9d6cd`，精确账号为 `platformAccountId=33418593-16eb-4ba4-8d61-0a0189cccd2e`，文章为 `articleId=79e854f0-55ed-4da7-a590-926ceb3f2449`、标题“Geo Media Publisher 发布链路测试”。未创建新 Job 或 PublishRecord，未调用 `finalSubmit`、`platformSelfTest.continue`、继续发布、retry 或 logout。
- 应用自建 `VISIBLE` Browser（`headless=false`）使用已保存 Session 打开 Adapter 已定义的 `https://mp.sohu.com/mpfe/v4/`。真实 Playwright `page.url()` 为 `https://mp.sohu.com/mpfe/v4/contentManagement/first/page`；从 DOM 发现并点击纯导航文章入口 `a[href="/mpfe/v4/contentManagement/first/page?newsType=1"]`，点击后 `page.url()` 为 `https://mp.sohu.com/mpfe/v4/contentManagement/first/page?newsType=1`。
- 已枚举的脱敏内容/管理菜单结构：`我的内容`、`发布内容`（未点击）、`栏目管理`、`活动`、`素材库`、`数据分析`、`内容分析`、`粉丝数据`、`账号信息`、`账号权益`、`平台收益`、`结算中心`、`文章`、`图集`、`视频`、`动态`、`发布`（发布入口，未点击）。候选文章 selector 为 `a[href="/mpfe/v4/contentManagement/first/page?newsType=1"]`。
- 文章管理真实 DOM 显示 `全部0`、`已发布0`、`审核中0`、`未通过0`、`草稿0`、`定时发布0`，并显示空列表“这里空空如也，快来发布新内容吧”；未取得精确标题对应的文章行、External ID 或公开 URL。该负面 DOM 证据已保存，但当前 Sohu reconciliation 契约只在取得完整正向证据时回收发布结果，故 fail-closed 返回 `STILL_UNCERTAIN`，没有擅自升级为 `CONFIRMED_NOT_PUBLISHED`。
- 只读回查证据：[导航 DOM 与 URL](output/v119-sohu-reconciliation/navigation-dom.json)、[后台截图](output/v119-sohu-reconciliation/00-backend.png)、[文章管理截图](output/v119-sohu-reconciliation/01-文章.png)、[reconciliation 结果](output/v119-sohu-reconciliation/reconcile-result.json)。Job 前后均保持 `NeedsReconciliation`；没有 External ID/URL，也没有写入新的 PublishRecord。现有一次提交后的 `SubmissionIntent` 仍按未知结果处理，禁止二次提交。
- 运行时曾发现 `out/main/main.js` 未包含已审阅的裸“文章”识别规则，本轮仅重建当前应用 bundle 使既有 reconciliation 调整生效；未修改搜狐发布 selector、未增强 finalSubmit/继续发布能力、未重建 Installer。`pnpm build` 通过，版本仍为 `1.1.9`。
- 本轮安全结论：`STILL_UNCERTAIN / RECONCILIATION_BLOCKED`，`PublishPassed` 不是 `PASS`。应用自建 Browser 资源已关闭；未触碰微博、B站、列举网、知乎现有 Job 或百家号状态。

### V1.1.9 Sohu reconciliation checkpoint - STILL_UNCERTAIN / RECONCILIATION_BLOCKED - 2026-08-25

- This pass only attempted the existing read-only `jobs.reconcileBrowser` path for Job `3993bc2f-73f8-4738-a321-2baf73e9d6cd`. It did not call `platformSelfTest.continue`, `jobs:run`, `finalSubmit`, retry, logout, or create any Job/PublishRecord.
- The application-owned `VISIBLE` Browser opened the Adapter's existing `https://mp.sohu.com/mpfe/v4/` backend URL, but the real DOM did not expose a usable content-management/article-management entry. The reconciler therefore stopped with `CONTENT_MANAGEMENT_NOT_FOUND`; it did not infer a negative publish result from that absence.
- A narrowly scoped reconciliation-only adjustment was made in `packages/adapters/sohu-media/src/browser.ts`: the existing reconciler now waits for Sohu DOM readiness, dismisses the optional `暂不认证` dialog when present, and recognizes the already observed visible `文章` entry. No publish selectors, content filling, image upload, required-field, or final-submit logic was changed.
- Database remains unchanged: SubmissionIntent=`Unknown`, `final_submit_count=1`; Job=`NeedsReconciliation`; the existing PublishRecord=`Prepared`, `success=0`, `verification_status=WaitingUser`, with no External ID/URL; self-test remains `FAILED`. `CONFIRMED_NOT_PUBLISHED` was not written because the platform did not provide sufficient negative evidence.
- Current safe outcome: `STILL_UNCERTAIN / RECONCILIATION_BLOCKED`, failure reason `CONTENT_MANAGEMENT_NOT_FOUND`. `PublishPassed` remains not `PASS`. No other platform or the existing Zhihu `NeedsReconciliation` Job was touched.
- Validation after the reconciliation-only adjustment: `pnpm lint`, `pnpm typecheck`, and the Sohu adapter test command passed. The existing 1.1.9 installer was not rebuilt because no publish capability or release version change was made.

### V1.1.9 Sohu final-submit checkpoint - NEEDS_RECONCILIATION / ONE FINAL SUBMIT - 2026-08-25

- The same `platformAccountId=33418593-16eb-4ba4-8d61-0a0189cccd2e`, `testRunId=b067a8bf-b16c-4412-a8fd-2cc0f73ad921`, Job `3993bc2f-73f8-4738-a321-2baf73e9d6cd`, submission intent `91067620-f582-4576-954e-416886e31519`, and prepared `PublishRecord=56b19d1a-ab9c-4b5b-a885-29031d40615b` were reused. No new SELF_TEST, Job, or PublishRecord was created.
- The owner completed the Sohu verification flow, confirmed the AI-generated-content declaration, and the application-owned visible Playwright Browser continued the same Job. The platform final submit was claimed and attempted exactly once: `final_submit_count=1`.
- SubmissionIntent is `Unknown` with error code `UNKNOWN`; the Job is `NeedsReconciliation`. The submission result is unknown, so no retry, second click, new navigation for resubmission, or logout is allowed.
- External ID and External URL are absent. The existing PublishRecord remains `Prepared`/`WaitingUser` with no published URL or external ID; `PublishPassed` is not `PASS`.
- Verified evidence remains: Login `PASS`; real Sohu article Editor `PASS` at `https://mp.sohu.com/mpfe/v4/contentManagement/news/addmoment`; Title `PASS`; Body `PASS`; Image `PASS`; Browser `VISIBLE` with `headless=false`; app-owned Browser resources were closed after the run. The AI-generated-content checkbox was selected per the owner's confirmation and Sohu DOM automation support.
- Final result: `NEEDS_RECONCILIATION` / `RESULT_UNKNOWN`. A real published URL, reachable-page check, title match, and successful PublishRecord cannot be claimed from this run.
- Validation after the Sohu-only change: `pnpm lint`, `pnpm typecheck`, Sohu adapter tests, `pnpm test` (57 files / 284 tests), `pnpm build`, and `pnpm installer` passed. The current `release` directory contains the new `1.1.9` installer and the existing `1.1.7` installer; no `1.1.8` installer file is present in the workspace, and this run did not overwrite or delete one.

### V1.1.9 Sohu resume checkpoint - WAITING_FOR_USER / NO FINAL SUBMIT - 2026-08-25

- The owner signal was received and the existing `testRunId=b067a8bf-b16c-4412-a8fd-2cc0f73ad921`, Job `3993bc2f-73f8-4738-a321-2baf73e9d6cd`, submission intent `91067620-f582-4576-954e-416886e31519`, and prepared `PublishRecord=56b19d1a-ab9c-4b5b-a885-29031d40615b` were reused. No new Job or PublishRecord was created.
- `final_submit_count=0`, intent state remains `Prepared`, and no external ID/URL exists. The application-owned `VISIBLE` Browser still pauses on a real visible CAPTCHA/security control; no verification was bypassed and no final submit was clicked.
- Sohu-only security detection was narrowed to visible CAPTCHA/security controls and no longer scans the entire page text or generic `security` classes. The current app-owned Page remains available for the owner to complete normal verification, after which the same Job may be continued once.
- Validation after this Sohu-only change: `pnpm lint`, `pnpm typecheck`, Sohu adapter tests, and `pnpm build` passed. Full `pnpm test` was deferred because its native `better-sqlite3` rebuild was locked by the active app-owned Browser process; Installer validation remains pending until the Job reaches a terminal result.

## V1.1.9 Sohu Article Editor + Real Publish Acceptance - WAITING_FOR_USER / NO FINAL SUBMIT - 2026-08-25

### Scope and live evidence

- This phase is Sohu-only. We did not modify or run Weibo, Bilibili, Lieju, Zhihu, or Baijiahao; Baijiahao remains `SKIPPED_BY_OWNER`, and the existing Zhihu `NeedsReconciliation` Job was not touched.
- The Sohu account is `platformAccountId=33418593-16eb-4ba4-8d61-0a0189cccd2e`. The evidence uses the application-owned visible Browser/Context/Page with the saved encrypted Session; no user Chrome tab or desktop-window URL observation was used.
- `testRunId=b067a8bf-b16c-4412-a8fd-2cc0f73ad921` and the single Sohu Job `3993bc2f-73f8-4738-a321-2baf73e9d6cd` are the only V1.1.9 Job being continued. A prepared `PublishRecord` exists with no external result yet.
- Login: `PASS`. Browser mode: `VISIBLE`, `headless=false`. Playwright editor evidence: `page.url()=https://mp.sohu.com/mpfe/v4/contentManagement/news/addmoment`; the article editor was discovered through visible DOM text and not a guessed editor URL.
- Title: `PASS`. Body: `PASS` with rich-text whitespace-normalized round-trip evidence. Image: `PASS` with a new visible `upload-item` image and Sohu DOM text `已成功上传1张图片`; Sohu clearing `input.files` after upload is recorded as normal platform behavior.
- The optional Sohu real-name dialog was dismissed through the exact visible DOM button `暂不认证`; no real-name verification was attempted. A normal side-panel iframe was excluded from security detection; CAPTCHA/SMS/security signals remain fail-closed.
- Current final-submit gate is `WAITING_FOR_USER` with `USER_ACTION_REQUIRED`: Sohu still requires the account owner to complete normal verification and/or visible required fields. `submission_intent_id=91067620-f582-4576-954e-416886e31519`, `final_submit_count=0`, intent state `Prepared`; no final submit was clicked, no External ID/URL exists, and PublishPassed is not set.
- The application-owned visible Browser has been reopened for this same Job by `scripts/v119-sohu-resume-existing.mts`. The next continuation must use this same `testRunId`/Job; do not create a second Job or click final submit manually. After the owner completes the normal platform verification, continue only after an explicit user signal.

### V1.1.9 code and validation checkpoint

- Sohu-only changes are in `packages/adapters/sohu-media/src/browser.ts` and its adapter test. The Sohu adapter now dynamically discovers article/editor/image DOM, handles the optional real-name prompt, supports Playwright filechooser upload evidence, and implements Sohu-specific `finalSubmit`, `collectPublishResult`, `verifyPublished`, and `reconcile`. The generic Browser Adapter remains fail-closed.
- `pnpm typecheck`, `pnpm lint`, Sohu adapter tests (6 passed), and `pnpm build` passed after the latest changes. Full test and installer validation remain to be completed after this user-gated Job reaches a terminal result.
- Version is `1.1.9`; the existing `1.1.7` installer remains preserved. No `1.1.8` installer file was found in the current workspace, and no older installer was overwritten. No `PublishPassed=PASS` claim is allowed until External ID/URL, reachable URL, exact title match, and the correct PublishRecord are all verified.

## V1.1.8 Sohu → Weibo → Bilibili Real Publish Acceptance Survey — SURVEY COMPLETE / NO FINAL SUBMIT · 2026-08-25

### Scope and safety boundary

- 已先读取本文件最新状态。本轮按用户要求跳过列举网：不创建新 SELF_TEST、不创建新 Job、不继续验证码、不调用 `finalSubmit`；列举网-01 当前状态记录为 `DEFERRED / WAITING_FOR_USER / RISK_CONTROL`。
- 列举网既有 L5 `testRunId=3613ba24-d82d-4cbe-9d72-c4c080ecdc2b`、Job `27e76fc0-ba4e-4831-94e1-062b59c15d76` 保持 `WAITING_FOR_USER / NeedsUserAction`，`final_submit_count=0`，无 PublishRecord、External ID 或 External URL。上一轮等待该验证码的本软件临时测试进程及其 Browser 资源已停止；没有关闭用户原有 Chrome。
- 未触碰知乎现有 `NeedsReconciliation` Job（包括 `1bf90421-fa31-4a1f-b5a0-6639e671392b`），百家号继续 `SKIPPED_BY_OWNER`。本轮没有修改 Publisher、Scheduler、OAuth 公共架构，也没有修改搜狐号、微博、哔哩哔哩 Adapter selector。
- 本轮不追加 SELF_TEST：搜狐号和微博各已有唯一一条 L5；哔哩哔哩已有历史 L5 记录，包含 `9c882c66-0845-4ea3-995e-2caa57782990` 与 `d84f031c-6a1f-4f83-8795-820646b826d0`，本轮不删除、不重跑、不再创建第三条。

### Real Browser survey evidence

- 按要求顺序复用已由 Geo Media Publisher 创建的可见 Browser、加密账号 Session、Playwright `page.url()` 和真实 DOM 证据：搜狐号 → 新浪微博 → 哔哩哔哩。三条自测均记录 `BROWSER_EXECUTION_MODE=PASSED`、`VISIBLE:headless:false`；没有使用用户现有 Chrome 标签页。
- 三个平台均没有创建 Publish Job、没有 PublishRecord、没有 External ID/URL；三者均未触发最终提交，因此不存在需要 reconciliation 的本轮未知提交。

| 平台 | 唯一 L5 SELF_TEST | Login | Editor / 内容模型 | Image | Required Fields | Final Submit | External ID / URL | PublishRecord | Result / Failure Reason |
|---|---|---|---|---|---|---|---|---|---|
| 搜狐号 | `7dfbb274-6727-4c01-b60b-764c4fac8200` | PASS；`checkLogin` 通过 | `page.url()=https://mp.sohu.com/mpfe/v4/`；只证明后台首页，未找到文章编辑器或内容管理 DOM；搜狐 Adapter 只定义 `backendUrl=https://mp.sohu.com/`，没有已审阅的文章入口/内容管理 URL | `IMAGE_UPLOAD_FAILED`；无编辑器 DOM 上传证据 | 未到达；无法安全判定文章编辑器字段 | 未触发；当前 generic Browser Adapter 未实现平台专属 finalSubmit | 无 | 无 | `PARTIAL_PASSED`；`EDITOR_NOT_FOUND`、`IMAGE_UPLOAD_FAILED` |
| 新浪微博 | `cd6d0418-567e-4dd9-976b-4b52630050ef` | PASS；`checkLogin` 通过 | `page.url()=https://weibo.com/`；未找到可证明的普通微博或长文章编辑器 DOM；当前定义同时声明 `article/imagePost`，但没有已审阅的长文章入口/内容管理 URL，内容模型未判定 | `IMAGE_UPLOAD_FAILED`；无编辑器 DOM 上传证据 | 未到达 | 未触发；当前 generic Browser Adapter 未实现平台专属 finalSubmit | 无 | 无 | `PARTIAL_PASSED`；`EDITOR_NOT_FOUND`、普通微博/长文章 `CONTENT_MODEL_MISMATCH` 未判定、`IMAGE_UPLOAD_FAILED` |
| 哔哩哔哩 | 复用既有 `d84f031c-6a1f-4f83-8795-820646b826d0`（不新建） | PASS；`checkLogin` 通过 | `page.url()=https://member.bilibili.com/platform/home`；只证明创作中心首页，未取得专栏文章编辑器入口或真实 DOM；当前 Browser Adapter 没有已审阅的专栏 editorUrl/selector | `IMAGE_UPLOAD_FAILED`；无编辑器 DOM 上传证据 | 未到达 | 未触发；未执行任何提交 | 无 | 无 | `FAILED`；`EDITOR_NOT_FOUND`、`IMAGE_UPLOAD_FAILED` |

### Platform-specific capability conclusion

- 搜狐号：已确认可恢复登录并打开真实创作中心首页；真正文章发布入口和内容管理 URL 尚未从真实 DOM 得到，不能宣称 Editor、Content 或发布能力通过。当前失败发生在图片证据阶段，尚未进入 Required Fields/Final Submit。
- 新浪微博：已确认可恢复登录并打开 `https://weibo.com/`；普通微博与长文章内容模型尚未被真实编辑器 DOM 区分，不能把 `article=true` 的静态能力声明当作长文章发布证据。当前失败发生在图片证据阶段。
- 哔哩哔哩：已确认可恢复登录并打开创作中心首页；是否存在专栏文章入口尚未取得真实 DOM 证据，不能把 API Adapter 的 `article=true` 当作 Browser 专栏入口证据。当前失败发生在图片证据阶段；没有点击最终提交。
- 三个平台当前 Browser Adapter 都仍是通用后台打开/人工最终确认合同，未实现平台专属 `finalSubmit`、`collectPublishResult`、`verifyPublished` 或 `reconcile`。因此本轮不做大规模修复，下一阶段应先逐个平台补充真实 editor/content-management DOM 契约，再单独重新验收；本轮不升级任何 `PublishPassed`。

### Validation boundary

- 本轮仅更新项目状态文档并停止上一轮列举网等待进程，没有代码修改，因此没有重新运行 lint/typecheck/test/build/installer；既有 V1.1.7 验证记录保持不变。版本文件当前仍为 `1.1.8`，未覆盖旧 Installer。

## V1.1.7 Playwright-owned Browser Test Harness + Connected Platforms Capability Survey — CODE COMPLETE / REAL SURVEY BLOCKED · 2026-08-24

### Scope and harness result

- 已先读取本文件最新状态；本轮没有新建或重试知乎 L5，也没有把 Windows 桌面窗口、窗口标题、`SetIsBorderRequired` 或用户已有 Chrome 标签页作为平台证据。
- BrowserAutomation 自测现在由 Geo Media Publisher 自己通过 `BrowserSessionManager`、`playwright-core`、系统 Chrome 优先/Edge 回退、按 `platformAccountId` 隔离的加密 `storageState` 创建并控制 Browser/Context/Page。`BrowserSessionManager.open()` 创建 Context 后立即创建并持有 Page；所有后台 URL 证据取自该 Page 的 `page.url()`，页面真实性同时检查真实 DOM `document.body`。
- 首轮自测统一使用 `VISIBLE / headless=false`。有效 Session 直接打开 Adapter 已定义后台；无效/过期 Session 返回 `WAITING_FOR_USER`，保留应用自建可见 Browser，验证码、短信、二维码、拼图、安全验证不绕过；用户完成后可通过同一 `testRunId` 继续。正常结束或失败只关闭本软件拥有的 Browser 资源，不 logout、不关闭用户原有 Chrome。
- 本轮没有修改新浪微博、搜狐号、列举网、哔哩哔哩的业务 selector，也没有修改 Publisher/Scheduler/OAuth 公共架构。列举网测试入口固定为 `https://post.lieju.com/190/239`；新增的 Browser Mode/DOM 证据字段属于 harness 证据，不是 selector 逻辑。
- 版本已从 `1.1.6` 升为 `1.1.7`；旧 Installer 保留未覆盖。

### Real survey evidence

- 通过生产 Electron 主进程 IPC、当前生产数据库和加密凭据，按顺序执行：新浪微博 → 搜狐号 → 列举网-01 → 哔哩哔哩。四个平台均使用应用自建可见 Playwright Browser；没有使用外部标签页。没有新增 Publish Job、PublishRecord、External ID 或 External URL。
- 新增/继续的唯一自测证据：Weibo L5 `cd6d0418-567e-4dd9-976b-4b52630050ef`；Sohu L5 `7dfbb274-6727-4c01-b60b-764c4fac8200`；Lieju-01 L3 `833dac0f-bcc9-493d-a449-22f43db280d7`；Bilibili 继续既有待确认 L5 `d84f031c-6a1f-4f83-8795-820646b826d0`，未创建第二条 Bilibili L5。
- 新浪微博：L1 Login `PASSED`；后台真实 URL `https://weibo.com/`，Editor 仅 `PARTIAL_PASSED`；Title/Body 未取得 selector 回读证据；Image `FAILED / IMAGE_UPLOAD_FAILED`；未到达最终提交，因此没有 External ID/URL。结果 `PARTIAL_PASSED`，未声明发布能力通过。
- 搜狐号：L1 Login `PASSED`；后台真实 URL `https://mp.sohu.com/mpfe/v4/`，Editor 仅 `PARTIAL_PASSED`；Title/Body 未取得 selector 回读证据；Image `FAILED / IMAGE_UPLOAD_FAILED`；未到达最终提交，因此没有 External ID/URL。结果 `PARTIAL_PASSED`，未声明发布能力通过。
- 列举网-01：L1 Login `PASSED`；Editor URL `https://post.lieju.com/190/239`，Title/Body `PASSED`；Image `FAILED / IMAGE_UPLOAD_FAILED`；平台已声明必填字段 `category/location/contact/captcha`，故 Required Fields 为 `REQUIRED_FIELD_MISSING`；本轮未创建新提交。旧列举网未知结果 Job `e1697efe-5ba4-4f83-8795-820646b826d0`、`bf7298b1-f326-46b5-8ac5-54e1106c9892` 继续保持 `NeedsReconciliation`，严禁二次提交。当前自测结果 `FAILED`，其中旧运行曾出现 `BROWSER_EXECUTION_MODE_NOT_VERIFIED`；源代码已补齐列举网 Adapter 的真实 VISIBLE/headless 证据字段，但不为修复该证据再创建第二条自测。
- 哔哩哔哩：继续既有 L5 `d84f031c-6a1f-4f83-8795-820646b826d0`；L1 Login `PASSED`；后台真实 URL `https://member.bilibili.com/platform/home`，Editor 仅 `PARTIAL_PASSED`；Title/Body 未取得 selector 回读证据；Image `FAILED / IMAGE_UPLOAD_FAILED`，最终提交因图片 DOM 证据不足停止；没有创建 Job、没有点击提交、没有 External ID/URL。结果 `FAILED`，不升级为 PublishPassed。
- 百家号继续 `SKIPPED_BY_OWNER`；知乎当前已有 `NeedsReconciliation`，本轮没有新建知乎 L5 Job，也没有处理旧未知提交。

### Validation and packaging

- `pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（55 个测试文件 / 281 个测试）；`pnpm build` PASS；`pnpm installer` PASS。
- 1.1.7 Installer：[release/Geo Media Publisher Setup 1.1.7.exe](release/Geo%20Media%20Publisher%20Setup%201.1.7.exe)，101036682 bytes，SHA256 `D221E75D4550A78D9CB8CC10F24A03E264BCD21C90ED62BDD2B7E42555482A6B`。
- 1.1.6 Installer 保留未覆盖：[release/Geo Media Publisher Setup 1.1.6.exe](release/Geo%20Media%20Publisher%20Setup%201.1.6.exe)，101034705 bytes，SHA256 `E3A84D56DD17CB2EBF5B727FD792407E9D06A7ADB6DF94BFBF27EB97C5E5B0F0`。
- `release/win-unpacked/Geo Media Publisher.exe` 启动冒烟 PASS，文件版本 `1.1.7`、产品版本 `1.1.7.0`；打包版通过 Renderer API 读取生产账号和平台自测数据。
- 未宣称任何平台 `PublishPassed`；当前真实能力结论仍受平台 selector/editor、图片上传、必填字段和最终提交/回查契约阻塞。工作区 `.git` 仍不是可用 Git repository，因此不提供 source SHA。

## V1.1.6 Zhihu Job 1bf90421-fa31-4a1f-b5a0-6639e671392b — STILL_UNCERTAIN / NEEDS_RECONCILIATION · confirmed-account retry 2026-08-24

- 用户提供的当前截图确认目标会话为知乎账号 `zhirXBiurpC`（Lv 2、创作分 300、草稿箱 20），当前地址为 `https://www.zhihu.com/creator`，并且浏览器已打开“内容管理”标签；这解决了前一轮的账号识别疑问。
- 本轮仍只针对 Job `1bf90421-fa31-4a1f-b5a0-6639e671392b`、SELF_TEST `f7e67f80-983b-48f3-a1d4-877e2785beb0`、精确标题 `Geo Media Publisher 知乎发布测试 2026-08-24 15:56:58`、账号 ID `8f666025-1776-41d5-8295-3bab150f615c` 和北京时间约 `2026-08-24 15:52:10–15:57:42` 做只读核对。
- 项目窗口只读状态显示知乎已连接、存在 1 个账号容器；但未取得该 Job 标题的内容管理行、真实 External ID/URL、可访问页面标题匹配或时间窗口匹配证据。Windows 观察接口在读取/验证窗口时失败：`SetIsBorderRequired failed: 不支持此接口 (0x80004002)`；未继续猜测或操作页面。
- 本轮未创建新 Job，未调用 `finalSubmit`，未点击任何发布按钮，未修改 `submissionIntentId=718eccaf-a490-4a91-8a58-8d90a239cb72`，未写入 PublishRecord，未修复 `PLATFORM_CHANGED`。
- 结论继续保持 `STILL_UNCERTAIN / NeedsReconciliation`；当前证据不足以判定 `FOUND_PUBLISHED/Reconciled` 或 `CONFIRMED_NOT_PUBLISHED`。

## V1.1.6 Zhihu Job 1bf90421-fa31-4a1f-b5a0-6639e671392b — STILL_UNCERTAIN / NEEDS_RECONCILIATION · retry 2026-08-24

- 用户要求在登录修复后重新执行同一 Job 的只读 reconciliation。目标仍为 SELF_TEST `f7e67f80-983b-48f3-a1d4-877e2785beb0`、精确标题 `Geo Media Publisher 知乎发布测试 2026-08-24 15:56:58`、账号 ID `8f666025-1776-41d5-8295-3bab150f615c`、时间窗口约北京时间 `2026-08-24 15:52:10–15:57:42`。
- 刷新后 Windows 侧只发现一个知乎窗口，标题为 `(4 封私信) 创作中心 - 知乎 - Google Chrome`；但安全层再次无法可靠确认当前浏览器 URL，阻止读取账号身份、内容管理列表及目标标题。窗口标题不足以证明账号匹配或发布结果。
- 本次重试未取得真实 External ID、External URL、标题匹配、账号匹配或时间窗口匹配证据；不判定已发布，也不判定仅有草稿，继续 `STILL_UNCERTAIN / NeedsReconciliation`。
- 本轮未创建新 Job，未调用 `finalSubmit`，未点击任何发布按钮，未修改 `submissionIntentId=718eccaf-a490-4a91-8a58-8d90a239cb72`，未写入 PublishRecord，未修复 `PLATFORM_CHANGED`。

## V1.1.6 Zhihu Job 1bf90421-fa31-4a1f-b5a0-6639e671392b — STILL_UNCERTAIN / NEEDS_RECONCILIATION · 2026-08-24

- 本轮只对 Job `1bf90421-fa31-4a1f-b5a0-6639e671392b` 做只读 reconciliation；SELF_TEST `f7e67f80-983b-48f3-a1d4-877e2785beb0` 的精确标题为 `Geo Media Publisher 知乎发布测试 2026-08-24 15:56:58`，目标账号 ID 为 `8f666025-1776-41d5-8295-3bab150f615c`，testRun 时间窗口约为北京时间 `2026-08-24 15:52:10–15:57:42`。
- 用户纠正的目标知乎账号是截图中的 `zhirXBiurpC`（Lv 2、创作分 300、草稿箱 20）。本轮可见 Chrome 窗口实际显示的是另一账号“啊瘾”（Lv 3、创作分 2,092、草稿箱 42），因此不能把该窗口的内容列表当作目标账号证据。
- 已停止继续浏览器控制，未得到目标账号下按精确标题、账号和时间窗口的可靠发布/草稿结论；未取得 External ID、External URL 或可访问标题匹配证据。Computer Use 因无法可靠确定当前 Windows 浏览器 URL 而停止，未继续猜测页面。
- 本轮未创建新 Job，未调用 `finalSubmit`，未点击任何发布按钮，未修改 `submissionIntentId=718eccaf-a490-4a91-8a58-8d90a239cb72`，未写入 PublishRecord，未修复 `PLATFORM_CHANGED`。
- 结论保持 `STILL_UNCERTAIN / NeedsReconciliation`；待使用正确的 `zhirXBiurpC` 会话重新执行只读回查后，才可判定 `FOUND_PUBLISHED/Reconciled` 或 `CONFIRMED_NOT_PUBLISHED`。

## V1.1.6 Owner-Gated Real Zhihu L5 Acceptance — NEEDS_RECONCILIATION / PLATFORM_CHANGED · 2026-08-24

- 本次只测试知乎账号 `8f666025-1776-41d5-8295-3bab150f615c`，未处理其他平台，也未触碰原有 3 个 `NeedsReconciliation` Job。
- `testRunId=f7e67f80-983b-48f3-a1d4-877e2785beb0`；`Job ID=1bf90421-fa31-4a1f-b5a0-6639e671392b`；`submissionIntentId=718eccaf-a490-4a91-8a58-8d90a239cb72`；北京时间约 `2026-08-24 15:57:42`。
- 账号连接、Session、可见 Browser、知乎编辑器、标题、正文和测试图片均取得 PASS 证据；用户确认后只执行了 1 次最终提交尝试，`final_submit_count=1`。
- 平台返回 `PLATFORM_CHANGED`，提交结果不确定；系统已将 Job 和本次 L5 运行置为 `NeedsReconciliation / FAILED`。当前无 `PublishRecord`、`External ID`、`External URL` 或可验证发布时间，不能宣称 `Zhihu PublishPassed=PASS`。
- 严禁再次提交。后续只能使用知乎创作者后台按本次唯一测试标题、时间和账号做只读回查；若确认已发布，补写真实 External ID/URL/PublishRecord；若无法确认，继续保持 `NeedsReconciliation`。桌面控制在无法可靠确认当前浏览器 URL 后停止，未继续猜测页面。

## V1.1.6 Owner-Gated Real Zhihu L5 Acceptance — OWNER CONFIRMATION PENDING · 2026-08-24

- 已先读取本文件最新状态，并只读确认 `REAL_PUBLISH_TEST_BATCH_CONFIRMED` 仅由 `apps/desktop/src/main/platform-self-test.ts` 的 SELF_TEST/L5 `requestPublish`、`confirmPublish` 读取；普通文章 Job 创建与普通 Publisher 发布路径不读取该变量。本轮未修改代码。
- 使用一次性子进程环境变量 `REAL_PUBLISH_TEST_BATCH_CONFIRMED=1` 启动 `C:\GMP116ZhihuL5\Geo Media Publisher.exe`，未复用上一条 `WAITING_FOR_USER` run；只进入知乎。
- 新知乎 `testRunId`：`995ab2d7-a1ea-4f99-9a6d-4308d90fb89f`；`platformAccountId`：`8f666025-1776-41d5-8295-3bab150f615c`；当前结果 `WAITING_FOR_USER`，界面已停在“真实发布确认”。北京时间约 `2026-08-24 15:41:05`。
- 当前尚未点击用户确认，因此 `publishJobId = null`、`submissionIntentId = null`、`PublishRecordId = null`、`External ID = null`、`External URL = null`；尚未生成最终测试标题、未执行 URL 可访问性或标题匹配回查。
- 既有 3 个 `NeedsReconciliation` Job 未处理，其他平台未测试。待用户本人点击“确认测试发布”并处理验证码/安全验证后，继续记录真实证据；若提交结果不确定，立即保持 `NeedsReconciliation`，禁止二次提交。

## V1.1.6 Owner-Gated Real Zhihu L5 Acceptance — STOPPED / WAITING_FOR_USER · 2026-08-24

- 已读取本文件最新状态，并从独立目录 `C:\GMP116ZhihuL5` 启动当前 V1.1.6 正式安装版；未修改代码，未处理或重试既有 3 个 `NeedsReconciliation` Job，未测试其他平台。
- 本次只操作知乎自测入口。记录的当前知乎 `testRunId`：`c9ff153c-8314-4b03-8959-f773f0b0a9a7`；`platformAccountId`：`8f666025-1776-41d5-8295-3bab150f615c`；时间：`2026-08-24T07:29:34.637Z`–`2026-08-24T07:29:35.477Z`（北京时间约 15:29:34–15:29:35）。
- L5 结果：`WAITING_FOR_USER`，步骤 `PUBLISH_CONFIRMATION`，错误码 `REAL_PUBLISH_TEST_BATCH_CONFIRMATION_REQUIRED`，系统证据为 `REAL_PUBLISH_TEST_BATCH_CONFIRMED is not set; no real publish Job will be created.`
- 因安全门在创建 Job 前停止：`publishJobId = null`、`publishAttemptId/submissionIntentId = null`、`PublishRecordId = null`、`External ID = null`、`External URL = null`；没有生成本轮真实发布标题，也没有标题回查结果。
- 最终状态保持 `PublishPassed = NOT_TESTED / WAITING_FOR_USER`。未点击知乎最终提交按钮，未进入验证码或安全验证处理。用户随后以物理 Escape 中止了 Windows 控制会话；按规则已停止，不再继续或重试。
- 只读核对确认既有 Job `ea8c6507-ebb3-449a-9b01-227272ba4b77`、`e1697efe-5ba8-4fbb-bce5-11f2f3c2b788`、`bf7298b1-f326-46b5-8ac5-54e1106c9892` 仍为 `NeedsReconciliation`，均无新增 PublishRecord 或 External ID/URL；本轮没有新增 `publish_jobs`。
- 数据库另有一个同一账号、同一安全门拦截的既有记录 `testRunId=cfe6560e-daab-4fa0-adf0-aa5238aefc94`（约 15:29:25），同样未创建 Job；本轮不对其进行处理或重试。

## V1.1.6 Browser Publish Reconciliation + Zhihu L5 Final Submit — CODE COMPLETE / WAITING_FOR_USER · 2026-08-24

### Scope and safety

- 已先读取并锁定根目录状态中的 3 个既有 `NeedsReconciliation` Job；本轮没有创建新的真实发布 Job，没有点击任何最终提交按钮，也没有重试未知提交。
- 通用 Browser Adapter 继续 fail-closed；仅知乎实现 platform-specific `finalSubmit`、`collectPublishResult`、`verifyPublished`、`reconcile`。本轮未扩展其他平台的 L5。
- 唯一最终提交尝试使用持久化 `submission_intents` 和 migration `0021_v116_browser_l5_attempt.sql` 的 `final_submit_count` 原子门闩；第二次 claim 会被拒绝。timeout、crash 或 navigation uncertainty 均保持 `NeedsReconciliation`。
- 知乎 L5 复用已通过的 Session、Background、Editor、Title、Body、Image 链路；最终点击前先持久化 Job、Prepared `PublishRecord` 和唯一 submission intent。

### Phase 1 read-only reconcile

- 知乎 `ea8c6507-ebb3-449a-9b01-227272ba4b77`：`STILL_UNCERTAIN`。本轮未取得可可靠核对的知乎创作者后台真实内容列表证据；数据库仍为 `NeedsReconciliation`，无 `PublishRecord`、External ID 或 External URL。
- 列举网 `e1697efe-5ba8-4fbb-bce5-11f2f3c2b788`、`bf7298b1-f326-46b5-8ac5-54e1106c9892`：均为 `STILL_UNCERTAIN`。本轮未审阅到列举网平台级只读内容列表 reconcile 契约，也没有真实 External ID/URL 证据；两条 Job 保持 `NeedsReconciliation`，不重试，不宣称 `CONFIRMED_NOT_PUBLISHED`。
- 曾尝试通过应用的发布中心进行只读回查；Computer Use 在坐标输入前反复要求重新获取窗口状态，截图接口同时返回 `SetIsBorderRequired ... 不支持此接口`。因此在没有可靠后台列表证据时停止，未触达任何最终提交按钮。

### Validation and installer

- `pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（55 files / 281 tests）；`pnpm build` PASS；`pnpm installer` PASS。
- 正式 1.1.6 安装包：[release/Geo Media Publisher Setup 1.1.6.exe](release/Geo%20Media%20Publisher%20Setup%201.1.6.exe)，101034705 bytes，SHA256 `E3A84D56DD17CB2EBF5B727FD792407E9D06A7ADB6DF94BFBF27EB97C5E5B0F0`。
- 1.1.5 安装包未覆盖：[release/Geo Media Publisher Setup 1.1.5.exe](release/Geo%20Media%20Publisher%20Setup%201.1.5.exe)，101031128 bytes，SHA256 `7F27B8A40B7E5342FF71C9BB2915E1CDDC901DA47F100FBF45228F7AB72DC1BC`。
- 生产数据库中的既有 3 条 Job 没有被本轮代码或回查写改；`0021` 将在用户首次启动 1.1.6 时由迁移流程应用。

### User gate

- 正式真实发布尚未由本轮代理执行。下一步必须由用户本人从 1.1.6 安装包执行一次知乎真实 L5；只有取得真实 External ID、可访问 External URL、URL 标题匹配，并正确保存 `PublishRecord` 后，才可将 `PublishPassed` 标记为 `PASS`。

## V1.1.5 Publish Flow Unblock + Connected Platforms Real Publish Smoke — PARTIAL / WAITING_FOR_USER · 2026-08-24

- Scope completed: one shared article publish gate now serves Repository Job creation and Publisher preparation. `Off` permits operational `production` / `content_studio` / `excel_import` content, `WarningOnly` preserves risk visibility while allowing continuation, and `Strict` requires `Approved`. `benchmark` / `mock` / `test` content is rejected from the formal publish path even when Approved.
- Publish flow completed: article selection creates persistent per-platform/per-account Jobs and the Publish Center reloads them immediately with article, platform, account, image, mode, status, creation time, continuation, reconciliation, and technical detail actions. `DryRunPassed` is no longer displayed as published.
- Browser/API boundary completed: browser Jobs remain available for visible continuation when background evidence is not PASS; security/login signals remain user-action states. Official API platforms do not start Browser sessions. Lieju account/session isolation and no-proactive-logout behavior remain covered by the existing adapter tests.
- Account/self-test UI completed: connected accounts now distinguish session connectivity from publishing capability. The self-test page uses five main columns, compact progress chips, a technical evidence drawer, and verified no-horizontal-overflow behavior at 1920x1080.
- Installed smoke PASS: final installer installed to `C:\GMP115PublishSmoke`, EXE FileVersion `1.1.5`, ProductVersion `1.1.5.0`. Startup dashboard, 100-row article import preview, Zhihu visible login lifecycle, and Zhihu L1-L3 self-test passed. Self-test evidence reported `selfTestColumnCount=5` and `selfTestNoHorizontalOverflow=true` (the measured document width did not exceed the viewport). The preview workbook contained 100 duplicates, so `importConfirmed=false` and no new production articles were imported.
- Real publish acceptance: `WAITING_FOR_USER`. This installed smoke did not click an L5 final-publish action and created no real PublishRecord; it claims no external ID/URL. A read-only production-DB audit also found prior L5 BrowserAutomation attempts with unknown submission outcomes: Zhihu `testRunId=d4cd0921-8736-4375-903a-fbd6b7afff31`, `Job ID=ea8c6507-ebb3-449a-9b01-227272ba4b77`, `Job=NeedsReconciliation`, `PublishRecord=none`, `External ID/URL=none`; Lieju-01 `testRunId=d9fe4c1b-2eb9-451d-b2d5-2dad5a81e110`, `Job ID=e1697efe-5ba8-4fbb-bce5-11f2f3c2b788`, `Job=NeedsReconciliation`, `PublishRecord=none`, `External ID/URL=none`; Lieju-01 `testRunId=281bcb54-54cb-4d9b-993b-70bb0c789041`, `Job ID=bf7298b1-f326-46b5-8ac5-54e1106c9892`, `Job=NeedsReconciliation`, `PublishRecord=none`, `External ID/URL=none`. These rows must not be retried or counted as publish success. L5 is additionally protected by the one-batch environment flag `REAL_PUBLISH_TEST_BATCH_CONFIRMED`; after reconciliation and an owner-confirmed safe continuation, each result must be recorded as PASS, WAITING_FOR_USER, FAILED, SKIPPED_MEDIA_REQUIRED, or NEEDS_RECONCILIATION based on real evidence.
- Real-account preflight (read-only production DB): enabled + logged-in + authorized candidates are BrowserAutomation accounts for Zhihu, Weibo, Sohu Media, Baijiahao, Lieju-01, Lieju-02, and Bilibili. No eligible API account was present. Bilibili and Sohu Media also expose video capability, but this batch has no test video and therefore remains `SKIPPED_MEDIA_REQUIRED`; article-capable candidates remain blocked by the unresolved BrowserAutomation L5 path.
- L5 code blocker found before this batch: `apps/desktop/src/main/platform-self-test.ts:219` calls the persistent Job, while `packages/adapters/browser/src/index.ts:184-188` deliberately stops every non-dry-run BrowserAutomation `publishArticle` with `USER_ACTION_REQUIRED` instead of implementing a bounded, platform-specific final-submit/reconciliation path. The current batch stopped before creating a new testRun/Job and did not click any final publish button. Do not expand platforms or package over `1.1.5` until this blocker and the existing unknown submissions are resolved.
- Verification: `pnpm lint` PASS; `pnpm typecheck` PASS; `pnpm test` PASS (`54` files / `277` tests); `pnpm build` PASS; `pnpm installer` PASS. The final installer is `release/Geo Media Publisher Setup 1.1.5.exe`, `101031128` bytes, SHA256 `7F27B8A40B7E5342FF71C9BB2915E1CDDC901DA47F100FBF45228F7AB72DC1BC`.
- Git/source provenance: the workspace `.git` is not a valid repository, so no source SHA is claimed. Current evidence is the final installer hash, installed EXE version metadata, automated test results, and installed smoke output under `output/playwright/v115-installed-smoke`.
- Risks and next task: owner confirmation, connected-account scope, platform verification, and external ID/URL evidence are still required before claiming any real publish PASS. Next task is the owner-gated low-volume L5 batch smoke, one publish maximum per connected platform/account, with video accounts marked `SKIPPED_MEDIA_REQUIRED` when no test video is supplied.

## V1.1.4 Import Diagnostics + Browser Lifecycle + Background Publishing — Installed Smoke PASS · 2026-08-24

- 当前阶段：`V1.1.4 Import Diagnostics + Browser Lifecycle + Background Publishing`。本轮只收口 Excel 简易导入诊断、外部窗口启动守卫、登录专用 Browser 生命周期、浏览器平台后台模式、最终发布模式和知乎正文图片真实上传；未新增平台，41 平台范围不变，未重构稳定的 Publisher、Scheduler 或 OAuth 架构。
- Excel 根因：用户真实工作簿的 Sheet、`标题 / 内容` 表头和 100 行文章均有效。旧简易导入在“企业”为空时只会在数据库恰好存在一个企业时自动推断；正式库存在 5 个企业，因此 100 行全部命中隐藏的 `UNKNOWN_BRAND` 校验，表现为 `importable=0 / duplicate=0 / needsAdjustment=100`。这不是文章内容、重复检测、Quality Gate、templateVersion 或 Sheet 名称导致。
- 用户文件：`D:\Downloads\康一环保_木渎推广文章100篇_兼容导入版.xlsx`，SHA256 `8DC2CDBADB7020372BDF452035806D7F5FB515D3AEAF338D7D98C0B18DBF741F`，工作表 `文章导入`、范围 `A1:B101`。隔离 5 企业测试库中预览为总计 `100`、可导入 `100`、重复 `0`、错误 `0`、警告 `0`；确认导入后 Production 文章 `100`、`source=excel_import`、Publish Job `0`。
- Sheet 回归：另一个真实 100 篇文件 `江苏康一环保科技有限公司_木渎推广文章100篇.xlsx` 的工作表为 `Sheet1`，同样得到 `100 / 0 / 0 / 0` 并可在隔离库确认导入。简易导入现在按可识别的“标题/内容”表头选择 Sheet，不再要求名称为“文章导入”；多个候选 Sheet 会返回候选列表供用户选择。
- 简易导入规则：唯一必填为标题和内容；企业由用户在导入前显式选择默认企业，城市、业务、平台、ContentGoal、QualityGate、标签和摘要均可为空。导入只进入 Production 文章库并按当前审核模式处理，不创建发布任务、不自动发布。
- 行级诊断：预览按 Excel 行号返回 `IMPORTABLE / DUPLICATE / ERROR / WARNING`、错误代码和中文原因，覆盖 `MISSING_TITLE`、`MISSING_CONTENT`、`DUPLICATE_CONTENT`、`INVALID_HEADER`、`UNSUPPORTED_WORKBOOK`、`UNKNOWN_COLUMN`、`CONTENT_TOO_LONG` 等；顶部独立显示总计、可导入、重复、错误、警告，点击统计可筛选对应行。
- 错误报告：支持“导出错误报告”，至少写出 Excel 行号、标题、状态、错误代码和错误说明。无错误时按钮禁用；错误行不会再只汇总成无原因的“需调整”。
- 正式安装版 Excel Smoke：安装版使用上述用户文件真实预览出 100 行，页面显示总计 `100`、可导入 `100`、重复 `0`、错误 `0`、警告 `0`，第 2–4 行均显示“可导入”，按钮为“确认导入 100 篇”。Smoke 随后点击取消，`importConfirmed=false`；正式库文章/Job/PublishRecord 前后仍为 `128 / 2 / 1`，`excel_import` 正式文章仍为 `0`，没有覆盖用户数据库。
- 启动自动开知乎根因：旧 Scheduler 在 App 启动时立即执行到期任务恢复和 BrowserAutomation 登录巡检；登录巡检/待恢复 Browser Job 会进入可见 Browser Session（旧默认 `headless=false`），因此用户未点击“打开后台/连接账号/发布/自测”也可能看到知乎。
- External Launch Guard：所有 Browser、平台后台、OAuth 和编辑器外部打开均要求带 `userActionId` 的 `UserInitiatedAction`，允许来源仅为 `CONNECT_ACCOUNT`、`OPEN_BACKEND`、`START_PUBLISH`、`RUN_SELF_TEST`、`CONTINUE_PENDING_ACTION`。`triggerSource=APP_STARTUP` 或缺少用户动作 ID 会在启动 Browser / `shell.openExternal` 前被拒绝。
- 启动恢复：Browser 平台待处理任务启动后只转为提醒“有任务需要继续”，登录失效只显示“需要重新登录”，必须由用户点击继续或重新登录；不会在启动时自动恢复 Browser 页面。具备官方 API 的后台 Job 仍可由持久化 Scheduler 正常执行。
- 正式安装版启动 Smoke：冷启动等待 7 秒后首页正常显示且只有“平台页面不会自动打开”提醒；Chrome/Edge 进程数前后均为 `17`，`--remote-debugging-pipe` 进程前后均为 `0`，没有自动打开知乎或其他平台。
- 登录生命周期：知乎登录使用 Dedicated Login Page/Context/Browser。用户点击“我已完成登录”且 `checkSession` 成功后，加密保存 storageState、账号更新为 `logged_in/enabled`、刷新 `lastVerifiedAt`，显示“✓ 登录成功 / 知乎账号已连接 / 登录状态已安全保存”，然后自动关闭登录专用 Page/Context/Browser；检测失败、验证码、短信或安全验证时保持 Browser 供用户继续处理。
- 正式安装版登录 Smoke：真实知乎 Session 校验成功，`lastVerifiedAt=2026-08-24T05:07:34.826Z`；安装版显示完整中文成功提示并关闭专用 Browser。整个 Smoke 结束后没有 Geo Media Publisher/Electron 残留进程，也没有关闭用户原有的 17 个普通 Chrome/Edge 进程。
- 浏览器发布方式：普通设置支持“后台自动 / 可见辅助”。只有平台 `BackgroundAutomationStatus=PASSED` 且用户选择后台时才使用系统 Chrome/Edge + `playwright-core` + 加密 Session 创建独立 headless Browser Context；状态为 `UNKNOWN / FAILED / REQUIRES_VISIBLE_BROWSER` 时使用可见辅助。任务结束只释放本软件创建的 Page/Context/Browser。
- 最终发布模式：支持 `PREPARE_ONLY / CONFIRM_BEFORE_PUBLISH / AUTO_PUBLISH`（只准备内容 / 发布前确认 / 自动发布），默认“发布前确认”；`AUTO_PUBLISH` 必须由用户主动开启。Browser 平台在没有真实 L5 最终提交能力证据时仍回退发布前确认，不能从 L1–L3 推断自动发布安全。
- 知乎图片链路：`selectedImageAssetId` 已从 Article → Publish Job → Publisher → Zhihu Adapter 传递，只取 1 张主图。真实正文上传使用知乎 `PostEditor EditorSnapshotWrapper` 自有的图片 MIME file input；明确排除了会只生成 `alt=封面图` 的封面 input 和不会改变 Draft 正文的图片库 input。上传前把光标放到正文稳定位置，通过 `setInputFiles` 使用正常网页上传能力。
- 图片成功门：记录 `IMAGE_UPLOAD_STARTED` 后，只有 Draft 正文区域图片数量增加、出现新的已加载 HTTPS 图片且无可见上传中状态，才记录 `IMAGE_UPLOAD_PASSED`；否则记录 `IMAGE_UPLOAD_FAILED`，不得写 PASS 或 PublishRecord 图片成功证据。
- 知乎真实后台验收：正式安装版真实 `testRunId=8b954398-c7f6-472e-a4b9-7df84db34753`，`BROWSER_EXECUTION_MODE=BACKGROUND / headless:true`，L1 账号与 Session、L2 编辑器、L3 标题/正文回读、`IMAGE_UPLOAD_STARTED`、`IMAGE_FILL`、`IMAGE_UPLOAD_PASSED` 和 `BACKGROUND_AUTOMATION` 全部 `PASSED`。`BackgroundAutomationStatus=PASSED`，`ImageUploadStatus=PASSED`。
- 风控：遇 `LOGIN_EXPIRED`、`CAPTCHA`、`SECURITY_CHECK`、`SMS_REQUIRED`、`QR_LOGIN`、`RISK_CONTROL` 等立即停止后台流程并进入 `WAITING_FOR_USER`；不会自动可见回退或尝试绕过。用户点击“打开处理”后才允许启动可见 Browser。普通图片面板里的“手机扫码上传”说明不会再被误判成真实风控。
- API 平台：Official API / OAuth Adapter 继续直接走 API 后台发布，正常发布不创建 Browser；只有 OAuth 重新授权且存在用户动作 ID 时才打开系统浏览器。Excel 导入与发布完全分离。
- 资源与数据边界：安装版 Smoke 前后正式库文章/Job/PublishRecord 为 `128 / 2 / 1`，用户内容表无新增；平台自测表新增 1 条 L1–L3 run 及对应 steps，并更新账号验证时间。最终发布按钮未点击，`publishConfirmedAt / publishRecordId / externalId / externalUrl` 均为 `null`。L4、L5 未执行，`PublishPassed=NOT_TESTED`，不得虚报。
- 自动验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（54 个测试文件、272 个测试）；`pnpm build` PASS；`pnpm installer` PASS。回归覆盖真实 100 篇两种 Sheet 名称、行级诊断/错误报告、APP_STARTUP 守卫、Pending Job 提醒、登录成功/失败关闭策略、后台状态机/可见回退/安全验证、图片 ID 传递与 DOM 证据、资源释放、API 不启动 Browser、导入不自动发布及三种最终模式。
- 正式安装包：`release/Geo Media Publisher Setup 1.1.4.exe`，`101,029,852` bytes，SHA256 `2571A882FCEDCBA32DC433F13AED47F2F6F0AC636AE8D03343A13AD1AEF60C8F`。已安装到 `C:\GMP114DiagnosticsSmoke`，EXE FileVersion `1.1.4`、ProductVersion `1.1.4.0`，安装资源包含 migration `0020_v114_background_automation_status.sql`。
- Smoke 证据：`output/playwright/v114-installed-smoke/01-startup-dashboard.png`、`02-excel-100-preview.png`、`03-login-success.png`、`04-zhihu-background-self-test.png`。正式 Smoke 前生产文件已备份到 `artifacts/production-backups/v114-pre-smoke-20260824-1210`。
- Git 说明：工作区 `.git` 不是有效 Git repository，无法提供可信 source SHA；本状态以安装包 SHA256、安装版版本元数据、隔离数据库回归、正式库只读核对和安装版 Smoke 作为当前可复核证据。

## V1.1.4 Enterprise Profile Editor Restored · Installed Smoke PASS · 2026-08-24

- 当前阶段：`V1.1.3.1 Enterprise Profile Editor Restore` 已以产品版本 `1.1.4` 完成。恢复“内容生产”中的当前企业资料卡、企业资料编辑器和企业知识资料管理；未修改任何平台 Adapter、Publisher、Job Queue、Scheduler、OAuthSessionManager、BrowserSessionManager 或平台自测中心业务实现。
- 根因与恢复方式：现有 `brands` 数据与 Brand Fact 能力仍在，但当前 Renderer 缺少完整企业资料/知识资料管理入口，Content Studio 也未显式展示当前企业与本次匹配事实。新增 `EnterpriseProfileManager`，并复用既有 Brand Repository、Quality Gate 与 Brand Fact 管线，不另建平行企业模型。
- 企业资料字段：企业全称、简称、简介、行业、地址、联系方式、官网、服务地区、主营业务和备注均可编辑并持久化；主营业务支持新增、编辑、删除和上下排序，服务地区支持新增与删除。
- 企业知识资料：支持服务介绍、企业优势、资质证书、案例、服务流程、FAQ、设备、专利及其他资料的新增、编辑、删除、启用/停用；界面只显示用户可理解的中文分类与状态。
- AI 事实边界：固化“不得编造资质/案例/服务范围/效果承诺/价格/联系方式”等核心规则，并允许维护自定义禁用宣传词。生成仍使用现有 Quality Gate/Brand Fact；启用的知识条目会进入事实快照，停用条目不会参与生成。
- Content Studio：顶部显示当前企业、资料完整度、知识条数和最近更新时间；可直接编辑资料、管理知识，存在多个企业时可切换。选题保留业务/地区下拉选择，并显示本次匹配的企业事实。资料不足只警告，不阻断工作流；每次启动生成都会重新读取 Repository 中最新企业资料。
- 数据兼容：migration `0019_v114_enterprise_profile_restore.sql` 只为既有 `brands` 增加行业、官网、备注字段并建立 `brand_knowledge_entries`；旧优势、FAQ、服务流程、售后等内容以稳定 `source_key` 回填为知识条目，不重建或重复 seed 企业。生产企业总数安装前后均为 `5`。
- 正式安装版 Smoke：安装到 `C:\GMP114Smoke`，从真实安装版打开“内容生产”，进入当前企业编辑器，保存康一环保备注 `V1.1.4 安装版 Smoke 2026-08-24`，关闭整个 App 后重新打开，企业资料仍存在且 4 条旧知识资料仍可见；未触发内容生成、草稿或发布。
- 数据与 Session 核对：生产库 `PRAGMA integrity_check=ok`；康一环保原有企业全称、简介、主营业务和服务地区保留。知乎账号 `8f666025-1776-41d5-8295-3bab150f615c` 仍为 `logged_in/enabled`；安装前后加密凭据文件 SHA256 均为 `B27760177D604FF11EB9CC237A3B8D7EC6CAD455E4BBB98B59EDB0DE1511D6F1`。
- 备份：正式 Smoke 前已备份生产 `publisher.db`、WAL/SHM 与 `credentials.enc` 到 `artifacts/production-backups/v114-pre-smoke-20260824-104642`。
- 质量门：`pnpm lint`、`pnpm typecheck`、`pnpm test`（49 files / 235 tests）、`pnpm build`、`pnpm installer` 全部 PASS。
- 安装包：`release/Geo Media Publisher Setup 1.1.4.exe`，101,019,256 bytes，SHA256 `79816865EF06E0CD6075BB743B5A4867A5C0F55F8A4FF7CC4A8D26A1167A33C4`；已安装 EXE 文件版本 `1.1.4`、产品版本 `1.1.4.0`，安装包内已包含 migration 0019。
- Git 说明：工作区 `.git` 不是有效 Git repository，无法提供可信 source SHA；本状态以安装包 SHA256、版本元数据、生产库审计和安装版 Smoke 作为当前可复核证据。

## V1.1.3 Platform Self-Test Center — Platform Self-Test Acceptance / Installed Smoke PASS · 2026-08-24

- 当前阶段：`V1.1.3 Platform Self-Test Acceptance`。统一平台自测中心、逐账号证据模型、L1–L5 状态机、Renderer/IPC/Repository/Adapter 接线、测试与正式安装版 Smoke 已完成。目标是验证现有平台真实能力，不新增平台，也不把本地代码测试升级成平台真实通过。
- 入口与默认边界：“高级功能 → 平台自测”和账号中心平台卡片“自测”均可进入。默认“自测 L1–L3”只执行登录/Session、编辑器和内容填充，不创建测试文章、发布 Job 或 PublishRecord，不点击最终发布。“检查全部已连接账号”只执行 L1。
- L1–L5：`L1_LOGIN` 验证账号连接及 Session/OAuth；`L2_EDITOR` 打开真实创作者后台/编辑器；`L3_CONTENT_FILL` 填写并回读标题、正文及可验证图片；`L4_DRAFT` 只在 Adapter 声明并实现可靠草稿能力时创建真实草稿；`L5_PUBLISH` 必须单账号明确确认后才经持久化 Job Queue 真实发布、保存 External ID/URL 并回查状态。
- 证据模型：migration `0018_v113_platform_self_test.sql` 新增 `platform_self_test_runs` 与 `platform_self_test_steps`，保存 `testRunId`、平台、`platformAccountId`、等级、时间、结果、`errorCode`、脱敏 `verificationSignal` 及真实发布证据。Cookie、Token、Secret、Authorization 和密码不会写入自测表或 Renderer。
- 安全门：L5 的“确认测试发布”和清理的“确认删除”相互独立；没有确认不创建 Job。视频平台没有用户指定测试视频时停在 `WAITING_FOR_TEST_MEDIA`；图片没有合适测试素材时记录 `SKIPPED_NO_TEST_IMAGE`，只选择未上传时记录部分通过。验证码、短信、拼图、扫码、安全验证、人机或风控停在等待用户，不实现绕过。
- 列举网：结果按每个 `platformAccountId` 独立保存和逐行显示。当前生产库为列举网-01、列举网-02 两个未连接容器；本轮没有选择任一列举网账号。即使未来存在 13 个账号，默认也只运行用户手动选择的一个账号，不自动创建 13 个草稿或发布 13 条测试内容。
- 浏览器兼容：本机 Edge 为旧版本而 Chrome 为当前版本；BrowserSessionManager 改为 Chrome 优先、Edge 回退，解决知乎出现“客户端需升级”的直接环境风险。随后用真实页面修复知乎 Draft.js 正文必须定位真实 `contenteditable` 子节点，并为页面 hydration 增加 10 秒有界可见性等待；不无限等待。
- 正式安装版实测：安装到 `C:\GMP113Smoke`，安装文件版本 `1.1.3`、产品版本 `1.1.3.0`。安装前备份生产 `publisher.db`、WAL/SHM 和加密凭据到 `artifacts/production-backups/v113-pre-smoke-20260824-0952`。安装版真实打开平台自测中心并写入 migration 0018。
- 知乎真实结果：账号 `8f666025-1776-41d5-8295-3bab150f615c`，`testRunId=8ba9d9d7-b5ce-4655-bf3a-4563ce691579`。`ACCOUNT_CONNECTION=PASSED`、`SESSION_OR_OAUTH=PASSED`、`EDITOR_OPEN=PASSED`、`TITLE_FILL=PASSED`、`BODY_FILL=PASSED`；标题/正文均实际填入并回读一致。图片为 `PARTIAL_PASSED / IMAGE_FILL_NOT_VERIFIED`，因为只证明测试图片已选择，没有真实上传证据。L4、L5 未执行。
- 第二平台真实结果：生产环境没有已配置 PAT 的博客园账号，也没有第二个已连接 Browser 账号，因此选择百家号账号 `63a5c93c-e62f-4f6b-b2ae-58c1e1e01b38`。`testRunId=4045834f-d40b-41ba-9e1f-041288ef9562` 在 L1 得到 `LOGIN_EXPIRED / logged_out`，因此 LoginPassed=FAILED，L2/L3 未执行，没有打开编辑器。
- 外部副作用核对：本轮 `test source articles=0`、`self-test publish jobs=0`、`self-test publish records=0`、`publish confirmations=0`、带 External ID/URL 的自测结果=0。没有实际发布测试帖，没有 External URL，没有平台被升级为 `PublishPassed`。

### V1.1.3 逐平台真实状态

`NOT_TESTED` 表示本轮未以该平台真实账号执行对应等级；不得从单元测试或其他平台结果推断通过。

| 平台 | LoginPassed | EditorPassed | ContentFillPassed | DraftPassed | PublishPassed | 本轮说明 |
|---|---|---|---|---|---|---|
| 抖音 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行；没有测试视频与 L5 确认 |
| 快手 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 视频号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 小红书 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 哔哩哔哩 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行；没有测试视频 |
| 百家号 | FAILED（账号 63a5…）/ NOT_TESTED（另一个账号） | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 实测账号 `logged_out / LOGIN_EXPIRED`，在 L1 停止 |
| 头条号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 新浪微博 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 知乎 | PASS | PASS | PASS | NOT_TESTED | NOT_TESTED | 标题、正文真实填入并回读；图片仅部分通过 |
| 企鹅号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 搜狐号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 一点号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 大鱼号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 网易号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 爱奇艺 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 腾讯微视 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 微信公众号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 搜狐视频 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 皮皮虾 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 腾讯视频 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 多多视频 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 美拍 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| AcFun | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 快传号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 雪球号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 蜂网 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 得物 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 豆瓣 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| CSDN | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 简书 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 车家号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 小红书商家号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 易车号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 小红书私信版 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| TikTok | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行；没有测试视频 |
| YouTube | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行；没有测试视频 |
| Facebook Pages | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| Instagram Professional | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 其他账号 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 未执行 |
| 列举网 | NOT_TESTED（逐账号） | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 列举网-01、-02 均未选择；没有批量测试 |
| 博客园 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | 没有已配置 PAT 的生产账号 |

- 自动验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（48 个测试文件、230 个测试）；`pnpm build` PASS；`pnpm installer` PASS。新增测试覆盖 L1–L5 状态、L5 确认、L1-only 健康检查、13 个列举网账号不会批量发帖、Browser/OAuth 账号隔离、External URL 证据门、失败不升级 PublishPassed、WAITING_FOR_USER、删除确认和测试内容不进入 Production。
- 安装包：`release/Geo Media Publisher Setup 1.1.3.exe`，101,011,952 bytes，SHA256=`9A8F72AD693CE9AAFB3449C58577C3E2DF8994AB94F26DE71E69FD65A9BF9CA8`。
- 主要修改：`package.json`、`packages/domain/src/types.ts`、`packages/db/migrations/0018_v113_platform_self_test.sql`、`packages/db/src/repository.ts`、`packages/adapters/core/src/index.ts`、`packages/adapters/core/src/browser.ts`、`packages/adapters/core/src/browser.test.ts`、`packages/adapters/cnblogs/src/index.ts`、`packages/adapters/zhihu/src/browser.ts`、`packages/adapters/zhihu/src/browser.test.ts`、`apps/desktop/src/main/platform-self-test.ts`、`apps/desktop/src/main/ipc.ts`、`apps/desktop/src/main/preload.ts`、`apps/desktop/src/shared/api.ts`、`apps/desktop/src/renderer/PlatformSelfTestCenter.tsx`、`apps/desktop/src/renderer/App.tsx`、`apps/desktop/src/renderer/V11Workspace.tsx`、`apps/desktop/src/renderer/v11-ui-model.ts`、`apps/desktop/src/renderer/styles.css`、`tests/v113-platform-self-test.test.ts`、`tests/v04-platform-integration.test.ts`、`tests/v112-account-lieju-cnblogs.test.ts`、`docs/V0.6_VERIFICATION_PLAN.md`、`MANUAL_ACTIONS.md` 与本文件。

## V1.1.2 Account Priority + Lieju Multi-Account + CNBlogs Integration — Code Complete / Installed Smoke PASS · 2026-08-22

- 当前阶段：V1.1.2 `Account Priority + Lieju Multi-Account + CNBlogs Integration`。本轮只实现账号中心排序、列举网、博客园和列举网 13 账号管理；没有重构 Publisher、Scheduler、OAuth Runtime、BrowserSessionManager 核心，也没有修改现有稳定平台 Adapter 的业务实现。
- 账号中心排序：确定性优先级为 `CONNECTED` → `CONNECTABLE` → `CONFIG_REQUIRED` → `ASSISTED / MANUAL` → `DEVELOPING` → `BLOCKED / NOT_IMPLEMENTED`；同级按常用平台、最近使用时间、中文平台名排序。顶部提供“已连接 / 可连接 / 全部平台”，搜索只过滤、不改变既有排序。正式安装版实际前十为：知乎、哔哩哔哩、百家号、企鹅号、搜狐号、列举网、新浪微博、抖音、头条号、Facebook Pages。
- 平台目录：`PLATFORMS.csv`、平台能力目录和账号中心均为 41 个唯一外部平台；原 39 个全部保留，新增 `lieju`（列举网，BrowserAutomation）和 `cnblogs`（博客园，Official API）。打包资源内已核对 migration `0017_v112_account_priority_lieju_cnblogs.sql` 与 41 行平台目录。
- 列举网：使用现有 BrowserSessionManager、playwright-core 和系统 Edge / Chrome；首次连接打开 `https://www.lieju.com/login/`，验证码、短信、拼图和安全验证只等待账号所有者完成。正式安装版点击“+ 添加账号”后实际拉起系统 Chrome，窗口标题为“列举网登录”，应用显示“我已完成登录”。当前生产库有 1 个 `needs_user_action` 的 `列举网-01` 容器，Browser Session 尚未保存，真实已连接列举网账号数量为 **0**；外部浏览器中的凭据可登录性已验证，但未把该外部会话冒充为软件内已连接状态。
- 列举网多账号：统一 PlatformAccount 模型支持至少 13 个账号；每个账号保存独立 `platformAccountId`、本地别名、可安全获取的外部账号 ID / 名称、连接状态、`browserSessionId`、最后验证/发布时间。Session 的加密存储键和 hash 均包含 `platformAccountId`，重登或断开一个账号只处理该账号；同账号 Browser 发布使用独占 lock，不同账号按既有全局并发策略。发布窗口默认单选，允许多选并为 N 个账号分别创建持久化 Job、PublishRecord 和 Session 流程。
- 列举网发布准备：已按真实页面核对分类选择页与文章表单；可填标题、正文，并只在真实表单能力允许时使用已选图片。分类、地区、联系方式、价格等不能由文章推断的字段不猜测，拼图/验证码和最终提交始终等待用户。未执行最终发布，未声明列举网 `PublishPassed`。
- 博客园：使用官方博客后台 Open API 与 PAT，不优先使用 Browser Automation。连接验证先调用 `GET https://i.cnblogs.com/openapi/v1/corp/info`；创建文章调用 `POST https://i.cnblogs.com/openapi/v1/posts`，默认 `IsPublished=false` 创建未发布草稿；审核状态回查调用 `POST https://i.cnblogs.com/openapi/v1/posts/reviewStatus:check`。PAT 仅由主进程 safeStorage 加密保存，Renderer 只能读取“已配置”摘要，不能回读完整 PAT。当前未提供博客园 PAT，因此 `NotConfigured / WaitingForUser`，真实 `ConnectionPassed=false`、`PublishPassed=false`。
- 内容兼容：Excel 简易模板的“标题 / 内容”可直接进入博客园发布流程；普通文本按 Markdown 保留段落和换行。官方文档未确认独立图片上传端点，因此首版博客园只发布标题和正文，不调用未验证私有图片接口。唯一已连接博客园账号自动选择，多账号时才显示选择器。
- 现有平台保护：正式安装版通过 preload 读取到知乎账号仍为 `logged_in / ConnectionPassed`；知乎 Adapter 业务实现和已有 Session 能力未修改。列举网/博客园包、注册与测试均为增量实现。
- 自动验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（47 个测试文件、221 个测试）；`pnpm build` PASS；`pnpm installer` PASS。测试覆盖优先级、常用/搜索、41 平台、两种接入声明、列举网 13 账号承载与 Session 隔离、重登/断开隔离、同账号 lock、多账号独立 Job、博客园 PAT 安全边界与状态分离、Excel 流程、唯一账号自动选择和知乎保护。
- 正式安装版 Smoke：隔离安装到 `C:\GMP112Smoke`，静默安装退出码 0；账号中心真实 DOM 显示 `41 / 41` 和“已连接 / 可连接 / 全部平台”，知乎位于首位且为已连接，列举网位于可连接组；列举网官方登录页实际打开。没有在软件内完成列举网登录、没有配置博客园 PAT、没有执行任何平台最终发布，因此上述状态保持 `WaitingForUser`。
- 安装包：`release/Geo Media Publisher Setup 1.1.2.exe`，101,002,877 bytes（96.32 MiB），SHA256=`A175F0E4053DE3C44AF57CE67B9F54E69D438BD10250F7CB39EB74022CBA1F1C`。

## V1.1.1 UX Fix Pack — Code Complete / Installed Smoke PASS · 2026-08-22

- 当前阶段：V1.1.1 仅修复本轮定义的内容审核、图片标签与自动配图、账号中心平台目录三组 UX 问题；Renderer、IPC、Repository、ViewModel、测试和 Installer 已闭环。没有修改数据库 schema 或 migration，也没有改动 Adapter、Publisher、BrowserSessionManager、OAuth Runtime、Job Queue 或 Scheduler。
- V1.1 仍强制审核的根因：发布弹窗按 `qualityStatus !== Approved` 禁用操作，同时 Repository 无条件拒绝非 `Approved` 文章；这使运营文章和 Excel 导入草稿即使用户已确认提醒也无法进入既有持久化发布流程。
- 审核模式：新增 `Off`、`WarningOnly`、`Strict`，默认 `WarningOnly`。`WarningOnly` 对 Draft / NeedsReview 展示内容提醒，但保留“仍然发布”；`Off` 不做内容状态阻断；`Strict` 保留原有必须 `Approved` 的强制门禁。Benchmark、Mock 和测试来源继续严格门禁，Scheduler 门禁未改动。
- 直接发布：手工/Production、Content Studio 和 Excel 导入文章在 `Off` / `WarningOnly` 下都可发起发布；Excel 导入仍只负责导入，不自动创建 Job。真正点击发布时仍通过原有持久化 Job Queue，最终平台提交继续由账号所有者确认，不把准备完成写成 `PublishPassed`。
- 图片标签：普通图片编辑器直接显示多选“业务”“地区”“用途”和自定义标签，不再把业务/城市藏在高级页。用途改为多选，并继续写入已有 `metadata_json`，因此本轮不需要 migration。
- 自动配图：按文章业务+地区最高优先，其次业务、地区、用途/自定义标签，最后通用图；平台匹配只做同分候选的微调。显式排除当前图片，并避开最近发布/最近使用的图片，再按使用次数从最低候选池随机选择，支持“换一张”、手动选择和不配图。
- 账号中心：恢复完整 39 平台目录，支持全部/已连接/常用/需处理标签、搜索、收藏和能力状态；不再只显示知乎、微博、头条、抖音四个平台。已有知乎账号在正式安装升级后仍显示“已连接”，数据库为 `logged_in / enabled`，加密凭据文件安装前后 SHA256 未变化。
- 正式安装版 Smoke A–E：PASS。A：Draft/NeedsReview 文章显示发布入口、提醒和“仍然发布”；B：图片库实际批量上传 6 张，并在普通编辑器可见选择业务/地区/用途；C：其中 3 张分别写入不同标签，发布窗口自动命中地区图片并可“换一张”到另一候选；D：账号中心显示 `39 / 39`；E：知乎账号仍为“已连接”，发布窗口自动选择唯一知乎账号。Smoke 未点击平台最终发布按钮，因此不声明外部真实发布成功或 `PublishPassed`。
- 验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（44 个测试文件、207 个测试）；`pnpm build` PASS；`pnpm installer` PASS。安装包 `release/Geo Media Publisher Setup 1.1.1.exe`：100,996,975 bytes（96.32 MiB），SHA256=`39CC9217219A5A5332DBDA2DF6359E9A529C159AC64E1703827C58B01943A69B`。安装后注册版本和文件版本均为 1.1.1，打包资源内平台目录为 39 个唯一平台且没有 TestPlatform。
- 本轮主要修改：`package.json`、`packages/domain/src/types.ts`、`packages/db/src/repository.ts`、`apps/desktop/src/shared/api.ts`、`apps/desktop/src/main/preload.ts`、`apps/desktop/src/main/ipc.ts`、`apps/desktop/src/renderer/App.tsx`、`apps/desktop/src/renderer/V11Workspace.tsx`、`apps/desktop/src/renderer/v11-ui-model.ts`、`apps/desktop/src/renderer/ImageLibraryPage.tsx`、`apps/desktop/src/renderer/styles.css`、`tests/v103-zhihu-excel.test.ts`、`tests/v111-ux-fix-pack.test.ts`、本文件和 `MANUAL_ACTIONS.md`。

## V1.1 Product UX Refactor — Code Complete / Installer Generated · 2026-08-22

- 当前阶段：企业内容运营工作台的前端重构、现有能力接线、测试、构建和 V1.1.0 安装包均已完成。没有修改数据库 schema、没有新增 migration，也没有修改 Adapter、BrowserSessionManager、Publisher、Job Queue 或 Scheduler。
- 普通模式导航已收敛为：首页、内容生产、文章库、图片库、账号中心、发布中心、数据统计；侧栏“高级功能”承载平台能力、运行日志、AI 与模型设置、数据备份、高级审核规则、视频素材、发布计划、发布任务与技术诊断、图片高级标签。普通页面不再呈现 Adapter、OAuth、Job Queue、Provider、Model、Prompt、Benchmark、Lifecycle、Dry Run 或 PublishRecord ID 等技术概念。
- 首页：展示今日内容、待审核、待发布、已发布、在线账号、“需要处理”、快捷操作、最近文章和最近发布结果；统计和列表只取正式运营文章及其关联发布安排，避免测试/Benchmark 内容污染日常视图。
- 内容生产：默认只填写企业资料、业务、城市、关键词、生成数量（1–10）并点击“开始生成”。每一篇复用既有 Content Studio 持久化任务；完成后会按既有图片库优先级自动匹配图片、执行既有内容检查，并将业务、目标渠道写回已有 Article 字段以支撑后续匹配。高级选项仅展示业务说明，不暴露 Provider/Model/Prompt。
- 文章库：默认只显示 production、content_studio、excel_import 文章；行内展示封面、标题、业务/城市、审核状态、渠道、更新时间，以及查看/修改/审核/发布。审核抽屉使用草稿、待审核、已通过、需修改、已驳回等业务语言；详细技术审计继续保留在高级审核规则。
- Excel：默认按钮为“下载模板”和“Excel 导入”；模板为仅 `标题`、`内容` 两列的简易模板。高级模板与高级导入能力仍保留在高级筛选展开项；导入仍只写文章，不自动创建发布安排。
- 图片库：普通模式按治理现场、检测设备、消杀现场、白蚁防治、办公环境、企业资料、证书资料、通用图片分类，支持选择/批量上传、预览、启用/停用、删除；业务/城市标签已收进“高级标签”。匹配仍沿用既有业务+城市+平台+关键词优先级，不随机选择无关图片。
- 账号中心：普通模式只显示知乎、微博、头条、抖音的账号名、是否已登录、今日发布和常用操作（连接账号、重新登录/检查登录、打开后台、发布测试）。现有登录、加密会话、账号同步与平台端正常验证逻辑未改动。
- 发布中心：合并了日常发布安排与进度，显示文章、渠道、账号、状态、时间和操作；状态翻译为待发布、等待确认、发布中、已发布、需要处理。文章发布抽屉仅为已审核文章显示渠道勾选，单一已登录账号会自动选择，按现有接口创建持久化 Job 并打开编辑页面填充内容。知乎文案明确为“发布方式：需要最终确认”，不会点击最终发布、不会绕过验证、不会虚报发布成功。
- 主要修改：`apps/desktop/src/renderer/App.tsx`、`apps/desktop/src/renderer/V11Workspace.tsx`、`apps/desktop/src/renderer/v11-ui-model.ts`、`apps/desktop/src/renderer/styles.css`、`apps/desktop/src/main/ipc.ts`、`apps/desktop/src/main/preload.ts`、`apps/desktop/src/shared/api.ts`、`packages/db/src/repository.ts`、`tests/content-studio.test.ts`、`tests/v11-ux-workspace.test.ts`、`package.json`、本文件和 `MANUAL_ACTIONS.md`。
- 验证：`pnpm typecheck` PASS；`pnpm lint` PASS；`pnpm test` PASS（43 个测试文件、199 个测试）；`pnpm build` PASS；`pnpm installer` PASS。安装包 `release/Geo Media Publisher Setup 1.1.0.exe`：100,991,786 bytes，SHA256=`07A755911157995CCA0AE24F7B355796F0589D6D98F6A45554B64D113AF2C31B`。
- 安装版证据边界：安装程序可启动，但本机已有同 App ID 的旧应用处于运行状态，NSIS 显示 `Failed to uninstall old application files. Please try running the installer again.`，因此本轮安装目录未落地且 V1.1.0 的正式安装版 Smoke Test 为 BLOCKED。为保护当前知乎会话和现有数据，未关闭旧应用、未清理会话、未重置数据；也未执行真实账号连接、知乎编辑器打开或最终发布。关闭旧版后重新运行安装包，才能补齐正式安装版 A–E Smoke Test；在此之前，真实账号/编辑器/发布状态仍保持 `WaitingForUser`，不得把本地测试或安装包生成写成 `PublishPassed`。

## V1.0.4 Simple Import + Image Library + One-Click Publish · 2026-08-21

- 当前阶段：V1.0.4 本地实现、持久化模型、UI 入口、测试、构建和安装 Smoke Test 已完成；真实知乎账号/Session、最终发布和知乎编辑器真实配图插入仍保持 `WaitingForUser`，没有填写 `PublishPassed`。
- Excel 双模板：简易模板文件名为 `Geo Media Publisher 简易文章导入模板.xlsx`，单 Sheet `文章导入`，仅 `标题`、`内容` 两列且均必填；高级模板文件名为 `Geo Media Publisher 高级文章导入模板.xlsx`，保留 `标题`、`正文`、`摘要`、`企业`、`业务`、`城市`、`关键词`、`标签`、`目标平台`、`内容类型`、`推广程度`、`来源备注` 12 个字段及 `填写说明`。简易导入自动写入 `source=excel_import`、Draft/unchecked，导入只写文章，不创建 Job、不发布。
- 导入体验：默认预览只显示行号、标题、状态和错误；单品牌时自动匹配，多个品牌时可在预览中选择已有品牌；标题/内容必填，重复和错误继续走现有导入校验。
- 发布入口：文章库语言改为“发布到平台”，单个已连接账号自动选择并显示“账号：xxx（已自动选择）”，多账号才显示选择器；非 Approved 内容显示友好提示和“去审核”；主按钮为“打开X并填写文章”。仍沿用持久化 Job Queue、Publisher 和现有 Adapter 架构，不新增平台，不修改其他平台 Adapter 业务实现。
- 图片库：新增“图片库”页面，支持批量导入、预览、删除、业务/城市/平台/标签、通用、启用/停用、使用次数和最近使用时间；文件进入 `data/media/images`，敏感文件路径只由主进程处理。migration 为 `0016_v104_image_library.sql`，复用 `media_assets` 表并为 Job/Record 增加 `selected_image_asset_id`、`image_selection_mode`。
- 随机配图：默认随机，可替换随机、手动选择或不配图；匹配优先级为业务+城市+平台、业务+平台、业务+城市、业务、平台、通用，最佳候选中随机，并尽量避开最近 3 次；无候选时继续发布流程并显示提示。平台标签兼容 `知乎/百家号/微博` 中文写法及内部 key。Excel、AI、手工文章均可使用，缺业务/城市等字段时回退到通用候选。
- 知乎配图真实性：当前会持久化选择、写入 Job/PublishRecord，并将准备结果标为 `imageInsertion=pending_next_step`；知乎 Adapter 当前未稳定实现编辑器图片插入，因此没有声称真实插入成功。标题/正文仍按现有辅助发布流程填充，最终发布由用户确认。
- 主要修改：`packages/domain/src/types.ts`、`packages/db/migrations/0016_v104_image_library.sql`、`packages/db/src/repository.ts`、`packages/publisher/src/index.ts`、`apps/desktop/src/main/excel-templates.ts`、`apps/desktop/src/main/ipc.ts`、`apps/desktop/src/main/preload.ts`、`apps/desktop/src/shared/api.ts`、`apps/desktop/src/renderer/App.tsx`、`apps/desktop/src/renderer/ImageLibraryPage.tsx`、`apps/desktop/src/renderer/styles.css`、`package.json`、`tests/v104-simple-image.test.ts`、`tests/v04-platform-integration.test.ts`。
- 验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（42 个测试文件、196 个测试，含 better-sqlite3 native rebuild）；`pnpm build` PASS；`pnpm installer` PASS。安装包 `release/Geo Media Publisher Setup 1.0.4.exe`：100,992,353 bytes（96.31 MiB），SHA256=`3E4B166BD6873064A0BE23549F48BAD6B406FE0BACC14E4D8CDE801DD993A96E`。安装 Smoke Test PASS：静默安装退出码 0、发现 `0016_v104_image_library.sql`、安装后的 `Geo Media Publisher.exe` 启动并保持运行 8 秒后正常结束测试进程。该 Smoke Test 不代表真实知乎账号、编辑器配图或真实发布证据。

## V1.0.3 Zhihu Account Sync & Excel Article Import · 2026-08-21

- 当前阶段：V1.0.3 本地代码、持久化模型、UI 入口与测试已完成；知乎真实账号登录/编辑器输入尚未在本机以真实用户 Session 验证，平台状态保持 `WaitingForUser`，没有填写 `DryRunPassed` 或 `PublishPassed`。
- 账号规范模型：继续使用既有 `accounts` 表作为唯一规范 `PlatformAccount`；migration `0015_v103_zhihu_excel_import.sql` 增加 `connection_mode`、`authorization_status`、`browser_session_id`、`external_account_id`、`last_verified_at`，发布 Job/Record 同步保存 `platform_account_id`。知乎浏览器登录成功、刷新检查、断开都会回写同一条账号记录，稳定外部账号 ID 可用于去重；Session 只保存非敏感 hash 到审计字段，Cookie/StorageState 仍只走 CredentialStore。
- 知乎发布链路：文章库的 `[发布]` 只允许 Production 文章进入知乎辅助发布弹窗；弹窗展示标题、来源、Quality Gate、知乎账号和 `BrowserAutomation / ASSISTED` 模式。非 `Approved` 内容由 UI 和仓储双重阻断。任务先写入持久化 Job Queue，状态为 `AwaitingConfirmation`；准备阶段恢复用户 Session、打开 `https://zhuanlan.zhihu.com/write`，由知乎 Adapter 填充并实际校验标题/正文，记录 `EDITOR_OPEN_PASSED`、`TITLE_FILLED`、`BODY_FILLED`，写入 `PublishRecord(status=Prepared, success=false)`，不会点击最终发布、不会伪造 External ID/URL。
- Excel 文章导入：文章库新增 `[Excel 导入]`、`[下载导入模板]`；模板文件名为 `Geo Media Publisher 文章导入模板.xlsx`，包含 `文章导入`、`填写说明`。解析只读取静态单元格，敏感列、未知字段、宏、外链和公式均不作为代码执行；导入前显示预览、计数和错误报告。标题/正文必填，分号字段拆分，品牌/内容类型/推广程度/平台校验，标题+正文指纹重复默认跳过，显式覆盖才导入。文章写入 `source=excel_import`、`Production` 可筛选、质量状态为 `unchecked`，不自动 Approved、不创建 Job、不打开编辑器、不调用平台 API。
- 真实证据边界：新增的仓储和 Adapter 单测只证明本地契约；本轮没有可供 Codex 自动使用的知乎账号所有者授权/真实 Session，因此没有声称真实浏览器登录、真实编辑器输入或真实发布通过。验证码、安全验证、人机验证仍必须由账号所有者在知乎正常流程完成。
- 本轮修改范围：`packages/db/migrations/0015_v103_zhihu_excel_import.sql`、`packages/domain/src/types.ts`、`packages/db/src/repository.ts`、`packages/adapters/browser/src/index.ts`、`packages/adapters/zhihu/src/browser.ts`、`packages/publisher/src/index.ts`、`apps/desktop/src/main/ipc.ts`、`apps/desktop/src/main/preload.ts`、`apps/desktop/src/shared/api.ts`、`apps/desktop/src/renderer/App.tsx`、`package.json`/`pnpm-lock.yaml`；新增 `tests/v103-zhihu-excel.test.ts`、`packages/adapters/zhihu/src/browser.test.ts`。
- 验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（41 个测试文件、193 个测试，包含 better-sqlite3 native rebuild）；`pnpm build` PASS；`pnpm installer` PASS。安装包 `release/Geo Media Publisher Setup 1.0.3.exe`：100,987,449 bytes（96.31 MiB），SHA256=`D83E249374CCFF244AB908FFBBFD3B620FF3F3E65A686FE1391F01594E8E805F`。最终安装 Smoke Test PASS：静默安装退出码 0、安装目录发现 `0015_v103_zhihu_excel_import.sql`、安装后的 `Geo Media Publisher.exe` 启动保持运行 8 秒后正常结束测试进程。该 Smoke Test 未代表真实知乎账号或真实发布证据。

## V1.0 Internal Platform Automation Hub · 2026-08-21

- 当前阶段：Internal Platform Automation Hub。单企业内部使用，不引入 SaaS 租户隔离；V1.0 代码已完成，外部账号和真实发布继续保持 WaitingForUser。
- 平台能力已覆盖 39 个平台注册项并写入 integration_mode：API 4、OAuth 4、BrowserAutomation 6、SemiAuto 1、Manual 21、Blocked 3；生命周期仍按 PLATFORMS.csv 的独立 verification_status 记录。
- 第一批六个平台已完成 Browser Automation 统一接入：知乎、百家号、新浪微博、搜狐号、企鹅号、哔哩哔哩。当前支持用户自有账号登录、加密 Session 保存/恢复、打开官方后台和生成发布任务；真实最终点击、真实发布与平台回查尚未执行。
- 视频号改为 SemiAuto：系统准备内容并打开官方入口，最后确认由用户完成。抖音、Facebook Pages、YouTube、TikTok 保持原 OAuth Adapter，未修改其业务实现。
- 新增 AutomationAdapter、BrowserSessionManager、browser/semi-auto Adapter 包、0014 migration、账号状态和发布模式 UI；PublishRecord 记录 publishMode、automationType、browserSessionIdHash、operator、verificationStatus。
- Session 只经安全 CredentialStore 保存，生产环境使用 Electron safeStorage；Renderer 不读取敏感文件，不保存明文 Cookie。验证码、短信、安全验证和风控均暂停等待用户，不实现绕过。
- 真实发布状态：本轮没有真实账号发布证据，不填写 PublishPassed；缺少账号所有者授权、平台权限、External ID/URL 或状态回查时，保持 WaitingForUser。
- 验证：pnpm lint、pnpm typecheck、pnpm test（37 个测试文件、180 个测试）、pnpm build 已通过。详细边界见 docs/V1.0_PLATFORM_AUTOMATION_HUB.md 和 MANUAL_ACTIONS.md。

## V0.9.3.4 DeepSeek Production Sample Recovery · 2026-08-21

- 当前阶段：`DeepSeek Production Sample Recovery`；恢复代码已完成，但真实样例仍为 `BLOCKED_EXTERNAL`，原因是 DeepSeek 账户余额不足。`Human Review` 不推进，继续保持 `WAITING_FOR_HUMAN_REVIEW`。
- 真实 Provider 诊断：provider=`deepseek`，model=`deepseek-v4-flash`，HTTP status=`402`，error category=`balance`，response body 摘要为 `{"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}`，request id 未返回。API=`normal`、authentication=`normal`、model=`normal`，`/models` 返回 `deepseek-v4-flash` 和 `deepseek-v4-pro`；因此不是 API Key、鉴权、模型不可用或请求参数问题，而是余额阻断。诊断使用 `maxOutputTokens=3000`、`temperature=0.7`、`retryCount=3`，未输出 API Key、Authorization 或 Token。
- 数据状态：当前正式可用文章 `availableArticles=6`，正式来源文章总数 `8`（其中 2 篇历史文章为 `archived/NeedsRewrite`），Benchmark `120`；首页指标仍不计 Benchmark。现有 `production_intent_sample` 任务 `12` 个，`failed=12`、`sourceArticleId=0`、Production Sample 文章 `0`。未重新生成 120 条 Benchmark，未重新生成 Human Review，也未执行真实发布。
- 12 个失败任务的安全 `providerDiagnostics` 已持久化，恢复脚本在余额恢复前只做连接预检，不重置任务、不新增任务、不生成 Mock/伪 Production。恢复时将复用这 12 个原任务 ID，并按本轮场景校正第 5、9、11 项意图输入；预置 `topicPlan`，每个任务只调用一次内容生成。
- 本轮新增/修改：`packages/db/src/repository.ts` 增加无来源 Content Studio 任务恢复及安全诊断输出；`apps/desktop/src/main/content-studio.ts` 在规划/平台失败时持久化 provider、model、status、request id、HTTP status、error category 和已脱敏 body 摘要；`apps/desktop/src/shared/api.ts` 补充诊断类型；`scripts/v0934-deepseek-diagnostic.mts/.cjs` 提供只输出安全字段的 Provider 诊断；`scripts/v0934-production-sample-recovery.mts/.cjs` 提供 12 篇 Production Sample 的预检恢复；新增 V0.9.3.4 恢复测试。
- 12 篇目标场景与验收字段已固化在恢复脚本中，但由于真实余额阻断，本轮没有诚实可列出的 12 个生成标题、事实数量、品牌提及数、差异化分数或 `knowledgeSnapshot` 结果；不能将失败任务计为生成成功。
- 安全边界保持不变：未修改 OAuthSessionManager、Account Connection、Adapter、Publisher、Job Queue、Scheduler、Content Intent 模型或 Quality Gate 规则；未新增平台、未真实发布。
- 验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（36 个文件，176 个测试）；`pnpm build` PASS。
- 下一步：补充 DeepSeek 账户余额后运行 `pnpm exec electron scripts/v0934-production-sample-recovery.cjs`；成功后在文章库保持 `Production` 筛选，检查 12 篇的品牌、事实快照、城市/业务聚焦和平台风格，再决定是否进入人工查看。

## V0.9.3.3 Brand Content Intent Calibration · 2026-08-21

- 当前阶段：`Brand Content Intent Calibration` 已完成代码、质量门禁、来源追溯、旧文章归档和本地测试；真实 12 篇 DeepSeek Production 样例因 Provider HTTP 402 未完成，不把失败任务或 Mock 结果记为 Production。`Human Review` 不推进，继续保持 `WAITING_FOR_HUMAN_REVIEW`。
- 六篇旧 Content Studio 文章仍偏“全攻略/全解析/指南/要点”的原因：V0.9.3.1 已注入相关企业事实并持久化快照，但当时没有 `ContentIntent`、`SearchIntent`、用户决策型正文结构和品牌差异化评分；BrandPromotion 只检查品牌名出现，标题和结构仍容易回落到 SEO/教育模板。因此“用了企业事实”不等于“已经形成品牌内容意图”。
- Content Intent：新增并持久化 `ServiceIntroduction`、`SelectionGuide`、`BrandAnswer`、`ProblemSolution`、`ProfessionalInsight`、`LocalService`、`FAQ`、`CaseStyle`、`Educational`、`VideoScript`。默认核心品牌场景由 `BrandPromotion` 进入 `LocalService`/`ServiceIntroduction`，不会统一落到 `Educational`；真实案例为空时不强行生成 `CaseStyle` 证据。
- Search Intent：新增并持久化 `Commercial`、`CommercialInvestigation`、`Informational`、`Navigational`。`哪家好/找谁/公司/服务商` 映射 `Commercial`，`价格/多少钱/费用/报价` 映射 `CommercialInvestigation`，`原理/是什么/为什么/标准` 映射 `Informational`；Prompt 根据 Search Intent 调整问题回答、选择比较或解释结构。
- 品牌差异化：新增确定性 `BrandDifferentiationScore`，保存 `brandMentionCount`、`brandFactUsageCount`、`uniqueBrandFactCount`、service/region/process/qualification/device/case fact flags 和 score。品牌名参与计分但不能单独形成高分；BrandPromotion、BrandAnswer、LocalService、ServiceIntroduction 在无相关事实或 score<35 时标记 `GENERIC_BRAND_CONTENT` warning，这属于内容目标问题，不把合法品牌名判成虚假宣传。
- Prompt 与企业事实：`CONTENT_STUDIO_PROMPT_VERSION=v0.9.3.3-brand-intent-v1`。BrandAnswer/LocalService/ServiceIntroduction 要求按“用户问题 → 选择/背景 → 企业真实能力 → 具体服务事实 → 下一步决策/联系”组织，企业事实参与论证而不是只放在结尾；标题不强制公司名，并禁止连续使用万能模板和无证据排名/绝对化表达。安全 Prompt Diagnostics 仍只输出 brandId、knowledgeEntryCount、factCount、selectedFactTypes、city、keywords、platform、contentGoal、contentIntent、searchIntent、promotionStrength、promptVersion，不输出 Secret/Token/API Key。
- 旧 Production 文章：两篇直接 batch 文章未删除，已按精确标题标记 `NeedsRewrite` 并设置 `status=archived`，因此保留历史但不再进入可用库存/正常排期；文章库提供“重新生成品牌版”和“归档”入口。标题为“南京室内环境科普：了解甲醛治理与病媒生物防制的基本流程”和“无锡室内环境治理科普：甲醛、白蚁与病媒生物防制要点”。
- 当前真实库来源统计：正式来源总数 8（其中可用 6、Archived/NeedsRewrite 2），Benchmark 120；首页 `availableArticles=6`、`productionArticles=6`、`benchmarkArticles=120`，Benchmark 不计入首页。总文章没有删除；12 个 `production_intent_sample` 任务均为 `failed`、`sourceArticleId=0`，原因均为 DeepSeek HTTP 402，未新增 Production 样例。
- 12 篇真实样例计划已固定在 `scripts/v0933-production-sample.mts`，覆盖苏州/木渎/江苏、甲醛治理/定期消杀/白蚁防治/病媒生物防制，以及 BrandPromotion、SEOArticle、GEOArticle、Educational、VideoScript、BrandAnswer/LocalService/SelectionGuide/FAQ 等意图。由于真实 Provider 额度阻塞，本轮没有可诚实列出的 12 个生成标题、事实数或差异化分数；恢复额度后脚本预置 topicPlan，只调用一次每篇内容生成。
- 安全边界：未新增平台，未修改 Adapter、Publisher、Job Queue、Scheduler；未修改 OAuthSessionManager、平台账号连接中心、OAuth Callback、PKCE、safeStorage Credential、Token Refresh 或 Account Connection 状态体系；未重新生成 120 条 Benchmark，未执行真实平台发布、PublishRecord 或人工审核。
- 本轮修改范围：`packages/domain/src/types.ts`、`packages/domain/src/brand-facts.ts`、`packages/domain/src/brand-content-intent.ts`、`packages/domain/src/content-studio.ts`、`packages/domain/src/content-quality.ts`；`packages/db/src/repository.ts`；`apps/desktop/src/main/content-studio.ts`、`apps/desktop/src/main/quality-gate.ts`、`apps/desktop/src/main/ipc.ts`、`apps/desktop/src/main/preload.ts`；`apps/desktop/src/shared/api.ts`、`apps/desktop/src/renderer/AIContentStudio.tsx`、`apps/desktop/src/renderer/App.tsx`；`tests/v0931-brand-grounded-content.test.ts`、`tests/v0933-brand-intent.test.ts`；`scripts/v0933-production-sample.mts/.cjs`、`scripts/v0933-archive-legacy-production.mts/.cjs`、`scripts/v0933-production-audit.mts`。未新增 migration。
- 验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（35 个文件、174 个测试）；`pnpm build` PASS。真实样例执行证据为 12/12 任务 HTTP 402 failed，不是生成成功。
- Human Review：继续 `WAITING_FOR_HUMAN_REVIEW`；V0.9.3.2 OAuth 本地代码闭环和未有真实账号连接的事实保持不变。

## V0.9.3.1 Brand-Grounded Content Generation Validation · 2026-08-21

- 当前阶段：`Brand-Grounded Content Generation Validation` 已完成代码、隔离、真实样例和本地质量复核；`Human Review` 不推进，继续保持 `WAITING_FOR_HUMAN_REVIEW`。
- 前置调查：修复前生产库有 122 篇文章，首页“可用文章”将 120 条 V0.9.2 Benchmark 与 2 条直接 `ai_tasks`/`batch_article` DeepSeek 文章混在一起。120 条属于 `benchmarkRunId=deepseek_real-4a83e49e-cb58-4498-96e3-159d702e1512`、`benchmarkId=V091_BRAND_QUALITY_001`、`promptVersion=v0.9.2-deepseek-quality-benchmark-v1`；2 条直接文章标题为“南京室内环境科普：了解甲醛治理与病媒生物防制的基本流程”和“无锡室内环境治理科普：甲醛、白蚁与病媒生物防制要点”，来自 batch `5294f014-e05c-4ec8-854f-b7d6b39009a5`。用户看到的“江苏办公场所定期消杀怎么管理？从三个维度看清本质”属于上述 120 条 Benchmark，不是新的 Production Content Studio 文章。
- 根因：文章库与首页没有按来源分类；旧 Content Studio 任务没有持久化 `knowledgeSnapshot`、`contentGoal`、`promotionStrength`，主题规划只保留行业/城市/关键词/平台，品牌事实没有按业务、城市和关键词筛选；旧 Prompt 只使用浅层品牌字段，未形成可追溯的相关企业事实快照。原始 Benchmark 任务的 `input_json` 没有 `knowledgeSnapshot`、`contentGoal` 或 `promotionStrength`，因此不能证明使用了企业完整知识库。
- 来源隔离：新增 `production`、`content_studio`、`benchmark`、`mock`、`test` 来源分类；文章库默认 `Production`，支持独立筛选；Benchmark 不进入默认生产列表和首页库存指标。真实生产库当前只读统计为：`production=8`、`content_studio=6`、`benchmark=120`、`mock=0`、`test=0`；首页 `availableArticles=8`、独立 `benchmarkArticles=120`，总文章仍为 128，120 条 Benchmark 未删除、未重抽样。
- Prompt 与检索：`CONTENT_STUDIO_PROMPT_VERSION=v0.9.3.1-brand-grounded-v2`；默认 `BrandPromotion + Balanced`，支持 `BrandPromotion`、`SEOArticle`、`GEOArticle`、`Educational`、`FAQ`、`CaseStyle`、`VideoScript` 和 `Soft/Balanced/Strong`。生成前按业务、城市、关键词、主题对品牌事实评分，形成 `Relevant Brand Facts Snapshot`，仅注入相关事实；当前康一样例每篇快照为 5 条，类型为 `company_profile`、目标 `business`、`service_area`、`service_process`，未把其他业务整库塞入正文。安全 Prompt Diagnostics 只记录 brandId、factCount、selectedFactTypes、city、keywords、platform、goal、promotionStrength、promptVersion，不记录 Secret/Token/API Key。
- 真实样例：使用真实品牌“江苏康一环保科技有限公司”，6 个现有 Production Content Studio 任务各 1 篇，Provider/Model 均为 `deepseek/deepseek-v4-flash`，均为 `content_studio` 来源，未创建发布任务、未执行真实发布。首次 6 篇真实 DeepSeek 生成完成；后续修复调用遇到 DeepSeek HTTP 402，未把失败调用记为成功，随后只对这 6 个已有版本做本地安全措辞、标签和关键词复核，没有新增第 7 篇。
- 六篇最终验收结果：6/6 出现目标品牌（公司名与品牌名两个别名均可追溯，`brandMentionCount=2`），6/6 城市、业务、关键词命中，6/6 `unrelatedBusinessMentions=[]`，6/6 `brandFactUsageCount=5`，6/6 Quality Gate 当前为 `AI_Checked`，无 error/warning。标题分别为：`苏州甲醛治理全解析：从检测到治理的专业流程指南`、`木渎定期消杀：木渎企业夏季病媒生物防制要点：定期消杀不可忽视`、`木渎白蚁防治全攻略：家庭防蚁必知的5个关键点`、`江苏病媒生物防制：从家庭到公共场所的常见问题与应对指南`、`苏州甲醛治理全攻略：从检测到治理的完整流程`、`木渎消杀：木渎家庭消杀避坑指南：从需求到验收的完整流程`。
- 质量门禁：品牌名本身不触发营销风险；`BrandPromotion` 缺少品牌时单独标记 `BRAND_MISSING`；未提供的资质、证书、案例和绝对化承诺仍然阻断。法定名称中的“江苏”不会再被误判为苏州场景冲突。旧 2 条直接 batch 文章仍保留为真实 `production` 内容，未擅自删除；它们不代表本轮 6 篇样例已经通过品牌聚焦验收。
- UI 与追溯：Content Studio 增加“生成上下文”和“将使用哪些企业资料”预览；文章详情展示 Provider、Model、Brand、Goal、City、Platform、Knowledge facts、Prompt version 和事实摘要；首页提示 `正式 8 · Benchmark 120（不计入）`；文章库默认 Production，可切换 Benchmark/Mock/Test。
- 安全边界：未新增平台，未修改 Adapter、Publisher、Job Queue、Scheduler；未修改 OAuthSessionManager、平台账号连接中心、OAuth Callback、PKCE、safeStorage Credential、Token Refresh 或 Account Connection 状态体系；没有真实账号连接证据、真实 PublishRecord、真实平台发布或 `PublishPassed`。
- 本轮修改范围：`packages/domain/src/brand-facts.ts`、`packages/domain/src/content-studio.ts`、`packages/domain/src/content-quality.ts`、`packages/domain/src/types.ts`；`packages/db/src/repository.ts`；`apps/desktop/src/main/content-studio.ts`、`apps/desktop/src/main/quality-gate.ts`、`apps/desktop/src/main/ipc.ts`；`apps/desktop/src/shared/api.ts`、`apps/desktop/src/renderer/AIContentStudio.tsx`、`apps/desktop/src/renderer/App.tsx`；V0.9.3.1 测试、真实样例及本地安全复核脚本。未新增 migration。
- 验证：`pnpm lint` PASS；`pnpm typecheck` PASS；`pnpm test` PASS（34 个文件、168 个测试）；`pnpm build` PASS。定向品牌/质量测试 9/9 PASS。
- 下一步用户动作：先打开“AI Content Studio”查看生成上下文和企业事实，再打开“文章库”，保持 `Production` 筛选查看这 6 篇；如需查看旧基准，显式切换 `Benchmark`，不要把 Benchmark 当作可发布文章。真实发布仍需独立账号授权、人工确认和 PublishRecord 证据。

## V0.9.3.2 Unified Platform Account Connection · 2026-08-21

- 当前阶段：统一平台账号连接运行时已完成本地代码闭环；真实平台授权继续等待用户凭据、平台审核和账号所有者操作。`Human Review` 不推进，仍为 `WAITING_FOR_HUMAN_REVIEW`。
- 旧版不能直接登录的原因：主进程只把 Adapter 的 `beginLogin` 当作提示，缺少统一 OAuth 会话、回调声明/校验、连接记录和安全状态模型；YouTube 甚至没有生成官方 OAuth URL。Adapter `ready` 也曾与账号登录状态混在同一张卡片里。
- 本轮新增：`OAuthSessionManager`、统一 callback 输入解析、state/PKCE 继续只在主进程处理、系统浏览器 `shell.openExternal`、OAuth 连接日志、refresh 失败到 `NeedsReauth`、本地断开、账号授权记录和平台 manifest 的 `authStrategy`/`callbackStrategy`。
- OAuth UI/Runtime Ready：抖音、Facebook Pages、YouTube、TikTok、今日头条。它们的 Client ID/Secret、回调地址、审核或账号授权缺失时保持 `WaitingForCredentials`，不会打开无效 URL。
- 已声明 OAuth 但当前仍受平台/Adapter 合同阻塞：哔哩哔哩（Developing）、快手（Blocked）；新浪微博保持 `ManualOnly/Developing`，不伪造 OAuth。微信公众号是 `AppCredential`，不显示虚假 OAuth 连接按钮。
- ManualOnly：视频号、知乎、百家号、搜狐号、一点号、大鱼号、网易号、腾讯微视、搜狐视频、皮皮虾、腾讯视频、多多视频、美拍、AcFun、快传号、雪球号、蜂网/风行号、得物、豆瓣、CSDN、简书、车家号、小红书商家号、易车号、小红书私信版；这些平台只显示接入说明，不执行 Cookie 窃取、验证码/风控绕过或私有 API。
- 账号状态已与 Adapter 状态、授权状态、Publish 验证状态分离；同一平台可保留多个账号，Publish Job 继续绑定 `accountId`。
- 真实证据：本轮没有抖音 Client Key/Secret、Meta App、Google OAuth Client 或账号所有者授权；没有真实 `ACCOUNT_CONNECTED`、真实 `PublishRecord`、真实 Dry Run 或 `PublishPassed`。仅新增了可测试的官方 OAuth URL 打开路径，不记录 `OAUTH_BROWSER_OPEN_SMOKE_PASSED` 为真实环境证据。
- safeStorage：Client Secret、Access Token、Refresh Token 和 Page Token 仍只由主进程安全存储；Renderer 只接收 configured/connected/expiry/profile/scope 摘要，不接收完整 Token。
- 验证：`pnpm lint` PASS，`pnpm typecheck` PASS，`pnpm test` PASS（33 个文件、165 个测试；含新增 OAuth runtime 测试），`pnpm build` PASS。新增 migration：`0013_v0932_oauth_runtime.sql`。
- 下一步用户动作：打开“账号管理 → 平台账号配置中心”，添加对应账号，先保存平台应用凭据，再点击“连接账号”；抖音优先。完成官方登录/授权后，把完整 callback URL（或当前会话允许的 authorization code）粘贴回应用。没有凭据前不要把状态升级为已连接或发布通过。

## V0.9.3 Human Review Calibration · 2026-08-21

- 当前阶段：`WAITING_FOR_HUMAN_REVIEW`。固定人工审核队列和持久化审计已经就绪，但尚未执行真实人工审核，不能声明 `HUMAN_REVIEW_COMPLETED`。
- 固定数据集：`datasetId=V093_HUMAN_REVIEW_001`，沿用 V0.9.2.2 `benchmarkRunId=deepseek_real-4a83e49e-cb58-4498-96e3-159d702e1512`；目标 20 条，状态配额 `Approved=3`、`Needs_Review=7`、`Rejected=10`，覆盖微信公众号、知乎、今日头条、微博、抖音、B站。
- 选择边界：首次建立后固定保存，不随机重采样；保留机器原始状态、风险、证据、规则名、原文位置、建议、原始内容 Hash 和快照。其余 100 条不进入人工队列、不自动批准、不改变原始状态。
- 人工审计：支持每条机器风险的 `TruePositive`、`FalsePositive`、`Uncertain`，以及人工新增 `MissedIssue`；持久化 reviewerType、reviewedAt、originalStatus、finalStatus、reviewDuration、editCount、originalContentHash、finalContentHash 和 issue reason。人工结果不覆盖 `content_quality_states`，编辑只保存校准快照。
- 当前指标：未执行真实人工审核，因此 Precision、Recall、机器状态正确率、审核耗时、编辑次数、最终 Rejected 和 GEN_PROBLEM/QUALITY_GATE_PROBLEM 均不计算。
- Rejected 初步调查：当前自动状态仍为 `Approved=5`、`Needs_Review=41`、`Rejected=74`；`seo_quality=62` 默认多为 warning，`platform_length=9` 受未验证规则/平台配置影响，当前没有证据证明任何单一规则独立造成全部 Rejected；本阶段不改规则。
- 安全边界：没有新增平台，没有修改任何 Adapter、Publisher、Job Queue、Scheduler 或 Adapter Registry；没有重新生成 120 条，没有调用 DeepSeek，没有创建发布任务，没有执行真实平台发布。
- 文档：`docs/V0.9.3_HUMAN_REVIEW_CALIBRATION.md`。下一步由用户在 Quality Gate 页面逐条完成固定 20 条审核；完成后再生成真实 baseline 和校准候选。

## V0.9.2.2 WeChat Structured Output Compatibility · 2026-08-21

- 当前阶段：真实 DeepSeek 基准已完成并持久化，状态为 `COMPLETED`，120/120 Success，0 Failed。
- 凭据状态：正式 Electron 主进程安全读取 DeepSeek，`credentialStatus=Validated`；API Key、Authorization、ciphertext 和明文均未写入仓库、日志、Renderer 或报告。
- 固定 run：沿用 `benchmarkId=V091_BRAND_QUALITY_001`、`datasetVersion=V0.9.2-1.0.0`、`promptVersion=v0.9.2-deepseek-quality-benchmark-v1` 和原 `benchmarkRunId=deepseek_real-4a83e49e-cb58-4498-96e3-159d702e1512`。
- 根因与修复：旧 18 条仅能归类为 `LEGACY_UNCLASSIFIED`；新诊断确认 WeChat 结构化输出兼容问题，首轮 14 条成功（其中 13 条记录确定性归一化、1 条严格校验通过），4 条通过明确 `wechat_official/article` 约束的一次 repair 成功。没有保存原始输出，也没有无限重试或编造事实。
- 重试边界：首轮只重试 18 个旧 Failed，二轮只重试剩余 4 个 Failed；原有 102 个 Success 未重新生成或覆盖。当前 20 个 WeChat item 全部 Success，其他五个平台各 20/20。
- 持久化能力：新增 migration `0011_v0922_wechat_structured_output_diagnostics.sql`、安全诊断字段和逐 attempt 历史；当前唯一内容 120，Quality Gate 状态合计 120，review event 计数 130。
- Quality Gate：`Needs_Review=41`、`Approved=5`、`Rejected=74`、`Draft=0`；新 18 个 WeChat 内容均执行同一 Quality Gate。该自动状态不等于人工审核或真实平台发布通过。
- 当前基准报告：`docs/V0.9.2_DEEPSEEK_QUALITY_BENCHMARK.md`。
- 安全边界：未新增平台，未修改既有 Adapter、`packages/publisher`、Publisher、Job Queue、Scheduler 或 Registry；未执行真实平台发布，已记录 `DEEPSEEK_BENCHMARK_GENERATION_COMPLETED`。
- 下一步：进入 20 条代表性内容的真实人工审核与 owner gate；任何平台发布仍须独立账号授权、人工确认和真实 PublishRecord 证据。

## V0.9.1 真实品牌内容质量验收 · 2026-08-21

- 已完成真实企业资料验收数据集：通过品牌中心数据接口在临时数据库建立江苏康一环保科技有限公司资料，覆盖甲醛治理、定期消杀、灭四害、白蚁防治、病媒生物防制，以及江苏、苏州、木渎。
- 已复用 AI Content Studio 生成 20 个主题、120 个平台 Variant，覆盖微信公众号、知乎、今日头条、新浪微博、抖音脚本、B站脚本；本轮仅做本地内容生产与审核，未执行真实平台发布。
- 新增 `PlatformContentRules` 与 migration `0008_v091_content_quality_acceptance.sql`；当前六个平台规则均标记 `unverified`，使用保守 fallback，未凭空填写官方 source 或 lastVerifiedAt。
- Quality Gate 新增城市一致性、平台摘要/标签限制、中文重复度识别、人工编辑与审核审计；审核详情展示风险、证据、建议和原文位置。
- 已实际跑通 Needs_Review → 人工编辑 → 重新检查 → Approved，以及 AI_Checked → Rejected；只有 Approved 内容可通过发布计划前置门禁。
- 未新增平台，未修改 Adapter、`packages/publisher`、Job Queue、Scheduler、Publisher 核心或 Adapter Registry。
- 验收报告见 `docs/V0.9.1_REAL_BRAND_QUALITY_ACCEPTANCE.md`。

## V0.9 AI Content Quality Gate · 2026-08-20
- 新增独立 AI Quality Gate：品牌事实一致性、资质编造、虚假承诺、绝对化营销词、城市关键词覆盖、平台长度、SEO 和内容重复度八项检查。
- 新增 `content_quality_states` 与 `content_quality_reviews` migration，保存当前状态、内容哈希、检查明细、Provider/Model、触发来源和审核历史。
- 支持生成后自动检查、人工修改后的自动复检、手动重新检查以及 Approved/Rejected 决策；状态为 Draft、AI_Checked、Needs_Review、Approved、Rejected。
- 发布计划和视频任务在创建队列项前强制校验当前内容哈希与 Approved 状态；未批准内容不会进入发布队列。
- 未新增平台，未修改既有 Adapter、`packages/publisher`、Job Queue 或 Adapter Registry。
- 详细说明见 `docs/V0.9_CONTENT_QUALITY.md`。

## V0.8 AI Content Studio（2026-08-20）

- 已新增 AI Content Studio：企业资料输入、城市关键词批量扩展、主题规划和一次生成多平台内容。
- 已支持微信公众号、知乎、头条、微博、抖音脚本、B站视频脚本六种既有平台 key；未新增平台，未修改既有 Adapter、`packages/publisher`、Job Queue 或 Adapter Registry。
- 已接入 DeepSeek Provider、文章库、`article_variants`、视频素材和 Media Assets；视频脚本只保存为内容版本，不自动创建发布任务。
- 已新增 `content_studio_tasks`、`content_studio_versions` 及 migration `0006_v08_content_studio.sql`，支持任务记录、生成历史、重新生成和版本管理。
- 详细说明见 `docs/V0.8_CONTENT_STUDIO.md`。

## Release History / Legacy State

The following snapshot is retained for historical traceability. It is not the current project state; the V1.1.5 section above is the only current-state section.

### Legacy release snapshot

V1.1.2

### Legacy phase snapshot

Account Priority + Lieju Multi-Account + CNBlogs Integration 已完成代码、测试、Installer 与正式安装版 Smoke；列举网软件内真实连接和博客园 PAT 连接仍保持 `WaitingForUser`，未声明任何新增平台 `PublishPassed`

### Legacy objective snapshot

让已连接和可立即连接的平台稳定排在前面；通过独立加密 Browser Session 逐个连接并管理最多 13 个列举网账号；通过博客园官方 PAT API 创建未发布草稿并回查结果。平台目录完整保留 41 个平台，知乎真实连接状态继续保留；外部平台最终确认、External ID、URL 和状态回查仍需账号所有者完成

### Legacy snapshot timestamp

2026-08-22 12:45:00 +08:00（Asia/Shanghai）

### Legacy completed modules

- Electron桌面端：已完成，基于 Electron + React + TypeScript strict。
- AI Provider：已完成，支持 provider/model/生成时间记录。
- DeepSeek：已完成，沿用现有 AI Provider 配置和安全凭据边界。
- 内容生成：已完成，包含文章与平台 Variant。
- 图片生成：已完成，包含图片 Provider/模板封面能力。
- 发布队列：已完成，真实发布经过持久化 Job Queue、Manual Confirmation 和 PublishRecord。
- Scheduler：已完成，保留现有调度、限流、失败暂停和恢复逻辑。
- Adapter系统：已完成，平台能力通过 PlatformAdapter/manifest/capability detection 暴露；优先平台均有独立 Adapter 测试。
- 平台状态：已完成生命周期字段和 41 个外部平台目录；当前新增平台真实 `PublishPassed` 仍为 0。

### Legacy platform status statistics

统计范围：`PLATFORMS.csv` 的 41 个外部平台，不含开发环境 TestPlatform。

总平台数量：41

Stable：0

PublishPassed：0

DryRunPassed：0

CodeComplete：0

Developing：2

WaitingForUser：13

ManualOnly：21

Blocked：2

NotImplemented：3

状态规则：`CodeComplete` 不等于 `DryRunPassed`；`DryRunPassed` 不等于 `PublishPassed`；`PublishPassed` 不等于 `Stable`。本轮没有根据本地测试或 mock 响应虚升状态。

### Legacy platform details

真实发布状态均以验收计划和 PublishRecord 为准；当前没有任何平台达到 `DryRunPassed` 或 `PublishPassed`。

| 平台名称 | Adapter状态 | 认证状态 | 真实发布状态 | 阻塞原因 | 下一步动作 |
|---|---|---|---|---|---|
| 微信公众号 | ready | 未授权 | 未执行 | 本轮核验未发现真实公众号账号；生产安全凭据仅配置 AI Key，缺少 AppID/AppSecret、草稿权限和账号所有者确认 | 由账号所有者提供真实账号并配置 AppID/AppSecret，确认权限后再做真实 Dry Run |
| Facebook Pages | ready | 未授权 | 未执行 | 本轮核验未发现真实 Facebook 账号；生产安全凭据没有 Meta App、OAuth 回调、Page ID 或 Page token，未完成 Page 权限授权 | 账号所有者提供 Meta App/真实账号，完成 OAuth、Page 权限和登录检测后再做真实 Dry Run |
| 新浪微博 | degraded | 未授权 | 未执行 | 官方 CLI 发布/回查 contract 尚未由 owner 审阅注入 | 安装并登录官方 CLI，审阅 contract 后再验收 |
| 抖音 | ready | 未授权 | 未执行 | 需要开放平台审核、OAuth、`video.create` 权限 | 完成应用审核和授权，做视频 Dry Run |
| 哔哩哔哩 | degraded | 未授权 | 未执行 | 需要开发者审核、专栏权限、OAuth 和当前端点合同复核 | 先确认端点合同，再配置 OAuth 和 Dry Run |
| 快手 | degraded | 未授权 | Blocked | 官方当前暂停相关接入 | 等待平台恢复或客服确认，保持 Blocked |
| 视频号 | degraded/manual | 不适用 | ManualOnly | 未确认公开作品发布 API 或 Browser 自动化授权 | 仅官方视频号助手人工投稿 |
| 小红书 | degraded/manual | 不适用 | Blocked | 仅用户触发官方组件，暂无后台静默发布和可靠回查 | 保持 Blocked，等待官方资格/能力变化 |
| 百家号 | degraded/manual | 不适用 | ManualOnly | 未确认公开第三方内容写入 API | 仅官方创作后台人工投稿 |
| 今日头条 | ready | 未授权 | 未执行 | 需要应用审核、视频权限和真实低量发布验证 | 完成优先平台后再进入下一批验收 |
| 知乎 | degraded/manual | 不适用 | ManualOnly | 未确认公开写入 API，禁止未授权页面自动化 | 仅官方页面人工发布 |
| 企鹅号 | degraded/manual | 不适用 | Blocked | 开发者接入和第三方服务申请暂停 | 保持 Blocked，等待资格恢复 |
| 搜狐号 | degraded/manual | 不适用 | ManualOnly | 未确认公开第三方写入与状态回查 API | 仅官方创作中心人工投稿 |
| 一点号 | 未注册 | 不适用 | ManualOnly | 未确认公开第三方内容写入 API | 保持 ManualOnly |
| 大鱼号 | 未注册 | 不适用 | ManualOnly | 未确认公开第三方内容写入 API | 保持 ManualOnly |
| 网易号 | 未注册 | 不适用 | ManualOnly | 未确认公开第三方内容写入 API | 保持 ManualOnly |
| 爱奇艺 | 未注册 | 不适用 | NotImplemented | 尚无 Adapter，需确认当前 endpoint 合同和 Token 资格 | 暂不开发，等待独立输入合同 |
| 腾讯微视 | 未注册 | 不适用 | ManualOnly | 未发现公开第三方发布或回查 API | 保持 ManualOnly |
| 搜狐视频 | 未注册 | 不适用 | ManualOnly | 官方创作中心不是第三方作品写入接口 | 保持 ManualOnly |
| 皮皮虾 | 未注册 | 不适用 | ManualOnly | 未发现公开发布 SDK 或 API | 保持 ManualOnly |
| 腾讯视频 | 未注册 | 不适用 | ManualOnly | 不可复用企鹅号接口冒充腾讯视频写入 API | 保持 ManualOnly |
| 多多视频 | 未注册 | 不适用 | ManualOnly | 开放平台能力不是视频作品发布 | 保持 ManualOnly |
| 美拍 | 未注册 | 不适用 | ManualOnly | 未发现公开发布 API 且社区规则限制机器垃圾内容 | 保持 ManualOnly |
| AcFun | 未注册 | 不适用 | ManualOnly | 未发现公开第三方投稿或回查 API | 保持 ManualOnly |
| 快传号 | 未注册 | 不适用 | ManualOnly | 未发现公开发布 API，AI 内容还需平台规则确认 | 保持 ManualOnly |
| 雪球号 | 未注册 | 不适用 | ManualOnly | 未确认公开写入 API，财经内容风险高 | 保持 ManualOnly |
| 蜂网 | 未注册 | 不适用 | ManualOnly | 未发现公开发布 API | 保持 ManualOnly |
| 得物 | 未注册 | 不适用 | ManualOnly | 商家开放平台不是社区发布 API，条款限制自动化 | 保持 ManualOnly |
| 豆瓣 | 未注册 | 不适用 | ManualOnly | 未确认公开内容写入 API | 保持 ManualOnly |
| CSDN | 未注册 | 不适用 | ManualOnly | 未确认公开第三方内容写入 API | 保持 ManualOnly |
| 简书 | 未注册 | 不适用 | ManualOnly | 未确认公开第三方内容写入 API | 保持 ManualOnly |
| 车家号 | 未注册 | 不适用 | ManualOnly | 无公开内容写 API，条款禁止机器人自动程序 | 保持 ManualOnly |
| 小红书商家号 | 未注册 | 不适用 | ManualOnly | 经营 API 不是社区笔记发布 API | 保持 ManualOnly |
| 易车号 | 未注册 | 不适用 | ManualOnly | 公开 API 为数据读取，无作者内容写入 | 保持 ManualOnly |
| 小红书私信版 | 未注册 | 不适用 | ManualOnly | 客服消息仅用户发起，不支持主动营销 | 保持 ManualOnly |
| TikTok | ready | 未授权 | 未执行 | 需要应用审核、发布权限和公网媒体资产链路 | 后续闭环媒体资产后再验收 |
| YouTube | ready | 未授权 | 未执行 | 需要 Desktop OAuth、配额和真实账号非公开测试 | 后续闭环 OAuth 后再验收 |
| Instagram Professional | 未注册 | 不适用 | NotImplemented | 需要独立 Adapter 和公网媒体资产模型 | 暂不复用 Facebook Adapter |
| 其他账号 | 未注册 | 不适用 | NotImplemented | 扩展占位，不得实现万能 Adapter | 保持 NotImplemented |

### Legacy task snapshot

已完成：V0.9.2.2 DeepSeek 真实内容质量基准与 WeChat 结构化兼容修复。固定 run 120/120 Success；未执行真实平台发布，自动 Quality Gate 结果仍需人工审核和 owner gate。

等待用户：Facebook Pages 首先需要 Meta App、App Review/Advanced Access、真实账号授权、Page ID、OAuth 回调地址、Page 内容权限和 Page access token；在这些条件满足前不得创建真实 Dry Run Job、调用 Feed 发布或升级状态。微信公众号仍需真实账号、AppID、AppSecret、草稿/群发接口权限、账号所有者授权和登录检测；其他优先平台仍需各自的账号授权、Credential 配置、平台审核/权限、登录检测、Dry Run 内容准备和真实发布人工确认。

下一阶段：由用户完成 20 条代表性内容的实际人工审核，确认风险与可发布范围；然后才可在独立账号授权和人工确认下进入平台 Dry Run。Mock/DeepSeek 的可用指标已写入 V0.9.2.2 报告，缺失的旧 Mock issue 明细保持未估算。

### Legacy technical risks

- 架构风险：根目录没有 `.git` 元数据；本轮不执行 `git init`，不改变现有工作区边界。`packages/domain`、`packages/publisher`、Job Queue、Scheduler 和两个平台 Adapter 保持稳定；`packages/db` 仅复用既有 `media_assets.metadata_json`/`video_assets` 增加素材中心所需读写桥接，未新增 migration。
- 平台风险：平台审核、权限、接口合同、发布审核和状态回查可能变化；官方能力存在不等于当前账号可用。
- 权限风险：未获账号所有者明确授权不得真实发布；Credential 只允许主进程安全存储；验证码、安全验证和企业认证必须由用户完成。
- 证据风险：本地单元测试、mock HTTP、Adapter manifest 和 Dry Run 都不能替代真实 `PublishPassed` 证据。

### Legacy completed work

1. 建立项目根目录唯一长期状态入口 `PROJECT_STATE.md`。
2. 新增 `docs/V0.6_VERIFICATION_PLAN.md`，为 39 个外部平台建立真实验收记录栏位。
3. 在 `MANUAL_ACTIONS.md` 增加 V0.6 五个平台优先验收入口和统一人工动作。
4. 核对五个优先平台的 Adapter、认证边界、独立测试和 fail-closed 阻塞条件。
5. 按 `PLATFORMS.csv` 重新计算当前 39 个外部平台生命周期统计，保持所有真实通过状态为 0。
6. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`，全部通过；V0.9.3 后为 32 个测试文件 / 161 项。
7. 2026-08-20 完成微信公众号真实 Dry Run 前置核验：Adapter 已具备 access_token、素材/封面上传和 `draft/add` 草稿链路；本机无真实公众号账号，安全凭据未配置 AppID/AppSecret，未执行网络调用，未创建 PublishRecord，保持 `WaitingForUser`。
8. 2026-08-20 完成 Facebook Pages 真实发布前置核验：已确认 OAuth、Page token、权限预检、Feed、External ID、URL 和状态回查代码边界；本机无真实 Facebook 账号或 Meta 凭据，未执行 OAuth/Graph API/Feed 调用，保持 `WaitingForUser`。
9. 2026-08-20 完成 V0.6.1 平台账号配置中心：账号概览展示平台名称、Adapter/账号/Credential/授权状态、最后验证、最后 Dry Run 和最后发布时间；微信公众号、Facebook、抖音、YouTube 凭据按现有 Adapter schema 动态渲染，Secret 继续仅通过 safeStorage 保存。
10. 新增“测试连接”入口和审计日志；连接测试不写平台生命周期状态，日志上下文只记录账号/平台标识和错误类型，不记录 Token、Secret、Cookie 或 Authorization。
11. 新增微信公众号 V0.7 验收向导：串联账号配置、连接测试、权限/环境检查、文章/封面检查、真实 Dry Run、人工确认、正式发布、状态回查，并展示 PublishRecord、External ID 和 External URL。
12. 新增抖音 V0.7.1 验收向导：串联 Client Key/Secret、官方 OAuth、用户验证、视频素材 Job、Dry Run、人工确认、视频发布、状态回查，并展示 PublishRecord、External ID 和 External URL；未获得真实证据时不升级平台状态。
13. 完成 V0.7.2 视频素材中心：支持视频文件复制入库、文件元数据、封面图片、标题、描述、标签、平台适配 JSON、Adapter 发布前检查，并从现有素材创建视频 Publish Job；新增持久化回归测试，未新增平台或修改微信公众号/抖音 Adapter。

### Legacy verification snapshot

- `pnpm lint`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm test`：PASS，32 个测试文件 / 161 项测试；同时完成 better-sqlite3 host/Electron rebuild。
- `pnpm build`：PASS。

### Legacy next task snapshot

下一次 Codex 启动后先读取本文件，执行 20 条代表性内容的真实人工审核记录与 owner gate；平台规则的 source/lastVerifiedAt 仍需官方文档确认，真实平台发布仍需独立账号授权、人工确认和 PublishRecord，禁止用本次自动 Quality Gate 冒充发布证据。

## 微信公众号本轮 Dry Run 验证日志

- 验证时间：2026-08-20 14:52:30 +08:00（Asia/Shanghai）。
- Adapter 检查：已确认官方 API manifest、`checkLogin`、`/cgi-bin/token`、安全 token 缓存、`material/add_material?type=image` 封面上传、`draft/add` 图文草稿创建，以及 dry-run 分支不会调用 `freepublish/submit`。
- 真实环境检查：开发库和生产库均没有 `wechat_official` 账号；生产安全凭据仅存在 `ai:apiKey`，没有微信公众号 AppID/AppSecret；没有账号授权、草稿/群发权限或真实验证响应。
- 证据结论：本轮真实 Dry Run 未执行、未产生 Job ID/PublishRecord ID/External ID，未写入真实平台证据；生命周期严格保持 `WaitingForUser`，不得填写 `DryRunPassed`。
- 验证日志：`VERIFICATION / WECHAT_DRY_RUN_BLOCKED`，结果为 `BLOCKED`，原因是缺少真实账号、AppID、AppSecret、平台权限和账号所有者确认；该条为本轮核验记录，不冒充真实 Dry Run 成功日志。

## Facebook Pages 本轮真实发布验证日志

- 验证时间：2026-08-20 14:55:33 +08:00（Asia/Shanghai）。
- Adapter 检查：已确认 Facebook Pages 使用 Meta Graph API v26.0，OAuth 请求包含 `pages_manage_posts`、`pages_read_engagement`、`pages_show_list`；OAuth 完成后读取 Page 列表并安全保存 Page token；发布前检查 Page ID 与内容创建任务；Feed 响应保存 post ID，状态回查读取 `permalink_url` 与 `is_published`。
- 真实环境检查：开发库和生产库均没有 `facebook` 账号；生产安全凭据仅存在 `ai:apiKey`，没有 Meta App ID/Secret、OAuth 回调、Page ID 或 Page token；没有账号授权、Advanced Access/App Review 或 Page 权限响应。
- Dry Run 结论：当前 Adapter 的 `dryRun=true` 是零网络本地 validation/code gate，不调用 OAuth、Page 权限检测或 Feed，不能作为真实 `DryRunPassed` 证据；本轮未执行。
- 发布结论：未调用 Feed 发布接口，未产生 Job ID、PublishRecord ID、External ID、External URL 或状态回查结果；生命周期严格保持 `WaitingForUser`，不得填写 `DryRunPassed` 或 `PublishPassed`。
- 验证日志：`VERIFICATION / FACEBOOK_DRY_RUN_BLOCKED`，结果为 `BLOCKED`，原因是缺少 Meta App、真实账号授权、Page 权限和 Page token；该条为本轮核验记录，不冒充真实 Graph API 成功日志。

## V0.6.1 平台账号配置中心记录

- 账号中心为只读概览聚合：平台名称、Adapter 状态、账号状态、Credential 状态、授权状态、最后验证时间、最后 Dry Run 时间、最后发布时间。
- 微信公众号的 AppID/AppSecret、Facebook 的 Meta App ID/OAuth/Page ID、抖音的 Client Key/Client Secret/OAuth、YouTube 的 OAuth 相关字段按现有 Adapter credential schema 展示；没有新增平台，也没有修改现有 Adapter。
- 所有凭据仍由 Electron 主进程通过 `safeStorage` 保存；Renderer 只接收 configured/expired/字段状态，不接收 Secret、Token、Cookie 或 Authorization 值。
- “测试连接”复用账号 `checkLogin`，只更新账号授权/连接检查结果和 `last_login_check_at`，并写入脱敏连接测试日志；它不会改变平台 `verificationStatus` 或生命周期。
- 最后 Dry Run 时间从成功的 `PublishRecord`（`dryRun=true`/`status=DryRun`）派生，最后发布时间来自账号发布记录；没有真实记录时显示“暂无”。

## V0.7 微信公众号首个平台真实发布验收记录

- 验收向导入口：账号中心 → 微信公众号账号 → “进入微信公众号验收向导”。返回账号中心可继续编辑 AppID/AppSecret；Secret 仍只通过主进程 safeStorage 保存。
- 向导步骤：账号配置 → 连接测试 → 权限检查 → 文章检查 → 封面检查 → 真实 Dry Run → 人工确认 → 正式发布 → 状态回查。
- 当前实现只编排既有 `checkLogin`、文章/队列接口、`jobs.run`、`jobs.confirm`、`jobs.reconcile` 和 `PublishRecord` 历史，不新增平台、不修改 Adapter、不修改公共核心。
- 本轮未调用微信公众号真实接口；若缺少真实账号、AppID/AppSecret、草稿/素材/群发权限或账号所有者确认，向导保持阻塞，微信公众号生命周期严格保持 `WaitingForUser`。
- Dry Run 通过条件：必须存在成功的真实 Dry Run `PublishRecord`；正式发布通过条件：必须有正式发布的 External ID、External URL 和最终状态回查。单元测试、本地检查或向导打开均不能升级状态。

## V0.7.1 抖音真实发布验收记录

- 验收向导入口：账号中心 → 抖音账号 → “进入抖音验收向导”。向导只接受该账号已有的 `contentKind=video` 持久化 Job，并展示视频素材绑定状态；不会绕过 Job Queue 隐式创建任务。
- 验收步骤：账号配置 → Client Key/Client Secret 检查 → 官方 OAuth → Access Token 安全存储状态 → `userinfo` 用户验证 → `video.create` 权限门禁 → 视频素材检查 → Adapter Dry Run → 人工确认 → 正式视频上传 → 状态回查。
- 当前实现复用抖音 Adapter 已有的 OAuth、token store、视频校验/上传、状态查询和 Publisher API；没有新增平台，没有修改微信公众号 Adapter，没有修改 `packages/domain`、`packages/publisher`、`packages/db` 或 Adapter Registry。
- 重要证据边界：当前抖音 Adapter 的 `dryRun=true` 在进入 token/file/network 分支前直接完成本地视频参数校验，并返回 `networkCalls: 0`。因此本地 Job `DryRunPassed` 或 Dry Run PublishRecord 不能冒充真实平台 `DryRunPassed`；本轮没有真实账号时平台生命周期继续保持 `WaitingForUser`。
- 正式发布条件：必须先完成当前 Adapter Dry Run 和人工确认，再经持久化 Job Queue 执行视频上传；Adapter 返回的 `publish_id/item_id/video_id` 写入 PublishRecord 的 External ID，`video/query` 回查的分享链接写入 External URL。
- 当前真实环境：未发现可授权的抖音账号、Client Key/Client Secret、`video.create` 权限响应或账号所有者确认；本轮未执行 OAuth、视频上传、真实状态回查，未产生真实 PublishRecord/External ID/External URL，不填写 `DryRunPassed` 或 `PublishPassed`。
- 验证日志：`VERIFICATION / DOUYIN_DRY_RUN_BLOCKED`，结果为 `BLOCKED`；原因是缺少真实账号与授权条件，且现有 Dry Run 为零网络本地校验，不是平台真实 Dry Run 证据。

## V0.7.2 视频素材中心记录

- 素材入口：内容管理 → 素材库。现有素材库入口已替换为视频素材中心，不新增平台。
- 持久化边界：视频文件复制到应用媒体目录并写入现有 `video_assets`；标题、描述、标签、封面路径、封面媒体记录、平台适配字段和素材状态写入同 ID 的 `media_assets.metadata_json`，未新增 migration。
- 支持状态：`Draft`（仅素材）、`Ready`（已创建视频 Publish Job）、`DryRun`（已有成功 Dry Run PublishRecord）、`Published`（已有成功正式 PublishRecord）、`Failed`（正式记录失败或任务失败）。状态由素材、Job 和 PublishRecord 派生，不伪造真实平台状态。
- 发布链路：视频素材 → 现有视频能力平台选择 → 账号与文章选择 → Adapter `validateVideo` 发布前检查 → 现有持久化 Job Queue。创建任务不会直接调用外部平台。
- 平台适配字段以 JSON 保存并随视频素材保留；本轮不修改 Adapter，因此只有 Adapter 已支持的字段会参与真实发布，其余字段作为可审计素材配置保存。
- 当前真实发布状态：未执行真实抖音上传；抖音仍为 `WaitingForUser`。微信公众号未修改，继续为 `WaitingForUser`。
