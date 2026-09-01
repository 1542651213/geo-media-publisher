# Task10S — Xiaohongshu One-Shot Real Publish Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a typed, account-scoped, operation-scoped one-shot Xiaohongshu real-publish path without executing it in this round.

**Architecture:** Keep Task10R exploration as a separate read-only-final-submit path. Add a persisted authorization record and a single core guard; pass that guard through the existing PublisherService Job/SubmissionIntent/PublishRecord path to the XHS adapter. Add explicit Owner request/confirm/cancel UI and structured observation/reconciliation evidence.

**Tech Stack:** TypeScript strict mode, Vitest/tsx, Electron IPC, Playwright Core, SQLite migration/repository, electron-vite, electron-builder.

**Spec:** `docs/superpowers/specs/2026-09-01-xiaohongshu-task10s-one-shot-real-publish-acceptance-design.md`

## Global Constraints

- `platformKey=xiaohongshu`, `accountId=54b390ac-d81e-440a-baeb-d00f9f346cc3`, `mode=ONE_SHOT_REAL_PUBLISH_ACCEPTANCE`。
- Authorization literal is `OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH`; no global `FINAL_SUBMIT_ALLOWED=true`。
- `MAX_PUBLICATION_TRANSACTIONS=1`、`MAX_FINAL_SUBMIT_ATTEMPTS=1`、`FINAL_SUBMIT_RETRY_COUNT=0`。
- Task10R budgets remain 900000ms / 2 navigation restarts / 3 upload attempts / 12 intermediate clicks / 1 refresh / 3 title mutations / 3 body mutations。
- Final publish click, form submit, requestSubmit, Enter/keyboard submit, synthetic submit dispatch and direct publication network calls are forbidden outside the one-shot guard。
- This round must not deploy, login, explore, upload, fill, publish or operate the active installed runtime。
- Never use `git add .`, `git add -A`, `git clean`, `git reset` or `git restore`。

## File Map

- Create: `packages/domain` one-shot authorization record types。
- Create: `packages/adapters/core/src/one-shot-publication.ts` typed guard, preflight, observation and reconciliation。
- Modify: `packages/adapters/core/src/automation.ts`, `packages/adapters/core/src/index.ts` to expose the typed Task10S contract。
- Create: `packages/db/migrations/0023_v150_one_shot_publication_authorization.sql`。
- Modify: `packages/db/src/schema.ts`, `packages/db/src/repository.ts` for atomic authorization lifecycle。
- Modify: `packages/publisher/src/index.ts` to pass the one-shot guard through the existing persistent queue execution。
- Modify: `packages/adapters/xiaohongshu/src/browser.ts` and `src/index.ts` for Task10S exploration-to-submit, modal confirmation, observation and reconciliation。
- Modify: `apps/desktop/src/main/platform-self-test.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/shared/api.ts`, `src/shared/controlled-self-test-entry.ts`, `src/renderer/PlatformSelfTestCenter.tsx` for Owner confirmation and execution.
- Create: focused core/XHS/desktop contract tests and Task10S static marker tests。
- Create: `scripts/xiaohongshu-task10s-real-publish-acceptance.mts` only if the evidence collector is needed by the final live round; offline implementation must not fabricate live evidence。

### Task 1: Core one-shot contract

**Files:**
- Create: `packages/adapters/core/src/one-shot-publication.ts`
- Modify: `packages/adapters/core/src/automation.ts`
- Modify: `packages/adapters/core/src/index.ts`
- Modify: `packages/domain/src/types.ts`
- Test: `packages/adapters/core/src/one-shot-publication.test.ts`

**Interfaces:**
- Produce `OneShotPublicationAuthorization`, `OneShotFinalSubmitPreflight`, `OneShotPublicationGuard`, `classifyOneShotPostSubmitObservation` and `reconcileOneShotPublication`。
- `OneShotPublicationGuard.startFinalSubmit(preflight, action)` consumes before action; `confirmModal(candidate, action)` allows at most one modal commit inside the same transaction。

- [ ] Write failing tests for exact binding, all preflight gates, consume-before-action, second-submit rejection, no-retry after thrown action, valid confirmation modal and unrelated/ambiguous modal rejection。
- [ ] Run `pnpm exec vitest run packages/adapters/core/src/one-shot-publication.test.ts` and observe expected missing-symbol failures。
- [ ] Implement the minimal typed contract and guard; do not add a global boolean or any UI-specific selector.
- [ ] Run the focused test again and verify all new contract tests pass.

### Task 2: Persist authorization and wire the PublisherService boundary

**Files:**
- Create: `packages/db/migrations/0023_v150_one_shot_publication_authorization.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repository.ts`
- Modify: `packages/publisher/src/index.ts`
- Modify: `packages/adapters/core/src/index.ts`
- Test: `packages/db/src/one-shot-publication.repository.test.ts`, `packages/publisher/src/one-shot-publisher.test.ts`

**Interfaces:**
- Repository produces create/get/atomic-consume/complete/increment-modal-action methods keyed by operation ID。
- `PublisherService.executeJob(jobId, action, browserExecutionMode, oneShotAuthorization?)` passes a `OneShotPublicationGuard` into `BrowserPublishAttemptContext` while retaining the old call signature behavior。

- [ ] Write failing repository and publisher tests for atomic state transitions, duplicate consume rejection, and forwarding only when an explicit authorization is supplied。
- [ ] Run those tests and verify they fail for absent migration/methods。
- [ ] Add migration, repository conversion helpers and guarded publisher context wiring; do not alter generic non-XHS publish behavior。
- [ ] Run focused repository/publisher tests and existing publisher regression tests。

### Task 3: XHS Task10S final-submit adapter path

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.ts`
- Test: `packages/adapters/xiaohongshu/src/one-shot-publication.test.ts`
- Test: `tests/xiaohongshu-task10s-hard-guard-contract.test.ts`

**Interfaces:**
- Add `runOneShotRealPublishAcceptance` to the automation contract and implement it with the existing Task10R exploration and the supplied operation ID/authorization。
- Add XHS `finalSubmit` only as a guard-backed locator click; add bounded post-submit observation and read-only reconciliation。

- [ ] Write failing adapter/contract tests for missing auth, wrong binding, disabled/ambiguous/hit-test-invalid final control, single valid click, confirmation modal max-two-actions, prohibited bypass strings and timeout/no-retry behavior。
- [ ] Run focused adapter/contract tests and verify the new behavior is absent。
- [ ] Implement the adapter path, keeping Task10R exploration finalSubmitCount at zero and preserving all budgets。
- [ ] Run focused XHS and Task10R safety tests.

### Task 4: Owner authorization flow and structured evidence

**Files:**
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/shared/api.ts`
- Modify: `apps/desktop/src/shared/controlled-self-test-entry.ts`
- Modify: `apps/desktop/src/renderer/PlatformSelfTestCenter.tsx`
- Test: `apps/desktop/src/shared/controlled-self-test-entry.test.ts`, `tests/xiaohongshu-task10s-entry-contract.test.ts`

**Interfaces:**
- Add explicit request/confirm/cancel methods for the XHS one-shot mode; only confirm creates `AUTHORIZED_UNUSED` and then the formal queue records。
- Add evidence fields for authorization, preflight, transaction/action counts, observation, reconciliation, external ID/URL and public verification。

- [ ] Write failing UI/request tests for exact owner copy, cancel-without-authorization, XHS-only/account-only gating and no final-submit count before runtime execution。
- [ ] Run focused tests and verify they fail for missing Task10S entry points。
- [ ] Implement the main-process flow using the existing canonical session and Job Queue; never insert fake Published/Verified records。
- [ ] Implement the renderer confirmation copy and safe status display; never expose credentials/tokens/private storage.
- [ ] Run focused desktop contract tests and Task10R/Task10P/Q regressions.

### Task 5: Offline verification and package

**Files:**
- Create: `docs/superpowers/specs/2026-09-01-xiaohongshu-task10s-one-shot-real-publish-acceptance-design.md`
- Create: `docs/superpowers/plans/2026-09-01-xiaohongshu-task10s-one-shot-real-publish-acceptance.md`
- Generated only, not committed: `release-task10s-20260901-r1/`

- [ ] Run focused tests and confirm one-shot safety, Task10R exploration, Task10N/P/Q regressions and no-bypass static checks。
- [ ] Run full tests, typecheck and lint; fix failures with a new failing regression test first。
- [ ] Run build and package to a new Task10S staging directory without touching `release/` or the active installation。
- [ ] Compute the fresh `resources/app.asar` SHA256 and inspect packaged markers for Task10S and Task10R。
- [ ] Perform read-only active-runtime precheck and report deployment blocked if the existing runtime still owns the profile lock。

### Task 6: Selective commit and final audit

**Files:**
- Modify only the explicitly listed source/test/doc files from Tasks 1–4。

- [ ] Review `git diff` and `git status`; keep generated release/rollback/unrelated files unstaged。
- [ ] Run the final verification commands again before commit。
- [ ] Selectively stage only Task10S source/test/doc files and commit `feat: add one shot xiaohongshu publish acceptance`。
- [ ] Report commit, package hash/path, test/build status, active-runtime deployment block, zero live counters and `READY_FOR_FINAL_SUBMIT = NO`。
