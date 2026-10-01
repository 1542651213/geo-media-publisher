import type { AppRepository } from "./repository";
import { DEFAULT_PROMPT_TEMPLATES, defaultEnterpriseAIContext, type EnterpriseAIContext, type PromptTemplate, type StudioValidation } from "@publisher/domain";

export interface GenerationHistory {
  generationId: string; companyId: string; sourceArticleId: string | null; provider: string; model: string;
  templateId: string; templateVersion: number; targetPlatform: string; createdAt: string;
  status: "Running" | "Generated" | "NeedsUserAction" | "Failed" | "Unknown" | "Saved";
  tokenUsage?: { input: number; output: number }; errorCode: string | null; outputArticleId: string | null; variantId: string | null;
}
export interface LocalAIDraft { generationId: string; title: string; body: string; validation: StudioValidation; contentType: "article" | "case" }
export interface GenerationInputs { profileId: string; purpose: string; contextVersion: number; contextHash: string; sourceHash: string; context: EnterpriseAIContext; sourceText: string }
function historyFromRow(row: Record<string, unknown>): GenerationHistory {
  return { generationId: String(row.generation_id), companyId: String(row.company_id), sourceArticleId: row.source_article_id as string | null, provider: String(row.provider), model: String(row.model), templateId: String(row.template_id), templateVersion: Number(row.template_version), targetPlatform: String(row.target_platform), createdAt: String(row.created_at), status: row.status as GenerationHistory["status"], tokenUsage: row.token_usage_json ? JSON.parse(String(row.token_usage_json)) as GenerationHistory["tokenUsage"] : undefined, errorCode: row.error_code as string | null, outputArticleId: row.output_article_id as string | null, variantId: row.variant_id as string | null };
}
export class AICenterStore {
  constructor(private readonly repository: AppRepository) {
    const insert = repository.db.prepare("INSERT OR IGNORE INTO ai_prompt_templates(template_id,version,template_json) VALUES(?,?,?)");
    repository.db.transaction(() => { for (const template of DEFAULT_PROMPT_TEMPLATES) insert.run(template.templateId, template.version, JSON.stringify(template)); })();
  }
  context(companyId: string): EnterpriseAIContext {
    const brand = this.repository.getBrand(companyId);
    if (!brand) throw new Error("企业不存在");
    const row = this.repository.db.prepare("SELECT context_json FROM ai_enterprise_contexts WHERE company_id=?").get(companyId) as { context_json: string } | undefined;
    return row ? JSON.parse(row.context_json) as EnterpriseAIContext : defaultEnterpriseAIContext(brand);
  }
  saveContext(context: EnterpriseAIContext): void {
    if (!this.repository.getBrand(context.companyId)) throw new Error("企业不存在");
    this.repository.db.prepare("INSERT INTO ai_enterprise_contexts(company_id,context_json,updated_at) VALUES(?,?,?) ON CONFLICT(company_id) DO UPDATE SET context_json=excluded.context_json,version=ai_enterprise_contexts.version+1,updated_at=excluded.updated_at").run(context.companyId, JSON.stringify(context), new Date().toISOString());
  }
  contextVersion(companyId: string): number {
    const row = this.repository.db.prepare("SELECT version FROM ai_enterprise_contexts WHERE company_id=?").get(companyId) as { version: number } | undefined;
    return row?.version ?? 0;
  }
  templates(): PromptTemplate[] {
    return (this.repository.db.prepare("SELECT template_json FROM ai_prompt_templates ORDER BY template_id,version").all() as Array<{ template_json: string }>).map(row => JSON.parse(row.template_json) as PromptTemplate);
  }
  saveTemplate(template: PromptTemplate): void {
    this.repository.db.prepare("INSERT INTO ai_prompt_templates(template_id,version,template_json) VALUES(?,?,?)").run(template.templateId, template.version, JSON.stringify(template));
  }
  start(history: GenerationHistory, inputs?: GenerationInputs): void {
    this.repository.db.transaction(() => {
    this.repository.db.prepare("INSERT INTO ai_generation_history(generation_id,company_id,source_article_id,provider,model,template_id,template_version,target_platform,created_at,status) VALUES(?,?,?,?,?,?,?,?,?,?)").run(history.generationId, history.companyId, history.sourceArticleId, history.provider, history.model, history.templateId, history.templateVersion, history.targetPlatform, history.createdAt, history.status);
    if (inputs) this.repository.db.prepare("INSERT INTO ai_generation_inputs(generation_id,profile_id,purpose,context_version,context_hash,source_hash,context_json,source_text) VALUES(?,?,?,?,?,?,?,?)").run(history.generationId, inputs.profileId, inputs.purpose, inputs.contextVersion, inputs.contextHash, inputs.sourceHash, JSON.stringify(inputs.context), inputs.sourceText);
    })();
  }
  inputs(generationId: string): GenerationInputs | null {
    const row = this.repository.db.prepare("SELECT * FROM ai_generation_inputs WHERE generation_id=?").get(generationId) as Record<string, unknown> | undefined;
    return row ? { profileId: String(row.profile_id), purpose: String(row.purpose), contextVersion: Number(row.context_version), contextHash: String(row.context_hash), sourceHash: String(row.source_hash), context: JSON.parse(String(row.context_json)) as EnterpriseAIContext, sourceText: String(row.source_text) } : null;
  }
  finish(history: GenerationHistory, draft?: LocalAIDraft): void {
    this.repository.db.transaction(() => {
      this.repository.db.prepare("UPDATE ai_generation_history SET status=?,token_usage_json=?,error_code=?,output_article_id=?,variant_id=? WHERE generation_id=?").run(history.status, history.tokenUsage ? JSON.stringify(history.tokenUsage) : null, history.errorCode, history.outputArticleId, history.variantId, history.generationId);
      if (draft) this.repository.db.prepare("INSERT INTO ai_local_drafts(generation_id,title,body,validation_json,content_type) VALUES(?,?,?,?,?) ON CONFLICT(generation_id) DO UPDATE SET title=excluded.title,body=excluded.body,validation_json=excluded.validation_json").run(draft.generationId, draft.title, draft.body, JSON.stringify(draft.validation), draft.contentType);
    })();
  }
  history(companyId?: string): GenerationHistory[] {
    const rows = this.repository.db.prepare(`SELECT * FROM ai_generation_history ${companyId ? "WHERE company_id=?" : ""} ORDER BY created_at DESC LIMIT 200`).all(...(companyId ? [companyId] : [])) as Array<Record<string, unknown>>;
    return rows.map(historyFromRow);
  }
  generation(generationId: string): GenerationHistory | null {
    const row = this.repository.db.prepare("SELECT * FROM ai_generation_history WHERE generation_id=?").get(generationId) as Record<string, unknown> | undefined;
    return row ? historyFromRow(row) : null;
  }
  draft(generationId: string): LocalAIDraft | null {
    const row = this.repository.db.prepare("SELECT * FROM ai_local_drafts WHERE generation_id=?").get(generationId) as { title: string; body: string; validation_json: string; content_type: "article" | "case" } | undefined;
    return row ? { generationId, title: row.title, body: row.body, validation: JSON.parse(row.validation_json) as StudioValidation, contentType: row.content_type } : null;
  }
  recoverInterrupted(): number {
    return this.repository.db.prepare("UPDATE ai_generation_history SET status='Unknown',error_code='INTERRUPTED_RESULT_UNKNOWN' WHERE status='Running'").run().changes;
  }
  verification(profileId: string): { lastVerifiedAt: string | null; status: string; errorCode: string | null } {
    const row = this.repository.db.prepare("SELECT last_verified_at,status,error_code FROM ai_provider_verifications WHERE profile_id=?").get(profileId) as { last_verified_at: string | null; status: string; error_code: string | null } | undefined;
    return row ? { lastVerifiedAt: row.last_verified_at, status: row.status, errorCode: row.error_code } : { lastVerifiedAt: null, status: "NotVerified", errorCode: null };
  }
  isProductProfile(profileId: string): boolean { return Boolean(this.repository.db.prepare("SELECT 1 FROM ai_provider_verifications WHERE profile_id=?").get(profileId)); }
  isDefaultProfile(profileId: string): boolean { return Boolean((this.repository.db.prepare("SELECT is_default FROM ai_provider_verifications WHERE profile_id=?").get(profileId) as { is_default: number } | undefined)?.is_default); }
  setDefaultProfile(profileId: string, enabled: boolean): void {
    if (enabled) this.repository.db.prepare("UPDATE ai_provider_verifications SET is_default=0").run();
    this.repository.db.prepare("UPDATE ai_provider_verifications SET is_default=? WHERE profile_id=?").run(enabled ? 1 : 0, profileId);
  }
  saveVerification(profileId: string, status: string, errorCode: string | null): void {
    this.repository.db.prepare("INSERT INTO ai_provider_verifications(profile_id,last_verified_at,status,error_code) VALUES(?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET last_verified_at=excluded.last_verified_at,status=excluded.status,error_code=excluded.error_code").run(profileId, status === "Verified" ? new Date().toISOString() : null, status, errorCode);
  }
}
export const createAICenterStore = (repository: AppRepository): AICenterStore => new AICenterStore(repository);
