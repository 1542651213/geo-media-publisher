import { describe, expect, it, vi } from "vitest";
import type { AccountContext, PublishArticleInput } from "@publisher/domain";
import type { WeiboCliContract, WeiboCliRunner } from "./index";
import { WeiboAdapter, mapWeiboError } from "./index";

const context = (dryRun = false): AccountContext => ({ accountId: "a", accountName: "微博测试", platformKey: "weibo", settings: { dryRun } });
const article: PublishArticleInput = { articleId: "article-1", title: "标题", body: "正文", summary: "", tags: [] };
const contract: WeiboCliContract = {
  authArgs: ["auth", "whoami"],
  publishArticleArgs: (input) => ["publish", "article", "--title", input.title, "--body", input.body],
  parsePublish: () => ({ externalId: "weibo-1", publishedUrl: "https://weibo.com/u/1/weibo-1" }),
  statusArgs: (externalId) => ["status", externalId],
  parseStatus: () => ({ status: "published", publishedUrl: "https://weibo.com/u/1/weibo-1" })
};

describe("Weibo official CLI adapter", () => {
  it("declares verified official CLI capability without overclaiming video", () => {
    const adapter = new WeiboAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "weibo", transport: "official_sdk", status: "WaitingForUser", supportsArticle: true, supportsVideo: false });
    expect(adapter.getCapabilities()).toMatchObject({ article: true, imagePost: true, video: false });
  });
  it("keeps dry-run local and fails closed when command contract is absent", async () => {
    const adapter = new WeiboAdapter();
    await expect(adapter.publishArticle(context(true), article)).resolves.toMatchObject({ dryRun: true, prepared: true });
    await expect(adapter.publishArticle(context(), article)).rejects.toMatchObject({ code: "API_REVIEW_REQUIRED" });
  });
  it("runs only the injected official CLI contract and records external id/status", async () => {
    const runner: WeiboCliRunner = { run: vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" })) };
    const adapter = new WeiboAdapter({ runner, contract });
    await expect(adapter.checkLogin(context())).resolves.toBe("logged_in");
    await expect(adapter.publishArticle(context(), article)).resolves.toMatchObject({ status: "published", externalId: "weibo-1" });
    await expect(adapter.getPublishStatus(context(), "weibo-1")).resolves.toMatchObject({ status: "published", externalId: "weibo-1" });
    expect(runner.run).toHaveBeenCalledTimes(3);
  });
  it("maps authentication, permission, verification and content failures", () => {
    expect(mapWeiboError("login required", 1)).toBe("LOGIN_EXPIRED");
    expect(mapWeiboError("permission denied", 1)).toBe("PERMISSION_DENIED");
    expect(mapWeiboError("验证码", 1)).toBe("USER_ACTION_REQUIRED");
    expect(mapWeiboError("content invalid", 1)).toBe("CONTENT_REJECTED");
  });
});
