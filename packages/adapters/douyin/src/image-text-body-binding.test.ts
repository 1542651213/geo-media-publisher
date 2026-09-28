import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import type { AccountContext } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";
import { DouyinImageTextBrowserAdapter } from "./image-text-browser";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const store: CredentialStore = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false };
const browsers: Browser[] = [];
afterEach(async () => { for (const browser of browsers.splice(0)) await browser.close(); });

const binding = { accountId: "owner-account", articleId: "article-0926b", jobId: "job-0926b",
  creatorId: "72388977613", loginGeneration: 1, sessionIdHash: "session-0926b",
  operationId: "selection-1", imageSha256: "a".repeat(64) };
const ctx: AccountContext = { accountId: "owner-account", accountName: "Owner", platformKey: "douyin",
  settings: { expectedCreatorId: "72388977613", expectedLoginGeneration: 1 }, secrets: {} };

async function fixture(visibleId: string | null) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  await page.route("https://creator.douyin.com/**", (route) => {
    requests.push(`${route.request().method()} ${route.request().url()}`);
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8",
      body: `<html><body><main>${visibleId ? `抖音号：${visibleId}` : "编辑作品"}<div contenteditable="true">正文</div></main></body></html>` });
  });
  await page.goto("https://creator.douyin.com/creator-micro/content/post/image");
  requests.length = 0;
  const adapter = new DouyinImageTextBrowserAdapter({ credentialStore: store });
  const session = { context, page, executionMode: "VISIBLE", sessionIdHash: binding.sessionIdHash };
  Object.defineProperty(adapter, "activeCanonicalPage", { value: async () => ({ page, session }) });
  return { adapter, page, context, session, requests };
}

describe.skipIf(!existsSync(chrome))("Douyin read-only body identity and ownership", () => {
  it("uses a visible matching Creator ID without changing the editor", async () => {
    const { adapter, page, requests } = await fixture(binding.creatorId);
    const before = await page.locator("[contenteditable]").innerText();
    const result = await adapter.inspectCurrentImageTextBodyReadOnly(ctx, binding, "正文");
    expect(result).toMatchObject({ identityVerificationMode: "VISIBLE_CREATOR_ID", identityVerified: true,
      body: { candidateCount: 1, selectedCandidateIndex: 0 } });
    expect(page.url()).toBe("https://creator.douyin.com/creator-micro/content/post/image");
    expect(await page.locator("[contenteditable]").innerText()).toBe(before);
    expect(requests).toEqual([]);
  });

  it("labels a hidden ID as continuity evidence, never as renewed remote identity", async () => {
    const { adapter } = await fixture(null);
    const result = await adapter.inspectCurrentImageTextBodyReadOnly(ctx, binding, "正文");
    expect(result).toMatchObject({ identityVerificationMode: "CONTINUITY_EVIDENCE", identityVerified: false,
      identityEvidence: { creatorBindingId: binding.creatorId, sessionHashMatchesSelection: true,
        loginGenerationMatchesSelection: true } });
  });

  it("rejects a visible wrong Creator ID even with otherwise matching continuity", async () => {
    const { adapter } = await fixture("12345678901");
    await expect(adapter.inspectCurrentImageTextBodyReadOnly(ctx, binding, "正文"))
      .rejects.toThrow("DOUYIN_BODY_DIAGNOSTIC_CREATOR_MISMATCH");
  });

  it("rejects account, Context, generation and selection-session mismatch before DOM diagnosis", async () => {
    const { adapter, session } = await fixture(null);
    await expect(adapter.inspectCurrentImageTextBodyReadOnly({ ...ctx, accountId: "other" }, binding, "正文"))
      .rejects.toThrow("DOUYIN_BODY_DIAGNOSTIC_ACCOUNT_MISMATCH");
    await expect(adapter.inspectCurrentImageTextBodyReadOnly({ ...ctx, settings: { ...ctx.settings, expectedLoginGeneration: 2 } }, binding, "正文"))
      .rejects.toThrow("DOUYIN_BODY_DIAGNOSTIC_GENERATION_MISMATCH");
    session.sessionIdHash = "different";
    await expect(adapter.inspectCurrentImageTextBodyReadOnly(ctx, binding, "正文"))
      .rejects.toThrow("DOUYIN_BODY_DIAGNOSTIC_SESSION_MISMATCH");
    session.sessionIdHash = binding.sessionIdHash;
    session.context = await browsers[0]!.newContext();
    await expect(adapter.inspectCurrentImageTextBodyReadOnly(ctx, binding, "正文"))
      .rejects.toThrow("DOUYIN_BODY_DIAGNOSTIC_CONTEXT_MISMATCH");
  });
});
