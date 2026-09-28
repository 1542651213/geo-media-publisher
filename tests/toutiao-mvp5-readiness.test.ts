import { describe, expect, it } from "vitest";
import { prepareToutiaoArticlePayload } from "@publisher/adapters-toutiao/article-api";
import { evaluateMvp5CaptureReadiness, type Mvp5ReadinessInput } from "../apps/desktop/src/main/toutiao-capture-binding-readiness";
import { isMvp5PlainTextArticle } from "../apps/desktop/src/main/toutiao-captured-request-one-shot";

const settings = { version: 1 as const, coverMode: "none" as const, coverImages: [], articleAdType: "none" as const, remoteScheduledAt: null };

function fixture(): Mvp5ReadinessInput {
  const article = { id: "article", brandId: "brand", title: "Test", body: "<p>Hello</p>" };
  const prepared = prepareToutiaoArticlePayload({ jobId: "job", articleId: article.id, accountId: "account",
    brandId: article.brandId, title: article.title, html: article.body, settings,
    resolveAsset: () => null, now: new Date("2026-09-25T00:00:00.000Z") });
  return {
    expectedAccountId: "account", expectedCreatorId: "creator",
    account: { id: "account", platformKey: "toutiao", externalAccountId: "creator", loginStatus: "logged_in", enabled: true },
    job: { id: "job", accountId: "account", articleId: article.id, platformKey: "toutiao", status: "AwaitingConfirmation" },
    article,
    preparation: { canonicalPayloadJson: prepared.canonicalJson, payloadHash: prepared.payloadHash,
      contentBindingHash: prepared.contentBindingHash, settings },
    metadata: { bundleVersion: 1, loginGeneration: 1, credentialState: "VALID", validatedAt: "2026-09-25T00:00:00.000Z" },
    bundle: { version: 1, loginGeneration: 1, sessionIdentity: "creator", state: "VALID", validatedAt: "2026-09-25T00:00:00.000Z" },
    runtime: { accountId: "account", runtimeState: "ACTIVE", sessionExists: true, contextExists: true,
      canonicalPageExists: true, contextOwnsPage: true, pageAlive: true, pageHost: "mp.toutiao.com", contextDebugId: "context-1" },
    remoteAuthState: "VALID", remoteCreatorId: "creator", runtimeCookiesChangedSinceBundle: false,
    ticket: { state: "LOCKED", publishQuotaConsumed: false }, intentCount: 0, recordCount: 0
  };
}

describe("Toutiao MVP5 read-only binding readiness", () => {
  it("rejects links and embedded structures outside the one-shot plain-text contract", () => {
    expect(isMvp5PlainTextArticle("A simple test paragraph.")).toBe(true);
    expect(isMvp5PlainTextArticle('<a href="https://example.invalid">hello</a>')).toBe(false);
    expect(isMvp5PlainTextArticle("Visit https://example.invalid")).toBe(false);
    expect(isMvp5PlainTextArticle("![cover](asset.png)")).toBe(false);
  });
  it("reports technical bindings ready while preserving the old locked ticket", () => {
    const result = evaluateMvp5CaptureReadiness(fixture());
    expect(result).toMatchObject({ accountBindingReady: true, sessionBindingReady: true,
      credentialBindingReady: true, contentBindingReady: true, ticketState: "LOCKED",
      publishQuotaConsumed: false, recaptureEligibility: "OWNER_AUTH_REQUIRED", reasonCodes: [] });
  });

  it("classifies account, context, credential version, generation, content and ticket failures separately", () => {
    const base = fixture();
    const cases: Array<[Mvp5ReadinessInput, string]> = [
      [{ ...base, account: { ...base.account!, externalAccountId: "other" } }, "ACCOUNT_ID_MISMATCH"],
      [{ ...base, runtime: { ...base.runtime, contextOwnsPage: false } }, "CONTEXT_OWNERSHIP_MISMATCH"],
      [{ ...base, bundle: { ...base.bundle!, version: 2 } }, "CREDENTIAL_BUNDLE_VERSION_MISMATCH"],
      [{ ...base, bundle: { ...base.bundle!, loginGeneration: 2 } }, "LOGIN_GENERATION_MISMATCH"],
      [{ ...base, article: { ...base.article!, body: "Changed" } }, "CONTENT_BINDING_HASH_MISMATCH"],
      [{ ...base, ticket: { state: "ID_MISMATCH" as const, publishQuotaConsumed: false } }, "TICKET_ID_MISMATCH"],
      [{ ...base, ticket: { state: "SUBMIT_CONSUMED" as const, publishQuotaConsumed: true } }, "TICKET_ALREADY_CONSUMED"]
    ];
    for (const [input, code] of cases) {
      const result = evaluateMvp5CaptureReadiness(input);
      expect(result.reasonCodes).toContain(code);
      expect(result.recaptureEligibility).toBe("BLOCKED");
    }
  });

  it("does not mistake rotating request-time cookies for a new login generation", () => {
    const result = evaluateMvp5CaptureReadiness({ ...fixture(), runtimeCookiesChangedSinceBundle: true });
    expect(result.credentialBindingReady).toBe(true);
    expect(result.recaptureEligibility).toBe("OWNER_AUTH_REQUIRED");
  });
});
