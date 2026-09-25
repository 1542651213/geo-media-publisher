import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditMvp5OneShotCapture, claimMvp5OneShotCapture } from "../apps/desktop/src/main/toutiao-article-new-once";

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
});
