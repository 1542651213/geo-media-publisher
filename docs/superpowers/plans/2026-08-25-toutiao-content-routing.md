# Toutiao Content-Aware Adapter Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the existing Toutiao article BrowserAutomation adapter beside the official video API adapter and route jobs deterministically by the existing `PublishJob.contentKind`, while keeping this pass pre-submit-only.

**Architecture:** Extend the shared `AdapterRegistry` from one adapter per platform to a set of capability-specific adapters with an explicit `getForContent(platformKey, contentKind)` resolver. Preserve the existing platform-default lookup for account/OAuth/catalog code, but make Publisher, Scheduler, and platform self-test paths that know the content kind use the resolver. Register the Toutiao article adapter without changing the official video adapter.

**Tech Stack:** TypeScript strict mode, Vitest, pnpm, Electron/Playwright BrowserSessionManager, SQLite-backed Publisher runtime.

**Spec:** User-provided Toutiao article runtime routing and safe real-page dry-run request in the attached `pasted-text.txt`.

## Global Constraints

- `toutiao + video` must resolve to the official API adapter and keep `supportsArticle=false`.
- `toutiao + article` must resolve to `ToutiaoArticleBrowserAdapter`.
- Unknown or unsupported content kinds must fail closed; no registration-order fallback.
- The final submit control must never be clicked in this pass; final-submit clicks must remain `0`.
- Do not create a real publish Job, SubmissionIntent, PublishRecord, External ID, External URL, or `PublishPassed=PASS` from the dry-run.
- Do not modify platform business implementations for Weibo, Sohu, Baijiahao, Zhihu, Bilibili, or Lieju.
- Do not modify Publisher state semantics, Scheduler policy, SubmissionIntent, PublishRecord, or BrowserSessionManager behavior beyond the minimum content-aware adapter lookup needed for routing.
- Run focused tests first, then `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- Update `PROJECT_STATE.md` with only verified facts and preserve blocked/waiting status when the live account cannot pass Login.

---

### Task 1: Add failing content-aware registry tests

**Files:**
- Modify: `packages/adapters/core/src/index.test.ts`
- Modify: `tests/runtime-adapter-registry.test.ts`

**Interfaces:**
- Consumes: existing `PlatformAdapter`, `AdapterManifest`, and `createRuntimeAdapterRegistry` contracts.
- Produces: executable assertions for `getForContent(platformKey, contentKind)` and the Toutiao runtime registrations.

- [ ] **Step 1: Add registry tests for video/article/unknown/unavailable routing.**

  Add two same-key stubs with disjoint capabilities and assert:

  ```ts
  expect(registry.getForContent("stub", "video")).toBe(videoAdapter);
  expect(registry.getForContent("stub", "article")).toBe(articleAdapter);
  expect(() => registry.getForContent("stub", "image" as string)).toThrow(/unsupported content kind/i);
  expect(() => registry.getForContent("stub", "video")).toThrow(/no adapter registered/i);
  ```

  Add runtime assertions that `toutiao` video is `official_api`/`supportsArticle=false` and `toutiao` article is `browser`/`BrowserAutomation`/`supportsArticle=true`.

- [ ] **Step 2: Run the focused tests and verify they fail for the missing resolver/duplicate registration.**

  Run:

  ```text
  pnpm exec vitest run packages/adapters/core/src/index.test.ts tests/runtime-adapter-registry.test.ts
  ```

  Expected: FAIL because the registry has no content resolver and the runtime cannot register two `toutiao` adapters.

---

### Task 2: Implement capability-aware registry and Toutiao registration

**Files:**
- Modify: `packages/adapters/core/src/index.ts`
- Modify: `apps/desktop/src/main/adapter-registry.ts`

**Interfaces:**
- Consumes: the failing tests from Task 1.
- Produces: `AdapterRegistry.getForContent(platformKey: string, contentKind: string): PlatformAdapter`, a deterministic capability resolver, and runtime registration of `ToutiaoArticleBrowserAdapter`.

- [ ] **Step 1: Store multiple adapters per platform while retaining one explicit platform-default view.**

  Keep `list()`/`manifests()` one row per platform for existing catalog synchronization. Add `listAll()` for shutdown and any code that must see every registered implementation. Make `getForContent` validate `article|video`, match the corresponding manifest capability, and throw clear errors for zero or multiple matches. Keep `get(platformKey)` deterministic for existing platform-level code by preferring the existing video-only adapter when a platform has a video-only variant; do not use `get(platformKey)` in content-aware publish paths.

- [ ] **Step 2: Register `new ToutiaoArticleBrowserAdapter({ credentialStore, onBrowserRuntimeEvent })` after the existing official `ToutiaoAdapter`.**

  Do not change `ToutiaoAdapter` manifest or capabilities. Use `registry.listAll()` for owned browser-session shutdown so the article adapter is closed safely.

- [ ] **Step 3: Run the focused tests and verify they pass.**

  Run:

  ```text
  pnpm exec vitest run packages/adapters/core/src/index.test.ts tests/runtime-adapter-registry.test.ts packages/adapters/toutiao/src/index.test.ts packages/adapters/toutiao/src/browser.test.ts
  ```

  Expected: PASS, including the original official video contract.

---

### Task 3: Route Publisher and Scheduler by `PublishJob.contentKind`

**Files:**
- Modify: `packages/publisher/src/index.ts`
- Add or modify: `tests/v125-toutiao-content-routing.test.ts`

**Interfaces:**
- Consumes: `AdapterRegistry.getForContent` and existing `PublishJob.contentKind`.
- Produces: content-aware adapter selection for article prepare/execute/reconciliation/status polling and browser-mode scheduler gates.

- [ ] **Step 1: Add a regression test proving a Toutiao article job cannot use the video adapter and a video job cannot use the article adapter.**

  Use two same-key test adapters with spies and a real repository job fixture. Assert article execution calls only the article adapter, video execution calls only the video adapter, and an unsupported kind returns a clear failure without invoking either adapter.

- [ ] **Step 2: Replace content-aware `adapters.get(job.platformKey)` calls with `getForContent(job.platformKey, job.contentKind ?? "article")`.**

  Update `prepareArticle`, `executeJob`, `reconcileBrowserJob`, and `pollPublishingJob`. Add the optional content-kind argument to `isBrowserAutomationPlatform` and `resolveBrowserExecutionMode`; use it in Scheduler recovery, due-job filtering, and account/job browser gating so Toutiao article jobs remain visible/manual while video jobs retain API behavior.

- [ ] **Step 3: Run the focused routing and existing Publisher tests.**

  Run:

  ```text
  pnpm exec vitest run tests/v125-toutiao-content-routing.test.ts tests/integration.test.ts tests/v114-browser-lifecycle.test.ts tests/v119-browser-submit-state.test.ts
  ```

  Expected: PASS with no changes to publish state semantics.

---

### Task 4: Route Self-Test article and video paths explicitly

**Files:**
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `tests/v113-platform-self-test.test.ts`

**Interfaces:**
- Consumes: the existing Self-Test level and content paths plus `getForContent`.
- Produces: article L1-L3/L5 preparation through the Toutiao article adapter, while video L5 keeps the official video adapter.

- [ ] **Step 1: Add tests for the Self-Test resolver choice.**

  Assert that Toutiao safe/article preparation resolves the browser adapter and a video self-test path resolves the official API adapter; keep `confirmPublish` gated and assert no final-submit click is possible in the article preflight.

- [ ] **Step 2: Use `getForContent` at each Self-Test entry that has a known content path.**

  Use `article` for the existing article editor/content flow and `video` for the explicit video flow. Keep the existing `REAL_PUBLISH_TEST_BATCH_CONFIRMED` gate and do not add a submit fallback.

- [ ] **Step 3: Run the focused Self-Test tests.**

  Run:

  ```text
  pnpm exec vitest run tests/v113-platform-self-test.test.ts tests/v114-background-automation-status.test.ts
  ```

  Expected: PASS and no real publish evidence created by tests.

---

### Task 5: Verify live account boundary and update state

**Files:**
- Modify: `PROJECT_STATE.md`
- Modify: `docs/V1.2.5_VERIFICATION_DELTA.md`

**Interfaces:**
- Consumes: all code/test results and the read-only production account/session snapshot.
- Produces: a truthful runtime-routing conclusion and a dry-run result that distinguishes code readiness from live Login evidence.

- [ ] **Step 1: Read-only inspect the current Toutiao account and session state.**

  Confirm enabled/login status, stored browser session presence, existing Toutiao Job/PublishRecord counts, and do not mutate the database or credentials.

- [ ] **Step 2: If Login is valid, run exactly one visible Toutiao article preflight.**

  Use a unique timestamped title/body, route through `getForContent("toutiao", "article")`, call only login → article editor preparation → `prepareFinalSubmit`, and close the owned session. Assert/record `finalSubmitClickCount=0`, no external evidence, and no publish record. If Login is expired/missing or a security challenge appears, stop and record the exact blocker without attempting login bypass or submit.

- [ ] **Step 3: Run the complete verification commands.**

  Run:

  ```text
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm build
  ```

- [ ] **Step 4: Update state/docs with routing, file changes, test results, live dry-run evidence, and `READY_FOR_REAL_SELF_TEST` only if every requested live gate is actually proven.**

  Keep `PublishPassed` unchanged unless a future owner-authorized final submit produces verifiable external evidence.

---

## Verification Review

- [ ] Every required route case is covered: article, video, unknown content kind, unavailable article adapter, and unavailable video adapter.
- [ ] No route depends on registration order or silently falls back across content kinds.
- [ ] The official Toutiao video adapter still has `supportsArticle=false` and remains the default platform catalog entry.
- [ ] The article adapter never exposes a final-submit implementation and no live submit click occurs.
- [ ] `PROJECT_STATE.md` reports only observed facts and preserves any Login/session blocker.
