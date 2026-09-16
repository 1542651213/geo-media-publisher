# Task 10G: Xiaohongshu Creator Home Readiness and DOM Topology Discovery

## Scope

Add bounded, read-only diagnostics around the existing Xiaohongshu Creator Home readiness check. Preserve the existing publish-entry resolver and all canonical-page, account-mutex, heartbeat, authentication, and publishing side-effect behavior.

## Implementation steps

1. Add RED tests for single-snapshot readiness, bounded observation, bounded DOM topology, semantic nodes and nearest interactive ancestors, same-origin/cross-origin frame metadata, open shadow-root metadata, bounded output, and zero-click behavior.
2. Implement page-evaluate diagnostics that return only safe, bounded fields. Add a bounded observation loop that recognizes a populated stable shell without requiring a publish entry.
3. Emit operation-correlated readiness, topology, semantic, frame, shadow, and accessibility diagnostics from the existing editor-entry path without changing its click strategy.
4. Extend the read-only Task 10A analyzer to correlate and summarize the new diagnostics.
5. Run focused and full verification, package inspection, and read-only production DB checks. Deploy only if the installed app and target XHS profile are demonstrably inactive; otherwise leave the installed artifact untouched.

## Safety invariants

- No login, checkLogin, live Gate, SELF_TEST, preparePublish, content mutation, upload, draft save, or submit.
- Diagnostics never call click, fill, type, keyboard, setInputFiles, save, or submit.
- No cookies, tokens, storage values, full HTML, innerHTML, outerHTML, or unbounded page text are recorded.
- Unrelated dirty files and historical artifacts remain untouched and unstaged.
