import { describe, expect, it, vi } from "vitest";
import { CNBLOGS_CORP_INFO_ENDPOINT, CNBLOGS_CREATE_POST_ENDPOINT, CNBLOGS_REVIEW_STATUS_ENDPOINT, CnblogsOfficialApiAdapter, type CnblogsHttpClient } from "./index";

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

describe("CNBlogs official Open API adapter", () => {
  it("uses remote blog identity and does not trust a locally supplied BlogApp", async () => {
    const adapter = new CnblogsOfficialApiAdapter({ httpClient: { request: async () => response({ success: true, value: { blogUrl: "https://www.cnblogs.com/verified-blog/" } }) } });
    const profile = await adapter.getAccountProfile({ accountId: "c1", accountName: "博客园", platformKey: "cnblogs", settings: {}, secrets: { pat: "fixture-pat", blogApp: "unverified-local-name" } });
    expect(profile).toMatchObject({ accountId: "verified-blog", authorizationStatus: "Authorized" });
    expect(JSON.stringify(profile)).not.toContain("unverified-local-name");
  });
  it("does not interpret an HTTP 200 error payload as logged in", async () => {
    const adapter = new CnblogsOfficialApiAdapter({ httpClient: { request: async () => response({ success: false, message: "expired" }) } });
    expect(await adapter.checkLogin({ accountId: "c1", accountName: "博客园", platformKey: "cnblogs", settings: {}, secrets: { pat: "fixture-pat" } })).not.toBe("logged_in");
  });
  it("prepares locally before confirmation, so the formal boundary creates exactly one remote post", async () => {
    let posts = 0;
    const adapter = new CnblogsOfficialApiAdapter({ httpClient: { request: async (_url, init) => { if (init.method === "POST") posts++; return response({ success: true, value: { postId: 123, postUrl: "https://www.cnblogs.com/demo/p/123" } }); } } });
    expect(adapter.getCapabilities().draft).toBe(false);
    const context = { accountId: "c1", accountName: "博客园", platformKey: "cnblogs", settings: { dryRun: true, manualConfirmationRequired: true }, secrets: { pat: "fixture-pat" } };
    const article = { articleId: "a1", title: "标题", body: "第一段\n第二段", summary: "", tags: [] };
    await adapter.publishArticle(context, article);
    expect(posts).toBe(0);
    const result = await adapter.publishArticle({ ...context, settings: { dryRun: false, manualConfirmationRequired: false } }, article);
    expect(posts).toBe(1);
    expect(result.status).toBe("publishing");
  });
  it("validates a PAT without exposing it in the result", async () => {
    const request = vi.fn(async (_url: string, _init: RequestInit) => response({ success: true, value: { blogUrl: "https://www.cnblogs.com/demo" } }));
    const adapter = new CnblogsOfficialApiAdapter({ httpClient: { request } as CnblogsHttpClient });
    const status = await adapter.checkLogin({ accountId: "c1", accountName: "博客园", platformKey: "cnblogs", settings: {}, secrets: { pat: "private-pat" } });
    expect(status).toBe("logged_in");
    expect(request).toHaveBeenCalledWith(CNBLOGS_CORP_INFO_ENDPOINT, expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer private-pat", "Authorization-Type": "pat" }) }));
    expect(JSON.stringify(status)).not.toContain("private-pat");
  });

  it("submits the confirmed Markdown post once and preserves line breaks without claiming review success", async () => {
    const request = vi.fn(async (_url: string, _init: RequestInit) => response({ success: true, value: { postId: 123, postUrl: "https://www.cnblogs.com/demo/p/123" } }));
    const adapter = new CnblogsOfficialApiAdapter({ httpClient: { request } as CnblogsHttpClient });
    const result = await adapter.publishArticle({ accountId: "c1", accountName: "博客园", platformKey: "cnblogs", settings: { dryRun: false, manualConfirmationRequired: false }, secrets: { pat: "private-pat" } }, { articleId: "a1", title: "标题", body: "第一段\n第二段", summary: "摘要", tags: ["标签"] });
    expect(result).toMatchObject({ success: true, status: "publishing", dryRun: false, externalId: "123", response: { endpoint: CNBLOGS_CREATE_POST_ENDPOINT, isDraft: false, postFormat: "Markdown" } });
    const init = request.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ Title: "标题", PostFormat: "Markdown", IsPublished: true });
    expect(String(payload.Body)).toContain("  \n");
    expect(JSON.stringify(result)).not.toContain("private-pat");
  });

  it("maps official review states without upgrading connection to PublishPassed", async () => {
    const request = vi.fn(async (_url: string, _init: RequestInit) => response({ success: true, value: { postId: 123, reviewStatus: 0 } }));
    const adapter = new CnblogsOfficialApiAdapter({ httpClient: { request } as CnblogsHttpClient });
    const result = await adapter.getPublishStatus({ accountId: "c1", accountName: "博客园", platformKey: "cnblogs", settings: {}, secrets: { pat: "private-pat" } }, "123");
    expect(result.status).toBe("publishing");
    expect(request).toHaveBeenCalledWith(CNBLOGS_REVIEW_STATUS_ENDPOINT, expect.anything());
  });
});
