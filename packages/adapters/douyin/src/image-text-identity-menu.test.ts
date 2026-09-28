import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { revealDouyinCreatorIdentityReadOnly } from "./image-text-identity-menu";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(body: string) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 1200, height: 720 } });
  const page = await context.newPage();
  await page.route("https://creator.douyin.com/**", async (route) => route.fulfill({
    status: 200, contentType: "text/html; charset=utf-8", body }));
  await page.goto("https://creator.douyin.com/creator-micro/home");
  const readVisibleId = async () => /抖音号\s*[:：]\s*(\d+)/u.exec(await page.locator("body").innerText())?.[1] ?? null;
  return { page, readVisibleId };
}

describe.skipIf(!existsSync(chrome))("Douyin owned-page identity menu reveal", () => {
  it("reveals the stable Creator ID with one normal avatar click and no navigation", async () => {
    const { page, readVisibleId } = await fixture(`<!doctype html><html><body>
      <header style="height:80px"><div class="avatar-control" style="position:absolute;right:20px;top:15px;
        width:40px;height:40px;cursor:pointer" onclick="document.querySelector('#menu').hidden=false">头像</div></header>
      <div id="menu" hidden>抖音号：72388977613</div></body></html>`);
    const result = await revealDouyinCreatorIdentityReadOnly(page, readVisibleId);
    expect(result.creatorId).toBe("72388977613");
    expect(result.probe.attempted).toBe("CLICK");
    expect(page.url()).toBe("https://creator.douyin.com/creator-micro/home");
  });

  it("does not click an ambiguous avatar surface", async () => {
    const { page, readVisibleId } = await fixture(`<!doctype html><html><body><header>
      <div class="avatar-one" style="position:absolute;right:20px;top:15px;width:40px;height:40px;cursor:pointer"
        onclick="window.clicked=true">A</div>
      <div class="avatar-two" style="position:absolute;right:80px;top:15px;width:40px;height:40px;cursor:pointer"
        onclick="window.clicked=true">B</div></header></body></html>`);
    const result = await revealDouyinCreatorIdentityReadOnly(page, readVisibleId);
    expect(result.creatorId).toBeNull();
    expect(result.probe.attempted).toBe("NONE");
    expect(await page.evaluate(() => (window as unknown as { clicked?: boolean }).clicked)).toBeUndefined();
  });
});
