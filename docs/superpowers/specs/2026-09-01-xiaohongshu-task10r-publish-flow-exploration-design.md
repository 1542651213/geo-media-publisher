# Xiaohongshu Task10R Publish Flow Exploration Design

**Date:** 2026-09-01

**Status:** Approved for implementation

## Goal

Extend the existing Xiaohongshu browser adapter from bounded post-upload discovery to a bounded end-to-end publish-flow exploration that can reach a verified, enabled final-submit control without ever activating final publication.

## Non-negotiable safety contract

- The only live account is `54b390ac-d81e-440a-baeb-d00f9f346cc3`.
- The existing account-scoped mutex, canonical `BrowserContext`, and canonical authenticated `Page` are reused for the entire operation.
- The exploration creates no Job, SubmissionIntent, or PublishRecord.
- A safe fixture is the only upload input; upload attempts are bounded at 3 and every attempt is recorded.
- Intermediate publishing-flow controls may be clicked only after same-page/context revalidation, unique candidate resolution, visibility, enabled-state, and hit-test checks.
- Title, body, and mandatory settings mutations are bounded and explicitly counted.
- Final publish controls are discovery-only. No click, keyboard submit, form submit, or synthetic submit event is permitted. `FINAL_SUBMIT_COUNT` must remain `0`.
- Cookies, tokens, credentials, private storage, and image contents are never included in evidence.
- Login/security verification states remain owner-action blockers and are never bypassed.

## Architecture

### Typed operation mode

Add `XHS_PUBLISH_FLOW_EXPLORATION` as a typed exploration mode alongside the existing `POST_UPLOAD_DISCOVERY_ONLY` mode. The existing Task10P path remains unchanged and continues to stop after post-upload discovery. The new mode is exposed through a dedicated exploration entry point so it cannot accidentally call `preparePublish` or the final publish path.

### Adapter-owned state machine

The Xiaohongshu adapter owns the flow because selectors, page lifecycle, hit-test evidence, and platform phases are adapter concerns. The state machine reuses the current canonical-page resolver and mutex, then executes these bounded phases:

1. authenticate and revalidate canonical ownership;
2. observe Creator Home and navigate to `/publish/publish` with existing proven publish-entry diagnostics;
3. wait for functional image-post readiness for at most 10 seconds, allowing loading/transitioning while route, image-post classification, and upload capability become ready;
4. enter the image-only mutation boundary and attempt the safe fixture upload with bounded retries;
5. observe post-upload semantic inventory, topology, modal/overlay, preview, and phase;
6. resolve and click only high-confidence internal actions such as next, complete, confirm, continue, edit image, crop done, or return to editor, recording before/after evidence and stopping at 12 clicks;
7. once the post-upload editor is present, discover and fill the title and body with bounded strategies and verify readback;
8. discover required settings and mutate only controls proven to block final readiness;
9. discover the final-submit control and validate unique/visible/enabled/hit-test state without clicking it;
10. return a truthful PASS-ready result or a typed safe blocker.

### Evidence model

Define serializable exploration evidence containing operation metadata, canonical identity, timeline, phase snapshots, semantic nodes, interactive topology, media preview diagnostics, modal state, action logs, selector signals, title/body readback status without unnecessary content retention, required-setting mutations, final-submit status, counters, database baseline, and blocker. The runtime emits structured diagnostics through the existing logger and the entry layer writes the final sanitized report to `output/xiaohongshu-task10r-publish-flow-exploration.json`.

### UI and IPC boundary

Add a separate renderer action and confirmation copy for the exploration mode. The main-process handler validates the exact exploration mode and account ID, then invokes the adapter operation. The renderer never receives or manipulates a `Page`; it only displays the sanitized result. The final-submit prohibition is enforced in the adapter and represented in the result, not delegated to UI discipline.

## Budgets and stop conditions

The operation enforces these ceilings: 15 minutes total, 2 navigation restarts, 3 safe-image upload attempts, 12 intermediate action clicks, 1 refresh, 3 title mutation strategies, 3 body mutation strategies, and 0 final-submit clicks. Exceeding a ceiling produces a truthful blocker and preserves all evidence. Login/security verification, lost canonical ownership, unsafe ambiguity, unknown destructive UI, or an operation that would require final publication also stop immediately.

## Data and database behavior

The exploration reads the production database counts before and after and expects the publish domain to be unchanged. It must not call queue creation, submission-intent creation, formal publish-record creation, or `preparePublish`. If automatic platform behavior saves a draft, it is reported as observed external behavior rather than represented as a successful formal publish.

## Testing strategy

Use TDD. First add failing unit/contract tests for:

- the exploration mode and IPC request contract;
- canonical page/context/mutex ownership;
- functional readiness during transitioning/loading;
- upload attempt and retry ceilings;
- safe intermediate-action candidate resolution and before/after logs;
- title/body strategy limits and readback verification;
- mandatory-setting-only mutations;
- final-submit discovery with a hard non-click assertion;
- total budget exhaustion and safe blocker mapping;
- no Job/SubmissionIntent/PublishRecord and no `preparePublish` regression;
- existing generic self-test and Task10N/P/Q safety behavior.

Then implement the smallest adapter and entry-layer changes needed to make those tests pass, run focused tests after each slice, and finally run full tests, typecheck, lint, and build.

## Deployment and live exploration

Only a built/package artifact whose source commit and installed hash are recorded may be used for live exploration. Before deployment, persist the current evidence and database baseline. The live run must use the existing owner-established session, perform at most the authorized safe actions, stop before final publish, and persist the complete report. If the active runtime requires a reboot or loses canonical ownership, preserve the report and stop.
