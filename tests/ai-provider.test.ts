import { describe, expect, it, vi } from "vitest";
import { AIProviderError, DeepSeekErrorMapper, DeepSeekProvider, OpenAICompatibleProvider, buildAuthorizationHeader, normalizeBaseUrl } from "@publisher/ai";
import type { Brand, ContentStudioInput } from "@publisher/domain";

const brand: Brand = { id: "brand", name: "测试品牌", companyName: "测试公司", description: "本地服务", mainBusiness: "测试业务", serviceRegions: ["南京"], advantages: [], contact: {}, establishedAt: "", address: "", serviceProcess: "", afterSales: "", faq: "", certificates: "", patents: "", equipment: "", cases: "", aiForbiddenClaims: ["禁止虚构数据"], createdAt: "", updatedAt: "" };
const task = { brand, city: "南京", keyword: "测试服务", articleType: "科普", minWords: 300, maxWords: 800, includeFaq: true, includeSummary: true, includeTags: true, includeSeoKeywords: true };

describe("OpenAI-compatible provider", () => {
  it("validates structured JSON and records usage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "标题", body: "正文", summary: "摘要", tags: ["标签"], seoKeywords: ["关键词"], suggestedCoverPrompt: "无文字封面" }) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.test/v1", apiKey: "secret", model: "model", temperature: 0.2, maxOutputTokens: 500, timeoutMs: 1000, retryCount: 0 });
    const result = await provider.generateArticle(task);
    expect(result.title).toBe("标题");
    expect(result.usage?.totalTokens).toBe(30);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("secret");
    fetchMock.mockRestore();
  });

  it("repairs one invalid JSON response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "修复标题", body: "修复正文", summary: "", tags: [], seoKeywords: [], suggestedCoverPrompt: "" }) } }] }), { status: 200 }));
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.test/v1", apiKey: "secret", model: "model", temperature: 0.2, maxOutputTokens: 500, timeoutMs: 1000, retryCount: 0 });
    await expect(provider.generateArticle(task)).resolves.toMatchObject({ title: "修复标题" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it("generates a structured topic plan and platform-specific Content Studio output", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "主题摘要", topics: [{ title: "主题", angle: "角度", audience: "用户", keyPoints: ["要点"], recommendedPlatforms: ["zhihu"] }] }) } }], usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ platformKey: "zhihu", contentType: "article", title: "知乎标题", body: "知乎正文", summary: "摘要", tags: ["标签"], seoKeywords: ["关键词"], tone: "理性", structure: ["结论", "论据"], keywordLayout: { primary: "南京测试服务", secondary: ["测试服务"], placements: ["首段", "结尾"] } }) } }], usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 } }), { status: 200 }));
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.test/v1", apiKey: "secret", model: "model", temperature: 0.2, maxOutputTokens: 500, timeoutMs: 1000, retryCount: 0 });
    const input: ContentStudioInput = { brand, industry: "测试行业", cities: ["南京"], keywords: ["测试服务"], targetPlatforms: ["zhihu"], topicPlan: null, mediaAssets: [], videoAssets: [] };
    const plan = await provider.generateTopicPlan(input);
    const content = await provider.generateStudioContent({ ...input, platformKey: "zhihu" });
    expect(plan.topics[0]?.title).toBe("主题");
    expect(content).toMatchObject({ platformKey: "zhihu", title: "知乎标题", contentType: "article" });
    expect(content.usage?.totalTokens).toBe(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it("normalizes WeChat aliases, fenced JSON, and string lists without adding facts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "```json\n{\"platform_key\":\"微信公众号\",\"content_type\":\"article\",\"headline\":\"微信标题\",\"content\":\"微信正文，只保留输入事实。\",\"tags\":\"甲醛治理,苏州\",\"seo_keywords\":\"甲醛治理、苏州\",\"keyword_layout\":\"首段,结尾\"}\n```" } }] }), { status: 200 }));
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.test/v1", apiKey: "secret", model: "model", temperature: 0.2, maxOutputTokens: 500, timeoutMs: 1000, retryCount: 0 });
    const input: ContentStudioInput = { brand, industry: "测试行业", cities: ["南京"], keywords: ["测试服务"], targetPlatforms: ["wechat_official"], topicPlan: null, mediaAssets: [], videoAssets: [] };
    const result = await provider.generateStudioContent({ ...input, platformKey: "wechat_official" });
    expect(result).toMatchObject({ platformKey: "wechat_official", contentType: "article", title: "微信标题", body: "微信正文，只保留输入事实。", tags: ["甲醛治理", "苏州"], seoKeywords: ["甲醛治理", "苏州"], keywordLayout: { primary: "测试服务", placements: ["首段", "结尾"] } });
    expect(result.structuredDiagnostics?.map((item) => item.category)).toEqual(expect.arrayContaining(["MARKDOWN_CODE_FENCE", "NORMALIZATION_APPLIED"]));
    expect(result.body).not.toContain("资质");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it("repairs malformed WeChat JSON once and records truncated output safely", async () => {
    const truncatedContent = JSON.stringify({ platformKey: "wechat_official", contentType: "article", title: "截断" }).slice(0, -3);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: truncatedContent } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ platformKey: "wechat_official", contentType: "article", title: "修复标题", body: "修复正文", keywordLayout: { primary: "测试服务", secondary: [], placements: [] } }) } }] }), { status: 200 }));
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.test/v1", apiKey: "secret", model: "model", temperature: 0.2, maxOutputTokens: 500, timeoutMs: 1000, retryCount: 0 });
    const input: ContentStudioInput = { brand, industry: "测试行业", cities: ["南京"], keywords: ["测试服务"], targetPlatforms: ["wechat_official"], topicPlan: null, mediaAssets: [], videoAssets: [] };
    const result = await provider.generateStudioContent({ ...input, platformKey: "wechat_official" });
    expect(result.title).toBe("修复标题");
    expect(result.structuredDiagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ category: "OUTPUT_TRUNCATED" }), expect.objectContaining({ category: "REPAIR_RETRY_SUCCEEDED", repairAttempted: true })]));
    const repairRequest = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body)) as { messages?: Array<{ content?: string }> };
    expect(repairRequest.messages?.[1]?.content).toContain("不得增加事实");
    expect(repairRequest.messages?.[1]?.content).toContain("platformKey 必须严格为 wechat_official");
    fetchMock.mockRestore();
  });

  it("keeps a malformed repair as Failed with safe schema diagnostics", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ platformKey: "wechat_official", contentType: "article", title: "缺少正文", keywordLayout: "尾部" }) } }] }), { status: 200 }));
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.test/v1", apiKey: "secret", model: "model", temperature: 0.2, maxOutputTokens: 500, timeoutMs: 1000, retryCount: 0 });
    const input: ContentStudioInput = { brand, industry: "测试行业", cities: ["南京"], keywords: ["测试服务"], targetPlatforms: ["wechat_official"], topicPlan: null, mediaAssets: [], videoAssets: [] };
    const error = await provider.generateStudioContent({ ...input, platformKey: "wechat_official" }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "AI_INVALID_OUTPUT", structuredDiagnostics: expect.arrayContaining([expect.objectContaining({ category: "REPAIR_RETRY_FAILED" })]) });
    expect(error instanceof Error ? error.message : String(error)).not.toContain("not-json");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it("keeps the other five platforms on the strict schema path", async () => {
    const platforms = ["zhihu", "toutiao", "weibo", "douyin", "bilibili"] as const;
    let callIndex = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const platformKey = platforms[callIndex++] ?? "zhihu";
      const contentType = platformKey === "douyin" || platformKey === "bilibili" ? "video_script" : "article";
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ platformKey, contentType, title: `${platformKey}-title`, body: `${platformKey}-body`, keywordLayout: { primary: "keyword", secondary: [], placements: [] } }) } }] }), { status: 200 }));
    });
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.test/v1", apiKey: "secret", model: "model", temperature: 0.2, maxOutputTokens: 500, timeoutMs: 1000, retryCount: 0 });
    const input: ContentStudioInput = { brand, industry: "测试行业", cities: ["南京"], keywords: ["测试服务"], targetPlatforms: [...platforms], topicPlan: null, mediaAssets: [], videoAssets: [] };
    for (const platformKey of platforms) {
      const result = await provider.generateStudioContent({ ...input, platformKey });
      expect(result.platformKey).toBe(platformKey);
      expect(result.structuredDiagnostics).toEqual([]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(platforms.length);
    fetchMock.mockRestore();
  });
});

describe("DeepSeek connection diagnostics", () => {
  it("tests /models first, uses a strict Bearer header, then runs a minimal chat check", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: "list", data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 }));
    const provider = new DeepSeekProvider({ apiKey: "  sk-test-key  ", baseUrl: "https://api.deepseek.com/v1///", retryCount: 0 });

    const result = await provider.testConnection();

    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("DeepSeek 连接成功") });
    expect(result.diagnostic).toMatchObject({ api: "normal", authentication: "normal", modelStatus: "normal", chatCompletion: "normal", availableModels: ["deepseek-v4-flash", "deepseek-v4-pro"] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.deepseek.com/models");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.deepseek.com/chat/completions");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toEqual({ Authorization: "Bearer sk-test-key" });
    const request = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>;
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.response_format).toBeUndefined();
    expect(request.messages).toEqual([{ role: "user", content: "仅回复 OK" }]);
    fetchMock.mockRestore();
  });

  it("reports a model that is absent from /models without calling chat completion", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "deepseek-v4-pro" }] }), { status: 200 }));
    const result = await new DeepSeekProvider({ apiKey: "sk-test-key", retryCount: 0 }).testConnection();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("当前模型不可用");
    expect(result.message).toContain("deepseek-v4-pro");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.diagnostic?.modelStatus).toBe("failed");
    fetchMock.mockRestore();
  });

  it.each([
    [400, "DeepSeek 请求格式错误", "bad_request"],
    [401, "DeepSeek API Key 无效", "credential"],
    [402, "DeepSeek 账户余额不足", "balance"],
    [422, "DeepSeek 请求参数不正确", "invalid_request"],
    [429, "DeepSeek 请求过于频繁，请稍后重试", "rate_limit"],
    [500, "DeepSeek 服务暂时异常", "server"]
  ])("maps HTTP %s to a specific DeepSeek error", async (status, message, code) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: status === 402 ? "Insufficient Balance" : "field is invalid" }, request_id: "req-123" }), { status }));
    const result = await new DeepSeekProvider({ apiKey: "sk-test-key", retryCount: 0 }).testConnection();

    expect(result).toMatchObject({ ok: false, message });
    expect(result.diagnostic).toMatchObject({ httpStatus: status, errorCode: code, requestId: "req-123" });
    if (status === 402) expect(result.diagnostic?.responseBodySummary).toContain("Insufficient Balance");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it("maps only a rejected fetch to network failure and maps timeout separately", async () => {
    const networkFetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(new DeepSeekProvider({ apiKey: "sk-test-key", retryCount: 0 }).testConnection()).resolves.toMatchObject({ ok: false, message: "网络连接失败" });
    networkFetch.mockRestore();

    const timeoutFetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(new DeepSeekProvider({ apiKey: "sk-test-key", retryCount: 0 }).testConnection()).resolves.toMatchObject({ ok: false, message: "DeepSeek 请求超时" });
    timeoutFetch.mockRestore();
  });

  it("keeps the provider error metadata and normalizes URL and credentials", () => {
    expect(normalizeBaseUrl(" https://api.deepseek.com/v1/// ", { stripV1: true })).toBe("https://api.deepseek.com");
    expect(buildAuthorizationHeader("  sk-test-key\n")).toBe("Bearer sk-test-key");
    expect(DeepSeekErrorMapper.map(new AIProviderError("AI_INVALID_REQUEST", "field", { httpStatus: 422, provider: "deepseek", requestId: "req-1" }))).toMatchObject({ code: "invalid_request", message: "DeepSeek 请求参数不正确", retryable: false, httpStatus: 422, provider: "deepseek", requestId: "req-1" });
  });
});
