import { z } from "zod";
import type { AppRepository } from "@publisher/db";
import type { Account } from "@publisher/domain";
import type { OperationsRuntimeHealth } from "../shared/content-operations";
import type { AccountBindingBlocker, AccountBindingBlockerCode, AccountOnboardingAccount, AccountOnboardingConfirmationResult,
  AccountOnboardingEvidence, AccountOnboardingEvidenceState, AccountOnboardingSource } from "../shared/account-onboarding";
import { productPlatform } from "../shared/product-platform-policy";

const idSchema = z.string().trim().min(1).max(200);
const confirmationSchema = z.strictObject({ accountId: idSchema, companyId: idSchema, expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  expectedCompanyId: idSchema.nullable(), confirmReassignment: z.boolean().optional().default(false) });

interface BindingRow { account_id: string; company_id: string; version: number }
interface HistoryRow { account_id: string; job_id: string; article_id: string; company_id: string }
interface EvidenceAccumulator { companyId: string; jobCount: number; articles: Set<string>; sources: AccountOnboardingSource[] }
interface ReferenceGuard { code: AccountBindingBlockerCode; scope: "BindingChange" | "Reassignment"; summary: string; sql: string }

export interface AccountOnboardingOptions {
  /** Synchronous Main-only invalidation; it must not authenticate, probe a platform or modify historical data.
   * Invalidate the request epoch even when same-company reconfirmation keeps the bindingVersion unchanged. */
  invalidateAuthentication(accountId: string, platformKey: string, bindingVersion: number): void;
  runtimeHealth?(accountId: string, platformKey: string): OperationsRuntimeHealth | null;
  now?: () => Date;
}

const referenceGuards: readonly ReferenceGuard[] = [
  { code: "ACTIVE_PUBLISH_JOB", scope: "BindingChange", summary: "发布任务正在运行或提交", sql: `SELECT COUNT(*) AS count FROM publish_jobs WHERE account_id=?
    AND status IN ('Running','Preparing','ReadyToSubmit','Submitting','Submitted','Publishing')` },
  { code: "UNRESOLVED_PUBLISH_JOB", scope: "Reassignment", summary: "原发布任务的未知结果须保留并核对", sql: `SELECT COUNT(*) AS count FROM publish_jobs WHERE account_id=?
    AND status IN ('NeedsReconciliation','Unknown')` },
  { code: "FROZEN_SUBMISSION_INTENT", scope: "Reassignment", summary: "提交意图已有冻结、一次提交声明或未知结果", sql: `SELECT COUNT(*) AS count FROM submission_intents WHERE account_id=?
    AND (final_submit_count>=1 OR submit_boundary_entered_at IS NOT NULL OR state IN ('Prepared','Submitting','Submitted','Unknown')
      OR remote_status IN ('UNCERTAIN','CONFIRMING','SCHEDULED_ACCEPTED'))` },
  { code: "FROZEN_PUBLISH_RECORD", scope: "Reassignment", summary: "已有编辑器准备或冻结的浏览器发布记录", sql: `SELECT COUNT(*) AS count FROM publish_records WHERE account_id=?
    AND (status IN ('Prepared','Preparing','Submitting','Submitted','Publishing','NeedsReconciliation','Unknown')
      OR CASE WHEN json_valid(response_json) THEN json_extract(response_json,'$.contentTransport') IN ('ARTICLE_BROWSER','DOUYIN_IMAGE_TEXT_BROWSER') ELSE 0 END)` },
  { code: "FROZEN_TOUTIAO_PREPARATION", scope: "Reassignment", summary: "头条文章设置或准备内容已冻结", sql: "SELECT COUNT(*) AS count FROM toutiao_article_job_preparations WHERE account_id=?" },
  { code: "FROZEN_TOUTIAO_FINAL_BINDING", scope: "Reassignment", summary: "头条最终提交身份和内容已冻结", sql: "SELECT COUNT(*) AS count FROM toutiao_article_final_bindings WHERE account_id=?" },
  { code: "FROZEN_DOUYIN_JOB", scope: "Reassignment", summary: "抖音图文设置或一次图片选择操作已冻结", sql: `SELECT COUNT(*) AS count FROM publish_jobs WHERE account_id=? AND platform_key='douyin'
    AND CASE WHEN json_valid(publish_payload_json) THEN (json_type(publish_payload_json,'$.douyinImageTextSettings') IS NOT NULL
      OR json_type(publish_payload_json,'$.douyinImageSelection') IS NOT NULL) ELSE 1 END` },
  { code: "ACTIVE_DOUYIN_CONNECTION", scope: "Reassignment", summary: "抖音 Creator 连接仍有有效身份绑定", sql: "SELECT COUNT(*) AS count FROM douyin_image_text_connections WHERE account_id=? AND active=1" },
  { code: "FROZEN_B01_AUTHORIZATION", scope: "Reassignment", summary: "抖音历史验收授权和原内容绑定须保留", sql: "SELECT COUNT(*) AS count FROM b01_product_e2e_authorization WHERE account_id=?" },
  { code: "FROZEN_WEBSITE_OPERATION", scope: "Reassignment", summary: "官网原操作已绑定站点、身份和内容", sql: "SELECT COUNT(*) AS count FROM official_api_operations WHERE account_id=?" }
];

function onboardingError(code: string, message: string, blockers?: AccountBindingBlocker[]): Error {
  return Object.assign(new Error(message), { code, ...(blockers ? { blockers } : {}) });
}

/** Owner previews and confirmations reuse the F binding table. Preview never initializes, authenticates or writes. */
export class AccountOnboarding {
  constructor(private readonly repository: AppRepository, private readonly options: AccountOnboardingOptions) {}

  preview(): AccountOnboardingAccount[] {
    const companies = new Map(this.repository.listBrands().map(company => [company.id, company]));
    const bindings = new Map((this.repository.db.prepare("SELECT account_id,company_id,version FROM operations_account_company_bindings").all() as BindingRow[])
      .map(binding => [binding.account_id, binding]));
    const byAccount = new Map<string, Map<string, EvidenceAccumulator>>();
    // Only relational metadata is read; article body/title, PublishRecord responses and credentials are absent.
    const history = this.repository.db.prepare(`SELECT j.account_id,j.id AS job_id,a.id AS article_id,a.brand_id AS company_id
      FROM publish_jobs j JOIN articles a ON a.id=j.article_id JOIN brands b ON b.id=a.brand_id
      ORDER BY j.account_id,a.brand_id,j.created_at,j.id`).all() as HistoryRow[];
    for (const row of history) {
      let evidence = byAccount.get(row.account_id);
      if (!evidence) { evidence = new Map(); byAccount.set(row.account_id, evidence); }
      let entry = evidence.get(row.company_id);
      if (!entry) { entry = { companyId: row.company_id, jobCount: 0, articles: new Set(), sources: [] }; evidence.set(row.company_id, entry); }
      entry.jobCount += 1;
      entry.articles.add(row.article_id);
      if (entry.sources.length < 3) entry.sources.push({ jobId: row.job_id, articleId: row.article_id, brandId: row.company_id });
    }
    return this.repository.listAccounts({ includeArchived: true }).map((account): AccountOnboardingAccount => {
      const binding = bindings.get(account.id);
      const currentCompanyId = binding?.company_id ?? null;
      const currentCompany = currentCompanyId ? companies.get(currentCompanyId) : null;
      const evidence: AccountOnboardingEvidence[] = [...(byAccount.get(account.id)?.values() ?? [])].map(entry => {
        const company = companies.get(entry.companyId);
        return { companyId: entry.companyId, companyName: company?.companyName || company?.name || "企业资料缺失", source: "HistoricalJobArticleBrand" as const,
          jobCount: entry.jobCount, articleCount: entry.articles.size, brandCount: 1, sources: entry.sources };
      });
      const evidenceState: AccountOnboardingEvidenceState = binding ? "Confirmed" : evidence.length === 1 ? "Unique" : evidence.length > 1 ? "Conflict" : "NoEvidence";
      const suggested = evidenceState === "Unique" ? evidence[0] : null;
      const health = this.options.runtimeHealth?.(account.id, account.platformKey) ?? null;
      const archived = Boolean(account.archivedAt);
      const bindingBlockers = this.bindingBlockers(account.id, binding ? "Reassignment" : "BindingChange");
      const verificationState = archived || !account.enabled ? "DISABLED" : health?.state ?? "UNVERIFIED";
      const conflictReason = evidence.length > 1 ? "历史使用涉及多个企业，不能自动认定归属" : binding && evidence.length === 1 && evidence[0]?.companyId !== currentCompanyId
        ? "历史使用企业与当前已确认归属不同，修改前须 Owner 核对" : null;
      return { accountId: account.id, platformKey: account.platformKey, accountName: account.accountName || account.accountAlias || account.name,
        enabled: account.enabled, archived, currentCompanyId, currentCompanyName: currentCompany ? currentCompany.companyName || currentCompany.name : null,
        currentBindingVersion: binding ? this.validVersion(binding.version) : 0, evidenceState, suggestedCompanyId: suggested?.companyId ?? null,
        suggestedCompanyName: suggested?.companyName ?? null, evidence, evidenceSummary: evidence.length ? evidence.map(entry => `${entry.companyName}：${entry.jobCount} 个历史任务、${entry.articleCount} 篇文章`).join("；") : "没有可核验的历史任务、文章和企业关系；昵称不作为归属证据",
        conflictReason, verificationState, checkedAt: health?.checkedAt ?? null, platformOrdinaryEnabled: productPlatform(account.platformKey)?.ordinaryPublishEnabled === true,
        articlePublishEligibility: "NotEvaluated", bindingBlockers, canConfirm: !archived && (Boolean(binding) || bindingBlockers.length === 0),
        canReassign: !archived && Boolean(binding) && bindingBlockers.length === 0,
        nextAction: archived ? "账号已归档，先由 Owner 在账号中心核对" : bindingBlockers.length ? binding
          ? "当前企业可再次确认；修改归属前须保留原任务和冻结数据，先核对原操作" : "发布任务仍在运行，先核对原操作后再确认企业" : !currentCompanyId
          ? evidenceState === "Conflict" ? "核对历史冲突，逐账号选择并确认所属企业" : "先核对并确认所属企业，之后再检查身份"
          : !account.enabled ? "账号已停用，需要使用时由 Owner 明确启用" : "所属企业已确认，按当前认证状态检查身份；确认归属不等于认证成功" };
    });
  }

  confirm(payload: unknown): AccountOnboardingConfirmationResult {
    const input = confirmationSchema.parse(payload);
    return this.repository.db.transaction(() => {
      const account = this.repository.getAccountById(input.accountId);
      if (!account) throw onboardingError("ACCOUNT_NOT_FOUND", "账号不存在");
      if (account.archivedAt) throw onboardingError("ACCOUNT_ARCHIVED", "账号已归档，请先由 Owner 核对");
      if (!this.repository.getBrand(input.companyId)) throw onboardingError("COMPANY_NOT_FOUND", "企业不存在");
      const existing = this.repository.db.prepare("SELECT account_id,company_id,version FROM operations_account_company_bindings WHERE account_id=?").get(account.id) as BindingRow | undefined;
      const version = existing ? this.validVersion(existing.version) : 0;
      const previousCompanyId = existing?.company_id ?? null;
      if (version !== input.expectedVersion || previousCompanyId !== input.expectedCompanyId)
        throw onboardingError("ACCOUNT_BINDING_VERSION_CONFLICT", "账号归属版本已变化，请刷新逐账号映射后重新确认");
      if (existing && previousCompanyId === input.companyId) {
        // Reconfirming the same company does not migrate a frozen operation or mutate version/timestamps.
        this.options.invalidateAuthentication(account.id, account.platformKey, version);
        return this.confirmationResult(account, input.companyId, previousCompanyId, version);
      }
      if (existing && previousCompanyId !== input.companyId && !input.confirmReassignment)
        throw onboardingError("ACCOUNT_REASSIGNMENT_CONFIRMATION_REQUIRED", "已绑定账号需要 Owner 明确确认修改归属");
      // Historical terminal/frozen rows belong to their original operation. They do not prevent initial ownership assignment.
      const blockers = this.bindingBlockers(account.id, existing ? "Reassignment" : "BindingChange");
      if (blockers.length) throw onboardingError("ACCOUNT_BINDING_LOCKED", "账号存在运行或冻结绑定，不能修改归属；请保留原任务并核对", blockers);
      const timestamp = (this.options.now?.() ?? new Date()).toISOString();
      const nextVersion = version + 1;
      if (!Number.isSafeInteger(nextVersion)) throw onboardingError("ACCOUNT_BINDING_VERSION_INVALID", "账号归属版本无效，请保留现场并检查");
      if (existing) {
        const updated = this.repository.db.prepare(`UPDATE operations_account_company_bindings SET company_id=?,updated_at=?,version=version+1
          WHERE account_id=? AND company_id=? AND version=?`).run(input.companyId, timestamp, account.id, previousCompanyId, version);
        if (updated.changes !== 1) throw onboardingError("ACCOUNT_BINDING_VERSION_CONFLICT", "账号归属版本已变化，请刷新逐账号映射后重新确认");
      } else {
        this.repository.db.prepare("INSERT INTO operations_account_company_bindings(account_id,company_id,bound_at,updated_at,version) VALUES(?,?,?,?,1)")
          .run(account.id, input.companyId, timestamp, timestamp);
      }
      // This synchronous callback invalidates pending requests before another event-loop turn can commit old auth.
      // A callback failure rolls back this binding transaction; it is always safe to leave runtime auth invalidated.
      this.options.invalidateAuthentication(account.id, account.platformKey, nextVersion);
      return this.confirmationResult(account, input.companyId, previousCompanyId, nextVersion);
    }).immediate();
  }

  private validVersion(version: number): number {
    if (!Number.isSafeInteger(version) || version < 1) throw onboardingError("ACCOUNT_BINDING_VERSION_INVALID", "账号归属版本无效，请保留现场并检查");
    return version;
  }

  private bindingBlockers(accountId: string, scope: ReferenceGuard["scope"]): AccountBindingBlocker[] {
    return referenceGuards.filter(guard => scope === "Reassignment" || guard.scope === "BindingChange").flatMap(guard => {
      const row = this.repository.db.prepare(guard.sql).get(accountId) as { count: number };
      return row.count > 0 ? [{ code: guard.code, count: row.count, summary: guard.summary }] : [];
    });
  }

  private confirmationResult(account: Account, companyId: string, previousCompanyId: string | null, bindingVersion: number): AccountOnboardingConfirmationResult {
    return { accountId: account.id, platformKey: account.platformKey, companyId, previousCompanyId, bindingVersion,
      authenticated: false, verificationState: "UNVERIFIED", requiresIdentityVerification: true };
  }
}
