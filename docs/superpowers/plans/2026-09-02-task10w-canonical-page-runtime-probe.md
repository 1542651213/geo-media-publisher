# Task10W Canonical Page Runtime Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed, account-scoped, read-only XHS canonical Page runtime probe and use it as the fail-closed identity proof source for Task10V.

**Architecture:** The XHS Adapter owns the existing canonical Page lookup and performs fixed URL/DOM/identity probes under the account mutex. The Main identity service validates the fixed XHS account and returns the observation through a payload-free IPC/preload method; convergence remains separate and gated by exact stable identity proof.

**Tech Stack:** TypeScript strict mode, Playwright Core Page, Electron IPC/preload, Vitest, pnpm, electron-vite, electron-builder.

**Spec:** `docs/superpowers/specs/2026-09-02-task10w-canonical-page-runtime-probe-design.md`

## Global Constraints

- Reuse the existing canonical authenticated Context/Page; never create a replacement Context/Page.
- Probe only `page.url()` and fixed `page.evaluate(() => location.href)` plus bounded allowlisted public identity signals.
- Compare URL origin and pathname; query/hash differences do not fail consistency.
- Renderer cannot provide or override URL, selector, JavaScript, Context ID, or Page ID.
- Probe does not navigate, click, upload, mutate content/settings, create/consume authorization, or converge authorization.
- Preserve unrelated dirty/untracked files and use selective staging only.

### Task 1: Add failing adapter probe contract tests

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts` only after the tests fail

- [ ] Add a test that invokes the new typed adapter probe on the fixture's existing canonical Page and asserts Playwright URL, DOM href, origin/path consistency, canonical/probed Context/Page IDs, and stable Creator ID candidates.
- [ ] Add a test for query/hash-only differences that expects `PASS`.
- [ ] Add a test for a different origin/path that expects `FAIL` without `goto`, new Page, or click calls.
- [ ] Add a test whose fixed `evaluate` rejects and assert `DOM_LOCATION_EVALUATE_STATUS=FAIL` with an error class instead of fallback success.
- [ ] Add a test that asserts the probe does not inspect arbitrary storage or accept a caller-supplied script/selector.
- [ ] Run `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts -t "canonical runtime probe"` and confirm the new tests fail because the probe API is absent.

### Task 2: Implement the minimal typed XHS adapter probe

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`

- [ ] Define exported result/error types for runtime URL probe status, bounded identity candidates, and canonical/probed identity correlation.
- [ ] Add `inspectCanonicalPageRuntime(ctx)` under `accountOperationMutex.run`; resolve only `activeCanonicalPage(ctx)` and preserve its ownership checks.
- [ ] Read `page.url()` and one fixed `page.evaluate(() => location.href)`; classify thrown errors with a safe error name/class and return structured failure evidence.
- [ ] Normalize URL comparison by origin and pathname only, sanitize public URL output, and preserve query/hash without treating them as mismatch.
- [ ] Add a bounded fixed page-side allowlist probe with a 50-node limit for visible public profile anchors/text/data identifiers; do not dump storage, globals, HTML, headers, or response bodies.
- [ ] Include runtime auth, browser connection, closed state, canonical Context/Page IDs, probed Context/Page IDs, and no-new-Page evidence.
- [ ] Make `readCanonicalCreatorIdentity` delegate to the probe so Task10V and the diagnostic entry point use the same evidence path.
- [ ] Run the adapter probe tests and confirm they pass.

### Task 3: Wire Main identity service and IPC/preload

**Files:**
- Modify: `apps/desktop/src/main/xhs-identity.ts`
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/preload.ts`
- Modify: `apps/desktop/src/shared/api.ts`

- [ ] Add a fixed-account `inspectCanonicalXhsPageRuntime(accountId)` Main method returning the adapter observation; reject other accounts before browser access.
- [ ] Update `verifyCreatorIdentity` to consume the probe result and preserve explicit DOM-evaluate and URL-consistency failure information.
- [ ] Add `platform-self-test:probe-xhs-canonical-page` with a payload containing only the fixed account ID literal; do not accept caller-supplied Page/Context IDs or script data.
- [ ] Expose `platformSelfTest.probeXhsCanonicalPage(accountId)` through preload and the typed shared API.
- [ ] Add Main/IPC contract tests for fixed account validation, read-only routing, and convergence remaining separate.
- [ ] Run focused Main/IPC tests and confirm they pass.

### Task 4: Add Task10V identity and safety regressions

**Files:**
- Modify: `apps/desktop/src/main/xhs-identity.test.ts`
- Modify: `tests/xiaohongshu-task10v-identity.test.ts`
- Create or modify: `tests/xiaohongshu-task10w-runtime-probe.test.ts`

- [ ] Assert exact stable ID match verifies identity and only an explicit later convergence call can converge authorizations.
- [ ] Assert missing ID, nickname-only evidence, URL mismatch, evaluate failure, and Page/Context mismatch fail closed.
- [ ] Assert probe execution never changes upload/title/body/settings/publication/final-submit counters and never creates authorization.
- [ ] Assert existing Task10R exploration, Task10S hard guard, and Task10U reconciliation contracts still pass.
- [ ] Run focused Task10W/Task10V tests and confirm zero failures.

### Task 5: Verify, package, and record the release

**Files:**
- Create: `release-task10w-20260902-r1/` via the existing build/package flow
- Create: `output/xiaohongshu-task10w-canonical-page-runtime-probe.json`

- [ ] Run focused tests, then full tests, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; record exit codes and counts.
- [ ] Run the existing package command without overwriting prior Task10V artifacts; verify the new package contains the probe, fixed-evaluate URL cross-check, identity allowlist, same-Page correlation, and convergence gate markers.
- [ ] Compute the new `app.asar` SHA-256 from the independent staging directory.
- [ ] Persist static verification evidence with source changes, tests, package path/hash, and all zero live mutation counters; do not perform live XHS proof in the offline implementation/package phase.
- [ ] Selectively stage only Task10W source/tests/docs/output/package metadata and create the Task10W commit.
