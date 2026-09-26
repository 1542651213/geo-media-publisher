import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsV2Client } from "@publisher/cms-v2-client";
import { CmsV2OperationTransport } from "./cms-v2-transport";

const config = { origin: "https://huiquan.example.test", siteId: "huiquan", environment: "staging" as const, keyId: "fixture-key", secret: "0123456789abcdef0123456789abcdef" };

afterEach(() => vi.restoreAllMocks());

describe("shared CMS V2 staging transport", () => {
  it.each(["huiquan", "shupai"] as const)("reuses CmsV2Client for %s with the retained publish body", async (siteId) => {
    const request = vi.spyOn(CmsV2Client.prototype, "request").mockImplementation(async (_method, _path, _options) => ({ ok: true, requestId: "request-1", httpStatus: 202, data: { jobId: "job-1", siteId, environment: "staging", contentId: "content-1", revisionId: "revision-1", contentHash: "hash-1" } }) as never);
    const exactRequestBody = '{"revisionId":"revision-1", "contentHash":"hash-1", "rowVersion":3}';
    const result = await new CmsV2OperationTransport({ ...config, siteId }).publish({ contentId: "content-1", exactRequestBody, idempotencyKey: "retained-operation-1" });
    expect(request).toHaveBeenCalledWith("POST", "/contents/content-1/publish", { exactJson: exactRequestBody, idempotencyKey: "retained-operation-1" });
    expect(result).toEqual({ httpStatus: 202, jobId: "job-1", contentId: "content-1", revisionId: "revision-1", contentHash: "hash-1", rowVersion: 3 });
  });

  it("rejects production scope and verifies same-origin HTTPS public identity", async () => {
    expect(() => new CmsV2OperationTransport({ ...config, environment: "production" })).toThrow("WEBSITE_STAGING_SCOPE_REQUIRED");
    const transport = new CmsV2OperationTransport(config);
    await expect(transport.verifyPublic({ contentId: "content-1", revisionId: "revision-1", contentHash: "hash-1", media: [], publicUrl: "https://shupai.example.test/news/fixture/" })).rejects.toThrow("CMS_PUBLIC_URL_SCOPE_MISMATCH");
    const fetchPublic = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('<html><head><meta content="content-1" name="cms-content-id"><meta name="cms-revision-id" content="revision-1"><meta name="cms-content-hash" content="hash-1"></head></html>', { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    const result = await transport.verifyPublic({ contentId: "content-1", revisionId: "revision-1", contentHash: "hash-1", media: [], publicUrl: "https://huiquan.example.test/news/fixture/" });
    expect(result).toMatchObject({ ok: true, contentId: "content-1", response: { status: 200, revisionId: "revision-1", contentHash: "hash-1" } });
    expect(fetchPublic).toHaveBeenCalledOnce();
  });

  it("requires the published media bytes to match the stored upload hash", async () => {
    const image = Buffer.from([1, 2, 3, 4]);
    const sha256 = createHash("sha256").update(image).digest("hex");
    const fetchPublic = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).includes("/media/")
      ? new Response(image, { status: 200, headers: { "content-type": "image/png" } })
      : new Response('<meta name="cms-content-id" content="content-1"><meta name="cms-revision-id" content="revision-1"><meta name="cms-content-hash" content="hash-1">', { status: 200, headers: { "content-type": "text/html" } }));
    const media = [{ mediaId: "11111111-1111-4111-8111-111111111111", sha256 }];
    const result = await new CmsV2OperationTransport(config).verifyPublic({ contentId: "content-1", revisionId: "revision-1", contentHash: "hash-1", media, publicUrl: "https://huiquan.example.test/news/fixture/" });
    expect(result.response.mediaCount).toBe(1);
    expect(fetchPublic).toHaveBeenCalledTimes(2);
  });
});
