import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashToutiaoFinalPayload, type ToutiaoArticleFinalPayload } from "../final-payload";
import { UnverifiedAbogusAlgorithm } from "./abogus";
import { BoundToutiaoArticleSigner, type ToutiaoAbogusAlgorithm, type ToutiaoSignerInput } from "./index";

const payload: ToutiaoArticleFinalPayload = { version: 1, accountId: "account", brandId: "brand", title: "图文标题", html: "<p>正文</p>",
  coverMode: "none", coverAssets: [], articleAdType: "none", remoteScheduledAt: null, settingsSnapshotVersion: 1, contentBindingHash: "a".repeat(64) };
const input: ToutiaoSignerInput = { finalPayload: payload, finalPayloadHash: hashToutiaoFinalPayload(payload), credentialBundleVersion: 3,
  loginGeneration: 2, tokenMaterial: { csrf: "csrf-secret", antiToken: "anti-secret", msToken: "ms-secret" }, requestMetadata: { method: "POST", route: "offline-fixture" } };
const binding = { accountId: payload.accountId, finalPayloadHash: input.finalPayloadHash, credentialBundleVersion: 3, loginGeneration: 2 };

describe("Toutiao signer boundary", () => {
  it("binds the final payload hash and returns deterministic fixture output with version", async () => {
    const fixtureAlgorithm: ToutiaoAbogusAlgorithm = { version: "offline-fixture-v1", compute: async (canonical, signerInput) => createHash("sha256").update(canonical + signerInput.finalPayloadHash).digest("hex") };
    const signer = new BoundToutiaoArticleSigner(fixtureAlgorithm, binding, ["csrf", "antiToken", "msToken"]);
    const first = await signer.sign(input);
    const second = await signer.sign(input);
    expect(first.signature).toBe("20d275a134ceb9608630b4db20d47c99545d20be8ea72547edaeb576ec9584f0");
    expect(first.signature).toBe(second.signature);
    expect(first.signerVersion).toBe("offline-fixture-v1");
    expect(first.inputHash).toMatch(/^[a-f0-9]{64}$/u);
    await expect(signer.sign({ ...input, finalPayloadHash: "b".repeat(64) })).rejects.toMatchObject({ code: "PAYLOAD_BINDING_MISMATCH" });
    await expect(signer.sign({ ...input, credentialBundleVersion: 4 })).rejects.toMatchObject({ code: "PAYLOAD_BINDING_MISMATCH" });
    await expect(signer.sign({ ...input, loginGeneration: 3 })).rejects.toMatchObject({ code: "PAYLOAD_BINDING_MISMATCH" });
    await expect(signer.sign({ ...input, finalPayload: { ...payload, html: '<img src="asset://sha256/fake">' }, finalPayloadHash: hashToutiaoFinalPayload({ ...payload, html: '<img src="asset://sha256/fake">' }) })).rejects.toMatchObject({ code: "PAYLOAD_BINDING_MISMATCH" });
  });

  it("keeps the unverified a_bogus implementation fail-closed", async () => {
    await expect(new BoundToutiaoArticleSigner(new UnverifiedAbogusAlgorithm(), binding, ["csrf", "antiToken", "msToken"]).sign(input)).rejects.toMatchObject({ code: "ABOGUS_SIGNER_UNVERIFIED" });
  });

  it("does not permanently require a token whose current protocol requirement is unknown", async () => {
    const signer = new BoundToutiaoArticleSigner({ version: "mock-optional-token-v1", compute: async () => "fixture-signature" }, binding, ["csrf"]);
    const result = await signer.sign({ ...input, tokenMaterial: { csrf: "csrf-secret", antiToken: null, msToken: null } });
    expect(result.signerVersion).toBe("mock-optional-token-v1");
  });
});
