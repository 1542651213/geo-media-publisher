import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { inspectDouyinManagementReadOnlyNavigation } from "./image-text-management-preflight";

const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const home = "https://creator.douyin.com/creator-micro/home";
const manage = "https://creator.douyin.com/creator-micro/content/manage";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(options: { labels?: string; managementId?: string } = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  await page.route("https://creator.douyin.com/**", async (route) => {
    const request = route.request();
    requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    const isManage = new URL(request.url()).pathname === "/creator-micro/content/manage";
    const id = isManage ? options.managementId ?? "72388977613" : "72388977613";
    const body = isManage
      ? `<input placeholder="搜索作品">${options.labels ?? "<button>已发布</button><button>审核中</button><button>未通过</button>"}`
      : "<div>发布图文</div>";
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="UTF-8"></head><body>抖音号：${id}${body}</body></html>` });
  });
  await page.goto(home);
  const verifyIdentity = async () => (await page.locator("body").innerText()).includes("抖音号：72388977613");
  return { page, context, requests, verifyIdentity };
}

describe.skipIf(!existsSync(chrome))("Douyin app-owned read-only management preflight", () => {
  it("uses only the same owned Page and GET navigation, then returns home", async () => {
    const { page, context, requests, verifyIdentity } = await fixture();
    const result = await inspectDouyinManagementReadOnlyNavigation(page, context, verifyIdentity);
    expect(result).toMatchObject({ managementUrl: manage, returnUrl: home, ready: true,
      searchControlCount: 1, stateLabels: ["已发布", "审核中", "未通过"], imageEntryCount: 1 });
    expect(page.url()).toBe(home);
    expect(requests).toEqual(["GET /creator-micro/home", "GET /creator-micro/content/manage", "GET /creator-micro/home"]);
  });

  it("rejects a foreign Context, active editor and changed Creator identity before proceeding", async () => {
    const foreign = await fixture();
    await expect(inspectDouyinManagementReadOnlyNavigation(foreign.page, {} as typeof foreign.context, foreign.verifyIdentity))
      .rejects.toThrow("DOUYIN_READONLY_CONTEXT_MISMATCH");
    await foreign.page.goto("https://creator.douyin.com/creator-micro/content/post/image");
    await expect(inspectDouyinManagementReadOnlyNavigation(foreign.page, foreign.context, foreign.verifyIdentity))
      .rejects.toThrow("DOUYIN_READONLY_EDITOR_PRESERVED");
    const changed = await fixture({ managementId: "90000000000" });
    await expect(inspectDouyinManagementReadOnlyNavigation(changed.page, changed.context, changed.verifyIdentity))
      .rejects.toThrow("DOUYIN_READONLY_CREATOR_IDENTITY_CHANGED");
    expect(changed.page.url()).toBe(manage);
  });

  it("records missing filters without inventing them", async () => {
    const { page, context, verifyIdentity } = await fixture({ labels: "<button>已发布</button>" });
    const result = await inspectDouyinManagementReadOnlyNavigation(page, context, verifyIdentity);
    expect(result.ready).toBe(false);
    expect(result.stateLabels).toEqual(["已发布"]);
    expect(result.returnUrl).toBe(home);
  });
});
