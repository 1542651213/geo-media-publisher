import { describe, expect, it } from "vitest";
import { assertDouyinImageTextTitle, douyinImageTextTitleError, b01ArticleMarker } from "@publisher/domain";

describe("Douyin title pre-boundary validation", () => {
  it("accepts exactly 20 title units and fails closed before platform truncation", () => {
    expect(() => assertDouyinImageTextTitle("中".repeat(20))).not.toThrow();
    expect(() => assertDouyinImageTextTitle("A".repeat(21))).toThrow("20");
    expect(douyinImageTextTitleError(" ")).not.toBeNull();
    expect(douyinImageTextTitleError("室内空气管理 B01-A7F39C")).toBeNull();
    expect(douyinImageTextTitleError("😀".repeat(11))).not.toBeNull();
  });
  it("requires the same short unique marker in title and body only for B01", () => {
    expect(b01ArticleMarker("室内空气管理 B01-A7F39C", "通风记录 B01-A7F39C")).toBe("B01-A7F39C");
    expect(b01ArticleMarker("B01-A7F39C", "B01-B12345")).toBeNull();
    expect(b01ArticleMarker("B01-A7F39C B01-B12345", "B01-A7F39C")).toBeNull();
  });
});

