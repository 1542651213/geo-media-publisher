import { describe, expect, it } from "vitest";
import { XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID } from "@publisher/domain";
import type { Account, Platform } from "@publisher/domain";
import {
  ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_CONFIRMATION,
  ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_MODE,
  buildOneShotRealPublishRequest,
  supportsOneShotRealPublishAcceptance
} from "../apps/desktop/src/shared/controlled-self-test-entry";

const account = (overrides: Partial<Pick<Account, "id" | "platformKey" | "platformAccountId" | "enabled" | "archivedAt">> = {}): Pick<Account, "id" | "platformKey" | "platformAccountId" | "enabled" | "archivedAt"> => ({
  id: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID,
  platformKey: "xiaohongshu",
  platformAccountId: "xhs-platform-account",
  enabled: true,
  archivedAt: null,
  ...overrides
});

const platform = (overrides: Partial<Pick<Platform, "platformKey" | "capabilities">> = {}): Pick<Platform, "platformKey" | "capabilities"> => ({
  platformKey: "xiaohongshu",
  capabilities: { article: true, imagePost: true, video: false, coverImage: false, tags: true, categories: false, scheduledPublish: false, draft: false, markdown: false, richText: true, maxTitleLength: 1000, maxImageCount: 18, controlledSelfTestModes: ["XHS_PUBLISH_FLOW_EXPLORATION"] },
  ...overrides
});

describe("Task10S one-shot entry", () => {
  it("exposes the exact owner confirmation and typed mode", () => {
    expect(ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_MODE).toBe("ONE_SHOT_REAL_PUBLISH_ACCEPTANCE");
    expect(ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_CONFIRMATION).toBe("本次会真实发布 1 条测试笔记，最多提交一次。");
  });

  it("allows only the bound XHS account", () => {
    expect(supportsOneShotRealPublishAcceptance(platform(), account())).toBe(true);
    expect(supportsOneShotRealPublishAcceptance(platform({ platformKey: "weibo" }), account())).toBe(false);
    expect(supportsOneShotRealPublishAcceptance(platform(), account({ id: "another-account" }))).toBe(false);
    expect(supportsOneShotRealPublishAcceptance(platform(), account({ enabled: false }))).toBe(false);
  });

  it("requires connection, owner confirmation and a free entry", () => {
    const input = { account: account(), platform: platform(), connected: true, busy: false, confirmed: true };
    expect(buildOneShotRealPublishRequest(input)).toEqual({ platformAccountId: "xhs-platform-account", mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE_MODE });
    expect(buildOneShotRealPublishRequest({ ...input, connected: false })).toBeNull();
    expect(buildOneShotRealPublishRequest({ ...input, busy: true })).toBeNull();
    expect(buildOneShotRealPublishRequest({ ...input, confirmed: false })).toBeNull();
  });
});
