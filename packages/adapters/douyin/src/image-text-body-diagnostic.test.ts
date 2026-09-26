import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { compareDouyinBodyText, inspectDouyinBodyPage } from "./image-text-body-diagnostic";

describe("Douyin body code-point diagnosis", () => {
  it("keeps an exact approved Chinese sentence exact", () => {
    const text = "这是 Geo Media Publisher 的抖音图文发布链路测试内容，用于验证图片上传、内容填写、发布状态和作品回查。";
    const result = compareDouyinBodyText(text, text);
    expect(result).toMatchObject({ expectedUtf16Length: 61, actualUtf16Length: 61,
      expectedCodePointCount: 61, actualCodePointCount: 61, prefixCodePoints: 61,
      insertions: 0, deletions: 0, substitutions: 0, operations: [] });
  });

  it("distinguishes terminal LF, NBSP and zero-width characters", () => {
    const lf = compareDouyinBodyText("正文", "正文\n");
    expect(lf).toMatchObject({ firstDifference: { expectedCodePointIndex: 2, actualCodePointIndex: 2 },
      insertions: 1, deletions: 0, substitutions: 0 });
    expect(lf.operations[0]?.actual?.hex).toBe("U+000A");
    expect(lf.operations[0]?.location).toBe("end");
    const nbsp = compareDouyinBodyText("a b", "a\u00a0b");
    expect(nbsp).toMatchObject({ insertions: 0, deletions: 0, substitutions: 1 });
    expect(nbsp.operations[0]?.actual?.hex).toBe("U+00A0");
    const zeroWidth = compareDouyinBodyText("ab", "a\u200bb");
    expect(zeroWidth.operations[0]?.actual?.hex).toBe("U+200B");
  });

  it("reports deletions, same-length substitutions and all internal edits", () => {
    expect(compareDouyinBodyText("abc", "ac")).toMatchObject({ deletions: 1, insertions: 0 });
    expect(compareDouyinBodyText("abc", "axc")).toMatchObject({ substitutions: 1, insertions: 0 });
    const changed = compareDouyinBodyText("a b\nc", "a  b\nd");
    expect(changed).toMatchObject({ insertions: 1, substitutions: 1, deletions: 0 });
    expect(changed.operations).toHaveLength(2);
  });

  it("indexes emoji and combining marks as code points without erasing joiners", () => {
    const result = compareDouyinBodyText("👩‍💻e\u0301", "👩💻e\u0301");
    expect(result.expectedUtf16Length).toBeGreaterThan(result.expectedCodePointCount);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.expected?.hex).toBe("U+200D");
  });
});

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(bodyHtml: string) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const page = await browser.newPage();
  await page.setContent(`<main><input placeholder="添加作品标题" value="测试标题"><div id="editor-shell">${bodyHtml}</div><span>0 / 1000</span></main>`);
  return page;
}

describe.skipIf(!existsSync(chrome))("Douyin bounded body DOM diagnosis", () => {
  it("scopes an exact body node away from title and counter", async () => {
    const page = await fixture('<div contenteditable="true" role="textbox" aria-label="作品描述">测试正文。</div>');
    const result = await inspectDouyinBodyPage(page, "测试正文。");
    expect(result.candidateCount).toBe(1);
    expect(result.selectedCandidateIndex).toBe(0);
    expect(result.candidates[0]).toMatchObject({ tagName: "div", role: "textbox", ariaLabel: "作品描述",
      innerText: { diff: { insertions: 0, deletions: 0, substitutions: 0 } } });
    expect(result.candidates[0]?.structure.some((node) => node.kind === "text" && node.utf16Length === 5)).toBe(true);
  });

  it("distinguishes a terminal BR from text-node LF and an empty paragraph", async () => {
    const br = await inspectDouyinBodyPage(await fixture('<div contenteditable="true">正文<br></div>'), "正文");
    expect(br.candidates[0]?.structure.some((node) => node.tagName === "br")).toBe(true);
    expect(br.candidates[0]?.textContent.utf16Length).toBe(2);
    expect(br.candidates[0]?.innerText.diff?.operations[0]?.actual?.hex).toBe("U+000A");
    expect(br.candidates[0]?.domGeneratedTextDifference).toBe("YES");
    const paragraph = await inspectDouyinBodyPage(await fixture('<div contenteditable="true"><p>正文</p><p><br></p></div>'), "正文");
    expect(paragraph.candidates[0]?.structure.filter((node) => node.tagName === "p")).toHaveLength(2);
    expect(paragraph.candidates[0]?.textContent.utf16Length).toBe(2);
    expect(paragraph.candidates[0]?.innerText.utf16Length).toBeGreaterThan(2);
    expect(paragraph.candidates[0]?.domGeneratedTextDifference).toBe("YES");
  });

  it("retains actual NBSP, zero-width and visible extra characters in text-node evidence", async () => {
    const page = await fixture('<div contenteditable="true">A&nbsp;B\u200b!</div>');
    const result = await inspectDouyinBodyPage(page, "A B!");
    expect(result.candidates[0]?.textContent.diff?.operations.map((op) => op.actual?.hex)).toContain("U+00A0");
    expect(result.candidates[0]?.textContent.diff?.operations.map((op) => op.actual?.hex)).toContain("U+200B");
  });

  it("does not select nested or multiple contenteditable candidates by coincidental text", async () => {
    const nested = await inspectDouyinBodyPage(await fixture('<div contenteditable="true">外层 <div contenteditable="true">正文</div></div>'), "正文");
    expect(nested.candidateCount).toBe(2);
    expect(nested.selectedCandidateIndex).toBeNull();
    const multiple = await inspectDouyinBodyPage(await fixture('<div contenteditable="true">正文</div><div contenteditable="true">正文</div>'), "正文");
    expect(multiple.selectedCandidateIndex).toBeNull();
  });

  it("rejects a wide parent wrapper even when it contains the approved body", async () => {
    const result = await inspectDouyinBodyPage(await fixture('<div contenteditable="true">标题 <span>正文</span><span>0 / 1000</span></div>'), "正文");
    expect(result.selectedCandidateIndex).toBeNull();
    expect(result.candidates[0]?.innerText.diff).toBeNull();
    expect(result.candidates[0]?.innerText.utf16Length).toBeGreaterThan(2);
    expect(result.candidates[0]?.structure.some((node) => node.tagName === "span")).toBe(true);
  });
});
