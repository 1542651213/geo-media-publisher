/** This is the complete allowlist for R1-C auth/signing diagnostics. */
export interface ToutiaoAuthSignerEvidence {
  readonly accountId: string;
  readonly credentialBundleVersion: number;
  readonly loginGeneration: number;
  readonly credentialState: "VALID" | "INVALID" | "UNKNOWN";
  readonly credentialValidatedAt: string | null;
  readonly credentialFingerprint: string;
  readonly finalPayloadHash: string | null;
  readonly signerVersion: string | null;
  readonly signerInputHash: string | null;
  readonly signatureGeneratedAt: string | null;
  readonly reasonCode: string;
  readonly httpStatus: number | null;
}

export function toutiaoAuthSignerEvidence(input: ToutiaoAuthSignerEvidence): ToutiaoAuthSignerEvidence {
  return { accountId: input.accountId, credentialBundleVersion: input.credentialBundleVersion,
    loginGeneration: input.loginGeneration, credentialState: input.credentialState,
    credentialValidatedAt: input.credentialValidatedAt, credentialFingerprint: input.credentialFingerprint,
    finalPayloadHash: input.finalPayloadHash, signerVersion: input.signerVersion, signerInputHash: input.signerInputHash,
    signatureGeneratedAt: input.signatureGeneratedAt, reasonCode: input.reasonCode, httpStatus: input.httpStatus };
}
