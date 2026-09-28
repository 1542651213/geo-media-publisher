import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { clickRecommendedDouyinMusicOnce, inspectRecommendedDouyinMusic } from "./image-text-music";
import { assertDouyinPreMusicEvidenceCurrent, hashDouyinPreMusicEditorObservation,
  inspectDouyinPreMusicReadOnly, type DouyinPreMusicBinding } from "./image-text-pre-music";

const creatorEditor = "https://creator.douyin.com/creator-micro/content/post/image";
const entry = '<div data-douyin-music-region><button id="entry">选择音乐</button></div>';
const track = '<div data-selected-music="track-a"><span data-track-title>舒缓纯音乐</span><span data-track-artist>音乐人</span><time>01:30</time></div>';
let browser: Browser;

async function editor(html: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route("https://creator.douyin.com/**", (route) => route.fulfill({ status: 200,
    contentType: "text/html; charset=utf-8", body: `<html><body><main>${html}</main></body></html>` }));
  await page.goto(creatorEditor);
  return page;
}

function binding(page: Page): DouyinPreMusicBinding {
  const previewDigest = "c".repeat(64);
  return { accountId: "account", articleId: "article", jobId: "job", preparationId: "preparation",
    uploadOperationId: "operation", sessionIdHash: "session", loginGeneration: 1,
    sourceContentHash: "a".repeat(64), imageSha256: "b".repeat(64), previewDigest,
    editorObservationHash: hashDouyinPreMusicEditorObservation({ title: "标题", semanticBody: "正文",
      previewDigest, imageCount: 1, settings: { visibility: "public", timing: "immediate" } }),
    editorUrl: page.url(), page, context: page.context(), musicSelectionCount: 0 };
}

describe.skipIf(!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))("Douyin pre-music evidence", () => {
  beforeAll(async () => { browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true }); });
  afterAll(async () => { await browser?.close(); });

  it("classifies an unselected entry without clicking or navigating", async () => {
    const page = await editor(entry);
    try {
      await page.evaluate(() => { (window as Window & { musicClicks?: number }).musicClicks = 0;
        document.getElementById("entry")!.addEventListener("click", () => { (window as Window & { musicClicks?: number }).musicClicks! += 1; }); });
      const input = binding(page);
      const evidence = await inspectDouyinPreMusicReadOnly(input);
      expect(evidence).toMatchObject({ classification: "NONE", musicSelectionCountAtObservation: 0,
        diagnostic: { classification: "NONE", entryNodeCount: 1, selectedContainerCount: 0 } });
      expect(await page.evaluate(() => (window as Window & { musicClicks?: number }).musicClicks)).toBe(0);
      expect(page.url()).toBe(creatorEditor);
      expect(() => assertDouyinPreMusicEvidenceCurrent(evidence, input)).not.toThrow();
    } finally { await page.close(); }
  });

  it.each([
    ["TRACK", `${entry.slice(0, -6)}${track}</div>`, "DOUYIN_PRE_MUSIC_UNEXPECTED_TRACK"],
    ["AMBIGUOUS", `${entry.slice(0, -6)}${track}${track}</div>`, "DOUYIN_PRE_MUSIC_AMBIGUOUS"],
    ["UNKNOWN", "<div>no music region</div>", "DOUYIN_PRE_MUSIC_UNKNOWN"]
  ])("stops on %s before opening the drawer", async (_kind, html, reason) => {
    const page = await editor(html);
    try { await expect(inspectDouyinPreMusicReadOnly(binding(page))).rejects.toThrow(reason); }
    finally { await page.close(); }
  });

  it("invalidates on Page, Context, Job, upload, preparation and navigation changes", async () => {
    const page = await editor(entry);
    try {
      const original = binding(page);
      const evidence = await inspectDouyinPreMusicReadOnly(original);
      for (const change of [{ jobId: "other" }, { articleId: "other" }, { accountId: "other" },
        { uploadOperationId: "other" }, { preparationId: "other" }, { sessionIdHash: "other" },
        { loginGeneration: 2 }, { editorObservationHash: "d".repeat(64) }, { musicSelectionCount: 1 }])
        expect(() => assertDouyinPreMusicEvidenceCurrent(evidence, { ...original, ...change })).toThrow("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
      const replacement = await editor(entry);
      try { expect(() => assertDouyinPreMusicEvidenceCurrent(evidence, binding(replacement))).toThrow("DOUYIN_PRE_MUSIC_EVIDENCE_STALE"); }
      finally { await replacement.close(); }
      await page.goto("https://creator.douyin.com/creator-micro/home");
      await page.goto(creatorEditor);
      expect(() => assertDouyinPreMusicEvidenceCurrent(evidence, original)).toThrow("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
    } finally { await page.close(); }
  });

  it("rejects a drawer that was already open before the pre-music observation", async () => {
    const page = await editor(`${entry}<div role="dialog"><input placeholder="搜索音乐"></div>`);
    try { await expect(inspectDouyinPreMusicReadOnly(binding(page))).rejects.toThrow("DOUYIN_PRE_MUSIC_DRAWER_ALREADY_OPEN"); }
    finally { await page.close(); }
  });

  it("opens the drawer then dispatches at most one guarded track click", async () => {
    const page = await editor(`${entry}<div role="dialog" hidden><input placeholder="搜索音乐"><button>推荐</button>
      <div data-music-id="track-a"><span class="title">舒缓纯音乐</span><span class="artist">音乐人</span><time>01:30</time></div></div>`);
    try {
      await page.evaluate(() => { (window as Window & { actions?: string[] }).actions = [];
        document.getElementById("entry")!.addEventListener("click", () => { (window as Window & { actions?: string[] }).actions!.push("drawer");
          (document.querySelector('[role="dialog"]') as HTMLElement).hidden = false; });
        document.querySelector('[data-music-id="track-a"]')!.addEventListener("click", () =>
          (window as Window & { actions?: string[] }).actions!.push("track")); });
      const input = binding(page);
      const evidence = await inspectDouyinPreMusicReadOnly(input);
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual([]);
      const found = await inspectRecommendedDouyinMusic(page, evidence, async () => input);
      expect(found.candidates).toHaveLength(1);
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual(["drawer"]);
      let dispatched = 0;
      await clickRecommendedDouyinMusicOnce(page, page.locator('[data-music-id="track-a"]'), evidence,
        async () => input, () => { dispatched += 1; });
      expect(dispatched).toBe(1);
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual(["drawer", "track"]);
      await expect(clickRecommendedDouyinMusicOnce(page, page.locator('[data-music-id="track-a"]'), evidence,
        async () => ({ ...input, musicSelectionCount: 1 }), () => { dispatched += 1; })).rejects.toThrow("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
      expect(dispatched).toBe(1);
    } finally { await page.close(); }
  });

  it("refuses a music click after the owned Page is replaced", async () => {
    const page = await editor(entry);
    const replacement = await editor(entry);
    try {
      const evidence = await inspectDouyinPreMusicReadOnly(binding(page));
      let dispatched = 0;
      await expect(clickRecommendedDouyinMusicOnce(page, page.locator("#entry"), evidence,
        async () => binding(replacement), () => { dispatched += 1; })).rejects.toThrow("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
      expect(dispatched).toBe(0);
    } finally { await page.close(); await replacement.close(); }
  });
});
