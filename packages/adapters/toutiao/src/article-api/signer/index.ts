import { canonicalSerialize, sha256Canonical, ToutiaoPreparationError } from "@publisher/domain";
import { assertToutiaoFinalPayloadReady, hashToutiaoFinalPayload, type ToutiaoArticleFinalPayload } from "../final-payload";

export interface ToutiaoSignerInput {
  readonly finalPayload: Readonly<ToutiaoArticleFinalPayload>;
  readonly finalPayloadHash: string;
  readonly credentialBundleVersion: number;
  readonly loginGeneration: number;
  readonly tokenMaterial: Readonly<{ csrf: string; antiToken: string; msToken: string }>;
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

export class BoundToutiaoArticleSigner implements ToutiaoArticleSigner {
  constructor(private readonly algorithm: ToutiaoAbogusAlgorithm) {}
  async sign(input: ToutiaoSignerInput): Promise<ToutiaoSignerResult> {
    assertToutiaoFinalPayloadReady(input.finalPayload);
    if (hashToutiaoFinalPayload(input.finalPayload) !== input.finalPayloadHash || input.finalPayload.accountId.length === 0
      || !Number.isInteger(input.credentialBundleVersion) || input.credentialBundleVersion < 1
      || !Number.isInteger(input.loginGeneration) || input.loginGeneration < 1
      || !input.tokenMaterial.csrf || !input.tokenMaterial.antiToken || !input.tokenMaterial.msToken) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
    const canonicalFinalPayload = canonicalSerialize(input.finalPayload);
    const inputHash = sha256Canonical({ finalPayloadHash: input.finalPayloadHash, credentialBundleVersion: input.credentialBundleVersion,
      loginGeneration: input.loginGeneration, requestMetadata: input.requestMetadata });
    const signature = await this.algorithm.compute(canonicalFinalPayload, input);
    if (!signature) throw new Error("SIGNATURE_UNAVAILABLE");
    return { signature, signerVersion: this.algorithm.version, signedAt: new Date().toISOString(), inputHash };
  }
}
