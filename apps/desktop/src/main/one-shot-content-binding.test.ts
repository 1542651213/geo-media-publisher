import { describe, expect, it } from "vitest";
import { buildOneShotContentBinding, validateOneShotContentPayload, verifyOneShotContentBinding, type OneShotContentPayload } from "./one-shot-content-binding";

const payload: OneShotContentPayload = {
  platformKey: "xiaohongshu",
  accountId: "account-1",
  creatorId: "960803317",
  title: "GMP发布验收2｜请忽略",
  body: "GEO Media Publisher 小红书自动发布最终验收测试。本内容仅用于验证上传、正文回读、发布事务与平台确认流程，请忽略。",
  imageAssetId: "image-1",
  imageSha256: "a".repeat(64)
};

describe("explicit one-shot content binding", () => {
  it("builds an immutable binding from explicit title, body, and image", () => {
    const binding = buildOneShotContentBinding(payload);
    expect(binding.contentBindingId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(binding.titleSha256).toHaveLength(64);
    expect(binding.bodySha256).toHaveLength(64);
    expect(binding.titleCanonical).toBe("GMP发布验收2|请忽略");
    expect(binding.bodyCanonical).toBe(payload.body);
    expect(verifyOneShotContentBinding(binding, payload)).toMatchObject({ status: "PASS_WITH_NORMALIZATION" });
  });

  it("fails closed when required content is missing", () => {
    expect(() => validateOneShotContentPayload({ ...payload, title: "" })).toThrow("ONE_SHOT_CONTENT_PAYLOAD_REQUIRED");
    expect(() => validateOneShotContentPayload({ ...payload, body: "" })).toThrow("ONE_SHOT_CONTENT_PAYLOAD_REQUIRED");
    expect(() => validateOneShotContentPayload({ ...payload, imageAssetId: "" })).toThrow("ONE_SHOT_CONTENT_PAYLOAD_REQUIRED");
  });

  it("rejects content changed after prepare", () => {
    const binding = buildOneShotContentBinding(payload);
    expect(verifyOneShotContentBinding(binding, { ...payload, body: `${payload.body} changed` })).toMatchObject({ status: "FAIL", reasons: ["BODY_HASH_MISMATCH"] });
  });

  it("accepts R69.4 newline and NBSP normalization but preserves real differences", () => {
    const binding = buildOneShotContentBinding(payload);
    expect(verifyOneShotContentBinding(binding, { ...payload, body: payload.body.replaceAll(" ", "\u00a0") })).toMatchObject({ status: "PASS_WITH_NORMALIZATION" });
    expect(verifyOneShotContentBinding(binding, { ...payload, body: payload.body.replace("最终", "最终不同") })).toMatchObject({ status: "FAIL" });
  });
});
