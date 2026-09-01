# TASK10V XHS Identity Proof and Authorization Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 account-scoped canonical BrowserSession/Page 上证明 XHS Creator external ID，并把指定账号的 one-shot `AUTHORIZED_UNUSED` 授权收敛为唯一可复用 operation，同时保持所有发布 mutation 为零。

**Architecture:** XHS Adapter 提供只读、进程内的 canonical Page URL/identity observation；main 层用 typed identity service 执行严格匹配和 owner-approved 本地绑定；DB repository 通过 migration 0024 持久化 identity binding，并以单事务 deterministic convergence 标记旧 unused authorization 为 `SUPERSEDED_UNUSED`。one-shot request path 复用现有 operation，不创建第三条授权；prepublish gate 在 editor/upload 前执行 identity proof。

**Tech Stack:** TypeScript strict mode, Electron main/preload/renderer, Playwright Core, better-sqlite3, Vitest, pnpm, electron-vite, electron-builder。

**Spec:** `docs/superpowers/specs/2026-09-01-task10v-xhs-identity-proof-authorization-convergence-design.md`

## Global Constraints

- 只允许平台 `xiaohongshu`、内部账号 `54b390ac-d81e-440a-baeb-d00f9f346cc3`。
- expected XHS Creator ID 必须与 `accounts.external_account_id=960803317` 精确匹配；不得用昵称、URL、头像、cookie 或 session hash 代替。
- canonical URL 来源必须是 Playwright `page.url()`，并与 `page.evaluate(() => location.href)` 的 origin/path 一致；不得依赖屏幕 OCR/Computer Use 地址栏。
- 复用已有 canonical BrowserSession/Page；不得创建 new BrowserContext 或 new Page。
- 本 Task 不上传、不填写标题/正文、不改设置、不 final submit；`UPLOAD_MUTATION_COUNT=0`、`TITLE_MUTATION_COUNT=0`、`BODY_MUTATION_COUNT=0`、`PUBLICATION_TRANSACTION_COUNT=0`、`FINAL_SUBMIT_COUNT=0`。
- 不创建第三个 authorization；旧历史只允许通过正式 repository/service 标记 `SUPERSEDED_UNUSED`，不得删除。
- 保留 Task10R exploration、Task10S one-shot guard、Task10T atomic confirm、Task10U reconciliation 行为。
- 所有新 selector/identity extraction 必须有回归测试；不得使用 `any`、fragile nth-child 或随机 class hash。

---

### Task 1: Add typed identity and convergence contracts plus migration 0024

**Files:**
- Modify: `packages/domain/src/types.ts`
- Create: `packages/db/migrations/0024_v151_platform_account_identity_binding.sql`
- Modify: `packages/db/src/migration-upgrade.test.ts`
- Test: `packages/db/src/platform-account-identity.repository.test.ts`

**Interfaces:**
- Produces `CreatorIdentityProof`, `CreatorIdentityVerificationResult`, `PlatformAccountIdentityBinding`, `OneShotAuthorizationConvergenceResult`, and `OneShotPublicationAuthorizationState = "..." | "SUPERSEDED_UNUSED"`.
- Migration creates `platform_account_identity_bindings` with unique `(platform_key, account_id)` and `(platform_key, external_creator_id)` constraints without changing migration 0023.

- [ ] **Step 1: Write failing domain/repository tests**

```ts
it("requires a stable external creator id for identity verification", () => {
  const proof: CreatorIdentityProof = {
    platformKey: "xiaohongshu",
    externalCreatorId: null,
    displayName: "测试账号",
    profileUrl: null,
    source: "CREATOR_ACCOUNT_SURFACE",
    stable: false
  };
  expect(proof.stable).toBe(false);
});

it("creates identity binding constraints in migration 0024", () => {
  const database = openDatabase(fixturePath, migrationDir);
  expect(tableExists(database.db, "platform_account_identity_bindings")).toBe(true);
  expect(indexExists(database.db, "uq_platform_account_identity_bindings_account")).toBe(true);
  expect(indexExists(database.db, "uq_platform_account_identity_bindings_external")).toBe(true);
});
```

- [ ] **Step 2: Run the focused tests and verify the missing contract/migration failure**

Run: `pnpm exec vitest run packages/db/src/platform-account-identity.repository.test.ts packages/db/src/migration-upgrade.test.ts`

Expected: FAIL because the migration and typed repository contract do not exist.

- [ ] **Step 3: Add the typed contracts and migration**

Use these exact fields in `packages/domain/src/types.ts`:

```ts
export type CreatorIdentityProofSource = "CREATOR_PROFILE_LINK" | "CREATOR_STRUCTURED_DATA" | "CREATOR_ACCOUNT_SURFACE";
export interface CreatorIdentityProof {
  platformKey: "xiaohongshu";
  externalCreatorId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  source: CreatorIdentityProofSource;
  stable: boolean;
}
export interface PlatformAccountIdentityBinding {
  platformKey: string;
  accountId: string;
  externalCreatorId: string;
  displayName: string | null;
  profileUrl: string | null;
  bindingSource: "LEGACY_ACCOUNT_EXTERNAL_ID_MATCH" | "OWNER_APPROVED_CREATOR_IDENTITY_BINDING";
  boundAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface CreatorIdentityVerificationResult {
  expectedExternalCreatorId: string | null;
  observed: CreatorIdentityProof;
  verified: boolean;
  mismatch: boolean;
  canonicalContextId: string;
  canonicalPageId: string;
  canonicalPageUrl: string;
  domLocationHref: string;
  pageUrlConsistency: "PASS" | "FAIL";
  routeClass: "CREATOR_HOME" | "PUBLISH_EDITOR" | "CREATOR_CONTENT" | "OTHER_CREATOR_PAGE" | "LOGIN" | "SECURITY_VERIFICATION" | "UNKNOWN";
}
```

Create migration `0024_v151_platform_account_identity_binding.sql` with `id TEXT PRIMARY KEY`, the fields above, `FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE`, and unique indexes named exactly as the tests assert. The external ID must be `TEXT NOT NULL`; no secret/session fields may be added.

- [ ] **Step 4: Run migration and contract tests**

Run: `pnpm exec vitest run packages/db/src/platform-account-identity.repository.test.ts packages/db/src/migration-upgrade.test.ts`

Expected: PASS for migration discovery, 0023→0024, second-run idempotency, and domain-row preservation.

- [ ] **Step 5: Commit the schema contract slice**

```powershell
git add packages/domain/src/types.ts packages/db/migrations/0024_v151_platform_account_identity_binding.sql packages/db/src/migration-upgrade.test.ts packages/db/src/platform-account-identity.repository.test.ts
git commit -m "feat: add task10v identity binding schema"
```

### Task 2: Implement narrow repository identity binding and authorization convergence

**Files:**
- Modify: `packages/db/src/repository.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/platform-account-identity.repository.test.ts`
- Test: `packages/db/src/one-shot-publication.repository.test.ts`

**Interfaces:**
- `getPlatformAccountIdentityBinding(platformKey: string, accountId: string): PlatformAccountIdentityBinding | null`
- `bindPlatformAccountIdentity(input: { platformKey: "xiaohongshu"; accountId: string; externalCreatorId: string; displayName?: string | null; profileUrl?: string | null; bindingSource: PlatformAccountIdentityBinding["bindingSource"] }): PlatformAccountIdentityBinding`
- `listReusableOneShotPublicationAuthorizations(input: { platformKey: "xiaohongshu"; accountId: string; mode: typeof ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }): OneShotPublicationAuthorization[]`
- `convergeUnusedOneShotAuthorization(input: { platformKey: "xiaohongshu"; accountId: string; mode: typeof ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }): OneShotAuthorizationConvergenceResult`

- [ ] **Step 1: Write failing repository tests**

Cover these behaviors with fixture DB rows: legacy expected ID fallback, first binding, conflicting external ID rejection, two unused rows retaining newest by `created_at DESC` then `operation_id DESC`, old row becoming `SUPERSEDED_UNUSED`, no deletion, consumed/publication-started rows excluded, and a second convergence returning `mutationCount: 0`.

```ts
it("retains the newest reusable authorization and supersedes the older one", () => {
  const result = database.repository.convergeUnusedOneShotAuthorization(input);
  expect(result.reusableOperationId).toBe("operation-new");
  expect(result.supersededOperationIds).toEqual(["operation-old"]);
  expect(result.activeUnusedAuthorizationCount).toBe(1);
  expect(result.mutationCount).toBe(1);
  expect(database.repository.getOneShotPublicationAuthorization("operation-old")?.state).toBe("SUPERSEDED_UNUSED");
});

it("does not overwrite an existing identity binding", () => {
  database.repository.bindPlatformAccountIdentity(firstBinding);
  expect(() => database.repository.bindPlatformAccountIdentity(conflictingBinding)).toThrow(/已绑定|conflict|mismatch/iu);
});
```

- [ ] **Step 2: Run the repository tests and confirm RED**

Run: `pnpm exec vitest run packages/db/src/platform-account-identity.repository.test.ts packages/db/src/one-shot-publication.repository.test.ts`

Expected: FAIL because methods are absent and the state mapper does not yet include `SUPERSEDED_UNUSED`.

- [ ] **Step 3: Implement transactional repository methods**

Use `this.db.transaction` for binding and convergence. Binding must first load the current account-scoped binding and any conflicting external binding, return the existing identical binding idempotently, and throw before mutation on conflict. Convergence must select only exact XHS/account/mode rows with `state='AUTHORIZED_UNUSED'`, zero transaction/final-submit/retry counters, and a corresponding `platform_self_test_runs` row with no `publish_job_id`; update losers to `SUPERSEDED_UNUSED` in the same transaction. Do not update rows that fail the safe predicate.

- [ ] **Step 4: Run repository tests GREEN**

Run: `pnpm exec vitest run packages/db/src/platform-account-identity.repository.test.ts packages/db/src/one-shot-publication.repository.test.ts`

Expected: PASS, including idempotent second convergence and all unsafe-state rejection cases.

- [ ] **Step 5: Commit repository behavior**

```powershell
git add packages/db/src/repository.ts packages/db/src/index.ts packages/db/src/platform-account-identity.repository.test.ts packages/db/src/one-shot-publication.repository.test.ts
git commit -m "feat: converge reusable xiaohongshu authorization"
```

### Task 3: Expose canonical Page URL and XHS Creator identity proof in the Adapter

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `packages/adapters/xiaohongshu/src/index.ts`
- Test: `packages/adapters/xiaohongshu/src/browser.test.ts`
- Test: `packages/adapters/xiaohongshu/src/creator-identity.test.ts`

**Interfaces:**
- `readCanonicalCreatorIdentity(ctx: AccountContext, operationId?: string): Promise<CreatorIdentityObservation>` on the XHS browser adapter.
- `CreatorIdentityObservation` contains `canonicalContextId`, `canonicalPageId`, `canonicalPageUrl`, `domLocationHref`, `pageUrlConsistency`, `routeClass`, `runtimeAuthState`, `browserConnected`, `pageClosed`, and the sanitized `CreatorIdentityProof`.

- [ ] **Step 1: Write failing adapter tests**

Use existing canonical Page test doubles with `url()`, `context()`, `evaluate()`, and `isClosed()`; do not add a second Page. Assert that a matching structured/profile ID `960803317` passes, a different ID fails closed, nickname-only evidence is insufficient, and URL disagreement returns `pageUrlConsistency: "FAIL"` without navigation.

```ts
it("reads URL and Creator ID from the existing canonical Page only", async () => {
  const result = await adapter.readCanonicalCreatorIdentity(context, "task10v-proof");
  expect(result.canonicalPageUrl).toBe("https://creator.xiaohongshu.com/new/home");
  expect(result.domLocationHref).toBe("https://creator.xiaohongshu.com/new/home");
  expect(result.pageUrlConsistency).toBe("PASS");
  expect(result.proof.externalCreatorId).toBe("960803317");
  expect(result.proof.stable).toBe(true);
  expect(fixture.createdPages).toHaveLength(0);
});
```

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/creator-identity.test.ts packages/adapters/xiaohongshu/src/browser.test.ts`

Expected: FAIL because the public observation method and structured identity source are absent.

- [ ] **Step 3: Implement the read-only observer**

Inside the existing account mutex, call `activeCanonicalPage(ctx)` only. Verify browser connectivity, page closure, `page.context() === session.context`, and `session.context.pages().includes(page)`. Read `page.url()` and `page.evaluate(() => location.href)`; compare origin/path and return `FAIL` without mutation if inconsistent. Classify only the real XHS Creator origin into the route classes from the contract; login/security/unknown are non-verified. Reuse the bounded evidence collector and `inspectAccountIdentity`, adding a source marker based on structured data/profile link/account surface. Never read storage, cookies, credentials, or image content.

- [ ] **Step 4: Run adapter tests GREEN**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/creator-identity.test.ts packages/adapters/xiaohongshu/src/browser.test.ts`

Expected: PASS with no navigation, no new Page, exact URL consistency, exact ID match/mismatch, and stable-ID requirement.

- [ ] **Step 5: Commit adapter observation**

```powershell
git add packages/adapters/xiaohongshu/src/browser.ts packages/adapters/xiaohongshu/src/index.ts packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/creator-identity.test.ts
git commit -m "feat: observe canonical xiaohongshu creator identity"
```

### Task 4: Add main identity proof service and safe IPC/preload surface

**Files:**
- Create: `apps/desktop/src/main/xhs-identity.ts`
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/preload.ts`
- Modify: `apps/desktop/src/shared/api.ts`
- Test: `apps/desktop/src/main/xhs-identity.test.ts`

**Interfaces:**
- `XhsIdentityService.verifyCreatorIdentity(accountId: string): Promise<CreatorIdentityVerificationResult>`
- `XhsIdentityService.bindOwnerApprovedCreatorIdentity(input): PlatformAccountIdentityBinding`
- `XhsIdentityService.verifyAndConverge(accountId: string): Promise<Task10VIdentityAcceptance>`
- IPC `platform-self-test:verify-xhs-creator-identity` is read/proof-only; IPC `platform-self-test:verify-and-converge-xhs-identity` may write only the formal identity binding and authorization supersession after exact proof.

- [ ] **Step 1: Write failing service tests**

Cover expected ID from explicit binding then legacy account metadata, exact match, mismatch with zero writes, owner-approved first binding, owner approval absent, wrong account/platform, URL inconsistency, and convergence only after verification. Assert no publication counters change.

- [ ] **Step 2: Run service tests RED**

Run: `pnpm exec vitest run apps/desktop/src/main/xhs-identity.test.ts`

Expected: FAIL because the service and IPC surface are absent.

- [ ] **Step 3: Implement the service with strict fail-closed ordering**

Resolve the exact active account, obtain the registered XHS automation adapter, call `readCanonicalCreatorIdentity` with an `AccountContext` using the existing `accountId` and a generated user-action id, resolve expected identity from binding then `account.externalAccountId`, and compare only non-empty stable external IDs. On match, upsert the formal binding transactionally only if absent/identical; then call repository convergence. On mismatch, login/security/unknown/URL inconsistency, return a blocked result and perform no writes. Binding without expected identity requires an explicit `ownerApproved: true` input and still requires a stable observed ID.

- [ ] **Step 4: Add typed IPC/preload methods and structured logs**

Register the proof-only and verify-and-converge channels with Zod account/platform validation. Log `EXPECTED_CREATOR_IDENTITY`, `OBSERVED_CREATOR_IDENTITY`, `ACCOUNT_IDENTITY_VERIFIED`, `ACCOUNT_IDENTITY_MISMATCH`, `ACTIVE_UNUSED_AUTHORIZATION_COUNT`, `REUSABLE_ONE_SHOT_OPERATION_ID`, and superseded count without secrets. Do not increment upload/publication/final-submit counters.

- [ ] **Step 5: Run service and type tests GREEN**

Run: `pnpm exec vitest run apps/desktop/src/main/xhs-identity.test.ts packages/db/src/platform-account-identity.repository.test.ts`

Expected: PASS with no mutation on mismatch and convergence only after exact proof.

- [ ] **Step 6: Commit service and IPC surface**

```powershell
git add apps/desktop/src/main/xhs-identity.ts apps/desktop/src/main/platform-self-test.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/preload.ts apps/desktop/src/shared/api.ts apps/desktop/src/main/xhs-identity.test.ts
git commit -m "feat: add task10v xhs identity proof service"
```

### Task 5: Integrate identity proof and reusable authorization into one-shot flow

**Files:**
- Modify: `apps/desktop/src/main/platform-self-test.ts`
- Modify: `apps/desktop/src/renderer/PlatformSelfTestCenter.tsx`
- Modify: `packages/domain/src/types.ts`
- Test: `apps/desktop/src/main/platform-self-test.test.ts`
- Test: `apps/desktop/src/renderer/PlatformSelfTestCenter.test.tsx` (or the repository’s existing renderer test location)

**Interfaces:**
- `requestOneShotPublish` consults `convergeUnusedOneShotAuthorization` and returns the exact existing run when a reusable authorization exists.
- `confirmOneShotPublish` runs identity proof before `runEditorAndContent`; identity mismatch records `ACCOUNT_IDENTITY_MISMATCH` and leaves upload at zero.
- A reusable run with prior `ONE_SHOT_PREPUBLISH_EVIDENCE_INCOMPLETE` is resumable without requiring the old confirmation-required step.

- [ ] **Step 1: Write failing flow tests**

Cover two existing `AUTHORIZED_UNUSED` rows causing one reusable operation and no third row, existing reusable request returning the same run, identity mismatch stopping before editor/upload, matching identity allowing prepublish to continue in a fixture, and preservation of Task10R/Task10S/Task10U guards.

- [ ] **Step 2: Run flow tests RED**

Run: `pnpm exec vitest run apps/desktop/src/main/platform-self-test.test.ts`

Expected: FAIL because request currently always inserts a new run and one-shot confirmation currently accepts only the original confirmation step.

- [ ] **Step 3: Implement reuse/resume and identity gate**

Before creating a run, use the exact XHS/account/mode convergence result. If `reusableOperationId` exists, load the matching self-test run and return it without creating a run or authorization. If no matching run exists, fail closed with an orphaned reusable-authorization error. Expand `mustOneShotRun` to accept an exact reusable authorization plus a prior prepublish failure. In `confirmOneShotPublishOnce`, call the identity service before `runEditorAndContent`; on failure record a precise identity step and return before image preparation/upload. Keep authorization `AUTHORIZED_UNUSED` and all publication counters at zero.

- [ ] **Step 4: Add UI status without an automatic confirm**

Add a read-only Task10V action on the XHS row labeled `确认账号身份并收敛一次性授权`, wired to the proof/convergence IPC. Show `正在确认当前小红书账号身份`, mismatch text `当前登录的小红书账号与已绑定账号不一致`, reusable operation id, and active unused count. Do not auto-click confirmation, upload, or publish. Keep `探索发布流程（不发布）` and `自测 L1–L3` visually distinct.

- [ ] **Step 5: Run flow/UI tests GREEN**

Run: `pnpm exec vitest run apps/desktop/src/main/platform-self-test.test.ts apps/desktop/src/renderer/PlatformSelfTestCenter.test.tsx`

Expected: PASS with no third authorization and no publication-side effects.

- [ ] **Step 6: Commit one-shot integration**

```powershell
git add apps/desktop/src/main/platform-self-test.ts apps/desktop/src/renderer/PlatformSelfTestCenter.tsx packages/domain/src/types.ts apps/desktop/src/main/platform-self-test.test.ts apps/desktop/src/renderer/PlatformSelfTestCenter.test.tsx
git commit -m "feat: converge task10v one shot resume flow"
```

### Task 6: Add analyzer evidence and complete regression coverage

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/task10a-evidence.helpers.ts` (or the existing Task10A analyzer helper file)
- Modify: `packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts`
- Modify: `apps/desktop/src/main/platform-self-test.test.ts`
- Modify: `packages/db/src/one-shot-reconciliation.test.ts`
- Modify: `packages/publisher/src/one-shot-publisher.test.ts`
- Create or modify: `output/xiaohongshu-task10v-identity-convergence.json` only if the project’s evidence writer requires a fixture artifact

**Interfaces:**
- Analyzer exposes `EXPECTED_CREATOR_IDENTITY`, `OBSERVED_CREATOR_IDENTITY`, `ACCOUNT_IDENTITY_VERIFIED`, `ACCOUNT_IDENTITY_MISMATCH`, `ACTIVE_UNUSED_AUTHORIZATION_COUNT`, `REUSABLE_ONE_SHOT_OPERATION_ID`, and `SUPERSEDED_UNUSED_AUTHORIZATION_COUNT`.
- Identity proof/convergence never increments publication transaction, upload, content, or final-submit counters.

- [ ] **Step 1: Add failing analyzer and regression assertions**

Assert analyzer reads structured fields rather than substring counts, and add fixtures for exact ID match/mismatch, two unused auth rows, Task10U reconciliation, Task10T atomic confirmation, Task10S non-click guard, Task10R exploration, and `FINAL_SUBMIT_COUNT=0`.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts packages/db/src/one-shot-reconciliation.test.ts packages/publisher/src/one-shot-publisher.test.ts`

Expected: FAIL on missing Task10V evidence fields.

- [ ] **Step 3: Implement structured evidence mapping**

Map only typed fields from the identity service and repository result. Keep IDs/display names/profile URLs sanitized and exclude cookies, tokens, credentials, local storage, and raw API payloads.

- [ ] **Step 4: Run full focused regression suite**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts packages/db/src/one-shot-reconciliation.test.ts packages/publisher/src/one-shot-publisher.test.ts packages/adapters/xiaohongshu/src/task10r-evidence.helpers.test.ts`

Expected: PASS with all historical safety behavior intact.

- [ ] **Step 5: Commit evidence/regressions**

```powershell
git add packages/adapters/xiaohongshu/src/task10a-evidence.helpers.ts packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts packages/db/src/one-shot-reconciliation.test.ts packages/publisher/src/one-shot-publisher.test.ts packages/adapters/xiaohongshu/src/task10r-evidence.helpers.test.ts
git commit -m "test: cover task10v identity convergence evidence"
```

### Task 7: Offline verification, package, and safe deployment

**Files:**
- Modify: `output/xiaohongshu-task10v-identity-convergence.json` only through the formal evidence writer if required
- Create: `release-task10v-20260901-r1/` as package output; do not overwrite Task10S/Task10T/Task10U staging

**Interfaces:**
- Migration 0024 must be included and discovered by packaged startup.
- Installed runtime must expose the proof/convergence IPC and preserve all prior safety markers.

- [ ] **Step 1: Run focused suite**

Run: `pnpm test -- packages/adapters/xiaohongshu/src/creator-identity.test.ts packages/db/src/platform-account-identity.repository.test.ts apps/desktop/src/main/xhs-identity.test.ts`

Expected: PASS; all offline mutation counters remain zero.

- [ ] **Step 2: Run full tests, typecheck, lint, and build**

Run: `pnpm test`; `pnpm typecheck`; `pnpm lint`; `pnpm build`

Expected: exit code 0 and no new failures.

- [ ] **Step 3: Create the Task10V commit selectively**

Inspect `git status --short`, then stage only the exact Task10V paths listed below and commit:

```powershell
git add -- packages/domain/src/types.ts packages/db/migrations/0024_v151_platform_account_identity_binding.sql packages/db/src/index.ts packages/db/src/repository.ts packages/db/src/migration-upgrade.test.ts packages/db/src/platform-account-identity.repository.test.ts packages/db/src/one-shot-publication.repository.test.ts packages/adapters/xiaohongshu/src/browser.ts packages/adapters/xiaohongshu/src/index.ts packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/creator-identity.test.ts packages/adapters/xiaohongshu/src/task10a-evidence.helpers.ts packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts packages/adapters/xiaohongshu/src/task10r-evidence.helpers.test.ts apps/desktop/src/main/xhs-identity.ts apps/desktop/src/main/xhs-identity.test.ts apps/desktop/src/main/platform-self-test.ts apps/desktop/src/main/platform-self-test.test.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/preload.ts apps/desktop/src/shared/api.ts apps/desktop/src/renderer/PlatformSelfTestCenter.tsx apps/desktop/src/renderer/PlatformSelfTestCenter.test.tsx packages/db/src/one-shot-reconciliation.test.ts packages/publisher/src/one-shot-publisher.test.ts
git commit -m "feat: prove xiaohongshu creator identity and converge one shot auth"
```

Do not use `git add .`, `git add -A`, `git clean`, `git reset`, or `git restore`; preserve unrelated release/rollback artifacts.

- [ ] **Step 4: Package and verify markers**

Build/package into a unique `release-task10v-20260901-r1` path using the project’s existing package script/config. Compute the packaged `app.asar` SHA256 and inspect it for migration 0024, canonical Page URL proof, exact ID comparison, convergence, no-third-authorization reuse, and Task10R/S/T/U markers.

- [ ] **Step 5: Perform safe runtime precheck and deployment only after zero processes**

Read installed process count, XHS profile process count, and lock ownership. If runtime is active, report `DEPLOYMENT=BLOCKED_ACTIVE_RUNTIME` and stop without killing it. If `0/0/NO`, create a unique rollback, verify old installed hash, deploy the existing Task10V package, verify installed hash equals staging hash, and start the packaged app. Never modify credentials, browser profiles, or production DB by hand.

### Task 8: Production identity proof and authorization convergence acceptance

**Files:**
- No source edits; use installed runtime IPC/service and read-only evidence output.

**Interfaces:**
- The existing canonical authenticated XHS Page is the only browser object used.
- Production writes are limited to formal identity binding (only if absent/identical legacy promotion) and superseding the older unused authorization.

- [ ] **Step 1: Invoke proof through the installed typed IPC/service**

Call the proof-only or combined verify-and-converge path with account `54b390ac-d81e-440a-baeb-d00f9f346cc3`. Record `page.url()` source, DOM `location.href`, context/page ids, route class, observed external ID, confidence, and exact match. Do not navigate, click, type, upload, or submit.

- [ ] **Step 2: Stop before mutation on any identity ambiguity**

If URL consistency fails, route is login/security/unknown, stable ID is absent, or observed ID is not `960803317`, write `NEXT_BLOCKER` and do not bind or supersede anything.

- [ ] **Step 3: On exact match, run formal local binding/convergence once**

Persist the matching identity binding through repository/service only, then converge the two known unused authorizations. Expected reusable operation is `6cb27b65-b122-4430-b8c7-aa83c59c8cac` only if timestamps and strict state prove it is newest and safe; old operation becomes `SUPERSEDED_UNUSED`. Do not consume the reusable authorization.

- [ ] **Step 4: Re-read acceptance state through repository/service**

Verify `ACCOUNT_IDENTITY_VERIFIED=YES`, one active unused authorization, reusable operation id, authorization still `AUTHORIZED_UNUSED`, no operation/publication/upload/content/final-submit mutations, publish-domain counts unchanged at `15/12/9`, and no third authorization.

- [ ] **Step 5: Persist the final evidence and stop**

Write `output/xiaohongshu-task10v-identity-convergence.json` with timeline, URL/identity evidence, authorization states, convergence result, counters, and blocker. Do not start the real one-shot publish flow.

## Plan self-review

- Spec coverage: identity contract/binding, canonical Page URL consistency, strict expected-ID match, owner-approved fallback binding, authorization convergence/deterministic supersession, no-third request reuse, prepublish ordering, UI feedback, analyzer fields, regression tests, package/deploy, and production acceptance are covered by Tasks 1–8.
- Placeholder scan: no unresolved placeholder instruction, vague “similar to” reference, or unspecified implementation step remains; every task names files, interfaces, commands, and expected outcomes.
- Type consistency: `CreatorIdentityProof`, `PlatformAccountIdentityBinding`, `CreatorIdentityVerificationResult`, and `OneShotAuthorizationConvergenceResult` are introduced in Task 1 and consumed by Tasks 2–8; the `SUPERSEDED_UNUSED` state is explicitly carried into repository mapping and flow tests.
- Safety review: no step uses Computer Use URL evidence, new BrowserContext/Page, raw production SQL, third authorization creation, upload, content mutation, or final submit.
