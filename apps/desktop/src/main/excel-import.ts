import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as XLSX from "xlsx";
import {
  EXCEL_ARTICLE_HEADERS,
  EXCEL_SIMPLE_ARTICLE_HEADERS,
  EXCEL_TEMPLATE_VERSION,
  type ExcelArticleRowInput,
  type ExcelImportDiagnostic,
  type ExcelImportDiagnosticCode,
  type ExcelImportPreview,
  type ExcelImportSheetCandidate
} from "@publisher/domain";

const sensitiveHeader = /密码|cookie|token|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token/iu;
const knownHeaders = new Set<string>([...EXCEL_ARTICLE_HEADERS, ...EXCEL_SIMPLE_ARTICLE_HEADERS]);

export interface ExcelWorkbookParseOptions {
  fileName?: string;
  sheetName?: string;
}

export interface ExcelWorkbookParseResult {
  fileName: string;
  rows: ExcelArticleRowInput[];
  warnings: string[];
  diagnostics: ExcelImportDiagnostic[];
  selectedSheetName: string | null;
  sheetCandidates: ExcelImportSheetCandidate[];
  requiresSheetSelection: boolean;
}

export interface ExcelImportErrorReportRow {
  excelRowNumber: number | null;
  title: string;
  status: "DUPLICATE" | "ERROR" | "WARNING";
  errorCode: string;
  errorDescription: string;
}

interface ScannedSheet {
  candidate: ExcelImportSheetCandidate;
  matrix: unknown[][];
  headerMap: Map<string, number>;
}

const diagnosticMessage: Record<ExcelImportDiagnosticCode, string> = {
  MISSING_TITLE: "标题为空",
  MISSING_CONTENT: "内容为空",
  DUPLICATE_CONTENT: "与已有文章或本次工作簿中的文章重复",
  INVALID_HEADER: "第一行必须包含“标题”和“内容”或“正文”表头",
  UNSUPPORTED_WORKBOOK: "工作簿无法读取或不包含可读取的工作表",
  UNKNOWN_COLUMN: "存在无法识别的列，该列会被忽略",
  TITLE_TOO_LONG: "标题超过 200 字符",
  CONTENT_TOO_LONG: "内容超过 200000 字符",
  INVALID_TEMPLATE_VERSION: "模板版本不匹配",
  UNKNOWN_BRAND: "企业未匹配到现有品牌",
  INVALID_PLATFORM: "目标平台不在已启用文章平台中",
  INVALID_CONTENT_TYPE: "内容类型不合法",
  INVALID_PROMOTION_STRENGTH: "推广程度不合法"
};

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).replace(/^\uFEFF/u, "").trim();
}

function normalizeHeader(value: unknown): string {
  const header = cellText(value);
  return header === "内容" ? "正文" : header;
}

function makeDiagnostic(input: Omit<ExcelImportDiagnostic, "message"> & { message?: string }): ExcelImportDiagnostic {
  return { ...input, message: input.message ?? diagnosticMessage[input.code] };
}

function unsupported(fileName: string, code: "INVALID_HEADER" | "UNSUPPORTED_WORKBOOK", message?: string): ExcelWorkbookParseResult {
  return {
    fileName,
    rows: [],
    warnings: [],
    diagnostics: [makeDiagnostic({ sheetName: null, rowNumber: code === "INVALID_HEADER" ? 1 : null, title: "", severity: "ERROR", code, message })],
    selectedSheetName: null,
    sheetCandidates: [],
    requiresSheetSelection: false
  };
}

function hasSupportedWorkbookSignature(data: Uint8Array, fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || lower.endsWith(".xlsb")) return data[0] === 0x50 && data[1] === 0x4b;
  if (lower.endsWith(".xls")) return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => data[index] === value);
  return false;
}

function scanSheet(sheetName: string, sheet: XLSX.WorkSheet): ScannedSheet | null {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const headers = (matrix[0] ?? []).map(cellText);
  const headerMap = new Map<string, number>();
  const unknownColumns: string[] = [];
  headers.forEach((header, index) => {
    if (!header) return;
    const normalized = normalizeHeader(header);
    if (!knownHeaders.has(header) && !knownHeaders.has(normalized)) unknownColumns.push(header);
    else if (!headerMap.has(normalized)) headerMap.set(normalized, index);
  });
  if (!headerMap.has("标题") || !headerMap.has("正文")) return null;
  const rowCount = matrix.slice(1).filter((row) => row.some((value) => Boolean(cellText(value)))).length;
  return { candidate: { sheetName, headers, rowCount, unknownColumns }, matrix, headerMap };
}

function parseRows(scanned: ScannedSheet): ExcelArticleRowInput[] {
  const rows: ExcelArticleRowInput[] = [];
  for (let index = 1; index < scanned.matrix.length; index += 1) {
    const values = scanned.matrix[index] ?? [];
    if (values.every((value) => !cellText(value))) continue;
    const read = (header: string): string => cellText(values[scanned.headerMap.get(header) ?? -1]);
    rows.push({
      rowNumber: index + 1,
      templateVersion: read("templateVersion") || EXCEL_TEMPLATE_VERSION,
      title: read("标题"),
      body: read("正文"),
      summary: read("摘要"),
      company: read("企业"),
      business: read("业务"),
      city: read("城市"),
      keywords: read("关键词"),
      tags: read("标签"),
      targetPlatforms: read("目标平台"),
      contentType: read("内容类型"),
      promotionStrength: read("推广程度"),
      sourceNote: read("来源备注")
    });
  }
  return rows;
}

export function parseExcelArticleWorkbook(data: Uint8Array, options: ExcelWorkbookParseOptions = {}): ExcelWorkbookParseResult {
  const fileName = basename(options.fileName ?? "Excel 工作簿.xlsx");
  if (!hasSupportedWorkbookSignature(data, fileName)) return unsupported(fileName, "UNSUPPORTED_WORKBOOK");
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "array", cellFormula: false, cellHTML: false, bookVBA: true });
  } catch (error) {
    const message = error instanceof Error ? `工作簿无法读取：${error.message}` : undefined;
    return unsupported(fileName, "UNSUPPORTED_WORKBOOK", message);
  }
  if (workbook.SheetNames.length === 0) return unsupported(fileName, "UNSUPPORTED_WORKBOOK");

  const scanned = workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const result = scanSheet(sheetName, sheet);
    return result ? [result] : [];
  });
  if (scanned.length === 0) return unsupported(fileName, "INVALID_HEADER");

  const candidates = scanned.map((item) => item.candidate);
  const selected = options.sheetName
    ? scanned.find((item) => item.candidate.sheetName === options.sheetName)
    : scanned.length === 1 ? scanned[0] : undefined;
  if (options.sheetName && !selected) {
    return {
      fileName,
      rows: [],
      warnings: [],
      diagnostics: [makeDiagnostic({ sheetName: options.sheetName, rowNumber: 1, title: "", severity: "ERROR", code: "INVALID_HEADER" })],
      selectedSheetName: null,
      sheetCandidates: candidates,
      requiresSheetSelection: candidates.length > 1
    };
  }
  if (!selected) {
    return { fileName, rows: [], warnings: [], diagnostics: [], selectedSheetName: null, sheetCandidates: candidates, requiresSheetSelection: true };
  }

  const warnings: string[] = [];
  const diagnostics: ExcelImportDiagnostic[] = [];
  for (const column of selected.candidate.unknownColumns) {
    const message = sensitiveHeader.test(column) ? `已忽略敏感字段列：${column}` : `未知字段列：${column}`;
    warnings.push(message);
    diagnostics.push(makeDiagnostic({ sheetName: selected.candidate.sheetName, rowNumber: 1, title: "", severity: "WARNING", code: "UNKNOWN_COLUMN", message }));
  }
  if (workbook.vbaraw) warnings.push("检测到宏数据，已忽略且不会执行宏");
  for (const [address, value] of Object.entries(workbook.Sheets[selected.candidate.sheetName] ?? {})) {
    if (address.startsWith("!")) continue;
    const cell = value as Record<string, unknown>;
    if (typeof cell.f === "string") warnings.push(`单元格 ${address} 含公式，已按静态值处理`);
    if (typeof cell.l === "object" && cell.l !== null) warnings.push(`单元格 ${address} 含外部链接，已忽略链接元数据`);
  }
  return {
    fileName,
    rows: parseRows(selected),
    warnings: [...new Set(warnings)],
    diagnostics,
    selectedSheetName: selected.candidate.sheetName,
    sheetCandidates: candidates,
    requiresSheetSelection: false
  };
}

export function readExcelArticleFile(filePath: string, options: Omit<ExcelWorkbookParseOptions, "fileName"> = {}): ExcelWorkbookParseResult {
  return parseExcelArticleWorkbook(readFileSync(filePath), { ...options, fileName: basename(filePath) });
}

function canonicalCode(code: string): string {
  if (code === "TITLE_REQUIRED") return "MISSING_TITLE";
  if (code === "BODY_REQUIRED") return "MISSING_CONTENT";
  if (code === "BODY_TOO_LONG") return "CONTENT_TOO_LONG";
  return code;
}

export function buildExcelImportErrorReportRows(preview: ExcelImportPreview): ExcelImportErrorReportRow[] {
  const reportRows: ExcelImportErrorReportRow[] = preview.rows
    .filter((row) => row.status !== "VALID")
    .map((row) => {
      const codes = row.diagnosticCodes.length > 0
        ? row.diagnosticCodes
        : [...new Set(row.errorCodes.map(canonicalCode))];
      const fallbackCode = row.status === "DUPLICATE" ? "DUPLICATE_CONTENT" : "UNSUPPORTED_WORKBOOK";
      return {
        excelRowNumber: row.rowNumber,
        title: row.title,
        status: row.status === "DUPLICATE" ? "DUPLICATE" : row.status === "WARNING" ? "WARNING" : "ERROR",
        errorCode: (codes.length > 0 ? codes : [fallbackCode]).join("；"),
        errorDescription: row.errorReason || diagnosticMessage[fallbackCode as ExcelImportDiagnosticCode]
      };
    });
  for (const diagnostic of preview.diagnostics) {
    reportRows.push({
      excelRowNumber: diagnostic.rowNumber,
      title: diagnostic.title,
      status: diagnostic.severity,
      errorCode: diagnostic.code,
      errorDescription: diagnostic.message
    });
  }
  return reportRows;
}

function csvValue(value: unknown): string {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`;
}

export function buildExcelImportErrorReportCsv(preview: ExcelImportPreview): string {
  const lines: unknown[][] = [
    ["Excel行号", "标题", "状态", "错误代码", "错误说明"],
    ...buildExcelImportErrorReportRows(preview).map((row) => [row.excelRowNumber ?? "", row.title, row.status, row.errorCode, row.errorDescription])
  ];
  return `\ufeff${lines.map((line) => line.map(csvValue).join(",")).join("\r\n")}\r\n`;
}
