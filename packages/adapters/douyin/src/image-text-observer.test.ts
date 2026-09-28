import { EventEmitter } from "node:events";
import type { Page, Request, Response, Route } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { DouyinImagePostObserver, isPublishRequest } from "./image-text-observer";

const request = (url: string, method = "POST"): Request => ({ url: () => url, method: () => method }) as Request;
const publishUrl = "https://creator.douyin.com/web/api/media/aweme/create_v2/?signed=never-logged";

class MockPage extends EventEmitter {
  routeHandler: ((route: Route) => Promise<void>) | null = null;
  async route(_pattern: string, handler: (route: Route) => Promise<void>): Promise<void> { this.routeHandler = handler; }
  async unroute(): Promise<void> { this.routeHandler = null; }
  isClosed(): boolean { return false; }
}

describe("Douyin one-shot page response observer", () => {
  it("matches only the known browser image-post write path", () => {
    expect(isPublishRequest(request(publishUrl))).toBe(true);
    expect(isPublishRequest(request(publishUrl, "GET"))).toBe(false);
    expect(isPublishRequest(request("https://evil.example/web/api/media/aweme/create_v2/"))).toBe(false);
    expect(isPublishRequest(request("https://creator.douyin.com/web/api/media/aweme/create_v3/"))).toBe(false);
  });

  it("passes one request and aborts a second Page request", async () => {
    const page = new MockPage();
    const observer = new DouyinImagePostObserver(page as unknown as Page);
    await observer.installOneShotGuard();
    observer.markFinalClick();
    const first = { request: () => request(publishUrl), continue: vi.fn(), abort: vi.fn() } as unknown as Route;
    const second = { request: () => request(publishUrl), continue: vi.fn(), abort: vi.fn() } as unknown as Route;
    await page.routeHandler!(first);
    await page.routeHandler!(second);
    expect(first.continue).toHaveBeenCalledOnce();
    expect(first.abort).not.toHaveBeenCalled();
    expect(second.abort).toHaveBeenCalledOnce();
    observer.stop();
    expect(page.routeHandler).not.toBeNull();
  });

  it("blocks unknown writes during final action without blocking reads", async () => {
    const page = new MockPage();
    const observer = new DouyinImagePostObserver(page as unknown as Page);
    await observer.installOneShotGuard();
    observer.markFinalClick();
    const write = { request: () => request("https://creator.douyin.com/unrelated/write"), continue: vi.fn(), abort: vi.fn() } as unknown as Route;
    const read = { request: () => request("https://creator.douyin.com/unrelated/read", "GET"), continue: vi.fn(), abort: vi.fn() } as unknown as Route;
    await page.routeHandler!(write);
    await page.routeHandler!(read);
    expect(write.abort).toHaveBeenCalledOnce();
    expect(read.continue).toHaveBeenCalledOnce();
    observer.stop();
  });

  it("accepts one correlated safe response and keeps duplicate observation uncertain", async () => {
    const page = new MockPage();
    const observer = new DouyinImagePostObserver(page as unknown as Page);
    observer.markFinalClick();
    const req = request(publishUrl);
    page.emit("request", req);
    page.emit("response", { request: () => req, status: () => 200,
      json: async () => ({ status_code: 0, item_id: "7361234567890123456", cookie: "secret" }) } as unknown as Response);
    const result = await observer.collect(100);
    expect(result.classification).toEqual({ status: "ACCEPTED", remoteId: "7361234567890123456" });
    expect(JSON.stringify(result)).not.toContain("secret");
    page.emit("request", req);
    expect((await observer.collect(100)).classification.status).toBe("UNKNOWN");
    observer.stop();
  });

  it("ignores a response from before the final action", async () => {
    const page = new MockPage();
    const observer = new DouyinImagePostObserver(page as unknown as Page);
    const old = request(publishUrl);
    page.emit("request", old);
    observer.markFinalClick();
    page.emit("response", { request: () => old, status: () => 200,
      json: async () => ({ status_code: 0, item_id: "7361234567890123456" }) } as unknown as Response);
    expect((await observer.collect(10)).classification.status).toBe("UNKNOWN");
    observer.stop();
  });
});
