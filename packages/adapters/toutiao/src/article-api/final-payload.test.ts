import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashToutiaoContentBinding } from "@publisher/domain";
import { buildToutiaoFinalPayload, hashToutiaoFinalPayload, type ToutiaoRemoteAssetResolution } from "./final-payload";
import { prepareToutiaoArticlePayload } from "./payload";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "toutiao-final-")); dirs.push(dir);
  const filePath = join(dir, "asset.png"); writeFileSync(filePath, "image bytes");
  const input = { jobId: "job", articleId: "article", accountId: "account", brandId: "brand", title: "图文标题",
    html: '<p>正文<img src="asset://image"></p>', settings: { version: 1 as const, coverMode: "single" as const,
      coverImages: ["image"], articleAdType: "none" as const, remoteScheduledAt: null as string | null },
    resolveAsset: (id: string) => id === "image" ? { assetId: "image", brandId: "brand", filePath, mimeType: "image/png", width: null, height: null } : null,
    now: new Date("2026-09-24T00:00:00.000Z") };
  const prepared = prepareToutiaoArticlePayload(input);
  const resolution: ToutiaoRemoteAssetResolution = { platform: "toutiao", uploadKey: prepared.payload.coverUploadKeys[0]!,
    sourceByteSha256: prepared.payload.assetSnapshots[0]!.byteSha256, remoteAssetId: "remote-1", remoteUrl: "https://p3.toutiaoimg.com/image-1",
    accountId: "account", status: "VALIDATED", createdAt: "2026-09-24T01:00:00.000Z", validatedAt: "2026-09-24T02:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z" };
  return { input, prepared, resolution };
}

describe("Toutiao final payload binding", () => {
  it("requires every local asset and rejects wrong account, source bytes, expiry or fake URL", () => {
    const { prepared, resolution } = fixture();
    expect(buildToutiaoFinalPayload(prepared.payload, prepared.contentBindingHash, [])).toEqual({ state: "REMOTE_ASSET_RESOLUTION_REQUIRED", missingUploadKeys: [resolution.uploadKey] });
    const external = { ...prepared.payload, normalizedHtml: '<img src="https://external.example/image.png">' };
    expect(buildToutiaoFinalPayload(external, hashToutiaoContentBinding(external), [])).toMatchObject({ state: "REMOTE_ASSET_RESOLUTION_REQUIRED", reasonCode: "UNRESOLVED_IMAGE_SOURCE" });
    for (const wrong of [{ ...resolution, accountId: "other" }, { ...resolution, sourceByteSha256: "a".repeat(64) },
      { ...resolution, expiresAt: "2026-09-24T00:00:00.000Z" }, { ...resolution, remoteUrl: "https://example.invalid/fake" }]) {
      expect(() => buildToutiaoFinalPayload(prepared.payload, prepared.contentBindingHash, [wrong], new Date("2026-09-25T00:00:00.000Z"))).toThrowError(expect.objectContaining({ code: "PAYLOAD_BINDING_MISMATCH" }));
    }
    expect(() => buildToutiaoFinalPayload(prepared.payload, prepared.contentBindingHash, [resolution, { ...resolution, remoteAssetId: "ambiguous" }])).toThrowError(expect.objectContaining({ code: "PAYLOAD_BINDING_MISMATCH" }));
    expect(() => buildToutiaoFinalPayload(prepared.payload, "b".repeat(64), [resolution])).toThrowError(expect.objectContaining({ code: "PAYLOAD_BINDING_MISMATCH" }));
  });

  it("reuses one resolved image for body and cover and excludes operational times from the final hash", () => {
    const { prepared, resolution } = fixture();
    const now = new Date("2026-09-26T00:00:00.000Z");
    const first = buildToutiaoFinalPayload(prepared.payload, prepared.contentBindingHash, [resolution], now);
    const later = buildToutiaoFinalPayload(prepared.payload, prepared.contentBindingHash, [{ ...resolution, createdAt: "2026-09-25T01:00:00.000Z", validatedAt: "2026-09-25T02:00:00.000Z" }], now);
    expect(first.state).toBe("FINAL_PAYLOAD_READY");
    expect(later.state).toBe("FINAL_PAYLOAD_READY");
    if (first.state !== "FINAL_PAYLOAD_READY" || later.state !== "FINAL_PAYLOAD_READY") return;
    expect(first.payload.html).toContain(resolution.remoteUrl);
    expect(first.payload.coverAssets[0]?.remoteUrl).toBe(resolution.remoteUrl);
    expect(first.finalPayloadHash).toBe(later.finalPayloadHash);
    expect(hashToutiaoFinalPayload({ ...first.payload, title: "别的标题" })).not.toBe(first.finalPayloadHash);
    expect(hashToutiaoFinalPayload({ ...first.payload, html: "别的正文" })).not.toBe(first.finalPayloadHash);
    expect(hashToutiaoFinalPayload({ ...first.payload, remoteScheduledAt: "2026-09-26T00:00:00.000Z" })).not.toBe(first.finalPayloadHash);
    expect(hashToutiaoFinalPayload({ ...first.payload, coverAssets: [{ ...first.payload.coverAssets[0]!, remoteAssetId: "different-cover" }] })).not.toBe(first.finalPayloadHash);
    const changedUrl = buildToutiaoFinalPayload(prepared.payload, prepared.contentBindingHash, [{ ...resolution, remoteUrl: "https://p3.toutiaoimg.com/image-2" }], now);
    expect(changedUrl.state).toBe("FINAL_PAYLOAD_READY");
    if (changedUrl.state === "FINAL_PAYLOAD_READY") expect(changedUrl.finalPayloadHash).not.toBe(first.finalPayloadHash);
    expect(hashToutiaoContentBinding({ ...prepared.payload, preparedAt: "later" } as typeof prepared.payload)).toBe(prepared.contentBindingHash);
  });
});
