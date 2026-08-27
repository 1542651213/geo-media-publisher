# Xiaohongshu Active Login Session Binding Implementation Plan

> **For agentic workers:** Execute this plan inline with focused RED-GREEN-REFACTOR checkpoints. Do not merge or push.

**Goal:** Make installed-app Xiaohongshu login completion resolve the exact visible account-scoped Page/Context created by begin-login, expose sanitized object-identity diagnostics, and fail specifically when that active login session is missing.

**Architecture:** Keep platform selectors and login evidence in `XiaohongshuBrowserAdapter`. Move account-scoped active-session and pending-login ownership to the long-lived shared `BrowserSessionManager`, and construct one manager for the desktop runtime registry. The IPC completion flow remains account-specific; XHS identity readback occurs on the same active Page before session release.

**Tech Stack:** TypeScript strict mode, Electron main process, Playwright Core, Vitest, pnpm.

**Spec:** User-provided continuation request in `pasted-text.txt`; existing XHS account-connection design in `docs/superpowers/specs/2026-08-27-xiaohongshu-account-connection-design.md`.

## Global Constraints

- Keep `platformKey=xiaohongshu` and modify only the XHS/browser lifecycle boundaries plus shared browser runtime plumbing.
- Do not modify other platform Adapter business behavior, publish/job/intent/record paths, or final-submit behavior.
- Never log cookies, tokens, Authorization headers, storageState contents, or secrets; debug IDs are process-memory-only random IDs.
- Missing active login Page must surface `ACTIVE_LOGIN_SESSION_NOT_FOUND` in a user-action error and must not fall back to encrypted stored Session.
- No new account, no real publish, `Final Submit Count=0`, `Job/Intent/PublishRecord=NO`, no merge, and no push.
- Preserve all pre-existing dirty worktree changes and stage only files belonging to this plan if committing.

## Execution status — 2026-08-27

- Task 1 RED was observed with 5 expected failures; the new focused lifecycle tests then pass after the implementation.
- Source verification is green: focused lifecycle/gate suite 64/64, full suite 72 files / 431 tests, typecheck, lint, and Electron renderer/main build all exit 0.
- Installed deployment target: `C:\GMP116ZhihuL5\Geo Media Publisher`; rollback copy: `C:\GMP116ZhihuL5\Geo Media Publisher.previous-20260827-xiaohongshu-active-session-binding`.
- The rebuilt package is deployed and running; 145 packaged files match the installed package by SHA-256. No owner click was performed because Computer Use is explicitly forbidden, so installed begin/complete diagnostics and the five real-page gates remain owner-dependent and are not claimed as PASS.
- No new account, final-submit action, publish Job, SubmissionIntent, or PublishRecord was created by this task.

### Task 1: Add failing lifecycle and registry tests

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.test.ts`
- Modify: `packages/adapters/browser/src/index.test.ts`
- Modify: `tests/runtime-adapter-registry.test.ts`

**Tests to add before production changes:**

- `beginLogin` followed by `completeLogin` on the same XHS adapter resolves the same Page/Context and emits `BEGIN_LOGIN_PAGE` then `COMPLETE_LOGIN_PAGE` with equal debug IDs.
- Re-fetching XHS through the runtime registry returns the same adapter instance and equal BrowserSessionManager debug ID.
- Completion without the pending active Page rejects with a message containing `ACTIVE_LOGIN_SESSION_NOT_FOUND`, even when the credential store has no stored Session.
- A second account completion never reads account A’s Page.
- XHS login and identity readback use one Page; identity persistence is not allowed to close it before the explicit release step.

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/browser/src/index.test.ts tests/runtime-adapter-registry.test.ts`

Expected RED result: the current adapter-local state and silent `needs_user_action` fallback cannot provide registry/runtime identity or the required specific missing-session error.

### Task 2: Share and identify browser runtime state

**Files:**
- Modify: `packages/adapters/core/src/browser.ts`
- Modify: `packages/adapters/browser/src/index.ts`
- Modify: `packages/adapters/core/src/automation.ts`
- Modify: `apps/desktop/src/main/adapter-registry.ts`

**Implementation:**

- Give `PlaywrightSessionManager` one process-memory `debugId`, account-scoped active-session lookup, pending-login markers, and per-session `contextDebugId`/`pageDebugId` generated with `randomUUID()`.
- Make `BrowserSessionManager` reuse the existing account-scoped active Session for the same `{platformKey, accountId}` and clear it only when that Session is closed.
- Have `BrowserAutomationAdapter` use manager state, retaining only a test-double fallback for managers that predate the new methods.
- Throw `BrowserAutomationError("USER_ACTION_REQUIRED", "ACTIVE_LOGIN_SESSION_NOT_FOUND: ...")` from completion when the pending account has no live Page; do not open a replacement Context or inspect stored credentials in this path.
- Add optional XHS-only connection diagnostics callback fields containing platform/account IDs, adapter and manager debug IDs, active-session found, context/page counts, Page URL/title/closed state, and timestamp.
- Build one `BrowserSessionManager` in `createRuntimeAdapterRegistry` and pass it to registered browser adapters; registry lookup must return the same long-lived XHS adapter.

Run the Task 1 focused test command and expect GREEN.

### Task 3: Preserve same-page XHS identity and persistence ordering

**Files:**
- Modify: `packages/adapters/xiaohongshu/src/browser.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `packages/adapters/xiaohongshu/src/browser.test.ts`

**Implementation:**

- At `completeConnection` start, inspect the exact pending active Page and perform XHS contextual login evidence detection.
- Keep the XHS active visible Page open after login detection; `getAccountProfile` must prefer that active Page even before a stored Session exists.
- Read identity from that same Page, persist encrypted storageState only after identity readback, synchronize the explicit account row, then call `releaseConnectionSession`.
- Log begin/complete diagnostics through the main logger with safe fields only; successful completion must include only account/platform/action identity plus sanitized session evidence.
- Keep login-page, visible security modal, missing active Page, and stored-session restore outcomes distinct.

Run: `pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/browser/src/index.test.ts tests/runtime-adapter-registry.test.ts`

### Task 4: Verify source and installed-app boundary

**Files:**
- Modify: `docs/superpowers/plans/2026-08-27-xiaohongshu-active-session-binding.md`
- Modify: `output/v142-xiaohongshu-account-connection.json` only if a new sanitized verification artifact is produced.

- Run focused tests, full `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; record fresh exit codes and counts.
- Rebuild the Electron installed-app package, back up the exact existing installed resources, replace only the built executable/resources needed by the deployment, and restart the existing installed app without creating an account.
- Do not use Computer Use or the source runner as a substitute for installed-app memory-state validation. Report the owner-dependent manual click separately if no UI automation is authorized.
- Validate that no publish Job, SubmissionIntent, PublishRecord, or final-submit side effect was created.
