import { createHash } from "node:crypto";

/** The three outcomes used by a content readback gate. */
export type XiaohongshuEditorReadbackStatus = "PASS" | "PASS_WITH_NORMALIZATION" | "FAIL";

export const XIAOHONGSHU_EDITOR_CANONICALIZATION_VERSION = "xhs-editor-canonical-v1" as const;

/**
 * Only transformations known to be introduced by the XHS editor serializer
 * are reported here.  Semantic joiner characters (ZWJ/ZWNJ) are deliberately
 * left out so a real content change cannot be hidden by the readback gate.
 */
export type XiaohongshuEditorNormalizationReason =
  | "CRLF_TO_LF"
  | "CR_TO_LF"
  | "NBSP_TO_SPACE"
  | "NARROW_NBSP_TO_SPACE"
  | "FULLWIDTH_VERTICAL_BAR_TO_ASCII"
  | "ZERO_WIDTH_REMOVED"
  | "BOM_REMOVED"
  | "TAB_TO_SPACE"
  | "SPACE_RUN_NORMALIZED"
  | "BLANK_LINE_RUN_NORMALIZED"
  | "LEADING_WHITESPACE_TRIMMED"
  | "TRAILING_WHITESPACE_TRIMMED";

export interface XiaohongshuEditorReadbackVerification {
  status: XiaohongshuEditorReadbackStatus;
  canonicalizationVersion: typeof XIAOHONGSHU_EDITOR_CANONICALIZATION_VERSION;
  expectedLength: number;
  actualLength: number;
  expectedHash: string;
  actualHash: string;
  expectedNormalizedLength: number;
  actualNormalizedLength: number;
  expectedNormalizedHash: string;
  actualNormalizedHash: string;
  firstDifferenceIndex: number | null;
  expectedCharacter: string | null;
  actualCharacter: string | null;
  expectedCodePoint: number | null;
  actualCodePoint: number | null;
  normalizationReasons: XiaohongshuEditorNormalizationReason[];
  expectedContextBeforeAfter: string;
  actualContextBeforeAfter: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function firstDifference(expected: string, actual: string): {
  index: number | null;
  expectedCharacter: string | null;
  actualCharacter: string | null;
  expectedCodePoint: number | null;
  actualCodePoint: number | null;
} {
  const expectedCharacters = Array.from(expected);
  const actualCharacters = Array.from(actual);
  const limit = Math.max(expectedCharacters.length, actualCharacters.length);
  for (let index = 0; index < limit; index += 1) {
    const expectedCharacter = expectedCharacters[index] ?? null;
    const actualCharacter = actualCharacters[index] ?? null;
    if (expectedCharacter !== actualCharacter) {
      return {
        index,
        expectedCharacter,
        actualCharacter,
        expectedCodePoint: expectedCharacter === null ? null : expectedCharacter.codePointAt(0) ?? null,
        actualCodePoint: actualCharacter === null ? null : actualCharacter.codePointAt(0) ?? null
      };
    }
  }
  return { index: null, expectedCharacter: null, actualCharacter: null, expectedCodePoint: null, actualCodePoint: null };
}

function boundedContext(value: string, index: number | null, radius = 20): string {
  if (index === null) return "";
  const characters = Array.from(value);
  return characters.slice(Math.max(0, index - radius), index + radius + 1).join("");
}

function normalizeWithReasons(value: string): { value: string; reasons: XiaohongshuEditorNormalizationReason[] } {
  const reasons = new Set<XiaohongshuEditorNormalizationReason>();
  let normalized = value;

  if (/\r\n/gu.test(normalized)) reasons.add("CRLF_TO_LF");
  if (/(?<!\r)\r(?!\n)|^\r/gu.test(normalized)) reasons.add("CR_TO_LF");
  if (/\u00a0/gu.test(normalized)) reasons.add("NBSP_TO_SPACE");
  if (/\u202f/gu.test(normalized)) reasons.add("NARROW_NBSP_TO_SPACE");
  if (/｜/gu.test(normalized)) reasons.add("FULLWIDTH_VERTICAL_BAR_TO_ASCII");
  if (/[\u200b\u2060]/gu.test(normalized)) reasons.add("ZERO_WIDTH_REMOVED");
  if (/\ufeff/gu.test(normalized)) reasons.add("BOM_REMOVED");
  if (/\t/gu.test(normalized)) reasons.add("TAB_TO_SPACE");

  normalized = normalized
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00a0|\u202f/gu, " ")
    // XHS may serialize the title separator as a fullwidth vertical bar;
    // keep this compatibility conversion explicit rather than applying NFKC
    // to unrelated CJK punctuation.
    .replace(/｜/gu, "|")
    // These are formatting artifacts, unlike ZWJ/ZWNJ which are semantic.
    .replace(/[\u200b\u2060\ufeff]/gu, "")
    .split("\n")
    .map((line) => {
      if (/[ ]{2,}/gu.test(line) || /\t/gu.test(line)) reasons.add("SPACE_RUN_NORMALIZED");
      return line.replace(/[\t ]+/gu, " ");
    })
    .join("\n");

  // The rich-text editor can serialize one logical paragraph separator as
  // several empty block boundaries in innerText. Keep a single blank line so
  // paragraph structure remains visible, but do not treat redundant empty
  // blocks as a content mutation.
  if (/\n{3,}/gu.test(normalized)) reasons.add("BLANK_LINE_RUN_NORMALIZED");
  normalized = normalized.replace(/\n{3,}/gu, "\n\n");

  const trimmed = normalized.replace(/^[ \t\n]+/gu, "").replace(/[ \t\n]+$/gu, "");
  if (trimmed.length !== normalized.length) {
    const leadingRemoved = normalized.length - normalized.replace(/^[ \t\n]+/gu, "").length;
    if (leadingRemoved > 0) reasons.add("LEADING_WHITESPACE_TRIMMED");
    const trailingRemoved = normalized.length - normalized.replace(/[ \t\n]+$/gu, "").length;
    if (trailingRemoved > 0) reasons.add("TRAILING_WHITESPACE_TRIMMED");
  }

  return { value: trimmed, reasons: [...reasons] };
}

/**
 * Normalizes editor text while preserving line boundaries.  The XHS editor
 * can introduce CRLF, non-breaking spaces, horizontal whitespace runs and
 * zero-width formatting characters when it serializes rich text.
 */
export function normalizeXiaohongshuEditorText(value: string): string {
  return normalizeWithReasons(value).value;
}

/**
 * Compares the raw editor value with the trusted Article body and preserves
 * enough non-content telemetry to diagnose a failed gate safely.
 */
export function classifyXiaohongshuEditorReadback(expected: string, actual: string): XiaohongshuEditorReadbackVerification {
  const normalizedExpectedResult = normalizeWithReasons(expected);
  const normalizedActualResult = normalizeWithReasons(actual);
  const normalizedExpected = normalizedExpectedResult.value;
  const normalizedActual = normalizedActualResult.value;
  const diff = firstDifference(expected, actual);
  const normalizationReasons = [...new Set([...normalizedExpectedResult.reasons, ...normalizedActualResult.reasons])];
  return {
    status: actual === expected ? "PASS" : normalizedActual === normalizedExpected ? "PASS_WITH_NORMALIZATION" : "FAIL",
    canonicalizationVersion: XIAOHONGSHU_EDITOR_CANONICALIZATION_VERSION,
    expectedLength: codePointLength(expected),
    actualLength: codePointLength(actual),
    expectedHash: sha256(expected),
    actualHash: sha256(actual),
    expectedNormalizedLength: codePointLength(normalizedExpected),
    actualNormalizedLength: codePointLength(normalizedActual),
    expectedNormalizedHash: sha256(normalizedExpected),
    actualNormalizedHash: sha256(normalizedActual),
    firstDifferenceIndex: diff.index,
    expectedCharacter: diff.expectedCharacter,
    actualCharacter: diff.actualCharacter,
    expectedCodePoint: diff.expectedCodePoint,
    actualCodePoint: diff.actualCodePoint,
    normalizationReasons,
    expectedContextBeforeAfter: boundedContext(expected, diff.index),
    actualContextBeforeAfter: boundedContext(actual, diff.index)
  };
}
