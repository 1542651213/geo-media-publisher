# Sohu Deep Final-Control Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend only the Sohu Browser Adapter diagnostics so the same SELF_TEST Job can locate a real final-publish chain across the full page, frames, portals, fixed/sticky/footer regions, and open shadow roots without clicking a publish-side-effect control.

**Architecture:** Keep the existing Publisher/Scheduler/OAuth and one-click submission gate unchanged. Add Sohu-owned deep DOM snapshot helpers that scan each Playwright frame, recursively inspect open shadow roots, record visible and hidden candidate metadata, compare snapshots around content reuse/fill, and classify candidates as direct submit, safe next-step/confirmation, preview-only, hidden-required, iframe, portal, or not found. The Sohu SELF_TEST harness will persist redacted JSON, screenshots, frame URLs, bottom DOM, and portal/fixed summaries after the no-click preflight.

**Tech Stack:** TypeScript strict mode, Playwright Core `Page`/`Frame`, Vitest, Electron visible Browser Session, SQLite-backed existing SELF_TEST Job.

**Spec:** User request in the current Codex task; durable state is recorded in `PROJECT_STATE.md`.

## Global Constraints

- Continue only Job `6fb37664-4340-4e1a-accd-865987e907df`, Run `3e58a669-072f-4373-bff1-d1dcccaa5f17`, and Article `58c1c7ee-c763-4cd7-892b-15b550be5923`.
- Do not create a Job, Article, PublishRecord, second submission intent, or new test content.
- Do not touch Weibo, Bilibili, Lieju, Zhihu, Baijiahao, or shared Publisher/Scheduler/OAuth architecture.
- Keep `final_submit_count=0`; do not click a direct final-publish control or any ambiguous control.
- A `下一步`/`预览` candidate may be clicked only when its text and metadata explicitly exclude publish/submit semantics and the diagnostic records it as a non-final transition before the next scan.
- All persisted DOM evidence must be redacted and bounded; never persist cookies, storage state, secrets, raw input values, or full article body text.

---

### Task 1: Define deep-discovery evidence and classification tests

**Files:**
- Modify: `packages/adapters/sohu-media/src/browser.test.ts`
- Modify: `packages/adapters/sohu-media/src/browser.ts` only if a small exported pure classifier is needed by the tests

**Interfaces:**
- Consumes: synthetic control/frame snapshot fixtures.
- Produces: regression coverage for candidate classification, frame/portal/shadow metadata, and before/after DOM diff semantics.

- [ ] **Step 1: Write failing tests** for a pure Sohu discovery classifier or equivalent adapter diagnostic helper covering:
  - `FINAL_SUBMIT_DIRECT` for enabled `发布`/`提交` controls.
  - `NEXT_STEP_TO_CONFIRMATION` for exact `下一步` without publish/submit keywords.
  - `PREVIEW_ONLY` for exact `预览`.
  - `CONTROL_HIDDEN_BY_REQUIRED_STATE` for a publish candidate that is CSS-hidden or disabled with required-field evidence.
  - `CONTROL_IN_IFRAME` and `CONTROL_IN_PORTAL` from frame URL/surface metadata.
  - `CONTROL_NOT_FOUND` when no candidate exists.
  - stable before/after diff fields showing added/removed/changed candidate keys without article-body content.
- [ ] **Step 2: Run the focused Sohu test and verify it fails for the missing helper/behavior.**

Run: `pnpm exec vitest run packages/adapters/sohu-media/src/browser.test.ts`

Expected: FAIL because the deep discovery classification/diff contract does not yet exist.

- [ ] **Step 3: Implement the smallest pure classifier/data contract in the Sohu Adapter.** Keep all labels bounded and avoid exposing raw input values.
- [ ] **Step 4: Re-run the focused Sohu test and verify it passes.**

### Task 2: Implement full-page, frame, shadow-root, and region scanning

**Files:**
- Modify: `packages/adapters/sohu-media/src/browser.ts`

**Interfaces:**
- Consumes: a live Playwright `Page` and the existing verified editor URL.
- Produces: a bounded `SohuDeepDomDiscovery` containing scroll passes, frame URLs, visible/hidden candidate records, shadow-root records, portal/fixed/sticky/footer summaries, bottom DOM summary, candidate classification, and before/after diff data.

- [ ] **Step 1: Add the redacted candidate schema and stable classification constants.** Every candidate records `tag`, bounded `text`, bounded selector, `frameUrl`, `visible`, `disabled`, `ariaDisabled`, `boundingBox`, computed `display`/`visibility`/`opacity`, region/surface, and keyword matches.
- [ ] **Step 2: Add a frame scanner using `page.frames()` and `frame.evaluate`.** Record every frame URL, preserve a scan error for inaccessible frames, and inspect the main document plus every same-origin/cross-origin frame without guessing content from URL alone.
- [ ] **Step 3: Traverse open shadow roots recursively.** Scan `button`, `a`, `[role=button]`, `input`, and `div` in both light DOM and open shadow DOM; never access closed shadow roots.
- [ ] **Step 4: Add full-page scroll passes from top to bottom and back to top.** Repeat scans after bounded scroll increments, recording scroll position and deduplicating candidates by frame/selector/region.
- [ ] **Step 5: Add portal/fixed/sticky/footer detection.** Record bounded summaries for body-level portals and elements whose computed position is fixed/sticky or whose nearest region is footer; include modal/drawer/confirmation surface metadata.
- [ ] **Step 6: Add `CONTROL_IN_IFRAME`, `CONTROL_IN_PORTAL`, `CONTROL_HIDDEN_BY_REQUIRED_STATE`, and `CONTROL_NOT_FOUND` classification without treating a hidden candidate as clickable.
- [ ] **Step 7: Re-run focused tests and fix only Sohu Adapter failures.**

### Task 3: Compare content-reuse/fill DOM and safely inspect non-final transitions

**Files:**
- Modify: `packages/adapters/sohu-media/src/browser.ts`
- Modify: `scripts/v119-sohu-resume-existing.mts`

**Interfaces:**
- Consumes: the same existing article and current Sohu Browser Session.
- Produces: before/after DOM snapshots and diff artifacts; at most a safe `下一步`/`预览` transition when the classifier proves it is not a final publish action.

- [ ] **Step 1: Add a pre-content snapshot immediately after the real editor is restored.** Before writing, compare title/body/image state and skip `fill`/image upload when the existing article content and image evidence already match, so this pass does not re-fill the test content.
- [ ] **Step 2: Add a post-content-reuse/fill snapshot and bounded diff.** Persist only candidate/region/frame changes, not raw article body or sensitive values.
- [ ] **Step 3: Implement a no-click final-control scan first.** If a direct final control is found, stop and raise a diagnostic waiting state containing its text, selector, frame URL, page URL, disabled state, and prerequisites; do not click it.
- [ ] **Step 4: If and only if a candidate is classified as `NEXT_STEP_TO_CONFIRMATION` or `PREVIEW_ONLY`, click that non-final transition, wait for the next DOM state, and scan all frames/regions again. Never click an element whose text/metadata includes `发布`, `提交`, `立即发布`, `确认发布`, or an equivalent final semantic.
- [ ] **Step 5: Extend `v119-sohu-resume-existing.mts` to save a full-page screenshot, frame URLs, deep candidate JSON, bottom DOM summary, portal/fixed/sticky/footer summary, and before/after diff under a new Sohu-only output path. Do not create a signal or call final submit.
- [ ] **Step 6: Run the focused Sohu tests and execute the same Job once in the visible app-owned Browser. Confirm the database intent count remains zero.

### Task 4: Final verification and durable state handoff

**Files:**
- Modify: `PROJECT_STATE.md`
- Create: Sohu-only output evidence files under `output/`

- [ ] **Step 1: Verify the live result against the explicit classification checklist:** direct final, next-step, preview-only, hidden-required, iframe, portal, and not-found; record which are proven and which remain unproven.
- [ ] **Step 2: Run `pnpm lint`, `pnpm typecheck`, the focused Sohu tests, `pnpm test`, and `pnpm build`.
- [ ] **Step 3: Query the production DB read-only and confirm the same Job/Run/Article, `final_submit_count=0`, no new Job/Record, and no External ID/URL.
- [ ] **Step 4: Update `PROJECT_STATE.md` with exact IDs, evidence paths, classification, screenshot path, frame URLs, no-click result, and remaining user gate. Do not claim Sohu PublishPassed.

