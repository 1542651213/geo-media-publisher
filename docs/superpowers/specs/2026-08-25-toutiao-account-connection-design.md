# Toutiao Account Connection Capability Design

**Status:** Approved in chat on 2026-08-25

## Goal

Expose the existing Toutiao article BrowserAutomation session through the shared Account Center connection lifecycle while preserving the official Toutiao video API adapter and its content-aware runtime routing.

## Root cause

The runtime registers two adapters with the same formal platform key:

- `ToutiaoAdapter` supports video through the official API.
- `ToutiaoArticleBrowserAdapter` supports article preparation through BrowserAutomation.

Content execution already resolves these adapters with `AdapterRegistry.getForContent(platformKey, contentKind)`. Account lifecycle operations still resolve `registry.get(platformKey)`, whose default adapter is the video adapter. The persisted platform metadata therefore remains `official_api / API`, and the Account Center does not render a BrowserAutomation connection action. The same default lookup also sends `accounts:begin-login`, `complete-login`, `open-backend`, and `check-login` through the video adapter instead of the existing encrypted browser-session flow.

## Architecture

### Separate publish capability from account connection capability

Add an optional runtime-derived `accountConnectionMode` field to the domain `Platform` view. It is an account-lifecycle capability, not a replacement for `integrationMode`:

- `integrationMode` remains the primary publish/integration mode. For Toutiao it remains `API`, so video job routing and API auto-publish decisions are unchanged.
- `accountConnectionMode` is derived from the registered adapter that owns account connection. For Toutiao it is `BrowserAutomation`; for ordinary single-adapter platforms it follows the existing adapter capability.

The field is derived during `platforms:list` from the live registry rather than persisted in the database. No migration or new credential/session table is required.

### Shared registry resolution

Add an `AdapterRegistry` account-connection resolver that:

1. Finds adapters registered for the platform key that implement the shared automation connection contract.
2. Returns the unique connection adapter when one exists.
3. Falls back to the existing default adapter for single-adapter OAuth/API/manual platforms.
4. Throws when multiple connection adapters are ambiguous.
5. Leaves `getForContent()` and `get()` semantics intact.

For `toutiao`, this resolver returns `ToutiaoArticleBrowserAdapter`; the video adapter remains the result of `getForContent("toutiao", "video")`.

### IPC data flow

Account lifecycle IPC handlers use the account-connection resolver:

`begin-login` → visible BrowserAutomation session → official Toutiao creator page → owner completes normal login/security verification → `complete-login` → existing login detection → existing encrypted CredentialStore `session:toutiao:<accountId>` save → `syncBrowserPlatformAccount`.

`open-backend`, `refresh-login`, `check-login`, `cancel-login`, and `disconnect` use the same resolved connection adapter. Credential configuration remains on the default publish adapter so Toutiao’s official video OAuth credentials remain available and are not rewritten as browser credentials.

The connection flow never calls the publisher or scheduler and never creates a Job, SubmissionIntent, or PublishRecord.

### Renderer behavior

The V1.1 Account Center and the existing platform-connection UI use `accountConnectionMode` for account actions:

- unconnected BrowserAutomation capability: `连接账号`;
- connected BrowserAutomation capability: `打开后台` and `重新登录`;
- expired or login-required BrowserAutomation capability: `重新登录`;
- existing `自测` and article publish actions remain where already present.

No platform-key conditional such as `if (platform === "toutiao")` is added.

## Session and safety rules

- The browser opens with `VISIBLE` execution mode for connection and relogin.
- QR, password, SMS, CAPTCHA, and security verification remain entirely manual.
- The existing encrypted CredentialStore is the only session persistence boundary.
- Session identifiers shown in logs or UI remain hashes; cookie, token, storage state, and credential contents are never logged or written to project state.
- A failed login check does not create or replace a valid stored session.
- Existing valid session data remains intact until a new login has passed detection and the new storage state has been saved.
- Opening the dashboard reuses the stored account session and performs no publish action.
- `finalSubmitClicks` remains `0` throughout this scope.

## Error handling

- Missing or ambiguous connection adapter: fail closed with a safe account-connection error.
- Browser runtime unavailable: preserve existing diagnostic redaction and account error-state handling.
- Login/security page still active: return `needs_user_action`; do not save a valid session.
- Session save failure: do not mark the account connected; do not create publish artifacts; preserve any previously valid stored session.
- Expired stored session: expose `重新登录` while keeping `LOGIN_REQUIRED` behavior for SELF_TEST.

## Verification

Add or update focused tests for:

1. Same-key registry resolution selects BrowserAutomation for account connection and preserves video/article content routing.
2. Toutiao BrowserAutomation connection opens visible mode, detects manual login, persists through the existing session manager, and reloads the stored session.
3. Failed login and session-save failure do not produce a valid account state.
4. Platform metadata exposes `accountConnectionMode=BrowserAutomation` while retaining `integrationMode=API`.
5. Account Center actions show connect/relogin/dashboard actions from capability metadata.
6. Account lifecycle operations do not create Job, PublishRecord, SubmissionIntent, or final submit side effects.
7. `finalSubmitClickCount` remains `0` and the official video adapter route is unchanged.

Run the project-required validation commands after implementation:

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Update `PROJECT_STATE.md` with the implementation and verification gates only. Do not record cookies, tokens, credentials, or session contents.

## Scope boundary

This change does not implement article final submission, does not execute Toutiao SELF_TEST, does not publish, does not modify the official video adapter’s API/auth/publish behavior, and does not alter existing account/session storage formats.
