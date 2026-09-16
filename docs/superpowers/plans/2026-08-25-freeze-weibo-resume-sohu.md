# Freeze Weibo Verified Publish and Resume Sohu Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the already verified Weibo real-publish behavior as a regression contract, then continue only the existing Sohu Job once the owner completes the visible CAPTCHA/security step.

**Architecture:** Do not change the Weibo Adapter or shared publishing behavior. Add a small versioned evidence baseline and a test that protects the exact successful chain: ordinary post body plus one image, one final submission, verified External ID/URL, reachable post body, and Published/Verified persistence. Reuse the existing Sohu visible-browser resume harness and its existing Job/Session/Article/Intent/PublishRecord; a signal is accepted only after the owner confirms the normal security step is complete.

**Tech Stack:** TypeScript, Vitest, existing repository `PublisherService`/SQLite contracts, Playwright inside the application-owned Electron Browser, PowerShell.

**Spec:** The current user request: freeze the verified Weibo chain with regression protection; continue only Sohu Job `6fb37664-4340-4e1a-accd-865987e907df`; allow one real Sohu submission after owner CAPTCHA completion; create no Job; do not change Weibo or touch Bilibili.

## Global Constraints

- Weibo Adapter business code, shared Publisher, Scheduler, BrowserSessionManager, and Bilibili remain unchanged.
- No new Weibo or Sohu Job, Article, Session, Intent, or PublishRecord may be created.
- The Sohu final submit side effect may occur at most once; if it occurs with an uncertain result, stop at `NeedsReconciliation` and never retry.
- CAPTCHA, SMS, QR, and security verification are completed only by the account owner; no bypass or DOM-level workaround is allowed.
- `PublishPassed` requires real External ID, reachable External URL, matching test content, and a verified Published PublishRecord.

---

### Task 1: Add the frozen Weibo evidence contract

**Files:**
- Create: `tests/v127-weibo-real-publish-regression.test.ts`
- Create: `scripts/v127-weibo-real-publish-baseline.json`

**Interfaces:**
- Consumes: the existing verified evidence at `output/v125-weibo-correct-external-evidence.json`.
- Produces: a stable local regression fixture describing the one successful Weibo chain; it does not call Weibo or create a Job.

- [ ] **Step 1: Write the failing test**

  Add a Vitest test that reads `scripts/v127-weibo-real-publish-baseline.json` and asserts: platform `weibo`; browser mode `VISIBLE`; ordinary body-plus-image model; `finalSubmitCount=1`; `clickCount=1`; non-empty External ID and Weibo External URL; `bodyMatch=true`; `urlReachable=true`; Job `Success`; PublishRecord `Published`/`Verified`; and no duplicate submit or duplicate Job.

- [ ] **Step 2: Run the focused test and verify it fails for the missing baseline**

  Run `pnpm exec vitest run tests/v127-weibo-real-publish-regression.test.ts`.

  Expected failure: the baseline file is absent. No application code or platform page is involved.

- [ ] **Step 3: Add the minimal frozen baseline**

  Store only non-secret evidence identifiers and invariants in the JSON baseline, including the existing verified Job/PublishRecord/External ID/URL and evidence source path. Do not store cookies, tokens, storage state, or credentials.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run `pnpm exec vitest run tests/v127-weibo-real-publish-regression.test.ts` and confirm the frozen chain passes without opening a Browser or changing production data.

### Task 2: Resume only the existing Sohu Job

**Files:**
- Reuse: `scripts/v119-sohu-resume-existing.mts`
- Reuse: `scripts/v119-sohu-db-state.mjs`
- Update last: `PROJECT_STATE.md`

**Interfaces:**
- Consumes: existing Run `3e58a669-072f-4373-bff1-d1dcccaa5f17` and Job `6fb37664-4340-4e1a-accd-865987e907df`.
- Produces: one Sohu final-submit attempt at most, followed by `collectPublishResult`/`verifyPublished` evidence or `NeedsReconciliation`.

- [ ] **Step 1: Start the existing visible resume process**

  Launch `pnpm exec tsx scripts/v119-sohu-resume-existing.mts` with the application-owned Electron Browser visible. Confirm the run resolves to the existing Job and reports `NeedsUserAction` with `final_submit_count=0` before any signal is created.

- [ ] **Step 2: Pause for the owner security action**

  Leave the Browser open at the Sohu editor. The owner completes only the normal CAPTCHA/security flow in the visible page. Do not create `output/v119-sohu-resume.signal` before that action is complete.

- [ ] **Step 3: Continue the same Job once**

  After owner confirmation, create the existing harness signal and let it call `platformSelfTest.continue` for the same Run. Do not create a new Job or refill a new Article. Allow the existing one-submit gate to decide whether the final control is safe.

- [ ] **Step 4: Collect and verify the result**

  If submission succeeds, require External ID, reachable External URL, matching Sohu content, and Published PublishRecord. If the submit side effect occurs but evidence is uncertain, keep `NeedsReconciliation` and stop. If the final submit side effect never occurs, keep `NeedsUserAction`/failure.

### Task 3: Run repository verification and update durable state

**Files:**
- Update: `PROJECT_STATE.md`

- [ ] **Step 1: Run the focused and repository checks**

  Run the focused regression test, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` as applicable after the Browser process is not holding the native module lock.

- [ ] **Step 2: Record exact reality**

  Record the frozen Weibo regression contract, the unchanged Bilibili boundary, and the exact Sohu Job/Intent/PublishRecord state, final submit count, External ID/URL, and user/security blocker. Do not upgrade a status without external proof.

## Self-review checklist

- [ ] No Weibo Adapter or Bilibili file was modified.
- [ ] The Weibo regression test fails when its frozen baseline is absent and passes with the checked-in baseline.
- [ ] The Sohu process uses the existing Run/Job/Article/Session/Intent/PublishRecord only.
- [ ] No second Sohu submit is attempted after a claimed side effect or uncertain result.
- [ ] `PROJECT_STATE.md` is updated only after final verification evidence is known.
