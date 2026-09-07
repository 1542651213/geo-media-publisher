# Task10S r34 Draft Resume and Final Dispatch Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fixed Task10S retained-editor action resume a server-backed XHS image draft from the current Page and consume the one-shot final-submit authorization only at the durable mousePressed dispatch boundary.

**Architecture:** Keep the r33 closed-shadow resolver and ordinary XHS production selector unchanged. Add a strict editor-scoped image-counter predicate to the Task10S completion gate, and add an explicit one-shot guard state transition that is persisted transactionally with the submission-intent claim immediately before the single CDP mouse dispatch.

**Tech Stack:** TypeScript strict mode, Vitest, Playwright CDP session, SQLite repository transactions, Electron packaging.

**Spec:** `C:/Users/Administrator/.codex/attachments/7a1295c2-b112-4968-bcdb-b029557af9de/pasted-text.txt`

## Global Constraints

- Offline implementation, tests, and package only.
- Do not deploy, restart, reload, navigate, upload, fill live content, submit live content, touch the r32 Attempt5 Page, or authorize Attempt6.
- Preserve Attempt3/4/5 locks and `IMAGE_UPLOAD_ATTEMPT_COUNT = 5`.
- Do not modify the ordinary XHS production final-submit selector.
- Completion action upload call count must remain zero.
- No database schema change is required; only persisted authorization state values and transactional updates change.

---

### Task 1: RED tests for reopened-draft image proof

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/task10s-retained-editor-completion.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/post-upload-reconciliation-diagnostic.test.ts`

**Interfaces:**
- Consume the existing `evaluateTask10sRetainedEditorGate` and post-upload snapshot types.
- Require a valid current-page editor image count such as `1/18`; reject `0/18`, missing, malformed, and non-editor counter evidence.

- [ ] Add a server-backed draft snapshot with a non-blob/non-data image item and `1/18` counter; assert the Task10S gate accepts it.
- [ ] Add zero-image, missing-counter, `0/18`, malformed, and out-of-range counter cases; assert title/body/final submission remain blocked.
- [ ] Run the focused tests and confirm they fail because the current gate does not require a valid counter.

### Task 2: RED tests for durable final dispatch state

**Files:**
- Modify: `packages/adapters/core/src/one-shot-publication.test.ts`
- Modify: `packages/db/src/one-shot-publication.repository.test.ts`
- Modify: `packages/publisher/src/task10s-retained-editor-execution.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/task10s-closed-shadow-final-submit.test.ts`

**Interfaces:**
- Add tests for `AUTHORIZED_UNUSED -> ARMED -> FINAL_MOUSEPRESS_DISPATCH_STARTED`.
- Add a repository transaction test proving authorization lock and submission-intent claim succeed or fail together.
- Add tests proving pre-dispatch failures leave authorization and final attempt unused, while mousePressed or mouseReleased failures enter reconciliation with no retry.

- [ ] Assert preflight arms only in memory and does not call the persistence hook.
- [ ] Assert the dispatch-boundary hook runs once immediately before the first mousePressed.
- [ ] Assert duplicate dispatch is rejected after the durable boundary.
- [ ] Run the focused tests and confirm they fail against the current pre-mousePressed consumption behavior.

### Task 3: Implement current-page draft proof

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/post-upload-reconciliation-diagnostic.ts`
- Modify: `packages/adapters/xiaohongshu/src/task10s-retained-editor-completion.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`

**Interfaces:**
- Add a bounded `parseXiaohongshuImageCounterText(value: string | null)` helper with current >= 1, total >= current, and a bounded total <= 100.
- Add `imageCounterValid` to the Task10S gate input and require it together with current editor-scoped image asset proof.
- Pass the current reconciliation snapshot counter into the gate; do not use historical Attempt5 state or FileList metadata.

- [ ] Extend the diagnostic to keep the safe counter editor-scoped and metadata-only.
- [ ] Require the current counter predicate before any fixed title fill.
- [ ] Keep upload helpers and ordinary production selector behavior unchanged.

### Task 4: Implement durable one-shot dispatch boundary

**Files:**
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/adapters/core/src/one-shot-publication.ts`
- Modify: `packages/adapters/core/src/automation.ts`
- Modify: `packages/adapters/core/src/index.ts`
- Modify: `packages/db/src/repository.ts`
- Modify: `packages/publisher/src/index.ts`
- Modify: `packages/adapters/xiaohongshu/src/task10s-closed-shadow-final-submit.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`

**Interfaces:**
- Add typed states `ARMED`, `FINAL_MOUSEPRESS_DISPATCH_STARTED`, `SUBMIT_RECONCILIATION_REQUIRED`, and `COMPLETED` while retaining legacy states for existing records.
- Add guard methods `prepareFinalSubmit`, `beginFinalMousePress`, `markSubmissionReconciliationRequired`, and `hasFinalMousePressStarted`.
- Add a current-page click option that invokes a callback after fresh node, scroll, and box-model preparation but immediately before the single mousePressed.
- Add one repository transaction that atomically changes the authorization to `FINAL_MOUSEPRESS_DISPATCH_STARTED` and claims the prepared submission intent.

- [ ] Make pre-click validation failures leave authorization and final-submit counters unchanged.
- [ ] Move Task10S retained-editor submission-intent claim into the same dispatch-boundary transaction as authorization locking.
- [ ] Persist reconciliation-required state on mousePressed/mouseReleased/observation uncertainty and never retry.
- [ ] Preserve r33 closed-shadow resolution, fresh node IDs, and ordinary production selector paths.

### Task 5: Full verification and r34 package

**Files:**
- Modify: `docs/superpowers/plans/2026-09-07-task10s-r34-draft-resume.md`
- Create: `D:/GEO/releases/release-task10s-20260907-r34` outside the source worktree.

- [ ] Run focused tests and confirm all new RED cases are green.
- [ ] Run full tests, typecheck, lint, and build.
- [ ] Record start/end HEAD, package path, staging SHA256, and confirm no deploy/restart/live actions.
- [ ] Verify source diff contains no production final-submit selector change and completion upload call count remains zero.

