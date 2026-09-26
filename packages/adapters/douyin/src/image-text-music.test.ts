import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { chooseDouyinMusic, inspectRecommendedDouyinMusic, readSelectedDouyinMusic, type DouyinMusicCandidate } from "./image-text-music";

const candidate = (title: string, overrides: Partial<DouyinMusicCandidate> = {}): DouyinMusicCandidate => ({
  title, artist: "平台音乐人", duration: "01:30", trackId: null, sourceTab: "推荐", selectable: true, usageText: "", ...overrides
});

describe("Douyin optional recommended music policy", () => {
  it("filters unsuitable themes and recently submitted tracks before one random draw", () => {
    let draws = 0;
    const result = chooseDouyinMusic([
      candidate("八月开门红"), candidate("舒缓室内纯音乐", { trackId: "fresh" }),
      candidate("清新家居氛围", { trackId: "recent" }), candidate("治愈轻音乐", { trackId: "other" })
    ], [{ title: "清新家居氛围", artist: "平台音乐人", duration: "01:30", trackId: "recent" }],
    () => { draws += 1; return 0.9; });
    expect(result.selected?.trackId).toBe("other");
    expect(result.eligibleCount).toBe(2);
    expect(result.recentExcludedCount).toBe(1);
    expect(draws).toBe(1);
  });

  it("skips optional music without a click when no safe track exists", () => {
    expect(chooseDouyinMusic([candidate("失恋伤心夜店")], [], () => { throw new Error("random should not run"); }).selected).toBeNull();
  });

  it("uses scoped title artist duration identity without a track id", () => {
    const result = chooseDouyinMusic([candidate("舒缓纯音乐")],
      [{ title: "舒缓纯音乐", artist: "平台音乐人", duration: "01:30", trackId: null }], () => 0);
    expect(result.selected).toBeNull();
    expect(result.recentExcludedCount).toBe(1);
  });

  it("rejects invalid random values and incomplete identities", () => {
    expect(() => chooseDouyinMusic([candidate("轻音乐")], [], () => 1)).toThrow();
    expect(chooseDouyinMusic([candidate("轻音乐", { artist: "" })], [], () => 0).selected).toBeNull();
  });

  it.skipIf(!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))(
    "reads bounded current-page rows and verifies the selected music without network access", async () => {
      const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(`<button id="entry">选择音乐</button><input placeholder="搜索音乐"><button>推荐</button>
          <div data-music-id="track-1"><span class="title">舒缓纯音乐</span><span class="artist">音乐人</span><time>01:30</time></div>`);
        const inspected = await inspectRecommendedDouyinMusic(page);
        expect(inspected.candidates).toMatchObject([{ trackId: "track-1", title: "舒缓纯音乐", artist: "音乐人", duration: "01:30", rowIndex: 0 }]);
        await page.setContent(`<div><span>选择音乐</span><span class="title">舒缓纯音乐</span><span class="artist">音乐人</span><time>01:30</time></div>`);
        expect(await readSelectedDouyinMusic(page)).toEqual({ selected: true, title: "舒缓纯音乐", artist: "音乐人", duration: "01:30" });
        await page.setContent(`<div><span class="title">选择音乐</span></div>`);
        expect((await readSelectedDouyinMusic(page)).selected).toBe(false);
      } finally { await browser.close(); }
    });
});
