# Multi-company workspace — R1.15-F

## Selecting a company

The sidebar's `当前企业工作区` selects a real Brand/Company. Main persists its identifier in `operationsWorkspaceCompanyId`. `CompanyWorkspace.current()` validates that identifier against current brands; with no saved selection it uses the first real company. With no company, ordinary article/image reads are empty and authoring requires creating a company.

The selector reads `workspace.companies`, while ordinary `brands.list` exposes only the active company. Switching changes the keyed route container. Article/image/account selections, Studio outputs/source text, open forms, import previews and company context are reset. Async responses use request tokens/cancellation checks so an old company's result cannot overwrite the mounted workspace.

## Main enforcement

Renderer does not choose the authority by passing an arbitrary company ID. IPC middleware runs `CompanyWorkspace.prepare` before handlers. Main injects current company filters and rejects mismatched IDs.

| Resource | Enforcement |
| --- | --- |
| Articles/pages/history/variants | Article ownership; variant resolves to its source article |
| Images | Company ownership before import/update/delete/read |
| Accounts | Unique operations binding; old account/platform IDs resolve to the bound account |
| Quality/review | Article or variant owner, plus current content hash |
| E AI generation/context/history/local drafts | Current company; local generation ID resolves to persisted company |
| Legacy AI tasks/Studio roots/versions | Main resolves stored brand, including root task IDs |
| Knowledge/keyword templates/brands | Stored brand owner, not just payload brand |
| Video assets | Managed video view resolves brand through its ownership metadata |
| Jobs and Website maintenance | `id` and `jobId` resolve to article company before run/recover/maintain |
| Legacy publish plans | Current company, all chosen accounts bound to it; batch remains disabled |
| F plans/facts/queues/import preview | Strict company schema and service-level ownership |
| Statistics | Current-company articles/jobs/accounts/AI metadata only |

Website import captures the company before the file picker, rechecks it after remote capability verification, and binds the new account after credential persistence. OfficialAPI preparation and Publisher recheck workspace ownership after asynchronous I/O and again before final action. Company switching cannot authorize a pending old-company publish.

Jobs, SubmissionIntents and PublishRecords remain durable historical data. Cross-company access is refused; no historical business rows are deleted or rewritten to satisfy the workspace view. Reconciliation preserves its original idempotent intent.

## Account migration policy

Migration `0032_content_operations.sql` adds metadata rather than rewriting old business records. On service initialization an account is bound automatically only if its historical article/job ownership yields exactly one company, or the database has only one company. Conflicting/ambiguous accounts remain unassigned. The Owner page lists them for explicit binding to the current company. It is unsafe to infer company from DB logged_in, alias text, or whichever company happened to be selected.

No migration copies a credential into SQLite. Existing external IDs, previous login state, jobs/intents/records and article/media bytes remain intact. The private-copy migration test verifies every existing non-migration table's sorted row digest, integrity, foreign keys and idempotent reopen; it reports counts/digests, not business data. Closed-app recovery also preserves encrypted credentials and their Windows `Local State` encryption context, and exact persistent profiles when used; a DB-only backup cannot restore authentication.

## Company-specific AI and import behavior

- Enterprise Context belongs to the company. Approved unexpired facts from only that company are injected into generation.
- Prompt definitions and Provider profiles remain reusable global configuration. Each company's Studio defaults separately choose profile/model/template version/purpose/targets. Shared provider configuration does not merge company facts.
- Generation history, outputs, queue items and source-linked variants retain company lineage.
- One source queue item generates variants for its exact saved source article. A different company's source ID is rejected.
- Import preview is cached in Main, tied to current company and consumed once. CSV/XLSX company mismatches produce row errors.
- Identical text in another company is valid. New article/import/AI hashes are namespaced by company; same-company duplicate checks retain raw-content fingerprints. Editing text updates that fingerprint; status-only updates keep the content hash.
- Duplicate image SHA is reused within one company. Another company receives its own asset ownership and physical copy.

## Operations and verification

Main APIs: `workspace.companies/current/select`, `operations.snapshot`, `operations.bindAccount`, `operations.listUnboundAccounts`. Relevant focused tests include `r115-f-workspace`, `r115-f-company-import`, `r115-f-assets`, `r115-f-ai-fact-binding`, OfficialAPI IPC/connection/controller, operator authority and operations UI tests.

Installed smoke uses two synthetic companies in isolated app data. It generates company A drafts, switches to B, proves empty A article/image/account/fact views and rejected A-ID reads, checks Studio selection reset, then restarts and verifies persisted company and encrypted provider configuration. Production app data is hashed before/after and remains unchanged.

For future development, every new Main resource must resolve its stored owner and recheck after any await that could yield to a company switch. Filtering a Renderer array alone is not sufficient. Do not create a second platform/company configuration system.
