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

## Implemented H changes; final measurement pending

- The Main-owned `jobs:page` API returns bounded summaries and exact totals; platform/account/date/status/Owner filters execute inside the same company scope. Article bodies and frozen publish payloads never cross this UI endpoint.
- A supporting article/job index is added by migration `0037_jobs_company_page_index.sql`; no historical rows are deleted or rewritten.
- The review read model uses one metadata join and displays a stale Approved hash as Draft. Eligibility and human approval guards remain authoritative.
- Opening the Operations Center no longer fetches all full Articles and Jobs just to build the board. Jobs reads occur when that tab is opened, paged, filtered or refreshed.
- The normal Scheduler retains its existing repository methods and batch policy.

Focused pagination/history/scope/read-model and operations regression: 3 files / 28 tests PASS. H installed before/after results, hardware measurements and final status must replace this pending paragraph at delivery; no speed-up is claimed yet.
