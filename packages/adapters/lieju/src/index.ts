import { stat } from "node:fs/promises";
import { extname } from "node:path";
import type { AccountContext, AccountProfile, PublishArticleInput, PublishResult, PublishStatusResult } from "@publisher/domain";
import type { BrowserPublishAttemptContext, BrowserPublishReconciliationInput, BrowserPublishReconciliationResult, AutomationPrepareResult } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";
import type { Locator, Page } from "playwright-core";

export const LIEJU_LOGIN_URL = "https://www.lieju.com/login/";
export const LIEJU_MEMBER_URL = "https://www.lieju.com/member/";
export const LIEJU_PUBLISH_URL = "https://post.lieju.com/190/239";

const LIEJU_EDITOR_URL_PATTERN = /^https:\/\/post\.lieju\.com\/\d+\/\d+(?:[/?#]|$)/iu;
const LIEJU_PUBLIC_URL_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.)?lieju\.com\/[^?#]*\/\d+\.html(?:[?#]|$)/iu;
const LIEJU_REQUIRED_FIELDS = ["category", "location", "contact", "captcha"] as const;
type LiejuRequiredField = (typeof LIEJU_REQUIRED_FIELDS)[number];

const definition: BrowserPlatformDefinition = {
  platformKey: "lieju",
  displayName: "列举网",
  category: "分类信息/图文",
  officialWebsite: "https://www.lieju.com/",
  loginUrl: LIEJU_LOGIN_URL,
  backendUrl: LIEJU_MEMBER_URL,
  officialSources: ["https://www.lieju.com/", LIEJU_LOGIN_URL, LIEJU_PUBLISH_URL],
  version: "1.1.8",
  researchStatus: "partial",
  blockingReason: "使用用户自有账号的独立加密 Browser Session；分类、地区、联系方式、拼图/验证码和最终提交均由用户在官方页面确认。",
  loginUrlPattern: /lieju\.com\/login(?:[/?#]|$)/iu,
  capabilities: { article: true, imagePost: true, video: false, coverImage: false, tags: false, categories: true, scheduledPublish: false, draft: false, markdown: false, richText: false, maxTitleLength: 80, maxImageCount: 1, maxTagCount: 0, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false }
};

interface LiejuFieldEvidence {
  missing: LiejuRequiredField[];
  visibleSecurityChallenge: boolean;
  observed: LiejuRequiredField[];
  evidence: string;
}

interface LiejuPublishedCandidate {
  href: string;
  context: string;
}

export class LiejuBrowserAdapter extends BrowserAutomationAdapter {
  private readonly accountLocks = new Set<string>();
  private readonly publishedUrls = new Map<string, string>();

  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const opened = await this.openBackendPage(ctx, LIEJU_MEMBER_URL);
    const body = await opened.page.locator("body").innerText();
    const accountName = body.match(/用户名[：:]\s*([^\s【]+)/u)?.[1]?.trim();
    return { ...(accountName ? { accountId: accountName, accountName } : {}), authorizationStatus: "Authorized" };
  }

  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const lockKey = `${this.platformKey}:${ctx.accountId}`;
    if (this.accountLocks.has(lockKey)) throw new BrowserAutomationError("RATE_LIMITED", "同一个列举网账号已有发布准备流程正在运行");
    this.accountLocks.add(lockKey);
    try {
      const validation = await this.validateArticle(article);
      if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("；"));
      const opened = await this.openBackendPage(ctx, LIEJU_PUBLISH_URL);
      if (!LIEJU_EDITOR_URL_PATTERN.test(opened.page.url())) {
        try { await opened.page.waitForURL(LIEJU_EDITOR_URL_PATTERN, { timeout: 90_000, waitUntil: "domcontentloaded" }); }
        catch {
          return { prepared: true, requiresUserAction: true, message: "列举网分类选择页已打开。请先选择真实分类；系统未猜测分类、地区或联系方式，也未执行最终提交。", sessionIdHash: opened.session.sessionIdHash, backendUrl: opened.page.url(), titleFilled: false, bodyFilled: false, response: { adapter: this.platformKey, stage: "category_required", automationType: this.automationType, browserExecutionMode: opened.session.executionMode, headless: opened.session.headless, requiredUserFields: [...LIEJU_REQUIRED_FIELDS], finalSubmit: "user_action_required" } };
        }
      }

      const title = opened.page.locator("#atc_title");
      const body = opened.page.locator("#atc_content");
      if (await title.count() !== 1 || await body.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "列举网标题或描述输入框未找到，已停止操作");
      await title.fill(article.title);
      await body.fill(article.body);
      const titleFilled = (await title.inputValue()).trim() === article.title.trim();
      const bodyFilled = (await body.inputValue()).trim() === article.body.trim();
      if (!titleFilled || !bodyFilled) throw new BrowserAutomationError("CONTENT_REJECTED", "列举网标题或描述输入后校验不一致，已停止操作");

      let imageUploaded = false;
      const imagePath = article.images?.[0];
      if (imagePath) {
        const image = await stat(imagePath);
        const extension = extname(imagePath).toLowerCase();
        if (!image.isFile() || image.size > 1024 * 1024 || ![".jpg", ".jpeg", ".gif", ".png"].includes(extension)) throw new BrowserAutomationError("CONTENT_REJECTED", "列举网图片必须为不超过 1MB 的 jpg/gif/png 文件");
        const input = opened.page.locator("#in_url1");
        if (await input.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "列举网图片上传控件未找到，未声明图片准备成功");
        await input.setInputFiles(imagePath);
        imageUploaded = await input.evaluate((element) => (element as HTMLInputElement).files?.length === 1);
        if (!imageUploaded) throw new BrowserAutomationError("UPLOAD_FAILED", "列举网图片未通过浏览器文件选择校验");
      }

      const fieldEvidence = await this.readFieldEvidence(opened.page);
      const imageRequired = await this.isImageRequired(opened.page);
      return { prepared: true, requiresUserAction: true, message: "列举网标题和描述已填写。请本人核对分类、地区、联系方式，正常完成拼图/验证码，并决定是否最终提交。", sessionIdHash: opened.session.sessionIdHash, backendUrl: opened.page.url(), editorOpenedAt: new Date().toISOString(), titleFilled, bodyFilled, response: { adapter: this.platformKey, stage: "form_prepared", pageUrl: opened.page.url(), domEvidence: "playwright:live-lieju-form", automationType: this.automationType, browserExecutionMode: opened.session.executionMode, headless: opened.session.headless, imageUploaded, imageRequired, requiredUserFields: [...LIEJU_REQUIRED_FIELDS], fieldEvidence, finalSubmit: "user_action_required" } };
    } finally {
      this.accountLocks.delete(lockKey);
    }
  }

  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "列举网 L5 需要继续使用此前保留的可见 Browser Page；请在发布队列点击继续，不会创建第二条任务");
    const { page } = active;
    if (!LIEJU_EDITOR_URL_PATTERN.test(page.url())) throw new BrowserAutomationError("PLATFORM_CHANGED", "列举网当前页面已离开已校验编辑器，未执行最终提交");

    const fieldEvidence = await this.readFieldEvidence(page);
    if (fieldEvidence.visibleSecurityChallenge) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "CAPTCHA: 列举网要求账号所有者完成正常验证码/安全验证；系统未尝试绕过验证");
    const missingFields = fieldEvidence.missing.filter((field) => field !== "captcha");
    if (missingFields.length > 0) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `REQUIRED_FIELD_MISSING: 请在列举网官方页面完成必填字段：${missingFields.join("、")}`);
    if (fieldEvidence.missing.includes("captcha")) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "CAPTCHA: 请在列举网官方页面完成验证码或拼图验证后，再继续同一 Job");

    const title = page.locator("#atc_title");
    const body = page.locator("#atc_content");
    const titleValue = (await title.inputValue().catch(() => "")).trim();
    const bodyValue = (await body.inputValue().catch(() => "")).trim();
    if (titleValue !== article.title.trim() || !bodyValue.includes(article.body.trim())) throw new BrowserAutomationError("CONTENT_REJECTED", "列举网最终提交前的标题或正文回读与已校验内容不一致，未执行最终提交");

    const image = page.locator("#in_url1");
    if (await this.isImageRequired(page) && !(await this.hasSelectedImage(image))) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "MEDIA_REQUIRED: 列举网真实表单将图片标记为必填，请由用户选择图片后再继续同一 Job");
    const submitButton = await this.findFinalSubmitButton(page);
    const beforeUrl = page.url();
    await submitButton.click();
    try { await page.waitForURL((url) => url.toString() !== beforeUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }); } catch { /* JS submit may keep the same document; result collection below is still fail-closed. */ }
    const result = await this.readPublishedResult(page, attempt, "final_submitted");
    if (!result) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "列举网最终提交动作已执行，但 RESULT_URL_NOT_FOUND；结果不确定，禁止再次提交");
    this.publishedUrls.set(this.accountKey(ctx), result.publishedUrl as string);
    return result;
  }

  async collectPublishResult(ctx: AccountContext, _article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "列举网最终提交后已没有可读取结果的 Browser Session");
    const result = await this.readPublishedResult(active.page, attempt, "result_collected");
    if (!result) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "列举网最终提交后未取得可验证 External ID/URL，禁止再次提交");
    this.publishedUrls.set(this.accountKey(ctx), result.publishedUrl as string);
    return result;
  }

  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const externalId = result.externalId?.trim() ?? "";
    const publishedUrl = result.publishedUrl?.trim() ?? "";
    if (!externalId || !this.isPublicUrl(publishedUrl)) return { status: "failed", externalId: externalId || undefined, publishedUrl: publishedUrl || undefined, response: { titleMatch: false, urlReachable: false }, errorCode: "EXTERNAL_EVIDENCE_INCOMPLETE", errorMessage: "列举网发布结果缺少可验证 External ID 或 External URL" };
    const active = await this.activeBackendPage(ctx);
    if (!active) return { status: "failed", externalId, publishedUrl, response: { titleMatch: false, urlReachable: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "列举网发布结果验证需要可见 Browser Session" };
    try {
      await active.page.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const currentUrl = this.normalizePublicUrl(active.page.url());
      const heading = (await active.page.locator("h1").first().innerText().catch(() => "")).trim();
      const pageText = await active.page.locator("body").innerText().catch(() => "");
      const titleMatch = heading === article.title.trim() || (heading.length === 0 && pageText.includes(article.title.trim()));
      const urlReachable = currentUrl === publishedUrl || currentUrl === this.normalizePublicUrl(publishedUrl);
      if (!urlReachable || !titleMatch) return { status: "failed", externalId, publishedUrl: currentUrl ?? active.page.url(), response: { titleMatch, urlReachable, heading }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "列举网文章 URL 可导航，但标题回读或最终 URL 校验未通过" };
      return { status: "published", externalId, publishedUrl: currentUrl ?? publishedUrl, response: { titleMatch: true, urlReachable: true, heading, accountMatch: "authenticated_session" } };
    } catch (error) {
      return { status: "failed", externalId, publishedUrl, response: { titleMatch: false, urlReachable: false }, errorCode: "NETWORK_ERROR", errorMessage: error instanceof Error ? error.message : "列举网文章 URL 不可访问" };
    }
  }

  async getPublishStatus(ctx: AccountContext, externalId: string): Promise<PublishStatusResult> {
    const publishedUrl = this.publishedUrls.get(this.accountKey(ctx));
    if (!publishedUrl || this.externalIdFromUrl(publishedUrl) !== externalId.trim()) return { status: "failed", externalId, response: { statusLookup: "url_not_retained" }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "列举网状态回查缺少本次已验证 External URL；未猜测 URL" };
    const active = await this.activeBackendPage(ctx);
    if (!active) return { status: "failed", externalId, publishedUrl, response: { statusLookup: "browser_session_missing" }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "列举网状态回查需要可见 Browser Session" };
    try {
      await active.page.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const reachable = this.isPublicUrl(active.page.url());
      return reachable ? { status: "published", externalId, publishedUrl: this.normalizePublicUrl(active.page.url()) ?? publishedUrl, response: { statusLookup: "public_url_reachable" } } : { status: "failed", externalId, publishedUrl, response: { statusLookup: "unexpected_url", pageUrl: active.page.url() }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "列举网状态回查导航到了非公开信息 URL" };
    } catch (error) {
      return { status: "failed", externalId, publishedUrl, response: { statusLookup: "navigation_failed" }, errorCode: "NETWORK_ERROR", errorMessage: error instanceof Error ? error.message : "列举网状态回查失败" };
    }
  }

  async reconcile(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult> {
    const opened = await this.openBackendPage(ctx, LIEJU_MEMBER_URL);
    const candidates = await this.readPublishedCandidates(opened.page, input.title);
    const candidate = candidates.find((item) => item.context.includes(input.title));
    if (!candidate) return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: true, timeWindowMatch: false, response: { pageUrl: opened.page.url(), matchedBy: "no_exact_title" }, message: "列举网当前账号后台未取得足够完整的标题、账号和时间窗口证据，保持 NeedsReconciliation" };
    const publishedUrl = this.normalizePublicUrl(candidate.href);
    const externalId = publishedUrl ? this.externalIdFromUrl(publishedUrl) : null;
    const timeWindowMatch = /刚刚|分钟前|今天|昨天|\d{4}[年/-]/u.test(candidate.context);
    if (externalId && publishedUrl && timeWindowMatch) return { status: "FOUND_PUBLISHED", externalId, publishedUrl, titleMatch: true, accountMatch: true, timeWindowMatch: true, response: { pageUrl: opened.page.url(), matchedBy: "exact_title_authenticated_member_page", candidateContext: candidate.context.slice(0, 1_000) }, message: "列举网当前账号后台找到标题、公开 URL 和时间窗口均匹配的真实信息" };
    return { status: "STILL_UNCERTAIN", externalId: externalId ?? undefined, publishedUrl: publishedUrl ?? undefined, titleMatch: true, accountMatch: true, timeWindowMatch, response: { pageUrl: opened.page.url(), matchedBy: "exact_title_without_complete_external_evidence", candidateContext: candidate.context.slice(0, 1_000) }, message: "列举网后台找到同名候选，但 External URL 或时间窗口证据不完整" };
  }

  private async readFieldEvidence(page: Page): Promise<LiejuFieldEvidence> {
    const candidate = page as unknown as { evaluate?: <T>(pageFunction: () => T) => Promise<T> };
    if (typeof candidate.evaluate !== "function") return { missing: [...LIEJU_REQUIRED_FIELDS], visibleSecurityChallenge: false, observed: [], evidence: "page-evaluate-unavailable" };
    return candidate.evaluate(() => {
      const visible = (element: Element): boolean => {
        const target = element as HTMLElement;
        const style = window.getComputedStyle(target);
        const bounds = target.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      };
      const labelFor = (element: Element): string => {
        const input = element as HTMLInputElement;
        const id = input.id;
        const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? "" : "";
        const parent = element.closest("label")?.textContent ?? element.parentElement?.textContent ?? "";
        return `${input.name ?? ""} ${id} ${input.getAttribute("placeholder") ?? ""} ${input.getAttribute("aria-label") ?? ""} ${input.getAttribute("title") ?? ""} ${explicit} ${parent}`.replace(/\s+/gu, " ").trim().slice(0, 400);
      };
      const classify = (raw: string): LiejuRequiredField | null => {
        if (/验证码|captcha|human.?check/iu.test(raw)) return "captcha";
        if (/分类|category/iu.test(raw)) return "category";
        if (/地区|区域|城市|位置|省|市|区|location|region|city|area/iu.test(raw)) return "location";
        if (/联系人|联系方式|联系电话|手机|电话|contact|phone|mobile|tel/iu.test(raw)) return "contact";
        return null;
      };
      const missing = new Set<LiejuRequiredField>();
      const observed = new Set<LiejuRequiredField>();
      for (const element of Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea"))) {
        if (!visible(element) || element.type === "hidden") continue;
        const raw = labelFor(element);
        const key = classify(raw);
        if (!key) continue;
        observed.add(key);
        const value = element instanceof HTMLSelectElement ? `${element.value} ${element.selectedOptions[0]?.textContent ?? ""}` : element.value;
        if (!value.trim() || /^(0|-1|null|undefined|请选择|请选择地区|请选择分类)/iu.test(value.trim())) missing.add(key);
      }
      const pageText = document.body?.innerText ?? "";
      const visibleSecurityChallenge = Array.from(document.querySelectorAll("[id*='captcha' i],[class*='captcha' i],[id*='security' i],[class*='security' i],iframe[src*='captcha' i]")).some(visible)
        || /请.{0,20}(完成|通过).{0,20}(验证|验证码|人机)|拖动.{0,12}拼图|安全验证/iu.test(pageText);
      if (visibleSecurityChallenge) missing.add("captcha");
      return { missing: Array.from(missing), visibleSecurityChallenge, observed: Array.from(observed), evidence: `fields:${Array.from(observed).join(",") || "none"};missing:${Array.from(missing).join(",") || "none"};security:${visibleSecurityChallenge}` };
    });
  }

  private async isImageRequired(page: Page): Promise<boolean> {
    const input = page.locator("#in_url1");
    if (await input.count() !== 1) return false;
    const candidate = input as unknown as { getAttribute?: (name: string) => Promise<string | null> };
    if (typeof candidate.getAttribute !== "function") return false;
    return (await candidate.getAttribute("required").catch(() => null)) !== null || (await candidate.getAttribute("aria-required").catch(() => null)) === "true";
  }

  private async hasSelectedImage(input: Locator): Promise<boolean> {
    return input.evaluate((element) => (element as HTMLInputElement).files?.length === 1).catch(() => false);
  }

  private async findFinalSubmitButton(page: Page): Promise<Locator> {
    const candidates = page.locator('button, input[type="submit"], [role="button"]');
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false)) || !(await candidate.isEnabled().catch(() => false))) continue;
      const label = `${await candidate.innerText().catch(() => "")} ${await candidate.getAttribute("value").catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")} ${await candidate.getAttribute("title").catch(() => "")}`.trim();
      if (/(发布|提交|立即发布|免费发布|确认发布)/u.test(label) && !/保存|草稿|预览|取消/iu.test(label)) return candidate;
    }
    throw new BrowserAutomationError("PLATFORM_CHANGED", "列举网最终提交按钮未在已校验编辑器中出现，未执行点击");
  }

  private async readPublishedResult(page: Page, attempt: BrowserPublishAttemptContext, stage: string): Promise<PublishResult | null> {
    const publishedUrl = (await this.readPublishedCandidates(page, "")).map((item) => this.normalizePublicUrl(item.href)).find((url): url is string => Boolean(url)) ?? this.normalizePublicUrl(page.url());
    if (!publishedUrl) return null;
    const externalId = this.externalIdFromUrl(publishedUrl);
    if (!externalId) return null;
    return { success: true, status: "published", externalId, publishedUrl, response: { adapter: this.platformKey, stage, submissionIntentId: attempt.submissionIntentId, finalSubmitCount: 1, browserSessionIdHash: this.sessionHashForResult(page), resultUrlEvidence: "playwright:page.url-or-public-anchor", titleMatchPendingVerification: true } };
  }

  private async readPublishedCandidates(page: Page, expectedTitle: string): Promise<LiejuPublishedCandidate[]> {
    const candidate = page as unknown as { evaluate?: <T, A>(pageFunction: (arg: A) => T, arg: A) => Promise<T> };
    if (typeof candidate.evaluate !== "function") return [];
    return candidate.evaluate(({ title }) => Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((anchor) => ({ href: anchor.href, context: (anchor.parentElement?.parentElement?.innerText ?? anchor.innerText ?? "").replace(/\s+/gu, " ").trim() }))
      .filter((item) => /^https:\/\/(?:[a-z0-9-]+\.)?lieju\.com\/[^?#]*\/\d+\.html(?:[?#]|$)/iu.test(item.href) && (!title || item.context.includes(title))).slice(0, 20), { title: expectedTitle });
  }

  private normalizePublicUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!LIEJU_PUBLIC_URL_PATTERN.test(parsed.href)) return null;
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    } catch { return null; }
  }

  private isPublicUrl(url: string): boolean { return this.normalizePublicUrl(url) !== null; }

  private externalIdFromUrl(url: string): string | null {
    const match = /\/(\d+)\.html(?:[?#]|$)/iu.exec(url);
    return match?.[1] ?? null;
  }

  private accountKey(ctx: AccountContext): string { return `${this.platformKey}:${ctx.accountId}`; }

  private sessionHashForResult(page: Page): string {
    return `page:${page.url().split("?", 1)[0]}`;
  }
}

export default LiejuBrowserAdapter;
