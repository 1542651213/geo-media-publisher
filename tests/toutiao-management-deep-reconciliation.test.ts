import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright-core";
import {
  matchDeepToutiaoRows, parseToutiaoManagementRowTime, resolveOwnedToutiaoManagementPage,
  scanOwnedToutiaoManagement
} from "../packages/adapters/toutiao/src/management-deep-reconciliation";
import { sanitizeToutiaoResponseDiagnostic } from "../packages/adapters/toutiao/src/article-api/captured-request-replay";

const submittedAt = "2026-09-25T01:09:42.000Z";
const title = "GMP头条单次测试260925010942";
const target = { title, submittedAt, remoteId: null };
const row = (state: string, name = title, time = "2026-09-25 09:09") => ({
  title: name, rowText: `${name} ${state} ${time}`, href: "/article/123456789", dataId: "123456789"
});

describe("Toutiao owned management reconciliation", () => {
  it("selects only the account context's management page", () => {
    const context = { pages: vi.fn() } as unknown as BrowserContext;
    const otherContext = { pages: vi.fn() } as unknown as BrowserContext;
    const page = (url: string, owner: BrowserContext) => ({ isClosed: () => false, context: () => owner, url: () => url }) as unknown as Page;
    const canonical = page("https://mp.toutiao.com/profile_v4/index", context);
    const irrelevant = page("https://mp.toutiao.com/profile_v4/graphic/publish", context);
    const owned = page("https://mp.toutiao.com/profile_v4/manage/content/all?tab=all", context);
    const foreign = page("https://mp.toutiao.com/profile_v4/manage/content/all", otherContext);
    vi.mocked(context.pages).mockReturnValue([canonical, irrelevant, foreign, owned]);
    expect(resolveOwnedToutiaoManagementPage(context, canonical)).toBe(owned);
    expect(() => resolveOwnedToutiaoManagementPage(context, foreign)).toThrow("CONTEXT_OWNERSHIP_MISMATCH");
  });

  it("parses platform local time and requires the target time window", () => {
    expect(parseToutiaoManagementRowTime("2026-09-25 09:09", submittedAt)).toBe(Date.parse("2026-09-25T01:09:00Z"));
    expect(matchDeepToutiaoRows([row("已发布", title, "2026-08-10 09:09")], target).match.state).toBe("NOT_FOUND");
  });

  it("classifies the unique target row without mistaking a different title", () => {
    expect(matchDeepToutiaoRows([row("审核中"), row("已发布", "别的文章")], target).match.state).toBe("REVIEWING");
    expect(matchDeepToutiaoRows([row("审核未通过")], target).match.state).toBe("REJECTED");
    expect(matchDeepToutiaoRows([row("草稿")], target).match.state).toBe("DRAFT");
    expect(matchDeepToutiaoRows([row("已发布")], target).match.state).toBe("PUBLISHED");
    expect(matchDeepToutiaoRows([], target).match.state).toBe("NOT_FOUND");
  });

  it("blocks an automatic content mutation before returning any scan result", async () => {
    let guard: ((route: unknown) => Promise<void>) | undefined;
    const page = {
      isClosed: () => false, url: () => "https://mp.toutiao.com/profile_v4/manage/content/all",
      context: () => context, on: vi.fn(), off: vi.fn(), waitForTimeout: vi.fn(),
      goto: vi.fn(async () => {
        const request = { method: () => "POST", url: () => "https://mp.toutiao.com/mp/agw/article/publish",
          headers: () => ({}), postData: () => null, resourceType: () => "fetch", frame: () => ({ url: () => page.url() }) };
        await guard?.({ request: () => request, abort: vi.fn() });
      }), evaluate: vi.fn(async () => ({ rows: [], statuses: [], nextExists: false, nextDisabled: false }))
    } as unknown as Page;
    const context = { pages: () => [page], serviceWorkers: () => [],
      route: vi.fn(async (_pattern: string, handler: typeof guard) => { guard = handler; }),
      unroute: vi.fn() } as unknown as BrowserContext;
    await expect(scanOwnedToutiaoManagement(context, page, target))
      .rejects.toThrow("MUTATION_ATTEMPT_BLOCKED");
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(context.unroute).toHaveBeenCalledTimes(1);
  });
});

describe("future response diagnostic sanitizer", () => {
  it("retains bounded plain error text and rejects secret shaped responses", () => {
    expect(sanitizeToutiaoResponseDiagnostic("参数错误，请检查封面")).toBe("参数错误，请检查封面");
    expect(sanitizeToutiaoResponseDiagnostic("token=secret")).toBeNull();
    expect(sanitizeToutiaoResponseDiagnostic("https://example.com/?a=secret")).toBeNull();
    expect(sanitizeToutiaoResponseDiagnostic("a".repeat(40))).toBeNull();
    expect(sanitizeToutiaoResponseDiagnostic("错误".repeat(100))).toBeNull();
  });
});
