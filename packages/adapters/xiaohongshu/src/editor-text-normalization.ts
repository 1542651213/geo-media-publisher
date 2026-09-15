/**
 * Normalizes editor text using the same representation returned by the
 * Xiaohongshu editor readback path.
 */
export function normalizeXiaohongshuEditorText(value: string): string {
  const stripped = Array.from(value.normalize("NFKC")).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code === 0x0a || code === 0x0d) || (code > 0x1f && code !== 0x7f && code !== 0xad && code !== 0x200b && code !== 0x200c && code !== 0x200d && code !== 0x2060 && code !== 0xfeff);
  }).join("");
  return stripped.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/[ ]+/gu, " ").trim();
}
