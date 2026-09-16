# Xiaohongshu Desktop Account Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the registered `xiaohongshu` BrowserAutomation adapter usable from the desktop account workflow: explicit account creation, visible manual login, isolated encrypted BrowserSession, separated identity readback, account-level gate-only routing, and no publish-domain side effects.

**Architecture:** Preserve `xiaohongshu`, `xiaohongshu_business`, and `xiaohongshu_private` as separate platform keys. Reuse the existing `accounts:create`, BrowserAutomation adapter lifecycle, repository account records, `browserSessionCredentialKey({ platformKey, accountId })`, and per-account self-test API. Add generic BrowserAutomation UI semantics: “连接账号” may reuse one incomplete account for first connection/relogin, while “+ 添加账号” always creates a new UUID before beginning login; every account action receives the selected account ID. The installed application is rebuilt only after source tests and build pass, then its executable/resources are backed up and replaced in a controlled restart sequence.

**Tech Stack:** TypeScript strict mode, Electron + React renderer, Vitest, SQLite repository with existing migrations, Playwright Core BrowserSession manager, pnpm, electron-vite, electron-builder.

**Spec:** `docs/superpowers/specs/2026-08-27-xiaohongshu-account-connection-design.md`

## Global Constraints

- Keep `platformKey=xiaohongshu` with `displayName=小红书`, `transport=browser`, and `integrationMode=BrowserAutomation`.
- Preserve historical `xiaohongshu_business` and `xiaohongshu_private` rows and their independent business meanings.
- Use the existing account record and encrypted BrowserSession store; do not add a second account model or credential enum.
- “连接账号” may reuse an existing incomplete account for the initial connection or explicit relogin; “+ 添加账号” must call `accounts.create` first and then begin login with the returned UUID, even when a connected account already exists.
- Identity and login are separate acceptance gates: login is accepted only when the BrowserAutomation lifecycle verifies a non-login page without security interruption, and identity is accepted only after safe nickname/profile evidence is read back; a nickname never becomes an invented external ID.
- Every login, refresh, cancel, disconnect, open-backend, check-login, self-test, and publish-preparation account action carries the selected internal account ID; no action may select the first account as a fallback.
- Never automate CAPTCHA, QR code, SMS, slider, or risk-control verification; pause with user-action status and tell the owner to complete normal verification in the visible BrowserSession.
- This work never clicks final submit and never creates a publish Job, SubmissionIntent, PublishRecord, or `PublishPassed=PASS` for the Xiaohongshu gate-only path.
- Do not modify Weibo, Toutiao, Sohu, Zhihu, Publisher state-machine, Scheduler, SubmissionIntent, or PublishRecord business implementations.
- Preserve uncommitted user changes already present in the worktree; stage only files belonging to the current task at each commit.

## Execution status — 2026-08-27

- Tasks 1–5: implemented and covered by focused tests. The ordinary `xiaohongshu` route is distinct from `xiaohongshu_business` and `xiaohongshu_private`; runtime `platforms:list` overlays `accountConnectionMode=BrowserAutomation` without changing publish transport.
- Account semantics: `连接账号` creates the first record only when no row exists, or reuses exactly one incomplete row; `+ 添加账号` always creates a fresh UUID before login, including when connected accounts exist. Multiple incomplete rows require an explicit selection and never choose the first row.
- Login/identity acceptance: login lifecycle completion is checked first; identity readback is a separate adapter call and persistence step. Nickname-only evidence updates `accountName` and leaves `externalAccountId` null; no identifier is guessed.
- Account-level routing: login, re-login, session check, backend open, disconnect, self-test, and gate-only actions carry the selected internal `accountId`; missing or ambiguous selection fails closed.
- Installed app order completed for the login-fix package: source focused tests/build → Electron-target native/package → stop exact installed process → backup old resources/native unpacked directory → replace → restart installed executable. Current installed app is running at `C:\GMP116ZhihuL5\Geo Media Publisher\Geo Media Publisher.exe` (main PID `23176`); the r6 exe/app.asar/native hashes match the package and production data/credentials were preserved.
- Owner continuation result (historical pre-bugfix): the running app showed the ordinary `小红书` card with one explicit account record, `54b390ac-d81e-440a-baeb-d00f9f346cc3`; the old account-specific gate-only stopped with a false-positive security classification. The current bugfix run does not ask the owner to repeat login or switch accounts; it stops because that exact account has no persisted BrowserSession available to the source runner.
- Latest verification: focused tests PASS (9 files / 54 tests), `pnpm test` PASS (72 files / 412 tests), `pnpm typecheck` PASS, `pnpm lint` PASS, and `pnpm build` PASS. Gate-only database deltas are zero for Job, SubmissionIntent, and PublishRecord, with final-submit count zero.

### False-negative bugfix continuation — 2026-08-27

- Root cause confirmed: XHS login detection treated whole-page keyword text as security evidence, and the generic connection lifecycle closed the owner Page before identity readback could reuse it.
- TDD fix is complete: visible blocking evidence is contextual; Creator positive signals are combined; exact account-scoped Page/Context membership is checked; XHS keeps the login Session open until identity readback/persistence finishes; an account with no stored Session is not inspected by creating a replacement Context/Page.
- Current focused bugfix suite: 4 files / 47 tests PASS. Full suite: 72 files / 424 tests PASS. `pnpm typecheck`, `pnpm lint`, and `pnpm build` PASS.
- Exact-account source gate-only was rerun for `54b390ac-d81e-440a-baeb-d00f9f346cc3`; it stopped at Login / Session with `LOGIN_REQUIRED` because the production account row has no persisted BrowserSession. This is not an owner-page verdict and no Computer Use was used.
- No new account, no account switch, no real publish, and no Job/SubmissionIntent/PublishRecord side effect. The installed r6 app has now been restarted. The exact existing account remains the only target; owner must use its existing “重新登录/连接现有账号” action, never “+ 添加账号”, then complete manual login before post-restart Login → Identity → gate-only verification.

---

### Task 1: Prove catalog registration and independent account identity storage

**Files:**
- Modify: `tests/xiaohongshu-account-routing.test.ts`
- Modify: `tests/runtime-adapter-registry.test.ts`
- Modify: `packages/db/src/repository.ts`

**Interfaces:**
- Consumes: `createRuntimeAdapterRegistry`, `openDatabase`, `AppRepository.createAccount`, `AppRepository.syncBrowserPlatformAccount`.
- Produces: a repository sync operation that always updates the explicitly supplied account row and never merges it into another row because of an external ID.

- [ ] **Step 1: Write the failing test for same-external-ID account isolation**

Append this test to `tests/xiaohongshu-account-routing.test.ts`:

```ts
  it("does not merge a second account when identity evidence belongs to another account", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-routing-isolation-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const first = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 A" });
    const second = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "小红书账号 B" });

    const syncedFirst = opened.repository.syncBrowserPlatformAccount({ accountId: first.id, platformKey: "xiaohongshu", accountName: "创作者昵称", externalAccountId: "same-stable-profile", browserSessionId: "session:xiaohongshu:" + first.id });
    expect(syncedFirst.id).toBe(first.id);
    expect(() => opened.repository.syncBrowserPlatformAccount({ accountId: second.id, platformKey: "xiaohongshu", accountName: "创作者昵称", externalAccountId: "same-stable-profile", browserSessionId: "session:xiaohongshu:" + second.id })).toThrow(/外部账号.*其他内部账号|external.*account/i);
    expect(opened.repository.listAccounts().filter((candidate) => candidate.platformKey === "xiaohongshu")).toHaveLength(2);
    expect(opened.repository.listAccounts().find((candidate) => candidate.id === first.id)?.browserSessionId).toContain(first.id);
    expect(opened.repository.listAccounts().find((candidate) => candidate.id === second.id)).toMatchObject({ loginStatus: "unknown", browserSessionId: null });
  });
```

Add a second case with `externalAccountId: "stable-profile-a"` and `externalAccountId: "stable-profile-b"` that asserts two rows remain logged in and their `browserSessionId` values contain different internal account IDs.

- [ ] **Step 2: Run the focused test and verify the failure is the current external-ID merge**

Run: `pnpm exec vitest run tests/xiaohongshu-account-routing.test.ts`

Expected: FAIL because `syncBrowserPlatformAccount` currently finds `existingByExternal` and updates the first row instead of the explicitly supplied second row.

- [ ] **Step 3: Write the minimal repository implementation**

In `packages/db/src/repository.ts`, keep the external-ID uniqueness guard but change it from implicit merge to explicit fail-closed behavior: query an existing row with the same non-null `externalAccountId`, and if it belongs to another internal account, throw `new Error("平台外部账号已绑定到其他内部账号")` before any update. Use `input.accountId` in the account `UPDATE`, the `upsertAccountAuthorization` call, and the returned `SELECT`. Keep `preservedExternalId` so an omitted external ID preserves an already verified value on the same row, while an explicit `null` clears it.

The resulting core must have this shape:

```ts
      const existingByExternal = input.externalAccountId ? this.db.prepare("SELECT id FROM accounts WHERE platform_key=? AND external_account_id=? AND id<>?").get(input.platformKey, input.externalAccountId, input.accountId) as Row | undefined : undefined;
      if (existingByExternal) throw new Error("平台外部账号已绑定到其他内部账号");
      const timestamp = input.lastVerifiedAt ?? now();
      const preservedExternalId = input.externalAccountId === undefined ? (typeof current.external_account_id === "string" ? current.external_account_id : null) : input.externalAccountId;
      this.db.prepare("UPDATE accounts SET platform_account_name=COALESCE(NULLIF(?,''),platform_account_name), login_status='logged_in', enabled=1, paused_reason=NULL, connection_mode='BrowserAutomation', authorization_status='Authorized', browser_session_id=?, external_account_id=?, last_verified_at=?, last_login_check_at=?, last_used_at=?, updated_at=? WHERE id=? AND platform_key=?").run(input.accountName?.trim() ?? "", input.browserSessionId, preservedExternalId, timestamp, timestamp, timestamp, timestamp, input.accountId, input.platformKey);
      this.upsertAccountAuthorization({ accountId: input.accountId, platformKey: input.platformKey, authorizationType: "BrowserAutomation", status: "Authorized", providerAccountId: preservedExternalId, providerAccountName: input.accountName ?? null });
      return toAccount(this.db.prepare("SELECT * FROM accounts WHERE id=?").get(input.accountId) as Row);
```

- [ ] **Step 4: Run the focused test and verify all account isolation assertions pass**

Run: `pnpm exec vitest run tests/xiaohongshu-account-routing.test.ts tests/v112-account-lieju-cnblogs.test.ts`

Expected: PASS, including existing Lieju session/disconnect isolation and the new same-external-ID Xiaohongshu case.

- [ ] **Step 5: Commit the repository isolation change**

Run:

```bash
git add tests/xiaohongshu-account-routing.test.ts packages/db/src/repository.ts
git commit -m "fix: keep browser accounts isolated by internal id"
```

### Task 2: Separate login completion from identity persistence and return safe identity data

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `tests/xiaohongshu-account-routing.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.test.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts` only if a failing identity/login test identifies a missing signal.

**Interfaces:**
- Consumes: `AutomationAdapter.completeConnection`, `AutomationAdapter.getAccountProfile`, `syncBrowserAccount`, `AccountProfile`.
- Produces: `accounts:complete-login` response with the stable internal `accountId`, the profile-derived `accountName`, and nullable external ID; account row is marked logged in only after login completion and identity synchronization both succeed.

- [ ] **Step 1: Write the failing response contract test**

Add a pure helper in `apps/desktop/src/main/ipc.ts` only after the test names its desired behavior, or, if keeping IPC private is preferable, add the equivalent repository/adapter integration assertion to `tests/xiaohongshu-account-routing.test.ts`: a login completion result must retain the created internal account ID, return the adapter profile nickname rather than the local alias, and return `null` when no stable external ID exists.

Use this concrete assertion in the routing test:

```ts
  it("keeps login status and identity fields distinct when only a nickname is reliable", () => {
    const directory = mkdtempSync(join(tmpdir(), "publisher-xhs-routing-identity-"));
    tempDirs.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedPlatformCatalog(platformCsv);
    const account = opened.repository.createAccount({ platformKey: "xiaohongshu", name: "本地容器 A", accountAlias: "本地容器 A" });
    const saved = opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", accountName: "平台昵称", externalAccountId: null, browserSessionId: "session:xiaohongshu:" + account.id });

    expect(saved.id).toBe(account.id);
    expect(saved.accountAlias).toBe("本地容器 A");
    expect(saved.accountName).toBe("平台昵称");
    expect(saved.externalAccountId).toBeNull();
    expect(saved.loginStatus).toBe("logged_in");
  });
```

Add a pure response-mapping helper to `apps/desktop/src/main/account-connection.ts` and test it from `tests/xiaohongshu-account-routing.test.ts`:

```ts
expect(browserAccountConnectionResult(saved)).toMatchObject({ accountId: account.id, accountName: "平台昵称" });
expect(browserAccountConnectionResult(saved).accountId).not.toBe("平台昵称");
```

- [ ] **Step 2: Run the focused identity tests and verify the response mapping fails or exposes the current alias**

Run: `pnpm exec vitest run tests/xiaohongshu-account-routing.test.ts packages/adapters/xiaohongshu/src/browser.test.ts`

Expected: the repository portion passes, while the new IPC mapping assertion identifies the current `account.name` response and the missing nullable external-ID assertion if the helper is not yet extracted.

- [ ] **Step 3: Implement the minimal IPC identity mapping**

In `syncBrowserAccount`, continue to pass only `profile.accountId` when the adapter returned a stable ID; do not derive one from nickname, URL text without a stable profile path, or local account ID. Add this pure function to `apps/desktop/src/main/account-connection.ts`:

```ts
export function browserAccountConnectionResult(account: Account): { configured: true; accountStatus: "Connected"; authorizationStatus: "Authorized"; accountId: string; accountName: string | null; scopes: string[]; expiresAt: null } {
  return { configured: true, accountStatus: "Connected", authorizationStatus: "Authorized", accountId: account.id, accountName: account.accountName ?? account.name, scopes: [], expiresAt: null };
}
```

Keep `account.id` as the internal account ID used by all later UI calls. The profile nickname belongs in `account.accountName`; `account.accountAlias`/`account.name` remains the owner’s local label. Ensure the success log includes only `accountId`, `platformKey`, and `userActionId`.

- [ ] **Step 4: Add and run login/identity separation tests**

Keep the existing adapter tests for stable profile ID, nickname-only profile, login-page expiry, and security verification. Add one assertion that a nickname-only profile has `accountId === undefined` and `accountName === nickname`, and one assertion that a login-page result is not accepted merely because the body is non-empty.

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-account-routing.test.ts`

Expected: PASS with no external ID guessed from nickname and no account row marked `logged_in` before identity sync.

- [ ] **Step 5: Commit the identity/login boundary**

Run:

```bash
git add apps/desktop/src/main/ipc.ts tests/xiaohongshu-account-routing.test.ts packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/browser.ts
git commit -m "fix: separate xiaohongshu login and identity persistence"
```

### Task 3: Make account-center connection and “+ 添加账号” semantics explicit

**Files:**
- Modify: `apps/desktop/src/renderer/v11-ui-model.ts`
- Modify: `apps/desktop/src/renderer/V11Workspace.tsx`
- Modify: `apps/desktop/src/renderer/PlatformConnectionCenter.tsx`
- Modify: `apps/desktop/src/renderer/platform-connection-ui.ts`
- Modify: `tests/platform-connection-ui.test.ts`
- Create: `tests/xiaohongshu-account-center-ui.test.ts`

**Interfaces:**
- Consumes: `AccountManagementRow`, `Platform`, `window.publisherAPI.accounts.create`, `window.publisherAPI.accounts.beginLogin`, and existing `platformConnectionActions`.
- Produces: tested pure UI decisions plus renderer handlers where `connect(platformKey, accountId?)` reuses only an incomplete account for normal connection/relogin and `addAccount(platformKey)` always creates a fresh account before opening the visible BrowserSession.

- [ ] **Step 1: Write failing pure UI tests for action semantics**

Export pure helpers from `v11-ui-model.ts` with these signatures:

```ts
export type AccountConnectionIntent = "connect" | "add" | "relogin";
export function accountConnectionTarget(rows: AccountManagementRow[], intent: AccountConnectionIntent): { accountId: string | null; createAccount: boolean };
export function platformHasConnectedAccount(rows: AccountManagementRow[]): boolean;
```

Add `tests/xiaohongshu-account-center-ui.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AccountManagementRow } from "../apps/desktop/src/shared/api";
import { accountConnectionTarget, platformHasConnectedAccount } from "../apps/desktop/src/renderer/v11-ui-model";

function row(id: string, accountStatus: AccountManagementRow["accountStatus"]): AccountManagementRow {
  return { account: { id, platformKey: "xiaohongshu", name: id, accountAlias: id, accountName: null, groupId: null, loginStatus: accountStatus === "Connected" ? "logged_in" : "logged_out", enabled: true, allowAutoPublish: false, minimumIntervalSeconds: 0, publishMode: "manual", todayPublishCount: 0, lastPublishAt: null, lastLoginCheck: null, pausedReason: null, failedCount: 0 }, platform: {} as AccountManagementRow["platform"], credentialStatus: { configured: false, expired: false, fields: [] }, lastDryRunAt: null, accountStatus, authorizationStatus: "Unknown", authorizationScopes: [], authorizationExpiresAt: null, providerAccountId: null, providerAccountName: null, publishVerification: "NotTested", connectionStage: "NotConfigured" };
}

describe("BrowserAutomation account creation semantics", () => {
  it("reuses an incomplete container for connect but creates a new account for add", () => {
    const rows = [row("account-connected", "Connected"), row("account-pending", "NeedsLogin")];
    expect(accountConnectionTarget(rows, "connect")).toEqual({ accountId: "account-pending", createAccount: false });
    expect(accountConnectionTarget(rows, "relogin")).toEqual({ accountId: "account-pending", createAccount: false });
    expect(accountConnectionTarget(rows, "add")).toEqual({ accountId: null, createAccount: true });
    expect(platformHasConnectedAccount(rows)).toBe(true);
  });

  it("fails closed when an account action requires an explicit selected row", () => {
    expect(accountConnectionTarget([], "relogin")).toEqual({ accountId: null, createAccount: false });
  });
});
```

Add to `tests/platform-connection-ui.test.ts` a browser action expectation that connected rows include `+ 添加账号` as an independent action, while relogin remains account-specific.

- [ ] **Step 2: Run the new UI tests and verify they fail because the helpers/actions do not exist**

Run: `pnpm exec vitest run tests/xiaohongshu-account-center-ui.test.ts tests/platform-connection-ui.test.ts`

Expected: FAIL with missing helper exports and the current connected browser action list lacking an add-account action.

- [ ] **Step 3: Implement the minimal pure helpers and BrowserAutomation action**

In `v11-ui-model.ts`, implement `accountConnectionTarget` as follows: `add` always returns `{ accountId:null, createAccount:true }`; `connect` may reuse an incomplete container only when exactly one incomplete container exists, and may create a new container only when there are no rows; `relogin` reuses an incomplete container only when exactly one exists, otherwise returns `{ accountId:null, createAccount:false }`. Multiple incomplete rows therefore require an explicit account selection and never choose the first row. `platformHasConnectedAccount` returns `rows.some((row) => row.accountStatus === "Connected")`.

In `platform-connection-ui.ts`, extend `PlatformConnectionActionKind` with `add-account`, and return `[{ kind:"view-account", label:"查看账号" }, { kind:"open-backend", label:"打开后台" }, { kind:"relogin", label:"重新登录" }, { kind:"add-account", label:"+ 添加账号" }]` for a connected BrowserAutomation row. A platform with multiple account rows shows `选择账号` plus `+ 添加账号`; a platform with no rows shows `连接账号` plus `+ 添加账号`. No card action may route to a first account implicitly.

- [ ] **Step 4: Wire V11AccountsCenter to exact IDs and fresh account creation**

Refactor the existing `connect` handler in `V11Workspace.tsx` into:

```ts
const beginAccountLogin = async (platformKey: string, intent: "connect" | "add" | "relogin", selectedAccountId?: string): Promise<void> => {
  const rows = rowsFor(platformKey);
  const target = selectedAccountId ? { accountId: selectedAccountId, createAccount: false } : accountConnectionTarget(rows, intent);
  let account = target.accountId ? overview.find((item) => item.account.id === target.accountId)?.account : undefined;
  if (!account && target.createAccount) {
    const platform = platforms.find((item) => item.platformKey === platformKey);
    const alias = `${platform?.displayName ?? platformLabel(platformKey)}账号 ${rows.length + 1}`;
    account = await window.publisherAPI.accounts.create({ platformKey, name: alias, accountAlias: alias, publishMode: "assisted" });
  }
  if (!account) throw new Error("未选择可连接的账号");
  const result = await window.publisherAPI.accounts.beginLogin(account.id, platformKey);
  if (!result.opened) throw new Error(result.message ?? "暂时无法打开官方登录页");
  setPendingLogin({ accountId: account.id, platformKey });
  setMessage(`已打开${platforms.find((item) => item.platformKey === platformKey)?.displayName ?? platformKey}官方登录页。`);
  load();
  refresh();
};
```

Use `beginAccountLogin(platformKey, "connect")` for the first connection button, `beginAccountLogin(platformKey, "relogin", row.account.id)` for each account’s relogin, and `beginAccountLogin(platformKey, "add")` for `+ 添加账号`. If a selected account ID cannot be found, throw and do not create a replacement. Never call begin login with a platform-only lookup after a connected row exists.

- [ ] **Step 5: Render all BrowserAutomation accounts and account-level actions in V11AccountsCenter**

For each BrowserAutomation platform card, render the connected count plus each row’s alias/profile name and exact account actions. Each row’s self-test action navigates to the existing self-test center with the row’s `platformAccountId ?? id` available through the selected account state or account-level list; no card-level self-test invokes a run without an ID. Keep publish navigation separate and do not add any new publish capability to Xiaohongshu.

Add `+ 添加账号` to the card whenever the platform kind is BrowserAutomation. The connected card must no longer show only “重新登录” against `connectedRows[0]`; it must show relogin/open/check/disconnect per row. Preserve the existing Lieju and CNBlogs specialized drawers.

- [ ] **Step 6: Render all account rows in PlatformConnectionCenter and route actions explicitly**

Replace the one-row `rowsByPlatform` action target with selected account state. `accountFor(platform, intent)` must use `accountConnectionTarget` for `connect` and create a record for `add-account`; it must accept an explicit `accountId` for relogin/open/check/disconnect. `actionFor` must reject an account action when no row is selected, rather than selecting `rowsByPlatform.get(platformKey)` or the first row. `PlatformDetail` must list `rows` and pass each row’s ID to its buttons.

The account-level handlers must call only these exact forms:

```ts
window.publisherAPI.accounts.beginLogin(row.account.id, row.account.platformKey)
window.publisherAPI.accounts.openBackend(row.account.id, row.account.platformKey)
window.publisherAPI.accounts.checkLogin(row.account.id, row.account.platformKey)
window.publisherAPI.accounts.disconnect(row.account.id, row.account.platformKey)
window.publisherAPI.platformSelfTest.runSafe(row.account.platformAccountId ?? row.account.id)
```

- [ ] **Step 7: Run UI tests and typecheck the renderer changes**

Run: `pnpm exec vitest run tests/xiaohongshu-account-center-ui.test.ts tests/platform-connection-ui.test.ts tests/v112-account-lieju-cnblogs.test.ts`; then run `pnpm typecheck`.

Expected: PASS; typecheck reports no missing action kinds or account row type errors.

- [ ] **Step 8: Commit the explicit account-action semantics**

Run:

```bash
git add apps/desktop/src/renderer/v11-ui-model.ts apps/desktop/src/renderer/V11Workspace.tsx apps/desktop/src/renderer/PlatformConnectionCenter.tsx apps/desktop/src/renderer/platform-connection-ui.ts tests/platform-connection-ui.test.ts tests/xiaohongshu-account-center-ui.test.ts
git commit -m "feat: add explicit browser account creation actions"
```

### Task 4: Prove exact gate-only routing and zero publish side effects

**Files:**
- Modify: `tests/v142-xiaohongshu-gate-only.test.ts`
- Modify: `tests/xiaohongshu-account-routing.test.ts`
- Modify: `scripts/v142-xiaohongshu-gate-only.helpers.ts` only if a test finds an implicit fallback.

**Interfaces:**
- Consumes: `resolveExplicitXiaohongshuAccount`, `platformSelfTest.runSafe`, existing V1.4.2 gate-only script.
- Produces: tests that prove account A/B runs use distinct explicit IDs, missing IDs fail closed, and final submit/domain side-effect counts remain zero.

- [ ] **Step 1: Write the failing multi-account gate-routing assertions**

Add to `tests/v142-xiaohongshu-gate-only.test.ts`:

```ts
  it("routes two selected accounts independently and never uses the first account", () => {
    const accountA = account("account-a");
    const accountB = account("account-b");
    expect(resolveExplicitXiaohongshuAccount([accountA, accountB], "account-a").id).toBe("account-a");
    expect(resolveExplicitXiaohongshuAccount([accountA, accountB], "account-b").id).toBe("account-b");
    expect(() => resolveExplicitXiaohongshuAccount([accountA, accountB], undefined)).toThrow(/explicit.*account/i);
  });
```

Add a source assertion that all Xiaohongshu gate-only entry points require `XIAOHONGSHU_ACCOUNT_ID` and that the generated evidence has `finalSubmitCount: 0`, `jobCreated: false`, `intentCreated: false`, `publishRecordCreated: false`, and `publishPassed: "NOT_PASS"`.

- [ ] **Step 2: Run the gate-only focused tests and verify any fallback failure**

Run: `pnpm exec vitest run tests/v142-xiaohongshu-gate-only.test.ts tests/xiaohongshu-account-routing.test.ts`

Expected: FAIL only if any new UI/gate route lacks the required explicit-ID assertion; existing helper tests must continue to pass.

- [ ] **Step 3: Implement only the minimum fail-closed routing change**

Keep `resolveExplicitXiaohongshuAccount` as the single resolver. If any caller has a platform-only overload, remove it or require a non-empty `platformAccountId`; do not select `accounts[0]`. Keep the gate adapter stopped at final-submit discovery and do not add calls to `createArticlePublishJob`, `prepareSubmissionIntent`, `insertPublishRecord`, `collectPublishResult`, or `finalSubmit`.

- [ ] **Step 4: Run the focused gate-only tests and inspect evidence**

Run: `pnpm exec vitest run tests/v142-xiaohongshu-gate-only.test.ts tests/xiaohongshu-account-routing.test.ts`; then run the existing gate-only script in its test-safe mode if available and inspect `output/v142-xiaohongshu-gate-only.json` for `finalSubmitCount=0` and no publish-domain record creation.

Expected: PASS and zero final submit/domain side effects.

- [ ] **Step 5: Commit the gate routing proof**

Run:

```bash
git add tests/v142-xiaohongshu-gate-only.test.ts tests/xiaohongshu-account-routing.test.ts scripts/v142-xiaohongshu-gate-only.helpers.ts
git commit -m "test: enforce explicit xiaohongshu gate account routing"
```

### Task 5: Add regression coverage for platform definitions and account status presentation

**Files:**
- Modify: `tests/runtime-adapter-registry.test.ts`
- Modify: `tests/account-connection.test.ts`
- Modify: `tests/v04-platform-integration.test.ts` only if an existing regression assertion is the correct location.

**Interfaces:**
- Consumes: `createRuntimeAdapterRegistry`, `seedPlatformCatalog`, `syncAdapterManifests`, `addAccountConnectionMode`, `listPlatforms`.
- Produces: proof that the normal platform list contains ordinary Xiaohongshu with the correct label/mode, old merchant/private keys remain distinct, and Weibo/Toutiao/Sohu registrations remain unchanged.

- [ ] **Step 1: Write the failing catalog and status assertions**

Add assertions to `tests/runtime-adapter-registry.test.ts`:

```ts
  it("keeps ordinary, merchant, and private Xiaohongshu keys distinct", () => {
    const registry = createRuntimeAdapterRegistry(new MemoryCredentialStore(), false);
    expect(registry.get("xiaohongshu").manifest).toMatchObject({ platformKey: "xiaohongshu", displayName: "小红书", transport: "browser", integrationMode: "BrowserAutomation" });
  });
```

Because historical placeholder keys are catalog entries rather than runtime adapters, assert their distinct CSV rows in the same test instead of calling `registry.get` for them:

```ts
const csv = readFileSync(join(process.cwd(), "PLATFORMS.csv"), "utf8");
expect(csv).toContain("xiaohongshu_business,小红书商家号");
expect(csv).toContain("xiaohongshu_private,小红书私信版");
expect(csv).toContain("xiaohongshu,小红书,图文");
```

Add a repository-sync test using a stale DB row: after `seedPlatformCatalog`, update the ordinary xiaohongshu row to old `official_sdk`/`API` metadata, call `syncAdapterManifests`, and assert it returns to `小红书`/`browser`/`BrowserAutomation` while the old CSV keys remain unchanged.

- [ ] **Step 2: Run the regression tests and verify the stale metadata failure**

Run: `pnpm exec vitest run tests/runtime-adapter-registry.test.ts tests/account-connection.test.ts tests/v04-platform-integration.test.ts`

Expected: the stale-row assertion fails before startup sync is exercised with the rebuilt registry, or the test immediately exposes a key/mode regression.

- [ ] **Step 3: Implement only the catalog/overlay correction needed by the failing test**

Use the existing `syncAdapterManifests` and `addAccountConnectionModes` path. Do not rename the historical rows or change unrelated adapters. If the ordinary platform row is already corrected by current dirty changes, the implementation step is limited to making the regression fixture call the real startup sync path and ensuring no renderer-only label overrides are needed.

- [ ] **Step 4: Run the regression suite and commit**

Run: `pnpm exec vitest run tests/runtime-adapter-registry.test.ts tests/account-connection.test.ts tests/v04-platform-integration.test.ts`.

Expected: PASS with Weibo, Toutiao, Sohu, ordinary Xiaohongshu, merchant placeholder, and private placeholder assertions intact.

Commit:

```bash
git add tests/runtime-adapter-registry.test.ts tests/account-connection.test.ts tests/v04-platform-integration.test.ts
git commit -m "test: protect xiaohongshu platform registration boundaries"
```

### Task 6: Update state/evidence and perform source verification

**Files:**
- Modify: `PROJECT_STATE.md`
- Create: `output/v142-xiaohongshu-account-connection.json`
- Modify: `docs/PLATFORM_CAPABILITY_MATRIX.md` only if the current ordinary Xiaohongshu row is missing the verified desktop account path.

**Interfaces:**
- Consumes: focused test output, repository/account evidence, gate-only evidence, and build artifact paths.
- Produces: an auditable state entry that distinguishes source implementation, installed-app deployment, owner manual-login status, identity status, gate-only result, and the required zero-side-effect result.

- [ ] **Step 1: Create the typed evidence record and update PROJECT_STATE.md**

Record the source/runtime result with fields for `platformVisible`, `platformKey`, `connectionMode`, `addAccountAvailable`, `accountCreated`, `internalAccountId`, `displayName`, `externalAccountId`, `browserSessionKey`, `login`, `accountIdentity`, `multiAccountSupport`, `gateOnlyStarted`, `gateOnlyResult`, `finalSubmitCount`, `jobCreated`, `intentCreated`, `publishRecordCreated`, and `publishPassed`. Use `WAITING_FOR_OWNER_LOGIN`/`NOT_EXECUTED` when the real owner has not completed manual login; never mark it as successful based only on source tests.

Prepend a dated `V1.4.2 Xiaohongshu desktop account connection` section to `PROJECT_STATE.md`, link the evidence file, list focused/full verification status, and state the exact installed-app deployment order still pending or completed.

- [ ] **Step 2: Run focused tests and commit documentation/evidence**

Run: `pnpm exec vitest run tests/xiaohongshu-account-routing.test.ts tests/v142-xiaohongshu-gate-only.test.ts`.

Commit:

```bash
git add PROJECT_STATE.md output/v142-xiaohongshu-account-connection.json docs/PLATFORM_CAPABILITY_MATRIX.md tests/xiaohongshu-account-routing.test.ts
git commit -m "docs: record xiaohongshu account connection evidence"
```

### Task 7: Rebuild, deploy, restart, and perform the owner-visible verification

**Files/Artifacts:**
- Build output: `out/`, `release/win-unpacked/`
- Installed app: `C:\GMP116ZhihuL5\Geo Media Publisher\Geo Media Publisher.exe` and `C:\GMP116ZhihuL5\Geo Media Publisher\resources\app.asar`
- Backup directory: `C:\GMP116ZhihuL5\Geo Media Publisher.previous-20260827-xiaohongshu-account-connection\`
- Evidence: `output/v142-xiaohongshu-account-connection.json`, `PROJECT_STATE.md`

**Interfaces:**
- Consumes: passing source tests/typecheck/lint/build and existing production data directory.
- Produces: a restarted installed app whose startup `syncAdapterManifests` upgrades the stale ordinary Xiaohongshu platform row without editing the production DB by hand.

- [ ] **Step 1: Run focused tests before the production build**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/index.test.ts packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-account-routing.test.ts tests/v142-xiaohongshu-gate-only.test.ts tests/runtime-adapter-registry.test.ts tests/platform-connection-ui.test.ts tests/xiaohongshu-account-center-ui.test.ts`.

Expected: PASS.

- [ ] **Step 2: Run the complete required source checks**

Run in this order:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: each command exits 0. Do not deploy if any command fails; fix through a new RED test when behavior is wrong.

- [ ] **Step 3: Build the installed-app package after source build succeeds**

Run the package build that populates `release/win-unpacked` (the repository’s existing `pnpm installer` path if it is the established command), then verify:

```powershell
Test-Path 'release\win-unpacked\Geo Media Publisher.exe'
Test-Path 'release\win-unpacked\resources\app.asar'
Select-String -Path 'release\win-unpacked\resources\PLATFORMS.csv' -Pattern '^xiaohongshu,小红书,图文,.*BrowserAutomation$'
```

The packaged resource must contain ordinary `xiaohongshu` with the BrowserAutomation row before copying anything into the installed directory.

- [ ] **Step 4: Back up and stop the exact installed process before replacement**

Resolve the running PID by executable path, close only `Geo Media Publisher.exe`, wait until that exact process exits, and verify the destination paths are exactly inside `C:\GMP116ZhihuL5\Geo Media Publisher`. Move/copy the existing executable and `resources\app.asar` into `C:\GMP116ZhihuL5\Geo Media Publisher.previous-20260827-xiaohongshu-account-connection\` before replacing them. Do not delete the production data directory or credentials.

- [ ] **Step 5: Replace the installed binary/resources and restart the same installed executable**

Copy `release\win-unpacked\Geo Media Publisher.exe` and `release\win-unpacked\resources\app.asar` to the verified installed paths, preserve the existing `resources\PLATFORMS.csv` only when the packaged file has been verified, launch the installed executable, and wait for its renderer window. Startup must perform the normal DB catalog sync; no manual SQL account/platform edit is allowed.

- [ ] **Step 6: Verify platform visibility before creating an account**

In the restarted installed app, open the account center and verify ordinary `小红书` is visible with `图文`, `浏览器自动化`, and `+ 添加账号`; verify the merchant/private labels remain separate. Record `platformVisible=YES`, `platformKey=xiaohongshu`, and `connectionMode=BrowserAutomation` only from the actual UI/API observation.

- [ ] **Step 7: Click “+ 添加账号” and verify creation/session before login**

Click the ordinary Xiaohongshu `+ 添加账号` action. Verify a new internal UUID is created and the visible BrowserSession opens at the official creator/login entry. Record the internal ID and `browserSessionIdHash(platformKey, accountId)`. If the owner has not yet logged in, stop at this point and report the exact visible BrowserSession/window where manual login is required.

- [ ] **Step 8: Complete only owner-controlled login and then verify identity separately**

After the owner finishes normal login/security checks, click `我已完成登录`. First verify login/session state (`logged_in`, encrypted session stored, no login/security page). Then verify identity independently: display nickname may be saved; external account ID/profile URL is saved only if the adapter read a stable profile signal. Verify a second `+ 添加账号` creates a different UUID and session key, and disconnecting/failing one row leaves the other logged-in row/session unchanged.

- [ ] **Step 9: Run account-specific gate-only with the selected internal ID**

Use the account-level `自测`/gate-only entry for the exact created account ID. Verify the evidence records that ID, the expected BrowserSession key, and `finalSubmitCount=0`. Verify no Job, SubmissionIntent, PublishRecord, or `PublishPassed=PASS` was created. Do not click any final publish control.

- [ ] **Step 10: Update final evidence and commit deployment verification**

Update `output/v142-xiaohongshu-account-connection.json` and `PROJECT_STATE.md` with actual values or `WAITING_FOR_OWNER_LOGIN`; include the installed package path, backup path, timestamp, owner-login status, identity status, exact account ID(s), and zero-side-effect counts. Run `git diff --check`, inspect `git status`, and commit only the final state/evidence files.

### Task 8: Final verification and handoff

**Files:**
- No production source changes; inspect all changed files and evidence.

- [ ] **Step 1: Re-run all focused tests after deployment edits**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/index.test.ts packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-account-routing.test.ts tests/v142-xiaohongshu-gate-only.test.ts tests/runtime-adapter-registry.test.ts tests/platform-connection-ui.test.ts tests/xiaohongshu-account-center-ui.test.ts tests/account-connection.test.ts tests/v04-platform-integration.test.ts`.

- [ ] **Step 2: Re-run the required full checks if source changed after the prior run**

Run: `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` whenever any source/test change occurred after Task 7 Step 2; record fresh exit status and key counts.

- [ ] **Step 3: Inspect the final diff for forbidden behavior**

Run:

```bash
git diff --check
rg -n "accounts\[0\]|connectedRows\[0\]|rowsByPlatform|get\(platformKey\).*first|finalSubmit\s*\(|createArticlePublishJob|prepareSubmissionIntent|insertPublishRecord|PublishPassed.*PASS" apps/desktop packages/adapters/xiaohongshu scripts/v142-xiaohongshu-gate-only* tests
```

Expected: no account-action fallback or Xiaohongshu final-submit/domain-record path; test fixtures may mention forbidden tokens only inside assertions that enforce their absence.

- [ ] **Step 4: Report the evidence table and stop at the owner-login boundary when applicable**

The final report must include `Xiaohongshu Platform Visible in Desktop`, `Platform Key`, `Connection Mode`, `Add Account Available`, `Account Created`, `Internal Account ID`, `Display Name`, `External Account ID`, `Browser Session Key`, `Login`, `Account Identity`, `Multi-account Support`, `Gate-only Started`, `Gate-only Result`, `Final Submit Count=0`, `Job Created=NO`, `Intent Created=NO`, `PublishRecord Created=NO`, and `PublishPassed=NOT_PASS`. If owner login is still pending, say exactly which visible BrowserSession needs owner action and do not claim login/identity/gate completion.
