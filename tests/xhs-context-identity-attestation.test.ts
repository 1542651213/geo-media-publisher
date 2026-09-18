import { describe, expect, it } from "vitest";
import {
  XHS_CONTEXT_IDENTITY_ATTESTATION_TTL_MS,
  createXhsContextIdentityAttestation,
  validateXhsContextIdentityAttestation,
  type XhsContextIdentityAttestationSource,
  type XhsContextIdentityRuntime
} from "../apps/desktop/src/main/xhs-context-identity-attestation";

const issuedAt = new Date("2026-09-07T08:00:00.000Z");

function source(overrides: Partial<XhsContextIdentityAttestationSource> = {}): XhsContextIdentityAttestationSource {
  return {
    accountId: "xhs-account",
    expectedExternalCreatorId: "123456789",
    observedExternalCreatorId: "123456789",
    identityObservationStatus: "PASS",
    browserSessionIdentity: "session-a",
    browserContextIdentity: "context-a",
    sourcePageIdentity: "home-page",
    sourceOrigin: "https://creator.xiaohongshu.com",
    sourcePathname: "/new/home",
    browserConnected: true,
    pageClosed: false,
    runtimeAuthState: "AUTHENTICATED",
    externalAccountId: "123456789",
    ...overrides
  };
}

function runtime(overrides: Partial<XhsContextIdentityRuntime> = {}): XhsContextIdentityRuntime {
  return {
    accountId: "xhs-account",
    browserSessionIdentity: "session-a",
    browserContextIdentity: "context-a",
    currentPageExists: true,
    currentPageClosed: false,
    browserConnected: true,
    runtimeAuthState: "AUTHENTICATED",
    observedExternalCreatorId: "123456789",
    ...overrides
  };
}

describe("XHS Context-bound identity attestation", () => {
  it("creates an attestation only after a fresh exact Creator ID proof", () => {
    const result = createXhsContextIdentityAttestation(source(), issuedAt);

    expect(result.status).toBe("PASS");
    if (result.status === "PASS") {
      expect(result.attestation).toMatchObject({
        accountId: "xhs-account",
        expectedExternalCreatorId: "123456789",
        observedExternalCreatorId: "123456789",
        browserSessionIdentity: "session-a",
        browserContextIdentity: "context-a",
        sourcePageIdentity: "home-page",
        verified: true
      });
      expect(new Date(result.attestation.expiresAt).getTime() - issuedAt.getTime()).toBe(XHS_CONTEXT_IDENTITY_ATTESTATION_TTL_MS);
    }
  });

  it.each([
    ["identity signal is not observed", { identityObservationStatus: "NOT_VERIFIED" as const, observedExternalCreatorId: null }],
    ["Creator ID is wrong", { identityObservationStatus: "PASS" as const, observedExternalCreatorId: "other-creator" }],
    ["identity-capable Page is unavailable", { identityObservationStatus: "NOT_VERIFIED" as const, sourcePageIdentity: "draft-page" }],
    ["runtime is disconnected", { browserConnected: false }],
    ["runtime is not authenticated", { runtimeAuthState: "UNVERIFIED" as const }]
  ])("fails closed when %s", (_reason, overrides) => {
    expect(createXhsContextIdentityAttestation(source(overrides), issuedAt)).toMatchObject({ status: "BLOCKED" });
  });

  it("allows the current Page to change while retaining the same live Session and Context", () => {
    const created = createXhsContextIdentityAttestation(source(), issuedAt);
    expect(created.status).toBe("PASS");
    if (created.status !== "PASS") return;

    expect(validateXhsContextIdentityAttestation(created.attestation, runtime({ currentPageExists: true }), new Date(issuedAt.getTime() + 1_000))).toMatchObject({ valid: true });
  });

  it.each([
    ["a different BrowserSession", { browserSessionIdentity: "session-b" }],
    ["a different BrowserContext", { browserContextIdentity: "context-b" }],
    ["a disconnected runtime", { browserConnected: false }],
    ["a closed current Page", { currentPageClosed: true }],
    ["an expired attestation", { now: new Date(issuedAt.getTime() + XHS_CONTEXT_IDENTITY_ATTESTATION_TTL_MS + 1) }],
    ["a Creator ID mismatch", { observedExternalCreatorId: "other-creator" }]
  ])("invalidates on %s", (_reason, overrides) => {
    const created = createXhsContextIdentityAttestation(source(), issuedAt);
    expect(created.status).toBe("PASS");
    if (created.status !== "PASS") return;

    const { now, ...runtimeOverrides } = overrides as Partial<XhsContextIdentityRuntime> & { now?: Date };
    expect(validateXhsContextIdentityAttestation(created.attestation, runtime(runtimeOverrides), now ?? new Date(issuedAt.getTime() + 1_000))).toMatchObject({ valid: false });
  });

  it("does not depend on the source Page remaining open", () => {
    const created = createXhsContextIdentityAttestation(source(), issuedAt);
    expect(created.status).toBe("PASS");
    if (created.status !== "PASS") return;

    expect(validateXhsContextIdentityAttestation(created.attestation, runtime({ currentPageClosed: false }), new Date(issuedAt.getTime() + 2_000))).toMatchObject({ valid: true });
  });
});
