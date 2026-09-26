# Douyin image/text R1 runbook

## Scope and current gate

The intended first release is one instance, one Owner-authorized Douyin account, one `article` job representing image/text, plain title and body, exactly one PNG/JPEG image, no topics, no schedule, and no deliberate draft creation. The Owner must select public visibility explicitly; timing is immediate. **Automatic draft side effect was observed:** after test-image upload and navigation home, the Creator home displayed `继续编辑`. The R1 code has offline gates, but live automated preparation and one-shot submit remain unverified. `DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED` stays `false` for ordinary production.

The existing Douyin video OAuth adapter is a separate route. Do not infer image/text capability from a platform-wide connection state or from `video.create` permission.

## Account and content preparation

1. Owner completes normal Creator login and any QR, SMS, CAPTCHA, or identity check. The program verifies the active browser context, canonical page, Creator host, and stable Douyin ID. A stored `logged_in` row is insufficient.
2. Create one persisted Article and Job. Use an Owner-authorized test image with explicit source and bind its byte SHA256, order, title, body, account, Creator ID, visibility, and selected transport before upload. Rehash the file before each upload or final boundary.
   Show the Owner the complete title/body, exact account, image source/path/SHA256, public/immediate settings, possible automatic draft, and intended scope. Do not infer upload/edit permission from R0's old diagnostic upload.
3. Open the current Creator image/text entry through the owned page. Read the live DOM; upload through its file input; fill title/body; read back image count, title, body, and required settings. Stop on mismatch, missing control, security challenge, or changed identity.
4. Persist a Prepared PublishRecord and SubmissionIntent. The global formal gate allows one formal task. Only after a final preflight may the durable `final_submit_count` claim change from 0 to 1 immediately before the actual remote final action.

## Submit and recovery

The final action limit is one click. If the page closes, click times out, response is lost, or status is unknown after the claim, retain `NeedsReconciliation` and count 1. Never retry or switch to an API. App restart before the claim requires fresh session, identity, file-hash, and editor checks. Restart after the claim is reconciliation only.

Read-only Creator work management at `/creator-micro/content/manage` visibly has `已发布`, `审核中`, and `未通过` states, genre/date filters, and a `搜索作品` field. No draft tab was observed. The unpublished test image/text item was instead offered through a continue-editing prompt on the publishing route. Never automatically select “继续编辑”, “放弃”, or “暂存离开” for an old item. The current conservative parser only promotes a unique management row with the trusted response ID and matching title. Missing ID, incomplete list scope, or multiple candidates remain unknown. Reviewing is pending, rejection is recorded without retry, and a published management row plus ID yields `PUBLISHED_MANAGEMENT`. Verify the public page if available; if blocked by dynamic loading or login, record `PUBLIC_VERIFICATION_LIMITED` without resubmitting. Do not treat an editor success toast or HTTP 200 alone as published.

## One-shot authorization

Before real submit, show the Owner account/Creator ID, transport, exact title, body summary, image path and SHA256, source/content-binding hashes, live session proof, management readiness, and `final_submit_count=0`. Only an explicit Owner approval permits the single test submission. The test content may not contain client data, real contact details, or commercial promises. Ordinary production publishing and batch publishing remain off after a successful one-shot test until separately enabled.

## R1 implementation status (2026-09-26)

R1 adds the normal-app stored-session activation entry, strict image upload and settings checks, a one-shot browser final action with Page-scoped passive response observation, and conservative management/public readback. Offline gates pass: 135 test files / 966 tests, typecheck, lint, build, and independent package. The Owner completed normal-app Creator login; Main verified ID `72388977613`, the owned Page/Context, and the stored session generation. The application read-only management smoke passed on the owned `/creator-micro/content/manage` Page with one search input and the currently selected `已发布` label. This proves page readiness, not target-row matching or full state coverage. The actual automated upload, selected settings DOM, create response shape, and reconciliation of a new item remain unverified. No R1 image upload, new Article/Job/Intent/Record, or final click has occurred. The test package isolates acceptance to one exact account and Article; with no Article ID configured, all publish paths remain paused. Ordinary native submit stays OFF. An unknown result after a claimed boundary remains `NeedsReconciliation` and may only be read back, never submitted again.
