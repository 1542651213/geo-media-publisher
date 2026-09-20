/** Test-only entry: real Electron/preload/Renderer/IPC/Publisher/SQLite; no production main startup. */
import { app, BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "@publisher/db";
import { AdapterRegistry, type AutomationAdapter } from "@publisher/adapters-core";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { PersistentScheduler, PublisherService } from "@publisher/publisher";
import { createConsoleLogger } from "@publisher/logger";
import { registerIpc } from "../../apps/desktop/src/main/ipc";
import { pilotRequest, startPilotPlatform } from "./loopback-platform";

const source = resolve("D:/GEO/repairs/batch1-v0-f01-20260917/source");
const permitted = resolve("D:/GEO/repairs/batch1-v0-f01-20260917/runtime/ordinary-xhs-pilot");
const runDir = resolve(process.env.ORDINARY_XHS_BASELINE_DIR ?? "");
if (process.env.ORDINARY_XHS_BASELINE !== "SYNTHETIC_ONLY" || !runDir.toLowerCase().startsWith(permitted.toLowerCase() + "\\") || existsSync(join(runDir, "publisher.db"))) throw new Error("BASELINE_FRESH_ISOLATED_DIRECTORY_REQUIRED");
mkdirSync(runDir, { recursive: true });
app.setPath("userData", join(runDir, "userData"));
app.setPath("sessionData", join(runDir, "sessionData"));
app.disableHardwareAcceleration();
void app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: !["file:", "data:", "devtools:"].includes(url.protocol) && !(url.protocol === "http:" && url.hostname === "127.0.0.1") });
  });
  const platform = await startPilotPlatform();
  const db = openDatabase(join(runDir, "publisher.db"), join(source, "packages/db/migrations"));
  const repository = db.repository;
  repository.seedPlatformCatalog(join(source, "PLATFORMS.csv"));
  repository.setSetting("contentReviewMode", "Off");
  repository.setSetting("browserPublishMode", "visible");
  repository.setSetting("finalPublishMode", "confirm_before_publish");
  const brand = repository.createBrand({ name: "合成验收企业", companyName: "合成验收企业" });
  const article = repository.createArticle({ brandId: brand.id, topic: "合成验收", keyword: "合成验收", city: "", title: "普通文章离线验收", body: "这是一篇仅用于本地隔离验收的合成文章。它用于核对标题、正文、图片和明确确认，不会连接或发送至真实平台。", summary: "合成内容", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "synthetic", aiModel: "offline-pilot", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: randomUUID(), source: "production" });
  if (!article) throw new Error("BASELINE_ARTICLE_MISSING");
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1sAAAAASUVORK5CYII=", "base64");
  const imagePath = join(runDir, "explicit-single-image.png"); writeFileSync(imagePath, imageBytes);
  const image = repository.createImageAsset({ brandId: brand.id, name: "明确单图", filePath: imagePath, originalFileName: "explicit-single-image.png", mimeType: "image/png", size: imageBytes.length, universal: true });
  const account = repository.createAccount({ platformKey: "xiaohongshu", name: "合成小红书账号" });
  repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in" });
  repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", accountName: account.name, browserSessionId: "synthetic-session", externalAccountId: "synthetic-creator", lastVerifiedAt: new Date().toISOString() });
  repository.bindPlatformAccountIdentity({ platformKey: "xiaohongshu", accountId: account.id, externalCreatorId: "synthetic-creator", bindingSource: "OWNER_APPROVED_CREATOR_IDENTITY_BINDING" });
  const base = new TestPlatformAdapter();
  let prepares = 0;
  const adapter: AutomationAdapter = {
    platformKey: "xiaohongshu", supportsBoundImageBuffers: true,
    manifest: { ...base.manifest, platformKey: "xiaohongshu", displayName: "小红书", transport: "browser", integrationMode: "BrowserAutomation" },
    automationType: "BrowserAutomation", getCapabilities: () => ({ ...base.getCapabilities(), imagePost: true, maxImageCount: 1 }), getCredentialSchema: () => [],
    checkLogin: async () => "logged_in", beginLogin: async () => ({ sessionId: "synthetic", requiresUserAction: false }),
    connectAccount: async () => ({ sessionId: "synthetic", requiresUserAction: false }), isConnectionPending: () => false, completeConnection: async () => "logged_in", checkSession: async () => "logged_in",
    openBackend: async () => ({ opened: true, backendUrl: platform.endpoint.origin, sessionIdHash: "synthetic-session" }),
    validateArticle: async () => ({ valid: true, errors: [], warnings: ["Synthetic boundary; no official platform rule claim"] }),
    preparePublish: async (ctx, input) => {
      prepares++;
      const selected = input.boundImages?.[0];
      const job = repository.listJobs().find((item) => item.articleId === input.articleId && item.accountId === ctx.accountId);
      if (!selected || !job || !input.contentSnapshotId) throw new Error("BASELINE_BOUND_PAYLOAD_REQUIRED");
      await pilotRequest(platform.endpoint, "/upload", { accountId: ctx.accountId, jobId: job.id, articleId: input.articleId, snapshotId: input.contentSnapshotId, title: input.title, body: input.body, imageBase64: Buffer.from(selected.buffer).toString("base64"), imageSha256: selected.sha256 });
      return { prepared: false, requiresUserAction: true, message: "合成平台需要正常验证，尚未准备完成", response: { synthetic: true, imageUploaded: true } };
    },
    publishArticle: async () => { throw new Error("BASELINE_NO_SUBMIT_AUTHORITY"); },
    verifyPublish: async () => ({ status: "publishing", response: { synthetic: true } }), logout: async () => undefined
  };
  const registry = new AdapterRegistry(); registry.register(adapter);
  repository.syncAdapterManifests([{ manifest: adapter.manifest, capabilities: adapter.getCapabilities() }]);
  const logger = createConsoleLogger();
  const publisher = new PublisherService(repository, registry, logger);
  const scheduler = new PersistentScheduler(repository, publisher, logger);
  const credentials = { get: () => null, has: () => false, set: () => { throw new Error("NO_CREDENTIAL_WRITES"); }, delete: () => undefined };
  // New DB contains no AI/content studio tasks. No scheduler is started.
  registerIpc({ repository, registry, publisher, scheduler, resolveAccountSecrets: () => ({}), credentials, aiCredentials: credentials, dataDirectory: runDir, coverDir: runDir, appLogPath: join(runDir, "app.log"), databasePath: join(runDir, "publisher.db"), logger });
  const window = new BrowserWindow({ width: 1480, height: 960, webPreferences: { preload: join(source, "out/preload/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("file:")) event.preventDefault(); });
  writeFileSync(join(runDir, "baseline-ready.json"), JSON.stringify({ synthetic: true, executablePath: process.execPath, appPath: app.getAppPath(), userData: app.getPath("userData"), databasePath: join(runDir, "publisher.db"), article, image, account, nativeAbi: process.versions.modules, renderer: join(source, "out/renderer/index.html"), preload: join(source, "out/preload/preload.js") }, null, 2));
  app.on("before-quit", () => {
    writeFileSync(join(runDir, "baseline-result.json"), JSON.stringify({ prepares, uploads: platform.uploads, receipts: platform.receipts, jobs: repository.listJobs() }, null, 2));
    db.db.close(); void platform.close();
  });
  await window.loadFile(join(source, "out/renderer/index.html"));
}).catch((error: unknown) => { writeFileSync(join(runDir, "baseline-error.txt"), error instanceof Error ? error.stack ?? error.message : String(error)); app.exit(1); });
app.on("window-all-closed", () => app.quit());
