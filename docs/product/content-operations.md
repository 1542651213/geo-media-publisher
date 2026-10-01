# Content operations — R1.15-F

## Ordinary workflow

Select company → plan/source material → Provider/model/template → generate local Draft/source-linked Variants → deterministic validation → human review → Approved current hash → ordinary Product Preflight → separately confirmed formal publishing. AI generation/import/plan actions create no Job, SubmissionIntent or PublishRecord.

The operations page has nine tabs: Today, review, draft generation queue, plan, facts, AI usage, import, Owner actions and publish board. Today metrics and shortcuts open real views. The page has an explicit refresh action; queue work continues in Main while the page is elsewhere. Publication dashboard reads existing same-company jobs and does not submit them.

## Review authority

Review reuses existing quality state. Approve requires the exact current content hash and a current quality-state row. A Draft is checked locally against company/contact/claims and every selected platform policy, then recorded as Needs_Review before the explicit human decision. This step calls no Provider and does not label deterministic checks as AI_Checked. Generated output also passes deterministic checks before it can be saved. Editing title/body invalidates approval: repository state resets to Draft and the existing Main edit quality gate may immediately move it to Needs_Review. Neither state authorizes publishing. A stale approval is rejected. Return-to-draft and archive are explicit actions.

Main Product Preflight, job preparation, historical prepared-job execution and the immediate final-submit boundary all require current Approved content. Legacy `contentReviewMode=Off` no longer authorizes formal publishing. Developer Mode remains default off and cannot bypass Main.

## Durable Draft generation queue

Each queue records company, profile/provider/model, template ID/version, topic, requested source count, targets, state, effective concurrency and counts. Each item records its source index, Source/Variant kind, target, generation ID, source draft ID, output article, attempts and safe error code.

- 1–20 sources per queue, up to six existing Studio targets. N sources × T targets yields N source items plus N×T variant items.
- Effective concurrency is deliberately one per company (`SerialPerCompany`). UI reports one rather than claiming unused parallelism. This prevents cloud request storms and duplicate generation.
- Company mutex and atomic item claim prevent rapid double-click from starting the same item twice.
- Before saving, Main persists the returned generation ID. Saving the Draft and marking the queue item Completed share one SQLite transaction.
- Restart reconciles exact Saved history/output lineage. A known Generated local result may be saved locally without another cloud request. Completed items are not generated again.
- Pause lets the in-flight request finish but prevents the next item. Cancel does not save a returned result as an Article after cancellation; its local generation history may still retain the response. Resume/retry transitions also start the Main runner.
- Explicit 429 uses bounded backoff. Known ordinary failed items can be retried. Unknown provider transport results become Recoverable; Main never blindly replays them.
- Recoverable items require an explicit regenerate/cancel decision or read-only reconciliation against exact known local history.
- Validation-red results are Blocked with `CONTENT_VALIDATION_REQUIRED`; generic Retry cannot loop them. The user may explicitly regenerate/cancel, or save the edited local result in Studio/history and reconcile the exact generation. Linked variants then continue from the saved source.
- No queue path invokes Publisher, Scheduler, job creation, prepare-publish or final submit.

## Plans and calendar

Generate deterministic 7/30-day topic plans from company material, or create a manual date/topic/type/target item. List/calendar and status filters read the same records. Plan states are Planned/DraftCreated/Archived; these dates are editorial dates, not automated publishing times.

Create Draft produces a neutral nonempty editable outline, linked once to the plan. Repeating the operation reuses the existing Draft. `使用 AI 生成` prepares/reuses that plan source, persists a company-specific handoff, navigates to Studio and loads its exact source and targets. Company defaults load before the plan override so a slow response cannot replace the plan targets. Result variants retain source lineage. Generating the plan itself calls no AI and creates no publish job.

## Facts and claims

Facts record company, category, statement, source type/date, verification time, expiry, approval for AI and notes. Approved unexpired facts alone become generation context. Expired facts remain visible with a warning; unapproved facts remain excluded. Date-input expiry is normalized to end-of-day ISO. No Kangyi facts are hardcoded into generic code.

Existing enterprise approvedClaims/forbiddenClaims and deterministic enterprise/brand/contact checks remain. Unknown certificates, ranking, test data or clients are not invented as approved facts. Full prompts/responses remain local content records and are excluded from ordinary logs and diagnostic bundles.

## Images and duplicates

Images are read as actual bytes before import. MIME and dimensions come from bytes, not extension. JPEG/PNG/WebP/GIF/BMP are recognized; empty/corrupt/unsupported files and size/pixel/edge limits fail before writes. F uses a 20MB local asset limit, 100 million pixel limit and 20,000 maximum edge; target-specific publishing limits still apply separately.

SHA256 dedup is company-specific. The UI shows filename, actual dimensions, orientation, article/job usage and last platform when known. Platform suitability reports confirmed policy only; unknown aspect ratios/limits remain unknown. Replace/remove affects owned asset metadata; no production media store is purged. AI image generation and automatic cleanup are outside F.

Title/body duplicate checks normalize Unicode/whitespace/punctuation within the same company and return warnings rather than silently rewriting content. Fingerprints track subsequent edits. Legitimate identical text across companies is allowed.

## Usage, import and dashboards

Usage aggregates existing non-secret generation metadata by Provider/model and company for 1/7/30-day views: requests, outcomes, input/output/total tokens when supplied. Unknown pricing remains null and UI reports unknown cost. F makes no paid external generation for acceptance.

CSV/XLSX import: Main native picker → at most 8MB/1000 rows → first worksheet → text cells without executing formulas → preview → editable column mapping → row validation/duplicate warning → explicit Import as Draft. Mapping covers title/body/summary/company/business/city/keywords/tags/targets/content type/promotion/source/template version. Company mismatch, missing fields and invalid targets appear as per-row errors. Only valid rows import; preview is consumed once. No publishing happens.

Owner actions use runtime health rather than DB logged_in. Missing/expired credentials, login, reconciliation and unassigned companies are distinct. Weibo login, Sohu Creator login and CNBlogs PAT update are followed by a separate authorized acceptance task; F leaves their ordinary switches off.

Diagnostic Bundle uses the existing allowlist: no API key, cookie/storage state, complete prompt/response, company business text, private paths or raw platform HTML. Internal codes stay in details while normal messages are Chinese.

## Tests and maintenance

Focused store tests cover migration initialization, lineage, current-hash review, plans, facts/expiry, scoped import, defaults, 429, unknown results, pause/resume/cancel, crashes between response/save/completion, red validation recovery and zero publishing records. UI tests cover company response tokens, action availability, progress denominator, plan navigation, dates and human health messages. Installed smoke validates real packaged Main/Renderer IPC with a loopback OpenAI-compatible fixture, a real encrypted credential, two companies, queue, review edit, plan handoff, CSV+XLSX, image dedup and restart.

For a queue incident, inspect item state and generation ID first. Reconcile only matching company/source/output lineage. Never change an unknown item to Pending automatically or delete its history to make the queue look clean. Preserve a closed-app DB+encrypted credential backup before future migrations; test on its private copy. See root ready.md and R1.15-F READY for final command receipts and package identity.
