import { app } from "electron";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { readFileSync as readPhysicalFileSync } from "node:original-fs";
import { join, win32 } from "node:path";
import type { Page } from "playwright-core";
import type { XhsProductionReceiptObserver, XhsReceiptEvent, XhsReceiptMeta } from "@publisher/adapters-xiaohongshu/browser";
import { XhsProductionReceiptObserver as ReceiptObserver } from "@publisher/adapters-xiaohongshu/browser";
import type { AppRepository } from "@publisher/db";
import type { ProductionPilotGuard } from "@publisher/publisher";
import { FORMAL_XHS_PRODUCTION_PILOT_EXPIRES_AT_UTC, parseFormalXhsProductionPilotConfig, readFormalXhsProductionPilotGate, type FormalXhsProductionPilotConfig } from "./formal-xhs-production-pilot-config";

const hashFile = (path: string): string => createHash("sha256").update(readPhysicalFileSync(path)).digest("hex").toLowerCase();
const samePath = (left: string, right: string): boolean => win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
const inside = (parent: string, child: string): boolean => {
  const relative = win32.relative(win32.resolve(parent), win32.resolve(child));
  return Boolean(relative) && !relative.startsWith("..\\") && relative !== ".." && !win32.isAbsolute(relative);
};
const request = (payload: unknown): Record<string, unknown> => typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";

export interface FormalXhsProductionPilotContext {
  config: FormalXhsProductionPilotConfig;
  dataDirectory: string;
  buildSha256: string;
  productionReceiptFactory: (page: Page, meta: XhsReceiptMeta) => XhsProductionReceiptObserver;
  ensureRepository(repository: AppRepository): void;
  createGuard(repository: AppRepository): ProductionPilotGuard;
  assertIpc(channel: string, payload: unknown, repository: AppRepository): void;
}

/**
 * Strictly opt-in formal mode.  It uses the existing formal userData/database
 * and profile paths; unlike old fixed-content max3 code it never calls
 * app.setPath() or creates a synthetic account.
 */
export function initializeFormalXhsProductionPilot(): FormalXhsProductionPilotContext | null {
  const configPath = readFormalXhsProductionPilotGate(process.env);
  if (!configPath) return null;
  if (process.env.GEO_XHS_MAX3 || process.env.GEO_XHS_MAX3_CONFIG || process.env.ORDINARY_XHS_PILOT || process.env.ORDINARY_XHS_PILOT_CONFIG) {
    throw new Error("FORMAL_XHS_PRODUCTION_PILOT_MODE_CONFLICT");
  }
  const dataDirectory = join(app.getPath("userData"), "production-data");
  const controlDirectory = join(dataDirectory, "production-pilot-control");
  if (!inside(controlDirectory, configPath) || !existsSync(configPath)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_CONFIG_PATH_DENIED");
  const config = parseFormalXhsProductionPilotConfig(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
  if (Date.now() >= Date.parse(FORMAL_XHS_PRODUCTION_PILOT_EXPIRES_AT_UTC)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_AUTHORIZATION_EXPIRED");
  if (!app.isPackaged || !samePath(process.execPath, config.executablePath) || !samePath(app.getAppPath(), config.appAsarPath)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_PACKAGE_PATH_MISMATCH");
  if (hashFile(process.execPath) !== config.executableSha256 || hashFile(app.getAppPath()) !== config.appAsarSha256) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_PACKAGE_HASH_MISMATCH");
  const receiptDirectory = join(dataDirectory, "production-pilot-evidence", config.pilotId);
  mkdirSync(receiptDirectory, { recursive: true });
  const assertActive = (): void => {
    if (Date.now() >= Date.parse(config.expiresAtUtc)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_AUTHORIZATION_EXPIRED");
  };
  const ensureRepository = (repository: AppRepository): void => {
    assertActive();
    repository.ensureProductionPilotAuthorization({ pilotId: config.pilotId, expiresAt: config.expiresAtUtc, maxFinalSubmissions: config.maxFinalSubmissions });
  };
  const productionReceiptFactory = (page: Page, meta: XhsReceiptMeta): XhsProductionReceiptObserver => {
    assertActive();
    if (meta.buildSha256.toLowerCase() !== config.appAsarSha256 || !meta.accountId || !meta.creatorId || !meta.jobId || !meta.snapshotId || !meta.contextId || !meta.pageId || !/^[0-9a-f-]{36}$/iu.test(meta.intentId)) {
      throw new Error("FORMAL_XHS_PRODUCTION_PILOT_RECEIPT_BINDING_MISMATCH");
    }
    const receiptPath = join(receiptDirectory, `${meta.intentId}.jsonl`);
    const persist = (event: XhsReceiptEvent): void => {
      const descriptor = openSync(receiptPath, "a", 0o600);
      try { writeSync(descriptor, `${JSON.stringify(event)}\n`); fsyncSync(descriptor); }
      finally { closeSync(descriptor); }
    };
    return new ReceiptObserver(page, meta, persist);
  };
  const createGuard = (repository: AppRepository): ProductionPilotGuard => ({
    buildSha256: config.appAsarSha256,
    registerPrepared: ({ job, snapshot, recordId }) => {
      assertActive();
      repository.registerProductionPilotPreparedBinding({ pilotId: config.pilotId, jobId: job.id, snapshotId: snapshot.id, publishRecordId: recordId });
    },
    claimFinalSubmit: ({ job, intentId, snapshot, subject }) => {
      assertActive();
      return repository.claimProductionPilotFinalSubmit({ pilotId: config.pilotId, buildSha256: config.appAsarSha256, jobId: job.id, intentId, snapshotId: snapshot.id, subject });
    },
    markUnknown: ({ intentId, errorCode }) => repository.markProductionPilotSubmissionUnknown({ pilotId: config.pilotId, intentId, errorCode })
  });
  return { config, dataDirectory, buildSha256: config.appAsarSha256, productionReceiptFactory, ensureRepository, createGuard, assertIpc: (channel, payload, repository) => assertPilotIpc(config, channel, payload, repository) };
}

const readOnlyChannels = new Set([
  "accounts:list", "accounts:overview", "accounts:credential-status", "articles:get", "articles:list", "articles:page", "articles:history", "articles:variants", "brands:list", "image-assets:list", "jobs:list", "jobs:preview", "platforms:list", "platforms:profiles", "platforms:content-rules", "quality:items", "quality:status", "quality:history", "dashboard:get", "logs:list", "notifications:list", "settings:get"
]);
const accountChannels = new Set(["accounts:begin-login", "accounts:complete-login", "accounts:cancel-login", "accounts:refresh-login", "accounts:check-login", "accounts:open-backend", "accounts:session-heartbeat", "accounts:pre-submit-gate"]);
const permittedJobChannels = new Set(["jobs:preview", "jobs:confirm", "jobs:run", "jobs:cancel", "jobs:reconcile-browser"]);

/** Only freshly registered ordinary XHS Jobs can mutate the formal pilot. */
function assertPilotIpc(config: FormalXhsProductionPilotConfig, channel: string, payload: unknown, repository: AppRepository): void {
  if (readOnlyChannels.has(channel)) return;
  const input = request(payload);
  if (accountChannels.has(channel)) {
    const accountId = text(input.accountId);
    const platformKey = text(input.platformKey);
    if (platformKey !== "xiaohongshu" || !accountId || !repository.listAccounts().some((account) => account.id === accountId && account.platformKey === platformKey && account.enabled && !account.archivedAt)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_ACCOUNT_SCOPE_DENIED");
    return;
  }
  if (channel === "articles:prepare-publish") {
    const account = repository.listAccounts().find((candidate) => candidate.platformKey === "xiaohongshu" && candidate.enabled && !candidate.archivedAt && (candidate.platformAccountId ?? candidate.id) === text(input.platformAccountId));
    if (!account || !repository.getArticle(text(input.articleId)) || !repository.getImageAsset(text(input.selectedImageAssetId)) || text(input.platformKey) !== "xiaohongshu" || text(input.imageSelectionMode) !== "manual" || text(input.finalPublishMode) !== "CONFIRM_BEFORE_PUBLISH" || input.articleVariantId) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_PREPARE_SCOPE_DENIED");
    return;
  }
  if (permittedJobChannels.has(channel)) {
    const jobId = text(input.id);
    const job = repository.getJob(jobId);
    const authorization = repository.getProductionPilotAuthorization(config.pilotId);
    const binding = job ? repository.getProductionPilotPreparedBinding(config.pilotId, job.id) : null;
    if (!job || !authorization || job.platformKey !== "xiaohongshu" || job.createdAt < authorization.createdAt || !job.contentBindingId || !binding || binding.snapshotId !== job.contentBindingId || binding.accountId !== job.accountId || binding.articleId !== job.articleId) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_JOB_SCOPE_DENIED");
    return;
  }
  throw new Error("FORMAL_XHS_PRODUCTION_PILOT_CHANNEL_DENIED");
}
