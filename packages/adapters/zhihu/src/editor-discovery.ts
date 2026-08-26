import { BrowserAutomationError } from "@publisher/adapters-browser";
import type { Locator, Page } from "playwright-core";

export type ZhihuEditorField = "title" | "body";
export type ZhihuEditorFailureCode = "CONTENT_EDITOR_AMBIGUOUS" | "CONTENT_TITLE_NOT_VERIFIED" | "CONTENT_BODY_NOT_VERIFIED";

export interface ZhihuEditorCandidateEvidence {
  field: ZhihuEditorField;
  selector: string;
  count: number;
  visible: boolean;
  enabled: boolean;
  attributes: Record<string, string>;
  semanticScore: number;
  structuralSignals: string[];
}

export interface ZhihuEditorHandle {
  locator: Locator;
  evidence: ZhihuEditorCandidateEvidence;
}

export class ZhihuEditorVerificationError extends BrowserAutomationError {
  readonly editorCode: ZhihuEditorFailureCode;

  constructor(editorCode: ZhihuEditorFailureCode, message: string) {
    super("CONTENT_REJECTED", `${editorCode}: ${message}`);
    this.name = "ZhihuEditorVerificationError";
    this.editorCode = editorCode;
  }
}

const ZHIHU_TITLE_SELECTORS = [
  'input[placeholder*="\u6807\u9898"], textarea[placeholder*="\u6807\u9898"], input[aria-label*="\u6807\u9898"], textarea[aria-label*="\u6807\u9898"]',
  'input[name*="title" i], textarea[name*="title" i], input[id*="title" i], textarea[id*="title" i]',
  'input[placeholder], textarea[placeholder]'
];

const ZHIHU_BODY_SELECTORS = [
  '.DraftEditor-root [contenteditable="true"], .public-DraftEditor-content[contenteditable="true"], [role="textbox"][contenteditable="true"]',
  '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label], [contenteditable="true"][data-placeholder]',
  'textarea[name*="body" i], textarea[id*="body" i], textarea[aria-label*="body" i]'
];

const ATTRIBUTE_NAMES = ["placeholder", "aria-label", "role", "name", "id", "class", "contenteditable", "data-placeholder"] as const;

function failureCode(field: ZhihuEditorField): ZhihuEditorFailureCode {
  return field === "title" ? "CONTENT_TITLE_NOT_VERIFIED" : "CONTENT_BODY_NOT_VERIFIED";
}

function selectorList(field: ZhihuEditorField): string[] { return field === "title" ? ZHIHU_TITLE_SELECTORS : ZHIHU_BODY_SELECTORS; }

async function count(locator: Locator): Promise<number> {
  const candidate = locator as unknown as { count?: () => Promise<number> };
  return typeof candidate.count === "function" ? await candidate.count() : 1;
}

async function first(locator: Locator): Promise<Locator> {
  const candidate = locator as unknown as { first?: () => Locator };
  return typeof candidate.first === "function" ? candidate.first() : locator;
}

async function attribute(locator: Locator, name: string): Promise<string> {
  const candidate = locator as unknown as { getAttribute?: (attributeName: string) => Promise<string | null> };
  if (typeof candidate.getAttribute !== "function") return "";
  return (await candidate.getAttribute(name).catch(() => null))?.trim() ?? "";
}

async function visible(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isVisible?: () => Promise<boolean> };
  return typeof candidate.isVisible === "function" ? await candidate.isVisible().catch(() => false) : true;
}

async function enabled(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isEnabled?: () => Promise<boolean> };
  return typeof candidate.isEnabled === "function" ? await candidate.isEnabled().catch(() => false) : true;
}

function scoreCandidate(field: ZhihuEditorField, attributes: Record<string, string>): { score: number; signals: string[] } {
  const semantic = Object.entries(attributes).map(([key, value]) => `${key}:${value}`).join(" ").toLowerCase();
  const signals: string[] = [];
  let score = 0;
  if (field === "title") {
    if (/title|\u6807\u9898/iu.test(semantic)) { score += 5; signals.push("title-semantic-attribute"); }
    if (/placeholder|aria-label/iu.test(semantic)) { score += 2; signals.push("accessible-label"); }
    if (/^(input|textarea)$/iu.test(attributes.tag ?? "")) { score += 2; signals.push("text-input-structure"); }
  } else {
    if (attributes.contenteditable === "true") { score += 5; signals.push("contenteditable"); }
    if (/textbox/iu.test(attributes.role)) { score += 3; signals.push("textbox-role"); }
    if (/drafteditor|public-draft|prosemirror|editor|正文|body/iu.test(semantic)) { score += 3; signals.push("rich-text-semantic-structure"); }
  }
  return { score, signals };
}

async function candidateFor(root: Page | Locator, field: ZhihuEditorField, selector: string): Promise<ZhihuEditorHandle | null> {
  const locator = root.locator(selector);
  const candidateCount = await count(locator);
  if (candidateCount === 0) return null;
  if (candidateCount > 1) {
    throw new ZhihuEditorVerificationError("CONTENT_EDITOR_AMBIGUOUS", `${field} selector ${selector} matched ${candidateCount} visible candidates`);
  }
  const item = await first(locator);
  const isVisible = await visible(item);
  const isEnabled = await enabled(item);
  if (!isVisible || !isEnabled) return null;
  const attributes: Record<string, string> = {};
  for (const name of ATTRIBUTE_NAMES) attributes[name] = await attribute(item, name);
  const tag = await attribute(item, "tagName");
  if (tag) attributes.tag = tag;
    const scored = scoreCandidate(field, attributes);
    if (field === "body" && scored.signals.length === 0 && !/contenteditable/iu.test(selector)) return null;
    return { locator: item, evidence: { field, selector, count: candidateCount, visible: isVisible, enabled: isEnabled, attributes, semanticScore: scored.score, structuralSignals: scored.signals } };
}

async function roots(page: Page): Promise<Array<Page | Locator>> {
  const output: Array<Page | Locator> = [page];
  const candidate = page as unknown as { frames?: () => Array<{ url: () => string; locator: (selector: string) => Locator }> };
  if (typeof candidate.frames === "function") {
    for (const frame of candidate.frames()) {
      if (frame.url() !== page.url()) output.push(frame as unknown as Locator);
    }
  }
  return output;
}

export async function discoverZhihuEditor(page: Page, field: ZhihuEditorField): Promise<ZhihuEditorHandle> {
  const candidates: ZhihuEditorHandle[] = [];
  for (const root of await roots(page)) {
    for (const selector of selectorList(field)) {
      const candidate = await candidateFor(root, field, selector);
      if (!candidate) continue;
      const duplicate = candidates.some((existing) => existing.locator === candidate.locator || (existing.evidence.attributes.id && existing.evidence.attributes.id === candidate.evidence.attributes.id));
      if (!duplicate) candidates.push(candidate);
      if (candidate.evidence.semanticScore >= (field === "title" ? 7 : 8)) break;
    }
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) throw new ZhihuEditorVerificationError(failureCode(field), `no visible, enabled ${field} editor candidate was verified`);
  const bestScore = Math.max(...candidates.map((candidate) => candidate.evidence.semanticScore));
  const best = candidates.filter((candidate) => candidate.evidence.semanticScore === bestScore);
  if (best.length !== 1) throw new ZhihuEditorVerificationError("CONTENT_EDITOR_AMBIGUOUS", `${field} has ${best.length} equally scored editor candidates`);
  return best[0];
}

export function normalizeEditorText(value: string): string {
  const stripped = Array.from(value.normalize("NFKC")).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 0x1f && code !== 0x7f && code !== 0xad && code !== 0x200b && code !== 0x200c && code !== 0x200d && code !== 0x2060 && code !== 0xfeff;
  }).join("");
  return stripped.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/[ ]+/gu, " ").trim();
}

export async function readZhihuEditorValue(handle: ZhihuEditorHandle, field: ZhihuEditorField): Promise<string> {
  const locator = handle.locator as unknown as { inputValue?: () => Promise<string>; innerText?: () => Promise<string>; textContent?: () => Promise<string | null> };
  const value = field === "title" && typeof locator.inputValue === "function"
    ? await locator.inputValue().catch(() => "")
    : typeof locator.innerText === "function"
      ? await locator.innerText().catch(() => "")
      : typeof locator.textContent === "function"
        ? await locator.textContent().then((text) => text ?? "").catch(() => "")
        : "";
  return normalizeEditorText(value);
}

export function assertZhihuReadback(field: ZhihuEditorField, expected: string, actual: string): void {
  if (normalizeEditorText(expected) !== normalizeEditorText(actual)) throw new ZhihuEditorVerificationError(failureCode(field), `${field} readback differs from the requested content`);
}
