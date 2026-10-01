import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { OperationsAssets } from "../apps/desktop/src/main/operations-assets";

it("hashes actual bytes, detects MIME, returns same-company duplicate, and derives usage without Jobs", () => {
  const dir = mkdtempSync(join(tmpdir(), "assets-f-"));
  const { db, repository } = openDatabase(join(dir, "db"), join(process.cwd(), "packages/db/migrations"));
  try {
    const a = repository.createBrand({ name: "甲", companyName: "甲企业" }), b = repository.createBrand({ name: "乙", companyName: "乙企业" });
    const source = join(dir, "中文 (图片).jpg");
    writeFileSync(source, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rZsAAAAASUVORK5CYII=", "base64"));
    const service = new OperationsAssets(repository, join(dir, "images"));
    const first = service.import(a.id, [source], { name: undefined })[0]!;
    expect(first.name).toBe("中文 (图片)");
    expect(first).toMatchObject({ mimeType: "image/png", width: 1, height: 1, duplicate: false, orientation: "square" });
    expect(service.import(a.id, [source])[0]).toMatchObject({ id: first.id, duplicate: true });
    expect(repository.listImageAssets(a.id)).toHaveLength(1);
    expect(readdirSync(join(dir, "images"))).toHaveLength(1);
    const other = service.import(b.id, [source])[0]!;
    expect(other.id).not.toBe(first.id);
    expect(service.list(a.id).map(item => item.id)).toEqual([first.id]);
    writeFileSync(source, "corrupt");
    expect(() => service.import(a.id, [source])).toThrow();
    expect(service.list(a.id)[0]).toMatchObject({ usedByArticleCount: 0, usedByJobCount: 0 });
    const article = repository.createArticle({ brandId: a.id, topic: "素材", keyword: "", city: "", title: "已绑定图片", body: "素材使用记录", summary: "", tags: [], seoKeywords: [], articleType: "article", aiProvider: "manual", aiModel: "manual", generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: "asset-usage-fixture" });
    repository.attachCover(article!.id, first.id);
    expect(service.list(a.id)[0]).toMatchObject({ usedByArticleCount: 1, usedByJobCount: 0, lastUsedPlatform: null });
    expect(repository.listJobs()).toEqual([]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
