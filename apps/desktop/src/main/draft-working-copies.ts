import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppRepository } from "@publisher/db";
import { DRAFT_COPY_STATUSES, DRAFT_DOCUMENT_KINDS, type DraftCommitResult,
  type DraftDocumentKind, type DraftEditSnapshot, type DraftWorkingCopy, type DraftWorkingCopyErrorCode } from "../shared/draft-working-copies";

type Row = Record<string, unknown>;
const idSchema = z.string().trim().min(1).max(200);
const versionSchema = z.string().min(1).max(256);
const localVersionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const snapshotSchema = z.strictObject({ title: z.string().max(2000), body: z.string().max(100000) });
const copyRefSchema = z.strictObject({ companyId: idSchema, copyId: idSchema });
const copyVersionSchema = copyRefSchema.extend({ localVersion: localVersionSchema });
const openSchema = z.strictObject({ companyId: idSchema, documentKind: z.enum(DRAFT_DOCUMENT_KINDS), documentId: idSchema, copyId: idSchema.optional() });
const persistSchema = copyVersionSchema.extend({ baseVersion: versionSchema, localVersion: localVersionSchema.min(1), snapshot: snapshotSchema });
const commitSchema = copyVersionSchema.extend({ baseVersion: versionSchema });
const resolutionSchema = copyVersionSchema.extend({ choice: z.enum(["current", "recovered"]), expectedCurrentVersion: versionSchema });
const resultSchema = z.strictObject({ companyId: idSchema, copyId: idSchema, documentKind: z.enum(DRAFT_DOCUMENT_KINDS), documentId: idSchema,
  localVersion: localVersionSchema, articleId: idSchema, variantId: idSchema.nullable(), status: z.literal("Committed"), persistedAt: z.string().min(1) });
const terminal = (status: string): boolean => status === "Committed" || status === "Discarded";
const str = (value: unknown): string => typeof value === "string" ? value : "";
const timestamp = (): string => new Date().toISOString();
const snapshotHash = (snapshot: DraftEditSnapshot): string => createHash("sha256").update(JSON.stringify({ title: snapshot.title, body: snapshot.body })).digest("hex");

export class DraftWorkingCopyError extends Error {
  constructor(readonly code: DraftWorkingCopyErrorCode, message: string) { super(message); this.name = "DraftWorkingCopyError"; }
}
const error = (code: DraftWorkingCopyErrorCode, message: string): DraftWorkingCopyError => new DraftWorkingCopyError(code, message);

/** Main injects the existing Product Studio store/save functions. No Provider call belongs here. */
export interface DraftStudioPort {
  get(generationId: string): { companyId: string; title: string; body: string; outputArticleId?: string | null; variantId?: string | null } | null;
  saveDraft(generationId: string, title: string, body: string): { articleId: string; variantId: string | null };
}
export interface DraftAuditMetadata {
  operation: string;
  code?: DraftWorkingCopyErrorCode;
  copyId?: string;
  companyId?: string;
  documentKind?: DraftDocumentKind;
  documentId?: string;
  localVersion?: number;
}
export interface DraftWorkingCopiesOptions {
  studio?: DraftStudioPort;
  assertCompany?: (companyId: string) => void;
  /** Main should construct one service at startup. Test/additional views may disable startup recovery. */
  recoverOnStartup?: boolean;
  /** Runs inside the commit transaction; pass the existing synchronous deterministic quality gate. */
  onArticleCommitted?: (articleId: string) => void;
  audit?: (event: string, metadata: DraftAuditMetadata) => void;
}
interface CanonicalDocument { companyId: string; version: string; snapshot: DraftEditSnapshot; outputArticleId: string | null }

/** Working copies are never a Job, Intent, Record, or an automatically Approved Article. */
export class DraftWorkingCopies {
  constructor(private readonly repository: AppRepository, private readonly options: DraftWorkingCopiesOptions = {}) {
    if (options.recoverOnStartup !== false) this.perform("restart", () => {
      // The main process owns one writer. A prior process cannot leave a live editor lease behind.
      this.repository.db.prepare(`UPDATE draft_working_copies SET active_editing=0,
        status=CASE WHEN status='Conflict' THEN 'Conflict' ELSE 'Recovered' END
        WHERE active_editing=1 AND status IN ('Editing','Recovered','Conflict')`).run();
    });
  }

  open(payload: unknown): DraftWorkingCopy {
    return this.perform("open", () => {
      const input = openSchema.parse(payload);
      this.assertCompany(input.companyId);
      const canonical = this.canonical(input.companyId, input.documentKind, input.documentId);
      return this.repository.db.transaction(() => {
        const at = timestamp();
        if (input.copyId) {
          const row = this.row(input.companyId, input.copyId);
          if (row.document_kind !== input.documentKind || row.document_id !== input.documentId)
            throw error("DRAFT_COMPANY_MISMATCH", "工作副本与当前企业或文档不匹配");
          this.assertOpenable(row);
          this.repository.db.prepare("UPDATE draft_working_copies SET active_editing=1,status=?,updated_at=? WHERE copy_id=? AND local_version=?")
            .run(this.conflicts(row, canonical) ? "Conflict" : "Editing", at, input.copyId, row.local_version);
          const copy = this.view(this.row(input.companyId, input.copyId), canonical);
          this.audit("DRAFT_EDITOR_OPENED", "open", copy);
          return copy;
        }
        const copyId = randomUUID(), json = JSON.stringify(canonical.snapshot), hash = snapshotHash(canonical.snapshot);
        // Protection is persistent before the first Renderer debounce; opening an editor is conservative.
        this.repository.db.prepare(`INSERT INTO draft_working_copies(copy_id,company_id,document_kind,document_id,base_version,local_version,
          base_snapshot_json,base_snapshot_hash,snapshot_json,snapshot_hash,active_editing,status,commit_result_json,created_at,updated_at,persisted_at)
          VALUES(?,?,?,?,?,0,?,?,?,?,1,'Editing',NULL,?,?,?)`)
          .run(copyId, input.companyId, input.documentKind, input.documentId, canonical.version, json, hash, json, hash, at, at, at);
        const copy = this.view(this.row(input.companyId, copyId), canonical);
        this.audit("DRAFT_EDITOR_OPENED", "open", copy);
        return copy;
      })();
    });
  }

  get(payload: unknown): DraftWorkingCopy {
    return this.perform("get", () => {
      const input = copyRefSchema.parse(payload);
      return this.view(this.row(input.companyId, input.copyId));
    });
  }

  persist(payload: unknown): DraftWorkingCopy {
    return this.perform("persist", () => {
      const input = persistSchema.parse(payload);
      return this.repository.db.transaction(() => {
        const row = this.row(input.companyId, input.copyId), hash = snapshotHash(input.snapshot);
        if (row.base_version !== input.baseVersion) throw error("DRAFT_CANONICAL_CONFLICT", "工作副本基础版本存在冲突，请先查看差异");
        if (input.localVersion === Number(row.local_version) && row.snapshot_hash === hash) return this.view(row);
        this.assertOpenable(row);
        if (row.active_editing !== 1) throw error("DRAFT_COPY_CLOSED", "编辑窗口已离开，请先恢复工作副本再继续编辑");
        if (input.localVersion <= Number(row.local_version)) this.stale();
        const canonical = this.canonicalForRow(row), at = timestamp();
        // A newer canonical version cannot be overwritten. The user's text can still be retained for recovery.
        const changed = this.repository.db.prepare(`UPDATE draft_working_copies SET local_version=?,snapshot_json=?,snapshot_hash=?,status=?,updated_at=?,persisted_at=?
          WHERE copy_id=? AND company_id=? AND local_version=? AND status IN ('Editing','Recovered','Conflict')`)
          .run(input.localVersion, JSON.stringify(input.snapshot), hash, this.conflicts(row, canonical) ? "Conflict" : "Editing", at, at,
            input.copyId, input.companyId, row.local_version);
        if (changed.changes !== 1) this.stale();
        const copy = this.view(this.row(input.companyId, input.copyId), canonical);
        this.audit("DRAFT_COPY_PERSISTED", "persist", copy);
        return copy; // Only this successful synchronous transaction is a Main acknowledgement.
      })();
    });
  }

  listRecovery(payload: unknown): DraftWorkingCopy[] {
    return this.perform("listRecovery", () => {
      const { companyId } = z.strictObject({ companyId: idSchema }).parse(payload);
      this.assertCompany(companyId);
      const rows = this.repository.db.prepare(`SELECT * FROM draft_working_copies WHERE company_id=?
        AND status IN ('Editing','Recovered','Conflict') AND snapshot_hash<>base_snapshot_hash ORDER BY updated_at DESC,copy_id`).all(companyId) as Row[];
      return rows.map(row => this.view(row));
    });
  }

  commit(payload: unknown): DraftCommitResult {
    return this.perform("commit", () => {
      const input = commitSchema.parse(payload);
      return this.repository.db.transaction(() => {
        const row = this.row(input.companyId, input.copyId);
        this.assertLocalVersion(row, input.localVersion);
        if (row.base_version !== input.baseVersion) throw error("DRAFT_CANONICAL_CONFLICT", "基础版本存在冲突，请查看差异后再提交编辑");
        if (row.status === "Committed") return resultSchema.parse(JSON.parse(str(row.commit_result_json)));
        this.assertOpenable(row);
        const canonical = this.canonicalForRow(row);
        if (this.conflicts(row, canonical)) throw error("DRAFT_CANONICAL_CONFLICT", "文档版本存在冲突；恢复草稿已保留，请查看差异后选择当前版本或恢复文本");
        const snapshot = this.snapshot(row.snapshot_json);
        let saved: { articleId: string; variantId: string | null };
        if (row.document_kind === "Article") {
          const articleId = str(row.document_id);
          if (row.snapshot_hash !== row.base_snapshot_hash) {
            this.repository.updateArticle(articleId, snapshot); // Reuses Draft + human edit audit invalidation.
            const callbackResult: unknown = this.options.onArticleCommitted?.(articleId);
            if (callbackResult && typeof callbackResult === "object" && "then" in callbackResult)
              throw error("DRAFT_PERSIST_FAILED", "编辑保存失败：质量检查必须在 Main 同步完成；工作副本已保留");
          }
          saved = { articleId, variantId: null };
        } else {
          const studio = this.options.studio;
          if (!studio) throw error("DRAFT_STUDIO_UNAVAILABLE", "AI Studio 本地草稿服务暂时不可用，请保留恢复草稿");
          if (canonical.outputArticleId && row.snapshot_hash !== row.base_snapshot_hash)
            throw error("DRAFT_COPY_CLOSED", "这个生成结果已保存，请到内容库修改同一文章；人工编辑工作副本已保留");
          saved = studio.saveDraft(str(row.document_id), snapshot.title, snapshot.body);
          const article = this.repository.getArticle(saved.articleId);
          if (!article || article.brandId !== input.companyId)
            throw error("DRAFT_COMPANY_MISMATCH", "Studio 保存结果与工作副本企业不匹配");
          if (saved.variantId) {
            const variant = this.repository.getArticleVariant(saved.variantId);
            if (!variant || this.repository.getArticle(variant.articleId)?.brandId !== input.companyId)
              throw error("DRAFT_COMPANY_MISMATCH", "Studio 保存版本与工作副本企业不匹配");
          }
        }
        const result: DraftCommitResult = { copyId: input.copyId, companyId: input.companyId, documentKind: row.document_kind as DraftDocumentKind,
          documentId: str(row.document_id), localVersion: input.localVersion, ...saved, status: "Committed", persistedAt: timestamp() };
        const committed = this.repository.db.prepare(`UPDATE draft_working_copies SET status='Committed',active_editing=0,commit_result_json=?,updated_at=?,persisted_at=?
          WHERE copy_id=? AND company_id=? AND local_version=? AND status IN ('Editing','Recovered','Conflict')`)
          .run(JSON.stringify(result), result.persistedAt, result.persistedAt, input.copyId, input.companyId, input.localVersion);
        if (committed.changes !== 1) this.stale();
        this.audit("DRAFT_COPY_COMMITTED", "commit", result);
        return result;
      })();
    });
  }

  discard(payload: unknown): DraftWorkingCopy {
    return this.perform("discard", () => {
      const input = copyVersionSchema.parse(payload);
      return this.repository.db.transaction(() => {
        const row = this.row(input.companyId, input.copyId); this.assertLocalVersion(row, input.localVersion);
        if (row.status === "Discarded") return this.view(row);
        this.assertOpenable(row);
        const discarded = this.repository.db.prepare("UPDATE draft_working_copies SET status='Discarded',active_editing=0,updated_at=? WHERE copy_id=? AND local_version=?")
          .run(timestamp(), input.copyId, input.localVersion);
        if (discarded.changes !== 1) this.stale();
        const copy = this.view(this.row(input.companyId, input.copyId));
        this.audit("DRAFT_COPY_DISCARDED", "discard", copy);
        return copy; // Explicit dismissal preserves the local snapshot; it does not delete content.
      })();
    });
  }

  /** Call only after the Renderer has flushed its latest version before navigation/company switch/close. */
  release(payload: unknown): DraftWorkingCopy {
    return this.perform("release", () => {
      const input = copyVersionSchema.parse(payload);
      return this.repository.db.transaction(() => {
        const row = this.row(input.companyId, input.copyId); this.assertLocalVersion(row, input.localVersion);
        if (terminal(str(row.status))) return this.view(row);
        const canonical = this.canonicalForRow(row);
        const released = this.repository.db.prepare("UPDATE draft_working_copies SET status=?,active_editing=0,updated_at=? WHERE copy_id=? AND local_version=?")
          .run(this.conflicts(row, canonical) ? "Conflict" : "Recovered", timestamp(), input.copyId, input.localVersion);
        if (released.changes !== 1) this.stale();
        const copy = this.view(this.row(input.companyId, input.copyId), canonical);
        this.audit("DRAFT_EDITOR_RELEASED", "release", copy);
        return copy;
      })();
    });
  }

  resolve(payload: unknown): DraftWorkingCopy {
    return this.perform("resolve", () => {
      const input = resolutionSchema.parse(payload);
      return this.repository.db.transaction(() => {
        const row = this.row(input.companyId, input.copyId); this.assertLocalVersion(row, input.localVersion); this.assertOpenable(row);
        const canonical = this.canonicalForRow(row);
        if (canonical.version !== input.expectedCurrentVersion) throw error("DRAFT_CANONICAL_CONFLICT", "当前版本再次发生冲突，请重新查看差异");
        const snapshot = input.choice === "current" ? canonical.snapshot : this.snapshot(row.snapshot_json);
        const localVersion = input.localVersion + 1;
        if (!Number.isSafeInteger(localVersion)) this.stale();
        const at = timestamp();
        const resolved = this.repository.db.prepare(`UPDATE draft_working_copies SET base_version=?,base_snapshot_json=?,base_snapshot_hash=?,local_version=?,
          snapshot_json=?,snapshot_hash=?,active_editing=1,status='Editing',updated_at=?,persisted_at=?
          WHERE copy_id=? AND company_id=? AND local_version=? AND status IN ('Editing','Recovered','Conflict')`)
          .run(canonical.version, JSON.stringify(canonical.snapshot), snapshotHash(canonical.snapshot), localVersion, JSON.stringify(snapshot), snapshotHash(snapshot),
            at, at, input.copyId, input.companyId, input.localVersion);
        if (resolved.changes !== 1) this.stale();
        const copy = this.view(this.row(input.companyId, input.copyId), canonical);
        this.audit("DRAFT_COPY_RESOLVED", "resolve", copy);
        return copy; // Resolution changes only the working copy. Canonical content awaits an explicit commit.
      })();
    });
  }

  private assertCompany(companyId: string): void {
    if (!this.repository.getBrand(companyId)) throw error("DRAFT_COMPANY_MISMATCH", "企业工作区不存在，草稿未修改");
    if (this.options.assertCompany) {
      try { this.options.assertCompany(companyId); }
      catch { throw error("DRAFT_COMPANY_MISMATCH", "企业工作区已切换，请回到原企业处理编辑草稿"); }
    } else {
      const brands = this.repository.listBrands(), selected = this.repository.getSettings().operationsWorkspaceCompanyId;
      const current = brands.find(brand => brand.id === selected)?.id ?? brands[0]?.id;
      if (companyId !== current) throw error("DRAFT_COMPANY_MISMATCH", "企业工作区已切换，请回到原企业处理编辑草稿");
    }
  }

  private row(companyId: string, copyId: string): Row {
    this.assertCompany(companyId);
    const row = this.repository.db.prepare("SELECT * FROM draft_working_copies WHERE copy_id=?").get(copyId) as Row | undefined;
    if (!row) throw error("DRAFT_COPY_NOT_FOUND", "本地工作副本不存在，请重新打开文档");
    if (row.company_id !== companyId) throw error("DRAFT_COMPANY_MISMATCH", "工作副本不属于当前企业");
    return row;
  }

  private canonical(companyId: string, kind: DraftDocumentKind, documentId: string): CanonicalDocument {
    if (kind === "Article") {
      const article = this.repository.getArticle(documentId);
      if (!article) throw error("DRAFT_DOCUMENT_NOT_FOUND", "原文章不存在；本地恢复草稿仍保留，请先检查文档");
      if (article.brandId !== companyId) throw error("DRAFT_COMPANY_MISMATCH", "文章与编辑工作副本企业不匹配");
      return { companyId, version: article.contentHash, snapshot: { title: article.title, body: article.body }, outputArticleId: article.id };
    }
    const draft = this.options.studio?.get(documentId);
    if (!draft) throw error("DRAFT_DOCUMENT_NOT_FOUND", "Studio 生成草稿不存在；本地恢复草稿仍保留");
    if (draft.companyId !== companyId) throw error("DRAFT_COMPANY_MISMATCH", "Studio 生成结果与编辑工作副本企业不匹配");
    const snapshot = snapshotSchema.parse({ title: draft.title, body: draft.body });
    return { companyId, version: snapshotHash(snapshot), snapshot, outputArticleId: draft.outputArticleId ?? null };
  }

  private canonicalForRow(row: Row): CanonicalDocument {
    return this.canonical(str(row.company_id), z.enum(DRAFT_DOCUMENT_KINDS).parse(row.document_kind), str(row.document_id));
  }
  private snapshot(value: unknown): DraftEditSnapshot { return snapshotSchema.parse(JSON.parse(str(value))); }
  private conflicts(row: Row, canonical: CanonicalDocument): boolean {
    return row.base_version !== canonical.version || row.base_snapshot_hash !== snapshotHash(canonical.snapshot);
  }
  private view(row: Row, canonical = this.canonicalForRow(row)): DraftWorkingCopy {
    const status = z.enum(DRAFT_COPY_STATUSES).parse(row.status);
    return { copyId: str(row.copy_id), companyId: str(row.company_id), documentKind: z.enum(DRAFT_DOCUMENT_KINDS).parse(row.document_kind),
      documentId: str(row.document_id), baseVersion: str(row.base_version), localVersion: Number(row.local_version),
      baseSnapshot: this.snapshot(row.base_snapshot_json), snapshot: this.snapshot(row.snapshot_json),
      currentVersion: canonical.version, currentSnapshot: canonical.snapshot, hasChanges: row.snapshot_hash !== row.base_snapshot_hash,
      activeEditing: row.active_editing === 1, status: !terminal(status) && this.conflicts(row, canonical) ? "Conflict" : status,
      createdAt: str(row.created_at), updatedAt: str(row.updated_at), persistedAt: str(row.persisted_at) };
  }
  private assertOpenable(row: Row): void {
    if (terminal(str(row.status))) throw error("DRAFT_COPY_CLOSED", "该工作副本已提交或放弃，请重新打开文档");
  }
  private assertLocalVersion(row: Row, localVersion: number): void { if (Number(row.local_version) !== localVersion) this.stale(); }
  private stale(): never { throw error("DRAFT_VERSION_STALE", "编辑版本已更新；旧请求未覆盖新文本，请重新读取工作副本"); }
  private audit(event: string, operation: string, copy?: Pick<DraftWorkingCopy, "copyId" | "companyId" | "documentKind" | "documentId" | "localVersion">, code?: DraftWorkingCopyErrorCode): void {
    // Audit is metadata-only and must not turn a committed persistence into a misleading failure acknowledgement.
    try { this.options.audit?.(event, { operation, ...(copy ? { copyId: copy.copyId, companyId: copy.companyId, documentKind: copy.documentKind, documentId: copy.documentId, localVersion: copy.localVersion } : {}), ...(code ? { code } : {}) }); }
    catch { /* Main logging failure must not change the persistence result. */ }
  }
  private perform<T>(operation: string, action: () => T): T {
    try { return action(); }
    catch (cause) {
      const failure = cause instanceof DraftWorkingCopyError ? cause : cause instanceof z.ZodError
        ? error("DRAFT_INPUT_INVALID", "编辑草稿参数无效，当前内容未被覆盖")
        : error("DRAFT_PERSIST_FAILED", "本地草稿保存失败；请保留编辑窗口，上次已确认的持久化快照仍保留");
      this.audit("DRAFT_OPERATION_FAILED", operation, undefined, failure.code);
      throw failure;
    }
  }
}

/** Reuse this before prepare and at the existing Publisher final-submit approval callback. */
export function assertNoUnsubmittedEdits(repository: AppRepository, articleId: string): void {
  try {
    const article = repository.getArticle(articleId);
    if (!article) throw error("DRAFT_DOCUMENT_NOT_FOUND", "文章不存在，请重新选择内容");
    const pending = repository.db.prepare(`SELECT w.copy_id FROM draft_working_copies w
      LEFT JOIN ai_generation_history g ON w.document_kind='StudioGeneration' AND g.generation_id=w.document_id
      WHERE w.company_id=? AND w.status IN ('Editing','Recovered','Conflict')
        AND (w.active_editing=1 OR w.snapshot_hash<>w.base_snapshot_hash)
        AND ((w.document_kind='Article' AND w.document_id=?) OR (w.document_kind='StudioGeneration' AND g.output_article_id=?)) LIMIT 1`)
      .get(article.brandId, articleId, articleId);
    if (pending) throw error("DRAFT_UNSUBMITTED_EDITS", "请先处理未提交编辑：提交并重新审核，或明确保留当前版本后再发布");
  } catch (cause) {
    if (cause instanceof DraftWorkingCopyError) throw cause;
    throw error("DRAFT_PERSIST_FAILED", "编辑草稿状态读取失败，暂不能继续发布，请保留当前内容后重试");
  }
}
