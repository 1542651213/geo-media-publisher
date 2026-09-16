# Xiaohongshu Task10R Publish Flow Exploration Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a bounded Xiaohongshu publish-flow exploration that performs only authorized safe interactions and proves final-submit readiness without ever submitting a publication.

**Architecture:** Keep the existing Task10P POST_UPLOAD_DISCOVERY_ONLY path intact and add a separate typed XHS_PUBLISH_FLOW_EXPLORATION path. Put selectors, DOM classification, canonical ownership revalidation, bounded action execution, and counters in the Xiaohongshu adapter; keep the main process as the operation/IPC boundary and keep the renderer as a confirmation/result surface. Persist only sanitized evidence and readonly DB counts.

**Tech Stack:** TypeScript strict mode, Playwright Core, Vitest, Electron IPC/preload, existing BrowserAutomationAdapter, logger, and SQLite repository.

**Spec:** docs/superpowers/specs/2026-09-01-xiaohongshu-task10r-publish-flow-exploration-design.md

## Global Constraints

- Reuse account 54b390ac-d81e-440a-baeb-d00f9f346cc3, its existing account mutex, canonical BrowserContext, and canonical authenticated Page.
- Never create a new BrowserContext, Page, Job, SubmissionIntent, or PublishRecord for exploration.
- Only SAFE_TEST_FIXTURE may be uploaded; maximum upload attempts are 3 and every attempt is recorded.
- Maximum exploration duration is 15 minutes; navigation restarts 2; intermediate clicks 12; refreshes 1; title mutations 3; body mutations 3.
- Final submit discovery is read-only; no click, Enter, keyboard submit, form submit, or synthetic submit event is allowed, and FINAL_SUBMIT_COUNT must remain 0.
- Intermediate action clicks require a unique high-confidence internal publishing-flow candidate plus same Context/Page, visible, enabled, and hit-test-valid revalidation immediately before click.
- Mandatory settings may be mutated only when a page validation signal proves they block final readiness; optional settings remain unchanged.
- Evidence contains sanitized URLs, bounded DOM metadata, geometry, roles, labels, phase data, action results, and counters, but no cookies, tokens, credentials, private storage, or image contents.
- Preserve unrelated dirty and untracked files. Use selective git add path only; never use git add ., git add -A, git clean, git reset, or git restore.

## File Map

- Create: packages/adapters/xiaohongshu/src/publish-flow-exploration.ts — XHS phase/action policy and candidate selection helpers; it imports generic operation types from adapters-core.
- Create: packages/adapters/xiaohongshu/src/publish-flow-exploration.test.ts — policy, budget, candidate safety, and evidence contract tests.
- Modify: packages/adapters/core/src/automation.ts — typed exploration mode plus platform-neutral input, budget, counter, timeline, and result contracts; it must not import the XHS package.
- Modify: packages/adapters/xiaohongshu/src/image-editor-discovery.ts — configurable readiness windows, richer safe action candidates, validation signals, and final-submit read-only evidence.
- Modify: packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts — transitioning/readiness and topology regression tests.
- Modify: packages/adapters/xiaohongshu/src/browser.ts — canonical adapter-owned exploration loop, safe upload retry boundary, title/body/settings mutations, final-submit non-click proof, and timeline diagnostics.
- Modify: packages/adapters/xiaohongshu/src/browser.test.ts — adapter integration contracts and no-submit/no-preparePublish tests.
- Modify: packages/adapters/xiaohongshu/src/index.ts — export exploration types/helpers.
- Modify: apps/desktop/src/main/platform-self-test.ts — operation allocation, safe fixture resolution, logger boundary, and no-domain-record guarantee.
- Modify: apps/desktop/src/main/ipc.ts — exact exploration-mode payload validation and IPC handler.
- Modify: apps/desktop/src/main/preload.ts — expose the exploration IPC method.
- Modify: apps/desktop/src/shared/api.ts — type the renderer API.
- Modify: apps/desktop/src/shared/controlled-self-test-entry.ts — exploration capability, request, guard, and confirmation/result copy.
- Modify: apps/desktop/src/renderer/V11Workspace.tsx — exploration entry point in the account center.
- Modify: apps/desktop/src/renderer/PlatformSelfTestCenter.tsx — exploration entry point in the self-test center.
- Create: scripts/xiaohongshu-task10r-publish-flow-exploration.mts — readonly JSONL/DB evidence assembler for the required output artifact.
- Create: packages/adapters/xiaohongshu/src/task10r-evidence.helpers.test.ts — sanitized evidence and DB invariants.
- Create: output/xiaohongshu-task10r-publish-flow-exploration.json — generated only after the live operation, never hand-authored as a result.

### Task 1: Add the typed exploration contract and pure safety policy

**Files:**
- Modify: packages/adapters/core/src/automation.ts
- Modify: packages/adapters/xiaohongshu/src/index.ts
- Create: packages/adapters/xiaohongshu/src/publish-flow-exploration.ts
- Test: packages/adapters/xiaohongshu/src/publish-flow-exploration.test.ts

**Interfaces:**
- ControlledSelfTestMode becomes POST_UPLOAD_DISCOVERY_ONLY | XHS_PUBLISH_FLOW_EXPLORATION while existing consumers keep their literal behavior.
- Add the platform-neutral PublishFlowExplorationInput, PublishFlowExplorationBudgets, PublishFlowExplorationCounters, PublishFlowExplorationTimelineEntry, and PublishFlowExplorationResult contracts to adapters-core. The result uses bounded Record<string, unknown> evidence so adapters-core does not import XHS phase types.
- The XHS publish-flow-exploration module imports those core contracts and adds XHS-specific phases, action candidate status, blocker mapping, and selection helpers.
- Add selectSafeIntermediateAction(candidates, state) returning either one candidate with candidateStatus FOUND_UNIQUE or a typed safe blocker; final-submit labels never qualify as intermediate actions.
- Add canSpendBudget(counters, budget, resource) and recordBudgetUse(counters, resource) with immutable return values.
- Add assertExplorationSafety(result) that throws only when finalSubmitCount > 0, a forbidden mutation is recorded, or a budget counter exceeds its ceiling.

- [ ] Step 1: Write failing policy tests. Cover action labels 完成/确认/下一步/继续/编辑图片/裁剪完成/返回编辑, exclusion of 发布/提交/发表, ambiguous candidates, hidden/disabled candidates, budget ceilings, retry count derivation, and the hard finalSubmitCount === 0 invariant.

- [ ] Step 2: Run the focused test file to verify failure.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src/publish-flow-exploration.test.ts
~~~

Expected: FAIL because the new mode, policy functions, and result types do not yet exist.

- [ ] Step 3: Implement the minimal pure policy. Use literal unions and readonly arrays; normalize only bounded semantic text; reject final-submit labels before returning any intermediate candidate. Make counter updates immutable and make budget exhaustion a typed decision rather than an exception from the browser layer.

- [ ] Step 4: Run the focused test file to verify pass.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src/publish-flow-exploration.test.ts
~~~

Expected: PASS with all new policy tests green.

- [ ] Step 5: Commit the contract slice selectively.

Run:
~~~text
git add packages/adapters/core/src/automation.ts packages/adapters/xiaohongshu/src/index.ts packages/adapters/xiaohongshu/src/publish-flow-exploration.ts packages/adapters/xiaohongshu/src/publish-flow-exploration.test.ts
git commit -m "feat: add xiaohongshu exploration safety contract"
~~~

### Task 2: Make image-editor evidence usable for functional exploration

**Files:**
- Modify: packages/adapters/xiaohongshu/src/image-editor-discovery.ts
- Modify: packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts

**Interfaces:**
- Extend ImageEditorInspectionOptions with optional readinessWindowMs and readinessSampleIntervalMs; preserve Task10P defaults when omitted and accept exploration values of 10000 and 80.
- Extend ImageEditorIntermediateActionCandidate with bounded normalizedText, boundingBox, nearestInteractiveAncestorTag, nearestInteractiveAncestorRole, pointerEvents, and hitTestValid fields.
- Extend ImageEditorControlCandidate with boundingBox and hitTestValid so final-submit readiness can be proven without clicking.
- Extend ImageEditorDomSnapshot and normalized snapshots with requiredValidationSignals and forbiddenActionSignalPresent booleans/strings, never raw page text beyond bounded semantic labels.
- Keep inspectPostUploadImageEditor read-only and ensure controls are not discovered as blockers while phase is still IMAGE_POST_TRANSITIONING or an intermediate state.

- [ ] Step 1: Write failing discovery tests. Add fixtures proving a loading/transitioning editor remains observed through the configured 10-second window, stable DOM alone does not return a terminal post-upload editor, intermediate candidates include geometry/ancestor/hit-test evidence, final-submit candidates remain inspectable while disabled, and validation signals identify only mandatory settings.

- [ ] Step 2: Run image-editor tests to verify failure.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts
~~~

Expected: FAIL on the new options and evidence assertions.

- [ ] Step 3: Implement configurable readiness and safe DOM evidence. Update both page-evaluation and locator fallback paths. Compute hit-test validity with document.elementFromPoint against the candidate or its nearest interactive ancestor, retain only geometry/roles/labels, and make semantic normalization deterministic. Do not inspect image pixels or serialize attribute values that may contain secrets.

- [ ] Step 4: Run image-editor and existing XHS tests.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts packages/adapters/xiaohongshu/src/browser.test.ts
~~~

Expected: PASS, including all Task10P readiness regressions.

- [ ] Step 5: Commit the evidence slice selectively.

Run:
~~~text
git add packages/adapters/xiaohongshu/src/image-editor-discovery.ts packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts
git commit -m "feat: enrich xiaohongshu exploration editor evidence"
~~~

### Task 3: Implement the canonical adapter exploration loop

**Files:**
- Modify: packages/adapters/xiaohongshu/src/browser.ts
- Modify: packages/adapters/xiaohongshu/src/browser.test.ts
- Modify: packages/adapters/xiaohongshu/src/publish-flow-exploration.ts

**Interfaces:**
- AutomationAdapter gains optional runPublishFlowExploration(ctx: AccountContext, input: PublishFlowExplorationInput): Promise<PublishFlowExplorationResult>.
- XiaohongshuBrowserAdapter.runPublishFlowExploration runs under the existing account mutex and creates exactly one operation ID.
- The adapter emits XHS_PUBLISH_FLOW_TIMELINE, XHS_PUBLISH_FLOW_ACTION, XHS_PUBLISH_FLOW_COUNTERS, and XHS_PUBLISH_FLOW_COMPLETED diagnostics using sanitized fields.
- uploadImages accepts a diagnostic attempt index and emits one start/completion/failure record per actual setInputFiles attempt; each call revalidates the same canonical page/context.

- [ ] Step 1: Write failing adapter tests. Add canonical fake-session tests for: no active page; page/context ownership mismatch; functional pre-upload readiness after transitioning; one safe upload success; bounded upload retry; intermediate action click with before/after snapshots; title/body readback; mandatory setting mutation only on validation feedback; final-submit discovery with no click; no preparePublish; zero domain-record calls; and budget exhaustion.

- [ ] Step 2: Run the new adapter tests to verify failure.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts -t "publish-flow exploration"
~~~

Expected: FAIL because the exploration method and action loop do not exist.

- [ ] Step 3: Implement operation setup and canonical preflight. Resolve activeCanonicalPage, capture only context/page debug IDs and sanitized URL, check browser connected/page open/runtime auth, and record AUTHENTICATED, CREATOR_HOME, and canonical match timeline entries. Never construct a new page or context. Use existing publish-note navigation proof and allow up to two bounded navigation restarts only when the current canonical page remains owned.

- [ ] Step 4: Implement functional pre-upload readiness and one image-only mutation boundary. Call the configurable readiness inspector for up to 10 seconds with route/content-type/upload-capability checks; do not use DOM stability alone as an exit. Enter IMAGE_UPLOAD_ONLY only after the pre-upload contract passes. Attempt the fixture at most three times, increment uploadMutationCount for every real file-input mutation, derive uploadRetryCount as attempts minus one, and stop retrying on auth/security/ownership or a destructive/unknown state.

- [ ] Step 5: Implement observe/classify/click for internal intermediate controls. After upload, collect semantic inventory, topology, preview, modal, validation, and phase. Use selectSafeIntermediateAction and immediately re-resolve the same candidate on the same page; verify visible/enabled/hit-test/ancestor ownership before clicking. Log index, stateBefore, bounded semantic text, candidate status, click result, stateAfter, and increment the click counter only after a click is actually dispatched. Never include final-submit candidates in this action path.

- [ ] Step 6: Implement title/body mutation and readback. Only after IMAGE_POST_POST_UPLOAD_EDITOR is proven, discover a unique visible enabled title control and body control. Use at most three selector/fill strategies per field, no clipboard, and verify normalized readback. Record attempted/verified, strategy signal, length/hash, and mutation counters without retaining unrelated content. If the phase returns to an intermediate state, resume the observe/classify loop within the click budget instead of misreporting editor readiness.

- [ ] Step 7: Implement mandatory settings and final-submit read-only proof. Read validation feedback and required controls. Change only a setting whose requiredness and blocking feedback are both proven; record each mutation and re-inspect. Discover final-submit candidates including disabled state, uniqueness, visibility, and hit-test. Set READY_FOR_FINAL_SUBMIT only when the final control is unique, visible, enabled, and hit-test-valid after title/body/mandatory-field verification. Do not call click, keyboard APIs, form submission, or synthetic events for this control.

- [ ] Step 8: Implement truthful stop mapping and safety assertion. Map auth/security, canonical loss, unsafe ambiguity, unknown destructive UI, final-submit-required, budget exhaustion, and timeout to explicit blockers. Before returning, run assertExplorationSafety; if any forbidden counter is nonzero, return SAFETY_BOUNDARY_VIOLATION and do not claim readiness.

- [ ] Step 9: Run focused adapter tests to verify pass.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/publish-flow-exploration.test.ts packages/adapters/xiaohongshu/src/image-editor-discovery.test.ts
~~~

Expected: PASS with final-submit click spies at zero and existing Task10P contracts unchanged.

- [ ] Step 10: Commit the adapter slice selectively.

Run:
~~~text
git add packages/adapters/xiaohongshu/src/browser.ts packages/adapters/xiaohongshu/src/browser.test.ts packages/adapters/xiaohongshu/src/publish-flow-exploration.ts
git commit -m "feat: explore xiaohongshu publish flow without submit"
~~~

### Task 4: Expose the exploration operation through main process and renderer

**Files:**
- Modify: apps/desktop/src/main/platform-self-test.ts
- Modify: apps/desktop/src/main/ipc.ts
- Modify: apps/desktop/src/main/preload.ts
- Modify: apps/desktop/src/shared/api.ts
- Modify: apps/desktop/src/shared/controlled-self-test-entry.ts
- Modify: apps/desktop/src/renderer/V11Workspace.tsx
- Modify: apps/desktop/src/renderer/PlatformSelfTestCenter.tsx
- Test: tests/controlled-self-test-entry.test.ts
- Test: tests/xiaohongshu-task10r-exploration-contract.test.ts

**Interfaces:**
- Add platformSelfTest.runPublishFlowExploration(input: { platformAccountId: string; mode: XHS_PUBLISH_FLOW_EXPLORATION }): Promise<PublishFlowExplorationResult> to the shared API.
- Add buildPublishFlowExplorationRequest and supportsPublishFlowExploration in shared entry code.
- Main service method runPublishFlowExploration(platformAccountId: string, mode: XHS_PUBLISH_FLOW_EXPLORATION) resolves only the exact XHS account, uses the existing safe fixture path, passes the test title/body, and logs operation ID/counters without creating a persistent self-test run or publish-domain rows.
- IPC rejects every mode other than the exact exploration literal and rejects missing/disabled/archived/non-XHS accounts.

- [ ] Step 1: Write failing IPC/entry tests. Assert exact mode validation, account identity selection, single-flight guard, confirmation requirement, safe test text, no final-submit action exposure, and no use of generic runSafe/preparePublish.

- [ ] Step 2: Run the focused contract tests to verify failure.

Run:
~~~text
pnpm exec vitest run tests/controlled-self-test-entry.test.ts tests/xiaohongshu-task10r-exploration-contract.test.ts
~~~

Expected: FAIL because the new request/API/IPC path does not exist.

- [ ] Step 3: Implement the main-process service method. Reuse the existing account lookup and fixture materialization, create no repository rows, set triggerSource XHS_PUBLISH_FLOW_EXPLORATION, and pass the canonical account context to the adapter. Use the existing controlledOperations account-scoped single-flight guard.

- [ ] Step 4: Implement preload/shared API/IPC validation. Add the exact method to the typed API and register one handler with a zod literal for XHS_PUBLISH_FLOW_EXPLORATION. Do not broaden the existing Task10P handler or make a generic mode passthrough.

- [ ] Step 5: Implement explicit renderer confirmation and result display. Add a separate exploration action with confirmation text stating that test title/body/settings may be changed, final publish will not be clicked, and no formal draft/publish record is created. Reuse the existing per-account guard and disable navigation/account actions while running. Display the operation status and blocker/counters; do not add any final-submit button or keyboard behavior.

- [ ] Step 6: Run focused and regression tests.

Run:
~~~text
pnpm exec vitest run tests/controlled-self-test-entry.test.ts tests/xiaohongshu-task10r-exploration-contract.test.ts tests/v142-xiaohongshu-gate-only.test.ts tests/xiaohongshu-pre-submit-gate-contract.test.ts packages/adapters/core/src/platform-self-test-entry.test.ts
~~~

Expected: PASS with Task10P and generic self-test behavior unchanged.

- [ ] Step 7: Commit the entry slice selectively.

Run:
~~~text
git add apps/desktop/src/main/platform-self-test.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/preload.ts apps/desktop/src/shared/api.ts apps/desktop/src/shared/controlled-self-test-entry.ts apps/desktop/src/renderer/V11Workspace.tsx apps/desktop/src/renderer/PlatformSelfTestCenter.tsx tests/controlled-self-test-entry.test.ts tests/xiaohongshu-task10r-exploration-contract.test.ts
git commit -m "feat: expose xiaohongshu publish exploration"
~~~

### Task 5: Add sanitized evidence assembly and readonly DB verification

**Files:**
- Create: scripts/xiaohongshu-task10r-publish-flow-exploration.mts
- Create: packages/adapters/xiaohongshu/src/task10r-evidence.helpers.test.ts

**Interfaces:**
- Script arguments are --operation-id uuid, optional --log-path path, optional --db-path path, and --output path; output defaults to output/xiaohongshu-task10r-publish-flow-exploration.json.
- Export pure helpers sanitizeTask10rDiagnostic, collectTask10rTimeline, collectTask10rOperationEvidence, and assertTask10rDbUnchanged for tests.
- The output top level contains task, operation, canonical, timeline, states, actions, selectors, counters, finalSubmit, database, blocker, readyForFinalSubmit, and safety.

- [ ] Step 1: Write failing evidence-helper tests. Feed representative JSONL diagnostics containing URLs, phase snapshots, semantic nodes, action logs, final-submit disabled/enabled states, and forbidden secret-like fields. Assert sanitized output keeps allowed DOM evidence, strips cookies/tokens/credentials/storage/image data, preserves operation correlation, and reports DB counts exactly.

- [ ] Step 2: Run the helper tests to verify failure.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src/task10r-evidence.helpers.test.ts
~~~

Expected: FAIL because the assembler/helpers do not exist.

- [ ] Step 3: Implement readonly log/DB assembly. Parse only records matching the requested operation ID and platform/account, sanitize URL to origin/path, preserve bounded timeline order, derive upload/action/title/body/settings/final-submit counters, and query only publish_jobs, submission_intents, and publish_records counts. Never write to DB or logs from this script.

- [ ] Step 4: Implement safety assertions and output writing. Refuse to write a PASS-ready report if final-submit count is nonzero, DB counts changed, operation correlation is ambiguous, or canonical identity is not stable. Use writeFileSync only for the requested output path after all checks pass; create the output directory if necessary.

- [ ] Step 5: Run helper tests and a parser fixture.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src/task10r-evidence.helpers.test.ts packages/adapters/xiaohongshu/src/task10a-evidence.helpers.test.ts
~~~

Expected: PASS, with no secret-like field retained in serialized output.

- [ ] Step 6: Commit the evidence slice selectively.

Run:
~~~text
git add scripts/xiaohongshu-task10r-publish-flow-exploration.mts packages/adapters/xiaohongshu/src/task10r-evidence.helpers.test.ts
git commit -m "feat: persist sanitized task10r evidence"
~~~

### Task 6: Run repository verification before packaging

**Files:**
- Modify only files required by failing verification; otherwise no new source files.

- [ ] Step 1: Run the XHS-focused suite.

Run:
~~~text
pnpm exec vitest run packages/adapters/xiaohongshu/src tests/controlled-self-test-entry.test.ts tests/xiaohongshu-task10r-exploration-contract.test.ts tests/v142-xiaohongshu-gate-only.test.ts tests/xiaohongshu-pre-submit-gate-contract.test.ts
~~~

Expected: PASS with no final-submit click and no domain-record mutation assertions failing.

- [ ] Step 2: Run full tests.

Run:
~~~text
pnpm test
~~~

Expected: PASS for all existing and new tests.

- [ ] Step 3: Run typecheck and lint.

Run:
~~~text
pnpm typecheck
pnpm lint
~~~

Expected: both commands exit successfully with no new warnings/errors.

- [ ] Step 4: Run build.

Run:
~~~text
pnpm build
~~~

Expected: Electron/Vite build completes and contains the exploration IPC/adapter code.

- [ ] Step 5: Review the diff and status.

Run:
~~~text
git diff --check
git status --short
git diff --stat HEAD
~~~

Expected: only Task10R source/tests/docs changes are present in this worktree; unrelated main-workspace changes remain outside this worktree.

- [ ] Step 6: Do not create a separate verification-only commit. If a verification failure requires a source or test correction, return to the owning Task 1–5 TDD slice, run its focused test again, and include only that named slice's files in its selective commit before repeating Task 6.

### Task 7: Package/deploy with runtime safety and run the one live exploration

**Files:**
- Create: output/xiaohongshu-task10r-publish-flow-exploration.json
- Preserve: all existing output/release artifacts; do not overwrite unrelated release files without first resolving the exact deployment target.

- [ ] Step 1: Record source/deployment baseline. Capture commit SHA, built artifact SHA256, installed resources/app.asar SHA256, current production DB counts, and active process/page ownership evidence. Confirm the installed target corresponds to the built Task10R commit before any UI action.

- [ ] Step 2: Deploy without force-killing the active runtime. Follow the project’s existing packaging/installation flow. If an active app/browser process prevents a safe handoff or requires reboot, write the pre-deployment evidence and stop with an explicit ACTIVE_RUNTIME_DEPLOYMENT_BLOCKED blocker; do not kill processes.

- [ ] Step 3: Start exactly one exploration operation. In the owner-established authenticated session, confirm the dedicated exploration prompt once, click only the exploration entry, and reuse the existing canonical page/context/mutex. Do not click generic self-test, Task10P discovery, preparePublish, final publish, or any unrelated account control.

- [ ] Step 4: Observe and interact within budget. Allow navigation/intermediate action/title/body/mandatory-setting interactions only as classified by the adapter. If login/security/captcha appears, stop for owner action. If final-submit is reached, inspect only and stop; never click it. If a state is unsafe or ambiguous, preserve evidence and stop.

- [ ] Step 5: Assemble the required report immediately after the operation.

Run:
~~~text
pnpm exec tsx scripts/xiaohongshu-task10r-publish-flow-exploration.mts --operation-id EXPLORATION_OPERATION_ID --output output/xiaohongshu-task10r-publish-flow-exploration.json
~~~

Expected: one JSON report containing full timeline, observed states, action logs, selectors/topology/preview/modal evidence, counters, blocker/readiness, and readonly DB before/after.

- [ ] Step 6: Verify the live safety boundary. Check FINAL_SUBMIT_COUNT = 0, uploadAttempts <= 3, intermediateActionClickCount <= 12, title/body/settings limits, no preparePublish diagnostic, no Job/Intent/PublishRecord creation, unchanged DB counts, canonical page survival, and operation correlation. If any check fails, report SAFETY_BOUNDARY_VIOLATION and do not claim readiness.

- [ ] Step 7: Commit only the generated evidence and completed source changes.

Run:
~~~text
git add output/xiaohongshu-task10r-publish-flow-exploration.json
git commit -m "evidence: record task10r xiaohongshu exploration"
~~~

Expected: the evidence file is committed only if it is sanitized, uniquely correlated, and the hard final-submit boundary is intact.

## Completion Report Requirements

Report the exact values for TASK_10R, operation ID, auth/canonical matches, full timeline, pre-upload state, upload attempts/counters, post-upload states, intermediate actions/click count, title/body status and readback, mandatory settings, final-submit visibility/enabled/hit-test, FINAL_SUBMIT_COUNT = 0, Job/Intent/PublishRecord counts/creation flags, blocker, readiness, source changes, focused/full tests, typecheck, lint, build, commit, and deployment hashes. If the result is READY_FOR_FINAL_SUBMIT = YES_REQUIRES_OWNER_AUTHORIZATION, stop immediately and do not take any further publish action.
