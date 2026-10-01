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
- [ ] Back up closed normal DB/WAL/SHM/credentials outside source with restricted local access.
- [ ] Inspect installed normal UI accounts/readiness and existing local jobs/records without creating publishing jobs.
- [ ] Record historical implementation and current blockers for each platform.

### Task 2: Weibo normal product route

**Files:** `packages/adapters/weibo/src/browser.ts`, its tests, necessary Main/normal UI gate files, `docs/platforms/` runbook if present.

**Interfaces:** Existing PlatformAdapter + PublisherService prepared/final/reconcile contracts; at most one new local job and final action.

- [ ] Compare historical verified ordinary-post implementation, current route and current remote identity.
- [ ] If needed, write a focused regression test, observe RED, implement the minimal platform fix, observe GREEN.
- [ ] Run focused Adapter/readiness/gate/reconcile tests, typecheck, lint and build before installed acceptance.
- [ ] If credentials/session need Owner interaction, record blocker and continue without creating a job.
- [ ] Otherwise run normal installed article → explicit account → preflight → unique job → strict editor readback → one final submit → management/public readback → restart.
- [ ] Only after PUBLISHED_CONFIRMED enable Weibo ordinary; batch remains OFF; commit verified changes/evidence.

### Task 3: Toutiao normal product route

**Files:** `packages/adapters/toutiao/src/article-publisher.ts`, `browser.ts`, existing tests, necessary Main/UI gate files.

**Interfaces:** Existing BrowserNative article route, durable final boundary and read-only management reconciliation. No captured-request replay fallback.

- [ ] Reverify current Creator/session/identity/editor and historical plain text + cover route.
- [ ] Apply only necessary RED→GREEN selector/readiness/route fixes and run focused gates plus typecheck/lint/build.
- [ ] Record Owner-only blocker or perform the one normal installed UI Product E2E and original-job restart recovery.
- [ ] Enable ordinary only after PUBLISHED_CONFIRMED; batch OFF; commit verified changes/evidence.

### Task 4: Sohu normal product route

**Files:** `packages/adapters/sohu-media/src/browser.ts`, existing Adapter and reconciliation tests, necessary Main/UI gate files.

**Interfaces:** Existing prepare/final/reconcile path; verified current account identity and unique management matching.

- [ ] Reverify current account/session/editor/management page; reuse history without whole-branch copying.
- [ ] Apply only necessary RED→GREEN changes, focused tests and typecheck/lint/build.
- [ ] Record Owner-only blocker or perform one normal installed UI Product E2E and original-job restart recovery.
- [ ] Enable ordinary only after PUBLISHED_CONFIRMED; batch OFF; commit verified changes/evidence.

### Task 5: CNBlogs API normal product route

**Files:** `packages/adapters/cnblogs/src/index.ts`, its tests, account-readiness and necessary Main/UI files.

**Interfaces:** Official endpoint/current credential identity/capability, durable original Job/Intent/Record; no blind re-POST on unknown result.

- [ ] Read current official API contract and verify configured Main SafeStorage credential/account identity without displaying values.
- [ ] Apply necessary RED→GREEN draft/readback/final-claim/status changes; run focused tests and typecheck/lint/build.
- [ ] Missing safely recoverable credential is Owner-only blocker; do not fabricate an account/identity.
- [ ] If ready, perform one installed ordinary API Product E2E, exact post ID/status/public URL verification and original-job restart recovery.
- [ ] Enable ordinary only after PUBLISHED_CONFIRMED; batch OFF; commit verified changes/evidence.

### Task 6: Unified verification and department handoff

**Files:** `apps/desktop/src/shared/product-platform-policy.ts`, policy tests, `ready.md`, `docs/releases/R1.15-D-READY.md`, sanitized `docs/evidence/r115-d/`.

**Interfaces:** Final policy consumes actual platform acceptance; installer identity consumes final runtime source commit, final docs consume verification artifacts.

- [ ] Verify Douyin/Website ON, only new PASS platforms ON, every batch OFF; blocked platforms OFF.
- [ ] `pnpm install --frozen-lockfile`, host native rebuild, full Vitest `--maxWorkers=1`, typecheck, lint, build; report counts and all failures honestly.
- [ ] Fresh whole-branch review under executing-plans; any Important/Critical fix gets RED→GREEN and a green full suite.
- [ ] Secret scan source/task commits/evidence/package; preserve protected local data and previous release identities.
- [ ] Electron native rebuild; build one independent NSIS department release if at least one new platform PASS; otherwise deliver implementation Candidate and blocked status as attachment defines.
- [ ] Install into new directory; normal production-data UI smoke/restart with no further publishing; verify source/package byte parity and gate state.
- [ ] Update durable ready/runbooks/release identity; local commits/tag only; verify clean branch and private-remote blocker.
- [ ] Produce full requested final report and stop; no excluded platform or website work.
