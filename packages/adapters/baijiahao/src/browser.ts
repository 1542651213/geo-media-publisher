import type { AccountContext, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import type { BrowserPublishAttemptContext } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";
import type { AutomationPrepareResult } from "@publisher/adapters-core";
import type { Frame, Locator, Page } from "playwright-core";

const BAIJIAHAO_BACKEND_URL = "https://baijiahao.baidu.com/";
const SECURITY_CHALLENGE_PATTERN = /captcha|security\s*check|人机|验证码|短信验证|安全验证|风险控制|二维码登录/iu;
const PERMISSION_OR_ACCOUNT_PATTERN = /(?:没有权限|无权|权限不足|账号异常|账号被封|账号受限|账号存在风险)/iu;
const REQUIRED_PAGE_STATE_PATTERN = /(?:请先同意|协议确认|必须选择分类|请完善必填|必填项未完成|需要完成声明)/iu;
const PUBLISH_CONTROL_PATTERN = /^(?:发布|立即发布|确认发布|提交|发布文章|发布内容|下一步|预览后发布)$/u;
const ARTICLE_ENTRY_PATTERN = /^(?:(?:发布|写作|创建|新建)?\s*(?:图文|文章)|图文(?:发布|创作)?|文章(?:发布|创作)?|内容发布|写作|publish\s+article|article)$/iu;
const IMAGE_INPUT_SELECTORS = [
  'input[type="file"][accept*="image"]',
  'input[type="file"]'
];
const FIELD_DISCOVERY_SELECTORS = ["input", "textarea", '[contenteditable="true"]', '[role="textbox"]'];
const INTERACTIVE_DISCOVERY_SELECTOR = 'button, a, [role="button"], [tabindex="0"]';
const EDITOR_INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060-\u206F\uFEFF]/gu;

export function normalizeBaijiahaoEditorText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(EDITOR_INVISIBLE_CHARACTERS, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\s+/gu, " ")
    .trim();
}

type EditorFieldKind = "title" | "body";
type BaijiahaoEditorFailureCode = "CONTENT_EDITOR_NOT_VERIFIED" | "CONTENT_EDITOR_AMBIGUOUS" | "CONTENT_TITLE_NOT_VERIFIED" | "CONTENT_BODY_NOT_VERIFIED";

type DomRoot = Pick<Page, "locator" | "url"> | Pick<Frame, "locator" | "url">;

interface EditorCandidateEvidence {
  kind: EditorFieldKind;
  frameUrl: string;
  selector: string;
  index: number;
  tagName: string;
  role: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  name: string | null;
  className: string | null;
  id: string | null;
  contenteditable: string | null;
  visible: boolean;
  editable: boolean;
  nearbyText: string;
  score: number;
  signals: string[];
}

interface EditorCandidate extends EditorCandidateEvidence {
  locator: Locator;
}

interface EditorDiscovery {
  title: EditorCandidate | null;
  body: EditorCandidate | null;
  titleCandidates: EditorCandidateEvidence[];
  bodyCandidates: EditorCandidateEvidence[];
  frameCount: number;
  frameUrls: string[];
  pageDiagnostics: PageDomDiagnostics;
}

interface PageDomDiagnostics {
  pageUrl: string;
  documentTitle: string;
  readyState: string;
  bodyTextLength: number;
  bodyTextSample: string;
  bodyChildCount: number;
  fieldCount: number;
  interactiveCount: number;
  iframeCount: number;
}

interface PublishControlInspection {
  locator: Locator | null;
  verified: boolean;
  enabled: boolean;
  reason: string;
  evidence: {
    verified: boolean;
    enabled: boolean;
    candidateCount: number;
    labels: string[];
    disabledLabels: string[];
  };
}

interface InteractiveEvidence {
  frameUrl: string;
  selector: string;
  index: number;
  tagName: string;
  role: string | null;
  ariaLabel: string | null;
  title: string | null;
  className: string | null;
  id: string | null;
  text: string;
  visible: boolean;
  enabled: boolean;
}

class BaijiahaoEditorError extends BrowserAutomationError {
  constructor(readonly editorCode: BaijiahaoEditorFailureCode, message: string) {
    super("CONTENT_REJECTED", `${editorCode}: ${message}`);
    this.name = "BaijiahaoEditorError";
  }
}

const definition: BrowserPlatformDefinition = {
  platformKey: "baijiahao",
  displayName: "百家号",
  category: "图文/内容",
  officialWebsite: "https://baijiahao.baidu.com/",
  developerPortal: "https://baijiahao.baidu.com/",
  backendUrl: "https://baijiahao.baidu.com/",
  officialSources: ["https://baijiahao.baidu.com/"],
  version: "1.0.0",
  researchStatus: "partial",
  blockingReason: "首阶段完成用户自有浏览器 Session、官方后台打开和发布任务准备；真实提交与回查仍需账号所有者确认和平台条款/权限验收。",
  capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false }
};

export class BaijiahaoBrowserAdapter extends BrowserAutomationAdapter {
  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }

  private readonly verifiedEditorUrls = new Map<string, string>();
  private readonly preparedImageEvidence = new Map<string, { imageUploaded: boolean; imageUploadEvidence: string }>();

  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("; "));
    const opened = await this.openBackendPage(ctx, BAIJIAHAO_BACKEND_URL);
    const page = opened.page as unknown as Page;
    await this.waitForPageHydration(page);
    await this.assertPageReady(page);

    const editor = await this.ensureArticleEditor(page);
    const title = editor.discovery.title?.locator;
    const body = editor.discovery.body?.locator;
    if (!title || !body) throw new BaijiahaoEditorError("CONTENT_EDITOR_NOT_VERIFIED", this.editorDiagnostic(editor.discovery));
    await title.waitFor({ state: "visible", timeout: 10_000 });
    await body.waitFor({ state: "visible", timeout: 10_000 });

    const events = ["EDITOR_OPEN_PASSED"];
    const titleBefore = await this.readField(title);
    if (normalizeBaijiahaoEditorText(titleBefore) === normalizeBaijiahaoEditorText(article.title)) events.push("TITLE_REUSED");
    else {
      await this.fillField(title, article.title);
      events.push("TITLE_FILLED");
    }
    if (normalizeBaijiahaoEditorText(await this.readField(title)) !== normalizeBaijiahaoEditorText(article.title)) {
      throw new BaijiahaoEditorError("CONTENT_TITLE_NOT_VERIFIED", `标题回读与目标内容不一致；field=${this.fieldDiagnostic(editor.discovery.title)}`);
    }

    const bodyBefore = await this.readField(body);
    if (normalizeBaijiahaoEditorText(bodyBefore) === normalizeBaijiahaoEditorText(article.body)) events.push("BODY_REUSED");
    else {
      await this.fillField(body, article.body);
      events.push("BODY_FILLED");
    }
    if (normalizeBaijiahaoEditorText(await this.readField(body)) !== normalizeBaijiahaoEditorText(article.body)) {
      throw new BaijiahaoEditorError("CONTENT_BODY_NOT_VERIFIED", `正文回读与目标内容不一致；field=${this.fieldDiagnostic(editor.discovery.body)}`);
    }

    let imageUploaded = false;
    let imageUploadEvidence = "not_requested";
    const imagePath = article.images?.[0]?.trim();
    if (imagePath) {
      events.push("IMAGE_UPLOAD_STARTED");
      try {
        const input = await this.findOptionalVisibleField(page, IMAGE_INPUT_SELECTORS);
        if (!input) {
          imageUploadEvidence = "no_visible_image_input_optional";
          events.push("IMAGE_UPLOAD_SKIPPED_OPTIONAL");
        } else {
          await input.setInputFiles(imagePath);
          imageUploaded = true;
          imageUploadEvidence = "visible_image_file_input_accepted";
          events.push("IMAGE_UPLOAD_PASSED");
        }
      } catch (error) {
        imageUploadEvidence = `optional_upload_failed:${error instanceof Error ? error.message : "unknown"}`.slice(0, 300);
        events.push("IMAGE_UPLOAD_SKIPPED_OPTIONAL");
      }
    }

    const editorUrl = page.url();
    const accountKey = this.accountKey(ctx);
    this.verifiedEditorUrls.set(accountKey, editorUrl);
    this.preparedImageEvidence.set(accountKey, { imageUploaded, imageUploadEvidence });
    return {
      prepared: true,
      requiresUserAction: false,
      message: "百家号文章编辑器已打开，标题和正文已通过真实 DOM 回读；最终发布只允许一次。",
      sessionIdHash: opened.session.sessionIdHash,
      backendUrl: editorUrl,
      editorOpenedAt: new Date().toISOString(),
      titleFilled: true,
      bodyFilled: true,
      response: {
        adapter: this.platformKey,
        stage: "editor_prepared",
        pageUrl: editorUrl,
        domEvidence: "playwright:baijiahao:multi-signal-editor-dom",
        editorDom: {
          frameCount: editor.discovery.frameCount,
          frameUrls: editor.discovery.frameUrls,
          title: editor.discovery.title ? this.editorEvidence(editor.discovery.title) : null,
          body: editor.discovery.body ? this.editorEvidence(editor.discovery.body) : null,
          titleCandidates: editor.discovery.titleCandidates,
          bodyCandidates: editor.discovery.bodyCandidates
        },
        automationType: this.automationType,
        browserExecutionMode: opened.session.executionMode,
        headless: opened.session.headless,
        events,
        entryLabel: editor.entryLabel,
        imageUploaded,
        imageUploadEvidence,
        imageUploadRequired: false,
        requiredFields: [],
        requiredUserFields: [],
        finalSubmit: "platform_specific_once",
        resultVerification: "platform_specific_public_url_title_body_account"
      }
    };
  }

  async prepareFinalSubmit(ctx: AccountContext, article: PublishArticleInput): Promise<{ response: Record<string, unknown> }> {
    const active = await this.requireActiveEditor(ctx, article);
    await this.assertPageReady(active.page);
    const control = await this.inspectPublishControl(active.page);
    if (!control.verified) throw new BrowserAutomationError("FINAL_SUBMIT_CONTROL_NOT_FOUND", `FINAL_SUBMIT_CONTROL_NOT_VERIFIED: ${control.reason}`);
    if (!control.enabled) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `REQUIRED_FIELD_MISSING: 百家号最终提交控件存在但不可用；${control.reason}`);
    return { response: { adapter: this.platformKey, stage: "final_submit_preflight", pageUrl: active.page.url(), finalControlVisible: true, finalSubmit: "platform_specific_once", finalSubmitControl: control.evidence } };
  }

  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    if (attempt.attempt !== 1) throw new BrowserAutomationError("FINAL_SUBMIT_ALREADY_USED", "百家号最终提交只允许一次");
    const active = await this.requireActiveEditor(ctx, article);
    const page = active.page;
    await this.assertPageReady(page);
    const control = await this.inspectPublishControl(page);
    if (!control.verified) throw new BrowserAutomationError("FINAL_SUBMIT_CONTROL_NOT_FOUND", `FINAL_SUBMIT_CONTROL_NOT_VERIFIED: ${control.reason}`);
    if (!control.enabled || !control.locator) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `REQUIRED_FIELD_MISSING: 百家号最终提交控件存在但不可用；${control.reason}`);
    const submit = control.locator;
    const beforeUrl = page.url();
    attempt.markSubmissionSideEffect?.();
    await submit.click();
    await page.waitForTimeout(1_000).catch(() => undefined);
    await page.waitForURL((url) => url.toString() !== beforeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    if (await this.hasSecurityChallenge(page)) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "百家号最终提交后出现验证码或安全验证，结果未知，禁止再次提交");
    const result = this.resultFromUrl(page.url());
    if (!result) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "百家号最终提交已执行但未取得可靠 External ID/URL，禁止再次提交");
    const imageEvidence = this.preparedImageEvidence.get(this.accountKey(ctx));
    return { success: true, status: "published", ...result, response: { adapter: this.platformKey, stage: "final_submitted", beforeUrl, afterUrl: page.url(), finalSubmitCount: 1, submissionIntentId: attempt.submissionIntentId, imageUploaded: imageEvidence?.imageUploaded ?? false, imageUploadEvidence: imageEvidence?.imageUploadEvidence ?? "not_requested" } };
  }

  async collectPublishResult(ctx: AccountContext, _article: PublishArticleInput, _attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "百家号提交后没有可读取的应用自建 Browser Session");
    const result = this.resultFromUrl(active.page.url());
    if (!result) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "百家号提交后未取得可靠 External ID/URL，禁止再次提交");
    const imageEvidence = this.preparedImageEvidence.get(this.accountKey(ctx));
    return { success: true, status: "published", ...result, response: { adapter: this.platformKey, stage: "result_collected", pageUrl: active.page.url(), imageUploaded: imageEvidence?.imageUploaded ?? false, imageUploadEvidence: imageEvidence?.imageUploadEvidence ?? "not_requested" } };
  }

  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const externalId = result.externalId?.trim() ?? "";
    const publishedUrl = result.publishedUrl?.trim() ?? "";
    if (!externalId || !this.isPublicUrl(publishedUrl)) return { status: "failed", externalId: externalId || undefined, publishedUrl: publishedUrl || undefined, response: { accountMatch: false, titleMatch: false, bodyMatch: false, urlReachable: false }, errorCode: "EXTERNAL_EVIDENCE_INCOMPLETE", errorMessage: "百家号 External ID 或 External URL 不完整" };
    const active = await this.activeBackendPage(ctx);
    if (!active) return { status: "failed", externalId, publishedUrl, response: { accountMatch: false, titleMatch: false, bodyMatch: false, urlReachable: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "百家号公开结果验证需要当前应用自建 Browser Session" };
    try {
      await active.page.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const pageTitle = await active.page.title().catch(() => "");
      const pageText = await active.page.locator("body").innerText().catch(() => "");
      const titleMatch = pageTitle.includes(article.title) || pageText.includes(article.title);
      const bodyMatch = pageText.includes(article.body);
      const accountMatch = pageText.includes(ctx.accountName);
      const urlReachable = this.isPublicUrl(active.page.url());
      const published = titleMatch && bodyMatch && accountMatch && urlReachable;
      return { status: published ? "published" : "failed", externalId, publishedUrl: active.page.url(), response: { accountMatch, titleMatch, bodyMatch, urlReachable, pageUrl: active.page.url() }, ...(published ? {} : { errorCode: "RECONCILIATION_UNCERTAIN" as const, errorMessage: "百家号公开页面未同时证明账号、标题、正文和可访问 URL" }) };
    } catch (error) {
      return { status: "failed", externalId, publishedUrl, response: { accountMatch: false, titleMatch: false, bodyMatch: false, urlReachable: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: error instanceof Error ? error.message : "百家号公开结果验证失败" };
    }
  }

  private accountKey(ctx: AccountContext): string { return `${this.platformKey}:${ctx.accountId}`; }

  private async ensureArticleEditor(page: Page): Promise<{ entryLabel: string | null; discovery: EditorDiscovery }> {
    let discovery = await this.discoverEditor(page, false);
    if (discovery.title && discovery.body) return { entryLabel: null, discovery };

    const entryDiscovery = await this.collectArticleEntries(page);
    if (entryDiscovery.entries.length === 0) throw new BaijiahaoEditorError("CONTENT_EDITOR_NOT_VERIFIED", `${this.editorDiagnostic(discovery)}; interactive=${JSON.stringify(entryDiscovery.evidence).slice(0, 6_000)}`);
    if (entryDiscovery.entries.length > 1) throw new BaijiahaoEditorError("CONTENT_EDITOR_AMBIGUOUS", `发现多个无法可靠区分的图文入口；entries=${entryDiscovery.entries.map((entry) => entry.label).join(" | ")}; ${this.editorDiagnostic(discovery)}`);

    const entry = entryDiscovery.entries[0];
    await entry.locator.click();
    discovery = await this.waitForEditor(page);
    return { entryLabel: entry.label, discovery };
  }

  private async waitForEditor(page: Page): Promise<EditorDiscovery> {
    let latest = await this.discoverEditor(page, false);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (latest.title && latest.body) return latest;
      await page.waitForTimeout(200).catch(() => undefined);
      latest = await this.discoverEditor(page, false);
    }
    return await this.discoverEditor(page, true);
  }

  private async discoverEditor(page: Page, strict: boolean): Promise<EditorDiscovery> {
    const roots = this.domRoots(page);
    const titleCandidates = await this.collectFieldCandidates(roots, "title");
    const bodyCandidates = await this.collectFieldCandidates(roots, "body");
    const title = this.selectEditorCandidate(titleCandidates, "title", strict);
    const body = this.selectEditorCandidate(bodyCandidates, "body", strict);
    return {
      title,
      body,
      titleCandidates: titleCandidates.map((candidate) => this.editorEvidence(candidate)),
      bodyCandidates: bodyCandidates.map((candidate) => this.editorEvidence(candidate)),
      frameCount: roots.length,
      frameUrls: roots.map((root) => root.url),
      pageDiagnostics: await this.pageDiagnostics(page)
    };
  }

  private async pageDiagnostics(page: Page): Promise<PageDomDiagnostics> {
    const fallback: PageDomDiagnostics = { pageUrl: page.url(), documentTitle: "", readyState: "unknown", bodyTextLength: 0, bodyTextSample: "", bodyChildCount: 0, fieldCount: 0, interactiveCount: 0, iframeCount: 0 };
    const evaluate = (page as unknown as { evaluate?: <T>(fn: () => T) => Promise<T> }).evaluate;
    if (!evaluate) return fallback;
    const result = await evaluate.call(page, () => ({
      documentTitle: document.title,
      readyState: document.readyState,
      bodyTextSample: document.body?.innerText?.slice(0, 500) ?? "",
      bodyTextLength: document.body?.innerText?.length ?? 0,
      bodyChildCount: document.body?.children.length ?? 0,
      fieldCount: document.querySelectorAll("input, textarea, [contenteditable=\"true\"], [role=\"textbox\"]").length,
      interactiveCount: document.querySelectorAll("button, a, [role=\"button\"], [tabindex=\"0\"]").length,
      iframeCount: document.querySelectorAll("iframe").length
    })).catch(() => null) as Omit<PageDomDiagnostics, "pageUrl"> | null;
    return result ? { pageUrl: page.url(), ...result } : fallback;
  }

  private async waitForPageHydration(page: Page): Promise<void> {
    const evaluate = (page as unknown as { evaluate?: <T>(fn: () => T) => Promise<T> }).evaluate;
    if (!evaluate) return;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = await evaluate.call(page, () => ({ readyState: document.readyState, bodyChildCount: document.body?.children.length ?? 0, bodyTextLength: document.body?.innerText?.length ?? 0, fieldCount: document.querySelectorAll("input, textarea, [contenteditable=\"true\"], [role=\"textbox\"]").length, interactiveCount: document.querySelectorAll("button, a, [role=\"button\"], [tabindex=\"0\"]").length })).catch(() => null) as { readyState: string; bodyChildCount: number; bodyTextLength: number; fieldCount: number; interactiveCount: number } | null;
      if (state && state.readyState === "complete" && state.bodyChildCount > 0 && (state.bodyTextLength > 0 || state.fieldCount > 0 || state.interactiveCount > 0)) return;
      await page.waitForTimeout(200).catch(() => undefined);
    }
  }

  private domRoots(page: Page): Array<{ root: DomRoot; url: string }> {
    const frames = (page as unknown as { frames?: () => Frame[] }).frames?.();
    if (frames && frames.length > 0) return frames.map((frame) => ({ root: frame, url: frame.url() }));
    return [{ root: page, url: page.url() }];
  }

  private async collectFieldCandidates(roots: Array<{ root: DomRoot; url: string }>, kind: EditorFieldKind): Promise<EditorCandidate[]> {
    const candidates: EditorCandidate[] = [];
    const seen = new Set<string>();
    for (const { root, url } of roots) {
      for (const selector of FIELD_DISCOVERY_SELECTORS) {
        const collection = root.locator(selector);
        const count = Math.min(await collection.count().catch(() => 0), 100);
        for (let index = 0; index < count; index += 1) {
          const nth = (collection as unknown as { nth?: (value: number) => Locator }).nth;
          const locator = nth ? nth.call(collection, index) : collection.first();
          const evidence = await this.describeEditorCandidate(locator, kind, url, selector, index, count);
          const key = evidence.id && count === 1
            ? `${url}|id:${evidence.id}`
            : `${url}|${evidence.tagName}|${evidence.name ?? ""}|${evidence.placeholder ?? ""}|${evidence.ariaLabel ?? ""}|${evidence.className ?? ""}|${index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ ...evidence, locator });
        }
      }
    }
    return candidates;
  }

  private async describeEditorCandidate(locator: Locator, kind: EditorFieldKind, frameUrl: string, selector: string, index: number, sourceCount: number): Promise<EditorCandidateEvidence> {
    const getAttribute = async (name: string): Promise<string | null> => await locator.getAttribute(name).catch(() => null);
    const role = await getAttribute("role");
    const placeholder = await getAttribute("placeholder");
    const ariaLabel = await getAttribute("aria-label");
    const name = await getAttribute("name");
    const className = await getAttribute("class");
    const id = await getAttribute("id");
    const contenteditable = await getAttribute("contenteditable");
    const visible = await (locator as unknown as { isVisible?: () => Promise<boolean> }).isVisible?.().catch(() => false) ?? false;
    const enabled = await (locator as unknown as { isEnabled?: () => Promise<boolean> }).isEnabled?.().catch(() => true) ?? true;
    const disabled = (await getAttribute("disabled")) !== null || (await getAttribute("aria-disabled")) === "true";
    const readOnly = (await getAttribute("readonly")) !== null || (await getAttribute("aria-readonly")) === "true";
    const evaluate = (locator as unknown as { evaluate?: <T>(fn: (element: Element) => T) => Promise<T> }).evaluate;
    const domMetadata: { tagName: string; nearbyText: string } | null = evaluate
      ? await evaluate.call(locator, (element: Element) => ({ tagName: element.tagName, nearbyText: element.parentElement?.innerText?.slice(0, 300) ?? "" })).catch(() => null) as { tagName: string; nearbyText: string } | null
      : null;
    const tagName = domMetadata?.tagName ?? (selector.startsWith("input") ? "INPUT" : selector === "textarea" ? "TEXTAREA" : selector.includes("contenteditable") ? "DIV" : "UNKNOWN");
    const nearbyText = domMetadata?.nearbyText ?? (await locator.innerText().catch(() => "")).slice(0, 300);
    const semanticText = [placeholder, ariaLabel, name, id, className, nearbyText].filter((value): value is string => Boolean(value?.trim())).join(" ");
    const titleSemantic = /标题|title|headline/iu.test(semanticText);
    const bodySemantic = /正文|内容|body|article|editor|富文本|prosemirror|quill|draft/iu.test(semanticText);
    const structural = kind === "title"
      ? ["INPUT", "TEXTAREA"].includes(tagName.toUpperCase())
      : ["TEXTAREA", "DIV", "ARTICLE", "P"].includes(tagName.toUpperCase()) || contenteditable === "true";
    const semantic = kind === "title" ? titleSemantic : bodySemantic;
    const editable = enabled && !disabled && !readOnly && contenteditable !== "false";
    const signals = [
      ...(visible ? ["visible"] : []),
      ...(editable ? ["editable"] : []),
      ...(structural ? [`tag:${tagName.toLowerCase()}`] : []),
      ...(semantic ? [`semantic:${kind}`] : []),
      ...(role === "textbox" ? ["role:textbox"] : []),
      ...(contenteditable === "true" ? ["contenteditable:true"] : []),
      ...(className && /prosemirror|quill|draft|editor/iu.test(className) ? ["rich-text-class"] : []),
      ...(sourceCount > 1 ? [`selector_count:${sourceCount}`] : [])
    ];
    const score = (visible ? 3 : 0) + (editable ? 3 : 0) + (structural ? 2 : 0) + (semantic ? 4 : 0) + (role === "textbox" ? 1 : 0) + (contenteditable === "true" ? 2 : 0) + (className && /prosemirror|quill|draft|editor/iu.test(className) ? 1 : 0);
    return { kind, frameUrl, selector, index, tagName, role, placeholder, ariaLabel, name, className, id, contenteditable, visible, editable, nearbyText, score, signals };
  }

  private selectEditorCandidate(candidates: EditorCandidate[], kind: EditorFieldKind, strict: boolean): EditorCandidate | null {
    const eligible = candidates.filter((candidate) => {
      if (!candidate.visible || !candidate.editable) return false;
      const semantic = kind === "title"
        ? /标题|title|headline/iu.test([candidate.placeholder, candidate.ariaLabel, candidate.name, candidate.id, candidate.className, candidate.nearbyText].filter(Boolean).join(" "))
        : candidate.contenteditable === "true" || /正文|内容|body|article|editor|富文本|prosemirror|quill|draft/iu.test([candidate.placeholder, candidate.ariaLabel, candidate.name, candidate.id, candidate.className, candidate.nearbyText].filter(Boolean).join(" "));
      const structural = kind === "title"
        ? ["INPUT", "TEXTAREA"].includes(candidate.tagName.toUpperCase())
        : ["TEXTAREA", "DIV", "ARTICLE", "P"].includes(candidate.tagName.toUpperCase()) || candidate.contenteditable === "true";
      return structural && semantic;
    }).sort((left, right) => right.score - left.score);
    if (eligible.length === 0) {
      if (strict) throw new BaijiahaoEditorError(kind === "title" ? "CONTENT_TITLE_NOT_VERIFIED" : "CONTENT_BODY_NOT_VERIFIED", `未找到满足可见、可编辑、结构和语义信号的${kind === "title" ? "标题" : "正文"}候选；candidates=${JSON.stringify(candidates.map((candidate) => this.editorEvidence(candidate))).slice(0, 3_000)}`);
      return null;
    }
    const best = eligible[0];
    const nearTies = eligible.filter((candidate) => best.score - candidate.score < 2);
    if (nearTies.length > 1) throw new BaijiahaoEditorError("CONTENT_EDITOR_AMBIGUOUS", `${kind === "title" ? "标题" : "正文"}存在多个无法可靠区分的候选；candidates=${JSON.stringify(nearTies.map((candidate) => this.editorEvidence(candidate))).slice(0, 3_000)}`);
    return best;
  }

  private async collectArticleEntries(page: Page): Promise<{ entries: Array<{ locator: Locator; label: string }>; evidence: InteractiveEvidence[] }> {
    const entries: Array<{ locator: Locator; label: string }> = [];
    const evidence: InteractiveEvidence[] = [];
    const roots = this.domRoots(page);
    for (const { root, url: frameUrl } of roots) {
      const collection = root.locator(INTERACTIVE_DISCOVERY_SELECTOR);
      const count = Math.min(await collection.count().catch(() => 0), 100);
      for (let index = 0; index < count; index += 1) {
        const nth = (collection as unknown as { nth?: (value: number) => Locator }).nth;
        const locator = nth ? nth.call(collection, index) : collection.first();
        const text = (await locator.innerText().catch(() => "")).replace(/\s+/gu, " ").trim().slice(0, 300);
        const ariaLabel = await locator.getAttribute("aria-label").catch(() => null);
        const title = await locator.getAttribute("title").catch(() => null);
        const role = await locator.getAttribute("role").catch(() => null);
        const className = await locator.getAttribute("class").catch(() => null);
        const id = await locator.getAttribute("id").catch(() => null);
        const visible = await locator.isVisible().catch(() => false);
        const enabled = await locator.isEnabled().catch(() => false);
        const evaluate = (locator as unknown as { evaluate?: <T>(fn: (element: Element) => T) => Promise<T> }).evaluate;
        const tagName = evaluate
          ? String(await evaluate.call(locator, (element: Element) => element.tagName).catch(() => "UNKNOWN"))
          : "UNKNOWN";
        const itemEvidence: InteractiveEvidence = { frameUrl, selector: INTERACTIVE_DISCOVERY_SELECTOR, index, tagName, role, ariaLabel, title, className, id, text, visible, enabled };
        if (visible || text || ariaLabel || title) evidence.push(itemEvidence);
        const labels = [text, ariaLabel, title]
          .filter((value): value is string => Boolean(value?.trim()))
          .map((value) => value.replace(/\s+/gu, " ").trim());
        const label = labels.find((value) => ARTICLE_ENTRY_PATTERN.test(value));
        if (!label || !visible || !enabled) continue;
        entries.push({ locator, label });
      }
    }
    return { entries, evidence };
  }

  private async requireActiveEditor(ctx: AccountContext, article: PublishArticleInput): Promise<{ page: Page }> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "百家号没有可继续使用的应用自建 Visible Browser Session");
    const page = active.page as unknown as Page;
    const expectedUrl = this.verifiedEditorUrls.get(this.accountKey(ctx));
    if (!expectedUrl || page.url() !== expectedUrl) {
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", `百家号编辑器会话未通过同一页面校验：${article.title}`);
    }
    return { page };
  }

  private async findOptionalVisibleField(page: Page, selectors: string[]): Promise<Locator | null> {
    for (const selector of selectors) {
      const candidate = page.locator(selector).first();
      if (await candidate.count().catch(() => 0) === 0) continue;
      const visible = (candidate as unknown as { isVisible?: () => Promise<boolean> }).isVisible;
      if (visible && !(await visible.call(candidate).catch(() => false))) continue;
      return candidate;
    }
    return null;
  }

  private async inspectPublishControl(page: Page): Promise<PublishControlInspection> {
    const candidates = page.locator('button, [role="button"], a');
    const count = Math.min(await candidates.count().catch(() => 0), 100);
    const matched: Array<{ locator: Locator; label: string; enabled: boolean }> = [];
    for (let index = 0; index < count; index += 1) {
      const nth = (candidates as unknown as { nth?: (value: number) => Locator }).nth;
      const candidate = nth ? nth.call(candidates, index) : candidates.first();
      const labels = [await candidate.innerText().catch(() => ""), await candidate.getAttribute("aria-label").catch(() => null), await candidate.getAttribute("title").catch(() => null)]
        .filter((value): value is string => Boolean(value?.trim()))
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      const label = labels.split(/\s+/u).find((value) => PUBLISH_CONTROL_PATTERN.test(value)) ?? (PUBLISH_CONTROL_PATTERN.test(labels) ? labels : null);
      if (!label) continue;
      const visible = await candidate.isVisible().catch(() => false);
      const enabled = await candidate.isEnabled().catch(() => false);
      if (visible) matched.push({ locator: candidate, label, enabled });
    }
    const labels = matched.map((item) => item.label);
    const disabledLabels = matched.filter((item) => !item.enabled).map((item) => item.label);
    const verified = matched.length === 1;
    const enabled = verified && matched[0]?.enabled === true;
    const reason = matched.length === 0 ? "未找到可见的最终提交控件" : matched.length > 1 ? `发现 ${matched.length} 个候选：${labels.join(" | ")}` : enabled ? "唯一最终提交控件已找到且可用" : `唯一控件不可用：${disabledLabels.join(" | ")}`;
    return { locator: enabled ? matched[0].locator : null, verified, enabled, reason, evidence: { verified, enabled, candidateCount: matched.length, labels, disabledLabels } };
  }

  private async readField(field: Locator): Promise<string> {
    if (await field.getAttribute("contenteditable").catch(() => null) === "true") return (await field.innerText().catch(() => "")).trim();
    const inputValue = await field.inputValue().catch(() => "");
    if (inputValue) return inputValue.trim();
    return (await field.innerText().catch(() => "")).trim();
  }

  private async fillField(field: Locator, value: string): Promise<void> {
    await field.click().catch(() => undefined);
    await field.fill(value);
  }

  private normalizedIncludes(actual: string, expected: string): boolean { return normalizeBaijiahaoEditorText(actual).includes(normalizeBaijiahaoEditorText(expected)); }

  private editorEvidence(candidate: EditorCandidate): EditorCandidateEvidence {
    const { locator: _locator, ...evidence } = candidate;
    return evidence;
  }

  private fieldDiagnostic(candidate: EditorCandidate | null): string { return candidate ? JSON.stringify(this.editorEvidence(candidate)) : "missing"; }

  private editorDiagnostic(discovery: EditorDiscovery): string {
    return `dom=${JSON.stringify({ frameCount: discovery.frameCount, frameUrls: discovery.frameUrls, pageDiagnostics: discovery.pageDiagnostics, titleCandidates: discovery.titleCandidates, bodyCandidates: discovery.bodyCandidates }).slice(0, 6_000)}`;
  }

  private async assertPageReady(page: Page): Promise<void> {
    const url = page.url();
    if (this.isLoginPage(url)) throw new BrowserAutomationError("LOGIN_EXPIRED", "百家号 Session 已过期，请重新登录");
    const text = await page.locator("body").innerText().catch(() => "");
    if (SECURITY_CHALLENGE_PATTERN.test(text) || SECURITY_CHALLENGE_PATTERN.test(url)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "百家号当前页面要求用户完成验证码或安全验证");
    if (PERMISSION_OR_ACCOUNT_PATTERN.test(text)) throw new BrowserAutomationError("PERMISSION_DENIED", "百家号当前账号或页面权限不满足编辑条件");
    if (REQUIRED_PAGE_STATE_PATTERN.test(text)) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "百家号当前页面要求用户完成协议或必填状态处理");
  }

  private async hasSecurityChallenge(page: Page): Promise<boolean> {
    const text = await page.locator("body").innerText().catch(() => "");
    return SECURITY_CHALLENGE_PATTERN.test(text) || SECURITY_CHALLENGE_PATTERN.test(page.url());
  }

  private resultFromUrl(url: string): { externalId: string; publishedUrl: string } | null {
    if (!this.isPublicUrl(url)) return null;
    const parsed = new URL(url);
    const externalId = parsed.searchParams.get("id") ?? parsed.searchParams.get("articleId") ?? parsed.pathname.match(/(\d{6,})/u)?.[1] ?? null;
    return externalId ? { externalId, publishedUrl: url } : null;
  }

  private isPublicUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "baijiahao.baidu.com" && parsed.pathname !== "/";
    } catch {
      return false;
    }
  }
}
