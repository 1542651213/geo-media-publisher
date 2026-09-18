import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@publisher/db";
import type { ExcelArticleRowInput, ExcelImportDiagnostic } from "@publisher/domain";
import {
  buildExcelImportErrorReportCsv,
  buildExcelImportErrorReportRows,
  parseExcelArticleWorkbook,
  readExcelArticleFile
} from "../apps/desktop/src/main/excel-import";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open !== false) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workbookBuffer(sheets: Array<{ name: string; rows: unknown[][] }>): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}

function openFiveBrandFixture(): ReturnType<typeof openDatabase> & { defaultBrandId: string } {
  const dir = mkdtempSync(join(tmpdir(), "publisher-v114-excel-"));
  tempDirs.push(dir);
  const opened = openDatabase(join(dir, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedDevelopment(platformCsv);
  for (let index = 2; index <= 5; index += 1) opened.repository.createBrand({ name: `隔离品牌${index}`, companyName: `隔离企业${index}` });
  const target = opened.repository.listBrands().find((brand) => brand.companyName === "示例企业");
  if (!target) throw new Error("default test brand missing");
  expect(opened.repository.listBrands()).toHaveLength(5);
  return { ...opened, defaultBrandId: target.id };
}

function previewParsed(opened: ReturnType<typeof openFiveBrandFixture>, parsed: ReturnType<typeof readExcelArticleFile>) {
  return opened.repository.previewExcelArticleImport({
    fileName: parsed.fileName,
    rows: parsed.rows,
    warnings: parsed.warnings,
    diagnostics: parsed.diagnostics,
    selectedSheetName: parsed.selectedSheetName,
    sheetCandidates: parsed.sheetCandidates,
    requiresSheetSelection: parsed.requiresSheetSelection,
    defaultBrandId: opened.defaultBrandId
  });
}

describe("V1.1.4 Excel import diagnostics", () => {
  it("detects title/content headers on any sheet name and requires a choice for multiple candidates", () => {
    const single = parseExcelArticleWorkbook(workbookBuffer([
      { name: "Sheet1", rows: [["标题", "内容"], ["标题一", "内容一"], ["标题二", "内容二"]] }
    ]), { fileName: "任意名称.xlsx" });
    expect(single).toMatchObject({ selectedSheetName: "Sheet1", requiresSheetSelection: false });
    expect(single.rows).toHaveLength(2);
    expect(single.rows[0]).toMatchObject({ rowNumber: 2, title: "标题一", body: "内容一", templateVersion: "1.0" });

    const multipleData = workbookBuffer([
      { name: "甲", rows: [["标题", "内容"], ["甲标题", "甲内容"]] },
      { name: "填写说明", rows: [["字段", "说明"], ["标题", "必填"]] },
      { name: "乙", rows: [["标题", "正文"], ["乙标题", "乙正文"]] }
    ]);
    const multiple = parseExcelArticleWorkbook(multipleData, { fileName: "多候选.xlsx" });
    expect(multiple).toMatchObject({ selectedSheetName: null, requiresSheetSelection: true, rows: [] });
    expect(multiple.sheetCandidates.map((candidate) => candidate.sheetName)).toEqual(["甲", "乙"]);
    const selected = parseExcelArticleWorkbook(multipleData, { fileName: "多候选.xlsx", sheetName: "乙" });
    expect(selected).toMatchObject({ selectedSheetName: "乙", requiresSheetSelection: false });
    expect(selected.rows[0]).toMatchObject({ title: "乙标题", body: "乙正文" });
  });

  it("returns workbook/header/unknown-column diagnostics without hiding importable rows", () => {
    const invalid = parseExcelArticleWorkbook(workbookBuffer([{ name: "数据", rows: [["名称", "说明"], ["一", "二"]] }]), { fileName: "错误表头.xlsx" });
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_HEADER", severity: "ERROR", rowNumber: 1 }));

    const unsupported = parseExcelArticleWorkbook(new Uint8Array([0, 1, 2, 3]), { fileName: "损坏.xlsx" });
    expect(unsupported.diagnostics).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_WORKBOOK", severity: "ERROR" }));

    const withUnknown = parseExcelArticleWorkbook(workbookBuffer([
      { name: "数据", rows: [["标题", "内容", "自定义备注"], ["可导入", "正文", "保留在原表"]] }
    ]), { fileName: "未知列.xlsx" });
    expect(withUnknown.rows).toHaveLength(1);
    expect(withUnknown.diagnostics).toContainEqual(expect.objectContaining({ code: "UNKNOWN_COLUMN", severity: "WARNING", rowNumber: 1 }));
  });

  it("returns canonical row reasons, separates duplicate/error/warning totals, and builds an auditable report", () => {
    const opened = openFiveBrandFixture();
    const base = (rowNumber: number, title: string, body: string): ExcelArticleRowInput => ({ rowNumber, templateVersion: "1.0", title, body, summary: "", company: "", business: "", city: "", keywords: "", tags: "", targetPlatforms: "", contentType: "", promotionStrength: "", sourceNote: "" });
    const warning: ExcelImportDiagnostic = { sheetName: "Sheet1", rowNumber: 1, title: "", severity: "WARNING", code: "UNKNOWN_COLUMN", message: "未知字段列：备注" };
    const preview = opened.repository.previewExcelArticleImport({
      fileName: "逐行诊断.xlsx",
      rows: [
        base(2, "", "有内容"),
        base(3, "有标题", ""),
        base(4, "批内重复", "相同正文"),
        base(5, "批内重复", "相同正文"),
        base(6, "超长内容", "字".repeat(200001))
      ],
      diagnostics: [warning],
      defaultBrandId: opened.defaultBrandId,
      selectedSheetName: "Sheet1"
    });
    expect(preview).toMatchObject({ totalRows: 5, validRows: 1, duplicateRows: 1, errorRows: 3, warningRows: 1 });
    expect(preview.rows[0]?.diagnosticCodes).toContain("MISSING_TITLE");
    expect(preview.rows[1]?.diagnosticCodes).toContain("MISSING_CONTENT");
    expect(preview.rows[3]).toMatchObject({ status: "DUPLICATE", duplicateRowNumber: 4 });
    expect(preview.rows[3]?.diagnosticCodes).toContain("DUPLICATE_CONTENT");
    expect(preview.rows[4]?.diagnosticCodes).toContain("CONTENT_TOO_LONG");

    const report = buildExcelImportErrorReportRows(preview);
    expect(report).toEqual(expect.arrayContaining([
      expect.objectContaining({ excelRowNumber: 2, status: "ERROR", errorCode: "MISSING_TITLE", errorDescription: "标题为空" }),
      expect.objectContaining({ excelRowNumber: 5, status: "DUPLICATE", errorCode: "DUPLICATE_CONTENT" }),
      expect.objectContaining({ excelRowNumber: 1, status: "WARNING", errorCode: "UNKNOWN_COLUMN" })
    ]));
    const csv = buildExcelImportErrorReportCsv(preview);
    expect(csv).toContain("Excel行号");
    expect(csv).toContain("MISSING_CONTENT");
    expect(csv).toContain("CONTENT_TOO_LONG");
  });

  const realWorkbookCases = [
    { path: "D:\\Downloads\\示例企业_木渎推广文章100篇.xlsx", expectedSheet: "Sheet1" },
    { path: "D:\\Downloads\\示例环保_木渎推广文章100篇_兼容导入版.xlsx", expectedSheet: "文章导入" }
  ];

  it.skipIf(realWorkbookCases.some((item) => !existsSync(item.path)))("imports both real 100-article workbooks into an isolated Production library without creating jobs", () => {
    for (const workbookCase of realWorkbookCases) {
      const parsed = readExcelArticleFile(workbookCase.path);
      expect(parsed).toMatchObject({ selectedSheetName: workbookCase.expectedSheet, requiresSheetSelection: false });
      expect(parsed.rows).toHaveLength(100);
      expect(parsed.rows.every((row) => Boolean(row.title) && Boolean(row.body))).toBe(true);

      const opened = openFiveBrandFixture();
      const preview = previewParsed(opened, parsed);
      expect(preview).toMatchObject({ totalRows: 100, validRows: 100, duplicateRows: 0, errorRows: 0 });
      const result = opened.repository.confirmExcelArticleImport({ preview });
      expect(result).toMatchObject({ imported: 100, skippedDuplicates: 0, failed: 0 });
      expect(opened.repository.listArticles({ source: "excel_import" })).toHaveLength(100);
      expect(opened.repository.listArticles({ source: "production" })).toHaveLength(100);
      expect(opened.repository.listArticles({ source: "excel_import" }).every((article) => article.source === "excel_import" && article.qualityStatus === "unchecked")).toBe(true);
      expect(opened.repository.listJobs()).toHaveLength(0);
    }
  });
});
