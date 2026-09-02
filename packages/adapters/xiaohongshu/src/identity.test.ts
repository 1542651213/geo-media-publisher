import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractCreatorIdFromAccountLabel, resolveCreatorIdentityCandidates, type XiaohongshuCreatorIdentityCandidate } from "./identity";

function candidate(rawValue: string): XiaohongshuCreatorIdentityCandidate {
  return {
    source: "CREATOR_HOME_ACCOUNT_LABEL",
    rawValue,
    normalizedCreatorId: rawValue.trim(),
    semanticAnchor: "xiaohongshu-account-id-label"
  };
}

describe("Xiaohongshu bounded Creator ID identity reader", () => {
  it.each([
    ["小红书账号：960803317", "960803317"],
    ["小红书账号: 960803317", "960803317"],
    ["小红书账号  ：\u00a0960803317", "960803317"]
  ])("extracts a numeric ID only from the semantic account label: %s", (text, expected) => {
    expect(extractCreatorIdFromAccountLabel(text)).toBe(expected);
  });

  it.each([
    "粉丝：960803317",
    "点赞 960803317",
    "收藏：960803317",
    "账号昵称：960803317",
    "小红书账号：abc960803317",
    "小红书账号：96",
    "小红书账号"
  ])("rejects unanchored or malformed identity text: %s", (text) => {
    expect(extractCreatorIdFromAccountLabel(text)).toBeNull();
  });

  it("deduplicates equal semantic candidates", () => {
    expect(resolveCreatorIdentityCandidates([candidate("960803317"), candidate("960803317")])).toEqual({
      status: "PASS",
      normalizedCreatorId: "960803317",
      candidates: [candidate("960803317")],
      failureCode: null
    });
  });

  it("fails closed when semantic candidates disagree", () => {
    expect(resolveCreatorIdentityCandidates([candidate("960803317"), candidate("123456789")])).toMatchObject({
      status: "AMBIGUOUS",
      normalizedCreatorId: null,
      failureCode: "AMBIGUOUS_IDENTITY"
    });
  });

  it("fails closed when no semantic candidate exists", () => {
    expect(resolveCreatorIdentityCandidates([])).toEqual({
      status: "NOT_VERIFIED",
      normalizedCreatorId: null,
      candidates: [],
      failureCode: "CREATOR_ID_NOT_FOUND"
    });
  });

  it("keeps the shared reader bounded and read-only", () => {
    const source = readFileSync("packages/adapters/xiaohongshu/src/identity.ts", "utf8");
    expect(source).not.toMatch(/document\.body|document\.documentElement|localStorage|sessionStorage|indexedDB|cookie|storageState|newPage|newContext|\.goto\(/iu);
    expect(source).toContain('page.locator(ACCOUNT_LABEL_SELECTOR)');
    expect(source).toContain("MAX_MATCHES = 10");
    expect(source).toContain("MAX_ANCESTOR_DEPTH = 3");
  });
});
