# Toutiao MVP-5.2 Capture Binding Implementation Plan

> **For agentic workers:** Execute each step in the isolated Toutiao worktree. The existing capture ticket is immutable; no real capture or publish is permitted in this task.

**Goal:** Explain and repair the pre-submit binding contract, expose safe reason codes, and verify readiness with read-only runtime evidence.

**Architecture:** Keep R1-A's durable submit gate. Separate stable account/session identity from mutable request-time cookies while retaining exact binding of the captured Cookie header to the current BrowserContext. Use a pure validator for content and request metadata, and a Main-only read-only preflight for saved Job, Bundle, runtime and ticket state.

**Tech Stack:** TypeScript strict mode, Electron Main IPC, Playwright BrowserSession, SafeStorage, SQLite repository, Vitest.

**Spec:** Owner task `TOUTIAO_MVP_5_2_CAPTURE_BINDING_ROOT_CAUSE_AND_PREFLIGHT` in this conversation.

## Steps

- [ ] Audit the old claim, Job/Intent/Record and existing validation path without reading raw secrets; document what the old evidence can and cannot prove.
- [ ] Add failing tests for distinct request/content/cookie/session/version reason codes and runtime-cookie rotation. Keep no raw values in output.
- [ ] Implement the minimal binding contract and structured reason codes; preserve fail-closed behavior and R1-A ordering.
- [ ] Add a read-only Main preflight that inspects the existing ticket, account-owned BrowserContext, Bundle metadata and frozen content without creating or modifying a ticket.
- [ ] Run focused and full tests, typecheck, lint and build; package the final runtime code commit and verify EXE, app.asar and Main hashes.
- [ ] Run only the packaged read-only preflight on the Owner account, close the app, and record the result in `PROJECT_STATE.md`.
