import { describe, expect, it } from "vitest";
import { sprintUiSelection, confirmedProductActionAvailable } from "../apps/desktop/src/renderer/sprint-publish-ui";
const grant = { platformKey: "toutiao" as const, accountId: "account", articleId: "article", contentHash: "a".repeat(64),
  expectedRemoteId: "123", imageAssetId: "image", expiresAt: new Date(Date.now() + 60_000).toISOString() };
describe("Sprint normal UI exact selection", () => {
  it("offers one confirmed action only for an ordinary or exact unsubmitted sprint job", () => {
    const article = { id: "article", contentHash: "a".repeat(64) };
    const job = { platformKey: "toutiao", articleId: "article", accountId: "account", selectedImageAssetId: "image", status: "AwaitingConfirmation", finalPublishMode: "CONFIRM_BEFORE_PUBLISH" };
    expect(confirmedProductActionAvailable(false, [grant], job, article)).toBe(true);
    expect(confirmedProductActionAvailable(true, [], job, article)).toBe(true);
    for (const override of [{ status: "NeedsReconciliation" }, { status: "Success" }, { finalPublishMode: "PREPARE_ONLY" }, { selectedImageAssetId: "other" }, { accountId: "other" }])
      expect(confirmedProductActionAvailable(false, [grant], { ...job, ...override }, article)).toBe(false);
    expect(confirmedProductActionAvailable(false, [], job, article)).toBe(false);
    expect(confirmedProductActionAvailable(true, [], { ...job, platformKey: "xiaohongshu" }, article)).toBe(false);
  });
  it("shows only the unexpired exact article/hash/account selection", () => {
    const article = { id: "article", contentHash: "a".repeat(64) };
    expect(sprintUiSelection([grant], "toutiao", article, "account")).toEqual(grant);
    expect(sprintUiSelection([grant], "weibo", article)).toBeNull();
    expect(sprintUiSelection([grant], "toutiao", { ...article, contentHash: "b".repeat(64) })).toBeNull();
    expect(sprintUiSelection([grant], "toutiao", article, "other")).toBeNull();
    expect(sprintUiSelection([{ ...grant, expiresAt: new Date(0).toISOString() }], "toutiao", article)).toBeNull();
    expect(sprintUiSelection([], "toutiao", article)).toBeNull();
  });
});
