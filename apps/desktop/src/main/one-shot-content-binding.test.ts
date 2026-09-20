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
    expect(binding.titleCanonical).toBe(payload.title);
    expect(binding.bodyCanonical).toBe(payload.body);
    expect(verifyOneShotContentBinding(binding, payload)).toMatchObject({ status: "PASS" });
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

  it("rejects NBSP replacement as a real content difference", () => {
    const binding = buildOneShotContentBinding(payload);
    expect(verifyOneShotContentBinding(binding, { ...payload, body: payload.body.replaceAll(" ", "\u00a0") })).toMatchObject({ status: "FAIL" });
    expect(verifyOneShotContentBinding(binding, { ...payload, body: payload.body.replace("最终", "最终不同") })).toMatchObject({ status: "FAIL" });
  });
});

it.each(["NBSP", "punctuation", "trim"])("F02 rejects %s substitution in bound editor readback", (change) => {
 const binding = buildOneShotContentBinding(payload);
 const changed = change === "NBSP" ? { ...payload, body: payload.body.replaceAll(" ", "\u00a0") } : change === "punctuation" ? { ...payload, title: payload.title.replace("｜", "|") } : { ...payload, body: payload.body + " " };
 expect(verifyOneShotContentBinding(binding, changed).status).toBe("FAIL");
});

it("reports the exact permitted line-ending transform", () => {
 const value = { ...payload, body: "A\r\nB" }; const binding = buildOneShotContentBinding(value);
 expect(verifyOneShotContentBinding(binding, value)).toEqual({ status: "PASS_WITH_NORMALIZATION", reasons: ["BODY_CRLF_OR_CR_TO_LF"] });
});
