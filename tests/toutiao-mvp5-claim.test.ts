import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimMvp5OneShotCapture } from "../apps/desktop/src/main/toutiao-article-new-once";

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
});
