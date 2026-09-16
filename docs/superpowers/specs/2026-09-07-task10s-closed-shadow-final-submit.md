# Task10S r33 Closed-Shadow Final Submit Design

## Problem

XHS renders the real image-post final publish control inside the closed shadow root of a unique `xhs-publish-btn` host. A document-global exact text scan therefore returns zero even though the visible native publish button exists. The normal XHS production final-submit resolver must remain unchanged.

## Design

1. Add a Task10S-only host resolver. It recognizes only the fixed `xhs-publish-btn` host, requires exactly one connected/rendered host, and validates the fixed submit attributes (`is-publish`, `submit-text`, `submit-disabled`, `submit-loading`). Presence is independent from enabled state.
2. Add a Main-owned bounded CDP resolver for the current canonical Playwright Page. It creates a CDP session through the current BrowserContext, enables the DOM domain, calls `DOM.getDocument` with `depth=-1` and `pierce=true`, and traverses only the current document tree and the host's closed shadow roots. It requires exactly one host and exactly one inner native `button` with exact text `发布`; draft buttons are ignored.
3. Return only safe metadata for the host and inner button. Node IDs remain internal. No `shadowRoot` JavaScript access, HTML dump, selector input, URL/Page/Context input, or generic button scan is allowed.
4. Before the final mutation, resolve the host and inner button again. Scroll the freshly resolved inner node into view, obtain its current box model, and dispatch exactly one CDP `mousePressed`/`mouseReleased` pair at the derived center. The click boundary is one-shot: after the press begins, no retry is possible.
5. Reuse existing fixed title/body readback, identity, authorization, retained-editor, PublishRecord, and one-shot guard gates. The new path must never upload. Normal `finalSubmit` behavior remains unchanged unless the internal Task10S retained-editor marker is present.

## Safety invariants

- Unique host and unique exact inner publish button are required; zero or multiple candidates fail closed.
- Host disabled/loading and inner `aria-disabled`/`aria-busy` are independently checked.
- No host click, coordinate hardcode, stale backend node reuse, upload call, Attempt6, or deployment is allowed.
