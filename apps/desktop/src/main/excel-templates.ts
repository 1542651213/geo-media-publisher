import * as XLSX from "xlsx";
import { EXCEL_ADVANCED_ARTICLE_HEADERS, EXCEL_SIMPLE_ARTICLE_HEADERS } from "@publisher/domain";

export function writeSimpleExcelTemplate(filePath: string): void {
  const book = XLSX.utils.book_new();
  const articleSheet = XLSX.utils.aoa_to_sheet([[...EXCEL_SIMPLE_ARTICLE_HEADERS], ["示例标题", "示例内容（请替换）"]]);
  XLSX.utils.book_append_sheet(book, articleSheet, "文章导入");
  XLSX.writeFile(book, filePath, { bookType: "xlsx", compression: true });
}

export function writeAdvancedExcelTemplate(filePath: string): void {
  const book = XLSX.utils.book_new();
  const articleSheet = XLSX.utils.aoa_to_sheet([[...EXCEL_ADVANCED_ARTICLE_HEADERS], ["示例标题", "示例正文（请替换）", "", "", "", "", "关键词1；关键词2", "标签1；标签2", "zhihu", "科普", "Soft", ""]]);
  const instructionSheet = XLSX.utils.aoa_to_sheet([["字段", "填写说明"], ["标题", "必填，最长 200 字符"], ["正文", "必填，最长 200000 字符"], ["关键词 / 标签", "多个值使用英文或中文分号分隔"], ["目标平台", "只记录发布意图，不会自动创建发布任务"], ["企业", "必须匹配应用中已有品牌；未知企业可在导入预览中选择或跳过"], ["质量与发布", "导入后为 Production + Draft/unchecked，不会自动发布"]]);
  XLSX.utils.book_append_sheet(book, articleSheet, "文章导入");
  XLSX.utils.book_append_sheet(book, instructionSheet, "填写说明");
  XLSX.writeFile(book, filePath, { bookType: "xlsx", compression: true });
}
