import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chromium, type Page } from "playwright-core";
import { inspectXiaohongshuGlobalExactPublishDom } from "./global-exact-publish-diagnostic";

const chromeExecutable = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function withFixture(body: string, callback: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto("https://creator.xiaohongshu.com/publish/publish?target=image", { waitUntil: "commit", timeout: 5000 }).catch(() => undefined);
    await page.setContent(body);
    await callback(page);
  } finally {
    await browser.close();
  }
}

describe("XHS global exact publish DOM diagnostic", () => {
  it.skipIf(!existsSync(chromeExecutable))("finds exact 发布 on native, div, and span surfaces", async () => {
    await withFixture(`<main><button>发布</button></main>`, async (page) => {
      const result = await inspectXiaohongshuGlobalExactPublishDom(page);
      expect(result.globalExactPublishTextMatchCount).toBe(1);
      expect(result.globalExactPublishUnique).toBe("YES");
      expect(result.globalExactPublishNodesSafe[0]).toMatchObject({ tagName: "BUTTON", connected: true, rendered: true });
    });

    await withFixture(`<main><div>发布</div></main>`, async (page) => {
      const result = await inspectXiaohongshuGlobalExactPublishDom(page);
      expect(result.globalExactPublishTextMatchCount).toBe(1);
      expect(result.globalExactPublishNodesSafe[0]?.tagName).toBe("DIV");
    });

    await withFixture(`<main><span>发布</span></main>`, async (page) => {
      const result = await inspectXiaohongshuGlobalExactPublishDom(page);
      expect(result.globalExactPublishTextMatchCount).toBe(1);
      expect(result.globalExactPublishNodesSafe[0]?.tagName).toBe("SPAN");
    });
  }, 20_000);

  it.skipIf(!existsSync(chromeExecutable))("returns bounded ancestor metadata for a nested nonstandard surface", async () => {
    await withFixture(`<main><div class="clickable"><span>发布</span></div></main>`, async (page) => {
      const result = await inspectXiaohongshuGlobalExactPublishDom(page);
      expect(result.globalExactPublishTextMatchCount).toBe(1);
      expect(result.globalExactPublishUnique).toBe("YES");
      expect(result.globalExactPublishNodesSafe[0]?.tagName).toBe("SPAN");
      expect(result.globalExactPublishNodesSafe[0]?.ancestors[0]).toMatchObject({ depth: 1, tagName: "DIV", classNameSafe: "clickable" });
    });
  }, 20_000);

  it.skipIf(!existsSync(chromeExecutable))("rejects non-exact labels and marks multiple exact nodes ambiguous", async () => {
    await withFixture(`<main><button>发布笔记</button><div>立即发布</div></main>`, async (page) => {
      const result = await inspectXiaohongshuGlobalExactPublishDom(page);
      expect(result.globalExactPublishTextMatchCount).toBe(0);
      expect(result.globalExactPublishUnique).toBe("NO");
    });

    await withFixture(`<main><button>发布</button><div>发布</div></main>`, async (page) => {
      const result = await inspectXiaohongshuGlobalExactPublishDom(page);
      expect(result.globalExactPublishTextMatchCount).toBe(2);
      expect(result.globalExactPublishUnique).toBe("AMBIGUOUS");
    });
  }, 20_000);

  it.skipIf(!existsSync(chromeExecutable))("keeps hidden metadata and caps ancestors at five levels", async () => {
    await withFixture(`<main><div style="display:none"><span>发布</span></div><div><div><div><div><div><div><span id="deep">发布</span></div></div></div></div></div></div></main>`, async (page) => {
      const result = await inspectXiaohongshuGlobalExactPublishDom(page);
      expect(result.globalExactPublishTextMatchCount).toBe(2);
      expect(result.globalExactPublishNodesSafe[0]).toMatchObject({ rendered: false });
      expect(result.globalExactPublishNodesSafe[0]?.ancestors[0]).toMatchObject({ display: "none" });
      const deep = result.globalExactPublishNodesSafe.find((node) => node.ancestors[0]?.tagName === "DIV" && node.rendered);
      expect(deep?.ancestors).toHaveLength(5);
      expect(deep?.ancestors.every((ancestor) => ancestor.depth >= 1 && ancestor.depth <= 5)).toBe(true);
    });
  }, 20_000);

  it("is read-only and does not expose full node contents", async () => {
    const source = await import("node:fs").then(({ readFileSync }) => readFileSync("packages/adapters/xiaohongshu/src/global-exact-publish-diagnostic.ts", "utf8"));
    expect(source).not.toMatch(/setInputFiles|\.click\s*\(|outerHTML|innerHTML|cookies|storage|token/iu);
  });
});
