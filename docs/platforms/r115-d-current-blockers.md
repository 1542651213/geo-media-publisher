# R1.15-D current blocked platform handoff

Verified on 2026-10-01 using the installed application's normal production-data,
Main account services and application-owned browser pages. No current platform
publication was performed for these three platforms. Their ordinary and batch
gates remain OFF. Local old logged_in fields and historical PASS are insufficient.

| Platform | Current fact | Owner action | Follow-on technical gate |
| --- | --- | --- | --- |
| Weibo | No saved BrowserLogin; owned passport visitor page; needs_user_action; no stable Creator identity | Normal account-center login and any required verification | Recheck current identity; minimally restore archived platform-specific ordinary-post route, then one new bounded installed Product E2E |
| Sohu | Saved session leads to public mp.sohu.com root recommendation page with login controls; no current Creator identity | Normal Creator login and any required verification | Recheck stable identity and actual editor/management contracts, then one new bounded installed Product E2E |
| CNBlogs | Existing Main SafeStorage PAT GET /openapi/v1/corp/info returns 401 | Update PAT via Main secure input; never paste it into source, docs or logs | Verify identity/blogUrl/quota, remote draft/update/final/readback and uncertain-create reconciliation before any publish |

Sohu login detection now requires the exact HTTPS Creator host/path and current
Creator DOM. SPA-loading or a public feed is not logged_in. Classification runs
while the owned session is open, before persistence and background cleanup;
connection completion uses the same classification. Visible/background lifecycle
regressions pass. This fixes login truth without granting ordinary publication.

CNBlogs primary source: [official team OpenAPI documentation](https://www.cnblogs.com/cmt/articles/19246558).
The current documented PAT contract includes create /posts, /posts/reviewStatus and
/corp/info. It does not establish a safe original-post update/publish transition or
an idempotency lookup for an uncertain create. The inherited configured blogApp
profile is not a verified independent remote identity. The inherited prepare-draft
POST followed by another final-create POST must not be promoted unchanged. Do not
invent undocumented endpoints or retry an unknown POST. Keep OFF until these facts
are verified after valid authentication.

Historical source references are retained in Git rather than copied wholesale:
Weibo real-publish scripts/tests, Toutiao BrowserNative archive, Sohu editor/final/
reconciliation implementation, CNBlogs API adapter. A new login must not cause old
uncertain Jobs or their submit counts to be reset. Each later acceptance needs its
own clearly bounded account/article/image and one final-submit allowance.

These are Owner-only blockers for the current sprint; they do not block delivery
of the earned Toutiao addition. The installed R1.15-D release advertises no new
publish proof for them. No automatic continuation or scheduled publish was created.
