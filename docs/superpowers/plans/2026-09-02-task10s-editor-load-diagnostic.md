# Task10S Editor Load Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed, bounded, redacted XHS `/publish/publish` load diagnostic that observes the existing canonical Page and performs at most one reload of that exact route without creating browser objects or touching publication content.

**Architecture:** Keep the diagnostic in the Xiaohongshu adapter as a dedicated module. It attaches and removes Playwright lifecycle/network/error listeners around one fixed-route reload, records only origin/path and bounded safe metadata, samples `document.readyState` for at most 30 seconds, and classifies the first proven load failure. Expose it through a fixed Main/preload IPC method with no URL, selector, script, Page ID, or reload-count input from Renderer.

**Tech Stack:** TypeScript strict mode, Playwright Page event APIs, Electron IPC/preload, Vitest, pnpm.

**Spec:** `C:\Users\Administrator\.codex\attachments\a0e83951-5867-4cd9-bddc-1d3305c955e9\pasted-text.txt`

## Global Constraints

- Bind diagnostics to the existing canonical XHS Page only.
- Do not create BrowserSession, BrowserContext, or Page.
- Reload only the exact `https://creator.xiaohongshu.com/publish/publish` origin/path, at most once per run.
- Do not navigate, click, upload, edit title/body/settings, create authorization, or submit publication.
- Store only sanitized URL origin/path; never capture headers, cookies, bodies, storage, tokens, or response bodies.
- Redact token-like, cookie-like, authorization-like, credential-like, phone, email, and long-random-secret text.
- Bound console messages at 100 entries and 500 characters each; page errors at 50 entries; failed resources at 50 entries.
- Remove every listener in `finally`, including on reload timeout or evaluation failure.
- Preserve the existing Task10W identity implementation and Task10V authorization state.

### Task 1: Define redaction and bounded diagnostic types

**Files:**
- Create: `packages/adapters/xiaohongshu/src/editor-load-diagnostic.ts`
- Test: `packages/adapters/xiaohongshu/src/editor-load-diagnostic.test.ts`

**Interfaces:**
- Produce `XhsEditorLoadDiagnosticResult` with lifecycle timestamps, sanitized resource failures, bounded error arrays, ready-state samples, frame summaries, reload count, and root-cause classification.
- Produce `runXhsEditorLoadDiagnostic(page, metadata, options?)` with no URL or selector input; it verifies the current page route internally.

- [ ] **Step 1: Write failing pure-function tests** for URL query/fragment stripping, redaction of secret-like text, bounded truncation, status bucketing, and root-cause precedence.
- [ ] **Step 2: Run the focused diagnostic test and confirm the expected failures.**
- [ ] **Step 3: Implement the pure helpers and strict result types.**
- [ ] **Step 4: Run the focused test and confirm it passes.**
- [ ] **Step 5: Commit the isolated diagnostic types/helpers.**

### Task 2: Implement the single-reload listener lifecycle

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/editor-load-diagnostic.ts`
- Test: `packages/adapters/xiaohongshu/src/editor-load-diagnostic.test.ts`

**Interfaces:**
- `runXhsEditorLoadDiagnostic` attaches `pageerror`, `console`, `request`, `requestfailed`, `response`, `domcontentloaded`, `load`, and `framenavigated` listeners.
- It captures only fixed safe fields, starts one `page.reload({ waitUntil: "commit" })`, samples `document.readyState` at bounded offsets through 30 seconds, records same-origin frame metadata, classifies the result, and removes listeners.

- [ ] **Step 1: Extend tests with a fake existing Page proving listener capture, cleanup, main-document fields, script/XHR failures, lifecycle events, frame summaries, and one reload maximum.**
- [ ] **Step 2: Run the test and confirm it fails because the runner is not implemented.**
- [ ] **Step 3: Implement the minimum listener registry, fixed evaluate function, reload guard, bounded sampler, and safe classification.**
- [ ] **Step 4: Run focused tests and confirm request bodies/headers/URLs with query strings never appear.**
- [ ] **Step 5: Commit the runnable adapter diagnostic.**

### Task 3: Wire a fixed Main/preload API

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/preload.ts`
- Modify: `apps/desktop/src/shared/api.ts`
- Test: `tests/task10s-editor-load-diagnostic.test.ts`

**Interfaces:**
- Add `XiaohongshuBrowserAdapter.inspectEditorLoad(ctx)` that resolves the existing canonical Page, requires exact publish-route origin/path, and invokes the diagnostic with a fixed operation metadata object.
- Add fixed IPC channel `accounts:editor-load-diagnostic` accepting only `{ accountId, platformKey }` validated by existing schemas; reject non-XHS platforms.
- Add `window.publisherAPI.accounts.inspectEditorLoad(accountId, platformKey)` with no URL, selector, script, Page ID, or reload options.

- [ ] **Step 1: Write failing IPC/adapter tests for exact-route enforcement, no new Page/Context, one reload, and publication counters remaining zero.**
- [ ] **Step 2: Run the focused tests and confirm failure before wiring.**
- [ ] **Step 3: Add the typed adapter method, IPC registration, preload method, and shared API type.**
- [ ] **Step 4: Run focused tests and confirm the fixed API returns the diagnostic result.**
- [ ] **Step 5: Commit the Main/preload wiring.**

### Task 4: Verify static checks and package r4

**Files:**
- Test-only updates from Tasks 1–3.
- Create: `output/xiaohongshu-task10s-editor-load-diagnostic-r4-20260902.json` only after runtime evidence exists.

- [ ] **Step 1: Run focused tests covering redaction, event capture, one reload, cleanup, and no publication mutation.**
- [ ] **Step 2: Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.**
- [ ] **Step 3: Package to independent `release-task10s-20260902-r4` without touching r3.**
- [ ] **Step 4: Record staging hash and preserve the current installed hash/rollback path.**
- [ ] **Step 5: Commit all source/test changes before deployment.**

### Task 5: Deploy r4 and perform one live diagnostic

**Runtime procedure:**
- Preserve XHS profile path `C:\Users\Administrator\AppData\Roaming\codex-media-publisher\browser-profiles\xiaohongshu\54b390ac-d81e-440a-baeb-d00f9f346cc3`.
- Stop only the old Geo process normally, move the installed directory to a new rollback path, copy r4 staging into the installed path, verify `app.asar` SHA equality, and start Geo with the existing remote debugging port.
- Restore the account through the formal existing lifecycle if required; do not login, create a new account, or create a new Page specifically for diagnosis.
- Confirm the exact current canonical Page route and no existing user draft before calling the fixed diagnostic API.
- Invoke the diagnostic exactly once; do not call prepare prepublish afterward in this run.

- [ ] **Step 1: Capture pre-deploy process, profile, authorization, database, and mutation baselines.**
- [ ] **Step 2: Deploy r4 with an independent rollback directory and verify hashes.**
- [ ] **Step 3: Capture post-restore canonical runtime IDs and invoke one fixed editor-load diagnostic.**
- [ ] **Step 4: Save sanitized machine-readable runtime evidence without overwriting r3/r8/r9 evidence.**
- [ ] **Step 5: Classify the root cause and stop before any Task10S content mutation.**
