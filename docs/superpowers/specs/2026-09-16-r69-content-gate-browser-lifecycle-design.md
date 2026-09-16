# R69 Content Gate and Browser Lifecycle

## Goal

R69 adds two bounded capabilities to the existing publishing pipeline:

1. A deterministic pre-publish content gate for title length, body length, and selected image count.
2. Explicit lifecycle ownership for browser sessions used by publishing tasks.

The existing XHS ARM, completion, final-submit, one-shot boundary, and publish transaction code remain unchanged.

## Existing boundaries

- `packages/domain/src/content-quality.ts` already contains reusable quality evaluation types and rules.
- `packages/db/src/repository.ts` owns persisted quality state and the existing source/review gate.
- `packages/publisher/src/index.ts` is the shared job execution boundary before a platform adapter is invoked.
- `packages/adapters/browser/src/index.ts` owns browser automation session lookup, opening, runtime state, and cleanup.
- Platform adapters remain responsible for platform-specific selectors, login, upload, and submit behavior.

## ContentQualityGate

Add a pure, platform-neutral gate module in the domain package. Its input is the publish article payload plus the selected image count. Its output is a structured result:

```ts
type ContentGateResult = {
  passed: boolean;
  checks: {
    titleLength: { passed: boolean; actual: number; minimum: number; maximum: number };
    bodyLength: { passed: boolean; actual: number; minimum: number; maximum: number };
    imageCount: { passed: boolean; actual: number; minimum: number; maximum: number };
  };
  failureCodes: string[];
};
```

The minimum and maximum values are explicit constants in the module so the behavior is deterministic and testable. Image count is derived from the publish request (`selectedImageAssetId` and the platform input), not from a browser DOM observation. A selected image contributes one image; no selected image contributes zero.

`PublisherService.prepareArticle` evaluates this gate after loading the article and before invoking an adapter. A failed result raises the existing content-rejection error shape with the gate result attached to sanitized diagnostics. The adapter is not called and no browser session is opened for a blocked job. Existing review/source checks remain in force.

## BrowserSession lifecycle

Extend the existing `BrowserSessionManager` with a scoped lifecycle operation for automation jobs. The operation accepts an account-scoped identity and an async task callback. It transitions:

`CLOSED → OPENING → READY → RUNNING → CLOSING → CLOSED`

The manager reuses the existing account profile and credential store. `OPENING` starts or restores the browser session; `READY` confirms the session and context are usable; `RUNNING` encloses adapter work; `CLOSING` closes the task-owned context/browser resources; `CLOSED` is the default post-task state. Persisted profile data, account records, cookies, and session metadata are retained.

If opening fails, the manager records a sanitized runtime event and returns to `CLOSED`. If the task fails, the original error is rethrown after recording the failure and attempting bounded cleanup. Cleanup errors are recorded but do not mask the original task error. Existing explicitly retained/manual sessions are not closed by this scoped operation unless the caller opts into the task-owned lifecycle; current retained-editor and diagnostic flows keep their current behavior.

The lifecycle state and transitions are observable through the existing runtime snapshot/event hooks. No renderer API directly accesses browser internals.

## Integration flow

1. A job enters `PublisherService.prepareArticle`.
2. Existing source/review validation runs.
3. `ContentQualityGate` evaluates title, body, and selected image count.
4. On failure, the job remains persisted with its existing failure semantics and the adapter is not called.
5. On pass, the browser adapter runs inside the scoped `BrowserSessionManager` lifecycle.
6. Adapter behavior, including XHS picker recovery, ARM, completion, final submit, and reconciliation, is unchanged.
7. The lifecycle scope closes browser resources after the adapter operation and retains persisted account/profile data.

## Error and logging contract

Content failures use stable gate codes for the failing checks and include actual/limit diagnostics. Browser lifecycle failures include the lifecycle state, account-scoped platform key, transition, and sanitized error code. Secrets, cookies, storage state, and raw credentials are never logged.

## Tests

Domain tests cover passing input, title too short/long, body too short/long, image count below/above limits, and multiple simultaneous failures. Publisher tests prove a failed gate prevents adapter invocation and a passing gate preserves the existing prepare path.

Browser manager tests cover the default `CLOSED` state, automatic open and `READY` transition for a task, `RUNNING`/`CLOSING`/`CLOSED` transitions after success and failure, profile/session retention, cleanup error reporting, and recovery of a persisted account session. Existing adapter and XHS tests must remain green.

## Non-goals

- No changes to ARM or authorization semantics.
- No changes to XHS identity binding, upload, picker recovery, editor discovery, final submit, one-shot durability, or publication transaction logic.
- No database schema change is required; lifecycle state is runtime-only and content gate output is attached to existing diagnostics.
- No automatic retry is added.
