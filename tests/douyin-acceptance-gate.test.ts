import { describe, expect, it } from "vitest";
import { assertDouyinAcceptanceChannel, type AcceptanceJobRef } from "../apps/desktop/src/main/douyin-acceptance-gate";

const target = { accountId: "owner", articleId: "fresh-test" };
const job: AcceptanceJobRef = { id: "job", accountId: target.accountId, articleId: target.articleId,
  platformKey: "douyin", contentKind: "article" };
const findJob = (id: string): AcceptanceJobRef | null => id === job.id ? job : null;

describe("Douyin R1 exact-candidate acceptance isolation", () => {
  it("allows only a manual image-post prepare for the target Article and account", () => {
    const base = { articleId: target.articleId, platformKey: "douyin", platformAccountId: target.accountId,
      imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH" };
    expect(() => assertDouyinAcceptanceChannel("articles:prepare-publish", base, target, findJob)).not.toThrow();
    expect(() => assertDouyinAcceptanceChannel("articles:prepare-publish", { ...base, platformKey: "toutiao" }, target, findJob)).toThrow();
    expect(() => assertDouyinAcceptanceChannel("articles:prepare-publish", { ...base, articleId: "old" }, target, findJob)).toThrow();
    expect(() => assertDouyinAcceptanceChannel("articles:prepare-publish", { ...base, finalPublishMode: "AUTO_PUBLISH" }, target, findJob)).toThrow();
    expect(() => assertDouyinAcceptanceChannel("articles:prepare-publish", { ...base, finalPublishMode: undefined }, target, findJob)).toThrow();
  });

  it("allows one exact Job to confirm or run but never routes video, retries or self-tests", () => {
    expect(() => assertDouyinAcceptanceChannel("jobs:confirm", { id: job.id, dryRun: false }, target, findJob)).not.toThrow();
    expect(() => assertDouyinAcceptanceChannel("jobs:run", { id: job.id }, target, findJob)).not.toThrow();
    expect(() => assertDouyinAcceptanceChannel("jobs:confirm", { id: job.id, dryRun: true }, target, findJob)).toThrow();
    expect(() => assertDouyinAcceptanceChannel("jobs:retry", { id: job.id }, target, findJob)).toThrow();
    expect(() => assertDouyinAcceptanceChannel("platform-self-test:confirm-publish", { id: job.id }, target, findJob)).toThrow();
    expect(() => assertDouyinAcceptanceChannel("jobs:run", { id: "old" }, target, findJob)).toThrow();
    expect(() => assertDouyinAcceptanceChannel("jobs:run", { id: job.id }, target,
      () => ({ ...job, contentKind: "video" }))).toThrow();
  });

  it("prepares only the already created image-text Job with matching account and article", () => {
    expect(() => assertDouyinAcceptanceChannel("jobs:prepare-existing-douyin", { id: job.id }, target, findJob)).not.toThrow();
    expect(() => assertDouyinAcceptanceChannel("jobs:prepare-existing-douyin", { id: "old" }, target, findJob)).toThrow(/DOUYIN_ACCEPTANCE_JOB_MISMATCH/u);
    for (const changed of [{ ...job, accountId: "other" }, { ...job, articleId: "other" },
      { ...job, contentKind: "video" }, { ...job, platformKey: "toutiao" }]) {
      expect(() => assertDouyinAcceptanceChannel("jobs:prepare-existing-douyin", { id: job.id }, target,
        () => changed)).toThrow(/DOUYIN_ACCEPTANCE_JOB_MISMATCH/u);
    }
  });
});
