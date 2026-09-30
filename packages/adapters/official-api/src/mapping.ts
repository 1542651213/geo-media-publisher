import { createHash } from "node:crypto";
import { z } from "zod";
import type { CmsDraft, Media } from "../../../cms-v2-client/src/contracts";

export const officialApiContentSettingsSchema = z.strictObject({
  version: z.literal(1), kind: z.enum(["article", "case"]),
  summary: z.string().trim().min(1).max(500).optional(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(191).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  seoTitle: z.string().trim().min(1).max(200).optional(), seoDescription: z.string().trim().min(1).max(300).optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
  takeaways: z.array(z.string().trim().min(1).max(300)).min(1).max(20).optional(),
  location: z.string().trim().max(300).optional(), detailIntro: z.string().trim().max(3000).optional(),
  serviceFocus: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  coverAssetId: z.string().min(1).max(128).nullable().default(null),
  bodyImageAssetIds: z.array(z.string().min(1).max(128)).max(20).default([]),
  galleryAssetIds: z.array(z.string().min(1).max(128)).max(20).default([])
});
export type OfficialApiContentSettings = z.infer<typeof officialApiContentSettingsSchema>;
export interface OfficialApiSourceSnapshot { articleId: string; brandId: string; title: string; body: string; summary: string;
  tags: string[]; seoKeywords: string[]; articleType: string; city: string }
export interface OfficialApiScope { accountId: string; siteId: string; environment: "staging" | "production"; keyId: string }
export interface OfficialApiImageBinding { assetId: string; brandId: string | null; universal?: boolean; filePath: string; sha256: string;
  mimeType: string; bytes: number; width: number; height: number; alt: string }
type PreparedBlock = CmsDraft["blocks"][number] & { assetId?: string; ordered?: boolean };
export interface OfficialApiPreparedContent { version: 1; source: OfficialApiSourceSnapshot; scope: OfficialApiScope;
  settings: OfficialApiContentSettings; slug: string; sourceHash: string; contentBindingId: string;
  images: OfficialApiImageBinding[]; draftPreview: Omit<CmsDraft, "blocks"> & { blocks: PreparedBlock[] } }

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const required = (value: string, maximum: number, name: string): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw new Error(`WEBSITE_${name}_INVALID`);
  return value.trim();
};

/** Controlled-block parser minimally adapted from archive-website-adapters-20260928 mapping.ts. */
export function parseOfficialApiBody(body: string): PreparedBlock[] {
  if (/<[a-z!/][^>]*>/iu.test(body)) throw new Error("WEBSITE_UNSUPPORTED_HTML");
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: PreparedBlock[] = [];
  const listItem = (line: string) => /^(?:([-*])|\d+[.)])\s+(.+)$/u.exec(line);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) { index += 1; continue; }
    const heading = /^(#{2,3})\s+(.+)$/u.exec(line);
    if (heading) { blocks.push({ type: "heading", level: heading[1]!.length, text: required(heading[2]!, 300, "HEADING") }); index += 1; continue; }
    if (listItem(line)) {
      const ordered = /^\d/u.test(line); const items: string[] = [];
      while (index < lines.length) {
        const itemLine = lines[index]?.trim() ?? ""; const match = listItem(itemLine);
        if (!match || /^\d/u.test(itemLine) !== ordered) break;
        items.push(required(match[2]!, 500, "LIST_ITEM")); index += 1;
      }
      if (items.length > 30) throw new Error("WEBSITE_LIST_LIMIT");
      blocks.push({ type: "list", items, ordered }); continue;
    }
    if (line.startsWith("> ")) { blocks.push({ type: "quote", text: required(line.slice(2), 5000, "QUOTE") }); index += 1; continue; }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index]?.trim() ?? "";
      if (!current || /^(#{2,3})\s+/u.test(current) || listItem(current) || current.startsWith("> ")) break;
      paragraph.push(current); index += 1;
    }
    blocks.push({ type: "paragraph", text: required(paragraph.join(" "), 5000, "PARAGRAPH") });
  }
  if (!blocks.length || blocks.length > 100) throw new Error("WEBSITE_BLOCKS_LIMIT");
  return blocks;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function prepareOfficialApiContent(input: { source: OfficialApiSourceSnapshot; scope: OfficialApiScope;
  settings: unknown; images: OfficialApiImageBinding[] }): OfficialApiPreparedContent {
  const source = structuredClone(input.source); const scope = { ...input.scope };
  if (scope.siteId !== "kangyi" || !["staging", "production"].includes(scope.environment) || !scope.accountId || !scope.keyId)
    throw new Error("WEBSITE_SCOPE_INVALID");
  const settings = officialApiContentSettingsSchema.parse(input.settings);
  const title = required(source.title, 200, "TITLE"); const summary = required(settings.summary ?? source.summary, 500, "SUMMARY");
  const category = required(settings.category ?? source.articleType, 100, "CATEGORY");
  const textBlocks = parseOfficialApiBody(source.body);
  const keywords = settings.keywords ?? [...new Set([...source.seoKeywords, ...source.tags].map(value => value.trim()).filter(Boolean))];
  if (!keywords.length || keywords.length > 20 || keywords.some(value => value.length > 100)) throw new Error("WEBSITE_KEYWORDS_INVALID");
  if (settings.kind === "article" && settings.galleryAssetIds.length) throw new Error("WEBSITE_ARTICLE_GALLERY_FORBIDDEN");
  if (settings.kind === "case" && (settings.galleryAssetIds.length < 2 || !settings.serviceFocus?.length)) throw new Error("WEBSITE_CASE_GALLERY_OR_SERVICE_REQUIRED");
  const chosenIds = [...new Set([...(settings.coverAssetId ? [settings.coverAssetId] : []), ...settings.bodyImageAssetIds, ...settings.galleryAssetIds])];
  if (chosenIds.length > 20) throw new Error("WEBSITE_MEDIA_LIMIT");
  const images = chosenIds.map(assetId => {
    const found = input.images.filter(image => image.assetId === assetId);
    if (found.length !== 1) throw new Error("WEBSITE_IMAGE_BINDING_REQUIRED");
    const image = { ...found[0]!, universal: Boolean(found[0]!.universal) };
    if (image.brandId !== source.brandId && !image.universal) throw new Error("WEBSITE_CROSS_BRAND_IMAGE");
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.mimeType) || !/^[a-f0-9]{64}$/u.test(image.sha256)
      || !Number.isSafeInteger(image.bytes) || image.bytes < 1 || image.bytes > 8388608
      || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
      || image.width > 10000 || image.height > 10000 || image.width * image.height > 40000000) throw new Error("WEBSITE_MEDIA_INVALID");
    image.alt = required(image.alt || title, 300, "ALT"); return image;
  });
  const blocks = [...textBlocks, ...settings.bodyImageAssetIds.map(assetId => ({ type: "image", assetId,
    alt: images.find(image => image.assetId === assetId)!.alt }))];
  if (blocks.length > 100) throw new Error("WEBSITE_BLOCKS_LIMIT");
  const slug = settings.slug ?? `geo-${settings.kind}-${hash([scope, source.articleId, settings.kind]).slice(0, 16)}`;
  const seoTitle = required(settings.seoTitle ?? title, 200, "SEO_TITLE");
  const seoDescription = required(settings.seoDescription ?? summary, 300, "SEO_DESCRIPTION");
  const draftPreview = { kind: settings.kind, slug, title, summary, category, seoTitle, seoDescription, keywords, blocks,
    ...(settings.kind === "article" ? { takeaways: settings.takeaways ?? textBlocks.flatMap(block => block.items ?? (block.text ? [block.text] : [])).slice(0, 3).map(text => text.slice(0, 300)), showOnHomepage: false }
      : { location: required(settings.location ?? source.city, 300, "CASE_LOCATION"), listSummary: summary,
        detailIntro: required(settings.detailIntro ?? source.body, 3000, "CASE_INTRO"), serviceFocus: settings.serviceFocus }) };
  const sourceHash = hash(source);
  return freeze({ version: 1, source, scope, settings, slug, sourceHash,
    contentBindingId: hash({ source, scope, settings, images }), images, draftPreview });
}

export function buildOfficialApiDraft(prepared: OfficialApiPreparedContent, remoteMedia: Record<string, Media>): CmsDraft {
  const mediaId = (assetId: string) => {
    const local = prepared.images.find(image => image.assetId === assetId); const remote = remoteMedia[assetId];
    if (!local || !remote || remote.sha256 !== local.sha256 || remote.bytes !== local.bytes || remote.mime !== local.mimeType
      || remote.width !== local.width || remote.height !== local.height
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(remote.mediaId)) throw new Error("WEBSITE_MEDIA_BINDING_MISMATCH");
    return remote.mediaId;
  };
  const blocks = prepared.draftPreview.blocks.map(block => {
    if (block.type !== "image") return block;
    if (!block.assetId) throw new Error("WEBSITE_MEDIA_BINDING_REQUIRED");
    return { type: "image", mediaId: mediaId(block.assetId), alt: block.alt };
  });
  return { ...prepared.draftPreview, kind: prepared.settings.kind, slug: prepared.slug, title: prepared.source.title.trim(), blocks,
    ...(prepared.settings.coverAssetId ? { coverMediaId: mediaId(prepared.settings.coverAssetId),
      coverAlt: prepared.images.find(image => image.assetId === prepared.settings.coverAssetId)!.alt } : {}),
    ...(prepared.settings.kind === "case" ? { galleryMediaIds: prepared.settings.galleryAssetIds.map(mediaId) } : {}) };
}
