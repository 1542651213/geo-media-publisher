# Account session persistence — R1.15-F

## Authority and startup

`accounts.login_status`, an old verification timestamp, a saved credential, or an existing profile directory is not proof of current authentication. Main owns `AccountSessionRehydrationCoordinator`; Renderer receives only a safe snapshot. Startup does not mark every account expired and does not run the scheduler's previous login sweep.

1. Read the exact account/platform binding and its company from `operations_account_company_bindings`.
2. For Douyin BrowserAutomation, select the article browser adapter, even when the registry's preferred connection adapter is OAuth. Do not probe OAuth for the already bound browser article account.
3. Restore only an existing exact platform/account browser profile or encrypted storage state. Restoration is hidden and requires no new login window. Missing state does not create a replacement account.
4. Read the live identity with that adapter. A successful transport response alone does not authenticate the account.
5. Compare it to the Main-owned expected remote identity. For Douyin also compare login generation. Website must be Authorized with write scope to become CONNECTED.
6. Re-read company, mode, identity, enabled state and login generation after asynchronous verification. A stale response cannot revive a disconnected/rebound/replaced account.

Startup uses two workers. Each account has an in-flight refresh identity; duplicates share the pending check. A conflicting company binding is quarantined rather than guessed. Ambiguous historical accounts remain unassigned and are not probed until their company is confirmed.

## Runtime states

| State | Meaning | Operational action |
| --- | --- | --- |
| CHECKING | Verification is running | Wait; do not create a formal job |
| AUTHENTICATED | Browser identity matches exactly | Still run fresh publish preflight |
| CONNECTED | API identity and authorization match | Still run fresh publish preflight |
| NEEDS_LOGIN | No usable browser auth or explicit unauthenticated result | Complete normal login |
| CREDENTIAL_INVALID | Explicit invalid/expired API credential | Owner updates credential |
| IDENTITY_MISMATCH | Remote identity/company/generation does not match | Stop; confirm binding |
| NETWORK_UNAVAILABLE | Network/service prevented verification | Keep credential; retry a read-only check |
| UNVERIFIED | Evidence or expected identity is missing | Confirm binding/check connection |
| DISABLED | Account is disabled/archived | Do not verify or publish |

Offline is not expired. Failed decryption is not guessed around. No browser context, storage state, cookie, raw remote identity, token or secret path is returned to Renderer. DTO contains account/platform/company identifiers, safe state, check time, generation and an error code. Normal UI maps those states to Chinese explanations; details retain internal codes.

## Persistence and isolation

- Browser keys use exact platform/account identities in the encrypted Main store. Persistent profile directories also use those identities.
- Browser contexts are not reused between accounts. Two accounts on one platform have separate contexts.
- Account-company binding is unique. An account cannot silently move from company A to B.
- Credentials use Electron SafeStorage and `credentials.enc`; SQLite stores references and non-secret metadata only.
- On Windows, encrypted credential backups also need the application's `Local State` OS-protected OSCrypt key context for a same-user private restore. A copied `credentials.enc` alone in a fresh userData directory can fail decryption even when the original credential is valid. Keep that context private, never print/upload it, and do not downgrade to plaintext storage. Preserve the exact persistent browser profiles separately when applicable.
- Website import verifies the chosen environment before persistence, checks the workspace again after the await, stores the complete encrypted credential bundle, and binds the created account to the originally selected company.
- A capability/read-only response remains separate from write permission. Existing private release authorization is not distributed in the installer.
- Restart proves neither login nor publishing permission. It initiates fresh identity verification.

## Publish remains independently gated

Existing ordinary paths for Douyin, Website and Toutiao remain enabled. Every batch capability remains false. Product Preflight and platform preparation perform their own current identity and content checks. Main verifies company ownership and the current Approved content hash again immediately before final submission. Developer Mode cannot bypass these checks.

Historical unknown submissions enter read-only reconciliation. They are not recreated, retried with a new identity, or overridden by an unrelated review-state change. A terminal historical result remains readable within its company.

## Verification and investigation

Focused tests are in `account-session-rehydration.test.ts`, `packages/adapters/core/src/browser.test.ts`, `packages/adapters/browser/src/index.test.ts`, runtime-registry, product-preflight and OfficialAPI tests. They cover restart, missing/expired state, network outage, API auth failure, wrong identity, duplicate company bindings, in-flight disconnect/rotation, two accounts/two companies and Douyin adapter routing.

`scripts/r115-f-browser-restore-smoke.mts` runs actual local Chromium contexts against a loopback identity page, saves encrypted fixture state, closes/recreates managers, and proves hidden restoration and identity isolation. It does not establish the current status of an Owner platform account.

`scripts/r115-f-live-readonly-restart.mjs` can inspect an already closed private backup twice with the installed executable. It copies encrypted credentials without displaying them, sets `TOUTIAO_READONLY_PREFLIGHT=true` to disable the scheduler, calls no Job/prepare/submit methods, and exports only aggregate runtime states. Unassigned accounts are reported separately. Exact observed states and limitations are in R1.15-F READY/evidence; a timeout is CHECKING, never PASS authentication.

When diagnosing, first inspect safe runtime state and error code, then binding/generation and the adapter route. Do not extract secrets from logs, export cookie contents, or change DB logged_in to manufacture authentication. Do not repeat final submission to test login.

## Owner follow-up

Use normal login for Weibo, normal Creator login for Sohu, and a new Owner PAT for CNBlogs when current credentials are invalid. Confirm company ownership for quarantined legacy accounts. Opening their formal publishing still requires a separate explicitly authorized real E2E task; F does not enable those platforms.
