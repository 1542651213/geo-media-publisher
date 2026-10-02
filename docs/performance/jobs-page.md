# R1.15-H Jobs page performance

H profiling uses a synthetic installed-app dataset of **3000 Articles, 1000 image metadata rows, 10000 historical Cancelled Jobs**, evenly split between two companies. No executable jobs, real platform requests or cloud calls are used. All 5000 company-scoped rows must remain available through pagination.

## G baseline measured during H

Five fresh-process and five warm samples were collected on the same dataset; OS caches were not flushed. The fresh-process path visits the 500-image grid before Jobs, matching the earlier slow operator path. P95 below uses nearest rank over five samples, so it is the maximum observation, not a population estimate.

| Action | Median ms | P95 ms |
| --- | ---: | ---: |
| First Jobs page after image grid | 1231 | 4902 |
| Warm Jobs page from Article library | 646 | 857 |
| Owner filter | 85 | 140 |
| Next page | 247 | 684 |
| Company switch | 581 | 789 |

Every Jobs entry triggered 4629 measured DB reads/preparations across six IPC requests. `operations:snapshot` alone issued 4539 queries; its review list loaded per-article quality state, review history and complete Article rows. Separately, `articles:list` serialized approximately 5.76 MB and `jobs:list` 3.67 MB although only 50 rows were visible. In the 4902 ms sample, all measured query execution totalled 163 ms; delays before/around IPC and UI work also contribute and are not misattributed to SQL alone.

Instrumentation measures statement preparation, execution, IPC handler elapsed time, payload size and a JSON serialization probe. Mapping/domain time is the handler remainder. IPC/Renderer settle includes transport and automation settling; it is not a pure React render measurement. App process working sets are recorded; summed process peak counters are not called a simultaneous peak.

The five timed samples finished. The final Playwright Main hash probe reported a garbage-collected Promise while the app remained responsive. That failure receipt is retained. A separate Electron RUN_AS_NODE read-only check of the closed synthetic database passed integrity, foreign keys and all 3000/1000/10000 counts; a supplemental receipt completes the baseline. Earlier fixture/UI synchronization failures are retained and excluded from the five-sample statistics.

## Implemented H changes

- The Main-owned `jobs:page` API returns bounded summaries and exact totals; platform/account/date/status/Owner filters execute inside the same company scope. Article bodies and frozen publish payloads never cross this UI endpoint.
- A supporting article/job index is added by migration `0037_jobs_company_page_index.sql`; no historical rows are deleted or rewritten.
- The review read model uses one metadata join and displays a stale Approved hash as Draft. Eligibility and human approval guards remain authoritative.
- Opening the Operations Center no longer fetches all full Articles and Jobs just to build the board. Jobs reads occur when that tab is opened, paged, filtered or refreshed.
- The normal Scheduler retains its existing repository methods and batch policy.

Focused pagination/history/scope/read-model and operations regression: 3 files / 28 tests PASS. Final full regression: 240 files / 1698 tests PASS.

## Actual H installed result

The H installation built from `fa54951e874aa5e38eaf12d2ed38b930e9515e88` used a closed copy of the exact G synthetic dataset, the same instrumentation and five samples for every action. All 10000 Jobs remain; integrity and foreign-key checks pass. No other test/build/scan ran concurrently with the timed samples.

| Action | G median / P95 ms | H median / P95 ms |
| --- | ---: | ---: |
| First Jobs page after image grid | 1231 / 4902 | **976 / 4855** |
| Warm Jobs page from Article library | 646 / 857 | **213 / 326** |
| Owner filter | 85 / 140 | **94 / 249** |
| Next page | 247 / 684 | **112 / 146** |
| Company switch | 581 / 789 | **195 / 213** |

Warm median improves 67%, pagination 55%, and company switch 66%. Cold median improves 21%, but cold P95 is effectively unchanged and the Owner filter regresses in this small sample. **Stable cold initial visibility below 2 seconds is not established.** Do not describe the entire operator path as consistently instant.

Cold-entry measured reads fall from 4629 to **124**, IPC payload from 10003651 to **596490 bytes**, and handler time from approximately 341–351 ms to **27–30 ms**. There are still six IPC calls, including two bounded `jobs:page` reads during initial component state setup. Each page payload is approximately 13 KB. Across the five cold samples, summed process working sets were 630816–678720 KB before and 562620–621916 KB after; these are sampled working sets, not an isolated allocation benchmark.

The two slow H cold samples spent only 22 ms in measured SQL and 27–28 ms in Main handlers, but had 3.9–4.1 seconds between the first and last IPC completion. A separate five-run click/long-task diagnostic reproduced the tail: two runs waited approximately 3.96 seconds in Playwright's visible/enabled/stable actionability stage before the Jobs click; one delayed between the navigation click and the first Operations IPC. No corresponding Renderer long task was observed in those intervals. Once the Jobs click occurred, bounded page reads took roughly 9–11 ms and the final visible/paint checks took tens of milliseconds. This localizes the remaining delay to navigation/render/input scheduling, without proving an OS, Chromium or application root cause. The original five-sample statistics are retained; diagnostic timings do not replace them.

Public summary: [verification receipt](../evidence/r115-h-verification.json). Detailed synthetic timing receipts and diagnostic logs remain in the ignored H execution directory. A future foreground/hardware trace can investigate the remaining cold tail without changing data or weakening safety checks.
