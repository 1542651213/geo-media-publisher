import { createHash } from "node:crypto";
import { openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { imageSize } from "image-size";
import type { Article, ImageAsset } from "@publisher/domain";
import { officialApiContentSettingsSchema, prepareOfficialApiContent, type OfficialApiScope } from "../../../../packages/adapters/official-api/src/mapping";

export interface OfficialApiSelectionRepository {
  getArticle(id: string): Pick<Article, "id" | "brandId" | "title" | "body" | "summary" | "tags" | "seoKeywords" | "articleType" | "city"> | null;
  getImageAsset(id: string): Pick<ImageAsset, "id" | "brandId" | "universal" | "enabled" | "filePath" | "name" | "mimeType" | "sha256"> | null;
}

/** Header dimensions are a preflight; the CMS decoder remains authoritative for image integrity. */
export function freezeOfficialApiSelection(repository: OfficialApiSelectionRepository, articleId: string, scope: OfficialApiScope, rawSettings: unknown) {
  const source = repository.getArticle(articleId);
  if (!source) throw new Error("WEBSITE_ARTICLE_NOT_FOUND");
  const settings = officialApiContentSettingsSchema.parse(rawSettings);
  const ids = [...new Set([...(settings.coverAssetId ? [settings.coverAssetId] : []), ...settings.bodyImageAssetIds, ...settings.galleryAssetIds])];
  const images = ids.map(assetId => {
    const asset = repository.getImageAsset(assetId);
    if (!asset?.enabled || (asset.brandId !== source.brandId && !asset.universal)) throw new Error("WEBSITE_IMAGE_NOT_AVAILABLE");
    let bytes: Buffer;
    try {
      const fd = openSync(asset.filePath, "r");
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size < 1 || stat.size > 8388608) throw new Error("Invalid size");
        bytes = readFileSync(fd);
      } finally { closeSync(fd); }
    } catch { throw new Error("WEBSITE_IMAGE_UNREADABLE_OR_TOO_LARGE"); }
    if (bytes.length < 1 || bytes.length > 8388608) throw new Error("WEBSITE_MEDIA_INVALID");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (asset.sha256 && asset.sha256 !== sha256) throw new Error("WEBSITE_IMAGE_BYTES_CHANGED");
    let dimensions: ReturnType<typeof imageSize>;
    try { dimensions = imageSize(bytes); } catch { throw new Error("WEBSITE_IMAGE_UNREADABLE"); }
    const mimeType = dimensions.type === "jpg" ? "image/jpeg" : dimensions.type === "png" ? "image/png" : dimensions.type === "webp" ? "image/webp" : null;
    if (!mimeType) throw new Error("WEBSITE_IMAGE_FORMAT_UNSUPPORTED");
    return { assetId, brandId: asset.brandId, universal: asset.universal, filePath: asset.filePath, sha256, mimeType, bytes: bytes.length,
      width: dimensions.width, height: dimensions.height, alt: asset.name || source.title };
  });
  return prepareOfficialApiContent({ source: { articleId: source.id, brandId: source.brandId, title: source.title, body: source.body,
    summary: source.summary, tags: [...source.tags], seoKeywords: [...source.seoKeywords], articleType: source.articleType, city: source.city },
    // Only explicitly named routing fields can cross into the journal. Never spread a credential object.
    scope: { accountId: scope.accountId, siteId: scope.siteId, environment: scope.environment, keyId: scope.keyId }, settings, images });
}
