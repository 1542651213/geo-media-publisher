import type { GeneratedQualityInput } from "./quality-types";

export interface QualityGateOptions {
  minWords: number;
  maxWords: number;
  forbiddenClaims: string[];
  similarityTexts?: string[];
  similarityThreshold?: number;
}

export interface QualityGateResult {
  status: "passed" | "warning" | "failed";
  errors: string[];
  warnings: string[];
}

function normalizedWords(value: string): number {
  return value.replace(/\s+/gu, "").length;
}

export function checkGeneratedArticleQuality(input: GeneratedQualityInput, options: QualityGateOptions): QualityGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) errors.push("标题不能为空");
  if (!body) errors.push("正文不能为空");
  const wordCount = normalizedWords(body);
  if (body && wordCount < options.minWords) errors.push(`正文少于最小字数 ${options.minWords}`);
  if (body && wordCount > options.maxWords) errors.push(`正文超过最大字数 ${options.maxWords}`);
  for (const claim of options.forbiddenClaims.map((item) => item.trim()).filter(Boolean)) {
    if (title.includes(claim) || body.includes(claim)) warnings.push(`检测到禁止编造项：${claim}`);
  }
  if (options.similarityTexts?.some((text) => simpleSimilarity(body, text) >= (options.similarityThreshold ?? 0.72))) {
    warnings.push("与已有内容相似度较高，请人工复核");
  }
  return { status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed", errors, warnings };
}

function simpleSimilarity(left: string, right: string): number {
  const a = new Set(left.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const b = new Set(right.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / (a.size + b.size - intersection);
}

export function validatePlatformArticle(input: { title: string; body: string; coverPath?: string; tags?: string[] }, profile: { titleLimit: number; minBodyLength?: number; maxBodyLength?: number; supportsCover: boolean; coverRequired?: boolean; maxTags?: number; supportsTags: boolean }): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.title.trim()) errors.push("标题不能为空");
  if (profile.titleLimit > 0 && input.title.length > profile.titleLimit) errors.push(`标题不能超过 ${profile.titleLimit} 个字符`);
  if (!input.body.trim()) errors.push("正文不能为空");
  if ((profile.minBodyLength ?? 0) > 0 && input.body.length < (profile.minBodyLength ?? 0)) errors.push(`正文不能少于 ${profile.minBodyLength} 个字符`);
  if ((profile.maxBodyLength ?? 0) > 0 && input.body.length > (profile.maxBodyLength ?? 0)) errors.push(`正文不能超过 ${profile.maxBodyLength} 个字符`);
  if (profile.coverRequired && !input.coverPath) errors.push("该平台要求封面图片");
  if (input.coverPath && !profile.supportsCover) warnings.push("该平台不支持封面，封面将被忽略");
  if ((input.tags?.length ?? 0) > (profile.maxTags ?? 0) && profile.supportsTags) errors.push(`标签不能超过 ${profile.maxTags} 个`);
  if (!profile.supportsTags && (input.tags?.length ?? 0) > 0) warnings.push("该平台不支持标签");
  return { valid: errors.length === 0, errors, warnings };
}
