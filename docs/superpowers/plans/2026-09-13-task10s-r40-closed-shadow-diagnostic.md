# Task10S Closed-Shadow Final-Submit Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a fixed, readonly Main action that reuses the existing closed-shadow XHS publish-surface resolver and writes safe structured evidence without changing publish behavior.

**Architecture:** Add one fixed second-instance action and one Main/adapter diagnostic bridge. The bridge resolves the active canonical XHS Page, validates the authenticated publish-editor route, calls `inspectTask10sClosedShadowPublishSurface(page)`, and serializes only the resolver’s safe result. Existing upload, production publish, closed-shadow resolver behavior, and one-shot click paths remain unchanged.

**Tech Stack:** TypeScript strict mode, Electron Main, Playwright Core, Vitest, existing second-instance diagnostic dispatcher, existing XHS closed-shadow CDP resolver.

**Spec:** Owner-provided r40 Task10S closed-shadow final-submit diagnostic requirements in the current task.

## Global Constraints

- Diagnostic action: `--xhs-task10s-closed-shadow-final-submit-diagnostic`.
- No arguments, caller selectors, text, URL, Page ID, Context ID, script, or CSS/XPath.
- Only execute with a connected BrowserSession, live canonical Page, XHS origin, and `/publish/publish` pathname.
- Reuse `inspectTask10sClosedShadowPublishSurface`; add no duplicate CDP tree traversal.
- Readonly only: no click, mouse dispatch, fill, upload, navigation, refresh, draft save, or publication transaction.
- Do not modify the fresh-flow runner, upload runner, terminal classifier, identity verifier, publish resolver, one-shot state machine, or retained-editor completion behavior.
- Generate and package `release-task10s-20260913-r40`; do not deploy or restart installed r39.

### Task 1: Add the red contract tests

**Files:**
- Create: `tests/task10s-closed-shadow-final-submit-diagnostic.test.ts`
- Test: `apps/desktop/src/main/diagnostic-trigger.ts`
- Test: `apps/desktop/src/main/main.ts`
- Test: `apps/desktop/src/main/xhs-identity.ts`
- Test: `packages/adapters/xiaohongshu/src/browser.ts`

**Interfaces:**
- The tests will require a fixed flag/action pair and an adapter method named `inspectCurrentXiaohongshuClosedShadowFinalSubmit()` returning the existing closed-shadow resolution plus typed runtime metadata.

- [ ] Write tests that require the new flag to parse only with no extra arguments and route through the fixed diagnostic runner.
- [ ] Write a source-contract test requiring Main wiring to call the new service method and requiring that service/adapter wiring references `inspectTask10sClosedShadowPublishSurface`.
- [ ] Write readonly source-contract assertions rejecting `click`, `mousePressed`, `mouseReleased`, `setInputFiles`, `fill`, `goto`, `reload`, and publication mutation in the new diagnostic path.
- [ ] Run the focused test file and confirm RED because the action and bridge do not yet exist.

### Task 2: Add the typed readonly adapter bridge

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Test: `tests/task10s-closed-shadow-final-submit-diagnostic.test.ts`

**Interfaces:**
- Add `inspectCurrentXiaohongshuClosedShadowFinalSubmit(ctx: AccountContext): Promise<...>`.
- The method must use the existing `activeBrowserSession`, `activeCanonicalPage`, browser/context/page ownership checks, XHS origin, and `/publish/publish` route gate.
- On a valid page it calls only `inspectTask10sClosedShadowPublishSurface(canonical.page)` and returns safe resolution fields plus page/session metadata.

- [ ] Add the typed result shape with `inspectionStatus`, `failureCode`, session/context/page metadata, `cdpSessionCreated`, CDP request metadata, host/button counts, safe host/button fields, present/enabled state, and no side-effect counters.
- [ ] Implement fail-closed runtime/page/origin/path checks.
- [ ] Implement the valid branch by delegating directly to `inspectTask10sClosedShadowPublishSurface` without copying resolver logic.
- [ ] Run the focused tests and confirm GREEN.

### Task 3: Wire the fixed Main action and evidence writer

**Files:**
- Modify: `apps/desktop/src/main/diagnostic-trigger.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/main/xhs-identity.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/preload.ts`
- Test: `tests/task10s-closed-shadow-final-submit-diagnostic.test.ts`

**Interfaces:**
- Add fixed action constants and dispatcher routing for `--xhs-task10s-closed-shadow-final-submit-diagnostic`.
- Add a no-argument Main service/adapter call and a redacted evidence file under the existing production evidence directory.

- [ ] Add the flag/action to the existing parser and fixed diagnostic runner.
- [ ] Add the Main handler that invokes the typed XHS service method and writes structured safe evidence.
- [ ] Add the service and IPC/preload declarations only as fixed no-argument calls where the existing project contract requires them.
- [ ] Ensure the evidence writer records `DOM.getDocument` depth/pierce as fixed safe metadata and the resolver result without URLs, cookies, storage, tokens, or raw HTML.
- [ ] Re-run the focused tests and inspect the diff to verify all forbidden mutation paths remain absent.

### Task 4: Regression and packaging verification

**Files:**
- Modify only the files listed above plus the plan document.
- Verify unchanged: `packages/adapters/xiaohongshu/src/task10s-closed-shadow-final-submit.ts`, fresh-flow runner, upload runner, production publish resolver, and one-shot state machine.

- [ ] Run focused tests and record zero failures.
- [ ] Run the full test suite, typecheck, lint, build, and package commands.
- [ ] Verify the packaged `app.asar` hash and create `D:/GEO/releases/release-task10s-20260913-r40` without deployment.
- [ ] Record commit, release path, SHA256, changed files, and unchanged-path proof.
