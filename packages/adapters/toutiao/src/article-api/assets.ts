import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ToutiaoPreparationError } from "@publisher/domain";

export interface LocalAssetSource {
  readonly assetId: string;
  readonly brandId: string | null;
  readonly universal?: boolean;
  readonly filePath: string;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ToutiaoAssetSnapshot {
  readonly assetId: string;
  readonly sourcePath: string;
  readonly brandId: string | null;
  readonly byteSha256: string;
  readonly size: number;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly resolvedAt: string;
}

function bytesAt(path: string): Buffer {
  try { return readFileSync(path); }
  catch { throw new ToutiaoPreparationError("ASSET_NOT_FOUND", "Local image bytes could not be read"); }
}

export function snapshotLocalAsset(source: LocalAssetSource, expectedBrandId: string, resolvedAt: string): ToutiaoAssetSnapshot {
  if (source.brandId !== expectedBrandId && !(source.brandId === null && source.universal === true)) throw new ToutiaoPreparationError("ASSET_BRAND_MISMATCH");
  const bytes = bytesAt(source.filePath);
  return Object.freeze({ assetId: source.assetId, sourcePath: source.filePath, brandId: source.brandId, byteSha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, mimeType: source.mimeType, width: source.width, height: source.height, resolvedAt });
}

export function assertAssetSnapshotCurrent(snapshot: ToutiaoAssetSnapshot): void {
  const bytes = bytesAt(snapshot.sourcePath);
  if (bytes.length !== snapshot.size || createHash("sha256").update(bytes).digest("hex") !== snapshot.byteSha256) throw new ToutiaoPreparationError("ASSET_HASH_MISMATCH");
}

export function makeAssetUploadKey(platform: string, accountId: string, byteSha256: string): string {
  return `${platform}:${accountId}:${byteSha256}`;
}

export interface ToutiaoUploadCacheEntry {
  readonly key: string;
  readonly platform: "toutiao";
  readonly accountId: string;
  readonly sourceHash: string;
  readonly remoteAssetId: string;
  readonly remoteUrl: string;
  readonly status: "UPLOADED" | "VALIDATED" | "EXPIRED";
  readonly createdAt: string;
  readonly validatedAt: string | null;
}

/** Purely local mapping. Online upload and validation belong to a later task. */
export class ToutiaoUploadResultMap {
  private readonly entries = new Map<string, ToutiaoUploadCacheEntry>();
  get(accountId: string, byteSha256: string): ToutiaoUploadCacheEntry | null {
    const entry = this.entries.get(makeAssetUploadKey("toutiao", accountId, byteSha256));
    return entry?.status === "EXPIRED" ? null : entry ?? null;
  }
  put(entry: ToutiaoUploadCacheEntry): void {
    if (entry.key !== makeAssetUploadKey(entry.platform, entry.accountId, entry.sourceHash)) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH", "Upload cache key does not match its account and source hash");
    this.entries.set(entry.key, Object.freeze({ ...entry }));
  }
}
