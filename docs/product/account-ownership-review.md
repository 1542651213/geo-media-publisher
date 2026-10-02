# Owner account ownership review

Open **内容运营 → Owner 处理 → 历史账号逐项确认**. The page shows every account, platform, current company (UNASSIGNED when unset), suggested company, confidence, relationship evidence, conflicts and the next action. Filter by platform, confidence, or unresolved/conflicting accounts.

Select the intended company workspace at the top, inspect each row and choose the correct company. Click **确认该账号企业归属** for that individual account. Choose another company when the suggestion is wrong, or **保留未确认** to defer. A selection or suggestion alone performs no assignment. Changing an existing binding additionally requires the explicit reassignment checkbox and passes the existing frozen-operation guards.

| Confidence | Meaning |
| --- | --- |
| HIGH | Explicit Owner binding with no conflicting relationship evidence |
| MEDIUM | Consistent multiple historical jobs, a PublishRecord relation, or an OfficialAPI source-article relation |
| LOW | Limited single-job or company-specific image relationship evidence |
| CONFLICT | Relationships point to multiple companies, or disagree with the confirmed binding |
| NO_EVIDENCE | No reliable company relationship; Owner must choose or defer |

Evidence reads only relational IDs and counts from Jobs, Articles, PublishRecords, selected company-specific images and OfficialAPI operations. Universal images do not suggest ownership. Remote identity and Website credential metadata identify an account/site, not its owning company; without an explicit company relation they supply no ownership inference. Nicknames, titles, article bodies, media paths, credential values and remote response bodies are excluded from the evidence computation.

The H private-copy review found **28 UNASSIGNED accounts: 7 MEDIUM, 1 LOW, 3 CONFLICT, 17 NO_EVIDENCE**. Owner confirmations performed: **0**. The eight unique suggestions are still suggestions. Complete account names and company details remain in the restricted private report and in the ordinary Owner UI after the authorized production upgrade; the public evidence table is anonymous.

Confirmation checks the version/company the Owner actually reviewed, invalidates old authentication generations, and requires a fresh identity check. It never rewrites historical Jobs, PublishRecords, frozen content, submission counts or remote results. Company ownership, session identity and article publish eligibility are separate checks.

Focused evidence: 46 onboarding tests passed, including conflicting record/image/site relations and unchanged history. Actual H installed UI confirmation passed using a synthetic account; the resulting company binding was checked through Main. The 28 real accounts remain UNASSIGNED and were not confirmed by this test. The installed screenshot index includes the one-page review and the Owner action list.
