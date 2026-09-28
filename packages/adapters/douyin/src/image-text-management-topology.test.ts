import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { inspectDouyinManagementTopology } from "./image-text-management-topology";

const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const manage = "https://creator.douyin.com/creator-micro/content/manage";
const targetId = "7690435917298928942";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(body: string) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext();
  const page = await context.newPage();
  const methods: string[] = [];
  await page.route("https://creator.douyin.com/**", async (route) => {
    methods.push(route.request().method());
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
  });
  await page.goto(manage);
  return { context, page, methods };
}

describe.skipIf(!existsSync(chrome))("Douyin bounded app-owned management topology", () => {
  it("returns structural hints without a signed URL, attribute values, or page HTML", async () => {
    const { context, page, methods } = await fixture(`<!doctype html><html><body>
      <input placeholder="搜索作品"><button>已发布</button><button>审核中</button><button>未通过</button>
      <div class="work-list" style="height:150px;overflow-y:auto"><div style="height:400px">
        <div class="work-card" data-work-id="${targetId}" data-secret="do-not-return">
          <a href="https://www.douyin.com/note/${targetId}?token=secret-value">测试作品</a><span>已发布</span>
        </div></div></div><button aria-label="下一页">下一页</button>
      <div>没有更多作品</div></body></html>`);
    const result = await inspectDouyinManagementTopology(page, context, targetId);
    expect(result.searchControls).toContainEqual({ tag: "input", role: null, placeholder: "搜索作品", visible: true });
    expect(result.statusControls.map((item) => item.text)).toEqual(expect.arrayContaining(["已发布", "审核中", "未通过"]));
    expect(result.anchorSamples).toEqual(expect.arrayContaining([expect.objectContaining({
      pathTemplate: "/note/:id", exactTargetIdInPath: true })]));
    expect(result.rowSamples).toEqual(expect.arrayContaining([expect.objectContaining({
      classSummary: "work-card", exactTargetIdInData: true, dataAttributeNames: ["data-work-id", "data-secret"] })]));
    expect(result.paginationControls.map((item) => item.text)).toContain("下一页");
    expect(result.scrollContainers.some((item) => item.classSummary === "work-list")).toBe(true);
    expect(result.endOfListSignal).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(methods).toEqual(["GET"]);
  });

  it("rejects a foreign Context, wrong route, and malformed target before reading DOM", async () => {
    const { context, page } = await fixture("<input placeholder='搜索作品'>");
    const other = await context.browser()!.newContext();
    try {
      await expect(inspectDouyinManagementTopology(page, other, targetId)).rejects.toThrow("CONTEXT_MISMATCH");
      await expect(inspectDouyinManagementTopology(page, context, "bad")).rejects.toThrow("TARGET_ID_INVALID");
      await page.goto("https://creator.douyin.com/creator-micro/home");
      await expect(inspectDouyinManagementTopology(page, context, targetId)).rejects.toThrow("ROUTE_MISMATCH");
    } finally { await other.close(); }
  });

  it("records review dropdown option topology separately without selecting a status", async () => {
    const { context, page, methods } = await fixture(`<!doctype html><html><body>
      <input placeholder="搜索作品"><button>已发布</button>
      <div role="button" onclick="document.querySelector('#review-options').hidden=false">审核状态</div>
      <div id="review-options" hidden><div role="option" class="state-choice">审核中</div>
        <div role="option" class="state-choice">未通过</div></div></body></html>`);
    const result = await inspectDouyinManagementTopology(page, context, targetId);
    expect(result.statusControls.map((item) => item.text)).toContain("已发布");
    expect(result.reviewDropdown).toMatchObject({ controlMatchCount: 1, opened: true, reasonCode: null });
    expect(result.reviewDropdown.visibleOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "option", text: "审核中", classSummary: "state-choice" }),
      expect.objectContaining({ role: "option", text: "未通过", classSummary: "state-choice" })]));
    expect(page.url()).toBe(manage);
    expect(methods).toEqual(["GET"]);
  });

  it("waits for the real list to replace an early loading surface", async () => {
    const { context, page } = await fixture(`<!doctype html><html><body>
      <input placeholder="搜索作品"><div class="list-loading" role="progressbar">加载中</div>
      <section id="works"></section><script>setTimeout(() => {
        document.querySelector('.list-loading').remove();
        document.querySelector('#works').innerHTML = '<div class="work-card" data-work-id="${targetId}"><a href="https://www.douyin.com/note/${targetId}">目标</a><span>已发布</span></div>';
      }, 400);</script></body></html>`);
    const result = await inspectDouyinManagementTopology(page, context, targetId);
    expect(result.loadingIndicatorCount).toBe(0);
    expect(result.rowSamples.some((row) => row.exactTargetIdInData)).toBe(true);
  }, 15_000);
});
