import { describe, expect, it } from "vitest";
import { assertDouyinR14ReadOnlyChannel } from "../apps/desktop/src/main/douyin-r14-readonly-gate";

const binding = { jobId: "exact-job", accountId: "exact-account", articleId: "exact-article", nativeSubmitEnabled: false };

describe("Douyin R1.14 exact-job read-only runtime gate", () => {
  it("allows only owned account inspection and exact claimed-job reconciliation", () => {
    expect(() => assertDouyinR14ReadOnlyChannel("accounts:inspect-douyin-management-topology",
      { accountId: "exact-account", jobId: "exact-job" }, binding)).not.toThrow();
    expect(() => assertDouyinR14ReadOnlyChannel("jobs:reconcile-browser", { id: "exact-job" }, binding)).not.toThrow();
    expect(() => assertDouyinR14ReadOnlyChannel("accounts:activate-douyin-image-text",
      { accountId: "exact-account" }, binding)).not.toThrow();
  });
  it("blocks all publish, preparation, retry, alternate-job and native-submit routes", () => {
    for (const channel of ["jobs:run", "jobs:confirm", "jobs:prepare-existing-douyin", "jobs:retry",
      "jobs:reconcile-not-submitted", "articles:prepare-publish", "platform-self-test:confirm-publish"])
      expect(() => assertDouyinR14ReadOnlyChannel(channel, { id: "exact-job" }, binding)).toThrow("READONLY_CHANNEL_ONLY");
    expect(() => assertDouyinR14ReadOnlyChannel("jobs:reconcile-browser", { id: "other-job" }, binding))
      .toThrow("READONLY_JOB_MISMATCH");
    expect(() => assertDouyinR14ReadOnlyChannel("accounts:inspect-douyin-management-topology",
      { accountId: "other-account", jobId: "exact-job" }, binding)).toThrow("READONLY_ACCOUNT_MISMATCH");
    expect(() => assertDouyinR14ReadOnlyChannel("jobs:reconcile-browser", { id: "exact-job" },
      { ...binding, nativeSubmitEnabled: true })).toThrow("READONLY_RUNTIME_BINDING_INVALID");
  });
});
