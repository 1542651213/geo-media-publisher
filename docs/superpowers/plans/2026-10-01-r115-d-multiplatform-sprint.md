# R1.15-D Multi-platform Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute inline, sequentially by platform; one fresh whole-branch review at the end.

**Goal:** Add as many currently verifiable Weibo, Toutiao, Sohu and CNBlogs ordinary publishing routes as possible to the accepted Douyin + Kangyi Website department release, without duplicate publication.

**Architecture:** Reuse existing PlatformAdapters, normal article UI, Main IPC, PublisherService and SQLite Job/SubmissionIntent/PublishRecord. A platform gate opens only after its one installed Product E2E is PUBLISHED_CONFIRMED. Login, credential and unknown-result blockers are isolated to that platform; all batch gates remain OFF.

**Tech Stack:** Electron 37, React 19, TypeScript, Playwright Core, SQLite/better-sqlite3, Electron SafeStorage, pnpm, Vitest, electron-builder NSIS.

**Spec:** Owner attachment `GEO_R1_15_D_MULTI_PLATFORM_FAST_SPRINT_CODEX_TASK.md`, supplied in this conversation on 2026-10-01. The attachment is the execution and publishing authorization; no additional design approval is required by Owner's explicit continuous-execution instruction.

## Global Constraints

- Baseline HEAD and R1.15-C tag: `9b8bf10eae6edd8746cd32e3dd9dc9cd9c7b51e0`; canonical repository is `D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher`.
- Development branch: `release/2026-10-01-r1.15-d-multiplatform-sprint`; never reset to older public origin/main.
- Platform order: Weibo → Toutiao → Sohu → CNBlogs.
- Per platform: MAX_REAL_PUBLISH_COUNT=1, MAX_FINAL_SUBMIT_COUNT=1, MAX_TEST_JOB_COUNT=1.
- After final boundary: read-only reconciliation only; no retry, replacement job/article, Node/API replay or transport fallback.
- Current app-owned session/context/page and remote account identity must match; local logged_in is insufficient.
- Use approved, unposted content matching the account's company; otherwise create true, low-risk content through normal content library.
- Secrets remain encrypted/Main-only; no secret value, cookie, storage state or API key in output, source, SQLite or Git.
- Preserve Douyin ordinary ON, Website ordinary ON, all batch OFF; do not modify excluded platform Adapter business code or Kangyi website/server.
- No automatic public Git push or visibility change. Missing private remote is nontechnical delivery blocker.
- Preserve previous releases, existing production business data, credentials and unknown historical jobs.

## Review Focus

- A duplicate UI click or process restart must not create a second job/final action for the same sprint binding.
- Identity drift between account selection and submit must fail closed before side effects.
- A final response timeout must leave original durable intent recoverable without dispatching again.
- Platform Published success remains independent from formatting/image fidelity warnings.
- The installed package must match the source gates and contain no candidate grants, secrets or business data.

### Task 1: Protect and audit the accepted baseline

**Files:** `ready.md`, `AGENTS.md`, existing platform runbooks, `apps/desktop/src/main/adapter-registry.ts`, platform adapters, Main gate, and normal production-data through installed Main.

**Interfaces:** Produces sanitized per-platform current-state evidence and protected external backup; consumes no remote-write capability.

- [x] Verify status, branch, HEAD, origin/main, R1.15-C tag and fetch origin.
- [x] Create the authorized release branch from accepted R1.15-C HEAD.
- [x] Back up closed normal DB/WAL/SHM/credentials outside source with restricted local access.
- [x] Inspect installed normal UI accounts/readiness and existing local jobs/records without creating publishing jobs.
- [x] Record historical implementation and current blockers for each platform.

### Task 2: Weibo normal product route

**Files:** `packages/adapters/weibo/src/browser.ts`, its tests, necessary Main/normal UI gate files, `docs/platforms/` runbook if present.

**Interfaces:** Existing PlatformAdapter + PublisherService prepared/final/reconcile contracts; at most one new local job and final action.

- [x] Compare historical verified ordinary-post implementation, current route and current remote identity.
- [x] Resolve implementation branch as deferred: current visitor login is an Owner-only blocker; no invented route proof.
- [x] Include existing Adapter/gate/reconcile tests in final full regression; no current live submit allowed.
- [x] Record Owner login blocker and continue without creating a job.
- [x] Resolve live acceptance branch as NOT_RUN_OWNER_LOGIN_BLOCKED, jobs/final/publish=0.
- [x] Keep Weibo ordinary/batch OFF; commit truthful blocked evidence.

### Task 3: Toutiao normal product route

**Files:** `packages/adapters/toutiao/src/article-publisher.ts`, `browser.ts`, existing tests, necessary Main/UI gate files.

**Interfaces:** Existing BrowserNative article route, durable final boundary and read-only management reconciliation. No captured-request replay fallback.

- [x] Reverify current Creator/session/identity/editor and historical plain text + cover route.
- [x] Apply only necessary RED→GREEN selector/readiness/route fixes and run focused gates plus typecheck/lint/build.
- [x] Perform the one normal installed UI Product E2E and original-job restart recovery; count=1, management/public PASS.
- [x] Enable ordinary after PUBLISHED_CONFIRMED; video/batch OFF; commit verified changes/evidence.

### Task 4: Sohu normal product route

**Files:** `packages/adapters/sohu-media/src/browser.ts`, existing Adapter and reconciliation tests, necessary Main/UI gate files.

**Interfaces:** Existing prepare/final/reconcile path; verified current account identity and unique management matching.

- [x] Reverify current account/session: actual public recommendation root requires Owner login; editor/live submit deferred.
- [x] Apply RED→GREEN current Creator classification and background lifecycle fix; focused/full tests and typecheck/lint/build PASS.
- [x] Record Owner-only blocker; live Product E2E NOT_RUN, jobs/final/publish=0.
- [x] Keep Sohu ordinary/batch OFF; current installed checkLogin needs_user_action; commit truthful evidence.

### Task 5: CNBlogs API normal product route

**Files:** `packages/adapters/cnblogs/src/index.ts`, its tests, account-readiness and necessary Main/UI files.

**Interfaces:** Official endpoint/current credential identity/capability, durable original Job/Intent/Record; no blind re-POST on unknown result.

- [x] Read current official API contract; existing Main SafeStorage credential GET corp/info returns401, no values displayed.
- [x] Defer remote draft/update/final changes until valid authentication and safe official contract can be proven; inherited tests included in full regression.
- [x] Record Owner-only valid PAT blocker; no fabricated account identity.
- [x] Resolve live Product E2E as NOT_RUN_OWNER_CREDENTIAL_BLOCKED, draft/job/final/publish=0.
- [x] Keep CNBlogs ordinary/batch OFF; commit truthful evidence and contract limitations.

### Task 6: Unified verification and department handoff

**Files:** `apps/desktop/src/shared/product-platform-policy.ts`, policy tests, `ready.md`, `docs/releases/R1.15-D-READY.md`, sanitized `docs/evidence/r115-d/`.

**Interfaces:** Final policy consumes actual platform acceptance; installer identity consumes final runtime source commit, final docs consume verification artifacts.

- [x] Verify Douyin/Website/Toutiao ON, every batch OFF; blocked platforms OFF.
- [x] Frozen install, host native rebuild, full serial Vitest 188 files/1348 tests, typecheck/lint/build PASS; zero final inherited/new failures.
- [x] Fresh whole-branch review; two Important and one Minor reproduced/fixed RED→GREEN; source approved at 9b723211; final full suite green.
- [x] Preserve protected local data: 65 tables, zero unexpected changes/removals, old credential entries unchanged; previous release hash retained. Final commit secret scan follows documentation.
- [x] Electron ABI136 native rebuild and independent NSIS department Release built, hashed and grant-free package inspection PASS.
- [x] Independent install and two normal UI launches/restart PASS; no new jobs/final clicks; byte parity/gates PASS.
- [x] Durable ready/runbooks and release identity complete; staged source/docs/runtime secret scans PASS. Final local commit/tag and clean checks are recorded in the final report; private remote absent, no public push.
- [x] Prepare the attachment-defined partial READY final report; all runtime gates completed, three Owner-only platform blockers isolated. Stop after final identity checks; no excluded platform or website work.
