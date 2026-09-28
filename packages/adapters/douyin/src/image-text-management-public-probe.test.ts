import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { isTrustedDouyinPublishedProbe, probeDouyinPublishedCardPublicUrl } from "./image-text-management-public-probe";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const remoteId = "7690435917298928942";
const title = "装修后为什么要关注甲醛？";
const marker = "DYCORE693951f2";
const submittedAt = "2026-09-28T04:19:20.640Z";
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

async function fixture(cards: string[], profileLink = false) {
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
    const body = profileLink && new URL(route.request().url()).pathname === "/user/self"
      ? `<a href="https://www.douyin.com/note/${remoteId}?source=profile">作品</a>`
      : `${title} ${marker}<img src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E">`;
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body:
      `<html><body>${body}</body></html>` });
  });
  return { context, page, methods };
}

function card(state = "已发布", id = remoteId): string {
  return `<div class="video-card-real"><div class="info-title-text-real">${title}。正文 ${marker}</div>
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

  it("opens the actual exact-ID link from a bounded view dialog", async () => {
    const modalCard = card().replace(/window\.open\([^;]+\)/u, "document.querySelector('#view').hidden=false");
    const { context, page } = await fixture([modalCard,
      `<div id="view" role="dialog" hidden><a href="https://www.douyin.com/note/${remoteId}">查看</a></div>`]);
    const result = await probeDouyinPublishedCardPublicUrl(page, context, {
      remoteId, title, marker, submitBoundaryEnteredAt: submittedAt });
    expect(result).toMatchObject({ attempted: true, reason: "ACTUAL_PUBLIC_WORK_OPENED",
      publicUrlSource: "ACTUAL_VIEW_HREF", exactRemoteIdMatch: true,
      observedPagePath: "/creator-micro/content/manage", visibleDialogCount: 1,
      visibleWorkLinkPaths: [expect.objectContaining({ exactRemoteIdInPath: true })] });
  }, 20_000);

  it("uses an actual exact-ID profile href when the cover opens the public self page", async () => {
    const profileCard = card().replace(`https://www.douyin.com/note/${remoteId}?track=discard`,
      "https://www.douyin.com/user/self");
    const { context, page } = await fixture([profileCard], true);
    const result = await probeDouyinPublishedCardPublicUrl(page, context, {
      remoteId, title, marker, submitBoundaryEnteredAt: submittedAt });
    expect(result).toMatchObject({ attempted: true, publicUrlSource: "ACTUAL_VIEW_HREF",
      actualPublicUrl: `https://www.douyin.com/note/${remoteId}`, exactRemoteIdMatch: true,
      publicTitleMatch: true, publicMarkerMatch: true });
  }, 20_000);

  it("reconciles a unique exact title without a marker only after the real href proves the trusted ID", async () => {
    const profileCard = card().replace(`https://www.douyin.com/note/${remoteId}?track=discard`,
      "https://www.douyin.com/user/self");
    const { context, page } = await fixture([profileCard], true);
    const result = await probeDouyinPublishedCardPublicUrl(page, context, {
      remoteId, title, submitBoundaryEnteredAt: submittedAt });
    expect(result).toMatchObject({ attempted: true, cardState: "PUBLISHED",
      exactRemoteIdMatch: true, actualPublicUrl: `https://www.douyin.com/note/${remoteId}`,
      publicTitleMatch: true, publicMarkerMatch: false });
    expect(isTrustedDouyinPublishedProbe(result, remoteId)).toBe(true);
    for (const weakened of [
      { ...result, cardState: "REVIEWING" as const },
      { ...result, cardTimeMatchesBoundary: false },
      { ...result, exactTargetCardCount: 2 },
      { ...result, actualRemoteId: "7690435917298928999" },
      { ...result, actualPublicUrl: "https://www.douyin.com/note/7690435917298928999" },
      { ...result, actualPublicUrl: `https://other.douyin.com/note/${remoteId}` },
      { ...result, publicTitleMatch: false },
      { ...result, publicImageEvidence: false },
      { ...result, reason: "PUBLIC_VIEW_READ_FAILED_AFTER_CLICK" }
    ]) expect(isTrustedDouyinPublishedProbe(weakened, remoteId)).toBe(false);
  }, 20_000);

  it("does not accept a title that only contains the approved title as a substring", async () => {
    const { context, page, methods } = await fixture([
      card().replace(`>${title}。正文`, `>扩展${title}。正文`)]);
    const result = await probeDouyinPublishedCardPublicUrl(page, context, {
      remoteId, title, submitBoundaryEnteredAt: submittedAt });
    expect(result).toMatchObject({ attempted: false, reason: "TARGET_CARD_NOT_UNIQUE" });
    expect(methods).toEqual(["GET"]);
  }, 20_000);
});
