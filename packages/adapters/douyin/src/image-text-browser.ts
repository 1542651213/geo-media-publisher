import type { Page } from "playwright-core";
import { basename } from "node:path";
import { type AccountContext, type AccountProfile, type LoginStatus,
  type PublishArticleInput, type PublishResult, type ValidationResult } from "@publisher/domain";
import { assertDouyinImageTextReadback, freezeDouyinImageText, verifyDouyinImageTextImage,
  type FrozenDouyinImageText } from "@publisher/domain/douyin-image-text";
import type { AutomationPrepareResult } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";
import { assertDouyinEditorSettings, protectExistingDouyinDraft, verifyDouyinUploadEvidence,
  type DouyinEditorSettingsSnapshot } from "./image-text-evidence";

const creatorHome = "https://creator.douyin.com/creator-micro/home";

export function parseVisibleDouyinCreatorId(pageText: string): string | null {
  const matches = [...pageText.matchAll(/抖音号\s*[:：]?\s*(\d{5,20})/gu)].map((match) => match[1]);
  return matches.length === 1 ? matches[0] ?? null : null;
}

/** Compatibility helper for diagnostics; only selected control state can pass. */
export function douyinRequiredSettingsPass(evidence: DouyinEditorSettingsSnapshot): boolean {
  try { assertDouyinEditorSettings(evidence, "public"); return true; }
  catch { return false; }
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

  private async readEditorSettings(page: Page): Promise<DouyinEditorSettingsSnapshot> {
    return page.evaluate(() => {
      const controls = [...document.querySelectorAll<Element>('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"],[role="switch"],[aria-pressed]')]
        .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
        .map((element) => {
          const label = (element.getAttribute("aria-label") ?? element.closest("label")?.textContent ?? element.parentElement?.textContent ?? "")
            .replace(/\s+/gu, " ").trim().slice(0, 80);
          const selected = element instanceof HTMLInputElement ? element.checked
            : element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-pressed") === "true";
          const explicit = element instanceof HTMLInputElement || element.hasAttribute("aria-checked") || element.hasAttribute("aria-pressed");
          return { label, selected, explicit };
        }).filter((item) => item.label && item.explicit);
      const publicControls = controls.filter(({ label }) => /^(公开|所有人可见|公开可见)$/u.test(label));
      const privateControls = controls.filter(({ label }) => /仅自己可见|私密/u.test(label));
      const followerControls = controls.filter(({ label }) => /仅粉丝可见|粉丝可见/u.test(label));
      const immediateControls = controls.filter(({ label }) => /立即发布|立即/u.test(label));
      const scheduleControls = controls.filter(({ label }) => /定时发布|定时/u.test(label));
      const publicSelected = publicControls.length === 1 && publicControls[0]?.selected === true;
      const privateSelected = privateControls.length === 1 && privateControls[0]?.selected === true;
      const followersSelected = followerControls.length === 1 && followerControls[0]?.selected === true;
      const immediateSelected = immediateControls.length === 1 && immediateControls[0]?.selected === true;
      const scheduleOff = scheduleControls.length === 1 && scheduleControls[0]?.selected === false;
      const scheduled = scheduleControls.some((item) => item.selected);
      const visibleRequired = [...document.querySelectorAll<HTMLElement>('[required],[aria-required="true"]')]
        .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
      const requiredEmptyCount = visibleRequired.filter((element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? !element.value.trim() : element.getAttribute("aria-checked") !== "true" && !element.textContent?.trim()).length;
      const unknownMandatoryCount = visibleRequired.filter((element) => !(
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.hasAttribute("aria-checked"))).length;
      const selectedMandatory = controls.filter(({ label, selected }) => selected && !/公开|可见|私密|粉丝|立即|定时/u.test(label))
        .map(({ label }) => ({ key: label, value: "selected" }));
      return {
        visibility: publicSelected ? "public" as const : followersSelected ? "followers" as const : privateSelected ? "private" as const : "unknown" as const,
        visibilitySelected: publicSelected || privateSelected || followersSelected,
        timing: scheduled ? "scheduled" as const : immediateSelected || scheduleOff ? "immediate" as const : "unknown" as const,
        timingSelected: scheduled || immediateSelected || scheduleOff,
        requiredEmptyCount, unknownMandatoryCount, selectedMandatory
      };
    });
  }

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
    const visibility = ctx.settings.expectedVisibility;
    if (visibility !== "public") throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_OWNER_VISIBILITY_SELECTION_REQUIRED");
    protectExistingDouyinDraft(await page.locator("body").innerText());
    const source = { articleId: article.articleId, accountId: ctx.accountId, creatorId,
      title: article.title, body: article.body, imagePaths: article.images ?? [], topics: [], visibility, scheduledAt: null } as const;
    const initialFrozen = await freezeDouyinImageText(source);
    const card = page.locator('[role="button"]').filter({ hasText: /发布图文/u });
    if (await card.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_IMAGE_TEXT_ENTRY_AMBIGUOUS");
    await page.keyboard.press("Escape");
    await card.click();
    protectExistingDouyinDraft(await page.locator("body").innerText());
    await page.waitForURL((url) => url.origin === "https://creator.douyin.com" && url.pathname === "/creator-micro/content/upload", { timeout: 15_000 });
    const upload = page.locator('input[type="file"][accept*="image/"]');
    if (await upload.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_IMAGE_UPLOAD_CONTROL_AMBIGUOUS");
    const uploadArea = await upload.evaluate((element) => (element.closest("label")?.textContent ?? element.parentElement?.textContent ?? "").slice(0, 120));
    if (!/图文|图片|上传/u.test(uploadArea)) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_IMAGE_UPLOAD_AREA_UNVERIFIED");
    const previewSelector = 'main img, [class*="upload"] img, [class*="image"] img';
    const preUploadImageCount = await page.locator(previewSelector).count();
    if (!await verifyDouyinImageTextImage(initialFrozen, 0)) throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_HASH_MISMATCH");
    await upload.setInputFiles(initialFrozen.imagePaths[0]!);
    const uploadInputFileName = await upload.evaluate((element) => element instanceof HTMLInputElement ? element.files?.[0]?.name ?? null : null).catch(() => null);
    await page.waitForURL((url) => url.origin === "https://creator.douyin.com" && url.pathname === "/creator-micro/content/post/image", { timeout: 30_000 });
    const images = page.locator(previewSelector);
    await images.first().waitFor({ state: "visible", timeout: 15_000 });
    const postUploadImageCount = await images.count();
    const imageVisible = postUploadImageCount === 1 && await images.first().isVisible();
    const imageLoaded = postUploadImageCount === 1 && await images.first().evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
    const editorText = await page.locator("body").innerText();
    verifyDouyinUploadEvidence({ preUploadImageCount, postUploadImageCount, selectedFileName: basename(initialFrozen.imagePaths[0]!),
      uploadInputFileName, imageVisible, imageLoaded, processing: /上传中|处理中|正在处理/u.test(editorText),
      error: /上传失败|图片处理失败/u.test(editorText), currentEditorRoute: new URL(page.url()).pathname === "/creator-micro/content/post/image",
      contextOwned: page.context() === owned.session.context });
    const title = page.locator('input[placeholder="添加作品标题"]');
    const body = page.locator('[contenteditable="true"]');
    if (await title.count() !== 1 || await body.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_EDITOR_FIELDS_AMBIGUOUS");
    await title.fill(initialFrozen.title);
    await body.fill(initialFrozen.body);
    const titleReadback = await title.inputValue();
    const bodyReadback = await body.innerText();
    const imageCount = await images.count();
    const finalControl = page.locator('button,[role="button"]').filter({ hasText: /^发布$/u });
    const finalCount = await finalControl.count();
    const settings = await this.readEditorSettings(page);
    assertDouyinEditorSettings(settings, visibility);
    const frozen = await freezeDouyinImageText({ ...source, mandatorySelections: settings.selectedMandatory });
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
        expectedCreatorId: creatorId, settingsSnapshot: settings, mandatorySelections: settings.selectedMandatory,
        finalSubmitCount: 0 } };
  }

  override async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("; "));
    if (ctx.settings.dryRun === true) return { success: true, dryRun: true, response: {
      adapter: "douyin-image-text-browser", stage: "local_validation_only", networkCalls: 0, finalSubmitCount: 0 } };
    throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Douyin image-text requires a persisted Prepared record and one-shot final submit boundary");
  }
}
