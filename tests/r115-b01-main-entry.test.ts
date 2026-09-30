import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@publisher/db";
import type { IpcDependencies } from "../apps/desktop/src/main/ipc";

const handlers = vi.hoisted(() => new Map<string, (_event: unknown, payload: unknown) => Promise<unknown>>());
const confirm = vi.hoisted(() => vi.fn(async () => ({ response: 1 })));
vi.mock("electron", () => ({
  ipcMain: { removeHandler: (channel: string) => handlers.delete(channel),
    handle: (channel: string, handler: (_event: unknown, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); } },
  app: { getPath: () => "" }, dialog: { showMessageBox: confirm }, shell: {}
}));

import { registerIpc } from "../apps/desktop/src/main/ipc";

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
afterEach(() => { confirm.mockClear(); for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(capability = true) {
  const root = mkdtempSync(join(tmpdir(), "gmp-b01-main-entry-")); roots.push(root);
  const opened = openDatabase(join(root, "publisher.db"), join(process.cwd(), "packages/db/migrations")); databases.push(opened.db);
  const repo = opened.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  repo.setSetting("contentReviewMode", "Off");
  const brand = repo.createBrand({ name: "B01", companyName: "B01" });
  const account = repo.createAccount({ platformKey: "douyin", name: "Owner test" });
  repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "fixture-creator", browserSessionIdHash: "fixture" });
  const marker = `GMP-R115-B01-${Date.now()}`;
  const article = repo.createArticle({ brandId: brand.id, title: `${marker} title`, body: `${marker} body`, summary: "", tags: [],
    seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
    generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: createHash("sha256").update(marker).digest("hex"), source: "production" });
  if (!article) throw new Error("Fixture Article missing");
  const path = join(root, "image.png"); writeFileSync(path, "B01 image bytes");
  const image = repo.createImageAsset({ brandId: brand.id, name: "B01 image", filePath: path, originalFileName: "image.png", mimeType: "image/png", size: 15 });
  const publisher = { prepareArticle: async () => { throw new Error("STOP_BEFORE_BROWSER"); }, executeJob: async () => { throw new Error("STOP_BEFORE_FINAL"); } };
  const adapter = { manifest: { transport: "browser" }, getCapabilities: () => ({ article: true, imagePost: true }),
    inspectOwnedCreatorReadiness: vi.fn(async () => ({ identityVerified: true, contextOwnership: true,
      sessionExists: true, contextExists: true, canonicalPageExists: true, creatorId: "fixture-creator" })),
    prepareFinalSubmit: vi.fn(async () => ({ response: { contentBindingHash: "fixture-binding", titleReadback: true,
      bodyReadback: true, settingsReadback: true, managementReadOnlyReady: true } })) };
  const registry = { getForContent: () => adapter };
  registerIpc({ repository: repo, publisher, scheduler: {}, registry, b01AcceptanceEnabled: capability,
    resolveAccountSecrets: () => ({}), dataDirectory: root, coverDir: root,
    logger: { info: () => {}, warn: () => {}, error: () => {} }, credentials: {}, aiCredentials: {},
    appLogPath: "", databasePath: join(root, "publisher.db") } as unknown as IpcDependencies);
  const invoke = (channel: string, payload: unknown): Promise<unknown> => {
    const handler = handlers.get(channel); if (!handler) throw new Error(`Missing IPC handler ${channel}`); return handler({}, payload);
  };
  return { repo, account, article, image, path, invoke, adapter };
}

describe("B01 Candidate R2 Main authorization request", () => {
  it("creates one exact grant from Main state and leaves final approval and intent absent", async () => {
    const { repo, account, article, image, invoke } = fixture();
    const target = { platformKey: "douyin", accountId: account.id, articleId: article.id, imageAssetId: image.id };
    await expect(invoke("b01:availability", {})).resolves.toMatchObject({ enabled: true });
    await expect(invoke("b01:request-authorization", target)).resolves.toMatchObject({ id: "R1.15-B01", status: "Created", eligible: true });
    expect(repo.getB01Authorization()).toMatchObject({ accountId: account.id, articleId: article.id, imageAssetId: image.id,
      imageSha256: createHash("sha256").update("B01 image bytes").digest("hex"), jobId: null, finalAuthorizedAt: null });
    expect(repo.listJobs()).toHaveLength(0);
    expect(handlers.has("b01:set-status")).toBe(false);
    expect(handlers.has("b01:set-final-approved")).toBe(false);
    await expect(invoke("b01:request-authorization", target)).rejects.toThrow();
  });

  it("fails closed for disabled capability, forged platform or missing account, Article and image", async () => {
    const disabled = fixture(false);
    await expect(disabled.invoke("b01:request-authorization", { platformKey: "douyin", accountId: disabled.account.id,
      articleId: disabled.article.id, imageAssetId: disabled.image.id })).rejects.toThrow();
    expect(disabled.repo.getB01Authorization()).toBeNull();
    disabled.repo.createB01Authorization({ platformKey: "douyin", accountId: disabled.account.id,
      articleId: disabled.article.id, imageAssetId: disabled.image.id,
      imageSha256: createHash("sha256").update("B01 image bytes").digest("hex"),
      expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await expect(disabled.invoke("articles:prepare-publish", { articleId: disabled.article.id, platformKey: "douyin",
      platformAccountId: disabled.account.id, finalPublishMode: "CONFIRM_BEFORE_PUBLISH", imageSelectionMode: "manual",
      selectedImageAssetId: disabled.image.id })).rejects.toThrow("普通运营发布已阻止");
    expect(disabled.repo.listJobs()).toHaveLength(0);
    const { repo, account, article, image, invoke } = fixture();
    const target = { platformKey: "douyin", accountId: account.id, articleId: article.id, imageAssetId: image.id };
    for (const change of [{ platformKey: "weibo" }, { accountId: "missing" }, { articleId: "missing" }, { imageAssetId: "missing" }])
      await expect(invoke("b01:request-authorization", { ...target, ...change })).rejects.toThrow();
    expect(repo.getB01Authorization()).toBeNull();
  });

  it("does not create an authorization when the Main confirmation is cancelled", async () => {
    const { repo, account, article, image, invoke } = fixture();
    confirm.mockResolvedValueOnce({ response: 0 });
    await expect(invoke("b01:request-authorization", { platformKey: "douyin", accountId: account.id,
      articleId: article.id, imageAssetId: image.id })).rejects.toThrow("B01_OWNER_AUTHORIZATION_REQUIRED");
    expect(repo.getB01Authorization()).toBeNull();
  });

  it("requires a separate prepared, intent-free Owner approval path", async () => {
    const { repo, account, article, image, invoke } = fixture();
    await expect(invoke("b01:request-final-approval", { jobId: "missing" })).rejects.toThrow();
    await invoke("b01:request-authorization", { platformKey: "douyin", accountId: account.id, articleId: article.id, imageAssetId: image.id });
    const job = repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
      douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } });
    await expect(invoke("b01:request-final-approval", { jobId: job.id })).rejects.toThrow();
    expect(repo.getSubmissionIntentByJob(job.id)).toBeNull();
    expect(repo.getB01Authorization()?.status).toBe("Bound");
  });

  it("approves only a strictly bound Prepared record after owned-editor readback, before Intent creation", async () => {
    const { repo, account, article, image, invoke, adapter } = fixture();
    await invoke("b01:request-authorization", { platformKey: "douyin", accountId: account.id, articleId: article.id, imageAssetId: image.id });
    const job = repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
      douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } });
    const auth = repo.getB01Authorization();
    const connection = repo.getDouyinImageTextConnection(account.id);
    if (!auth || !connection) throw new Error("B01 fixture binding missing");
    repo.insertPublishRecord({ jobId: job.id, accountId: account.id, platformAccountId: account.id,
      platformKey: "douyin", articleId: article.id, publishedUrl: null, publishedExternalId: null,
      success: false, status: "Prepared", publishMode: "ASSISTED", automationType: "BrowserAutomation",
      verificationStatus: "WaitingUser", titleFilled: true, bodyFilled: true,
      response: { imageUploaded: true, contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER", selectedImageAssetId: image.id,
        imageSelectionMode: "manual", imageHashes: [auth.imageSha256], musicModeRequested: "NONE",
        musicResult: "DISABLED", expectedCreatorId: connection.creatorId, expectedLoginGeneration: connection.loginGeneration,
        contentBindingHash: "fixture-binding" } });
    repo.markB01Prepared(job.id);
    expect(repo.getSubmissionIntentByJob(job.id)).toBeNull();
    adapter.inspectOwnedCreatorReadiness.mockResolvedValueOnce({ identityVerified: false, contextOwnership: true,
      sessionExists: true, contextExists: true, canonicalPageExists: true, creatorId: "fixture-creator" });
    await expect(invoke("b01:request-final-approval", { jobId: job.id })).rejects.toThrow("B01_REMOTE_IDENTITY_UNVERIFIED");
    expect(repo.getB01Authorization()?.status).toBe("Prepared");
    adapter.prepareFinalSubmit.mockResolvedValueOnce({ response: { contentBindingHash: "wrong", titleReadback: true,
      bodyReadback: true, settingsReadback: true, managementReadOnlyReady: true } });
    await expect(invoke("b01:request-final-approval", { jobId: job.id })).rejects.toThrow("B01_FINAL_READBACK_MISMATCH");
    expect(repo.getB01Authorization()?.status).toBe("Prepared");
    await expect(invoke("b01:request-final-approval", { jobId: job.id })).resolves.toMatchObject({ status: "FinalApproved", jobId: job.id });
    expect(adapter.prepareFinalSubmit).toHaveBeenCalledTimes(2);
    expect(repo.getSubmissionIntentByJob(job.id)).toBeNull();
    expect(() => repo.assertB01Job(job.id, "final")).not.toThrow();
    await expect(invoke("b01:request-final-approval", { jobId: job.id })).rejects.toThrow();
  });
});
