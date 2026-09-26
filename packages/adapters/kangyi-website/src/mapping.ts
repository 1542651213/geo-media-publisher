import { createHash } from "node:crypto";
import type { Article, BoundImageBytes, ContentSnapshot } from "@publisher/domain";
import type { KangyiPreparedBlock, KangyiPreparedImageBinding, KangyiWebsiteContentKind, KangyiWebsiteDraftPreview, KangyiWebsitePreparedContentV1 } from "@publisher/domain";
import type { CmsDraft, ContentKind } from "@publisher/cms-v2-client";

export interface KangyiImageFact {
  assetId: string;
  brandId: string | null;
  sha256: string;
  mimeType: string;
  bytes: number;
  alt: string;
}

export type KangyiImageBinding = KangyiPreparedImageBinding;
export type KangyiPreparedContent = KangyiWebsitePreparedContentV1;
export type KangyiDraftPreview = KangyiWebsiteDraftPreview;

const SUPPORTED_MIME = new Set<KangyiImageBinding["mimeType"]>(["image/jpeg", "image/png", "image/webp"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function required(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function stableSlug(articleId: string, kind: ContentKind, approvedSlug?: string | null): string {
  if (approvedSlug !== undefined && approvedSlug !== null && approvedSlug.trim()) {
    const slug = approvedSlug.trim();
    if (!SLUG_PATTERN.test(slug) || slug.length > 191) throw new Error("KANGYI_APPROVED_SLUG_INVALID");
    return slug;
  }
  const digest = createHash("sha256").update(articleId, "utf8").digest("hex").slice(0, 16);
  return `geo-${kind}-${digest}`;
}

function parseBody(body: string): KangyiPreparedBlock[] {
  if (/<[a-z!/][^>]*>/iu.test(body)) throw new Error("KANGYI_UNSUPPORTED_HTML");
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: KangyiPreparedBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) { index += 1; continue; }
    const heading = /^(#{2,3})\s+(.+)$/u.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length as 2 | 3, text: required(heading[2]!, "KANGYI_HEADING_REQUIRED") });
      index += 1;
      continue;
    }
    if (/^(?:[-*])\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const listLine = lines[index]?.trim() ?? "";
        const match = /^(?:[-*])\s+(.+)$/u.exec(listLine);
        if (!match) break;
        items.push(required(match[1]!, "KANGYI_LIST_ITEM_REQUIRED"));
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({ type: "quote", text: required(line.slice(2), "KANGYI_QUOTE_REQUIRED") });
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index]?.trim() ?? "";
      if (!paragraphLine || /^(?:#{2,3})\s+/.test(paragraphLine) || /^(?:[-*])\s+/.test(paragraphLine) || paragraphLine.startsWith("> ")) break;
      paragraph.push(paragraphLine);
      index += 1;
    }
    if (paragraph.length > 0) blocks.push({ type: "paragraph", text: required(paragraph.join(" "), "KANGYI_PARAGRAPH_REQUIRED") });
  }
  if (blocks.length === 0) throw new Error("KANGYI_BLOCKS_REQUIRED");
  return blocks;
}

function textForTakeaways(blocks: KangyiPreparedBlock[]): string[] {
  return blocks.flatMap((block) => block.type === "list" ? block.items : "text" in block ? [block.text] : []).slice(0, 3).map((value) => value.slice(0, 300));
}

function freezePrepared<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezePrepared(child);
    Object.freeze(value);
  }
  return value;
}

export function prepareKangyiWebsiteContent(input: {
  article: Article;
  snapshot: ContentSnapshot;
  account: { id: string; siteId: string; environment: "local" | "staging" | "production" };
  kind?: ContentKind;
  approvedSlug?: string | null;
  imageFacts?: KangyiImageFact[];
}): KangyiPreparedContent {
  const { article, snapshot } = input;
  if (!["kangyi", "huiquan", "shupai"].includes(input.account.siteId)) throw new Error("KANGYI_SITE_MISMATCH");
  if (snapshot.sourceArticleId !== article.id || snapshot.accountId !== input.account.id || snapshot.platformKey !== `${input.account.siteId}_website`) throw new Error("KANGYI_IMMUTABLE_BINDING_MISMATCH");
  const kind = (input.kind ?? "article") as KangyiWebsiteContentKind;
  const title = required(snapshot.canonicalTitle, "KANGYI_TITLE_REQUIRED");
  const summary = required(snapshot.summary, "KANGYI_SUMMARY_REQUIRED");
  const category = required(article.articleType, "KANGYI_CATEGORY_REQUIRED");
  const blocks = parseBody(snapshot.canonicalBody);
  const keywords = [...new Set(snapshot.tags.map((value) => value.trim()).filter(Boolean))];
  if (keywords.length === 0) throw new Error("KANGYI_KEYWORDS_REQUIRED");
  const takeaways = textForTakeaways(blocks);
  if (takeaways.length === 0) throw new Error("KANGYI_TAKEAWAYS_REQUIRED");
  const imageFacts = input.imageFacts ?? [];
  const snapshotImages = snapshot.images;
  if (imageFacts.length !== snapshotImages.length) throw new Error("KANGYI_IMAGE_BINDING_MISMATCH");
  const imageBindings = imageFacts.map((image): KangyiImageBinding => {
    const snapshotImage = snapshotImages.find((candidate) => candidate.assetId === image.assetId);
    if (!snapshotImage || snapshotImage.sha256 !== image.sha256 || image.brandId !== article.brandId) throw new Error("KANGYI_CROSS_BRAND_IMAGE");
    if (!SUPPORTED_MIME.has(image.mimeType as KangyiImageBinding["mimeType"])) throw new Error("KANGYI_UNSUPPORTED_MIME");
    if (!Number.isSafeInteger(image.bytes) || image.bytes < 1 || image.bytes > 8 * 1024 * 1024) throw new Error("KANGYI_IMAGE_SIZE_LIMIT");
    return { assetId: image.assetId, snapshotSha256: image.sha256, mimeType: image.mimeType as KangyiImageBinding["mimeType"], bytes: image.bytes, alt: required(image.alt || title, "KANGYI_IMAGE_ALT_REQUIRED"), mediaId: null };
  });
  const preparedBlocks: KangyiPreparedBlock[] = [...blocks, ...imageBindings.map((image) => ({ type: "image" as const, assetId: image.assetId, sha256: image.snapshotSha256, alt: image.alt }))];
  const draftPreview: KangyiDraftPreview = {
    kind, slug: stableSlug(article.id, kind, input.approvedSlug), title, blocks: preparedBlocks,
    summary, category, seoTitle: title, seoDescription: summary, keywords, takeaways, showOnHomepage: false,
    ...(article.keyword.trim() ? { primaryKeyword: article.keyword.trim() } : {}),
    ...(kind === "case" ? {
      location: required(article.city, "KANGYI_CASE_LOCATION_REQUIRED"),
      listSummary: summary,
      detailIntro: required(snapshot.canonicalBody, "KANGYI_CASE_DETAIL_REQUIRED")
    } : {})
  };
  return freezePrepared({ version: 1, articleId: article.id, brandId: article.brandId, accountId: input.account.id, snapshotId: snapshot.id, contentBindingId: snapshot.id, siteId: input.account.siteId as KangyiPreparedContent["siteId"], environment: input.account.environment, kind, slug: draftPreview.slug, draftPreview, imageBindings });
}

export function buildKangyiCmsDraft(prepared: KangyiPreparedContent, mediaIds?: Record<string, string>): CmsDraft {
  const imageIds = prepared.imageBindings.map((image) => {
    const mediaId = mediaIds?.[image.assetId];
    if (!mediaId) throw new Error("KANGYI_MEDIA_BINDING_REQUIRED");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(mediaId)) throw new Error("KANGYI_MEDIA_ID_INVALID");
    return mediaId;
  });
  const blocks = prepared.draftPreview.blocks.map((block): CmsDraft["blocks"][number] => {
    if (block.type !== "image") return block;
    const mediaId = mediaIds?.[block.assetId];
    if (!mediaId) throw new Error("KANGYI_MEDIA_BINDING_REQUIRED");
    return { type: "image", mediaId, alt: block.alt };
  });
  return {
    kind: prepared.draftPreview.kind,
    slug: prepared.draftPreview.slug,
    title: prepared.draftPreview.title,
    summary: prepared.draftPreview.summary,
    category: prepared.draftPreview.category,
    seoTitle: prepared.draftPreview.seoTitle,
    seoDescription: prepared.draftPreview.seoDescription,
    keywords: prepared.draftPreview.keywords,
    takeaways: prepared.draftPreview.takeaways,
    showOnHomepage: prepared.draftPreview.showOnHomepage,
    ...(prepared.draftPreview.primaryKeyword ? { primaryKeyword: prepared.draftPreview.primaryKeyword } : {}),
    ...(prepared.draftPreview.location ? { location: prepared.draftPreview.location } : {}),
    ...(prepared.draftPreview.listSummary ? { listSummary: prepared.draftPreview.listSummary } : {}),
    ...(prepared.draftPreview.detailIntro ? { detailIntro: prepared.draftPreview.detailIntro } : {}),
    blocks,
    ...(imageIds.length > 0 ? { coverMediaId: imageIds[0], coverAlt: prepared.imageBindings[0]!.alt, galleryMediaIds: imageIds } : {})
  };
}

export function imageFactsFromSnapshot(snapshot: ContentSnapshot, boundImages: BoundImageBytes[], brandId: string): KangyiImageFact[] {
  return snapshot.images.map((image) => {
    const bound = boundImages.find((candidate) => candidate.assetId === image.assetId);
    if (!bound) throw new Error("KANGYI_SNAPSHOT_IMAGE_BYTES_MISSING");
    return { assetId: image.assetId, brandId, sha256: image.sha256, mimeType: bound.mimeType, bytes: bound.buffer.byteLength, alt: image.name };
  });
}
