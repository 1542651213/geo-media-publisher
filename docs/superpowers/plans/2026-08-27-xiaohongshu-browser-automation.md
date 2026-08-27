# Xiaohongshu BrowserAutomation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an account-isolated Xiaohongshu BrowserAutomation image-post gate and a real no-submit evidence runner under the existing `xiaohongshu` platform ID.

**Architecture:** Reuse the existing `BrowserAutomationAdapter`, `BrowserSessionManager`, canonical `accounts` records, and queue/account contracts. Replace only the old Xiaohongshu ManualOnly adapter with a browser article adapter; add profile-aware generic account sync and a standalone runner that stops before final submit and never persists a Job, Intent, or PublishRecord.

**Tech Stack:** TypeScript strict mode, Playwright Core Locator/Page interfaces, Vitest, Electron `safeStorage`, existing SQLite Repository, `tsx` runner.

**Spec:** `docs/superpowers/specs/2026-08-27-xiaohongshu-browser-automation-design.md`

## Global Constraints

- Formal platform ID remains `xiaohongshu`; multiple accounts are distinguished by existing `accountId`/`platformAccountId`.
- All browser sessions use `session:${platformKey}:${accountId}`; no fallback to another account.
- This phase supports article/image-post only; video, live, commerce, private messages, comments, and fan-out publishing remain unsupported.
- Browser login is owner-performed; never automate or bypass CAPTCHA, QR verification, SMS, real-name, or risk controls.
- Every title/body write uses normalized strict readback equality; `includes()` is not a pass condition.
- Image upload passes only after DOM preview/loading evidence; `setInputFiles()` alone is insufficient.
- Final submit controls may be discovered and recorded but never clicked; `finalSubmitClickCount` is always `0`.
- Gate-only creates no Job, SubmissionIntent, or PublishRecord and cannot set `PublishPassed`.
- Do not modify existing Weibo, Toutiao, Sohu, Zhihu, Baijiahao, Publisher core, SubmissionIntent, or PublishRecord business implementations.
- Use migrations for schema changes; this plan intentionally adds no schema change.

### Task 1: Add failing Xiaohongshu adapter and routing tests

**Files:**
- Create: `packages/adapters/xiaohongshu/src/browser.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.test.ts`
- Modify: `packages/adapters/xiaohongshu/package.json`
- Modify: `tests/runtime-adapter-registry.test.ts`

**Interfaces:**
- Consumes: existing `BrowserSession`, `BrowserSessionManager`, `BrowserAutomationAdapterOptions`, `AccountContext`, and `PublishArticleInput`.
- Produces: test expectations for `XiaohongshuBrowserAdapter`, `@publisher/adapters-xiaohongshu/browser`, and the single article route for `xiaohongshu`.

- [ ] **Step 1: Write the failing adapter contract tests**

  Add fixture-backed tests for the 20 required behaviors: successful/expired login, unique account identity, image-post entry, video-entry rejection, verified image upload and failed upload, unique/ambiguous title, strict title readback, body discovery and strict body readback, required fields, publish settings classification, security blocking, unique/ambiguous final control, second-confirmation evidence, no click, and composite account routing. The fixture must expose counters for the submit locator and session manager `open` calls.

- [ ] **Step 2: Run focused tests to verify RED**

  Run `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/index.test.ts tests/runtime-adapter-registry.test.ts`.

  Expected: FAIL because `./browser` and `XiaohongshuBrowserAdapter` do not exist and the registry still resolves the old `ManualOnly` implementation.

- [ ] **Step 3: Add only package export and routing assertions needed by the tests**

  Update the package export map to include `"./browser": "./src/browser.ts"`; do not implement production behavior in this step. Change index tests to expect `transport: "browser"`, `integrationMode: "BrowserAutomation"`, `supportsArticle: true`, and `supportsVideo: false`.

- [ ] **Step 4: Re-run focused tests and keep the expected implementation failures**

  Run the same Vitest command. Expected: tests still fail on missing adapter behavior, proving the tests are exercising the requested production surface.

### Task 2: Implement Xiaohongshu DOM discovery and gate preparation

**Files:**
- Create: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.ts`

**Interfaces:**
- Consumes: Task 1 fixture contracts and protected `BrowserAutomationAdapter` lifecycle.
- Produces: `XiaohongshuBrowserAdapter`, `XiaohongshuAccountIdentityEvidence`, `XiaohongshuGateEvidence`, and strict `preparePublish()` behavior.

- [ ] **Step 1: Implement the smallest semantic field helpers**

  Add `normalizeXiaohongshuEditorText`, attribute/visibility/enabled helpers, and a scored candidate discovery function. Title candidates must use placeholder/aria-label/name/id/tag signals; body candidates must use `textarea`, `contenteditable`, role, placeholder, and editor structure. Throw the platform-specific evidence error when the best candidate is tied or readback differs.

- [ ] **Step 2: Implement account identity and security evidence**

  Enumerate visible `a[href]` profile candidates and accept only a unique stable profile URL/ID; preserve nickname if present and set `externalAccountId` to `null` if no reliable ID exists. Read page/frame URL and body text for security signals and throw before opening the editor when a challenge is present.

- [ ] **Step 3: Implement unique image-post entry discovery**

  Enumerate visible enabled anchors/buttons and accept a single href/text/aria candidate for image-post/图文/笔记. Explicit video-only candidates must not count. If no unique candidate exists, throw `CONTENT_EDITOR_AMBIGUOUS` or `CONTENT_REJECTED` with the evidence code `IMAGE_POST_ENTRY_NOT_VERIFIED`.

- [ ] **Step 4: Implement file-input upload with DOM completion proof**

  Require `input[type=file]`, call `setInputFiles()` with the first article image, then poll bounded DOM evidence: visible preview image or preview container exists, image is loaded, no visible loading/progress/failed text remains, and preview count increased from baseline. Throw `UPLOAD_FAILED` with `IMAGE_UPLOAD_NOT_VERIFIED` evidence on timeout or failed state.

- [ ] **Step 5: Implement strict title/body write-readback and required fields**

  Fill the discovered title and body locators, read the same actual nodes, normalize both values, and require equality. Enumerate visible enabled required fields and require non-empty values. Do not use substring matching. Record exact selector and semantic evidence in the response.

- [ ] **Step 6: Implement publish-settings and final-control discovery without click**

  Read visible checkboxes/radios/selects and nearby labels into `REQUIRED`/`OPTIONAL`/`UNKNOWN` evidence without changing them. Enumerate visible enabled button/role-button candidates, filter publish labels while excluding save/draft/video-only controls, require exactly one, and record label/visibility/enabled/selector/unique/second-confirmation. Return `finalSubmitClickCount: 0`; no code path in `preparePublish` may call the final control’s `click`.

- [ ] **Step 7: Run focused adapter tests to verify GREEN**

  Run `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/index.test.ts tests/runtime-adapter-registry.test.ts`.

  Expected: PASS, with no warnings from the adapter tests and submit locator click count remaining zero.

### Task 3: Register the browser adapter and persist account identity safely

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/index.ts`
- Modify: `apps/desktop/src/main/adapter-registry.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `tests/runtime-adapter-registry.test.ts`
- Create: `tests/xiaohongshu-account-routing.test.ts`

**Interfaces:**
- Consumes: `XiaohongshuBrowserAdapter.getAccountProfile()`, `AccountProfile`, and existing `syncBrowserPlatformAccount()`.
- Produces: registry route `xiaohongshu/article -> XiaohongshuBrowserAdapter`; generic BrowserAutomation login/check paths that persist profile display name and reliable external ID.

- [ ] **Step 1: Add failing routing and identity persistence tests**

  Assert the runtime registry returns the browser adapter for `xiaohongshu` article, rejects `xiaohongshu` video, and keeps the formal key singular. Add two accounts with the same platform and distinct IDs; assert each context reaches its own session. Add an identity test that returns `{ accountId: undefined, accountName: "仅昵称", ... }` and verifies persisted `externalAccountId` remains `null`.

- [ ] **Step 2: Run the routing test to verify RED**

  Run `pnpm exec vitest run tests/xiaohongshu-account-routing.test.ts tests/runtime-adapter-registry.test.ts`.

  Expected: FAIL because the old adapter is still registered and IPC does not call the profile hook.

- [ ] **Step 3: Implement minimal registry and generic profile sync**

  Register `XiaohongshuBrowserAdapter` instead of the old ManualOnly class. In the existing generic BrowserAutomation branches for complete-login, refresh-login, and check-login, call `getAccountProfile` when available and pass only `accountName`, `externalAccountId`, and the existing `browserSessionIdHash` to `syncBrowserPlatformAccount`. Keep all platform selector logic inside each adapter.

- [ ] **Step 4: Run focused routing and account tests to verify GREEN**

  Run `pnpm exec vitest run tests/xiaohongshu-account-routing.test.ts tests/runtime-adapter-registry.test.ts tests/account-connection.test.ts packages/adapters/core/src/browser.test.ts`.

  Expected: PASS; the two accounts have different session keys/hashes, missing account IDs fail without fallback, and an expired A context does not open B.

### Task 4: Add standalone gate-only runner and evidence tests

**Files:**
- Create: `scripts/v142-xiaohongshu-gate-only.mts`
- Create: `scripts/v142-xiaohongshu-gate-only-entry.mjs`
- Create: `tests/v142-xiaohongshu-gate-only.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `SafeStorageCredentialStore`, `createRuntimeAdapterRegistry`, repository image fixture lookup, `XiaohongshuBrowserAdapter`, and explicit `XIAOHONGSHU_ACCOUNT_ID`.
- Produces: redacted JSON evidence at `output/v142-xiaohongshu-gate-only.json`; a gate runner that never calls Publisher or persistence APIs for Job/Intent/Record.

- [ ] **Step 1: Write failing runner/evidence tests**

  Test pure exported helpers for the exact title/body format, fixture selection, explicit-account resolution, required gate ordering, readiness calculation, and fixed `finalSubmitClickCount: 0`. Use a spy adapter/repository facade and assert no `createArticlePublishJob`, `prepareSubmissionIntent`, `insertPublishRecord`, `finalSubmit`, or `collectPublishResult` call occurs.

- [ ] **Step 2: Run runner tests to verify RED**

  Run `pnpm exec vitest run tests/v142-xiaohongshu-gate-only.test.ts`.

  Expected: FAIL because the runner and helper exports do not exist.

- [ ] **Step 3: Implement the runner and redacted evidence**

  Follow the existing Electron script pattern: set the known production userData path, wait for Electron readiness, open the production database with existing migrations, load safe credentials, construct the runtime registry, resolve exactly `XIAOHONGSHU_ACCOUNT_ID`, select an existing SELF_TEST/universal image, run the adapter checks in the specified order, capture evidence/screenshot under the account-specific debug path, and always close only owned sessions. Write only non-secret fields to JSON, including gate result/evidence, account ID, identity summary, session hash, `finalSubmitClickCount: 0`, `jobCreated: false`, `intentCreated: false`, `publishRecordCreated: false`, `publishPassed: "NOT_PASS"`, and readiness marker.

- [ ] **Step 4: Run runner tests to verify GREEN**

  Run `pnpm exec vitest run tests/v142-xiaohongshu-gate-only.test.ts`.

  Expected: PASS and static evidence confirms no final submit/persistence path is reachable from the runner.

### Task 5: Update state documentation and run all verification

**Files:**
- Modify: `PROJECT_STATE.md`
- Modify: `PLATFORMS.csv`
- Modify: `docs/PLATFORM_CAPABILITY_MATRIX.md`

**Interfaces:**
- Consumes: focused test output and, if owner runs it, `output/v142-xiaohongshu-gate-only.json`.
- Produces: auditable state that distinguishes code readiness/gate-only from `PublishPassed`.

- [ ] **Step 1: Add failing documentation assertions if needed**

  Extend the runtime/platform test to require `PLATFORMS.csv` transport `browser`, lifecycle `WaitingForUser`, and manifest article-only BrowserAutomation metadata for `xiaohongshu`.

- [ ] **Step 2: Run the platform assertion to verify RED**

  Run `pnpm exec vitest run tests/runtime-adapter-registry.test.ts`.

  Expected: FAIL while CSV and manifest still describe the old official SDK/video capability.

- [ ] **Step 3: Update platform metadata and PROJECT_STATE**

  Change only the canonical `xiaohongshu` row to `browser`, `WaitingForUser`, `BrowserAutomation` and article/image gate wording; leave `xiaohongshu_business` and `xiaohongshu_private` unchanged. Add a new top `PROJECT_STATE.md` section documenting code/test status, current account or `NOT_EXECUTED`, composite session proof, gate-only restrictions, output path, and `Final Submit Count = 0`. Do not mark `PublishPassed`.

- [ ] **Step 4: Run focused and full verification**

  Run, in order:

  - `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/index.test.ts tests/xiaohongshu-account-routing.test.ts tests/v142-xiaohongshu-gate-only.test.ts tests/runtime-adapter-registry.test.ts`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`

  Expected: all commands exit 0. Existing Weibo, Toutiao, Sohu, Zhihu and Baijiahao regression tests remain green.

- [ ] **Step 5: Run real gate-only only when an explicit account is available**

  Run the entry wrapper with `XIAOHONGSHU_ACCOUNT_ID=<explicit-account-id>` only if the owner has a currently logged-in account and normal platform verification is complete. Inspect the JSON for the complete gate table. If any required gate fails or security appears, keep the exact failure reason and do not retry/fallback. If all gates pass, report `XIAOHONGSHU_READY_FOR_REAL_SELF_TEST = YES` while retaining `PublishPassed = NOT_PASS` and zero submit count.
