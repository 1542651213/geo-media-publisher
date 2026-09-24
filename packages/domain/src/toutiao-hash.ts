/** Node-only Toutiao hashes. Renderer imports the browser-safe domain entrypoint. */
import { createHash } from "node:crypto";
import { canonicalSerialize, ToutiaoPreparationError, type ToutiaoContentBindingInput } from "./toutiao-article";

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalSerialize(value)).digest("hex");
}

export function hashToutiaoContentBinding(input: ToutiaoContentBindingInput): string {
  if (!input || typeof input.accountId !== "string" || !input.accountId || typeof input.brandId !== "string" || !input.brandId
    || typeof input.title !== "string" || !input.title || typeof input.normalizedHtml !== "string"
    || !Array.isArray(input.coverUploadKeys) || !Array.isArray(input.bodyImageUploadKeys) || !Array.isArray(input.assetSnapshots)
    || input.coverUploadKeys.some((key) => typeof key !== "string") || input.bodyImageUploadKeys.some((key) => typeof key !== "string")
    || !["auto", "none", "single", "multiple"].includes(input.coverMode) || !["none", "platform_default"].includes(input.articleAdType)
    || input.remoteScheduledAt !== null && typeof input.remoteScheduledAt !== "string"
    || !Number.isInteger(input.settingsSnapshotVersion) || input.settingsSnapshotVersion < 1) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  if (input.assetSnapshots.some((asset) => !asset || typeof asset.byteSha256 !== "string")) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  const assetByteHashes = [...new Set(input.assetSnapshots.map((asset) => asset.byteSha256))].sort();
  if (assetByteHashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  return sha256Canonical({ version: 1, accountId: input.accountId, brandId: input.brandId, title: input.title,
    normalizedHtml: input.normalizedHtml, coverMode: input.coverMode, coverUploadKeys: input.coverUploadKeys,
    bodyImageUploadKeys: input.bodyImageUploadKeys, articleAdType: input.articleAdType,
    remoteScheduledAt: input.remoteScheduledAt, settingsSnapshotVersion: input.settingsSnapshotVersion, assetByteHashes });
}
