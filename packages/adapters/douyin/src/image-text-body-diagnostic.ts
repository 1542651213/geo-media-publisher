import { createHash } from "node:crypto";
import type { Page } from "playwright-core";
import { readDouyinBodyText } from "./image-text-body-readback";

type CharacterEvidence = { index: number; codePoint: number; hex: string; escaped: string };
type EditOperation = { type: "insert" | "delete" | "substitute"; expectedIndex: number; actualIndex: number;
  expected?: CharacterEvidence; actual?: CharacterEvidence; location: "start" | "internal" | "end" };

export type DouyinBodyTextDiff = {
  expectedUtf16Length: number; actualUtf16Length: number;
  expectedCodePointCount: number; actualCodePointCount: number;
  prefixCodePoints: number; suffixCodePoints: number;
  firstDifference: { expectedCodePointIndex: number; actualCodePointIndex: number;
    expectedUtf16Index: number; actualUtf16Index: number } | null;
  expectedWindow: CharacterEvidence[]; actualWindow: CharacterEvidence[];
  insertions: number; deletions: number; substitutions: number; operations: EditOperation[];
};

function character(value: string, index: number): CharacterEvidence {
  const codePoint = value.codePointAt(0)!;
  return { index, codePoint, hex: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
    escaped: JSON.stringify(value) };
}

/** A complete, bounded Levenshtein script over Unicode code points, without text normalization. */
export function compareDouyinBodyText(expected: string, actual: string): DouyinBodyTextDiff {
  const left = Array.from(expected);
  const right = Array.from(actual);
  if (left.length > 2_000 || right.length > 2_000) throw new Error("DOUYIN_BODY_DIAGNOSTIC_TEXT_TOO_LONG");
  let prefix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(left.length, right.length) - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
  const n = left.length, m = right.length;
  const width = m + 1;
  const distances = new Uint16Array((n + 1) * width);
  for (let i = 0; i <= n; i++) distances[i * width] = i;
  for (let j = 0; j <= m; j++) distances[j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    distances[i * width + j] = left[i - 1] === right[j - 1]
      ? distances[(i - 1) * width + j - 1]!
      : Math.min(distances[(i - 1) * width + j - 1]! + 1,
        distances[(i - 1) * width + j]! + 1, distances[i * width + j - 1]! + 1);
  }
  const reversed: EditOperation[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]
      && distances[i * width + j] === distances[(i - 1) * width + j - 1]) { i--; j--; continue; }
    const cost = distances[i * width + j];
    let type: EditOperation["type"];
    if (i > 0 && j > 0 && cost === distances[(i - 1) * width + j - 1]! + 1) { type = "substitute"; i--; j--; }
    else if (i > 0 && cost === distances[(i - 1) * width + j]! + 1) { type = "delete"; i--; }
    else if (j > 0 && cost === distances[i * width + j - 1]! + 1) { type = "insert"; j--; }
    else throw new Error("DOUYIN_BODY_DIAGNOSTIC_DIFF_INCONSISTENT");
    const location = i === 0 ? "start" : i >= n - (type === "insert" ? 0 : 1) ? "end" : "internal";
    reversed.push({ type, expectedIndex: i, actualIndex: j,
      ...(type !== "insert" ? { expected: character(left[i]!, i) } : {}),
      ...(type !== "delete" ? { actual: character(right[j]!, j) } : {}), location });
  }
  const operations = reversed.reverse();
  const first = operations[0];
  const window = (values: string[], index: number) => values.slice(Math.max(0, index - 4), Math.min(values.length, index + 5))
    .map((value, offset) => character(value, Math.max(0, index - 4) + offset));
  return { expectedUtf16Length: expected.length, actualUtf16Length: actual.length,
    expectedCodePointCount: n, actualCodePointCount: m, prefixCodePoints: prefix, suffixCodePoints: suffix,
    firstDifference: first ? { expectedCodePointIndex: first.expectedIndex, actualCodePointIndex: first.actualIndex,
      expectedUtf16Index: left.slice(0, first.expectedIndex).join("").length,
      actualUtf16Index: right.slice(0, first.actualIndex).join("").length } : null,
    expectedWindow: first ? window(left, first.expectedIndex) : [],
    actualWindow: first ? window(right, first.actualIndex) : [],
    insertions: operations.filter((op) => op.type === "insert").length,
    deletions: operations.filter((op) => op.type === "delete").length,
    substitutions: operations.filter((op) => op.type === "substitute").length, operations };
}

type StructureNode = { kind: "element" | "text"; path: string; tagName?: string; utf16Length?: number };
type RawCandidate = { index: number; tagName: string; role: string | null; contenteditable: string | null;
  ariaLabel: string | null; placeholder: string | null; className: string; boundingBox: { x: number; y: number; width: number; height: number };
  visible: boolean; editable: boolean; childElementCount: number; childNodeCount: number;
  directChildTags: string[]; dataKeyNames: string[]; isInsideLikelyEditorContainer: boolean;
  nestedEditable: boolean; containsCounter: boolean; structure: StructureNode[];
  innerText: string; textContent: string; value: string | null };

type TextRepresentation = { utf16Length: number; codePointCount: number; sha256: string; diff: DouyinBodyTextDiff | null };
export type DouyinBodyCandidateDiagnostic = Omit<RawCandidate, "innerText" | "textContent" | "value" | "className"> & {
  classNameSha256: string; selectorProvenance: string;
  innerText: TextRepresentation; textContent: TextRepresentation; adapterExtractor: TextRepresentation;
  value: TextRepresentation | null;
  domGeneratedTextDifference: "YES" | "NO" | "UNKNOWN";
};
export type DouyinBodyPageDiagnostic = { locator: '[contenteditable="true"]'; candidateCount: number;
  selectedCandidateIndex: number | null; candidates: DouyinBodyCandidateDiagnostic[];
  semanticReadback: (TextRepresentation & { terminalPlaceholderIgnored: boolean;
    structureClass: "SLATE_TERMINAL_ZWSP" | "SLATE_PARAGRAPHS" | "SLATE_OTHER" | "NON_SLATE" }) | null };

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Reads only bounded editable candidates on the supplied owned Page; never changes the DOM. */
export async function inspectDouyinBodyPage(page: Page, expected: string): Promise<DouyinBodyPageDiagnostic> {
  const locator = '[contenteditable="true"]' as const;
  const count = await page.locator(locator).count();
  if (count > 12) throw new Error("DOUYIN_BODY_DIAGNOSTIC_TOO_MANY_CANDIDATES");
  const raw = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[contenteditable="true"]')].map((element, index) => {
    const rect = element.getBoundingClientRect();
    const structure: StructureNode[] = [];
    const visit = (node: Node, path: string, depth: number): void => {
      if (structure.length >= 80 || depth > 5) return;
      if (node.nodeType === Node.TEXT_NODE) structure.push({ kind: "text", path, utf16Length: node.textContent?.length ?? 0 });
      else if (node instanceof Element) {
        structure.push({ kind: "element", path, tagName: node.tagName.toLowerCase() });
        [...node.childNodes].forEach((child, childIndex) => visit(child, `${path}.${childIndex}`, depth + 1));
      }
    };
    visit(element, "0", 0);
    return { index, tagName: element.tagName.toLowerCase(), role: element.getAttribute("role"),
      contenteditable: element.getAttribute("contenteditable"), ariaLabel: element.getAttribute("aria-label")?.slice(0, 120) ?? null,
      placeholder: (element.getAttribute("placeholder") ?? element.getAttribute("data-placeholder"))?.slice(0, 120) ?? null,
      className: String(element.className).slice(0, 300),
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: rect.width > 0 && rect.height > 0, editable: element.isContentEditable,
      childElementCount: element.childElementCount, childNodeCount: element.childNodes.length,
      directChildTags: [...element.children].map((child) => child.tagName.toLowerCase()).slice(0, 20),
      dataKeyNames: [...element.attributes].filter((attribute) => attribute.name.startsWith("data-"))
        .map((attribute) => attribute.name).slice(0, 20),
      isInsideLikelyEditorContainer: Boolean(element.closest('main,[class*="editor"],[class*="Editor"],[class*="content"]')),
      nestedEditable: Boolean(element.parentElement?.closest('[contenteditable="true"]')
        || element.querySelector('[contenteditable="true"]')),
      containsCounter: /\b\d+\s*\/\s*\d+\b/u.test(element.textContent ?? ""),
      structure, innerText: element.innerText, textContent: element.textContent ?? "",
      value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : null };
  })) as RawCandidate[];
  if (raw.length !== count) throw new Error("DOUYIN_BODY_DIAGNOSTIC_CANDIDATES_CHANGED");
  const unique = raw.length === 1 ? raw[0] : null;
  const selectedCandidateIndex = unique?.visible && unique.editable && !unique.nestedEditable && !unique.containsCounter ? 0 : null;
  const representation = (value: string, includeDiff: boolean): TextRepresentation => ({ utf16Length: value.length,
    codePointCount: Array.from(value).length, sha256: sha256(value),
    diff: includeDiff ? compareDouyinBodyText(expected, value) : null });
  const candidates: DouyinBodyCandidateDiagnostic[] = [];
  for (const candidate of raw) {
    if (candidate.innerText.length > 2_000 || candidate.textContent.length > 2_000 || (candidate.value?.length ?? 0) > 2_000)
      throw new Error("DOUYIN_BODY_DIAGNOSTIC_TEXT_TOO_LONG");
    const extracted = await page.locator(locator).nth(candidate.index).innerText();
    const { className, innerText, textContent, value, ...safe } = candidate;
    const structuralSeparator = candidate.structure.some((node) => node.tagName === "br" || node.tagName === "p" || node.tagName === "div");
    const includeDiff = candidate.index === selectedCandidateIndex;
    candidates.push({ ...safe, classNameSha256: sha256(className), selectorProvenance: `${locator}:nth(${candidate.index})`,
      innerText: representation(innerText, includeDiff), textContent: representation(textContent, includeDiff),
      adapterExtractor: representation(extracted, includeDiff),
      value: value === null ? null : representation(value, includeDiff),
      domGeneratedTextDifference: innerText === textContent ? "NO"
        : textContent === expected && structuralSeparator ? "YES" : "UNKNOWN" });
  }
  const semantic = selectedCandidateIndex === null ? null : await readDouyinBodyText(page);
  if (semantic && (semantic.rawInnerText !== raw[0]?.innerText || semantic.rawTextContent !== raw[0]?.textContent))
    throw new Error("DOUYIN_BODY_DIAGNOSTIC_EDITOR_CHANGED");
  return { locator, candidateCount: count, selectedCandidateIndex, candidates,
    semanticReadback: semantic ? { ...representation(semantic.semanticText, true),
      terminalPlaceholderIgnored: semantic.terminalPlaceholderIgnored, structureClass: semantic.structureClass } : null };
}
