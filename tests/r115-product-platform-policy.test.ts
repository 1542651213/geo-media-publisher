import { describe, expect, it } from "vitest";
import type { Account, Platform, PublishJob } from "@publisher/domain";
import {
  PRODUCT_PLATFORM_POLICY,
  operatorPlatformCatalog,
  operatorPlatformKeys,
  operatorContentStudioTargets,
  operatorFavoriteKeys,
  operatorPublishBlockReason,
  operatorOverviewJobs,
  operatorAccounts,
  operatorStatisticsRows,
  safeOperatorSelection
} from "../apps/desktop/src/shared/product-platform-policy";
import { assertOperatorPublishIpcRequest } from "../apps/desktop/src/main/operator-publish-gate";
import { loadAccountCenterData } from "../apps/desktop/src/renderer/v11-ui-model";
import type { AccountManagementRow } from "../apps/desktop/src/shared/api";

const platform = (platformKey: string, extra: Partial<Platform> = {}): Platform => ({
  platformKey,
  displayName: platformKey,
  enabled: true,
  capabilities: { article: true },
  ...extra
} as Platform);

describe("R1.15 ordinary platform policy", () => {
  const catalog = [platform("zhihu"), platform("bilibili"), platform("douyin"), platform("netease_media"), platform("baijiahao")];
  it("opens only ordinary Douyin image/text and leaves every batch and other platform gate OFF", () => {
    expect(PRODUCT_PLATFORM_POLICY.filter((item) => item.ordinaryPublishEnabled).map((item) => item.platformKey)).toEqual(["douyin"]);
    expect(PRODUCT_PLATFORM_POLICY.every((item) => !item.batchPublishEnabled)).toBe(true);
    expect(operatorPublishBlockReason("douyin", platform("douyin"))).toBeNull();
    expect(operatorPublishBlockReason("douyin", platform("douyin", { enabled: false }))).toBeTruthy();
  });

  it("presents exactly ten platforms in the required order even when current main lacks Website", () => {
    expect(PRODUCT_PLATFORM_POLICY.map((item) => item.displayName)).toEqual([
      "抖音", "小红书", "官网", "今日头条", "搜狐号", "网易号", "百家号", "微博", "列举网", "博客园"
    ]);
    expect(operatorPlatformCatalog(catalog).map((item) => item.platformKey)).toEqual([
      "douyin", "xiaohongshu", "website", "toutiao", "sohu_media", "netease_media", "baijiahao", "weibo", "lieju", "cnblogs"
    ]);
    expect(operatorPlatformCatalog(catalog)).toHaveLength(10);
    expect(operatorPlatformCatalog(catalog).some((item) => ["zhihu", "bilibili"].includes(item.platformKey))).toBe(false);
  });

  it("keeps old favorites and accounts stored while hiding them from ordinary views", () => {
    const accounts = [{ id: "old", platformKey: "zhihu" }, { id: "current", platformKey: "douyin" }] as Account[];
    const before = structuredClone(accounts);
    expect(operatorAccounts(accounts).map((item) => item.id)).toEqual(["current"]);
    expect(accounts).toEqual(before);
    expect(operatorFavoriteKeys(["zhihu", "bilibili", "douyin"])).toEqual(["douyin"]);
    expect(safeOperatorSelection("zhihu", operatorPlatformCatalog(catalog))).toBeNull();
    expect(safeOperatorSelection("douyin", operatorPlatformCatalog(catalog))).toBe("douyin");
  });

  it("loads a ten-platform account center without leaking old favorites or hidden accounts", async () => {
    const rows = [
      { account: { id: "old", platformKey: "zhihu" } },
      { account: { id: "current", platformKey: "douyin" } }
    ] as AccountManagementRow[];
    const loaded = await loadAccountCenterData({
      overview: async () => rows,
      platforms: async () => catalog,
      settings: async () => ({ favoritePlatformKeys: "zhihu,douyin,bilibili" })
    });
    expect(loaded.platforms.map((item) => item.platformKey)).toEqual(operatorPlatformKeys());
    expect(loaded.overview.map((row) => row.account.id)).toEqual(["current"]);
    expect(loaded.favoritePlatformKeys).toEqual(["douyin"]);
    expect(rows.map((row) => row.account.id)).toEqual(["old", "current"]);
  });

  it("shows staged platforms without granting ordinary publish capability", () => {
    const views = operatorPlatformCatalog(catalog);
    expect(operatorPublishBlockReason("website", views.find((item) => item.platformKey === "website"))).toContain("尚未验收");
    expect(operatorPublishBlockReason("netease_media", views.find((item) => item.platformKey === "netease_media"))).toContain("待开发");
    expect(operatorPublishBlockReason("baijiahao", views.find((item) => item.platformKey === "baijiahao"))).toContain("编辑器");
    expect(operatorPublishBlockReason("zhihu", platform("zhihu"))).toContain("普通运营");
    expect(operatorPlatformKeys()).toHaveLength(10);
  });

  it("offers only supported ordinary article-generation targets and no legacy Zhihu default", () => {
    expect(operatorContentStudioTargets.map((item) => item.key)).toEqual(["toutiao", "weibo"]);
  });

  it("counts only ordinary platform jobs while retaining hidden history for audit", () => {
    const jobs = [
      { id: "historical", platformKey: "zhihu", status: "NeedsReconciliation" },
      { id: "current", platformKey: "douyin", status: "Published" }
    ] as PublishJob[];
    expect(operatorOverviewJobs(jobs).map((job) => job.id)).toEqual(["current"]);
    expect(operatorStatisticsRows(jobs).map((row) => row.platformKey)).toEqual(operatorPlatformKeys());
    expect(operatorStatisticsRows(jobs).find((row) => row.platformKey === "douyin")?.publishedCount).toBe(1);
    expect(jobs.map((job) => job.id)).toEqual(["historical", "current"]);
  });

  it("rejects forged IPC prepare and execution requests before task creation or submit", () => {
    const resolvePlatform = (key: string): Platform | undefined => operatorPlatformCatalog(catalog).find((item) => item.platformKey === key);
    expect(() => assertOperatorPublishIpcRequest("articles:prepare-publish", { platformKey: "zhihu" }, resolvePlatform, () => null)).toThrow();
    expect(() => assertOperatorPublishIpcRequest("articles:prepare-publish", { platformKey: "netease_media" }, resolvePlatform, () => null)).toThrow();
    expect(() => assertOperatorPublishIpcRequest("articles:prepare-publish", { platformKey: "douyin" }, resolvePlatform, () => null)).not.toThrow();
    expect(() => assertOperatorPublishIpcRequest("articles:prepare-publish", { platformKey: "douyin" }, () => ({ ...platform("douyin"), capabilities: { ...platform("douyin").capabilities, article: false } }), () => null)).toThrow();
    expect(() => assertOperatorPublishIpcRequest("jobs:run", { id: "old-job" }, resolvePlatform, () => ({ platformKey: "zhihu" }))).toThrow();
    expect(() => assertOperatorPublishIpcRequest("jobs:reconcile", { id: "old-job" }, resolvePlatform, () => ({ platformKey: "zhihu" }))).not.toThrow();
  });
});
