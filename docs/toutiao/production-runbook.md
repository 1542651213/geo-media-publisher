# Toutiao BrowserNative production candidate

## Scope and readiness

Route C: the owned browser performs the platform's final action. Main retains the
Job, global formal execution slot, SubmissionIntent, Prepared PublishRecord and
atomic final-submit claim. Node never replays the browser request on this route.

The supported initial scope is one visible application instance, one formal task,
plain-text article and one verified cover image. Rich HTML, image posts, tags,
categories, platform scheduling and draft creation are not advertised capabilities.
The historical Browser success supports this choice; it does not replace a fresh
Owner-authorized acceptance of this package.

Ordinary routing is `platform=toutiao + contentKind=article + ARTICLE_BROWSER`.
Video and other platforms keep their routes. An old Job frozen to `ARTICLE_WEB_API`
cannot be prepared/submitted through BrowserNative. Read-only reconciliation of
an old uncertain Job is still allowed. The 7050 experiment remains uncertain with
its count of one; it is never a source of reusable publish permission.

## Configuration

- `TOUTIAO_BROWSER_NATIVE_SUBMIT_ENABLED` defaults to false. Enable it only for an
  explicitly approved acceptance/production session.
- `TOUTIAO_ARTICLE_API_PUBLISHER_ENABLED` cannot replace the normal article route.
- `TOUTIAO_MVP5_ONE_SHOT_ENABLED`, protocol/capture diagnostics and experimental
  BrowserAssistedApi flags remain false for ordinary publishing.
- `TOUTIAO_READONLY_PREFLIGHT=true` pauses the scheduler and existing publish IPC
  paths. It is required for `publisherAPI.toutiaoProduction.readiness(accountId)`.
  The preflight also rejects an occupied formal execution slot. Use a fresh single
  task-owned app instance; do not change flags inside an already publishing process.

## Read-only packaged preflight

1. Verify the runtime commit, executable, `resources/app.asar` and extracted Main
   hashes. Close only the task-owned old app normally. Confirm one Main instance.
2. Back up the existing application DB using SQLite backup; record migrations.
   Never copy plaintext credentials or reset existing records.
3. Start the package in read-only preflight mode with formal/experimental submit
   disabled. Activate the exact saved account through the app's existing service.
4. Invoke the readiness IPC. It checks app-owned Page/Context, remote login and
   stable identity, then the guarded management scan. URL comes from `Page.url()`.
   Its zero candidate count denotes no new Job, not the historical experiment.
5. Login/security verification requires the Owner. Do not bypass it. Incomplete
   management reads are not readiness and do not prove absence of remote work.
6. Close the owned Context/app normally when finished. A temporary debugging port
   is an acceptance aid only; it is not a production launch requirement.

## Owner-authorized one-shot acceptance

Before approval, present the exact account, BrowserNative transport, proposed
title/body, content hash, one cover and its source/hash, live session and management
readiness. No new Article or Job is created before authorization.

After explicit approval, start only that package with the native submit flag and
existing self-test authorization flag enabled. Set
`TOUTIAO_NATIVE_ACCEPTANCE_ACCOUNT_ID` to the exact approved account ID: this pauses
the scheduler and other publish entry points, and confines self-test confirmation
to that Toutiao account. Leave read-only-preflight mode off during that acceptance.
Use the existing single-account self-test confirmation entry. It creates a new
`source=test` Article and Job before editor preparation; no test content is relabeled
production. The unique title derives from the persisted self-test run. The cover
must be explicitly marked for testing and be generic or same-brand. Recheck the
presented content/image before confirming; any changed candidate needs new review.

The prepared editor binds stable creator identity, current Page/Context, article,
title/body and cover. Main persists `ARTICLE_BROWSER`, prepared-input hash and
expected creator identity. Final preflight reads back the actual editor again.
Only the existing durable callback can claim final count 0 to 1 before the last
click. Preview navigation is distinct from the final confirmation click.

The ordinary path is prepare -> Owner confirms -> submitOnce -> confirm/reconcile.
If the app restarts before the boundary, explicit preparation may restore the same
Job/Record only with identical frozen content/identity/transport. An app restart
after the boundary permits read-only reconciliation only.

## Results and recovery

| Evidence | State/action |
| --- | --- |
| Exact target management row reviewing | Submitted; read-only polling |
| Exact target scheduled | Submitted/Scheduled; read-only polling |
| Exact target rejected | Failed with rejection evidence; no automatic retry |
| Draft, missing, ambiguous, unreadable or unknown | NeedsReconciliation |
| Published row and valid public URL, exact public title/body | Published/Verified; Job Success |
| Click timeout, crash or response lost after claim | NeedsReconciliation; retain count one |

Remote ID is preferred. Without one, exact normalized title, verified account and
the durable submission-time window must uniquely identify the row. Row status is
read from that row. HTTP 200, page toast or a random public link is never enough.
Public-page failure remains uncertain and is never a reason to publish again.

Use the ordinary read-only query action for Submitted/Publishing/NeedsReconciliation.
Self-test continue/confirm on a run with an existing Job also only reconciles.
For pending review, use bounded low-frequency reads (e.g. 60 seconds, 15 minutes).
Retain pending state after the window. Never click again, switch transport, unlock
a ticket, reset a count or create a replacement to bypass an uncertain attempt.

## Production enablement

Offline implementation and package success do not equal `PublishPassed`. Record the
new Owner authorization, one final action, remote ID/state/URL and public readback.
Only a successful one-shot closure can mark this transport production-ready. Even
then, formal publishing remains explicitly configured; this runbook does not start
batch work. Keep the experimental route off and preserve all historical evidence.
