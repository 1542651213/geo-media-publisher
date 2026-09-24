import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertPreparedPayloadBinding, prepareToutiaoArticlePayload } from "./payload";
import type { LocalAssetSource } from "./assets";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "toutiao-payload-")); dirs.push(dir);
  const filePath = join(dir, "image.png"); writeFileSync(filePath, "image bytes");
  const image: LocalAssetSource = { assetId: "image-a", brandId: "brand-a", filePath, mimeType: "image/png", width: null, height: null };
  const input = {
    jobId: "job-a", articleId: "article-a", accountId: "account-a", brandId: "brand-a", title: "标题 A", html: '<p>正文<img src="asset://image-a"></p>',
    settings: { version: 1 as const, coverMode: "single" as const, coverImages: ["image-a"], articleAdType: "none" as const, remoteScheduledAt: null as string | null },
    resolveAsset: (id: string) => id === "image-a" ? image : null,
    now: new Date("2026-09-24T00:00:00.000Z"), platformHostedDomains: ["p3.toutiaoimg.com"]
  };
  return { input, filePath };
}

describe("Toutiao prepared payload binding", () => {
  it("freezes a deterministic payload and reuses body image as its cover", () => {
    const { input } = fixture();
    const first = prepareToutiaoArticlePayload(input);
    const second = prepareToutiaoArticlePayload(input);
    expect(first.payloadHash).toBe(second.payloadHash);
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.payload.assetSnapshots).toHaveLength(1);
    expect(first.payload.bodyImageUploadKeys[0]).toBe(first.payload.coverUploadKeys[0]);
    expect(Object.isFrozen(first.payload)).toBe(true);
    expect(first.payload.normalizedHtml).toContain("asset://sha256/");
    assertPreparedPayloadBinding(first.payload, first.payloadHash);
  });

  it("binds title, HTML, cover, asset bytes and remote schedule", () => {
    const { input, filePath } = fixture();
    const original = prepareToutiaoArticlePayload(input);
    expect(prepareToutiaoArticlePayload({ ...input, title: "标题 B" }).payloadHash).not.toBe(original.payloadHash);
    expect(prepareToutiaoArticlePayload({ ...input, html: "不同正文" }).payloadHash).not.toBe(original.payloadHash);
    expect(prepareToutiaoArticlePayload({ ...input, settings: { ...input.settings, coverMode: "none", coverImages: [] } }).payloadHash).not.toBe(original.payloadHash);
    expect(prepareToutiaoArticlePayload({ ...input, settings: { ...input.settings, remoteScheduledAt: "2026-09-25T08:00:00Z" } }).payloadHash).not.toBe(original.payloadHash);
    writeFileSync(filePath, "different bytes");
    expect(prepareToutiaoArticlePayload(input).payloadHash).not.toBe(original.payloadHash);
    expect(() => assertPreparedPayloadBinding({ ...original.payload, title: "mutated" }, original.payloadHash)).toThrowError(expect.objectContaining({ code: "PAYLOAD_BINDING_MISMATCH" }));
  });

  it("does not follow later source article changes and rejects unresolved external images", () => {
    const { input } = fixture();
    const prepared = prepareToutiaoArticlePayload(input);
    input.title = "later article edit";
    input.html = "later body edit";
    expect(prepared.payload.title).toBe("标题 A");
    expect(prepared.payloadHash).toBe(prepared.payloadHash);
    expect(() => prepareToutiaoArticlePayload({ ...input, html: '<img src="https://external.example/image.png">' })).toThrowError(expect.objectContaining({ code: "UNRESOLVED_EXTERNAL_IMAGE" }));
  });
});
