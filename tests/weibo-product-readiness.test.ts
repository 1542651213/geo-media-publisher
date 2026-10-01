import { expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import * as weibo from "@publisher/adapters-weibo/browser";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBrowserReconciliationId } from "@publisher/publisher";

const inspect = (url: string, text: string, creatorId: string | null, composeCount = 1) =>
  (weibo as unknown as { classifyWeiboCreatorSession(url: string, text: string, creatorId: string | null, composeCount: number): string }).classifyWeiboCreatorSession(url, text, creatorId, composeCount);
it("does not treat visitor content, an untrusted URL or a challenge as an authenticated Weibo Creator", () => {
  expect(inspect("https://weibo.com/", "热门微博 登录", null)).toBe("needs_user_action");
  expect(inspect("https://weibo.com.evil.invalid/", "我的主页 发微博", "123456789")).not.toBe("logged_in");
  expect(inspect("https://weibo.com/", "我的主页 发微博 安全验证", "123456789")).toBe("needs_user_action");
  expect(inspect("https://weibo.com/", "我的主页 发微博", "123456789", 2)).toBe("unknown");
  expect(inspect("https://weibo.com/", "我的主页 发微博", "123456789")).toBe("logged_in");
});
it("refuses a changed image binding and refuses any final action without a durable callback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "weibo-image-binding-")), path = join(dir, "fixture.png");
  try {
    writeFileSync(path, "original-fixture");
    const hashes = [createHash("sha256").update("original-fixture").digest("hex")];
    expect(() => weibo.assertWeiboImageBinding([path], hashes)).not.toThrow();
    writeFileSync(path, "changed-fixture");
    expect(() => weibo.assertWeiboImageBinding([path], hashes)).toThrow("已改变");
    const adapter = new weibo.WeiboBrowserAdapter({ credentialStore: { get: () => null, set: () => {}, delete: () => {}, has: () => false } });
    await expect(adapter.finalSubmit({ accountId: "owned", accountName: "Owner", platformKey: "weibo", settings: {} }, { articleId: "draft", title: "标题", body: "正文", summary: "", tags: [] }, { jobId: "job", submissionIntentId: "intent", attempt: 1 })).rejects.toThrow("提交边界");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("accepts only an exact author-owned HTTPS post URL as a reconciliation identity", () => {
  const parse = (weibo as unknown as { parseWeiboPostUrl(url: string, creatorId: string): { externalId: string; publishedUrl: string } | null }).parseWeiboPostUrl;
  expect(parse("https://weibo.com/123456789/Rf17LuR6n", "123456789")).toMatchObject({ externalId: "Rf17LuR6n" });
  for (const url of ["https://weibo.com/u/123456789", "https://weibo.com/987654321/Rf17LuR6n", "https://weibo.com.evil.invalid/123456789/Rf17LuR6n", "http://weibo.com/123456789/Rf17LuR6n"]) expect(parse(url, "123456789")).toBeNull();
});
it("retains Weibo alphanumeric mids without weakening numeric IDs for other platforms", () => {
  expect(isBrowserReconciliationId("weibo", "Rf17LuR6n")).toBe(true);
  expect(isBrowserReconciliationId("toutiao", "Rf17LuR6n")).toBe(false);
  expect(isBrowserReconciliationId("douyin", "7591234567")).toBe(true);
  for (const id of [null, "", "../Rf17LuR6n", "https://evil.invalid", "A".repeat(31)]) expect(isBrowserReconciliationId("weibo", id)).toBe(false);
});
it("returns the publisher's exact-ID evidence only after a read of the bound author's public URL", async () => {
  const adapter = new weibo.WeiboBrowserAdapter({ credentialStore: { get: () => null, set: () => {}, delete: () => {}, has: () => false } });
  const url = "https://weibo.com/123456789/Rf17LuR6n";
  const goto = vi.fn(async () => ({ status: () => 200 }));
  const page = { goto, url: () => url, locator: () => ({ innerText: async () => "原标题与原正文" }) } as unknown as Page;
  const active = vi.spyOn(adapter as unknown as { activeCanonicalPage(): Promise<unknown> }, "activeCanonicalPage").mockResolvedValue({ page });
  const ctx = { accountId: "owned", accountName: "Owner", platformKey: "weibo", settings: { expectedCreatorId: "123456789" } };
  const input = { jobId: "job", articleId: "article", title: "原标题", accountName: "Owner", windowStart: new Date().toISOString(), windowEnd: new Date().toISOString(), waitWindowSatisfied: true, finalSubmitCount: 1, expectedCreatorId: "123456789", expectedExternalId: "Rf17LuR6n", expectedPublishedUrl: url };
  const result = await adapter.reconcile(ctx, input);
  expect(result).toMatchObject({ status: "FOUND_PUBLISHED", externalId: "Rf17LuR6n", accountMatch: true, response: { readOnly: true, matchedBy: "REMOTE_ID", exactAuthorUrlMatch: true } });
  expect(goto).toHaveBeenCalledTimes(1);
  await expect(adapter.reconcile(ctx, { ...input, expectedPublishedUrl: "https://weibo.com/987654321/Rf17LuR6n" })).resolves.toMatchObject({ status: "STILL_UNCERTAIN" });
  expect(goto).toHaveBeenCalledTimes(1);
  active.mockRestore();
});
