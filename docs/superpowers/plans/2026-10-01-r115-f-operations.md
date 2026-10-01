# R1.15-F session and multi-company operations implementation plan

> **For agentic workers:** Use test-driven implementation, parallel independent modules, then one fresh whole-branch review. User has authorized uninterrupted execution and local Release/tag only.

**Goal:** Restore valid account sessions across restart and extend the E product into a company-scoped, draft-only operations workspace.

**Architecture:** Keep Account/Brand/Article/ImageAsset, encrypted BrowserSession and E AIProductCenter as authorities. Add additive operations metadata with exact company checks in Main, reuse existing quality review state, and expose write-free account rehydration through a bounded queue. Draft generation and content plans never enter Publisher or Scheduler.

**Tech stack:** Existing TypeScript, Electron, React, SQLite, Playwright owned browser, SafeStorage.

**Spec:** Owner attachment `GEO_R1_15_F_SESSION_MULTI_COMPANY_OPERATIONS_OWNER_ABSENT_SPRINT.md`, sections 0–58; authoritative received task.

## Constraints

- Trusted base a2ee465cb95974b36af27c7d1be6485917f6ad29, retain E/D/C ancestry.
- Canonical checkout only; dedicated F release branch; no reset, public push or overwrite of previous artifacts.
- Real platform publications and new final submits zero; all batch false; preserve Douyin/Website/Toutiao ordinary.
- Secrets only existing Main encrypted store, never renderer DTO/log/SQLite/Git/diagnostics.
- Migration and operational tests use protected copies or synthetic isolated app data. No normal app-data mutation.
- Unknown/offline identity is not expiry; restart or timestamp is not authentication.

## Review focus

- Two same-platform accounts and two companies must never share sessions, images, selection or AI context.
- Network failure must preserve credentials and prior metadata without promoting authentication.
- Interrupted provider requests must not be automatically reissued or re-save completed drafts.
- Changing reviewed content invalidates approval; old approved content hashes cannot authorize new bytes.
- Company switch and stale async UI responses must not carry selections into another workspace.

## Tasks

1. **Session persistence:** Audit core BrowserSessionManager, adapters and scheduler; add runtime rehydration coordinator with exact binding and bounded/lazy hidden restore. RED→GREEN restart valid/expired/offline/mismatch/API/multi-account/scheduler tests; expose to Main and account health. Keep fresh publish identity preflight.
2. **Operations persistence:** Add versioned migration and focused Main/store module for workspace account bindings, existing quality review, facts, plans, generation queues, duplicate warnings, usage aggregates and draft import. RED→GREEN company isolation, approval/hash invalidation, plan 7/30, fact expiry, queue recovery/pause/resume/cancel/config/backoff/idempotent save and no Job/Intent/Record tests.
3. **Ordinary UI:** Global company selection resets mounted routes/selections; company-scoped articles/images/accounts/stats/AI. Operations center exposes Today, review, generation queue, calendar/list, facts, usage, import preview, publish board and Owner actions. No raw diagnostic/final-submit controls.
4. **Integration:** Bind E provider generation to approved/unexpired facts and draft queue; enforce review/company/image ownership in Main preflight and Job creation. Main image byte SHA dedup with usage/dimensions/suitability; CSV/XLSX preview mapping and row errors. Tests protect existing platform switches/contracts.
5. **Delivery:** Frozen install, full tests, typecheck/lint/build; protected-copy migration/integrity/FK/row parity; native rebuild/NSIS distinct F output; package parity and isolated installed two-start smoke. Fresh review and fixes, redacted secret scan, durable product/READY docs and local commits/tag. Final report contains every requested field and evidence limits.

Tasks 1 and 2 have separate files and may run concurrently. Task 3 uses a typed shared operations API defined by Task 2. Root owns ipc.ts, preload.ts, shared/api.ts, main.ts and existing renderer integration; agents must not edit these shared files. Parent performs all native rebuilds and final tests/package serially.
