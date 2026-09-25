# Toutiao MVP-5.1 controlled runtime

This path is off by default. It operates only on the explicitly selected, previously authorized account. Never place credentials, signed requests, or Browser StorageState in a shell command, log, diagnostic output, or repository file.

## Diagnostic process gates

Start one packaged app main instance with these process-scoped variables:

- `TOUTIAO_MVP5_ONE_SHOT_ENABLED=true`
- `TOUTIAO_PROTOCOL_SHADOW_ENABLED=true`
- `TOUTIAO_MVP5_ACCOUNT_ID=<exact saved account ID>`
- `TOUTIAO_MVP5_EXPECTED_CREATOR_ID=<stable owner creator ID>`

The scheduler and ordinary publish IPC routes are paused in this process. The normal Article API feature flag remains off. The exact account and creator ID are verified against the live account-owned BrowserContext; a saved `logged_in` flag is insufficient.

Use the Main-backed diagnostic bridge in this order:

1. `oneShotBuildIdentity()` and `accounts.getRuntimeSessionStatus()` verify the packaged Main code and runtime ownership.
2. `oneShotRuntimePreflight(accountId)` activates the saved session if needed; checks live login and creator identity; performs a guarded, read-only management-list smoke; verifies a database backup; then synchronizes the encrypted Bundle. It returns metadata only.
3. `oneShotPrepareTestJob(accountId)` creates or reuses one transparent `source=test` Job with no image and a frozen Toutiao settings snapshot. Record its Job ID and title from the ordinary Job/Article views.
4. Only after readback and account binding are proven, `oneShotCapturedReplay(accountId, jobId)` claims the task-wide ticket, captures and aborts one browser publish request, then uses the R1-A durable final-submit claim before any Node POST.
5. If final submit was claimed, use `oneShotReconcile(accountId, jobId)` for read-only target-row and public-page checks. An absent or ambiguous row is unknown. Never send another POST.

The claim file in the app's production-data diagnostics directory is an irreversible task-wide stop marker. Never remove it to obtain another attempt. A crash after its creation requires a read-only audit of the Job, Intent and Record before deciding any next action.

At task end, close the packaged application normally to discard in-memory signed material. The persistent write-deny route stays in the BrowserContext until that application instance exits.
