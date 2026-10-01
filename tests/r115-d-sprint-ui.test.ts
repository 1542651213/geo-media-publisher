import { describe, expect, it } from "vitest";
import { sprintUiSelection } from "../apps/desktop/src/renderer/sprint-publish-ui";
const grant = { platformKey: "toutiao" as const, accountId: "account", articleId: "article", contentHash: "a".repeat(64),
  expectedRemoteId: "123", imageAssetId: "image", expiresAt: new Date(Date.now() + 60_000).toISOString() };
describe("Sprint normal UI exact selection", () => {
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
