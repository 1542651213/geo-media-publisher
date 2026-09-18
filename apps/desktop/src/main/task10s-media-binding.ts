import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

export interface Task10sFixtureProof {
  path: string;
  expectedName: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  valid: boolean;
}

export interface Task10sImageAssetLike {
  id: string;
  filePath: string;
  originalFileName: string;
  mimeType: string;
  size: number;
}

export interface Task10sImageAssetBindingResult {
  status: "PASS" | "BLOCKED";
  failureCode: string | null;
  assetId: string | null;
  imagePath: string | null;
}

export function validateTask10sImageAssetBinding(_asset: Task10sImageAssetLike | null, _fixture: Task10sFixtureProof): Task10sImageAssetBindingResult {
  const fixture = _fixture;
  const asset = _asset;
  if (!fixture.valid) return { status: "BLOCKED", failureCode: "TASK10S_FIXTURE_INVALID", assetId: asset?.id ?? null, imagePath: asset?.filePath ?? null };
  if (!asset) return { status: "BLOCKED", failureCode: "JOB_IMAGE_ASSET_MISSING", assetId: null, imagePath: null };
  if (asset.originalFileName !== fixture.expectedName || asset.mimeType !== "image/png" || asset.size !== fixture.expectedSizeBytes) {
    return { status: "BLOCKED", failureCode: "IMAGE_ASSET_METADATA_MISMATCH", assetId: asset.id, imagePath: asset.filePath };
  }
  if (asset.filePath !== fixture.path) return { status: "BLOCKED", failureCode: "IMAGE_ASSET_PATH_MISMATCH", assetId: asset.id, imagePath: asset.filePath };
  if (!existsSync(asset.filePath)) return { status: "BLOCKED", failureCode: "IMAGE_ASSET_FILE_MISSING", assetId: asset.id, imagePath: asset.filePath };
  try {
    const stat = statSync(asset.filePath);
    if (!stat.isFile() || stat.size !== fixture.expectedSizeBytes) return { status: "BLOCKED", failureCode: "IMAGE_ASSET_FILE_METADATA_MISMATCH", assetId: asset.id, imagePath: asset.filePath };
    const sha256 = createHash("sha256").update(readFileSync(asset.filePath)).digest("hex").toUpperCase();
    if (sha256 !== fixture.expectedSha256) return { status: "BLOCKED", failureCode: "IMAGE_ASSET_HASH_MISMATCH", assetId: asset.id, imagePath: asset.filePath };
  } catch {
    return { status: "BLOCKED", failureCode: "IMAGE_ASSET_FILE_READ_FAILED", assetId: asset.id, imagePath: asset.filePath };
  }
  return { status: "PASS", failureCode: null, assetId: asset.id, imagePath: asset.filePath };
}
