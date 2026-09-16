# Xiaohongshu Task 10D Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the XHS side-effect-free editor Gate diagnosable and reproducible offline, add a read-only Task 10A evidence analyzer, and verify that no publish-domain state changes occur.

**Architecture:** Keep all platform selectors and navigation inside the XHS adapter. Harden the existing canonical-page Gate with operation-correlated diagnostics and explicit fail-closed failure mapping; do not relax authenticated-page identity checks. Implement the evidence analyzer as a pure log/readonly-DB parser with deterministic operation correlation, and test it with synthetic sanitized JSONL fixtures.

**Tech Stack:** TypeScript strict mode, Vitest, tsx, Playwright-compatible Page/Locator fixtures, Python stdlib sqlite readonly probe for production checkpoints, Electron/Vite packaging.

**Spec:** User-provided long-task Phase 0–37 requirements in the current task.

## Global Constraints

- Never run Owner login, XHS checkLogin, live Gate, PRE_SUBMIT, SELF_TEST, preparePublish production call, real content mutation, upload, draft save, or final submit.
- Preserve the single canonical XHS Context/Page architecture and authenticated-page fail-closed identity boundary.
- Never kill Chrome, the XHS profile, the installed app, or the Owner browser session.
- Never write production DB, credentials, browser profiles, or unrelated dirty files.
- All new diagnostics correlate `operationId`, `platformKey`, `accountId`; Page lifecycle diagnostics also correlate `contextDebugId` and `pageDebugId` without secrets.
- Keep unrelated dirty/untracked changes unstaged and unmodified.

### Task 1: Baseline and implementation audit

**Files:**
- Read: `packages/adapters/xiaohongshu/src/browser.ts`
- Read: `packages/adapters/browser/src/index.ts`
- Read: `apps/desktop/src/main/ipc.ts`
- Read: `apps/desktop/src/main/adapter-registry.ts`
- Read: `apps/desktop/src/renderer/session-heartbeat.ts`
- Read: `packages/logger/src/index.ts`

- [ ] Record branch, HEAD, dirty/staged/untracked summary, production DB counts, installed process tree, and Chrome processes matching the target XHS profile.
- [ ] Trace `accounts:pre-submit-gate` through preload, renderer heartbeat, adapter mutex, canonical page lookup, editor entry, and result diagnostics.
- [ ] Enumerate early returns/throws before `navigateToImagePostEditor` and list whether each emits enough correlated evidence.
- [ ] Audit authentication evidence sources and confirm no URL-only acceptance.

### Task 2: RED tests for canonical Gate failure coverage

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.test.ts`

- [ ] Add fixtures for canonical Page missing/closed, foreign Context, account A/B isolation, stale runtime state with contradictory Page signal, and authenticated Page with expected positive signal.
- [ ] Add assertions for explicit failure code/stage/missing signal and operation markers for every pre-navigation failure.
- [ ] Add editor-entry state-machine tests for `/publish/publish`, `/new/home`, Creator root, missing/click-failed entries, content-type discovery/selection failures, timeout, route-not-reached, login, security verification, and unknown fallback.
- [ ] Run only the new tests and verify they fail for the intended missing behavior before changing production code.

### Task 3: Minimal XHS Gate hardening

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`

- [ ] Ensure every Gate lifecycle has a stable operation record even when canonical Page lookup returns null or throws an ownership/liveness error; use sanitized diagnostics only.
- [ ] Map closed/disconnected/ownership failures to explicit existing failure codes and stages without treating them as authenticated.
- [ ] Preserve `assertProfilePageCanBeRead`; keep identity signal requirements fail-closed and do not add URL-only fallback.
- [ ] Make editor-entry navigation state-aware and bounded, preserving safe navigation clicks while excluding input/upload/fill/type/submit behavior.
- [ ] Keep `UNKNOWN_UI_STATE` as the final fallback only and emit `EDITOR_NAVIGATION_FAILED` with all structured fields.
- [ ] Verify the RED tests turn GREEN, then run the existing XHS adapter tests.

### Task 4: Diagnostics and lifecycle regression tests

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.test.ts`
- Modify: `packages/adapters/core/src/browser.test.ts` only if a shared lifecycle regression is proven necessary
- Modify: `tests/heartbeat-invocation-wiring.test.ts` only if a wiring gap is proven necessary

- [ ] Verify operation markers and Page lifecycle markers include operation/account/platform correlation, and `contextDebugId`/`pageDebugId` where required.
- [ ] Verify heartbeat pre/post pairing remains read-only and no operationId collision is possible in fixture runs.
- [ ] Verify mutex release after exceptions and canonical Page retention after Gate timeout.
- [ ] Assert no sensitive values appear in diagnostics.

### Task 5: Pure Task 10A evidence analyzer

**Files:**
- Create: `scripts/v143-xiaohongshu-task10a-evidence.helpers.ts`
- Create: `scripts/v143-xiaohongshu-task10a-evidence.mts`
- Create: `scripts/v143-xiaohongshu-task10a-evidence.helpers.test.ts`

- [ ] Define a typed input for `platformKey`, `accountId`, optional `operationId`, optional time window, log path, readonly DB path, and output path.
- [ ] Parse JSONL app logs defensively, filter exact XHS account/platform, correlate a single Gate operation by operationId and temporal lifecycle markers, and return `EVIDENCE_AMBIGUOUS: YES` when uniqueness cannot be established.
- [ ] Extract login/canonical IDs, heartbeat phases, Gate/page/editor diagnostics, entry step sequence, auth/security/login flags, and publish-domain counts.
- [ ] Read production DB through a readonly connection only; never import IPC, launch Browser, navigate Page, call Gate/checkLogin/preparePublish, or create domain rows.
- [ ] Write only the requested runtime output path when invoked; keep generated output ignored/untracked according to existing repository policy.

### Task 6: Analyzer fixture matrix

**Files:**
- Modify: `scripts/v143-xiaohongshu-task10a-evidence.helpers.test.ts`

- [ ] Cover success, authenticated signal missing, entry missing, route not reached, login redirect, security verification, unknown UI state, multiple historical operations, mixed accounts, incomplete operation, stale context/current context, and no Gate.
- [ ] Assert correlation uses the same operationId and does not let old heartbeat/context data contaminate the current result.
- [ ] Assert no IPC/browser side-effect imports are required by the helper.

### Task 7: Verification, artifact, DB, and deployment gate

**Files:**
- Modify: `PROJECT_STATE.md`
- Modify: `docs/superpowers/plans/2026-08-30-xiaohongshu-task10d-hardening.md` only if the implementation diverges from the stated scope

- [ ] Run focused diagnostics/Gate/editor/auth/canonical/mutex/heartbeat/analyzer/IPC/preload tests and record exact counts.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; record exact exit status/counts.
- [ ] Inspect staging `app.asar` for all required diagnostic markers and compute SHA-256.
- [ ] Recheck production DB counts and stop deployment if they differ from the Phase 0 baseline.
- [ ] Review `git diff`, `git diff --cached`, and status; stage only this plan/code/tests/docs/analyzer files, never `git add .` or `git add -A`.
- [ ] Recheck installed PID and target XHS Chrome profile processes. Deploy only if the profile has naturally exited, the app can be gracefully shut down, and rollback/hash checks are safe; otherwise record `BLOCKED_ACTIVE_XHS_PROFILE_SESSION` without force termination.
- [ ] Update `PROJECT_STATE.md` with Task 9C/10B/10C/10D truth, retry readiness, and the mandatory `READY_FOR_REAL_SELF_TEST = NO` state.
