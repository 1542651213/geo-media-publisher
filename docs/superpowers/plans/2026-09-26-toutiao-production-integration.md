# Toutiao production integration plan

## Decision and boundary

Use the existing Browser adapter for native submission, with Main owning the durable Job, global serial gate, SubmissionIntent and reconciliation. Historical Browser evidence exists in repository snapshot `6327076`; the Node replay experiment has no confirmed publication and code 7050 remains unknown. Keep its implementation and diagnostics outside normal routing.

No real final submit is authorized in this implementation phase. The historical experimental Job and its consumed submit count remain untouched. After offline verification and packaged read-only preflight, present a new exact article proposal for Owner approval.

## Work

1. Audit history, native preparation/submission, replay, account ownership, durable boundary and management scanning. Record bounded evidence in the transport decision.
2. Make normal Toutiao article routing explicitly BrowserNative, with formal submission default disabled. Retain video and other platform behavior. Persist transport/input binding in the existing Prepared Record metadata.
3. Reuse native editor/readback/single-cover preparation. Require expected remote identity, current Context ownership and durable claim callback. Treat immediate submit UI as pending evidence, never public confirmation.
4. Connect the existing guarded deep management scanner and independent public verifier to ordinary Publisher reconciliation. Preserve Reviewing, Rejected, Draft, Scheduled, NotFound and Ambiguous semantics; no retry or fallback after the boundary.
5. Test account/content/transport mismatch, one-shot claim, post-boundary uncertainty, status matching and record closure. Run focused tests, full suite, typecheck, lint and build.
6. Commit runtime changes, package that commit, hash executable/asar/Main. Run read-only app-owned preflight with all real publishing paused. Document runbook, package, current limits and explicit Owner acceptance boundary.

## Ownership

- Browser agent: Toutiao adapter and management parser/scanner, adapter tests.
- Publisher agent: core reconciliation contract and Publisher orchestration/tests.
- Main: runtime routing, Repository metadata, read-only preflight, package/runbook.
- History reviewer: historical evidence and decision document; independent review.

## Acceptance

Offline implementation and a package can be complete before live acceptance. `TOUTIAO_ARTICLE_PRODUCTION_READY` remains NO until a separately authorized new article is confirmed through management state and public readback. There is no request replay or second transport after a native final click.
