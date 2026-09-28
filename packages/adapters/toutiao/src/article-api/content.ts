export type ToutiaoImageClassification = "PLATFORM_HOSTED" | "REMOTE_EXTERNAL" | "LOCAL_ASSET" | "MISSING" | "UNSUPPORTED";
/** Explicit platform-owned host heuristic; acceptance still needs later platform validation. */
export const TOUTIAO_HOSTED_IMAGE_DOMAINS = ["toutiaoimg.com"] as const;
export interface ToutiaoImageReference {
  readonly source: string | null;
  readonly classification: ToutiaoImageClassification;
  readonly occurrence: number;
  /** Offsets point to the value of src in normalizedHtml, excluding quotes. */
  readonly valueStart: number | null;
  readonly valueEnd: number | null;
}
export interface ToutiaoContentDiagnostic { readonly code: "MISSING_IMAGE_SOURCE" | "UNSUPPORTED_IMAGE_SOURCE"; readonly occurrence: number }
export interface ToutiaoNormalizedContent {
  readonly normalizedHtml: string;
  readonly plainText: string;
  readonly imageReferences: readonly ToutiaoImageReference[];
  readonly diagnostics: readonly ToutiaoContentDiagnostic[];
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#(\d+)|#x([\da-f]+));/giu, (match, decimal: string | undefined, hex: string | undefined) => {
    if (decimal || hex) { const code = Number.parseInt(decimal ?? hex!, decimal ? 10 : 16); return code <= 0x10ffff ? String.fromCodePoint(code) : match; }
    return ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " } as Record<string, string>)[match.toLowerCase()] ?? match;
  });
}

export function classifyToutiaoImageSource(source: string | null, platformHostedDomains: readonly string[]): ToutiaoImageClassification {
  if (source === null || source.trim() === "") return "MISSING";
  const value = source.trim();
  if (value.startsWith("//")) {
    try { return classifyToutiaoImageSource(`https:${value}`, platformHostedDomains); }
    catch { return "UNSUPPORTED"; }
  }
  if (/^(?:asset:\/\/|file:\/\/|\.{1,2}[\\/]|[A-Za-z]:[\\/]|[\\/])/u.test(value)) return "LOCAL_ASSET";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "UNSUPPORTED";
    const hostname = url.hostname.toLowerCase();
    if (platformHostedDomains.some((domain) => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`))) return "PLATFORM_HOSTED";
    return "REMOTE_EXTERNAL";
  } catch { return "UNSUPPORTED"; }
}

function tagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index]!;
    if (quote) { if (char === quote) quote = null; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return index;
  }
  return html.length - 1;
}

function sourceAttribute(html: string, from: number, end: number): { value: string; start: number; end: number } | null {
  let index = from;
  while (index < end) {
    while (index < end && /\s|\//u.test(html[index]!)) index += 1;
    const nameStart = index;
    while (index < end && !/[\s=/>]/u.test(html[index]!)) index += 1;
    const name = html.slice(nameStart, index).toLowerCase();
    if (!name) { index += 1; continue; }
    while (index < end && /\s/u.test(html[index]!)) index += 1;
    if (html[index] !== "=") { if (name === "src") return { value: "", start: index, end: index }; continue; }
    index += 1;
    while (index < end && /\s/u.test(html[index]!)) index += 1;
    const quote = html[index] === '"' || html[index] === "'" ? html[index++] : null;
    const valueStart = index;
    if (quote) while (index < end && html[index] !== quote) index += 1;
    else while (index < end && !/[\s>]/u.test(html[index]!)) index += 1;
    const valueEnd = index;
    if (quote && index < end) index += 1;
    if (name === "src") return { value: decodeEntities(html.slice(valueStart, valueEnd)), start: valueStart, end: valueEnd };
  }
  return null;
}

export function normalizeToutiaoArticleContent(htmlInput: string, options: { platformHostedDomains?: readonly string[] } = {}): ToutiaoNormalizedContent {
  const html = htmlInput.replace(/\r\n?/gu, "\n").normalize("NFC");
  const lower = html.toLowerCase();
  const images: ToutiaoImageReference[] = [];
  const diagnostics: ToutiaoContentDiagnostic[] = [];
  const textParts: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) { textParts.push(html.slice(cursor)); break; }
    textParts.push(html.slice(cursor, start));
    if (html.startsWith("<!--", start)) {
      const close = html.indexOf("-->", start + 4);
      cursor = close < 0 ? html.length : close + 3;
      continue;
    }
    const end = tagEnd(html, start + 1);
    const tagName = /^<\s*([a-z][\w:-]*)/iu.exec(html.slice(start, Math.min(end + 1, start + 60)))?.[1]?.toLowerCase();
    if (tagName === "script" || tagName === "style") {
      const closeStart = lower.indexOf(`</${tagName}`, end + 1);
      cursor = closeStart < 0 ? html.length : tagEnd(html, closeStart + 2) + 1;
      continue;
    }
    if (tagName === "img") {
      const nameEnd = start + /^<\s*img/iu.exec(html.slice(start))![0].length;
      const attribute = sourceAttribute(html, nameEnd, end);
      const source = attribute?.value ?? null;
      const classification = classifyToutiaoImageSource(source, options.platformHostedDomains ?? TOUTIAO_HOSTED_IMAGE_DOMAINS);
      const occurrence = images.length;
      images.push({ source, classification, occurrence, valueStart: attribute?.start ?? null, valueEnd: attribute?.end ?? null });
      if (classification === "MISSING" || classification === "UNSUPPORTED") diagnostics.push({ code: classification === "MISSING" ? "MISSING_IMAGE_SOURCE" : "UNSUPPORTED_IMAGE_SOURCE", occurrence });
    }
    cursor = end + 1;
  }
  return { normalizedHtml: html, plainText: decodeEntities(textParts.join(" ")).replace(/\s+/gu, " ").trim(), imageReferences: images, diagnostics };
}

export function replaceImageSources(html: string, references: readonly ToutiaoImageReference[], replacements: ReadonlyMap<string, string>): string {
  let result = html;
  for (const reference of [...references].reverse()) {
    if (reference.source === null || reference.valueStart === null || reference.valueEnd === null) continue;
    const replacement = replacements.get(reference.source);
    if (replacement !== undefined) result = result.slice(0, reference.valueStart) + replacement.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;") + result.slice(reference.valueEnd);
  }
  return result;
}
