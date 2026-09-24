import type { ToutiaoAbogusAlgorithm, ToutiaoSignerInput } from "./index";

/** No verified offline fixture exists for the live a_bogus algorithm. Always fail closed. */
export class UnverifiedAbogusAlgorithm implements ToutiaoAbogusAlgorithm {
  readonly version = "toutiao-abogus-unverified";
  async compute(_canonicalFinalPayload: string, _input: ToutiaoSignerInput): Promise<never> {
    throw Object.assign(new Error("ABOGUS_SIGNER_UNVERIFIED"), { code: "ABOGUS_SIGNER_UNVERIFIED" });
  }
}
