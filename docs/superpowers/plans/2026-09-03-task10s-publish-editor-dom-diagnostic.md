# Task10S Publish Editor DOM Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed no-argument Main diagnostic that evaluates the existing canonical Xiaohongshu publish editor Page and returns bounded metadata for the exact tabs, upload surface, and image file inputs.

**Architecture:** Keep the existing readiness and semantic-gate behavior unchanged. Add a dedicated adapter diagnostic whose self-contained `Page.evaluate` callback contains only fixed labels and bounded metadata logic; expose it through the account-scoped identity service, fixed IPC channel, preload bridge, and shared typed API.

**Tech Stack:** TypeScript strict mode, Playwright Core, Electron IPC, Vitest, electron-vite, electron-builder.

**Spec:** User-provided Task10S canonical XHS bounded DOM diagnostic requirements in the current thread.

## Global Constraints

- The diagnostic takes no Renderer/IPC arguments and never accepts selectors, text, URL, Page ID, Context ID, script, XPath, or CSS.
- The Main/adapter layer alone resolves the existing account-owned canonical Page and validates `https://creator.xiaohongshu.com/publish/publish`.
- The evaluate callback is self-contained and returns only fixed-label counts, bounded element metadata, at most five ancestors, and file-input metadata.
- The diagnostic performs no navigation, reload, click, keyboard action, `setInputFiles`, content mutation, authorization mutation, or final submit.
- Existing semantic selectors and Task10S upload/fill/submit behavior remain unchanged until live evidence proves a false negative.
- Preserve the r14 installation as rollback and package the diagnostic release as r15 or the next unused release directory.

---

### Task 1: Add failing bounded DOM evaluator tests

**Files:**
- Create: `packages/adapters/xiaohongshu/src/publish-editor-dom-diagnostic.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.ts` only if the test requires an export

**Interfaces:**
- Produce a tested `inspectXiaohongshuPublishEditorDom(page)` helper that returns fixed-label counts, bounded node metadata, bounded ancestor metadata, and file-input metadata.

- [ ] Write a Playwright fixture containing the six exact labels, a selected `上传图文` signal, a visible `上传图片` surface, and one hidden image file input; assert exact counts and safe fields.
- [ ] Assert ancestor output has no more than five entries and no HTML/text dump fields.
- [ ] Assert zero/multiple labels and wrong route are represented as fail-closed diagnostics.
- [ ] Assert the fixture’s click and `setInputFiles` counters remain zero.
- [ ] Run `pnpm exec vitest run packages/adapters/xiaohongshu/src/publish-editor-dom-diagnostic.test.ts` and verify the new helper is missing or the expected assertions fail.

### Task 2: Implement the self-contained adapter diagnostic

**Files:**
- Create: `packages/adapters/xiaohongshu/src/publish-editor-dom-diagnostic.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.ts`

**Interfaces:**
- `inspectXiaohongshuPublishEditorDom(page: Page): Promise<XiaohongshuPublishEditorDomSnapshot>` performs one bounded `page.evaluate` with fixed labels embedded in the callback.
- `XiaohongshuBrowserAdapter.inspectCurrentXiaohongshuPublishEditorDom(ctx)` resolves the existing canonical Page, validates session/context/page/origin/path, and returns the typed fail-closed runtime result.

- [ ] Define serializable result types for route/lifecycle status, six label diagnostics, selected-tab signal, upload-button diagnostics, and file-input metadata.
- [ ] Implement only fixed exact-label matching, safe style/geometry fields, `connected`, and five-level ancestor metadata inside a self-contained evaluate callback.
- [ ] Add route and Page ownership gates before evaluation; return bounded failure results without evaluating an invalid Page.
- [ ] Run Task 1 tests and verify they pass without changing existing semantic-gate rules.

### Task 3: Wire the fixed no-argument Main API

**Files:**
- Modify: `apps/desktop/src/main/xhs-identity.ts`
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/shared/api.ts`
- Test: `apps/desktop/src/main/xhs-identity.test.ts`
- Create: `tests/xiaohongshu-publish-editor-dom-diagnostic-contract.test.ts`

**Interfaces:**
- Renderer API: `publisherAPI.platformSelfTest.inspectCurrentXiaohongshuPublishEditorDom(): Promise<XiaohongshuPublishEditorDomRuntimeDiagnostic>`.
- IPC channel: `platform-self-test:inspect-current-xhs-publish-editor-dom` with no payload.
- Main lookup: fixed `XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID`; no Page/Context/selector input.

- [ ] Add a failing service/API contract test for the no-argument call and fixed account routing.
- [ ] Wire the identity service, platform self-test façade, IPC handler, preload bridge, and shared type.
- [ ] Add static contract assertions for no arbitrary selector input, no HTML dump, no click, no upload, and no final submit.
- [ ] Run focused adapter and desktop contract tests.

### Task 4: Verify, package, deploy, and run live diagnostic only

**Files:**
- Generated only: `D:\GEO\releases\release-task10s-20260903-r15` or next unused release directory.

- [ ] Run focused tests, full tests, typecheck, lint, and build; record exit codes and counts.
- [ ] Package the diagnostic-only release without changing the installed runtime until the artifact hash is recorded.
- [ ] Deploy normally while preserving r14 rollback; do not upload, fill, or submit during deployment validation.
- [ ] Reconnect only through normal lifecycle if required, perform fresh Creator ID proof, and call the new no-argument diagnostic on the existing canonical Page.
- [ ] Report live exact counts, selected signal, upload surface, file-input metadata, false-negative decision, zero mutation counters, and next blocker.
