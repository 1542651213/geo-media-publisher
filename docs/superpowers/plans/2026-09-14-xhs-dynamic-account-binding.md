# Dynamic XHS Account Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the historical fixed XHS test-account and creator gates with immutable, account-bound Task10S identity validation while preserving r46 media binding and the existing one-shot/final-mouse safety state machine.

**Architecture:** Reuse the existing `accounts`, `platform_self_test_runs`, `publish_jobs`, `publish_records`, and `platform_account_identity_bindings` tables. Treat `platform_account_id` as the persisted immutable run account key and expose it as `accountId` on the domain run model; resolve every runtime account from that run/job/authorization binding, then validate its enabled, non-archived state, browser session, browser context, and trusted creator identity. Make one-shot authorization and diagnostics accept the resolved account ID while keeping all mutation and final-submit code paths unchanged.

**Tech Stack:** TypeScript strict mode, Vitest, Electron main/preload IPC, Playwright-backed XHS adapter, SQLite migrations/repository, pnpm/electron-vite/electron-builder.

**Spec:** `C:\Users\Administrator\.codex\attachments\ff7e8fe2-a711-4b1e-9143-0ab0eabe0a99\pasted-text.txt`

## Global Constraints

- Offline implementation only: no deploy, live login, live upload, live ARM, live completion, or publish.
- Do not create r48; do not alter the current live runtime or the failed historical Job `9037e0bb-2bc8-41c7-9a78-7f03f920cf67`.
- Do not hardcode account `54b390ac-d81e-440a-baeb-d00f9f346cc3` or creator `960803317` in production runtime gates; historical values may remain in test fixtures.
- Reuse the existing Account and identity-binding schema; no parallel account table and no global historical rebind migration.
- Every new XHS run resolves an enabled, non-archived selected account and keeps the run account binding immutable.
- Creator identity must come from `Account.externalAccountId` or the first trusted Page-scoped verifier result, with exact mismatch fail-closed behavior.
- Session, context, profile, job, record, authorization, editor, and attestation must match the run-bound account.
- Preserve r46 `selected_image_asset_id` behavior and `XHS validateArticle`; do not change one-shot semantics or final mouse dispatch code.
- Follow TDD RED → GREEN, run focused and full offline verification, then build/package `release-task10s-20260914-r47`.

### Task 1: Add dynamic account/creator contract tests (RED)

**Files:**
- Create: `tests/task10s-dynamic-account-binding.test.ts`
- Modify: `apps/desktop/src/main/xhs-identity.test.ts`
- Modify: `packages/adapters/core/src/one-shot-publication.test.ts`

**Interfaces:**
- Tests consume `XhsIdentityService`, `createOwnerAuthorizedOneShotPublication`, `AppRepository.createPlatformSelfTestRun`, and the Task10S service account/run gates.
- Tests establish Account A/B fixtures, creator A/B fixtures, and assert fail-closed cross-account behavior without browser mutation.

- [ ] **Step 1: Write failing tests** for dynamic identity acceptance, archived-account rejection, immutable run binding, cross-account session/creator/editor/authorization rejection, arbitrary account one-shot authorization, and production-source hardcode audit.
- [ ] **Step 2: Run the new focused tests** with `pnpm exec vitest run tests/task10s-dynamic-account-binding.test.ts apps/desktop/src/main/xhs-identity.test.ts packages/adapters/core/src/one-shot-publication.test.ts`; expected failures include the fixed-account error and literal creator/account assertions.
- [ ] **Step 3: Keep existing r46 media and one-shot tests in the RED regression set** so changes cannot weaken image binding or retry prevention.

### Task 2: Remove fixed production identity gates

**Files:**
- Modify: `apps/desktop/src/main/xhs-identity.ts`
- Modify: `apps/desktop/src/main/task10s-attempt3.ts`
- Modify: `apps/desktop/src/shared/controlled-self-test-entry.ts`
- Modify: `packages/adapters/core/src/one-shot-publication.ts`
- Modify: `packages/domain/src/types.ts`

**Interfaces:**
- `XhsIdentityService.requireAccount(accountId: string): Account` validates only repository account existence, XHS platform, enabled state, and non-archived state.
- `createOwnerAuthorizedOneShotPublication(input: { platformKey: string; accountId: string; operationId: string; mode: string }): OneShotPublicationAuthorization` preserves mode/platform/operation validation but accepts any usable selected XHS account.
- `PlatformSelfTestRun.accountId: string` is mapped from the existing persisted `platform_account_id`; no historical rows are rewritten.
- `OneShotFinalSubmitPreflight.accountId` and authorization account IDs are plain strings.

- [ ] **Step 1: Implement the minimal dynamic changes** after Task 1 RED: remove the fixed account check and fixed creator literal from production identity validation, derive expected creator from the binding/account, and make controlled one-shot support depend on XHS platform plus account usability.
- [ ] **Step 2: Replace fixed creator checks in Task10S contracts** with `account.externalAccountId`/identity-binding values and preserve explicit owner approval for first-time binding.
- [ ] **Step 3: Remove the exported production fixed-ID dependency and update historical test fixtures to local constants** so production source contains no fixed test account/creator gate.
- [ ] **Step 4: Run the identity and one-shot focused tests** and confirm they pass while the r46 one-shot boundary tests still pass.

### Task 3: Bind runs and authorization/jobs to the selected account

**Files:**
- Modify: `packages/db/src/repository.ts`
- Modify: `packages/db/src/repository.test.ts` or the closest existing repository test file
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/one-shot-reconciliation.ts`

**Interfaces:**
- `createPlatformSelfTestRun({ platformAccountId, requestedLevel })` resolves only an enabled, non-archived account and persists the selected account key as before; returned `PlatformSelfTestRun.accountId` is immutable.
- `PlatformSelfTestService.account(run): Account` resolves exactly the run-bound account and rejects archived, disabled, wrong-platform, or changed bindings.
- Reconciliation validates `identity.accountId` against the persisted run/authorization account instead of a global constant.

- [ ] **Step 1: Add RED repository/service tests** for Account A and B runs, UI selection changes after run creation, archived new-run rejection, historical failed-run preservation, and cross-account authorization/job reuse.
- [ ] **Step 2: Implement run account mapping and account resolver checks** without changing existing table columns or rewriting old rows.
- [ ] **Step 3: Update one-shot confirmation, prepublish, ARM, recovery, and completion gates** to compare run.accountId, job.accountId, record.accountId, authorization.accountId, and the resolved Account.
- [ ] **Step 4: Run repository and Task10S focused tests** and verify failed historical jobs remain Failed and no new Job/Record/Auth is created by read-only gates.

### Task 4: Preserve session/context/profile isolation through every XHS operation

**Files:**
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/xhs-identity.ts`
- Modify: `packages/publisher/src/index.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/task10s-retained-editor-completion.test.ts`
- Modify: `packages/publisher/src/task10s-retained-editor-execution.test.ts`

**Interfaces:**
- All Task10S runtime contexts are built from the run-bound Account and carry the account ID into the existing adapter context.
- Identity attestations remain bound to `accountId`, `browserSessionIdentity`, `browserContextIdentity`, and trusted creator ID; existing validation behavior remains fail-closed.
- Retained editor recovery and completion accept only Pages/Contexts whose runtime account/session/context match the bound Account; no fallback account selection is added.

- [ ] **Step 1: Add RED tests** for A-run+B-session, A-run+B-creator, A-editor+B-completion, context rebinding, and archived-account fallback.
- [ ] **Step 2: Implement account-derived expected creator and runtime binding checks** at the existing preflight points; keep upload, refill, ARM count, and final mouse code untouched.
- [ ] **Step 3: Run the XHS adapter and publisher focused tests** and confirm r46 selected image asset and `validateArticle` behavior remain unchanged.

### Task 5: Update IPC/preload/renderer account selection

**Files:**
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/preload.ts`
- Modify: `apps/desktop/src/shared/api.ts`
- Modify: `apps/desktop/src/renderer/PlatformSelfTestCenter.tsx`
- Modify: `apps/desktop/src/shared/controlled-self-test-entry.test.ts`

**Interfaces:**
- XHS diagnostic and identity IPC payloads accept a validated `accountId` string and never substitute a fixed account.
- Actions without an explicit account resolve the selected/unique usable XHS account through the existing account center state; ambiguous or unavailable accounts fail closed.
- Renderer buttons and reconciliation actions use each row’s account ID and platform key, preserving the existing one-shot UI guard.

- [ ] **Step 1: Add RED source/IPC tests** proving Account B can invoke identity/diagnostic actions, wrong account IDs are rejected, and no fixed literal is used in production paths.
- [ ] **Step 2: Implement validated dynamic payloads and account-derived logging/evidence.**
- [ ] **Step 3: Run shared/API and desktop focused tests** and confirm no live action is introduced.

### Task 6: Security audit, verification, and r47 package

**Files:**
- Create: `docs/superpowers/plans/2026-09-14-xhs-dynamic-account-binding.md`
- Modify: relevant source/tests/docs from Tasks 1–5 only

**Interfaces:**
- Production audit command scans `apps packages` excluding tests, release, out, and node_modules for fixed account/creator values and gate strings.
- Package output is written to `D:\GEO\releases\release-task10s-20260914-r47`.

- [ ] **Step 1: Run RED regression and record the observed failure.**
- [ ] **Step 2: Run GREEN focused tests, full tests, typecheck, lint, build, and package.**
- [ ] **Step 3: Inspect the packaged app.asar SHA256 and changed-file list; verify `XHS validateArticle`, one-shot state machine, final mouse code, and publication counters are unchanged.**
- [ ] **Step 4: Commit only r47 source/tests/plan changes, leaving pre-existing release/build/log dirt untouched.**
- [ ] **Step 5: Report start HEAD, commit, release path/hash, changed files, dynamic binding/security fields, and offline safety counters, then stop.**
