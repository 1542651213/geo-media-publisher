import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { ContentSnapshot } from "@publisher/domain";
import { ContentSnapshots } from "./content-snapshots";

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const snapshot = (): ContentSnapshot => ({
  id: "snapshot-1", purpose: "PRODUCTION", platformKey: "kangyi_website", contentType: "article", accountId: "account-1", creatorId: null,
  subjectEvidence: "DATABASE_ONLY_NOT_RUNTIME_VERIFIED", sourceArticleId: "article-1", sourceVariantId: null, operationId: null,
  rawTitle: "标题", rawBody: "正文", rawTitleSha256: "title-hash", rawBodySha256: "body-hash", canonicalTitle: "标题", canonicalBody: "正文",
  canonicalTitleSha256: "title-hash", canonicalBodySha256: "body-hash", normalizationVersion: "line-endings-v1", normalizationReasons: [], summary: "摘要", tags: ["标签"],
  images: [{ assetId: "asset-1", sourcePath: "C:\\mutable\\cover.png", sha256, name: "cover.png", mimeType: "image/png" }]
});

describe("immutable ContentSnapshot adapter input", () => {
  it("returns stored immutable bytes and hash without reopening the mutable source path", () => {
    const storedBytes = Buffer.from(bytes);
    const db = { prepare: () => ({ get: () => ({ bytes: storedBytes }) }) } as unknown as Database.Database;
    const snapshots = new ContentSnapshots(db);
    const currentSnapshot = snapshot();
    const bound = snapshots.historicalInput(currentSnapshot, "article-1");
    currentSnapshot.images[0]!.sourcePath = "C:\\mutable\\changed-after-snapshot.png";
    const reconstructed = snapshots.historicalInput(currentSnapshot, "article-1");
    expect(bound.boundImages?.[0]).toMatchObject({ assetId: "asset-1", sha256, mimeType: "image/png" });
    expect(reconstructed.boundImages?.[0]?.buffer).toEqual(bytes);
    expect(reconstructed.boundImages?.[0]?.sha256).toBe(sha256);
    expect(reconstructed.images).toEqual(["C:\\mutable\\changed-after-snapshot.png"]);
  });
});
