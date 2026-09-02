# Task10S editor bootstrap network diagnostic

## Scope

Add a fixed, read-only diagnostic for the existing Xiaohongshu canonical Page so an editor bootstrap failure can be classified from CDP Network lifecycle evidence without entering the editor or mutating publication content.

## Safety contract

- Resolve only the account-owned canonical Page already held by the adapter.
- Attach CDP `Network.requestWillBeSent`, `Network.responseReceived`, and `Network.loadingFailed` listeners.
- Retain only bounded request IDs, method, XHR/fetch type, origin/pathname, response status/presence, failure text, blocked reason, CORS status, cancellation, and service-worker involvement.
- Never retain request headers, bodies, cookies, storage, tokens, or query strings.
- Perform at most one reload of the exact fixed `/publish/publish` route, after blocking when a non-empty draft control is detected.
- Expose the result through a fixed `xiaohongshu` IPC API with no caller-supplied URL, selector, or script.
- Keep Task10S preparation, Task10V, authorization, and publication mutations out of this diagnostic.

## Verification

- Unit tests cover safe event correlation, endpoint grouping, A–K classification, cleanup, and fixed-route rejection.
- Wiring tests cover adapter, IPC, preload, and shared API boundaries.
- Run focused tests, full tests, typecheck, lint, build, package hash verification, and one live diagnostic invocation after deployment.
