# Toutiao MVP-5.1 controlled runtime

## MVP-5.3 successor capture

The MVP-5.1 instructions below describe the original capture only. Once `toutiao-mvp-5-one-shot.claim` exists, **do not** call `oneShotRuntimePreflight`, `oneShotPrepareTestJob`, or remove that claim to start over. For an Owner-approved successor, use the same original account and Job with the packaged MVP-5.3 code. `oneShotBindingReadiness(accountId, jobId)` and `oneShotManagementDiagnostic(accountId)` are read-only checks.

The default-off `oneShotCapturedReplay(accountId, jobId)` path now verifies the original self-test authorization and locked predecessor ticket, checks the unused Job submit budget and target management row, and then shows an Electron Main confirmation dialog with the account, Job, title, content hash and one-shot limits. Cancel is the default. Only the Owner's affirmative dialog response allows editor activation. The successor claim is written exclusively after title/body and required-field readback, immediately before the one permitted editor action. It records the predecessor digest and shares the original Job's durable submit budget. Never invoke this path merely to inspect the dialog, and never automate the Owner's affirmative click.

If the successor claim is created but capture or binding fails, keep both claims. Do not click again, start a second capture, or send through a different transport. Close the packaged app normally so the guarded editor and in-memory request are released. Use only read-only reconciliation if the browser abort or Node send state is uncertain.

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
