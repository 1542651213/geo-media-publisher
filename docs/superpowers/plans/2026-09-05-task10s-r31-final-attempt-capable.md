# Task10S r31 Final Attempt-Capable Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare an offline r31 release that can complete the retained Task10S XHS editor with a Task10S-only exact `发布` surface resolver, fixed title/body readback, and the existing one-shot publication transaction, without deployment or Attempt5 execution.

**Architecture:** Keep r30's document-global exact DOM diagnostic unchanged. Add a pure resolver under the XHS adapter that resolves exactly one rendered `发布` node or bounded ancestor using only safe structural signals and reports presence separately from enabled state. Add an internal retained-editor execution mode through the existing PublisherService transaction path; the XHS adapter uses the new resolver only for that mode, while normal `finalSubmit` keeps its existing production selector. Wire a fixed no-argument second-instance action through Main and PlatformSelfTestService; it resolves the current retained runtime internally, fills only fixed Task10S content, revalidates identity/authorization, and delegates the one-shot final click to the existing guard and PublishRecord flow.

**Tech Stack:** TypeScript strict mode, Electron Main process, Playwright Core, Vitest, PublisherService, SQLite-backed one-shot authorization and SubmissionIntent.

**Spec:** User-provided Task10S r31 requirements in the current task.

## Global Constraints

- Do not deploy, restart, navigate, reload, create Page/Context/BrowserSession, or consume Attempt5 in this turn.
- Do not change the general XHS production final-submit selector or its normal resolver.
- The new action accepts no selector, text, URL, Page ID, Context ID, file path, or script.
- The new action must never call `uploadImages`, `setInputFiles`, a file chooser, or any upload retry.
- Fixed title is `自动化发布测试｜请忽略` and fixed body is `这是一条 GEO Media Publisher 小红书自动发布链路测试内容，请忽略。`.
- The only final mutation remains the existing one-shot authorization guard and persistent PublisherService transaction.
- Preserve all existing release artifacts and stage only source, test, and plan files for r31 commits.

---

### Task 1: Add the exact Task10S final-surface resolver contract

**Files:**
- Create: `packages/adapters/xiaohongshu/src/task10s-final-surface.ts`
- Test: `packages/adapters/xiaohongshu/src/task10s-final-surface.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.ts`

**Interfaces:**
- Consumes: `XiaohongshuGlobalExactPublishDomRuntimeDiagnostic` from `global-exact-publish-diagnostic.ts`.
- Produces: `resolveTask10sExactPublishSurface(diagnostic): Task10sFinalSurfaceResolution` with `status`, `present`, `enabled`, `currentState`, `candidate`, and `failureCode` fields.

- [x] **Step 1: Write the failing tests**

Cover these concrete fixtures: one exact visible `SPAN` with a clickable parent `DIV`; one `DIV` with `cursor:pointer` and active pointer events; native `BUTTON`; `[role=button]`; disabled candidate; hidden candidate; zero/multiple exact matches; ancestor depth 6; and two qualifying ancestors. Assert the resolver never accepts ambiguous or out-of-bound candidates and that a disabled unique surface returns `present=true`, `enabled=false`.

- [x] **Step 2: Run the resolver tests and verify the expected red failure**

Run `pnpm exec vitest run packages/adapters/xiaohongshu/src/task10s-final-surface.test.ts`.

Expected result: FAIL because `task10s-final-surface.ts` and `resolveTask10sExactPublishSurface` do not yet exist.

- [x] **Step 3: Implement the minimal resolver**

Implement exact-count and rendered-node gates, inspect only the existing r30 safe node/ancestor metadata, accept one unique candidate with `NATIVE_BUTTON`, `ROLE_BUTTON`, or `TABINDEX_INTERACTIVE`/`CURSOR_POINTER` plus active pointer events, reject disabled candidates only for `enabled`, and return `AMBIGUOUS`, `NOT_FOUND`, `NOT_VISIBLE`, `NO_CLICKABLE_SURFACE`, or `DISABLED` without throwing. Do not add a browser query, click, or production-selector import.

- [x] **Step 4: Run resolver tests and verify green**

Run the same Vitest command and confirm all resolver cases pass.

- [x] **Step 5: Commit the isolated resolver**

Run `git add packages/adapters/xiaohongshu/src/task10s-final-surface.ts packages/adapters/xiaohongshu/src/task10s-final-surface.test.ts packages/adapters/xiaohongshu/src/index.ts` and commit with `feat: add task10s exact final surface resolver`.

### Task 2: Add the fixed retained-editor execution mode to the existing transaction boundary

**Files:**
- Modify: `packages/adapters/core/src/index.ts`
- Modify: `packages/publisher/src/index.ts`
- Test: `packages/publisher/src/task10s-retained-editor-execution.test.ts`

**Interfaces:**
- Consumes: existing `PublisherService.executeJob`, `OneShotPublicationGuard`, `SubmissionIntent`, and `PublishRecord` APIs.
- Produces: `PublisherService.executeTask10sRetainedEditor(jobId, action, browserExecutionMode, authorization)` and an internal `task10sRetainedEditor?: true` field on `BrowserPublishAttemptContext`.

- [x] **Step 1: Write failing transaction-path tests**

Add a test adapter that records its attempt context and exposes `finalSubmit`; assert `executeTask10sRetainedEditor` forwards `task10sRetainedEditor: true`, passes the existing guard, creates no upload call, and still claims exactly one SubmissionIntent final-submit attempt. Add a second test asserting an ordinary `executeJob` call does not set the internal marker.

- [x] **Step 2: Run the focused publisher test and verify red**

Run `pnpm exec vitest run packages/publisher/src/task10s-retained-editor-execution.test.ts`.

Expected result: FAIL because the method and internal context marker are absent.

- [x] **Step 3: Implement the smallest internal mode**

Refactor `executeJob` into a shared private executor with a boolean internal mode, add `executeTask10sRetainedEditor` as the only public Main-side entry, propagate the marker into `BrowserPublishAttemptContext`, and keep the existing job claim, intent claim, guard consumption, result collection, PublishRecord update, and failure reconciliation logic unchanged.

- [x] **Step 4: Run focused publisher tests and verify green**

Run the same command and confirm normal execution and retained-editor execution both pass.

- [x] **Step 5: Commit the transaction-mode change**

Run `git add packages/adapters/core/src/index.ts packages/publisher/src/index.ts packages/publisher/src/task10s-retained-editor-execution.test.ts` and commit with `feat: add retained editor transaction mode`.

### Task 3: Implement XHS retained-editor completion using the Task10S resolver

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.ts`
- Test: `packages/adapters/xiaohongshu/src/task10s-retained-editor-completion.test.ts`

**Interfaces:**
- Consumes: `BrowserPublishAttemptContext.task10sRetainedEditor`, r30 global exact diagnostic wrapper, `inspectPostUploadImageEditor`, existing title/body discovery and readback helpers, and `OneShotPublicationGuard`.
- Produces: XHS `finalSubmit(ctx, article, attempt)` behavior that uses the Task10S resolver only when the internal marker is true; otherwise it uses the existing production final-submit path.

- [x] **Step 1: Write failing adapter tests**

Add tests proving the Task10S path requires post-upload editor proof, runs global exact `发布` with count 1, resolves a non-native exact surface, fills only the fixed title/body values with strict readback, re-resolves `发布` and requires enabled state, uses the existing one-shot guard, never calls upload helpers, and rejects disabled/ambiguous/missing/hidden surfaces. Add a regression assertion that ordinary final-submit calls still use the pre-existing selector path.

- [x] **Step 2: Run the focused adapter tests and verify red**

Run `pnpm exec vitest run packages/adapters/xiaohongshu/src/task10s-retained-editor-completion.test.ts`.

Expected result: FAIL because the Task10S marker branch and specialized final-surface path are absent.

- [x] **Step 3: Implement the bounded Task10S branch**

At the start of the marked path, acquire the same canonical Page/Context and require `/publish/publish`, post-upload editor-ready evidence with at least one editor-scoped image asset, title/body controls, and no explicit upload error. Run the existing r30 global exact diagnostic, resolve it with `resolveTask10sExactPublishSurface`, fill the fixed title/body once and read back exact normalized values, then verify required fields. Run the global diagnostic and resolver again, require `present=true` and `enabled=true`, and construct the existing `OneShotFinalSubmitPreflight` for `OneShotPublicationGuard.startFinalSubmit`. Reuse existing confirmation and post-submit observation/result logic. Keep `performOneShotFinalSubmit` and the normal production selector unchanged for unmarked calls.

- [x] **Step 4: Run focused adapter tests and verify green**

Run the same command and confirm no upload call is possible from the retained-editor branch and all safe resolver gates pass/fail as specified.

- [x] **Step 5: Commit the XHS adapter change**

Run `git add packages/adapters/xiaohongshu/src/browser.ts packages/adapters/xiaohongshu/src/index.ts packages/adapters/xiaohongshu/src/task10s-retained-editor-completion.test.ts` and commit with `feat: add xhs retained editor completion path`.

### Task 4: Add the fixed no-argument Main action and gate orchestration

**Files:**
- Modify: `apps/desktop/src/main/task10s-attempt3.ts`
- Modify: `apps/desktop/src/main/diagnostic-trigger.ts`
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Test: `tests/task10s-retained-editor-action.test.ts`
- Test: `tests/task10s-final-completion-gate.test.ts`

**Interfaces:**
- Consumes: existing fixed second-instance parser/runner, fixed canonical account ID, current authorization operation ID, current L5 PlatformSelfTestRun and Prepared Job, `XhsIdentityService.verifyCreatorIdentity`, and `PublisherService.executeTask10sRetainedEditor`.
- Produces: `--xhs-task10s-complete-retained-editor`, `RUN_XHS_TASK10S_COMPLETE_RETAINED_EDITOR`, and `PlatformSelfTestService.runTask10sCompleteRetainedEditor()` with a typed safe result/evidence writer.

- [x] **Step 1: Write failing action/gate tests**

Cover exact action parsing with no arguments, rejection of extra selector/text/URL/Page/Context/file/script input, dispatch only once, no upload calls, no title/body mutation when upload/editor/global exact/identity/auth gates fail, fixed title/body readback failure ordering, disabled final control blocking, authorization-not-unused blocking, and one-shot second-click impossibility.

- [x] **Step 2: Run the focused action/gate tests and verify red**

Run `pnpm exec vitest run tests/task10s-retained-editor-action.test.ts tests/task10s-final-completion-gate.test.ts`.

Expected result: FAIL because the fixed action, result type, and completion gate are absent.

- [x] **Step 3: Implement fixed action plumbing**

Add the fixed flag/action to the existing Task10S action registry. Extend `createFixedDiagnosticRunner` with a callback and wire Main logging/evidence output. Implement `runTask10sCompleteRetainedEditor` to resolve the fixed account and authorization operation internally, require an existing L5 run and Prepared Job, verify active runtime and retained-page identity, call post-upload/global exact diagnostics through Main-owned services, fresh-verify creator ID `960803317`, and call `executeTask10sRetainedEditor` only after all preconditions pass. Do not create authorization, Page, Context, upload, or new Job/Record. Keep action arguments fixed and reject all caller data.

- [x] **Step 4: Run focused action/gate tests and verify green**

Run the same Vitest command and confirm the action has no upload path and the one-shot gate is fail-closed.

- [x] **Step 5: Commit fixed action plumbing**

Run `git add apps/desktop/src/main/task10s-attempt3.ts apps/desktop/src/main/diagnostic-trigger.ts apps/desktop/src/main/platform-self-test.ts apps/desktop/src/main/main.ts tests/task10s-retained-editor-action.test.ts tests/task10s-final-completion-gate.test.ts` and commit with `feat: add fixed task10s retained editor action`.

### Task 5: Audit static picker behavior, compatibility, and regressions

**Files:**
- Modify only the r31 evidence/test files required by the implementation.
- Test: `tests/task10s-r31-release-contract.test.ts`

**Interfaces:**
- Consumes: the fixed action/parser, source tree, existing r30 global diagnostic, normal XHS final-submit selector source, and package scripts.
- Produces: assertions that r30 global exact diagnostic remains present, general production selector text is unchanged, the fixed action has no upload API calls, `openFilePicker=true` is reported as proven/not proven without changing runtime behavior, and no final click occurs during offline tests.

- [x] **Step 1: Write failing release-contract tests**

Assert r30 action/diagnostic exports remain wired, `XIAOHONGSHU_FINAL_SUBMIT_SELECTOR` and its normal resolver are unchanged, the fixed action is no-argument, and the retained-editor action source contains no upload helper invocation.

- [x] **Step 2: Run the contract tests and verify red**

Run `pnpm exec vitest run tests/task10s-r31-release-contract.test.ts` and confirm the new action contract fails before its implementation is complete.

- [x] **Step 3: Implement only required static evidence fields**

Add bounded `OPEN_FILE_PICKER_QUERY_SOURCE` evidence to the offline action evidence without enabling picker interaction or changing navigation behavior. Keep all DOM diagnostics safe and fixed.

- [x] **Step 4: Run all focused tests and verify green**

Run `pnpm exec vitest run packages/adapters/xiaohongshu/src/task10s-final-surface.test.ts packages/publisher/src/task10s-retained-editor-execution.test.ts packages/adapters/xiaohongshu/src/task10s-retained-editor-completion.test.ts tests/task10s-retained-editor-action.test.ts tests/task10s-final-completion-gate.test.ts tests/task10s-r31-release-contract.test.ts`.

- [x] **Step 5: Commit regression coverage**

Run `git add tests/task10s-r31-release-contract.test.ts` and commit with `test: lock task10s r31 safety contracts`.

### Task 6: Full verification and offline r31 package

**Files:**
- Modify: generated build/package outputs under `release/` only as existing packaging behavior requires; do not stage those user-owned artifacts.
- Create: next unused release directory under `D:\GEO\releases\release-task10s-20260905-r31`.

**Interfaces:**
- Consumes: committed r31 source and tests.
- Produces: verified focused/full test reports, typecheck/lint/build results, `START_HEAD`, `END_HEAD`, staging SHA256, and an uninstalled r31 `win-unpacked` package.

- [x] **Step 1: Run focused tests after the final code is committed**

Run the focused command from Task 5 and confirm zero failures.

- [x] **Step 2: Run the full test suite**

Run `pnpm rebuild better-sqlite3; pnpm exec vitest run` and record the complete pass count.

- [x] **Step 3: Run static checks**

Run `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build`, recording exit code and output summary for each.

- [x] **Step 4: Package offline r31**

Run the existing package command that successfully produced r30 (`pnpm exec electron-builder --win dir --projectDir .` after `pnpm run build`) and copy the resulting `release/win-unpacked` plus its package metadata to the next unused `D:\GEO\releases\release-task10s-20260905-r31` directory. Hash `resources/app.asar` with SHA256 and verify the staging hash is stable.

- [x] **Step 5: Verify no deployment/runtime action occurred**

Run `git status --short`, `git diff -- packages/adapters/xiaohongshu/src/browser.ts`, and inspect release directory timestamps. Confirm no deploy, restart, BrowserSession/Context/Page creation, upload, title/body fill, final click, authorization creation, or Attempt5 execution was performed.

- [x] **Step 6: Commit only plan/source/test changes if needed**

Stage only the plan and r31 source/test files, never generated `release/` artifacts, and commit with `chore: prepare task10s r31 offline release`.

---

## Final report checklist

- [ ] `FINAL_ATTEMPT_CAPABLE_RELEASE_PREPARED = YES` only after all verification commands and package hash are observed.
- [ ] `R30_GLOBAL_EXACT_DIAGNOSTIC_RETAINED = YES`.
- [ ] `TASK10S_SAFE_FINAL_SURFACE_RESOLVER_IMPLEMENTED = YES`.
- [ ] `PRODUCTION_FINAL_SUBMIT_SELECTOR_CHANGED = NO`.
- [ ] `TASK10S_COMPLETE_RETAINED_EDITOR_ACTION_IMPLEMENTED = YES`.
- [ ] `TITLE_FIXED_CONTRACT_IMPLEMENTED = YES` and `BODY_FIXED_CONTRACT_IMPLEMENTED = YES`.
- [ ] `STRICT_TITLE_READBACK = YES` and `STRICT_BODY_READBACK = YES`.
- [ ] `FINAL_IDENTITY_REVALIDATION_REQUIRED = YES`.
- [ ] `FINAL_ONE_SHOT_GUARD_IMPLEMENTED = YES`.
- [ ] `COMPLETE_ACTION_UPLOAD_CALL_COUNT = 0`.
- [ ] `DEPLOY = NO`; `CONTROLLED_UPLOAD_ATTEMPT_5 = NOT_AUTHORIZED`.
- [ ] `IMAGE_UPLOAD_ATTEMPT_COUNT = 4`; `FINAL_SUBMIT_CLICK_COUNT = 0`; authorization remains `AUTHORIZED_UNUSED`; new authorization count remains `0`.
- [ ] `NEXT_BLOCKER = OWNER_DEPLOY_AND_ATTEMPT5_AUTHORIZATION`.
