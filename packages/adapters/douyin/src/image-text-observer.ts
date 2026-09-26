import type { Page, Request, Response, Route } from "playwright-core";
import { classifyDouyinPublishResponse, type DouyinPublishResponseEvidence } from "./image-text-evidence";

export const isPublishRequest = (request: Pick<Request, "url" | "method">): boolean => {
  try {
    const url = new URL(request.url());
    return request.method() === "POST" && (url.hostname === "creator.douyin.com" || url.hostname.endsWith(".douyin.com"))
      && url.pathname === "/web/api/media/aweme/create_v2/";
  } catch { return false; }
};

/** Observes only the owned Page. Never records request headers, body, cookies or signed URLs. */
export class DouyinImagePostObserver {
  private requestCount = 0;
  private finalClickCount = 0;
  private responseObserved = false;
  private httpStatus: number | null = null;
  private statusCode: number | null = null;
  private itemId: string | null = null;
  private afterFinalAction = false;
  private readonly trackedRequests = new Set<Request>();
  private allowedDispatchCount = 0;
  private routeInstalled = false;
  private readonly routePattern = "**/web/api/media/aweme/create_v2/**";
  private readonly onRoute = async (route: Route): Promise<void> => {
    if (!isPublishRequest(route.request())) { await route.continue(); return; }
    if (!this.afterFinalAction) { await route.abort(); return; }
    this.allowedDispatchCount += 1;
    if (this.allowedDispatchCount > 1) { await route.abort(); return; }
    await route.continue();
  };
  private readonly pending = new Set<Promise<void>>();
  private readonly onRequest = (request: Request): void => {
    if (this.afterFinalAction && isPublishRequest(request)) { this.requestCount += 1; this.trackedRequests.add(request); }
  };
  private readonly onResponse = (response: Response): void => {
    if (!this.trackedRequests.has(response.request())) return;
    const read = (async (): Promise<void> => {
      this.responseObserved = true;
      this.httpStatus = response.status();
      try {
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
        const data = payload as Record<string, unknown>;
        const status = data.status_code;
        this.statusCode = typeof status === "number" && Number.isInteger(status) ? status : null;
        const item = data.item_id ?? (data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>).item_id : null);
        this.itemId = typeof item === "string" && /^\d{10,30}$/u.test(item) ? item : null;
      } catch { /* An unreadable response is uncertain. */ }
    })();
    this.pending.add(read);
    void read.finally(() => this.pending.delete(read));
  };

  constructor(private readonly page: Page) {
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
  }

  /** Guard only this Page's known image-post create path. It remains until Page closure after the claim. */
  async installOneShotGuard(): Promise<void> {
    await this.page.route(this.routePattern, this.onRoute);
    this.routeInstalled = true;
  }

  async removeUnusedGuard(): Promise<void> {
    if (this.routeInstalled && this.finalClickCount === 0) {
      await this.page.unroute(this.routePattern, this.onRoute);
      this.routeInstalled = false;
    }
  }

  markFinalClick(): void { this.finalClickCount += 1; this.afterFinalAction = true; }

  async collect(timeoutMs = 20_000): Promise<{ evidence: DouyinPublishResponseEvidence; classification: ReturnType<typeof classifyDouyinPublishResponse> }> {
    const deadline = Date.now() + timeoutMs;
    while (!this.responseObserved && !this.page.isClosed() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    await Promise.race([Promise.allSettled([...this.pending]), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    const evidence: DouyinPublishResponseEvidence = { finalClickCount: this.finalClickCount, requestCount: this.requestCount,
      responseObserved: this.responseObserved, httpStatus: this.httpStatus, statusCode: this.statusCode, itemId: this.itemId,
      samePage: !this.page.isClosed(), afterFinalAction: this.afterFinalAction };
    return { evidence, classification: classifyDouyinPublishResponse(evidence) };
  }

  stop(): void { this.page.off("request", this.onRequest); this.page.off("response", this.onResponse); }
}
