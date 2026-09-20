import { app } from "electron";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { readFileSync as readPhysicalFileSync } from "node:original-fs";
import { join, win32 } from "node:path";
import type { Page } from "playwright-core";
import type { XhsProductionReceiptObserver, XhsReceiptEvent, XhsReceiptMeta } from "@publisher/adapters-xiaohongshu/browser";
import { XhsProductionReceiptObserver as ReceiptObserver } from "@publisher/adapters-xiaohongshu/browser";
import type { AppRepository, ProductionPilotOwnerVerification, ProductionPilotSlot } from "@publisher/db";
import type { ImageAsset } from "@publisher/domain";
import type { ProductionPilotGuard } from "@publisher/publisher";
import { parseFormalXhsProductionPilotConfig, readFormalXhsProductionPilotGate, type FormalXhsProductionPilotConfig } from "./formal-xhs-production-pilot-config";

const hashFile = (path: string): string => createHash("sha256").update(readPhysicalFileSync(path)).digest("hex").toLowerCase();
const samePath = (left: string, right: string): boolean => win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
const inside = (parent: string, child: string): boolean => {
  const relative = win32.relative(win32.resolve(parent), win32.resolve(child));
  return Boolean(relative) && !relative.startsWith("..\\") && relative !== ".." && !win32.isAbsolute(relative);
};
const request = (payload: unknown): Record<string, unknown> => typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const hashText = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export interface FormalXhsProductionPilotContext {
  config: FormalXhsProductionPilotConfig;
  dataDirectory: string;
  buildSha256: string;
  productionReceiptFactory: (page: Page, meta: XhsReceiptMeta) => XhsProductionReceiptObserver;
  ensureRepository(repository: AppRepository): void;
  createGuard(repository: AppRepository): ProductionPilotGuard;
  reconcileOwnerVerifiedPublished(repository: AppRepository, input: { jobId: string; intentId: string; ownerConfirmation: ProductionPilotOwnerVerification }): ProductionPilotSlot;
  assertIpc(channel: string, payload: unknown, repository: AppRepository): void;
  crossBrandImageBindingPermit(articleId: string, imageAssetId: string, repository: AppRepository): { articleId: string; imageAssetId: string } | null;
  crossBrandImageAssetsForArticle(articleId: string, brandId: string | undefined, repository: AppRepository): ImageAsset[];
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
  if (!config.xhsAccountId) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_ACCOUNT_BINDING_REQUIRED");
  if (!app.isPackaged || !samePath(process.execPath, config.executablePath) || !samePath(app.getAppPath(), config.appAsarPath)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_PACKAGE_PATH_MISMATCH");
  if (hashFile(process.execPath) !== config.executableSha256 || hashFile(app.getAppPath()) !== config.appAsarSha256) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_PACKAGE_HASH_MISMATCH");
  const receiptDirectory = join(dataDirectory, "production-pilot-evidence", config.pilotId);
  mkdirSync(receiptDirectory, { recursive: true });
  const assertActive = (): void => {
    if (config.authorizationMode !== "UNTIL_REVOKED" && Date.now() >= Date.parse(config.expiresAtUtc)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_AUTHORIZATION_EXPIRED");
  };
  const ensureRepository = (repository: AppRepository): void => {
    repository.ensureProductionPilotAuthorization({ pilotId: config.pilotId, expiresAt: config.expiresAtUtc, maxFinalSubmissions: config.maxFinalSubmissions });
  };
  const productionReceiptFactory = (page: Page, meta: XhsReceiptMeta): XhsProductionReceiptObserver => {
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
      repository.registerProductionPilotPreparedBinding({ pilotId: config.pilotId, jobId: job.id, snapshotId: snapshot.id, publishRecordId: recordId });
    },
    claimFinalSubmit: ({ job, intentId, snapshot, subject }) => {
      assertActive();
      return repository.claimProductionPilotFinalSubmit({ pilotId: config.pilotId, buildSha256: config.appAsarSha256, jobId: job.id, intentId, snapshotId: snapshot.id, subject });
    },
    recordAccepted: ({ job, intentId, externalId, publishedUrl, receiptSha256 }) => {
      const slot = repository.recordProductionPilotAccepted({ pilotId: config.pilotId, intentId, externalId, ...(publishedUrl ? { publishedUrl } : {}), receiptSha256 });
      const accepted = repository.getJob(job.id);
      if (slot.state !== "Accepted" || !accepted || accepted.status !== "Publishing") throw new Error("PRODUCTION_PILOT_ACCEPTANCE_TRANSITION_REJECTED");
      return accepted;
    },
    markUnknown: ({ intentId, errorCode }) => repository.markProductionPilotSubmissionUnknown({ pilotId: config.pilotId, intentId, errorCode })
  });
  const reconcileOwnerVerifiedPublished = (repository: AppRepository, input: { jobId: string; intentId: string; ownerConfirmation: ProductionPilotOwnerVerification }): ProductionPilotSlot => {
    if (config.authorizationMode !== "UNTIL_REVOKED" && !config.expiresAtUtc) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_AUTHORIZATION_MISSING");
    return repository.recordProductionPilotOwnerVerifiedPublished({ pilotId: config.pilotId, jobId: input.jobId, intentId: input.intentId, ownerConfirmation: input.ownerConfirmation });
  };
  return {
    config,
    dataDirectory,
    buildSha256: config.appAsarSha256,
    productionReceiptFactory,
    ensureRepository,
    createGuard,
    reconcileOwnerVerifiedPublished,
    assertIpc: (channel, payload, repository) => assertFormalXhsProductionPilotIpc(config, channel, payload, repository),
    crossBrandImageBindingPermit: (articleId, imageAssetId, repository) => isAuthorizedCrossBrandImageBinding(config, repository, articleId, imageAssetId) ? { articleId, imageAssetId } : null,
    crossBrandImageAssetsForArticle: (articleId, brandId, repository) => {
      const authorization = config.crossBrandImageBindingAuthorization;
      if (!authorization || (authorization.articleId && authorization.articleId !== articleId) || (brandId !== undefined && brandId !== authorization.articleBrandId)) return [];
      const image = repository.getImageAsset(authorization.imageAssetId);
      return isAuthorizedCrossBrandImageBinding(config, repository, articleId, authorization.imageAssetId) && image ? [image] : [];
    }
  };
}

/** This permit is only issued from the formal pilot's hash-pinned local control file. */
export function isAuthorizedCrossBrandImageBinding(config: FormalXhsProductionPilotConfig, repository: AppRepository, articleId: string, imageAssetId: string): boolean {
  const authorization = config.crossBrandImageBindingAuthorization;
  if (!authorization || authorization.imageAssetId !== imageAssetId || (authorization.articleId && authorization.articleId !== articleId)) return false;
  const article = repository.getArticle(articleId);
  const image = repository.getImageAsset(imageAssetId);
  if (!article || !image || !image.enabled || article.brandId !== authorization.articleBrandId || image.brandId !== authorization.imageBrandId || article.brandId === image.brandId || (authorization.articleTitleSha256 && hashText(article.title) !== authorization.articleTitleSha256) || (authorization.articleBodySha256 && hashText(article.body) !== authorization.articleBodySha256)) return false;
  try { return hashFile(image.filePath) === authorization.imageSha256; }
  catch { return false; }
}

const accountChannels = new Set(["accounts:begin-login", "accounts:complete-login", "accounts:cancel-login", "accounts:refresh-login", "accounts:check-login", "accounts:open-backend", "accounts:session-heartbeat", "accounts:pre-submit-gate"]);
const archivedAccountRecoveryChannels = new Set(["accounts:begin-login", "accounts:complete-login", "accounts:cancel-login"]);
const xhsJobMutationChannels = new Set(["jobs:cancel", "jobs:confirm", "jobs:run", "jobs:reconcile", "jobs:reconcile-browser", "jobs:reconcile-not-submitted", "jobs:retry", "jobs:owner-verify-published"]);
const blockedPublicationEntryChannels = new Set(["jobs:recover", "plans:generate-jobs"]);
const blockedSelfTestChannels = new Set([
  "platform-self-test:run-safe", "platform-self-test:run-post-upload-discovery", "platform-self-test:run-publish-flow-exploration", "platform-self-test:continue", "platform-self-test:run-level", "platform-self-test:request-publish", "platform-self-test:confirm-publish", "platform-self-test:request-one-shot-publish", "platform-self-test:prepare-one-shot-prepublish", "platform-self-test:confirm-one-shot-publish", "platform-self-test:reconcile-failed-one-shot-confirmation"
]);

function isBoundXhsAccount(config: FormalXhsProductionPilotConfig, repository: AppRepository, accountId: string): boolean {
  return Boolean(accountId) && (!config.xhsAccountId || config.xhsAccountId === accountId) && repository.listAccounts().some((account) => account.id === accountId && account.platformKey === "xiaohongshu" && account.enabled && !account.archivedAt);
}

/**
 * An account card created only to reconnect the configured Creator cannot
 * publish anything.  It may own the visible login session only while the
 * configured account is uniquely archived and the candidate has no durable
 * publication reference.  complete-login still requires a page-scoped Creator
 * proof before restoring the archived account or persisting any identity.
 */
function isArchivedConfiguredXhsRecoveryCandidate(config: FormalXhsProductionPilotConfig, repository: AppRepository, accountId: string): boolean {
  if (!config.xhsAccountId || config.xhsAccountId === accountId) return false;
  const configured = repository.getAccountById(config.xhsAccountId, "xiaohongshu");
  const candidate = repository.getAccountById(accountId, "xiaohongshu");
  if (!configured || !candidate || !configured.archivedAt || !configured.externalAccountId || candidate.archivedAt || !candidate.enabled || candidate.externalAccountId) return false;
  return !repository.listJobs().some((job) => job.accountId === accountId);
}

/**
 * Formal mode is a narrow XHS publication boundary, not an application-wide
 * IPC firewall. Article, media, and other normal-management channels keep
 * their regular authorization and Repository validation. Only XHS lifecycle
 * transitions and legacy self-test publication entry points are scoped here.
 */
export function assertFormalXhsProductionPilotIpc(config: FormalXhsProductionPilotConfig, channel: string, payload: unknown, repository: AppRepository): void {
  const input = request(payload);
  if (accountChannels.has(channel)) {
    const accountId = text(input.accountId);
    const platformKey = text(input.platformKey);
    if (platformKey !== "xiaohongshu") return;
    if (!isBoundXhsAccount(config, repository, accountId)
      && !(archivedAccountRecoveryChannels.has(channel) && isArchivedConfiguredXhsRecoveryCandidate(config, repository, accountId))) {
      throw new Error("FORMAL_XHS_PRODUCTION_PILOT_ACCOUNT_SCOPE_DENIED");
    }
    return;
  }
  if (channel === "articles:prepare-publish") {
    if (text(input.platformKey) !== "xiaohongshu") return;
    const account = repository.listAccounts().find((candidate) => candidate.platformKey === "xiaohongshu" && candidate.enabled && !candidate.archivedAt && (candidate.platformAccountId ?? candidate.id) === text(input.platformAccountId));
    const articleId = text(input.articleId);
    const imageAssetId = text(input.selectedImageAssetId);
    const article = repository.getArticle(articleId);
    const image = repository.getImageAsset(imageAssetId);
    const compatibleBrand = Boolean(article && image && (!image.brandId || image.brandId === article.brandId || isAuthorizedCrossBrandImageBinding(config, repository, articleId, imageAssetId)));
    if (!account || !isBoundXhsAccount(config, repository, account.id) || !article || !image || !compatibleBrand || text(input.imageSelectionMode) !== "manual" || text(input.finalPublishMode) !== "CONFIRM_BEFORE_PUBLISH" || input.articleVariantId) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_PREPARE_SCOPE_DENIED");
    return;
  }
  if (xhsJobMutationChannels.has(channel)) {
    const jobId = text(input.id);
    const job = repository.getJob(jobId);
    if (!job || job.platformKey !== "xiaohongshu") return;
    const authorization = repository.getProductionPilotAuthorization(config.pilotId);
    const binding = repository.getProductionPilotPreparedBinding(config.pilotId, job.id);
    if (!authorization || job.createdAt < authorization.createdAt || !job.contentBindingId || !binding || binding.snapshotId !== job.contentBindingId || binding.accountId !== job.accountId || binding.articleId !== job.articleId || !isBoundXhsAccount(config, repository, job.accountId)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_JOB_SCOPE_DENIED");
    if (channel === "jobs:cancel" && repository.getSubmissionBarrier(job.id)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_JOB_SCOPE_DENIED");
    return;
  }
  if (blockedPublicationEntryChannels.has(channel) || blockedSelfTestChannels.has(channel)) throw new Error("FORMAL_XHS_PRODUCTION_PILOT_CHANNEL_DENIED");
}
