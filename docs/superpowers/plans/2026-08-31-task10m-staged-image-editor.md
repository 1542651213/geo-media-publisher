# Task 10M Staged Image Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Xiaohongshu image-post flow phase-aware so Gate passes only the stable pre-upload shell and preparePublish validates post-upload controls after its approved upload.

**Architecture:** Reuse the existing `image-editor-discovery.ts` signal collection and phase classifier. Add pure phase contracts plus bounded post-upload readiness, call them from the existing canonical-page/mutex flow, and expose structured phase-aware events to the Task10A analyzer.

**Tech Stack:** TypeScript strict mode, Playwright `Page`/`Locator`, Vitest, pnpm, Electron packaging.

**Spec:** `docs/superpowers/specs/2026-08-31-task10m-staged-image-editor-design.md`

## Global Constraints

- Keep Task10I canonical Page/Context, mutex, heartbeat, and single Publish Note navigation unchanged except for regression-safe integration.
- Gate must remain read-only with `UPLOAD_COUNT=0`, `CONTENT_MUTATION_COUNT=0`, and `FINAL_SUBMIT_COUNT=0`.
- `preparePublish` must not upload until the pre-upload contract passes.
- A hidden enabled file input is valid only with one usable visible upload surface; no selector guessing or `first()`/`nth()` control selection.
- Post-upload control failures must retain their POST_UPLOAD phase in structured evidence.
- Final submit counts come only from explicit final-submit action markers.
- Do not modify other platform adapters, credentials, browser profiles, or production DB.

---

### Task 1: Define phase-aware contracts and RED tests

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/image-editor-discovery.ts`
- Test: `packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`
- Test: `packages/adapters/xiaohongshu/src/browser.test.ts`

**Interfaces:**
- Produce pure `assertPreUploadImageEditorContract(result)` returning structured pass/failure data.
- Produce `inspectPostUploadImageEditor(page, metadata, options)` with bounded readiness samples and phase-aware control discovery.
- Preserve `classifyImagePostEditorPhase`, `resolveImageEditorUploadCapability`, and Task10I navigation interfaces.

- [ ] **Step 1: Write failing phase-contract tests** covering pre-upload pass without title/body/final controls, hidden valid upload input, isolated hidden input failure, `IMAGE_POST` plus “上传视频” supporting text, and post-upload required controls.
- [ ] **Step 2: Write failing adapter tests** covering Gate PRE_UPLOAD pass with zero mutations, preparePublish refusal before upload when PRE_UPLOAD fails, upload-before-title order, bounded post-upload readiness timeout, precise post-upload failure, same Page/Context, and no final-submit click.
- [ ] **Step 3: Run the targeted tests and confirm they fail for missing phase-aware behavior.**

### Task 2: Implement shared pre-upload and post-upload discovery

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/image-editor-discovery.ts`
- Test: `packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts`

**Interfaces:**
- `assertPreUploadImageEditorContract` accepts phase inspection evidence and requires route/shell/content type/upload capability/stability/auth identity signals while explicitly ignoring post-upload controls.
- `inspectPostUploadImageEditor` performs bounded readiness (maximum 5 seconds, stable samples), requires upload completion signals, then reuses existing control discovery and returns phase-specific failures.

- [ ] **Step 1: Implement only the smallest pre-upload assertion required by the RED tests.**
- [ ] **Step 2: Implement post-upload readiness samples and strict `IMAGE_POST_POST_UPLOAD_EDITOR` classification.**
- [ ] **Step 3: Run image-editor tests and verify all pass without changing navigation selectors.**

### Task 3: Integrate phase contracts into Gate and preparePublish

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Test: `packages/adapters/xiaohongshu/src/browser.test.ts`

**Interfaces:**
- Gate calls `inspectImagePostEditorPhase`, applies the pre-upload contract, and returns `PRE_SUBMIT_GATE_PHASE=PRE_UPLOAD`, `PRE_UPLOAD_GATE_STATUS`, `POST_UPLOAD_CONTROLS_STATUS=NOT_APPLICABLE_BEFORE_UPLOAD`, and `PRE_SUBMIT_GATE_PASS_MEANING=SAFE_TO_ENTER_PREPARE_PUBLISH_UPLOAD_STAGE`.
- preparePublish uses the same canonical Page and operation ID, emits the mutation-boundary marker only after pre-upload pass, calls existing `uploadImages`, invokes post-upload inspection, and fills title/body only after post-upload control pass.

- [ ] **Step 1: Wire Gate to return structured PRE_UPLOAD success and precise phase failure.**
- [ ] **Step 2: Wire preparePublish to assert PRE_UPLOAD before `uploadImages`.**
- [ ] **Step 3: Add the post-upload bounded inspection before title/body mutation.**
- [ ] **Step 4: Run adapter tests and confirm Gate remains zero-side-effect and preparePublish preserves upload-before-title.**

### Task 4: Add phase markers and update Task10A analyzer

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `scripts/v143-xiaohongshu-task10a-evidence.helpers.ts`
- Test: `packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts`

**Interfaces:**
- Emit `PRE_UPLOAD_GATE_INSPECTION_STARTED`, `PRE_UPLOAD_GATE_RESULT`, `PREPARE_PUBLISH_MUTATION_BOUNDARY_ENTERED`, `POST_UPLOAD_EDITOR_READINESS_STARTED`, `POST_UPLOAD_EDITOR_READINESS_SAMPLE`, `POST_UPLOAD_EDITOR_PHASE_OBSERVED`, `POST_UPLOAD_EDITOR_CONTROLS_DISCOVERED`, `POST_UPLOAD_EDITOR_INSPECTION_FAILED`, and `POST_UPLOAD_EDITOR_INSPECTION_COMPLETED` with operation/account/context/page/sanitized URL/phase fields.
- Extend `Task10AEvidenceSummary` with `preSubmitGatePhase`, `preUploadGateStatus`, `preUploadGateFailureCode`, `imageEditorPhase`, `imageEditorPhaseConfidence`, `uploadCapabilityPresent`, `postUploadControlsStatus`, and `preSubmitGatePassMeaning`.

- [ ] **Step 1: Add analyzer RED fixtures for phase-aware Gate success and post-upload failure.**
- [ ] **Step 2: Run analyzer tests and confirm the new fields are absent or incorrect.**
- [ ] **Step 3: Implement explicit event parsing and keep final-submit counting restricted to explicit action markers.**
- [ ] **Step 4: Run analyzer tests and verify navigation/control-discovery markers do not increment finalSubmitCount.**

### Task 5: Focused and full verification

**Files:**
- Read-only verification of changed files and existing test suites.

- [ ] **Step 1: Run focused phase, Gate, preparePublish, analyzer, navigation, canonical Page, mutex, heartbeat, and regression tests.**
- [ ] **Step 2: Run `pnpm test`.**
- [ ] **Step 3: Run `pnpm typecheck`.**
- [ ] **Step 4: Run `pnpm lint`.**
- [ ] **Step 5: Run `pnpm build`.**
- [ ] **Step 6: Read-only verify production DB remains 15 / 12 / 9.**

### Task 6: Selective commit, package, audit, and deployment

**Files:**
- Create: `release-task10m-<unique>/win-unpacked` as generated staging output.
- Create: one unique rollback directory only after deployment precheck passes.

- [ ] **Step 1: Inspect `git diff` and stage only Task10M source, tests, analyzer, spec, and plan files.**
- [ ] **Step 2: Review `git diff --cached` and commit `feat: stage xiaohongshu image editor gate`.**
- [ ] **Step 3: Package without staging unrelated dirty files and verify all Task10M/Task10L markers in `app.asar`.**
- [ ] **Step 4: Record staging SHA256 and verify DB read-only counts.**
- [ ] **Step 5: Require installed/XHS process precheck `0 / 0 / NO`; if not, report `BLOCKED_ACTIVE_RUNTIME` and stop.**
- [ ] **Step 6: If precheck passes, record old installed hash, create non-overwriting rollback, deploy only `resources/app.asar`, verify hash match, start packaged app, verify Electron 37.10.3 / ABI 136 / responding / APP_STARTUP, and re-read DB.**
- [ ] **Step 7: Stop without live Gate, login, upload, SELF_TEST, or preparePublish.**
