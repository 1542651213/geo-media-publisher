# Xiaohongshu auth-state restart diagnosis v2

## Scope

Prepare a safe, account-scoped diagnostic deployment for
`xiaohongshu/54b390ac-d81e-440a-baeb-d00f9f346cc3`. This phase must not ask the
Owner to log in, restore a browser session, open the publish editor, upload
media, call `preparePublish`, create publishing-domain rows, or click any
publish CTA.

## Plan

1. Audit the current BrowserSession, credential, adapter, IPC, diagnostic, and
   database paths. Preserve unrelated Sohu, release, and Toutiao changes.
2. Add failing tests for secret-safe HMAC value fingerprints, pre-navigation
   storage capture, persistent-profile credential-source policy, redirect
   classification, runtime manifest fields, and same-context new-page probing.
3. Implement the smallest Xiaohongshu/core instrumentation required by those
   tests. The account-scoped persistent profile is the canonical auth source;
   credential snapshots remain metadata/legacy storage and are not reinjected
   into Xiaohongshu persistent profiles.
4. Add a one-shot v2 restore diagnostic runner and evidence schema, but do not
   execute it in this phase. It must capture pre-navigation state, attach safe
   request/response/navigation diagnostics, classify redirects without secrets,
   and stop after restore attempt 1.
5. Review the existing account check-login status chain and only add a minimal
   Xiaohongshu status-sync fix if its behavior is fully covered by focused
   tests; otherwise record the follow-up explicitly.
6. Run focused tests, full test/typecheck/lint/build, deploy a v2 installed-app
   build with a rollback copy, and write readiness evidence. Stop with
   `DIAGNOSTIC_V2_READY=YES` and `OWNER_ACTION_REQUIRED=YES`.

## Safety invariants

- `FINAL_SUBMIT_COUNT=0`.
- No `Job`, `SubmissionIntent`, `PublishRecord`, real SELF_TEST, or publish
  request is created.
- No account, credential, profile, or unrelated platform changes are made.
- Cookie/storage values, tokens, credentials, authorization headers, passwords,
  and verification data never enter logs or evidence. Fingerprint keys exist
  only in process memory for one diagnostic run.
- Publishing-domain database counts must be unchanged before and after.
