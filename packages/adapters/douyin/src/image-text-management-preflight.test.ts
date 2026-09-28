import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { inspectDouyinManagementControls, inspectDouyinManagementReadOnlyNavigation } from "./image-text-management-preflight";

const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const home = "https://creator.douyin.com/creator-micro/home";
const manage = "https://creator.douyin.com/creator-micro/content/manage";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(options: { labels?: string; managementId?: string; delayedControls?: boolean;
  dropdownStates?: boolean } = {}) {
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
    const controls = isManage ? options.labels ?? (options.dropdownStates
      ? `<button>已发布</button><div role="button" onclick="document.querySelector('#review-options').hidden=false">审核状态</div>
        <div id="review-options" hidden><button>审核中</button><button>未通过</button></div>`
      : "<button>已发布</button><button>审核中</button><button>未通过</button>")
      : "<div>发布图文</div>";
    const body = `${isManage ? '<input placeholder="搜索作品">' : ""}<section id="controls">${options.delayedControls ? "" : controls}</section>`
      + (options.delayedControls ? `<script>setTimeout(() => { document.querySelector('#controls').innerHTML = ${JSON.stringify(controls)}; }, 350)</script>` : "");
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="UTF-8"></head><body>抖音号：${id}${body}</body></html>` });
  });
  await page.goto(home);
  const verifyIdentity = async () => (await page.locator("body").innerText()).includes("抖音号：72388977613");
  return { page, context, requests, verifyIdentity };
}

describe.skipIf(!existsSync(chrome))("Douyin app-owned read-only management preflight", () => {
  it("recognizes review states inside the live management dropdown without leaving the page", async () => {
    const { page, context, verifyIdentity } = await fixture({ dropdownStates: true });
    await page.goto(manage);
    const result = await inspectDouyinManagementControls(page, context);
    expect(result).toMatchObject({ searchControlCount: 1, stateLabels: ["已发布", "审核中", "未通过"] });
    expect(await verifyIdentity()).toBe(true);
    expect(page.url()).toBe(manage);
  });
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
  }, 15_000);

  it("waits for management filters and the home image entry to hydrate", async () => {
    const { page, context, verifyIdentity } = await fixture({ delayedControls: true });
    const result = await inspectDouyinManagementReadOnlyNavigation(page, context, verifyIdentity);
    expect(result.ready).toBe(true);
    expect(result.imageEntryCount).toBe(1);
  });

  it("recognizes visible filter labels with count suffixes", async () => {
    const { page, context, verifyIdentity } = await fixture({
      labels: "<button>已发布（3）</button><button>审核中（2）</button><button>未通过（1）</button>"
    });
    const result = await inspectDouyinManagementReadOnlyNavigation(page, context, verifyIdentity);
    expect(result.ready).toBe(true);
    expect(result.stateLabels).toEqual(["已发布", "审核中", "未通过"]);
    expect(result.filterControlTexts).toEqual(["已发布（3）", "审核中（2）", "未通过（1）"]);
    expect(result.managementControlHints).toContainEqual({ tag: "button", text: "审核中（2）", role: null });
  });

  it("reads reviewing and rejected options from the current review-status filter", async () => {
    const { page, context, requests, verifyIdentity } = await fixture({ dropdownStates: true });
    const result = await inspectDouyinManagementReadOnlyNavigation(page, context, verifyIdentity);
    expect(result.ready).toBe(true);
    expect(result.stateLabels).toEqual(["已发布", "审核中", "未通过"]);
    expect(result.filterControlTexts).toContain("审核中");
    expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
    expect(page.url()).toBe(home);
  }, 20_000);
});
