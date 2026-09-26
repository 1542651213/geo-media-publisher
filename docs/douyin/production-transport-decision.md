# Douyin image/text transport decision (R0)

## Evidence

- Existing `DouyinOfficialAdapter` handles `contentKind=video` through OAuth and `/2/video/create/`. It rejects article publishing and advertises `imagePost=false`.
- On 2026-09-26, the Owner logged in to an account-owned `BrowserSessionManager` Chrome context. The canonical `page.url()` was `https://creator.douyin.com/creator-micro/home`. The home exposed a `发布图文` entry. After the Owner opened it, the same context reached `https://creator.douyin.com/creator-micro/content/upload`, where the DOM contained separate video and image file inputs and an `上传图文` control.
- With the Owner's explicit permission, the Owner manually uploaded an original, unbranded test image (SHA256 `12549e819791a4b06160e9eb38445ceb53da5e71b0dcadc4cc10f3876afe4872`). The same canonical page then reached `/creator-micro/content/post/image`; DOM exposed exactly one visible `input[placeholder="添加作品标题"]`, one `div[contenteditable=true]`, one visible editor image, `继续添加`, `发布`, and `暂存离开`. The title input had no `maxlength` attribute; no title limit is inferred. The pre-upload DOM contained *two* file inputs (one video and one image), so an unqualified `input[type=file]` selector is unsafe; the image input exposed `accept` including `image/png` and `image/jpeg`. Browser `setInputFiles` has not yet been exercised against the live Creator editor. Returning home showed `继续编辑`, evidence of an automatic draft side effect. No title/body was filled and no final submit was clicked.
- The Owner read Douyin ID `72388977613` from the account menu. The second owned diagnostic process independently read that same ID from the visible account-menu DOM. The production app has not persisted this diagnostic Session, so normal-app identity binding remains open.
- The same owned page reached Creator work management at `/creator-micro/content/manage` with a `搜索作品` input. The Owner observed `已发布`, `审核中`, and `未通过` state labels, plus genre and publication-date filters. No draft listing was found. On returning to work publication, Creator prompted to continue the last unpublished image/text item. Management row identity and remote IDs are still unverified.
- Current official Open Platform documentation describes image/text creation at `/api/douyin/v1/video/create_image_text/` and image upload at `/api/douyin/v1/video/upload_image/`, with `video.create.bind` permission. The existing video adapter requests `video.create`. No current account permission evidence proves this official route usable here.

## Decision

**Selected route for implementation: BrowserNative**, subject to automated upload, identity, editor, and management readback. It uses the Creator UI already reached in the account-owned browser. Protocol observations about ImageX, STS, Guard, BDMS, and `create_v2` remain discovery hints only.

The transport identity is `(platform=douyin, contentKind=article/image_text, transport=DOUYIN_IMAGE_TEXT_BROWSER)`. Existing `(douyin, video)` remains the official OAuth adapter. No automatic transport fallback is allowed after preparation or final-submit claim.

## Acceptance boundary

The production flag remains off, and the adapter deliberately has no final-submit implementation until the current editor settings and management rows are validated. No formal Douyin image/text publish may run until the current Creator page proves stable account identity, one-image upload completion, title/body readback, actual final action, and read-only work-management reconciliation. The Owner must then review the exact account, title, body, image SHA256, content hash, session, management readiness, and zero submit count before authorizing one final action.
