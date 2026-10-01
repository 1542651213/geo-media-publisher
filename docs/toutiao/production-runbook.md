# Toutiao BrowserNative ordinary article runbook

## Current R1.15-D department release

Ordinary article publishing is ON following one normal installed Product E2E on
2026-10-01. Batch is OFF. Main rejects Toutiao video creation and confirm/run/retry
before any Candidate exception; read-only history reconciliation remains available.
Use the current release identified in `docs/releases/R1.15-D-READY.md`, rather than
the historical September package below. Do not launch with diagnostic flags.

Normal workflow: account center current login/Creator identity -> approved article
in the correct company's library -> Toutiao -> explicit account selection (even if
only one account) -> manually selected enabled same-brand image -> prepare ->
Publish Center "确认并继续发布" -> original-task read-only status query. Main validates
title/body, physical image availability/brand and current Creator permission before
Job creation. Supported scope is plain text and one cover. Preparation and final
execution use the selected ImageAsset exclusively; an older Article/Variant cover
cannot override it. Actual editor title/body/image readback is mandatory.

The earned acceptance is Job `7a3d52b5-c0aa-41dd-8f93-2fd11e2d4a3a`, Record
`8b1f833e-cfb5-4a72-97be-7569417ea301`, remote ID `7691493900585910827`, URL
`https://www.toutiao.com/item/7691493900585910827/`. The durable boundary entered at
`2026-10-01T00:45:17.438Z`. One uncertain browser result was reconciled read-only in
the same Candidate and original Job. Unique current-account management Published,
public title/body/reachability, and restart readback passed. Job Success / Record
Published / remote status PUBLISHED_CONFIRMED; the existing Intent contract retains
Submitted and final_submit_count=1. Never rerun this completed acceptance.

Current completion has two independent layers: trusted exact target Published
management evidence closes publish success; public title/body/reachability records
Content Fidelity PASS/FAIL/LIMITED. Missing or mismatched public content is a warning
and never authorizes another submit. Missing identity, ambiguous management rows,
reviewing/rejected/draft states still cannot become Published.

Before-boundary recovery may restore the same prepared Job/Record only with identical
frozen content, transport and account, count=0 and no uncertain boundary. After the
claim, every restart/recovery is read-only. Retain all old uncertain API experiments.

## Historical September acceptance context

The following retained material describes the earlier scoped MVP and diagnostic
acceptance. Its package paths and explicit flags are historical; current ordinary
enablement and completion rules above take precedence.

## Scope and readiness

Route C: the owned browser performs the platform's final action. Main retains the
Job, global formal execution slot, SubmissionIntent, Prepared PublishRecord and
atomic final-submit claim. Node never replays the browser request on this route.

The supported initial scope is one visible application instance, one formal task,
plain-text article and one verified cover image. Rich HTML, image posts, tags,
categories, platform scheduling and draft creation are not advertised capabilities.
The historical Browser success supported this choice. One fresh Owner-approved
acceptance completed on 2026-09-26; its exact scope and runtime versions are below.

Ordinary routing is `platform=toutiao + contentKind=article + ARTICLE_BROWSER`.
Other platforms keep their routes. Toutiao video remains blocked in ordinary Main.
An old Job frozen to `ARTICLE_WEB_API`
cannot be prepared/submitted through BrowserNative. Read-only reconciliation of
an old uncertain Job is still allowed. The 7050 experiment remains uncertain with
its count of one; it is never a source of reusable publish permission.

## Configuration

- Current ordinary ON enables the native article route without an environment flag.
  `TOUTIAO_BROWSER_NATIVE_SUBMIT_ENABLED` was used by historical scoped diagnostics;
  it is not required for the R1.15-D normal employee workflow.
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
| Unique matching current-account Published row, trusted ID and URL | PUBLISHED_CONFIRMED; Job Success; independent public fidelity |
| Click timeout, crash or response lost after claim | NeedsReconciliation; retain count one |

Remote ID is preferred. Without one, exact normalized title, verified account and
the durable submission-time window must uniquely identify the row. Row status is
read from that row. HTTP 200, page toast or a random public link is never enough.
Public-page failure records a fidelity warning after trusted management success.
It never permits another publish. Incomplete management evidence remains uncertain.

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

## Historical accepted package and next launch

- Final runtime: `80b7281916a8444ead3257a9b0b213ce96de65a3`.
- Package: `C:\Users\Administrator\.codex\artifacts\toutiao-native-80b7281\win-unpacked\Geo Media Publisher.exe`.
- EXE: `033fefa7204f414daa67761dac2fdc85c866fb5855f67b400991c2eebcdf1945`.
- app.asar: `d1111e8a450c856498d833ee9b1b265f19af6b97eb510ab12131faed9d393a5e`.
- Main: `683c6713f13ab6729bd9da957e483bc0cbaf713ca9b5f591fa524e4b55a190ce`.

Native submit used `9ff2a18`. The later `80b7281` change affects only read-only
public confirmation and safe evidence retention; it was tested and packaged before
reconciling the same submitted Job. Both packages' manifests are retained.

Acceptance Job `487827ce-a382-4491-b2d2-13274dfb3e78` is Success, Record
`631000cc-1ca3-4fb3-a366-a7b10f716d73` Published/Verified, remote ID
`7689658153499165194`, final count one. Public title/body/reachability passed at
`2026-09-26T02:13:47.813Z`. The app and owned Context were normally closed afterward.
Do not continue this completed test to obtain a new publish allowance.

For an inspection-only launch, start this EXE from a process with
`TOUTIAO_READONLY_PREFLIGHT=true` and `TOUTIAO_BROWSER_NATIVE_SUBMIT_ENABLED=false`.
Keep the API, MVP-5 and protocol Shadow flags false. No debugging port is required
for ordinary UI inspection. This mode pauses due publishing and permits read-only
account activation and result queries.

For later approved ordinary use, close the inspection instance normally and start
one instance with `TOUTIAO_BROWSER_NATIVE_SUBMIT_ENABLED=true`, read-only mode off,
and experimental/acceptance-only flags unset. Review existing due tasks first;
ordinary mode resumes the normal scheduler. This manual configuration is explicit
enablement, not permission to replay a completed/uncertain Job. Every new article
still goes through the persisted queue, preparation, confirmation and single-submit
boundary. No flag was persisted or globally enabled by the acceptance task.

Public confirmation waits briefly for content hydration in a separate guarded
Page. Unknown requests remain aborted and are counted separately. The same target
must still have a Published management row, matching remote ID and verified public
title/body. Failed public reads retain candidate evidence and NeedsReconciliation;
they never permit another final action.
