import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { Media } from "./contracts";
import { CmsV2Client, signRequest } from "./client";

const secret = "0123456789abcdef0123456789abcdef"; // gitleaks:allow -- public fixed signing-vector fixture, never a service credential
const scope = { siteId: "kangyi", environment: "local" as const, keyId: "test-key", secret };
const mediaId = "123e4567-e89b-42d3-a456-426614174000";
const bytes = Buffer.from("private-media-fixture", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const expected: Media = { mediaId, sha256, mime: "image/png", width: 640, height: 480, bytes: bytes.length };

type TestServer = { origin: string; close: () => Promise<void> };

async function server(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): Promise<TestServer> {
  const instance = createServer((request, response) => {
    response.setHeader("Connection", "close");
    void Promise.resolve(handler(request, response)).catch(() => response.destroy());
  });
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  const port = (instance.address() as { port: number }).port;
  return { origin: `http://127.0.0.1:${port}`, close: async () => { instance.closeAllConnections(); await new Promise<void>((resolve) => instance.close(() => resolve())); } };
}

function sendMedia(response: ServerResponse, body = bytes, headers: Partial<Record<string, string>> = {}): void {
  response.writeHead(200, {
    "Content-Type": expected.mime,
    "Content-Length": String(body.length),
    "X-Media-Id": expected.mediaId,
    "X-Media-Sha256": expected.sha256,
    "X-Media-Width": String(expected.width),
    "X-Media-Height": String(expected.height),
    "X-Media-Bytes": String(expected.bytes),
    ...headers
  });
  response.end(body);
}

describe("CmsV2Client private media verification", () => {
  it("streams a signed private-media GET and returns verified metadata without returning pixels", async () => {
    let observed: IncomingMessage | undefined;
    const instance = await server((request, response) => { observed = request; sendMedia(response); });
    try {
      const result = await new CmsV2Client({ ...scope, origin: instance.origin }).verifyPrivateMedia(expected);
      expect(result).toEqual({ httpStatus: 200, ...expected });
      expect(observed?.method).toBe("GET");
      expect(observed?.url).toBe(`/_publish-api/v2/media/${mediaId}`);
      expect(observed?.headers["idempotency-key"]).toBeUndefined();
      expect(observed?.headers["content-type"]).toBeUndefined();
      expect(observed?.headers.accept).toBe(expected.mime);
      const nonce = observed?.headers["x-publish-nonce"] as string;
      const timestamp = Number(observed?.headers["x-publish-timestamp"]);
      expect(nonce).toMatch(/^[a-f0-9]{32}$/u);
      expect(observed?.headers["x-publish-signature"]).toBe(signRequest({
        method: "GET", target: `/_publish-api/v2/media/${mediaId}`, siteId: scope.siteId,
        environment: scope.environment, timestamp, nonce, body: Buffer.alloc(0)
      }, secret));
      expect(result).not.toHaveProperty("body");
      expect(result).not.toHaveProperty("bytesBuffer");
    } finally { await instance.close(); }
  });

  it.each([
    ["identity", { "X-Media-Id": "123e4567-e89b-42d3-a456-426614174001" }],
    ["declared hash", { "X-Media-Sha256": "0".repeat(64) }],
    ["declared bytes", { "X-Media-Bytes": String(expected.bytes + 1) }],
    ["MIME", { "Content-Type": "image/jpeg" }],
    ["width", { "X-Media-Width": String(expected.width + 1) }],
    ["height", { "X-Media-Height": String(expected.height + 1) }],
    ["Content-Length", { "Content-Length": String(expected.bytes + 1) }]
  ])("rejects a mismatched %s header without exposing its value", async (_name, headers) => {
    const instance = await server((_request, response) => sendMedia(response, bytes, headers));
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin }).verifyPrivateMedia(expected))
        .rejects.toMatchObject({ code: "MEDIA_MISMATCH", status: 200 });
    } finally { await instance.close(); }
  });

  it.each([
    ["corrupt body", Buffer.from("private-media-fixturf", "utf8")],
    ["empty body", Buffer.alloc(0)]
  ])("rejects a %s against the signed metadata", async (_name, body) => {
    const instance = await server((_request, response) => {
      response.writeHead(200, {
        "Content-Type": expected.mime,
        "X-Media-Id": expected.mediaId,
        "X-Media-Sha256": expected.sha256,
        "X-Media-Width": String(expected.width),
        "X-Media-Height": String(expected.height),
        "X-Media-Bytes": String(expected.bytes)
      });
      response.end(body);
    });
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin }).verifyPrivateMedia(expected))
        .rejects.toMatchObject({ code: "MEDIA_MISMATCH", status: 200 });
    } finally { await instance.close(); }
  });

  it.each([401, 403])("classifies HTTP %i as a bounded authorization error", async (status) => {
    const instance = await server((_request, response) => { response.statusCode = status; response.end(secret); });
    try {
      const rejection = expect(new CmsV2Client({ ...scope, origin: instance.origin }).verifyPrivateMedia(expected)).rejects;
      await rejection.toMatchObject({ code: "AUTH_REJECTED", status });
      await rejection.not.toHaveProperty("message", expect.stringContaining(secret));
    } finally { await instance.close(); }
  });

  it("rejects redirects without following them", async () => {
    let requests = 0;
    const instance = await server((request, response) => {
      requests += 1;
      if (request.url?.startsWith("/_publish-api/v2/media/")) {
        response.writeHead(302, { Location: "/credential-reflection" });
      }
      response.end(secret);
    });
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin }).verifyPrivateMedia(expected))
        .rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 302 });
      expect(requests).toBe(1);
    } finally { await instance.close(); }
  });

  it("rejects a successful HTML response as unexpected binary media", async () => {
    const instance = await server((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(`<p>${secret}</p>`); });
    try {
      const rejection = expect(new CmsV2Client({ ...scope, origin: instance.origin }).verifyPrivateMedia(expected)).rejects;
      await rejection.toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 200 });
      await rejection.not.toHaveProperty("message", expect.stringContaining(secret));
    } finally { await instance.close(); }
  });

  it("cancels an unread response stream when metadata is rejected", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); },
      cancel() { canceled = true; }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200, headers: {
      "Content-Type": "image/jpeg",
      "X-Media-Id": expected.mediaId,
      "X-Media-Sha256": expected.sha256,
      "X-Media-Width": String(expected.width),
      "X-Media-Height": String(expected.height),
      "X-Media-Bytes": String(expected.bytes)
    } })));
    try {
      await expect(new CmsV2Client({ ...scope, origin: "http://127.0.0.1" }).verifyPrivateMedia(expected))
        .rejects.toMatchObject({ code: "MEDIA_MISMATCH", status: 200 });
      expect(canceled).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("aborts a chunked response when the streamed body exceeds 8 MiB", async () => {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
    const instance = await server((_request, response) => {
      response.writeHead(200, {
        "Content-Type": expected.mime,
        "X-Media-Id": expected.mediaId,
        "X-Media-Sha256": expected.sha256,
        "X-Media-Width": String(expected.width),
        "X-Media-Height": String(expected.height),
        "X-Media-Bytes": String(expected.bytes)
      });
      response.end(oversized);
    });
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin }).verifyPrivateMedia(expected))
        .rejects.toMatchObject({ code: "MEDIA_TOO_LARGE", status: 200 });
    } finally { await instance.close(); }
  });

  it("uses only the configured bounded retry budget for read transport failures", async () => {
    let requests = 0;
    const instance = await server((request, response) => {
      requests += 1;
      if (requests < 2) { request.socket.destroy(); return; }
      sendMedia(response);
    });
    try {
      const result = await new CmsV2Client({ ...scope, origin: instance.origin, maxRetries: 1, retryDelayMs: 0 }).verifyPrivateMedia(expected);
      expect(result.mediaId).toBe(expected.mediaId);
      expect(requests).toBe(2);
    } finally { await instance.close(); }
  });

  it("sanitizes exhausted transport and server errors", async () => {
    let transportRequests = 0;
    const transport = await server((request) => { transportRequests += 1; request.socket.destroy(new Error(secret)); });
    try {
      const rejection = expect(new CmsV2Client({ ...scope, origin: transport.origin, maxRetries: 1, retryDelayMs: 0 }).verifyPrivateMedia(expected)).rejects;
      await rejection.toMatchObject({ code: "TRANSPORT_ERROR", status: 0 });
      await rejection.not.toHaveProperty("message", expect.stringContaining(secret));
      expect(transportRequests).toBe(2);
    } finally { await transport.close(); }

    const remote = await server((_request, response) => { response.statusCode = 500; response.end(secret); });
    try {
      const rejection = expect(new CmsV2Client({ ...scope, origin: remote.origin }).verifyPrivateMedia(expected)).rejects;
      await rejection.toMatchObject({ code: "REMOTE_ERROR", status: 500 });
      await rejection.not.toHaveProperty("message", expect.stringContaining(secret));
    } finally { await remote.close(); }
  });

  it.each([
    { ...expected, mediaId: "not-a-uuid" },
    { ...expected, sha256: "ABC" },
    { ...expected, bytes: 0 },
    { ...expected, bytes: 8 * 1024 * 1024 + 1 },
    { ...expected, width: 0 },
    { ...expected, height: 10_001 },
    { ...expected, mime: "text/html" as Media["mime"] }
  ])("validates the expected Media contract before any HTTP request", async (invalid) => {
    let requests = 0;
    const instance = await server((_request, response) => { requests += 1; sendMedia(response); });
    try {
      await expect(new CmsV2Client({ ...scope, origin: instance.origin }).verifyPrivateMedia(invalid))
        .rejects.toMatchObject({ code: "INVALID_MEDIA_EXPECTATION", status: 0 });
      expect(requests).toBe(0);
    } finally { await instance.close(); }
  });
});
