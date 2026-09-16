# Task10S Prepared Editor Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Main-side, no-publish recovery action that reconstructs the XHS image editor from one existing Prepared Job and its bound Article.

**Architecture:** Keep the existing diagnostic fresh-flow, ARM transition, completion action, upload runner, terminal classifier, closed-shadow resolver, and one-shot transaction unchanged. Add a separate trusted Main orchestration with an explicit persisted-state preflight, a dedicated XHS adapter recovery method that reuses the existing bounded editor exploration internals with trusted Article content, and a read-only closed-shadow stop gate.

**Tech Stack:** TypeScript strict mode, Electron Main, Playwright adapter, SQLite AppRepository, Vitest, pnpm.

**Spec:** `C:/Users/Administrator/.codex/attachments/8667fe70-63c4-45cc-9de4-3d1f79bedd1e/pasted-text.txt`

## Global Constraints

- Recovery is offline-only in this turn; do not deploy, run live recovery, ARM, completion, executeJob, click publish, or create publication transactions.
- Recovery must start from `PlatformSelfTestRun.publishJobId` and `PublishJob.articleId`; never use fixed literals, historical attempts, or a new Article as the trust source.
- Require exactly one existing Job and one Prepared PublishRecord, current account/platform/creator binding, and `AUTHORIZED_UNUSED` authorization.
- Reuse the existing XHS image-entry resolver, upload runner, terminal readiness classifier, Article-bound title/body fill/readback, and closed-shadow diagnostic.
- Recovery must stop with final submit, mouse, authorization, Job, Record, and publication counters at zero.
- Do not modify fresh-flow, ARM, completion behavior, schemas, identity semantics, one-shot state machine, or final submit implementation.

---

### Task 1: Add the recovery contract and RED tests

**Files:**
- Create: `apps/desktop/src/main/task10s-prepared-editor-recovery.ts`
- Create: `tests/task10s-prepared-editor-recovery.test.ts`

**Interfaces:**
- Produce `XHS_TASK10S_PREPARED_EDITOR_RECOVERY_FLAG`, `RUN_XHS_TASK10S_PREPARED_EDITOR_RECOVERY`, trusted-state validation, editor-page guard, and evidence validation helpers.
- The trusted-state helper consumes the exact run/job/record/article/account/authorization snapshot and returns a fail-closed code.
- The evidence helper consumes bounded recovery evidence and returns `PASS` only for one upload, terminal `EDITOR_READY`, strict Article readback, closed-shadow PASS, and zero submit/transaction counters.

- [ ] **Step 1: Write the failing tests**

  Cover missing run/job/record/article/authorization, wrong Prepared status, identity mismatch, duplicate editor, invalid fixture, upload/readiness/readback/closed-shadow failures, duplicate-count preservation, authorization preservation, zero submit counters, and reconstructed PageId acceptance.

- [ ] **Step 2: Run the focused test file and verify RED**

  Run: `pnpm exec vitest run tests/task10s-prepared-editor-recovery.test.ts`

  Expected: FAIL because the recovery contract module and action do not exist yet.

### Task 2: Implement the pure recovery contract

**Files:**
- Modify: `apps/desktop/src/main/task10s-prepared-editor-recovery.ts`

- [ ] **Step 1: Implement the smallest trusted-state validator and evidence gate**
- [ ] **Step 2: Re-run the focused tests and verify GREEN**

  Run: `pnpm exec vitest run tests/task10s-prepared-editor-recovery.test.ts`

### Task 3: Add the dedicated XHS adapter recovery method

**Files:**
- Modify: `packages/adapters/core/src/automation.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`

- [ ] **Step 1: Add an optional `recoverPreparedEditor` capability**
- [ ] **Step 2: Implement the XHS method with an existing `/publish/publish` guard**
- [ ] **Step 3: Reuse the existing bounded editor exploration internals with the supplied trusted Article title/body and safe fixture, one upload, and no submit call**
- [ ] **Step 4: Run XHS adapter tests and the recovery contract tests**

### Task 4: Wire the Main trusted action and fixed flag

**Files:**
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/diagnostic-trigger.ts`
- Modify: `apps/desktop/src/main/main.ts`

- [ ] **Step 1: Add the no-argument recovery action and evidence writer**
- [ ] **Step 2: Read and validate the existing trusted Job/Record/Article/auth state before any browser mutation**
- [ ] **Step 3: Verify current identity and context page inventory, block an existing editor, validate the safe fixture, then call the adapter recovery method**
- [ ] **Step 4: Run the read-only closed-shadow diagnostic after content proof and stop without ARM/completion**
- [ ] **Step 5: Run Main action and dispatch tests**

### Task 5: Verify, audit, package, and commit

**Files:**
- Audit only: all changed files and protected XHS files.

- [ ] **Step 1: Run focused, full tests, typecheck, lint, build, and package**
- [ ] **Step 2: Verify protected files and zero publication side-effect counters**
- [ ] **Step 3: Create `release-task10s-20260913-r44` and record the app.asar SHA256**
- [ ] **Step 4: Commit only the r44 source/tests/docs/release outputs while preserving pre-existing dirty artifacts**
