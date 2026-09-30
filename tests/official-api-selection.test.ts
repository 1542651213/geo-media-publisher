import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { freezeOfficialApiSelection, type OfficialApiSelectionRepository } from "../apps/desktop/src/main/official-api-selection";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=", "base64");
const source = { id: "article", brandId: "brand", title: "系统测试", body: "原始正文，不自动改写。", summary: "系统验收摘要", tags: ["测试"], seoKeywords: ["验收"], articleType: "系统验收", city: "南京" };
const scope = { accountId: "account", siteId: "kangyi", environment: "staging" as const, keyId: "test-key" };
describe("Main Website frozen selection", () => {
  it("reads actual PNG bytes with a Chinese misleading filename, deduplicates roles and never copies a secret", () => {
    const dir = mkdtempSync(join(tmpdir(), "geo-website-selection-"));
    try {
      const file = join(dir, "中文 图片 (正文).jpg"); writeFileSync(file, png);
      const repository: OfficialApiSelectionRepository = { getArticle: () => source,
        getImageAsset: () => ({ id: "image", brandId: "brand", universal: false, enabled: true, filePath: file, name: "图片", mimeType: "image/jpeg", sha256: null }) };
      const prepared = freezeOfficialApiSelection(repository, "article", scope, { version: 1, kind: "article", coverAssetId: "image", bodyImageAssetIds: ["image"] });
      expect(prepared.images).toHaveLength(1);
      expect(prepared.images[0]).toMatchObject({ mimeType: "image/png", width: 1, height: 1, sha256: createHash("sha256").update(png).digest("hex") });
      expect(prepared.source.body).toBe(source.body);
      expect(prepared.scope).toEqual(scope);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it.each(["disabled", "cross-brand", "unowned-not-universal", "changed-hash", "empty", "unsupported"])("rejects %s before a Job or HTTP dispatch", failure => {
    const dir = mkdtempSync(join(tmpdir(), "geo-website-invalid-"));
    try {
      const file = join(dir, "fixture.png"); writeFileSync(file, failure === "empty" ? Buffer.alloc(0) : failure === "unsupported" ? Buffer.from("<svg></svg>") : png);
      const repository: OfficialApiSelectionRepository = { getArticle: () => source, getImageAsset: () => ({ id: "image", brandId: failure === "cross-brand" ? "other" : failure === "unowned-not-universal" ? null : "brand", universal: false, enabled: failure !== "disabled", filePath: file, name: "图", mimeType: "image/png", sha256: failure === "changed-hash" ? "f".repeat(64) : null }) };
      expect(() => freezeOfficialApiSelection(repository, "article", scope, { version: 1, kind: "article", coverAssetId: "image" })).toThrow("WEBSITE_");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
