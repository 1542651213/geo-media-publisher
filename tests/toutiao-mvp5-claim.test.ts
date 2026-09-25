import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditMvp5OneShotCapture, claimMvp5OneShotCapture, claimMvp53OwnerRecapture,
  readMvp5LockedClaimEvidence } from "../apps/desktop/src/main/toutiao-article-new-once";

describe("MVP5 durable task claim", () => {
  it("allows only one editor capture across process restarts and stores no secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "mvp5-claim-"));
    try {
      const binding = { accountId: "account", jobId: "job", articleId: "article", contentBindingHash: "a".repeat(64) };
      const path = claimMvp5OneShotCapture(dir, binding);
      expect(readFileSync(path, "utf8")).toContain("TOUTIAO_MVP_5_CAPTURE_REPLAY_ONE_SHOT_REAL_PUBLISH");
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject(binding);
      expect(() => claimMvp5OneShotCapture(dir, binding)).toThrow("TOUTIAO_MVP5_ALREADY_CLAIMED");
      expect(readFileSync(path, "utf8")).not.toMatch(/cookie|token|signature|a_bogus/iu);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("audits a locked capture ticket without changing it or authorizing recapture", () => {
    const dir = mkdtempSync(join(tmpdir(), "mvp5-audit-"));
    try {
      const binding = { accountId: "account", jobId: "job", articleId: "article", contentBindingHash: "a".repeat(64) };
      expect(auditMvp5OneShotCapture(dir, binding, 0)).toMatchObject({ state: "MISSING", publishQuotaConsumed: false });
      const path = claimMvp5OneShotCapture(dir, binding);
      const before = readFileSync(path, "utf8");
      expect(auditMvp5OneShotCapture(dir, binding, 0)).toMatchObject({ state: "LOCKED", publishQuotaConsumed: false });
      expect(auditMvp5OneShotCapture(dir, { ...binding, jobId: "other" }, 0)).toMatchObject({ state: "ID_MISMATCH" });
      expect(auditMvp5OneShotCapture(dir, binding, 1)).toMatchObject({ state: "SUBMIT_CONSUMED", publishQuotaConsumed: true });
      expect(readFileSync(path, "utf8")).toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("appends one successor ticket with old-ticket lineage and one shared publish budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "mvp53-claim-"));
    try {
      const binding = { accountId: "account", jobId: "job", articleId: "article", contentBindingHash: "a".repeat(64) };
      const oldPath = claimMvp5OneShotCapture(dir, binding);
      const oldBytes = readFileSync(oldPath, "utf8");
      const predecessor = readMvp5LockedClaimEvidence(dir, binding);
      expect(predecessor?.ticketId).toMatch(/^[a-f0-9]{64}$/u);
      expect(predecessor?.claimedAt).toBeTruthy();
      const newTicket = claimMvp53OwnerRecapture(dir, binding, { ownerApprovalReference: "main-dialog:approval-1",
        originalPublishAuthorizationReference: "platform-self-test:9f2a30c8-ceb9-4418-88a5-aff03b78d8fa",
        approvedAt: new Date().toISOString(), finalSubmitCount: 0, intentCount: 0, recordCount: 0 });
      const saved = JSON.parse(readFileSync(newTicket.path, "utf8")) as Record<string, unknown>;
      expect(saved).toMatchObject({ ...binding, ownerApprovalReference: "main-dialog:approval-1",
        originalPublishAuthorizationReference: "platform-self-test:9f2a30c8-ceb9-4418-88a5-aff03b78d8fa",
        predecessorTicketId: newTicket.predecessorTicketId, sharedPublishBudgetId: newTicket.sharedPublishBudgetId });
      expect(newTicket.ticketId).not.toBe(newTicket.predecessorTicketId);
      expect(newTicket.predecessorTicketId).toBe(predecessor?.ticketId);
      expect(readFileSync(oldPath, "utf8")).toBe(oldBytes);
      expect(() => claimMvp53OwnerRecapture(dir, binding, { ownerApprovalReference: "main-dialog:approval-2",
        originalPublishAuthorizationReference: "platform-self-test:9f2a30c8-ceb9-4418-88a5-aff03b78d8fa",
        approvedAt: new Date().toISOString(), finalSubmitCount: 0, intentCount: 0, recordCount: 0 }))
        .toThrow("TOUTIAO_MVP53_RECAPTURE_ALREADY_CLAIMED");
      expect(readFileSync(newTicket.path, "utf8")).not.toMatch(/cookie|token|signature|a_bogus/iu);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects consumed budget, unrelated Job and missing old ticket without creating a successor", () => {
    const dir = mkdtempSync(join(tmpdir(), "mvp53-budget-"));
    try {
      const binding = { accountId: "account", jobId: "job", articleId: "article", contentBindingHash: "a".repeat(64) };
      const approval = { ownerApprovalReference: "main-dialog:approval-1", approvedAt: new Date().toISOString(),
        originalPublishAuthorizationReference: "platform-self-test:9f2a30c8-ceb9-4418-88a5-aff03b78d8fa",
        finalSubmitCount: 0, intentCount: 0, recordCount: 0 };
      expect(() => claimMvp53OwnerRecapture(dir, binding, approval)).toThrow("TOUTIAO_MVP53_OLD_TICKET_NOT_LOCKED");
      claimMvp5OneShotCapture(dir, binding);
      expect(() => claimMvp53OwnerRecapture(dir, { ...binding, jobId: "other" }, approval)).toThrow("TOUTIAO_MVP53_OLD_TICKET_NOT_LOCKED");
      expect(() => claimMvp53OwnerRecapture(dir, binding, { ...approval, finalSubmitCount: 1 })).toThrow("TOUTIAO_MVP53_PUBLISH_BUDGET_USED");
      expect(() => claimMvp53OwnerRecapture(dir, binding, { ...approval, intentCount: 1 })).toThrow("TOUTIAO_MVP53_PUBLISH_BUDGET_USED");
      expect(() => claimMvp53OwnerRecapture(dir, binding, { ...approval, ownerApprovalReference: "" })).toThrow("TOUTIAO_MVP53_OWNER_APPROVAL_REQUIRED");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
