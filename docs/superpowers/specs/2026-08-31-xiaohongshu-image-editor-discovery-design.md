# Xiaohongshu Image Editor Discovery Design

## Goal

After the already verified Task10I navigation click reaches `/publish/publish`, the Xiaohongshu adapter must perform bounded, read-only editor-shell readiness and structured control discovery. A Gate result must preserve the distinction between navigation failure, editor-shell failure, and an individual missing or ambiguous control.

## Constraints

- The existing canonical authenticated Page, BrowserContext, account mutex, and heartbeat lifecycle remain authoritative.
- Editor shell readiness is a separate phase from control discovery. The first missing control query is not an immediate navigation failure.
- Discovery is read-only: no click, fill, type, keyboard input, file upload, draft save, settings mutation, or final submit.
- Each critical control is fail-closed with `FOUND_UNIQUE`, `NOT_FOUND`, `AMBIGUOUS`, `NOT_VISIBLE`, or `DISABLED` evidence where applicable.
- Publish settings are observable but are not a mandatory PASS requirement; absence is represented as structured `NOT_APPLICABLE` evidence.
- `preparePublish` continues to share the discovery selectors/contract but retains its existing mutation boundary after successful discovery.
- Final-submit counts come only from explicit structured final-submit action markers.
- No Task10J second-level image-post click is introduced.

## Design

`inspectImagePostEditor(page, metadata)` is a side-effect-free adapter helper. It first samples the current route and safe DOM counts for a bounded readiness window of at most approximately three seconds. It emits `IMAGE_EDITOR_INSPECTION_STARTED`, one or more `IMAGE_EDITOR_READINESS_SAMPLE` events, and one shell result marker. A route can be correct while the shell is still loading; only a stable shell signal permits control discovery.

Once the shell is ready, the helper discovers content type and each required control using stable accessibility, semantic, and data-attribute signals already supported by the adapter. It returns a typed result containing statuses, safe candidate identities, security/login flags, sanitized URL, and precise failure metadata. Candidate values never include title/body content, handler source, credentials, cookies, or storage state.

The Gate calls the helper after `navigateToImagePostEditor(..., "GATE_NAVIGATION")`. If the route is reached but discovery does not pass, the returned result is `needs_user_action` with `failureStage: "EDITOR_DISCOVERY"` and a precise failure code. Navigation failures retain their existing navigation-stage codes. `preparePublish` uses the same discovery primitives and selector policy, but it does not call the Gate helper and does not mutate until its own discovery checks have passed.

Task10A parses the new markers into readiness samples, shell result, content type, candidate lists, control statuses, publish-settings evidence, and precise discovery failure fields. The parser treats only explicit final-submit action markers as final submits; navigation and discovery marker names are never substring-counted.

## Verification

TDD coverage will exercise delayed shell rendering, shell timeout, content type classification, unique/missing/ambiguous/hidden/disabled controls, security/login fail-closed handling, settings `NOT_APPLICABLE`, Gate zero side effects, Task10I one-click behavior, canonical Page/mutex/heartbeat continuity, preparePublish mutation ordering, analyzer marker extraction, and explicit final-submit counting. Focused tests precede full test, typecheck, lint, build, package audit, read-only DB comparison, selective commit, and inactive-profile deployment.
