# GEO Website Adapter state — 2026-09-26

The CMS V2 list filter contract is `active | published | deleted`; `draft` is not a server filter. The local CMS MySQL HTTP final gate passed before this GEO work. Kangyi production has **not** received that contract change, so GEO must not call `status=published` against Kangyi production.

This branch has one `CmsV2Client` for Kangyi, Huiquan and Shupai. The Website Adapter registry now has separate platform/account identities for the three sites. Huiquan and Shupai content preparation and the durable operation runner use their own `siteId`, platform key and account. The staging transport uses the same signed client, sends persisted exact JSON and idempotency keys, disables automatic transport retries, requires HTTP 202 for publish acceptance, polls the saved CMS job, and checks the final same-origin HTTPS page identity and public media hashes before closing a local PublishRecord.

Current verification:

- Huiquan and Shupai HTTPS staging: signed `capabilities`, article/case `active`, `published`, `deleted`, and invalid-status `400 BAD_REQUEST / Invalid filter` passed with the GEO client on 2026-09-26. No write was made in this GEO smoke. Both sites had zero active/published articles and cases at the time of the check.
- Focused Client/Adapter/registry/mapping/durable runner/transport tests and TypeScript typecheck passed. The full repository test command still fails for unrelated absent historical Weibo/XHS fixture files and one XHS Task10S test in this worktree; two registry failures introduced by the new sites were fixed and the focused registry suite passes.
- No GEO production publication, Kangyi production change, or website production deployment was performed. Temporary remote and local smoke files were removed. The HMAC secrets stayed on the staging server.

Next gate: run one isolated, clearly marked GEO-created staging fixture through the complete durable runner against Huiquan, reconcile its retained operation IDs, then unpublish and soft-delete it. Repeat with Shupai using the same transport and only different site configuration. Do not call Kangyi production write endpoints or reuse production-admin credentials. Before any Kangyi production path, read-only recheck production-editor scope and deploy/verify the status contract separately.
