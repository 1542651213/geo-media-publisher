import { expect, it } from "vitest";
import * as ai from "@publisher/ai";

type Client = { listModels(): Promise<Array<{ id: string }>>; generateText(input: { model: string; systemPrompt: string; userPrompt: string }): Promise<{ text: string }> };
const client = (provider: string, fetchPort: typeof fetch): Client => {
  const factory = (ai as unknown as { createTextProvider: (config: unknown, secret: string | null, fetchPort: typeof fetch) => Client }).createTextProvider;
  expect(factory, "text provider factory exists").toBeTypeOf("function");
  return factory({ provider, baseUrl: provider === "ollama" ? "http://127.0.0.1:11434" : "https://api.xiaomimimo.com/v1", defaultModel: "manual-model", timeoutMs: 1000 }, provider === "ollama" ? null : "fixture-only-secret", fetchPort);
};
it("uses the official MiMo api-key contract and preserves model IDs and output", async () => {
  const transport: typeof fetch = async (url, init) => {
    expect(String(url)).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(new Headers(init?.headers).get("api-key")).toBe("fixture-only-secret");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "manual-model", stream: false, max_completion_tokens: 3000 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "原文" } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }));
  };
  expect((await client("mimo", transport).generateText({ model: "manual-model", systemPrompt: "事实", userPrompt: "源稿" })).text).toBe("原文");
});
it("lists existing Ollama models and uses non-stream native chat without a credential", async () => {
  const transport: typeof fetch = async (url, init) => {
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "local:latest" }] }));
    expect(JSON.parse(String(init?.body))).toMatchObject({ stream: false, model: "local:latest" });
    return new Response(JSON.stringify({ message: { content: "本地输出" }, done: true }));
  };
  const provider = client("ollama", transport);
  expect(await provider.listModels()).toEqual([{ id: "local:latest", displayName: "local:latest" }]);
  expect((await provider.generateText({ model: "local:latest", systemPrompt: "", userPrompt: "源稿" })).text).toBe("本地输出");
});
it("never leaks a provider error body or blindly retries an uncertain generation", async () => {
  let count = 0;
  const provider = client("mimo", async () => { count++; return new Response("fixture-only-secret private prompt", { status: 401 }); });
  await expect(provider.generateText({ model: "manual-model", systemPrompt: "", userPrompt: "源稿" })).rejects.toThrow("授权已失效");
  expect(count).toBe(1);
});
it("rejects incomplete cloud output even if it contains valid JSON", async () => {
  const provider = client("mimo", async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"title":"标题","body":"截断正文"}' } }] })));
  await expect(provider.generateText({ model: "manual-model", systemPrompt: "", userPrompt: "源稿" })).rejects.toThrow("未完成");
});
it.each([undefined, null, ""])("does not trust cloud output without an explicit terminal finish reason: %s", async (finish_reason) => {
  const provider = client("mimo", async () => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: '{"title":"标题","body":"正文"}' } }] })));
  await expect(provider.generateText({ model: "manual", systemPrompt: "", userPrompt: "" })).rejects.toThrow("未完成");
});
it.each([
  ["openai", "https://api.openai.com/v1", "max_completion_tokens"],
  ["deepseek", "https://api.deepseek.com", "max_tokens"],
  ["custom", "http://127.0.0.1:19191/v1", "max_tokens"]
] as const)("supports %s model discovery and a manually entered model without changing its identity", async (provider, baseUrl, tokenField) => {
  const fetchPort: typeof fetch = async (url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-only-secret");
    expect(init?.redirect).toBe("error");
    if (String(url) === `${baseUrl}/models`) return new Response(JSON.stringify({ data: [{ id: "discovered-model" }] }));
    expect(String(url)).toBe(`${baseUrl}/chat/completions`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "manual-model", [tokenField]: 3000 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "文本" } }] }));
  };
  const providerClient = ai.createTextProvider({ provider, baseUrl, defaultModel: "manual-model" }, "fixture-only-secret", fetchPort);
  expect(await providerClient.listModels()).toEqual([{ id: "discovered-model", displayName: "discovered-model" }]);
  expect(await providerClient.generateText({ model: "manual-model", systemPrompt: "资料", userPrompt: "源稿" })).toMatchObject({ text: "文本", model: "manual-model" });
});
it("blocks missing credentials, redirects and wrong official hosts before leaking a key", async () => {
  let requests = 0;
  const fetchPort: typeof fetch = async () => { requests++; throw new Error("fixture-only-secret private prompt"); };
  expect(() => ai.createTextProvider({ provider: "openai", baseUrl: "https://evil.invalid/v1", defaultModel: "manual" }, "fixture-only-secret", fetchPort)).toThrow("地址不匹配");
  const provider = ai.createTextProvider({ provider: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "manual" }, null, fetchPort);
  await expect(provider.listModels()).rejects.toThrow("尚未配置"); expect(requests).toBe(0);
  const configured = ai.createTextProvider({ provider: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "manual" }, "fixture-only-secret", fetchPort);
  await expect(configured.generateText({ model: "manual", systemPrompt: "", userPrompt: "" })).rejects.toThrow("结果无法确认"); expect(requests).toBe(1);
});
it("bounds response bytes and exposes neither 5xx bodies nor oversized output", async () => {
  const unavailable = client("mimo", async () => new Response("fixture-only-secret", { status: 503 }));
  await expect(unavailable.listModels()).resolves.toHaveLength(1);
  await expect(unavailable.generateText({ model: "manual", systemPrompt: "", userPrompt: "" })).rejects.toThrow("暂时不可用");
  const oversized = client("mimo", async () => new Response("x".repeat(2_000_001)));
  await expect(oversized.generateText({ model: "manual", systemPrompt: "", userPrompt: "" })).rejects.toThrow("无法读取");
});
