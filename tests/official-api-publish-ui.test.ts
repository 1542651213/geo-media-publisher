import { describe, expect, it } from "vitest";
import type { Article, ImageAsset } from "@publisher/domain";
import type { OfficialApiAccountView, OfficialApiAvailability, OfficialApiContentSettings, OfficialApiJobView } from "../apps/desktop/src/shared/official-api";
import {
  buildWebsitePrepareInput,
  controlledWebsiteAssets,
  defaultOfficialApiSettings,
  preferredWebsiteCandidate,
  refreshWebsiteConnections,
  splitOfficialApiList,
  validateOfficialApiSettings,
  websiteJobActions,
  websiteOperationFeedback,
  websitePublishEligibility
} from "../apps/desktop/src/renderer/official-api-publish-ui";

const availability: OfficialApiAvailability = {
  ordinaryEnabled: false,
  candidateSelections: [
    { accountId: "stage", articleId: "article-1", kind: "article" },
    { accountId: "prod", articleId: "article-1", kind: "article" },
    { accountId: "other", articleId: "article-2", kind: "case" }
  ]
};

const connection = (accountId: string, environment: "staging" | "production" | null = "production", overrides: Partial<OfficialApiAccountView> = {}): OfficialApiAccountView => ({
  accountId,
  connectionMode: "OfficialAPI",
  configured: true,
  status: "CONNECTED",
  siteId: "kangyi",
  environment,
  baseUrl: environment ? `https://${environment}.example.test` : null,
  keyId: "safe-key-id",
  apiVersion: "2",
  writesEnabled: true,
  contentTypes: ["article", "case"],
  lastVerifiedAt: "2026-10-01T00:00:00.000Z",
  ...overrides
});

describe("ordinary Website publish UI model", () => {
  it("refreshes configured connection truth instead of trusting persisted UNVERIFIED metadata", async () => {
    const stale = connection("prod", "production", { status: "UNVERIFIED", writesEnabled: false, apiVersion: null, contentTypes: [] });
    expect(websitePublishEligibility("article-1", "prod", "article", availability, [stale]).eligible).toBe(false);
    const fresh = await refreshWebsiteConnections([stale], async () => connection("prod"));
    expect(websitePublishEligibility("article-1", "prod", "article", availability, fresh).eligible).toBe(true);
    const failed = await refreshWebsiteConnections([stale], async () => { throw new Error("OFFLINE"); });
    expect(websitePublishEligibility("article-1", "prod", "article", availability, failed).eligible).toBe(false);
  });
  it("keeps a candidate disabled when the selected content kind differs from the package grant", () => {
    expect(websitePublishEligibility("article-1", "prod", "case", availability, [connection("prod")]).eligible).toBe(false);
  });
  it("prefers an authorized production candidate while retaining an explicitly authorized staging candidate", () => {
    const connections = [connection("stage", "staging"), connection("prod", "production")];
    expect(preferredWebsiteCandidate("article-1", availability, connections, "article")?.accountId).toBe("prod");
    expect(websitePublishEligibility("article-1", "stage", "article", availability, connections)).toMatchObject({ eligible: true, connection: { environment: "staging" } });
  });

  it("allows any verified writable account after ordinary Website release", () => {
    const released: OfficialApiAvailability = { ordinaryEnabled: true, candidateSelections: [] };
    expect(websitePublishEligibility("any-article", "prod", "article", released, [connection("prod")]).eligible).toBe(true);
  });

  it("keeps the global selector closed for an unbound account and article", () => {
    expect(websitePublishEligibility("article-2", "prod", "article", availability, [connection("prod")]).eligible).toBe(false);
  });

  it.each([
    ["wrong article binding", "prod", "article-2", connection("prod")],
    ["read only", "prod", "article-1", connection("prod", "production", { status: "READ_ONLY", writesEnabled: false })],
    ["unconfigured account", "prod", "article-1", connection("prod", "production", { configured: false })],
    ["unverified environment", "prod", "article-1", connection("prod", null)],
    ["wrong site", "prod", "article-1", connection("prod", "production", { siteId: "other" })],
    ["wrong API", "prod", "article-1", connection("prod", "production", { apiVersion: "1" })],
    ["unsupported kind", "prod", "article-1", connection("prod", "production", { contentTypes: ["article"] })]
  ])("rejects %s before preparePublish", (_label, accountId, articleId, view) => {
    expect(websitePublishEligibility(articleId as string, accountId as string, "case", availability, [view as OfficialApiAccountView]).eligible).toBe(false);
  });

  it("exposes only enabled same-brand assets or explicitly universal assets", () => {
    const article = { id: "article-1", brandId: "brand-a" } as Article;
    const assets = [
      { id: "same", brandId: "brand-a", enabled: true, universal: false },
      { id: "universal", brandId: null, enabled: true, universal: true },
      { id: "unowned-private", brandId: null, enabled: true, universal: false },
      { id: "cross-brand", brandId: "brand-b", enabled: true, universal: true },
      { id: "disabled", brandId: "brand-a", enabled: false, universal: false }
    ] as ImageAsset[];
    expect(controlledWebsiteAssets(article, assets).map(asset => asset.id)).toEqual(["same", "universal", "cross-brand"]);
  });

  it("requires two controlled gallery images and a service focus for CASE", () => {
    const settings: OfficialApiContentSettings = { ...defaultOfficialApiSettings({ tags: [], seoKeywords: [], coverAssetId: null }), kind: "case", galleryAssetIds: ["one"], serviceFocus: [] };
    expect(validateOfficialApiSettings(settings, new Set(["one", "two"]))).toContain("至少 2 张");
    expect(validateOfficialApiSettings({ ...settings, galleryAssetIds: ["one", "two"] }, new Set(["one", "two"]))).toContain("服务重点");
    expect(validateOfficialApiSettings({ ...settings, galleryAssetIds: ["one", "two"], serviceFocus: ["治理"] }, new Set(["one", "two"]))).toBeNull();
  });

  it("forbids ARTICLE galleries and any asset outside the controlled set", () => {
    const settings = { ...defaultOfficialApiSettings({ tags: ["治理"], seoKeywords: [], coverAssetId: null }), galleryAssetIds: ["outside"] };
    expect(validateOfficialApiSettings(settings, new Set(["inside"]))).toContain("行业科普");
    expect(validateOfficialApiSettings({ ...settings, galleryAssetIds: [], bodyImageAssetIds: ["outside"] }, new Set(["inside"]))).toContain("当前文章素材库");
  });

  it("rejects explicit empty keyword lists and more than twenty selected assets", () => {
    const base = defaultOfficialApiSettings({ tags: ["治理"], seoKeywords: [], coverAssetId: null });
    expect(validateOfficialApiSettings({ ...base, keywords: [] }, new Set())).toContain("关键词");
    const ids = Array.from({ length: 21 }, (_, index) => `asset-${index}`);
    expect(validateOfficialApiSettings({ ...base, bodyImageAssetIds: ids }, new Set(ids))).toContain("20");
  });

  it("normalizes comma and newline list fields without duplicate values", () => {
    expect(splitOfficialApiList("治理, 消杀\n治理，检测")).toEqual(["治理", "消杀", "检测"]);
  });

  it("always prepares Website through the standard confirmation boundary", () => {
    const settings = defaultOfficialApiSettings({ tags: ["治理"], seoKeywords: [], coverAssetId: null });
    expect(buildWebsitePrepareInput("article-1", "stage", settings)).toEqual({
      articleId: "article-1",
      platformKey: "website",
      platformAccountId: "stage",
      publishMode: "ASSISTED",
      finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
      selectedImageAssetId: null,
      imageSelectionMode: "none",
      websiteSettings: settings
    });
  });

  it("offers only original-operation recovery while publish or maintenance polling remains pending", () => {
    const base: OfficialApiJobView = { jobId: "job", phase: "NEEDS_RECONCILIATION", contentId: "content", revisionId: null, contentHash: null,
      rowVersion: null, remoteJobId: null, publicUrl: null, kind: "article", siteId: "kangyi", environment: "staging",
      publicContentVerified: null, fidelityWarning: null, errorCode: null, canPurge: false };
    expect(websiteJobActions(base)).toEqual(["recover"]);
    expect(websiteJobActions({ ...base, phase: "PUBLISH_ACCEPTED" })).toEqual(["recover"]);
    expect(websiteJobActions({ ...base, phase: "MAINTENANCE_DELETE" })).toEqual(["recover"]);
    expect(websiteJobActions({ ...base, phase: "PREPARED" })).toEqual([]);
    expect(websiteJobActions({ ...base, phase: "PUBLISHING" })).toEqual([]);
    expect(websiteJobActions({ ...base, contentId: null })).toEqual(["recover"]);
  });

  it("exposes state-valid maintenance only after an original terminal job", () => {
    const base: OfficialApiJobView = { jobId: "job", phase: "PUBLISHED", contentId: "content", revisionId: "revision", contentHash: "hash",
      rowVersion: 2, remoteJobId: "remote", publicUrl: "https://example.test/content", kind: "article", siteId: "kangyi", environment: "staging",
      publicContentVerified: true, fidelityWarning: null, errorCode: null, canPurge: false };
    expect(websiteJobActions(base)).toEqual(["unpublish", "delete"]);
    expect(websiteJobActions({ ...base, remoteJobId: null })).toEqual([]);
    expect(websiteJobActions({ ...base, phase: "UNPUBLISHED" })).toEqual(["delete"]);
    expect(websiteJobActions({ ...base, phase: "DELETED" })).toEqual(["restore"]);
    expect(websiteJobActions({ ...base, phase: "DELETED", canPurge: true })).toEqual(["restore", "purge"]);
    expect(websiteJobActions({ ...base, phase: "RESTORED" })).toEqual(["delete"]);
    expect(websiteJobActions({ ...base, phase: "CLEANED", canPurge: true })).toEqual([]);
  });

  it("distinguishes accepted polling from terminal handler feedback", () => {
    const view = { jobId: "job", phase: "PUBLISH_ACCEPTED", contentId: "content", revisionId: null, contentHash: null,
      rowVersion: null, remoteJobId: "remote", publicUrl: null, kind: "article", siteId: "kangyi", environment: "staging",
      publicContentVerified: null, fidelityWarning: null, errorCode: null, canPurge: false } satisfies OfficialApiJobView;
    expect(websiteOperationFeedback("recover", view)).toBe("官网操作已接收，仍需查询原任务状态。");
    expect(websiteOperationFeedback("recover", { ...view, phase: "PUBLISHED" })).toBe("已按原操作恢复官网任务状态。");
    expect(websiteOperationFeedback("delete", { ...view, phase: "DELETED" })).toBe("官网操作已完成并回读最新状态。");
  });
});
