# Douyin image/text R0 runbook

## Scope and current gate

The intended first release is one instance, one Owner-authorized Douyin account, one `article` job representing image/text, plain title and body, exactly one PNG/JPEG image, no topics, no schedule, and no deliberate draft creation. **Automatic draft side effect was observed:** after test-image upload and navigation home, the Creator home displayed `继续编辑`. The current source and Creator audit do **not** yet establish a production-ready submit path. `DOUYIN_IMAGE_TEXT_NATIVE_SUBMIT_ENABLED` must remain `false` until the offline gates and one-shot acceptance prerequisites pass.

The existing Douyin video OAuth adapter is a separate route. Do not infer image/text capability from a platform-wide connection state or from `video.create` permission.

## Account and content preparation

1. Owner completes normal Creator login and any QR, SMS, CAPTCHA, or identity check. The program verifies the active browser context, canonical page, Creator host, and stable Douyin ID. A stored `logged_in` row is insufficient.
2. Create one persisted Article and Job. Use an Owner-authorized test image with explicit source and bind its byte SHA256, order, title, body, account, Creator ID, visibility, and selected transport before upload. Rehash the file before each upload or final boundary.
3. Open the current Creator image/text entry through the owned page. Read the live DOM; upload through its file input; fill title/body; read back image count, title, body, and required settings. Stop on mismatch, missing control, security challenge, or changed identity.
4. Persist a Prepared PublishRecord and SubmissionIntent. The global formal gate allows one formal task. Only after a final preflight may the durable `final_submit_count` claim change from 0 to 1 immediately before the actual remote final action.

## Submit and recovery

The final action limit is one click. If the page closes, click times out, response is lost, or status is unknown after the claim, retain `NeedsReconciliation` and count 1. Never retry or switch to an API. App restart before the claim requires fresh session, identity, file-hash, and editor checks. Restart after the claim is reconciliation only.

Read-only Creator work management at `/creator-micro/content/manage` visibly has `已发布`, `审核中`, and `未通过` states, genre/date filters, and a `搜索作品` field. No draft tab was observed. The unpublished test image/text item was instead offered through a continue-editing prompt on the publishing route. Reconciliation should identify a unique work by remote ID first, then exact title plus account and submit time. Multiple candidates are ambiguous. Reviewing is pending, rejection is a recorded failure, and published requires a trusted remote ID. Verify the public page if available; if blocked by dynamic loading or login, record `PUBLIC_VERIFICATION_LIMITED` without resubmitting. Do not treat an editor success toast as published.

## One-shot authorization

Before real submit, show the Owner account/Creator ID, transport, exact title, body summary, image path and SHA256, source/content-binding hashes, live session proof, management readiness, and `final_submit_count=0`. Only an explicit Owner approval permits the single test submission. The test content may not contain client data, real contact details, or commercial promises. Ordinary production publishing and batch publishing remain off after a successful one-shot test until separately enabled.

## R0 implementation status (2026-09-26)

The R0 source adds a separate BrowserNative image/text adapter, Creator account/login-generation binding, one-image content and SHA256 freezing, and a fail-closed editor readback. The adapter does not implement the final publish action or management reconciliation yet. Therefore this runbook describes the required one-shot procedure, not a procedure currently enabled in ordinary production. The prior diagnostic Creator window was memory-only and has been closed. Current visibility/schedule selections, automated `setInputFiles`, unique management row identifiers, and public URL remain unverified. No real image/text Job, Intent, PublishRecord, or final click was made.
