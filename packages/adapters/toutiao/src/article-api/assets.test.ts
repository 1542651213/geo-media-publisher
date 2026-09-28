import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertAssetSnapshotCurrent, makeAssetUploadKey, snapshotLocalAsset, ToutiaoUploadResultMap, type LocalAssetSource } from "./assets";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function asset(bytes: string, name: string, brandId = "brand-a"): LocalAssetSource {
  const dir = mkdtempSync(join(tmpdir(), "toutiao-asset-")); dirs.push(dir);
  const filePath = join(dir, name); writeFileSync(filePath, bytes);
  return { assetId: `${name}-${dirs.length}`, brandId, filePath, mimeType: "image/png", width: null, height: null };
}

describe("Toutiao local asset snapshots", () => {
  it("hashes bytes rather than names, paths or URLs", () => {
    const first = snapshotLocalAsset(asset("same bytes", "a.png"), "brand-a", "2026-09-24T00:00:00.000Z");
    const second = snapshotLocalAsset(asset("same bytes", "b.png"), "brand-a", "2026-09-24T00:00:00.000Z");
    expect(first.byteSha256).toBe(second.byteSha256);
    expect(makeAssetUploadKey("toutiao", "account-a", first.byteSha256)).toBe(makeAssetUploadKey("toutiao", "account-a", second.byteSha256));
    expect(makeAssetUploadKey("toutiao", "account-b", first.byteSha256)).not.toBe(makeAssetUploadKey("toutiao", "account-a", first.byteSha256));
  });

  it("rejects changed bytes, wrong brands and missing files", () => {
    const source = asset("before", "asset.png");
    const snapshot = snapshotLocalAsset(source, "brand-a", "2026-09-24T00:00:00.000Z");
    writeFileSync(source.filePath, "after");
    expect(() => assertAssetSnapshotCurrent(snapshot)).toThrowError(expect.objectContaining({ code: "ASSET_HASH_MISMATCH" }));
    expect(() => snapshotLocalAsset(source, "brand-b", "2026-09-24T00:00:00.000Z")).toThrowError(expect.objectContaining({ code: "ASSET_BRAND_MISMATCH" }));
    expect(() => snapshotLocalAsset({ ...source, filePath: join(tmpdir(), "missing-toutiao-asset.png") }, "brand-a", "2026-09-24T00:00:00.000Z")).toThrowError(expect.objectContaining({ code: "ASSET_NOT_FOUND" }));
  });

  it("reuses an upload result only for the same account and byte hash", () => {
    const sourceHash = snapshotLocalAsset(asset("shared", "shared.png"), "brand-a", "2026-09-24T00:00:00.000Z").byteSha256;
    const key = makeAssetUploadKey("toutiao", "account-a", sourceHash);
    const cache = new ToutiaoUploadResultMap();
    cache.put({ key, platform: "toutiao", accountId: "account-a", sourceHash, remoteAssetId: "remote-a", remoteUrl: "https://example.invalid/a", status: "UPLOADED", createdAt: "2026-09-24T00:00:00.000Z", validatedAt: null });
    expect(cache.get("account-a", sourceHash)?.remoteAssetId).toBe("remote-a");
    expect(cache.get("account-b", sourceHash)).toBeNull();
    expect(() => cache.put({ key, platform: "toutiao", accountId: "account-b", sourceHash, remoteAssetId: "wrong", remoteUrl: "https://example.invalid/wrong", status: "UPLOADED", createdAt: "2026-09-24T00:00:00.000Z", validatedAt: null })).toThrowError(expect.objectContaining({ code: "PAYLOAD_BINDING_MISMATCH" }));
    cache.put({ key, platform: "toutiao", accountId: "account-a", sourceHash, remoteAssetId: "remote-a", remoteUrl: "https://example.invalid/a", status: "EXPIRED", createdAt: "2026-09-24T00:00:00.000Z", validatedAt: "2026-09-25T00:00:00.000Z" });
    expect(cache.get("account-a", sourceHash)).toBeNull();
  });
});
