import { canonicalSerialize, sha256Canonical, ToutiaoPreparationError } from "@publisher/domain";
import { assertToutiaoFinalPayloadReady, hashToutiaoFinalPayload, type ToutiaoArticleFinalPayload } from "../final-payload";

export interface ToutiaoSignerInput {
  readonly finalPayload: Readonly<ToutiaoArticleFinalPayload>;
  readonly finalPayloadHash: string;
  readonly credentialBundleVersion: number;
  readonly loginGeneration: number;
  readonly tokenMaterial: Readonly<{ csrf: string | null; antiToken: string | null; msToken: string | null }>;
  readonly requestMetadata: Readonly<Record<string, string>>;
}
export interface ToutiaoSignerResult {
  /** Sensitive short-lived request material; never persist or log. */
  readonly signature: string;
  readonly signerVersion: string;
  readonly signedAt: string;
  readonly inputHash: string;
}
export interface ToutiaoArticleSigner { sign(input: ToutiaoSignerInput): Promise<ToutiaoSignerResult> }
export interface ToutiaoAbogusAlgorithm {
  readonly version: string;
  compute(canonicalFinalPayload: string, input: ToutiaoSignerInput): Promise<string>;
}
/** Frozen non-secret evidence from the intended attempt; never re-read mutable Article state here. */
export interface ToutiaoFrozenSignerBinding {
  readonly accountId: string;
  readonly finalPayloadHash: string;
  readonly credentialBundleVersion: number;
  readonly loginGeneration: number;
}

export class BoundToutiaoArticleSigner implements ToutiaoArticleSigner {
  /** Required token names come from a versioned protocol profile, not a permanent platform assumption. */
  constructor(private readonly algorithm: ToutiaoAbogusAlgorithm, private readonly binding: ToutiaoFrozenSignerBinding,
    private readonly requiredTokenNames: readonly (keyof ToutiaoSignerInput["tokenMaterial"])[]) {}
  async sign(input: ToutiaoSignerInput): Promise<ToutiaoSignerResult> {
    assertToutiaoFinalPayloadReady(input.finalPayload);
    if (hashToutiaoFinalPayload(input.finalPayload) !== input.finalPayloadHash || input.finalPayload.accountId.length === 0
      || input.finalPayload.accountId !== this.binding.accountId || input.finalPayloadHash !== this.binding.finalPayloadHash
      || input.credentialBundleVersion !== this.binding.credentialBundleVersion || input.loginGeneration !== this.binding.loginGeneration
      || !Number.isInteger(input.credentialBundleVersion) || input.credentialBundleVersion < 1
      || !Number.isInteger(input.loginGeneration) || input.loginGeneration < 1
      || this.requiredTokenNames.some((name) => !input.tokenMaterial[name])) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
    const canonicalFinalPayload = canonicalSerialize(input.finalPayload);
    const inputHash = sha256Canonical({ finalPayloadHash: input.finalPayloadHash, credentialBundleVersion: input.credentialBundleVersion,
      loginGeneration: input.loginGeneration, requestMetadata: input.requestMetadata });
    const signature = await this.algorithm.compute(canonicalFinalPayload, input);
    if (!signature) throw new Error("SIGNATURE_UNAVAILABLE");
    return { signature, signerVersion: this.algorithm.version, signedAt: new Date().toISOString(), inputHash };
  }
}
