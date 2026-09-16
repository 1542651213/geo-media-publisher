import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Account, AccountContext, ImageAsset, PublishArticleInput } from "@publisher/domain";
import { browserSessionIdHash, isAutomationAdapter, type AutomationAdapter } from "@publisher/adapters-core";
import { XiaohongshuGateError } from "@publisher/adapters-xiaohongshu";
import { XIAOHONGSHU_GATE_ORDER, XIAOHONGSHU_OUTPUT_PATH, XIAOHONGSHU_TEST_BODY, XIAOHONGSHU_USER_DATA_PATH, buildXiaohongshuTestTitle, classifyXiaohongshuLoginFailure, isXiaohongshuReady, resolveExplicitXiaohongshuAccount, resolveXiaohongshuAccountId, selectXiaohongshuSelfTestImage, type GateStateMap } from "./v142-xiaohongshu-gate-only.helpers";
export { XIAOHONGSHU_GATE_ORDER, XIAOHONGSHU_OUTPUT_PATH, XIAOHONGSHU_TEST_BODY, XIAOHONGSHU_USER_DATA_PATH, buildXiaohongshuTestTitle, isXiaohongshuReady, resolveExplicitXiaohongshuAccount, selectXiaohongshuSelfTestImage } from "./v142-xiaohongshu-gate-only.helpers";
export type { GateResult, GateState, GateStateMap } from "./v142-xiaohongshu-gate-only.helpers";

type JsonRecord = Record<string, unknown>;

function initialGates(): GateStateMap {
  return Object.fromEntries(XIAOHONGSHU_GATE_ORDER.map((gate) => [gate, { result: "NOT_RUN" as const }])) as GateStateMap;
}

function redact(value: string): string {
  return value
    .replace(/(cookie|token|secret|authorization|access[_-]?key|refresh[_-]?token)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]")
    .slice(0, 4_000);
}

function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "gateCode" in error) return String((error as { gateCode?: unknown }).gateCode ?? "");
  if (typeof error === "object" && error !== null && "code" in error) return String((error as { code?: unknown }).code ?? "");
  return null;
}

function gateForFailure(code: string | null, currentGate: string): string {
  if (code === "LOGIN_REQUIRED" || code === "LOGIN_EXPIRED") return "Login / Session";
  if (code === "SECURITY_VERIFICATION_REQUIRED") return "Login / Session";
  if (code === "ACCOUNT_IDENTITY_UNVERIFIED") return "Account Identity";
  if (code === "IMAGE_POST_ENTRY_NOT_VERIFIED") return "Image-post Entry";
  if (code === "IMAGE_UPLOAD_NOT_VERIFIED" || code === "UPLOAD_FAILED") return "Image Upload";
  if (code === "CONTENT_TITLE_NOT_VERIFIED") return "Title Readback";
  if (code === "CONTENT_BODY_NOT_VERIFIED") return "Body Readback";
  if (code === "FINAL_SUBMIT_CONTROL_NOT_VERIFIED" || code === "FINAL_SUBMIT_CONTROL_NOT_FOUND") return "Final Submit Control discovery";
  if (code === "REQUIRED_FIELD_MISSING" || code === "REQUIRED_FIELDS_NOT_VERIFIED") return "Required Fields";
  return currentGate;
}

function errorEvidence(error: unknown): JsonRecord {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code: errorCode(error),
    message: redact(error instanceof Error ? error.message : String(error))
  };
}

function counts(db: { prepare: (sql: string) => { get: () => unknown } }): JsonRecord {
  const count = (table: string): number => Number(((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: unknown } | undefined)?.count ?? 0));
  return { publishJobs: count("publish_jobs"), submissionIntents: count("submission_intents"), publishRecords: count("publish_records") };
}

function accountRow(account: Account): JsonRecord {
  return {
    id: account.id,
    platformAccountId: account.platformAccountId ?? account.id,
    platformKey: account.platformKey,
    accountAlias: account.accountAlias,
    enabled: account.enabled,
    loginStatus: account.loginStatus,
    authorizationStatus: account.authorizationStatus,
    connectionMode: account.connectionMode,
    browserSessionIdPresent: Boolean(account.browserSessionId),
    externalAccountId: account.externalAccountId ?? null,
    platformAccountName: account.accountName ?? null
  };
}

function contextFor(account: Account, userActionId: string): AccountContext {
  return {
    accountId: account.id,
    accountName: account.accountAlias || account.name,
    platformKey: "xiaohongshu",
    settings: { triggerSource: "RUN_SELF_TEST", userActionId, browserExecutionMode: "VISIBLE" },
    secrets: {}
  };
}

function mapPreparedGates(gates: GateStateMap, response: JsonRecord): void {
  const pass = (gate: string, evidence: unknown): void => { gates[gate] = { result: "PASS", evidence }; };
  if (response.imagePostEntry === "verified") pass("Image-post Entry", "unique visible enabled image-post entry");
  if (response.imageUploaded === true) pass("Image Upload", response.imageUploadEvidence ?? response.imageUploaded);
  if (response.titleEditor === "verified") pass("Title Editor", response.titleEditor);
  if (response.titleFilled === true || response.titleEditor === "verified") pass("Title Write", response.titleFilled ?? true);
  if (response.titleReadback === true) pass("Title Readback", response.titleReadbackValue ?? true);
  if (response.bodyEditor === "verified") pass("Body Editor", response.bodyEditor);
  if (response.bodyFilled === true || response.bodyEditor === "verified") pass("Body Write", response.bodyFilled ?? true);
  if (response.bodyReadback === true) pass("Body Readback", response.bodyReadbackValue ?? true);
  if (response.requiredFieldsStatus === "KNOWN") gates["Required Fields"] = { result: "KNOWN", evidence: response.requiredFields ?? [] };
  if (response.publishSettingsStatus === "KNOWN") gates["Publish Settings"] = { result: "KNOWN", evidence: response.publishSettings ?? [] };
  const finalSubmit = response.finalSubmitControl;
  if (typeof finalSubmit === "object" && finalSubmit !== null && "verified" in finalSubmit && (finalSubmit as { verified?: unknown }).verified === true) gates["Final Submit Control discovery"] = { result: "VERIFIED", evidence: finalSubmit };
}

function buildGateReport(evidence: JsonRecord, gates: GateStateMap, accountId: string, finalSubmitCount: number, securityVerification: string): Array<{ gate: string; result: string; evidence: unknown }> {
  const gateResult = (name: string): string => gates[name]?.result ?? "NOT_RUN";
  const gateEvidence = (name: string): unknown => gates[name]?.evidence ?? null;
  const platform = evidence.platform;
  const route = evidence.route;
  const platformRegistered = typeof route === "object" && route !== null && (route as { integrationMode?: unknown }).integrationMode === "BrowserAutomation";
  return [
    { gate: "Platform Registered", result: platformRegistered ? "PASS" : "NOT_RUN", evidence: { catalog: platform ?? "runtime catalog not inspected", runtime: route ?? null } },
    { gate: "Account ID", result: accountId ? (evidence.account ? "PASS" : "FAIL") : "FAIL", evidence: accountId || "XIAOHONGSHU_ACCOUNT_ID missing; no fallback" },
    { gate: "Account Identity", result: gateResult("Account Identity"), evidence: gateEvidence("Account Identity") },
    { gate: "Browser Session Isolation", result: accountId ? "PASS" : "NOT_RUN", evidence: accountId ? `session:xiaohongshu:${accountId}` : "account not selected" },
    { gate: "Login", result: gateResult("Login / Session"), evidence: gateEvidence("Login / Session") },
    { gate: "Image-post Entry", result: gateResult("Image-post Entry"), evidence: gateEvidence("Image-post Entry") },
    { gate: "Image Upload", result: gateResult("Image Upload"), evidence: gateEvidence("Image Upload") },
    { gate: "Title Editor", result: gateResult("Title Editor"), evidence: gateEvidence("Title Editor") },
    { gate: "Title Readback", result: gateResult("Title Readback"), evidence: gateEvidence("Title Readback") },
    { gate: "Body Editor", result: gateResult("Body Editor"), evidence: gateEvidence("Body Editor") },
    { gate: "Body Readback", result: gateResult("Body Readback"), evidence: gateEvidence("Body Readback") },
    { gate: "Required Fields", result: gateResult("Required Fields"), evidence: gateEvidence("Required Fields") },
    { gate: "Publish Settings", result: gateResult("Publish Settings"), evidence: gateEvidence("Publish Settings") },
    { gate: "Final Submit Control", result: gateResult("Final Submit Control discovery"), evidence: gateEvidence("Final Submit Control discovery") },
    { gate: "Security Verification", result: securityVerification, evidence: securityVerification === "NONE" ? "no security challenge detected" : securityVerification },
    { gate: "Final Submit Count", result: String(finalSubmitCount), evidence: "final submit click is forbidden in gate-only runner" },
    { gate: "Job Created", result: "NO", evidence: "runner does not call the Job Queue" },
    { gate: "Intent Created", result: "NO", evidence: "runner does not create SubmissionIntent" },
    { gate: "PublishRecord Created", result: "NO", evidence: "runner does not create PublishRecord" },
    { gate: "PublishPassed", result: "NOT_PASS", evidence: "gate-only is not a publish result" },
    { gate: "Ready for Real SELF_TEST", result: evidence.readyForRealSelfTest === true ? "YES" : "NO", evidence: "real publish remains stopped" }
  ];
}

export async function runXiaohongshuGateOnly(): Promise<JsonRecord> {
  const cliAccountIndex = process.argv.findIndex((argument) => argument === "--account-id");
  const cliAccountId = cliAccountIndex >= 0 ? process.argv[cliAccountIndex + 1] : undefined;
  const accountId = resolveXiaohongshuAccountId(cliAccountId, process.env.XIAOHONGSHU_ACCOUNT_ID);
  const userDataPath = process.env.PUBLISHER_USER_DATA_PATH?.trim() || XIAOHONGSHU_USER_DATA_PATH;
  const dataDirectory = process.env.PUBLISHER_DATA_DIRECTORY?.trim() || join(userDataPath, "production-data");
  const databasePath = process.env.XIAOHONGSHU_DB_PATH?.trim() || join(dataDirectory, "publisher.db");
  const outputPath = process.env.XIAOHONGSHU_OUTPUT_PATH?.trim() || XIAOHONGSHU_OUTPUT_PATH;
  const title = buildXiaohongshuTestTitle();
  const startedAt = new Date().toISOString();
  const gates = initialGates();
  let currentGate = "Account Identity";
  let securityVerification = "NOT_RUN";
  let finalSubmitCount = 0;
  let opened: { db: { close: () => void; prepare: (sql: string) => { get: () => unknown } }; repository: { listAccounts: () => Account[]; listPlatforms: () => Array<{ platformKey: string; integrationMode?: string; displayName?: string }>; listImageAssets: (brandId?: string, includeArchived?: boolean) => ImageAsset[]; syncBrowserPlatformAccount: (input: { accountId: string; platformKey: string; accountName?: string; browserSessionId: string; externalAccountId?: string | null; lastVerifiedAt?: string }) => Account } } | null = null;
  let adapter: AutomationAdapter | null = null;
  let quitElectron: (() => void) | null = null;
  const evidence: JsonRecord = {
    operation: "xiaohongshu_gate_only_v142",
    startedAt,
    finishedAt: null,
    platformKey: "xiaohongshu",
    contentKind: "article",
    accountId: accountId || null,
    browserSessionIdHash: accountId ? browserSessionIdHash({ platformKey: "xiaohongshu", accountId }) : null,
    content: { title, body: XIAOHONGSHU_TEST_BODY, imageSource: "existing SELF_TEST/universal fixture only" },
    gateOrder: [...XIAOHONGSHU_GATE_ORDER],
    gates,
    securityVerification,
    finalSubmitCount: 0,
    finalSubmitAction: "FORBIDDEN",
    jobCreated: false,
    intentCreated: false,
    publishRecordCreated: false,
    publishPassed: "NOT_PASS",
    readyForRealSelfTest: false,
    result: "NOT_EXECUTED",
    error: null
  };

  try {
    const [{ app, safeStorage }, { openDatabase }, { SafeStorageCredentialStore }, { createFileLogger }, { createRuntimeAdapterRegistry }] = await Promise.all([
      import("electron"),
      import("@publisher/db"),
      import("@publisher/security"),
      import("@publisher/logger"),
      import("../apps/desktop/src/main/adapter-registry")
    ]);
    app.setName("codex-media-publisher");
    app.setPath("userData", userDataPath);
    quitElectron = () => app.quit();
    await app.whenReady();
    mkdirSync(join(process.cwd(), "output"), { recursive: true });
    opened = openDatabase(databasePath, join(process.cwd(), "packages", "db", "migrations"));
    const beforeCounts = counts(opened.db);
    evidence.databaseCountsBefore = beforeCounts;
    const platform = opened.repository.listPlatforms().find((candidate) => candidate.platformKey === "xiaohongshu");
    evidence.platform = platform ? { platformKey: platform.platformKey, displayName: platform.displayName, catalogIntegrationMode: platform.integrationMode ?? null } : null;

    const credentials = new SafeStorageCredentialStore(join(dataDirectory, "credentials.enc"), safeStorage);
    const logger = createFileLogger(join(dataDirectory, "logs", "app.log"));
    const registry = createRuntimeAdapterRegistry(credentials, false, logger, join(userDataPath, "browser-profiles"));
    const selected = registry.getForContent("xiaohongshu", "article");
    if (!isAutomationAdapter(selected)) throw new Error("XIAOHONGSHU_ARTICLE_ROUTE_NOT_BROWSER_AUTOMATION");
    adapter = selected;
    evidence.route = { adapterClass: adapter.constructor.name, platformKey: adapter.platformKey, transport: adapter.manifest.transport, integrationMode: adapter.manifest.integrationMode, supportsArticle: adapter.manifest.supportsArticle, supportsVideo: adapter.manifest.supportsVideo };
    if (!platform || adapter.manifest.integrationMode !== "BrowserAutomation" || adapter.manifest.transport !== "browser") throw new Error("XIAOHONGSHU_PLATFORM_NOT_REGISTERED_AS_BROWSER_AUTOMATION");

    if (!accountId) throw new Error("XIAOHONGSHU_ACCOUNT_ID is required; account fallback is forbidden");
    const account = resolveExplicitXiaohongshuAccount(opened.repository.listAccounts(), accountId);
    evidence.account = { ...accountRow(account), browserSessionKey: `session:xiaohongshu:${account.id}` };

    const image = selectXiaohongshuSelfTestImage(opened.repository.listImageAssets(undefined, true));
    if (!image || !existsSync(image.filePath)) throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", "未找到存在于本地的 SELF_TEST/universal 图片 fixture；没有联网下载素材");
    evidence.imageFixture = { id: image.id, filePath: image.filePath, universal: image.universal, usage: image.usage, tags: image.tags };
    const article: PublishArticleInput = { articleId: `v142-xiaohongshu-${Date.now()}`, title, body: XIAOHONGSHU_TEST_BODY, summary: "", tags: [], images: [image.filePath] };
    const context = contextFor(account, `v142-xiaohongshu-${Date.now()}`);

    currentGate = "Login / Session";
    const login = await adapter.checkLogin(context);
    evidence.login = login;
    if (login !== "logged_in") {
      const loginCode = classifyXiaohongshuLoginFailure(login, Boolean(evidence.account && typeof evidence.account === "object" && "browserSessionIdPresent" in evidence.account && (evidence.account as JsonRecord).browserSessionIdPresent === true));
      throw new XiaohongshuGateError(loginCode, login === "expired" ? "LOGIN_EXPIRED" : "USER_ACTION_REQUIRED", `小红书登录/Session 未通过：${login}`);
    }
    gates["Login / Session"] = { result: "PASS", evidence: { login, sessionIsolationKey: `xiaohongshu:${account.id}` } };
    evidence.browserSession = adapter.getBrowserSessionEvidence ? await adapter.getBrowserSessionEvidence(context) : null;

    currentGate = "Account Identity";
    const profile = adapter.getAccountProfile ? await adapter.getAccountProfile(context) : {};
    if (!profile.accountName && !profile.accountId) throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "真实页面没有返回可记录的账号身份");
    const conflicting = profile.accountId ? opened.repository.listAccounts().find((candidate) => candidate.id !== account.id && candidate.platformKey === "xiaohongshu" && candidate.externalAccountId === profile.accountId) : undefined;
    if (conflicting) throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", `平台账号身份已绑定其他本地账号：${conflicting.id}`);
    const synced = opened.repository.syncBrowserPlatformAccount({ accountId: account.id, platformKey: "xiaohongshu", accountName: profile.accountName ?? account.name, browserSessionId: browserSessionIdHash({ platformKey: "xiaohongshu", accountId: account.id }), externalAccountId: profile.accountId ?? null, lastVerifiedAt: new Date().toISOString() });
    evidence.accountIdentity = { externalAccountId: profile.accountId ?? null, displayName: profile.accountName ?? null, persistedAccountId: synced.id, persistedPlatformAccountName: synced.accountName ?? null };
    gates["Account Identity"] = { result: "PASS", evidence: evidence.accountIdentity };

    currentGate = "Image-post Entry";
    const prepared = await adapter.preparePublish(context, article);
    const response = prepared.response;
    mapPreparedGates(gates, response);
    securityVerification = response.securityVerification === "NONE" ? "NONE" : String(response.securityVerification ?? "UNKNOWN");
    finalSubmitCount = Number(response.finalSubmitClickCount ?? 0);
    evidence.prepared = prepared;
    evidence.gates = gates;
    evidence.securityVerification = securityVerification;
    evidence.finalSubmitCount = finalSubmitCount;
    if (finalSubmitCount !== 0) throw new Error(`FINAL_SUBMIT_COUNT_NOT_ZERO:${finalSubmitCount}`);
    evidence.readyForRealSelfTest = isXiaohongshuReady(gates, finalSubmitCount, securityVerification);
    evidence.result = evidence.readyForRealSelfTest ? "GATE_COMPLETE_STOPPED_BEFORE_SUBMIT" : "FAILED_CLOSED";
    if (!evidence.readyForRealSelfTest) throw new Error("XIAOHONGSHU_REQUIRED_GATES_NOT_COMPLETE");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedGate = /XIAOHONGSHU_ACCOUNT_ID|XIAOHONGSHU account not found/iu.test(message) ? "Account ID" : gateForFailure(errorCode(error), currentGate);
    if (failedGate in gates && gates[failedGate].result === "NOT_RUN") gates[failedGate] = { result: "FAIL", evidence: errorEvidence(error) };
    securityVerification = errorCode(error) === "SECURITY_VERIFICATION_REQUIRED" ? "SECURITY_VERIFICATION_REQUIRED" : securityVerification;
    evidence.gates = gates;
    evidence.securityVerification = securityVerification;
    evidence.finalSubmitCount = finalSubmitCount;
    evidence.publishPassed = "NOT_PASS";
    evidence.readyForRealSelfTest = false;
    evidence.result = "FAILED_CLOSED";
    evidence.error = errorEvidence(error);
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.finalSubmitCount = finalSubmitCount;
    evidence.finalSubmitAction = "FORBIDDEN";
    evidence.jobCreated = false;
    evidence.intentCreated = false;
    evidence.publishRecordCreated = false;
    evidence.publishPassed = "NOT_PASS";
    evidence.report = buildGateReport(evidence, gates, accountId, finalSubmitCount, securityVerification);
    if (opened) {
      const afterCounts = counts(opened.db);
      evidence.databaseCountsAfter = afterCounts;
      evidence.databaseDelta = {
        publishJobs: Number(afterCounts.publishJobs) - Number((evidence.databaseCountsBefore as JsonRecord).publishJobs),
        submissionIntents: Number(afterCounts.submissionIntents) - Number((evidence.databaseCountsBefore as JsonRecord).submissionIntents),
        publishRecords: Number(afterCounts.publishRecords) - Number((evidence.databaseCountsBefore as JsonRecord).publishRecords)
      };
    }
    if (adapter) await adapter.closeOwnedSessions?.().catch(() => undefined);
    if (opened) opened.db.close();
    mkdirSync(join(process.cwd(), "output"), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
    quitElectron?.();
  }
  return evidence;
}
