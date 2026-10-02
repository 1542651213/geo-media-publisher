import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type AppRepository } from "@publisher/db";
import type { BrowserSession, BrowserSessionManager, PlatformAdapter } from "@publisher/adapters-core";
import { AccountOnboarding } from "../apps/desktop/src/main/account-onboarding";
import { CompanyWorkspace } from "../apps/desktop/src/main/company-workspace";
import { AccountSessionRehydrationCoordinator, type AccountSessionTarget } from "../apps/desktop/src/main/account-session-rehydration";

const timestamp = "2026-10-02T08:00:00.000Z";
const roots: Array<{ directory: string; db: Database.Database }> = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "r115-g-account-onboarding-"));
  const { repository, db } = openDatabase(join(directory, "publisher.db"), resolve("packages/db/migrations"));
  roots.push({ directory, db });
  repository.seedPlatformCatalog(resolve("PLATFORMS.csv"));
  const invalidateAuthentication = vi.fn<(accountId: string, platformKey: string, version: number) => void>();
  const onboarding = new AccountOnboarding(repository, { invalidateAuthentication, now: () => new Date(timestamp) });
  return { repository, db, onboarding, invalidateAuthentication };
}

function company(repository: AppRepository, name = "合成企业甲") {
  return repository.createBrand({ name, companyName: `${name}有限公司` });
}

function account(repository: AppRepository, name = "合成账号", platformKey = "weibo") {
  return repository.createAccount({ platformKey, name });
}

function article(repository: AppRepository, companyId: string) {
  const result = repository.createArticle({ brandId: companyId, topic: "合成资料", keyword: "资料", city: "南京", title: "不应出现在账号证据中的标题",
    body: "不应出现在账号证据中的客户正文", summary: "", tags: [], seoKeywords: [], articleType: "article", aiProvider: "fixture", aiModel: "fixture",
    generatedAt: timestamp, reusePolicy: "always", contentHash: randomUUID() });
  if (!result) throw new Error("synthetic fixture article was not created");
  return result;
}

function job(repository: AppRepository, accountId: string, articleId: string, platformKey = "weibo", status = "Success") {
  const id = randomUUID();
  repository.db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,platform_account_id,article_id,scheduled_at,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, accountId, platformKey, accountId, articleId, timestamp, status, timestamp);
  return id;
}

function bind(repository: AppRepository, accountId: string, companyId: string, version = 1) {
  repository.db.prepare("INSERT INTO operations_account_company_bindings(account_id,company_id,bound_at,updated_at,version) VALUES(?,?,?,?,?)")
    .run(accountId, companyId, timestamp, timestamp, version);
}

function historicalRows(repository: AppRepository): string {
  return JSON.stringify(["accounts", "articles", "publish_jobs", "submission_intents", "publish_records", "douyin_image_text_connections", "toutiao_article_job_preparations", "b01_product_e2e_authorization", "official_api_operations"]
    .map(table => repository.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}

function frozenRecord(repository: AppRepository, accountId: string, articleId: string, jobId: string, platformKey: string, contentTransport: string) {
  repository.db.prepare("INSERT INTO publish_records(id,job_id,account_id,platform_key,article_id,success,response_json,published_at,status) VALUES(?,?,?,?,?,0,?,?,'Failed')")
    .run(randomUUID(), jobId, accountId, platformKey, articleId, JSON.stringify({ contentTransport, contentBindingHash: "a".repeat(64) }), timestamp);
}

afterEach(() => {
  for (const resource of roots.splice(0)) {
    resource.db.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

it("allows explicit Owner confirmation through the Main workspace guard while preserving ordinary account and company restrictions", () => {
  const { repository, onboarding, invalidateAuthentication } = fixture();
  const a = company(repository), b = company(repository, "合成企业乙"), owned = account(repository);
  const workspace = new CompanyWorkspace(repository, id => onboarding.preview().find(row => row.accountId === id)?.currentCompanyId ?? null);
  workspace.select(a.id);
  const initial = { accountId: owned.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null };
  expect(() => workspace.prepare("accounts:check-login", { accountId: owned.id })).toThrow("账号未绑定");
  expect(onboarding.confirm(workspace.prepare("account-onboarding:confirm", initial))).toMatchObject({ bindingVersion: 1, authenticated: false });
  workspace.select(b.id);
  const reassignment = { accountId: owned.id, companyId: b.id, expectedVersion: 1, expectedCompanyId: a.id, confirmReassignment: true };
  expect(() => workspace.prepare("accounts:update", { id: owned.id })).toThrow("账号未绑定");
  expect(() => workspace.prepare("account-onboarding:confirm", { ...reassignment, companyId: a.id })).toThrow("企业工作区已切换");
  expect(() => onboarding.confirm(workspace.prepare("account-onboarding:confirm", { ...reassignment, confirmReassignment: false }))).toThrow("明确确认修改归属");
  expect(onboarding.confirm(workspace.prepare("account-onboarding:confirm", reassignment))).toMatchObject({ bindingVersion: 2, authenticated: false });
  expect(() => onboarding.confirm(workspace.prepare("account-onboarding:confirm", reassignment))).toThrow("归属版本已变化");
  expect(invalidateAuthentication).toHaveBeenCalledTimes(2);
  expect(repository.listJobs()).toEqual([]);
});

describe("R1.15-G evidence-based account onboarding", () => {
  it("previews sole historical Job/Article/Brand evidence without any writes, authentication or article text", () => {
    const { repository, onboarding, invalidateAuthentication } = fixture();
    const a = company(repository), b = company(repository, "合成企业乙");
    const owned = account(repository), source = article(repository, a.id);
    job(repository, owned.id, source.id);
    job(repository, owned.id, source.id);
    const before = historicalRows(repository);
    const changes = repository.db.prepare("SELECT total_changes() AS count").get();

    const preview = onboarding.preview();

    expect(preview.find(row => row.accountId === owned.id)).toMatchObject({ currentCompanyId: null, currentBindingVersion: 0,
      evidenceState: "Unique", suggestedCompanyId: a.id, suggestedCompanyName: a.companyName, verificationState: "UNVERIFIED",
      articlePublishEligibility: "NotEvaluated", evidence: [{ companyId: a.id, jobCount: 2, articleCount: 1, brandCount: 1 }] });
    expect(preview.find(row => row.accountId === owned.id)?.evidence[0]?.sources).toHaveLength(2);
    expect(JSON.stringify(preview)).not.toContain(source.title);
    expect(JSON.stringify(preview)).not.toContain(source.body);
    expect(JSON.stringify(preview)).not.toContain(b.id);
    expect(historicalRows(repository)).toBe(before);
    expect(repository.db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
    expect(repository.db.prepare("SELECT * FROM operations_account_company_bindings").all()).toEqual([]);
    expect(invalidateAuthentication).not.toHaveBeenCalled();
  });

  it("marks historical use in multiple companies as conflict and does not guess from nicknames", () => {
    const { repository, onboarding } = fixture();
    const a = company(repository), b = company(repository, "合成企业乙");
    const conflicted = account(repository), nicknameOnly = account(repository, a.companyName);
    job(repository, conflicted.id, article(repository, a.id).id);
    job(repository, conflicted.id, article(repository, b.id).id);
    const preview = onboarding.preview();
    expect(preview.find(row => row.accountId === conflicted.id)).toMatchObject({ evidenceState: "Conflict", suggestedCompanyId: null });
    expect(preview.find(row => row.accountId === conflicted.id)?.conflictReason).toContain("多个企业");
    expect(preview.find(row => row.accountId === nicknameOnly.id)).toMatchObject({ evidenceState: "NoEvidence", suggestedCompanyId: null, evidence: [] });
  });

  it("does not make the only company a historical ownership fact when an account has no evidence", () => {
    const { repository, onboarding } = fixture();
    const a = company(repository), owned = account(repository, a.companyName);
    expect(onboarding.preview().find(row => row.accountId === owned.id)).toMatchObject({ evidenceState: "NoEvidence", suggestedCompanyId: null, currentBindingVersion: 0 });
    expect(repository.db.prepare("SELECT * FROM operations_account_company_bindings").all()).toEqual([]);
  });

  it("shows existing confirmed binding/version and keeps archived and manually disabled accounts distinct", () => {
    const { repository, onboarding } = fixture();
    const a = company(repository), owned = account(repository), archived = account(repository, "归档账号");
    bind(repository, owned.id, a.id, 7);
    repository.updateAccount(owned.id, { enabled: false, loginStatus: "logged_in" });
    repository.markPlatformAccountDisconnected(archived.id, "weibo");
    expect(onboarding.preview()).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: owned.id, evidenceState: "Confirmed", currentCompanyId: a.id, currentBindingVersion: 7, enabled: false, verificationState: "DISABLED" }),
      expect.objectContaining({ accountId: archived.id, archived: true, verificationState: "DISABLED" })
    ]));
  });

  it("confirms an explicit mapping atomically, increments binding version and invalidates rather than authenticates", () => {
    const { repository, onboarding, invalidateAuthentication } = fixture();
    const a = company(repository), owned = account(repository);
    repository.updateAccount(owned.id, { enabled: false, loginStatus: "logged_in" });
    const before = historicalRows(repository);

    expect(onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null }))
      .toMatchObject({ accountId: owned.id, companyId: a.id, bindingVersion: 1, authenticated: false, verificationState: "UNVERIFIED", requiresIdentityVerification: true });

    expect(invalidateAuthentication).toHaveBeenCalledExactlyOnceWith(owned.id, "weibo", 1);
    expect(onboarding.preview().find(row => row.accountId === owned.id)).toMatchObject({ currentCompanyId: a.id, currentBindingVersion: 1 });
    expect(historicalRows(repository)).toBe(before);
  });

  it.each([
    { jobStatus: "Success", intentState: "Submitted", count: 1, remoteStatus: "PUBLISHED_CONFIRMED" },
    { jobStatus: "NeedsReconciliation", intentState: "Unknown", count: 1, remoteStatus: "UNCERTAIN" },
    { jobStatus: "Unknown", intentState: "Unknown", count: 0, remoteStatus: "UNCERTAIN" }
  ])("allows initial ownership confirmation with an old $jobStatus / $intentState intent and preserves its exact historical bytes", ({ jobStatus, intentState, count, remoteStatus }) => {
    const { repository, onboarding, invalidateAuthentication } = fixture();
    const a = company(repository), owned = account(repository, "合成遗留账号", "toutiao"), source = article(repository, a.id);
    const jobId = job(repository, owned.id, source.id, "toutiao", jobStatus);
    repository.db.prepare("INSERT INTO submission_intents(id,job_id,account_id,article_id,platform_key,attempt,state,created_at,updated_at,final_submit_count,submit_boundary_entered_at,remote_status) VALUES(?,?,?,?,?,1,?,?,?,?,?,?)")
      .run(randomUUID(), jobId, owned.id, source.id, "toutiao", intentState, timestamp, timestamp, count, timestamp, remoteStatus);
    repository.db.prepare("INSERT INTO toutiao_article_job_preparations(job_id,account_id,article_id,settings_version,content_transport,settings_json,created_at) VALUES(?,?,?,1,'ARTICLE_WEB_API','{}',?)")
      .run(jobId, owned.id, source.id, timestamp);
    frozenRecord(repository, owned.id, source.id, jobId, "toutiao", "ARTICLE_BROWSER");
    const before = historicalRows(repository);

    expect(onboarding.preview().find(row => row.accountId === owned.id)).toMatchObject({ currentCompanyId: null,
      currentBindingVersion: 0, evidenceState: "Unique", suggestedCompanyId: a.id, canConfirm: true, canReassign: false, bindingBlockers: [] });
    expect(onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null }))
      .toMatchObject({ companyId: a.id, previousCompanyId: null, bindingVersion: 1, authenticated: false, requiresIdentityVerification: true });

    expect(historicalRows(repository)).toBe(before);
    expect(onboarding.preview().find(row => row.accountId === owned.id)).toMatchObject({ currentCompanyId: a.id, currentBindingVersion: 1,
      canConfirm: true, canReassign: false, bindingBlockers: expect.arrayContaining([expect.objectContaining({ code: "FROZEN_SUBMISSION_INTENT" })]) });
    expect(invalidateAuthentication).toHaveBeenCalledExactlyOnceWith(owned.id, "toutiao", 1);
  });

  it.each(["Running", "Preparing", "ReadyToSubmit", "Submitting", "Submitted", "Publishing"])("still refuses initial assignment while a %s job is in flight", status => {
    const { repository, onboarding, invalidateAuthentication } = fixture();
    const a = company(repository), owned = account(repository), source = article(repository, a.id);
    job(repository, owned.id, source.id, "weibo", status);
    const before = historicalRows(repository);
    expect(onboarding.preview().find(row => row.accountId === owned.id)).toMatchObject({ canConfirm: false, canReassign: false,
      bindingBlockers: [expect.objectContaining({ code: "ACTIVE_PUBLISH_JOB" })] });
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null })).toThrow("运行或冻结");
    expect(historicalRows(repository)).toBe(before);
    expect(repository.db.prepare("SELECT * FROM operations_account_company_bindings").all()).toEqual([]);
    expect(invalidateAuthentication).not.toHaveBeenCalled();
  });

  it("reconfirms the same company without migrating a binding or historical frozen data even when an old operation remains", () => {
    const { repository, onboarding, invalidateAuthentication } = fixture();
    const a = company(repository), owned = account(repository, "已有归属账号", "toutiao"), source = article(repository, a.id);
    bind(repository, owned.id, a.id, 7);
    const jobId = job(repository, owned.id, source.id, "toutiao", "Running");
    frozenRecord(repository, owned.id, source.id, jobId, "toutiao", "ARTICLE_BROWSER");
    const before = historicalRows(repository);
    const bindingBefore = repository.db.prepare("SELECT * FROM operations_account_company_bindings WHERE account_id=?").get(owned.id);
    const changes = repository.db.prepare("SELECT total_changes() AS count").get();

    expect(onboarding.preview().find(row => row.accountId === owned.id)).toMatchObject({ currentCompanyId: a.id,
      currentBindingVersion: 7, canConfirm: true, canReassign: false });
    expect(onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 7, expectedCompanyId: a.id }))
      .toMatchObject({ companyId: a.id, previousCompanyId: a.id, bindingVersion: 7, authenticated: false, requiresIdentityVerification: true });

    expect(repository.db.prepare("SELECT * FROM operations_account_company_bindings WHERE account_id=?").get(owned.id)).toEqual(bindingBefore);
    expect(repository.db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
    expect(historicalRows(repository)).toBe(before);
    expect(invalidateAuthentication).toHaveBeenCalledExactlyOnceWith(owned.id, "toutiao", 7);
  });

  it("rejects stale version/company confirmations and never invalidates on a rejected write", () => {
    const { repository, onboarding, invalidateAuthentication } = fixture();
    const a = company(repository), owned = account(repository);
    onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null });
    const before = onboarding.preview();
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null })).toThrow("归属版本已变化");
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 1, expectedCompanyId: null })).toThrow("归属版本已变化");
    expect(onboarding.preview()).toEqual(before);
    expect(invalidateAuthentication).toHaveBeenCalledTimes(1);
  });

  it("requires a separate explicit reassignment confirmation and rejects an old mapping after A to B to A", () => {
    const { repository, onboarding } = fixture();
    const a = company(repository), b = company(repository, "合成企业乙"), owned = account(repository);
    bind(repository, owned.id, a.id);
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: b.id, expectedVersion: 1, expectedCompanyId: a.id })).toThrow("明确确认修改归属");
    expect(onboarding.confirm({ accountId: owned.id, companyId: b.id, expectedVersion: 1, expectedCompanyId: a.id, confirmReassignment: true }).bindingVersion).toBe(2);
    expect(onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 2, expectedCompanyId: b.id, confirmReassignment: true }).bindingVersion).toBe(3);
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: b.id, expectedVersion: 1, expectedCompanyId: a.id, confirmReassignment: true })).toThrow("归属版本已变化");
  });

  it.each(["Running", "Preparing", "ReadyToSubmit", "Submitting", "Submitted", "Publishing", "NeedsReconciliation", "Unknown"])("refuses a %s job without altering historical data", status => {
    const { repository, onboarding, invalidateAuthentication } = fixture();
    const a = company(repository), b = company(repository, "合成企业乙"), owned = account(repository), source = article(repository, a.id);
    bind(repository, owned.id, a.id);
    job(repository, owned.id, source.id, "weibo", status);
    const before = historicalRows(repository);
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: b.id, expectedVersion: 1, expectedCompanyId: a.id, confirmReassignment: true })).toThrow("运行或冻结");
    expect(historicalRows(repository)).toBe(before);
    expect(onboarding.preview().find(row => row.accountId === owned.id)?.currentCompanyId).toBe(a.id);
    expect(invalidateAuthentication).not.toHaveBeenCalled();
  });

  it.each([
    { state: "Prepared", count: 0, boundary: null, remoteStatus: "NOT_STARTED" },
    { state: "Unknown", count: 0, boundary: null, remoteStatus: "UNCERTAIN" },
    { state: "Submitted", count: 1, boundary: timestamp, remoteStatus: "PUBLISHED_CONFIRMED" },
    { state: "NotSubmitted", count: 0, boundary: timestamp, remoteStatus: "NOT_STARTED" },
    { state: "NotSubmitted", count: 0, boundary: null, remoteStatus: "UNCERTAIN" }
  ])("preserves frozen or uncertain submission $state / count=$count", ({ state, count, boundary, remoteStatus }) => {
    const { repository, onboarding } = fixture();
    const a = company(repository), b = company(repository, "合成企业乙"), owned = account(repository), source = article(repository, a.id);
    bind(repository, owned.id, a.id);
    const jobId = job(repository, owned.id, source.id, "weibo", "Failed");
    repository.db.prepare("INSERT INTO submission_intents(id,job_id,account_id,article_id,platform_key,attempt,state,created_at,updated_at,final_submit_count,submit_boundary_entered_at,remote_status) VALUES(?,?,?,?,?,1,?,?,?,?,?,?)")
      .run(randomUUID(), jobId, owned.id, source.id, "weibo", state, timestamp, timestamp, count, boundary, remoteStatus);
    const before = historicalRows(repository);
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: b.id, expectedVersion: 1, expectedCompanyId: a.id, confirmReassignment: true })).toThrow("运行或冻结");
    expect(historicalRows(repository)).toBe(before);
  });

  it.each(["toutiao-preparation", "toutiao-record", "douyin-record", "douyin-settings", "douyin-file-claim", "douyin-connection", "website-operation", "b01-authorization"])("refuses the exact persisted %s binding", frozen => {
    const { repository, onboarding } = fixture();
    const a = company(repository), b = company(repository, "合成企业乙");
    const platformKey = frozen.startsWith("toutiao") ? "toutiao" : frozen.startsWith("website") ? "website" : "douyin";
    const owned = account(repository, "冻结账号", platformKey), source = article(repository, a.id);
    bind(repository, owned.id, a.id);
    const jobId = job(repository, owned.id, source.id, platformKey, "Failed");
    if (frozen === "toutiao-preparation") repository.db.prepare("INSERT INTO toutiao_article_job_preparations(job_id,account_id,article_id,settings_version,content_transport,settings_json,created_at) VALUES(?,?,?,1,'ARTICLE_WEB_API','{}',?)")
      .run(jobId, owned.id, source.id, timestamp);
    else if (frozen === "toutiao-record") frozenRecord(repository, owned.id, source.id, jobId, platformKey, "ARTICLE_BROWSER");
    else if (frozen === "douyin-record") frozenRecord(repository, owned.id, source.id, jobId, platformKey, "DOUYIN_IMAGE_TEXT_BROWSER");
    else if (frozen === "douyin-settings" || frozen === "douyin-file-claim") repository.db.prepare("UPDATE publish_jobs SET publish_payload_json=? WHERE id=?")
      .run(JSON.stringify(frozen === "douyin-settings" ? { douyinImageTextSettings: { version: 1, visibility: "public", timing: "immediate" } }
        : { douyinImageSelection: { stage: "FILE_SELECTION_DISPATCHED", operationId: "fixture-operation" } }), jobId);
    else if (frozen === "douyin-connection") repository.saveDouyinImageTextConnection({ accountId: owned.id, creatorId: "fixture-creator", browserSessionIdHash: "fixture-session-hash" });
    else if (frozen === "website-operation") repository.db.prepare("INSERT INTO official_api_operations(job_id,account_id,source_article_id,site_id,environment,key_id,source_hash,content_binding_id,phase,journal_json,created_at,updated_at) VALUES(?,?,?,'fixture-site','staging','fixture-key',?,?,'FAILED','{}',?,?)")
      .run(jobId, owned.id, source.id, "a".repeat(64), "b".repeat(64), timestamp, timestamp);
    else {
      const assetId = randomUUID();
      repository.db.prepare("INSERT INTO media_assets(id,brand_id,type,title,file_path,created_at) VALUES(?,?,'image','合成占位素材','fixture-only',?)").run(assetId, a.id, timestamp);
      repository.db.prepare("INSERT INTO b01_product_e2e_authorization(id,platform_key,authorization_purpose,account_id,article_id,article_content_hash,article_snapshot_sha256,image_asset_id,image_sha256,job_id,status,created_at,expires_at) VALUES('fixture-b01','douyin','R1.15-B01',?,?,?,?,?,?,?,'Revoked',?,?)")
        .run(owned.id, source.id, source.contentHash, "a".repeat(64), assetId, "b".repeat(64), jobId, timestamp, timestamp);
    }
    const before = historicalRows(repository);
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: b.id, expectedVersion: 1, expectedCompanyId: a.id, confirmReassignment: true })).toThrow("运行或冻结");
    expect(historicalRows(repository)).toBe(before);
  });

  it("rejects archived/missing accounts, unknown companies and extra forged input before any write", () => {
    const { repository, onboarding, invalidateAuthentication } = fixture();
    const a = company(repository), owned = account(repository), active = account(repository, "活动账号");
    repository.markPlatformAccountDisconnected(owned.id, "weibo");
    const before = historicalRows(repository);
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null })).toThrow("已归档");
    expect(() => onboarding.confirm({ accountId: "missing", companyId: a.id, expectedVersion: 0, expectedCompanyId: null })).toThrow("账号不存在");
    expect(() => onboarding.confirm({ accountId: active.id, companyId: "missing-company", expectedVersion: 0, expectedCompanyId: null })).toThrow("企业不存在");
    expect(() => onboarding.confirm({ accountId: active.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null, authenticated: true })).toThrow();
    expect(historicalRows(repository)).toBe(before);
    expect(repository.db.prepare("SELECT * FROM operations_account_company_bindings").all()).toEqual([]);
    expect(invalidateAuthentication).not.toHaveBeenCalled();
  });

  it("rolls binding persistence back if the required synchronous authentication invalidation fails", () => {
    const { repository } = fixture();
    const a = company(repository), owned = account(repository);
    const onboarding = new AccountOnboarding(repository, { invalidateAuthentication: () => { throw new Error("fixture invalidation failure"); } });
    expect(() => onboarding.confirm({ accountId: owned.id, companyId: a.id, expectedVersion: 0, expectedCompanyId: null })).toThrow("fixture invalidation failure");
    expect(repository.db.prepare("SELECT * FROM operations_account_company_bindings WHERE account_id=?").get(owned.id)).toBeUndefined();
  });

  it("signals authentication invalidation before returning so a late old probe cannot authenticate the confirmed mapping", async () => {
    const { repository } = fixture();
    const a = company(repository), b = company(repository, "合成企业乙"), owned = account(repository);
    bind(repository, owned.id, a.id);
    let current: AccountSessionTarget = { accountId: owned.id, accountName: owned.accountAlias, platformKey: "weibo", companyId: a.id,
      connectionMode: "BrowserAutomation", enabled: true, expectedRemoteIdentity: "fixture-remote", loginGeneration: 1 };
    let release!: () => void;
    const pending = new Promise<void>(resolvePending => { release = resolvePending; });
    const remote = { manifest: { transport: "browser" }, checkLogin: vi.fn(async () => { await pending; return "logged_in"; }),
      getAccountProfile: vi.fn(async () => ({ accountId: "fixture-remote" })) } as unknown as PlatformAdapter;
    const coordinator = new AccountSessionRehydrationCoordinator({ registry: { tryGetForConnection: () => remote },
      browserSessions: { restore: vi.fn(async () => ({ executionMode: "BACKGROUND", headless: true }) as BrowserSession) } as unknown as BrowserSessionManager,
      resolveCompanyId: () => current.companyId, resolveAuthoritativeTarget: () => current });
    const onboarding = new AccountOnboarding(repository, { invalidateAuthentication: (_accountId, _platformKey, version) => {
      current = { ...current, companyId: b.id, loginGeneration: version };
    } });
    const late = coordinator.refresh(current);
    await vi.waitFor(() => expect(remote.checkLogin).toHaveBeenCalled());
    onboarding.confirm({ accountId: owned.id, companyId: b.id, expectedVersion: 1, expectedCompanyId: a.id, confirmReassignment: true });
    expect(current.loginGeneration).toBe(2);
    expect(current.companyId).toBe(b.id);
    release();
    await expect(late).resolves.toMatchObject({ state: "IDENTITY_MISMATCH", reasonCode: "COMPANY_BINDING_CHANGED", identityMatched: false });
  });
});
