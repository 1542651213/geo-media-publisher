import { assertAIRequestProfile } from './ai-request-budget';
import { aiRequestGovernor, requestFingerprint } from "./ai-request-budget";
import type { AISentDataPreview,AIWorkloadPreview } from "../shared/ai-request-budget";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAICenterStore, type AppRepository, type GenerationHistory, type LocalAIDraft } from "@publisher/db";
import { createTextProvider, PROVIDER_DEFINITIONS, TextProviderError, validateProviderConfig, type ProviderKey } from "@publisher/ai";
import { STUDIO_PURPOSES, STUDIO_TARGETS, platformContentPolicy, validateStudioDraft, type EnterpriseAIContext, type PromptTemplate, type StudioValidation } from "@publisher/domain";
import type { CredentialStore } from "@publisher/security";

export interface ProductProviderProfile { id: string; provider: ProviderKey; displayName: string; baseUrl: string; defaultModel: string; configured: boolean; isDefault: boolean; lastVerifiedAt: string | null; verificationStatus: string }
export interface StudioGenerationOptions { budgetId?:string; signal?:AbortSignal; beforeRequest?:()=>void }
export interface StudioRequest { previewId?:string; companyId: string; sourceArticleId: string | null; sourceText: string; purpose: string; targetPlatforms: string[]; profileId: string; model: string; templateId: string; templateVersion: number }
export interface StudioOutput extends LocalAIDraft { status: GenerationHistory["status"]; platformKey: string; errorMessage?: string }
const providerKeys = ["mimo", "openai", "deepseek", "ollama", "custom"] as const;
const list = z.array(z.string().trim().min(1).max(2000)).max(100);
const contextSchema = z.strictObject({ companyId: z.string().min(1), companyName: z.string().trim().min(1).max(200), brandNames: list, serviceAreas: list, coreServices: list, contactInfo: z.record(z.string().max(80), z.string().max(1000)), verifiedSellingPoints: list, approvedClaims: list, forbiddenClaims: list, seoKeywords: list, geoKeywords: list, tone: z.string().max(1000), officialWebsite: z.string().max(2000) });
const templateSchema = z.strictObject({ templateId: z.string().regex(/^[a-z0-9_-]{1,80}$/u), name: z.string().trim().min(1).max(100), version: z.number().int().positive(), targetPlatform: z.enum(STUDIO_TARGETS).nullable(), contentType: z.enum(["article", "case"]), systemPrompt: z.string().trim().min(1).max(20000), userPromptTemplate: z.string().trim().min(1).max(20000), enabled: z.boolean() });
const studioSchema=z.strictObject({ companyId: z.string().min(1), sourceArticleId: z.string().min(1).nullable(), sourceText: z.string().max(100000), purpose: z.enum(STUDIO_PURPOSES), targetPlatforms: z.array(z.enum(STUDIO_TARGETS)).min(1).max(6), profileId: z.string().min(1), model: z.string().trim().min(1).max(200), templateId: z.string().min(1), templateVersion: z.number().int().positive(), previewId:z.string().min(1).optional() });
export class AIProductCenter {
  readonly store;
  private readonly inFlight = new Set<string>();
  private readonly activeWork=new Map<string,Promise<void>>();
  private readonly activeControllers=new Map<string,AbortController>();
  private readonly pendingReads=new Set<Promise<unknown>>();
  readonly governor;
  constructor(private readonly repository: AppRepository, private readonly credentials: CredentialStore, private readonly fetchPort: typeof fetch = fetch,
    private readonly approvedFacts: (companyId: string) => string[] = () => []) {
    this.store = createAICenterStore(repository);
    this.governor=aiRequestGovernor(repository);
  }
  definitions() { return PROVIDER_DEFINITIONS; }
  profiles(): ProductProviderProfile[] {
    return this.repository.listAiProviderProfiles().filter(profile => this.store.isProductProfile(profile.id) && providerKeys.includes(profile.provider as ProviderKey)).map(profile => {
      const verification = this.store.verification(profile.id);
      const safeRef = profile.credentialRef.startsWith("ai:");
      return { id: profile.id, provider: profile.provider as ProviderKey, displayName: profile.name, baseUrl: profile.baseUrl, defaultModel: profile.model, configured: profile.provider === "ollama" || safeRef && this.credentials.has(profile.credentialRef), isDefault: this.store.isDefaultProfile(profile.id), lastVerifiedAt: verification.lastVerifiedAt, verificationStatus: verification.status };
    });
  }
  saveProfile(payload: unknown): ProductProviderProfile {
    const input = z.strictObject({ id: z.string().min(1).optional(), provider: z.enum(providerKeys), displayName: z.string().trim().min(1).max(100), baseUrl: z.string().url().max(2000), defaultModel: z.string().trim().min(1).max(200), isDefault: z.boolean() }).parse(payload);
    const old = input.id ? this.repository.getAiProviderProfile(input.id) : null;
    if (input.id && !old) throw new Error("服务商配置不存在");
    if (old && !this.store.isProductProfile(old.id)) throw new Error("历史配置请在 Developer Mode 管理，或新建服务商配置");
    if (old && old.provider !== input.provider) throw new Error("请新建配置以切换服务商，避免复用错误凭据");
    validateProviderConfig({ provider: input.provider, baseUrl: input.baseUrl, defaultModel: input.defaultModel });
    const id = old?.id ?? randomUUID();
    const credentialRef = old?.credentialRef.startsWith("ai:") ? old.credentialRef : `ai:provider:${id}`;
    if (old && old.baseUrl.replace(/\/+$/u, "") !== input.baseUrl.replace(/\/+$/u, "")) this.credentials.delete(credentialRef);
    this.repository.db.transaction(() => {
      this.repository.upsertAiProviderProfile({ id, name: input.displayName, provider: input.provider, baseUrl: input.baseUrl, model: input.defaultModel, credentialRef, temperature: 0.7, maxOutputTokens: 3000, timeoutMs: 30000, retryCount: 0, concurrency: 2, enabled: true, isDefault: false, isFallback: false });
      if (!old) this.store.saveVerification(id, "NotVerified", null);
      this.store.setDefaultProfile(id, input.isDefault);
      if (input.isDefault) this.repository.setSetting("productDefaultAIProfileId", id);
      if (old && (old.model !== input.defaultModel || old.baseUrl !== input.baseUrl)) this.store.saveVerification(id, "NotVerified", null);
    })();
    return this.profiles().find(profile => profile.id === id)!;
  }
  setCredential(id: string, value: string): void {
    const profile = this.profile(id);
    if (profile.provider === "ollama") throw new Error("本机 Ollama 无需 API Key");
    const key = z.string().trim().min(1).max(8192).parse(value);
    if (/[\r\n]/u.test(key)) throw new Error("API Key 格式无效");
    this.credentials.set(profile.credentialRef, key);
    this.repository.setSetting(`productAIKeyRevision:${id}`,Number(this.repository.getSettings()[`productAIKeyRevision:${id}`]??0)+1);
    this.store.saveVerification(id, "NotVerified", null);
  }
  saveLegacyProfile(payload: unknown) {
    const input = z.strictObject({ id: z.string().optional(), name: z.string().min(1), provider: z.string().min(1), baseUrl: z.string().url(), model: z.string().min(1), credentialRef: z.string(), temperature: z.number().min(0).max(2), maxOutputTokens: z.number().int().min(128).max(32000), timeoutMs: z.number().int().min(1000).max(300000), retryCount: z.number().int().min(0).max(5), concurrency: z.number().int().min(1).max(20), enabled: z.boolean(), isDefault: z.boolean(), isFallback: z.boolean() }).parse(payload);
    const old = input.id ? this.repository.getAiProviderProfile(input.id) : null;
    if (input.id && (!old || this.store.isProductProfile(input.id))) throw new Error("此配置只能通过 Provider Center 管理");
    if (input.provider !== "mock") validateProviderConfig({ provider: providerKeys.includes(input.provider as ProviderKey) ? input.provider as ProviderKey : "custom", baseUrl: input.baseUrl, defaultModel: input.model });
    const id = old?.id ?? randomUUID();
    const unchanged = old && old.provider === input.provider && old.baseUrl.replace(/\/+$/u, "") === input.baseUrl.replace(/\/+$/u, "");
    const credentialRef = `ai:legacy:${id}`;
    if (old && !unchanged) this.credentials.delete(credentialRef);
    return this.repository.upsertAiProviderProfile({ ...input, id, credentialRef });
  }
  deleteLegacyProfile(id: string): void {
    if (this.store.isProductProfile(id)) throw new Error("正式服务商配置不可从历史入口删除");
    this.repository.deleteAiProviderProfile(id);
    this.credentials.delete(`ai:legacy:${id}`);
  }
  setLegacyCredential(id: string, value: string): void {
    const profile = this.repository.getAiProviderProfile(id);
    if (!profile || this.store.isProductProfile(id)) throw new Error("历史服务商配置不存在");
    const key = z.string().trim().min(1).max(8192).parse(value);
    if (/[\r\n]/u.test(key)) throw new Error("API Key 格式无效");
    const credentialRef = `ai:legacy:${id}`;
    this.credentials.set(credentialRef, key);
    this.repository.upsertAiProviderProfile({ ...profile, credentialRef });
  }
  legacyProfileConfigured(id: string): boolean {
    const profile = this.repository.getAiProviderProfile(id);
    return Boolean(profile && !this.store.isProductProfile(id) && profile.credentialRef === `ai:legacy:${id}` && this.credentials.has(profile.credentialRef));
  }
  private profile(id: string) {
    const profile = this.repository.getAiProviderProfile(id);
    if (!profile || !this.store.isProductProfile(id) || !providerKeys.includes(profile.provider as ProviderKey) || profile.credentialRef !== `ai:provider:${id}`) throw new Error("服务商配置或凭据引用无效");
    return profile;
  }
  private client(id: string) {
    const profile = this.profile(id);assertAIRequestProfile(profile);
    return createTextProvider({ provider: profile.provider as ProviderKey, baseUrl: profile.baseUrl, defaultModel: profile.model, timeoutMs: profile.timeoutMs, maxOutputTokens: profile.maxOutputTokens }, profile.provider === "ollama" ? null : this.credentials.get(profile.credentialRef), this.fetchPort);
  }
  private async trackedRead<T>(operation:()=>Promise<T>):Promise<T>{const pending=this.governor.read(operation);this.pendingReads.add(pending);try{return await pending;}finally{this.pendingReads.delete(pending);}}
  listModels(id: string) { return this.trackedRead(()=>this.client(id).listModels()); }
  async testConnection(id: string): Promise<{ ok: boolean; message: string }> {
    if(this.profile(id).provider==='mimo')return{ok:false,message:'此服务商的连接探测会发出计费生成请求。请先在 AI Studio 查看资料和请求预算，再明确发起一次生成；本入口不会发出付费探测。'};
    try { const result = await this.trackedRead(()=>this.client(id).testConnection()); this.store.saveVerification(id, result.ok ? "Verified" : "Unavailable", null); return result; }
    catch (error) { this.store.saveVerification(id, "Failed", error instanceof TextProviderError ? error.code : "CONNECTION_FAILED"); return { ok: false, message: error instanceof TextProviderError ? error.message : "连接验证失败，请检查配置和安全存储" }; }
  }
  context(companyId: string) { return this.store.context(companyId); }
  private effectiveContext(companyId: string) {
    const context = this.store.context(companyId);
    return { ...context, approvedClaims: [...new Set([...context.approvedClaims, ...this.approvedFacts(companyId)])] };
  }
  saveContext(payload: unknown): EnterpriseAIContext { const context = contextSchema.parse(payload); this.store.saveContext(context); return context; }
  templates() { return this.store.templates(); }
  saveTemplate(payload: unknown): PromptTemplate {
    const template = templateSchema.parse(payload);
    const versions = this.templates().filter(item => item.templateId === template.templateId);
    const expected = Math.max(0, ...versions.map(item => item.version)) + 1;
    if (template.version !== expected) throw new Error(`模板版本已更新，请使用版本 ${expected}`);
    this.store.saveTemplate(template); return template;
  }
  history(companyId?: string) { return this.store.history(companyId); }
  draft(id: string) { return this.store.draft(id); }
  private validation(companyId: string, platformKey: string, title: string, body: string, contentType: string, sourceFacts?: string): StudioValidation {
    const others = this.repository.listBrands().filter(brand => brand.id !== companyId);
    return validateStudioDraft({ context: this.effectiveContext(companyId), platformKey, title, body, contentType, sourceFacts, otherCompanies: others.map(brand => brand.companyName), otherBrands: others.map(brand => brand.name), recent: this.repository.listArticles({ brandId: companyId }).slice(0, 100) });
  }
  validateDraft(id: string, title: string, body: string): StudioValidation {
    const history = this.store.generation(id), draft = this.draft(id);
    if (!history || !draft) throw new Error("生成记录不存在");
    return this.validation(history.companyId, history.targetPlatform, title, body, draft.contentType, this.store.inputs(id)?.sourceText);
  }
  configurationFingerprint(input:{companyId:string;profileId:string;model:string;templateId:string;templateVersion:number}):string {
    const profile=this.profile(input.profileId),template=this.templates().find(item=>item.templateId===input.templateId&&item.version===input.templateVersion);
    return requestFingerprint({companyId:input.companyId,context:this.effectiveContext(input.companyId),contextVersion:this.store.contextVersion(input.companyId),profile,credentialRevision:this.repository.getSettings()[`productAIKeyRevision:${input.profileId}`]??0,model:input.model,template});
  }
  private generationFingerprint(input:StudioRequest):string {const {previewId:_preview,...request}=input;const source=input.sourceArticleId?this.repository.getArticle(input.sourceArticleId):null;return requestFingerprint({...request,sourceVersion:source?.contentHash??null,sourceText:source?source.title+"\n"+source.body:input.sourceText});}
  requestDataPreview(input:{companyId:string;profileId:string;templateId:string;templateVersion:number;sourceText:string},sourcePolicy='仅发送所选源稿、当前企业 AI Context 和明确允许 AI 使用的事实；标题修复仍使用相同事实边界。'):AISentDataPreview{
    const context=this.effectiveContext(input.companyId),profile=this.profile(input.profileId),template=this.templates().find(item=>item.templateId===input.templateId&&item.version===input.templateVersion&&item.enabled);if(!template)throw new Error('模板不存在或已停用');assertAIRequestProfile(profile);
    return{provider:profile.provider,endpoint:profile.baseUrl,companyName:context.companyName,sourceText:input.sourceText,contextText:JSON.stringify(context,null,2),templateText:template.systemPrompt+'\n'+template.userPromptTemplate,sourcePolicy};
  }
  previewGeneration(payload:unknown):AIWorkloadPreview {
    const input=studioSchema.parse(payload),source=input.sourceArticleId?this.repository.getArticle(input.sourceArticleId):null;
    if(input.sourceArticleId&&(!source||source.brandId!==input.companyId))throw new Error("源文章与当前企业不匹配");
    if(!(source?source.title+source.body:input.sourceText).trim())throw new Error("请提供源稿或资料");
    const profile=this.profile(input.profileId),count=new Set(input.targetPlatforms).size;
    return this.governor.preview({kind:"Studio",companyId:input.companyId,sourceCount:1,targetCount:count,workItemCount:count,baseRequests:count,maxRequests:count*2,titleRepairAllowance:count,rateLimitRetryAllowance:0,globalConcurrency:1,maxOutputTokensPerRequest:profile.maxOutputTokens,inputCharacters:(source?source.title+source.body:input.sourceText).length+JSON.stringify(this.effectiveContext(input.companyId)).length,model:input.model,templateId:input.templateId,templateVersion:input.templateVersion,costEstimate:null,currency:null,dataSent:this.requestDataPreview({...input,sourceText:source?source.title+'\n'+source.body:input.sourceText})},this.generationFingerprint(input),this.configurationFingerprint(input));
  }
  requestBudget(id:string,companyId:string){const budget=this.governor.get(id);if(budget.companyId!==companyId)throw new Error("AI_BUDGET_COMPANY_MISMATCH");return budget;}
  cancel(companyId:string):void {this.activeControllers.get(companyId)?.abort();}
  async waitForIdle():Promise<void>{await Promise.all([...this.activeWork.values(),...this.pendingReads]);}
  cancelAll():void {for(const controller of this.activeControllers.values())controller.abort();}
  async generate(payload: unknown, options:StudioGenerationOptions={}): Promise<StudioOutput[]> {
    const input = studioSchema.parse(payload);
    if (this.inFlight.has(input.companyId)) throw new Error("该企业已有生成请求，请等待完成");
    const context = this.effectiveContext(input.companyId), contextVersion = this.store.contextVersion(input.companyId), source = input.sourceArticleId ? this.repository.getArticle(input.sourceArticleId) : null;
    if (input.sourceArticleId && (!source || source.brandId !== input.companyId)) throw new Error("源文章与当前企业不匹配");
    const sourceText = source ? `${source.title}\n${source.body}` : input.sourceText;
    if (!sourceText.trim()) throw new Error("请提供源稿或资料");
    const template = this.templates().find(item => item.templateId === input.templateId && item.version === input.templateVersion && item.enabled);
    if (!template) throw new Error("模板不存在或已停用");
    const profile = this.profile(input.profileId);
    const client = this.client(input.profileId);
    const controller=new AbortController(),signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
    const fingerprint=this.generationFingerprint(input),snapshot=this.configurationFingerprint(input);
    const previewId=options.budgetId??input.previewId??this.previewGeneration(input).previewId;
    if(options.budgetId){const budget=this.requestBudget(previewId,input.companyId);if(budget.status!=="Active"||budget.snapshotFingerprint!==snapshot)throw new TextProviderError("AI_PREVIEW_STALE","工作量确认已失效，请重新预览");}
    else this.governor.activate(previewId,input.companyId,fingerprint,snapshot);
    const beforeRequest=():void=>{if(this.generationFingerprint(input)!==fingerprint)throw new TextProviderError("RESULT_CONTEXT_CHANGED","源稿已变化，请重新预览；原结果保留供人工核对");options.beforeRequest?.();};
    let completeWork:()=>void=()=>{};this.activeWork.set(input.companyId,new Promise<void>(resolve=>{completeWork=resolve;}));
    this.activeControllers.set(input.companyId,controller);
    this.inFlight.add(input.companyId);
    try {
      const outputs: StudioOutput[] = [];
      for (const platformKey of new Set(input.targetPlatforms)) {
        if(signal.aborted)break;
        const history: GenerationHistory = { generationId: randomUUID(), companyId: input.companyId, sourceArticleId: source?.id ?? null, provider: profile.provider, model: input.model, templateId: template.templateId, templateVersion: template.version, targetPlatform: platformKey, createdAt: new Date().toISOString(), status: "Running", errorCode: null, outputArticleId: null, variantId: null };
        this.store.start(history, { profileId: profile.id, purpose: input.purpose, contextVersion, contextHash: createHash("sha256").update(JSON.stringify(context)).digest("hex"), sourceHash: createHash("sha256").update(sourceText).digest("hex"), context, sourceText });
        this.repository.db.prepare("UPDATE ai_generation_history SET request_budget_id=? WHERE generation_id=?").run(previewId,history.generationId);
        let knownDraft:LocalAIDraft|undefined;
        try {
          if (template.targetPlatform && template.targetPlatform !== platformKey) throw new TextProviderError("TEMPLATE_PLATFORM_MISMATCH", "该模板仅适用于指定平台；多平台请选通用模板");
          const variables: Record<string, string> = { purpose: input.purpose, context: JSON.stringify(context), source: sourceText, platform: platformKey, policy: JSON.stringify(platformContentPolicy(platformKey)) };
          const userPrompt = template.userPromptTemplate.replace(/\{\{(purpose|context|source|platform|policy)\}\}/gu, (_, key: string) => variables[key]!);
          const mandatoryContext = `企业事实边界：${JSON.stringify(context)}\n平台限制：${JSON.stringify(platformContentPolicy(platformKey))}\n仅使用所提供资料；未知认证、排名、客户、合作品牌、检测数据不得补全。输出 JSON {title,body}。`;
          const result = await this.governor.run(previewId,history.generationId,"Base",()=>this.configurationFingerprint(input),()=>client.generateText({ model: input.model, systemPrompt: `${mandatoryContext}\n${template.systemPrompt}`, userPrompt,signal }),signal,beforeRequest);
          history.tokenUsage = result.tokenUsage;
          const generated = z.object({ title: z.string().max(2000), body: z.string().max(100000) }).parse(JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/gu, "")));
          const originalBody=input.purpose==='生成标题'?source?.body??input.sourceText:generated.body;
          knownDraft={generationId:history.generationId,title:generated.title,body:originalBody,validation:this.validation(input.companyId,platformKey,generated.title,originalBody,template.contentType,sourceText),contentType:template.contentType};
          let title = generated.title;
          const limit = platformContentPolicy(platformKey).maxTitleLength;
          let repairMessage: string | undefined;
          if (limit !== null && title.length > limit) {
            try {
              const repair = await this.governor.run(previewId,history.generationId,"TitleRepair",()=>this.configurationFingerprint(input),()=>client.generateText({ model: input.model, systemPrompt: "仅修复标题长度和格式，不添加或改变事实。只返回 JSON {title}。禁止修改正文。", userPrompt: JSON.stringify({ title, maxTitleLength: limit, titleLengthMode: "utf16", facts: context }),signal }),signal,beforeRequest);
              const repaired = z.object({ title: z.string().max(2000) }).parse(JSON.parse(repair.text.replace(/^```(?:json)?\s*|\s*```$/gu, "")));
              title = repaired.title;
              if (repair.tokenUsage) history.tokenUsage = { input: (history.tokenUsage?.input ?? 0) + repair.tokenUsage.input, output: (history.tokenUsage?.output ?? 0) + repair.tokenUsage.output };
            } catch (error) {
              if(error&&typeof error==='object'&&'code' in error&&['TRANSPORT_UNKNOWN','RESULT_CONTEXT_CHANGED'].includes(String(error.code)))throw error;
              history.errorCode = error instanceof TextProviderError ? error.code : "TITLE_REPAIR_INVALID";
              repairMessage = "标题自动修复未完成；原始草稿已保留，请人工缩短标题。系统不会再次自动请求。";
            }
          }
          if(signal.aborted)throw new TextProviderError("TRANSPORT_UNKNOWN","请求已发出，取消后结果需要人工核对");
          beforeRequest();
          const body = input.purpose === "生成标题" ? source?.body ?? input.sourceText : generated.body;
          const validation = this.validation(input.companyId, platformKey, title, body, template.contentType, sourceText);
          history.status = validation.errors.length ? "NeedsUserAction" : "Generated";
          const draft: LocalAIDraft = { generationId: history.generationId, title, body, validation, contentType: template.contentType };
          this.store.finish(history, draft); outputs.push({ ...draft, platformKey, status: history.status, ...(repairMessage ? { errorMessage: repairMessage } : {}) });
        } catch (error) {
          history.errorCode = error && typeof error==="object" && "code" in error ? String(error.code) : "OUTPUT_INVALID";
          const canceledIssued=history.errorCode==='AI_CANCELED'&&Boolean(this.repository.db.prepare('SELECT id FROM ai_request_journal WHERE generation_id=? LIMIT 1').get(history.generationId));
          history.status = ["TRANSPORT_UNKNOWN","RESULT_CONTEXT_CHANGED"].includes(history.errorCode)||canceledIssued ? "Unknown" : "Failed";
          if(knownDraft)knownDraft.validation={...knownDraft.validation,errors:[...new Set([...knownDraft.validation.errors,history.errorCode])]};
          this.store.finish(history,knownDraft);
          outputs.push({ generationId: history.generationId, title: knownDraft?.title??"", body: knownDraft?.body??"", validation: knownDraft?.validation??{ errors: [history.errorCode], warnings: [] }, contentType: template.contentType, platformKey, status: history.status, errorMessage: knownDraft?"自动修复结果未知，已收到的原始草稿保留；请核对未知请求并手动修改。系统不会补发。":error instanceof TextProviderError ? error.message : "生成结果无法读取，请核对模型输出格式" });
        }
      }
      return outputs;
    } finally { this.inFlight.delete(input.companyId);this.activeControllers.delete(input.companyId);completeWork();this.activeWork.delete(input.companyId); }
  }
  saveDraft(id: string, title: string, body: string): { articleId: string; variantId: string | null } {
    z.string().max(2000).parse(title); z.string().max(100000).parse(body);
    const history = this.store.generation(id), draft = this.draft(id);
    if (!history || !draft) throw new Error("本地草稿不存在");
    if (history.status === "Saved" && history.outputArticleId) return { articleId: history.outputArticleId, variantId: history.variantId };
    const validation = this.validateDraft(id, title, body);
    if (validation.errors.length) throw new Error("内容校验未通过，请修正红项后保存");
    return this.repository.db.transaction(() => {
      const hash = createHash("sha256").update(`${history.companyId}\n${title}\n${body}\n${history.targetPlatform}`).digest("hex");
      let variantId: string | null = null;
      if (history.sourceArticleId) {
        variantId = this.repository.createArticleVariant({ articleId: history.sourceArticleId, platformKey: history.targetPlatform, title, body, summary: "", coverAssetId: null, contentHash: hash }).id;
      }
        const article = this.repository.createArticle({ brandId: history.companyId, topic: "AI Content Studio", keyword: "", city: "", title, body, summary: "", tags: [], seoKeywords: [], articleType: draft.contentType, aiProvider: history.provider, aiModel: history.model, generatedAt: history.createdAt, reusePolicy: "once", contentHash: hash, source: "content_studio", company: this.context(history.companyId).companyName, targetPlatforms: [history.targetPlatform], qualityStatus: validation.warnings.length ? "warning" : "unchecked", qualityWarnings: validation.warnings });
        if (!article) throw new Error("内容已存在，请到内容库查看");
      const articleId = article.id;
      history.status = "Saved"; history.outputArticleId = articleId; history.variantId = variantId;
      this.store.finish(history, { ...draft, title, body, validation });
      return { articleId: articleId!, variantId };
    })();
  }
}
