import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { assertDouyinMusicReadback, readSelectedDouyinMusic } from "./image-text-music";
import type { DouyinMusicBinding } from "@publisher/domain/douyin-image-text";

const none: DouyinMusicBinding = { mode: "NONE" };
const track: DouyinMusicBinding = { mode: "AUTO_RECOMMENDED", identity: "id:track-a", trackId: "track-a",
  title: "舒缓纯音乐", artist: "平台音乐人", duration: "01:30" };
const entry = '<div data-douyin-music-region><div class="title">选择音乐</div><div>点击添加合适作品风格音乐</div></div>';
const selected = (id = "track-a", title = "舒缓纯音乐") => `<div data-selected-music="${id}">
  <span data-track-title>${title}</span><span data-track-artist>平台音乐人</span><time>01:30</time></div>`;

describe.skipIf(!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))("Douyin music surface contract", () => {
  it("does not read the entry, generic title classes, or drawer candidates as a selected song", async () => {
    const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    try {
      const page = await browser.newPage();
      for (const html of [entry, `<div data-douyin-music-region><div class="title">选择音乐</div></div>`,
        `${entry}<div role="dialog"><input placeholder="搜索音乐"><div data-music-id="other"><div class="title">推荐曲</div></div></div>`,
        `${entry}<div class="title">导航标题</div>`,
        `<div data-douyin-music-region><div class="title">选择音乐</div></div><div role="dialog"><input placeholder="搜索音乐"><div class="music-card">推荐曲</div></div>`]) {
        await page.setContent(`<main>${html}</main>`);
        const observed = await readSelectedDouyinMusic(page);
        expect(observed.classification).toBe("NONE");
        expect(assertDouyinMusicReadback(none, observed)).toBe("PASS_NONE");
      }
    } finally { await browser.close(); }
  });

  it("requires an explicit selected container and an exact track identity", async () => {
    const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<main><div data-douyin-music-region><div class="title">选择音乐</div>${selected()}</div>
        <div role="dialog"><input placeholder="搜索音乐"><div data-music-id="candidate">候选</div></div></main>`);
      const observed = await readSelectedDouyinMusic(page);
      expect(observed.classification).toBe("TRACK");
      expect(observed.drawerPresent).toBe(true);
      expect(assertDouyinMusicReadback(track, observed)).toBe("PASS_TRACK");
      expect(assertDouyinMusicReadback({ ...track, trackId: null,
        identity: "text:舒缓纯音乐\u0000平台音乐人\u000001:30" }, observed)).toBe("PASS_TRACK");
      expect(() => assertDouyinMusicReadback(none, observed)).toThrow("DOUYIN_MUSIC_READBACK_MISMATCH");
      expect(() => assertDouyinMusicReadback({ ...track, title: "另一首" }, observed)).toThrow();
      expect(() => assertDouyinMusicReadback({ ...track, trackId: "track-b" }, observed)).toThrow();
      await page.setContent(`<main><div data-douyin-music-region><div>选择音乐</div><div data-selected-music=""><span data-track-title>舒缓纯音乐</span><span data-track-artist>平台音乐人</span><time>01:30</time></div></div></main>`);
      const noId = await readSelectedDouyinMusic(page);
      expect(assertDouyinMusicReadback({ ...track, trackId: null,
        identity: "text:舒缓纯音乐\u0000平台音乐人\u000001:30" }, noId)).toBe("PASS_TRACK");
    } finally { await browser.close(); }
  });

  it("fails closed on unknown, duplicate, and unscoped selected structures", async () => {
    const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    try {
      const page = await browser.newPage();
      for (const html of ["<div>无音乐区域</div>",
        `<div data-douyin-music-region>${selected()}</div>`,
        `<div data-douyin-music-region><div>选择音乐</div>${selected()}${selected("other")}</div>`,
        `<div data-douyin-music-region><div>选择音乐</div><div class="music-card">不明曲目</div></div>`,
        `<div data-douyin-music-region><div>选择音乐</div></div><div class="music-chip">不明已选音乐</div>`,
        `<div data-douyin-music-region><div>选择音乐</div><div data-selected-music="track-a"><span data-track-title>选择音乐</span></div></div>`]) {
        await page.setContent(`<main>${html}</main>`);
        const observed = await readSelectedDouyinMusic(page);
        expect(["UNKNOWN", "AMBIGUOUS"]).toContain(observed.classification);
        expect(() => assertDouyinMusicReadback(none, observed)).toThrow();
        expect(() => assertDouyinMusicReadback(track, observed)).toThrow();
      }
    } finally { await browser.close(); }
  });
});
