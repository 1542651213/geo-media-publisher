import type * as ProductPolicy from "../apps/desktop/src/shared/product-platform-policy";
import type { Platform } from "@publisher/domain";
import { createHash, randomUUID } from "node:crypto";
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

// Retain the historical Candidate contract as an explicit OFF-policy fixture.
vi.mock("../apps/desktop/src/shared/product-platform-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof ProductPolicy>();
  return { ...actual,
    productPlatform: (key: string) => key === "douyin" ? { ...actual.productPlatform(key), ordinaryPublishEnabled: false } : actual.productPlatform(key),
    operatorPublishBlockReason: (key: string, platform?: Platform) => key === "douyin" ? "普通 UI 待验收" : actual.operatorPublishBlockReason(key, platform)
  };
});

import { registerIpc } from "../apps/desktop/src/main/ipc";
import { PlatformSelfTestService } from "../apps/desktop/src/main/platform-self-test";

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
  // Historical write acceptance is now explicitly confined to Developer Mode.
  repo.setSetting("developerMode", true);
  const brand = repo.createBrand({ name: "B01", companyName: "B01" });
  const account = repo.createAccount({ platformKey: "douyin", name: "Owner test" });
  repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "fixture-creator", browserSessionIdHash: "fixture" });
  const marker = `B01-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const article = repo.createArticle({ brandId: brand.id, title: `${marker} title`, body: `${marker} body`, summary: "", tags: [],
    seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
    generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: createHash("sha256").update(marker).digest("hex"), source: "production" });
  if (!article) throw new Error("Fixture Article missing");
  repo.setSetting("operationsWorkspaceCompanyId", brand.id);
  repo.db.prepare("INSERT INTO operations_account_company_bindings(account_id,company_id,bound_at,updated_at) VALUES(?,?,?,?)").run(account.id,brand.id,new Date().toISOString(),new Date().toISOString());
  repo.saveContentQualityReview({contentType:"article",contentId:article.id,brandId:brand.id,platformKey:null,contentHash:article.contentHash,trigger:"manual_recheck",provider:"test",model:"test",result:{status:"AI_Checked",score:100,checks:[],issues:[]},snapshot:{}});
  repo.decideContentQuality("article",article.id,"Approved","human-review","manual","fixture reviewed");
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
  it("lets Developer safe levels reach their handler while L5 remains blocked before any job", async () => {
    const { repo, account, invoke } = fixture();
    const runLevel = vi.spyOn(PlatformSelfTestService.prototype, "runLevel").mockRejectedValue(new Error("SAFE_HANDLER_REACHED"));
    try {
      for (const level of ["L1_LOGIN", "L2_EDITOR", "L3_CONTENT_FILL", "L4_DRAFT"]) {
        await expect(invoke("platform-self-test:run-level", { platformAccountId: account.id, level })).rejects.toThrow("SAFE_HANDLER_REACHED");
      }
      await expect(invoke("platform-self-test:run-level", { platformAccountId: account.id, level: "L5_PUBLISH" })).rejects.toThrow("DISABLED");
      expect(runLevel).toHaveBeenCalledTimes(4);
      repo.setSetting("developerMode", false);
      await expect(invoke("platform-self-test:run-level", { platformAccountId: account.id, level: "L1_LOGIN" })).rejects.toThrow("Developer");
      expect(runLevel).toHaveBeenCalledTimes(4);
      expect(repo.listJobs()).toEqual([]);
    } finally { runLevel.mockRestore(); }
  });
  it("retires only an exact safe failed pre-boundary Job through Main and blocks its final route", async () => {
    const { repo, account, article, image, invoke } = fixture();
    await invoke("b01:request-authorization", { platformKey: "douyin", accountId: account.id, articleId: article.id, imageAssetId: image.id });
    const job = repo.createB01Job({ articleId: article.id, platformKey: "douyin", platformAccountId: account.id,
      selectedImageAssetId: image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
      douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } });
    await expect(invoke("b01:retire-preboundary", { jobId: job.id, status: "Revoked" })).rejects.toThrow();
    await expect(invoke("b01:retire-preboundary", { jobId: job.id })).rejects.toThrow();
    repo.updateJobFailure(job.id, "NeedsUserAction", "USER_ACTION_REQUIRED", "fixture", null);
    await expect(invoke("b01:retire-preboundary", { jobId: job.id })).resolves.toMatchObject({ status: "Revoked", jobId: job.id });
    expect(repo.getJob(job.id)?.status).toBe("Cancelled");
    await expect(invoke("jobs:confirm", { id: job.id, dryRun: false })).rejects.toThrow();
    await expect(invoke("jobs:run", { id: job.id })).rejects.toThrow();
    expect(repo.getSubmissionIntentByJob(job.id)).toBeNull();
  });
  it("imports the selected company's image through Main and hashes managed bytes", async () => {
    const { repo, path, invoke } = fixture();
    const selected = repo.createBrand({ name: "Selected company", companyName: "Selected company" });
    repo.setSetting("operationsWorkspaceCompanyId",selected.id);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rZsAAAAASUVORK5CYII=","base64");
    writeFileSync(path,bytes);
    const payload = { brandId: selected.id, sourcePaths: [path], name: "new image", tags: [], business: [], city: [], usage: [], platform: [], universal: false };
    const imported = await invoke("image-assets:import", payload) as Array<{ id: string; brandId: string; filePath: string; sha256: string }>;
    expect(imported).toHaveLength(1);
    expect(imported[0]?.brandId).toBe(selected.id);
    expect(imported[0]?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(repo.getImageAsset(imported[0]!.id)?.sha256).toBe(imported[0]?.sha256);
    repo.updateImageAsset(imported[0]!.id, { name: "renamed" });
    expect(repo.markImageAssetUsed(imported[0]!.id).sha256).toBe(imported[0]?.sha256);
    await expect(invoke("image-assets:import", { ...payload, sha256: "0".repeat(64) })).rejects.toThrow();
  });
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
