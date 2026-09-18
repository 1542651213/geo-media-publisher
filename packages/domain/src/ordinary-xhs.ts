export const ORDINARY_XHS_RULES = {
  version: "ordinary-image-pilot-v1", status: "NOT_VERIFIED",
  checkedAt: "2026-09-17", platformKey: "xiaohongshu", contentType: "image-note",
  source: "本地验收范围；公开官方资料未能确认当前编辑器字数规则",
  message: "本次仅单图、可见浏览器、人工确认；本地保守上限标题20/正文1000 UTF-16单位（含空格换行），不是已核验的官方限制。平台规则待核验，页面拒绝即停止。"
} as const;
export function assertOrdinaryXhsInput(input: { title: string; body: string; imageCount: number; coverPath?: string; tags?: string[] }): void {
  if (!input.title.trim() || input.title.length > 20 || !input.body.trim() || input.body.length > 1000) throw new Error("XHS_PILOT_TEXT_LIMIT: " + ORDINARY_XHS_RULES.message);
  if (input.imageCount !== 1 || input.coverPath || input.tags?.length) throw new Error("XHS_PILOT_SINGLE_EXPLICIT_IMAGE_REQUIRED: 不支持多图、视频、独立封面或另行添加话题");
}
