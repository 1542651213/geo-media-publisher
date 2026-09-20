# Plan: Kangyi Website Publishing API V2 Phase 1

## Goal

Add a read-only, Official API Kangyi website adapter to the clean GEO r4
baseline. Reuse the authoritative Kangyi CmsV2 signing/transport contract,
reuse GEO's existing Publisher, Account, CredentialStore, and ContentSnapshot
lifecycle, and make the adapter fail closed for all publishing writes during
Phase 1.

## Architecture

- `packages/cms-v2-client` is the single GEO runtime boundary for the Kangyi
  CmsV2 protocol. Its signing and request behavior is ported from the
  read-only Kangyi `clients/cms-v2` source without importing server code.
- `packages/adapters/kangyi-website` implements the existing `PlatformAdapter`
  contract with `integrationMode: "API"`, `transport: "official_api"`, and a
  read-only capabilities check. It receives credentials through the existing
  `AccountContext.secrets` path populated from `SafeStorageCredentialStore`.
- A deterministic operation-binding utility is client/adapter-facing only in
  Phase 1. It binds the future per-operation idempotency key to persisted GEO
  identifiers and immutable operation identity without secrets.
- `apps/desktop/src/main/adapter-registry.ts` registers the adapter. No new
  publisher framework, website database, or CMS server change is introduced.

## Tech Stack

TypeScript strict mode, pnpm workspaces, Vitest, Node `crypto`, existing GEO
`PlatformAdapter`/`AdapterRegistry`, existing Electron SafeStorage credential
flow, and the existing `ContentSnapshots` immutable image-byte boundary.

## Spec

The user-provided Phase 1 implementation request and the authoritative
Kangyi client contract in `D:/康一环保科技/康一K3-R2-admin-workspace/clients/cms-v2`.
The only live staging request permitted by this plan is a signed GET of
`/_publish-api/v2/capabilities`; all media/content/draft/validate/publish
requests remain prohibited.

## Global Constraints

- Work only in `C:/Users/Administrator/Desktop/geo-media-publisher-kangyi-phase1`.
- Do not modify the old dirty GEO workspace or any Kangyi repository/server.
- Do not expose, hash, persist, or log secrets. Never hard-code the staging
  secret path or value.
- Do not call any write API, production endpoint, XHS real action, or create a
  second Website Job/Record/Intent database.
- Keep XHS adapters and Task10S behavior unchanged.
- Every production behavior change follows RED -> GREEN -> focused test ->
  repository verification.
- Preserve the baseline full-test failures as pre-existing unless a changed
  file causes a new failure.

## Review Focus

- Exact canonical/signature compatibility with the authoritative CmsV2 client,
  especially GET empty-body hashing and write-only idempotency enforcement.
- No secret leakage through account profile, adapter result, logs, or errors.
- Wrong site/environment and invalid capabilities fail closed.
- `publishArticle` makes no network request in Phase 1.
- Adapter registration does not alter existing XHS registration or behavior.
- The idempotency key is deterministic, operation-specific, restart-stable,
  secret-free, and within the server regex.
- Existing immutable `ContentSnapshot.boundImages` are consumed conceptually;
  no mutable source path is re-read and no Website snapshot is introduced.

## Tasks

### Task 1: CmsV2 client boundary

Files:

- Add `packages/cms-v2-client/package.json`, `src/contracts.ts`, `src/client.ts`,
  `src/index.ts`, and focused tests.
- Add root TypeScript alias and workspace package metadata as required.

RED tests cover known signing vector, GET empty-body hash/no idempotency,
write idempotency validation, same serialized body across retries, safe error
classification, and transport uncertainty. Implement the minimal client
matching the current Kangyi source contract, then run focused tests and commit.

### Task 2: Deterministic Website operation binding

Files:

- Add `packages/adapters/kangyi-website/src/operation-key.ts` and tests.

RED tests cover same binding after reconstruction/restart, different operation
or snapshot producing different keys, allowed regex, 128-character bound, and
absence of secret material. Implement a stable SHA-256-derived key using only
the declared operation identity fields and commit.

### Task 3: Kangyi Website Adapter foundation

Files:

- Add `packages/adapters/kangyi-website/package.json`, `src/index.ts`, and
  focused adapter tests.

RED tests cover manifest/capabilities, credential schema, signed capabilities
success through an injected client, wrong site/environment, invalid HMAC
mapping, `writesEnabled=false` read-only behavior, non-secret account profile,
and Phase 1 fail-closed `publishArticle` with no client write call. Implement
the adapter with the existing `PlatformAdapter` and CmsV2 client boundary.

### Task 4: Registry wiring and guarded staging read-only acceptance

Files:

- Add the adapter package alias/import and register it in
  `apps/desktop/src/main/adapter-registry.ts`.
- Add a guarded integration test or runnable acceptance entry that uses only
  process-scoped runtime injection and sends one signed staging capabilities
  GET when explicitly enabled; it must skip without the owner-provided secret.

RED tests cover registry discovery and Official API mode. Run the guarded
staging GET once with the existing external secret file if available; assert
HTTP 200, kangyi/staging, protocol 2, article/case, and writesEnabled true.
No write endpoint may be invoked. Commit.

### Task 5: Verification and local delivery

Run focused CmsV2 and adapter tests, typecheck, lint, build, and the full test
suite. Compare failures with the recorded clean-baseline failures and classify
new versus pre-existing. Perform a whole-branch self-review, record the
decision that no migration is needed in Phase 1 because no CMS operation is
executed and the existing GEO lifecycle remains authoritative, then create one
local commit for any final verification-only changes. No merge or push.

## Completion Criteria

- Clean worktree remains based on peeled r4 commit
  `fba8dac3a2cfa7b5ada1a3c95cd3bd2123c1c3ad`.
- CmsV2 signer/transport is implemented once in GEO and matches the current
  Kangyi client contract.
- Kangyi adapter is discoverable as an Official API adapter and checkLogin can
  perform signed read-only capabilities verification.
- `publishArticle` is fail-closed and no Phase 2 write request is sent.
- SafeStorage credential injection and immutable ContentSnapshot interfaces are
  reused; no second Website database exists.
- Focused tests, typecheck, lint, build, and the final test classification are
  recorded honestly, with baseline failures separated from new failures.
- A local implementation commit exists on the Phase 1 branch.
