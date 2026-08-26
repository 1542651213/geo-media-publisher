import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountContext, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import type { BrowserPublishAttemptContext, BrowserPublishReconciliationInput, BrowserPublishReconciliationResult } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";
import type { AutomationPrepareResult, BrowserSession } from "@publisher/adapters-core";
import type { Locator, Page } from "playwright-core";

const SOHU_BACKEND_URL = "https://mp.sohu.com/mpfe/v4/";
const SOHU_ARTICLE_ENTRY_PATTERN = /发布文章|写文章|图文创作|文章创作|图文发布|发文|新建文章|发布内容|^发布$/u;
const SOHU_ARTICLE_SECONDARY_PATTERN = /图文|文章/u;
const SOHU_CONTENT_ENTRY_PATTERN = /内容管理|文章管理|已发布|我的文章|内容中心|^文章$/u;
const SOHU_TITLE_PATTERN = /标题|title|article.?title/iu;
const SOHU_BODY_PATTERN = /正文|内容|body|editor|article/iu;
const SOHU_IMAGE_PATTERN = /图片|封面|image|cover/iu;
const SOHU_SECURITY_PATTERN = /captcha|security.?check|验证码|安全验证|人机|风控|短信/iu;
const SOHU_SKIP_OPTIONAL_REAL_NAME_PATTERN = /^暂不认证$/u;
const SOHU_FINAL_SUBMIT_TEXT_PATTERN = /^(?:发布|发布文章|发布内容|立即发布|确认发布|提交)$/u;

type SohuRequiredField = {
  label: string;
  kind: string;
  required: boolean;
  filled: boolean;
};

type SohuFieldEvidence = {
  fields: SohuRequiredField[];
  missing: string[];
  visibleSecurityChallenge: boolean;
  evidence: string;
};

type SohuPublicCandidate = {
  href: string;
  context: string;
  label: string;
  externalId: string | null;
};

type SohuContentManagementEvidence = {
  pageLoaded: boolean;
  articleManagementPage: boolean;
  accountIdentityVisible: boolean;
  totalContentCount: number | null;
  statusCounts: Record<string, number | null>;
  statusCategoriesComplete: boolean;
  titleOccurrenceCount: number;
  matchingTitleHrefs: string[];
  matchingTitleExternalIds: string[];
  totalContentDom?: Array<{ tag: string; text: string; parentText: string; nextText: string; valueClasses: string[]; pseudoContent: string[]; outer: string }>;
  bodyText: string;
};

type SohuSubmitDomEvidence = {
  url: string;
  toastDom: string[];
  modalDom: string[];
  statusDom: string[];
  bodyText: string;
};

export type SohuDomClassification = "FINAL_SUBMIT_DIRECT" | "NEXT_STEP_TO_CONFIRMATION" | "PREVIEW_ONLY" | "CONTROL_HIDDEN_BY_REQUIRED_STATE" | "CONTROL_IN_IFRAME" | "CONTROL_IN_PORTAL" | "CONTROL_NOT_FOUND";

export type SohuDeepDomCandidate = {
  tag: string;
  role?: string | null;
  text: string;
  selector: string;
  frameUrl: string;
  inFrame: boolean;
  visible: boolean;
  inViewport: boolean;
  disabled: boolean;
  ariaDisabled: boolean;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  css: { display: string; visibility: string; opacity: string; position?: string };
  region: "page" | "modal" | "drawer" | "confirmation" | "portal" | "fixed" | "sticky" | "footer" | "shadow";
  surface: "page" | "modal" | "drawer" | "confirmation";
  keywordMatches: string[];
};

export type SohuDeepDomSnapshot = {
  phase: string;
  pageUrl: string;
  scrollY: number;
  frameUrls: string[];
  frameErrors?: Array<{ frameUrl: string; error: string }>;
  scrollPasses?: Array<{ frameUrl: string; scrollY: number }>;
  candidates: SohuDeepDomCandidate[];
  bottomDom: Array<{ tag: string; text: string; selector: string; position: string; visible: boolean }>;
  portalSummary: Array<{ tag: string; text: string; selector: string; frameUrl: string; region: string; visible: boolean }>;
  shadowRootCount: number;
};

export type SohuDeepDomDiff = {
  added: string[];
  removed: string[];
  changed: string[];
};

type SohuDomControl = {
  kind: "button" | "role-button" | "a" | "checkbox" | "radio" | "select";
  label: string;
  hint: string;
  disabled: boolean;
  surface: "page" | "modal" | "drawer" | "confirmation";
  keywordMatches: string[];
};

type SohuEditorDomDiscovery = {
  controls: SohuDomControl[];
  finalPublish: {
    state: "absent" | "conditional" | "present_disabled" | "present_enabled";
    candidateCount: number;
    enabledCount: number;
    surfaces: Array<"page" | "modal" | "drawer" | "confirmation">;
  };
};

export function classifySohuControlCandidate(candidate: SohuDeepDomCandidate): SohuDomClassification {
  const text = `${candidate.text} ${candidate.keywordMatches.join(" ")}`.replace(/\s+/gu, " ").trim();
  const interactive = /^(button|a|input|select)$/iu.test(candidate.tag) || candidate.role === "button" || (candidate.tag === "div" && SOHU_FINAL_SUBMIT_TEXT_PATTERN.test(candidate.text.trim()));
  if (!interactive) return "CONTROL_NOT_FOUND";
  const preview = /^预览$/u.test(candidate.text.trim());
  const nextStep = /^下一步$/u.test(candidate.text.trim()) && !/发布|提交|立即发布|确认/u.test(text);
  const final = /发布|提交|立即发布|确认发布|保存并发布/u.test(text);
  if (!preview && !nextStep && !final) return "CONTROL_NOT_FOUND";
  if (candidate.inFrame) return "CONTROL_IN_IFRAME";
  if (candidate.region === "portal") return "CONTROL_IN_PORTAL";
  if (preview) return "PREVIEW_ONLY";
  if (nextStep) return "NEXT_STEP_TO_CONFIRMATION";
  if (final) {
    const hidden = !candidate.visible || candidate.disabled || candidate.ariaDisabled || candidate.css.display === "none" || candidate.css.visibility === "hidden" || candidate.css.opacity === "0";
    return hidden ? "CONTROL_HIDDEN_BY_REQUIRED_STATE" : "FINAL_SUBMIT_DIRECT";
  }
  return "CONTROL_NOT_FOUND";
}

export function shouldAllowSohuDirectSubmitPreflight(triggerSource: unknown): boolean {
  return triggerSource === "CONTINUE_PENDING_ACTION";
}

export function classifySohuDiscovery(snapshot: SohuDeepDomSnapshot): { classification: SohuDomClassification; directFinalCount: number; safeTransitionCount: number; hiddenRequiredCount: number; iframeCount: number; portalCount: number } {
  const classifications = snapshot.candidates.map(classifySohuControlCandidate);
  const directFinalCount = classifications.filter((value) => value === "FINAL_SUBMIT_DIRECT").length;
  const safeTransitionCount = classifications.filter((value) => value === "NEXT_STEP_TO_CONFIRMATION" || value === "PREVIEW_ONLY").length;
  const hiddenRequiredCount = classifications.filter((value) => value === "CONTROL_HIDDEN_BY_REQUIRED_STATE").length;
  const iframeCount = classifications.filter((value) => value === "CONTROL_IN_IFRAME").length;
  const portalCount = classifications.filter((value) => value === "CONTROL_IN_PORTAL").length;
  const classification = directFinalCount > 0 ? "FINAL_SUBMIT_DIRECT" : safeTransitionCount > 0 ? (classifications.includes("NEXT_STEP_TO_CONFIRMATION") ? "NEXT_STEP_TO_CONFIRMATION" : "PREVIEW_ONLY") : hiddenRequiredCount > 0 ? "CONTROL_HIDDEN_BY_REQUIRED_STATE" : iframeCount > 0 ? "CONTROL_IN_IFRAME" : portalCount > 0 ? "CONTROL_IN_PORTAL" : "CONTROL_NOT_FOUND";
  return { classification, directFinalCount, safeTransitionCount, hiddenRequiredCount, iframeCount, portalCount };
}

export function diffSohuDomSnapshots(before: SohuDeepDomSnapshot, after: SohuDeepDomSnapshot): SohuDeepDomDiff {
  const key = (candidate: SohuDeepDomCandidate): string => `${candidate.frameUrl}::${candidate.selector}`;
  const signature = (candidate: SohuDeepDomCandidate): string => JSON.stringify({ tag: candidate.tag, text: candidate.text, visible: candidate.visible, inViewport: candidate.inViewport, disabled: candidate.disabled, ariaDisabled: candidate.ariaDisabled, css: candidate.css, region: candidate.region, surface: candidate.surface, keywordMatches: candidate.keywordMatches });
  const beforeMap = new Map(before.candidates.map((candidate) => [key(candidate), signature(candidate)]));
  const afterMap = new Map(after.candidates.map((candidate) => [key(candidate), signature(candidate)]));
  return {
    added: [...afterMap.keys()].filter((candidateKey) => !beforeMap.has(candidateKey)).sort(),
    removed: [...beforeMap.keys()].filter((candidateKey) => !afterMap.has(candidateKey)).sort(),
    changed: [...afterMap.keys()].filter((candidateKey) => beforeMap.has(candidateKey) && beforeMap.get(candidateKey) !== afterMap.get(candidateKey)).sort()
  };
}

type SohuFinalSubmitReadiness = {
  submitButton: Locator;
  required: SohuFieldEvidence;
  discovery: SohuEditorDomDiscovery;
  deepDiscovery: SohuDeepDomSnapshot;
  deepClassification: ReturnType<typeof classifySohuDiscovery>;
};

const definition: BrowserPlatformDefinition = {
  platformKey: "sohu_media",
  displayName: "搜狐号",
  category: "图文/图集/短视频",
  officialWebsite: "https://mp.sohu.com/",
  backendUrl: SOHU_BACKEND_URL,
  officialSources: ["https://mp.sohu.com/"],
  version: "1.1.9",
  researchStatus: "partial",
  blockingReason: "V1.1.9 通过搜狐创作中心真实 DOM 动态发现文章入口；真实提交和回查只使用搜狐专属契约并保持一次提交闸门。",
  capabilities: { article: true, imagePost: true, video: true, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, maxVideoSize: 1024 * 1024 * 1024, supportsVideoCover: true, supportsVideoTags: true, videoPublishAsync: false }
};

export class SohuBrowserAdapter extends BrowserAutomationAdapter {
  private readonly verifiedEditorUrls = new Map<string, string>();
  private readonly publishedUrls = new Map<string, string>();

  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }

  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("；"));
    const opened = await this.openBackendPage(ctx, SOHU_BACKEND_URL);
    const { page } = opened;
    const entry = await this.discoverArticleEditor(page);
    const editorUrl = page.url();
    const title = await this.findTitleField(page);
    const body = await this.findBodyField(page);
    const beforeContentDom = await this.captureDeepDomDiscovery(page, "before_content_reuse");
    const events = ["EDITOR_OPEN_PASSED"];
    const titleBefore = (await title.inputValue().catch(() => "")).trim();
    if (titleBefore === article.title.trim()) events.push("TITLE_REUSED");
    else await title.fill(article.title);
    const titleValue = (await title.inputValue().catch(() => "")).trim();
    if (titleValue !== article.title.trim()) throw new BrowserAutomationError("CONTENT_REJECTED", "搜狐文章标题输入后回读不一致，已停止操作");

    const bodyBefore = await this.readFieldValue(body);
    if (this.normalizedTextIncludes(bodyBefore, article.body)) events.push("BODY_REUSED");
    else await body.fill(article.body);
    const bodyValue = await this.readFieldValue(body);
    if (!this.normalizedTextIncludes(bodyValue, article.body)) {
      throw new BrowserAutomationError(
        "CONTENT_REJECTED",
        `CONTENT_MODEL_MISMATCH: 搜狐文章正文输入后回读不一致，已停止操作；field=${await this.fieldDiagnostics(body)}；readback=${bodyValue.slice(0, 500)}`
      );
    }

    await this.ensureAiGeneratedContentChecked(page);
    if (titleBefore !== article.title.trim()) events.push("TITLE_FILLED");
    if (!this.normalizedTextIncludes(bodyBefore, article.body)) events.push("BODY_FILLED");
    const imagePath = article.images?.[0]?.trim();
    let imageEvidence: { imageCountBefore: number; imageCountAfter: number; mechanism: string } | null = null;
    if (imagePath) {
      const existingImageCount = await this.visibleImageCount(page);
      if (existingImageCount > 0) {
        imageEvidence = { imageCountBefore: existingImageCount, imageCountAfter: existingImageCount, mechanism: "existing-visible-image-reused" };
        events.push("IMAGE_REUSED");
      } else {
        events.push("IMAGE_UPLOAD_STARTED");
        imageEvidence = await this.uploadFirstImage(page, imagePath);
        events.push("IMAGE_UPLOAD_PASSED");
      }
    }

    const required = await this.inspectRequiredFields(page);
    const domDiscovery = await this.discoverEditorDom(page, required.missing);
    const afterContentDom = await this.captureDeepDomDiscovery(page, "after_content_reuse");
    const contentDomDiff = diffSohuDomSnapshots(beforeContentDom, afterContentDom);
    const contentArtifacts = await this.persistDeepDiscoveryArtifacts(page, { stage: "content_reuse", before: beforeContentDom, after: afterContentDom, diff: contentDomDiff });
    this.verifiedEditorUrls.set(this.accountKey(ctx), editorUrl);
    return {
      prepared: true,
      requiresUserAction: required.missing.length > 0,
      message: required.missing.length > 0
        ? `搜狐文章编辑器已准备；请在应用自建可见页面完成必填字段：${required.missing.join("、")}`
        : "搜狐文章编辑器已由真实 DOM 动态发现，标题、正文、图片和当前可见必填字段已完成校验；最终提交等待一次性用户确认。",
      sessionIdHash: opened.session.sessionIdHash,
      backendUrl: editorUrl,
      editorOpenedAt: new Date().toISOString(),
      titleFilled: true,
      bodyFilled: true,
      response: {
        adapter: this.platformKey,
        stage: "editor_prepared",
        entryLabel: entry.label,
        entryDiscovery: "playwright:visible-dom-text",
        pageUrl: page.url(),
        domEvidence: "playwright:sohu-live-editor-dom",
        automationType: this.automationType,
        browserExecutionMode: opened.session.executionMode,
        headless: opened.session.headless,
        events,
        ...(imageEvidence ? {
          imageUploaded: true,
          imageUploadEvidence: "editor_dom_new_visible_image_after_file_input",
          imageCountBefore: imageEvidence.imageCountBefore,
          imageCountAfter: imageEvidence.imageCountAfter,
          imageUploadMechanism: imageEvidence.mechanism
        } : {}),
        requiredFields: required.fields,
        requiredUserFields: required.missing,
        domDiscovery,
        deepDomDiscovery: afterContentDom,
        contentDomDiff,
        diagnosticArtifacts: contentArtifacts,
        finalSubmit: "platform_specific_once",
        resultVerification: "platform_specific_external_url_title_reachable"
      }
    };
  }

  async prepareFinalSubmit(ctx: AccountContext, article: PublishArticleInput): Promise<{ response: Record<string, unknown> }> {
    const active = await this.ensureActiveEditorPage(ctx, article);
    const readiness = await this.inspectFinalSubmitReadiness(active.page, article, this.verifiedEditorUrls.get(this.accountKey(ctx)) ?? null, shouldAllowSohuDirectSubmitPreflight(ctx.settings.triggerSource));
    return { response: { adapter: this.platformKey, stage: "final_submit_preflight", pageUrl: active.page.url(), domDiscovery: readiness.discovery, deepDomDiscovery: readiness.deepDiscovery, deepClassification: readiness.deepClassification, requiredFields: readiness.required.fields } };
  }

  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.ensureActiveEditorPage(ctx, article);
    const { page } = active;
    const readiness = await this.inspectFinalSubmitReadiness(page, article, this.verifiedEditorUrls.get(this.accountKey(ctx)) ?? null, true);
    const submitButton = readiness.submitButton;
    const before = await this.readSubmitDomEvidence(page);
    attempt.markSubmissionSideEffect?.();
    await submitButton.click();
    await page.waitForTimeout(1_000);
    try { await page.waitForURL((url) => url.toString() !== before.url, { waitUntil: "domcontentloaded", timeout: 45_000 }); } catch { /* some Sohu flows render a success result without changing the URL */ }
    const after = await this.readSubmitDomEvidence(page);
    const submitEvidence = { beforeUrl: before.url, afterUrl: after.url, beforeDom: before, afterDom: after };
    if (await this.hasSecurityChallenge(page)) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `搜狐最终提交动作已执行后出现验证码或安全验证，结果不确定，已停止且禁止二次提交；submitEvidence=${JSON.stringify(submitEvidence)}`);
    const result = await this.readPublicResult(page, article.title, attempt, "final_submitted");
    if (!result) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `搜狐最终提交动作已执行，但 RESULT_URL_NOT_FOUND；结果不确定，禁止再次提交；submitEvidence=${JSON.stringify(submitEvidence)}`);
    result.response = { ...result.response, submitEvidence };
    this.publishedUrls.set(this.accountKey(ctx), result.publishedUrl as string);
    return result;
  }

  async collectPublishResult(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "搜狐最终提交后已没有可读取结果的 Browser Session");
    const result = await this.readPublicResult(active.page, article.title, attempt, "result_collected");
    if (!result) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "搜狐最终提交后未取得可验证 External ID/URL，禁止再次提交");
    this.publishedUrls.set(this.accountKey(ctx), result.publishedUrl as string);
    return result;
  }

  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const externalId = result.externalId?.trim() ?? "";
    const publishedUrl = result.publishedUrl?.trim() ?? "";
    if (!externalId || !this.isPublicSohuUrl(publishedUrl)) return { status: "failed", externalId: externalId || undefined, publishedUrl: publishedUrl || undefined, response: { titleMatch: false, urlReachable: false }, errorCode: "EXTERNAL_EVIDENCE_INCOMPLETE", errorMessage: "搜狐发布结果缺少可验证 External ID 或 External URL" };
    const active = await this.activeBackendPage(ctx);
    if (!active) return { status: "failed", externalId, publishedUrl, response: { titleMatch: false, urlReachable: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "搜狐发布结果验证需要可见 Browser Session" };
    try {
      await active.page.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const heading = (await active.page.locator("h1").first().innerText().catch(() => "")).trim();
      const pageTitle = (await active.page.title().catch(() => "")).trim();
      const pageText = await active.page.locator("body").innerText().catch(() => "");
      const titleMatch = heading === article.title.trim() || pageTitle.includes(article.title.trim()) || (heading.length === 0 && pageText.includes(article.title.trim()));
      const urlReachable = this.isPublicSohuUrl(active.page.url());
      if (!urlReachable || !titleMatch) return { status: "failed", externalId, publishedUrl: active.page.url(), response: { titleMatch, urlReachable, heading, pageTitle }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "搜狐文章 URL 可访问性或标题回读未通过" };
      return { status: "published", externalId, publishedUrl: active.page.url().split("#", 1)[0], response: { titleMatch: true, urlReachable: true, heading, pageTitle, accountMatch: "authenticated_session" } };
    } catch (error) {
      return { status: "failed", externalId, publishedUrl, response: { titleMatch: false, urlReachable: false }, errorCode: "NETWORK_ERROR", errorMessage: error instanceof Error ? error.message : "搜狐文章 URL 不可访问" };
    }
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    const publishedUrl = this.publishedUrls.get(this.accountKey(ctx));
    if (!publishedUrl || this.externalIdFromUrl(publishedUrl) !== externalId.trim()) return { status: "failed", externalId, response: { statusLookup: "url_not_retained" }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "搜狐状态回查缺少本次已验证 External URL；未猜测 URL" };
    const active = await this.activeBackendPage(ctx);
    if (!active) return { status: "failed", externalId, publishedUrl, response: { statusLookup: "browser_session_missing" }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "搜狐状态回查需要可见 Browser Session" };
    try {
      await active.page.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return this.isPublicSohuUrl(active.page.url())
        ? { status: "published", externalId, publishedUrl: active.page.url().split("#", 1)[0], response: { statusLookup: "public_url_reachable" } }
        : { status: "failed", externalId, publishedUrl, response: { statusLookup: "unexpected_url", pageUrl: active.page.url() }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "搜狐状态回查导航到了非公开文章 URL" };
    } catch (error) {
      return { status: "failed", externalId, publishedUrl, response: { statusLookup: "navigation_failed" }, errorCode: "NETWORK_ERROR", errorMessage: error instanceof Error ? error.message : "搜狐状态回查失败" };
    }
  }

  async reconcile(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult> {
    const opened = await this.openBackendPage(ctx, SOHU_BACKEND_URL);
    const { page } = opened;
    await this.waitForSohuDom(page);
    await this.dismissOptionalRealNameDialog(page);
    let contentEntry: { label: string };
    try {
      contentEntry = await this.discoverContentManagement(page);
    } catch (error) {
      return {
        status: "STILL_UNCERTAIN",
        titleMatch: false,
        accountMatch: false,
        timeWindowMatch: false,
        response: { pageUrl: page.url(), matchedBy: "content_management_entry_missing", errorCode: error instanceof Error && "code" in error ? (error as { code?: string }).code : "UNKNOWN" },
        message: "搜狐内容管理入口或页面导航未取得真实 DOM 证据，保持 NeedsReconciliation；未判定为未发布"
      };
    }
    const managementEvidence = await this.readContentManagementEvidence(page, input.title, input.accountName);
    const candidates = await this.readContentCandidates(page, input.title);
    const candidate = candidates.find((item) => item.context.includes(input.title) && item.externalId);
    const windowStart = Date.parse(input.windowStart);
    const windowEnd = Date.parse(input.windowEnd);
    const pageEvidenceComplete = managementEvidence.pageLoaded
      && managementEvidence.articleManagementPage
      && managementEvidence.accountIdentityVisible
      && managementEvidence.statusCategoriesComplete
      && managementEvidence.totalContentCount === 0;
    const evidenceResponse = {
      pageUrl: page.url(),
      contentManagementEntry: contentEntry.label,
      managementEvidence,
      finalSubmitEvidence: {
        waitWindowSatisfied: input.waitWindowSatisfied === true,
        submissionIntentState: input.submissionIntentState ?? null,
        finalSubmitCount: input.finalSubmitCount ?? 0,
        noSecondSubmit: input.finalSubmitCount === 1
      }
    };
    if (candidate && pageEvidenceComplete) {
      const timeWindowMatch = this.timeWindowMatches(candidate.context, windowStart, windowEnd);
      if (timeWindowMatch) return { status: "FOUND_PUBLISHED", externalId: candidate.externalId ?? undefined, publishedUrl: candidate.href, titleMatch: true, accountMatch: true, timeWindowMatch: true, response: { ...evidenceResponse, matchedBy: "exact_title_authenticated_sohu_content_management", candidateContext: candidate.context.slice(0, 1_000) }, message: "搜狐内容管理中找到标题、公开 URL 和时间窗口均匹配的真实文章" };
      return { status: "STILL_UNCERTAIN", externalId: candidate.externalId ?? undefined, publishedUrl: candidate.href, titleMatch: true, accountMatch: true, timeWindowMatch: false, response: { ...evidenceResponse, matchedBy: "exact_title_without_time_window", candidateContext: candidate.context.slice(0, 1_000) }, message: "搜狐内容管理找到同名文章，但时间窗口无法可靠匹配，保持 NeedsReconciliation" };
    }
    const noMatchingTitle = managementEvidence.titleOccurrenceCount === 0;
    const noMatchingExternalId = !input.expectedExternalId || managementEvidence.matchingTitleExternalIds.every((id) => id !== input.expectedExternalId);
    const noMatchingUrl = !input.expectedPublishedUrl || managementEvidence.matchingTitleHrefs.every((href) => href !== input.expectedPublishedUrl);
    const strictNegative = pageEvidenceComplete
      && input.waitWindowSatisfied === true
      && input.submissionIntentState === "Unknown"
      && input.finalSubmitCount === 1
      && noMatchingTitle
      && noMatchingExternalId
      && noMatchingUrl
      && candidates.every((item) => !item.context.includes(input.title));
    if (strictNegative) {
      return {
        status: "CONFIRMED_NOT_PUBLISHED",
        titleMatch: false,
        accountMatch: true,
        timeWindowMatch: false,
        response: { ...evidenceResponse, matchedBy: "complete_sohu_article_management_empty_negative_evidence", negativeEvidence: { pageLoaded: managementEvidence.pageLoaded, articleManagementPage: managementEvidence.articleManagementPage, accountIdentityVisible: managementEvidence.accountIdentityVisible, totalContentCount: managementEvidence.totalContentCount, statusCategoriesComplete: managementEvidence.statusCategoriesComplete, noMatchingTitle, noMatchingExternalId, noMatchingUrl, noSecondSubmit: input.finalSubmitCount === 1, waitWindowSatisfied: input.waitWindowSatisfied === true } },
        message: "搜狐同账号文章管理页已完整加载，全部/已发布/审核中/未通过/草稿/定时发布均为0、账号总内容量为0，且等待窗口已满足、无匹配标题/External ID/URL、仅有一次 final submit；已确认未发布"
      };
    }
    return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: managementEvidence.accountIdentityVisible, timeWindowMatch: false, response: { ...evidenceResponse, matchedBy: "negative_evidence_contract_incomplete", negativeEvidenceGates: { pageEvidenceComplete, noMatchingTitle, noMatchingExternalId, noMatchingUrl, waitWindowSatisfied: input.waitWindowSatisfied === true, submissionIntentState: input.submissionIntentState ?? null, finalSubmitCount: input.finalSubmitCount ?? 0 } }, message: "搜狐内容管理负向证据不完整，保持 NeedsReconciliation；DOM 未完整加载、入口/分类/总内容量缺失或提交闸门未满足时不判定为未发布" };
  }

  override async closeOwnedSessions(): Promise<void> {
    try { await super.closeOwnedSessions(); }
    finally { this.verifiedEditorUrls.clear(); }
  }

  private async discoverArticleEditor(page: Page): Promise<{ label: string }> {
    await this.waitForSohuDom(page);
    await this.dismissOptionalRealNameDialog(page);
    const existing = await this.hasEditorFields(page);
    let discoveredLabel = "";
    if (!existing) {
      for (let attempt = 0; attempt < 3 && !(await this.hasEditorFields(page)); attempt += 1) {
        const clicked = await this.clickDiscoveredEntry(page, attempt === 0 ? SOHU_ARTICLE_ENTRY_PATTERN : SOHU_ARTICLE_SECONDARY_PATTERN, "EDITOR_NOT_FOUND");
        if (!clicked) break;
        discoveredLabel = clicked.label;
        await this.dismissOptionalRealNameDialog(page);
        try { await page.waitForFunction(() => Boolean(document.querySelector('input,textarea,[contenteditable="true"]')), undefined, { timeout: 8_000 }); } catch { /* field-specific discovery below provides the concrete failure */ }
      }
      if (!(await this.hasEditorFields(page))) {
        const labels = await this.visibleControlLabels(page);
        const dom = await this.domDiagnostics(page);
        throw new BrowserAutomationError(
          "PLATFORM_CHANGED",
          `EDITOR_NOT_FOUND: 搜狐后台真实 DOM 未发现发布文章、写文章或图文创作入口；page.url()=${page.url()}；visibleControls=${labels.join(" | ")}；dom=${dom}`
        );
      }
    }
    await this.findTitleField(page);
    await this.findBodyField(page);
    return { label: discoveredLabel || (await this.readLastDiscoveredLabel(page)) || "搜狐文章入口" };
  }

  private async dismissOptionalRealNameDialog(page: Page): Promise<void> {
    const buttons = page.locator("button").filter({ hasText: SOHU_SKIP_OPTIONAL_REAL_NAME_PATTERN });
    for (let index = 0; index < await buttons.count(); index += 1) {
      const candidate = buttons.nth(index);
      if (!(await candidate.isVisible().catch(() => false)) || !(await candidate.isEnabled().catch(() => false))) continue;
      try {
        await candidate.click({ timeout: 5_000 });
        await page.waitForTimeout(500);
        return;
      } catch {
        // Continue to the text-level DOM candidate below if the button wrapper is transient.
      }
    }
    const skip = page.getByText(SOHU_SKIP_OPTIONAL_REAL_NAME_PATTERN);
    for (let index = 0; index < await skip.count(); index += 1) {
      const candidate = skip.nth(index);
      if (!(await candidate.isVisible().catch(() => false)) || !(await candidate.isEnabled().catch(() => false))) continue;
      try {
        await candidate.click({ timeout: 5_000 });
        await page.waitForTimeout(500);
        return;
      } catch {
        // A duplicate hidden text node can be present; continue to the next real DOM candidate.
      }
    }
  }

  private async discoverContentManagement(page: Page): Promise<{ label: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const clicked = await this.clickDiscoveredEntry(page, SOHU_CONTENT_ENTRY_PATTERN, "CONTENT_MANAGEMENT_NOT_FOUND");
      if (clicked) {
        await page.waitForTimeout(500);
        return { label: clicked.label };
      }
      await page.waitForTimeout(1_000);
    }
    throw new BrowserAutomationError("PLATFORM_CHANGED", "搜狐后台真实 DOM 未发现内容管理或文章管理入口");
  }

  private async clickDiscoveredEntry(page: Page, pattern: RegExp, errorLabel: string): Promise<{ label: string } | null> {
    const candidates = page.locator('a,button,[role="button"],[role="menuitem"]');
    const count = await candidates.count();
    let best: { index: number; label: string; score: number } | null = null;
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false)) || !(await candidate.isEnabled().catch(() => false))) continue;
      const label = await this.controlLabel(candidate);
      if (!pattern.test(label) || /视频|直播|问答/iu.test(label) && pattern === SOHU_ARTICLE_ENTRY_PATTERN) continue;
      const exact = /^(发布文章|写文章|图文创作|文章创作|文章|内容管理|文章管理|已发布)$/u.test(label.trim()) ? 100 : 0;
      const score = exact + Math.max(0, 80 - label.length);
      if (!best || score > best.score) best = { index, label: label.trim(), score };
    }
    if (best) {
      await candidates.nth(best.index).click();
      await page.waitForTimeout(1_000);
      return { label: best.label };
    }

    const domText = await this.findVisibleDomTextEntry(page, pattern);
    if (!domText) {
      if (errorLabel === "EDITOR_NOT_FOUND") return null;
      return null;
    }
    await page.locator("body *").nth(domText.index).click();
    await page.waitForTimeout(1_000);
    return { label: domText.label };
  }

  private async findVisibleDomTextEntry(page: Page, pattern: RegExp): Promise<{ index: number; label: string } | null> {
    const matches = await page.locator("body *").evaluateAll((elements, options: { source: string; flags: string }) => {
      const candidatePattern = new RegExp(options.source, options.flags);
      const visible = (element: Element): boolean => {
        const target = element as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || bounds.width <= 0 || bounds.height <= 0) return false;
        const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return !topmost || element.contains(topmost) || topmost.contains(element);
      };
      const rows: Array<{ index: number; label: string; score: number }> = [];
      elements.forEach((element, index) => {
        if (!visible(element) || /^(HTML|HEAD|BODY|SCRIPT|STYLE|SVG|PATH)$/u.test(element.tagName)) return;
        const target = element as HTMLElement;
        const label = [target.innerText, target.getAttribute("aria-label"), target.getAttribute("title"), target.getAttribute("data-tooltip"), target.getAttribute("data-title")]
          .filter((value): value is string => Boolean(value))
          .join(" ")
          .replace(/\s+/gu, " ")
          .trim();
        if (!label || label.length > 120 || !candidatePattern.test(label)) return;
        rows.push({ index, label, score: (candidatePattern.test(label.trim()) ? 100 : 0) + Math.max(0, 80 - label.length) });
      });
      rows.sort((left, right) => right.score - left.score || left.label.length - right.label.length);
      return rows.slice(0, 10);
    }, { source: pattern.source, flags: pattern.flags });
    return matches[0] ?? null;
  }

  private async findTitleField(page: Page): Promise<Locator> {
    const field = await this.findField(page, SOHU_TITLE_PATTERN, false);
    if (!field) throw new BrowserAutomationError("PLATFORM_CHANGED", "EDITOR_NOT_FOUND: 搜狐文章标题输入框未在动态发现的编辑器中出现");
    return field;
  }

  private async findBodyField(page: Page): Promise<Locator> {
    const field = await this.findField(page, SOHU_BODY_PATTERN, true);
    if (!field) throw new BrowserAutomationError("PLATFORM_CHANGED", "EDITOR_NOT_FOUND: 搜狐文章正文编辑区域未在动态发现的编辑器中出现");
    return field;
  }

  private async findField(page: Page, pattern: RegExp, contentEditableAllowed: boolean): Promise<Locator | null> {
    const selector = contentEditableAllowed ? 'textarea,input,[contenteditable="true"]' : "input,textarea";
    const candidates = page.locator(selector);
    const count = await candidates.count();
    let fallback: Locator | null = null;
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const type = (await candidate.getAttribute("type").catch(() => null)) ?? "";
      if (/hidden|search|checkbox|radio|file/iu.test(type)) continue;
      const label = await this.controlLabel(candidate);
      if (pattern.test(label) && !/搜索|search|评论|comment/iu.test(label)) return candidate;
      if (!fallback && contentEditableAllowed && await candidate.getAttribute("contenteditable").catch(() => null) === "true") fallback = candidate;
    }
    return fallback;
  }

  private async uploadFirstImage(page: Page, imagePath: string): Promise<{ imageCountBefore: number; imageCountAfter: number; mechanism: string }> {
    await this.dismissOptionalRealNameDialog(page);
    const imageCountBefore = await this.visibleImageCount(page);
    let selectedInput = await this.findImageInput(page);
    let mechanism = "dynamic-image-file-input";
    let fileProvidedByChooser = false;
    if (!selectedInput) {
      let imageControl: { label: string } | null = null;
      const uploadText = page.getByText(/^\s*上传图片\s*$/u);
      for (let index = 0; index < await uploadText.count(); index += 1) {
        const candidate = uploadText.nth(index);
        if (!(await candidate.isVisible().catch(() => false)) || !(await candidate.isEnabled().catch(() => false))) continue;
        const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null);
        try {
          await candidate.click({ timeout: 5_000 });
          imageControl = { label: "上传图片" };
          const fileChooser = await fileChooserPromise;
          if (fileChooser) {
            await fileChooser.setFiles(imagePath);
            fileProvidedByChooser = true;
            mechanism = "dynamic-dom-control:上传图片:filechooser";
          }
          break;
        } catch {
          // Try the next real DOM text node or the broader image control discovery below.
        }
      }
      imageControl ??= await this.clickDiscoveredEntry(page, SOHU_IMAGE_PATTERN, "IMAGE_UPLOAD_FAILED");
      if (imageControl) {
        mechanism = `dynamic-dom-control:${imageControl.label}`;
        if (!fileProvidedByChooser) {
          try { await page.waitForFunction(() => document.querySelectorAll('input[type="file"]').length > 0, undefined, { timeout: 8_000 }); } catch { /* concrete error below */ }
          selectedInput = await this.findImageInput(page);
        }
      }
    }
    if (!selectedInput && !fileProvidedByChooser) {
      const labels = await this.visibleControlLabels(page);
      throw new BrowserAutomationError("UPLOAD_FAILED", `IMAGE_UPLOAD_FAILED: 搜狐动态文章编辑器未发现图片/封面文件控件；imageControls=${labels.filter((label) => SOHU_IMAGE_PATTERN.test(label)).join(" | ")}; visibleControls=${labels.join(" | ")}; dom=${await this.domDiagnostics(page)}; realNameDialog=${await this.realNameDialogDiagnostics(page)}; uploadControls=${await this.uploadControlDiagnostics(page)}`);
    }
    try {
      if (!fileProvidedByChooser) await selectedInput!.setInputFiles(imagePath);
      await page.waitForFunction(({ before }) => {
        const visible = (element: Element): boolean => {
          const target = element as HTMLElement;
          const style = window.getComputedStyle(target);
          const bounds = target.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
        };
        const inputSelected = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].some((input) => (input.files?.length ?? 0) > 0);
        const images = [...document.images].filter((image) => visible(image) && /^(blob:|data:|https?:)/iu.test(image.currentSrc || image.src));
        const uploadCompleted = /已成功上传|成功上传|上传完成|继续上传/iu.test(document.body?.innerText ?? "");
        return images.length > before && (inputSelected || uploadCompleted);
      }, { before: imageCountBefore }, { timeout: 45_000 });
      await page.waitForTimeout(1_000);
      const imageCountAfter = await this.visibleImageCount(page);
      if (imageCountAfter <= imageCountBefore) throw new BrowserAutomationError("UPLOAD_FAILED", "IMAGE_UPLOAD_FAILED: 搜狐编辑器未出现新增可见图片 DOM");
      return { imageCountBefore, imageCountAfter, mechanism };
    } catch (error) {
      if (error instanceof BrowserAutomationError) throw error;
      throw new BrowserAutomationError("UPLOAD_FAILED", `IMAGE_UPLOAD_FAILED: 搜狐图片上传未取得真实 DOM 完成证据（${error instanceof Error ? error.message : "未知错误"}）；after=${await this.uploadPostDiagnostics(page)}`);
    }
  }

  private async findImageInput(page: Page): Promise<Locator | null> {
    const inputs = page.locator('input[type="file"]');
    const count = await inputs.count();
    const onlyInput: Locator | null = count === 1 ? inputs.first() : null;
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      const accept = (await input.getAttribute("accept").catch(() => null)) ?? "";
      const label = await this.controlLabel(input);
      if (/image|jpg|jpeg|png|webp/iu.test(accept) || SOHU_IMAGE_PATTERN.test(label)) return input;
    }
    return onlyInput;
  }

  private async ensureAiGeneratedContentChecked(page: Page): Promise<boolean> {
    const aiPattern = /\u542b\u6709\s*AI\s*\u751f\u6210\u5185\u5bb9/iu;
    const controls = page.locator('input[type="checkbox"],[role="checkbox"]');
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (!(await control.isVisible().catch(() => false))) continue;
      if (!aiPattern.test(await this.controlLabel(control))) continue;
      const tagName = await control.evaluate((element) => element.tagName).catch(() => "");
      if (tagName === "INPUT") {
        if (!(await control.isChecked().catch(() => false))) await control.check().catch(() => control.click());
      } else if ((await control.getAttribute("aria-checked").catch(() => null)) !== "true") {
        await control.click();
      }
      return true;
    }
    const labels = page.locator('label,button,[role="checkbox"],span').filter({ hasText: aiPattern });
    for (let index = 0; index < await labels.count(); index += 1) {
      const label = labels.nth(index);
      if (!(await label.isVisible().catch(() => false)) || !(await label.isEnabled().catch(() => true))) continue;
      await label.click();
      return true;
    }
    return false;
  }

  private async inspectRequiredFields(page: Page): Promise<SohuFieldEvidence> {
    const candidate = await page.evaluate(() => {
      const visible = (element: Element): boolean => {
        const target = element as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
      };
      const labelFor = (element: Element): string => {
        const input = element as HTMLInputElement;
        const id = input.id;
        const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? "" : "";
        const parent = element.closest("label")?.textContent ?? element.parentElement?.textContent ?? "";
        return `${input.name ?? ""} ${id} ${input.getAttribute("placeholder") ?? ""} ${input.getAttribute("aria-label") ?? ""} ${input.getAttribute("title") ?? ""} ${explicit} ${parent}`.replace(/\s+/gu, " ").trim().slice(0, 400);
      };
      const fields: SohuRequiredField[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLElement>("input,select,textarea,[contenteditable='true']"))) {
        if (!visible(element) || (element instanceof HTMLInputElement && element.type === "hidden")) continue;
        const raw = labelFor(element);
        if (/标题|正文|内容|搜索|评论|comment|editor/iu.test(raw)) continue;
        const required = element.hasAttribute("required") || element.getAttribute("aria-required") === "true" || /必填|\*/u.test(raw);
        if (!required) continue;
        const isChoice = element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type);
        const value = isChoice ? `${element.checked}` : element instanceof HTMLSelectElement ? `${element.value} ${element.selectedOptions[0]?.textContent ?? ""}` : element instanceof HTMLElement && element.isContentEditable ? element.innerText : (element as HTMLInputElement).value;
        const filled = isChoice ? element.checked : Boolean(value.trim()) && !/^(请选择|请选择分类|请选择频道|请选择栏目|请选择地区|0|-1|null|undefined)$/iu.test(value.trim());
        fields.push({ label: raw.slice(0, 120) || element.tagName.toLowerCase(), kind: element.tagName.toLowerCase(), required: true, filled });
      }
      const pageText = document.body?.innerText ?? "";
      const visibleSecurityChallenge = Array.from(document.querySelectorAll("iframe[src*='captcha' i],iframe[src*='security' i],iframe[id*='captcha' i],iframe[class*='captcha' i],[id*='captcha' i],[class*='captcha' i]")).some(visible)
        || /请.{0,20}(完成|通过).{0,20}(验证|验证码|人机)|拖动.{0,12}拼图|安全验证/iu.test(pageText);
      return { fields, visibleSecurityChallenge };
    });
    const missing = candidate.fields.filter((field) => !field.filled).map((field) => field.label);
    if (candidate.visibleSecurityChallenge) missing.push("安全验证/验证码");
    return { fields: candidate.fields, missing: [...new Set(missing)], visibleSecurityChallenge: candidate.visibleSecurityChallenge, evidence: `required:${candidate.fields.length};missing:${[...new Set(missing)].join(",") || "none"};security:${candidate.visibleSecurityChallenge}` };
  }

  private async readPublicResult(page: Page, title: string, attempt: BrowserPublishAttemptContext, stage: string): Promise<PublishResult | null> {
    const candidates = await this.readPublicCandidates(page, title);
    const candidate = candidates.find((item) => item.externalId) ?? null;
    if (!candidate?.externalId) return null;
    return { success: true, status: "published", externalId: candidate.externalId, publishedUrl: candidate.href, response: { adapter: this.platformKey, stage, submissionIntentId: attempt.submissionIntentId, finalSubmitCount: 1, resultEvidence: "playwright:page.url-or-visible-public-anchor", titleMatchPendingVerification: true } };
  }

  private async readContentManagementEvidence(page: Page, expectedTitle: string, accountName: string): Promise<SohuContentManagementEvidence> {
    return page.evaluate(({ expectedTitle: title, accountName: expectedAccountName }) => {
      const visible = (element: Element): boolean => {
        const target = element as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
      };
      const clean = (value: string): string => value.replace(/\s+/gu, " ").trim();
      const bodyText = clean(document.body?.innerText ?? "");
      const visibleTexts = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter(visible)
        .map((element) => clean(element.innerText ?? ""))
        .filter(Boolean);
      const statTexts = [...visibleTexts].filter((value) => /总内容量/u.test(value)).sort((left, right) => left.length - right.length);
      const totalStatTexts = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => visible(element) && /总内容量/u.test(clean(element.innerText ?? "")))
        .flatMap((element) => [
          element.innerText,
          element.parentElement?.innerText,
          element.parentElement?.parentElement?.innerText,
          element.nextElementSibling?.textContent,
          element.parentElement?.nextElementSibling?.textContent
        ])
        .filter((value): value is string => Boolean(value))
        .map(clean);
      const totalContentDom = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => visible(element) && /总内容量/u.test(clean(element.innerText ?? "")))
        .sort((left, right) => clean(left.innerText ?? "").length - clean(right.innerText ?? "").length)
        .slice(0, 12)
        .map((element) => {
          const valueNodes = [element, ...Array.from(element.querySelectorAll<HTMLElement>("h3, [class*='number-icon']"))];
          const valueClasses = valueNodes.flatMap((node) => [...node.classList].filter((className) => /(?:number|count|total)/iu.test(className)));
          const pseudoContent = valueNodes.flatMap((node) => [window.getComputedStyle(node, "::before").content, window.getComputedStyle(node, "::after").content].filter((value) => value && value !== "none"));
          return {
            tag: element.tagName,
            text: clean(element.innerText ?? "").slice(0, 300),
            parentText: clean(element.parentElement?.innerText ?? "").slice(0, 300),
            nextText: clean(element.nextElementSibling?.textContent ?? "").slice(0, 300),
            valueClasses,
            pseudoContent,
            outer: element.outerHTML.slice(0, 800)
          };
        });
      const totalContentValueNodes = Array.from(document.querySelectorAll<HTMLElement>(".read-info-info-item"))
        .filter((element) => visible(element) && clean(element.innerText ?? "").includes("总内容量"))
        .flatMap((card) => [card, ...Array.from(card.querySelectorAll<HTMLElement>("h3, [class*='number-icon']"))]);
      const totalContentDomMatches = totalContentValueNodes.flatMap((element) => {
        const classMatch = [...element.classList].map((className) => className.match(/(?:mp-iconnumber|number-icon)[_-]([0-9]+)/iu)).find((match): match is RegExpMatchArray => Boolean(match));
        const pseudoValues = [window.getComputedStyle(element, "::before").content, window.getComputedStyle(element, "::after").content]
          .map((value) => value.split('"').join("").split("'").join(""))
          .filter((value) => /^[0-9]+$/u.test(value));
        const textMatch = clean(element.innerText ?? "").match(/(?:总内容量|内容量)\s*([0-9]+)/u);
        return [classMatch?.[1], ...pseudoValues, textMatch?.[1]].filter((value): value is string => Boolean(value));
      });
      const totalContentMatch = [...totalContentDomMatches, ...totalStatTexts, ...statTexts, bodyText].map((value) => typeof value === "string" ? value.match(/总内容量\s*([0-9]+)/u) : null).find((match): match is RegExpMatchArray => Boolean(match));
      const totalContentCount = totalContentDomMatches.map((value) => Number(value)).find((value) => Number.isInteger(value));
      const countFor = (label: string): number | null => {
        const match = `${bodyText} ${visibleTexts.join(" ")}`.match(new RegExp(`${label}\\s*([0-9]+)`, "u"));
        return match ? Number(match[1]) : null;
      };
      const statusCounts: Record<string, number | null> = {
        全部: countFor("全部"),
        已发布: countFor("已发布"),
        审核中: countFor("审核中"),
        未通过: countFor("未通过"),
        草稿: countFor("草稿"),
        定时发布: countFor("定时发布")
      };
      const externalIdFromHref = (href: string): string | null => {
        try {
          const parsed = new URL(href);
          if (parsed.hostname === "mp.sohu.com") return null;
          return parsed.pathname.match(/(?:^|\/)(\d{5,})(?:[/?#_.-]|$)/u)?.[1] ?? null;
        } catch { return null; }
      };
      const matchingTitleHrefs: string[] = [];
      const matchingTitleExternalIds: string[] = [];
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
        if (!visible(anchor)) continue;
        let context = clean(anchor.innerText || anchor.getAttribute("aria-label") || "");
        let row: Element | null = anchor;
        for (let depth = 0; depth < 6 && row; depth += 1) {
          context = clean(row instanceof HTMLElement ? row.innerText : row.textContent ?? "");
          if (context.includes(title)) break;
          row = row.parentElement;
        }
        if (!context.includes(title)) continue;
        const href = anchor.href.split("#", 1)[0];
        matchingTitleHrefs.push(href);
        const externalId = externalIdFromHref(href);
        if (externalId) matchingTitleExternalIds.push(externalId);
      }
      return {
        pageLoaded: document.readyState === "complete" && Boolean(document.body),
        articleManagementPage: location.pathname === "/mpfe/v4/contentManagement/first/page" && new URL(location.href).searchParams.get("newsType") === "1",
        accountIdentityVisible: Boolean(expectedAccountName && bodyText.includes(expectedAccountName)) || /实名认证.*(?:小狐狸|账号信息|我的内容)/u.test(bodyText),
        totalContentCount: totalContentCount ?? (totalContentMatch ? Number(totalContentMatch[1]) : null),
        statusCounts,
        statusCategoriesComplete: ["全部", "已发布", "审核中", "未通过", "草稿", "定时发布"].every((label) => statusCounts[label] !== null),
        titleOccurrenceCount: bodyText.includes(title) ? 1 : 0,
        matchingTitleHrefs: [...new Set(matchingTitleHrefs)],
        matchingTitleExternalIds: [...new Set(matchingTitleExternalIds)],
        totalContentDom,
        bodyText: bodyText.slice(0, 2_000)
      };
    }, { expectedTitle, accountName });
  }

  private async readSubmitDomEvidence(page: Page): Promise<SohuSubmitDomEvidence> {
    return page.evaluate(() => {
      const visibleText = (selector: string, limit = 8): string[] => [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
        })
        .map((element) => (element.innerText || element.textContent || "").replace(/\s+/gu, " ").trim())
        .filter(Boolean)
        .slice(0, limit);
      const bodyText = (document.body?.innerText ?? "").replace(/\s+/gu, " ").trim();
      const statusDom = visibleText('[role="status"],[class*="status" i],[class*="result" i],[class*="success" i],[class*="审核"],[class*="发布" i]')
        .filter((value) => /成功|失败|审核|发布|提交|草稿|定时/iu.test(value));
      return {
        url: location.href,
        toastDom: visibleText('[role="alert"],[class*="toast" i],[class*="message" i],[class*="notification" i]'),
        modalDom: visibleText('[role="dialog"],[class*="modal" i],[class*="dialog" i]'),
        statusDom,
        bodyText: bodyText.slice(0, 2_000)
      };
    });
  }

  private async readContentCandidates(page: Page, title: string): Promise<SohuPublicCandidate[]> {
    return this.readPublicCandidates(page, title);
  }

  private async readPublicCandidates(page: Page, title: string): Promise<SohuPublicCandidate[]> {
    return page.evaluate(({ expectedTitle }) => {
      const visible = (element: Element): boolean => {
        const target = element as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      };
      const externalIdFromHref = (href: string): string | null => {
        try {
          const parsed = new URL(href);
          if (parsed.hostname === "mp.sohu.com") return null;
          const numeric = parsed.pathname.match(/(?:^|\/)(\d{5,})(?:[/?#_.-]|$)/u)?.[1];
          return numeric ?? null;
        } catch { return null; }
      };
      const candidates: SohuPublicCandidate[] = [];
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
        if (!visible(anchor)) continue;
        const href = anchor.href.split("#", 1)[0];
        if (!/^https?:\/\//iu.test(href) || new URL(href).hostname === "mp.sohu.com") continue;
        let row: Element = anchor;
        let context = `${anchor.innerText} ${anchor.getAttribute("aria-label") ?? ""}`.trim();
        for (let depth = 0; depth < 8; depth += 1) {
          context = (row instanceof HTMLElement ? row.innerText : row.textContent ?? "").replace(/\s+/gu, " ").trim();
          if (context.includes(expectedTitle) || depth >= 3) break;
          if (!row.parentElement) break;
          row = row.parentElement;
        }
        const label = (anchor.innerText || anchor.getAttribute("aria-label") || "").trim();
        const externalId = externalIdFromHref(href);
        if (externalId && (!expectedTitle || context.includes(expectedTitle) || /查看|文章|发布成功|已发布/iu.test(`${label} ${context}`))) candidates.push({ href, context, label, externalId });
      }
      const currentUrl = location.href.split("#", 1)[0];
      const currentId = externalIdFromHref(currentUrl);
      if (currentId && currentUrl !== "about:blank") candidates.push({ href: currentUrl, context: document.body?.innerText ?? "", label: document.title, externalId: currentId });
      return candidates.slice(0, 30);
    }, { expectedTitle: title });
  }

  private async findFinalSubmitButton(page: Page): Promise<Locator> {
    const candidates = page.locator('button,input[type="submit"],[role="button"]');
    const count = await candidates.count();
    let disabledLabel = "";
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const label = await this.controlLabel(candidate);
      if (!/(发布文章|立即发布|确认发布|发布|提交)/u.test(label) || /保存|草稿|预览|取消|视频/iu.test(label)) continue;
      if (!(await candidate.isVisible().catch(() => false))) continue;
      if (!(await candidate.isEnabled().catch(() => false))) { disabledLabel = label; continue; }
      return candidate;
    }
    const domEntry = await this.findVisibleDomTextEntry(page, /^(发布|发布文章|发布内容|立即发布|确认发布|提交)$/u);
    if (domEntry) return page.locator("body *").nth(domEntry.index);
    if (disabledLabel) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `FINAL_SUBMIT_DISABLED: 搜狐最终发布控件存在但不可用；control=${disabledLabel}`);
    throw new BrowserAutomationError("FINAL_SUBMIT_CONTROL_NOT_FOUND", `搜狐最终发布控件未在已校验文章编辑器中出现，未执行点击；page.url()=${page.url()}；visibleControls=${(await this.visibleControlLabels(page)).slice(0, 40).join(" | ")}`);
  }

  private async ensureActiveEditorPage(ctx: AccountContext, article: PublishArticleInput): Promise<{ page: Page; session: BrowserSession }> {
    let active = await this.activeBackendPage(ctx);
    if (!active) {
      await this.preparePublish(ctx, article);
      active = await this.activeBackendPage(ctx);
    }
    if (!active) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "搜狐 L5 最终提交需要保留此前已校验的可见 Browser Page；不会创建第二条任务");
    return active as { page: Page; session: BrowserSession };
  }

  private async inspectFinalSubmitReadiness(page: Page, article: PublishArticleInput, verifiedUrl: string | null, allowDirectSubmit: boolean): Promise<SohuFinalSubmitReadiness> {
    if (verifiedUrl && page.url() !== verifiedUrl) throw new BrowserAutomationError("PLATFORM_CHANGED", "EDITOR_NOT_FOUND: 搜狐当前页面已离开已校验文章编辑器，未执行最终提交");
    await this.assertNoSecurityChallenge(page, false);
    const title = await this.findTitleField(page);
    const body = await this.findBodyField(page);
    const titleValue = (await title.inputValue().catch(() => "")).trim();
    const bodyValue = await this.readFieldValue(body);
    if (titleValue !== article.title.trim() || !this.normalizedTextIncludes(bodyValue, article.body)) throw new BrowserAutomationError("CONTENT_REJECTED", "CONTENT_MODEL_MISMATCH: 搜狐最终提交前的标题或正文回读与已校验内容不一致，未执行最终提交");
    const required = await this.inspectRequiredFields(page);
    const discovery = await this.discoverEditorDom(page, required.missing);
    const deepDiscovery = await this.captureDeepDomDiscovery(page, "before_final_submit");
    const deepClassification = classifySohuDiscovery(deepDiscovery);
    const artifacts = await this.persistDeepDiscoveryArtifacts(page, { stage: "before_final_submit", required, shallow: discovery, deep: deepDiscovery, classification: deepClassification });
    let finalDeepDiscovery = deepDiscovery;
    let finalClassification = deepClassification;
    let discoveredFinalButton: Locator | null = null;
    if (finalClassification.classification === "CONTROL_NOT_FOUND") {
      try {
        discoveredFinalButton = await this.findFinalSubmitButton(page);
        finalClassification = { ...finalClassification, classification: "FINAL_SUBMIT_DIRECT", directFinalCount: 1 };
      } catch {
        // Keep the fail-closed deep-discovery result when no visible final text fallback exists.
      }
    }
    if (!allowDirectSubmit && finalClassification.safeTransitionCount > 0 && finalClassification.directFinalCount === 0) {
      const transition = await this.clickSafeNonFinalTransition(page, deepDiscovery);
      if (transition) {
        finalDeepDiscovery = await this.captureDeepDomDiscovery(page, "after_safe_non_final_transition");
        finalClassification = classifySohuDiscovery(finalDeepDiscovery);
        await this.persistDeepDiscoveryArtifacts(page, { stage: "after_safe_non_final_transition", transition, before: deepDiscovery, after: finalDeepDiscovery, classification: finalClassification });
      }
    }
    const diagnostic = this.deepDiagnosticSummary(finalDeepDiscovery, finalClassification, artifacts);
    if (required.missing.length > 0) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", `REQUIRED_FIELD_MISSING: 请在搜狐真实文章编辑器中完成：${required.missing.join("、")}；page.url()=${page.url()}；deepDiscovery=${diagnostic}`);
    if (finalClassification.classification !== "CONTROL_NOT_FOUND") {
      const code = finalClassification.classification === "CONTROL_HIDDEN_BY_REQUIRED_STATE" ? "USER_ACTION_REQUIRED" : finalClassification.classification === "FINAL_SUBMIT_DIRECT" && allowDirectSubmit ? null : "USER_ACTION_REQUIRED";
      if (code) throw new BrowserAutomationError(code, `${finalClassification.classification}: 搜狐最终发布链路已被定位，但本次诊断不会点击最终提交；page.url()=${page.url()}；deepDiscovery=${diagnostic}`);
    }
    if (!allowDirectSubmit && finalClassification.classification === "CONTROL_NOT_FOUND") throw new BrowserAutomationError("FINAL_SUBMIT_CONTROL_NOT_FOUND", `CONTROL_NOT_FOUND: 搜狐完整页面、frame、portal、fixed、sticky、footer 和 open shadow root 扫描均未找到最终发布控件；page.url()=${page.url()}；deepDiscovery=${diagnostic}`);
    if (finalClassification.classification !== "FINAL_SUBMIT_DIRECT") throw new BrowserAutomationError("FINAL_SUBMIT_CONTROL_NOT_FOUND", `CONTROL_NOT_FOUND: 当前链路没有可安全执行的直接最终发布控件；page.url()=${page.url()}；deepDiscovery=${diagnostic}`);
    return { submitButton: discoveredFinalButton ?? await this.findFinalSubmitButton(page), required, discovery, deepDiscovery: finalDeepDiscovery, deepClassification: finalClassification };
  }

  private async captureDeepDomDiscovery(page: Page, phase: string): Promise<SohuDeepDomSnapshot> {
    const candidateMap = new Map<string, SohuDeepDomCandidate>();
    const frameErrors: Array<{ frameUrl: string; error: string }> = [];
    const scrollPasses: Array<{ frameUrl: string; scrollY: number }> = [];
    let bottomDom: SohuDeepDomSnapshot["bottomDom"] = [];
    let shadowRootCount = 0;
    const mainFrame = page.mainFrame();
    const frameUrls = [...new Set(page.frames().map((frame) => frame.url()).filter(Boolean))];
    const viewport = await page.evaluate(() => ({ height: window.innerHeight, scrollHeight: Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0) })).catch(() => ({ height: 800, scrollHeight: 800 }));
    const pageOffsets = this.scrollOffsets(viewport.scrollHeight, viewport.height);

    for (const pageScrollY of pageOffsets) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), pageScrollY).catch(() => undefined);
      await page.waitForTimeout(120);
      for (const frame of page.frames()) {
        const frameUrl = frame.url();
        const frameHeight = await frame.evaluate(() => ({ height: window.innerHeight, scrollHeight: Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0) })).catch(() => ({ height: 800, scrollHeight: 800 }));
        const frameOffsets = frame === mainFrame ? [pageScrollY] : this.scrollOffsets(frameHeight.scrollHeight, frameHeight.height);
        for (const frameScrollY of frameOffsets) {
          await frame.evaluate((scrollY) => window.scrollTo(0, scrollY), frameScrollY).catch(() => undefined);
          scrollPasses.push({ frameUrl, scrollY: frameScrollY });
          try {
            const partial = await frame.evaluate(({ frameUrl: currentFrameUrl, inFrame, phase: currentPhase, scrollY, atBottom, finalSubmitPattern }) => {
               type PartialCandidate = SohuDeepDomCandidate;
               const finalSubmitTextPattern = new RegExp(finalSubmitPattern, "u");
              const clean = (value: string, limit = 240): string => value.replace(/\s+/gu, " ").trim().slice(0, limit);
              const visibleState = (element: Element) => {
                const target = element as HTMLElement;
                const style = window.getComputedStyle(target);
                const bounds = target.getBoundingClientRect();
                const cssVisible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && bounds.width > 0 && bounds.height > 0;
                const inViewport = cssVisible && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
                return { style, bounds, visible: cssVisible, inViewport };
              };
              const selectorFor = (element: Element): string => {
                const parts: string[] = [];
                let current: Element | null = element;
                for (let depth = 0; current && depth < 18; depth += 1) {
                  const tag = current.tagName.toLowerCase();
                  const id = current.id && /^[A-Za-z_][A-Za-z0-9_-]{0,80}$/u.test(current.id) ? `#${current.id}` : "";
                  let part = `${tag}${id}`;
                  if (!id && current.parentElement) {
                    const siblings = [...current.parentElement.children].filter((item) => item.tagName === current?.tagName);
                    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
                  }
                  parts.unshift(part);
                  const root = current.getRootNode();
                  if (root instanceof ShadowRoot) {
                    parts.unshift(">>>");
                    current = root.host;
                  } else current = current.parentElement;
                }
                return parts.join(" > ").slice(0, 600);
              };
              const surfaceFor = (element: Element): PartialCandidate["surface"] => {
                const parent = element.closest('[role="dialog"],[class*="modal" i],[class*="dialog" i],[class*="drawer" i]');
                if (!parent) return "page";
                return /确认|发布|提交/iu.test(parent.textContent ?? "") ? "confirmation" : /drawer/iu.test(parent.getAttribute("class") ?? "") ? "drawer" : "modal";
              };
              const regionFor = (element: Element, surface: PartialCandidate["surface"], shadow: boolean): PartialCandidate["region"] => {
                const target = element as HTMLElement;
                const style = window.getComputedStyle(target);
                const marker = `${target.id} ${target.className} ${target.getAttribute("data-testid") ?? ""} ${target.getAttribute("data-portal") ?? ""}`;
                if (style.position === "fixed") return "fixed";
                if (style.position === "sticky") return "sticky";
                if (element.tagName.toLowerCase() === "footer" || /footer/iu.test(marker)) return "footer";
                if (/portal|teleport|overlay/iu.test(marker) || element.parentElement === document.body && surface !== "page") return "portal";
                if (shadow) return "shadow";
                if (surface !== "page") return surface;
                return "page";
              };
              const roots: Array<{ root: Document | ShadowRoot; shadow: boolean }> = [{ root: document, shadow: false }];
              const elements: Array<{ element: HTMLElement; shadow: boolean }> = [];
              let shadowRoots = 0;
              for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
                const currentRoot = roots[rootIndex];
                for (const element of Array.from(currentRoot.root.querySelectorAll<HTMLElement>("button,a,[role='button'],input,div"))) {
                  elements.push({ element, shadow: currentRoot.shadow });
                  if (element.shadowRoot) {
                    shadowRoots += 1;
                    roots.push({ root: element.shadowRoot, shadow: true });
                  }
                }
              }
              const keywordList = ["发布", "提交", "立即发布", "保存并发布", "下一步", "预览", "确认", "声明", "原创", "AI", "分类", "领域", "封面"];
              const candidates: PartialCandidate[] = elements.map(({ element, shadow }) => {
                const tag = element.tagName.toLowerCase();
                const role = element.getAttribute("role");
                const state = visibleState(element);
                const ariaLabel = element.getAttribute("aria-label") ?? "";
                const title = element.getAttribute("title") ?? "";
                const placeholder = element.getAttribute("placeholder") ?? "";
               const rawText = [element.innerText, ariaLabel, title, placeholder].filter(Boolean).join(" ");
               const customFinalDiv = tag === "div" && finalSubmitTextPattern.test(rawText.replace(/\s+/gu, " ").trim());
               const interactive = /^(button|a|input|select)$/iu.test(tag) || role === "button" || customFinalDiv;
                const text = clean(tag === "div" && !interactive ? "" : rawText);
                const combined = `${interactive ? clean(rawText, 400) : `${ariaLabel} ${title} ${placeholder}`}`;
                const surface = surfaceFor(element);
                const region = regionFor(element, surface, shadow);
                const boundingBox = state.bounds.width > 0 || state.bounds.height > 0 ? { x: state.bounds.x, y: state.bounds.y, width: state.bounds.width, height: state.bounds.height } : null;
                const ariaDisabled = element.getAttribute("aria-disabled") === "true";
                const disabled = ("disabled" in element && Boolean((element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled)) || ariaDisabled;
                return { tag, role, text, selector: selectorFor(element), frameUrl: currentFrameUrl, inFrame, visible: state.visible, inViewport: state.inViewport, disabled, ariaDisabled, boundingBox, css: { display: state.style.display, visibility: state.style.visibility, opacity: state.style.opacity, position: state.style.position }, region, surface, keywordMatches: keywordList.filter((keyword) => combined.includes(keyword)) };
              });
              const bottom = atBottom ? [...document.querySelectorAll<HTMLElement>("footer,body > *,[style*='position: fixed'],[style*='position: sticky']")].filter((element) => !/^(SCRIPT|STYLE|LINK)$/u.test(element.tagName)).slice(-80).map((element) => { const state = visibleState(element); const tag = element.tagName.toLowerCase(); return { tag, text: tag === "div" ? "" : clean(element.innerText || element.getAttribute("aria-label") || ""), selector: selectorFor(element), position: state.style.position, visible: state.visible }; }) : [];
              return { phase: currentPhase, frameUrl: currentFrameUrl, scrollY, candidates, bottomDom: bottom, portalSummary: candidates.filter((candidate) => ["portal", "fixed", "sticky", "footer"].includes(candidate.region)).slice(0, 120).map((candidate) => ({ tag: candidate.tag, text: candidate.text, selector: candidate.selector, frameUrl: candidate.frameUrl, region: candidate.region, visible: candidate.visible })), shadowRootCount: shadowRoots };
             }, { frameUrl, inFrame: frame !== mainFrame, phase, scrollY: frameScrollY, atBottom: frameScrollY >= Math.max(0, frameHeight.scrollHeight - frameHeight.height), finalSubmitPattern: SOHU_FINAL_SUBMIT_TEXT_PATTERN.source });
            shadowRootCount += partial.shadowRootCount;
            if (partial.bottomDom.length > 0) bottomDom = partial.bottomDom;
            for (const candidate of partial.candidates) {
              const key = `${candidate.frameUrl}::${candidate.selector}`;
              const existing = candidateMap.get(key);
              if (!existing || candidate.inViewport || candidate.text.length > existing.text.length) candidateMap.set(key, candidate);
            }
          } catch (error) {
            frameErrors.push({ frameUrl, error: error instanceof Error ? error.message.slice(0, 240) : "frame_scan_failed" });
          }
        }
      }
    }
    for (const frame of page.frames()) await frame.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    const candidates = [...candidateMap.values()];
    const portalSummary = candidates.filter((candidate) => ["portal", "fixed", "sticky", "footer"].includes(candidate.region)).slice(0, 240).map((candidate) => ({ tag: candidate.tag, text: candidate.text, selector: candidate.selector, frameUrl: candidate.frameUrl, region: candidate.region, visible: candidate.visible }));
    return { phase, pageUrl: page.url(), scrollY: 0, frameUrls, frameErrors, scrollPasses, candidates, bottomDom, portalSummary, shadowRootCount };
  }

  private scrollOffsets(scrollHeight: number, viewportHeight: number): number[] {
    const maximum = Math.max(0, scrollHeight - viewportHeight);
    const step = Math.max(400, viewportHeight - 120);
    const offsets: number[] = [];
    for (let offset = 0; offset < maximum; offset += step) offsets.push(offset);
    offsets.push(maximum);
    return [...new Set(offsets)];
  }

  private async clickSafeNonFinalTransition(page: Page, snapshot: SohuDeepDomSnapshot): Promise<Record<string, unknown> | null> {
    const candidate = snapshot.candidates.find((item) => {
      const classification = classifySohuControlCandidate(item);
      return (classification === "NEXT_STEP_TO_CONFIRMATION" || classification === "PREVIEW_ONLY") && item.visible && item.inViewport && !item.disabled && !item.ariaDisabled && !item.inFrame && !item.selector.includes(">>>");
    });
    if (!candidate) return null;
    const locator = page.locator(candidate.selector).first();
    if (!(await locator.isVisible().catch(() => false)) || !(await locator.isEnabled().catch(() => false))) return null;
    await locator.click({ timeout: 5_000 });
    await page.waitForTimeout(750);
    return { classification: classifySohuControlCandidate(candidate), text: candidate.text, selector: candidate.selector, frameUrl: candidate.frameUrl, pageUrl: page.url() };
  }

  private deepDiagnosticSummary(snapshot: SohuDeepDomSnapshot, classification: ReturnType<typeof classifySohuDiscovery>, artifacts: Record<string, unknown>): string {
    const candidates = snapshot.candidates.map((candidate) => ({ ...candidate, classification: classifySohuControlCandidate(candidate) })).filter((candidate) => candidate.classification !== "CONTROL_NOT_FOUND" || candidate.keywordMatches.length > 0).slice(0, 80);
    return JSON.stringify({ classification, pageUrl: snapshot.pageUrl, frameUrls: snapshot.frameUrls, frameErrors: snapshot.frameErrors, candidateCount: snapshot.candidates.length, candidates, bottomDom: snapshot.bottomDom.slice(0, 80), portalSummary: snapshot.portalSummary.slice(0, 120), shadowRootCount: snapshot.shadowRootCount, artifacts });
  }

  private async persistDeepDiscoveryArtifacts(page: Page, payload: Record<string, unknown>): Promise<Record<string, string>> {
    const stage = typeof payload.stage === "string" ? payload.stage.replace(/[^A-Za-z0-9_-]/gu, "_") : "snapshot";
    const outputDir = join(process.cwd(), "output");
    mkdirSync(outputDir, { recursive: true });
    const jsonPath = join(outputDir, `v121-sohu-deep-discovery-${stage}.json`);
    const screenshotPath = join(outputDir, `v121-sohu-deep-discovery-${stage}.png`);
    let screenshotError = "";
    try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch (error) { screenshotError = error instanceof Error ? error.message.slice(0, 240) : "screenshot_failed"; }
    writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), pageUrl: page.url(), screenshotPath, screenshotError: screenshotError || null, ...payload }, null, 2), "utf8");
    return { jsonPath, screenshotPath, ...(screenshotError ? { screenshotError } : {}) };
  }

  private async discoverEditorDom(page: Page, missingRequiredFields: string[] = []): Promise<SohuEditorDomDiscovery> {
    return page.evaluate(({ missing }) => {
      const visible = (element: Element): boolean => {
        const target = element as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
      };
      const clean = (value: string, limit = 160): string => value.replace(/\s+/gu, " ").trim().slice(0, limit);
      const associated = (element: Element): string[] => {
        const input = element as HTMLInputElement;
        const explicit = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent ?? "" : "";
        const described = (element.getAttribute("aria-describedby") ?? "").split(/\s+/u).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
        const label = element.closest("label")?.textContent ?? "";
        return [explicit, described, label, element.getAttribute("data-tooltip") ?? "", element.getAttribute("data-title") ?? ""].map(clean).filter(Boolean);
      };
      const surfaceFor = (element: Element): "page" | "modal" | "drawer" | "confirmation" => {
        const parent = element.closest('[role="dialog"],[class*="modal" i],[class*="dialog" i],[class*="drawer" i]');
        if (!parent) return "page";
        return /确认|发布|提交/iu.test(parent.textContent ?? "") ? "confirmation" : /drawer/iu.test(parent.getAttribute("class") ?? "") ? "drawer" : "modal";
      };
      const controls: SohuDomControl[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"],a,input[type="checkbox"],input[type="radio"],select'))) {
        if (!visible(element)) continue;
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute("role");
        const kind: SohuDomControl["kind"] = tag === "button" ? "button" : role === "button" ? "role-button" : tag === "a" ? "a" : tag === "select" ? "select" : (element as HTMLInputElement).type === "radio" ? "radio" : "checkbox";
        const hint = associated(element).join(" | ");
        const label = clean([tag === "input" || tag === "select" ? element.getAttribute("aria-label") ?? "" : element.innerText, element.getAttribute("aria-label") ?? "", element.getAttribute("title") ?? "", element.getAttribute("placeholder") ?? "", kind === "select" ? (element as HTMLSelectElement).selectedOptions[0]?.textContent ?? "" : ""].filter(Boolean).join(" ")) || clean(hint);
        const combined = `${label} ${hint}`;
        const keywordMatches = ["发布", "提交", "确认发布", "立即发布", "声明", "原创", "AI", "分类", "领域", "封面"].filter((keyword) => combined.includes(keyword));
        controls.push({ kind, label, hint, disabled: (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true", surface: surfaceFor(element), keywordMatches });
      }
      const finalCandidates = controls.filter((control) => control.keywordMatches.some((keyword) => ["发布", "提交", "确认发布", "立即发布"].includes(keyword)));
      const enabledCount = finalCandidates.filter((control) => !control.disabled).length;
      const state = finalCandidates.length === 0 ? (missing.length > 0 ? "conditional" : "absent") : enabledCount > 0 ? "present_enabled" : "present_disabled";
      return { controls, finalPublish: { state, candidateCount: finalCandidates.length, enabledCount, surfaces: [...new Set(finalCandidates.map((control) => control.surface))] } };
    }, { missing: missingRequiredFields });
  }

  private async assertNoSecurityChallenge(page: Page, afterFinalClick: boolean): Promise<void> {
    if (await this.hasSecurityChallenge(page)) throw new BrowserAutomationError(afterFinalClick ? "SUBMISSION_UNCERTAIN" : "USER_ACTION_REQUIRED", afterFinalClick ? "搜狐最终提交后出现安全验证，结果不确定，禁止二次提交" : "搜狐页面要求账号所有者完成正常验证码/安全验证；系统未尝试绕过验证");
  }

  private async hasSecurityChallenge(page: Page): Promise<boolean> {
    void SOHU_SECURITY_PATTERN;
    return page.evaluate(() => [...document.querySelectorAll("iframe[src*='captcha' i],iframe[src*='security' i],iframe[id*='captcha' i],iframe[class*='captcha' i],[id*='captcha' i],[class*='captcha' i]")].some((element) => {
      const target = element as HTMLElement;
      const style = window.getComputedStyle(target);
      const bounds = target.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
    })).catch(() => false);
  }

  private async hasEditorFields(page: Page): Promise<boolean> {
    return (await page.locator('input,textarea,[contenteditable="true"]').count()) > 0 && Boolean(await this.findField(page, SOHU_TITLE_PATTERN, false)) && Boolean(await this.findField(page, SOHU_BODY_PATTERN, true));
  }

  private async visibleImageCount(page: Page): Promise<number> {
    return page.evaluate(() => [...document.images].filter((image) => {
      const style = window.getComputedStyle(image);
      const bounds = image.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0 && /^(blob:|data:|https?:)/iu.test(image.currentSrc || image.src);
    }).length).catch(() => 0);
  }

  private async readFieldValue(field: Locator): Promise<string> {
    const contentEditable = await field.getAttribute("contenteditable").catch(() => null);
    if (contentEditable === "true") {
      const innerText = await field.innerText().catch(() => "");
      const textContent = await field.textContent().catch(() => "");
      return (innerText || textContent || "").trim();
    }
    return (await field.inputValue().catch(() => "")).trim();
  }

  private async fieldDiagnostics(field: Locator): Promise<string> {
    return field.evaluate((element) => JSON.stringify({
      tagName: element.tagName,
      contentEditable: element.getAttribute("contenteditable"),
      role: element.getAttribute("role"),
      placeholder: element.getAttribute("placeholder"),
      ariaLabel: element.getAttribute("aria-label"),
      textLength: (element.textContent ?? "").length,
      innerTextLength: (element as HTMLElement).innerText?.length ?? 0,
      inputValueLength: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value.length : null
    })).catch(() => "evaluate_failed");
  }

  private normalizedTextIncludes(actual: string, expected: string): boolean {
    const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
    return normalize(actual).includes(normalize(expected));
  }

  private async controlLabel(locator: Locator): Promise<string> {
    const attributes = await Promise.all(["placeholder", "aria-label", "title", "name", "id", "class"].map((name) => locator.getAttribute(name).catch(() => null)));
    const text = await locator.innerText().catch(() => "");
    return [...attributes.filter((value): value is string => Boolean(value)), text].join(" ").replace(/\s+/gu, " ").trim().slice(0, 500);
  }

  private async readLastDiscoveredLabel(page: Page): Promise<string> {
    const candidates = page.locator('a,button,[role="button"],[role="menuitem"]');
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const label = await this.controlLabel(candidates.nth(index));
      if (SOHU_ARTICLE_ENTRY_PATTERN.test(label)) return label;
    }
    return "";
  }

  private async visibleControlLabels(page: Page): Promise<string[]> {
    return page.locator('a,button,[role="button"],[role="menuitem"]').evaluateAll((elements) => elements
      .filter((element) => {
        const target = element as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      })
      .map((element) => {
        const target = element as HTMLElement;
        return [target.innerText, target.getAttribute("aria-label"), target.getAttribute("title")]
          .filter((value): value is string => Boolean(value))
          .join(" ")
          .replace(/\s+/gu, " ")
          .trim();
      })
      .filter(Boolean)
      .slice(0, 80)
    ).catch(() => []);
  }

  private async waitForSohuDom(page: Page): Promise<void> {
    try {
      await page.waitForFunction(() => Boolean(document.body?.innerText.trim()) || Boolean(document.querySelector('input,textarea,[contenteditable="true"]')), undefined, { timeout: 15_000 });
      await page.waitForTimeout(500);
    } catch {
      // The diagnostic below records the real page state; do not infer an editor from the URL alone.
    }
  }

  private async domDiagnostics(page: Page): Promise<string> {
    return page.evaluate(() => JSON.stringify({
      readyState: document.readyState,
      title: document.title,
      bodyText: document.body?.innerText.slice(0, 500) ?? "",
      htmlLength: document.documentElement?.outerHTML.length ?? 0,
      iframeCount: document.querySelectorAll("iframe").length,
      controlCount: document.querySelectorAll('a,button,[role="button"],[role="menuitem"]').length
    })).catch(() => "evaluate_failed");
  }

  private async realNameDialogDiagnostics(page: Page): Promise<string> {
    return page.locator("body *").evaluateAll((elements) => elements
      .filter((element) => (element.textContent ?? "").trim() === "暂不认证")
      .slice(0, 10)
      .map((element) => {
        const target = element as HTMLElement;
        const bounds = target.getBoundingClientRect();
        const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return { tag: target.tagName, className: target.className, role: target.getAttribute("role"), bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, topmostTag: topmost?.tagName ?? null, topmostClass: (topmost as HTMLElement | null)?.className ?? null };
      })
    ).then((items) => JSON.stringify(items)).catch(() => "evaluate_failed");
  }

  private async uploadControlDiagnostics(page: Page): Promise<string> {
    return page.locator("body *").evaluateAll((elements) => elements
      .filter((element) => (element.textContent ?? "").replace(/\s+/gu, " ").trim() === "上传图片")
      .slice(0, 10)
      .map((element) => {
        const target = element as HTMLElement;
        const bounds = target.getBoundingClientRect();
        const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return { tag: target.tagName, className: target.className, role: target.getAttribute("role"), contentEditable: target.getAttribute("contenteditable"), bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, topmostTag: topmost?.tagName ?? null, topmostClass: (topmost as HTMLElement | null)?.className ?? null, outer: target.outerHTML.slice(0, 500) };
      })
    ).then((items) => JSON.stringify(items)).catch(() => "evaluate_failed");
  }

  private async uploadPostDiagnostics(page: Page): Promise<string> {
    return page.evaluate(() => JSON.stringify({
      fileInputs: [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].map((input) => ({ accept: input.accept, files: [...(input.files ?? [])].map((file) => ({ name: file.name, size: file.size, type: file.type })) })),
      visibleImages: [...document.images].filter((image) => {
        const style = window.getComputedStyle(image);
        const bounds = image.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      }).slice(0, 20).map((image) => ({ src: (image.currentSrc || image.src).slice(0, 300), className: image.className })),
      visibleDialogs: [...document.querySelectorAll('[role="dialog"],.el-dialog,.dialog-content')].filter((element) => {
        const target = element as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      }).slice(0, 5).map((element) => (element as HTMLElement).innerText.slice(0, 500)),
      bodyText: document.body?.innerText.slice(0, 1_000) ?? ""
    })).catch(() => "evaluate_failed");
  }

  private timeWindowMatches(context: string, windowStart: number, windowEnd: number): boolean {
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return false;
    if (/刚刚|分钟前|今天|昨天/iu.test(context)) return true;
    const values = context.match(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/gu) ?? [];
    return values.some((value) => { const parsed = Date.parse(value.replace(/[年月]/gu, "-").replace("日", "").replaceAll("/", "-")); return Number.isFinite(parsed) && parsed >= windowStart && parsed <= windowEnd; });
  }

  private isPublicSohuUrl(url: string): boolean {
    try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname !== "mp.sohu.com" && /(?:^|\.)sohu\.com$/iu.test(parsed.hostname) && Boolean(this.externalIdFromUrl(parsed.href)); } catch { return false; }
  }

  private externalIdFromUrl(url: string): string | null {
    try { return new URL(url).pathname.match(/(?:^|\/)(\d{5,})(?:[/?#_.-]|$)/u)?.[1] ?? null; } catch { return null; }
  }

  private accountKey(ctx: AccountContext): string { return `${this.platformKey}:${ctx.accountId}`; }
}

export default SohuBrowserAdapter;
