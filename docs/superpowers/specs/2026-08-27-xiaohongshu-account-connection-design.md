# Xiaohongshu Desktop Account Connection Design

## Goal

Expose the formal `xiaohongshu` BrowserAutomation platform in the desktop account workflow so an owner can create an independent account record, complete normal manual login in a visible BrowserSession, persist the encrypted session, and see the verified account identity without creating any publish Job, SubmissionIntent, PublishRecord, or real publish result.

## Current findings

- `PLATFORMS.csv` already contains the formal `xiaohongshu` row and retains the historical `xiaohongshu_business` and `xiaohongshu_private` rows as separate capabilities.
- The runtime registry already registers `XiaohongshuBrowserAdapter` under `platformKey=xiaohongshu`; its manifest declares `transport=browser`, `integrationMode=BrowserAutomation`, article/image-post support, and no video support.
- Desktop startup seeds the catalog and then calls `syncAdapterManifests`; this is the existing path that upgrades a stale platform row when the new package is actually launched.
- The running installed application is an older package from `C:\GMP116ZhihuL5\Geo Media Publisher`; its bundled catalog still describes the old `xiaohongshu` official SDK boundary. The source and rebuilt package must therefore be deployed before installed-app verification.
- The generic V1.1 account center already supports per-account self-test rows, but its platform card reuses the first account when connecting and has no generic “add another BrowserAutomation account” action. The platform capability page also summarizes only one row and does not expose a multi-account add action.

## Design

### Platform registration and catalog

Keep the three platform keys distinct:

- `xiaohongshu` — ordinary creator image-note BrowserAutomation.
- `xiaohongshu_business` — historical merchant capability placeholder.
- `xiaohongshu_private` — historical private-message capability placeholder.

Do not migrate or rename existing rows. The package resource must contain the formal `xiaohongshu` BrowserAutomation catalog row, and startup manifest synchronization remains the source of truth for the registered adapter’s display name, transport, integration mode, and capabilities.

### Account lifecycle

Use the existing lifecycle without adding a second account model:

1. The renderer requests `accounts:create` with `platformKey=xiaohongshu` and receives a generated UUID.
2. The renderer invokes `accounts:begin-login` with that exact account ID.
3. The adapter opens a visible, account-scoped BrowserSession using the existing session identity `{ platformKey, accountId }`, navigates to the official creator entry, and pauses for owner-controlled login and platform security verification.
4. On explicit “I finished login”, the main process calls `completeConnection`, validates multiple login signals, saves the BrowserSession through the encrypted credential store, and closes only that temporary visible session.
5. The main process obtains the account profile from the same account-scoped session or restored session. It persists a safe nickname when available and persists an external account ID only when a stable page/profile identifier is actually present. No external ID is guessed from a nickname or local account ID.
6. A failed or expired account is marked for user action/paused according to the existing account lifecycle. Other account IDs and their session keys remain untouched.

### Multi-account desktop UI

Generalize the existing BrowserAutomation UI rather than adding an Xiaohongshu-only component:

- Any BrowserAutomation platform always exposes an explicit `+ 添加账号` action.
- Initial connection may reuse an existing incomplete container; the add action always creates a fresh account record and never replaces a connected account.
- The account center displays the connected count and names/aliases, and its account-level actions target the exact account ID.
- The platform capability page displays all rows for the selected platform and provides account-specific login, check, open-backend, relogin, disconnect, and self-test navigation. No platform-level action silently selects a random or first account.

### Gate-only and safety boundary

The existing `platformSelfTest` APIs and V1.4.2 runner continue to require an explicit `platformAccountId`/`XIAOHONGSHU_ACCOUNT_ID`. The renderer self-test action must carry the selected account’s ID; missing IDs fail closed and never fall back to the first account. The Xiaohongshu adapter remains stopped after final-submit discovery with `finalSubmitClickCount=0`, and the connection workflow itself never creates publish-domain records.

## Error handling and observability

- Browser runtime failures continue through `BrowserRuntimeError` and the existing diagnostic logger.
- Login pages, security/verification pages, and missing identity evidence remain user-action states; no CAPTCHA, QR, SMS, slider, or risk-control bypass is added.
- Identity sync and login completion log the account ID and platform key, but never cookies, storage state, tokens, or secrets.
- UI messages identify the visible BrowserSession flow and tell the owner where manual verification is required.

## Testing strategy

Add focused tests for catalog/manifest synchronization, fresh multi-account creation, distinct session keys, identity persistence with and without stable external IDs, isolated login failure, explicit self-test account routing, and zero final-submit side effects. Preserve the existing adapter-specific tests and add regression assertions that merchant/private placeholder keys and Weibo/Toutiao/Sohu registrations are unchanged. Finish with focused tests plus `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

## Explicit non-goals

- No real Xiaohongshu note publish.
- No final-submit click, `PublishPassed=PASS`, Job, SubmissionIntent, or PublishRecord creation from gate-only or account connection.
- No change to Weibo, Toutiao, Sohu, Publisher state machine, Scheduler, SubmissionIntent, or PublishRecord behavior.
- No new credential enum, migration, or platform-specific account UI architecture.
