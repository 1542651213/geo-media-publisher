# Xiaohongshu Session Persistence Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine why the manually verified Xiaohongshu account session is not restored by the gate, and make the smallest account-scoped persistence fix needed to prove two consecutive restores without entering the publishing flow.

**Architecture:** Trace the installed-app login/complete-login path and the gate restore path down to the actual Chromium persistence locator, encrypted credential metadata, and close/flush ordering. Preserve the existing `platformKey + accountId` boundary; if a real defect is found, add a focused regression test first and change only the Xiaohongshu/shared BrowserSession code required to make the same persistence locator recoverable.

**Tech Stack:** TypeScript, Electron, Playwright, Vitest, better-sqlite3, SafeStorageCredentialStore, pnpm.

**Spec:** `C:\Users\Administrator\.codex\attachments\8084bd63-de52-4231-8b6a-d0ce7045f395\pasted-text.txt`

## Global Constraints

- Never enter the Xiaohongshu publishing gate, upload media, write title/body, or click any publish CTA.
- `FINAL_SUBMIT_COUNT` must remain `0`.
- Do not create SELF_TEST, Job, SubmissionIntent, or PublishRecord rows.
- Reuse only `platformKey=xiaohongshu` and account `54b390ac-d81e-440a-baeb-d00f9f346cc3`.
- Do not add, switch, delete, archive, or clear any account or credential.
- Do not clear cookies, app userData, or existing credentials.
- Do not modify Sohu, Toutiao, release, or unrelated dirty changes.
- Never log cookie values, token values, passwords, plaintext credentials, or authorization headers.
- Preserve existing dirty worktree changes and do not use `git reset --hard` or `git clean`.
- Stop immediately if a live restore requires another security verification, CAPTCHA, QR code, phone confirmation, or risk-control action.

---

### Task 1: Capture a read-only baseline and map the involved files

**Files:**
- Read: `PROJECT_STATE.md`
- Read: `AGENTS.md`
- Read: `packages/adapters/xiaohongshu/src/browser.ts`
- Read: `packages/adapters/browser/src/index.ts`
- Read: `packages/adapters/core/src/browser.ts`
- Read: `apps/desktop/src/main/ipc.ts`
- Read: `apps/desktop/src/main/adapter-registry.ts`
- Read: `packages/security/src/index.ts`
- Read: `packages/db/src/repository.ts`
- Read: `scripts/v142-xiaohongshu-gate-only.mts`
- Read: `scripts/v142-xiaohongshu-gate-only-entry.mjs`
- Create: `output/v143-xiaohongshu-session-persistence-diagnosis.json`

**Interfaces:**
- Consumes: current branch state and the existing production paths.
- Produces: a redacted baseline containing exact account identifiers, file paths, DB publish counts, encrypted credential-key presence, current git state, installed executable path/hash, and a list of candidate login/restore functions.

- [ ] **Step 1: Record branch and dirty state without changing files**

Run:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --name-status
```

Expected: branch `codex/xiaohongshu-account-connection`, HEAD `a50972d...`, and existing unrelated dirty changes remain unchanged.

- [ ] **Step 2: Record production counts and safe credential metadata**

Run a read-only SQLite query against `C:\Users\Administrator\AppData\Roaming\codex-media-publisher\production-data\publisher.db` for `publish_jobs`, `submission_intents`, and `publish_records`; inspect only encrypted credential JSON keys and metadata, never decrypted payload values.

Expected: before counts are recorded and the exact key `session:xiaohongshu:54b390ac-d81e-440a-baeb-d00f9f346cc3` is present.

- [ ] **Step 3: Locate every login-completion and restore call site**

Run:

```powershell
rg -n "complete-login|COMPLETE_LOGIN|I.?ve completed|完成登录|checkSession|openBackendPage|storageState|launchPersistentContext|newContext|partition|userDataDir|BrowserSessionManager|credential" apps packages scripts
```

Expected: a file/function inventory connecting renderer action → IPC → main → adapter → repository/credential store and gate runner → adapter → BrowserSession manager.

- [ ] **Step 4: Write the initial redacted evidence file**

Use `apply_patch` to add JSON-shaped evidence with fields required by the user request, setting unresolved fields to explicit `NOT_INSPECTED` rather than guessing. Include `FINAL_SUBMIT_COUNT: 0`, `jobCreated: false`, `intentCreated: false`, and `publishRecordCreated: false`.

---

### Task 2: Trace the physical persistence locator and lifecycle ordering

**Files:**
- Read: all call sites identified in Task 1.
- Modify only if necessary for safe diagnostics: the smallest Xiaohongshu/shared BrowserSession files.
- Test: existing BrowserSession and Xiaohongshu adapter tests identified by `rg`.

**Interfaces:**
- Consumes: Task 1 file inventory and baseline.
- Produces: evidence for manual login, complete-login persistence, and gate restore, including `userDataDir`, profile, partition, storage mode, runtime, manager/adapter identity, account key, session/context/page IDs, credential metadata, and close/flush ordering.

- [ ] **Step 1: Trace installed-app BrowserSession construction**

Read the complete implementations that construct the visible account-1 session and record the final browser API arguments, not only the app userData root. Distinguish Electron `session partition`/`BrowserWindow` state from Playwright `launchPersistentContext(userDataDir)` and from ephemeral `newContext({storageState})`.

- [ ] **Step 2: Trace the renderer “我已完成登录” path**

Read the complete renderer handler, IPC registration, main handler, adapter completion method, account repository update, and credential-store write. Record whether live cookies/storage/profile state is read after verification, whether credential `updatedAt` changes, and whether status changes before persistence completes.

- [ ] **Step 3: Trace gate restore construction**

Read the complete gate runner and BrowserSession manager restore path. Record its browser executable/runtime, manager instance, adapter instance, account-scoped key, profile path, partition, storage mode, credential snapshot version/length metadata, and page/context ownership checks.

- [ ] **Step 4: Compare manual and gate locators**

Create a redacted comparison table in the evidence file with explicit values or `UNKNOWN` for:

```text
MANUAL_LOGIN_USER_DATA_DIR
GATE_RESTORE_USER_DATA_DIR
MANUAL_LOGIN_PROFILE
GATE_RESTORE_PROFILE
MANUAL_LOGIN_PARTITION
GATE_RESTORE_PARTITION
MANUAL_LOGIN_STORAGE_MODE
GATE_RESTORE_STORAGE_MODE
INSTALLED_APP_BROWSER_RUNTIME
GATE_BROWSER_RUNTIME
ACCOUNT_SCOPED_PROFILE_ISOLATION
```

- [ ] **Step 5: Identify the single root-cause hypothesis before editing production code**

Write one evidence-backed hypothesis, such as “manual login uses Electron persistent partition X while gate restores Playwright storageState Y” or “complete-login updates account status without refreshing the credential.” Do not implement a fix until the hypothesis is supported by call-site and runtime evidence.

---

### Task 3: Add minimal safe diagnostics only where static tracing cannot prove runtime behavior

**Files:**
- Modify: the smallest relevant Xiaohongshu/shared BrowserSession source file(s), only if current logs cannot expose the required metadata.
- Test: corresponding adapter/session tests.
- Modify: `output/v143-xiaohongshu-session-persistence-diagnosis.json` with redacted runtime evidence.

**Interfaces:**
- Consumes: Task 2 root-cause hypothesis.
- Produces: runtime metadata only: platform/account, instance IDs, physical locators, persistent/ephemeral mode, credential key, credential timestamp/byte length/version, cookie count/domain/name metadata, open URL, restore result, and close/flush ordering.

- [ ] **Step 1: Write a focused failing test for missing diagnostic behavior, if diagnostics are required**

The test must assert safe metadata shape and must assert sensitive values are absent. Run the focused test and confirm it fails for the expected missing behavior before implementation.

- [ ] **Step 2: Implement the smallest redacted diagnostic instrumentation**

Do not log values or authorization material. Ensure account IDs and credential keys are exact, and ensure log records identify the manager/context/page relationship without retaining page content.

- [ ] **Step 3: Run the focused diagnostic test**

Run the exact Vitest file and confirm it passes with no sensitive output.

- [ ] **Step 4: Run the controlled persistence probe only**

Use the exact account and existing persistent session. Start account 1’s BrowserSession, attempt restore, collect ownership evidence, close only the owned test page/context/session, then repeat once. Do not invoke `preparePublish`, image upload, title/body writes, or any publish control.

Expected: either a clear `SECURITY_VERIFICATION_REQUIRED` stop or two restore results with complete locator evidence.

---

### Task 4: If and only if a real code defect is proven, add regression tests first

**Files:**
- Test: existing BrowserSession/Xiaohongshu test files or a narrowly scoped new test file under the owning package.
- Modify: only the Xiaohongshu/shared BrowserSession production file named by the root-cause evidence.

**Interfaces:**
- Consumes: confirmed root cause from Tasks 2–3.
- Produces: failing-then-passing regression coverage for the exact persistence defect.

- [ ] **Step 1: Add the smallest failing test for the confirmed defect**

Cover only the proven behavior: current session state is saved after manual verification, `updatedAt` changes when payload changes, login and restore use the same persistence locator, account profiles are isolated, persistence occurs before close, restore uses the newest state, and failed restore does not clear a prior credential. Do not add unrelated platform tests.

- [ ] **Step 2: Run the test and verify the expected failure**

Run the exact focused Vitest command. The failure must demonstrate the real defect rather than a fixture or environment mismatch.

- [ ] **Step 3: Implement one minimal root-cause fix**

Preserve the existing `platformKey + accountId` keying and sibling-platform behavior. Do not add speculative cookie hacks or broad state-machine changes.

- [ ] **Step 4: Run the regression test and verify it passes**

Run the exact focused test again and inspect output for unrelated failures.

---

### Task 5: Controlled two-restore verification and evidence finalization

**Files:**
- Modify: `output/v143-xiaohongshu-session-persistence-diagnosis.json`
- Do not modify: production database schema/data, account records, credential contents, unrelated source or release files.

**Interfaces:**
- Consumes: the diagnosed/fixed persistence implementation and exact account-1 session.
- Produces: final redacted evidence proving two sequential restore attempts or documenting the exact blocker.

- [ ] **Step 1: Capture `RESTORE_ATTEMPT_1`**

Restore the exact account-1 session, verify no QR/CAPTCHA/security prompt/risk block, verify page ownership, and close only the owned test resources. If security verification is required, stop and mark `OWNER_ACTION_REQUIRED` without opening the gate.

- [ ] **Step 2: Capture `RESTORE_ATTEMPT_2`**

Start a fresh BrowserSession using the same persistence locator and repeat the same checks. Require a second independent PASS; do not reuse an in-memory page/context as proof.

- [ ] **Step 3: Recheck database counts independently**

Run the same read-only SQLite count query and require before == after for all three publish-domain tables.

- [ ] **Step 4: Verify no sensitive data entered evidence**

Inspect the JSON for cookie/token/password/authorization values and remove any unsafe diagnostic field before finalizing.

- [ ] **Step 5: Run verification if source changed**

Run, in this order:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: exit code 0 for all commands. If source did not change, report the existing fresh verification separately and do not claim a new source verification run.

- [ ] **Step 6: Record deployment and git state**

Confirm installed app path/hash/process state, confirm no redeploy unless a source fix requires it, confirm the existing v143 rollback path remains intact, and report only session-persistence files if a commit is made. Never stage unrelated changes.

---

## Self-review checklist

- [ ] No step enters the Xiaohongshu publishing editor or clicks a final CTA.
- [ ] The physical manual-login and gate-restore locators are both recorded or explicitly marked `UNKNOWN`.
- [ ] Credential metadata is compared without exposing plaintext.
- [ ] Close/flush ordering is proven rather than inferred.
- [ ] Account-scoped isolation and sibling-account safety are tested or explicitly reported.
- [ ] A production fix is made only after a failing regression test reproduces the confirmed defect.
- [ ] The final evidence includes `FINAL_SUBMIT_COUNT = 0` and unchanged publish-domain counts.
