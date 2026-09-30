import { describe, expect, it } from "vitest";
import { buildOfficialApiDraft, prepareOfficialApiContent } from "./mapping";

const source = { articleId: "article-one", brandId: "brand-one", title: "系统验收说明", summary: "验证真实的官网内容映射。",
  body: "第一段原文。\n\n## 二级标题\n\n- 条目一\n- 条目二\n\n> 引用原文", tags: ["验收"], seoKeywords: ["官网"], articleType: "治理常识", city: "南京" };
const scope = { accountId: "account-one", siteId: "kangyi", environment: "staging" as const, keyId: "fixture-key" };
const facts = ["cover", "body", "gallery"].map((assetId, index) => ({ assetId, brandId: "brand-one", filePath: `D:/fixture/${assetId}.png`,
  sha256: String(index + 1).repeat(64), mimeType: "image/png" as const, bytes: 100, width: 10, height: 10, alt: assetId }));
const uploaded = Object.fromEntries(facts.map((image, index) => [image.assetId, { mediaId: `10000000-0000-4000-a000-00000000000${index + 1}`,
  sha256: image.sha256, mime: image.mimeType, width: 10, height: 10, bytes: 100 }]));

describe("OfficialAPI controlled content mapping", () => {
  it("accepts explicit summary/category/keywords for a simple imported article without rewriting its body", () => {
    const imported = { ...source, summary: "", articleType: "", tags: [], seoKeywords: [] };
    expect(() => prepareOfficialApiContent({ source: imported, scope, images: [], settings: { version: 1, kind: "article" } })).toThrow("SUMMARY_INVALID");
    const prepared = prepareOfficialApiContent({ source: imported, scope, images: [], settings: { version: 1, kind: "article",
      summary: "Owner 填写的明确摘要", category: "系统验收", keywords: ["系统验收"] } });
    expect(prepared.draftPreview.summary).toBe("Owner 填写的明确摘要");
    expect(prepared.source.body).toBe(imported.body);
    expect(prepared.source.summary).toBe("");
  });
  it("keeps text order and distinct cover/body bindings without adding ARTICLE gallery", () => {
    const prepared = prepareOfficialApiContent({ source, scope, images: facts.slice(0, 2),
      settings: { version: 1, kind: "article", coverAssetId: "cover", bodyImageAssetIds: ["body"], galleryAssetIds: [] } });
    const draft = buildOfficialApiDraft(prepared, uploaded);
    expect(draft.kind).toBe("article"); expect(draft.title).toBe(source.title);
    expect(draft.blocks.slice(0, 4)).toEqual([{ type: "paragraph", text: "第一段原文。" }, { type: "heading", level: 2, text: "二级标题" },
      { type: "list", items: ["条目一", "条目二"], ordered: false }, { type: "quote", text: "引用原文" }]);
    expect(draft.coverMediaId).toBe(uploaded.cover!.mediaId);
    expect(draft.blocks.at(-1)).toEqual({ type: "image", mediaId: uploaded.body!.mediaId, alt: "body" });
    expect(draft).not.toHaveProperty("galleryMediaIds");
    expect(Object.isFrozen(prepared.source)).toBe(true);
  });

  it("maps real CASE metadata and deduplicates upload identity reused across roles", () => {
    const prepared = prepareOfficialApiContent({ source, scope, images: facts, settings: { version: 1, kind: "case",
      coverAssetId: "cover", bodyImageAssetIds: ["body"], galleryAssetIds: ["body", "gallery"], location: "南京 · 系统测试", serviceFocus: ["验收模拟"] } });
    const draft = buildOfficialApiDraft(prepared, uploaded);
    expect(draft).toMatchObject({ kind: "case", location: "南京 · 系统测试", serviceFocus: ["验收模拟"],
      listSummary: source.summary, galleryMediaIds: [uploaded.body!.mediaId, uploaded.gallery!.mediaId] });
    expect(prepared.images.map(image => image.assetId)).toEqual(["cover", "body", "gallery"]);
    expect(draft.detailIntro).toContain("第一段原文");
  });

  it.each([
    { images: [{ ...facts[0]!, brandId: "other" }], settings: { version: 1, kind: "article", coverAssetId: "cover" } },
    { images: facts, settings: { version: 1, kind: "article", galleryAssetIds: ["gallery"] } },
    { images: [], settings: { version: 1, kind: "case", location: "", galleryAssetIds: [] } },
    { images: [], settings: { version: 1, kind: "article", slug: "../wrong" } },
    { images: [{ ...facts[0]!, mimeType: "image/gif" }], settings: { version: 1, kind: "article", coverAssetId: "cover" } }
  ])("rejects invalid owner settings/media before remote work: %j", changed => {
    expect(() => prepareOfficialApiContent({ source, scope, ...changed })).toThrow();
  });

  it("rejects remote media whose server hash does not match the frozen local bytes", () => {
    const prepared = prepareOfficialApiContent({ source, scope, images: facts.slice(0, 1), settings: { version: 1, kind: "article", coverAssetId: "cover" } });
    expect(() => buildOfficialApiDraft(prepared, { ...uploaded, cover: { ...uploaded.cover!, sha256: "f".repeat(64) } })).toThrow("MEDIA_BINDING");
  });

  it("keeps stable slug/binding and refuses HTML or over-limit text instead of silently truncating", () => {
    const input = { source, scope, images: [], settings: { version: 1, kind: "article" } };
    expect(prepareOfficialApiContent(input).contentBindingId).toBe(prepareOfficialApiContent(input).contentBindingId);
    expect(() => prepareOfficialApiContent({ ...input, source: { ...source, body: "<script>unsafe</script>" } })).toThrow("HTML");
    expect(() => prepareOfficialApiContent({ ...input, source: { ...source, summary: "长".repeat(501) } })).toThrow();
  });
});
