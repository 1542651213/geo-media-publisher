import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { CmsV2Client } from "./client";
import { recoverAppliedPublishResponse } from "./publish-recovery";

const contentId = "10000000-0000-4000-a000-000000000001";
const revisionId = "20000000-0000-4000-a000-000000000001";
const jobId = "30000000-0000-4000-a000-000000000001";
const contentHash = "a".repeat(64);
const scope = { siteId: "kangyi", environment: "local" as const, principalId: "fixture-principal", externalId: "geo:fixture:immutable" };
const exactJson = JSON.stringify({ rowVersion: 1, revisionId, contentHash });
const operation = { ...scope, contentId, revisionId, contentHash, rowVersion: 1, exactJson, idempotencyKey: "fixture-original-publish", kind: "article" as const };
const originalJob = { jobId, operation: "publish", ...scope, contentId, revisionId, contentHash, status: "queued", publicUrl: "https://example.test/news/fixture" };
const applied = { id: contentId, contentId, ...scope, kind: "article", revisionId, draftRevisionId: revisionId,
  contentHash, rowVersion: 2, publishedRevisionId: revisionId, deletedAt: null, draft: { kind: "article" } };

async function fixture(record: Record<string, unknown>, cachePresent = true) {
  const observations: Array<{ method: string; key?: string; body: string }> = [];
  let newlyEnqueued = 0;
  const server = createServer(async (request, response) => {
    // Each fixture owns and closes its server. Do not retain pooled sockets across
    // fixture lifetimes when Windows reuses an ephemeral loopback port.
    response.setHeader("Connection", "close");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    observations.push({ method: request.method ?? "", key: request.headers["idempotency-key"] as string | undefined, body });
    if (request.method === "GET") response.end(JSON.stringify({ ok: true, data: record, requestId: "fixture-read" }));
    else if (cachePresent && body === exactJson && request.headers["idempotency-key"] === operation.idempotencyKey) {
      response.statusCode = 202;
      response.end(JSON.stringify({ ok: true, data: originalJob, requestId: "fixture-cache" }));
    } else if ((JSON.parse(body) as { rowVersion: number }).rowVersion !== record.rowVersion) {
      response.statusCode = 409;
      response.end(JSON.stringify({ ok: false, error: { code: "CONFLICT", message: "Content state changed", retryable: false }, requestId: "fixture-fence" }));
    } else {
      newlyEnqueued += 1;
      response.statusCode = 202;
      response.end(JSON.stringify({ ok: true, data: { ...originalJob, jobId: "UNSAFE_REPLACEMENT" }, requestId: "fixture-unsafe" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new CmsV2Client({ siteId: scope.siteId, environment: scope.environment, keyId: "fixture-key",
    secret: "public-signing-fixture-no-live-key-32", // gitleaks:allow -- public test vector
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
  return { client, observations, enqueued: () => newlyEnqueued,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

describe("applied publish response recovery", () => {
  it("recovers the original cached job with its exact bytes/key after a read proves the old write fence cannot pass", async () => {
    const remote = await fixture(applied);
    try {
      expect((await recoverAppliedPublishResponse(remote.client, operation)).data.jobId).toBe(jobId);
      expect(remote.observations).toEqual([{ method: "GET", body: "", key: undefined },
        { method: "POST", body: exactJson, key: operation.idempotencyKey }]);
      expect(remote.enqueued()).toBe(0);
    } finally { await remote.close(); }
  });

  it("a missing cache hits the original stale version fence and never queues a new job", async () => {
    const remote = await fixture(applied, false);
    try {
      await expect(recoverAppliedPublishResponse(remote.client, operation)).rejects.toMatchObject({ code: "REMOTE_STATUS_UNKNOWN" });
      expect(remote.observations).toHaveLength(2);
      expect(remote.enqueued()).toBe(0);
    } finally { await remote.close(); }
  });

  it.each([
    { rowVersion: 1 }, { rowVersion: 1, publishedRevisionId: null }, { environment: "production" }, { siteId: "other" },
    { externalId: "other" }, { principalId: "other" }, { contentId: "other" }, { draftRevisionId: "other" },
    { contentHash: "b".repeat(64) }, { deletedAt: "2026-10-01" }, { kind: "case" }
  ])("does not dispatch any POST when the original identity/applied fence is unproven: %j", async changed => {
    const remote = await fixture({ ...applied, ...changed });
    try {
      await expect(recoverAppliedPublishResponse(remote.client, operation)).rejects.toMatchObject({ code: "REMOTE_STATUS_UNKNOWN" });
      expect(remote.observations.map(item => item.method)).toEqual(["GET"]);
      expect(remote.enqueued()).toBe(0);
    } finally { await remote.close(); }
  });

  it("also recovers the original response after a failed verification compensates the pointer and advances the version", async () => {
    const remote = await fixture({ ...applied, rowVersion: 3, publishedRevisionId: null });
    try {
      expect((await recoverAppliedPublishResponse(remote.client, operation)).data.jobId).toBe(jobId);
      expect(remote.enqueued()).toBe(0);
    } finally { await remote.close(); }
  });

  it("rejects a changed retained request before any HTTP access", async () => {
    const remote = await fixture(applied);
    try {
      await expect(recoverAppliedPublishResponse(remote.client, { ...operation, exactJson: JSON.stringify({ rowVersion: 2, revisionId, contentHash }) }))
        .rejects.toMatchObject({ code: "RECOVERY_BINDING_MISMATCH" });
      expect(remote.observations).toEqual([]);
    } finally { await remote.close(); }
  });
});
