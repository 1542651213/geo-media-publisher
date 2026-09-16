import { describe, expect, it } from "vitest";
import { classifyXiaohongshuEditorReadback, normalizeXiaohongshuEditorText } from "./editor-text-normalization";

describe("Xiaohongshu editor body readback", () => {
  it("reports an exact body match as PASS with raw telemetry", () => {
    const result = classifyXiaohongshuEditorReadback("正文 A", "正文 A");

    expect(result.status).toBe("PASS");
    expect(result.expectedLength).toBe(4);
    expect(result.actualLength).toBe(4);
    expect(result.expectedHash).toMatch(/^[0-9A-F]{64}$/);
    expect(result.actualHash).toBe(result.expectedHash);
    expect(result.firstDifferenceIndex).toBeNull();
  });

  it("accepts CRLF, NBSP, repeated spaces, and zero-width differences with normalization", () => {
    const expected = "第一行\n第二行 文本";
    const actual = "第一行\r\n第二行\u00a0  文本\u200b";

    expect(normalizeXiaohongshuEditorText(actual)).toBe(expected);
    expect(classifyXiaohongshuEditorReadback(expected, actual).status).toBe("PASS_WITH_NORMALIZATION");
  });

  it("accepts rich-text innerText block boundaries after normalization", () => {
    const expected = "第一段\n第二段";
    const innerText = "第一段\r\n第二段\u200b";

    expect(classifyXiaohongshuEditorReadback(expected, innerText).status).toBe("PASS_WITH_NORMALIZATION");
  });

  it("reports a failed body match with the first differing code point", () => {
    const result = classifyXiaohongshuEditorReadback("正文 ABC", "正文 ABD");

    expect(result.status).toBe("FAIL");
    expect(result.firstDifferenceIndex).toBe(5);
    expect(result.expectedCharacter).toBe("C");
    expect(result.actualCharacter).toBe("D");
    expect(result.expectedHash).not.toBe(result.actualHash);
    expect(result.expectedLength).toBe(6);
    expect(result.actualLength).toBe(6);
  });
});
