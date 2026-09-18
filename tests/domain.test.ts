import { describe, expect, it } from "vitest";
import { canReuseArticle, checkGeneratedArticleQuality, decideFailure, expandKeywords, validJobTransition, validatePlatformArticle } from "@publisher/domain";
import type { Article, KeywordTemplate, PublishRecord } from "@publisher/domain";

const templates = (count: number): KeywordTemplate[] => Array.from({ length: count }, (_, index) => ({ id: `template-${index}`, brandId: "brand-1", template: `{城市}服务模板${index}`, category: "测试", enabled: true }));

describe("keyword expansion", () => {
  it("expands 13 cities x 8 templates and de-duplicates exact repeats", () => {
    const result = expandKeywords({ brandId: "brand-1", cities: ["南京", "苏州", "南京"], templates: templates(8) });
    expect(result).toHaveLength(16);
    expect(new Set(result.map((item) => item.keyword)).size).toBe(16);
  });
});

describe("reuse policy and queue states", () => {
  const article = (reusePolicy: Article["reusePolicy"]): Article => ({ id: "article-1", brandId: "brand-1", topic: "topic", keyword: "keyword", city: "南京", title: "title", body: "body", summary: "", tags: [], seoKeywords: [], coverAssetId: null, articleType: "科普", aiProvider: "mock", aiModel: "mock", generatedAt: "2026-01-01", status: "available", reusePolicy, contentHash: "hash", useCount: 0, publishCount: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  const record = (platformKey: string, accountId: string): PublishRecord => ({ id: "record-1", jobId: "job-1", accountId, platformKey, articleId: "article-1", publishedUrl: null, publishedExternalId: null, success: true, response: {}, publishedAt: "2026-01-01" });

  it("applies all five reuse strategies", () => {
    expect(canReuseArticle({ article: article("once"), platformKey: "test", accountId: "a1", records: [] })).toBe(true);
    expect(canReuseArticle({ article: article("once"), platformKey: "test", accountId: "a1", records: [record("other", "a2")] })).toBe(false);
    expect(canReuseArticle({ article: article("same_platform"), platformKey: "test", accountId: "a1", records: [record("other", "a2")] })).toBe(true);
    expect(canReuseArticle({ article: article("same_platform_different_account"), platformKey: "test", accountId: "a1", records: [record("test", "a2")] })).toBe(true);
    expect(canReuseArticle({ article: article("always"), platformKey: "test", accountId: "a1", records: [record("test", "a1")] })).toBe(true);
    expect(canReuseArticle({ article: article("rewrite"), platformKey: "test", accountId: "a1", records: [record("test", "a1")] })).toBe(true);
  });

  it("maps failures to finite retry and manual-action states", () => {
    expect(decideFailure("NETWORK_ERROR", 1, 3, 3).status).toBe("Retry");
    expect(decideFailure("NETWORK_ERROR", 3, 3, 3).status).toBe("Failed");
    expect(decideFailure("LOGIN_EXPIRED", 1, 3, 3)).toMatchObject({ status: "NeedsUserAction", shouldPauseAccount: true });
    expect(decideFailure("USER_ACTION_REQUIRED", 1, 3, 3).status).toBe("NeedsUserAction");
    expect(validJobTransition("Running", "Success")).toBe(true);
    expect(validJobTransition("Success", "Running")).toBe(false);
  });
});

describe("quality gates and platform rules", () => {
  it("marks forbidden claims and similarity as warnings without claiming perfect detection", () => {
    const result = checkGeneratedArticleQuality({ title: "行业第一服务", body: "南京服务内容" }, { minWords: 1, maxWords: 100, forbiddenClaims: ["行业第一"], similarityTexts: ["南京服务内容"] });
    expect(result.status).toBe("warning");
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("行业第一"), expect.stringContaining("相似度") ]));
  });

  it("validates platform title, body, cover and tag limits before adapter work", () => {
    const result = validatePlatformArticle({ title: "太长标题", body: "短", tags: ["a", "b"] }, { titleLimit: 3, minBodyLength: 10, maxBodyLength: 100, supportsCover: true, coverRequired: true, maxTags: 1, supportsTags: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("标题"), expect.stringContaining("正文"), expect.stringContaining("封面"), expect.stringContaining("标签") ]));
  });
});
