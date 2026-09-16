import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateTask10sImageAssetBinding, type Task10sFixtureProof, type Task10sImageAssetLike } from "../apps/desktop/src/main/task10s-media-binding";

const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).reverse().forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixtureFor(path: string, bytes: Buffer): Task10sFixtureProof {
  return { path, expectedName: "task10s-safe-test.png", expectedSizeBytes: bytes.byteLength, expectedSha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(), valid: true };
}

function assetFor(path: string, bytes: Buffer): Task10sImageAssetLike {
  return { id: "image-1", filePath: path, originalFileName: "task10s-safe-test.png", mimeType: "image/png", size: bytes.byteLength };
}

describe("Task10S Job-bound media gate", () => {
  it("accepts a persisted ImageAsset whose file matches the verified fixture", () => {
    const directory = mkdtempSync(join(tmpdir(), "task10s-media-binding-")); tempDirs.push(directory);
    const bytes = Buffer.from("real fixture bytes"); const path = join(directory, "task10s-safe-test.png"); writeFileSync(path, bytes);
    expect(validateTask10sImageAssetBinding(assetFor(path, bytes), fixtureFor(path, bytes))).toMatchObject({ status: "PASS", assetId: "image-1", imagePath: path });
  });

  it("fails closed when the Job has no selected ImageAsset", () => {
    const bytes = Buffer.from("real fixture bytes"); const path = join(tmpdir(), "task10s-safe-test.png");
    expect(validateTask10sImageAssetBinding(null, fixtureFor(path, bytes))).toMatchObject({ status: "BLOCKED", failureCode: "JOB_IMAGE_ASSET_MISSING" });
  });

  it("fails closed when the bound ImageAsset file is missing", () => {
    const bytes = Buffer.from("real fixture bytes"); const path = join(tmpdir(), "task10s-missing.png");
    expect(validateTask10sImageAssetBinding(assetFor(path, bytes), fixtureFor(path, bytes))).toMatchObject({ status: "BLOCKED", failureCode: "IMAGE_ASSET_FILE_MISSING" });
  });

  it("fails closed when the bound ImageAsset file hash differs", () => {
    const directory = mkdtempSync(join(tmpdir(), "task10s-media-binding-")); tempDirs.push(directory);
    const expected = Buffer.alloc(16, 1); const actual = Buffer.alloc(16, 2); const path = join(directory, "task10s-safe-test.png"); writeFileSync(path, actual);
    expect(validateTask10sImageAssetBinding(assetFor(path, actual), fixtureFor(path, expected))).toMatchObject({ status: "BLOCKED", failureCode: "IMAGE_ASSET_HASH_MISMATCH" });
  });

  it("fails closed when the fixture proof itself is invalid", () => {
    const bytes = Buffer.from("real fixture bytes"); const path = join(tmpdir(), "task10s-safe-test.png");
    expect(validateTask10sImageAssetBinding(null, { ...fixtureFor(path, bytes), valid: false })).toMatchObject({ status: "BLOCKED", failureCode: "TASK10S_FIXTURE_INVALID" });
  });
});
