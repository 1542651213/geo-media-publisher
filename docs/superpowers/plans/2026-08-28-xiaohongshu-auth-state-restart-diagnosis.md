# Xiaohongshu Auth-State Restart Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, value-free diagnostics that capture Xiaohongshu authentication metadata before BrowserSession close, after profile flush, and after a fresh reopen, then stop for one controlled owner login experiment before proposing any persistence fix.

**Architecture:** Keep selector and platform-specific auth inspection inside the Xiaohongshu adapter. Add a pure metadata collector that reads only cookie/storage/profile metadata, wire lifecycle events from the shared BrowserSession manager without changing platform behavior, and use a separate Electron diagnostic runner to compare the closed profile with one fresh restore. The runner fails closed if the owner-login evidence is missing, unstable, or the profile is still locked.

**Tech Stack:** TypeScript strict mode, Electron 37, Playwright Core, Vitest, Node filesystem metadata, encrypted SafeStorage credential store, read-only SQLite inspection.

**Spec:** `C:\Users\Administrator\.codex\attachments\0d6b0903-c077-4795-a38f-13d96b83e8bd\pasted-text.txt`

## Global Constraints

- Do not enter the publish editor, upload an image, write title/body, call `preparePublish()`, click a publish CTA, run SELF_TEST, or create Job/SubmissionIntent/PublishRecord.
- `FINAL_SUBMIT_COUNT = 0`; publishing-domain database counts must remain unchanged.
- Use only `platformKey=xiaohongshu` and accountId `54b390ac-d81e-440a-baeb-d00f9f346cc3`.
- Never record cookie, token, localStorage, sessionStorage, IndexedDB business-data, credential, or secret values.
- Do not clear credentials, profile, cookies, storage, or account rows; do not add, switch, archive, or delete accounts.
- Do not modify Sohu, Toutiao, Weibo, release, or unrelated lifecycle implementations.
- Do not bypass CAPTCHA, security verification, risk controls, or fingerprint detection.
- Do not request the owner to log in until `DIAGNOSTIC_INSTRUMENTATION_READY = YES` is verified.
- Do not run a speculative persistence fix in this plan; diagnosis evidence must precede any fix.

---

### Task 1: Establish the diagnostic boundary and preserve the dirty worktree

**Files:**
- Read: `PROJECT_STATE.md`
- Read: `packages/adapters/core/src/browser.ts`
- Read: `packages/adapters/browser/src/index.ts`
- Read: `packages/adapters/xiaohongshu/src/browser.ts`
- Read: `apps/desktop/src/main/adapter-registry.ts`
- Read: `apps/desktop/src/main/ipc.ts`
- Read: `apps/desktop/src/main/main.ts`
- Read: `scripts/v143-xiaohongshu-session-persistence-restore.mts`
- Create: `output/v143-xiaohongshu-auth-state-restart-diagnosis.json`

**Interfaces:**
- Consumes: existing account-scoped persistent profile, encrypted credential key, installed-app log, and the existing exact-account restore runner.
- Produces: a read-only baseline containing branch/HEAD, installed app path, userData path, profile path, credential key (name only), and `publish_jobs`, `submission_intents`, `publish_records` counts.

- [ ] **Step 1: Capture read-only source and production baselines**

Run:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
```

Confirm the target profile is exactly:

```text
C:\Users\Administrator\AppData\Roaming\codex-media-publisher\browser-profiles\xiaohongshu\54b390ac-d81e-440a-baeb-d00f9f346cc3
```

Read the three publishing counts using SQLite read-only mode and record them without changing the DB.

- [ ] **Step 2: Trace the close boundary before editing it**

Document the current call chain:

```text
accounts:begin-login
  -> Adapter.connectAccount
  -> BrowserSessionManager.open
  -> launchPersistentContext(profilePath)
accounts:complete-login
  -> Adapter.completeConnection
  -> Xiaohongshu.inspectConnectionPage/loginStatusForPage
  -> Adapter.persistConnectionSession
  -> BrowserSessionManager.save
  -> syncBrowserAccount
  -> Adapter.releaseConnectionSession
  -> BrowserSessionManager.close(context)
```

The diagnosis must not alter this behavior until instrumentation has tests.

- [ ] **Step 3: Verify the boundary is isolated to Xiaohongshu instrumentation**

Use `git diff --name-only` and reject any planned edit outside the shared browser lifecycle diagnostics, the Xiaohongshu adapter, the registry wiring, the new diagnostic runner, tests, plan, and evidence.

### Task 2: Implement the value-free auth metadata collector

**Files:**
- Create: `packages/adapters/xiaohongshu/src/auth-state-diagnostics.ts`
- Create: `packages/adapters/xiaohongshu/src/auth-state-diagnostics.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.ts` only if the package export needs to expose the collector to the runner

**Interfaces:**
- Consumes: `BrowserContext`, current `Page`, optional persistent profile path, and optional credential file path.
- Produces: `collectXhsAuthStateMetadata(input): Promise<XhsAuthStateMetadata>` with only metadata fields.

The exported types must have these shapes:

```ts
export interface XhsCookieMetadata {
  name: string;
  domain: string;
  path: string;
  expires: number;
  isSessionCookie: boolean;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
}

export interface XhsProfileFileMetadata {
  relativePath: string;
  exists: boolean;
  kind: "file" | "directory" | "missing";
  size: number | null;
  modifiedAt: string | null;
}

export interface XhsAuthStateMetadata {
  capturedAt: string;
  pageUrl: string;
  origins: string[];
  cookies: XhsCookieMetadata[];
  sessionCookieNames: string[];
  persistentCookieNames: string[];
  cookieCountTotal: number;
  cookieCountXiaohongshu: number;
  sessionCookieCount: number;
  persistentCookieCount: number;
  localStorage: Array<{ origin: string; keyNames: string[]; keyCount: number }>;
  sessionStorage: Array<{ origin: string; keyNames: string[]; keyCount: number }>;
  indexedDB: Array<{ origin: string; databaseNames: string[]; objectStoresByDatabase: Record<string, string[]> }>;
  serviceWorkers: Array<{ origin: string; registrationScopes: string[]; count: number }>;
  profileFiles: XhsProfileFileMetadata[];
  credentialFile: { path: string | null; exists: boolean; size: number | null; modifiedAt: string | null };
  runtime: {
    userAgent: string | null;
    language: string | null;
    timezone: string | null;
    viewport: { width: number; height: number; deviceScaleFactor: number } | null;
  };
}
```

- [ ] **Step 1: Write failing tests for safe cookie classification and redaction**

Use a fixture context whose `cookies()` returns one cookie with `expires: -1` and one with a positive expiry. Assert that the output marks only the first as `isSessionCookie`, includes names and flags, and contains no `value` key anywhere:

```ts
it("classifies session and persistent cookies without returning values", async () => {
  const result = await collectXhsAuthStateMetadata(fixtureInput({
    cookies: [
      { name: "session_cookie", domain: ".xiaohongshu.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax", value: "secret" },
      { name: "persistent_cookie", domain: ".xiaohongshu.com", path: "/", expires: 1_900_000_000, httpOnly: false, secure: true, sameSite: "None", value: "secret" }
    ]
  }));
  expect(result.sessionCookieNames).toEqual(["session_cookie"]);
  expect(result.persistentCookieNames).toEqual(["persistent_cookie"]);
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(JSON.stringify(result)).not.toMatch(/"value"/iu);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm exec vitest run packages/adapters/xiaohongshu/src/auth-state-diagnostics.test.ts
```

Expected: FAIL because the collector and metadata types do not yet exist.

- [ ] **Step 3: Implement the collector with bounded, value-free reads**

Use `context.cookies()` and map only the allowed cookie metadata. Mark `expires <= 0` as session-only, and mark Xiaohongshu cookies by domain membership only for the count; do not infer authentication from names.

Use `page.evaluate` to collect current-origin localStorage/sessionStorage key names, `indexedDB.databases()` names and versions, object-store names by opening each database read-only, and `navigator.serviceWorker.getRegistrations()` scopes. Catch unsupported APIs as empty metadata with an explicit `collectionWarnings` field if needed; never fail login merely because optional metadata is unavailable.

Stat only this fixed set of existing profile candidates under the account profile: `Cookies`, `Network/Cookies`, `Local Storage`, `Default/Local Storage`, `IndexedDB`, `Default/IndexedDB`, `Session Storage`, `Default/Session Storage`, `Preferences`, `Default/Preferences`, `Secure Preferences`, `Default/Secure Preferences`, `SingletonLock`, `SingletonCookie`, and `SingletonSocket`.

- [ ] **Step 4: Run focused tests and verify the collector**

Run:

```powershell
pnpm exec vitest run packages/adapters/xiaohongshu/src/auth-state-diagnostics.test.ts
```

Expected: PASS, including tests for session/persistent cookie counts, storage key-only output, profile metadata, missing optional APIs, and absence of cookie/token values.

### Task 3: Instrument stable login and graceful BrowserSession lifecycle

**Files:**
- Modify: `packages/adapters/core/src/browser.ts`
- Modify: `packages/adapters/core/src/browser.test.ts`
- Modify: `packages/adapters/browser/src/index.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.test.ts`

**Interfaces:**
- Consumes: existing `BrowserSession`, adapter lifecycle, and the value-free collector.
- Produces: stable-login evidence, close lifecycle evidence, and runtime/config metadata without changing publish behavior.

Add these diagnostic-only contracts:

```ts
export type BrowserSessionLifecyclePhase =
  | "OPEN_STARTED"
  | "OPEN_COMPLETED"
  | "CLOSE_STARTED"
  | "CONTEXT_CLOSE_COMPLETED"
  | "CLOSE_COMPLETED"
  | "CLOSE_FAILED";

export interface BrowserSessionLifecycleEvent {
  phase: BrowserSessionLifecyclePhase;
  timestamp: string;
  platformKey: string;
  accountId: string;
  storageMode: BrowserSessionStorageMode;
  profilePath: string | null;
  contextDebugId: string;
  pageDebugId: string;
  browserConnected: boolean | null;
}
```

`BrowserSession` must also retain the selected `browserChannel`, while the manager callback remains optional and has no behavior when unset. The persistent close path must await `context.close()` before emitting `CONTEXT_CLOSE_COMPLETED` and `CLOSE_COMPLETED`; it must not call `process.kill()`.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests asserting that persistent close emits `CLOSE_STARTED`, then `CONTEXT_CLOSE_COMPLETED`, then `CLOSE_COMPLETED`, never calls `browser.close()` separately for a persistent context, and removes the active exact account key only after the close promise resolves. Add an assertion that a close failure emits `CLOSE_FAILED` and still clears the in-memory ownership map.

- [ ] **Step 2: Run the focused lifecycle tests and verify failure**

Run:

```powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts
```

Expected: FAIL because lifecycle events and selected channel are not yet implemented.

- [ ] **Step 3: Implement lifecycle events and selected runtime metadata**

Emit lifecycle events at the shared manager boundary with exact `platformKey + accountId` identity. Keep the existing persistent/ephemeral close semantics and error behavior. Record channel, headless mode, storage mode, profile path, context/page debug IDs, and `browser.isConnected()` where available; do not record cookies or storage values.

In the Xiaohongshu adapter, add:

```ts
export type XiaohongshuAuthStateDiagnosticPhase =
  | "LIVE_LOGIN_BEFORE_CLOSE"
  | "AUTH_STATE_BEFORE_CLOSE";
```

Implement a condition-based stable observation window after a candidate logged-in page is found. For four seconds, poll every 250 ms and require a non-`/login` creator URL, no verification URL, no visible login/QR/SMS/captcha/slider/security modal, and at least two positive creator UI signals on every sample. Return `needs_user_action` or `expired` immediately if a blocking state appears; do not use a single fixed sleep as proof.

At `persistConnectionSession`, after the stable login result and the existing encrypted `BrowserSessionManager.save`, collect `AUTH_STATE_BEFORE_CLOSE` while the page/context are still live. Emit `LIVE_LOGIN_BEFORE_CLOSE` and `AUTH_STATE_BEFORE_CLOSE` through an optional callback. The callback must receive only metadata and safe paths/timestamps.

- [ ] **Step 4: Run focused tests and verify behavior**

Run:

```powershell
pnpm exec vitest run packages/adapters/core/src/browser.test.ts packages/adapters/xiaohongshu/src/browser.test.ts
```

Expected: PASS for lifecycle ordering, delayed login redirects, stable login blocking, callback payload redaction, exact account ownership, and existing adapter behavior.

### Task 4: Wire installed-app diagnostics and create the controlled restart runner

**Files:**
- Modify: `apps/desktop/src/main/adapter-registry.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Create: `scripts/v143-xiaohongshu-auth-state-restart-diagnosis.mts`
- Create: `scripts/v143-xiaohongshu-auth-state-restart-entry.cjs`
- Create: `scripts/v143-xiaohongshu-auth-state-restart-diagnosis.test.mts`

**Interfaces:**
- Consumes: installed-app log callbacks, target account/profile/credential paths, `collectXhsAuthStateMetadata`, and shared `BrowserSessionManager`.
- Produces: `output/v143-xiaohongshu-auth-state-restart-diagnosis.json` with before-close, after-close, and after-reopen metadata and explicit stop reasons.

- [ ] **Step 1: Write failing runner/evidence tests**

Test that a fake evidence stream containing `LIVE_LOGIN_BEFORE_CLOSE` and `AUTH_STATE_BEFORE_CLOSE` writes only safe fields, that a missing live-login event returns `DIAGNOSTIC_INSTRUMENTATION_NOT_OBSERVED`, that an Attempt 1 `/login` result stops without any Attempt 2 field, and that evidence always contains `finalSubmitCount: 0`, `jobCreated: false`, `intentCreated: false`, and `publishRecordCreated: false`.

- [ ] **Step 2: Implement installed-app callback wiring**

Pass the exact production credential file path to the Xiaohongshu adapter diagnostic options. Log event names `XHS_AUTH_STATE_DIAGNOSTIC` and `BROWSER_SESSION_LIFECYCLE` through the existing file logger. Log only metadata and safe paths; never log the decrypted credential, cookie values, storage values, or page body text.

- [ ] **Step 3: Implement the controlled runner state machine**

The runner must execute these states in order:

```text
READ_BASELINE
  -> READ_OWNER_LOGIN_DIAGNOSTIC
  -> VERIFY_PROFILE_UNLOCKED_AND_AFTER_CLOSE
  -> RESTORE_ATTEMPT_1
  -> COLLECT_AUTH_STATE_AFTER_REOPEN
  -> CLOSE_RESTORE_SESSION
  -> WRITE_EVIDENCE
```

Before opening restore, require a recent `LIVE_LOGIN_BEFORE_CLOSE=PASS` and `AUTH_STATE_BEFORE_CLOSE` event for the exact account and profile. Verify the profile is not held by an active Chrome/Edge process and record profile file metadata after close. Poll for the process/lock condition with a bounded timeout; do not force-kill.

For Attempt 1, create a new registry with the same exact profile root, same account context, same system-browser channel order, and same visible execution mode. Call only `checkLogin` and `getBrowserSessionEvidence`; never call `getAccountProfile`, `preparePublish`, or any editor method. Collect after-reopen metadata, compare cookie names/counts, storage key names, IndexedDB names, service-worker scopes, profile files, runtime values, and safe lifecycle metadata. If status is not `logged_in`, set `RESTORE_ATTEMPT_1=BLOCKED`, close the restore Session gracefully, write evidence, and exit without a second attempt.

If status is `logged_in`, record `AUTH_STATE_PRESENT_AFTER_REOPEN=YES`, then close the restore Session gracefully and stop. This diagnosis run intentionally does not execute Attempt 2 or PRE-SUBMIT GATE.

- [ ] **Step 4: Run focused runner tests**

Run:

```powershell
pnpm exec vitest run scripts/v143-xiaohongshu-auth-state-restart-diagnosis.test.mts
```

Expected: PASS with no real browser launch and no publish-domain writes.

### Task 5: Full verification, deployment, and owner handoff

**Files:**
- Modify: `output/v143-xiaohongshu-auth-state-restart-diagnosis.json`
- Preserve: all pre-existing Sohu/release/Toutiao dirty files

**Interfaces:**
- Consumes: focused implementation and runner tests.
- Produces: a deployed diagnostic build and `DIAGNOSTIC_INSTRUMENTATION_READY=YES` only when all gates pass.

- [ ] **Step 1: Run required verification before packaging**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit 0; no unrelated files are staged or reverted.

- [ ] **Step 2: Package and deploy with a new rollback backup**

Rebuild native modules, package to a new staging directory outside `release\win-unpacked`, verify executable/app.asar/native hashes, create a new non-overwriting rollback directory under `C:\GMP116ZhihuL5`, and deploy only after exact installed-process shutdown and path verification. Preserve both earlier rollback directories and all production-data/profile/credential files.

- [ ] **Step 3: Verify the installed diagnostic runtime**

Start the installed app, verify the exact executable path, `Responding=True`, userData path, target profile root configuration, Electron native startup, and unchanged publishing-domain counts. Do not click account controls or open a platform browser during this step.

- [ ] **Step 4: Write the readiness evidence and stop**

Set:

```text
DIAGNOSTIC_INSTRUMENTATION_READY = YES
OWNER_ACTION_REQUIRED = YES
FINAL_SUBMIT_COUNT = 0
```

Then stop and ask the owner to perform exactly one controlled login experiment for account 1 in the new installed app. Do not run the restart runner until the owner explicitly confirms completion.

### Task 6: After owner confirmation, collect evidence and stop before any fix

**Files:**
- Modify: `output/v143-xiaohongshu-auth-state-restart-diagnosis.json`
- Modify: `PROJECT_STATE.md` only if the project’s established state log requires the new diagnosis result

**Interfaces:**
- Consumes: installed-app `XHS_AUTH_STATE_DIAGNOSTIC` and `BROWSER_SESSION_LIFECYCLE` events plus one controlled restore.
- Produces: root-cause classification, cookie/storage/profile/runtime diffs, survival matrix, DB before/after, and a precise blocker or diagnosis.

- [ ] **Step 1: Verify the owner event before starting restore**

Require exact accountId/platform/profile evidence and `LIVE_LOGIN_BEFORE_CLOSE=PASS`. If absent or unstable, write `OWNER_ACTION_REQUIRED=YES` and stop without opening restore.

- [ ] **Step 2: Run the one controlled restore and compare metadata**

Populate `AUTH_STATE_DIFF_AFTER_RESTART`, `AUTH_STATE_PRESENT_AFTER_REOPEN`, `AUTH_STATE_PRESENT_BUT_SERVER_REJECTED`, `XHS_SESSION_ONLY_COOKIES_PRESENT`, `SESSION_ONLY_COOKIE_LOSS_CORRELATED_WITH_LOGIN_EXPIRY`, and the survival matrix. Keep all cookie/storage values out of the evidence.

- [ ] **Step 3: Recheck publishing-domain counts and final safety invariants**

Read the same three counts after the runner. Require before == after and retain `FINAL_SUBMIT_COUNT=0`, `JOB_CREATED=NO`, `INTENT_CREATED=NO`, and `PUBLISH_RECORD_CREATED=NO`.

- [ ] **Step 4: Stop before implementing a persistence fix**

If the evidence proves a root cause, report it and propose a separately reviewed follow-up. Do not alter cookie expiry, tokens, fingerprinting, risk controls, account status semantics, or architecture in this diagnosis run.

---

## Self-review checklist

- [ ] Cookie values, token values, storage values, and business data are excluded from every diagnostic type, logger payload, test fixture assertion, and JSON evidence file.
- [ ] Stable login observation is condition-based and rejects delayed `/login` redirects.
- [ ] Persistent close is awaited and no process kill is introduced.
- [ ] Attempt 1 failure stops the runner before any additional restore.
- [ ] The runner never calls editor, upload, title/body, `preparePublish`, or final submit code.
- [ ] Production DB counts are read-only and compared before/after.
- [ ] Existing unrelated dirty files remain untouched.
