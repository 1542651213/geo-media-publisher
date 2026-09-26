# Douyin image/text R1 runbook

## Scope and current gate

The intended first release is one instance, one Owner-authorized Douyin account, one `article` job representing image/text, plain title and body, exactly one PNG/JPEG image, no topics, no schedule, and no deliberate draft creation. The Owner must select public visibility explicitly; timing is immediate. **Automatic draft side effect was observed:** after test-image upload and navigation home, the Creator home displayed `继续编辑`. The R1 code has offline gates, but live automated preparation and one-shot submit remain unverified. `DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED` stays `false` for ordinary production.

The existing Douyin video OAuth adapter is a separate route. Do not infer image/text capability from a platform-wide connection state or from `video.create` permission.

## Account and content preparation

1. Owner completes normal Creator login and any QR, SMS, CAPTCHA, or identity check. The program verifies the active browser context, canonical page, Creator host, and stable Douyin ID. A stored `logged_in` row is insufficient.
2. Create one persisted Article and Job. Use an Owner-authorized test image with explicit source and bind its byte SHA256, order, title, body, account, Creator ID, visibility, and selected transport before upload. Rehash the file before each upload or final boundary.
   Show the Owner the complete title/body, exact account, image source/path/SHA256, public/immediate settings, possible automatic draft, and intended scope. Do not infer upload/edit permission from R0's old diagnostic upload.
3. Open the current Creator image/text entry through the owned page. Read the live DOM; upload through its file input; fill title/body; read back image count, title, body, and required settings. Stop on mismatch, missing control, security challenge, or changed identity.
   For a no-location candidate, the adapter denies only Creator geolocation through the owned Chromium context before preparation. A browser location prompt can otherwise cover editor controls. QR, SMS, CAPTCHA, risk and identity prompts still require the Owner's normal platform action.
4. Persist a Prepared PublishRecord and SubmissionIntent. The global formal gate allows one formal task. Only after a final preflight may the durable `final_submit_count` claim change from 0 to 1 immediately before the actual remote final action.

## Submit and recovery

The final action limit is one click. If the page closes, click times out, response is lost, or status is unknown after the claim, retain `NeedsReconciliation` and count 1. Never retry or switch to an API. App restart before the claim requires fresh session, identity, file-hash, and editor checks. Restart after the claim is reconciliation only.

Read-only Creator work management at `/creator-micro/content/manage` visibly has `已发布`, `审核中`, and `未通过` states, genre/date filters, and a `搜索作品` field. No draft tab was observed. The unpublished test image/text item was instead offered through a continue-editing prompt on the publishing route. Never automatically select “继续编辑”, “放弃”, or “暂存离开” for an old item. The current conservative parser only promotes a unique management row with the trusted response ID and matching title. Missing ID, incomplete list scope, or multiple candidates remain unknown. Reviewing is pending, rejection is recorded without retry, and a published management row plus ID yields `PUBLISHED_MANAGEMENT`. Verify the public page if available; if blocked by dynamic loading or login, record `PUBLIC_VERIFICATION_LIMITED` without resubmitting. Do not treat an editor success toast or HTTP 200 alone as published.

## One-shot authorization

Before real submit, show the Owner account/Creator ID, transport, exact title, body summary, image path and SHA256, source/content-binding hashes, live session proof, management readiness, and `final_submit_count=0`. Only an explicit Owner approval permits the single test submission. The test content may not contain client data, real contact details, or commercial promises. Ordinary production publishing and batch publishing remain off after a successful one-shot test until separately enabled.

## R1 implementation and live evidence (2026-09-26)

R1 adds normal-app stored-session activation, strict image upload and settings checks, a one-shot browser final action with Page-scoped passive response observation, and conservative management/public readback. The Owner completed normal-app Creator login; Main verified ID `72388977613`, the owned Page/Context, and the stored session generation. Read-only management smoke passed on `/creator-micro/content/manage` with one search input and the selected `已发布` label. This does not prove target-row matching or full state coverage.

The Owner authorized one exact test Article/Job, preparation and at most one final action. The app-owned browser selected the approved image once and reached `/creator-micro/content/post/image` with one loaded preview; the file input unmounted during navigation, causing the first adapter preparation to fail before a Prepared Record existed. The Owner approved continuing **only that existing unfinished item**. Its title/body remained blank. A Chrome location prompt was denied in that owned window, and later code added Creator-origin geolocation denial during preparation. After a corrected package restarted, the same account/Context was verified, but both normal image-post entry paths opened an empty upload page with no recoverable `继续编辑` offer. No second image upload is allowed for this candidate. Do not assume a missing draft list means the unfinished item was deleted from the platform.

The retained Job is `AwaitingConfirmation` with no SubmissionIntent, PublishRecord, or final-submit claim. Final click, create response shape, new management target row and public page remain NOT_RUN. The resume branch now requires exact nonempty candidate title/body and one image in the correct editor, as well as account and Article binding; a blank or unrelated draft cannot be silently used. Ordinary native submit stays OFF. If a later separately authorized candidate reaches the claim and has an unknown result, retain `NeedsReconciliation` and only read back; never submit again.

Final safe source commit `5ce8d24` passed the focused Douyin tests, 135 full test files / 970 tests, typecheck, lint, build and independent NSIS package. Its EXE, app.asar and packaged Main hashes were checked against the built source. This is code/package readiness only. The live restart described above used the prior `23f712d` package for read-only draft recovery; the final safe package did not perform a live upload or submit.
