# Task10W XHS Canonical Page Runtime Probe

## Goal

Expose a narrow, typed, read-only Main-process probe for the existing authenticated Xiaohongshu canonical Page so Task10V can obtain authoritative Playwright URL, same-Page DOM URL, and bounded Creator identity evidence without navigation, arbitrary JavaScript, or authorization convergence.

## Design

`XiaohongshuBrowserAdapter.inspectCanonicalPageRuntime` is the single browser-facing entry point. It runs under the existing account operation mutex, resolves only `activeCanonicalPage(ctx)`, verifies that the Page belongs to the returned Session Context, reads `page.url()`, and executes one fixed `page.evaluate(() => location.href)` probe. It never creates a Context/Page, navigates, clicks, uploads, or mutates the editor.

The adapter returns a typed runtime observation containing canonical and probed Context/Page IDs, sanitized Playwright and DOM URLs, URL consistency based on origin and pathname, explicit evaluate status/error class, runtime auth/session state, and bounded allowlisted identity candidates. The fixed page-side probe reads only visible public profile anchors, account-ID text, safe `data-*` identifiers, ARIA labels, and bounded account-menu/profile text; it does not inspect cookies, storage, headers, tokens, arbitrary globals, or response bodies.

`XhsIdentityService` exposes the observation through a read-only Main method and reuses it for identity verification. Its existing convergence method remains the only path that can call authorization convergence, and it can do so only after exact stable Creator-ID proof. IPC and preload expose a payload-free account-scoped probe channel; Renderer input cannot provide a URL, selector, script, Context ID, or Page ID.

## Failure semantics

Missing canonical Page, ownership mismatch, closed Page, disconnected browser, URL mismatch, and `location.href` evaluation failure are structured failures. Evaluation errors retain their class and stage and are never converted into an identity-positive or generic incomplete result. A missing stable Creator ID yields an explicit unverified observation; a stable ID different from the expected account ID fails closed and blocks convergence.

## Verification

Adapter tests cover same-Page URL/DOM probing, origin/path normalization, evaluation failure, Context/Page correlation, bounded identity extraction, safe-source restrictions, and no navigation/click. Main service and IPC contract tests cover probe routing, exact account scoping, identity match/mismatch, and convergence gating. Existing Task10R/Task10S/Task10U/Task10V regressions must remain green.
