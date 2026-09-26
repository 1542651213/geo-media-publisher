# Toutiao article transport decision

Audit baseline: `70188a0d6e4a59a90c0546814204572d99826eaf` (2026-09-26).

## Decision

Use **BrowserNative** submission with Main owning the durable Job, SubmissionIntent,
irreversible submit boundary, evidence and reconciliation (Route C). The platform's
own browser request completes the submission. Main does not replay that request.

Retain BrowserAssistedApi as an experiment, disabled by default. Its ability to
capture and send a signed request is proven; successful remote article publication
through that transport is not.

The initial decision preceded real acceptance. On 2026-09-26 the Owner separately
approved the exact new candidate; one BrowserNative final action and subsequent
read-only reconciliation completed successfully. See the acceptance result below.

## Historical Browser evidence and provenance

The earliest reachable Git snapshot containing the successful Browser route is
`6327076f249cf69a0970bdacc6668e12437dc3b9` (`codex修改前`, 2026-08-26).
It is a root commit: this repository cannot identify separate original V1.3.8 and
V1.3.9 implementation commits. Reporting invented feature commits would overstate
the available history.

The evidence chain exists in committed files, rather than only PROJECT_STATE:

1. `output/v138-toutiao-real-publish.json` records one Browser final action,
   `CLICKED_ONCE`, and an initially uncertain result. The prepared article, Job,
   Intent and Record remain linked; no second submit is recorded.
2. `output/v139-toutiao-reconciliation.json` records one management-row match,
   explicit `已发布`, remote ID `7678241442350891547`, and the actual public URL
   `https://www.toutiao.com/article/7678241442350891547/`. The verification result
   has `urlReachable`, `titleMatch`, and `bodyMatch` all true.
3. `scripts/v139-toutiao-reconcile.mts` implements the read-only management
   navigation, account/title/minute matching, row-state distinction, actual-link
   extraction, adapter public-page verification, and closure of the existing
   records. It never invokes a final submit. Its hard-coded target IDs and minute
   make it historical evidence, not a reusable production entry point.
4. `tests/v139-toutiao-reconciliation.test.ts` verifies existing-record transition
   from uncertain to Submitted and then Published without changing the durable
   final-submit count or creating replacement rows. It is an offline test, not
   additional real-platform evidence.
5. A read-only query of the current production database during this audit
   corroborated the original records: Job
   `f2e31cfc-176c-488b-8ca9-e6fd3d769ab7` is Success with one attempt; Intent
   `fe2e81e7-1ec2-4ba1-a080-7a2b4206a6d3` is Submitted with
   `final_submit_count=1`; Record `8500aae4-f2d1-49a3-a3db-b55e7336b3f3` is
   Published/Verified and contains that same remote ID and public URL.

The two evidence JSON files, historical reconciliation script, Browser adapter
test file and V1.3.9 repository test have identical Git blob IDs at the root
snapshot and the audit baseline. The Browser adapter's `prepareStrict`,
`prepareFinalSubmit`, `finalSubmit`, `verifyPublished` and original `reconcile`
implementations are also retained; intervening changes added diagnostics and
management helpers around them.

Limitations: the historical evidence is locally retained execution evidence, not
an independent platform attestation. The public page was not re-fetched by this
source audit. Historical success does not prove current selectors, account rights,
cover rules or a new packaged build can publish today.

## Production gap exposed by the history

The historical submit code remains available, but its successful management-page
closure was performed by the target-specific V1.3.9 script. At the audit baseline,
the adapter's ordinary `reconcile()` only inspects its current page. It does not
drive the management scan that actually closed the historical publish.

Reuse the current owned-Context deep management scanner and public verification
inside the normal adapter/reconciliation route. Preserve exact identity and target
matching, ambiguity rejection, explicit row states and the durable count. Do not
rerun the historical script against new content or copy its hard-coded IDs.

## BrowserAssistedApi audit

The experimental implementation already provides useful components:

- account-owned BrowserSession activation and encrypted credential storage;
- context-wide guarded capture, browser abort and Main-only raw request material;
- exact destination/content binding, credential generation/version and current
  domain/path-aware Cookie checks;
- request/body hashes, short capture freshness policy, persistent capture claims;
- R1-A durable final-submit claim before Node send;
- one transport call, byte-preserving body and URL handoff, manual redirects,
  no application-level retry, and safe response metadata;
- response uncertainty and read-only reconciliation.

These are retained research and safety assets. They do not establish that a
Browser-generated signed POST is accepted when sent by Node's network stack.
The successful read-only GET replay only proves that some authenticated reads can
be reused; it cannot validate the publish endpoint.

The one live experiment remains: Browser POST sent 0, Node POST sent 1, durable
final-submit count 1, HTTP 200, platform code 7050, and no verified remote article.
A read-only database audit confirmed the saved response contains only the keys
`code`, `data`, `err_no`, `message`, `now`, `reason` as shape metadata, plus
`httpStatus=200`, `platformCode=7050`, and `remoteState=UNCERTAIN`.
The original message/reason values were not retained and cannot be recovered from
the released response memory.

`IS_NODE_REPLAY_ROUTE_PROVEN = NO`

## Bounded 7050 conclusion

`7050_MAPPING = UNKNOWN`

Current code has no supported mapping from 7050 to rejection, duplicate, bad
payload, risk control, or browser/network binding. The prior bounded frontend
search recorded no relevant handler; an occurrence inside a numerical lookup
table is not an error mapping. The response's missing diagnostic values cannot be
recreated. No SDK reverse engineering or additional publish request is justified
for this decision.

TLS/HTTP behavior, browser state, header handling, payload validation and token
freshness are possible categories, not proven causes. A nonzero platform code and
an empty scanned management scope do not prove absence of a remote side effect.

## Route comparison

| Criterion | BrowserAssistedApi | BrowserNative + Main boundary |
| --- | --- | --- |
| Real complete publish evidence | Not proven | Historical success plus one new Owner-approved acceptance |
| Duplicate-send surface | Browser abort plus Node handoff | One Browser final action |
| Confirmation | Reuses management/public evidence | Same evidence, historically successful |
| Platform coupling | Editor, security runtime, raw request contract and cross-client transport | Editor and read-only management/public UI |
| Remaining work | Unproven 7050 cause and publish transport acceptance | Bounded initial scope accepted; explicit enablement remains required |
| Maintenance | Two network environments and captured credential materials | Platform native request environment |

BrowserNative was selected because it had stronger repository evidence and fewer
unproven boundaries. The fresh acceptance below verifies one current execution;
it does not establish that Browser automation is infallible.

## Required production boundaries

- One formal execution at a time. Persist Intent/Prepared Record before the
  irreversible action and atomically claim count 0 to 1 immediately before it.
- Recheck account identity, Context ownership, frozen title/body/settings and
  required cover state before the claim. A live page alone does not prove identity.
- After the boundary, timeout, crash, lost response or missing article remains
  NeedsReconciliation. Never retry, switch transports or click again.
- Published requires explicit target-row status plus public verification when a
  public URL is available. Reviewing, Rejected, Draft, Scheduled, NotFound and
  Unknown remain distinct evidence states. Ambiguous targets are never selected.
- Ordinary routing uses an explicit article transport capability. Experimental
  flags do not silently replace the normal article route.
- API preparation, credentials, fixtures, diagnostics and replay code stay
  available behind the existing experimental process gates, off by default.

The historical experiment `GMP头条单次测试260925010942` remains
NeedsReconciliation with `final_submit_count=1`. Its Article/Job/Intent, capture
claims and evidence must not be reset or reused. A future new test requires new
Owner authorization and new content/Job/Intent; it does not release this budget.

## Acceptance boundary

Offline tests, typecheck, lint, build, package and a read-only live preflight must
pass before presenting the Owner with the exact new article, content hash,
transport, account and cover/image scope. This task's implementation permission
does not authorize that final publish. Production readiness is recorded only after
the separately authorized single attempt and evidence-based reconciliation.

## Completed acceptance, 2026-09-26

The Owner's current-session approval bound the exact title, content hash, account
and one generic test cover. Submission runtime `9ff2a18` created a new test
Article/Job/Intent/Record and claimed the single native final action. Initial
uncertainty caused reconciliation only. The management scan later found the
uniquely matched target Published.

Runtime `80b7281` fixed only read-only confirmation: unknown background requests
remain blocked but their successful blocking does not invalidate verified public
content; content-mutation attempts still fail verification. Bounded DOM hydration
and safe candidate evidence retention improve recovery without any resubmission.

The same Job `487827ce-a382-4491-b2d2-13274dfb3e78` is now Success; its existing
Record is Published/Verified, Intent PUBLISHED_CONFIRMED, final count still one.
Remote ID is `7689658153499165194`; the actual management-provided public URL is
`https://www.toutiao.com/item/7689658153499165194/?enter_from=mp_group_management`.
Public reachability, title and body were verified. No Node submit or fallback ran.
The old 7050 experiment remains uncertain/count1 and was not touched.

This establishes the bounded BrowserNative production MVP: plain text, one cover,
owned visible browser, Main durable boundary, management/public confirmation.
Formal submit remains default disabled, requires explicit configuration, and this
completed acceptance authorizes no further content or batch publication.
