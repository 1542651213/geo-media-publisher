import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { captureAbortedPublishRequest, CapturedRequestReplay, nodeFetchReplayTransport } from "./captured-request-replay";

const fixture = () => ({
  method: "POST",
  url: "https://mp.toutiao.com/mp/agw/article/publish?a_bogus=fake-signature&msToken=fake-token&aid=1",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: "cookie=fake-cookie", "x-secsdk-csrf-token": "fake-csrf", origin: "https://mp.toutiao.com", host: "mp.toutiao.com", "content-length": "999" },
  body: Buffer.from("title=%E6%B5%8B%E8%AF%95&content=%3Cp%3Ehello%3C%2Fp%3E&extra=a%2Bb", "utf8")
});

describe("captured Toutiao request replay", () => {
  it("preserves final query and body bytes, strips transport-managed headers, and sends once", async () => {
    const captured = captureAbortedPublishRequest(fixture(), Date.now());
    const seen: Array<{ url: string; method: string; headers: Record<string, string | string[] | undefined>; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      seen.push({ url: request.url ?? "", method: request.method ?? "", headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"code":0,"data":{"pgc_id":"fake-id"}}');
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No fixture server address");
      const replay = new CapturedRequestReplay(async (request) => {
        const target = new URL(request.url);
        const result = await fetch(`http://127.0.0.1:${address.port}${target.pathname}${target.search}`, {
          method: request.method, headers: request.headers, body: new Uint8Array(request.body), redirect: "manual"
        });
        return { status: result.status, responseShape: ["code", "data"] };
      });
      const result = await replay.sendOnce(captured, { submissionAttemptId: "attempt-1", claimedRequestHash: captured.requestHash, claimedAt: Date.now() });
      expect(result.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.method).toBe("POST");
      expect(seen[0]?.url).toBe("/mp/agw/article/publish?a_bogus=fake-signature&msToken=fake-token&aid=1");
      expect(seen[0]?.body.equals(fixture().body)).toBe(true);
      expect(seen[0]?.headers.cookie).toBe("cookie=fake-cookie");
      expect(seen[0]?.headers["content-length"]).toBe(String(fixture().body.length));
      await expect(replay.sendOnce(captured, { submissionAttemptId: "attempt-1", claimedRequestHash: captured.requestHash, claimedAt: Date.now() }))
        .rejects.toThrow("TOUTIAO_REPLAY_ALREADY_CONSUMED");
    } finally { server.close(); }
  });

  it("rejects stale, mismatched, non-publish and duplicate material before transport", async () => {
    const transport = vi.fn(async () => ({ status: 200, responseShape: [] }));
    const replay = new CapturedRequestReplay(transport);
    const now = Date.now();
    const captured = captureAbortedPublishRequest(fixture(), now - 31_000);
    await expect(replay.sendOnce(captured, { submissionAttemptId: "a", claimedRequestHash: captured.requestHash, claimedAt: now }, now))
      .rejects.toThrow("CAPTURE_TOO_OLD");
    expect(transport).not.toHaveBeenCalled();
    const fresh = captureAbortedPublishRequest(fixture(), now);
    await expect(replay.sendOnce(fresh, { submissionAttemptId: "a", claimedRequestHash: "0".repeat(64), claimedAt: now }, now))
      .rejects.toThrow("REQUEST_HASH_MISMATCH");
    expect(transport).not.toHaveBeenCalled();
    expect(() => captureAbortedPublishRequest({ ...fixture(), url: "https://evil.example/mp/agw/article/publish" }, now))
      .toThrow("REQUEST_HOST_MISMATCH");
  });

  it("never exposes raw secrets through metadata serialization", () => {
    const captured = captureAbortedPublishRequest(fixture(), Date.now());
    const output = JSON.stringify(captured.evidence);
    expect(output).toContain(captured.requestHash);
    expect(output).not.toMatch(/fake-signature|fake-token|fake-cookie|fake-csrf|hello/u);
  });

  it("binds title and complete text to the captured form and requires a signed query", () => {
    const captured = captureAbortedPublishRequest(fixture(), Date.now());
    expect(captured.assertArticleBinding({ title: "测试", body: "hello" })).toBe(true);
    expect(() => captured.assertArticleBinding({ title: "另一标题", body: "hello" })).toThrow("TITLE_BINDING_MISMATCH");
    expect(() => captured.assertArticleBinding({ title: "测试", body: "other" })).toThrow("BODY_BINDING_MISMATCH");
    const unsigned = captureAbortedPublishRequest({ ...fixture(), url: "https://mp.toutiao.com/mp/agw/article/publish?aid=1" }, Date.now());
    expect(() => unsigned.assertArticleBinding({ title: "测试", body: "hello" })).toThrow("DYNAMIC_FIELD_MISSING");
  });

  it("does not replay a timed-out attempt a second time", async () => {
    const captured = captureAbortedPublishRequest(fixture(), Date.now());
    const transport = vi.fn(async () => { throw new Error("timeout"); });
    const replay = new CapturedRequestReplay(transport);
    const permit = { submissionAttemptId: "one-shot", claimedRequestHash: captured.requestHash, claimedAt: Date.now() };
    await expect(replay.sendOnce(captured, permit)).rejects.toThrow("timeout");
    await expect(replay.sendOnce(captured, permit)).rejects.toThrow("TOUTIAO_REPLAY_ALREADY_CONSUMED");
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([307, 308])("does not follow a %i redirect or issue a second POST", async (status) => {
    const captured = captureAbortedPublishRequest(fixture(), Date.now());
    const send = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      expect(Buffer.from(init.body as Uint8Array).equals(fixture().body)).toBe(true);
      return new Response("", { status, headers: { location: "https://mp.toutiao.com/mp/agw/article/publish" } });
    });
    vi.stubGlobal("fetch", send);
    try {
      const replay = new CapturedRequestReplay(nodeFetchReplayTransport);
      const result = await replay.sendOnce(captured, { submissionAttemptId: `redirect-${status}`,
        claimedRequestHash: captured.requestHash, claimedAt: Date.now() });
      expect(result.status).toBe(status);
      expect(send).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects captured cookies from a different credential snapshot", () => {
    const captured = captureAbortedPublishRequest(fixture(), Date.now());
    const cookie = { name: "cookie", value: "fake-cookie", domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null };
    expect(captured.assertCookieBinding([cookie])).toBe(true);
    expect(() => captured.assertCookieBinding([{ ...cookie, value: "other" }])).toThrow("COOKIE_BINDING_MISMATCH");
    expect(() => captured.assertCookieBinding([])).toThrow("COOKIE_BINDING_MISMATCH");
  });

  it("keeps semantic final payload hash separate from rotating authentication material", () => {
    const input = fixture();
    const first = captureAbortedPublishRequest(input, Date.now());
    const refreshed = captureAbortedPublishRequest({ ...input,
      url: input.url.replace("fake-signature", "new-signature").replace("fake-token", "new-token"),
      headers: { ...input.headers, cookie: "cookie=new-cookie", "x-secsdk-csrf-token": "new-csrf" } }, Date.now());
    expect(first.finalPayloadHash).toBe(refreshed.finalPayloadHash);
    expect(first.requestHash).not.toBe(refreshed.requestHash);
    const changed = captureAbortedPublishRequest({ ...input, body: Buffer.from("title=Other&content=Hello") }, Date.now());
    expect(changed.finalPayloadHash).not.toBe(first.finalPayloadHash);
  });

  it("classifies request shape and content binding failures without echoing values", () => {
    const input = fixture();
    expect(() => captureAbortedPublishRequest({ ...input, method: "GET" }, Date.now())).toThrow("REQUEST_METHOD_MISMATCH");
    expect(() => captureAbortedPublishRequest({ ...input, url: input.url.replace("mp.toutiao.com", "example.invalid") }, Date.now())).toThrow("REQUEST_HOST_MISMATCH");
    expect(() => captureAbortedPublishRequest({ ...input, url: input.url.replace("/article/publish", "/article/save") }, Date.now())).toThrow("REQUEST_PATH_MISMATCH");
    expect(() => captureAbortedPublishRequest({ ...input, headers: { ...input.headers, "content-type": "application/json" } }, Date.now())).toThrow("CONTENT_TYPE_MISMATCH");
    const captured = captureAbortedPublishRequest(input, Date.now());
    expect(() => captured.assertArticleBinding({ title: "changed", body: "hello" })).toThrow("TITLE_BINDING_MISMATCH");
    expect(() => captured.assertArticleBinding({ title: "测试", body: "changed" })).toThrow("BODY_BINDING_MISMATCH");
    expect(() => captured.assertCookieBinding([{ name: "cookie", value: "changed", domain: "mp.toutiao.com",
      path: "/", hostOnly: true, secure: true, expiresAt: null }])).toThrow("COOKIE_BINDING_MISMATCH");
    expect(() => captured.forReplay(Date.now() + 31_000)).toThrow("CAPTURE_TOO_OLD");
  });

  it("binds semantic text across equivalent HTML and line endings while dynamic fields affect only request hash", () => {
    const input = fixture();
    const normalized = captureAbortedPublishRequest({ ...input,
      body: Buffer.from("title=%E6%B5%8B%E8%AF%95&content=%3Cp%3Ehello%26nbsp%3B%3C%2Fp%3E") }, Date.now());
    expect(normalized.assertArticleBinding({ title: "测试", body: "hello\r\n" })).toBe(true);
    const changedSignature = captureAbortedPublishRequest({ ...input,
      url: input.url.replace("fake-signature", "rotated").replace("fake-token", "rotated-token") }, Date.now());
    const original = captureAbortedPublishRequest(input, Date.now());
    expect(changedSignature.finalPayloadHash).toBe(original.finalPayloadHash);
    expect(changedSignature.requestHash).not.toBe(original.requestHash);
  });

  it("rejects a captured hyperlink whose visible text matches the frozen plain text", () => {
    const input = fixture();
    const captured = captureAbortedPublishRequest({ ...input,
      body: Buffer.from("title=%E6%B5%8B%E8%AF%95&content=%3Cp%3E%3Ca+href%3D%22https%3A%2F%2Fexample.invalid%22%3Ehello%3C%2Fa%3E%3C%2Fp%3E") }, Date.now());
    expect(() => captured.assertArticleBinding({ title: "测试", body: "hello" })).toThrow("BODY_BINDING_MISMATCH");
  });

  it("accepts duplicate cookie names from separate eligible domains only when each captured value is still current", () => {
    const captured = captureAbortedPublishRequest({ ...fixture(),
      headers: { ...fixture().headers, cookie: "sid=parent-value; sid=creator-value" } }, Date.now());
    const cookie = (value: string, domain: string) => ({ name: "sid", value, domain, path: "/",
      hostOnly: domain === "mp.toutiao.com", secure: true, expiresAt: null });
    expect(captured.assertCookieBinding([cookie("parent-value", ".toutiao.com"),
      cookie("creator-value", "mp.toutiao.com")])).toBe(true);
    expect(() => captured.assertCookieBinding([cookie("parent-value", ".toutiao.com"),
      cookie("other-value", "mp.toutiao.com")])).toThrow("COOKIE_BINDING_MISMATCH");
  });
});
