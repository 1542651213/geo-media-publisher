import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import { ContentOperations } from "../apps/desktop/src/main/content-operations";

it("imports identical copy independently in two companies and deduplicates only within one company", () => {
  const root = mkdtempSync(join(tmpdir(), "f-company-import-"));
  const { db, repository } = openDatabase(join(root, "fixture.db"), join(process.cwd(), "packages/db/migrations"));
  try {
    repository.seedPlatformCatalog(join(process.cwd(), "PLATFORMS.csv"));
    const a = repository.createBrand({ name: "甲企业", companyName: "甲企业" }), b = repository.createBrand({ name: "乙企业", companyName: "乙企业" });
    const operations = new ContentOperations(repository, { profiles: () => [], history: () => [], generate: async () => [], saveDraft: () => { throw Error("UNUSED"); } });
    const preview = (companyId: string) => operations.previewImport({ companyId, fileName: "copy.csv", mapping: { title: "title", body: "body" }, rows: [{ title: "同一流程资料", body: "两个企业分别管理的通用流程" }] });
    const first = preview(a.id); expect(first.validRows).toBe(1);
    expect(operations.commitImport({ companyId: a.id, previewId: first.previewId }).imported).toBe(1);
    const second = preview(b.id); expect(second.duplicateRows).toBe(0);
    expect(operations.commitImport({ companyId: b.id, previewId: second.previewId }).imported).toBe(1);
    expect(preview(a.id).duplicateRows).toBe(1); expect(preview(b.id).duplicateRows).toBe(1);
    expect(repository.listArticles({ brandId: a.id })).toHaveLength(1); expect(repository.listArticles({ brandId: b.id })).toHaveLength(1);
    expect(repository.listJobs()).toHaveLength(0);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
