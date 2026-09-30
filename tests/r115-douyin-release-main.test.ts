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

import { registerIpc } from "../apps/desktop/src/main/ipc";

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];
afterEach(() => { confirm.mockClear(); for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(capability = false) {
  const root = mkdtempSync(join(tmpdir(), "gmp-douyin-release-")); roots.push(root);
  const opened = openDatabase(join(root, "publisher.db"), join(process.cwd(), "packages/db/migrations")); databases.push(opened.db);
  const repo = opened.repository;
  repo.seedDevelopment(join(process.cwd(), "PLATFORMS.csv"));
  repo.setSetting("contentReviewMode", "Off");
  const brand = repo.createBrand({ name: "B01", companyName: "B01" });
  const account = repo.createAccount({ platformKey: "douyin", name: "Owner test" });
  repo.saveDouyinImageTextConnection({ accountId: account.id, creatorId: "fixture-creator", browserSessionIdHash: "fixture" });
  const marker = `B01-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const article = repo.createArticle({ brandId: brand.id, title: `${marker} title`, body: `${marker} body`, summary: "", tags: [],
    seoKeywords: [], topic: "B01", keyword: "B01", city: "", articleType: "科普", aiProvider: "fixture", aiModel: "fixture",
    generatedAt: new Date().toISOString(), reusePolicy: "once", contentHash: createHash("sha256").update(marker).digest("hex"), source: "production" });
  if (!article) throw new Error("Fixture Article missing");
  const path = join(root, "image.png"); writeFileSync(path, "B01 image bytes");
  const image = repo.createImageAsset({ brandId: brand.id, name: "B01 image", filePath: path, originalFileName: "image.png", mimeType: "image/png", size: 15 });
  const publisher = { prepareArticle: vi.fn(async (id: string) => ({ job: repo.getJob(id), record: null, message: "isolated prepared" })), executeJob: vi.fn(async () => { throw new Error("STOP_BEFORE_FINAL"); }) };
  const adapter = { manifest: { transport: "browser" }, getCapabilities: () => ({ article: true, imagePost: true }),
    inspectOwnedCreatorReadiness: vi.fn(async () => ({ identityVerified: true, contextOwnership: true,
      sessionExists: true, contextExists: true, canonicalPageExists: true, creatorId: "fixture-creator", runtimeAuthState: "AUTHENTICATED" })),
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
  return { repo, account, article, image, path, invoke, adapter, publisher };
}

describe("Douyin ordinary Release Main product path", () => {
  const request = (f: ReturnType<typeof fixture>) => ({ articleId: f.article.id, platformKey: "douyin", platformAccountId: f.account.platformAccountId ?? f.account.id,
    selectedImageAssetId: f.image.id, imageSelectionMode: "manual", finalPublishMode: "CONFIRM_BEFORE_PUBLISH",
    douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } });
  it("prepares an ordinary Article without a B01 marker or authorization and never submits", async () => {
    const f = fixture();
    f.repo.updateArticle(f.article.id, { title: "室内空气管理", body: "正常正文\n第二段\n第三段" });
    await expect(f.invoke("b01:availability", {})).resolves.toMatchObject({ enabled: false });
    await expect(f.invoke("b01:request-authorization", { platformKey: "douyin", accountId: f.account.id, articleId: f.article.id, imageAssetId: f.image.id })).rejects.toThrow();
    await expect(f.invoke("articles:prepare-publish", request(f))).resolves.toMatchObject({ message: "isolated prepared" });
    expect(f.repo.getB01Authorization()).toBeNull();
    expect(f.repo.listJobs()).toHaveLength(1);
    const job = f.repo.listJobs()[0]!;
    expect(job).toMatchObject({ accountId: f.account.id, selectedImageAssetId: f.image.id, finalPublishMode: "CONFIRM_BEFORE_PUBLISH" });
    expect(f.repo.getSubmissionIntentByJob(job.id)).toBeNull();
    expect(f.publisher.prepareArticle).toHaveBeenCalledOnce();
    expect(f.publisher.executeJob).not.toHaveBeenCalled();
  });
  it("fails closed before Job creation for stale or mismatched identity, wrong ownership and DB login alone", async () => {
    for (const delta of [{ identityVerified: false }, { creatorId: "wrong" }, { contextOwnership: false },
      { canonicalPageExists: false }, { sessionExists: false }, { runtimeAuthState: "UNVERIFIED" }]) {
      const f = fixture();
      f.repo.updateAccount(f.account.id, { loginStatus: "logged_in" });
      f.adapter.inspectOwnedCreatorReadiness.mockResolvedValue({ identityVerified: true, contextOwnership: true, sessionExists: true,
        contextExists: true, canonicalPageExists: true, creatorId: "fixture-creator", runtimeAuthState: "AUTHENTICATED", ...delta });
      await expect(f.invoke("articles:prepare-publish", request(f))).rejects.toThrow("DOUYIN_CREATOR_IDENTITY_UNVERIFIED");
      expect(f.repo.listJobs()).toHaveLength(0);
      expect(f.publisher.prepareArticle).not.toHaveBeenCalled();
    }
  });
  it("rejects wrong account, image, oversized title and music before creating a Job", async () => {
    const f = fixture();
    await expect(f.invoke("articles:prepare-publish", { ...request(f), platformAccountId: "wrong" })).rejects.toThrow();
    await expect(f.invoke("articles:prepare-publish", { ...request(f), selectedImageAssetId: "wrong" })).rejects.toThrow();
    await expect(f.invoke("articles:prepare-publish", { ...request(f), douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate", musicMode: "AUTO_RECOMMENDED" } })).rejects.toThrow();
    f.repo.updateArticle(f.article.id, { title: "字".repeat(21) });
    await expect(f.invoke("articles:prepare-publish", request(f))).rejects.toThrow();
    expect(f.repo.listJobs()).toHaveLength(0);
    expect(f.publisher.prepareArticle).not.toHaveBeenCalled();
  });
  it("keeps all other platforms, batch and real diagnostic submissions blocked", async () => {
    const f = fixture();
    for (const platformKey of ["xiaohongshu", "website", "toutiao", "sohu_media", "netease_media", "baijiahao", "weibo", "lieju", "cnblogs", "zhihu"]) {
      await expect(f.invoke("articles:prepare-publish", { ...request(f), platformKey })).rejects.toThrow();
    }
    await expect(f.invoke("platform-self-test:request-publish", { platformAccountId: f.account.id })).rejects.toThrow();
    expect(f.repo.listJobs()).toHaveLength(0);
    expect(f.publisher.executeJob).not.toHaveBeenCalled();
  });
  it("never opens OAuth/video publishing through the ordinary image/text gate", async () => {
    const f = fixture();
    await f.invoke("articles:prepare-publish", request(f));
    const job = f.repo.listJobs()[0]!;
    vi.spyOn(f.repo, "getJob").mockReturnValue({ ...job, contentKind: "video" });
    await expect(f.invoke("jobs:confirm", { id: job.id, dryRun: false })).rejects.toThrow("DOUYIN_ORDINARY_IMAGE_TEXT_ONLY");
    await expect(f.invoke("jobs:run", { id: job.id })).rejects.toThrow("DOUYIN_ORDINARY_IMAGE_TEXT_ONLY");
    expect(f.publisher.executeJob).not.toHaveBeenCalled();
    expect(f.repo.getSubmissionIntentByJob(job.id)).toBeNull();
  });
});
