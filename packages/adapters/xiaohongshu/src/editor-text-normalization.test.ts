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

  it("accepts only redundant empty rich-text blocks between existing paragraphs", () => {
    const expected = "第一段。\n\n第二段。";
    const actual = "第一段。\n\n\n\n\n第二段。";

    const result = classifyXiaohongshuEditorReadback(expected, actual);

    expect(result.status).toBe("PASS_WITH_NORMALIZATION");
    expect(result.canonicalizationVersion).toBe("xhs-editor-canonical-v1");
    expect(result.normalizationReasons).toContain("BLANK_LINE_RUN_NORMALIZED");
    expect(classifyXiaohongshuEditorReadback("第一行\n第二行", "第一行\n\n第二行").status).toBe("FAIL");
  });

  it("normalizes CR-only lines, narrow no-break spaces, tabs, and editor edge whitespace", () => {
    const expected = "首行\n次行 内容";
    const actual = "\t首行\r次行\u202f  内容\t\r\n";

    const result = classifyXiaohongshuEditorReadback(expected, actual);

    expect(result.status).toBe("PASS_WITH_NORMALIZATION");
    expect(result.normalizationReasons).toEqual(expect.arrayContaining([
      "CR_TO_LF",
      "NARROW_NBSP_TO_SPACE",
      "TAB_TO_SPACE",
      "SPACE_RUN_NORMALIZED",
      "LEADING_WHITESPACE_TRIMMED",
      "TRAILING_WHITESPACE_TRIMMED"
    ]));
  });

  it("removes formatting zero-width characters and BOM but preserves ZWJ and ZWNJ", () => {
    const formatting = classifyXiaohongshuEditorReadback("正文", "\ufeff正\u200b文\u2060");

    expect(formatting.status).toBe("PASS_WITH_NORMALIZATION");
    expect(formatting.normalizationReasons).toEqual(expect.arrayContaining(["BOM_REMOVED", "ZERO_WIDTH_REMOVED"]));

    const zwj = classifyXiaohongshuEditorReadback("👩‍💻", "👩💻");
    const zwnj = classifyXiaohongshuEditorReadback("می\u200cشود", "میشود");
    expect(zwj.status).toBe("FAIL");
    expect(zwnj.status).toBe("FAIL");
  });

  it("keeps bounded code-point diff context for emoji and combining-character mismatches", () => {
    const result = classifyXiaohongshuEditorReadback("前🙂e\u0301后", "前🙃e\u0301后");

    expect(result.status).toBe("FAIL");
    expect(result.firstDifferenceIndex).toBe(1);
    expect(result.expectedCodePoint).toBe(0x1f642);
    expect(result.actualCodePoint).toBe(0x1f643);
    expect(result.expectedContextBeforeAfter).toBe("前🙂é后");
    expect(result.actualContextBeforeAfter).toBe("前🙃é后");
  });

  it("does not hide a semantic punctuation or whitespace difference", () => {
    const punctuation = classifyXiaohongshuEditorReadback("正文。", "正文！");
    const spacing = classifyXiaohongshuEditorReadback("a b", "ab");

    expect(punctuation.status).toBe("FAIL");
    expect(spacing.status).toBe("FAIL");
  });

  it("records the explicit fullwidth vertical-bar compatibility normalization", () => {
    const result = classifyXiaohongshuEditorReadback("标题|请忽略", "标题｜请忽略");

    expect(result.status).toBe("PASS_WITH_NORMALIZATION");
    expect(result.normalizationReasons).toContain("FULLWIDTH_VERTICAL_BAR_TO_ASCII");
  });

  it("handles empty and long bodies without unbounded evidence", () => {
    expect(classifyXiaohongshuEditorReadback("", "").status).toBe("PASS");
    const expected = "x".repeat(10_000);
    const actual = `${expected.slice(0, 9_999)}y`;
    const result = classifyXiaohongshuEditorReadback(expected, actual);

    expect(result.status).toBe("FAIL");
    expect(result.expectedContextBeforeAfter.length).toBeLessThanOrEqual(41);
    expect(result.actualContextBeforeAfter.length).toBeLessThanOrEqual(41);
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
