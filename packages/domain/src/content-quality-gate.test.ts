import { describe, expect, it } from "vitest";
import { evaluateContentQualityGate } from "./content-quality-gate";

describe("evaluateContentQualityGate", () => {
  it("passes valid content", () => {
    expect(evaluateContentQualityGate({ title: "标题", body: "正文", imageCount: 3 })).toEqual({
      passed: true,
      checks: {
        titleLength: { passed: true, actual: 2, minimum: 1, maximum: 100 },
        bodyLength: { passed: true, actual: 2, minimum: 1, maximum: 10_000 },
        imageCount: { passed: true, actual: 3, minimum: 0, maximum: 18 }
      },
      failureCodes: []
    });
  });

  it("rejects empty and too-long titles", () => {
    expect(evaluateContentQualityGate({ title: "", body: "正文", imageCount: 0 }).failureCodes).toEqual(["TITLE_LENGTH_INVALID"]);
    expect(evaluateContentQualityGate({ title: "a".repeat(101), body: "正文", imageCount: 0 }).failureCodes).toEqual(["TITLE_LENGTH_INVALID"]);
  });

  it("rejects empty and too-long bodies", () => {
    expect(evaluateContentQualityGate({ title: "标题", body: "", imageCount: 0 }).failureCodes).toEqual(["BODY_LENGTH_INVALID"]);
    expect(evaluateContentQualityGate({ title: "标题", body: "a".repeat(10_001), imageCount: 0 }).failureCodes).toEqual(["BODY_LENGTH_INVALID"]);
  });

  it("rejects more than 18 images", () => {
    const result = evaluateContentQualityGate({ title: "标题", body: "正文", imageCount: 19 });
    expect(result.failureCodes).toEqual(["IMAGE_COUNT_INVALID"]);
    expect(result.checks.imageCount).toEqual({ passed: false, actual: 19, minimum: 0, maximum: 18 });
  });

  it("rejects fractional and negative image counts", () => {
    expect(evaluateContentQualityGate({ title: "标题", body: "正文", imageCount: 1.5 }).failureCodes).toEqual(["IMAGE_COUNT_INVALID"]);
    expect(evaluateContentQualityGate({ title: "标题", body: "正文", imageCount: -1 }).failureCodes).toEqual(["IMAGE_COUNT_INVALID"]);
  });

  it("counts emoji as one Unicode code point", () => {
    const result = evaluateContentQualityGate({ title: "😀", body: "😀", imageCount: 0 });
    expect(result.checks.titleLength.actual).toBe(1);
    expect(result.checks.bodyLength.actual).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("returns simultaneous failures in deterministic order", () => {
    const result = evaluateContentQualityGate({ title: "", body: "", imageCount: 19 });
    expect(result.failureCodes).toEqual(["TITLE_LENGTH_INVALID", "BODY_LENGTH_INVALID", "IMAGE_COUNT_INVALID"]);
    expect(result.passed).toBe(false);
  });
});
