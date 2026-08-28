import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Account, ImageAsset } from "@publisher/domain";
import { XIAOHONGSHU_GATE_ORDER, XIAOHONGSHU_TEST_BODY, buildXiaohongshuTestTitle, classifyXiaohongshuLoginFailure, isXiaohongshuReady, resolveExplicitXiaohongshuAccount, resolveXiaohongshuAccountId, selectXiaohongshuSelfTestImage, type GateResult, type GateStateMap } from "../scripts/v142-xiaohongshu-gate-only.helpers";

describe("v142 Xiaohongshu gate-only runner helpers", () => {
  it("uses the exact gate order and required single-run content", () => {
    expect(XIAOHONGSHU_GATE_ORDER).toEqual([
      "Account Identity",
      "Login / Session",
      "Image-post Entry",
      "Image Upload",
      "Title Editor",
      "Title Write",
      "Title Readback",
      "Body Editor",
      "Body Write",
      "Body Readback",
      "Required Fields",
      "Publish Settings",
      "Final Submit Control discovery"
    ]);
    expect(XIAOHONGSHU_TEST_BODY).toBe("这是 Geo Media Publisher 小红书 BrowserAutomation 图文能力验证内容，仅用于验证账号、图片、标题、正文和发布控件，不执行最终发布。");
    expect(buildXiaohongshuTestTitle(new Date("2026-08-27T04:05:06.000Z"), "Asia/Shanghai")).toBe("GMP 小红书图文能力验证 2026-08-27 12:05:06");
  });

  it("selects only an existing SELF_TEST or universal image and never fabricates a path", () => {
    const image = (id: string, filePath: string, universal: boolean, labels: string[]): ImageAsset => ({ id, brandId: null, name: filePath, filePath, originalFileName: filePath.split("/").at(-1) ?? filePath, mimeType: "image/png", size: 1, tags: labels, business: [], city: [], usage: labels, platform: [], universal, enabled: true, lastUsedAt: null, useCount: 0, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" });
    expect(selectXiaohongshuSelfTestImage([image("normal", "C:/normal.png", false, ["other"]), image("fixture", "C:/fixture.png", false, ["SELF_TEST"])] )?.filePath).toBe("C:/fixture.png");
    expect(selectXiaohongshuSelfTestImage([image("normal", "C:/normal.png", false, ["other"])] )).toBeNull();
  });

  it("requires the explicit account ID and never falls back to another account", () => {
    const account = (id: string): Account => ({ id, platformAccountId: id, platformKey: "xiaohongshu", accountAlias: id, name: id, accountName: id, groupId: null, loginStatus: "logged_in", enabled: true, allowAutoPublish: false, publishMode: "manual", minimumIntervalSeconds: 0, failedCount: 0, connectionMode: "BrowserAutomation", authorizationStatus: "Authorized", browserSessionId: null, externalAccountId: null, lastVerifiedAt: null, lastUsedAt: null, pausedReason: null, lastLoginCheck: null, lastPublishAt: null, todayPublishCount: 0 });
    expect(resolveExplicitXiaohongshuAccount([account("account-a"), account("account-b")], "account-b").id).toBe("account-b");
    expect(() => resolveExplicitXiaohongshuAccount([account("account-a"), account("account-b")], "missing")).toThrow(/account.*not found/i);
    expect(() => resolveExplicitXiaohongshuAccount([account("account-a"), account("account-b")], undefined)).toThrow(/required|fallback is forbidden/i);
  });

  it("accepts only an explicitly supplied CLI or environment account ID", () => {
    expect(resolveXiaohongshuAccountId("account-cli", "account-env")).toBe("account-cli");
    expect(resolveXiaohongshuAccountId(undefined, "account-env")).toBe("account-env");
    expect(() => resolveXiaohongshuAccountId(undefined, undefined)).toThrow(/required|fallback is forbidden/i);
  });

  it("uses the canonical XIAOHONGSHU_ACCOUNT_ID environment variable", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "v142-xiaohongshu-gate-only.mts"), "utf8");
    expect(source).toContain("process.env.XIAOHONGSHU_ACCOUNT_ID");
    expect(source).not.toContain("process.env.XIAHONGSHU_ACCOUNT_ID");
  });

  it("does not label a missing stored session as a security challenge", () => {
    expect(classifyXiaohongshuLoginFailure("needs_user_action", false)).toBe("LOGIN_REQUIRED");
    expect(classifyXiaohongshuLoginFailure("needs_user_action", true)).toBe("SECURITY_VERIFICATION_REQUIRED");
    expect(classifyXiaohongshuLoginFailure("expired", true)).toBe("LOGIN_REQUIRED");
  });

  it("only emits READY=YES for complete gates and always keeps zero final submits", () => {
    const pass: GateStateMap = Object.fromEntries(XIAOHONGSHU_GATE_ORDER.map((gate) => [gate, { result: (gate === "Required Fields" || gate === "Publish Settings" ? "KNOWN" : gate === "Final Submit Control discovery" ? "VERIFIED" : "PASS") as GateResult }])) as GateStateMap;
    expect(isXiaohongshuReady(pass, 0, "NONE")).toBe(true);
    expect(isXiaohongshuReady({ ...pass, "Title Readback": { result: "FAIL" } }, 0, "NONE")).toBe(false);
    expect(isXiaohongshuReady(pass, 1, "NONE")).toBe(false);
    expect(isXiaohongshuReady(pass, 0, "SECURITY_VERIFICATION_REQUIRED")).toBe(false);
  });

  it("has no runner path for Job, Intent, PublishRecord, finalSubmit, or result collection", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "v142-xiaohongshu-gate-only.mts"), "utf8");
    expect(source).not.toMatch(/createArticlePublishJob|prepareSubmissionIntent|insertPublishRecord|collectPublishResult|finalSubmit\s*\(/u);
    expect(source).toContain("finalSubmitCount: 0");
    expect(source).toContain("publishPassed = \"NOT_PASS\"");
  });

  it("checks Login / Session before identity inspection and persistence", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "v142-xiaohongshu-gate-only.mts"), "utf8");
    const loginCheck = source.indexOf("const login = await adapter.checkLogin(context);");
    const identityRead = source.indexOf("const profile = adapter.getAccountProfile ? await adapter.getAccountProfile(context) : {};");
    const identityPersist = source.indexOf("const synced = opened.repository.syncBrowserPlatformAccount");
    expect(loginCheck).toBeGreaterThan(-1);
    expect(identityRead).toBeGreaterThan(loginCheck);
    expect(identityPersist).toBeGreaterThan(identityRead);
  });

  it("keeps active login persistence and release after same-Page identity readback", () => {
    const source = readFileSync(join(process.cwd(), "apps", "desktop", "src", "main", "ipc.ts"), "utf8");
    const completion = source.indexOf("status = await adapter.completeConnection(completedContext);");
    const profile = source.indexOf("const profile = adapter.getAccountProfile ? await adapter.getAccountProfile(completedContext) : undefined;", completion);
    const persistence = source.indexOf("await adapter.persistConnectionSession?.(effectiveContext);", profile);
    const sync = source.indexOf("const account = await syncBrowserAccount(adapter, effectiveAccountId, input.platformKey, action, profile);", persistence);
    const release = source.indexOf("await adapter.releaseConnectionSession?.(effectiveContext);", sync);
    expect(completion).toBeGreaterThan(-1);
    expect(profile).toBeGreaterThan(completion);
    expect(persistence).toBeGreaterThan(profile);
    expect(sync).toBeGreaterThan(persistence);
    expect(release).toBeGreaterThan(sync);
  });

  it("logs complete-login ingress, active-session state, and result contract", () => {
    const source = readFileSync(join(process.cwd(), "apps", "desktop", "src", "main", "ipc.ts"), "utf8");
    expect(source).toContain('logger.info("ACCOUNT", "COMPLETE_LOGIN_REQUEST"');
    expect(source).toContain('logger.info("ACCOUNT", "COMPLETE_CONNECTION_ENTERED"');
    expect(source).toContain('logger.info("ACCOUNT", "COMPLETE_LOGIN_RESPONSE"');
    expect(source).toContain("activeSessionKeys");
    expect(source).toContain("targetSessionFound");
    expect(source).toContain('accountStatus: "Connected"');
  });
});
