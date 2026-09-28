import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimControlledArticleNewCapture, claimControlledPublishRequestCapture } from "../apps/desktop/src/main/toutiao-article-new-once";

describe("controlled Toutiao article/new capture", () => {
  it("durably consumes a single task-wide permit before any request", () => {
    const directory = mkdtempSync(join(tmpdir(), "toutiao-article-new-"));
    try {
      const claimPath = claimControlledArticleNewCapture(directory);
      expect(readFileSync(claimPath, "utf8")).toContain("TOUTIAO_MVP_3_5_CONTROLLED_ARTICLE_NEW_CAPTURE");
      expect(() => claimControlledArticleNewCapture(directory)).toThrow("TOUTIAO_ARTICLE_NEW_ALREADY_CLAIMED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("controlled Toutiao publish request capture", () => {
  it("durably consumes a separate task-wide permit before opening the editor or clicking", () => {
    const directory = mkdtempSync(join(tmpdir(), "toutiao-publish-capture-"));
    try {
      const claimPath = claimControlledPublishRequestCapture(directory);
      expect(readFileSync(claimPath, "utf8")).toContain("TOUTIAO_MVP_4_CONTROLLED_PUBLISH_REQUEST_CAPTURE");
      expect(() => claimControlledPublishRequestCapture(directory)).toThrow("TOUTIAO_PUBLISH_CAPTURE_ALREADY_CLAIMED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
