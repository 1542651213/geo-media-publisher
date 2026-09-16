# Xiaohongshu Long-Lived Browser Session Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Extend the shared BrowserSessionManager so Xiaohongshu keeps one account-scoped live BrowserContext across login/check/backend Page lifecycles, while preserving other platform behavior and all publish safety invariants.

**Architecture:** Add an explicit per-platform BrowserSession policy to the existing shared manager. The manager owns the canonical Context and operation Pages are created and closed independently; only Xiaohongshu retains the Context after a Page closes and requires an already-active Context for normal operations. Runtime authentication state is held in process memory and exposed to the account overview separately from the database’s historical login fields.

**Tech Stack:** TypeScript strict mode, Playwright Core 1.62.1, Electron 37, Vitest 3.2.4, pnpm 11.19.0, existing BrowserSessionManager, BrowserAutomationAdapter, Electron IPC, and renderer account-center helpers.

**Spec:** docs/superpowers/specs/2026-08-28-xiaohongshu-long-lived-browser-session-design.md

## Global Constraints

- Use the existing shared BrowserSessionManager; do not add a Xiaohongshu-specific second manager.
- Use exact platformKey + accountId identity for every session, Page, credential lookup, runtime state lookup, IPC operation, and removal operation.
- Only xiaohongshu enables retainContextAfterPageClose and requireActiveContextForOperations; Sohu, Toutiao, Weibo, Zhihu, Baijiahao, and other platforms keep their existing lifecycle.
- PAGE_CLOSED must not clear a retained Xiaohongshu Context or mark it expired; only a real browser disconnect/crash or explicit account-session close clears the runtime reference.
- Use only the Playwright APIs actually provided by the current objects: Browser.isConnected() and Browser disconnected; do not invent a BrowserContext disconnected event.
- Persistent profile is the canonical Xiaohongshu auth source; PERSISTENT_PROFILE_CREDENTIAL_REINJECTION = NO remains true.
- No cookie value, token, password, Authorization header, credential plaintext, request body, or response body may enter logs, diagnostics, or tests.
- No migration is needed for transient runtime state; do not modify production publish data or account archive semantics.
- This implementation round must not call preparePublish(), enter an editor, upload an image, write a title/body, run SELF_TEST, click a final CTA, or create a Job, SubmissionIntent, or PublishRecord.
- FINAL_SUBMIT_COUNT = 0, JOB_CREATED = NO, INTENT_CREATED = NO, and PUBLISH_RECORD_CREATED = NO; publish_jobs, submission_intents, and publish_records counts must remain equal before and after verification.
- Preserve all unrelated dirty Sohu, release, Toutiao, output, and installed-app files; stage only files named by the current task.
- Every production behavior change starts with a focused failing test and is followed by focused green verification before the next behavior is added.

## File Map

| File | Responsibility |
| --- | --- |
| packages/adapters/core/src/browser.ts | Shared policy, canonical Context registry, Page operations, concurrency guard, browser disconnect state, runtime auth state |
| packages/adapters/core/src/browser.test.ts | Manager lifecycle, singleton, Page isolation, disconnect, shutdown, and profile-policy tests |
| packages/adapters/core/src/automation.ts | Optional page-only release and runtime-state contracts for browser adapters |
| packages/adapters/browser/src/index.ts | Shared adapter integration with operation Pages, active-context requirement, and backward-compatible non-XHS release |
| packages/adapters/browser/src/index.test.ts | Generic adapter contract and non-XHS regression tests |
| packages/adapters/xiaohongshu/src/browser.ts | XHS login Page release, active-context checks, operation Page cleanup, and live state transitions |
| packages/adapters/xiaohongshu/src/browser.test.ts | XHS login/check/backend lifecycle and no-cold-restore operation tests |
| apps/desktop/src/main/adapter-registry.ts | Shared manager registration with XHS-only policy and live diagnostic logging |
| apps/desktop/src/main/ipc.ts | Page-only completion release and runtime-aware account overview state |
| packages/domain/src/types.ts | Public Unverified account status and runtime auth state type if required by IPC contracts |
| apps/desktop/src/shared/api.ts | AccountManagementRow runtime state contract |
| apps/desktop/src/renderer/v11-ui-model.ts | Runtime-aware account labels, online-account logic, and connection targeting |
| apps/desktop/src/renderer/platform-connection-ui.ts | Runtime-aware platform connection labels/actions |
| apps/desktop/src/renderer/V11Workspace.tsx | Prevent unverified historical DB state from enabling live-account actions |
| apps/desktop/src/renderer/PlatformConnectionCenter.tsx | Keep verification/relogin actions available for unverified rows |
| tests/platform-connection-ui.test.ts | Renderer status and action regression tests |
| tests/xiaohongshu-account-center-ui.test.ts | XHS account-center historical-vs-live status tests |
| tests/runtime-adapter-registry.test.ts | Registry and XHS policy wiring tests |
| tests/xiaohongshu-long-lived-browser-session.test.ts | Cross-package runtime lifecycle and publish-domain zero-side-effect tests |
| PROJECT_STATE.md | Final implementation/deployment/live-verification record only after code and installed-app evidence exist |

---

### Task 0: Capture a read-only implementation baseline

**Files:**
- Read: PROJECT_STATE.md
- Read: packages/adapters/core/src/browser.ts
- Read: packages/adapters/browser/src/index.ts
- Read: packages/adapters/xiaohongshu/src/browser.ts
- Read: apps/desktop/src/main/adapter-registry.ts
- Read: apps/desktop/src/main/ipc.ts
- Read: packages/db/src/repository.ts

**Interfaces:**
- Consumes: current branch and current working tree.
- Produces: saved baseline of branch, dirty paths, installed app path, production DB path, target profile path, and publish-domain counts.

- [ ] Step 1: Record branch and dirty-path baseline without modifying files.

~~~powershell
git branch --show-current
git status --short --untracked-files=all
git log -3 --oneline
~~~

- [ ] Step 2: Record installed-app, production-data, and target-profile paths.

~~~powershell
Get-Item 'C:\GMP116ZhihuL5\Geo Media Publisher\Geo Media Publisher.exe'
Get-Item 'C:\Users\Administrator\AppData\Roaming\codex-media-publisher\production-data\publisher.db'
Get-Item 'C:\Users\Administrator\AppData\Roaming\codex-media-publisher\browser-profiles\xiaohongshu\54b390ac-d81e-440a-baeb-d00f9f346cc3'
~~~

- [ ] Step 3: Record publish-domain counts with existing read-only DB tooling.

~~~powershell
node -e 'const Database = require("better-sqlite3"); const db = new Database("C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data/publisher.db", { readonly: true }); const tables = ["publish_jobs", "submission_intents", "publish_records"]; console.log(JSON.stringify(Object.fromEntries(tables.map((table) => [table, db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count])))); db.close();'
~~~

Expected: the command reads only the production DB and records the three before counts. If this script is not present, use an existing inspection script found by rg --files scripts | rg 'production|inspect|db'; do not create a new production-data writer.

- [ ] Step 4: Verify no production source file is staged before implementation.

~~~powershell
git diff --cached --name-only
~~~

Expected: only the already committed design document is present, or the output is empty.

### Task 1: Add XHS policy and Page/Context lifecycle primitives

**Files:**
- Modify: packages/adapters/core/src/browser.ts
- Test: packages/adapters/core/src/browser.test.ts

**Interfaces:**
- Consumes: BrowserSessionIdentity, BrowserSession, current open(), close(), and getActiveSession().
- Produces: BrowserSessionPlatformPolicy, BrowserRuntimeAuthState, BrowserSessionOperationPage, openOperationPage(), closeOperationPage(), retainsContextAfterPageClose(), and requiresActiveContextForOperations().

- [ ] Step 1: Write the failing manager test for same-Context operation Pages and Page-only close.

~~~typescript
it("closes an XHS operation Page without closing its canonical Context", async () => {
  const firstPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
  const secondPage = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
  const context = {
    setDefaultTimeout: vi.fn(),
    newPage: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage),
    pages: vi.fn(() => [firstPage, secondPage]),
    close: vi.fn(async () => undefined)
  } as unknown as BrowserContext;
  const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
  const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
    launchBrowser: vi.fn(async () => browser),
    platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } }
  });
  const identity = { platformKey: "xiaohongshu", accountId: "account-a" };

  const session = await manager.open(identity, userAction);
  const operation = await manager.openOperationPage(identity, userAction);
  await manager.closeOperationPage(identity, operation.page);

  expect(operation.session).toBe(session);
  expect(operation.page).not.toBe(firstPage);
  expect(operation.page.close).toHaveBeenCalledTimes(1);
  expect(context.close).not.toHaveBeenCalled();
  expect(manager.getActiveSession(identity)).toBe(session);
});
~~~

- [ ] Step 2: Run the focused test and verify it fails because the new manager API is absent.

~~~powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts -t "closes an XHS operation Page"
~~~

Expected: FAIL with a missing policy or operation-Page implementation, not a test setup error.

- [ ] Step 3: Add the minimal policy and Page-operation contracts.

~~~typescript
export type BrowserRuntimeAuthState = "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED";

export interface BrowserSessionPlatformPolicy {
  retainContextAfterPageClose: boolean;
  requireActiveContextForOperations: boolean;
}

export interface BrowserSessionOperationPage {
  session: BrowserSession;
  page: Page;
  pageDebugId: string;
}

export interface BrowserSessionRuntimeState {
  state: BrowserRuntimeAuthState;
  contextDebugId: string | null;
  updatedAt: string;
  reason: string | null;
}
~~~

Extend BrowserSessionManagerOptions with:

~~~typescript
platformPolicies?: Readonly<Record<string, Partial<BrowserSessionPlatformPolicy>>>;
~~~

Implement openOperationPage() by obtaining the existing session through open(), creating one Page with session.context.newPage(), assigning a process-memory pageDebugId, and returning the session, Page, and debug id. Implement closeOperationPage() by validating that the Page belongs to the exact session Context, calling only page.close(), and never calling context.close().

- [ ] Step 4: Add policy lookup and retain the existing non-XHS default.

~~~typescript
private policy(platformKey: string): BrowserSessionPlatformPolicy {
  return {
    retainContextAfterPageClose: this.options.platformPolicies?.[platformKey]?.retainContextAfterPageClose ?? false,
    requireActiveContextForOperations: this.options.platformPolicies?.[platformKey]?.requireActiveContextForOperations ?? false
  };
}

retainsContextAfterPageClose(identity: BrowserSessionIdentity): boolean {
  return this.policy(identity.platformKey).retainContextAfterPageClose;
}

requiresActiveContextForOperations(identity: BrowserSessionIdentity): boolean {
  return this.policy(identity.platformKey).requireActiveContextForOperations;
}
~~~

- [ ] Step 5: Run the focused manager test and existing core browser tests.

~~~powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts -t "closes an XHS operation Page|persistent profile|active Page"
~~~

Expected: PASS, with existing non-XHS tests unchanged.

- [ ] Step 6: Commit only the core lifecycle change.

~~~powershell
git add -- packages/adapters/core/src/browser.ts packages/adapters/core/src/browser.test.ts
git commit -m "feat: separate browser page and context lifecycles"
~~~

### Task 2: Add concurrency guard, actual Browser disconnect handling, and runtime state

**Files:**
- Modify: packages/adapters/core/src/browser.ts
- Test: packages/adapters/core/src/browser.test.ts

**Interfaces:**
- Consumes: Task 1 policy and Page primitives.
- Produces: one in-flight Context creation per session key, setRuntimeAuthState(), getRuntimeAuthState(), and disconnect cleanup based on real Browser APIs.

- [ ] Step 1: Write the failing concurrent-open test.

~~~typescript
it("deduplicates concurrent XHS Context creation by platform and account", async () => {
  let releaseLaunch: (() => void) | undefined;
  const launchGate = new Promise<void>((resolve) => { releaseLaunch = resolve; });
  const page = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank") };
  const context = { browser: vi.fn(() => browser), setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), pages: vi.fn(() => [page]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
  const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined), isConnected: vi.fn(() => true) } as unknown as Browser;
  const launchPersistentContext = vi.fn(async () => { await launchGate; return context; });
  const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
    browserProfileRootDir: "C:\\temp\\browser-profiles",
    persistentProfilePlatforms: ["xiaohongshu"],
    platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } },
    launchPersistentContext
  } as never);
  const identity = { platformKey: "xiaohongshu", accountId: "account-concurrent" };

  const first = manager.open(identity, userAction);
  const second = manager.open(identity, userAction);
  releaseLaunch?.();
  const sessions = await Promise.all([first, second]);

  expect(sessions[0]).toBe(sessions[1]);
  expect(launchPersistentContext).toHaveBeenCalledTimes(1);
});
~~~

- [ ] Step 2: Run the concurrent test and verify two launches occur before implementation.

~~~powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts -t "deduplicates concurrent XHS Context creation"
~~~

Expected: FAIL with launch count 2 or equivalent missing pending-creation behavior.

- [ ] Step 3: Add a per-key pending Promise map and remove it in finally.

~~~typescript
private readonly pendingOpenPromises = new Map<string, Promise<BrowserSession>>();

async open(identity: BrowserSessionIdentity, action: UserInitiatedAction, executionMode: BrowserExecutionMode = "VISIBLE"): Promise<BrowserSession> {
  assertExternalLaunchAllowed(action);
  const key = browserSessionCredentialKey(identity);
  const existing = this.getActiveSession(identity);
  if (existing?.executionMode === executionMode) return existing;
  if (existing) await this.close(existing);
  const pending = this.pendingOpenPromises.get(key);
  if (pending) return pending;
  const creation = this.openFresh(identity, action, executionMode);
  this.pendingOpenPromises.set(key, creation);
  try {
    return await creation;
  } finally {
    if (this.pendingOpenPromises.get(key) === creation) this.pendingOpenPromises.delete(key);
  }
}
~~~

Move the current launch body into openFresh() without changing credential/profile behavior. If an active session exists with a different execution mode, close that exact session before openFresh() as the current implementation does.

- [ ] Step 4: Write the failing runtime-state test for Page close versus Browser disconnect.

~~~typescript
it("keeps authenticated runtime state after Page close and clears it on Browser disconnect", async () => {
  let disconnected: (() => void) | undefined;
  const page = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank"), close: vi.fn(async () => undefined) };
  const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), pages: vi.fn(() => [page]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
    isConnected: vi.fn(() => true),
    on: vi.fn((event: string, listener: () => void) => { if (event === "disconnected") disconnected = listener; })
  } as unknown as Browser;
  const manager = new BrowserSessionManager(new MemoryCredentialStore(), {
    launchBrowser: vi.fn(async () => browser),
    platformPolicies: { xiaohongshu: { retainContextAfterPageClose: true, requireActiveContextForOperations: true } }
  });
  const identity = { platformKey: "xiaohongshu", accountId: "account-disconnect" };
  const session = await manager.open(identity, userAction);
  manager.setRuntimeAuthState(identity, "AUTHENTICATED", null);
  await manager.closeOperationPage(identity, session.page);

  expect(manager.getActiveSession(identity)).toBe(session);
  expect(manager.getRuntimeAuthState(identity).state).toBe("AUTHENTICATED");
  disconnected?.();
  expect(manager.getActiveSession(identity)).toBeNull();
  expect(manager.getRuntimeAuthState(identity).state).toBe("DISCONNECTED");
});
~~~

- [ ] Step 5: Run the new runtime-state test and verify the failure is about missing disconnect/state behavior.

~~~powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts -t "keeps authenticated runtime state"
~~~

Expected: FAIL because runtime state and Browser disconnect registration are not implemented.

- [ ] Step 6: Implement actual Browser disconnect observation without inventing a Context event.

Use the Browser object returned by context.browser() and attach a listener to its real disconnected event. Guard test doubles at runtime with a callable check. On the event, clear the active session only if the map still points to the same session, set runtime state to DISCONNECTED, and emit a lifecycle event with a new CONTEXT_DISCONNECTED phase. In getActiveSession(), use browser.isConnected() when provided and catch context.pages() failures; an empty pages() result alone is not a disconnect for retained XHS sessions.

~~~typescript
setRuntimeAuthState(identity: BrowserSessionIdentity, state: BrowserRuntimeAuthState, reason: string | null): void {
  const session = this.activeSessions.get(browserSessionCredentialKey(identity));
  this.runtimeStates.set(browserSessionCredentialKey(identity), { state, contextDebugId: session?.contextDebugId ?? null, updatedAt: new Date().toISOString(), reason });
}

getRuntimeAuthState(identity: BrowserSessionIdentity): BrowserSessionRuntimeState {
  return this.runtimeStates.get(browserSessionCredentialKey(identity)) ?? { state: "UNVERIFIED", contextDebugId: null, updatedAt: new Date(0).toISOString(), reason: null };
}
~~~

Do not log or persist browser storage values. Explicit close() and closeAll() must set the affected runtime state to UNVERIFIED and remove pending-open entries for affected keys.

- [ ] Step 7: Add shutdown and account-isolation tests.

~~~typescript
it("closes only owned contexts during shutdown and leaves different accounts isolated", async () => {
  const pageA = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank") };
  const pageB = { isClosed: vi.fn(() => false), url: vi.fn(() => "about:blank") };
  const contextA = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => pageA), pages: vi.fn(() => [pageA]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
  const contextB = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => pageB), pages: vi.fn(() => [pageB]), close: vi.fn(async () => undefined) } as unknown as BrowserContext;
  const browser = { newContext: vi.fn().mockResolvedValueOnce(contextA).mockResolvedValueOnce(contextB), isConnected: vi.fn(() => true), close: vi.fn(async () => undefined) } as unknown as Browser;
  const manager = new BrowserSessionManager(new MemoryCredentialStore(), { launchBrowser: vi.fn(async () => browser) });

  const accountA = await manager.open({ platformKey: "xiaohongshu", accountId: "a" }, userAction);
  const accountB = await manager.open({ platformKey: "xiaohongshu", accountId: "b" }, userAction);
  await manager.closeOperationPage({ platformKey: "xiaohongshu", accountId: "a" }, accountA.page);

  expect(manager.getActiveSession({ platformKey: "xiaohongshu", accountId: "b" })).toBe(accountB);
  await manager.closeAll();
  expect(contextA.close).toHaveBeenCalledTimes(1);
  expect(contextB.close).toHaveBeenCalledTimes(1);
});
~~~

- [ ] Step 8: Run the complete core browser test file and commit.

~~~powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts
git add -- packages/adapters/core/src/browser.ts packages/adapters/core/src/browser.test.ts
git commit -m "feat: guard browser sessions and track live auth state"
~~~

### Task 3: Integrate operation Pages into the shared browser adapter contract

**Files:**
- Modify: packages/adapters/core/src/automation.ts
- Modify: packages/adapters/browser/src/index.ts
- Test: packages/adapters/browser/src/index.test.ts

**Interfaces:**
- Consumes: Task 1/2 manager methods.
- Produces: optional releaseConnectionPage, getBrowserRuntimeState, active-context-only getOrOpen() behavior for policy-enabled platforms, and unchanged context-closing behavior for other platforms.

- [ ] Step 1: Write failing adapter contract tests.

Add these tests beside the existing definition, context(), and fixture() helpers in packages/adapters/browser/src/index.test.ts:

~~~typescript
it("does not cold-open a policy-enabled account for a normal backend operation", async () => {
  const open = vi.fn(async () => { throw new Error("cold open must not run"); });
  const manager = {
    getActiveSession: vi.fn(() => null),
    requiresActiveContextForOperations: vi.fn(() => true),
    hasStoredSession: vi.fn(() => true),
    open,
    getRuntimeAuthState: vi.fn(() => ({ state: "UNVERIFIED", contextDebugId: null, updatedAt: new Date(0).toISOString(), reason: null }))
  } as unknown as BrowserSessionManager;
  const adapter = new BrowserAutomationAdapter({ ...definition, platformKey: "xiaohongshu" }, { sessionManager: manager });
  const ctx = { ...context(), platformKey: "xiaohongshu" };

  await expect(adapter.openBackend(ctx)).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED" });
  expect(open).not.toHaveBeenCalled();
});

it("keeps the legacy context-closing release for ordinary browser platforms", async () => {
  const fixtureState = fixture(false, true);

  await fixtureState.adapter.releaseConnectionSession(context());
  expect(fixtureState.manager.close).toHaveBeenCalledTimes(1);
});
~~~

- [ ] Step 2: Run the focused adapter tests and confirm they fail on current cold-open/release behavior.

~~~powershell
pnpm exec vitest run packages/adapters/browser/src/index.test.ts -t "policy-enabled account|legacy context-closing release"
~~~

- [ ] Step 3: Extend AutomationAdapter with optional lifecycle evidence methods.

~~~typescript
import type { BrowserSessionRuntimeState } from "./browser";

releaseConnectionPage?(ctx: AccountContext): Promise<void>;
getBrowserRuntimeState?(ctx: AccountContext): BrowserSessionRuntimeState;
~~~

Keep releaseConnectionSession unchanged for existing adapters. The new method is implemented only by Xiaohongshu, so IPC can choose Page-only release by capability without changing other platform business logic.

- [ ] Step 4: Make the shared adapter use the manager’s active-context policy.

In getOrOpen(), return null when requiresActiveContextForOperations(identity) is true and no active session exists. Keep cold opening for platforms without that policy and for the explicitly named diagnostic helper. In openBackendPage(), if the policy is enabled, call sessionManager.openOperationPage() on the active session; otherwise keep the current session.page behavior. Expose manager runtime state through getBrowserRuntimeState(). The adapter’s active-session lookup must stop treating a closed Page as a closed session when the manager policy retains the Context. For ordinary platforms retain the existing page-closed cleanup.

~~~typescript
protected async getOrOpen(ctx: AccountContext): Promise<BrowserSession | null> {
  const executionMode = browserExecutionModeFromSettings(ctx.settings);
  const identity = this.identity(ctx);
  const active = this.activeSession(identity);
  if (active?.executionMode === executionMode) return active;
  if (this.sessionManager.requiresActiveContextForOperations(identity)) return null;
  if (active) await this.closeActive(identity);
  if (!this.sessionManager.hasStoredSession(identity)) return null;
  const session = await this.sessionManager.open(identity, userInitiatedActionFromSettings(ctx.settings), executionMode);
  this.rememberActiveSession(identity, session);
  return session;
}
~~~

- [ ] Step 5: Run focused adapter tests and existing browser adapter tests.

~~~powershell
pnpm exec vitest run packages/adapters/browser/src/index.test.ts
pnpm exec vitest run packages/adapters/core/src/index.test.ts packages/adapters/browser/src/index.test.ts
~~~

- [ ] Step 6: Commit only the shared adapter contract and integration.

~~~powershell
git add -- packages/adapters/core/src/automation.ts packages/adapters/browser/src/index.ts packages/adapters/browser/src/index.test.ts
git commit -m "feat: expose account browser page lifecycle contract"
~~~

### Task 4: Wire the XHS-only policy and page-release evidence

**Files:**
- Modify: apps/desktop/src/main/adapter-registry.ts
- Modify: packages/adapters/browser/src/index.ts
- Modify: packages/adapters/xiaohongshu/src/browser.ts
- Modify: packages/adapters/xiaohongshu/src/browser.test.ts
- Modify: tests/runtime-adapter-registry.test.ts

**Interfaces:**
- Consumes: Task 2 manager policy/runtime state and Task 3 optional adapter methods.
- Produces: XHS-only policy registration, releaseConnectionPage(), explicit LOGIN_PAGE_RELEASED evidence, and stable same-account connection diagnostics.

- [ ] Step 1: Write the failing XHS release test.

Extend the existing setupPage() fixture before adding this test so its fake manager implements openOperationPage(), closeOperationPage(), getActiveSession(), setRuntimeAuthState(), and getRuntimeAuthState(). Its operation-page factory must return a distinct Page object on each call while keeping the same fake Context object, and closeOperationPage() must call only the requested Page.close().

~~~typescript
it("releases only the XHS login Page after persistence and retains the canonical Context", async () => {
  const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
  installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理"] });
  vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(false);
  const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
  const ctx = context("account-a");

  await adapter.connectAccount(ctx);
  await expect(adapter.completeConnection(ctx)).resolves.toBe("logged_in");
  await adapter.getAccountProfile(ctx);
  await adapter.persistConnectionSession(ctx);
  await adapter.releaseConnectionPage?.(ctx);

  expect(fixture.page.close).toHaveBeenCalledTimes(1);
  expect(fixture.manager.close).not.toHaveBeenCalled();
  expect(fixture.manager.getActiveSession?.({ platformKey: "xiaohongshu", accountId: "account-a" })).toBeDefined();
});
~~~

- [ ] Step 2: Run the focused XHS test and verify the current implementation closes the full session or lacks the method.

~~~powershell
pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts -t "releases only the XHS login Page"
~~~

- [ ] Step 3: Register the XHS-only manager policy.

~~~typescript
const browserSessionManager = new BrowserSessionManager(credentials, {
  onRuntimeEvent: onBrowserRuntimeEvent,
  onSessionLifecycle: onBrowserSessionLifecycle,
  browserProfileRootDir,
  persistentProfilePlatforms: ["xiaohongshu"],
  persistentProfileCredentialSnapshotPlatforms: [],
  platformPolicies: {
    xiaohongshu: {
      retainContextAfterPageClose: true,
      requireActiveContextForOperations: true
    }
  }
});
~~~

- [ ] Step 4: Add XHS Page-only release and mark runtime authentication only after persistence succeeds.

Implement releaseConnectionPage(ctx) to obtain the exact active session, close only its current login Page through closeOperationPage(), retain the Context, clear the pending login marker, and emit a sanitized LOGIN_PAGE_RELEASED diagnostic. Do not call sessionManager.close() or sessionManager.clear().

Update persistConnectionSession() in this order:

~~~typescript
await this.saveConnectionSession(ctx);
await this.emitAuthStateDiagnostic(ctx, "AUTH_STATE_BEFORE_CLOSE", null, null, null);
this.markConnectionComplete({ platformKey: this.platformKey, accountId: ctx.accountId });
this.sessionManager.setRuntimeAuthState({ platformKey: this.platformKey, accountId: ctx.accountId }, "AUTHENTICATED", null);
~~~

Make finishConnection() and connection-diagnostic emission protected only if the subclass needs them; do not make credential or Page internals public.

- [ ] Step 5: Extend sanitized diagnostics and assert registry wiring.

Add a LOGIN_PAGE_RELEASED diagnostic phase containing only existing non-secret identity fields, Page-closed state, Context/Page counts, and a boolean sessionRetainedAfterPageClose. Add tests that the XHS adapter uses the same manager instance for begin/complete/release and that no non-XHS policy entry is registered.

~~~typescript
expect(diagnostics.at(-1)).toMatchObject({ phase: "LOGIN_PAGE_RELEASED", sessionRetainedAfterPageClose: true, platformKey: "xiaohongshu", accountId: "account-a" });
expect(diagnostics.flatMap((item) => Object.keys(item))).not.toContain("storageState");
~~~

- [ ] Step 6: Run focused XHS and registry tests, then commit.

~~~powershell
pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts -t "login Page|same active Page|diagnostic"
pnpm exec vitest run tests/runtime-adapter-registry.test.ts
git add -- apps/desktop/src/main/adapter-registry.ts packages/adapters/browser/src/index.ts packages/adapters/xiaohongshu/src/browser.ts packages/adapters/xiaohongshu/src/browser.test.ts tests/runtime-adapter-registry.test.ts
git commit -m "feat: retain xiaohongshu context after login page close"
~~~

### Task 5: Make XHS checkLogin, profile, and backend operations reuse the active Context

**Files:**
- Modify: packages/adapters/xiaohongshu/src/browser.ts
- Test: packages/adapters/xiaohongshu/src/browser.test.ts
- Test: tests/xiaohongshu-long-lived-browser-session.test.ts

**Interfaces:**
- Consumes: Task 3 active-context policy and Task 4 XHS runtime state.
- Produces: temporary check/profile Pages in the canonical Context, no normal-operation cold restore, and a diagnostic-only cold restore path preserved for existing restart diagnostics.

- [ ] Step 1: Write failing tests for two same-context checks with separate Pages.

Extend the existing XHS setupPage() fixture with a queue of distinct operation Pages, a shared contextDebugId, per-Page pageDebugId values, operationPageDebugIds: string[], operationContextDebugIds: string[], and a manager openOperationPage() fake that records those arrays before returning the shared session. The fixture’s manager.open() must remain the only Context-launch spy.

~~~typescript
it("runs repeated XHS checkLogin calls on one Context and closes each operation Page", async () => {
  const fixture = setupPage({ pageUrl: "https://creator.xiaohongshu.com/new/home" });
  installPageEvidence(fixture, { positiveSignals: ["发布笔记", "笔记管理", "账号状态正常"] });
  const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });
  const ctx = context("account-a");

  await adapter.connectAccount(ctx);
  await adapter.completeConnection(ctx);
  await adapter.getAccountProfile(ctx);
  await adapter.persistConnectionSession(ctx);
  await adapter.releaseConnectionPage?.(ctx);
  const first = await adapter.checkLogin(ctx);
  const second = await adapter.checkLogin(ctx);

  expect(first).toBe("logged_in");
  expect(second).toBe("logged_in");
  expect(fixture.operationPageDebugIds).toHaveLength(2);
  expect(fixture.operationContextDebugIds[0]).toBe(fixture.operationContextDebugIds[1]);
  expect(fixture.operationPageDebugIds[0]).not.toBe(fixture.operationPageDebugIds[1]);
  expect(fixture.manager.open).toHaveBeenCalledTimes(1);
});
~~~

- [ ] Step 2: Run the test and verify current code reuses a stale Page or cold-opens a Context.

~~~powershell
pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts -t "repeated XHS checkLogin calls"
~~~

- [ ] Step 3: Implement active-context-only checkLogin() with finally Page cleanup.

When no active Context exists, return needs_user_action even if encrypted stored session data exists. When active, call openOperationPage() on the exact identity, set runtime state to CHECKING, navigate and evaluate the real XHS page, map logged_in to AUTHENTICATED, map expired or needs_user_action to NEEDS_USER_ACTION, and close only the temporary Page in finally.

~~~typescript
const identity = { platformKey: this.platformKey, accountId: ctx.accountId };
const active = this.activeBrowserSession(ctx);
if (!active) {
  this.sessionManager.setRuntimeAuthState(identity, "NEEDS_USER_ACTION", "ACTIVE_CONTEXT_REQUIRED");
  return "needs_user_action";
}
const opened = await this.sessionManager.openOperationPage(identity, userInitiatedActionFromSettings(ctx.settings), browserExecutionModeFromSettings(ctx.settings));
this.sessionManager.setRuntimeAuthState(identity, "CHECKING", null);
try {
  const status = await this.loginStatusForPage(ctx, opened.page, "CHECK_LOGIN");
  const state = status === "logged_in" ? "AUTHENTICATED" : status === "unknown" ? "UNVERIFIED" : "NEEDS_USER_ACTION";
  this.sessionManager.setRuntimeAuthState(identity, state, status === "logged_in" ? null : status);
  return status;
} finally {
  await this.sessionManager.closeOperationPage(identity, opened.page);
}
~~~

- [ ] Step 4: Refactor XHS profile and backend access without changing publish selectors.

When login is still pending, getAccountProfile() reads the Owner login Page already held by the canonical Context. Otherwise it obtains a temporary operation Page from the active Context, reads identity, and closes that Page in finally. openBackendPage() obtains a new operation Page from the active Context and leaves it open only for the explicit user-facing backend operation. preparePublish() remains untouched except that it now receives the active-context-only backend Page; it must not be called by this task’s tests or live run.

- [ ] Step 5: Preserve the existing restart diagnostic as an explicit diagnostic-only path.

Keep openDiagnosticSession() allowed to call sessionManager.open() only because the caller is the already-deployed, user-triggered restart diagnosis. Keep that branch out of checkLogin(), getAccountProfile() normal calls, openBackend(), and publishing. Add a test proving checkLogin() does not call open() when a stored session exists but no active Context exists.

~~~typescript
it("does not cold-open XHS checkLogin from stored credentials", async () => {
  const fixture = setupPage();
  vi.mocked(fixture.manager.hasStoredSession).mockReturnValue(true);
  vi.mocked(fixture.manager.getActiveSession).mockReturnValue(null);
  const adapter = new XiaohongshuBrowserAdapter({ sessionManager: fixture.manager });

  await expect(adapter.checkLogin(context("account-a"))).resolves.toBe("needs_user_action");
  expect(fixture.manager.open).not.toHaveBeenCalled();
});
~~~

- [ ] Step 6: Run XHS focused tests, including existing routing and restart-diagnostic tests.

~~~powershell
pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts
pnpm exec vitest run tests/xiaohongshu-account-routing.test.ts tests/xiaohongshu-auth-state-restart-diagnosis.test.ts
~~~

- [ ] Step 7: Commit the XHS operation lifecycle.

~~~powershell
git add -- packages/adapters/xiaohongshu/src/browser.ts packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-long-lived-browser-session.test.ts
git commit -m "feat: reuse xiaohongshu context for account operations"
~~~

### Task 6: Update IPC and account-center UI to distinguish historical login from live verification

**Files:**
- Modify: packages/domain/src/types.ts
- Modify: apps/desktop/src/shared/api.ts
- Modify: apps/desktop/src/main/ipc.ts
- Modify: apps/desktop/src/renderer/v11-ui-model.ts
- Modify: apps/desktop/src/renderer/platform-connection-ui.ts
- Modify: apps/desktop/src/renderer/V11Workspace.tsx
- Modify: apps/desktop/src/renderer/PlatformConnectionCenter.tsx
- Test: tests/platform-connection-ui.test.ts
- Test: tests/xiaohongshu-account-center-ui.test.ts

**Interfaces:**
- Consumes: BrowserRuntimeAuthState and BrowserSessionRuntimeState from core; optional AutomationAdapter.getBrowserRuntimeState().
- Produces: AccountManagementRow.runtimeAuthState, AccountStatus=Unverified, runtime-aware account status, and UI behavior that never treats XHS DB logged_in alone as live online.

- [ ] Step 1: Write failing UI-model tests for historical logged-in versus live authenticated.

Update the existing row() helper in tests/xiaohongshu-account-center-ui.test.ts to accept a Partial<AccountManagementRow> override, initialize runtimeAuthState to null, and set Account.loginStatus to logged_in for both Connected and Unverified rows. Then add:

~~~typescript
it("labels a historical XHS login as unverified and excludes it from online accounts", () => {
  const historical = row("account-1", "Unverified", { runtimeAuthState: "UNVERIFIED" });

  expect(accountStatusLabel(historical)).toBe("待验证");
  expect(isOnlineAccount(historical)).toBe(false);
});

it("counts an XHS account online only after the canonical Context is authenticated", () => {
  const live = row("account-1", "Connected", { runtimeAuthState: "AUTHENTICATED" });

  expect(accountStatusLabel(live)).toBe("已连接");
  expect(isOnlineAccount(live)).toBe(true);
});
~~~

- [ ] Step 2: Run the UI tests and verify the new status behavior is missing.

~~~powershell
pnpm exec vitest run tests/platform-connection-ui.test.ts tests/xiaohongshu-account-center-ui.test.ts -t "historical XHS login|canonical Context"
~~~

- [ ] Step 3: Add the type-level runtime status contract.

Add Unverified to AccountStatus and add this field to AccountManagementRow:

~~~typescript
runtimeAuthState: "UNVERIFIED" | "CHECKING" | "AUTHENTICATED" | "NEEDS_USER_ACTION" | "DISCONNECTED" | null;
~~~

Keep Account.loginStatus unchanged; it remains the persisted historical field.

- [ ] Step 4: Change only XHS account overview derivation and login completion release.

In accounts:complete-login, call releaseConnectionPage?.(effectiveContext) when the adapter provides it; otherwise call the existing releaseConnectionSession?.(effectiveContext). This preserves context-closing behavior for every adapter without a Page-only capability.

In accounts:overview, read the optional runtime state. For XHS, authenticated runtime state maps to Connected; CHECKING maps to Connecting; NEEDS_USER_ACTION or DISCONNECTED maps to NeedsLogin; otherwise a persisted logged_in account maps to Unverified. Return runtimeAuthState without updating the DB.

- [ ] Step 5: Update renderer helpers and guards.

Use runtimeAuthState for XHS labels and online checks:

~~~typescript
export const isOnlineAccount = (account: Pick<Account, "enabled" | "loginStatus" | "platformKey"> & { accountStatus?: string; runtimeAuthState?: string | null }): boolean =>
  account.enabled
  && (account.platformKey !== "xiaohongshu" || account.runtimeAuthState === "AUTHENTICATED")
  && (account.loginStatus === "logged_in" || account.accountStatus === "Connected");
~~~

Render Unverified as “待验证” and keep “验证登录” and “重新登录” available. Disable “打开后台” and publish entry points unless accountStatus is Connected. Do not change action labels or lifecycle logic for non-XHS rows.

- [ ] Step 6: Run the UI and type-focused tests.

~~~powershell
pnpm exec vitest run tests/platform-connection-ui.test.ts tests/xiaohongshu-account-center-ui.test.ts
pnpm typecheck
~~~

- [ ] Step 7: Commit the IPC/UI truthfulness change.

~~~powershell
git add -- packages/domain/src/types.ts apps/desktop/src/shared/api.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/v11-ui-model.ts apps/desktop/src/renderer/platform-connection-ui.ts apps/desktop/src/renderer/V11Workspace.tsx apps/desktop/src/renderer/PlatformConnectionCenter.tsx tests/platform-connection-ui.test.ts tests/xiaohongshu-account-center-ui.test.ts
git commit -m "feat: expose live browser auth state separately from account history"
~~~

### Task 7: Add removal, context-disconnect, and publish-domain zero-side-effect coverage

**Files:**
- Modify: packages/adapters/core/src/browser.test.ts
- Modify: packages/adapters/xiaohongshu/src/browser.test.ts
- Create: tests/xiaohongshu-long-lived-browser-session.test.ts

**Interfaces:**
- Consumes: all lifecycle and runtime-state contracts from Tasks 1–6.
- Produces: regression coverage for M09–M16, exact target removal, no cross-account cleanup, and unchanged publish-domain counters.

- [ ] Step 1: Write the failing cross-account removal and side-effect tests.

In the new test harness, use openDatabase() with the existing migration directory for an isolated test database, create two XHS adapter contexts backed by one manager, and define the exact context helper below. Create adapterA with the same manager and use vi.spyOn(adapterA, "preparePublish") for the forbidden-call assertion. Production database inspection remains a separate read-only command in Tasks 0, 8, and 9.

~~~typescript
const context = (accountId: string): AccountContext => ({
  accountId,
  accountName: accountId,
  platformKey: "xiaohongshu",
  settings: { userActionId: "11111111-1111-4111-8111-111111111111", triggerSource: "CONNECT_ACCOUNT" }
});

const adapterA = new XiaohongshuBrowserAdapter({ sessionManager: manager });
const publishCounts = (): { jobs: number; intents: number; records: number } => ({
  jobs: repository.listJobs().length,
  intents: Number(db.prepare("SELECT COUNT(*) AS count FROM submission_intents").get().count),
  records: repository.getPublishRecords().length
});

it("removes XHS account A without closing account B or touching publish rows", async () => {
  const before = publishCounts();
  const sessionA = await manager.open({ platformKey: "xiaohongshu", accountId: "account-a" }, userAction);
  const sessionB = await manager.open({ platformKey: "xiaohongshu", accountId: "account-b" }, userAction);
  const preparePublishSpy = vi.spyOn(adapterA, "preparePublish");

  await adapterA.logout(context("account-a"));

  expect(sessionA.context.close).toHaveBeenCalledTimes(1);
  expect(sessionB.context.close).not.toHaveBeenCalled();
  expect(manager.getActiveSession({ platformKey: "xiaohongshu", accountId: "account-b" })).toBe(sessionB);
  expect(preparePublishSpy).not.toHaveBeenCalled();
  expect(publishCounts()).toEqual(before);
});
~~~

- [ ] Step 2: Run the focused test and verify it fails only for the missing lifecycle behavior.

~~~powershell
pnpm exec vitest run tests/xiaohongshu-long-lived-browser-session.test.ts -t "removes XHS account A"
~~~

- [ ] Step 3: Implement exact-target runtime cleanup in logout and disconnect handling.

logout(ctx) must close only the manager session for the exact platformKey and accountId, clear only that identity’s pending marker/runtime reference/credential, and leave all other account keys untouched. Repository archive remains the existing IPC/repository behavior and is not refactored in this task.

- [ ] Step 4: Add a no-live-Context historical-status test.

Use the same row() helper from tests/xiaohongshu-account-center-ui.test.ts:

~~~typescript
it("does not report persisted logged_in as live XHS authentication without a Context", () => {
  const historical = row("account-1", "Unverified", { runtimeAuthState: "UNVERIFIED" });
  expect(historical.accountStatus).toBe("Unverified");
  expect(historical.runtimeAuthState).toBe("UNVERIFIED");
});
~~~

- [ ] Step 5: Run all relevant adapter, DB contract, and XHS safety tests.

~~~powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts packages/adapters/browser/src/index.test.ts packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-long-lived-browser-session.test.ts tests/xiaohongshu-account-routing.test.ts tests/xiaohongshu-account-center-ui.test.ts
~~~

- [ ] Step 6: Commit the regression and safety coverage.

~~~powershell
git add -- packages/adapters/core/src/browser.test.ts packages/adapters/browser/src/index.test.ts packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-long-lived-browser-session.test.ts tests/xiaohongshu-account-routing.test.ts tests/xiaohongshu-account-center-ui.test.ts
git commit -m "test: prove xiaohongshu session isolation and publish safety"
~~~

### Task 8: Full verification and installed-app deployment

**Files:**
- Modify: PROJECT_STATE.md only after verification/deployment evidence exists.
- Create: a new rollback directory outside the source tree using the existing deployment convention.

**Interfaces:**
- Consumes: completed implementation and focused tests.
- Produces: verified source build, installed app deployment record, old/new app.asar hashes, rollback path, and unchanged production DB counts.

- [ ] Step 1: Run focused tests fresh from the final source state.

~~~powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts packages/adapters/browser/src/index.test.ts packages/adapters/xiaohongshu/src/browser.test.ts tests/runtime-adapter-registry.test.ts tests/platform-connection-ui.test.ts tests/xiaohongshu-account-center-ui.test.ts tests/xiaohongshu-long-lived-browser-session.test.ts
~~~

- [ ] Step 2: Run required full verification.

~~~powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
~~~

Expected: each command exits zero. If any fails, write a reproducing failing test before changing implementation and do not deploy.

- [ ] Step 3: Re-read production DB counts before deployment.

~~~powershell
node -e 'const Database = require("better-sqlite3"); const db = new Database("C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data/publisher.db", { readonly: true }); const tables = ["publish_jobs", "submission_intents", "publish_records"]; console.log(JSON.stringify(Object.fromEntries(tables.map((table) => [table, db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count])))); db.close();'
~~~

Expected: counts equal the Task 0 baseline.

- [ ] Step 4: Create a recoverable installed-app rollback copy and record hashes.

Use an explicit versioned destination such as:

~~~powershell
$rollbackDir = 'C:\GMP116ZhihuL5\Geo Media Publisher.pre-xhs-long-lived-session-20260828'
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath 'C:\GMP116ZhihuL5\Geo Media Publisher\resources\app.asar' -Destination (Join-Path $rollbackDir 'app.asar') -Force
Get-FileHash 'C:\GMP116ZhihuL5\Geo Media Publisher\resources\app.asar' -Algorithm SHA256
Get-FileHash 'release\win-unpacked\resources\app.asar' -Algorithm SHA256
~~~

Do not delete the existing rollback directory or unrelated release output.

- [ ] Step 5: Deploy the new app without changing production-data or profile paths.

Stop only the existing installed app process if it is running, copy the built installed-app payload according to the project’s existing deployment script, and verify the executable still uses C:\Users\Administrator\AppData\Roaming\codex-media-publisher. Do not copy credentials, profile contents, or production DB into build output.

- [ ] Step 6: Update PROJECT_STATE.md with source/deployment evidence and commit it.

Record implementation commits, focused/full verification results, installed executable path, new/old app.asar hashes, rollback path, unchanged production DB counts, and READY_FOR_REAL_SELF_TEST=NO. Do not claim live runtime readiness before Task 9.

~~~powershell
git add -- PROJECT_STATE.md
git commit -m "docs: record xiaohongshu long-lived session deployment"
~~~

### Task 9: Execute the owner-controlled live same-context verification and stop

**Files:**
- Read: installed-app logs and live diagnostic evidence.
- Modify: output/v143-xiaohongshu-long-lived-browser-session.json only if the existing evidence convention requires a new report file.
- Modify: PROJECT_STATE.md after the live result is known.

**Interfaces:**
- Consumes: deployed app, target account 1, canonical profile path, existing CredentialStore, shared Manager, and owner-visible login flow.
- Produces: one bounded live evidence report; no publish operation.

- [ ] Step 1: Capture production publish-domain counts immediately before the live flow.

~~~powershell
node -e 'const Database = require("better-sqlite3"); const db = new Database("C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data/publisher.db", { readonly: true }); const tables = ["publish_jobs", "submission_intents", "publish_records"]; console.log(JSON.stringify(Object.fromEntries(tables.map((table) => [table, db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count])))); db.close();'
~~~

- [ ] Step 2: Ask Owner to complete normal XHS login/security verification only in account 1’s visible BrowserSession.

~~~text
platformKey = xiaohongshu
accountId = 54b390ac-d81e-440a-baeb-d00f9f346cc3
profile = C:\Users\Administrator\AppData\Roaming\codex-media-publisher\browser-profiles\xiaohongshu\54b390ac-d81e-440a-baeb-d00f9f346cc3
~~~

If QR code, CAPTCHA, SMS/phone confirmation, security verification, risk control, login failure, or uncertain identity appears, stop with OWNER_ACTION_REQUIRED or BLOCKED; do not bypass or create another session.

- [ ] Step 3: After stable login PASS, close only the login Page through the app completion flow.

Verify from sanitized logs/evidence:

~~~text
LOGIN_PAGE_CLOSE_PRESERVES_CONTEXT=PASS
ACCOUNT_SESSION_REUSED=PASS
ACCOUNT_SESSION_RETAINED_AFTER_LOGIN=YES
contextDebugId is unchanged
pageDebugId is closed and not reused as the next operation Page
~~~

- [ ] Step 4: Run same-context check 1, close its Page, then run same-context check 2.

Verify both checks use the exact account identity, the same contextDebugId, different pageDebugId values, and no new Context launch. Stop immediately after check 2.

- [ ] Step 5: Explicitly verify forbidden actions did not occur.

~~~text
PRE_SUBMIT_GATE=NOT_RUN
SELF_TEST=NOT_RUN
preparePublish=NOT_CALLED
FINAL_SUBMIT_COUNT=0
JOB_CREATED=NO
INTENT_CREATED=NO
PUBLISH_RECORD_CREATED=NO
~~~

- [ ] Step 6: Capture publish-domain counts after the live flow and require before == after.

~~~powershell
node -e 'const Database = require("better-sqlite3"); const db = new Database("C:/Users/Administrator/AppData/Roaming/codex-media-publisher/production-data/publisher.db", { readonly: true }); const tables = ["publish_jobs", "submission_intents", "publish_records"]; console.log(JSON.stringify(Object.fromEntries(tables.map((table) => [table, db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count])))); db.close();'
~~~

If any count changes, stop and report the exact change; do not attempt cleanup by deleting production rows.

- [ ] Step 7: Write final live evidence and update project state only with observed results.

The final report must include:

~~~text
LONG_LIVED_ACCOUNT_CONTEXT_IMPLEMENTED=YES
LOGIN_PAGE_CLOSE_PRESERVES_CONTEXT=PASS
ACCOUNT_SESSION_REUSED=PASS
CHECK_LOGIN_SAME_CONTEXT_1=PASS
CHECK_LOGIN_SAME_CONTEXT_2=PASS
CANONICAL_CONTEXT_SINGLETON=PASS
CONCURRENT_CONTEXT_CREATION_GUARD=PASS
SIBLING_CONTEXT_ISOLATION=PASS
ACCOUNT_STATUS_LIVE_SYNC=PASS
COLD_RESTORE_LIMITATION_DOCUMENTED=YES
XIAOHONGSHU_RUNTIME_SESSION_READY=YES
READY_FOR_REAL_SELF_TEST=NO
FINAL_SUBMIT_COUNT=0
~~~

If any line cannot be proven from evidence, set the corresponding result to BLOCKED or UNKNOWN, record the blocker, and do not proceed to PRE-SUBMIT or real self-test.

## Final Verification Matrix

| Requirement | Automated proof | Live proof | Stop condition |
| --- | --- | --- | --- |
| M01/M02 login Page close | XHS adapter lifecycle test | login Page closed, Context still active | Context closes with Page |
| M03/M04 repeated check | XHS browser test | same Context, different Pages | new Context or stale Page identity |
| M05 backend reuse | shared adapter/XHS test | no second Context | backend cold-opens |
| M06 active-context contract | browser adapter test | absent Context does not pass | stored credential creates live PASS |
| M07 singleton concurrency | manager Promise.all test | launch evidence remains one per key | launch count greater than 1 |
| M08 Page isolation | manager Page-close test | sibling Page unaffected | sibling closes |
| M09/M10 disconnect semantics | Browser disconnect test | no disconnect event inferred from Page close | Page close marks expired |
| M11/M12 account isolation/removal | manager/XHS tests | account 1 exact identity | fallback to another account |
| M13 shutdown | closeAll() test and app shutdown logs | graceful close/process evidence | force kill or lock remains |
| M14 DB/runtime truth | UI/IPC tests | DB logged_in without active Context is Unverified | green live status without proof |
| M15 cold restore limitation | no-active check test | not exercised in live flow | automatic re-login |
| M16 publish zero side effects | cross-package count test | before == after | any Job/Intent/Record created |
| M17 other-platform regression | full test suite | not exercised | unrelated adapter changed |
