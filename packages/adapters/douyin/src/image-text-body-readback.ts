import type { Page } from "playwright-core";

export type DouyinBodyReadback = {
  candidateCount: number;
  rawInnerText: string;
  rawTextContent: string;
  semanticText: string;
  terminalPlaceholderIgnored: boolean;
  structureClass: "SLATE_TERMINAL_ZWSP" | "SLATE_OTHER" | "NON_SLATE";
};

/** Read the unique editor. Only the exact observed Slate leaf pair has a removable terminal placeholder. */
export async function readDouyinBodyText(page: Page): Promise<DouyinBodyReadback> {
  const selector = '[contenteditable="true"]';
  const count = await page.locator(selector).count();
  if (count !== 1) throw new Error("DOUYIN_BODY_EDITOR_AMBIGUOUS");
  const result = await page.locator(selector).evaluate((element) => {
    if (!(element instanceof HTMLElement) || element.querySelector('[contenteditable="true"]')
      || element.parentElement?.closest('[contenteditable="true"]')
      || document.querySelectorAll('[contenteditable="true"]').length !== 1)
      throw new Error("DOUYIN_BODY_EDITOR_AMBIGUOUS");
    const rawInnerText = element.innerText;
    const rawTextContent = element.textContent ?? "";
    const isSlate = element.hasAttribute("data-slate-editor");
    const base = { candidateCount: 1, rawInnerText, rawTextContent, semanticText: rawInnerText,
      terminalPlaceholderIgnored: false,
      structureClass: isSlate ? "SLATE_OTHER" as const : "NON_SLATE" as const };
    if (!isSlate) return base;
    if (rawInnerText !== rawTextContent) throw new Error("DOUYIN_BODY_SLATE_STRUCTURE_UNVERIFIED");

    // Live Creator evidence: Slate root > div > div > two sibling span/span/text leaves.
    // A user-supplied U+200B in the content leaf remains part of semanticText.
    const outer = element.childNodes.length === 1 ? element.firstElementChild : null;
    const block = outer?.childNodes.length === 1 ? outer.firstElementChild : null;
    const leaves = block?.childNodes.length === 2 ? [...block.children] : [];
    if (outer?.tagName !== "DIV" || block?.tagName !== "DIV" || leaves.length !== 2
      || leaves.some((leaf) => leaf.tagName !== "SPAN" || leaf.childNodes.length !== 1)) return base;
    const [contentLeaf, terminalLeaf] = leaves;
    const contentSpan = contentLeaf?.firstElementChild;
    const terminalSpan = terminalLeaf?.firstElementChild;
    if (contentSpan?.tagName !== "SPAN" || terminalSpan?.tagName !== "SPAN"
      || contentSpan.childNodes.length !== 1 || terminalSpan.childNodes.length !== 1
      || contentSpan.firstChild?.nodeType !== Node.TEXT_NODE
      || terminalSpan.firstChild?.nodeType !== Node.TEXT_NODE) return base;
    const contentText = contentSpan.firstChild.textContent ?? "";
    const terminalText = terminalSpan.firstChild.textContent ?? "";
    if (!contentText || contentText === "\u200B" || terminalText !== "\u200B"
      || rawTextContent !== `${contentText}\u200B`) return base;
    return { ...base, semanticText: contentText, terminalPlaceholderIgnored: true,
      structureClass: "SLATE_TERMINAL_ZWSP" as const };
  });
  if (await page.locator(selector).count() !== 1) throw new Error("DOUYIN_BODY_EDITOR_AMBIGUOUS");
  return result;
}
