import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { deepFreeze, hashToutiaoContentBinding, normalizeToutiaoSettings, ToutiaoPreparationError, validateRemoteSchedule, validateTitle, type Article, type PublishJob, type ToutiaoArticleSettingsSnapshot } from "@publisher/domain";
import type { AppRepository } from "@publisher/db";
import { assertPreparedAssetsCurrent, assertPreparedPayloadBinding, prepareToutiaoArticlePayload, type ToutiaoArticlePreparedPayload } from "./payload";
import type { LocalAssetSource } from "./assets";
import { normalizeToutiaoArticleContent } from "./content";

function mimeFromPath(path: string): string {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function resolveAsset(repository: AppRepository, articleBrandId: string, assetIdOrPath: string): LocalAssetSource | null {
  const path = assetIdOrPath.startsWith("file://") ? fileURLToPath(assetIdOrPath) : assetIdOrPath;
  const image = repository.getImageAsset(path) ?? repository.listImageAssets(articleBrandId).find((candidate) => candidate.filePath === path) ?? null;
  if (image) return { assetId: image.id, brandId: image.brandId, universal: image.universal, filePath: image.filePath, mimeType: image.mimeType, width: null, height: null };
  const media = repository.getMediaAsset(path);
  if (!media) return null;
  return { assetId: media.id, brandId: media.brandId, filePath: media.filePath, mimeType: typeof media.metadata.mimeType === "string" ? media.metadata.mimeType : mimeFromPath(media.filePath), width: typeof media.metadata.width === "number" ? media.metadata.width : null, height: typeof media.metadata.height === "number" ? media.metadata.height : null };
}

export function preflightToutiaoArticleJob(repository: AppRepository, jobId: string, now: Date): { job: PublishJob; article: Article; settings: ToutiaoArticleSettingsSnapshot; title: string; html: string } {
  const job = repository.getJob(jobId);
  if (!job || job.platformKey !== "toutiao" || (job.contentKind ?? "article") !== "article") throw new Error("Toutiao article Job is required");
  const article = repository.getArticle(job.articleId);
  const savedSettings = repository.getToutiaoArticleSettingsSnapshot(jobId);
  if (!article || !savedSettings) throw new Error("Toutiao article or frozen settings snapshot is missing");
  const settings = normalizeToutiaoSettings(savedSettings);
  const variant = job.articleVariantId ? repository.getArticleVariant(job.articleVariantId) : null;
  const title = variant?.title ?? article.title;
  const html = variant?.body ?? article.body;
  const titleError = validateTitle(title, { minimum: 1, measurement: "weighted_cjk", provenance: "UNVERIFIED_PLATFORM_RULE" })[0];
  if (titleError) throw new ToutiaoPreparationError(titleError);
  const scheduleError = validateRemoteSchedule(settings.remoteScheduledAt, { supportsRemoteScheduling: true, provenance: "UNVERIFIED_PLATFORM_RULE" }, now)[0];
  if (scheduleError) throw new ToutiaoPreparationError(scheduleError);
  const content = normalizeToutiaoArticleContent(html);
  if (content.diagnostics.length) throw new ToutiaoPreparationError("UNSUPPORTED_IMAGE_SOURCE");
  for (const image of content.imageReferences) {
    if (image.classification === "REMOTE_EXTERNAL") throw new ToutiaoPreparationError("UNRESOLVED_EXTERNAL_IMAGE");
    if (image.classification !== "LOCAL_ASSET" || !image.source) continue;
    const source = image.source.startsWith("asset://") ? image.source.slice(8) : image.source;
    const asset = resolveAsset(repository, article.brandId, source);
    if (!asset || !existsSync(asset.filePath)) throw new ToutiaoPreparationError("ASSET_NOT_FOUND");
    if (asset.brandId !== article.brandId && !(asset.brandId === null && asset.universal === true)) throw new ToutiaoPreparationError("ASSET_BRAND_MISMATCH");
  }
  for (const coverId of settings.coverImages) {
    const asset = resolveAsset(repository, article.brandId, coverId);
    if (!asset || !existsSync(asset.filePath)) throw new ToutiaoPreparationError("MISSING_COVER_ASSET");
    if (asset.brandId !== article.brandId && !(asset.brandId === null && asset.universal === true)) throw new ToutiaoPreparationError("ASSET_BRAND_MISMATCH");
  }
  return { job, article, settings, title, html };
}

export function prepareToutiaoArticleJob(repository: AppRepository, jobId: string, now = new Date()): { payload: Readonly<ToutiaoArticlePreparedPayload>; canonicalJson: string; payloadHash: string; contentBindingHash: string } {
  const persisted = repository.getToutiaoArticlePreparation(jobId);
  if (persisted?.canonicalPayloadJson && persisted.payloadHash) {
    const payload = deepFreeze(JSON.parse(persisted.canonicalPayloadJson) as ToutiaoArticlePreparedPayload);
    assertPreparedPayloadBinding(payload, persisted.payloadHash);
    assertPreparedAssetsCurrent(payload);
    const contentBindingHash = hashToutiaoContentBinding(payload);
    if (persisted.contentBindingHash && persisted.contentBindingHash !== contentBindingHash) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
    return { payload, canonicalJson: persisted.canonicalPayloadJson, payloadHash: persisted.payloadHash, contentBindingHash };
  }
  const { job, article, settings, title, html } = preflightToutiaoArticleJob(repository, jobId, now);
  const prepared = prepareToutiaoArticlePayload({ jobId: job.id, articleId: article.id, accountId: job.accountId, brandId: article.brandId, title, html, settings, now, resolveAsset: (id) => resolveAsset(repository, article.brandId, id) });
  repository.saveToutiaoArticlePreparedPayload(job.id, prepared.canonicalJson, prepared.payloadHash);
  return prepared;
}
