import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "@publisher/db";
import type { ToutiaoCredentialBundleService } from "@publisher/adapters-toutiao/article-api";
import { captureAbortedPublishRequest } from "@publisher/adapters-toutiao/article-api";
import type { GlobalPublishExecutionGate } from "@publisher/publisher";
import type { AccountContext } from "@publisher/domain";
import type { ToutiaoArticleBrowserAdapter } from "../packages/adapters/toutiao/src/browser";
import { ToutiaoCapturedRequestOneShot } from "../apps/desktop/src/main/toutiao-captured-request-one-shot";

function fixture() {
  const order: string[] = [];
  const captured = captureAbortedPublishRequest({
    method: "POST", url: "https://mp.toutiao.com/mp/agw/article/publish?a_bogus=fake&msToken=fake",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "session=fake-secret" },
    body: Buffer.from("title=Test&content=%3Cp%3EHello%3C%2Fp%3E")
  }, Date.now());
  const account = { id: "account", platformAccountId: "creator", externalAccountId: "creator",
    loginStatus: "logged_in", enabled: true };
  const article = { id: "article", title: "Test", body: "Hello" };
  const job = { id: "job", accountId: "account", articleId: "article", platformKey: "toutiao", contentKind: "article", status: "AwaitingConfirmation", finalPublishMode: "CONFIRM_BEFORE_PUBLISH" };
  let finalSubmitCount = 0;
  let hasIntent = false;
  let hasRecord = false;
  let metadataPresent = true;
  const repo = {
    getJob: vi.fn(() => job), getArticle: vi.fn(() => article), listAccounts: vi.fn(() => [account]),
    getToutiaoArticlePreparation: vi.fn(() => ({ payloadHash: "a".repeat(64), contentBindingHash: "b".repeat(64),
      canonicalPayloadJson: JSON.stringify({ articleId: "article", accountId: "account", title: "Test", plainText: "Hello",
        coverMode: "none", remoteScheduledAt: null, assetSnapshots: [], coverUploadKeys: [], bodyImageUploadKeys: [] }) })),
    getToutiaoCredentialMetadata: vi.fn(() => metadataPresent ? { accountId: account.id, bundleVersion: 1, loginGeneration: 1,
      credentialState: "VALID", credentialFingerprint: "c".repeat(64), validatedAt: "2026-09-24T00:00:00.000Z" } : null),
    getSubmissionIntentByJob: vi.fn(() => hasIntent ? { id: "intent", state: "Prepared", finalSubmitCount, submissionAttemptId: finalSubmitCount ? "attempt" : null } : null),
    getPublishRecordByJob: vi.fn(() => hasRecord ? { id: "record" } : null),
    confirmJob: vi.fn(() => { order.push("confirm"); }), claimJob: vi.fn(() => { order.push("claim-job"); }),
    prepareSubmissionIntent: vi.fn(() => { order.push("intent"); hasIntent = true; return { id: "intent" }; }),
    bindToutiaoArticlePreparationToIntent: vi.fn(() => { order.push("bind-content"); }),
    bindToutiaoFinalPayloadForFutureSubmit: vi.fn(() => { order.push("bind-final"); }),
    assertToutiaoFutureSubmitReady: vi.fn(() => { order.push("ready"); return "SUBMIT_READY"; }),
    insertPublishRecord: vi.fn(() => { order.push("record"); hasRecord = true; return { id: "record" }; }),
    claimFinalSubmitAttempt: vi.fn(() => { order.push("final-claim"); finalSubmitCount = 1; return { submissionAttemptId: "attempt" }; }),
    markSubmissionIntentSubmitted: vi.fn(() => { order.push("accepted"); }),
    markSubmissionIntentUncertain: vi.fn(() => { order.push("uncertain"); }),
    updatePublishRecord: vi.fn(() => { order.push("record-update"); }),
    markJobPublishing: vi.fn(() => { order.push("publishing"); }),
    resetSubmissionIntentForUserAction: vi.fn(), updateJobFailure: vi.fn()
  };
  const credentials = { assertBound: vi.fn(() => ({ sessionIdentity: "creator", cookieMaterial: [{ name: "session", value: "fake-secret",
    domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null }] })) };
  const currentCookies = vi.fn(async () => [{ name: "session", value: "fake-secret",
    domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null }]);
  const gate = { run: vi.fn(async (_jobId: string, action: () => Promise<unknown>) => { order.push("gate"); return action(); }) };
  return { captured, repo, credentials, currentCookies, gate, order, setMetadataPresent: (value: boolean) => { metadataPresent = value; } };
}

describe("Toutiao captured request one-shot coordinator", () => {
  it("captures once only after the disk claim and never passes raw material to a Renderer result", async () => {
    const { captured, repo, credentials, currentCookies, gate, order } = fixture();
    const transport = vi.fn(async () => { order.push("node-post"); return { status: 200, responseShape: ["code"], platformCode: 0 }; });
    const adapter = { captureAbortedPublishRequest: vi.fn(async (_ctx: AccountContext, _article: { title: string; body: string },
      onCapture?: (request: typeof captured) => void, onReadbackReady?: () => void) => {
      order.push("readback"); onReadbackReady?.();
      order.push("browser-click"); onCapture?.(captured);
      return { status: "REQUEST_CAPTURED", remoteAuthState: "VALID", contentFilled: true, buttonTriggered: true,
        guard: { guardAbortFailed: false, publishAttemptCount: 1, blockedPublishCount: 1, publishSentCount: 0,
          draftSentCount: 0, uploadSentCount: 0 } };
    }) };
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport,
      gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies, () => "fixture-context");
    const result = await service.captureAndSubmit("job", { accountId: "account" } as AccountContext,
      adapter as unknown as Pick<ToutiaoArticleBrowserAdapter, "captureAbortedPublishRequest">,
      () => { order.push("disk-claim"); });
    expect(result.state).toBe("SUBMIT_ACCEPTED");
    expect(order.indexOf("readback")).toBeLessThan(order.indexOf("disk-claim"));
    expect(order.indexOf("disk-claim")).toBeLessThan(order.indexOf("browser-click"));
    expect(order.indexOf("final-claim")).toBeLessThan(order.indexOf("node-post"));
    expect(adapter.captureAbortedPublishRequest).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/fake-secret|fake-token|fake/u);
  });

  it("cannot run without an explicit app-owned runtime session proof", async () => {
    const { captured, repo, credentials, gate } = fixture();
    const transport = vi.fn(async () => ({ status: 200, responseShape: [], platformCode: 0 }));
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport,
      gate as unknown as Pick<GlobalPublishExecutionGate, "run">);
    expect(await service.submit("job", captured)).toMatchObject({ state: "BLOCKED_PRE_SUBMIT", reasonCode: "TOUTIAO_RUNTIME_SESSION_UNBOUND" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not click or send when the durable successor ticket cannot be claimed after readback", async () => {
    const { repo, credentials, currentCookies, gate } = fixture();
    const transport = vi.fn(async () => ({ status: 200, responseShape: [], platformCode: 0 }));
    let clicked = false;
    const adapter = { captureAbortedPublishRequest: vi.fn(async (_ctx: AccountContext,
      _article: { title: string; body: string }, _onCapture?: unknown, onReadbackReady?: () => void) => {
      onReadbackReady?.();
      clicked = true;
      throw new Error("unexpected editor continuation");
    }) };
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport,
      gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies, () => "fixture-context");
    const result = await service.captureAndSubmit("job", { accountId: "account" } as AccountContext,
      adapter as unknown as Pick<ToutiaoArticleBrowserAdapter, "captureAbortedPublishRequest">,
      () => { throw new Error("ticket already claimed"); });
    expect(result).toMatchObject({ state: "BLOCKED_PRE_SUBMIT", bindingReasonCode: "TICKET_NOT_ACTIVE" });
    expect(clicked).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(repo.claimFinalSubmitAttempt).not.toHaveBeenCalled();
  });

  it("never reaches Node when the browser abort is uncertain or two publish attempts were observed", async () => {
    for (const unsafeGuard of [{ guardAbortFailed: true, publishAttemptCount: 1, blockedPublishCount: 0 },
      { guardAbortFailed: false, publishAttemptCount: 2, blockedPublishCount: 2 }]) {
      const { captured, repo, credentials, currentCookies, gate } = fixture();
      const transport = vi.fn(async () => ({ status: 200, responseShape: [], platformCode: 0 }));
      const adapter = { captureAbortedPublishRequest: vi.fn(async (_ctx: AccountContext,
        _article: { title: string; body: string }, onCapture?: (request: typeof captured) => void) => {
        onCapture?.(captured);
        return { status: "REQUEST_CAPTURED", remoteAuthState: "VALID", contentFilled: true, buttonTriggered: true,
          guard: { ...unsafeGuard, publishSentCount: 0, draftSentCount: 0, uploadSentCount: 0 } };
      }) };
      const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
        credentials as unknown as ToutiaoCredentialBundleService, transport,
        gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies, () => "fixture-context");
      expect((await service.captureAndSubmit("job", { accountId: "account" } as AccountContext,
        adapter as unknown as Pick<ToutiaoArticleBrowserAdapter, "captureAbortedPublishRequest">,
        () => undefined)).state).toBe("BLOCKED_PRE_SUBMIT");
      expect(repo.claimFinalSubmitAttempt).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it("rejects a Context replacement between capture and submit before any durable submit claim", async () => {
    const { captured, repo, credentials, currentCookies, gate } = fixture();
    let contextId = "context-one";
    const transport = vi.fn(async () => ({ status: 200, responseShape: [], platformCode: 0 }));
    const adapter = { captureAbortedPublishRequest: vi.fn(async (_ctx: AccountContext,
      _article: { title: string; body: string }, onCapture?: (request: typeof captured) => void,
      onReadbackReady?: () => void) => {
      onReadbackReady?.();
      onCapture?.(captured);
      contextId = "context-two";
      return { status: "REQUEST_CAPTURED", remoteAuthState: "VALID", contentFilled: true, buttonTriggered: true,
        guard: { guardAbortFailed: false, publishAttemptCount: 1, blockedPublishCount: 1, publishSentCount: 0,
          draftSentCount: 0, uploadSentCount: 0 } };
    }) };
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport,
      gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies, () => contextId);
    expect(await service.captureAndSubmit("job", { accountId: "account" } as AccountContext,
      adapter as unknown as Pick<ToutiaoArticleBrowserAdapter, "captureAbortedPublishRequest">,
      () => undefined)).toMatchObject({ state: "BLOCKED_PRE_SUBMIT", bindingReasonCode: "BROWSER_SESSION_MISMATCH" });
    expect(repo.claimFinalSubmitAttempt).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a Bundle version or login generation change after capture", async () => {
    for (const field of ["bundleVersion", "loginGeneration"] as const) {
      const { captured, repo, credentials, currentCookies, gate } = fixture();
      const transport = vi.fn(async () => ({ status: 200, responseShape: [], platformCode: 0 }));
      const original = repo.getToutiaoCredentialMetadata();
      const adapter = { captureAbortedPublishRequest: vi.fn(async (_ctx: AccountContext,
        _article: { title: string; body: string }, onCapture?: (request: typeof captured) => void,
        onReadbackReady?: () => void) => {
        onReadbackReady?.();
        onCapture?.(captured);
        repo.getToutiaoCredentialMetadata.mockReturnValue({ ...original!, [field]: 2 });
        return { status: "REQUEST_CAPTURED", remoteAuthState: "VALID", contentFilled: true, buttonTriggered: true,
          guard: { guardAbortFailed: false, publishAttemptCount: 1, blockedPublishCount: 1, publishSentCount: 0,
            draftSentCount: 0, uploadSentCount: 0 } };
      }) };
      const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
        credentials as unknown as ToutiaoCredentialBundleService, transport,
        gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies, () => "context-one");
      expect(await service.captureAndSubmit("job", { accountId: "account" } as AccountContext,
        adapter as unknown as Pick<ToutiaoArticleBrowserAdapter, "captureAbortedPublishRequest">,
        () => undefined)).toMatchObject({ state: "BLOCKED_PRE_SUBMIT", bindingReasonCode:
          field === "bundleVersion" ? "CREDENTIAL_BUNDLE_VERSION_MISMATCH" : "LOGIN_GENERATION_MISMATCH" });
      expect(repo.claimFinalSubmitAttempt).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it("blocks before any Job or Intent mutation when credential metadata is absent", async () => {
    const { captured, repo, credentials, currentCookies, gate, setMetadataPresent } = fixture();
    setMetadataPresent(false);
    const transport = vi.fn(async () => ({ status: 200, responseShape: ["code"], platformCode: 0 }));
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport, gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies);
    expect(await service.submit("job", captured)).toMatchObject({ state: "BLOCKED_PRE_SUBMIT", reasonCode: "TOUTIAO_CREDENTIAL_BUNDLE_MISSING" });
    expect(gate.run).not.toHaveBeenCalled();
    expect(repo.prepareSubmissionIntent).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("persists the intent and final-submit count before one transport call, then stays pending", async () => {
    const { captured, repo, credentials, currentCookies, gate, order } = fixture();
    const transport = vi.fn(async () => { order.push("node-post"); return { status: 200, responseShape: ["code"], platformCode: 0 }; });
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport, gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies);
    expect(await service.submit("job", captured)).toMatchObject({ state: "SUBMIT_ACCEPTED", submissionAttemptId: "attempt" });
    expect(order.indexOf("record")).toBeLessThan(order.indexOf("final-claim"));
    expect(order.indexOf("final-claim")).toBeLessThan(order.indexOf("node-post"));
    expect(repo.markSubmissionIntentSubmitted).toHaveBeenCalledWith("intent", null, "SUBMIT_ACCEPTED");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("maps lost response to reconciliation and never replays", async () => {
    const { captured, repo, credentials, currentCookies, gate, order } = fixture();
    const transport = vi.fn(async () => { order.push("node-post"); throw new Error("lost response with fake-secret"); });
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport, gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies);
    const first = await service.submit("job", captured);
    expect(first).toMatchObject({ state: "NEEDS_RECONCILIATION", reasonCode: "TRANSPORT_RESPONSE_LOST" });
    expect(repo.markSubmissionIntentUncertain).toHaveBeenCalledWith("intent", "TIMEOUT");
    expect(JSON.stringify(first)).not.toContain("fake-secret");
    expect((await service.submit("job", captured)).state).toBe("BLOCKED_PRE_SUBMIT");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects a changed runtime cookie before claiming final submit", async () => {
    const { captured, repo, credentials, gate, currentCookies } = fixture();
    currentCookies.mockResolvedValue([{ name: "session", value: "rotated-session",
      domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null }]);
    const transport = vi.fn(async () => ({ status: 200, responseShape: [], platformCode: 0 }));
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport,
      gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies);
    expect(await service.submit("job", captured)).toMatchObject({ state: "BLOCKED_PRE_SUBMIT", reasonCode: "TOUTIAO_CAPTURE_BINDING_FAILED",
      bindingReasonCode: "COOKIE_BINDING_MISMATCH" });
    expect(repo.claimFinalSubmitAttempt).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("accepts an SDK cookie refresh before capture when the captured header still matches the live context", async () => {
    const { repo, credentials, gate, currentCookies } = fixture();
    const rotated = captureAbortedPublishRequest({ method: "POST",
      url: "https://mp.toutiao.com/mp/agw/article/publish?a_bogus=rotated&msToken=rotated",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "session=rotated-session" },
      body: Buffer.from("title=Test&content=%3Cp%3EHello%3C%2Fp%3E") }, Date.now());
    currentCookies.mockResolvedValue([{ name: "session", value: "rotated-session",
      domain: "mp.toutiao.com", path: "/", hostOnly: true, secure: true, expiresAt: null }]);
    const transport = vi.fn(async () => ({ status: 200, responseShape: ["code"], platformCode: 0 }));
    const service = new ToutiaoCapturedRequestOneShot(repo as unknown as AppRepository,
      credentials as unknown as ToutiaoCredentialBundleService, transport,
      gate as unknown as Pick<GlobalPublishExecutionGate, "run">, () => true, currentCookies);
    expect(await service.submit("job", rotated)).toMatchObject({ state: "SUBMIT_ACCEPTED" });
    expect(transport).toHaveBeenCalledOnce();
  });
});
