import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry, defaultCapabilities, type AutomationAdapter, type AutomationPrepareResult } from "@publisher/adapters-core";
import { openDatabase } from "@publisher/db";
import { TestPlatformAdapter } from "@publisher/adapters-test";
import { PublisherService } from "@publisher/publisher";
import type { AccountContext, AdapterManifest, LoginSession, LoginStatus, PublishArticleInput, PublishResult, PublishStatusResult, ValidationResult } from "@publisher/domain";
import type { Logger } from "@publisher/logger";
import { PlatformSelfTestService } from "../apps/desktop/src/main/platform-self-test";

const migrationDir = join(process.cwd(), "packages", "db", "migrations");
const platformCsv = join(process.cwd(), "PLATFORMS.csv");
const temporaryDirectories: string[] = [];
const databases: Array<{ close: () => void; open?: boolean }> = [];
const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
type Scenario = "pass" | "background_technical_failure" | "security_check" | "image_failure" | "upload_failure_with_qr_copy" | "cover_evidence";

class BackgroundTestAdapter implements AutomationAdapter {
  readonly platformKey = "zhihu";
  readonly automationType = "BrowserAutomation" as const;
  readonly manifest: AdapterManifest = {
    platformKey: "zhihu",
    displayName: "知乎",
    category: "图文/问答",
    version: "1.1.4-test",
    adapterStatus: "ready",
    authStrategy: "ManualSession",
    callbackStrategy: "ManualCodeCallback",
    status: "CodeComplete",
    researchStatus: "partial",
    transport: "browser",
    integrationMode: "BrowserAutomation",
    supportsArticle: true,
    supportsVideo: false,
    officialWebsite: "https://www.zhihu.com/",
    credentialSchema: [],
    officialSources: ["https://www.zhihu.com/"]
  };
  readonly modes: string[] = [];
  closeCount = 0;

  constructor(private readonly scenario: Scenario) {}

  getCapabilities() { return { ...defaultCapabilities, imagePost: true, coverImage: true, maxImageCount: 1 }; }
  getCredentialSchema() { return []; }
  async connectAccount(_ctx: AccountContext): Promise<LoginSession> { return { sessionId: "session", requiresUserAction: true }; }
  isConnectionPending(_ctx: AccountContext): boolean { return false; }
  async completeConnection(_ctx: AccountContext): Promise<LoginStatus> { return "logged_in"; }
  async checkSession(ctx: AccountContext): Promise<LoginStatus> { return this.checkLogin(ctx); }
  async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const mode = String(ctx.settings.browserExecutionMode);
    this.modes.push(`login:${mode}:${String(ctx.settings.triggerSource)}`);
    if (this.scenario === "security_check") throw codedError("CAPTCHA", "知乎要求验证码安全验证");
    return "logged_in";
  }
  async beginLogin(ctx: AccountContext): Promise<LoginSession> { return this.connectAccount(ctx); }
  async openBackend(_ctx: AccountContext) { return { opened: true, backendUrl: "https://zhuanlan.zhihu.com/write", sessionIdHash: "hash" }; }
  async preparePublish(ctx: AccountContext, _article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const mode = String(ctx.settings.browserExecutionMode);
    this.modes.push(`prepare:${mode}:${String(ctx.settings.triggerSource)}`);
    if (this.scenario === "background_technical_failure" && mode === "BACKGROUND") throw codedError("PLATFORM_CHANGED", "headless editor unavailable");
    if (this.scenario === "upload_failure_with_qr_copy") throw codedError("UPLOAD_FAILED", "图片未插入；高级诊断面板同时包含手机扫码上传说明");
    const imagePassed = this.scenario !== "image_failure";
    return {
      prepared: true,
      requiresUserAction: true,
      message: "prepared",
      backendUrl: "https://zhuanlan.zhihu.com/write",
      editorOpenedAt: new Date().toISOString(),
      titleFilled: true,
      bodyFilled: true,
      response: {
        stage: "editor_prepared",
        browserExecutionMode: mode,
        headless: mode === "BACKGROUND",
        ...(this.scenario === "cover_evidence"
          ? { imageRequirement: "cover_uploaded", coverInputVerified: true, coverUploadMethod: "file_input" }
          : {
              imageUploaded: imagePassed,
              events: imagePassed ? ["IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_PASSED"] : ["IMAGE_UPLOAD_STARTED", "IMAGE_UPLOAD_FAILED"],
              ...(imagePassed ? { imageUploadEvidence: "editor_image_count_increased_and_remote_image_loaded" } : {})
            })
      }
    };
  }
  async verifyPublish(_ctx: AccountContext, externalId?: string): Promise<PublishStatusResult> { return { status: "publishing", externalId, response: {} }; }
  async logout(_ctx: AccountContext): Promise<void> { return undefined; }
  async closeOwnedSessions(): Promise<void> { this.closeCount += 1; }
  async publishArticle(_ctx: AccountContext, _article: PublishArticleInput): Promise<PublishResult> { return { success: true, response: {} }; }
  async validateArticle(_article: PublishArticleInput): Promise<ValidationResult> { return { valid: true, errors: [], warnings: [] }; }
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function browserFixture(scenario: Scenario, withImage = true) {
  const directory = mkdtempSync(join(tmpdir(), "publisher-v114-background-"));
  temporaryDirectories.push(directory);
  const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
  databases.push(opened.db);
  opened.repository.seedDevelopment(platformCsv);
  const adapter = new BackgroundTestAdapter(scenario);
  const registry = new AdapterRegistry();
  registry.register(adapter);
  const publisher = new PublisherService(opened.repository, registry, logger, { resolveSecrets: () => ({}) });
  const service = new PlatformSelfTestService({ repository: opened.repository, registry, publisher, resolveAccountSecrets: () => ({}), logger });
  const account = opened.repository.createAccount({ platformKey: "zhihu", name: "知乎真实会话测试账号" });
  opened.repository.updateAccount(account.id, { enabled: true, loginStatus: "logged_in" });
  if (withImage) opened.repository.createImageAsset({ brandId: null, name: "通用测试图", filePath: "C:/safe-test/image.jpg", originalFileName: "image.jpg", mimeType: "image/jpeg", size: 1, usage: ["测试"], universal: true });
  return { ...opened, adapter, service, account };
}

afterEach(() => {
  for (const database of databases.splice(0)) if (database.open !== false) database.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("V1.1.7 visible Playwright self-test harness", () => {
  it("defaults to UNKNOWN and persists an audited background status", () => {
    const fixture = browserFixture("pass");
    expect(fixture.repository.listPlatforms().find((platform) => platform.platformKey === "zhihu")).toMatchObject({
      backgroundAutomationStatus: "UNKNOWN",
      backgroundAutomationLastTestedAt: null,
      backgroundAutomationReason: null
    });
    const updated = fixture.repository.updatePlatformBackgroundAutomation("zhihu", "FAILED", "headless failed");
    expect(updated).toMatchObject({ backgroundAutomationStatus: "FAILED", backgroundAutomationReason: "headless failed" });
    expect(updated.backgroundAutomationLastTestedAt).not.toBeNull();
  });

  it("uses one visible owned Browser session and DOM-backed image evidence", async () => {
    const fixture = browserFixture("pass");
    const run = await fixture.service.runSafe(fixture.account.id);
    expect(run.overallResult).toBe("PASSED");
    expect(run.steps.find((step) => step.stepKey === "IMAGE_FILL")).toMatchObject({ result: "PASSED" });
    expect(run.steps.find((step) => step.stepKey === "IMAGE_UPLOAD_PASSED")).toMatchObject({ result: "PASSED" });
    expect(fixture.repository.listPlatforms().find((platform) => platform.platformKey === "zhihu")?.backgroundAutomationStatus).toBe("UNKNOWN");
    expect(fixture.adapter.modes).toEqual(["login:VISIBLE:RUN_SELF_TEST", "prepare:VISIBLE:RUN_SELF_TEST"]);
    expect(fixture.adapter.closeCount).toBeGreaterThan(0);
    expect(fixture.repository.listJobs()).toHaveLength(0);
  });

  it("does not perform a background attempt or visible fallback in the first round", async () => {
    const fixture = browserFixture("background_technical_failure");
    const run = await fixture.service.runSafe(fixture.account.id);
    expect(run.overallResult).toBe("PASSED");
    expect(fixture.adapter.modes).toEqual(["login:VISIBLE:RUN_SELF_TEST", "prepare:VISIBLE:RUN_SELF_TEST"]);
    expect(fixture.repository.listPlatforms().find((platform) => platform.platformKey === "zhihu")).toMatchObject({ backgroundAutomationStatus: "UNKNOWN", backgroundAutomationReason: null });
  });

  it("never opens a visible fallback after CAPTCHA or another security gate", async () => {
    const fixture = browserFixture("security_check");
    const run = await fixture.service.runSafe(fixture.account.id);
    expect(run.overallResult).toBe("WAITING_FOR_USER");
    expect(fixture.adapter.modes).toEqual(["login:VISIBLE:RUN_SELF_TEST"]);
    expect(fixture.repository.listPlatforms().find((platform) => platform.platformKey === "zhihu")).toMatchObject({ backgroundAutomationStatus: "UNKNOWN", backgroundAutomationReason: null });
  });

  it("does not write PASS when image upload lacks editor DOM evidence", async () => {
    const fixture = browserFixture("image_failure");
    const run = await fixture.service.runSafe(fixture.account.id);
    expect(run.overallResult).toBe("FAILED");
    expect(run.steps.find((step) => step.stepKey === "IMAGE_UPLOAD_FAILED")).toMatchObject({ result: "FAILED", errorCode: "IMAGE_UPLOAD_FAILED" });
    expect(fixture.repository.listPlatforms().find((platform) => platform.platformKey === "zhihu")?.backgroundAutomationStatus).toBe("UNKNOWN");
  });

  it("accepts Toutiao cover evidence as strict image evidence", async () => {
    const fixture = browserFixture("cover_evidence");
    const run = await fixture.service.runSafe(fixture.account.id);
    expect(run.overallResult).toBe("PASSED");
    expect(run.steps.find((step) => step.stepKey === "IMAGE_FILL")).toMatchObject({ result: "PASSED" });
    expect(run.steps.find((step) => step.stepKey === "IMAGE_UPLOAD_PASSED")).toMatchObject({ result: "PASSED" });
  });

  it("does not misclassify upload diagnostics containing QR-copy as a security gate", async () => {
    const fixture = browserFixture("upload_failure_with_qr_copy");
    const run = await fixture.service.runSafe(fixture.account.id);
    expect(run.overallResult).toBe("FAILED");
    expect(fixture.adapter.modes).toEqual(["login:VISIBLE:RUN_SELF_TEST", "prepare:VISIBLE:RUN_SELF_TEST"]);
    expect(run.steps.filter((step) => step.errorCode === "UPLOAD_FAILED").every((step) => step.result === "FAILED")).toBe(true);
  });

  it("keeps image absence explicit and never applies the status to API platforms", async () => {
    const noImage = browserFixture("pass", false);
    const noImageRun = await noImage.service.runSafe(noImage.account.id);
    expect(noImageRun.overallResult).toBe("PASSED");
    expect(noImage.adapter.modes).toEqual(["login:VISIBLE:RUN_SELF_TEST", "prepare:VISIBLE:RUN_SELF_TEST"]);
    expect(noImage.repository.listPlatforms().find((platform) => platform.platformKey === "zhihu")?.backgroundAutomationStatus).toBe("UNKNOWN");

    const directory = mkdtempSync(join(tmpdir(), "publisher-v114-api-background-"));
    temporaryDirectories.push(directory);
    const opened = openDatabase(join(directory, "publisher.db"), migrationDir);
    databases.push(opened.db);
    opened.repository.seedDevelopment(platformCsv);
    const registry = new AdapterRegistry();
    registry.register(new TestPlatformAdapter());
    const account = opened.repository.createAccount({ platformKey: "test", name: "API 测试账号" });
    const publisher = new PublisherService(opened.repository, registry, logger, { resolveSecrets: () => ({}) });
    const service = new PlatformSelfTestService({ repository: opened.repository, registry, publisher, resolveAccountSecrets: () => ({}), logger });
    await service.runSafe(account.id);
    expect(opened.repository.listPlatforms().find((platform) => platform.platformKey === "test")?.backgroundAutomationStatus).toBe("UNKNOWN");
  });
});
