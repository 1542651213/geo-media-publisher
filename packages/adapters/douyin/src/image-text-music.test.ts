import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { chooseDouyinMusic, inspectRecommendedDouyinMusic, readSelectedDouyinMusic, type DouyinMusicCandidate } from "./image-text-music";
import { hashDouyinPreMusicEditorObservation, inspectDouyinPreMusicReadOnly } from "./image-text-pre-music";

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
    "does not open the music drawer without pre-music evidence", async () => {
      const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent('<main><div data-douyin-music-region><button>选择音乐</button></div>'
          + '<div role="dialog"><input placeholder="搜索音乐"><button>推荐</button></div></main>');
        await expect(inspectRecommendedDouyinMusic(page)).rejects.toThrow("DOUYIN_PRE_MUSIC_EVIDENCE_REQUIRED");
      } finally { await browser.close(); }
    });

  it.skipIf(!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))(
    "reads bounded current-page rows and verifies the selected music without network access", async () => {
      const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
      try {
        const page = await browser.newPage();
        await page.route("https://creator.douyin.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body><main></main></body></html>" }));
        await page.goto("https://creator.douyin.com/creator-micro/content/post/image");
        await page.setContent(`<main><div data-douyin-music-region><button id="entry">选择音乐</button></div><div role="dialog" hidden><input placeholder="搜索音乐"><button>推荐</button>
          <div data-music-id="track-1"><span class="title">舒缓纯音乐</span><span class="artist">音乐人</span><time>01:30</time></div></div></main>`);
        await page.evaluate(() => document.getElementById("entry")!.addEventListener("click", () => {
          (document.querySelector('[role="dialog"]') as HTMLElement).hidden = false;
        }));
        const binding = { accountId: "account", articleId: "article", jobId: "job", preparationId: "preparation",
          uploadOperationId: "operation", sessionIdHash: "session", loginGeneration: 1,
          sourceContentHash: "a".repeat(64), imageSha256: "b".repeat(64), previewDigest: "c".repeat(64),
          editorObservationHash: hashDouyinPreMusicEditorObservation({ title: "标题", semanticBody: "正文",
            previewDigest: "c".repeat(64), imageCount: 1, settings: { visibility: "public", timing: "immediate" } }),
          editorUrl: page.url(), page, context: page.context(), musicSelectionCount: 0 };
        const evidence = await inspectDouyinPreMusicReadOnly(binding);
        const inspected = await inspectRecommendedDouyinMusic(page, evidence, async () => binding);
        expect(inspected.candidates).toMatchObject([{ trackId: "track-1", title: "舒缓纯音乐", artist: "音乐人", duration: "01:30", rowIndex: 0 }]);
        await page.setContent(`<main><div data-douyin-music-region><span>选择音乐</span><div data-selected-music="track-1"><span data-track-title>舒缓纯音乐</span><span data-track-artist>音乐人</span><time>01:30</time></div></div></main>`);
        expect((await readSelectedDouyinMusic(page)).classification).toBe("TRACK");
        await page.setContent(`<main><div data-douyin-music-region><div class="title">选择音乐</div></div></main>`);
        expect((await readSelectedDouyinMusic(page)).classification).toBe("NONE");
      } finally { await browser.close(); }
    });
});
