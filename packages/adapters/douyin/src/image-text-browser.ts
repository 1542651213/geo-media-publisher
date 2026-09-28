import type { CDPSession, Locator, Page } from "playwright-core";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { type AccountContext, type AccountProfile, type LoginStatus,
  type PublishArticleInput, type PublishResult, type PublishStatusResult, type ValidationResult } from "@publisher/domain";
import { assertDouyinImageTextReadback, freezeDouyinImageText, verifyDouyinImageTextImage,
  type FrozenDouyinImageText, type DouyinMusicBinding } from "@publisher/domain/douyin-image-text";
import type { AutomationPrepareResult, BrowserPublishAttemptContext, BrowserPublishReconciliationInput, BrowserPublishReconciliationResult } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";
import { assertDouyinEditorSettings, protectExistingDouyinDraft,
  matchDouyinManagementRows, type DouyinEditorSettingsSnapshot, type DouyinManagementRow } from "./image-text-evidence";
import { DouyinImagePostObserver } from "./image-text-observer";
import { observeDouyinImageEditor, selectAndObserveDouyinImage } from "./image-text-upload";
import { inspectDouyinManagementControls, inspectDouyinManagementReadOnlyNavigation } from "./image-text-management-preflight";
import { inspectDouyinBodyPage, type DouyinBodyPageDiagnostic } from "./image-text-body-diagnostic";
import { readDouyinBodyText, type DouyinBodyReadback } from "./image-text-body-readback";
import { assertDouyinMusicReadback, chooseDouyinMusic, clickRecommendedDouyinMusicOnce, douyinMusicDrawerRows, douyinMusicIdentityKey,
  inspectRecommendedDouyinMusic, readSelectedDouyinMusic, type DouyinMusicIdentity, type DouyinMusicReadback } from "./image-text-music";
import { DouyinPreMusicInvariantError, hashDouyinPreMusicEditorObservation, inspectDouyinPreMusicReadOnly,
  type DouyinPreMusicBinding } from "./image-text-pre-music";
export { selectAndObserveDouyinImage } from "./image-text-upload";

const creatorHome = "https://creator.douyin.com/creator-micro/home";
const creatorLocationPermissionSessions = new WeakMap<Page, CDPSession>();

function requestedDouyinMusicMode(value: unknown): "NONE" | "AUTO_RECOMMENDED" {
  if (value === undefined || value === null || value === "NONE") return "NONE";
  if (value === "AUTO_RECOMMENDED") return "AUTO_RECOMMENDED";
  throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_MUSIC_POLICY_INVALID");
}

export function parseVisibleDouyinCreatorId(pageText: string): string | null {
  const matches = [...pageText.matchAll(/抖音号\s*[:：]?\s*(\d{5,20})/gu)].map((match) => match[1]);
  return matches.length === 1 ? matches[0] ?? null : null;
}

/** The known Creator welcome tour covers the home cards; skipping it only closes onboarding UI. */
export async function dismissKnownDouyinHomeTour(page: Page): Promise<boolean> {
  const welcome = page.getByText("欢迎体验新版首页", { exact: false });
  if (await welcome.count() !== 1 || !await welcome.isVisible()) return false;
  const skip = page.getByText("跳过", { exact: true });
  if (await skip.count() !== 1 || !await skip.isVisible())
    throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_HOME_TOUR_SKIP_AMBIGUOUS");
  await skip.click();
  await welcome.waitFor({ state: "hidden", timeout: 5_000 });
  return true;
}

/** URL transition can precede upload form hydration; wait for the exact image input. */
export async function waitForUniqueDouyinImageInput(page: Page): Promise<Locator> {
  const upload = page.locator('input[type="file"][accept*="image/"]');
  await upload.first().waitFor({ state: "attached", timeout: 15_000 });
  if (await upload.count() !== 1)
    throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_IMAGE_UPLOAD_CONTROL_AMBIGUOUS");
  return upload;
}

/** Deny only the optional location prompt for a no-location image post. */
export async function denyOptionalDouyinLocation(page: Page): Promise<void> {
  if (new URL(page.url()).origin !== "https://creator.douyin.com")
    throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_ORIGIN_REQUIRED_FOR_PERMISSION");
  const existing = creatorLocationPermissionSessions.get(page);
  if (existing && await page.evaluate(async () => (await navigator.permissions.query({ name: "geolocation" })).state) === "denied") return;
  creatorLocationPermissionSessions.delete(page);
  const session = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await session.send("Target.getTargetInfo");
    const browserContextId = targetInfo.browserContextId;
    if (!browserContextId)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_OWNED_BROWSER_CONTEXT_ID_MISSING");
    await session.send("Browser.setPermission", { permission: { name: "geolocation" }, setting: "denied",
      origin: "https://creator.douyin.com", browserContextId });
    const state = await page.evaluate(async () => (await navigator.permissions.query({ name: "geolocation" })).state);
    if (state !== "denied") throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_LOCATION_PERMISSION_NOT_DENIED");
    // Chromium removes this override when its CDP session detaches. Keep it for this owned Page's lifetime.
    creatorLocationPermissionSessions.set(page, session);
  } catch (error) {
    await session.detach().catch(() => undefined);
    throw error;
  }
}

export function isAuthorizedDouyinDraftResume(target: { accountId: string; articleId: string; pagePath: string;
  title: string; body: string; imageCount: number },
  approved: { accountId: string; articleId: string; title: string; body: string } | null): boolean {
  return approved?.accountId === target.accountId && approved.articleId === target.articleId
    && target.pagePath === "/creator-micro/content/post/image" && target.imageCount === 1
    && Boolean(approved.title.trim() && approved.body.trim())
    && target.title === approved.title && target.body === approved.body;
}

type DouyinUploadOperation = { accountId: string; articleId: string; jobId: string; operationId: string;
  page: Page; context: ReturnType<Page["context"]>; sessionIdHash: string; loginGeneration: number;
  sourceContentHash: string; imageSha256: string; selectionStatus: "DISPATCHED" | "RETURNED" | "THREW";
  preUploadImageCount: number; inputDetached: boolean; inputFileName: string | null; previewDigest?: string };

/** A blank editor may continue only inside the same, successfully returned file-choice operation. */
type ComparableDouyinUploadOperation = Pick<DouyinUploadOperation,
  "accountId" | "articleId" | "jobId" | "operationId" | "sessionIdHash"
  | "loginGeneration" | "sourceContentHash" | "imageSha256" | "selectionStatus" | "previewDigest"> &
  { page: object; context: object };
export function isSameDouyinUploadOperation(attempt: ComparableDouyinUploadOperation,
  current: Omit<ComparableDouyinUploadOperation, "selectionStatus"> & { pagePath: string; title: string; body: string }): boolean {
  return attempt.selectionStatus === "RETURNED" && /^[a-f0-9]{64}$/u.test(attempt.previewDigest ?? "")
    && current.pagePath === "/creator-micro/content/post/image"
    && attempt.accountId === current.accountId && attempt.articleId === current.articleId
    && attempt.jobId === current.jobId && attempt.operationId === current.operationId
    && attempt.page === current.page && attempt.context === current.context
    && attempt.sessionIdHash === current.sessionIdHash && attempt.loginGeneration === current.loginGeneration
    && attempt.sourceContentHash === current.sourceContentHash && attempt.imageSha256 === current.imageSha256;
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
  private readonly approvedResume: { accountId: string; articleId: string } | null;
  private readonly prepared = new Map<string, { frozen: FrozenDouyinImageText; page: Page; context: ReturnType<Page["context"]>;
    settings: DouyinEditorSettingsSnapshot; previewDigest: string | null; musicModeRequested: "NONE" | "AUTO_RECOMMENDED" }>();
  private readonly uploadOperations = new Map<string, DouyinUploadOperation>();
  private readonly claimFileSelection?: (input: { jobId: string; accountId: string; articleId: string;
    loginGeneration: number; sessionIdHash: string; imageSha256: string; sourceContentHash: string }) =>
    { operationId: string; stage: "FILE_SELECTION_DISPATCHED"; newlyClaimed: boolean };
  private readonly finalSubmitUsed = new Set<string>();
  private readonly musicSelectionUsed = new Set<string>();
  private readonly verifiedIdentity = new Map<string, { page: Page; context: ReturnType<Page["context"]>; sessionIdHash: string; creatorId: string; verifiedAt: number }>();

  constructor(options: BrowserAutomationAdapterOptions & { nativeSubmitEnabled?: boolean;
    approvedResume?: { accountId: string; articleId: string } | null;
    claimFileSelection?: DouyinImageTextBrowserAdapter["claimFileSelection"] } = {}) {
    super(definition, options);
    this.nativeSubmitEnabled = options.nativeSubmitEnabled === true;
    this.approvedResume = options.approvedResume ?? null;
    this.claimFileSelection = options.claimFileSelection;
  }

  assertFormalSubmitAvailable(): void {
    if (!this.nativeSubmitEnabled) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Douyin image-text BrowserNative formal submit is disabled");
  }

  protected override keepConnectionPageForCompletion(): boolean { return true; }
  protected override keepConnectionSessionOpenAfterCompletion(): boolean { return true; }

  /** Retain the Owner's verified canonical page for the single visible preparation task. */
  async releaseConnectionPage(_ctx: AccountContext): Promise<void> { /* retained until explicit logout or app shutdown */ }

  /** Restores only this account's encrypted BrowserSession; a hidden identity stays unverified. */
  async activateStoredCreatorSession(ctx: AccountContext): Promise<{ status: "ACTIVE" | "WAITING_FOR_OWNER" | "IDENTITY_MISMATCH"; creatorId: string | null; pageHost: string | null; sessionIdHash: string | null }> {
    const expected = typeof ctx.settings.expectedCreatorId === "string" ? ctx.settings.expectedCreatorId.trim() : "";
    if (!expected) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_BINDING_REQUIRED");
    const existing = await this.activeCanonicalPage(ctx);
    if (!existing) await this.openBackend(ctx);
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context || owned.session.executionMode !== "VISIBLE")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_ACTIVE_OWNED_CONTEXT_REQUIRED");
    const pageHost = new URL(owned.page.url()).host;
    if (pageHost !== "creator.douyin.com" || /login|passport|captcha|verify/iu.test(owned.page.url()))
      return { status: "WAITING_FOR_OWNER", creatorId: null, pageHost, sessionIdHash: owned.session.sessionIdHash };
    const creatorId = await this.readOwnedCreatorId(ctx, owned);
    return { status: !creatorId ? "WAITING_FOR_OWNER" : creatorId === expected ? "ACTIVE" : "IDENTITY_MISMATCH",
      creatorId, pageHost, sessionIdHash: owned.session.sessionIdHash };
  }

  /** Reports the actual account-owned BrowserSession and canonical Page without opening a new Context. */
  async inspectOwnedCreatorReadiness(ctx: AccountContext): Promise<ReturnType<DouyinImageTextBrowserAdapter["getBrowserRuntimeSnapshot"]> &
    { canonicalPageUrl: string | null; creatorId: string | null; identityVerified: boolean;
      contextOwnership: boolean; loginGeneration: number | null }> {
    const snapshot = this.getBrowserRuntimeSnapshot(ctx);
    const owned = await this.activeCanonicalPage(ctx);
    const contextOwnership = Boolean(owned && !owned.page.isClosed() && owned.page.context() === owned.session.context
      && owned.session.context.pages().includes(owned.page));
    const pageUrl = contextOwnership ? new URL(owned!.page.url()) : null;
    const creatorId = contextOwnership && pageUrl?.origin === "https://creator.douyin.com"
      ? await this.readOwnedCreatorId(ctx, owned!) : null;
    const expected = typeof ctx.settings.expectedCreatorId === "string" ? ctx.settings.expectedCreatorId : null;
    return { ...snapshot, canonicalPageUrl: pageUrl ? `${pageUrl.origin}${pageUrl.pathname}` : null,
      creatorId, identityVerified: Boolean(creatorId && expected && creatorId === expected), contextOwnership,
      loginGeneration: typeof ctx.settings.expectedLoginGeneration === "number" ? ctx.settings.expectedLoginGeneration : null };
  }

  /** GET-only smoke on the same Page; refuses to navigate away from an editor. */
  async preflightManagementReadOnly(ctx: AccountContext): Promise<Awaited<ReturnType<typeof inspectDouyinManagementReadOnlyNavigation>> &
    { creatorId: string; sessionIdHash: string; contextOwnership: true }> {
    const readiness = await this.inspectOwnedCreatorReadiness(ctx);
    if (!readiness.sessionExists || !readiness.contextOwnership || !readiness.identityVerified
      || !readiness.canonicalPageExists || readiness.canonicalPageClosed || !readiness.browserConnected)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_APP_OWNED_CREATOR_NOT_READY");
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_APP_OWNED_PAGE_MISSING");
    const expectedCreatorId = readiness.creatorId!;
    const result = await inspectDouyinManagementReadOnlyNavigation(owned.page, owned.session.context,
      async () => await this.readOwnedCreatorId(ctx, owned) === expectedCreatorId);
    return { ...result, creatorId: expectedCreatorId,
      sessionIdHash: owned.session.sessionIdHash, contextOwnership: true };
  }

  async inspectCurrentManagementPage(ctx: AccountContext): Promise<{ ready: boolean; creatorId: string | null; pageHost: string | null;
    pagePath: string | null; searchControlCount: number; stateLabels: string[]; visibleRowCount: number }> {
    const owned = await this.activeCanonicalPage(ctx);
    const empty = { ready: false, creatorId: null, pageHost: null, pagePath: null, searchControlCount: 0,
      stateLabels: [] as string[], visibleRowCount: 0 };
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context || owned.session.executionMode !== "VISIBLE") return empty;
    const url = new URL(owned.page.url());
    const creatorId = await this.readOwnedCreatorId(ctx, owned);
    if (url.host !== "creator.douyin.com" || url.pathname !== "/creator-micro/content/manage"
      || !creatorId || creatorId !== ctx.settings.expectedCreatorId) return { ...empty, creatorId, pageHost: url.host, pagePath: url.pathname };
    const pageEvidence = await owned.page.evaluate(() => {
      const text = document.body.innerText;
      const labels = ["已发布", "审核中", "未通过"].filter((label) => text.includes(label));
      const searchControlCount = document.querySelectorAll('input[placeholder="搜索作品"]').length;
      const visibleRowCount = [...document.querySelectorAll('a[href*="/video/"],a[href*="/note/"]')]
        .filter((link) => link.getBoundingClientRect().width > 0).length;
      return { labels, searchControlCount, visibleRowCount };
    });
    return { ready: pageEvidence.searchControlCount === 1 && pageEvidence.labels.length >= 1,
      creatorId, pageHost: url.host, pagePath: url.pathname, searchControlCount: pageEvidence.searchControlCount,
      stateLabels: pageEvidence.labels, visibleRowCount: pageEvidence.visibleRowCount };
  }

  /** Safe read-only evidence for this owned image editor; never returns text, cookies or signed URLs. */
  async inspectCurrentImageEditor(ctx: AccountContext): Promise<{ pagePath: string | null; creatorId: string | null;
    imageCount: number; imageLoaded: boolean; titleLength: number; bodyLength: number;
    settings: DouyinEditorSettingsSnapshot | null;
    controls: Array<{ label: string; tag: string; type: string | null; role: string | null;
      checked: boolean | null; ariaChecked: string | null; className: string; parentClassName: string }> }> {
    const empty = { pagePath: null, creatorId: null, imageCount: 0, imageLoaded: false, titleLength: 0,
      bodyLength: 0, settings: null, controls: [] };
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context || owned.session.executionMode !== "VISIBLE") return empty;
    const page = owned.page;
    const url = new URL(page.url());
    const creatorId = await this.readOwnedCreatorId(ctx, owned);
    if (url.host !== "creator.douyin.com" || url.pathname !== "/creator-micro/content/post/image"
      || creatorId !== ctx.settings.expectedCreatorId) return { ...empty, pagePath: url.pathname, creatorId };
    const dom = await page.evaluate(() => {
      const images = [...document.querySelectorAll<HTMLImageElement>('main img, [class*="upload"] img, [class*="image"] img')];
      const inputControls = [...document.querySelectorAll<Element>('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"],[role="switch"],[aria-pressed]')]
        .map((element) => {
          const label = (element.getAttribute("aria-label") ?? element.closest("label")?.textContent ?? element.parentElement?.textContent ?? "")
            .replace(/\s+/gu, " ").trim().slice(0, 80);
          return { label, tag: element.tagName.toLowerCase(), type: element.getAttribute("type"), role: element.getAttribute("role"),
            checked: element instanceof HTMLInputElement ? element.checked : null, ariaChecked: element.getAttribute("aria-checked"),
            className: String(element.className).slice(0, 120), parentClassName: String(element.parentElement?.className ?? "").slice(0, 120) };
        }).filter((control) => /公开|可见|私密|允许|立即|定时|声明/u.test(control.label));
      const visibleLabels = [...document.querySelectorAll<HTMLElement>('span,label,button,div')]
        .filter((element) => /^(公开|好友可见|仅自己可见|允许|不允许|立即发布|定时发布)$/u.test(element.textContent?.trim() ?? "")
          && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
        .map((element) => ({ label: element.textContent!.trim(), tag: element.tagName.toLowerCase(), type: null, role: element.getAttribute("role"),
          checked: null, ariaChecked: element.getAttribute("aria-checked") ?? element.parentElement?.getAttribute("aria-checked") ?? null,
          className: String(element.className).slice(0, 120), parentClassName: String(element.parentElement?.className ?? "").slice(0, 120) }));
      const controls = [...inputControls, ...visibleLabels].slice(0, 40);
      return { imageCount: images.length, imageLoaded: images.length === 1 && images[0]!.complete && images[0]!.naturalWidth > 0,
        titleLength: document.querySelector<HTMLInputElement>('input[placeholder="添加作品标题"]')?.value.length ?? 0,
        bodyLength: document.querySelector<HTMLElement>('[contenteditable="true"]')?.innerText.length ?? 0, controls };
    });
    return { pagePath: url.pathname, creatorId, ...dom, settings: await this.readEditorSettings(page) };
  }

  /** Main-only, read-only diagnosis of the exact existing image-post editor. Continuity is not renewed remote identity. */
  async inspectCurrentImageTextBodyReadOnly(ctx: AccountContext, binding: {
    accountId: string; articleId: string; jobId: string; creatorId: string; loginGeneration: number;
    sessionIdHash: string; operationId: string; imageSha256: string
  }, expectedBody: string): Promise<{ identityVerificationMode: "VISIBLE_CREATOR_ID" | "CONTINUITY_EVIDENCE";
    identityVerified: boolean; identityEvidence: { creatorBindingId: string; sessionHashMatchesSelection: true;
      loginGenerationMatchesSelection: true; contextOwnership: true; pagePath: string };
    accountId: string; articleId: string; jobId: string; operationId: string; body: DouyinBodyPageDiagnostic }> {
    if (ctx.platformKey !== "douyin" || ctx.accountId !== binding.accountId)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_BODY_DIAGNOSTIC_ACCOUNT_MISMATCH");
    if (!binding.articleId || !binding.jobId || !binding.operationId || !/^[a-f0-9]{64}$/u.test(binding.imageSha256)
      || !expectedBody || ctx.settings.expectedCreatorId !== binding.creatorId)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_BODY_DIAGNOSTIC_BINDING_MISSING");
    if (ctx.settings.expectedLoginGeneration !== binding.loginGeneration)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_BODY_DIAGNOSTIC_GENERATION_MISMATCH");
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.session.executionMode !== "VISIBLE"
      || owned.page.context() !== owned.session.context || !owned.session.context.pages().includes(owned.page))
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_BODY_DIAGNOSTIC_CONTEXT_MISMATCH");
    if (owned.session.sessionIdHash !== binding.sessionIdHash)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_BODY_DIAGNOSTIC_SESSION_MISMATCH");
    const pageUrl = new URL(owned.page.url());
    if (pageUrl.origin !== "https://creator.douyin.com" || pageUrl.pathname !== "/creator-micro/content/post/image")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_BODY_DIAGNOSTIC_EDITOR_ROUTE_REQUIRED");
    const visibleCreatorId = await this.readVisibleCreatorId(owned.page);
    if (visibleCreatorId && visibleCreatorId !== binding.creatorId)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_BODY_DIAGNOSTIC_CREATOR_MISMATCH");
    const body = await inspectDouyinBodyPage(owned.page, expectedBody);
    return { identityVerificationMode: visibleCreatorId ? "VISIBLE_CREATOR_ID" : "CONTINUITY_EVIDENCE",
      identityVerified: Boolean(visibleCreatorId),
      identityEvidence: { creatorBindingId: binding.creatorId, sessionHashMatchesSelection: true,
        loginGenerationMatchesSelection: true, contextOwnership: true, pagePath: pageUrl.pathname },
      accountId: ctx.accountId, articleId: binding.articleId, jobId: binding.jobId, operationId: binding.operationId, body };
  }

  /** Main's opt-in diagnostic reads only the owned image editor; it never opens the music drawer. */
  async inspectCurrentImageTextMusicReadOnly(ctx: AccountContext, binding: {
    accountId: string; articleId: string; jobId: string; creatorId: string;
    loginGeneration: number; sessionIdHash: string
  }): Promise<{ identityVerificationMode: "VISIBLE_CREATOR_ID" | "CONTINUITY_EVIDENCE";
    identityVerified: boolean; accountId: string; articleId: string; jobId: string;
    pagePath: string; contextOwnership: true; music: DouyinMusicReadback }> {
    if (ctx.platformKey !== "douyin" || ctx.accountId !== binding.accountId
      || ctx.settings.expectedCreatorId !== binding.creatorId
      || ctx.settings.expectedLoginGeneration !== binding.loginGeneration)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_MUSIC_DIAGNOSTIC_BINDING_MISMATCH");
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.session.executionMode !== "VISIBLE"
      || owned.page.context() !== owned.session.context || !owned.session.context.pages().includes(owned.page)
      || owned.session.sessionIdHash !== binding.sessionIdHash)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_MUSIC_DIAGNOSTIC_CONTEXT_MISMATCH");
    const pageUrl = new URL(owned.page.url());
    if (pageUrl.origin !== "https://creator.douyin.com" || pageUrl.pathname !== "/creator-micro/content/post/image")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_MUSIC_DIAGNOSTIC_EDITOR_ROUTE_REQUIRED");
    const visibleCreatorId = await this.readVisibleCreatorId(owned.page);
    if (visibleCreatorId && visibleCreatorId !== binding.creatorId)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_MUSIC_DIAGNOSTIC_CREATOR_MISMATCH");
    return { identityVerificationMode: visibleCreatorId ? "VISIBLE_CREATOR_ID" : "CONTINUITY_EVIDENCE",
      identityVerified: Boolean(visibleCreatorId), accountId: binding.accountId, articleId: binding.articleId,
      jobId: binding.jobId, pagePath: pageUrl.pathname, contextOwnership: true,
      music: await readSelectedDouyinMusic(owned.page) };
  }

  private async readVisibleCreatorId(page: Page): Promise<string | null> {
    if (new URL(page.url()).host !== "creator.douyin.com") return null;
    return parseVisibleDouyinCreatorId(await page.locator("body").innerText().catch(() => ""));
  }

  private async readOwnedCreatorId(ctx: AccountContext, owned: NonNullable<Awaited<ReturnType<DouyinImageTextBrowserAdapter["activeCanonicalPage"]>>>): Promise<string | null> {
    if (owned.page.isClosed() || owned.page.context() !== owned.session.context || new URL(owned.page.url()).host !== "creator.douyin.com"
      || /login|passport|captcha|verify/iu.test(owned.page.url())) { this.verifiedIdentity.delete(ctx.accountId); return null; }
    const visible = await this.readVisibleCreatorId(owned.page);
    if (visible) {
      this.verifiedIdentity.set(ctx.accountId, { page: owned.page, context: owned.session.context,
        sessionIdHash: owned.session.sessionIdHash, creatorId: visible, verifiedAt: Date.now() });
      return visible;
    }
    const previous = this.verifiedIdentity.get(ctx.accountId);
    return previous && previous.page === owned.page && previous.context === owned.session.context
      && previous.sessionIdHash === owned.session.sessionIdHash && Date.now() - previous.verifiedAt < 15 * 60_000
      ? previous.creatorId : null;
  }

  protected override async inspectConnectionPage(_ctx: AccountContext, page: Page): Promise<LoginStatus> {
    if (/login|passport|captcha|verify/iu.test(page.url())) return "needs_user_action";
    return await this.readVisibleCreatorId(page) ? "logged_in" : "needs_user_action";
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_CONTEXT_UNAVAILABLE");
    const creatorId = await this.readOwnedCreatorId(ctx, owned);
    if (!creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_STABLE_IDENTITY_NOT_VISIBLE");
    return { accountId: creatorId, accountName: ctx.accountName };
  }

  override async checkSession(ctx: AccountContext): Promise<LoginStatus> {
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context) return "needs_user_action";
    if (/login|passport|captcha|verify/iu.test(owned.page.url())) return "needs_user_action";
    const creatorId = await this.readOwnedCreatorId(ctx, owned);
    const expected = typeof ctx.settings.expectedCreatorId === "string" ? ctx.settings.expectedCreatorId : null;
    return creatorId && (!expected || creatorId === expected) ? "logged_in" : "needs_user_action";
  }

  override async checkLogin(ctx: AccountContext): Promise<LoginStatus> { return this.checkSession(ctx); }

  private async readEditorSettings(page: Page, coreNoMusic = false): Promise<DouyinEditorSettingsSnapshot> {
    return page.evaluate((ignoreOptionalSelections) => {
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
      // Core NONE binds the actual public/immediate controls and required fields, not optional music UI state.
      const selectedMandatory = ignoreOptionalSelections ? [] : controls
        .filter(({ label, selected }) => selected && !/公开|可见|私密|粉丝|立即|定时/u.test(label))
        .map(({ label }) => ({ key: label, value: "selected" }));
      return {
        visibility: publicSelected ? "public" as const : followersSelected ? "followers" as const : privateSelected ? "private" as const : "unknown" as const,
        visibilitySelected: publicSelected || privateSelected || followersSelected,
        timing: scheduled ? "scheduled" as const : immediateSelected || scheduleOff ? "immediate" as const : "unknown" as const,
        timingSelected: scheduled || immediateSelected || scheduleOff,
        requiredEmptyCount, unknownMandatoryCount, selectedMandatory
      };
    }, coreNoMusic);
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
    const preparationId = randomUUID();
    const musicMode = requestedDouyinMusicMode(ctx.settings.expectedMusicMode);
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("; "));
    const creatorId = typeof ctx.settings.expectedCreatorId === "string" ? ctx.settings.expectedCreatorId.trim() : "";
    if (!creatorId) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_VERIFIED_CREATOR_ID_REQUIRED");
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context || owned.session.executionMode !== "VISIBLE")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_ACTIVE_OWNED_CONTEXT_REQUIRED");
    const page = owned.page;
    if (new URL(page.url()).host !== "creator.douyin.com" || await this.readOwnedCreatorId(ctx, owned) !== creatorId)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_IDENTITY_MISMATCH");
    await denyOptionalDouyinLocation(page);
    const pagePath = new URL(page.url()).pathname;
    const resumeApproved = this.approvedResume?.accountId === ctx.accountId && this.approvedResume.articleId === article.articleId;
    const previewSelector = 'main img, [class*="upload"] img, [class*="image"] img';
    const resumeDraft = resumeApproved && isAuthorizedDouyinDraftResume({ accountId: ctx.accountId, articleId: article.articleId, pagePath,
      title: pagePath === "/creator-micro/content/post/image"
        ? await page.locator('input[placeholder="添加作品标题"]').inputValue().catch(() => "") : "",
      body: pagePath === "/creator-micro/content/post/image"
        ? await page.locator('[contenteditable="true"]').innerText().catch(() => "") : "",
      imageCount: pagePath === "/creator-micro/content/post/image" ? await page.locator(previewSelector).count() : 0 },
    { ...this.approvedResume!, title: article.title, body: article.body });
    const visibility = ctx.settings.expectedVisibility;
    if (visibility !== "public") throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_OWNER_VISIBILITY_SELECTION_REQUIRED");
    const source = { articleId: article.articleId, accountId: ctx.accountId, creatorId,
      title: article.title, body: article.body, imagePaths: article.images ?? [], topics: [], visibility, scheduledAt: null } as const;
    const initialFrozen = await freezeDouyinImageText(source);
    if (!await verifyDouyinImageTextImage(initialFrozen, 0)) throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_HASH_MISMATCH");
    const jobId = typeof ctx.settings.publishJobId === "string" ? ctx.settings.publishJobId : "";
    const loginGeneration = ctx.settings.expectedLoginGeneration;
    const priorOperation = this.uploadOperations.get(jobId);
    const sameOperation = priorOperation && isSameDouyinUploadOperation(priorOperation, {
      accountId: ctx.accountId, articleId: article.articleId, jobId, operationId: priorOperation.operationId,
      page, context: owned.session.context, sessionIdHash: owned.session.sessionIdHash,
      loginGeneration: typeof loginGeneration === "number" ? loginGeneration : -1,
      sourceContentHash: initialFrozen.sourceContentHash, imageSha256: initialFrozen.imageHashes[0] ?? "",
      previewDigest: priorOperation.previewDigest,
      pagePath, title: pagePath === "/creator-micro/content/post/image"
        ? await page.locator('input[placeholder="添加作品标题"]').inputValue().catch(() => "") : "",
      body: pagePath === "/creator-micro/content/post/image"
        ? await page.locator('[contenteditable="true"]').innerText().catch(() => "") : ""
    });
    if (priorOperation && !sameOperation)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_IMAGE_SELECTION_OPERATION_UNCERTAIN_OR_CHANGED");
    if (resumeApproved && !resumeDraft && !sameOperation)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_RESUMED_CONTENT_NOT_UNIQUELY_IDENTIFIED_NO_NEW_UPLOAD");
    if (!resumeDraft && !sameOperation && pagePath !== "/creator-micro/home")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_HOME_REQUIRED_FOR_NEW_IMAGE_TEXT");
    let previewDigest: string | null = null;
    if (sameOperation && priorOperation) {
      const currentImageInput = page.locator('input[type="file"][accept*="image/"]');
      const currentInputCount = await currentImageInput.count();
      const inputDetached = currentInputCount === 0;
      const inputFileName = currentInputCount === 1
        ? await currentImageInput.evaluate((element) => element instanceof HTMLInputElement
          ? element.files?.[0]?.name ?? null : null).catch(() => null) : null;
      const observed = await observeDouyinImageEditor(page, { expectedContext: owned.session.context,
        preUploadImageCount: priorOperation.preUploadImageCount, previewSelector,
        fileName: basename(initialFrozen.imagePaths[0]!), inputFileName, inputDetached });
      if (priorOperation.previewDigest && observed.previewDigest !== priorOperation.previewDigest)
        throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_PREVIEW_CHANGED");
      priorOperation.previewDigest = observed.previewDigest;
      previewDigest = observed.previewDigest;
    } else if (!resumeDraft) {
      protectExistingDouyinDraft(await page.locator("body").innerText());
      await dismissKnownDouyinHomeTour(page);
      await page.keyboard.press("Escape");
      const card = page.getByText("发布图文", { exact: true });
      if (await card.count() !== 1 || !await card.isVisible())
        throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_IMAGE_TEXT_ENTRY_AMBIGUOUS");
      await card.click();
      protectExistingDouyinDraft(await page.locator("body").innerText());
      await page.waitForURL((url) => url.origin === "https://creator.douyin.com" && url.pathname === "/creator-micro/content/upload", { timeout: 15_000 });
      const upload = await waitForUniqueDouyinImageInput(page);
      const uploadArea = await upload.evaluate((element) => (element.closest("label")?.textContent ?? element.parentElement?.textContent ?? "").slice(0, 120));
      if (!/图文|图片|上传/u.test(uploadArea)) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_IMAGE_UPLOAD_AREA_UNVERIFIED");
      const preUploadImageCount = await page.locator(previewSelector).count();
      if (preUploadImageCount !== 0 || !jobId || typeof loginGeneration !== "number" || !this.claimFileSelection)
        throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_IMAGE_SELECTION_PRECONDITION_MISSING");
      const imagePath = initialFrozen.imagePaths[0]!;
      const bytes = await readFile(imagePath);
      const imageSha256 = createHash("sha256").update(bytes).digest("hex");
      if (imageSha256 !== initialFrozen.imageHashes[0])
        throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_HASH_MISMATCH");
      const fileName = basename(imagePath);
      const mimeType = /\.png$/iu.test(fileName) ? "image/png" as const
        : /\.jpe?g$/iu.test(fileName) ? "image/jpeg" as const : null;
      if (!mimeType) throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_TYPE_UNSUPPORTED");
      const claim = this.claimFileSelection({ jobId, accountId: ctx.accountId, articleId: article.articleId,
        loginGeneration, sessionIdHash: owned.session.sessionIdHash, imageSha256,
        sourceContentHash: initialFrozen.sourceContentHash });
      if (!claim.newlyClaimed)
        throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_IMAGE_SELECTION_ALREADY_DISPATCHED_NO_REUPLOAD");
      const operation: DouyinUploadOperation = { accountId: ctx.accountId, articleId: article.articleId,
        jobId, operationId: claim.operationId, page, context: owned.session.context,
        sessionIdHash: owned.session.sessionIdHash, loginGeneration,
        sourceContentHash: initialFrozen.sourceContentHash, imageSha256,
        selectionStatus: "DISPATCHED", preUploadImageCount, inputDetached: false, inputFileName: fileName };
      this.uploadOperations.set(jobId, operation);
      const observed = await selectAndObserveDouyinImage(page, upload, { fileName, mimeType, bytes, imageSha256,
        expectedContext: owned.session.context, preUploadImageCount, previewSelector,
        onSelectionReturned: () => { operation.selectionStatus = "RETURNED"; },
        onSelectionThrew: () => { operation.selectionStatus = "THREW"; } });
      operation.inputDetached = observed.inputDetached;
      operation.inputFileName = observed.inputDetached ? null : fileName;
      operation.previewDigest = observed.previewDigest;
      previewDigest = observed.previewDigest;
    }
    const images = page.locator(previewSelector);
    await images.first().waitFor({ state: "visible", timeout: 15_000 });
    if (resumeDraft) {
      const imageCount = await images.count();
      const loaded = imageCount === 1 && await images.first().isVisible()
        && await images.first().evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
      const editorText = await page.locator("body").innerText();
      if (!loaded || /上传中|处理中|正在处理|上传失败|图片处理失败/u.test(editorText))
        throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_RESUMED_IMAGE_NOT_VERIFIED");
    }
    const title = page.locator('input[placeholder="添加作品标题"]');
    const body = page.locator('[contenteditable="true"]');
    if (await title.count() !== 1 || await body.count() !== 1) throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_EDITOR_FIELDS_AMBIGUOUS");
    if (resumeDraft && ((await title.inputValue()).trim() && await title.inputValue() !== initialFrozen.title
      || (await body.innerText()).trim() && await body.innerText() !== initialFrozen.body))
      throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_RESUMED_EDITOR_CONTENT_MISMATCH");
    await title.fill(initialFrozen.title);
    await body.fill(initialFrozen.body);
    const titleReadback = await title.inputValue();
    const bodyReadback = await readDouyinBodyText(page);
    const imageCount = await images.count();
    const finalControl = page.locator('button,[role="button"]').filter({ hasText: /^发布$/u });
    const finalCount = await finalControl.count();
    const settings = await this.readEditorSettings(page, musicMode === "NONE");
    assertDouyinEditorSettings(settings, visibility);
    // The content gate precedes every music-surface action. Neither a drawer nor a track click
    // can be used to make an incomplete editor look prepared.
    assertDouyinImageTextReadback(initialFrozen, { accountId: ctx.accountId, creatorId,
      contextOwned: page.context() === owned.session.context, sessionActive: !page.isClosed(),
      pageHost: new URL(page.url()).host, title: titleReadback, body: bodyReadback.semanticText, imageCount,
      requiredFieldsPresent: douyinRequiredSettingsPass(settings), finalSubmitControlCount: finalCount,
      securityChallenge: /captcha|security[-_/]?check|risk[-_/]?control/iu.test(page.url()) });
    const uploadOperation = this.uploadOperations.get(jobId);
    if (!uploadOperation || !previewDigest || uploadOperation.selectionStatus !== "RETURNED"
      || uploadOperation.accountId !== ctx.accountId || uploadOperation.articleId !== article.articleId
      || uploadOperation.jobId !== jobId || uploadOperation.page !== page
      || uploadOperation.context !== owned.session.context
      || uploadOperation.sessionIdHash !== owned.session.sessionIdHash
      || uploadOperation.loginGeneration !== loginGeneration
      || uploadOperation.sourceContentHash !== initialFrozen.sourceContentHash
      || uploadOperation.imageSha256 !== initialFrozen.imageHashes[0]
      || uploadOperation.previewDigest !== previewDigest)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_PRE_MUSIC_UPLOAD_OPERATION_UNVERIFIED");
    const resolveCurrentPreMusicBinding = async (): Promise<DouyinPreMusicBinding> => {
      try {
        const currentOwned = await this.activeCanonicalPage(ctx);
        if (!currentOwned || currentOwned.page !== page || currentOwned.session.context !== owned.session.context
          || currentOwned.session.sessionIdHash !== uploadOperation.sessionIdHash
          || currentOwned.session.executionMode !== "VISIBLE" || page.isClosed()
          || await this.readOwnedCreatorId(ctx, currentOwned) !== creatorId
          || ctx.settings.expectedLoginGeneration !== uploadOperation.loginGeneration)
          throw new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
        const currentTitle = await title.inputValue();
        const currentBody = await readDouyinBodyText(page);
        const currentSettings = await this.readEditorSettings(page);
        assertDouyinEditorSettings(currentSettings, visibility);
        const loadedPreviewSources = await images.evaluateAll((elements) => elements.filter((element) => {
          if (!(element instanceof HTMLImageElement) || !element.complete || element.naturalWidth <= 0) return false;
          return Boolean(element.currentSrc || element.src);
        }).map((element) => element instanceof HTMLImageElement ? element.currentSrc || element.src : ""));
        // These URLs remain ephemeral in Main; only the digest is retained in evidence.
        const currentPreviewMatches = loadedPreviewSources.filter((src) => createHash("sha256").update(src).digest("hex") === previewDigest).length;
        if (await images.count() !== 1 || loadedPreviewSources.length !== 1 || currentPreviewMatches !== 1
          || currentTitle !== initialFrozen.title || currentBody.semanticText !== initialFrozen.body
          || JSON.stringify(currentSettings) !== JSON.stringify(settings))
          throw new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_EDITOR_CHANGED");
        // A different Page can become canonical while the DOM reads above are pending.
        // The music action must never use a former canonical Page that remains open.
        const confirmedOwned = await this.activeCanonicalPage(ctx);
        if (!confirmedOwned || confirmedOwned.page !== page || confirmedOwned.session.context !== owned.session.context
          || confirmedOwned.session.sessionIdHash !== uploadOperation.sessionIdHash
          || page.isClosed() || page.context() !== confirmedOwned.session.context)
          throw new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_EVIDENCE_STALE");
        return { accountId: ctx.accountId, articleId: article.articleId, jobId, preparationId,
          uploadOperationId: uploadOperation.operationId, sessionIdHash: uploadOperation.sessionIdHash,
          loginGeneration: uploadOperation.loginGeneration, sourceContentHash: initialFrozen.sourceContentHash,
          imageSha256: uploadOperation.imageSha256, previewDigest,
          editorObservationHash: hashDouyinPreMusicEditorObservation({ title: currentTitle,
            semanticBody: currentBody.semanticText, previewDigest, imageCount: loadedPreviewSources.length,
            settings: currentSettings }), editorUrl: page.url(), page, context: owned.session.context,
          musicSelectionCount: this.musicSelectionUsed.has(jobId) ? 1 : 0 };
      } catch (error) {
        if (error instanceof DouyinPreMusicInvariantError) throw error;
        throw new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_CURRENT_EDITOR_UNVERIFIED");
      }
    };
    let preMusicEvidence: Awaited<ReturnType<typeof inspectDouyinPreMusicReadOnly>> | null = null;
    let musicBinding: DouyinMusicBinding = { mode: "NONE" };
    let musicResult = musicMode === "NONE" ? "DISABLED" : "SKIPPED_OPTIONAL";
    let musicCandidateCount = 0;
    let musicEligibleCount = 0;
    let musicRecentExcludedCount = 0;
    let musicSelectionOperationId: string | null = null;
    if (musicMode === "AUTO_RECOMMENDED") {
      preMusicEvidence = await inspectDouyinPreMusicReadOnly(await resolveCurrentPreMusicBinding());
      let recent: DouyinMusicIdentity[] = [];
      try {
        const value: unknown = JSON.parse(String(ctx.settings.recentDouyinMusicJson ?? "[]"));
        if (!Array.isArray(value)) throw new Error("DOUYIN_RECENT_MUSIC_INVALID");
        recent = value.filter((item): item is DouyinMusicIdentity => item && typeof item === "object"
          && typeof item.title === "string" && typeof item.artist === "string" && typeof item.duration === "string"
          && (item.trackId === null || typeof item.trackId === "string")).slice(0, 10);
      } catch { throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_RECENT_MUSIC_INVALID"); }
      try {
        const inspected = await inspectRecommendedDouyinMusic(page, preMusicEvidence, resolveCurrentPreMusicBinding);
        musicCandidateCount = inspected.candidates.length;
        const decision = chooseDouyinMusic(inspected.candidates, recent);
        musicEligibleCount = decision.eligibleCount;
        musicRecentExcludedCount = decision.recentExcludedCount;
        if (decision.selected) {
          const selected = decision.selected;
          const identity = douyinMusicIdentityKey(selected);
          const row = selected.rowIndex === undefined ? null : douyinMusicDrawerRows(page).nth(selected.rowIndex);
          if (!identity || !row || !await row.isVisible() || !((await row.innerText()).includes(selected.title)))
            throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_MUSIC_ROW_CHANGED_BEFORE_SELECTION");
          if (!jobId || this.musicSelectionUsed.has(jobId))
            throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_MUSIC_SELECTION_ALREADY_DISPATCHED");
          try { await clickRecommendedDouyinMusicOnce(page, row, preMusicEvidence, resolveCurrentPreMusicBinding,
            () => { musicSelectionOperationId = randomUUID(); this.musicSelectionUsed.add(jobId); }); }
          catch (error) {
            if (error instanceof DouyinPreMusicInvariantError) throw error;
            throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_MUSIC_SELECTION_RESULT_UNKNOWN");
          }
          await page.keyboard.press("Escape");
          const observed = await readSelectedDouyinMusic(page);
          const selectedBinding: DouyinMusicBinding = { mode: "AUTO_RECOMMENDED", identity, trackId: selected.trackId,
            title: selected.title, artist: selected.artist, duration: selected.duration };
          try { assertDouyinMusicReadback(selectedBinding, observed); }
          catch { throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_MUSIC_READBACK_MISMATCH"); }
          musicBinding = selectedBinding;
          musicResult = "SELECTED_VERIFIED";
        } else if (inspected.entryFound) await page.keyboard.press("Escape");
      } catch (error) {
        if (musicSelectionOperationId || error instanceof DouyinPreMusicInvariantError) throw error;
        await page.keyboard.press("Escape").catch(() => undefined);
        musicResult = "SKIPPED_OPTIONAL";
      }
    }
    let postMusicReadback: "PASS_NONE" | "PASS_TRACK" | "NOT_RUN" = "NOT_RUN";
    if (musicMode === "AUTO_RECOMMENDED") {
      const postMusic = await readSelectedDouyinMusic(page);
      if (postMusic.drawerPresent)
        throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_POST_MUSIC_DRAWER_STILL_OPEN");
      try { postMusicReadback = assertDouyinMusicReadback(musicBinding, postMusic); }
      catch { throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_MUSIC_READBACK_MISMATCH"); }
    }
    const postTitleReadback = await title.inputValue();
    const postBodyReadback = await readDouyinBodyText(page);
    const postImageCount = await images.count();
    const postSettings = await this.readEditorSettings(page, musicMode === "NONE");
    assertDouyinEditorSettings(postSettings, visibility);
    if (JSON.stringify(postSettings) !== JSON.stringify(settings) || postImageCount !== 1)
      throw new BrowserAutomationError("CONTENT_REJECTED", musicMode === "AUTO_RECOMMENDED"
        ? "DOUYIN_POST_MUSIC_EDITOR_CHANGED" : "DOUYIN_CORE_EDITOR_CHANGED");
    const postPreviewSource = await images.first().evaluate((image) => image instanceof HTMLImageElement
      && image.complete && image.naturalWidth > 0 ? image.currentSrc || image.src : "");
    if (!postPreviewSource || createHash("sha256").update(postPreviewSource).digest("hex") !== previewDigest)
      throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_PREVIEW_CHANGED");
    const frozen = await freezeDouyinImageText({ ...source, mandatorySelections: postSettings.selectedMandatory, musicBinding });
    if (frozen.imageHashes[0] !== uploadOperation.imageSha256)
      throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_HASH_CHANGED_AFTER_UPLOAD");
    assertDouyinImageTextReadback(frozen, { accountId: ctx.accountId, creatorId,
      contextOwned: page.context() === owned.session.context, sessionActive: !page.isClosed(),
      pageHost: new URL(page.url()).host, title: postTitleReadback, body: postBodyReadback.semanticText, imageCount: postImageCount,
      requiredFieldsPresent: douyinRequiredSettingsPass(postSettings), finalSubmitControlCount: await finalControl.count(),
      securityChallenge: /captcha|security[-_/]?check|risk[-_/]?control/iu.test(page.url()) });
    const finalOwned = await this.activeCanonicalPage(ctx);
    if (!finalOwned || finalOwned.page !== page || finalOwned.session.context !== owned.session.context
      || finalOwned.session.sessionIdHash !== uploadOperation.sessionIdHash || page.isClosed()
      || new URL(page.url()).origin !== "https://creator.douyin.com"
      || new URL(page.url()).pathname !== "/creator-micro/content/post/image"
      || ctx.settings.expectedLoginGeneration !== uploadOperation.loginGeneration
      || await this.readOwnedCreatorId(ctx, finalOwned) !== creatorId)
      throw musicMode === "AUTO_RECOMMENDED"
        ? new DouyinPreMusicInvariantError("DOUYIN_PRE_MUSIC_EVIDENCE_STALE")
        : new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_EDITOR_OWNERSHIP_STALE");
    this.prepared.set(ctx.accountId, { frozen, page, context: owned.session.context, settings: postSettings,
      previewDigest, musicModeRequested: musicMode });
    return { prepared: true, requiresUserAction: true, message: "Douyin image-text editor readback passed; waiting for one-shot authorization",
      sessionIdHash: owned.session.sessionIdHash, backendUrl: page.url(), editorOpenedAt: new Date().toISOString(),
      titleFilled: true, bodyFilled: true, response: { adapter: "douyin-image-text-browser", imageUploaded: true,
        imageAssociation: resumeDraft ? "owner_confirmed_resume" : "new_upload_verified",
        contentTransport: "DOUYIN_IMAGE_TEXT_BROWSER", imageHashes: frozen.imageHashes,
        sourceContentHash: frozen.sourceContentHash, contentBindingHash: frozen.contentBindingHash,
        musicModeRequested: musicMode, musicBinding, musicResult, musicCandidateCount,
        musicEligibleCount, musicRecentExcludedCount, musicSelectionOperationId,
        musicFeatureEnabled: musicMode === "AUTO_RECOMMENDED", musicDomGateExecuted: preMusicEvidence !== null,
        preMusicDiagnosticRun: preMusicEvidence !== null,
        ...(preMusicEvidence ? { preMusicClassification: preMusicEvidence.classification,
          preMusicEntryCount: preMusicEvidence.diagnostic.entryNodeCount,
          preMusicSelectedContainerCount: preMusicEvidence.diagnostic.selectedContainerCount,
          preMusicAmbiguousCount: preMusicEvidence.diagnostic.ambiguousNodes,
          preMusicCorrelationHash: createHash("sha256").update(`${preMusicEvidence.sessionIdHash}:${preMusicEvidence.preparationId}:${preMusicEvidence.evidenceId}`).digest("hex") } : {}),
        postMusicReadback,
        expectedCreatorId: creatorId, settingsSnapshot: postSettings, mandatorySelections: postSettings.selectedMandatory,
        rawBodyUtf16Length: postBodyReadback.rawInnerText.length,
        rawTextContentUtf16Length: postBodyReadback.rawTextContent.length,
        semanticBodyUtf16Length: postBodyReadback.semanticText.length,
        terminalPlaceholderIgnored: postBodyReadback.terminalPlaceholderIgnored,
        bodyStructureClass: postBodyReadback.structureClass,
        finalSubmitCount: 0 } };
  }

  private async verifyPreparedEditor(ctx: AccountContext, article: PublishArticleInput): Promise<{
    page: Page; frozen: FrozenDouyinImageText; bodyReadback: DouyinBodyReadback }> {
    const prepared = this.prepared.get(ctx.accountId);
    if (!prepared || prepared.page.isClosed() || prepared.page.context() !== prepared.context)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_PREPARED_EDITOR_NOT_ACTIVE");
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page !== prepared.page || owned.session.context !== prepared.context || owned.session.executionMode !== "VISIBLE")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_PREPARED_CONTEXT_MISMATCH");
    const page = prepared.page;
    if (new URL(page.url()).host !== "creator.douyin.com" || new URL(page.url()).pathname !== "/creator-micro/content/post/image")
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_EDITOR_ROUTE_CHANGED");
    const expectedCreatorId = prepared.frozen.creatorId;
    if (typeof ctx.settings.expectedCreatorId !== "string" || ctx.settings.expectedCreatorId !== expectedCreatorId
      || await this.readOwnedCreatorId(ctx, owned) !== expectedCreatorId)
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_CREATOR_IDENTITY_MISMATCH");
    const title = page.locator('input[placeholder="添加作品标题"]');
    const body = page.locator('[contenteditable="true"]');
    const images = page.locator('main img, [class*="upload"] img, [class*="image"] img');
    if (prepared.previewDigest) {
      const currentPreview = await images.count() === 1 ? await images.first().evaluate((image) => image instanceof HTMLImageElement
        ? image.currentSrc || image.src : "") : "";
      if (!currentPreview || createHash("sha256").update(currentPreview).digest("hex") !== prepared.previewDigest)
        throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_IMAGE_PREVIEW_CHANGED");
    }
    const finalControl = page.locator('button,[role="button"]').filter({ hasText: /^发布$/u });
    if (await title.count() !== 1 || await body.count() !== 1)
      throw new BrowserAutomationError("PLATFORM_CHANGED", "DOUYIN_EDITOR_FIELDS_AMBIGUOUS");
    const currentSettings = await this.readEditorSettings(page, prepared.musicModeRequested === "NONE");
    assertDouyinEditorSettings(currentSettings, "public");
    if (JSON.stringify(currentSettings) !== JSON.stringify(prepared.settings))
      throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_EDITOR_SETTINGS_CHANGED");
    if (article.title !== prepared.frozen.title || article.body !== prepared.frozen.body || article.images?.length !== 1
      || article.images[0] !== prepared.frozen.imagePaths[0] || !await verifyDouyinImageTextImage(prepared.frozen, 0))
      throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_PREPARED_CONTENT_OR_IMAGE_CHANGED");
    const currentMusicMode = requestedDouyinMusicMode(ctx.settings.expectedMusicMode);
    if (currentMusicMode !== prepared.musicModeRequested)
      throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_MUSIC_POLICY_CHANGED");
    if (prepared.musicModeRequested === "AUTO_RECOMMENDED") {
      const selectedMusic = await readSelectedDouyinMusic(page);
      const expectedMusic = prepared.frozen.musicBinding;
      try { assertDouyinMusicReadback(expectedMusic ?? { mode: "NONE" }, selectedMusic); }
      catch { throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_MUSIC_READBACK_MISMATCH"); }
    }
    const bodyReadback = await readDouyinBodyText(page);
    assertDouyinImageTextReadback(prepared.frozen, { accountId: ctx.accountId, creatorId: expectedCreatorId,
      contextOwned: true, sessionActive: true, pageHost: new URL(page.url()).host,
      title: await title.inputValue(), body: bodyReadback.semanticText, imageCount: await images.count(),
      requiredFieldsPresent: douyinRequiredSettingsPass(currentSettings), finalSubmitControlCount: await finalControl.count(),
      securityChallenge: /captcha|security[-_/]?check|risk[-_/]?control/iu.test(page.url()) });
    if (await finalControl.isDisabled()) throw new BrowserAutomationError("CONTENT_REJECTED", "DOUYIN_FINAL_CONTROL_DISABLED");
    return { page, frozen: prepared.frozen, bodyReadback };
  }

  /** A separate owned tab checks the real management route without leaving the prepared editor. */
  private async managementSmoke(ctx: AccountContext): Promise<void> {
    const prepared = this.prepared.get(ctx.accountId);
    if (!prepared) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_PREPARED_EDITOR_NOT_ACTIVE");
    const tab = await prepared.context.newPage();
    try {
      await tab.goto("https://creator.douyin.com/creator-micro/content/manage", { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (new URL(tab.url()).host !== "creator.douyin.com" || new URL(tab.url()).pathname !== "/creator-micro/content/manage")
        throw new Error("DOUYIN_MANAGEMENT_ROUTE_UNAVAILABLE");
      const controls = await inspectDouyinManagementControls(tab, prepared.context);
      if (controls.searchControlCount !== 1 || controls.stateLabels.length !== 3)
        throw new Error("DOUYIN_MANAGEMENT_STATES_UNVERIFIED");
    } finally { await tab.close().catch(() => undefined); }
  }

  async prepareFinalSubmit(ctx: AccountContext, article: PublishArticleInput): Promise<{ response: Record<string, unknown> }> {
    this.assertFormalSubmitAvailable();
    const verified = await this.verifyPreparedEditor(ctx, article);
    await this.managementSmoke(ctx);
    await this.verifyPreparedEditor(ctx, article);
    return { response: { adapter: "douyin-image-text-browser", stage: "final_submit_preflight", imageCount: 1,
      titleReadback: true, bodyReadback: true, settingsReadback: true, managementReadOnlyReady: true,
      rawBodyUtf16Length: verified.bodyReadback.rawInnerText.length,
      rawTextContentUtf16Length: verified.bodyReadback.rawTextContent.length,
      semanticBodyUtf16Length: verified.bodyReadback.semanticText.length,
      terminalPlaceholderIgnored: verified.bodyReadback.terminalPlaceholderIgnored,
      bodyStructureClass: verified.bodyReadback.structureClass,
      contentBindingHash: verified.frozen.contentBindingHash, finalSubmitCount: 0 } };
  }

  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    if (this.finalSubmitUsed.has(attempt.jobId)) throw new BrowserAutomationError("FINAL_SUBMIT_ALREADY_USED", "DOUYIN_FINAL_ACTION_ALREADY_USED");
    if (!attempt.markSubmissionSideEffect) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "DOUYIN_DURABLE_BOUNDARY_REQUIRED");
    this.assertFormalSubmitAvailable();
    const { page } = await this.verifyPreparedEditor(ctx, article);
    const button = page.locator('button,[role="button"]').filter({ hasText: /^发布$/u });
    const observer = new DouyinImagePostObserver(page);
    await observer.installOneShotGuard();
    this.finalSubmitUsed.add(attempt.jobId);
    try {
      attempt.markSubmissionSideEffect();
      observer.markFinalClick();
      try { await button.click({ timeout: 15_000 }); }
      catch { throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "DOUYIN_FINAL_CLICK_RESULT_UNKNOWN"); }
      const { evidence, classification, blockedUnknownWriteCount } = await observer.collect();
      if (classification.status !== "ACCEPTED") throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "DOUYIN_PUBLISH_RESPONSE_UNKNOWN");
      return { success: true, status: "publishing", externalId: classification.remoteId ?? undefined,
        response: { adapter: "douyin-image-text-browser", submissionAccepted: true, requiresManagementConfirmation: true,
          imageUploaded: true, finalActionCount: evidence.finalClickCount, observedPublishRequestCount: evidence.requestCount,
          httpStatus: evidence.httpStatus, platformStatusCode: evidence.statusCode, remoteId: classification.remoteId,
          blockedUnknownWriteCount,
          finalSubmitCount: 1, submissionIntentId: attempt.submissionIntentId } };
    } finally { observer.stop(); await observer.removeUnusedGuard(); }
  }

  async reconcile(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult> {
    const unknown = (reason: string, remoteState: "UNKNOWN" | "AMBIGUOUS" = "UNKNOWN"): BrowserPublishReconciliationResult => ({
      status: "STILL_UNCERTAIN", remoteState, titleMatch: false, accountMatch: false, timeWindowMatch: false,
      response: { adapter: "douyin-image-text-browser", readOnly: true, reason }, message: "Douyin management evidence remains uncertain; no retry"
    });
    const expected = typeof ctx.settings.expectedCreatorId === "string" ? ctx.settings.expectedCreatorId : "";
    if (!expected || input.expectedCreatorId !== expected || input.finalSubmitCount !== 1) return unknown("ACCOUNT_OR_BOUNDARY_MISMATCH");
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed() || owned.page.context() !== owned.session.context || owned.session.executionMode !== "VISIBLE"
      || await this.readOwnedCreatorId(ctx, owned) !== expected) return unknown("OWNED_CREATOR_IDENTITY_UNVERIFIED");
    const tab = await owned.session.context.newPage();
    try {
      await tab.goto("https://creator.douyin.com/creator-micro/content/manage", { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (new URL(tab.url()).pathname !== "/creator-micro/content/manage") return unknown("MANAGEMENT_ROUTE_UNAVAILABLE");
      await tab.locator('input[placeholder="搜索作品"]').waitFor({ state: "visible", timeout: 15_000 });
      if (await tab.locator('input[placeholder="搜索作品"]').count() !== 1) return unknown("MANAGEMENT_SEARCH_UNAVAILABLE");
      const rows = await tab.evaluate(() => {
        const output: DouyinManagementRow[] = [];
        for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"],a[href*="/note/"]')) {
          const href = link.href;
          const remoteId = /\/(?:video|note)\/(\d{10,30})(?:[/?#]|$)/u.exec(href)?.[1] ?? null;
          if (!remoteId) continue;
          const row = link.closest('tr,li,[class*="item"],[class*="card"]');
          if (!row || !(row instanceof HTMLElement) || row.getBoundingClientRect().width === 0) continue;
          const text = row.innerText.replace(/\s+/gu, " ").trim();
          const states = [/已发布/u, /审核中/u, /未通过/u].filter((pattern) => pattern.test(text));
          if (states.length !== 1) continue;
          const state: DouyinManagementRow["state"] = /已发布/u.test(text) ? "PUBLISHED" : /审核中/u.test(text) ? "REVIEWING" : "REJECTED";
          const title = (link.innerText || link.getAttribute("title") || "").replace(/\s+/gu, " ").trim();
          output.push({ remoteId, title, description: text, state, submittedAt: null, publicUrl: href,
            imageCount: row.querySelectorAll("img").length });
        }
        return output;
      });
      const match = matchDouyinManagementRows(rows, { remoteId: input.expectedExternalId ?? null,
        title: input.title, windowStart: input.windowStart, windowEnd: input.windowEnd, scopeComplete: false });
      if (match.state === "AMBIGUOUS") return unknown("MULTIPLE_REMOTE_CANDIDATES", "AMBIGUOUS");
      if (!match.remoteId || match.matchedBy !== "REMOTE_ID") return unknown("UNIQUE_REMOTE_ID_NOT_FOUND_IN_VISIBLE_SCOPE");
      const selected = rows.find((row) => row.remoteId === match.remoteId);
      const titleMatch = selected?.title.normalize("NFKC").trim() === input.title.normalize("NFKC").trim()
        || selected?.description.includes(input.title) === true;
      if (!titleMatch) return unknown("REMOTE_ID_TITLE_MISMATCH");
      return { status: match.state === "PUBLISHED" ? "FOUND_PUBLISHED" : "STILL_UNCERTAIN", remoteState: match.state,
        externalId: match.remoteId, publishedUrl: match.publicUrl ?? undefined, titleMatch: true, accountMatch: true,
        timeWindowMatch: false, response: { adapter: "douyin-image-text-browser", readOnly: true,
          matchedBy: "REMOTE_ID", remoteState: match.state, rowCount: rows.length, scopeComplete: false },
        message: `Douyin unique management row: ${match.state}` };
    } catch { return unknown("MANAGEMENT_READ_FAILED"); }
    finally { await tab.close().catch(() => undefined); }
  }

  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const id = result.externalId;
    const url = result.publishedUrl;
    const limited = (reason: string): PublishStatusResult => ({ status: "publishing", externalId: id, publishedUrl: url,
      response: { adapter: "douyin-image-text-browser", publicVerification: "LIMITED", reason },
      errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "PUBLIC_VERIFICATION_LIMITED" });
    if (!id || !url) return limited("PUBLIC_URL_UNAVAILABLE");
    let parsed: URL;
    try { parsed = new URL(url); } catch { return limited("PUBLIC_URL_INVALID"); }
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".douyin.com") || !parsed.pathname.includes(id)) return limited("PUBLIC_ID_URL_MISMATCH");
    const owned = await this.activeCanonicalPage(ctx);
    if (!owned || owned.page.isClosed()) return limited("OWNED_SESSION_UNAVAILABLE");
    const tab = await owned.session.context.newPage();
    try {
      await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const evidence = await tab.evaluate(() => ({ text: document.body.innerText, imageCount: [...document.images]
        .filter((image) => image.complete && image.naturalWidth > 0).length }));
      const titleMatch = evidence.text.includes(article.title);
      const bodyMatch = evidence.text.includes(article.body);
      const imageMatch = evidence.imageCount > 0;
      if (!titleMatch || !bodyMatch || !imageMatch) return limited("PUBLIC_TEXT_OR_IMAGE_UNVERIFIED");
      return { status: "published", externalId: id, publishedUrl: url,
        response: { adapter: "douyin-image-text-browser", urlReachable: true, titleMatch, bodyMatch, imageMatch,
          publicVerification: "CONFIRMED" } };
    } catch { return limited("PUBLIC_READ_FAILED"); }
    finally { await tab.close().catch(() => undefined); }
  }

  override async publishArticle(ctx: AccountContext, article: PublishArticleInput): Promise<PublishResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("; "));
    if (ctx.settings.dryRun === true) return { success: true, dryRun: true, response: {
      adapter: "douyin-image-text-browser", stage: "local_validation_only", networkCalls: 0, finalSubmitCount: 0 } };
    throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Douyin image-text requires a persisted Prepared record and one-shot final submit boundary");
  }
}
