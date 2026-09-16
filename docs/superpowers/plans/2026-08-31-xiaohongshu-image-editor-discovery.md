# Xiaohongshu Image Editor Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete read-only Xiaohongshu image-editor discovery after the live-verified Task10I navigation path, with precise Gate failures, analyzer evidence, zero mutation, and a deployable Task10K package.

**Architecture:** Keep Task10I's dynamic publish-note resolver, canonical Page lifecycle, mutex, and single-click navigation unchanged. Add a separate editor-shell/readiness and control-discovery contract used by the XHS Gate and the existing preparePublish path, with Gate-only structured diagnostics and precise post-route failure mapping.

**Tech Stack:** TypeScript strict mode, Playwright Core `Page`/`Locator`, Vitest, pnpm, Electron/Vite, electron-builder, Task10A JSON-line evidence analyzer.

**Spec:** `docs/superpowers/specs/2026-08-31-xiaohongshu-image-editor-discovery-design.md`

## Global Constraints

- Discovery remains read-only and must never call click, fill, type, keyboard input, setInputFiles, draft save, settings mutation, or final submit.
- The existing canonical authenticated Page and Context are reused; no new Page, Context, cold restore, or second image-post click is introduced.
- `PUBLISH_NAVIGATION_CLICK_COUNT <= 1`, `IMAGE_POST_NAVIGATION_CLICK_COUNT = 0`, and `EDITOR_DISCOVERY_CLICK_COUNT = 0`.
- `preparePublish` may mutate only after its existing discovery gates pass; its mutation behavior remains unchanged.
- Publish settings may return structured `NOT_APPLICABLE` and are not an absolute Gate PASS requirement.
- Final-submit counting uses explicit structured markers only.
- No database schema or production row mutation is permitted.
- Unrelated dirty and untracked files remain untouched and unstaged.

---

### Task 1: Define the editor discovery contract and test fixtures

**Files:**
- Create: `packages/adapters/xiaohongshu/src/image-editor-discovery.ts`
- Create: `packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`
- Modify: `packages/adapters/core/src/automation.ts`

**Interfaces:**
- Consumes: Playwright `Page` and the existing XHS selector policy.
- Produces: typed `ImagePostEditorInspectionResult`, control candidate/status types, readiness sample types, and precise editor discovery failure codes consumed by the adapter and analyzer.

- [ ] **Step 1: Write failing tests for the public result shape and status vocabulary.**

  Add tests asserting that the result can represent `IMAGE_EDITOR_SHELL_READY`, `IMAGE_EDITOR_SHELL_NOT_READY`, `IMAGE_EDITOR_SHELL_TIMEOUT`, unique/missing/ambiguous control statuses, settings `NOT_APPLICABLE`, and precise failure metadata without exposing content values.

- [ ] **Step 2: Run the new contract tests and verify the expected RED failure.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`

  Expected: FAIL because the discovery module and result types do not yet exist.

- [ ] **Step 3: Add the minimal shared types and failure-code unions.**

  Extend the core Gate failure union with `IMAGE_EDITOR_SHELL_TIMEOUT`, `CONTENT_TYPE_NOT_READY`, `TITLE_EDITOR_NOT_FOUND`, `BODY_EDITOR_NOT_FOUND`, `IMAGE_UPLOAD_CONTROL_NOT_FOUND`, `FINAL_SUBMIT_CONTROL_NOT_FOUND`, and `EDITOR_CONTROL_AMBIGUOUS`. Keep the existing navigation failure codes intact.

- [ ] **Step 4: Implement the minimal pure status/result constructors.**

  Define typed result constructors that return safe candidate identities, booleans/statuses, sanitized URL, and `failureStage: "EDITOR_DISCOVERY"` without storing field values or DOM source.

- [ ] **Step 5: Run the contract tests and verify GREEN.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`

  Expected: PASS.

### Task 2: Implement bounded shell readiness and fail-closed control discovery

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/image-editor-discovery.ts`
- Modify: `packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`

**Interfaces:**
- Consumes: `Page`, safe locator wrappers, and existing XHS semantic selector constants.
- Produces: `inspectImagePostEditor(page, metadata)` and shared control discovery primitives used by Gate and preparePublish.

- [ ] **Step 1: Add RED tests for delayed shell readiness and timeout.**

  Use a stateful test Page fixture whose safe route/DOM counts progress from no shell to shell-ready. Assert that delayed controls are discovered only after `IMAGE_EDITOR_SHELL_READY`, while a fixture that never exposes shell signals returns `IMAGE_EDITOR_SHELL_TIMEOUT` within the bounded window.

- [ ] **Step 2: Run the readiness tests and verify RED.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts -t "shell"`

  Expected: FAIL because readiness sampling is not implemented.

- [ ] **Step 3: Implement bounded readiness sampling.**

  Sample route, `document.readyState`, safe element counts, and security/login flags at short probe intervals for no more than approximately three seconds. Stop early when the editor-shell signal is stable; return `IMAGE_EDITOR_SHELL_NOT_READY` for an intermediate sample and `IMAGE_EDITOR_SHELL_TIMEOUT` only after the bounded window.

- [ ] **Step 4: Add RED tests for content type and all control status branches.**

  Cover image-post detection, video rejection, unique title/body/upload/final-submit controls, missing controls, ambiguous controls, hidden controls, disabled controls, settings `NOT_APPLICABLE`, security verification, and login redirect. Assert no click/fill/type/keyboard/upload operation is invoked.

- [ ] **Step 5: Run the control tests and verify RED.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts -t "control|content type|security|login"`

  Expected: FAIL because the discovery branches are not implemented.

- [ ] **Step 6: Implement minimal fail-closed discovery.**

  Discover candidates by stable placeholder/aria/role/data-attribute/contenteditable signals. Return `FOUND_UNIQUE` only for exactly one visible, enabled candidate; return explicit missing, ambiguous, hidden, or disabled statuses without selecting `first()` or `nth()` as a fallback. Treat publish settings as observed `NOT_APPLICABLE` when absent, and stop immediately on login/security signals.

- [ ] **Step 7: Run the focused discovery tests and verify GREEN.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`

  Expected: PASS with zero interaction counters.

### Task 3: Add structured editor diagnostics and integrate the Gate

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`
- Modify: `tests/xiaohongshu-pre-submit-gate-contract.test.ts`

**Interfaces:**
- Consumes: `inspectImagePostEditor` and the existing Task10I navigation result.
- Produces: `IMAGE_EDITOR_*` markers and Gate results with precise editor discovery failure codes.

- [ ] **Step 1: Add RED Gate tests for post-route discovery and precise failure mapping.**

  Assert that an editor route followed by missing title returns `needs_user_action` with `TITLE_EDITOR_NOT_FOUND` and `EDITOR_DISCOVERY`, not `PUBLISH_ENTRY_NOT_FOUND` or the generic `editor_not_found`; assert shell timeout and ambiguous control mappings similarly.

- [ ] **Step 2: Run the Gate tests and verify RED.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts tests/xiaohongshu-pre-submit-gate-contract.test.ts`

  Expected: FAIL because the Gate still performs inline checks and uses the old mapping.

- [ ] **Step 3: Emit the new structured markers.**

  Add `IMAGE_EDITOR_INSPECTION_STARTED`, `IMAGE_EDITOR_READINESS_SAMPLE`, `IMAGE_EDITOR_SHELL_READY`, `IMAGE_EDITOR_CONTENT_TYPE_OBSERVED`, `IMAGE_EDITOR_CONTROLS_DISCOVERED`, `IMAGE_EDITOR_INSPECTION_COMPLETED`, and `IMAGE_EDITOR_INSPECTION_FAILED`, each carrying operation/account/context/page identity and sanitized URL only.

- [ ] **Step 4: Integrate the helper after Task10I navigation.**

  Keep the existing canonical Page and mutex. After `navigateToImagePostEditor(..., "GATE_NAVIGATION")` reaches the editor, call the read-only inspector and return its structured result. Preserve login/security fail-closed behavior and return `ready` only when all required controls and content type pass.

- [ ] **Step 5: Replace only the post-route generic mapping.**

  Keep pre-route navigation codes mapped to navigation statuses. Map post-route inspector failures to `needs_user_action` with the exact failure code/stage/missing signal. Do not alter Task10I resolver, pre-click revalidation, one-click count, or post-state classifier.

- [ ] **Step 6: Run the focused Gate tests and verify GREEN.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts tests/xiaohongshu-pre-submit-gate-contract.test.ts packages/adapters/xiaohongshu/src/publish-note-navigation.test.ts`

  Expected: PASS and no new interaction path.

### Task 4: Share discovery with preparePublish without moving the mutation boundary

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.test.ts`
- Modify: `tests/xiaohongshu-task10i-contract.test.ts`

**Interfaces:**
- Consumes: shared selector/discovery primitives.
- Produces: preparePublish regression guarantees that mutation begins only after discovery success.

- [ ] **Step 1: Add RED tests for preparePublish ordering and unchanged Task10I navigation policy.**

  Assert that preparePublish still uses `PREPARE_PUBLISH`, calls the shared discovery contract before title/body mutation, and does not inherit Gate-only early-return behavior. Assert that Gate still contains no mutation APIs.

- [ ] **Step 2: Run the regression tests and verify RED if the current order violates the contract.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-task10i-contract.test.ts`

  Expected: FAIL only where the current flow lacks the shared discovery assertion or ordering evidence.

- [ ] **Step 3: Integrate the shared discovery primitives.**

  Keep preparePublish's existing article validation, upload, title/body fill, required-field checks, settings inspection, and final-submit discovery. Ensure the shared read-only editor contract runs before mutation and that Gate never calls `selectImagePostContentTypeForPrepare`.

- [ ] **Step 4: Run the preparePublish and Task10I regressions and verify GREEN.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-task10i-contract.test.ts packages/adapters/xiaohongshu/src/publish-note-navigation.test.ts`

  Expected: PASS with navigation click count at most one and editor discovery click count zero.

### Task 5: Extend Task10A analyzer and safety regressions

**Files:**
- Modify: `scripts/v143-xiaohongshu-task10a-evidence.helpers.ts`
- Modify: `packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts`
- Modify: `tests/xiaohongshu-task10i-contract.test.ts`

**Interfaces:**
- Consumes: JSON-line `IMAGE_EDITOR_*` events and explicit final-submit markers.
- Produces: parsed readiness samples, shell result, content type/control evidence, precise editor discovery failures, and final-submit count unaffected by navigation/discovery markers.

- [ ] **Step 1: Add RED analyzer tests.**

  Add fixtures for delayed readiness, shell timeout, control discovery, precise missing/ambiguous failure, `PUBLISH_NOTE_NAVIGATION_CLICK`, `IMAGE_EDITOR_CONTROLS_DISCOVERED`, and `FINAL_SUBMIT_CONTROL_DETECTED`. Assert the first three do not increment `finalSubmitCount`, while `FINAL_SUBMIT_CLICKED` increments it once.

- [ ] **Step 2: Run analyzer tests and verify RED.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts`

  Expected: FAIL because the summary fields and event extraction are missing.

- [ ] **Step 3: Implement structured analyzer extraction.**

  Add summary fields and marker parsing for all requested editor evidence. Keep final-submit counting as an explicit code/action allowlist; remove any ordinary keyword/sub-string inference from the final-submit path.

- [ ] **Step 4: Run analyzer tests and verify GREEN.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`

  Expected: PASS.

### Task 6: Focused verification and source audit

**Files:**
- Modify only files already listed above unless a focused test requires a new XHS test file.

- [ ] **Step 1: Run focused XHS tests.**

  Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/publish-note-navigation.test.ts packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts tests/xiaohongshu-pre-submit-gate-contract.test.ts tests/xiaohongshu-task10i-contract.test.ts`

  Expected: all focused tests pass, with navigation click count at most one, image-post click count zero, discovery click count zero, content mutation/upload/final-submit counts zero in Gate fixtures, and canonical/mutex/heartbeat regressions passing.

- [ ] **Step 2: Audit the diff.**

  Run: `git diff --stat` and `git diff -- packages/adapters/core packages/adapters/xiaohongshu scripts tests`

  Confirm only Task10K files are changed and no unrelated dirty/untracked file is staged.

### Task 7: Full verification and package audit

- [ ] **Step 1: Run the full test suite.**

  Run: `pnpm test`

  Expected: exit code 0 with zero failed tests.

- [ ] **Step 2: Run typecheck, lint, and build.**

  Run: `pnpm typecheck`
  Run: `pnpm lint`
  Run: `pnpm build`

  Expected: all commands exit 0.

- [ ] **Step 3: Produce Task10K staging package.**

  Use the repository's existing packaging workflow to create a new uniquely named `release-task10k-20260831` staging directory. Hash `resources/app.asar` and verify it contains every `IMAGE_EDITOR_*` marker plus Task10I markers and analyzer code.

- [ ] **Step 4: Read the production DB before and after package work.**

  Use read-only queries against the existing production DB and record `publish_jobs=15`, `submission_intents=12`, `publish_records=9` before and after. Do not run migrations or write statements.

### Task 8: Selective commit and inactive-profile deployment

- [ ] **Step 1: Confirm Task10K source files and current dirty state.**

  Run: `git status --short` and inspect each Task10K diff. Do not stage unrelated dirty or untracked files.

- [ ] **Step 2: Stage only Task10K paths and inspect the staged diff.**

  Stage each verified Task10K file by explicit path, then run: `git diff --cached`.

  Expected: staged content contains only Task10K implementation, tests, analyzer, and approved design/plan documentation.

- [ ] **Step 3: Commit Task10K.**

  Run: `git commit -m "feat: inspect xiaohongshu image editor gate"`

- [ ] **Step 4: Run deployment precheck.**

  Read-only inspect installed-app processes, XHS profile processes, and profile lock ownership. If any active XHS profile process or lock owner remains, report `BLOCKED_ACTIVE_XHS_PROFILE_SESSION` and stop without killing, closing, or deleting anything.

- [ ] **Step 5: Create a unique rollback only after a PASS precheck.**

  Read and verify the current installed `app.asar` hash, copy it to a new non-overwriting rollback path, and verify rollback hash equals the old installed hash.

- [ ] **Step 6: Deploy and verify the new staging package.**

  Copy only the new app package payload needed for deployment; preserve `publisher.db`, `credentials.enc`, `browser-profiles`, and `production-data`. Verify installed hash equals staging hash.

- [ ] **Step 7: Start the installed app for packaged smoke verification only.**

  Verify responding state, Electron 37.10.3, Native ABI 136, `APP_STARTUP` with `packaged=true`, installed diagnostics markers, and unchanged DB counts. Do not login, launch XHS BrowserSession, call checkLogin, run Gate, run SELF_TEST, or call preparePublish.

### Task 9: Final evidence report and stop

- [ ] **Step 1: Re-read verification outputs and staged/committed diff.**

  Confirm the final report distinguishes focused/full counts, package hash, deployment status, DB equality, and all zero side-effect counters.

- [ ] **Step 2: Stop after reporting.**

  Report `READY_FOR_REAL_SELF_TEST = NO`, `LIVE_PRE_SUBMIT_GATE = NOT_RUN`, `SELF_TEST = NOT_RUN`, and `REAL_PREPARE_PUBLISH = NOT_CALLED`. Do not perform any live operation after deployment.
