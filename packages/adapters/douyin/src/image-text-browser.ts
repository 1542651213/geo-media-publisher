import type { Page } from "playwright-core";
import { type AccountContext, type AccountProfile, type LoginStatus,
  type PublishArticleInput, type PublishResult, type ValidationResult } from "@publisher/domain";
import { assertDouyinImageTextReadback, freezeDouyinImageText, verifyDouyinImageTextImage,
  type FrozenDouyinImageText } from "@publisher/domain/douyin-image-text";
import type { AutomationPrepareResult } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";

const creatorHome = "https://creator.douyin.com/creator-micro/home";

export function parseVisibleDouyinCreatorId(pageText: string): string | null {
  const matches = [...pageText.matchAll(/抖音号\s*[:：]?\s*(\d{5,20})/gu)].map((match) => match[1]);
  return matches.length === 1 ? matches[0] ?? null : null;
}

export interface DouyinRequiredSettingsEvidence {
  selectedLabels: readonly string[];
  scheduleControlVisible: boolean;
  requiredEmptyCount: number;
}

/** Unknown custom controls fail closed; a visible, selected public option is required. */
export function douyinRequiredSettingsPass(evidence: DouyinRequiredSettingsEvidence): boolean {
  const selected = evidence.selectedLabels.join(" ");
  return /公开|所有人可见/u.test(selected)
    && !/仅自己可见|私密|定时/u.test(selected)
    && evidence.scheduleControlVisible && evidence.requiredEmptyCount === 0;
}
const definition: BrowserPlatformDefinition = {
  platformKey: "douyin",
  displayName: "抖音图文",
  category: "图文",
  officialWebsite: "https://creator.douyin.com/",
  backendUrl: creatorHome,
  officialSources: ["https://creator.douyin.com/", "https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-image-text/create-image-text"],
  version: "0.1.0-r0",
  blockingReason: "图文 BrowserNative 尚需完整编辑器设置与管理页验收；正式提交默认关闭。",
  researchStatus: "partial",
  loginUrlPattern: /\/login(?:[/?#]|$)|passport/iu,
  capabilities: {
    article: true, imagePost: true, video: false, coverImage: false, tags: false, categories: false,
    scheduledPublish: false, draft: false, markdown: false, richText: false, maxTitleLength: 0,
    maxImageCount: 1, maxTagCount: 0, videoFormats: [], supportsVideoCover: false,
    supportsVideoTags: false, videoPublishAsync: false, contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER",
    browserManagementReconciliation: true
  }
};

/** Image/text route. The existing Douyin OAuth video adapter remains separate. */
export class DouyinImageTextBrowserAdapter extends BrowserAutomationAdapter {
  private readonly nativeSubmitEnabled: boolean;
  private readonly prepared = new Map<string, { frozen: FrozenDouyinImageText; page: Page; context: ReturnType<Page["context"]> }>();

  constructor(options: BrowserAutomationAdapterOptions & { nativeSubmitEnabled?: boolean } = {}) {
    super(definition, options);
    this.nativeSubmitEnabled = options.nativeSubmitEnabled === true;
  }

  assertFormalSubmitAvailable(): void {
    if (!this.nativeSubmitEnabled) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Douyin image-text BrowserNative formal submit is disabled");
  }

  protected override keepConnectionPageForCompletion(): boolean { return true; }
  protected override keepConnectionSessionOpenAfterCompletion(): boolean { return true; }

  /** Retain the Owner's verified canonical page for the single visible preparation task. */
  async releaseConnectionPage(_ctx: AccountContext): Promise<void> { /* retained until explicit logout or app shutdown */ }

  private async readVisibleCreatorId(page: Page): Promise<string | null> {
    if (new URL(page.url()).host !== "creator.douyin.com") return null;
    return parseVisibleDouyinCreatorId(await page.locator("body").innerText().catch(() => ""));
  }

  protected override async inspectConnectionPage(_ctx: AccountContext, page: Page): Promise<LoginStatus> {
    if (/login|passport|captcha|verify/iu.test(page.url())) return "needs_user_action";
    return await this.readVisibleCreatorId(page) ? "logged_in" : "needs_user_action";
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_CONTEXT_UNAVAILABLE");
    const creatorId = await this.readVisibleCreatorId(owned.page);
    if (!creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_STABLE_IDENTITY_NOT_VISIBLE");
    return { accountId: creatorId, accountName: ctx.accountName };
  }

  override async checkSession(ctx: AccountContext): Promise<LoginStatus> {
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context) return "needs_user_action";
    if (/login|passport|captcha|verify/iu.test(owned.page.url())) return "needs_user_action";
    const creatorId = await this.readVisibleCreatorId(owned.page);
    const expected = typeof ctx.settings.expectedCreatorId === "string" ? ctx.settings.expectedCreatorId : null;
    return creatorId && (!expected || creatorId === expected) ? "logged_in" : "needs_user_action";
  }

  override async checkLogin(ctx: AccountContext): Promise<LoginStatus> { return this.checkSession(ctx); }

  override async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!article.articleId.trim() || !article.title.trim() || !article.body.trim()) errors.push("DOUYIN_IMAGE_TEXT_REQUIRED_CONTENT");
    if (/<\/?[a-z][^>]*>/iu.test(article.title) || /<\/?[a-z][^>]*>/iu.test(article.body)) errors.push("DOUYIN_IMAGE_TEXT_PLAIN_TEXT_REQUIRED");
    if (article.images?.length !== 1 || !article.images[0]?.trim()) errors.push("DOUYIN_IMAGE_TEXT_ONE_IMAGE_REQUIRED");
    if (article.coverPath) errors.push("DOUYIN_IMAGE_TEXT_SEPARATE_COVER_UNSUPPORTED");
    if (article.tags.length > 0 || article.topic?.trim()) errors.push("DOUYIN_IMAGE_TEXT_TOPICS_UNSUPPORTED");
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("; "));
    const creatorId = typeof ctx.settings.expectedCreatorId === "string" ? ctx.settings.expectedCreatorId.trim() : "";
    if (!creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_VERIFIED_CREATOR_ID_REQUIRED");
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context || owned.session.executionMode !== "VISIBLE")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_ACTIVE_OWNED_CONTEXT_REQUIRED");
    const page = owned.page;
    if (new URL(page.url()).host !== "creator.douyin.com" || await this.readVisibleCreatorId(page) !== creatorId)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_IDENTITY_MISMATCH");
    if (new URL(page.url()).pathname !== "/creator-micro/home")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_HOME_REQUIRED_FOR_NEW_IMAGE_TEXT");
    const frozen = await freezeDouyinImageText({ articleId: article.articleId, accountId: ctx.accountId, creatorId,
      title: article.title, body: article.body, imagePaths: article.images ?? [], topics: [], visibility: "public", scheduledAt: null });
    const card = page.locator('[role="button"]').filter({ hasText: /发布图文/u });
    if (await card.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_IMAGE_TEXT_ENTRY_AMBIGUOUS");
    await page.keyboard.press("Escape");
    await card.click();
    await page.waitForURL((url) => url.origin === "https://creator.douyin.com" && url.pathname === "/creator-micro/content/upload", { timeout: 15_000 });
    const upload = page.locator('input[type="file"][accept*="image/"]');
    if (await upload.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_IMAGE_UPLOAD_CONTROL_AMBIGUOUS");
    if (!await verifyDouyinImageTextImage(frozen, 0)) throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_HASH_MISMATCH");
    await upload.setInputFiles(frozen.imagePaths[0]!);
    await page.waitForURL((url) => url.origin === "https://creator.douyin.com" && url.pathname === "/creator-micro/content/post/image", { timeout: 30_000 });
    const title = page.locator('input[placeholder="添加作品标题"]');
    const body = page.locator('[contenteditable="true"]');
    if (await title.count() !== 1 || await body.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_EDITOR_FIELDS_AMBIGUOUS");
    await title.fill(frozen.title);
    await body.fill(frozen.body);
    const titleReadback = await title.inputValue();
    const bodyReadback = await body.innerText();
    const imageCount = await page.locator('main img, [class*="upload"] img, [class*="image"] img').count();
    const finalControl = page.locator('button,[role="button"]').filter({ hasText: /^发布$/u });
    const finalCount = await finalControl.count();
    const settings = await page.evaluate(() => {
      const options = [...document.querySelectorAll<Element>('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')];
      const selectedLabels = options.filter((element) => element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true")
        .map((element) => (element.closest("label")?.textContent ?? element.parentElement?.textContent ?? "").trim().slice(0, 80));
      const visibleText = document.body?.innerText ?? "";
      const requiredEmptyCount = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[required],textarea[required]')]
        .filter((element) => element.getBoundingClientRect().width > 0 && !element.value.trim()).length;
      return { selectedLabels, scheduleControlVisible: /定时/u.test(visibleText), requiredEmptyCount };
    });
    assertDouyinImageTextReadback(frozen, { accountId: ctx.accountId, creatorId,
      contextOwned: page.context() === owned.session.context, sessionActive: !page.isClosed(),
      pageHost: new URL(page.url()).host, title: titleReadback, body: bodyReadback, imageCount,
      requiredFieldsPresent: douyinRequiredSettingsPass(settings), finalSubmitControlCount: finalCount,
      securityChallenge: /captcha|security[-_/]?check|risk[-_/]?control/iu.test(page.url()) });
    this.prepared.set(ctx.accountId, { frozen, page, context: owned.session.context });
    return { prepared: true, requiresUserAction: true, message: "Douyin image-text editor readback passed; waiting for one-shot authorization",
      sessionIdHash: owned.session.sessionIdHash, backendUrl: page.url(), editorOpenedAt: new Date().toISOString(),
      titleFilled: true, bodyFilled: true, response: { adapter: "douyin-image-text-browser", imageUploaded: true,
        contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER", imageHashes: frozen.imageHashes,
        sourceContentHash: frozen.sourceContentHash, contentBindingHash: frozen.contentBindingHash,
        expectedCreatorId: creatorId, finalSubmitCount: 0 } };
  }

  override async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("; "));
    if (ctx.settings.dryRun === true) return { success: true, dryRun: true, response: {
      adapter: "douyin-image-text-browser", stage: "local_validation_only", networkCalls: 0, finalSubmitCount: 0 } };
    throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Douyin image-text requires a persisted Prepared record and one-shot final submit boundary");
  }
}
