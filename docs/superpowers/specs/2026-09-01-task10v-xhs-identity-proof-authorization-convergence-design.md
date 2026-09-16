# TASK10V XHS Creator Identity Proof and Authorization Convergence

**Status:** Approved for specification review

## Goal

让指定的小红书内部账号在 canonical authenticated Creator 页面上取得稳定的外部账号身份证明，并把同一账号、同一 one-shot mode 的可继续授权收敛为唯一一个 `AUTHORIZED_UNUSED` operation；不上传、不填写、不修改发布设置、不执行最终发布。

## Current evidence

- Internal account: `54b390ac-d81e-440a-baeb-d00f9f346cc3`.
- Platform: `xiaohongshu`.
- Existing persisted external identity: `accounts.external_account_id=960803317`.
- Existing identity provenance: persisted account metadata plus the last verified account/session check; current account row has `last_verified_at=2026-09-01T07:28:13.119Z`.
- The current adapter emits `ACCOUNT_IDENTITY_UNVERIFIED` from `assertProfilePageCanBeRead` / `inspectAccountIdentity` when page evidence does not contain a reliable Creator identity signal.
- Two independent unused authorizations currently exist and have no publication side effects:
  - `60ba762e-ee2f-4157-88b4-882a4793f5e7`, created at `2026-09-01T07:27:48.460Z`.
  - `6cb27b65-b122-4430-b8c7-aa83c59c8cac`, created at `2026-09-01T07:28:28.266Z`.
- Both have `AUTHORIZED_UNUSED`, publication transaction count `0`, final submit attempt count `0`, and no external publication evidence. Publish-domain counts remain `15 / 12 / 9`.

## Non-goals and hard safety invariants

- No XHS upload, title/body mutation, required-setting mutation, final submit, or public-page verification in this task.
- No third authorization is created.
- No existing authorization history is deleted.
- An identity mismatch never overwrites an existing identity binding.
- The one-shot authorization remains `AUTHORIZED_UNUSED`; it is not consumed.
- `UPLOAD_MUTATION_COUNT=0`, `TITLE_MUTATION_COUNT=0`, `BODY_MUTATION_COUNT=0`, `PUBLICATION_TRANSACTION_COUNT=0`, and `FINAL_SUBMIT_COUNT=0` throughout Task10V.
- Existing Task10S, Task10T, and Task10U atomicity/no-retry/reconciliation guarantees remain unchanged.

## Identity contract

### Typed proof

Add a platform-neutral proof contract in the domain layer and an XHS-specific producer:

```ts
type CreatorIdentityProof = {
  platformKey: "xiaohongshu";
  externalCreatorId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  source: "CREATOR_PROFILE_LINK" | "CREATOR_STRUCTURED_DATA" | "CREATOR_ACCOUNT_SURFACE";
  stable: boolean;
};
```

Only a stable external Creator ID can satisfy identity verification. Display name, Creator URL host, avatar presence, page title, login state, cookies, and session hashes are supporting diagnostics only and cannot independently pass the gate.

### Expected identity

The expected identity resolver reads the formal identity binding first and falls back to the existing `accounts.external_account_id` for legacy rows. The existing value `960803317` is therefore an expected XHS identity, not an internal UUID and not a value to be guessed from the account name.

### Observed identity

The XHS adapter keeps the current bounded, sanitized page-evidence collector and extends it to read stable public Creator identity surfaces in this order:

1. Structured public Creator/profile link data already present in the canonical page.
2. Stable public Creator account/profile data attributes or accessible account surface.
3. A visible account/profile link whose path contains a stable Creator identifier.

The collector returns only the typed proof fields above. It never reads cookies, tokens, credentials, private storage, or image contents. Multiple distinct external IDs are an immediate `ACCOUNT_IDENTITY_MISMATCH`/unverified result.

### Verification and binding

Introduce a narrow identity service with two operations:

```ts
verifyCreatorIdentity(input): CreatorIdentityVerificationResult
bindOwnerApprovedCreatorIdentity(input): CreatorIdentityBindingResult
```

Verification rules:

- authenticated runtime, same canonical Context/Page, no login/security signal, and exactly one stable observed external ID are required;
- if expected ID exists, observed ID must equal it;
- if expected ID exists and differs, return `ACCOUNT_IDENTITY_MISMATCH` and do not mutate;
- if expected ID is absent, binding requires an explicit owner-approved local binding flag plus the same stable proof; it binds only local metadata and never changes the XHS account;
- display-name-only evidence remains insufficient.

Because the existing schema has no explicit binding-source field, add migration `0024_v151_platform_account_identity_binding.sql` without modifying migration 0023. The narrow table stores `platform_key`, internal `account_id`, `external_creator_id`, optional `display_name`, optional `profile_url`, `binding_source`, `bound_at`, `created_at`, and `updated_at`, with unique constraints for `(platform_key, account_id)` and `(platform_key, external_creator_id)`. The repository method must transactionally reject conflicting active bindings and must not overwrite an existing external ID. Legacy expected IDs remain readable through the fallback resolver and are promoted to the explicit binding record only after a successful matching proof or owner-approved first binding.

## Authorization convergence

### Typed reusable authorization

Define a reusable-authority query for the exact tuple:

```text
platformKey = xiaohongshu
accountId = 54b390ac-d81e-440a-baeb-d00f9f346cc3
mode = ONE_SHOT_REAL_PUBLISH_ACCEPTANCE
state = AUTHORIZED_UNUSED
publicationTransactionCount = 0
finalSubmitAttemptCount = 0
finalSubmitRetryCount = 0
finalSubmitActionStarted = false
```

The deterministic selection order is `created_at DESC`, then `operation_id DESC`. For the current production evidence this retains `6cb27b65-b122-4430-b8c7-aa83c59c8cac` and marks `60ba762e-ee2f-4157-88b4-882a4793f5e7` as `SUPERSEDED`; it never deletes the old row.

### Formal convergence service

Add a typed `convergeUnusedOneShotAuthorization` service/repository path. It loads the exact account/mode set, validates every candidate, selects the deterministic winner, and marks all other valid unused candidates `SUPERSEDED` in one transaction. Unsafe candidates (consumed, publication-started, final-submit-started, mismatched account/platform/mode, or conflicting state) are not silently changed.

The service returns:

```ts
{
  reusableOperationId: string | null;
  supersededOperationIds: string[];
  activeUnusedAuthorizationCount: number;
  mutationCount: number;
}
```

### Request reuse and resume

`requestOneShotPublish` must consult the convergence service before creating a new test run or authorization. If a valid reusable authorization exists, it returns the associated existing run and opens the confirmation/resume surface without creating a third authorization. A run whose authorization is still unused but whose prior prepublish evidence failed is resumable after identity proof; the resume path must not require the old `ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED` step to remain the latest step.

If an unused authorization exists but its operation/run cannot be proven to match, the request fails closed with a precise orphaned-authorization error and performs no mutation. The service never consumes an authorization; only the existing final-submit guard may consume it when a future task starts the final action.

## Prepublish integration

The XHS one-shot flow order becomes:

```text
AUTHENTICATED
→ canonical Context/Page ownership
→ Creator identity proof and exact expected-ID match
→ editor functional readiness
→ safe fixture upload
→ title/body readback
→ required settings
→ final-submit preflight
```

Identity failure stops before editor/upload and records `ACCOUNT_IDENTITY_UNVERIFIED` or `ACCOUNT_IDENTITY_MISMATCH`, preserving upload count `0`.

## UI and diagnostics

- The one-shot confirmation surface shows `正在确认当前小红书账号身份` while proof is pending.
- A mismatch shows `当前登录的小红书账号与已绑定账号不一致` and does not offer a publish resume action.
- A reusable existing operation is shown as the current one-shot test; the UI does not create another request on each entry.
- Add structured evidence fields: `EXPECTED_CREATOR_IDENTITY`, `OBSERVED_CREATOR_IDENTITY`, `ACCOUNT_IDENTITY_VERIFIED`, `ACCOUNT_IDENTITY_MISMATCH`, `ACTIVE_UNUSED_AUTHORIZATION_COUNT`, `REUSABLE_ONE_SHOT_OPERATION_ID`, and `SUPERSEDED_UNUSED_AUTHORIZATION_COUNT`.
- Identity binding, verification, convergence, and supersession are logged without secrets. They do not increment publication transaction or final-submit counters.

## Test strategy

Tests are written before production implementation and must first fail for the missing behavior.

1. XHS proof with matching external ID passes.
2. Different external ID fails closed and preserves the existing binding.
3. No expected identity plus explicit owner-approved stable proof binds once.
4. No expected identity without owner approval and display-name-only evidence both fail.
5. Two unused authorizations retain the newest deterministically and supersede the old one without deletion.
6. An existing reusable authorization causes a new request to reuse the existing operation and creates no third authorization.
7. Consumed, publication-started, final-submit-started, wrong-account, wrong-platform, and mismatched-mode authorizations are not reusable.
8. A resumable unused authorization with prior prepublish failure can re-enter identity/editor preflight without a new authorization.
9. Identity mismatch keeps upload at zero.
10. Task10U reconciliation, Task10T atomic confirmation, Task10S one-shot/no-retry, and Task10R exploration regressions remain green.

## Deployment and production acceptance

Offline fixture/temp DB tests run before touching production. The new package includes migration 0024, identity proof, convergence, resume reuse, UI feedback, and all prior safety markers. Deployment uses a unique rollback and never overwrites credentials or browser profiles.

After normal runtime exit and package hash verification, startup applies migration 0024 through the normal runner. Only then may the deployed app perform the bounded production operation:

1. read the existing canonical authenticated XHS Creator identity;
2. compare it to expected `960803317`;
3. if exact, persist the formal matching identity record if absent;
4. converge the two existing unused authorizations, retaining the latest operation and superseding the older one;
5. re-read the result through the formal service/repository path.

The acceptance result is `ACCOUNT_IDENTITY_VERIFIED=YES`, `ACTIVE_UNUSED_AUTHORIZATION_COUNT=1`, reusable operation `6cb27b65-b122-4430-b8c7-aa83c59c8cac`, authorization still `AUTHORIZED_UNUSED`, publish-domain counts unchanged at `15 / 12 / 9`, and all live publication counters zero. If the page identity cannot be read or conflicts with `960803317`, production mutation stops before binding/convergence and the task is reported blocked.

