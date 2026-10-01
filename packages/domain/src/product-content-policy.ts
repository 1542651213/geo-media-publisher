/** Unknown constraints stay null. Verified limits describe the accepted ordinary product route. */
export interface PlatformContentPolicy {
  platformKey: string;
  maxTitleLength: number | null;
  titleLengthMode: "utf16";
  minBodyLength: number | null;
  maxBodyLength: number | null;
  minImageCount: number | null;
  maxImageCount: number | null;
  supportedContentTypes: readonly string[] | null;
  requiresCover: boolean | null;
  supportsSchedule: boolean | null;
  supportsTags: boolean | null;
  supportsMarkdown: boolean | null;
  supportsRichText: boolean | null;
  supportsVideo: boolean | null;
  evidence: string;
}
export const DOUYIN_IMAGE_TEXT_TITLE_LIMIT = 20;
export function platformContentPolicy(platformKey: string): PlatformContentPolicy {
  const unknown: PlatformContentPolicy = { platformKey, maxTitleLength: null, titleLengthMode: "utf16", minBodyLength: null, maxBodyLength: null, minImageCount: null, maxImageCount: null, supportedContentTypes: null, requiresCover: null, supportsSchedule: null, supportsTags: null, supportsMarkdown: null, supportsRichText: null, supportsVideo: null, evidence: "unknown" };
  if (platformKey === "douyin") return { ...unknown, maxTitleLength: DOUYIN_IMAGE_TEXT_TITLE_LIMIT, minImageCount: 1, maxImageCount: 1, supportedContentTypes: ["article"], supportsSchedule: false, supportsVideo: false, evidence: "R1.15-D accepted image/text ordinary route; Creator counter 20 UTF-16" };
  if (platformKey === "toutiao") return { ...unknown, minImageCount: 1, maxImageCount: 1, supportedContentTypes: ["article"], requiresCover: true, supportsMarkdown: false, supportsRichText: false, supportsVideo: false, evidence: "R1.15-D accepted plain-text single-cover route" };
  if (platformKey === "website") return { ...unknown, supportedContentTypes: ["article", "case"], supportsRichText: true, supportsVideo: false, evidence: "R1.15-C verified OfficialAPI ARTICLE / CASE blocks" };
  return unknown;
}
