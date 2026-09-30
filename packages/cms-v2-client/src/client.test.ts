import { createServer } from "node:http";
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { ClientError, CmsV2Client, signRequest } from "./client";

const secret = "0123456789abcdef0123456789abcdef"; // gitleaks:allow -- public fixed signing-vector fixture, never a service credential
const scope = { siteId: "kangyi", environment: "local" as const, keyId: "test-key", secret };
const envelope = (data: unknown): string => JSON.stringify({ ok: true, data, requestId: "test-request" });

async function server(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): Promise<{ origin: string; close: () => Promise<void> }> {
  const instance = createServer((request, response) => { void handler(request, response); });
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  const port = (instance.address() as { port: number }).port;
  return { origin: `http://127.0.0.1:${port}`, close: async () => { instance.closeAllConnections(); await new Promise<void>((resolve) => instance.close(() => resolve())); } };
}

describe("Kangyi CmsV2 client boundary", () => {
  it("never automatically resends an uncertain write with the default client", async () => {
    let received = 0;
    const instance = await server((request) => { received += 1; request.socket.destroy(); });
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin, retryDelayMs: 1 }).request("POST", "/contents", { json: {}, idempotencyKey: "single-dispatch-1" }))
        .rejects.toMatchObject({ code: "TRANSPORT_UNCERTAIN", outcomeUnknown: true, idempotencyKey: "single-dispatch-1" });
      expect(received).toBe(1);
    } finally { await instance.close(); }
  });

  it("never exposes credential values echoed in a remote rejection", async () => {
    const instance = await server((_request, response) => { response.statusCode = 403;
      response.end(JSON.stringify({ ok: false, error: { code: "SCOPE", message: secret, retryable: false }, requestId: "redaction" })); });
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin }).capabilities()).rejects.not.toHaveProperty("message", secret);
    } finally { await instance.close(); }
  });
  it("matches the authoritative fixed GET signing vector", () => {
    expect(signRequest({ method: "GET", target: "/_publish-api/v2/contents?externalId=a%2Fb&kind=article", siteId: "kangyi", environment: "staging", timestamp: 1_800_000_000, nonce: "00112233445566778899aabbccddeeff", body: Buffer.alloc(0) }, secret)).toBe("sha256=4f05bd1d572382f7a720ae87f6300a8e81f211ccec6ed1e4f8435cccddcc5118");
  });

  it("sends GET with the empty-body signature and no idempotency header", async () => {
    let requestHeaders: Record<string, string | string[] | undefined> = {};
    const instance = await server((_request, response) => { requestHeaders = _request.headers; response.end(envelope({ siteId: "kangyi" })); });
    try {
      const result = await new CmsV2Client({ ...scope, origin: instance.origin }).capabilities();
      expect(result.data.siteId).toBe("kangyi");
      expect(requestHeaders["idempotency-key"]).toBeUndefined();
      expect(requestHeaders["x-publish-signature"]).toMatch(/^sha256=[a-f0-9]{64}$/u);
    } finally { await instance.close(); }
  });

  it("uses the shared active, published and deleted list filter contract", async () => {
    const targets: string[] = [];
    const instance = await server((request, response) => {
      targets.push(request.url ?? "");
      response.end(envelope({ items: [], page: 1, pageSize: 20, total: 0 }));
    });
    try {
      const client = new CmsV2Client({ ...scope, origin: instance.origin });
      await client.listContents();
      await client.listContents({ status: "active", kind: "article" });
      await client.listContents({ status: "published", kind: "case" });
      await client.listContents({ status: "deleted" });
      expect(targets).toEqual([
        "/_publish-api/v2/contents",
        "/_publish-api/v2/contents?status=active&kind=article",
        "/_publish-api/v2/contents?status=published&kind=case",
        "/_publish-api/v2/contents?status=deleted"
      ]);
    } finally { await instance.close(); }
  });

  it("rejects writes without the contract idempotency key before transport", async () => {
    const instance = await server((_request, response) => { response.end(envelope({})); });
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin }).request("POST", "/contents", { json: {}, idempotencyKey: "bad key" })).rejects.toThrow("Idempotency-Key");
    } finally { await instance.close(); }
  });

  it("never automatically retries a retryable write, but preserves exact bytes for explicitly authorized recovery", async () => {
    const observations: Array<{ body: string; key: string | undefined; nonce: string | undefined }> = [];
    const instance = await server(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      observations.push({ body: Buffer.concat(chunks).toString(), key: request.headers["idempotency-key"] as string | undefined, nonce: request.headers["x-publish-nonce"] as string | undefined });
      response.statusCode = observations.length === 1 ? 503 : 201;
      response.end(observations.length === 1 ? JSON.stringify({ ok: false, error: { code: "UNAVAILABLE", message: "Try later", retryable: true }, requestId: "retry" }) : envelope({ contentId: "created" }));
    });
    try {
      let serializations = 0;
      const exactJson = JSON.stringify({ toJSON: () => { serializations += 1; return { title: "系统验收" }; } });
      const client = new CmsV2Client({ ...scope, origin: instance.origin, maxRetries: 1, retryDelayMs: 1 });
      await expect(client.request("POST", "/contents", { exactJson, idempotencyKey: "stable-operation-1" })).rejects.toMatchObject({ code: "UNAVAILABLE", outcomeUnknown: true });
      expect(observations).toHaveLength(1);
      // Local fixture explicitly authorizes this second dispatch; the production adapter exposes no replay path.
      const result = await client.request<{ contentId: string }>("POST", "/contents", { exactJson, idempotencyKey: "stable-operation-1" });
      expect(result.data.contentId).toBe("created");
      expect(serializations).toBe(1);
      expect(observations[0]?.body).toBe(observations[1]?.body);
      expect(observations[0]?.key).toBe(observations[1]?.key);
      expect(observations[0]?.nonce).not.toBe(observations[1]?.nonce);
    } finally { await instance.close(); }
  });

  it("sends the retained JSON bytes unchanged and exposes the actual HTTP acceptance status", async () => {
    const exactJson = '{"draft": {"title":"retained"}}';
    let observed = "";
    const instance = await server(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      observed = Buffer.concat(chunks).toString("utf8");
      response.statusCode = 202;
      response.end(envelope({ jobId: "job-1" }));
    });
    try {
      const result = await new CmsV2Client({ ...scope, origin: instance.origin }).request<{ jobId: string }>("POST", "/contents", { exactJson, idempotencyKey: "retained-operation-1" });
      expect(observed).toBe(exactJson);
      expect(result.httpStatus).toBe(202);
    } finally { await instance.close(); }
  });

  it("classifies exhausted write transport as uncertain while preserving the operation key", async () => {
    let calls = 0;
    const instance = await server((request) => { calls += 1; request.socket.destroy(); });
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin, maxRetries: 1, retryDelayMs: 1 }).request("POST", "/contents", { json: {}, idempotencyKey: "uncertain-operation" })).rejects.toSatisfy((error: unknown) => error instanceof ClientError && error.code === "TRANSPORT_UNCERTAIN" && error.idempotencyKey === "uncertain-operation" && error.outcomeUnknown);
      expect(calls).toBe(1);
    } finally { await instance.close(); }
  });
});
