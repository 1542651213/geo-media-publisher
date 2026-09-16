# Task10S r33 Closed-Shadow Final Submit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare an offline r33 release that can safely resolve and one-shot click the XHS `发布` button inside the closed shadow root of `xhs-publish-btn`, without deploying, consuming Attempt5, uploading, filling content, or clicking the live retained Page.

**Architecture:** Add a pure Task10S host/metadata resolver plus a CDP DOM-tree resolver/clicker in the XHS adapter. Route only the existing internal retained-editor action through it. Preserve r30 global exact diagnostics, fixed title/body readback, current identity/authorization/PublishRecord gates, and the ordinary production final-submit resolver unchanged.

## Task 1 — Red tests for closed-shadow host and CDP contracts

- [x] Extend `packages/adapters/xiaohongshu/src/task10s-final-surface.test.ts` with unique `xhs-publish-btn` host, fixed attributes, disabled/loading, zero/two hosts, and exact inner publish/draft/multiple-button cases.
- [x] Add a focused CDP test fixture for `DOM.getDocument({ depth: -1, pierce: true })`, fresh node resolution after rerender, one press/release pair, and no retry after a post-press failure.
- [x] Run focused tests and verify the new cases fail before implementation.

## Task 2 — Implement Task10S-only closed-shadow resolver and clicker

- [x] Add typed safe contracts and pure host/inner resolution helpers in a new or existing Task10S-scoped adapter module.
- [x] Implement current-page CDP session acquisition, pierced DOM traversal, host attribute validation, exact inner native publish resolution, enabled cross-check, box-model center calculation, and one-shot mouse dispatch.
- [x] Keep node IDs internal and avoid `shadowRoot`, HTML, broad selectors, caller-provided selector/text, or hardcoded coordinates.
- [x] Run focused adapter tests and verify green.

## Task 3 — Integrate with retained-editor final action

- [x] Replace only the marked Task10S retained-editor final surface resolution/click with fresh closed-shadow CDP resolution after fixed title/body readback.
- [x] Preserve the existing pre-upload/upload proof, fixed content contracts, identity revalidation, same Page/Context checks, one-shot guard, confirmation/observation, and production resolver for unmarked paths.
- [x] Add regression tests proving no upload call, no ordinary selector change, draft exclusion, disabled/loading blocking, and no second click.
- [x] Run focused adapter, publisher, and Main action tests.

## Task 4 — Full verification and offline package

- [x] Run focused tests, full tests, typecheck, lint, and build.
- [x] Record `START_HEAD` and `END_HEAD`, then package only to the next unused `D:\GEO\releases\release-task10s-20260907-r33` directory.
- [x] Hash `resources/app.asar`, verify package metadata, and confirm no deploy/restart/live runtime action occurred.
- [x] Preserve the existing dirty `release/` tree and do not stage generated build artifacts.
