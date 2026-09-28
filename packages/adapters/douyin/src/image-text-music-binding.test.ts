import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import type { AccountContext } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import { DouyinImageTextBrowserAdapter } from "./image-text-browser";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const store: CredentialStore = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false };
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });
const binding = { accountId: "account", articleId: "article", jobId: "job", creatorId: "72388977613",
  loginGeneration: 2, sessionIdHash: "session" };
const ctx: AccountContext = { accountId: "account", accountName: "Owner", platformKey: "douyin",
  settings: { expectedCreatorId: binding.creatorId, expectedLoginGeneration: 2 }, secrets: {} };

describe.skipIf(!existsSync(chrome))("read-only music diagnostic ownership", () => {
  it("reads only the owned editor and treats hidden identity as continuity evidence", async () => {
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    browsers.push(browser);
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests: string[] = [];
    await page.route("https://creator.douyin.com/**", (route) => {
      requests.push(route.request().method());
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: '<html><body><main><div data-douyin-music-region><div class="title">选择音乐</div></div></main></body></html>' });
    });
    await page.goto("https://creator.douyin.com/creator-micro/content/post/image");
    requests.length = 0;
    const adapter = new DouyinImageTextBrowserAdapter({ credentialStore: store });
    const session = { context, page, executionMode: "VISIBLE", sessionIdHash: "session" };
    Object.defineProperty(adapter, "activeCanonicalPage", { value: async () => ({ page, session }) });
    const diagnostic = await adapter.inspectCurrentImageTextMusicReadOnly(ctx, binding);
    expect(diagnostic).toMatchObject({ identityVerificationMode: "CONTINUITY_EVIDENCE", identityVerified: false,
      contextOwnership: true, music: { classification: "NONE", entryNodeCount: 1 } });
    expect(requests).toEqual([]);
    expect(page.url()).toBe("https://creator.douyin.com/creator-micro/content/post/image");
    await expect(adapter.inspectCurrentImageTextMusicReadOnly({ ...ctx, accountId: "other" }, binding)).rejects.toThrow();
    session.sessionIdHash = "wrong";
    await expect(adapter.inspectCurrentImageTextMusicReadOnly(ctx, binding)).rejects.toThrow();
  });
});
