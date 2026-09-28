import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { readDouyinBodyText } from "./image-text-body-readback";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(body: string): Promise<Page> {
  const browser = browsers[0] ?? await chromium.launch({ executablePath: chrome, headless: true });
  if (browsers.length === 0) browsers.push(browser);
  const page = await browser.newPage();
  await page.setContent(`<main><input placeholder="添加作品标题" value="测试标题">${body}</main>`);
  return page;
}

const slate = (leaves: string) => `<div contenteditable="true" data-slate-editor="true"><div><div>${leaves}</div></div></div>`;
const leaf = (value: string) => `<span><span>${value}</span></span>`;

describe.skipIf(!existsSync(chrome))("Douyin Slate semantic body readback", () => {
  it("keeps exact plain and Chinese bodies unchanged", async () => {
    for (const value of ["Exact text", "这是抖音图文测试正文。"])
      expect((await readDouyinBodyText(await fixture(`<div contenteditable="true">${value}</div>`))).semanticText).toBe(value);
  });

  it("excludes only the proven separate Slate terminal U+200B node", async () => {
    const body = "这是 Geo Media Publisher 的抖音图文发布链路测试内容，用于验证图片上传、正文回读、发布状态和作品回查。测试标识：C1606";
    const result = await readDouyinBodyText(await fixture(slate(leaf(body) + leaf("\u200B"))));
    expect(result).toMatchObject({ candidateCount: 1, semanticText: body,
      rawInnerText: `${body}\u200B`, rawTextContent: `${body}\u200B`,
      terminalPlaceholderIgnored: true, structureClass: "SLATE_TERMINAL_ZWSP" });
    expect(result.rawInnerText).toHaveLength(72);
    expect(result.semanticText).toHaveLength(71);
  });

  it("preserves user U+200B inside and at the end of the same text node", async () => {
    for (const value of ["A\u200BB", "ABC\u200B"])
      expect((await readDouyinBodyText(await fixture(slate(leaf(value))))).semanticText).toBe(value);
  });

  it("does not strip two terminal nodes, a different character, or visible trailing content", async () => {
    for (const leaves of [leaf("正文") + leaf("\u200B") + leaf("\u200B"),
      leaf("正文") + leaf(" "), leaf("正文") + leaf("&nbsp;"), leaf("正文") + leaf("\n"),
      leaf("正文X") + leaf("\u200B")]) {
      const result = await readDouyinBodyText(await fixture(slate(leaves))).catch((error: unknown) => {
        expect(String(error)).toMatch(/DOUYIN_BODY_SLATE_STRUCTURE_UNVERIFIED/u);
        return null;
      });
      if (!result) continue;
      if (leaves.includes("正文X")) expect(result.semanticText).toBe("正文X");
      else expect(result.terminalPlaceholderIgnored).toBe(false);
    }
  }, 15_000);

  it("keeps BR, empty paragraph, CRLF/LF and multiple paragraphs as actual readback", async () => {
    for (const body of [slate(leaf("正文") + "<br>"), slate("<p>正文</p><p><br></p>"),
      slate(leaf("甲\r\n乙\n丙")), slate("<p>第一段</p><p>第二段</p>")]) {
      const result = await readDouyinBodyText(await fixture(body)).catch((error: unknown) => {
        expect(String(error)).toMatch(/DOUYIN_BODY_SLATE_STRUCTURE_UNVERIFIED/u);
        return null;
      });
      if (result) expect(result.terminalPlaceholderIgnored).toBe(false);
    }
  });

  it("fails closed when Slate innerText and DOM text differ outside the proven terminal structure", async () => {
    await expect(readDouyinBodyText(await fixture(slate(leaf("正文") + "<br>"))))
      .rejects.toThrow(/DOUYIN_BODY_SLATE_STRUCTURE_UNVERIFIED/u);
  });

  it("rejects nested or multiple editables and never strips a non-Slate terminal marker", async () => {
    await expect(readDouyinBodyText(await fixture('<div contenteditable="true">外层<div contenteditable="true">正文</div></div>')))
      .rejects.toThrow(/DOUYIN_BODY_EDITOR_AMBIGUOUS/u);
    await expect(readDouyinBodyText(await fixture('<div contenteditable="true">正文</div><div contenteditable="true">其他</div>')))
      .rejects.toThrow(/DOUYIN_BODY_EDITOR_AMBIGUOUS/u);
    const nonSlate = await readDouyinBodyText(await fixture(`<div contenteditable="true">${leaf("正文") + leaf("\u200B")}</div>`));
    expect(nonSlate.semanticText).toBe("正文\u200B");
  });

  it("handles surrogate pairs before the terminal node without cutting them", async () => {
    const value = "测试👩‍💻完成";
    const result = await readDouyinBodyText(await fixture(slate(leaf(value) + leaf("\u200B"))));
    expect(result.semanticText).toBe(value);
    expect(result.rawInnerText.length).toBe(value.length + 1);
  });
});
