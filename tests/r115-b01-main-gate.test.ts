import { describe, expect, it } from "vitest";
import { assertB01OperatorIpcException, assertNoProductE2EDiagnosticSubmit } from "../apps/desktop/src/main/b01-product-e2e-gate";

describe("B01 Main IPC boundary", () => {
  it("permits only exact preparation and separately approved final Job requests", () => {
    const repo = {
      listAccounts: () => [{ id: "account", platformKey: "douyin", platformAccountId: "remote-account" }],
      b01Eligibility: ({ accountId, articleId, imageAssetId }: { accountId: string; articleId: string; imageAssetId: string }) =>
        ({ eligible: accountId === "account" && articleId === "article" && imageAssetId === "image" }),
      assertB01Job: (jobId: string, stage: string) => { if (jobId !== "job" || stage !== "final") throw new Error("B01 blocked"); }
    };
    const prepare = { platformKey: "douyin", articleId: "article", platformAccountId: "remote-account",
      selectedImageAssetId: "image", imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH" };
    expect(assertB01OperatorIpcException("articles:prepare-publish", prepare, repo)).toBe(true);
    expect(assertB01OperatorIpcException("articles:prepare-publish", { ...prepare, articleId: "old" }, repo)).toBe(false);
    expect(assertB01OperatorIpcException("articles:prepare-publish", { ...prepare, platformKey: "weibo" }, repo)).toBe(false);
    expect(assertB01OperatorIpcException("articles:prepare-publish", { ...prepare, finalPublishMode: "AUTO_PUBLISH" }, repo)).toBe(false);
    expect(assertB01OperatorIpcException("jobs:confirm", { id: "job", dryRun: false }, repo)).toBe(true);
    expect(assertB01OperatorIpcException("jobs:run", { id: "job" }, repo)).toBe(true);
    expect(assertB01OperatorIpcException("jobs:retry", { id: "job" }, repo)).toBe(false);
    expect(assertB01OperatorIpcException("jobs:prepare-existing-douyin", { id: "job" }, repo)).toBe(false);
  });

  it("blocks real-submit-capable diagnostic and self-test IPC without affecting read-only inspection", () => {
    for (const channel of ["platform-self-test:run-post-upload-discovery", "platform-self-test:continue",
      "platform-self-test:run-level", "platform-self-test:request-publish", "platform-self-test:confirm-publish"])
      expect(() => assertNoProductE2EDiagnosticSubmit(channel)).toThrow("B01_DIAGNOSTIC_SUBMIT_DISABLED");
    for (const channel of ["platform-self-test:list", "platform-self-test:get", "accounts:inspect-douyin-management"])
      expect(() => assertNoProductE2EDiagnosticSubmit(channel)).not.toThrow();
  });
});
