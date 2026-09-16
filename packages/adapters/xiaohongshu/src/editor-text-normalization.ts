import { createHash } from "node:crypto";

/** The three outcomes used by a content readback gate. */
export type XiaohongshuEditorReadbackStatus = "PASS" | "PASS_WITH_NORMALIZATION" | "FAIL";

export interface XiaohongshuEditorReadbackVerification {
  status: XiaohongshuEditorReadbackStatus;
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

/**
 * Normalizes editor text while preserving line boundaries.  The XHS editor
 * can introduce CRLF, non-breaking spaces, horizontal whitespace runs and
 * zero-width formatting characters when it serializes rich text.
 */
export function normalizeXiaohongshuEditorText(value: string): string {
  const stripped = Array.from(value.normalize("NFKC")).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code === 0x0a || code === 0x0d) || (code > 0x1f && code !== 0x7f && code !== 0xad && code !== 0x200b && code !== 0x200c && code !== 0x200d && code !== 0x2060 && code !== 0xfeff);
  }).join("");
  return stripped
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00a0/gu, " ")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/gu, " "))
    .join("\n")
    .trim();
}

/**
 * Compares the raw editor value with the trusted Article body and preserves
 * enough non-content telemetry to diagnose a failed gate safely.
 */
export function classifyXiaohongshuEditorReadback(expected: string, actual: string): XiaohongshuEditorReadbackVerification {
  const normalizedExpected = normalizeXiaohongshuEditorText(expected);
  const normalizedActual = normalizeXiaohongshuEditorText(actual);
  const diff = firstDifference(expected, actual);
  return {
    status: actual === expected ? "PASS" : normalizedActual === normalizedExpected ? "PASS_WITH_NORMALIZATION" : "FAIL",
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
    actualCodePoint: diff.actualCodePoint
  };
}
