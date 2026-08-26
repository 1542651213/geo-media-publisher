# Sohu L5 Submit State and DOM Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep an unexecuted Browser final-submit attempt resumable, add redacted Sohu editor DOM discovery, and continue the existing Sohu SELF_TEST Job through at most one verified final submit.

**Architecture:** The persistent submission intent remains the single submission boundary. A platform-specific preflight runs before the atomic final-submit claim; the adapter receives an explicit side-effect marker immediately before the real click, so only a claimed/executed uncertain submit can become `NeedsReconciliation`. Sohu discovery remains inside the Sohu adapter and records only redacted visible-control metadata.

**Tech Stack:** TypeScript strict mode, Vitest, SQLite repository, Playwright Core, Electron-owned visible Browser Session.

**Spec:** User request in the current task plus `AGENTS.md` and the latest `PROJECT_STATE.md`.

## Global Constraints

- Sohu-only runtime scope; do not create another Sohu Job, SELF_TEST, PublishRecord, or test article.
- Do not touch other platform Adapter business implementations.
- Do not click final submit during discovery; keep the existing Job's `final_submit_count=0` until a usable control and all reliable prerequisites are confirmed.
- Never guess Sohu AI declaration, category/domain, cover, or originality fields; unresolved required fields become `NeedsUserAction`.
- Final submit is at most once, preceded by one persisted submission intent; success requires External ID, External URL, reachable URL, exact title match, and the correct PublishRecord.

---

### Task 1: Lock the safe pre-submit state invariant with tests

**Files:**
- Create: `tests/v119-browser-submit-state.test.ts`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/adapters/core/src/index.ts`

**Interfaces:**
- Error codes include `FINAL_SUBMIT_CONTROL_NOT_FOUND` and `REQUIRED_FIELD_MISSING`.
- `BrowserPublishAttemptContext` exposes a callback that the adapter calls immediately before the real final click.
- The test uses a temporary SQLite database and a BrowserAutomation fake adapter that throws before the click.

- [ ] Write tests proving each of `FINAL_SUBMIT_CONTROL_NOT_FOUND`, `REQUIRED_FIELD_MISSING`, and `USER_ACTION_REQUIRED` leaves the Job resumable, the intent prepared, and `finalSubmitCount=0` when the adapter did not mark a submission side effect.
- [ ] Run only the new test and observe the expected failure caused by the current unconditional reconciliation path.

### Task 2: Implement the generic Browser publish state-machine fix

**Files:**
- Modify: `packages/db/src/repository.ts`
- Modify: `packages/publisher/src/index.ts`

**Interfaces:**
- A pre-submit user-action failure resets a `Prepared`/zero-count intent or a claimed/no-side-effect intent to `Prepared`, zero count, and `NeedsUserAction`.
- An error after `markSubmissionSideEffect()` remains `Unknown`/`NeedsReconciliation`.
- An optional adapter preflight runs before `claimFinalSubmitAttempt`.

- [ ] Implement the smallest repository transition that is valid for zero-count prepared intents and one-count claimed intents with no side effect.
- [ ] Run the new tests and confirm all three pre-submit errors stay resumable.
- [ ] Add the post-click regression test and confirm it still enters reconciliation.

### Task 3: Add Sohu-only redacted DOM discovery and preflight

**Files:**
- Modify: `packages/adapters/sohu-media/src/browser.ts`
- Modify: `packages/adapters/sohu-media/src/browser.test.ts`

**Interfaces:**
- Discovery enumerates visible `button`, `[role=button]`, `a`, checkbox, radio, and `select` controls with redacted label/role/disabled/associated-hint metadata.
- Discovery classifies final publish as absent, present-disabled, conditionally present, or nested in modal/drawer/confirmation UI.
- Discovery records required-field evidence for AI declaration, category/domain, cover, and originality only when the live DOM marks them required; it never invents values.
- Sohu preflight returns without clicking and throws `FINAL_SUBMIT_CONTROL_NOT_FOUND`, `REQUIRED_FIELD_MISSING`, or `USER_ACTION_REQUIRED` for unresolved prerequisites.

- [ ] Add fixture tests for redacted control classification and no-click preflight.
- [ ] Run the Sohu adapter tests and inspect the emitted evidence shape for secrets/content leakage.

### Task 4: Resume the existing Sohu SELF_TEST Job and finish only with real evidence

**Files:**
- Modify only if required: `scripts/v119-sohu-resume-existing.mts`
- Create/update runtime evidence under `output/` using the existing Job and article only.

- [ ] Read the live production rows and verify the one current Sohu SELF_TEST Job, intent, article, and saved Session.
- [ ] If the existing row was misclassified by the old bug and proof shows no click, reopen only that same Job/intent to `NeedsUserAction`/prepared zero-count state with an auditable backup; do not create a Job.
- [ ] Resume the saved visible Session, refill no content, and collect redacted DOM discovery without final submit.
- [ ] Ask for user choice only for fields not reliably determined from existing content, enterprise profile, or platform configuration.
- [ ] After the final button is genuinely enabled and prerequisites are complete, execute the same Job once, collect and verify the external result, and persist the PublishRecord.

### Task 5: Full verification and state handoff

**Files:**
- Modify: `PROJECT_STATE.md`

- [ ] Run the Sohu-related tests, `pnpm lint`, `pnpm typecheck`, full `pnpm test`, and `pnpm build`.
- [ ] Run Installer only if a formal new Installer is required; if so, increment the version and preserve all existing installers.
- [ ] Record exact Job/Run/intent/result evidence, DOM classification, final submit count, and any user gate in `PROJECT_STATE.md` without upgrading `PublishPassed` prematurely.

