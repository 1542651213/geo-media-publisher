import { createHash, randomUUID } from "node:crypto";
import { defaultCapabilities, type AutomationAdapter, type AutomationPrepareResult, type BrowserPublishAttemptContext, type BrowserPublishReconciliationInput, type BrowserPublishReconciliationResult } from "@publisher/adapters-core";
import type { AccountContext, AdapterManifest, PublishArticleInput, PublishResult, PublishStatusResult, XhsContextIdentityAttestation } from "@publisher/domain";
import { assertPilotEndpoint, pilotRequest, type PilotEndpoint, type PilotPayload, type PilotReceipt } from "./loopback-platform";

interface Lease { jobId: string; accountId: string; snapshotId: string; contextId: string; pageId: string; creatorId: string; alive: boolean; payload: PilotPayload }

/** External platform/identity substitution only. Persistence, IPC and Publisher stay real. */
export class SyntheticXhsAdapter implements AutomationAdapter {
  readonly platformKey = "xiaohongshu";
  readonly automationType = "BrowserAutomation";
  readonly supportsBoundImageBuffers = true;
  readonly manifest: AdapterManifest = { platformKey: "xiaohongshu", displayName: "小红书（离线合成边界）", category: "测试", version: "1.0.0", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "Stable", researchStatus: "verified", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "http://127.0.0.1", lastVerifiedAt: "2026-09-17", credentialSchema: [], officialSources: ["http://127.0.0.1/synthetic-not-official-platform-evidence"] };
  readonly leases = new Map<string, Lease>();
  readonly events: Array<{ kind: string; jobId: string; accountId: string }> = [];
  readonly unrelatedWindows = new Set(["synthetic-user-window"]);
  mode: "ready" | "verification" | "wrong-identity" | "invalid-content" = "ready";
  constructor(readonly endpoint: PilotEndpoint) { assertPilotEndpoint(endpoint); }
  getCapabilities() { return { ...defaultCapabilities, article: true, imagePost: true, video: false, maxImageCount: 1, maxTitleLength: 100, scheduledPublish: false }; }
  getCredentialSchema() { return []; }
  async checkLogin(_ctx: AccountContext) { return this.mode === "verification" ? "needs_user_action" as const : "logged_in" as const; }
  async beginLogin(_ctx: AccountContext) { return { sessionId: "synthetic", requiresUserAction: true, message: "离线合成登录边界" }; }
  async connectAccount(ctx: AccountContext) { return this.beginLogin(ctx); }
  isConnectionPending(_ctx: AccountContext) { return false; }
  async completeConnection(ctx: AccountContext) { return this.checkLogin(ctx); }
  async checkSession(ctx: AccountContext) { return this.checkLogin(ctx); }
  async openBackend(_ctx: AccountContext) { return { opened: true, backendUrl: this.endpoint.origin, sessionIdHash: "synthetic" }; }
  async logout(ctx: AccountContext) { for (const lease of this.leases.values()) if (lease.accountId === ctx.accountId) lease.alive = false; }
  async publishArticle(_ctx: AccountContext, _input: PublishArticleInput): Promise<PublishResult> { throw new Error("SYNTHETIC_FINAL_SUBMIT_GUARD_REQUIRED"); }
  async validateArticle(input: PublishArticleInput) { const errors = this.mode === "invalid-content" || input.boundImages?.length !== 1 ? ["SYNTHETIC_RULE_REJECTED"] : []; return { valid: errors.length === 0, errors, warnings: ["Synthetic test rule, not an official platform limit"] }; }

  private jobId(ctx: AccountContext): string { const id = ctx.settings.publishJobId; if (typeof id !== "string" || !id) throw new Error("SYNTHETIC_JOB_BINDING_REQUIRED"); return id; }
  private lease(ctx: AccountContext, input?: PublishArticleInput): Lease {
    const lease = this.leases.get(this.jobId(ctx));
    if (!lease?.alive || lease.accountId !== ctx.accountId || (input && lease.snapshotId !== input.contentSnapshotId)) throw new Error("SYNTHETIC_PREPARED_PAGE_DEAD_OR_WRONG_OWNER");
    if (input && (lease.payload.title !== input.title || lease.payload.body !== input.body || lease.payload.imageSha256.toLowerCase() !== input.boundImages?.[0]?.sha256.toLowerCase())) throw new Error("SYNTHETIC_READBACK_CHANGED");
    if (this.mode === "wrong-identity") throw new Error("SYNTHETIC_IDENTITY_MISMATCH");
    return lease;
  }
  subject(ctx: AccountContext): XhsContextIdentityAttestation {
    const lease = this.lease(ctx);
    return { accountId: ctx.accountId, platformKey: "xiaohongshu", expectedExternalCreatorId: lease.creatorId, observedExternalCreatorId: lease.creatorId, externalAccountId: lease.creatorId, browserSessionIdentity: `synthetic-session-${ctx.accountId}`, browserContextIdentity: lease.contextId, sourcePageIdentity: lease.pageId, sourceOrigin: "https://creator.xiaohongshu.com", sourcePathname: "/publish/publish", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), verified: true };
  }
  async preparePublish(ctx: AccountContext, input: PublishArticleInput): Promise<AutomationPrepareResult> {
    const jobId = this.jobId(ctx);
    const creatorId = ctx.settings.expectedExternalCreatorId;
    if (!input.contentSnapshotId || typeof creatorId !== "string" || !creatorId || this.mode === "wrong-identity") throw new Error("SYNTHETIC_IDENTITY_OR_SNAPSHOT_REQUIRED");
    if (this.mode === "verification") return { prepared: false, requiresUserAction: true, message: "需要正常验证", response: { synthetic: true } };
    const image = input.boundImages?.[0];
    if (!image || input.boundImages?.length !== 1 || createHash("sha256").update(image.buffer).digest("hex") !== image.sha256.toLowerCase()) throw new Error("SYNTHETIC_BOUND_IMAGE_INVALID");
    const payload: PilotPayload = { accountId: ctx.accountId, jobId, articleId: input.articleId, snapshotId: input.contentSnapshotId, title: input.title, body: input.body, imageBase64: Buffer.from(image.buffer).toString("base64"), imageSha256: image.sha256.toLowerCase() };
    await pilotRequest(this.endpoint, "/upload", payload);
    const lease: Lease = { jobId, accountId: ctx.accountId, snapshotId: input.contentSnapshotId, creatorId, pageId: randomUUID(), contextId: randomUUID(), alive: true, payload };
    this.leases.set(jobId, lease); this.events.push({ kind: "PREPARED", jobId, accountId: ctx.accountId });
    return { prepared: true, requiresUserAction: false, message: "合成编辑器准备完成，等待明确确认", sessionIdHash: `synthetic-session-${ctx.accountId}`, editorOpenedAt: new Date().toISOString(), titleFilled: true, bodyFilled: true, response: { synthetic: true, imageUploaded: true, uploadedImageSha256: image.sha256, uploadedByteSha256: [image.sha256], titleReadbackValue: input.title, bodyReadbackValue: input.body, contentSnapshotId: input.contentSnapshotId, contextId: lease.contextId, pageId: lease.pageId } };
  }
  async validatePreparedSession(ctx: AccountContext, input: PublishArticleInput): Promise<void> { this.lease(ctx, input); }
  async releasePreparedSession(ctx: AccountContext): Promise<void> { const id = this.jobId(ctx); const lease = this.leases.get(id); if (lease?.accountId === ctx.accountId) { lease.alive = false; this.events.push({ kind: "RELEASED", jobId: id, accountId: ctx.accountId }); } }
  manualClose(jobId: string): void { const lease = this.leases.get(jobId); if (lease) { lease.alive = false; this.events.push({ kind: "MANUAL_CLOSE", jobId, accountId: lease.accountId }); } }
  async prepareFinalSubmit(ctx: AccountContext, input: PublishArticleInput) { this.lease(ctx, input); return { response: { synthetic: true, ready: true } }; }
  async finalSubmit(ctx: AccountContext, input: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const lease = this.lease(ctx, input);
    const guard = attempt.productionPublicationGuard;
    if (!guard || guard.accountId !== ctx.accountId || guard.contentSnapshotId !== input.contentSnapshotId || attempt.jobId !== lease.jobId) throw new Error("SYNTHETIC_PRODUCTION_GUARD_REQUIRED");
    guard.claim(this.subject(ctx));
    const value = await pilotRequest(this.endpoint, "/submit", { ...lease.payload, intentId: attempt.submissionIntentId });
    const receipt = value as PilotReceipt;
    if (!receipt.externalId || receipt.intentId !== attempt.submissionIntentId || receipt.snapshotId !== lease.snapshotId) throw new Error("SYNTHETIC_RECEIPT_MISMATCH");
    return { success: true, status: "published", externalId: receipt.externalId, publishedUrl: `${this.endpoint.origin}/published/${receipt.externalId}`, response: { synthetic: true, receipt, imageUploaded: true, submissionAccepted: true } };
  }
  private async receipts(): Promise<PilotReceipt[]> { const data = await pilotRequest(this.endpoint, "/receipts"); if (!Array.isArray(data)) throw new Error("SYNTHETIC_RECEIPTS_INVALID"); return data as PilotReceipt[]; }
  async verifyPublished(ctx: AccountContext, input: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const receipt = (await this.receipts()).find((item) => item.externalId === result.externalId && item.accountId === ctx.accountId && item.snapshotId === input.contentSnapshotId && item.articleId === input.articleId && item.title === input.title && item.body === input.body);
    return receipt ? { status: "published", externalId: receipt.externalId, publishedUrl: result.publishedUrl, response: { synthetic: true, receipt } } : { status: "publishing", response: { synthetic: true, uncertain: true } };
  }
  async verifyPublish(_ctx: AccountContext, _externalId?: string): Promise<PublishStatusResult> { return { status: "publishing", response: { synthetic: true, exactOperationRequired: true } }; }
  async reconcile(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult> {
    const receipt = (await this.receipts()).find((item) => item.accountId === ctx.accountId && item.jobId === input.jobId && item.intentId === input.submissionIntentId && item.snapshotId === input.contentSnapshotId && item.articleId === input.articleId && item.title === input.title && (!input.expectedExternalId || item.externalId === input.expectedExternalId) && item.acceptedAt >= input.windowStart && item.acceptedAt <= input.windowEnd);
    return { status: receipt ? "FOUND_PUBLISHED" : "STILL_UNCERTAIN", ...(receipt ? { externalId: receipt.externalId, publishedUrl: `${this.endpoint.origin}/published/${receipt.externalId}` } : {}), titleMatch: Boolean(receipt), accountMatch: Boolean(receipt), timeWindowMatch: Boolean(receipt), response: { synthetic: true, receipt: receipt ?? null }, message: receipt ? "精确合成操作回执" : "缺少本次操作回执" };
  }
}
