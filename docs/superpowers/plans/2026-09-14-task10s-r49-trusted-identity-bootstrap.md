# Trusted XHS Identity Bootstrap Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [x] ) syntax for tracking.

**Goal:** Add a trusted, atomic first-binding path for Xiaohongshu Creator identity during complete-login, while preserving strict later-login verification, r47 account isolation, r46 media binding, and all publish one-shot protections.

**Architecture:** Keep identity observation in the XHS identity service, persist the first binding and account external ID together in the database repository transaction, and call the new service path from the existing XHS complete-login guard before any archived-account recovery. Treat an archived-only Creator owner as an explicit fail-closed conflict.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 transactions, Electron main-process IPC, pnpm native rebuild/package path.

**Spec:** C:\Users\Administrator\.codex\attachments\024942ae-c890-49af-81d9-3e66f23a4a23\pasted-text.txt

## Global Constraints

- Offline implementation only: do not deploy, retry complete-login in the live app, mutate production data, upload, ARM, complete, or publish.
- Do not change ARM, completion, closed-shadow, one-shot state machine, final mouse boundary, or publication transaction code.
- Preserve account/session/context ownership checks and r46 selected-image binding.
- Use only the existing page-scoped identity verifier and observed Creator ID; never trust user input, nickname, avatar, OCR, or query parameters.
- Keep archived-owner policy fail-closed with XHS_CREATOR_ID_BOUND_TO_ARCHIVED_ACCOUNT.
- Verify with RED tests, GREEN focused/regression/full tests, typecheck, lint, build, and pnpm package:dir (ABI 136).

---

## Task 1: Lock current behavior and security cases with RED tests

- [x] Add service tests for the current bootstrap deadlock, trusted first bind, same-account idempotence, changed Creator mismatch, runtime/session/page/stability prerequisites, active-owner conflict, and archived-owner conflict.
- [x] Add repository tests for atomic persistence of account external ID plus identity binding, partial legacy backfills, conflicting partial state, and concurrent first-bind race (at most one success).
- [x] Add IPC wiring tests proving complete-login uses bootstrap and does not touch publish paths.
- [x] Run the focused tests and record the expected RED failures before implementation.

## Task 2: Implement atomic repository bootstrap

- [x] Add a repository method that re-reads the active XHS account and all Creator ownership rows inside one SQLite transaction.
- [x] Support only safe states: truly unbound first bind, same-account idempotence, account-field-only backfill, and binding-only backfill.
- [x] Reject mismatched partial state, another active owner, and any archived owner with explicit fail-closed errors.
- [x] Write accounts.external_account_id and platform_account_identity_bindings together for a first bind, preserve the existing unique constraints, map race conflicts to fail-closed errors, then re-read both rows for post-commit equality.

## Task 3: Add trusted service flow

- [x] Add a service method that consumes the existing canonical/page-scoped observation only after account/session/context/authenticated /new/home, stable-ID, and page consistency gates pass.
- [x] Call the atomic repository method with the observed Creator ID and source metadata, then revalidate the persisted account and binding.
- [x] Preserve later-login exact matching and reject any attempt to overwrite an existing binding.
- [x] Keep existing owner-approved convergence behavior and r47 isolation tests intact.

## Task 4: Wire complete-login minimally

- [x] Replace only the XHS complete-login identity call with the trusted bootstrap service method.
- [x] Execute it before archived-account restoration so archived ownership cannot be silently transferred.
- [x] Leave adapter upload, jobs, authorization, completion, one-shot, and publication code unchanged.

## Task 5: GREEN verification and release

- [x] Run the focused identity/repository/IPC tests and all regression tests.
- [x] Run full tests, typecheck, lint, build, and pnpm package:dir; confirm packaged better-sqlite3 ABI 136.
- [x] Generate D:\GEO\releases\release-task10s-20260914-r49 and record hashes, commit, changed files, and required security report.
- [x] Confirm final submit and publication transaction counts remain zero and stop without deployment.


