# Kangyi Durable Operation Recovery Phase 1.6

## Goal

Extend the existing GEO publishing lifecycle so a future Kangyi multi-step CMS operation can resume after process exit or transport uncertainty using the same persisted intent, exact request payload, and per-operation idempotency key. No real CMS write is allowed in this phase.

## Constraints

- Reuse `PublishJob`, `SubmissionIntent`, `submission_dispatch_claims`, `PublishRecord`, `ContentSnapshot`, and the existing repository.
- Add only a nullable, versioned operation metadata field to existing submission intents; do not add a Website-specific database or lifecycle tables.
- Keep the Phase 1 Kangyi adapter publish entry point fail-closed.
- Move the final dispatch claim boundary to the actual CMS publish operation through a generic durable-operation seam, without changing XHS behavior.
- Persist no secrets, signatures, timestamps, nonces, cookies, or authorization headers.
- Use fake transport only for crash/restart tests; send no staging write request.

## Work plan

1. Add a versioned domain model and migration for nullable `submission_intents.operation_metadata_json`, with migration-upgrade and legacy-row coverage.
2. Add repository-owned typed, transactional checkpoint APIs for operation initialization, per-operation prepare/result transitions, existing final dispatch claim reuse, CMS job polling, and idempotent PublishRecord close.
3. Add a generic durable Kangyi operation runner seam that consumes the existing CmsV2 client contract, persists exact JSON bodies before writes, uses immutable snapshot inputs, claims the existing dispatch barrier immediately before publish, and recovers the same operation after uncertainty.
4. Add focused crash/restart tests for media, create, draft/validate, publish, polling, and final close, including same-key/same-body assertions and no duplicate content creation.
5. Run focused regression tests, migration tests, XHS barrier tests, typecheck, lint, build, and full tests where available; separate baseline failures from new failures.
6. Review the diff for secret leakage, old-workspace changes, forbidden write calls, and phase-gate behavior, then create one local commit without rewriting the Phase 1 baseline.

## Verification evidence required

- `operation_metadata_json` is nullable and historical XHS rows remain valid.
- Every JSON write operation has a persisted exact UTF-8 body, body SHA-256, key, binding, and state before transport.
- Media uses immutable snapshot bytes and stores server identity only after SHA-256 verification.
- Publish uses the existing dispatch-claim table at the final POST boundary and reuses an existing claim during recovery.
- CMS job IDs and public URLs are persisted before GEO completion; completion is idempotent and requires succeeded/public readback.
- Phase 1 `publishArticle()` remains fail-closed and no real staging write request is sent.
