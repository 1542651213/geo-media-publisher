import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { KuaishouAdapter, type KuaishouApiContract } from "./index";

function contract(): KuaishouApiContract {
  return {
    reviewed: true,
    accessTokenPlacement: "bearer",
    upload: {
      url: "https://official.example/upload",
      fileField: "file",
      chunkIndexField: "chunk_index",
      totalChunksField: "total_chunks",
      uploadIdField: "upload_id",
      contentRangeHeader: "Content-Range",
      photoIdPath: "photo_id",
      uploadIdPath: "upload_id"
    },
    publish: {
      url: "https://official.example/publish",
      method: "POST",
      body: ({ video, upload }) => ({ photo_id: upload.photoId, caption: video.title, description: video.description ?? "" }),
      externalIdPath: "publish_id"
    },
    status: {
      url: (externalId) => `https://official.example/status/${encodeURIComponent(externalId)}`,
      method: "GET",
      statusPath: "status",
      publishingValues: ["processing"],
      publishedValues: ["published"],
      failedValues: ["failed"],
      publishedUrlPath: "url",
      errorMessagePath: "message"
    },
    errorCodePaths: ["error_code"],
    errorMessagePaths: ["message"],
    errorCodeMap: { TOKEN_EXPIRED: "LOGIN_EXPIRED", REVIEW_REQUIRED: "API_REVIEW_REQUIRED" }
  };
}

const context = (dryRun = false) => ({
  accountId: "account-1",
  accountName: "test",
  platformKey: "kuaishou",
  settings: { dryRun },
  secrets: { clientId: "client", clientSecret: "secret", redirectUri: "https://app.example/callback" }
});

describe("Kuaishou official API adapter", () => {
  it("declares a truthful reviewed-boundary manifest", () => {
    const adapter = new KuaishouAdapter();
    expect(adapter.manifest).toMatchObject({ platformKey: "kuaishou", transport: "official_api", adapterStatus: "degraded", supportsArticle: false, supportsVideo: true, status: "Blocked" });
    expect(adapter.manifest.officialSources.length).toBeGreaterThan(0);
  });

  it("declares video-only capabilities and fails closed without a reviewed contract", async () => {
    const adapter = new KuaishouAdapter();
    expect(adapter.manifest.transport).toBe("official_api");
    expect(adapter.getCapabilities()).toMatchObject({ article: false, video: true, videoPublishAsync: true });
    const dir = mkdtempSync(join(tmpdir(), "kuaishou-adapter-"));
    try {
      const videoPath = join(dir, "video.mp4");
      writeFileSync(videoPath, "video");
      await expect(adapter.publishVideo(context(), { title: "title", tags: [], videoPath })).rejects.toMatchObject({ code: "API_REVIEW_REQUIRED" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-runs after local video validation without calling fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kuaishou-adapter-"));
    try {
      const videoPath = join(dir, "video.mp4");
      writeFileSync(videoPath, "video");
      const fetchPort = vi.fn<typeof fetch>();
      const adapter = new KuaishouAdapter({ fetchPort, apiContract: contract() });
      await expect(adapter.publishVideo(context(true), { title: "title", tags: [], videoPath })).resolves.toMatchObject({ dryRun: true, prepared: true });
      expect(fetchPort).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid video input during standalone validation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kuaishou-validation-"));
    try {
      const videoPath = join(dir, "video.mp4");
      writeFileSync(videoPath, "video");
      const adapter = new KuaishouAdapter();
      await expect(adapter.validateVideo({ title: "", tags: [], videoPath })).resolves.toMatchObject({ valid: false, errors: expect.any(Array) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uploads chunks, publishes and polls status through injected fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kuaishou-adapter-"));
    try {
      const videoPath = join(dir, "video.mp4");
      writeFileSync(videoPath, "1234567890");
      const fetchPort = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", refresh_token: "refresh", expires_in: 3600 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ upload_id: "upload-1" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ photo_id: "photo-1", upload_id: "upload-1" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ publish_id: "publish-1" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: "processing" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: "published", url: "https://kuaishou.example/publish-1" }), { status: 200 }));
      const adapter = new KuaishouAdapter({ fetchPort, apiContract: contract(), chunkSizeBytes: 5, oauth: { authorizationUrl: "https://official.example/oauth", tokenUrl: "https://official.example/token", scopes: ["user_video_publish"], tokenClientAuth: "body" } });
      const login = await adapter.beginLogin(context());
      expect(login.authorizationUrl).toContain("user_video_publish");
      await adapter.completeLogin(context(), "code", login.sessionId.replace("kuaishou-oauth-", ""));
      const result = await adapter.publishVideo(context(), { title: "title", tags: [], videoPath });
      expect(result).toMatchObject({ status: "publishing", externalId: "publish-1" });
      await expect(adapter.getPublishStatus(context(), "publish-1")).resolves.toMatchObject({ status: "publishing" });
      await expect(adapter.getPublishStatus(context(), "publish-1")).resolves.toMatchObject({ status: "published", publishedUrl: "https://kuaishou.example/publish-1" });
      expect(fetchPort).toHaveBeenCalledTimes(6);
      const uploadRequest = fetchPort.mock.calls[1]?.[1];
      expect(new Headers(uploadRequest?.headers).get("Authorization")).toBe("Bearer token");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps provider and HTTP errors without retrying", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kuaishou-adapter-"));
    try {
      const videoPath = join(dir, "video.mp4");
      writeFileSync(videoPath, "video");
      const fetchPort = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", refresh_token: "refresh", expires_in: 3600 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error_code: "REVIEW_REQUIRED", message: "contract review needed" }), { status: 400 }));
      const adapter = new KuaishouAdapter({ fetchPort, apiContract: contract(), oauth: { authorizationUrl: "https://official.example/oauth", tokenUrl: "https://official.example/token", scopes: ["user_video_publish"] } });
      const login = await adapter.beginLogin(context());
      await adapter.completeLogin(context(), "code", login.sessionId.replace("kuaishou-oauth-", ""));
      await expect(adapter.publishVideo(context(), { title: "title", tags: [], videoPath })).rejects.toMatchObject({ code: "API_REVIEW_REQUIRED", providerCode: "REVIEW_REQUIRED" });
      expect(fetchPort).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
