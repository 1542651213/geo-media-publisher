# Kangyi Account and Prepare Path — Phase 1.7

## Scope

Complete the read-only/product preparation boundary for the `kangyi_website` Official API adapter without sending CMS write requests. The existing account, credential, snapshot, submission-intent, and durable operation layers remain the sources of truth.

## Design

1. Add a pure Kangyi mapping module that consumes an immutable article/snapshot projection and produces a typed prepared content object. It emits only fields present in the Kangyi Draft contract, converts supported text blocks, requires the publish-required article fields, and binds images by asset/hash without inventing media IDs.
2. Add deterministic slug generation and collision fail-closed validation. The slug is derived from an approved stable slug or the article identity and is never time/random based.
3. Add pure Phase 2 stop-condition and single-article pilot-budget gates. The ordinary adapter publish entry remains closed; a future write orchestrator must explicitly pass the owner gate and all identity/payload/response gates before using the existing durable runner.
4. Exercise the existing Account/Repository/CredentialStore path with one Kangyi staging account and the approved local SafeStorage credential. Only the capabilities GET is allowed for live verification.
5. Prepare one same-brand article snapshot/content binding locally and run mapping/slug validation without CMS writes.

## Safety invariants

- No changes to the old dirty workspace, XHS adapters, CMS repository, server, or production.
- No secret is written to SQLite, operation metadata, logs, tests, or source control.
- No direct SQL is used for account/article/asset setup; all local data mutations go through existing repository APIs.
- No CMS method other than signed `GET /_publish-api/v2/capabilities` is invoked in this phase.

## Verification

Run the new mapping/gate/account-path tests, durable recovery and XHS barrier regressions, typecheck, lint, and build. Record live capabilities only after the Account path resolves the SafeStorage credential.
