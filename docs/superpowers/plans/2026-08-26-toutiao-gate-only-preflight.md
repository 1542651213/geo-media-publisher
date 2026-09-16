# Toutiao Gate-Only Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run the new Toutiao account identity and publish-permission preflight, then (only when both pass and no security blocker exists) verify the previously approved article gates without creating a SubmissionIntent or clicking final submit.

**Architecture:** Extend the existing one-shot runner with an explicit gate-only mode that performs no persistence before all gates pass and stops with `READY_FOR_FINAL_SUBMIT=YES`. Reuse `ToutiaoArticleBrowserAdapter` and its existing strict editor/cover/final-control checks; preserve the old Job/Intent/Record and keep the final-submit path out of this mode.

**Tech Stack:** TypeScript, Electron-owned BrowserSession, Playwright DOM evidence, Vitest, SQLite repository snapshots.

**Spec:** Current owner instruction in the task conversation.

## Global Constraints

- Account identity, Login, publish permission, and security checks are fail-closed.
- Do not create a new SubmissionIntent, Job, or PublishRecord before every gate passes.
- Do not click final submit; report `READY_FOR_FINAL_SUBMIT=YES` only after all gates pass.
- Never reuse the old Toutiao Job/Intent/Record or run; preserve Sohu/Baijiahao/Weibo scope.

---

### Task 1: Add the gate-only contract test

**Files:**
- Modify: `scripts/v133-toutiao-new-account-real-publish.mts`
- Test: `packages/adapters/toutiao/src/browser.test.ts`

**Interfaces:**
- Consumes: `ToutiaoArticleBrowserAdapter.inspectAccountPreflight`, `preparePublish`, and `prepareFinalSubmit`.
- Produces: an explicit runner mode that records gate evidence and leaves DB counts unchanged.

- [x] **Step 1: Write the failing test** for the adapter’s existing gate behavior to assert `preparePublish` and `prepareFinalSubmit` never invoke submit, using a fixture with a verified identity and no restriction.
- [x] **Step 2: Run the focused test** with `pnpm exec vitest run packages/adapters/toutiao/src/browser.test.ts` and confirm the new gate-only expectation fails before runner support is added.
- [x] **Step 3: Implement the minimal runner mode** controlled by `TOUTIAO_ACCOUNT_GATE_ONLY=1`; run preflight, check login, prepare article, verify cover/readback/required fields/final control, snapshot DB, and return without creating a Job or Intent.
- [x] **Step 4: Run the focused test again** and confirm all Toutiao adapter tests pass.

### Task 2: Execute the real gate-only preflight

**Files:**
- Modify: `PROJECT_STATE.md`
- Create/update: `output/v135-toutiao-account-gates.json`
- Create/update: `output/v135-toutiao-account-gates.png`

**Interfaces:**
- Consumes: the application-owned visible BrowserSession and the gate-only runner.
- Produces: durable evidence with account identity, permission, all gate results, DB before/after counts, and final submit count `0`.

- [x] **Step 1:** Run `TOUTIAO_ACCOUNT_GATE_ONLY=1 pnpm exec electron scripts/v133-toutiao-new-account-real-publish.mjs`.
- [x] **Step 2:** Identity/security preflight returned `SECURITY_VERIFICATION_REQUIRED`; stopped with no new persistence and no submit.
- [x] **Step 3:** Update the top of `PROJECT_STATE.md` with the actual result and evidence paths, preserving the old Toutiao artifacts and Sohu reconciliation state.

### Task 3: Run repository verification

**Files:**
- None beyond the plan/state/evidence files above.

- [x] **Step 1:** Run `pnpm test`.
- [x] **Step 2:** Run `pnpm typecheck`.
- [x] **Step 3:** Run `pnpm lint`.
- [x] **Step 4:** Run `pnpm build`.
