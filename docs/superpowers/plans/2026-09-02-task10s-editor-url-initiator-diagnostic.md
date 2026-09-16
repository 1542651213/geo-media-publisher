# Task10S editor request URL and initiator classification

## Scope

Extend the fixed, read-only Xiaohongshu editor bootstrap diagnostic so failed XHR/fetch requests retain a safe URL scheme/classification and bounded CDP initiator evidence. This distinguishes HTTP failures from opaque, browser-internal, extension, malformed, and other non-HTTP requests without exposing sensitive URL components.

## Safety contract

- Observe only the existing canonical Page through its existing CDP session.
- Keep at most three initiator stack frames per request, with scheme, host category, allowlisted Xiaohongshu pathname, and bounded line/column numbers.
- Emit only approved XHS origins and pathnames; never expose third-party hostnames, query strings, headers, request bodies, cookies, storage, tokens, or source code.
- Preserve the single fixed-route reload bound used by the prior diagnostic; do not add navigation, Page/Context creation, or editor/content mutation.
- Classify bootstrap failures conservatively; non-HTTP evidence must not be reported as a proven HTTP API failure.
- Keep Task10W identity, complete-login, Task10V authorization, and publication behavior unchanged.

## Verification

- Unit tests cover HTTP, blob, data, file, browser-internal, malformed, and initiator classification, bounded frame retention, redaction, and conservative bootstrap classes.
- Re-run focused tests, full tests, typecheck, lint, and build before packaging.
- Package and deploy as an independent r6 release, then execute exactly one live read-only diagnostic on the restored canonical runtime.
