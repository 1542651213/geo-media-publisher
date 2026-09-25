import { createHash } from "node:crypto";
import { canonicalSerialize, normalizeToutiaoSettings, type ToutiaoArticleSettingsSnapshot } from "@publisher/domain";
import { hashToutiaoContentBinding } from "@publisher/domain/toutiao-hash";
import { normalizeToutiaoArticleContent, type ToutiaoArticlePreparedPayload } from "@publisher/adapters-toutiao/article-api";
import { isMvp5PlainTextArticle, type CaptureBindingReasonCode } from "./toutiao-captured-request-one-shot";

export interface Mvp5ReadinessInput {
  readonly expectedAccountId: string;
  readonly expectedCreatorId: string;
  readonly account: { readonly id: string; readonly platformKey: string; readonly externalAccountId?: string | null;
    readonly loginStatus: string; readonly enabled: boolean } | null;
  readonly job: { readonly id: string; readonly accountId: string; readonly articleId: string;
    readonly platformKey: string; readonly status: string } | null;
  readonly article: { readonly id: string; readonly brandId: string; readonly title: string; readonly body: string } | null;
  readonly preparation: { readonly canonicalPayloadJson: string | null; readonly payloadHash: string | null;
    readonly contentBindingHash: string | null; readonly settings: ToutiaoArticleSettingsSnapshot } | null;
  readonly metadata: { readonly bundleVersion: number; readonly loginGeneration: number;
    readonly credentialState: string; readonly validatedAt: string | null } | null;
  readonly bundle: { readonly version: number; readonly loginGeneration: number; readonly sessionIdentity: string;
    readonly state: string; readonly validatedAt: string | null } | null;
  readonly credentialReadError?: boolean;
  readonly runtime: { readonly accountId: string; readonly runtimeState: string; readonly sessionExists: boolean;
    readonly contextExists: boolean; readonly canonicalPageExists: boolean; readonly contextOwnsPage: boolean;
    readonly pageAlive: boolean; readonly pageHost: string | null; readonly contextDebugId: string | null };
  readonly remoteAuthState: "VALID" | "INVALID" | "UNKNOWN";
  readonly remoteCreatorId: string | null;
  /** Diagnostic only; rotation is not a login-generation change. Never expose cookie values. */
  readonly runtimeCookiesChangedSinceBundle: boolean | null;
  readonly ticket: { readonly state: "MISSING" | "LOCKED" | "ID_MISMATCH" | "INVALID" | "SUBMIT_CONSUMED";
    readonly publishQuotaConsumed: boolean };
  readonly intentCount: number;
  readonly recordCount: number;
}

export interface Mvp5ReadinessResult {
  readonly accountBindingReady: boolean;
  readonly sessionBindingReady: boolean;
  readonly credentialBindingReady: boolean;
  readonly contentBindingReady: boolean;
  readonly ticketState: Mvp5ReadinessInput["ticket"]["state"];
  readonly publishQuotaConsumed: boolean;
  readonly runtimeCookiesChangedSinceBundle: boolean | null;
  readonly recaptureEligibility: "OWNER_AUTH_REQUIRED" | "BLOCKED";
  readonly reasonCodes: readonly CaptureBindingReasonCode[];
}

function preparedContentMatches(input: Mvp5ReadinessInput): boolean {
  const { job, article, preparation } = input;
  if (!job || !article || !isMvp5PlainTextArticle(article.body) || !preparation?.canonicalPayloadJson
    || !preparation.payloadHash || !preparation.contentBindingHash)
    return false;
  try {
    const payload = JSON.parse(preparation.canonicalPayloadJson) as ToutiaoArticlePreparedPayload;
    const canonicalHash = createHash("sha256").update(canonicalSerialize(payload)).digest("hex");
    const source = normalizeToutiaoArticleContent(article.body);
    const settings = normalizeToutiaoSettings(preparation.settings);
    const sourceHash = createHash("sha256").update(canonicalSerialize({ title: article.title, html: article.body,
      settings, assetByteHashes: [...new Set(payload.assetSnapshots.map((asset) => asset.byteSha256))].sort() })).digest("hex");
    return canonicalHash === preparation.payloadHash && hashToutiaoContentBinding(payload) === preparation.contentBindingHash
      && payload.sourceContentHash === sourceHash && payload.jobId === job.id && payload.articleId === article.id
      && payload.accountId === input.expectedAccountId && payload.brandId === article.brandId
      && payload.title === article.title.trim().normalize("NFC") && payload.plainText === source.plainText
      && payload.coverMode === "none" && payload.remoteScheduledAt === null
      && payload.assetSnapshots.length === 0 && source.imageReferences.length === 0;
  } catch { return false; }
}

/** Pure readiness evaluation. It cannot create a ticket, touch the network, or read a raw captured request. */
export function evaluateMvp5CaptureReadiness(input: Mvp5ReadinessInput): Mvp5ReadinessResult {
  const reasons: CaptureBindingReasonCode[] = [];
  const accountReady = Boolean(input.account && input.account.id === input.expectedAccountId
    && input.account.platformKey === "toutiao" && input.account.externalAccountId === input.expectedCreatorId
    && input.account.loginStatus === "logged_in" && input.account.enabled
    && input.remoteAuthState === "VALID" && input.remoteCreatorId === input.expectedCreatorId
    && input.job?.accountId === input.expectedAccountId && input.job.platformKey === "toutiao");
  if (!accountReady) reasons.push("ACCOUNT_ID_MISMATCH");
  const sessionReady = input.runtime.accountId === input.expectedAccountId && input.runtime.runtimeState === "ACTIVE"
    && input.runtime.sessionExists && input.runtime.contextExists && input.runtime.canonicalPageExists
    && input.runtime.contextOwnsPage && input.runtime.pageAlive && input.runtime.pageHost === "mp.toutiao.com"
    && Boolean(input.runtime.contextDebugId);
  if (!sessionReady) reasons.push(input.runtime.contextOwnsPage ? "BROWSER_SESSION_MISMATCH" : "CONTEXT_OWNERSHIP_MISMATCH");
  let credentialReady = true;
  if (input.credentialReadError) {
    reasons.push("CREDENTIAL_BUNDLE_INCONSISTENT"); credentialReady = false;
  } else if (!input.metadata || !input.bundle || input.metadata.credentialState !== "VALID" || input.bundle.state !== "VALID"
    || !input.metadata.validatedAt || !input.bundle.validatedAt || input.bundle.sessionIdentity !== input.expectedCreatorId) {
    reasons.push("CREDENTIAL_BUNDLE_MISSING"); credentialReady = false;
  } else {
    if (input.bundle.version !== input.metadata.bundleVersion) {
      reasons.push("CREDENTIAL_BUNDLE_VERSION_MISMATCH"); credentialReady = false;
    }
    if (input.bundle.loginGeneration !== input.metadata.loginGeneration) {
      reasons.push("LOGIN_GENERATION_MISMATCH"); credentialReady = false;
    }
    if (input.bundle.validatedAt !== input.metadata.validatedAt) {
      reasons.push("CREDENTIAL_BUNDLE_INCONSISTENT"); credentialReady = false;
    }
  }
  const contentReady = input.job?.status === "AwaitingConfirmation" && input.job.articleId === input.article?.id
    && input.intentCount === 0 && input.recordCount === 0 && preparedContentMatches(input);
  if (!contentReady) reasons.push("CONTENT_BINDING_HASH_MISMATCH");
  if (input.ticket.state === "MISSING") reasons.push("TICKET_MISSING");
  else if (input.ticket.state === "ID_MISMATCH" || input.ticket.state === "INVALID") reasons.push("TICKET_ID_MISMATCH");
  else if (input.ticket.state === "SUBMIT_CONSUMED" || input.ticket.publishQuotaConsumed) reasons.push("TICKET_ALREADY_CONSUMED");
  return { accountBindingReady: accountReady, sessionBindingReady: sessionReady,
    credentialBindingReady: credentialReady, contentBindingReady: Boolean(contentReady),
    ticketState: input.ticket.state, publishQuotaConsumed: input.ticket.publishQuotaConsumed,
    runtimeCookiesChangedSinceBundle: input.runtimeCookiesChangedSinceBundle,
    recaptureEligibility: reasons.length === 0 && input.ticket.state === "LOCKED" ? "OWNER_AUTH_REQUIRED" : "BLOCKED",
    reasonCodes: reasons };
}
