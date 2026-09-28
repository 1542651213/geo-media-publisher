# Douyin R1.4 Body Diagnostic Implementation Plan

> **For agentic workers:** Execute inline with test-driven development. Keep the current `C:\d16` application and Creator Page untouched.

**Goal:** Build a default-off, Main-owned, read-only body diagnostic that can distinguish editor node scope, DOM structure and every Unicode difference without changing the publish gate.

**Architecture:** A Douyin-only helper inspects bounded `contenteditable` candidates from an already-owned Page and compares code points in Main memory. The adapter checks same Page/Context, Creator origin and exact Job/session continuity before invoking it. A Main-only, environment-armed hook writes a sanitized artifact when the existing readiness IPC is called; Renderer receives only its normal readiness result.

**Tech Stack:** Electron Main, TypeScript strict, Playwright, SQLite repository, Vitest.

**Spec:** Owner task `DOUYIN_R1_4_BODY_READBACK_DIAGNOSTIC_INSTRUMENTATION` in this Codex conversation.

## Global constraints

- Do not close, navigate, edit or replace the running `C:\d16` app or Page.
- Do not upload, fill, submit, create another candidate, reset the claim or alter Job status.
- Default diagnostic flag is OFF; normal Renderer UI and production publishing remain unchanged.
- No normalization is connected to the formal editor readback gate.

## Review focus

- Multiple or nested contenteditable nodes must remain ambiguous rather than selecting a matching text by coincidence.
- A visible Creator ID mismatch must override otherwise valid continuity evidence.
- A hidden ID may produce only labeled continuity evidence bound to the existing session and login generation.
- Text-node characters and rendered structural separators must be distinguished.
- Emoji, NBSP and zero-width characters must survive code-point comparison.

## Tasks

### 1. Bounded DOM and Unicode diagnostic

- [x] Add failing Playwright fixtures for exact text, terminal BR, empty paragraph, NBSP, zero-width character, nesting, multiple candidates, wrong wrapper, Chinese punctuation and visible extra text.
- [x] Implement candidate-only DOM summaries, text hashes and complete code-point edit classification.
- [x] Run focused tests and commit.

### 2. Owned Page and Main gate

- [x] Add failing tests for wrong account, Context, Page, session hash, login generation, Creator ID and missing file-selection claim.
- [x] Implement adapter continuity/visible-identity validation and a default-off Main-only artifact trigger using the existing readiness path.
- [x] Run focused tests, typecheck, lint and commit.

### 3. Package and handoff

- [x] Run full tests and build without touching `C:\d16`.
- [x] Build and verify the independent package without touching `C:\d16`.
- [x] Update `PROJECT_STATE.md` and Douyin runbook with source-only readiness and deployment conditions.
