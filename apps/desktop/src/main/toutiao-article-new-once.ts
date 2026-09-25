import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Task-wide, fail-closed claim. A crash after this point does not authorize another request. */
export function claimControlledArticleNewCapture(dataDirectory: string): string {
  const directory = join(dataDirectory, "diagnostics");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "toutiao-mvp-3-5-article-new.claim");
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
      throw new Error("TOUTIAO_ARTICLE_NEW_ALREADY_CLAIMED");
    throw new Error("TOUTIAO_ARTICLE_NEW_CLAIM_FAILED");
  }
  try {
    writeSync(descriptor, JSON.stringify({ task: "TOUTIAO_MVP_3_5_CONTROLLED_ARTICLE_NEW_CAPTURE", claimedAt: new Date().toISOString() }));
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  return path;
}

/** A separate one-shot claim for the only permitted diagnostic publish-button click. */
export function claimControlledPublishRequestCapture(dataDirectory: string): string {
  const directory = join(dataDirectory, "diagnostics");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "toutiao-mvp-4-publish-request-capture.claim");
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
      throw new Error("TOUTIAO_PUBLISH_CAPTURE_ALREADY_CLAIMED");
    throw new Error("TOUTIAO_PUBLISH_CAPTURE_CLAIM_FAILED");
  }
  try {
    writeSync(descriptor, JSON.stringify({ task: "TOUTIAO_MVP_4_CONTROLLED_PUBLISH_REQUEST_CAPTURE", claimedAt: new Date().toISOString() }));
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  return path;
}

/** Task-wide claim before the MVP5 editor click. Never delete this file to obtain another attempt. */
export function claimMvp5OneShotCapture(dataDirectory: string, binding: {
  accountId: string; jobId: string; articleId: string; contentBindingHash: string
}): string {
  if (!binding.accountId || !binding.jobId || !binding.articleId
    || !/^[a-f0-9]{64}$/u.test(binding.contentBindingHash)) throw new Error("TOUTIAO_MVP5_BINDING_REQUIRED");
  const directory = join(dataDirectory, "diagnostics");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "toutiao-mvp-5-one-shot.claim");
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
      throw new Error("TOUTIAO_MVP5_ALREADY_CLAIMED");
    throw new Error("TOUTIAO_MVP5_CLAIM_FAILED");
  }
  try {
    writeSync(descriptor, JSON.stringify({ task: "TOUTIAO_MVP_5_CAPTURE_REPLAY_ONE_SHOT_REAL_PUBLISH",
      ...binding, claimedAt: new Date().toISOString() }));
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  return path;
}

export interface Mvp5CaptureTicketBinding {
  readonly accountId: string;
  readonly jobId: string;
  readonly articleId: string;
  readonly contentBindingHash: string;
}

/** Read-only audit. A locked ticket is never made reusable by this function. */
export function auditMvp5OneShotCapture(dataDirectory: string, expected: Mvp5CaptureTicketBinding,
  finalSubmitCount: number): { state: "MISSING" | "LOCKED" | "ID_MISMATCH" | "INVALID" | "SUBMIT_CONSUMED";
    publishQuotaConsumed: boolean } {
  const consumed = finalSubmitCount >= 1;
  const path = join(dataDirectory, "diagnostics", "toutiao-mvp-5-one-shot.claim");
  if (!existsSync(path)) return { state: consumed ? "SUBMIT_CONSUMED" : "MISSING", publishQuotaConsumed: consumed };
  let ticket: unknown;
  try { ticket = JSON.parse(readFileSync(path, "utf8")) as unknown; }
  catch { return { state: consumed ? "SUBMIT_CONSUMED" : "INVALID", publishQuotaConsumed: consumed }; }
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket))
    return { state: consumed ? "SUBMIT_CONSUMED" : "INVALID", publishQuotaConsumed: consumed };
  const value = ticket as Record<string, unknown>;
  if (value.task !== "TOUTIAO_MVP_5_CAPTURE_REPLAY_ONE_SHOT_REAL_PUBLISH"
    || typeof value.claimedAt !== "string" || !Number.isFinite(Date.parse(value.claimedAt)))
    return { state: consumed ? "SUBMIT_CONSUMED" : "INVALID", publishQuotaConsumed: consumed };
  const matches = value.accountId === expected.accountId && value.jobId === expected.jobId
    && value.articleId === expected.articleId && value.contentBindingHash === expected.contentBindingHash;
  return { state: consumed ? "SUBMIT_CONSUMED" : matches ? "LOCKED" : "ID_MISMATCH",
    publishQuotaConsumed: consumed };
}
