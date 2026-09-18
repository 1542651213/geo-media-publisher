import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry, createOwnerAuthorizedOneShotPublication, defaultCapabilities, ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, type PlatformAdapter } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { PublisherService } from "@publisher/publisher";
const XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID = "historical-test-account";
import type { Logger } from "@publisher/logger";
import { PlatformSelfTestService } from "../apps/desktop/src/main/platform-self-test";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const tempDirs: string[] = [];
const databases: Array<{ close: () => void }> = [];
const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const ACCEPTANCE_TITLE = "GMP发布验收2｜请忽略";
const ACCEPTANCE_BODY = "GEO Media Publisher 小红书自动发布最终验收测试。本内容仅用于验证上传、正文回读、发布事务与平台确认流程，请忽略。";

function explicitPayload(accountId: string, imageAssetId: string) {
  return { platformKey: "xiaohongshu" as const, accountId, creatorId: "123456789", title: ACCEPTANCE_TITLE, body: ACCEPTANCE_BODY, imageAssetId };
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "task10s-self-test-"));
  tempDirs.push(directory);
  const database = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(database.db);
  database.repository.seedDevelopment(platformCsv);
  const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10S 指定账号" });
  database.repository.db.prepare("UPDATE accounts SET id=? WHERE id=?").run(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, account.id);
  database.repository.syncBrowserPlatformAccount({ accountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, platformKey: "xiaohongshu", externalAccountId: "123456789", browserSessionId: "fixture-session", lastVerifiedAt: new Date().toISOString() });
  const imagePath = join(directory, "task10s-safe-test.png");
  writeFileSync(imagePath, Buffer.from("fixture"));
  const image = database.repository.createImageAsset({ brandId: database.repository.listBrands()[0]?.id ?? null, name: "Task10S SAFE_TEST_FIXTURE", filePath: imagePath, originalFileName: "task10s-safe-test.png", mimeType: "image/png", size: 7, tags: ["测试"], usage: ["测试"], platform: ["xiaohongshu"], universal: true });
  const publisher = new PublisherService(database.repository, new AdapterRegistry(), logger, { resolveSecrets: () => ({}) });
  const service = new PlatformSelfTestService({ repository: database.repository, registry: new AdapterRegistry(), publisher, resolveAccountSecrets: () => ({}), logger });
  return { database, service, image };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Task10S platform self-test entry", () => {
  it("prepares the existing one-shot without creating publish-domain rows or consuming authorization", async () => {
    const directory = mkdtempSync(join(tmpdir(), "task10s-prepublish-only-"));
    tempDirs.push(directory);
    const database = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(database.db);
    database.repository.seedDevelopment(platformCsv);
    const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10S prepublish-only" });
    database.repository.db.prepare("UPDATE accounts SET id=? WHERE id=?").run(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, account.id);
    database.repository.updateAccount(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, { enabled: true, loginStatus: "logged_in" });
    database.repository.syncBrowserPlatformAccount({ accountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, platformKey: "xiaohongshu", externalAccountId: "123456789", browserSessionId: "session-hash", lastVerifiedAt: "2026-09-02T00:00:00.000Z" });
    database.repository.createImageAsset({ brandId: database.repository.listBrands()[0]?.id ?? null, name: "Task10R SAFE_TEST_FIXTURE", filePath: "C:/safe/task10r-safe-test.png", originalFileName: "task10r-safe-test.png", mimeType: "image/png", size: 70, tags: ["测试"], usage: ["测试"], platform: ["xiaohongshu"], universal: true });
    const safePath = join(directory, "task10s-safe-test.png");
    writeFileSync(safePath, Buffer.from("fixture"));
    const safeFixture = database.repository.createImageAsset({ brandId: database.repository.listBrands()[0]?.id ?? null, name: "Task10S SAFE_TEST_FIXTURE", filePath: safePath, originalFileName: "task10s-safe-test.png", mimeType: "image/png", size: 7, tags: ["测试"], usage: ["测试"], platform: ["xiaohongshu"], universal: true });
    let receivedInput: { images?: string[] } | null = null;
    const receivedContext: { runtimeIdentityProof?: Record<string, unknown> } = {};
    const adapter = {
      platformKey: "xiaohongshu",
      manifest: { platformKey: "xiaohongshu", displayName: "XHS fixture", category: "测试", version: "test", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "WaitingForUser", researchStatus: "partial", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://creator.xiaohongshu.com/", credentialSchema: [], officialSources: ["https://creator.xiaohongshu.com/"] },
      getCapabilities: () => ({ ...defaultCapabilities, imagePost: true, coverImage: false }),
      getCredentialSchema: () => [],
      connectAccount: async () => ({ sessionId: "session", authorizationUrl: "https://creator.xiaohongshu.com/", expiresAt: null }),
      isConnectionPending: () => false,
      completeConnection: async () => "logged_in" as const,
      checkSession: async () => "logged_in" as const,
      checkLogin: async () => "logged_in" as const,
      getBrowserRuntimeSnapshot: () => ({ sessionExists: true, browserConnected: true, contextExists: true, canonicalPageExists: true, canonicalPageClosed: false, contextDebugId: "context", canonicalPageDebugId: "page" }),
      inspectCanonicalPageRuntime: async () => ({
        probeStatus: "PASS",
        failureStage: null,
        failureCode: null,
        failureErrorClass: null,
        canonicalContextId: "context",
        canonicalPageId: "page",
        probedContextId: "context",
        probedPageId: "page",
        pageContextMatchesSession: true,
        createdNewPage: false,
        browserConnected: true,
        pageClosed: false,
        runtimeAuthState: "AUTHENTICATED",
        playwrightPageUrl: "https://creator.xiaohongshu.com/new/home",
        domLocationHref: "https://creator.xiaohongshu.com/new/home",
        domLocationEvaluateStatus: "PASS",
        domLocationEvaluateErrorClass: null,
        pageUrlConsistency: "PASS",
        routeClass: "CREATOR_HOME",
        identityObservationStatus: "PASS",
        identitySourceCandidates: [{ sourceType: "VISIBLE_ACCOUNT_TEXT", stableIdentifierPresent: true, identifierFieldName: "externalCreatorId", sensitiveDataRequired: false, readOnlySafe: true, confidence: "HIGH", tagName: "SPAN", text: "123456789", href: null, role: null, dataIdentifierField: null, visible: true, source: "CREATOR_HOME_ACCOUNT_LABEL", rawValue: "123456789", normalizedCreatorId: "123456789", semanticAnchor: "xiaohongshu-account-id-label" }],
        identityDomDiagnosticMatchCount: 1,
        identityDomDiagnosticMatches: [],
        observedCreatorIdRaw: "123456789",
        observedCreatorIdNormalized: "123456789",
        observedDisplayName: null,
        observedProfileUrl: null
      }),
      preparePublish: async (context: unknown, input: { images?: string[] }) => {
        Object.assign(receivedContext, context as { runtimeIdentityProof?: Record<string, unknown> });
        receivedInput = input;
        return ({
        prepared: true,
        requiresUserAction: true,
        message: "prepared",
        sessionIdHash: "session-hash",
        backendUrl: "https://creator.xiaohongshu.com/publish/publish",
        editorOpenedAt: "2026-09-02T00:00:00.000Z",
        titleFilled: true,
        bodyFilled: true,
        response: {
          browserExecutionMode: "VISIBLE",
          headless: false,
          stage: "xiaohongshu_gate_only",
          titleReadbackValue: ACCEPTANCE_TITLE,
          bodyReadbackValue: ACCEPTANCE_BODY,
          imageUploaded: true,
          imageUploadRequired: true,
          events: ["IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_PASSED"],
          imageUploadEvidence: { mechanism: "input[type=file]", requestedCount: 1, previewCount: 1, previewVisible: true, uploadBusyCount: 0, verified: true },
          requiredFieldsStatus: "KNOWN",
          requiredFields: [],
          publishSettingsStatus: "KNOWN",
          publishSettings: [],
          finalSubmitControl: { verified: true, visible: true, enabled: true, unique: true, label: "发布", selector: "button", secondConfirmation: "absent" },
          finalSubmitClickCount: 0,
          finalSubmit: "discovered_but_not_clicked",
          jobCreated: false,
          intentCreated: false,
          publishRecordCreated: false
        }
        });
      }
    } as unknown as PlatformAdapter;
    const registry = { getForContent: () => adapter } as unknown as AdapterRegistry;
    const publisher = new PublisherService(database.repository, registry, logger, { resolveSecrets: () => ({}) });
    const service = new PlatformSelfTestService({ repository: database.repository, registry, publisher, resolveAccountSecrets: () => ({}), logger });
    const requested = service.requestOneShotPublish(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, explicitPayload(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, safeFixture.id));
    const authorization = { ...createOwnerAuthorizedOneShotPublication({ platformKey: "xiaohongshu", accountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, operationId: requested.testRunId, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE }), contentBindingId: requested.contentBindingId };
    database.repository.confirmPlatformSelfTestOneShotAtomically(requested.testRunId, authorization);
    database.repository.recordPlatformSelfTestStep({ testRunId: requested.testRunId, testLevel: "L5_PUBLISH", stepKey: "PUBLISH_SUBMIT", startedAt: new Date().toISOString(), result: "FAILED", errorCode: "ONE_SHOT_PREPUBLISH_EVIDENCE_INCOMPLETE", message: "fixture blocker" });

    const prepare = (service as unknown as { prepareOneShotPrepublish?: (testRunId: string) => Promise<{ status: string; preparedContent: { prepared: boolean; imageAssetId: string | null }; finalSubmit: { clickCount: number }; readyToResumeExistingOneShot: boolean }> }).prepareOneShotPrepublish;
    expect(typeof prepare).toBe("function");
    if (typeof prepare !== "function") return;
    const result = await prepare.call(service, requested.testRunId);

    expect(result.status).toBe("READY_FOR_FINAL_SUBMIT");
    expect(result.preparedContent).toMatchObject({ prepared: true, imageAssetId: expect.any(String) });
    expect(result.finalSubmit.clickCount).toBe(0);
    expect(result.readyToResumeExistingOneShot).toBe(true);
    expect((receivedInput as { images?: string[] } | null)?.images).toEqual([safeFixture.filePath]);
    expect((receivedInput as { body?: string } | null)?.body).toBe(ACCEPTANCE_BODY);
    expect(receivedContext.runtimeIdentityProof).toMatchObject({
      accountId: XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID,
      platformKey: "xiaohongshu",
      expectedExternalCreatorId: "123456789",
      observedExternalCreatorId: "123456789",
      canonicalContextId: "context",
      canonicalPageId: "page",
      verified: true
    });
    expect(result.preparedContent.imageAssetId).toBe(safeFixture.id);
    expect(database.repository.listJobs()).toHaveLength(0);
    expect(database.repository.db.prepare("SELECT COUNT(*) AS count FROM submission_intents").get()).toMatchObject({ count: 0 });
    expect(database.repository.getPublishRecords()).toHaveLength(0);
    expect(database.repository.getOneShotPublicationAuthorization(requested.testRunId)).toMatchObject({ state: "AUTHORIZED_UNUSED", publicationTransactionCount: 0, finalSubmitAttemptCount: 0 });
  });

  it("accepts structured XHS image upload evidence as a passing IMAGE_FILL proof", async () => {
    const directory = mkdtempSync(join(tmpdir(), "task10s-image-evidence-"));
    tempDirs.push(directory);
    const database = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(database.db);
    database.repository.seedDevelopment(platformCsv);
    const account = database.repository.createAccount({ platformKey: "xiaohongshu", name: "Task10S structured image evidence" });
    database.repository.db.prepare("UPDATE accounts SET id=? WHERE id=?").run(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, account.id);
    database.repository.updateAccount(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, { enabled: true, loginStatus: "logged_in" });
    const image = database.repository.createImageAsset({ brandId: database.repository.listBrands()[0]?.id ?? null, name: "Task10S SAFE_TEST_FIXTURE", filePath: "C:/safe/task10s-safe-test.png", originalFileName: "task10s-safe-test.png", mimeType: "image/png", size: 70, tags: ["测试"], usage: ["测试"], platform: ["xiaohongshu"], universal: true });
    const adapter = {
      platformKey: "xiaohongshu",
      manifest: { platformKey: "xiaohongshu", displayName: "XHS fixture", category: "测试", version: "test", adapterStatus: "ready", authStrategy: "ManualSession", callbackStrategy: "ManualCodeCallback", status: "WaitingForUser", researchStatus: "partial", transport: "browser", integrationMode: "BrowserAutomation", supportsArticle: true, supportsVideo: false, officialWebsite: "https://creator.xiaohongshu.com/", credentialSchema: [], officialSources: ["https://creator.xiaohongshu.com/"] },
      getCapabilities: () => ({ ...defaultCapabilities, imagePost: true, coverImage: false }),
      getCredentialSchema: () => [],
      connectAccount: async () => ({ sessionId: "session", authorizationUrl: "https://creator.xiaohongshu.com/", expiresAt: null }),
      isConnectionPending: () => false,
      completeConnection: async () => "logged_in" as const,
      checkSession: async () => "logged_in" as const,
      checkLogin: async () => "logged_in" as const,
      preparePublish: async () => ({
        prepared: true,
        requiresUserAction: true,
        message: "prepared",
        titleFilled: true,
        bodyFilled: true,
        response: {
          browserExecutionMode: "VISIBLE",
          headless: false,
          stage: "editor_prepared",
          imageUploaded: true,
          imageUploadRequired: true,
          events: ["IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_PASSED"],
          imageUploadEvidence: { mechanism: "input[type=file]", requestedCount: 1, previewCount: 1, previewVisible: true, uploadBusyCount: 0, verified: true }
        }
      })
    } as unknown as PlatformAdapter;
    const registry = { getForContent: () => adapter } as unknown as AdapterRegistry;
    const publisher = new PublisherService(database.repository, registry, logger, { resolveSecrets: () => ({}) });
    const service = new PlatformSelfTestService({ repository: database.repository, registry, publisher, resolveAccountSecrets: () => ({}), logger });

    const run = await service.runLevel(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, "L3_CONTENT_FILL");

    expect(run.steps.find((step) => step.stepKey === "IMAGE_FILL")?.result).toBe("PASSED");
    expect(run.steps.find((step) => step.stepKey === "IMAGE_UPLOAD_PASSED")?.result).toBe("PASSED");
    expect(database.repository.listJobs()).toHaveLength(0);
    expect(database.repository.getPublishRecords()).toHaveLength(0);
    expect(database.repository.listImageAssets(undefined, true)).toHaveLength(1);
    expect(image.originalFileName).toBe("task10s-safe-test.png");
  });

  it("does not create authorization or a publish job before owner confirmation", () => {
    const { database, service, image } = fixture();
    const requested = service.requestOneShotPublish(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, explicitPayload(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, image.id));
    expect(requested.overallResult).toBe("WAITING_FOR_USER");
    expect(requested.steps.find((item) => item.errorCode === "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED")?.message).toBe("本次会真实发布 1 条测试笔记，最多提交一次。");
    expect(database.repository.listJobs()).toHaveLength(0);
    expect(database.repository.getOneShotPublicationAuthorization(requested.testRunId)).toBeNull();
  });

  it("cancels without granting authorization", () => {
    const { database, service, image } = fixture();
    const requested = service.requestOneShotPublish(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, explicitPayload(XIAOHONGSHU_ONE_SHOT_ACCOUNT_ID, image.id));
    const cancelled = service.cancelOneShotPublish(requested.testRunId);
    expect(cancelled.overallResult).toBe("NOT_TESTED");
    expect(cancelled.steps.at(-1)?.errorCode).toBe("ONE_SHOT_PUBLISH_CANCELLED");
    expect(database.repository.listJobs()).toHaveLength(0);
  });
});
