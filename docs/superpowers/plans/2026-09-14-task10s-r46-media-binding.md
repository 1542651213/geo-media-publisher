# Task10S r46 Media Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a verified ImageAsset on every new Task10S Prepared Job and make recovery upload exactly that Job-bound media while preserving generic publisher validation and one-shot submission code.

**Architecture:** Reuse the existing `AppRepository.createImageAsset`, `getImageAsset`, and `createPlatformSelfTestPublishJob` APIs. Add a small pure media-binding validator for fixture metadata and file hash, invoke it before fresh ARM persistence, and pass the validated Job-bound asset path into prepared-editor recovery. The existing PublisherService, XHS `validateArticle`, completion gate, authorization, and final mouse state machine remain unchanged.

**Tech Stack:** TypeScript strict mode, Vitest, better-sqlite3 repository, Node `fs`/`crypto`, electron-vite packaging.

**Spec:** `C:\Users\Administrator\.codex\attachments\91684434-2b2f-4b60-95e3-467af5425a79\pasted-text.txt`

## Global Constraints

- Offline implementation only; do not deploy, alter the live Failed Job, ARM live state, completion, or publish.
- Do not create a parallel ImageAsset schema; use the existing persisted media_assets/ImageAsset pipeline.
- Do not change `PublisherService` image validation, XHS `validateArticle`, completion, one-shot, or final mouse code.
- New Task10S Prepared Jobs must have a verified Job-bound ImageAsset and `PREPARED_JOB_MEDIA_GATE = PASS` before ARM succeeds.
- Recovery must fail closed for missing/null/missing-file/hash-mismatch Job media and must upload the Job-bound file.

### Task 1: Add failing media-binding and ARM regression tests

**Files:**
- Modify: `tests/task10s-fresh-publish-prepared-job.test.ts`
- Create: `tests/task10s-media-binding.test.ts`

**Interfaces:**
- Tests will call the new pure validator exported from `apps/desktop/src/main/task10s-media-binding.ts`.
- The existing ARM fixture will assert `selectedImageAssetId` is non-null and its Prepared Record uses the same ID.

- [x] **Step 1: Write the failing tests** for null Job image binding, valid/missing/hash-mismatch fixture files, and ARM persistence.
- [x] **Step 2: Run only those tests** and verify they fail for the expected missing binding/validator behavior.

### Task 2: Implement verified Job-bound media binding

**Files:**
- Create: `apps/desktop/src/main/task10s-media-binding.ts`
- Modify: `apps/desktop/src/main/platform-self-test.ts`

**Interfaces:**
- `validateTask10sImageAsset(asset, fixture)` returns a typed PASS/BLOCKED media gate with asset ID/path and failure code.
- `ensureTask10sSafeImageAsset()` reuses a matching persisted ImageAsset or creates one through `repository.createImageAsset`, then validates file existence, PNG MIME, expected name/size/hash.
- `armTask10sFreshCompletion()` validates the media gate before calling `createPlatformSelfTestPublishJob`, passes `selectedImageAssetId`, and records `preparedJobMediaGate: "PASS"`.

- [x] **Step 1:** Implement only the smallest validator and asset resolver needed by the RED tests.
- [x] **Step 2:** Update ARM to fail closed before Job creation when the fixture or persisted asset is invalid.
- [x] **Step 3:** Run the focused media/ARM tests and verify GREEN.

### Task 3: Bind recovery to the Prepared Job ImageAsset

**Files:**
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/task10s-prepared-editor-recovery.ts`
- Modify: `tests/task10s-prepared-editor-recovery.test.ts`

**Interfaces:**
- Recovery resolves `job.selectedImageAssetId`, validates the persisted ImageAsset against the safe fixture, and passes its `filePath` to `adapter.recoverPreparedEditor`.
- Recovery evidence exposes `recoveryUsesJobBoundImageAsset: true` and rejects null/missing/mismatched media before browser mutation.

- [x] **Step 1:** Add RED tests for null, missing, and hash-mismatched Job media plus the positive Job-bound path.
- [x] **Step 2:** Add the recovery media gate and evidence field without changing upload retry limits or final-submit behavior.
- [x] **Step 3:** Run recovery and ARM focused tests.

### Task 4: Full verification and r46 package

**Files:**
- Modify only implementation/tests from Tasks 1–3.

- [x] **Step 1:** Run regression RED/GREEN evidence, focused tests, full tests, typecheck, lint, build, and package.
- [x] **Step 2:** Confirm the old Failed Job remains unchanged in the live database and no submit/publication counters changed.
- [x] **Step 3:** Create `release-task10s-20260914-r46`, record commit, changed files, and app.asar SHA256.
