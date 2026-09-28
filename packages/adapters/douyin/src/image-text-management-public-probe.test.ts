import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { probeDouyinPublishedCardPublicUrl } from "./image-text-management-public-probe";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const remoteId = "7690435917298928942";
const title = "装修后为什么要关注甲醛？";
const marker = "DYCORE693951f2";
const submittedAt = "2026-09-28T04:19:20.640Z";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(cards: string[]) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext();
  const page = await context.newPage();
  const methods: string[] = [];
  await context.route("https://creator.douyin.com/**", async (route) => {
    methods.push(route.request().method());
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body:
      `<!doctype html><html><body><input placeholder="搜索作品"><div class="list-scroll-real">
       <div class="content-body-real">${cards.join("")}</div></div></body></html>` });
  });
  await context.route("https://www.douyin.com/**", async (route) => {
    methods.push(route.request().method());
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body:
      `<html><body>${title} ${marker}</body></html>` });
  });
  return { context, page, methods };
}

function card(state = "已发布", id = remoteId): string {
  return `<div class="video-card-real"><div>${title} ${marker}</div>
    <div class="info-time-real">2026年09月28日 12:19</div><div class="info-status-real">${state}</div>
    <div class="video-card-cover-real" style="cursor:pointer;width:100px;height:100px"
      onclick="window.open('https://www.douyin.com/note/${id}?track=discard','_blank')">封面</div>
    <div class="edit-btn-real" onclick="window.edited=true">编辑作品</div>
    <div class="ghost-btn-real" onclick="window.deleted=true">删除作品</div></div>`;
}

describe.skipIf(!existsSync(chrome))("Douyin exact-card read-only public view", () => {
  it("opens only the unique matched cover and verifies the actual work URL", async () => {
    const { context, page, methods } = await fixture([card()]);
    const result = await probeDouyinPublishedCardPublicUrl(page, context, {
      remoteId, title, marker, submitBoundaryEnteredAt: submittedAt });
    expect(result).toMatchObject({ attempted: true, exactTargetCardCount: 1, cardState: "PUBLISHED",
      cardTimeMatchesBoundary: true, actualPublicUrl: `https://www.douyin.com/note/${remoteId}`,
      actualRemoteId: remoteId, exactRemoteIdMatch: true, publicTitleMatch: true,
      publicMarkerMatch: true });
    expect(await page.evaluate(() => (window as unknown as { edited?: boolean; deleted?: boolean }).edited)).toBeUndefined();
    expect(await page.evaluate(() => (window as unknown as { edited?: boolean; deleted?: boolean }).deleted)).toBeUndefined();
    expect(methods.every((method) => method === "GET")).toBe(true);
  }, 20_000);

  it("does not click a duplicate target or a reviewing card", async () => {
    const first = await fixture([card(), card()]);
    const duplicate = await probeDouyinPublishedCardPublicUrl(first.page, first.context, {
      remoteId, title, marker, submitBoundaryEnteredAt: submittedAt });
    expect(duplicate).toMatchObject({ attempted: false, reason: "TARGET_CARD_NOT_UNIQUE" });
    const second = await fixture([card("审核中")]);
    const reviewing = await probeDouyinPublishedCardPublicUrl(second.page, second.context, {
      remoteId, title, marker, submitBoundaryEnteredAt: submittedAt });
    expect(reviewing).toMatchObject({ attempted: false, reason: "TARGET_CARD_STATE_OR_TIME_UNVERIFIED" });
    expect(first.methods).toEqual(["GET"]);
    expect(second.methods).toEqual(["GET"]);
  }, 20_000);

  it("does not accept a different remote work ID from the opened URL", async () => {
    const { context, page } = await fixture([card("已发布", "7690435917298928999")]);
    const result = await probeDouyinPublishedCardPublicUrl(page, context, {
      remoteId, title, marker, submitBoundaryEnteredAt: submittedAt });
    expect(result).toMatchObject({ attempted: true, exactRemoteIdMatch: false,
      reason: "PUBLIC_REMOTE_ID_MISMATCH", actualRemoteId: "7690435917298928999" });
  }, 20_000);

  it("waits past an early empty list shell before assessing the target card", async () => {
    const delayed = `<script>setTimeout(() => { document.querySelector('.content-body-real').innerHTML = ${JSON.stringify(card())}; }, 500);</script>`;
    const { context, page } = await fixture([delayed]);
    const result = await probeDouyinPublishedCardPublicUrl(page, context, {
      remoteId, title, marker, submitBoundaryEnteredAt: submittedAt });
    expect(result).toMatchObject({ attempted: true, exactTargetCardCount: 1,
      exactRemoteIdMatch: true });
  }, 20_000);
});
