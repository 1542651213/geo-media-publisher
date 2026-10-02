import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAICenterStore, openDatabase, type AppRepository } from "@publisher/db";
import type Database from "better-sqlite3";
import { DraftWorkingCopies, assertNoUnsubmittedEdits } from "../apps/desktop/src/main/draft-working-copies";
import { AIProductCenter } from "../apps/desktop/src/main/ai-product-center";
import type { CredentialStore } from "@publisher/security";

interface Fixture { root: string; db: Database.Database; repository: AppRepository; companyId: string; otherCompanyId: string; articleId: string; drafts: DraftWorkingCopies }
const fixtures: Fixture[] = [];
const initial = { title: "流程说明", body: "甲企业的既有流程资料。" };
const changed = { title: "修改后的流程说明", body: "甲企业补充的流程资料。" };
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "r115-g-working-copy-"));
  const { db, repository } = openDatabase(join(root, "publisher.db"), resolve("packages/db/migrations"));
  const company = repository.createBrand({ name: "甲", companyName: "甲企业" });
  const other = repository.createBrand({ name: "乙", companyName: "乙企业" });
  repository.setSetting("operationsWorkspaceCompanyId", company.id);
  const article = repository.createArticle({ brandId: company.id, topic: "流程", keyword: "流程", city: "", ...initial,
    summary: "", tags: [], seoKeywords: [], articleType: "article", aiProvider: "manual", aiModel: "manual",
    generatedAt: "2026-10-02T00:00:00.000Z", reusePolicy: "once", contentHash: "initial-canonical-version" });
  if (!article) throw new Error("Synthetic article fixture was not created");
  const value = { root, db, repository, companyId: company.id, otherCompanyId: other.id, articleId: article.id, drafts: new DraftWorkingCopies(repository) };
  fixtures.push(value);
  return value;
}
function open(f: Fixture) { return f.drafts.open({ companyId: f.companyId, documentKind: "Article", documentId: f.articleId }); }
it('keeps orphaned recovery text readable without blocking another document in the company',()=>{const f=fixture(),copy=open(f);write(f,copy);f.repository.deleteArticle(f.articleId);const recovery=f.drafts.listRecovery({companyId:f.companyId});expect(recovery[0]).toMatchObject({canonicalMissing:true,snapshot:changed,status:'Conflict'});expect(f.drafts.get({companyId:f.companyId,copyId:copy.copyId}).snapshot).toEqual(changed);const next=f.repository.createArticle({brandId:f.companyId,...initial,topic:'其他文档',keyword:'其他',city:'',summary:'',tags:[],seoKeywords:[],articleType:'article',aiProvider:'manual',aiModel:'manual',generatedAt:'fixture',reusePolicy:'once',contentHash:'other-version'});if(!next)throw new Error('fixture required');expect(f.drafts.open({companyId:f.companyId,documentKind:'Article',documentId:next.id}).documentId).toBe(next.id);expect(()=>f.drafts.commit({companyId:f.companyId,copyId:copy.copyId,baseVersion:copy.baseVersion,localVersion:1})).toThrow('原文章不存在');});
function write(f: Fixture, copy: ReturnType<typeof open>, localVersion = 1, snapshot = changed) {
  return f.drafts.persist({ companyId: f.companyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion, snapshot });
}
function publishRows(repository: AppRepository) {
  return ["publish_jobs", "submission_intents", "publish_records"].map(table => repository.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
}
function frozenFixture(f: Fixture): void {
  const at = "2026-10-02T00:00:00.000Z";
  f.db.prepare("INSERT OR IGNORE INTO platforms(id,platform_key,display_name,category) VALUES('synthetic-platform','test','合成测试','test')").run();
  const account = f.repository.createAccount({ platformKey: "test", name: "合成账号" });
  f.db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,created_at,publish_payload_json) VALUES('frozen-job',?,'test',?,?,'NeedsReconciliation',?,?)")
    .run(account.id, f.articleId, at, at, JSON.stringify({ title: initial.title, body: initial.body, frozen: true }));
  f.db.prepare("INSERT INTO submission_intents(id,job_id,account_id,article_id,platform_key,attempt,state,created_at,updated_at,final_submit_count,payload_hash) VALUES('frozen-intent','frozen-job',?,?,'test',1,'Unknown',?,?,1,'frozen-payload-hash')")
    .run(account.id, f.articleId, at, at);
  f.db.prepare("INSERT INTO publish_records(id,job_id,account_id,platform_key,article_id,success,response_json,published_at) VALUES('frozen-record','frozen-job',?,'test',?,0,?,?)")
    .run(account.id, f.articleId, JSON.stringify({ retainedSnapshot: initial }), at);
}
function approve(f: Fixture): void {
  const article = f.repository.getArticle(f.articleId)!;
  f.repository.saveContentQualityReview({ contentType: "article", contentId: article.id, brandId: f.companyId, platformKey: null,
    contentHash: article.contentHash, trigger: "manual_review", provider: "human", model: "manual",
    result: { status: "Approved", score: 100, checks: [], issues: [] }, snapshot: initial, operatorType: "human", reason: "合成人工批准" });
}
afterEach(() => { while (fixtures.length) { const f = fixtures.pop()!; f.db.close(); rmSync(f.root, { recursive: true, force: true }); } });

describe("Main-owned persistent editing copies", () => {
  it("protects the approved version as soon as its editor is opened, before the first debounce", () => {
    const f = fixture(); approve(f);
    expect(() => assertNoUnsubmittedEdits(f.repository, f.articleId)).not.toThrow();
    const copy = open(f);
    expect(copy).toMatchObject({ companyId: f.companyId, documentId: f.articleId, baseVersion: "initial-canonical-version", localVersion: 0, snapshot: initial, activeEditing: true });
    expect(() => assertNoUnsubmittedEdits(f.repository, f.articleId)).toThrow(/先处理.*编辑/u);
    expect(f.repository.getContentQualityState("article", f.articleId)?.status).toBe("Approved");
  });

  it("acknowledges only the snapshot durably written in Main while leaving Article unchanged", () => {
    const f = fixture(), copy = open(f);
    const ack = write(f, copy);
    expect(ack).toMatchObject({ localVersion: 1, snapshot: changed, hasChanges: true, status: "Editing" });
    expect(ack.persistedAt).toBeTruthy();
    expect(f.drafts.get({ companyId: f.companyId, copyId: copy.copyId })).toEqual(ack);
    expect(f.repository.getArticle(f.articleId)).toMatchObject(initial);
    expect(publishRows(f.repository)).toEqual([[], [], []]);
  });

  it("makes matching autosave retransmission idempotent but refuses another payload at the same version", () => {
    const f = fixture(), copy = open(f), ack = write(f, copy);
    expect(write(f, copy)).toEqual(ack);
    expect(() => write(f, copy, 1, { title: "不同标题", body: changed.body })).toThrow(/版本/u);
    expect(f.drafts.get({ companyId: f.companyId, copyId: copy.copyId }).snapshot).toEqual(changed);
  });

  it("refuses an out-of-order autosave without overwriting the newest confirmed text", () => {
    const f = fixture(), copy = open(f);
    write(f, copy, 2, { title: "第二版", body: "第二版正文" });
    expect(() => write(f, copy, 1)).toThrow(/版本/u);
    expect(f.drafts.get({ companyId: f.companyId, copyId: copy.copyId })).toMatchObject({ localVersion: 2, snapshot: { title: "第二版", body: "第二版正文" } });
  });

  it("recovers the last confirmed long Chinese and pasted snapshot after a database reopen", () => {
    const f = fixture(), copy = open(f);
    const snapshot = { title: "中文编辑草稿", body: "中文正文与粘贴段落\n".repeat(5000) };
    write(f, copy, 1, snapshot);
    f.db.close();
    const reopened = openDatabase(join(f.root, "publisher.db"), resolve("packages/db/migrations"));
    f.db = reopened.db; f.repository = reopened.repository; f.drafts = new DraftWorkingCopies(f.repository);
    const recovered = f.drafts.listRecovery({ companyId: f.companyId });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ copyId: copy.copyId, localVersion: 1, snapshot, activeEditing: false, status: "Recovered" });
    expect(f.repository.getArticle(f.articleId)).toMatchObject(initial);
    expect(() => assertNoUnsubmittedEdits(f.repository, f.articleId)).toThrow();
    expect(publishRows(f.repository)).toEqual([[], [], []]);
  });

  it("keeps the previous acknowledgement after SQLite rejects the next persistence", () => {
    const f = fixture(), copy = open(f), ack = write(f, copy);
    f.db.exec("CREATE TRIGGER synthetic_draft_write_failure BEFORE UPDATE ON draft_working_copies WHEN NEW.local_version=2 BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END;");
    expect(() => write(f, copy, 2, { title: "未落盘文字", body: "未确认正文" })).toThrow(/保存失败/u);
    expect(f.drafts.get({ companyId: f.companyId, copyId: copy.copyId })).toEqual(ack);
  });

  it("rejects forged company/document/copy references and stale workspace requests", () => {
    const f = fixture(), copy = open(f);
    expect(() => f.drafts.open({ companyId: f.otherCompanyId, documentKind: "Article", documentId: f.articleId })).toThrow(/企业/u);
    expect(() => f.drafts.get({ companyId: f.otherCompanyId, copyId: copy.copyId })).toThrow(/企业/u);
    expect(() => f.drafts.persist({ companyId: f.otherCompanyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 1, snapshot: changed })).toThrow(/企业/u);
    expect(() => f.drafts.commit({ companyId: f.otherCompanyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 0 })).toThrow(/企业/u);
    expect(() => f.drafts.discard({ companyId: f.otherCompanyId, copyId: copy.copyId, localVersion: 0 })).toThrow(/企业/u);
    f.repository.setSetting("operationsWorkspaceCompanyId", f.otherCompanyId);
    expect(() => f.drafts.listRecovery({ companyId: f.companyId })).toThrow(/企业/u);
    expect(() => write(f, copy)).toThrow(/企业/u);
    expect(f.repository.getArticle(f.articleId)).toMatchObject(initial);
  });

  it("requires copy ownership to match the document even when the supplied workspace is valid", () => {
    const f = fixture();
    f.repository.setSetting("operationsWorkspaceCompanyId", f.otherCompanyId);
    expect(() => f.drafts.open({ companyId: f.otherCompanyId, documentKind: "Article", documentId: f.articleId })).toThrow(/企业/u);
  });

  it("refuses two editor commits based on the same canonical version and retains the conflicting copy", () => {
    const f = fixture(), first = open(f), second = open(f);
    expect(first.copyId).not.toBe(second.copyId);
    write(f, first, 1, { title: "窗口一", body: "窗口一正文" });
    write(f, second, 1, { title: "窗口二", body: "窗口二正文" });
    f.drafts.commit({ companyId: f.companyId, copyId: first.copyId, baseVersion: first.baseVersion, localVersion: 1 });
    expect(() => f.drafts.commit({ companyId: f.companyId, copyId: second.copyId, baseVersion: second.baseVersion, localVersion: 1 })).toThrow(/冲突/u);
    expect(f.repository.getArticle(f.articleId)).toMatchObject({ title: "窗口一", body: "窗口一正文" });
    expect(f.drafts.get({ companyId: f.companyId, copyId: second.copyId })).toMatchObject({ status: "Conflict", snapshot: { title: "窗口二", body: "窗口二正文" }, currentSnapshot: { title: "窗口一", body: "窗口一正文" } });
  });

  it("does not treat a quality-only timestamp update as a content version conflict", () => {
    const f = fixture(), copy = open(f); write(f, copy); approve(f);
    expect(() => f.drafts.commit({ companyId: f.companyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 1 })).not.toThrow();
    expect(f.repository.getArticle(f.articleId)).toMatchObject(changed);
  });

  it("requires an explicit conflict resolution and validates the displayed current version again", () => {
    const f = fixture(), copy = open(f); write(f, copy);
    f.repository.updateArticle(f.articleId, { title: "另一编辑已提交", body: "新版正文" });
    const recovery = f.drafts.get({ companyId: f.companyId, copyId: copy.copyId });
    expect(recovery.status).toBe("Conflict");
    expect(() => f.drafts.resolve({ companyId: f.companyId, copyId: copy.copyId, localVersion: 1, choice: "recovered", expectedCurrentVersion: "stale" })).toThrow(/冲突/u);
    const resolved = f.drafts.resolve({ companyId: f.companyId, copyId: copy.copyId, localVersion: 1, choice: "recovered", expectedCurrentVersion: recovery.currentVersion });
    expect(resolved).toMatchObject({ snapshot: changed, localVersion: 2, baseVersion: recovery.currentVersion, status: "Editing" });
    expect(f.repository.getArticle(f.articleId)?.title).toBe("另一编辑已提交");
    f.drafts.commit({ companyId: f.companyId, copyId: copy.copyId, baseVersion: resolved.baseVersion, localVersion: resolved.localVersion });
    expect(f.repository.getArticle(f.articleId)).toMatchObject(changed);
  });

  it("keeps the current canonical text when the user explicitly chooses it", () => {
    const f = fixture(), copy = open(f); write(f, copy);
    const current = f.repository.updateArticle(f.articleId, { title: "保留新版", body: "新版正文" });
    const resolved = f.drafts.resolve({ companyId: f.companyId, copyId: copy.copyId, localVersion: 1, choice: "current", expectedCurrentVersion: current.contentHash });
    expect(resolved).toMatchObject({ snapshot: { title: "保留新版", body: "新版正文" }, hasChanges: false, baseVersion: current.contentHash });
    f.drafts.release({ companyId: f.companyId, copyId: copy.copyId, localVersion: resolved.localVersion });
    expect(() => assertNoUnsubmittedEdits(f.repository, f.articleId)).not.toThrow();
    expect(f.drafts.listRecovery({ companyId: f.companyId })).toEqual([]);
  });

  it("refuses stale commit and discard requests after a newer local write", () => {
    const f = fixture(), copy = open(f); write(f, copy, 2);
    expect(() => f.drafts.commit({ companyId: f.companyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 1 })).toThrow(/版本/u);
    expect(() => f.drafts.discard({ companyId: f.companyId, copyId: copy.copyId, localVersion: 1 })).toThrow(/版本/u);
    expect(() => f.drafts.release({ companyId: f.companyId, copyId: copy.copyId, localVersion: 1 })).toThrow(/版本/u);
    expect(f.drafts.get({ companyId: f.companyId, copyId: copy.copyId }).localVersion).toBe(2);
  });

  it("retains saved working changes on leaving the editor and removes the publish blocker only after explicit discard", () => {
    const f = fixture(), copy = open(f); write(f, copy);
    const released = f.drafts.release({ companyId: f.companyId, copyId: copy.copyId, localVersion: 1 });
    expect(released).toMatchObject({ status: "Recovered", activeEditing: false, snapshot: changed });
    expect(() => assertNoUnsubmittedEdits(f.repository, f.articleId)).toThrow();
    expect(f.drafts.discard({ companyId: f.companyId, copyId: copy.copyId, localVersion: 1 }).status).toBe("Discarded");
    expect(() => assertNoUnsubmittedEdits(f.repository, f.articleId)).not.toThrow();
    expect(f.repository.getArticle(f.articleId)).toMatchObject(initial);
  });

  it("invalidates approval on commit while preserving every frozen Job, Intent and Record", () => {
    const f = fixture(); frozenFixture(f); approve(f);
    const before = publishRows(f.repository), copy = open(f); write(f, copy);
    const committed = f.drafts.commit({ companyId: f.companyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 1 });
    expect(committed).toMatchObject({ status: "Committed", articleId: f.articleId });
    const article = f.repository.getArticle(f.articleId)!;
    expect(f.repository.isContentApproved("article", article.id, article.contentHash)).toBe(false);
    expect(f.repository.getContentQualityState("article", article.id)?.status).toBe("Draft");
    expect(publishRows(f.repository)).toEqual(before);
    expect(() => assertNoUnsubmittedEdits(f.repository, f.articleId)).not.toThrow();
    const auditCount = (f.db.prepare("SELECT COUNT(*) count FROM content_quality_audits WHERE content_id=?").get(f.articleId) as { count: number }).count;
    expect(f.drafts.commit({ companyId: f.companyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 1 })).toEqual(committed);
    expect((f.db.prepare("SELECT COUNT(*) count FROM content_quality_audits WHERE content_id=?").get(f.articleId) as { count: number }).count).toBe(auditCount);
    expect(publishRows(f.repository)).toEqual(before);
  });

  it("rolls back canonical text and retains the working copy when the synchronous commit callback fails", () => {
    const f = fixture(), copy = open(f); write(f, copy); approve(f);
    const drafts = new DraftWorkingCopies(f.repository, { recoverOnStartup: false, onArticleCommitted: () => { throw new Error("synthetic quality failure"); } });
    expect(() => drafts.commit({ companyId: f.companyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 1 })).toThrow(/保存失败/u);
    expect(f.repository.getArticle(f.articleId)).toMatchObject(initial);
    expect(f.repository.getContentQualityState("article", f.articleId)?.status).toBe("Approved");
    expect(drafts.get({ companyId: f.companyId, copyId: copy.copyId })).toMatchObject({ localVersion: 1, snapshot: changed });
  });

  it("keeps Studio edits local and reuses the existing AI save mapping across repeated commits and reopen", () => {
    const f = fixture(), values = new Map<string, string>();
    const credentials: CredentialStore = { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); }, has: key => values.has(key) };
    const ai = new AIProductCenter(f.repository, credentials, async () => { throw new Error("Network is forbidden in this test"); });
    const store = createAICenterStore(f.repository);
    store.start({ generationId: "synthetic-generation", companyId: f.companyId, sourceArticleId: null, provider: "synthetic", model: "local-fixture", templateId: "industry", templateVersion: 1, targetPlatform: "website", createdAt: "2026-10-02T00:00:00.000Z", status: "Generated", errorCode: null, outputArticleId: null, variantId: null });
    store.finish(store.generation("synthetic-generation")!, { generationId: "synthetic-generation", ...initial, contentType: "article", validation: { errors: [], warnings: [] } });
    const drafts = new DraftWorkingCopies(f.repository, { recoverOnStartup: false, studio: {
      get: id => { const history = store.generation(id), draft = store.draft(id); return history && draft ? { companyId: history.companyId, ...draft, outputArticleId: history.outputArticleId, variantId: history.variantId } : null; },
      saveDraft: (id, title, body) => ai.saveDraft(id, title, body)
    } });
    const copy = drafts.open({ companyId: f.companyId, documentKind: "StudioGeneration", documentId: "synthetic-generation" });
    drafts.persist({ companyId: f.companyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 1, snapshot: changed });
    expect(f.repository.listArticles({ brandId: f.companyId })).toHaveLength(1);
    expect(store.draft("synthetic-generation")).toMatchObject(initial);
    const input = { companyId: f.companyId, copyId: copy.copyId, baseVersion: copy.baseVersion, localVersion: 1 };
    const result = drafts.commit(input);
    expect(result.articleId).not.toBe(f.articleId);
    expect(f.repository.getArticle(result.articleId)).toMatchObject(changed);
    expect(drafts.commit(input)).toEqual(result);
    const another = drafts.open({ companyId: f.companyId, documentKind: "StudioGeneration", documentId: "synthetic-generation" });
    const repeated = drafts.commit({ companyId: f.companyId, copyId: another.copyId, baseVersion: another.baseVersion, localVersion: 0 });
    expect(repeated.articleId).toBe(result.articleId);
    expect(f.repository.listArticles({ brandId: f.companyId })).toHaveLength(2);
    expect(publishRows(f.repository)).toEqual([[], [], []]);
  });
});
