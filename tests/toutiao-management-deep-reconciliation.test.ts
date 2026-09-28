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

  it("keeps the broad scan horizon separate from the precise submission match window", () => {
    expect(matchDeepToutiaoRows([row("已发布", title, "2026-09-26 09:09")], target).match.state).toBe("NOT_FOUND");
    expect(matchDeepToutiaoRows([row("已发布"), row("已发布")], target).match.state).toBe("PUBLISHED");
    expect(matchDeepToutiaoRows([row("已发布"), { ...row("审核中"), dataId: "999", href: "/article/999" }],
      { ...target, remoteId: "123456789" }).match.state).toBe("PUBLISHED");
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

  it("scans later pages before deciding a title match is unique", async () => {
    let status = "全部"; let pageIndex = 0; let selection = "";
    const targetA = row("已发布");
    const targetB = { ...row("已发布"), href: "/article/999", dataId: "999" };
    const control = {
      first() { return this; }, filter(value: { hasText: string }) { selection = value.hasText; return this; },
      isVisible: async () => true, isEnabled: async () => true, count: async () => 1, hover: async () => undefined,
      click: vi.fn(async () => { if (selection) { status = selection; selection = ""; pageIndex = 0; } else pageIndex += 1; })
    };
    const page = { isClosed: () => false, context: () => context,
      url: () => status === "草稿箱" ? "https://mp.toutiao.com/profile_v4/manage/draft" : "https://mp.toutiao.com/profile_v4/manage/content/all",
      on: vi.fn(), off: vi.fn(), waitForTimeout: vi.fn(), locator: () => control,
      goto: vi.fn(async (url: string) => { status = url.endsWith("/draft") ? "草稿箱" : "全部"; pageIndex = 0; }),
      evaluate: vi.fn(async () => ({ rows: status === "全部" ? [pageIndex === 0 ? targetA : targetB] : [],
        statuses: ["全部", "已发布"], nextExists: status === "全部", nextDisabled: pageIndex === 1,
        emptyState: status !== "全部", managementLinkPaths: [], paginationControls: [], statusControlShape: [] }))
    } as unknown as Page;
    const context = { pages: () => [page], serviceWorkers: () => [], route: vi.fn(), unroute: vi.fn() } as unknown as BrowserContext;
    const result = await scanOwnedToutiaoManagement(context, page, target);
    expect(result.match.state).toBe("AMBIGUOUS");
    expect(result.scans[0]).toMatchObject({ pages: 2, rows: 2 });
    expect(result.scopeComplete).toBe(true);
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
