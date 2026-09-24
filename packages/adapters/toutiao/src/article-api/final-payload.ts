import { canonicalSerialize, deepFreeze, hashToutiaoContentBinding, isSecretEvidenceKey, sha256Canonical, ToutiaoPreparationError } from "@publisher/domain";
import { makeAssetUploadKey } from "./assets";
import { normalizeToutiaoArticleContent } from "./content";
import type { ToutiaoArticlePreparedPayload } from "./payload";

export interface ToutiaoRemoteAssetResolution {
  readonly platform: "toutiao";
  readonly uploadKey: string;
  readonly sourceByteSha256: string;
  readonly remoteAssetId: string;
  readonly remoteUrl: string;
  readonly accountId: string;
  readonly status: "VALIDATED" | "EXPIRED";
  readonly createdAt: string;
  readonly validatedAt: string;
  readonly expiresAt: string | null;
}
export interface ToutiaoFinalAsset { readonly uploadKey: string; readonly sourceByteSha256: string; readonly remoteAssetId: string; readonly remoteUrl: string }
export interface ToutiaoArticleFinalPayload {
  readonly version: 1;
  readonly accountId: string;
  readonly brandId: string;
  readonly title: string;
  readonly html: string;
  readonly coverMode: ToutiaoArticlePreparedPayload["coverMode"];
  readonly coverAssets: readonly ToutiaoFinalAsset[];
  readonly articleAdType: ToutiaoArticlePreparedPayload["articleAdType"];
  readonly remoteScheduledAt: string | null;
  readonly settingsSnapshotVersion: number;
  readonly contentBindingHash: string;
}
export type ToutiaoFinalPayloadBuildResult =
  | { readonly state: "REMOTE_ASSET_RESOLUTION_REQUIRED"; readonly missingUploadKeys: readonly string[]; readonly reasonCode?: "UNRESOLVED_IMAGE_SOURCE" }
  | { readonly state: "FINAL_PAYLOAD_READY"; readonly payload: Readonly<ToutiaoArticleFinalPayload>; readonly canonicalJson: string; readonly finalPayloadHash: string };

function assertPlatformUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(isSecretEvidenceKey)
      || !(url.hostname === "toutiaoimg.com" || url.hostname.endsWith(".toutiaoimg.com"))) throw new Error();
  } catch { throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH", "Remote image URL is not a recognized Toutiao asset URL"); }
}

export function canonicalSerializeFinalPayload(payload: ToutiaoArticleFinalPayload): string {
  return canonicalSerialize(payload);
}

export function hashToutiaoFinalPayload(payload: ToutiaoArticleFinalPayload): string { return sha256Canonical(payload); }

export function assertToutiaoFinalPayloadReady(payload: ToutiaoArticleFinalPayload): void {
  if (!payload.accountId || !payload.brandId || !payload.title || !/^[a-f0-9]{64}$/u.test(payload.contentBindingHash)
    || payload.html.includes("asset://") || normalizeToutiaoArticleContent(payload.html).imageReferences.some((reference) => reference.classification !== "PLATFORM_HOSTED")
    || payload.coverMode === "none" && payload.coverAssets.length !== 0 || payload.coverMode === "single" && payload.coverAssets.length !== 1
    || payload.coverMode === "multiple" && payload.coverAssets.length < 2) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  for (const cover of payload.coverAssets) {
    if (!cover.remoteAssetId || !cover.remoteUrl || !/^[a-f0-9]{64}$/u.test(cover.sourceByteSha256)) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
    assertPlatformUrl(cover.remoteUrl);
  }
}

export function buildToutiaoFinalPayload(prepared: ToutiaoArticlePreparedPayload, contentBindingHash: string, resolutions: readonly ToutiaoRemoteAssetResolution[], now = new Date()): ToutiaoFinalPayloadBuildResult {
  if (hashToutiaoContentBinding(prepared) !== contentBindingHash) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  const sourceImages = normalizeToutiaoArticleContent(prepared.normalizedHtml).imageReferences;
  if (sourceImages.some((image) => image.classification === "REMOTE_EXTERNAL" || image.classification === "LOCAL_ASSET" && !image.source?.startsWith("asset://sha256/")))
    return { state: "REMOTE_ASSET_RESOLUTION_REQUIRED", missingUploadKeys: [], reasonCode: "UNRESOLVED_IMAGE_SOURCE" };
  const expectedByKey = new Map(prepared.assetSnapshots.map((asset) => [makeAssetUploadKey("toutiao", prepared.accountId, asset.byteSha256), asset.byteSha256]));
  const requiredKeys = [...new Set([...prepared.bodyImageUploadKeys, ...prepared.coverUploadKeys])];
  if (requiredKeys.some((key) => !expectedByKey.has(key))) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  const byKey = new Map(resolutions.map((resolution) => [resolution.uploadKey, resolution]));
  if (byKey.size !== resolutions.length) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH", "Duplicate remote asset resolution keys");
  const missingUploadKeys = requiredKeys.filter((key) => !byKey.has(key));
  if (missingUploadKeys.length) return { state: "REMOTE_ASSET_RESOLUTION_REQUIRED", missingUploadKeys };
  const resolved = new Map<string, ToutiaoFinalAsset>();
  for (const key of requiredKeys) {
    const entry = byKey.get(key)!;
    if (entry.platform !== "toutiao" || entry.accountId !== prepared.accountId || entry.uploadKey !== key || entry.sourceByteSha256 !== expectedByKey.get(key)
      || entry.status !== "VALIDATED" || !entry.remoteAssetId.trim() || !entry.remoteUrl.trim()
      || !Number.isFinite(Date.parse(entry.validatedAt)) || !Number.isFinite(Date.parse(entry.createdAt))
      || Date.parse(entry.createdAt) > Date.parse(entry.validatedAt) || Date.parse(entry.validatedAt) > now.getTime()
      || entry.expiresAt !== null && (!Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt) <= now.getTime())) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
    assertPlatformUrl(entry.remoteUrl);
    resolved.set(key, { uploadKey: key, sourceByteSha256: entry.sourceByteSha256, remoteAssetId: entry.remoteAssetId, remoteUrl: entry.remoteUrl });
  }
  let html = prepared.normalizedHtml;
  for (const asset of resolved.values()) html = html.replaceAll(`asset://sha256/${asset.sourceByteSha256}`, asset.remoteUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"));
  const references = normalizeToutiaoArticleContent(html).imageReferences;
  if (references.some((reference) => reference.classification !== "PLATFORM_HOSTED")) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH", "Final HTML retains an unresolved image");
  const payload = deepFreeze({ version: 1 as const, accountId: prepared.accountId, brandId: prepared.brandId, title: prepared.title, html,
    coverMode: prepared.coverMode, coverAssets: prepared.coverUploadKeys.map((key) => resolved.get(key)!), articleAdType: prepared.articleAdType,
    remoteScheduledAt: prepared.remoteScheduledAt, settingsSnapshotVersion: prepared.settingsSnapshotVersion, contentBindingHash });
  assertToutiaoFinalPayloadReady(payload);
  const canonicalJson = canonicalSerializeFinalPayload(payload);
  return { state: "FINAL_PAYLOAD_READY", payload, canonicalJson, finalPayloadHash: hashToutiaoFinalPayload(payload) };
}
