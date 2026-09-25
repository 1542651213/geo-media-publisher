import type { AppRepository } from "@publisher/db";
import type { ToutiaoCredentialBundleService } from "@publisher/adapters-toutiao/article-api";
import { CapturedRequestReplay, nodeFetchReplayTransport, normalizeToutiaoArticleContent, type AbortedPublishRequest, type ReplayTransport } from "@publisher/adapters-toutiao/article-api";
import { GlobalPublishExecutionGate } from "@publisher/publisher";
import type { AccountContext } from "@publisher/domain";
import type { ToutiaoArticleBrowserAdapter } from "@publisher/adapters-toutiao/browser";
import type { ToutiaoCookie } from "@publisher/adapters-toutiao/article-api";

export const TOUTIAO_CAPTURED_TRANSPORT_ID = "toutiao-browser-captured-request-v1";

export interface CapturedOneShotResult {
  readonly state: "BLOCKED_PRE_SUBMIT" | "SUBMIT_ACCEPTED" | "NEEDS_RECONCILIATION";
  readonly reasonCode: string;
  readonly jobId: string;
  readonly intentId: string | null;
  readonly recordId: string | null;
  readonly submissionAttemptId: string | null;
  readonly requestHash: string;
  readonly httpStatus: number | null;
  readonly platformCode: string | number | null;
  readonly remoteId: string | null;
}

function blocked(jobId: string, requestHash: string, reasonCode: string, intentId: string | null = null, recordId: string | null = null): CapturedOneShotResult {
  return { state: "BLOCKED_PRE_SUBMIT", reasonCode, jobId, intentId, recordId,
    submissionAttemptId: null, requestHash, httpStatus: null, platformCode: null, remoteId: null };
}

function preparedTextMatchesArticle(canonicalJson: string | null, article: { id: string; title: string; body: string }, accountId: string): boolean {
  if (!canonicalJson) return false;
  try {
    const payload: unknown = JSON.parse(canonicalJson);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const value = payload as Record<string, unknown>;
    const text = normalizeToutiaoArticleContent(article.body);
    return value.articleId === article.id && value.accountId === accountId && value.title === article.title.trim().normalize("NFC")
      && value.plainText === text.plainText && value.coverMode === "none"
      && value.remoteScheduledAt === null && Array.isArray(value.assetSnapshots) && value.assetSnapshots.length === 0
      && Array.isArray(value.coverUploadKeys) && value.coverUploadKeys.length === 0
      && Array.isArray(value.bodyImageUploadKeys) && value.bodyImageUploadKeys.length === 0
      && text.imageReferences.length === 0;
  } catch { return false; }
}

/** Experimental Main-only path. It requires a pre-existing frozen Job and R1-C credential bundle. */
export class ToutiaoCapturedRequestOneShot {
  private readonly replay: CapturedRequestReplay;

  constructor(
    private readonly repository: AppRepository,
    private readonly credentials: ToutiaoCredentialBundleService,
    transport: ReplayTransport = nodeFetchReplayTransport,
    private readonly gate: Pick<GlobalPublishExecutionGate, "run"> = GlobalPublishExecutionGate.forRepository(repository),
    private readonly sessionBound: (accountId: string) => boolean = () => false,
    private readonly currentCookies: (accountId: string) => Promise<readonly ToutiaoCookie[]> = async () => []
  ) { this.replay = new CapturedRequestReplay(transport); }

  /** Consume a separate task-wide disk claim before the single guarded editor click. */
  async captureAndSubmit(jobId: string, ctx: AccountContext,
    adapter: Pick<ToutiaoArticleBrowserAdapter, "captureAbortedPublishRequest">,
    claimCapture: () => void): Promise<CapturedOneShotResult> {
    const job = this.repository.getJob(jobId);
    const article = job ? this.repository.getArticle(job.articleId) : null;
    const metadata = job ? this.repository.getToutiaoCredentialMetadata(job.accountId) : null;
    const preparation = job ? this.repository.getToutiaoArticlePreparation(jobId) : null;
    if (!job || job.platformKey !== "toutiao" || job.accountId !== ctx.accountId || !article
      || job.status !== "AwaitingConfirmation" || job.finalPublishMode !== "CONFIRM_BEFORE_PUBLISH"
      || this.repository.getSubmissionIntentByJob(jobId) || this.repository.getPublishRecordByJob(jobId)
      || !preparedTextMatchesArticle(preparation?.canonicalPayloadJson ?? null, article, ctx.accountId)
      || !metadata || metadata.credentialState !== "VALID" || !metadata.validatedAt)
      return blocked(jobId, "", "TOUTIAO_CAPTURE_PRECONDITION_FAILED");
    if (!this.sessionBound(ctx.accountId)) return blocked(jobId, "", "TOUTIAO_RUNTIME_SESSION_UNBOUND");
    try { this.credentials.assertBound(ctx.accountId, metadata.bundleVersion, metadata.loginGeneration, "pre_submit"); }
    catch { return blocked(jobId, "", "TOUTIAO_CREDENTIAL_BUNDLE_MISMATCH"); }
    try { claimCapture(); }
    catch { return blocked(jobId, "", "TOUTIAO_ONE_SHOT_CAPTURE_ALREADY_CLAIMED"); }
    let captured: AbortedPublishRequest | null = null;
    try {
      const result = await adapter.captureAbortedPublishRequest(ctx, { title: article.title, body: article.body },
        (request) => { if (captured === null) captured = request; });
      const guard = result.guard;
      if (!captured || result.status !== "REQUEST_CAPTURED" || result.remoteAuthState !== "VALID"
        || !result.contentFilled || !result.buttonTriggered || guard.guardAbortFailed
        || guard.publishAttemptCount !== 1 || guard.blockedPublishCount !== 1 || guard.publishSentCount !== 0
        || guard.draftSentCount !== 0 || guard.uploadSentCount !== 0 || !this.sessionBound(ctx.accountId))
        return blocked(jobId, "", "TOUTIAO_BROWSER_CAPTURE_NOT_SAFE");
      return this.submit(jobId, captured);
    } catch { return blocked(jobId, "", "TOUTIAO_BROWSER_CAPTURE_FAILED"); }
  }

  async submit(jobId: string, captured: AbortedPublishRequest): Promise<CapturedOneShotResult> {
    const job = this.repository.getJob(jobId);
    const article = job ? this.repository.getArticle(job.articleId) : null;
    const account = job ? this.repository.listAccounts().find((item) => item.id === job.accountId) : null;
    const preparation = job ? this.repository.getToutiaoArticlePreparation(jobId) : null;
    const metadata = account ? this.repository.getToutiaoCredentialMetadata(account.id) : null;
    if (!job || job.platformKey !== "toutiao" || (job.contentKind ?? "article") !== "article"
      || job.status !== "AwaitingConfirmation" || job.finalPublishMode !== "CONFIRM_BEFORE_PUBLISH"
      || !article || !account || account.loginStatus !== "logged_in" || !account.enabled
      || !preparation?.payloadHash || !preparation.contentBindingHash || this.repository.getSubmissionIntentByJob(jobId)
      || this.repository.getPublishRecordByJob(jobId)) return blocked(jobId, captured.requestHash, "TOUTIAO_PREPARATION_NOT_READY");
    if (!preparedTextMatchesArticle(preparation.canonicalPayloadJson, article, account.id))
      return blocked(jobId, captured.requestHash, "TOUTIAO_CONTENT_BINDING_MISMATCH");
    if (!metadata || metadata.credentialState !== "VALID" || !metadata.validatedAt)
      return blocked(jobId, captured.requestHash, "TOUTIAO_CREDENTIAL_BUNDLE_MISSING");
    if (!this.sessionBound(account.id)) return blocked(jobId, captured.requestHash, "TOUTIAO_RUNTIME_SESSION_UNBOUND");
    const authValidatedAt = metadata.validatedAt;
    const contentBindingHash = preparation.contentBindingHash;
    try {
      const bundle = this.credentials.assertBound(account.id, metadata.bundleVersion, metadata.loginGeneration, "pre_submit");
      captured.forReplay(Date.now());
      captured.assertArticleBinding(article);
      captured.assertCookieBinding(bundle.cookieMaterial);
      captured.assertCookieBinding(await this.currentCookies(account.id));
    } catch { return blocked(jobId, captured.requestHash, "TOUTIAO_CAPTURE_BINDING_FAILED"); }

    return this.gate.run(jobId, async () => {
      let intentId: string | null = null;
      let recordId: string | null = null;
      let submissionAttemptId: string | null = null;
      try {
        const current = this.repository.getToutiaoCredentialMetadata(account.id);
        const currentAccount = this.repository.listAccounts().find((item) => item.id === account.id);
        if (!current || current.bundleVersion !== metadata.bundleVersion || current.loginGeneration !== metadata.loginGeneration
          || current.credentialFingerprint !== metadata.credentialFingerprint || !currentAccount?.enabled
          || currentAccount.loginStatus !== "logged_in" || currentAccount.externalAccountId !== account.externalAccountId
          || !this.sessionBound(account.id)) throw new Error("CREDENTIAL_OR_SESSION_CHANGED");
        const bundle = this.credentials.assertBound(account.id, metadata.bundleVersion, metadata.loginGeneration, "signed_or_submitting");
        captured.forReplay(Date.now());
        captured.assertArticleBinding(article);
        captured.assertCookieBinding(bundle.cookieMaterial);
        captured.assertCookieBinding(await this.currentCookies(account.id));

        this.repository.confirmJob(jobId);
        this.repository.claimJob(jobId);
        const preparedIntentId = this.repository.prepareSubmissionIntent(jobId).id;
        intentId = preparedIntentId;
        this.repository.bindToutiaoArticlePreparationToIntent(jobId, preparedIntentId);
        this.repository.bindToutiaoFinalPayloadForFutureSubmit({
          jobId, intentId: preparedIntentId, accountId: account.id, contentBindingHash,
          finalPayloadHash: captured.finalPayloadHash, credentialBundleVersion: metadata.bundleVersion,
          loginGeneration: metadata.loginGeneration, signerVersion: TOUTIAO_CAPTURED_TRANSPORT_ID,
          signerInputHash: captured.requestHash, signatureGeneratedAt: captured.evidence.capturedAt,
          authValidatedAt
        }, this.credentials);
        this.repository.assertToutiaoFutureSubmitReady(jobId, this.credentials);
        const record = this.repository.insertPublishRecord({
          jobId, accountId: account.id, platformAccountId: account.platformAccountId, platformKey: "toutiao",
          articleId: article.id, publishedUrl: null, publishedExternalId: null, success: false,
          response: { transportId: TOUTIAO_CAPTURED_TRANSPORT_ID, requestHash: captured.requestHash,
            finalPayloadHash: captured.finalPayloadHash,
            bodyHash: captured.evidence.bodyHash, queryKeyNames: captured.evidence.queryKeyNames,
            headerKeyNames: captured.evidence.headerKeyNames, capturedAt: captured.evidence.capturedAt },
          status: "Prepared", publishMode: "ASSISTED", automationType: "API", operator: "desktop-user",
          verificationStatus: "WaitingUser", titleFilled: true, bodyFilled: true
        });
        recordId = record.id;
        captured.forReplay(Date.now());
        this.credentials.assertBound(account.id, metadata.bundleVersion, metadata.loginGeneration, "signed_or_submitting");
        captured.assertCookieBinding(await this.currentCookies(account.id));
        if (!this.sessionBound(account.id)) throw new Error("SESSION_CHANGED");
        const claim = this.repository.claimFinalSubmitAttempt(intentId, {
          payloadHash: captured.requestHash, adapterId: TOUTIAO_CAPTURED_TRANSPORT_ID,
          credentialVersion: `${metadata.bundleVersion}:${metadata.loginGeneration}`
        });
        submissionAttemptId = claim.submissionAttemptId;
      } catch {
        const intent = this.repository.getSubmissionIntentByJob(jobId);
        if (intent && intent.finalSubmitCount >= 1) {
          this.repository.markSubmissionIntentUncertain(intent.id, "SUBMISSION_UNCERTAIN");
          return { state: "NEEDS_RECONCILIATION", reasonCode: "SUBMISSION_UNCERTAIN", jobId,
            intentId: intent.id, recordId, submissionAttemptId: intent.submissionAttemptId,
            requestHash: captured.requestHash, httpStatus: null, platformCode: null, remoteId: null };
        }
        if (intent?.state === "Prepared") this.repository.resetSubmissionIntentForUserAction(intent.id, "USER_ACTION_REQUIRED");
        else if (this.repository.getJob(jobId)?.status === "Preparing")
          this.repository.updateJobFailure(jobId, "NeedsUserAction", "USER_ACTION_REQUIRED", "Captured publish preflight failed", null);
        return blocked(jobId, captured.requestHash, "TOUTIAO_PRE_SUBMIT_GATE_FAILED", intentId, recordId);
      }

      // The durable count is already 1. Every outcome below is terminal for this transport attempt.
      try {
        const response = await this.replay.sendOnce(captured, {
          submissionAttemptId: submissionAttemptId!, claimedRequestHash: captured.requestHash, claimedAt: Date.now()
        });
        if (response.status === 200 && (response.platformCode === 0 || response.platformCode === "0")) {
          this.repository.markSubmissionIntentSubmitted(intentId!, response.remoteId ?? null, "SUBMIT_ACCEPTED");
          this.repository.updatePublishRecord(recordId!, { status: "Publishing", success: false,
            response: { requestHash: captured.requestHash, finalPayloadHash: captured.finalPayloadHash,
              bodyHash: captured.evidence.bodyHash,
              httpStatus: response.status, platformCode: response.platformCode,
              responseShape: response.responseShape, remoteId: response.remoteId ?? null,
              remoteState: "SUBMIT_ACCEPTED" }, verificationStatus: "WaitingUser" });
          this.repository.markJobPublishing(jobId, recordId!);
          return { state: "SUBMIT_ACCEPTED", reasonCode: "CONFIRMATION_REQUIRED", jobId,
            intentId, recordId, submissionAttemptId, requestHash: captured.requestHash,
            httpStatus: response.status, platformCode: response.platformCode ?? null, remoteId: response.remoteId ?? null };
        }
        this.repository.markSubmissionIntentUncertain(intentId!, "REMOTE_RESPONSE_UNCERTAIN");
        this.repository.updatePublishRecord(recordId!, { status: "Submitted", success: false,
          response: { requestHash: captured.requestHash, finalPayloadHash: captured.finalPayloadHash, httpStatus: response.status,
            platformCode: response.platformCode ?? null, responseShape: response.responseShape,
            remoteState: "UNCERTAIN" }, verificationStatus: "WaitingUser" });
        return { state: "NEEDS_RECONCILIATION", reasonCode: "REMOTE_RESPONSE_UNCERTAIN", jobId,
          intentId, recordId, submissionAttemptId, requestHash: captured.requestHash,
          httpStatus: response.status, platformCode: response.platformCode ?? null, remoteId: response.remoteId ?? null };
      } catch {
        this.repository.markSubmissionIntentUncertain(intentId!, "TIMEOUT");
        this.repository.updatePublishRecord(recordId!, { status: "Submitted", success: false,
          response: { requestHash: captured.requestHash, finalPayloadHash: captured.finalPayloadHash,
            bodyHash: captured.evidence.bodyHash,
            remoteState: "UNCERTAIN", reasonCode: "TRANSPORT_RESPONSE_LOST" }, verificationStatus: "WaitingUser" });
        return { state: "NEEDS_RECONCILIATION", reasonCode: "TRANSPORT_RESPONSE_LOST", jobId,
          intentId, recordId, submissionAttemptId, requestHash: captured.requestHash,
          httpStatus: null, platformCode: null, remoteId: null };
      }
    });
  }
}
