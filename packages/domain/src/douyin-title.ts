/** Creator image/text editor observed title counter: 20/20. Count conservatively in UTF-16 units. */
export const DOUYIN_IMAGE_TEXT_TITLE_LIMIT = 20;
export function douyinImageTextTitleError(title: string): string | null {
  if (!title.trim()) return "请填写抖音图文标题";
  return title.length > DOUYIN_IMAGE_TEXT_TITLE_LIMIT ? `抖音图文标题最多 20 个字符，当前 ${title.length} 个；请先缩短标题再准备发布。` : null;
}
export function assertDouyinImageTextTitle(title: string): void {
  const reason = douyinImageTextTitleError(title);
  if (reason) throw new Error(reason);
}
/** Acceptance-only marker; ordinary production Articles have no marker requirement. */
export function b01ArticleMarker(title: string, body: string): string | null {
  const markers = title.match(/\bB01-[A-F0-9]{6,8}\b/gu) ?? [];
  if (markers.length !== 1) return null;
  const marker = markers[0]!;
  return body.includes(marker) ? marker : null;
}
