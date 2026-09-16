# Toutiao Account Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Each task uses TDD: write the failing test, verify the failure, implement the smallest fix, then verify the focused and regression tests.

**Goal:** Route Toutiao account connection lifecycle operations to the existing article BrowserAutomation adapter, expose capability-driven Account Center actions, and preserve the official video API route.

**Architecture:** Keep `integrationMode=API` as the publish/integration capability for Toutiao video. Add an optional runtime-derived `Platform.accountConnectionMode` and an `AdapterRegistry` resolver for account lifecycle operations. The renderer consumes this separate capability, while the IPC layer uses the resolver for browser login, relogin, dashboard, session checks, and disconnect.

**Tech Stack:** TypeScript strict mode, Electron IPC, React, Vitest, Playwright Core abstractions, existing encrypted `CredentialStore`, SQLite repository views.

**Spec:** `docs/superpowers/specs/2026-08-25-toutiao-account-connection-design.md`

## Global Constraints

- Do not modify Toutiao official video API authentication, publishing, capability, or content routing.
- Do not create a second account system or a second Session persistence format.
- Use the existing encrypted `CredentialStore` key boundary `session:<platformKey>:<accountId>`.
- Browser login and relogin must use visible mode and require manual owner authentication.
- Never automate CAPTCHA, QR, SMS, password, or security verification.
- Account connection must not create a Job, PublishRecord, SubmissionIntent, or final-submit side effect.
- Keep `finalSubmitClicks` / `finalSubmitClickCount` at `0`.
- Do not run Toutiao Article SELF_TEST or publish during implementation.
- Do not write cookies, tokens, storage state, credentials, or Session contents to `PROJECT_STATE.md`, logs, or Git.
- Follow the repository’s required validation commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## File Map

- Modify `packages/domain/src/types.ts` to expose the optional account connection capability on `Platform`.
- Modify `packages/adapters/core/src/index.ts` to resolve account lifecycle adapters without changing content routing.
- Modify `packages/adapters/browser/src/index.ts` to close failed connection sessions safely while preserving previously stored Session data.
- Modify `apps/desktop/src/main/ipc.ts` to overlay runtime connection capability metadata and route account lifecycle IPC through the new resolver.
- Modify `apps/desktop/src/renderer/platform-connection-ui.ts` to derive actions from account connection capability and distinguish relogin from first connection.
- Modify `apps/desktop/src/renderer/V11Workspace.tsx` to use account connection capability for dashboard opening and connection/relogin labels.
- Modify `packages/adapters/core/src/index.test.ts` for same-key resolver behavior.
- Modify `packages/adapters/browser/src/index.test.ts` for failed-save cleanup and visible login lifecycle invariants.
- Modify `packages/adapters/toutiao/src/browser.test.ts` for Toutiao-specific connection/session loading and zero-submit behavior.
- Modify `tests/platform-connection-ui.test.ts` for capability-driven Toutiao actions.
- Add or modify a focused IPC/runtime test under `tests/` only if the existing IPC registration seam permits an isolated in-memory dependency fixture; otherwise cover the pure resolver and renderer decision paths without introducing a production-only test seam.
- Modify `PROJECT_STATE.md` only after implementation and verification, recording gates and scope without sensitive values.

### Task 1: Add account-connection resolution without changing content routing

**Files:**
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/adapters/core/src/index.ts`
- Test: `packages/adapters/core/src/index.test.ts`
- Test: `tests/v125-toutiao-content-routing.test.ts` if a regression assertion needs to be colocated with the existing dual-adapter fixture

**Interfaces:**
- Produces `Platform.accountConnectionMode?: PlatformCapability`.
- Produces `AdapterRegistry.getForConnection(platformKey: string): PlatformAdapter`.
- Produces `AdapterRegistry.tryGetForConnection(platformKey: string): PlatformAdapter | null`.
- Produces `AdapterRegistry.getAccountConnectionMode(platformKey: string): PlatformCapability | null`.
- Keeps `get(platformKey)` and `getForContent(platformKey, contentKind)` behavior unchanged.

- [ ] **Step 1: Write the failing resolver tests**

Extend the existing same-key registry test with a fixture where `videoAdapter` is the API adapter and `articleAdapter` is the BrowserAutomation adapter. Assert:

```ts
expect(registry.getForConnection("dual")).toBe(articleAdapter);
expect(registry.tryGetForConnection("missing")).toBeNull();
expect(registry.getAccountConnectionMode("dual")).toBe("BrowserAutomation");
expect(registry.getForContent("dual", "video")).toBe(videoAdapter);
expect(registry.getForContent("dual", "article")).toBe(articleAdapter);
```

Add a second fixture with two connection-capable adapters for one key and assert `getForConnection` throws an ambiguity error.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```text
pnpm exec vitest run packages/adapters/core/src/index.test.ts
```

Expected: fail because the new resolver methods and `Platform.accountConnectionMode` contract do not exist.

- [ ] **Step 3: Implement the minimal registry resolver**

In `AdapterRegistry`, inspect the registered adapters for one platform key by checking the shared automation contract (`connectAccount`, `completeConnection`, `checkSession`, and `openBackend`). Return the unique connection-capable adapter; throw `Multiple account connection adapters registered for platform: <key>` when more than one exists; otherwise return the existing `defaultAdapter`. Make `tryGetForConnection` return `null` for missing keys. Derive `accountConnectionMode` from the selected adapter manifest’s `integrationMode`, returning `null` when no adapter exists.

Do not alter `defaultAdapter`, `get`, `getForContent`, `list`, or `listAll` selection logic.

- [ ] **Step 4: Run focused and routing tests to verify GREEN**

Run:

```text
pnpm exec vitest run packages/adapters/core/src/index.test.ts tests/v125-toutiao-content-routing.test.ts
```

Expected: resolver and existing article/video routing tests pass.

- [ ] **Step 5: Refactor only after GREEN**

Keep the resolver predicate private and shared by `getForConnection`/`tryGetForConnection`; do not introduce a second registry or platform-specific branch.

### Task 2: Make browser connection failure fail closed and preserve old Session

**Files:**
- Modify: `packages/adapters/browser/src/index.ts`
- Test: `packages/adapters/browser/src/index.test.ts`
- Test: `packages/adapters/toutiao/src/browser.test.ts`

**Interfaces:**
- Preserves `AutomationAdapter.completeConnection(ctx): Promise<LoginStatus>`.
- On save failure, closes only the new owned visible session, clears its pending connection marker, rethrows the safe error, and leaves the existing credential-store value untouched.
- On save success, returns `logged_in` and closes the dedicated login session without creating publish artifacts.

- [ ] **Step 1: Write the failing save-failure test**

Add a BrowserAutomation lifecycle fixture whose `save` rejects with `Error("session save failed")`. Preload the credential fake with an old Session marker where possible, call `connectAccount`, then call `completeConnection`, and assert:

```ts
await expect(adapter.completeConnection(ctx)).rejects.toThrow("session save failed");
expect(manager.close).toHaveBeenCalledTimes(1);
expect(adapter.isConnectionPending(ctx)).toBe(false);
```

Add a Toutiao-specific test asserting `connectAccount` opens with `VISIBLE`, navigates to `https://mp.toutiao.com/`, and successful `completeConnection` invokes the existing save boundary. Assert no submit locator is clicked and the returned browser response keeps `finalSubmitClickCount` at `0` where applicable.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```text
pnpm exec vitest run packages/adapters/browser/src/index.test.ts packages/adapters/toutiao/src/browser.test.ts
```

Expected: the save-failure cleanup assertion fails because the current implementation leaves the pending session open when `sessionManager.save` rejects.

- [ ] **Step 3: Implement minimal cleanup around Session save**

In `BrowserAutomationAdapter.completeConnection`, keep login-page and verification-page checks before saving. Wrap only the save operation in a failure path that calls `closeActive(identity)` best-effort, removes the pending marker, and rethrows. After a successful save, remove the pending marker and close the owned session best-effort so a cleanup failure does not turn a successfully persisted Session into an account failure. Never call `sessionManager.clear` from this path.

- [ ] **Step 4: Run focused lifecycle tests to verify GREEN**

Run:

```text
pnpm exec vitest run packages/adapters/browser/src/index.test.ts packages/adapters/toutiao/src/browser.test.ts
```

Expected: visible login, failed login, save-failure cleanup, Session reload, and zero-submit tests pass.

- [ ] **Step 5: Confirm no publish side effects**

Keep the test fixture independent from `PublisherService`; verify the connection adapter methods do not receive article/video publish calls and no final-submit locator is clicked.

### Task 3: Route account IPC through the connection Adapter and expose runtime metadata

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`
- Test: add or modify a focused `tests/` runtime/IPC test only if the existing `registerIpc` dependency seam supports an in-memory repository, registry, credentials, logger, and Electron handler registry without launching the app

**Interfaces:**
- `platforms:list` returns each repository `Platform` with `accountConnectionMode` derived from `registry.tryGetForConnection(platformKey)`.
- `accounts:overview` uses the connection resolver for pending-browser detection and returns platform views containing the same field.
- Account lifecycle handlers use `registry.getForConnection`:
  `accounts:begin-login`, `accounts:complete-login`, `accounts:refresh-login`, `accounts:cancel-login`, `accounts:disconnect`, `accounts:open-backend`, and `accounts:check-login`.
- Credential configuration/status handlers remain on the default adapter so Toutiao video OAuth credentials stay intact.

- [ ] **Step 1: Write the failing runtime metadata and handler-selection test**

Using the existing dual-adapter fixture or a minimal equivalent, capture the `platforms:list` handler result and assert that the Toutiao row has the following shape:

```ts
const platform = platformsListResult.find((item) => item.platformKey === "toutiao");
expect(platform).toMatchObject({ integrationMode: "API", accountConnectionMode: "BrowserAutomation" });
expect(connectionAdapter).toBe(articleAdapter);
expect(videoAdapter.publishVideo).not.toHaveBeenCalled();
```

If IPC registration cannot be tested without Electron internals, keep the resolver assertion in `packages/adapters/core/src/index.test.ts` and add a pure helper test for the platform overlay; do not add a production-only test hook merely to satisfy this step.

- [ ] **Step 2: Run the focused test and verify RED**

Run the selected focused test command. Expected: fail because `Platform` has no runtime connection field and IPC still calls `registry.get`/`tryGet`.

- [ ] **Step 3: Implement a local platform-view overlay helper**

Inside `registerIpc`, add a typed helper named `listPlatformViews(): Platform[]` that maps `repository.listPlatforms()` and, when `registry.getAccountConnectionMode(platform.platformKey)` is non-null, returns `{ ...platform, accountConnectionMode }`. Use this helper in `platforms:list` and `accounts:overview` so both account-center paths see identical capability data. Keep repository storage unchanged.

- [ ] **Step 4: Switch only account lifecycle handlers to the new resolver**

Replace the adapter lookup in the account lifecycle handlers with `registry.getForConnection` and reuse a local adapter variable in handlers that currently call `registry.get` multiple times. Leave `accounts:set-credentials`, `accounts:credential-status`, Publisher, Scheduler, and content-kind routing on their existing selection paths.

Preserve existing account state transitions:

- begin connection: `needs_user_action`;
- successful browser completion: `syncBrowserPlatformAccount` → `logged_in`, enabled, encrypted Session hash only;
- incomplete login: `needs_user_action`;
- expired check: existing expired/paused mapping;
- disconnect: clear only the selected account’s browser Session and mark that account disconnected.

- [ ] **Step 5: Run focused runtime and regression tests to verify GREEN**

Run:

```text
pnpm exec vitest run packages/adapters/core/src/index.test.ts tests/v125-toutiao-content-routing.test.ts
```

Also run the nearest IPC/account tests discovered by `rg -n "accounts:begin-login|accounts:complete-login|accounts:open-backend|accounts:check-login" tests apps/desktop/src`.

Expected: Toutiao account operations select the article browser adapter while video execution remains on the official API adapter.

### Task 4: Render connection and relogin actions from capability metadata

**Files:**
- Modify: `apps/desktop/src/renderer/platform-connection-ui.ts`
- Modify: `apps/desktop/src/renderer/V11Workspace.tsx`
- Test: `tests/platform-connection-ui.test.ts`

**Interfaces:**
- `platformConnectionKind(platform)` prefers `platform.accountConnectionMode` and falls back to existing fields for older platforms.
- `platformConnectionActions(platform, row)` returns `重新登录` for `Expired`/`NeedsLogin`, `连接账号` for `NotConnected`, and the existing connected action set for `Connected`.
- V1.1 Account Center uses the account connection mode for `打开后台` and for the unconnected/relogin button label.

- [ ] **Step 1: Write the failing UI decision tests**

Extend `tests/platform-connection-ui.test.ts` with a Toutiao-shaped platform:

```ts
const toutiao = platform({
  platformKey: "toutiao",
  displayName: "头条号",
  transport: "official_api",
  integrationMode: "API",
  accountConnectionMode: "BrowserAutomation",
  authStrategy: "OAuth2"
});

expect(platformConnectionKind(toutiao)).toBe("browser");
expect(platformConnectionActions(toutiao, row({ platform: toutiao }))).toEqual([{ kind: "connect", label: "连接账号" }]);
expect(platformConnectionActions(toutiao, row({ platform: toutiao, accountStatus: "Expired" }))).toEqual([{ kind: "relogin", label: "重新登录" }]);
expect(platformConnectionActions(toutiao, row({ platform: toutiao, accountStatus: "Connected" }))).toEqual([
  { kind: "view-account", label: "查看账号" },
  { kind: "open-backend", label: "打开后台" },
  { kind: "relogin", label: "重新登录" }
]);
```

- [ ] **Step 2: Run the focused UI test and verify RED**

Run:

```text
pnpm exec vitest run tests/platform-connection-ui.test.ts
```

Expected: fail because the platform type and action logic do not yet read `accountConnectionMode`, and expired rows currently receive the first-connect action.

- [ ] **Step 3: Implement capability-driven UI decisions**

Update `platform-connection-ui.ts` to use a local connection-mode helper. Preserve blocked, not-implemented, manual, and OAuth behavior. Update browser actions so `Expired` and `NeedsLogin` return relogin.

Update `V11Workspace.tsx` so:

- dashboard opening checks the account connection capability, not only publish `integrationMode`;
- an existing expired/needs-login account shows `重新登录`;
- a never-connected account shows `连接账号`;
- no Toutiao-specific platform-key branch is introduced.

- [ ] **Step 4: Run focused UI and type tests to verify GREEN**

Run:

```text
pnpm exec vitest run tests/platform-connection-ui.test.ts
pnpm typecheck
```

Expected: all connection action tests pass and the renderer compiles in strict mode.

### Task 5: Update project state and complete verification

**Files:**
- Modify: `PROJECT_STATE.md`
- Inspect: `MANUAL_ACTIONS.md`
- Inspect: `docs/V0.6_VERIFICATION_PLAN.md`
- Inspect: `docs/V1.2.5_VERIFICATION_DELTA.md`

- [ ] **Step 1: Run the focused Toutiao/account suite**

Run:

```text
pnpm exec vitest run packages/adapters/core/src/index.test.ts packages/adapters/core/src/browser.test.ts packages/adapters/browser/src/index.test.ts packages/adapters/toutiao/src/browser.test.ts tests/platform-connection-ui.test.ts tests/v125-toutiao-content-routing.test.ts
```

Expected: resolver, Session lifecycle, Toutiao article adapter, UI action, and video-routing tests pass; no real browser or platform login is started by tests.

- [ ] **Step 2: Run the full required checks**

Run:

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands pass. If `pnpm test` rebuilds `better-sqlite3`, treat that native rebuild as an expected test step and use read-only SQLite inspection only if needed.

- [ ] **Step 3: Verify the safety boundary in source and test output**

Run:

```text
rg -n "finalSubmitClickCount|finalSubmitClicks|SubmissionIntent|PublishRecord|publish_jobs" packages/adapters/toutiao apps/desktop/src/main/ipc.ts tests
```

Confirm the connection path has no publisher/queue call, the Toutiao article adapter still reports zero final-submit clicks, and no real SELF_TEST or publish command was executed.

- [ ] **Step 4: Update `PROJECT_STATE.md` truthfully**

Add a new dated section recording:

- Account Center entry: code path enabled;
- Connect Account: implemented and test-covered;
- Visible browser/manual authentication: code path ready, owner action still required;
- Login detection and encrypted Session save/reload: test-covered;
- Relogin and dashboard reuse: code path and UI action test-covered;
- Article adapter Session loading: test-covered;
- Video API unaffected: routing regression passed;
- Job / PublishRecord / SubmissionIntent: not created;
- `finalSubmitClicks`: `0`.

Do not record account IDs, cookie values, tokens, credentials, storage state, or Session contents. Mark real manual login and live browser gates as pending owner action rather than PASS.

- [ ] **Step 5: Final report**

Report the requested gate table and conclude:

```text
READY_FOR_TOUTIAO_LOGIN=YES
```

Only claim this when code, typecheck, lint, tests, and build pass. Stop after reporting readiness; do not launch Toutiao Article SELF_TEST or publish.
