import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { extractCreatorIdFromAccountLabel, resolveCreatorIdentityCandidates, verifyIdentityOnPage, type XiaohongshuCreatorIdentityCandidate } from "./identity";

function candidate(rawValue: string): XiaohongshuCreatorIdentityCandidate {
  return {
    source: "CREATOR_HOME_ACCOUNT_LABEL",
    rawValue,
    normalizedCreatorId: rawValue.trim(),
    semanticAnchor: "xiaohongshu-account-id-label"
  };
}

function identityPage(url: string, closed = false): Page {
  const leaf = {
    isVisible: async () => true,
    getAttribute: async (name: string) => name === "href" ? "https://creator.xiaohongshu.com/user/profile/123456789" : null,
    innerText: async () => "测试账号",
    evaluate: async () => "A",
    nth: () => leaf
  };
  const locator = {
    count: async () => 1,
    nth: () => leaf
  };
  return {
    url: () => url,
    isClosed: () => closed,
    locator: (selector: string) => selector === "text=小红书账号" ? { count: async () => 0 } : locator
  } as unknown as Page;
}

describe("Xiaohongshu bounded Creator ID identity reader", () => {
  it.each([
    ["小红书账号：123456789", "123456789"],
    ["小红书账号: 123456789", "123456789"],
    ["小红书账号  ：\u00a0123456789", "123456789"]
  ])("extracts a numeric ID only from the semantic account label: %s", (text, expected) => {
    expect(extractCreatorIdFromAccountLabel(text)).toBe(expected);
  });

  it.each([
    "粉丝：123456789",
    "点赞 123456789",
    "收藏：123456789",
    "账号昵称：123456789",
    "小红书账号：abc123456789",
    "小红书账号：96",
    "小红书账号"
  ])("rejects unanchored or malformed identity text: %s", (text) => {
    expect(extractCreatorIdFromAccountLabel(text)).toBeNull();
  });

  it("deduplicates equal semantic candidates", () => {
    expect(resolveCreatorIdentityCandidates([candidate("123456789"), candidate("123456789")])).toEqual({
      status: "PASS",
      normalizedCreatorId: "123456789",
      candidates: [candidate("123456789")],
      failureCode: null
    });
  });

  it("fails closed when semantic candidates disagree", () => {
    expect(resolveCreatorIdentityCandidates([candidate("123456789"), candidate("123456789")])).toMatchObject({
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

  it("returns a typed proof for an existing official identity Page", async () => {
    const result = await verifyIdentityOnPage(identityPage("https://creator.xiaohongshu.com/new/home"), {
      browserSessionId: "session-a",
      contextId: "context-1",
      pageId: "page-a"
    });

    expect(result.status).toBe("PASS");
    if (result.status === "PASS") {
      expect(result.proof).toMatchObject({
        browserSessionId: "session-a",
        contextId: "context-1",
        pageId: "page-a",
        pageOrigin: "https://creator.xiaohongshu.com",
        pagePathname: "/new/home",
        creatorId: "123456789"
      });
      expect(new Date(result.proof.expiresAt).getTime() - new Date(result.proof.verifiedAt).getTime()).toBe(300_000);
    }
  });

  it("rejects a publish editor as an identity source even when its DOM is otherwise available", async () => {
    await expect(verifyIdentityOnPage(identityPage("https://creator.xiaohongshu.com/publish/publish"), {
      browserSessionId: "session-a",
      contextId: "context-1",
      pageId: "page-b"
    })).resolves.toEqual({ status: "FAIL", failureCode: "PUBLISH_EDITOR_CANNOT_BE_IDENTITY_SOURCE", proof: null });
  });

  it("fails closed for a closed identity Page", async () => {
    await expect(verifyIdentityOnPage(identityPage("https://creator.xiaohongshu.com/new/home", true), {
      browserSessionId: "session-a",
      contextId: "context-1",
      pageId: "page-a"
    })).resolves.toEqual({ status: "FAIL", failureCode: "IDENTITY_PAGE_CLOSED", proof: null });
  });

  it("keeps the shared reader bounded and read-only", () => {
    const source = readFileSync("packages/adapters/xiaohongshu/src/identity.ts", "utf8");
    expect(source).not.toMatch(/document\.body|document\.documentElement|localStorage|sessionStorage|indexedDB|cookie|storageState|newPage|newContext|\.goto\(/iu);
    expect(source).toContain('page.locator(ACCOUNT_LABEL_SELECTOR)');
    expect(source).toContain("MAX_MATCHES = 10");
    expect(source).toContain("MAX_ANCESTOR_DEPTH = 3");
  });
});
