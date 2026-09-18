import { app, ipcMain, session } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { readFileSync as readPhysicalFileSync } from "node:original-fs";
import { basename, dirname, join, resolve } from "node:path";
import net from "node:net";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import type { AppRepository } from "@publisher/db";
import { AdapterRegistry } from "@publisher/adapters-core";
import type { XhsContextIdentityAttestation } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { parseOrdinaryPilotConfiguration, readOrdinaryPilotGate, type OrdinaryPilotConfiguration } from "./ordinary-pilot/config";
import { SyntheticXhsAdapter } from "./ordinary-pilot/synthetic-adapter";
import { startPilotPlatform, type PilotReceipt } from "./ordinary-pilot/loopback-platform";

const hash = (path: string): string => createHash("sha256").update(readPhysicalFileSync(path)).digest("hex");
const samePath = (left: string, right: string): boolean => resolve(left).toLowerCase() === resolve(right).toLowerCase();
const overlaps = (left: string, right: string): boolean => {
  const a = resolve(left).toLowerCase(); const b = resolve(right).toLowerCase();
  return a === b || a.startsWith(`${b}\\`) || b.startsWith(`${a}\\`);
};
function assertOwnedTree(directory: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name); const stat = lstatSync(path);
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw new Error("ORDINARY_PILOT_LINKED_DATA_DENIED");
    if (stat.isDirectory()) assertOwnedTree(path);
  }
}
export interface OrdinaryPilotServices {
  registry: AdapterRegistry;
  resolveRuntimeIdentityAttestation(accountId: string): XhsContextIdentityAttestation | null;
  writeEvidence(): void;
  close(): Promise<void>;
}
export interface OrdinaryPilotContext {
  config: OrdinaryPilotConfiguration;
  dataDirectory: string;
  startScheduler: false;
  resumeBackgroundTasks: false;
  installNetworkPolicy(): void;
  createServices(repository: AppRepository, logger: Logger): Promise<OrdinaryPilotServices>;
}

/** Must execute before any default userData read, log, DB, lock or real registry construction. */
export function initializeOrdinaryPilot(): OrdinaryPilotContext | null {
  const configurationPath = readOrdinaryPilotGate(process.env);
  if (!configurationPath) return null;
  const config = parseOrdinaryPilotConfiguration(JSON.parse(readFileSync(configurationPath, "utf8")), configurationPath);
  const isolationRoot = dirname(config.runDirectory);
  if (overlaps(config.runDirectory, app.getPath("userData")) || overlaps(config.runDirectory, app.getAppPath()) || overlaps(config.runDirectory, dirname(process.execPath))) throw new Error("ORDINARY_PILOT_PRODUCTION_PATH_DENIED");
  if (!app.isPackaged || !samePath(process.execPath, config.executablePath) || !samePath(app.getAppPath(), config.appAsarPath)) throw new Error("ORDINARY_PILOT_CANDIDATE_IDENTITY_MISMATCH");
  if (hash(process.execPath) !== config.executableSha256 || hash(app.getAppPath()) !== config.appAsarSha256) throw new Error("ORDINARY_PILOT_CANDIDATE_HASH_MISMATCH");
  // Pilot-only process boundary: standard IPC must not reach remote AI, API or browser launches.
  net.Socket.prototype.connect = new Proxy(net.Socket.prototype.connect, { apply(target, receiver, args: unknown[]) {
    const options = Array.isArray(args[0]) ? args[0] as unknown[] : args;
    const first = options[0];
    const host = first && typeof first === "object" ? (first as { host?: unknown }).host : options[1];
    const pipe = first && typeof first === "object" ? (first as { path?: unknown }).path : typeof first === "string";
    if (pipe || host !== "127.0.0.1" && host !== "::1" && host !== undefined) throw new Error("ORDINARY_PILOT_REMOTE_NETWORK_DENIED");
    return Reflect.apply(target, receiver, args);
  } });
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
    Object.defineProperty(childProcess, name, { configurable: true, writable: true, value: () => { throw new Error("ORDINARY_PILOT_EXTERNAL_PROCESS_DENIED"); } });
  }
  syncBuiltinESMExports();
  mkdirSync(isolationRoot, { recursive: true });
  if (!samePath(realpathSync(isolationRoot), isolationRoot)) throw new Error("ORDINARY_PILOT_ROOT_REPARSE_DENIED");
  mkdirSync(config.runDirectory, { recursive: true });
  if (!samePath(realpathSync(config.runDirectory), config.runDirectory)) throw new Error("ORDINARY_PILOT_RUN_REPARSE_DENIED");
  assertOwnedTree(config.runDirectory);
  const markerPath = join(config.runDirectory, ".ordinary-pilot-owner.json");
  const marker = { version: 1, runId: config.runId, executableSha256: config.executableSha256, appAsarSha256: config.appAsarSha256, tokenHash: createHash("sha256").update(config.token).digest("hex") };
  if (existsSync(markerPath)) {
    if (!config.allowRecovery || JSON.stringify(JSON.parse(readFileSync(markerPath, "utf8"))) !== JSON.stringify(marker)) throw new Error("ORDINARY_PILOT_REUSE_NOT_AUTHORIZED");
  } else {
    const entries = readdirSync(config.runDirectory).filter((name) => !(samePath(dirname(configurationPath), config.runDirectory) && name === basename(configurationPath)));
    if (entries.length) throw new Error("ORDINARY_PILOT_FRESH_DIRECTORY_REQUIRED");
    writeFileSync(markerPath, JSON.stringify(marker));
  }
  for (const name of ["userData", "sessionData", "data"]) {
    const path = join(config.runDirectory, name); mkdirSync(path, { recursive: true });
    if (!samePath(realpathSync(path), path)) throw new Error("ORDINARY_PILOT_CHILD_REPARSE_DENIED");
  }
  app.setPath("userData", join(config.runDirectory, "userData"));
  app.setPath("sessionData", join(config.runDirectory, "sessionData"));
  const dataDirectory = join(config.runDirectory, "data");
  writeFileSync(join(config.runDirectory, "runtime-identity.json"), JSON.stringify({ synthetic: true, runId: config.runId, executablePath: process.execPath, executableSha256: config.executableSha256, appAsarPath: app.getAppPath(), appAsarSha256: config.appAsarSha256, userData: app.getPath("userData"), sessionData: app.getPath("sessionData"), databasePath: join(dataDirectory, "publisher.db"), electronVersion: process.versions.electron, nodeVersion: process.versions.node, nativeAbi: process.versions.modules, schedulerStarted: false, backgroundRecoveryEnabled: false }, null, 2));
  return {
    config, dataDirectory, startScheduler: false, resumeBackgroundTasks: false,
    installNetworkPolicy() {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        const allowed = ["file:", "data:", "devtools:"].includes(url.protocol) || url.protocol === "http:" && url.hostname === "127.0.0.1";
        if (!allowed) writeFileSync(join(config.runDirectory, "blocked-renderer-request.json"), JSON.stringify({ origin: url.origin, protocol: url.protocol }));
        callback({ cancel: !allowed });
      });
      app.on("web-contents-created", (_event, contents) => { contents.setWindowOpenHandler(() => ({ action: "deny" })); contents.on("will-navigate", (event, url) => { if (!url.startsWith("file:")) event.preventDefault(); }); });
    },
    async createServices(repository, logger) {
      let persistChanges: () => void = () => undefined;
      const platform = await startPilotPlatform(() => persistChanges());
      const adapter = new SyntheticXhsAdapter(platform.endpoint);
      const registry = new AdapterRegistry(); registry.register(adapter);
      const evidencePath = join(config.runDirectory, "pilot-state.json");
      if (config.allowRecovery && existsSync(evidencePath)) {
        const prior = JSON.parse(readFileSync(evidencePath, "utf8")) as { receipts?: PilotReceipt[] };
        if (Array.isArray(prior.receipts)) platform.receipts.push(...prior.receipts);
      }
      if (!repository.listAccounts().length) {
        repository.setSetting("contentReviewMode", "Off"); repository.setSetting("browserPublishMode", "visible"); repository.setSetting("finalPublishMode", "confirm_before_publish");
        const brand = repository.createBrand({ name: "离线合成企业", companyName: "离线合成企业" });
        for (const number of [1, 2]) repository.createArticle({ brandId: brand.id, topic: "离线验收", keyword: "合成", city: "", title: `离线普通文章${number}`, body: `第${number}篇本地合成文章，用于验证单账号不同文章各自确认。所有图片上传和最终提交仅发送到本机合成服务。`, summary: "离线验收", tags: [], seoKeywords: [], articleType: "科普", aiProvider: "synthetic", aiModel: "ordinary-pilot", generatedAt: new Date().toISOString(), reusePolicy: "always", contentHash: randomUUID(), source: "production" });
        const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1sAAAAASUVORK5CYII=", "base64");
        const imagePath = join(dataDirectory, "explicit-single-image.png"); writeFileSync(imagePath, bytes);
        repository.createImageAsset({ brandId: brand.id, name: "明确合成单图", filePath: imagePath, originalFileName: "explicit-single-image.png", mimeType: "image/png", size: bytes.length, universal: true });
        const account = repository.createAccount({ platformKey: "xiaohongshu", name: "离线合成小红书账号" });
        repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in", minimumIntervalSeconds: 0 });
        repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", accountName: account.name, browserSessionId: `synthetic-session-${account.id}`, externalAccountId: "synthetic-creator", lastVerifiedAt: new Date().toISOString() });
        repository.bindPlatformAccountIdentity({ platformKey: "xiaohongshu", accountId: account.id, externalCreatorId: "synthetic-creator", bindingSource: "OWNER_APPROVED_CREATOR_IDENTITY_BINDING" });
      }
      const snapshot = () => ({ synthetic: true, runId: config.runId, uploads: platform.uploads, receipts: platform.receipts, leases: [...adapter.leases.values()], resourceEvents: adapter.events, unrelatedWindows: [...adapter.unrelatedWindows], jobs: repository.listJobs(), records: repository.listJobs().map((job) => repository.getPublishRecordByJob(job.id)) });
      const writeEvidence = (): void => { writeFileSync(evidencePath, JSON.stringify(snapshot(), null, 2)); };
      persistChanges = writeEvidence;
      const control = (payload: unknown): unknown => {
        if (!payload || typeof payload !== "object") throw new Error("PILOT_CONTROL_INVALID");
        const command = payload as Record<string, unknown>;
        if (command.token !== config.token) throw new Error("PILOT_CONTROL_UNAUTHORIZED");
        if (command.action === "platform-mode" && ["accepted", "lost-response", "rejected"].includes(String(command.mode))) platform.setMode(command.mode as "accepted" | "lost-response" | "rejected");
        else if (command.action === "adapter-mode" && ["ready", "verification", "wrong-identity", "invalid-content"].includes(String(command.mode))) adapter.mode = command.mode as "ready" | "verification" | "wrong-identity" | "invalid-content";
        else if (command.action === "manual-close" && typeof command.jobId === "string") adapter.manualClose(command.jobId);
        else if (command.action !== "snapshot") throw new Error("PILOT_CONTROL_ACTION_DENIED");
        writeEvidence(); return snapshot();
      };
      ipcMain.handle("ordinary-pilot:control", (_event, payload: unknown) => control(payload));
      const testGlobal = globalThis as typeof globalThis & { __ordinaryXhsPilotControl?: (payload: unknown) => unknown };
      testGlobal.__ordinaryXhsPilotControl = control;
      logger.info("ORDINARY_PILOT", "SYNTHETIC_BOUNDARIES_ENABLED", "仅本机合成平台；不代表真实小红书结果", { runId: config.runId, dataDirectory });
      writeEvidence();
      return { registry, writeEvidence, resolveRuntimeIdentityAttestation(accountId) { const live = [...adapter.leases.values()].filter((lease) => lease.accountId === accountId && lease.alive); if (live.length !== 1) return null; try { return adapter.subject({ accountId, accountName: "synthetic", platformKey: "xiaohongshu", settings: { publishJobId: live[0]!.jobId } }); } catch { return null; } }, async close() { writeEvidence(); delete testGlobal.__ordinaryXhsPilotControl; ipcMain.removeHandler("ordinary-pilot:control"); await platform.close(); } };
    }
  };
}
