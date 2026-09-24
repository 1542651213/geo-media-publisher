import { describe, expect, it } from "vitest";
import type { Article, BoundImageBytes, ContentSnapshot } from "@publisher/domain";
import { buildKangyiCmsDraft, prepareKangyiWebsiteContent } from "./mapping";

const article = (overrides: Partial<Article> = {}): Article => ({
  id: "article-123",
  brandId: "brand-kangyi",
  topic: "病媒防制",
  keyword: "病媒生物防制",
  city: "江苏",
  title: "康一环保病媒防制服务沟通要点",
  body: "先说明场所类型和主要问题。\n\n再确认现场评估、报价说明和实施安排。\n\n最后确认结果复核和售后沟通。",
  summary: "整理康一环保病媒防制服务沟通前的确认要点。",
  tags: ["病媒防制"],
  seoKeywords: ["病媒生物防制"],
  coverAssetId: null,
  articleType: "科普",
  aiProvider: "fixture",
  aiModel: "fixture",
  generatedAt: "2026-09-20T00:00:00.000Z",
  status: "available",
  reusePolicy: "once",
  contentHash: "article-hash",
  useCount: 0,
  publishCount: 0,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  source: "test",
  ...overrides
});

const snapshot = (overrides: Partial<ContentSnapshot> = {}): ContentSnapshot => ({
  id: "snapshot-123",
  purpose: "PRODUCTION",
  platformKey: "kangyi_website",
  contentType: "article",
  accountId: "account-123",
  creatorId: null,
  subjectEvidence: "DATABASE_ONLY_NOT_RUNTIME_VERIFIED",
  sourceArticleId: "article-123",
  sourceVariantId: null,
  operationId: null,
  rawTitle: "康一环保病媒防制服务沟通要点",
  rawBody: "先说明场所类型和主要问题。\n\n再确认现场评估、报价说明和实施安排。\n\n最后确认结果复核和售后沟通。",
  rawTitleSha256: "title-hash",
  rawBodySha256: "body-hash",
  canonicalTitle: "康一环保病媒防制服务沟通要点",
  canonicalBody: "先说明场所类型和主要问题。\n\n再确认现场评估、报价说明和实施安排。\n\n最后确认结果复核和售后沟通。",
  canonicalTitleSha256: "title-hash",
  canonicalBodySha256: "body-hash",
  normalizationVersion: "line-endings-v1",
  normalizationReasons: [],
  summary: "整理康一环保病媒防制服务沟通前的确认要点。",
  tags: ["病媒防制"],
  images: [],
  ...overrides
});

const image = (): { binding: NonNullable<Parameters<typeof prepareKangyiWebsiteContent>[0]["imageFacts"]>[number]; bytes: BoundImageBytes } => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  return {
    binding: { assetId: "asset-123", brandId: "brand-kangyi", sha256: "image-hash", mimeType: "image/png", bytes: bytes.byteLength, alt: "康一环保 staging 验收图片" },
    bytes: { assetId: "asset-123", name: "fixture", mimeType: "image/png", sha256: "image-hash", buffer: bytes }
  };
};

describe("Kangyi Website mapping and prepare", () => {
  it("maps an article to a stable prepared payload without inventing media IDs", () => {
    const prepared = prepareKangyiWebsiteContent({ article: article(), snapshot: snapshot(), account: { id: "account-123", siteId: "kangyi", environment: "staging" } });
    expect(prepared.kind).toBe("article");
    expect(prepared.slug).toBe(prepareKangyiWebsiteContent({ article: article(), snapshot: snapshot(), account: { id: "account-123", siteId: "kangyi", environment: "staging" } }).slug);
    expect(prepared.draftPreview).toMatchObject({ summary: "整理康一环保病媒防制服务沟通前的确认要点。", category: "科普", seoTitle: article().title, seoDescription: article().summary, showOnHomepage: false });
    expect(prepared.draftPreview.blocks.every((block) => block.type !== "image")).toBe(true);
    expect(prepared.imageBindings).toEqual([]);
  });

  it("freezes the prepared mapping against later mutation of the source Article", () => {
    const source = article();
    const prepared = prepareKangyiWebsiteContent({ article: source, snapshot: snapshot(), account: { id: "account-123", siteId: "kangyi", environment: "staging" } });
    source.title = "later mutable title";
    source.body = "later mutable body";
    source.summary = "later mutable summary";
    source.tags.push("later tag");
    expect(prepared.draftPreview.title).toBe("康一环保病媒防制服务沟通要点");
    expect(prepared.draftPreview.summary).toBe("整理康一环保病媒防制服务沟通前的确认要点。");
    expect(prepared.draftPreview.keywords).not.toContain("later tag");
    expect(() => { (prepared.draftPreview as { title: string }).title = "attempted mutation"; }).toThrow();
    expect(() => prepared.draftPreview.keywords.push("attempted mutation")).toThrow();
  });

  it("maps case content only with source location and omits unsupported write fields", () => {
    const source = article({ city: "江苏", articleType: "现场案例" });
    const prepared = prepareKangyiWebsiteContent({ article: source, snapshot: snapshot(), kind: "case", account: { id: "account-123", siteId: "kangyi", environment: "staging" } });
    expect(prepared.draftPreview).toMatchObject({ kind: "case", location: "江苏", listSummary: snapshot().summary, detailIntro: snapshot().canonicalBody });
    expect(Object.keys(buildKangyiCmsDraft(prepared))).not.toContain("author");
    expect(Object.keys(buildKangyiCmsDraft(prepared))).not.toContain("company");
  });

  it("supports headings, lists, quotes, and a same-brand image binding", () => {
    const source = article({ body: "## 服务前\n\n- 确认场所\n- 说明问题\n\n> 具体边界以双方确认资料为准" });
    const snap = snapshot({ rawBody: source.body, canonicalBody: source.body, images: [{ assetId: "asset-123", sourcePath: "fixture.png", sha256: "image-hash", name: "fixture", mimeType: "image/png" }] });
    const fixtureImage = image();
    const prepared = prepareKangyiWebsiteContent({ article: source, snapshot: snap, account: { id: "account-123", siteId: "kangyi", environment: "staging" }, imageFacts: [fixtureImage.binding] });
    expect(prepared.draftPreview.blocks.map((block) => block.type)).toEqual(["heading", "list", "quote", "image"]);
    expect(prepared.imageBindings).toHaveLength(1);
    expect(() => buildKangyiCmsDraft(prepared)).toThrow("KANGYI_MEDIA_BINDING_REQUIRED");
    const draft = buildKangyiCmsDraft(prepared, { "asset-123": "11111111-1111-4111-8111-111111111111" });
    expect(draft.coverMediaId).toBe("11111111-1111-4111-8111-111111111111");
    expect(draft.blocks.at(-1)).toMatchObject({ type: "image", mediaId: "11111111-1111-4111-8111-111111111111" });
  });

  it("fails closed for missing publish-required source fields and unsupported HTML", () => {
    expect(() => prepareKangyiWebsiteContent({ article: article({ summary: "", seoKeywords: [], tags: [], keyword: "" }), snapshot: snapshot({ summary: "" }), account: { id: "account-123", siteId: "kangyi", environment: "staging" } })).toThrow("KANGYI_SUMMARY_REQUIRED");
    expect(() => prepareKangyiWebsiteContent({ article: article({ body: "<p>not a supported block</p>" }), snapshot: snapshot({ rawBody: "<p>not a supported block</p>", canonicalBody: "<p>not a supported block</p>" }), account: { id: "account-123", siteId: "kangyi", environment: "staging" } })).toThrow("KANGYI_UNSUPPORTED_HTML");
  });

  it("rejects cross-brand image bindings and case mappings without location", () => {
    const fixtureImage = image();
    expect(() => prepareKangyiWebsiteContent({ article: article(), snapshot: snapshot({ images: [{ assetId: "asset-123", sourcePath: "fixture.png", sha256: "image-hash", name: "fixture", mimeType: "image/png" }] }), account: { id: "account-123", siteId: "kangyi", environment: "staging" }, imageFacts: [{ ...fixtureImage.binding, brandId: "other-brand" }] })).toThrow("KANGYI_CROSS_BRAND_IMAGE");
    expect(() => prepareKangyiWebsiteContent({ article: article({ city: "" }), snapshot: snapshot(), kind: "case", account: { id: "account-123", siteId: "kangyi", environment: "staging" } })).toThrow("KANGYI_CASE_LOCATION_REQUIRED");
  });
});
