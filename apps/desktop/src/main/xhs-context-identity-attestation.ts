import type { BrowserRuntimeAuthState } from "@publisher/adapters-core";
import type { XhsContextIdentityAttestation } from "@publisher/domain";

export type { XhsContextIdentityAttestation } from "@publisher/domain";

export const XHS_CONTEXT_IDENTITY_ATTESTATION_TTL_MS = 5 * 60 * 1_000;

export interface XhsContextIdentityAttestationSource {
  accountId: string;
  expectedExternalCreatorId: string | null;
  observedExternalCreatorId: string | null;
  identityObservationStatus: "PASS" | "NOT_VERIFIED" | "AMBIGUOUS";
  browserSessionIdentity: string | null;
  browserContextIdentity: string | null;
  sourcePageIdentity: string | null;
  sourceOrigin: string;
  sourcePathname: string;
  browserConnected: boolean;
  pageClosed: boolean;
  runtimeAuthState: BrowserRuntimeAuthState;
  externalAccountId?: string | null;
}

export interface XhsContextIdentityRuntime {
  accountId: string;
  browserSessionIdentity: string | null;
  browserContextIdentity: string | null;
  currentPageExists: boolean;
  currentPageClosed: boolean;
  browserConnected: boolean;
  runtimeAuthState: BrowserRuntimeAuthState;
  observedExternalCreatorId: string | null;
}

export type XhsContextIdentityAttestationResult =
  | { status: "PASS"; attestation: XhsContextIdentityAttestation }
  | { status: "BLOCKED"; failureCode: string };

export type XhsContextIdentityAttestationValidation =
  | { valid: true; failureCode: null }
  | { valid: false; failureCode: string };

function blocked(failureCode: string): XhsContextIdentityAttestationResult {
  return { status: "BLOCKED", failureCode };
}

export function createXhsContextIdentityAttestation(input: XhsContextIdentityAttestationSource, now = new Date()): XhsContextIdentityAttestationResult {
  if (input.identityObservationStatus !== "PASS") return blocked("IDENTITY_OBSERVATION_NOT_PASS");
  if (!input.expectedExternalCreatorId || !input.observedExternalCreatorId) return blocked("CREATOR_ID_NOT_OBSERVED");
  if (input.expectedExternalCreatorId !== input.observedExternalCreatorId) return blocked("CREATOR_ID_MISMATCH");
  if (input.externalAccountId && input.externalAccountId !== input.observedExternalCreatorId) return blocked("EXTERNAL_ACCOUNT_ID_MISMATCH");
  if (!input.browserSessionIdentity) return blocked("BROWSER_SESSION_IDENTITY_NOT_AVAILABLE");
  if (!input.browserContextIdentity) return blocked("BROWSER_CONTEXT_IDENTITY_NOT_AVAILABLE");
  if (!input.sourcePageIdentity) return blocked("SOURCE_PAGE_IDENTITY_NOT_AVAILABLE");
  if (input.sourceOrigin !== "https://creator.xiaohongshu.com") return blocked("SOURCE_ORIGIN_NOT_ALLOWED");
  if (!input.sourcePathname || input.sourcePathname === "/publish/publish") return blocked("IDENTITY_CAPABLE_SOURCE_PAGE_REQUIRED");
  if (!input.browserConnected) return blocked("BROWSER_SESSION_DISCONNECTED");
  if (input.pageClosed) return blocked("SOURCE_PAGE_CLOSED");
  if (input.runtimeAuthState !== "AUTHENTICATED") return blocked("RUNTIME_NOT_AUTHENTICATED");

  const issuedAt = now.getTime();
  return {
    status: "PASS",
    attestation: {
      accountId: input.accountId,
      platformKey: "xiaohongshu",
      expectedExternalCreatorId: input.expectedExternalCreatorId,
      observedExternalCreatorId: input.observedExternalCreatorId,
      browserSessionIdentity: input.browserSessionIdentity,
      browserContextIdentity: input.browserContextIdentity,
      sourcePageIdentity: input.sourcePageIdentity,
      sourceOrigin: "https://creator.xiaohongshu.com",
      sourcePathname: input.sourcePathname,
      externalAccountId: input.externalAccountId ?? null,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + XHS_CONTEXT_IDENTITY_ATTESTATION_TTL_MS).toISOString(),
      verified: true
    }
  };
}

export function validateXhsContextIdentityAttestation(attestation: XhsContextIdentityAttestation, runtime: XhsContextIdentityRuntime, now = new Date()): XhsContextIdentityAttestationValidation {
  if (attestation.verified !== true || attestation.platformKey !== "xiaohongshu") return { valid: false, failureCode: "ATTESTATION_NOT_VERIFIED" };
  if (attestation.accountId !== runtime.accountId) return { valid: false, failureCode: "ATTESTATION_ACCOUNT_MISMATCH" };
  if (now.getTime() >= new Date(attestation.expiresAt).getTime()) return { valid: false, failureCode: "ATTESTATION_EXPIRED" };
  if (!runtime.browserConnected) return { valid: false, failureCode: "BROWSER_SESSION_DISCONNECTED" };
  if (runtime.runtimeAuthState !== "AUTHENTICATED") return { valid: false, failureCode: "RUNTIME_NOT_AUTHENTICATED" };
  if (!runtime.currentPageExists || runtime.currentPageClosed) return { valid: false, failureCode: "CURRENT_PAGE_UNAVAILABLE" };
  if (runtime.browserSessionIdentity !== attestation.browserSessionIdentity) return { valid: false, failureCode: "BROWSER_SESSION_REBOUND" };
  if (runtime.browserContextIdentity !== attestation.browserContextIdentity) return { valid: false, failureCode: "BROWSER_CONTEXT_CHANGED" };
  if (runtime.observedExternalCreatorId !== attestation.observedExternalCreatorId || runtime.observedExternalCreatorId !== attestation.expectedExternalCreatorId) return { valid: false, failureCode: "CREATOR_ID_MISMATCH" };
  return { valid: true, failureCode: null };
}
