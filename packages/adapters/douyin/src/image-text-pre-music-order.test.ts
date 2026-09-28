import { createHash } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";
import { freezeDouyinImageText } from "@publisher/domain/douyin-image-text";
import type { CredentialStore } from "@publisher/security";
import { DouyinImageTextBrowserAdapter } from "./image-text-browser";

const editorUrl = "https://creator.douyin.com/creator-micro/content/post/image";
const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8V8AAAAASUVORK5CYII=";
const secondImageData = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')}`;
const imageBytes = Buffer.from(imageData.split(",")[1]!, "base64");
const store: CredentialStore = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false };
let browser: Browser;
let imageDir: string;
let imagePath: string;

function html(input: { preselected?: boolean; corruptBody?: boolean; trackOnClick?: boolean; wrongTrackOnClick?: boolean;
  settingsChangeOnDrawerOpen?: boolean; secondPreviewOnDrawerOpen?: boolean; bodyChangeOnTrackClick?: boolean } = {}): string {
  const selected = (title: string) => `<div data-selected-music="track-a"><span data-track-title>${title}</span><span data-track-artist>音乐人</span><time>01:30</time></div>`;
  return `<html><body><main>
    <div class="upload-preview"><img src="${imageData}"></div><span>已添加1张图片</span>
    <input placeholder="添加作品标题"><div contenteditable="true"></div>
    <div data-douyin-music-region><button id="music-entry">选择音乐</button>${input.preselected ? selected("舒缓纯音乐") : ""}</div>
    <label><input type="radio" checked>公开</label><label><input type="radio">仅自己可见</label>
    <label><input type="radio" checked>立即发布</label><label><input type="radio">定时发布</label>
    <button>发布</button>
    <div role="dialog" hidden><input placeholder="搜索音乐"><button>推荐</button>
      ${input.trackOnClick ? '<div data-music-id="track-a"><span class="title">舒缓纯音乐</span><span class="artist">音乐人</span><time>01:30</time></div>' : ""}
    </div>
    </main><script>
      window.actions = [];
      document.querySelector('input[placeholder="添加作品标题"]').addEventListener('input', () => window.actions.push('title fill'));
      document.querySelector('[contenteditable="true"]').addEventListener('input', (event) => {
        window.actions.push('body fill');
        if (${Boolean(input.corruptBody)}) event.currentTarget.textContent += 'X';
      });
      document.getElementById('music-entry').addEventListener('click', () => {
        window.actions.push('drawer open'); document.querySelector('[role="dialog"]').hidden = false;
        if (${Boolean(input.settingsChangeOnDrawerOpen)}) document.querySelector('input[type="radio"]').checked = false;
        if (${Boolean(input.secondPreviewOnDrawerOpen)}) {
          const image = document.createElement('img'); image.src = ${JSON.stringify(secondImageData)};
          document.querySelector('.upload-preview').appendChild(image);
        }
      });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelector('[role="dialog"]').hidden = true; });
      document.querySelector('[data-music-id="track-a"]')?.addEventListener('click', () => {
        window.actions.push('music click');
        document.querySelector('[data-douyin-music-region]').insertAdjacentHTML('beforeend', ${JSON.stringify(selected(input.wrongTrackOnClick ? "另一首歌" : "舒缓纯音乐"))});
        if (${Boolean(input.bodyChangeOnTrackClick)}) document.querySelector('[contenteditable="true"]').textContent += 'X';
      });
    </script></body></html>`;
}

async function fixture(input: Parameters<typeof html>[0] = {}): Promise<{
  adapter: DouyinImageTextBrowserAdapter; page: Page; ctx: AccountContext; article: PublishArticleInput;
  replaceCanonicalDuringNextMusicGuard: () => Promise<Page>;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.route("https://creator.douyin.com/**", (route) => route.fulfill({ status: 200,
    contentType: "text/html; charset=utf-8", body: new URL(route.request().url()).pathname.endsWith("/manage")
      ? '<html><body><input placeholder="搜索作品"><button>已发布</button><button>审核中</button><button>未通过</button></body></html>'
      : html(input) }));
  await page.goto(editorUrl);
  await page.locator("main img").evaluate((image) => (image as HTMLImageElement).decode());
  const adapter = new DouyinImageTextBrowserAdapter({ credentialStore: store, nativeSubmitEnabled: true });
  const session = { context, page, executionMode: "VISIBLE", sessionIdHash: "test-session" };
  let canonicalPage = page;
  let replacement: Page | null = null;
  let creatorReadCount = 0;
  let replaceOnGuard = false;
  Object.defineProperty(adapter, "activeCanonicalPage", { value: async () => ({ page: canonicalPage, session }) });
  Object.defineProperty(adapter, "readOwnedCreatorId", { value: async () => {
    creatorReadCount += 1;
    if (replaceOnGuard && creatorReadCount === 3 && replacement) {
      await Promise.resolve();
      canonicalPage = replacement;
    }
    return "72388977613";
  } });
  const ctx = { accountId: "account", accountName: "Owner", platformKey: "douyin", secrets: {}, settings: {
    expectedCreatorId: "72388977613", expectedVisibility: "public", expectedLoginGeneration: 1,
    expectedMusicMode: "AUTO_RECOMMENDED", publishJobId: "job", recentDouyinMusicJson: "[]" } } as AccountContext;
  const article = { articleId: "article", title: "测试标题", body: "测试正文", summary: "", tags: [], images: [imagePath] } as PublishArticleInput;
  const frozen = await freezeDouyinImageText({ articleId: article.articleId, accountId: ctx.accountId,
    creatorId: "72388977613", title: article.title, body: article.body, imagePaths: [imagePath],
    topics: [], visibility: "public", scheduledAt: null });
  const previewDigest = createHash("sha256").update(imageData).digest("hex");
  (adapter as unknown as { uploadOperations: Map<string, object> }).uploadOperations.set("job", {
    accountId: ctx.accountId, articleId: article.articleId, jobId: "job", operationId: "operation",
    page, context, sessionIdHash: "test-session", loginGeneration: 1,
    sourceContentHash: frozen.sourceContentHash, imageSha256: frozen.imageHashes[0],
    selectionStatus: "RETURNED", preUploadImageCount: 0, inputDetached: true,
    inputFileName: null, previewDigest });
  return { adapter, page, ctx, article, replaceCanonicalDuringNextMusicGuard: async () => {
    replacement = await context.newPage();
    await replacement.goto(editorUrl);
    replaceOnGuard = true;
    return replacement;
  } };
}

describe.skipIf(!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))("Douyin pre-music prepare order", () => {
  beforeAll(async () => {
    imageDir = await mkdtemp(join(tmpdir(), "douyin-pre-music-order-"));
    imagePath = join(imageDir, "test.png");
    await writeFile(imagePath, imageBytes);
    browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  });
  afterAll(async () => { await browser?.close(); await rm(imagePath, { force: true }); await rmdir(imageDir); });

  it("claims and selects the image once before filling, pre-music classification and optional discovery", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const claim = vi.fn(() => ({ operationId: "new-operation", stage: "FILE_SELECTION_DISPATCHED" as const, newlyClaimed: true }));
    try {
      await page.route("https://creator.douyin.com/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        const body = path.endsWith("/home")
          ? '<html><body><button id="entry">发布图文</button><script>document.getElementById("entry").onclick=()=>location.href="/creator-micro/content/upload"</script></body></html>'
          : path.endsWith("/upload")
            ? '<html><body><label>上传图文<input type="file" accept="image/png"></label><script>document.querySelector("input").onchange=()=>location.href="/creator-micro/content/post/image"</script></body></html>'
            : html();
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
      });
      await page.goto("https://creator.douyin.com/creator-micro/home");
      const adapter = new DouyinImageTextBrowserAdapter({ credentialStore: store, claimFileSelection: claim });
      const session = { context, page, executionMode: "VISIBLE", sessionIdHash: "test-session" };
      Object.defineProperty(adapter, "activeCanonicalPage", { value: async () => ({ page, session }) });
      Object.defineProperty(adapter, "readOwnedCreatorId", { value: async () => "72388977613" });
      const ctx = { accountId: "account", accountName: "Owner", platformKey: "douyin", secrets: {}, settings: {
        expectedCreatorId: "72388977613", expectedVisibility: "public", expectedLoginGeneration: 1,
        expectedMusicMode: "AUTO_RECOMMENDED", publishJobId: "job", recentDouyinMusicJson: "[]" } } as AccountContext;
      const article = { articleId: "article", title: "测试标题", body: "测试正文", summary: "", tags: [], images: [imagePath] } as PublishArticleInput;
      const result = await adapter.preparePublish(ctx, article);
      expect(claim).toHaveBeenCalledTimes(1);
      expect(result.response).toMatchObject({ imageUploaded: true, preMusicDiagnosticRun: true,
        preMusicClassification: "NONE", postMusicReadback: "PASS_NONE" });
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual(["title fill", "body fill", "drawer open"]);
    } finally { await context.close(); }
  });

  it("reads content and NONE before opening the drawer, then freezes NONE after post-readback", async () => {
    const { adapter, page, ctx, article } = await fixture();
    try {
      const result = await adapter.preparePublish(ctx, article);
      expect(result.response).toMatchObject({ preMusicDiagnosticRun: true, preMusicClassification: "NONE",
        postMusicReadback: "PASS_NONE", musicBinding: { mode: "NONE" } });
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual(["title fill", "body fill", "drawer open"]);
    } finally { await page.context().close(); }
  });

  it("prepares and final-preflights an explicit NONE candidate without reading an unknown music DOM", async () => {
    const { adapter, page, ctx, article } = await fixture();
    try {
      ctx.settings.expectedMusicMode = "NONE";
      await page.evaluate(() => {
        const main = document.querySelector("main")!;
        const replacement = document.createElement("section");
        replacement.className = "upload-preview";
        while (main.firstChild) replacement.appendChild(main.firstChild);
        main.replaceWith(replacement);
        document.querySelector("[data-douyin-music-region]")!.innerHTML =
          '<span>选择音乐</span><button aria-pressed="true">选择音乐</button><div>未知音乐结构</div>';
      });
      const musicDomCalls = vi.spyOn(page, "evaluate");
      const prepared = await adapter.preparePublish(ctx, article);
      expect(prepared.response).toMatchObject({ musicModeRequested: "NONE", musicBinding: { mode: "NONE" },
        musicFeatureEnabled: false, musicDomGateExecuted: false });
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions))
        .toEqual(["title fill", "body fill"]);
      await page.locator('[data-douyin-music-region] [aria-pressed]').evaluate((element) => element.setAttribute("aria-pressed", "false"));
      const finalPreflight = await adapter.prepareFinalSubmit(ctx, article);
      expect(finalPreflight.response).toMatchObject({ stage: "final_submit_preflight", titleReadback: true,
        bodyReadback: true, settingsReadback: true });
      expect(musicDomCalls.mock.calls.filter(([fn]) => typeof fn === "function"
        && fn.name === "inspectDouyinMusicDocument")).toHaveLength(0);
    } finally { await page.context().close(); }
  });

  it("keeps AUTO strict when the main editor music structure is unknown", async () => {
    const { adapter, page, ctx, article } = await fixture();
    try {
      await page.evaluate(() => {
        const main = document.querySelector("main")!;
        const replacement = document.createElement("section");
        replacement.className = "upload-preview";
        while (main.firstChild) replacement.appendChild(main.firstChild);
        main.replaceWith(replacement);
      });
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("DOUYIN_PRE_MUSIC_UNKNOWN");
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions))
        .toEqual(["title fill", "body fill"]);
    } finally { await page.context().close(); }
  });

  it("rejects an unknown music policy before any editor preparation", async () => {
    const { adapter, page, ctx, article } = await fixture();
    try {
      ctx.settings.expectedMusicMode = "UNRECOGNIZED";
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("DOUYIN_MUSIC_POLICY_INVALID");
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("still checks music at final preflight when AUTO selected no track", async () => {
    const { adapter, page, ctx, article } = await fixture();
    try {
      const prepared = await adapter.preparePublish(ctx, article);
      expect(prepared.response).toMatchObject({ musicModeRequested: "AUTO_RECOMMENDED",
        musicBinding: { mode: "NONE" }, postMusicReadback: "PASS_NONE" });
      await page.locator("[data-douyin-music-region]").evaluate((element) => element.remove());
      await expect(adapter.prepareFinalSubmit(ctx, article)).rejects.toThrow("DOUYIN_MUSIC_READBACK_MISMATCH");
    } finally { await page.context().close(); }
  });

  it("stops on content mismatch before any music drawer action", async () => {
    const { adapter, page, ctx, article } = await fixture({ corruptBody: true });
    try {
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("BODY_MISMATCH");
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual(["title fill", "body fill"]);
    } finally { await page.context().close(); }
  });

  it("stops on a preexisting selected track before opening a drawer", async () => {
    const { adapter, page, ctx, article } = await fixture({ preselected: true });
    try {
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("DOUYIN_PRE_MUSIC_UNEXPECTED_TRACK");
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual(["title fill", "body fill"]);
    } finally { await page.context().close(); }
  });

  it("allows one track click only after NONE and verifies the selected track", async () => {
    const { adapter, page, ctx, article } = await fixture({ trackOnClick: true });
    try {
      const result = await adapter.preparePublish(ctx, article);
      expect(result.response).toMatchObject({ preMusicClassification: "NONE", postMusicReadback: "PASS_TRACK",
        musicBinding: { mode: "AUTO_RECOMMENDED", title: "舒缓纯音乐" } });
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual(["title fill", "body fill", "drawer open", "music click"]);
    } finally { await page.context().close(); }
  });

  it("never falls back to NONE after a clicked track reads back differently", async () => {
    const { adapter, page, ctx, article } = await fixture({ trackOnClick: true, wrongTrackOnClick: true });
    try {
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("DOUYIN_MUSIC_READBACK_MISMATCH");
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions)).toEqual(["title fill", "body fill", "drawer open", "music click"]);
    } finally { await page.context().close(); }
  });

  it("stops before track click when opening the drawer changes visibility", async () => {
    const { adapter, page, ctx, article } = await fixture({ trackOnClick: true, settingsChangeOnDrawerOpen: true });
    try {
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("DOUYIN_PRE_MUSIC_CURRENT_EDITOR_UNVERIFIED");
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions))
        .toEqual(["title fill", "body fill", "drawer open"]);
    } finally { await page.context().close(); }
  });

  it("stops before track click when a second preview appears after opening the drawer", async () => {
    const { adapter, page, ctx, article } = await fixture({ trackOnClick: true, secondPreviewOnDrawerOpen: true });
    try {
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("DOUYIN_PRE_MUSIC_EDITOR_CHANGED");
      expect(await page.locator(".upload-preview img").count()).toBe(2);
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions))
        .toEqual(["title fill", "body fill", "drawer open"]);
    } finally { await page.context().close(); }
  });

  it("rejects a canonical Page replacement during an asynchronous guard read while the old Page stays open", async () => {
    const { adapter, page, ctx, article, replaceCanonicalDuringNextMusicGuard } = await fixture({ trackOnClick: true });
    try {
      const replacement = await replaceCanonicalDuringNextMusicGuard();
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
      expect(page.isClosed()).toBe(false);
      expect(replacement.isClosed()).toBe(false);
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions))
        .toEqual(["title fill", "body fill"]);
    } finally { await page.context().close(); }
  });

  it("rejects content changed by a selected track before freezing Prepared", async () => {
    const { adapter, page, ctx, article } = await fixture({ trackOnClick: true, bodyChangeOnTrackClick: true });
    try {
      await expect(adapter.preparePublish(ctx, article)).rejects.toThrow("BODY_MISMATCH");
      expect(await page.evaluate(() => (window as Window & { actions?: string[] }).actions))
        .toEqual(["title fill", "body fill", "drawer open", "music click"]);
    } finally { await page.context().close(); }
  });
});
