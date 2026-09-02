# Task10W Identity Extraction and Complete-Login Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the stable Creator ID from the existing canonical XHS Page using a bounded semantic account label, reuse that reader in Task10W and `accounts:complete-login`, and verify the fix in a new deployed release without running Task10V or publishing.

**Architecture:** Add one pure typed parser plus one fixed Page-locator reader in the Xiaohongshu adapter. The existing page evidence, canonical runtime probe, `getAccountProfile`, and complete-login identity gate all consume that shared reader; no arbitrary renderer JavaScript, navigation, new Page, new Context, or nickname fallback is added.

**Tech Stack:** TypeScript strict mode, Playwright locator APIs, Vitest, pnpm, Electron packaged runtime, PowerShell deployment checks.

**Spec:** User-provided Task10W identity-blocker requirements in the active task.

## Global Constraints

- Use only the existing canonical XHS BrowserSession/Context/Page.
- Use the semantic label `小红书账号` and bounded locator/ancestor reads; never scan or dump the full DOM.
- Enforce `MAX_MATCHES <= 10`, `MAX_TEXT_LENGTH <= 300`, and `MAX_ANCESTOR_DEPTH <= 3`.
- Require a stable numeric Creator ID; nickname-only and arbitrary numeric matches fail closed.
- Preserve `accounts.external_account_id` as the expected-ID provenance.
- Do not create Page/Context, navigate, click, upload, mutate title/body/settings, create publication transactions, or run Task10V.
- Preserve r7, rollback, historical evidence, and the current XHS profile data.

### Task 1: Add the failing shared parser and lifecycle regression tests

**Files:**
- Create: `packages/adapters/xiaohongshu/src/identity.ts`
- Test: `packages/adapters/xiaohongshu/src/identity.test.ts`
- Test: `packages/adapters/xiaohongshu/src/browser.test.ts`
- Test: `tests/xiaohongshu-task10v-identity.test.ts`

- [x] **Step 1: Write failing tests for semantic label extraction.**

Cover full-width/ASCII colons, bounded whitespace, malformed values, arbitrary nine-digit text, follower/like counts, nickname-only, equal duplicate candidates, conflicting candidates, and bounded diagnostic limits.

- [x] **Step 2: Run the focused parser tests and verify the expected failure.**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/identity.test.ts`

Expected: FAIL because the shared parser module and exported functions do not yet exist.

- [x] **Step 3: Add failing adapter/complete-login characterization tests.**

Use a canonical Page fixture containing `小红书账号：960803317`; assert Task10W and `getAccountProfile` return the same normalized ID, preserve the same Page/Context IDs, and fail closed when the label is absent or conflicting.

- [x] **Step 4: Run the adapter and identity focused tests and verify the expected failures.**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-task10v-identity.test.ts`

Expected: FAIL on the missing shared label reader and complete-login proof path.

### Task 2: Implement one bounded typed identity reader

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/identity.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`

- [x] **Step 1: Implement `extractCreatorIdFromAccountLabel(text: string): string | null`.**

Accept only `小红书账号` with a legal colon and a 3–64 digit value, normalize whitespace and Unicode form, and reject all unanchored numbers or non-digit values.

- [x] **Step 2: Implement the fixed bounded Page reader.**

Read at most ten matches from a fixed `小红书账号` text locator and at most three ancestors per match. Record only bounded tag/role/class/text/parent text/own href and allowlisted data attributes. Produce typed candidates with `source`, `rawValue`, `normalizedCreatorId`, and `semanticAnchor`.

- [x] **Step 3: Implement duplicate/conflict handling.**

Deduplicate equal normalized IDs; return no identity for zero candidates and an explicit ambiguous failure for multiple different IDs.

- [x] **Step 4: Replace the separate identity parsing path in page evidence/profile lookup.**

Keep login-signal evaluation separate, merge only the shared reader’s identity result, and make `getAccountProfile` consume the already-read typed identity without nickname-only fallback.

- [x] **Step 5: Run the focused tests and verify they pass.**

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/identity.test.ts packages/adapters/xiaohongshu/src/browser.test.ts tests/xiaohongshu-task10v-identity.test.ts`

Expected: PASS with no navigation, click, Page creation, Context creation, or publication mutation in the fixtures.

### Task 3: Converge complete-login on Task10W proof

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/xhs-identity.ts`
- Test: `tests/xiaohongshu-account-center-ui.test.ts`
- Test: `tests/xiaohongshu-task10v-identity.test.ts`

- [x] **Step 1: Add a failing complete-login ordering assertion.**

Assert that after `COMPLETE_LOGIN_CHECK=logged_in`, the Main handler invokes the existing typed identity proof before profile persistence, emits the same canonical Context/Page IDs and normalized ID, and never reaches persistence when identity proof fails.

- [x] **Step 2: Run the failing IPC/lifecycle test.**

Run: `pnpm exec vitest run tests/xiaohongshu-account-center-ui.test.ts tests/xiaohongshu-task10v-identity.test.ts`

Expected: FAIL because `accounts:complete-login` currently calls `getAccountProfile` without first invoking Task10W identity proof.

- [x] **Step 3: Add the minimal typed proof gate before profile persistence.**

Call `platformSelfTests.verifyXhsCreatorIdentity(input.accountId)` after `completeConnection` reports `logged_in` and before `getAccountProfile`, reject unverified/mismatched identity, and leave existing release/persistence ordering intact.

- [x] **Step 4: Run the focused lifecycle tests.**

Run: `pnpm exec vitest run tests/xiaohongshu-account-center-ui.test.ts tests/xiaohongshu-task10v-identity.test.ts packages/adapters/xiaohongshu/src/browser.test.ts`

Expected: PASS; persistence happens only after the shared proof, and no Task10V/convergence method is called by complete-login.

### Task 4: Full verification, package, deploy, and live proof

**Files:**
- Modify: `apps/desktop/src/main/main.ts` only if run-specific evidence fields require a compatible diagnostic schema update.
- Create: run-specific evidence under the production evidence directory; never overwrite r7 or prior evidence.

- [x] **Step 1: Run focused tests, full tests, typecheck, lint, and build.**

Run the repository’s configured commands and require exit code 0 for each.

- [x] **Step 2: Commit the implementation on the current Task10W lineage.**

Record `START_HEAD`, `END_HEAD`, and `CODE_CHANGED=YES`; do not reset or switch to a sibling worktree.

- [x] **Step 3: Package a new independent release.**

Use `release-task10w-20260902-r8`, preserve r7 and rollback, and record staging/install hashes.

- [x] **Step 4: Deploy with profile preservation.**

Close/restart only the Geo app lifecycle if technically required; never delete the XHS profile, credentials, or login data. Do not run any publish operation.

- [ ] **Step 5: Run the fixed `--probe-xhs-canonical-page` trigger.**

Require trigger receipt, event count, same canonical IDs, URL consistency, bounded DOM diagnostic matches, observed normalized ID `960803317` from live DOM evidence, and `ACCOUNT_IDENTITY_VERIFIED=YES` before considering Task10W complete.

- [x] **Step 6: Stop before Task10V unless the user explicitly requests the next phase in a later safe step.**

This turn must leave authorization convergence and all publication mutation counters unchanged at zero.

**Live-proof note:** r8 is deployed on disk, but the current r7 Main process owns the authenticated XHS BrowserSession. Its normal shutdown hook closes owned browser sessions, so the fixed trigger was not sent after the in-place bundle replacement; doing so would produce evidence from the old in-memory bundle. A future safe restart is required before the r8 live probe.
