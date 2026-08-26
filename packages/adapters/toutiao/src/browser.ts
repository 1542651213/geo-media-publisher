import type { AccountContext, PublishArticleInput, ValidationResult } from "@publisher/domain";
import type { AutomationPrepareResult, BrowserPublishAttemptContext, BrowserPublishReconciliationInput, BrowserPublishReconciliationResult } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition } from "@publisher/adapters-browser";
import type { Frame, Locator, Page } from "playwright-core";
import type { PublishResult, PublishStatusResult } from "@publisher/domain";

const TOUTIAO_CREATOR_HOME = "https://mp.toutiao.com/";
const TOUTIAO_ARTICLE_EDITOR_URL = "https://mp.toutiao.com/profile_v4/graphic/publish";
const TOUTIAO_ARTICLE_EDITOR_PATH = /\/graphic\/publish|\/article\/publish|\/publish\/article/iu;
const TOUTIAO_TITLE_SELECTORS = [
  'input[placeholder*="\u6807\u9898"], textarea[placeholder*="\u6807\u9898"], input[aria-label*="\u6807\u9898"], textarea[aria-label*="\u6807\u9898"]',
  'input[name*="title" i], textarea[name*="title" i], input[id*="title" i], textarea[id*="title" i]',
  'input[placeholder], textarea[placeholder]'
];
const TOUTIAO_BODY_SELECTORS = [
  '[contenteditable="true"][role="textbox"], [contenteditable="true"].ProseMirror, [contenteditable="true"].editor',
  '[contenteditable="true"][aria-label], [contenteditable="true"][data-placeholder], textarea[name*="body" i], textarea[id*="body" i]'
];
const TOUTIAO_REQUIRED_SELECTOR = 'input[required], textarea[required], select[required], [aria-required="true"]';
const TOUTIAO_FILE_SELECTOR = 'input[type="file"]';
const TOUTIAO_SUBMIT_SELECTOR = 'button, [role="button"]';
const TOUTIAO_SINGLE_COVER_SELECTOR = ".article-cover-radio-group .byte-radio";
const TOUTIAO_COVER_ADD_SELECTOR = ".article-cover-add";

type ToutiaoEditorField = "title" | "body";
type ToutiaoEditorFailureCode = "CONTENT_EDITOR_AMBIGUOUS" | "CONTENT_TITLE_NOT_VERIFIED" | "CONTENT_BODY_NOT_VERIFIED";

interface EditorEvidence {
  field: ToutiaoEditorField;
  selector: string;
  count: number;
  visible: boolean;
  enabled: boolean;
  attributes: Record<string, string>;
  signals: string[];
}

interface EditorHandle { locator: Locator; evidence: EditorEvidence; }
type ToutiaoDocument = { locator: (selector: string) => Locator; url: () => string };

interface FinalSubmitControlEvidence {
  verified: boolean;
  enabled: boolean;
  label: string;
  selector: string;
  clickRequired: boolean;
}

interface PreparedCoverEvidence {
  uploaded: boolean;
  editorUrl: string;
}

interface ToutiaoPublicResult {
  externalId: string;
  publishedUrl: string;
}

export type ToutiaoAccountPreflightCode =
  | "ACCOUNT_IDENTITY_UNVERIFIED"
  | "ACCOUNT_MUTED"
  | "PUBLISH_PERMISSION_DENIED"
  | "SECURITY_VERIFICATION_REQUIRED"
  | "REAL_NAME_VERIFICATION_REQUIRED"
  | "ACCOUNT_ABNORMAL"
  | "ARTICLE_PUBLISH_ENTRY_UNVERIFIED";

export interface ToutiaoAccountIdentityEvidence {
  externalAccountId: string | null;
  profileUrl: string | null;
  displayName: string | null;
}

export interface ToutiaoAccountPreflightResult {
  allowed: boolean;
  pageUrl: string;
  creatorCenterAccessible: boolean;
  articlePublishPermission: boolean;
  warnings: string[];
  identity: ToutiaoAccountIdentityEvidence;
  identityCandidates: Array<{ href: string; externalAccountId: string | null; displayName: string | null }>;
  reasonCode: ToutiaoAccountPreflightCode | null;
  reason: string | null;
}

class ToutiaoEditorVerificationError extends BrowserAutomationError {
  constructor(code: ToutiaoEditorFailureCode, message: string) { super("CONTENT_REJECTED", `${code}: ${message}`); }
}

const definition: BrowserPlatformDefinition = {
  platformKey: "toutiao",
  displayName: "Toutiao article browser",
  category: "article",
  officialWebsite: "https://www.toutiao.com/",
  developerPortal: "https://open.douyin.com/",
  backendUrl: TOUTIAO_CREATOR_HOME,
  officialSources: ["https://mp.toutiao.com/", "https://open.douyin.com/"],
  version: "0.1.0",
  researchStatus: "partial",
  blockingReason: "Article BrowserAutomation verifies the owned session, editor DOM and final-submit control without clicking; owner approval is still required for any real submit.",
  capabilities: {
    article: true,
    imagePost: true,
    video: false,
    coverImage: true,
    tags: true,
    categories: true,
    scheduledPublish: false,
    draft: true,
    markdown: false,
    richText: true,
    maxTitleLength: 100,
    maxImageCount: 9,
    maxTagCount: 10,
    supportsVideoCover: false,
    supportsVideoTags: false,
    videoPublishAsync: false
  }
};

function normalize(value: string): string {
  const stripped = Array.from(value.normalize("NFKC")).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 0x1f && code !== 0x7f && code !== 0xad && code !== 0x200b && code !== 0x200c && code !== 0x200d && code !== 0x2060 && code !== 0xfeff;
  }).join("");
  return stripped.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/[ ]+/gu, " ").trim();
}

export function isToutiaoCreatorCenterPage(pageUrl: string, pageText: string): boolean {
  try {
    const url = new URL(pageUrl);
    return /^mp\.toutiao\.com$/iu.test(url.hostname)
      && !/(?:^|\/)(?:auth|login|signin)(?:\/|$)/iu.test(url.pathname)
      && pageText.trim().length > 0;
  } catch {
    return false;
  }
}

function publicResultFromUrl(value: string): ToutiaoPublicResult | null {
  try {
    const url = new URL(value);
    if (!/^(?:www\.)?toutiao\.com$/iu.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:article|w|item)\/([0-9]+)\/?$/iu);
    if (!match) return null;
    url.hash = "";
    return { externalId: match[1], publishedUrl: url.toString() };
  } catch {
    return null;
  }
}

function containsNormalized(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalize(needle);
  return normalizedNeedle.length > 0 && normalize(haystack).includes(normalizedNeedle);
}

function failureCode(field: ToutiaoEditorField): ToutiaoEditorFailureCode { return field === "title" ? "CONTENT_TITLE_NOT_VERIFIED" : "CONTENT_BODY_NOT_VERIFIED"; }

async function locatorCount(locator: Locator): Promise<number> {
  const candidate = locator as unknown as { count?: () => Promise<number> };
  return typeof candidate.count === "function" ? await candidate.count() : 1;
}

async function first(locator: Locator): Promise<Locator> {
  const candidate = locator as unknown as { first?: () => Locator };
  return typeof candidate.first === "function" ? candidate.first() : locator;
}

async function itemAt(locator: Locator, index: number): Promise<Locator> {
  const candidate = locator as unknown as { nth?: (position: number) => Locator; first?: () => Locator };
  if (typeof candidate.nth === "function") return candidate.nth(index);
  if (index === 0 && typeof candidate.first === "function") return candidate.first();
  return locator;
}

async function waitForNextEditorProbe(page: ToutiaoDocument): Promise<void> {
  const candidate = page as unknown as { waitForTimeout?: (milliseconds: number) => Promise<void> };
  if (typeof candidate.waitForTimeout === "function") {
    await candidate.waitForTimeout(250);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
}

function isDetachedFrameError(error: unknown): boolean {
  return /frame was detached|frame has been detached/iu.test(error instanceof Error ? error.message : String(error));
}

async function dismissVisibleAssistantDrawer(rootPage: Page, editor: ToutiaoDocument): Promise<void> {
  for (const document of [rootPage, editor]) {
    try {
      const drawer = document.locator(".ai-assistant-drawer");
      const drawerCount = await locatorCount(drawer);
      if (drawerCount === 0) continue;
      if (drawerCount !== 1 || !(await isVisible(drawer))) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", `Toutiao cover mode is blocked by an assistant drawer that was not uniquely verified; drawerCount=${drawerCount}`);
      const masks = document.locator(".byte-drawer-mask");
      const maskCount = await locatorCount(masks);
      if (maskCount !== 1) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", `Toutiao assistant drawer mask was not uniquely verified; maskCount=${maskCount}`);
      const mask = await first(masks);
      if (!(await isVisible(mask)) || !(await isEnabled(mask))) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", "Toutiao assistant drawer mask is not visible and enabled");
      await mask.click();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!(await isVisible(mask))) return;
        await waitForNextEditorProbe(document);
      }
      throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", "Toutiao assistant drawer did not close through its verified normal UI mask");
    } catch (error) {
      if (isDetachedFrameError(error)) continue;
      throw error;
    }
  }
}

async function clickUniqueCoverConfirmation(rootPage: Page, editor: ToutiaoDocument): Promise<void> {
  for (const document of [rootPage, editor]) {
    try {
      const candidates = document.locator('button, [role="button"]');
      const count = await locatorCount(candidates);
      const confirmations: Locator[] = [];
      for (let index = 0; index < count; index += 1) {
        const candidate = await itemAt(candidates, index);
        if (!(await isVisible(candidate)) || !(await isEnabled(candidate))) continue;
        if (normalize(await candidate.innerText().catch(() => "")) === "确定") confirmations.push(candidate);
      }
      if (confirmations.length === 0) continue;
      if (confirmations.length !== 1) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", `Toutiao cover confirmation was not uniquely discoverable; matches=${confirmations.length}`);
      try {
        await confirmations[0].click();
      } catch (error) {
        if (!isDetachedFrameError(error)) throw error;
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!(await isVisible(confirmations[0]))) return;
        await waitForNextEditorProbe(document);
      }
      throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", "Toutiao cover confirmation remained visible after the normal UI action");
    } catch (error) {
      if (isDetachedFrameError(error)) continue;
      throw error;
    }
  }
}

async function attr(locator: Locator, name: string): Promise<string> {
  const candidate = locator as unknown as { getAttribute?: (attributeName: string) => Promise<string | null> };
  return typeof candidate.getAttribute === "function" ? (await candidate.getAttribute(name).catch(() => null))?.trim() ?? "" : "";
}

async function isVisible(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isVisible?: () => Promise<boolean> };
  return typeof candidate.isVisible === "function" ? await candidate.isVisible().catch(() => false) : true;
}

async function isEnabled(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isEnabled?: () => Promise<boolean> };
  return typeof candidate.isEnabled === "function" ? await candidate.isEnabled().catch(() => false) : true;
}

async function discover(page: ToutiaoDocument, field: ToutiaoEditorField): Promise<EditorHandle> {
  const selectors = field === "title" ? TOUTIAO_TITLE_SELECTORS : TOUTIAO_BODY_SELECTORS;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    for (let selectorIndex = 0; selectorIndex < selectors.length; selectorIndex += 1) {
      const selector = selectors[selectorIndex];
      const candidates = page.locator(selector);
      const count = await locatorCount(candidates);
      if (count === 0) continue;
      // The first selectors are semantic and must remain unique. The final
      // fallback is intentionally not treated as an immediate ambiguity while
      // the editor is hydrating, because it can also match an AI helper field.
      if (count > 1) {
        if (selectorIndex === 0) throw new ToutiaoEditorVerificationError("CONTENT_EDITOR_AMBIGUOUS", `${field} selector ${selector} matched ${count} candidates`);
        continue;
      }
      const locator = await first(candidates);
      if (!(await isVisible(locator)) || !(await isEnabled(locator))) continue;
      const attributes: Record<string, string> = {};
      for (const name of ["placeholder", "aria-label", "role", "name", "id", "class", "contenteditable", "data-placeholder"] as const) attributes[name] = await attr(locator, name);
      const semantic = Object.values(attributes).join(" ").toLowerCase();
      const signals: string[] = [];
      if (field === "title" && /title|\u6807\u9898/iu.test(semantic)) signals.push("title-semantic-attribute");
      if (field === "body" && attributes.contenteditable === "true") signals.push("contenteditable");
      if (field === "body" && /textbox|prosemirror|editor|body|\u6b63\u6587/iu.test(semantic)) signals.push("rich-text-semantic-structure");
      if (signals.length > 0) return { locator, evidence: { field, selector, count, visible: true, enabled: true, attributes, signals } };
    }
    await waitForNextEditorProbe(page);
  }
  throw new ToutiaoEditorVerificationError(failureCode(field), `no visible, enabled ${field} editor candidate was verified`);
}

async function readValue(handle: EditorHandle, field: ToutiaoEditorField): Promise<string> {
  const locator = handle.locator as unknown as { inputValue?: () => Promise<string>; innerText?: () => Promise<string>; textContent?: () => Promise<string | null> };
  if (field === "title" && typeof locator.inputValue === "function") return normalize(await locator.inputValue().catch(() => ""));
  if (typeof locator.innerText === "function") return normalize(await locator.innerText().catch(() => ""));
  return normalize(typeof locator.textContent === "function" ? (await locator.textContent().catch(() => "")) ?? "" : "");
}

async function fillAndRead(handle: EditorHandle, field: ToutiaoEditorField, value: string): Promise<void> {
  await handle.locator.fill(value);
  const actual = await readValue(handle, field);
  if (normalize(value) !== actual) throw new ToutiaoEditorVerificationError(failureCode(field), `${field} readback differs from the requested content`);
}

async function fieldValue(locator: Locator): Promise<string> {
  const candidate = locator as unknown as { inputValue?: () => Promise<string>; innerText?: () => Promise<string>; textContent?: () => Promise<string | null> };
  if (typeof candidate.inputValue === "function") return normalize(await candidate.inputValue().catch(() => ""));
  if (typeof candidate.innerText === "function") return normalize(await candidate.innerText().catch(() => ""));
  return normalize(typeof candidate.textContent === "function" ? (await candidate.textContent().catch(() => "")) ?? "" : "");
}

const TOUTIAO_ACCOUNT_RESTRICTIONS: Array<{ code: ToutiaoAccountPreflightCode; pattern: RegExp; message: string }> = [
  { code: "ACCOUNT_MUTED", pattern: /(?:账号|帐号)[^\n]{0,24}(?:已被)?禁言|禁言[^\n]{0,24}(?:无法|不能)发布/iu, message: "Toutiao 当前账号已被禁言，禁止进入文章发布" },
  { code: "PUBLISH_PERMISSION_DENIED", pattern: /(?:发布权限不足|禁止发文|无权发布|没有发布权限|无发文权限|不具备发文权限|无法发布文章|文章发布(?:被拒绝|受限)|不能发布文章|账号权限不足)/iu, message: "Toutiao 当前账号没有文章发布权限" },
  { code: "SECURITY_VERIFICATION_REQUIRED", pattern: /(?:验证码|滑块|短信验证|安全验证|安全校验|人机验证|风控|captcha|security\s*check|sms\s*verify|risk\s*control)/iu, message: "Toutiao 当前页面要求用户完成正常安全验证" },
  { code: "REAL_NAME_VERIFICATION_REQUIRED", pattern: /实名认证[^\n]{0,32}(?:未完成|需|请|才能|阻塞|认证)/iu, message: "Toutiao 当前页面要求完成实名认证" },
  { code: "ACCOUNT_ABNORMAL", pattern: /(?:账号|帐号)[^\n]{0,24}(?:异常|受限|冻结|封禁)/iu, message: "Toutiao 当前账号处于异常或受限状态" }
];

const TOUTIAO_ACCOUNT_WEAK_SIGNALS: Array<{ code: string; pattern: RegExp }> = [
  { code: "ACCOUNT_COMPLETION_PROMPT", pattern: /(?:请|建议)?完善账号信息[^\n]{0,48}(?:解锁|发布)(?:文章|视频|内容)?/iu }
];

function accountRestriction(pageText: string): { code: ToutiaoAccountPreflightCode; message: string } | null {
  const match = TOUTIAO_ACCOUNT_RESTRICTIONS.find((item) => item.pattern.test(pageText));
  return match ? { code: match.code, message: match.message } : null;
}

function accountWarnings(pageText: string): string[] {
  return TOUTIAO_ACCOUNT_WEAK_SIGNALS.filter((item) => item.pattern.test(pageText)).map((item) => item.code);
}

export class ToutiaoArticleBrowserAdapter extends BrowserAutomationAdapter {
  private readonly preparedCoverEvidence = new Map<string, PreparedCoverEvidence>();
  private readonly finalSubmitUsed = new Set<string>();

  constructor(options: BrowserAutomationAdapterOptions = {}) { super(definition, options); }

  override async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const validation = await super.validateArticle(article);
    return validation;
  }

  private accountKey(ctx: AccountContext): string { return `${this.platformKey}:${ctx.accountId}`; }

  private async readPageText(page: Page): Promise<string> {
    const documents: ToutiaoDocument[] = [page, ...page.frames()];
    return (await Promise.all(documents.map((document) => document.locator("body").innerText().catch(() => "")))).join("\n");
  }

  private async inspectAccountPreflightOnPage(page: Page, options: { requireIdentity: boolean; requireArticleEntry: boolean }): Promise<ToutiaoAccountPreflightResult> {
    const documents: ToutiaoDocument[] = [page, ...page.frames()];
    // Creator Center hydrates its account shell after the initial route load.
    // Wait only for a bounded DOM signal; this remains read-only and never
    // clicks an entry or creates a publish record while identity is unknown.
    let pageText = "";
    let readyPolls = 0;
    const nativeWaitAvailable = typeof (page as unknown as { waitForTimeout?: unknown }).waitForTimeout === "function";
    const minimumReadyPolls = nativeWaitAvailable ? 6 : 1;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      pageText = await this.readPageText(page);
      const bodyReady = pageText.trim().length > 0;
      if (bodyReady) {
        readyPolls += 1;
        // The creator shell can first render the account name and only then
        // append the account-completion / restriction banner. On a real
        // Playwright page, require a short stabilization window instead of
        // treating the first non-empty body as final truth.
        if (readyPolls >= minimumReadyPolls) break;
      }
      await waitForNextEditorProbe(page);
    }
    const identities = new Map<string, ToutiaoAccountIdentityEvidence>();
    const identityCandidates: Array<{ href: string; externalAccountId: string | null; displayName: string | null }> = [];
    const identityCandidateKeys = new Set<string>();
    const recordIdentityCandidate = (candidate: { href: string; externalAccountId: string | null; displayName: string | null }): void => {
      const key = `${candidate.href}\u0000${candidate.externalAccountId ?? ""}\u0000${candidate.displayName ?? ""}`;
      if (identityCandidateKeys.has(key)) return;
      identityCandidateKeys.add(key);
      identityCandidates.push(candidate);
    };
    for (const document of documents) {
      // Some Chromium/Playwright builds do not return protocol-relative hrefs
      // from an attribute-substring locator until the creator shell finishes
      // hydrating. Enumerate the already-visible anchor set and filter the
      // profile path in memory so identity proof remains deterministic.
      const candidates = document.locator("a[href]");
      const count = await locatorCount(candidates).catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = await itemAt(candidates, index);
        if (!(await isVisible(candidate))) continue;
        const href = await attr(candidate, "href");
        if (!/\/c\/user\//iu.test(href)) continue;
        const displayName = normalize(await candidate.innerText().catch(() => "")) || null;
        try {
          const url = new URL(href, page.url());
          const match = url.pathname.match(/\/c\/user\/([0-9]+)\/?$/iu);
          if (!match) {
            recordIdentityCandidate({ href, externalAccountId: null, displayName });
            continue;
          }
          url.hash = "";
          recordIdentityCandidate({ href, externalAccountId: match[1], displayName });
          identities.set(match[1], { externalAccountId: match[1], profileUrl: url.toString(), displayName });
        } catch {
          // Ignore malformed or non-profile anchors; a missing unique profile is fail-closed below.
          recordIdentityCandidate({ href, externalAccountId: null, displayName });
        }
      }
    }
    const identityValues = [...identities.values()];
    const identity = identityValues.length === 1 ? identityValues[0] : { externalAccountId: null, profileUrl: null, displayName: null };
    let articleEntryVisible = false;
    for (const document of documents) {
      const candidates = document.locator('button, [role="button"], a');
      const count = await locatorCount(candidates).catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = await itemAt(candidates, index);
        if (!(await isVisible(candidate)) || !(await isEnabled(candidate))) continue;
        const label = `${await candidate.innerText().catch(() => "")} ${await attr(candidate, "aria-label")} ${await attr(candidate, "title")}`;
        const href = await attr(candidate, "href");
        if (TOUTIAO_ARTICLE_EDITOR_PATH.test(href) || /(?:write\s*article|article\s*publish|\u53d1\u5e03\u6587\u7ae0|\u5199\u6587\u7ae0|\u56fe\u6587)/iu.test(label)) {
          articleEntryVisible = true;
          break;
        }
      }
      if (articleEntryVisible) break;
    }
    const creatorCenterAccessible = isToutiaoCreatorCenterPage(page.url(), pageText);
    const restriction = accountRestriction(pageText);
    const warnings = accountWarnings(pageText);
    const reasonCode = restriction?.code
      ?? (options.requireIdentity && identityValues.length !== 1 ? "ACCOUNT_IDENTITY_UNVERIFIED" : null)
      ?? (!creatorCenterAccessible ? "ACCOUNT_IDENTITY_UNVERIFIED" : null)
      ?? (options.requireArticleEntry && !articleEntryVisible ? "ARTICLE_PUBLISH_ENTRY_UNVERIFIED" : null);
    const reason = restriction?.message
      ?? (reasonCode === "ACCOUNT_IDENTITY_UNVERIFIED" ? "Toutiao 页面未能唯一确认当前账号身份" : null)
      ?? (reasonCode === "ARTICLE_PUBLISH_ENTRY_UNVERIFIED" ? "Toutiao 创作中心未能确认文章发布入口" : null);
    return { allowed: reasonCode === null, pageUrl: page.url(), creatorCenterAccessible, articlePublishPermission: articleEntryVisible && !restriction, warnings, identity, identityCandidates, reasonCode, reason };
  }

  async inspectAccountPreflight(ctx: AccountContext): Promise<ToutiaoAccountPreflightResult> {
    const opened = await this.openBackendPage(ctx, TOUTIAO_CREATOR_HOME);
    return this.inspectAccountPreflightOnPage(opened.page as unknown as Page, { requireIdentity: true, requireArticleEntry: true });
  }

  private assertAccountPreflightAllowed(preflight: ToutiaoAccountPreflightResult): void {
    if (preflight.allowed) return;
    const permissionCodes: ToutiaoAccountPreflightCode[] = ["ACCOUNT_MUTED", "PUBLISH_PERMISSION_DENIED", "ACCOUNT_ABNORMAL"];
    const errorCode = preflight.reasonCode && permissionCodes.includes(preflight.reasonCode) ? "PERMISSION_DENIED" : "USER_ACTION_REQUIRED";
    throw new BrowserAutomationError(errorCode, `${preflight.reasonCode ?? "ACCOUNT_IDENTITY_UNVERIFIED"}: ${preflight.reason ?? "Toutiao account preflight did not pass"}`);
  }

  private async assertNoAccountRestriction(page: Page): Promise<void> {
    const preflight = await this.inspectAccountPreflightOnPage(page, { requireIdentity: false, requireArticleEntry: false });
    if (preflight.reasonCode && TOUTIAO_ACCOUNT_RESTRICTIONS.some((item) => item.code === preflight.reasonCode)) this.assertAccountPreflightAllowed(preflight);
  }

  private async assertNoSecurityChallenge(page: Page): Promise<void> {
    const frameUrls = page.frames().map((frame) => frame.url());
    const pageText = await this.readPageText(page);
    if (frameUrls.some((url) => /captcha|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(url))
      || /captcha|security check|验证码|安全验证|人机验证|风控/iu.test(pageText)) {
      throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Toutiao final submit requires normal platform verification; no CAPTCHA or security challenge was bypassed");
    }
  }

  private async assertCoverReady(ctx: AccountContext, editor: ToutiaoDocument): Promise<void> {
    const prepared = this.preparedCoverEvidence.get(this.accountKey(ctx));
    if (!prepared?.uploaded) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", "Toutiao cover was not verified before final submit");
    const candidates = editor.locator(".article-cover-images, .article-cover-img-wrap, .article-cover-preview");
    const count = await locatorCount(candidates);
    for (let index = 0; index < count; index += 1) {
      const candidate = await itemAt(candidates, index);
      if (await isVisible(candidate) && await isEnabled(candidate)) return;
    }
    throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", "Toutiao cover is no longer visible before final submit");
  }

  private async verifyFinalSubmitReadiness(ctx: AccountContext, article: PublishArticleInput): Promise<{ page: Page; editor: ToutiaoDocument; control: { locator: Locator; evidence: FinalSubmitControlEvidence }; accountPreflight: ToutiaoAccountPreflightResult }> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("USER_ACTION_REQUIRED", "Toutiao final submit requires the prepared visible browser session");
    const page = active.page as unknown as Page;
    await this.assertNoSecurityChallenge(page);
    const accountPreflight = await this.inspectAccountPreflightOnPage(page, { requireIdentity: true, requireArticleEntry: false });
    this.assertAccountPreflightAllowed(accountPreflight);
    const editor = await this.openArticleEditor(page);
    const title = await discover(editor, "title");
    const body = await discover(editor, "body");
    if (normalize(article.title) !== await readValue(title, "title")) throw new ToutiaoEditorVerificationError("CONTENT_TITLE_NOT_VERIFIED", "title readback differs before final submit");
    if (normalize(article.body) !== await readValue(body, "body")) throw new ToutiaoEditorVerificationError("CONTENT_BODY_NOT_VERIFIED", "body readback differs before final submit");
    await this.inspectRequiredFields(editor);
    await this.assertCoverReady(ctx, editor);
    const control = await this.inspectFinalSubmitControl(editor);
    return { page, editor, control, accountPreflight };
  }

  private async openArticleEditor(page: Page): Promise<ToutiaoDocument> {
    const currentFrames = (): Frame[] => {
      try { return page.frames(); } catch { return []; }
    };
    const editorDocument = (): ToutiaoDocument | null => {
      try {
        const nestedEditor = currentFrames().find((frame) => TOUTIAO_ARTICLE_EDITOR_PATH.test(frame.url()));
        if (nestedEditor) return nestedEditor;
        return TOUTIAO_ARTICLE_EDITOR_PATH.test(page.url()) ? page : null;
      } catch {
        return null;
      }
    };
    const hasUsableEditorField = async (document: ToutiaoDocument, selector: string): Promise<boolean> => {
      try {
        const candidates = document.locator(selector);
        const count = await locatorCount(candidates);
        if (count !== 1) return false;
        const candidate = await first(candidates);
        return await isVisible(candidate) && await isEnabled(candidate);
      } catch {
        // A client-side route change can detach the old creator frame. The
        // next probe must rediscover the current frame instead of treating a
        // transient detach as a platform failure.
        return false;
      }
    };
    const editorReady = async (document: ToutiaoDocument): Promise<boolean> => {
      return await hasUsableEditorField(document, TOUTIAO_TITLE_SELECTORS[0]) || await hasUsableEditorField(document, TOUTIAO_BODY_SELECTORS[0]);
    };
    const scopes = (): ToutiaoDocument[] => [page, ...currentFrames().filter((frame): frame is Frame => {
      try {
        const parentFrame = (frame as unknown as { parentFrame?: () => Frame | null }).parentFrame;
        return typeof parentFrame !== "function" || Boolean(parentFrame.call(frame));
      } catch { return false; }
    })];
    const existingEditor = editorDocument();
    if (existingEditor && await editorReady(existingEditor)) return existingEditor;
    const pageWithWait = page as unknown as { waitForTimeout?: (milliseconds: number) => Promise<void> };
    let ambiguousEntryObserved = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const matches: Array<{ locator: Locator; document: ToutiaoDocument; articleRoute: boolean }> = [];
      for (const document of scopes()) {
        const candidates = document.locator('button, [role="button"], a');
        const count = await locatorCount(candidates).catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          const candidate = await itemAt(candidates, index);
          if (!(await isVisible(candidate)) || !(await isEnabled(candidate))) continue;
          const label = `${await candidate.innerText().catch(() => "")} ${await attr(candidate, "aria-label")} ${await attr(candidate, "title")}`.trim();
          const href = await attr(candidate, "href");
          const articleRoute = TOUTIAO_ARTICLE_EDITOR_PATH.test(href);
          if (articleRoute || /(?:write|article|\u6587\u7ae0|\u56fe\u6587|\u521b\u4f5c|\u53d1\u5e03)/iu.test(label)) matches.push({ locator: candidate, document, articleRoute });
        }
      }
      const routeMatches = matches.filter((match) => match.articleRoute);
      if (routeMatches.length > 1 || (routeMatches.length === 0 && matches.length > 1)) {
        ambiguousEntryObserved = true;
        await pageWithWait.waitForTimeout?.(250);
        continue;
      }
      const match = routeMatches[0] ?? matches[0];
      if (match) {
        await match.locator.click();
        for (let waitAttempt = 0; waitAttempt < 40; waitAttempt += 1) {
          const discovered = editorDocument();
          if (discovered && await editorReady(discovered)) return discovered;
          await pageWithWait.waitForTimeout?.(250);
        }
        throw new BrowserAutomationError("PLATFORM_CHANGED", "Toutiao article entry click did not open a verified article editor");
      }
      const discovered = editorDocument();
      if (discovered && await editorReady(discovered)) return discovered;
      await pageWithWait.waitForTimeout?.(250);
    }
    if (ambiguousEntryObserved) throw new BrowserAutomationError("CONTENT_REJECTED", "CONTENT_EDITOR_AMBIGUOUS: multiple Toutiao article entry controls remained visible after the hydration window");
    throw new BrowserAutomationError("PLATFORM_CHANGED", "CONTENT_EDITOR_NOT_VERIFIED: Toutiao article entry was not found");
  }

  private async inspectRequiredFields(page: ToutiaoDocument): Promise<{ verified: true; fields: Array<{ label: string; filled: boolean }> }> {
    const required = page.locator(TOUTIAO_REQUIRED_SELECTOR);
    const count = await locatorCount(required);
    const fields: Array<{ label: string; filled: boolean }> = [];
    for (let index = 0; index < count; index += 1) {
      const field = required.nth(index);
      if (!(await isVisible(field)) || !(await isEnabled(field))) continue;
      const label = (await attr(field, "aria-label")) || (await attr(field, "name")) || (await attr(field, "id")) || "required-field";
      const filled = (await fieldValue(field)).length > 0;
      fields.push({ label, filled });
      if (!filled) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", `Toutiao required field is empty: ${label}`);
    }
    return { verified: true, fields };
  }

  private async inspectCover(rootPage: Page, editor: ToutiaoDocument, article: PublishArticleInput): Promise<{ editor: ToutiaoDocument; imageRequirement: "cover_uploaded" | "not_supplied"; coverInputVerified: boolean; coverUploadMethod: "file_input" | "file_chooser" | "not_supplied" }> {
    const coverPath = article.coverPath?.trim() || article.images?.[0]?.trim();
    let currentEditor = editor;
    let inputs = currentEditor.locator(TOUTIAO_FILE_SELECTOR);
    let count = await locatorCount(inputs);
    if (!coverPath) return { editor: currentEditor, imageRequirement: "not_supplied", coverInputVerified: count > 0, coverUploadMethod: "not_supplied" };
    if (count === 0) {
      await dismissVisibleAssistantDrawer(rootPage, currentEditor);
      currentEditor = await this.openArticleEditor(rootPage);
      const singleCoverCandidates = currentEditor.locator(TOUTIAO_SINGLE_COVER_SELECTOR);
      const modeCount = await locatorCount(singleCoverCandidates);
      const matchingModes: Locator[] = [];
      for (let index = 0; index < modeCount; index += 1) {
        const candidate = await itemAt(singleCoverCandidates, index);
        if (!(await isVisible(candidate)) || !(await isEnabled(candidate))) continue;
        if (normalize(await candidate.innerText().catch(() => "")) === "单图") matchingModes.push(candidate);
      }
      if (matchingModes.length !== 1) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", `Toutiao single-cover mode was not uniquely discoverable; matches=${matchingModes.length}, candidates=${modeCount}`);
      const mode = matchingModes[0];
      try {
        await mode.click();
      } catch (error) {
        if (!isDetachedFrameError(error)) throw error;
      }
      let coverAddClicked = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        currentEditor = await this.openArticleEditor(rootPage);
        inputs = currentEditor.locator(TOUTIAO_FILE_SELECTOR);
        count = await locatorCount(inputs);
        if (count > 0) break;
        const coverAdd = currentEditor.locator(TOUTIAO_COVER_ADD_SELECTOR);
        const coverAddCount = await locatorCount(coverAdd);
        if (coverAddCount === 1 && !coverAddClicked) {
          coverAddClicked = true;
          const add = await first(coverAdd);
          if (!(await isVisible(add)) || !(await isEnabled(add))) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", "Toutiao cover-add control is not visible and enabled");
          const pageWithChooser = rootPage as unknown as { waitForEvent?: (event: "filechooser", options?: { timeout: number }) => Promise<{ setFiles: (path: string) => Promise<void> }> };
          const chooserPromise = typeof pageWithChooser.waitForEvent === "function" ? pageWithChooser.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null) : null;
          try {
            await add.click();
          } catch (error) {
            if (!isDetachedFrameError(error)) throw error;
          }
          const chooser = chooserPromise ? await chooserPromise : null;
          if (chooser) {
            await chooser.setFiles(coverPath);
            await clickUniqueCoverConfirmation(rootPage, currentEditor);
            currentEditor = await this.openArticleEditor(rootPage);
            return { editor: currentEditor, imageRequirement: "cover_uploaded", coverInputVerified: true, coverUploadMethod: "file_chooser" };
          }
        }
        await waitForNextEditorProbe(currentEditor);
      }
    }
    if (count === 0) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", "Toutiao article cover/image input was not found");
    const input = inputs.first();
    if (!(await isVisible(input)) || !(await isEnabled(input))) throw new BrowserAutomationError("REQUIRED_FIELD_MISSING", "Toutiao article cover/image input is not usable");
    await input.setInputFiles(coverPath);
    await clickUniqueCoverConfirmation(rootPage, currentEditor);
    currentEditor = await this.openArticleEditor(rootPage);
    return { editor: currentEditor, imageRequirement: "cover_uploaded", coverInputVerified: true, coverUploadMethod: "file_input" };
  }

  private async inspectFinalSubmitControl(page: ToutiaoDocument): Promise<{ locator: Locator; evidence: FinalSubmitControlEvidence }> {
    const candidates = page.locator(TOUTIAO_SUBMIT_SELECTOR);
    const count = await locatorCount(candidates);
    const labels: string[] = [];
    let matchedLocator: Locator | null = null;
    let matchedLabel = "";
    let matchedCount = 0;
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await isVisible(candidate))) continue;
      const label = `${await candidate.innerText().catch(() => "")} ${await attr(candidate, "aria-label")} ${await attr(candidate, "title")}`.trim();
      labels.push(label);
      const enabled = await isEnabled(candidate);
      const disabledReason = `${await attr(candidate, "title")} ${await attr(candidate, "aria-label")} ${await attr(candidate, "data-disabled-reason")} ${await attr(candidate, "data-reason")} ${await attr(candidate, "data-tooltip")}`.trim();
      if (!enabled && /(?:发布权限|发文权限|无权发布|无法发布文章|不能发布文章|禁止发文|账号权限)/iu.test(disabledReason)) {
        throw new BrowserAutomationError("PERMISSION_DENIED", `PUBLISH_PERMISSION_DENIED: Toutiao final-submit control is disabled by account permission (${disabledReason})`);
      }
      if (enabled && /(?:publish|submit|\u53d1\u5e03|\u63d0\u4ea4|\u53d1\u8868)/iu.test(label) && !/(?:save|draft|\u4fdd\u5b58|\u8349\u7a3f|\u5b9a\u65f6|schedule)/iu.test(label)) {
        matchedCount += 1;
        matchedLocator = candidate;
        matchedLabel = label;
      }
    }
    if (matchedCount === 1 && matchedLocator) return { locator: matchedLocator, evidence: { verified: true, enabled: true, label: matchedLabel, selector: TOUTIAO_SUBMIT_SELECTOR, clickRequired: false } };
    throw new BrowserAutomationError("FINAL_SUBMIT_CONTROL_NOT_FOUND", `Toutiao final-submit control was not verified; visible labels: ${labels.slice(0, 8).join(" | ")}`);
  }

  private async findPublishedResult(page: Page, article: PublishArticleInput): Promise<ToutiaoPublicResult | null> {
    const pageText = await this.readPageText(page);
    const current = publicResultFromUrl(page.url());
    if (current && containsNormalized(pageText, article.title) && containsNormalized(pageText, article.body)) return current;

    const anchors = page.locator("a[href]");
    const count = await locatorCount(anchors);
    const matches = new Map<string, ToutiaoPublicResult>();
    for (let index = 0; index < count; index += 1) {
      const anchor = await itemAt(anchors, index);
      const result = publicResultFromUrl(await attr(anchor, "href"));
      if (!result) continue;
      const context = `${await anchor.innerText().catch(() => "")} ${pageText}`;
      if (containsNormalized(context, article.title) && containsNormalized(context, article.body)) matches.set(result.publishedUrl, result);
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }

  private async prepareStrict(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join(", "));
    const opened = await this.openBackendPage(ctx, TOUTIAO_CREATOR_HOME);
    const page = opened.page as unknown as Page;
    const accountPreflight = await this.inspectAccountPreflightOnPage(page, { requireIdentity: true, requireArticleEntry: true });
    this.assertAccountPreflightAllowed(accountPreflight);
    let editor: ToutiaoDocument;
    try {
      editor = await this.openArticleEditor(page);
    } catch (error) {
      if (!(error instanceof BrowserAutomationError) || error.code !== "PLATFORM_CHANGED") throw error;
      await page.goto(TOUTIAO_ARTICLE_EDITOR_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      editor = await this.openArticleEditor(page);
    }
    const title = await discover(editor, "title");
    const body = await discover(editor, "body");
    await title.locator.waitFor({ state: "visible", timeout: 10_000 });
    await body.locator.waitFor({ state: "visible", timeout: 10_000 });
    await fillAndRead(title, "title", article.title);
    await fillAndRead(body, "body", article.body);
    const requiredFields = await this.inspectRequiredFields(editor);
    const image = await this.inspectCover(page, editor, article);
    editor = image.editor;
    const finalSubmitControl = await this.inspectFinalSubmitControl(editor);
    this.preparedCoverEvidence.set(this.accountKey(ctx), { uploaded: image.imageRequirement === "cover_uploaded" && image.coverInputVerified, editorUrl: page.url() });
    return {
      prepared: true,
      requiresUserAction: true,
      message: "Toutiao article editor is open; title/body, required fields, cover requirement and final-submit control passed strict readback. Stopped before submit.",
      sessionIdHash: opened.session.sessionIdHash,
      backendUrl: page.url(),
      editorOpenedAt: new Date().toISOString(),
      titleFilled: true,
      bodyFilled: true,
      response: {
        adapter: this.platformKey,
        stage: "editor_prepared",
        automationType: this.automationType,
        browserExecutionMode: opened.session.executionMode,
        headless: opened.session.headless,
        articleEntry: "verified",
        titleDom: title.evidence,
        bodyDom: body.evidence,
        titleReadback: true,
        bodyReadback: true,
        accountPreflight,
        requiredFieldsVerified: requiredFields.verified,
        requiredFields: requiredFields.fields,
        imageRequirement: image.imageRequirement,
        coverInputVerified: image.coverInputVerified,
        coverUploadMethod: image.coverUploadMethod,
        finalSubmitControl: finalSubmitControl.evidence,
        finalSubmit: "user_action_required",
        finalSubmitClickCount: 0
      }
    };
  }

  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> { return this.prepareStrict(ctx, article); }

  async prepareFinalSubmit(ctx: AccountContext, article: PublishArticleInput): Promise<{ response: Record<string, unknown> }> {
    const readiness = await this.verifyFinalSubmitReadiness(ctx, article);
    return { response: { adapter: this.platformKey, stage: "final_submit_preflight", pageUrl: readiness.page.url(), titleReadback: true, bodyReadback: true, accountPreflight: readiness.accountPreflight, requiredFieldsVerified: true, finalSubmitControl: { ...readiness.control.evidence, clickRequired: true }, finalSubmit: "platform_specific_once", finalSubmitClickCount: 0 } };
  }

  async finalSubmit(ctx: AccountContext, article: PublishArticleInput, attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    if (this.finalSubmitUsed.has(attempt.jobId)) throw new BrowserAutomationError("FINAL_SUBMIT_ALREADY_USED", "Toutiao article final submit is limited to one attempt");
    const readiness = await this.verifyFinalSubmitReadiness(ctx, article);
    const beforeUrl = readiness.page.url();
    let finalControl = readiness.control;
    let previewNavigation = false;
    if (/预览并发布/iu.test(readiness.control.evidence.label)) {
      previewNavigation = true;
      try {
        await readiness.control.locator.click();
        await waitForNextEditorProbe(readiness.page);
        await this.assertNoSecurityChallenge(readiness.page);
        finalControl = await this.inspectFinalSubmitControl(readiness.page as unknown as ToutiaoDocument);
      } catch (error) {
        if (error instanceof BrowserAutomationError && error.code === "FINAL_SUBMIT_CONTROL_NOT_FOUND") throw error;
        throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `Toutiao preview navigation did not expose a verified final confirmation: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!/(?:确认发布|confirm\s*publish)/iu.test(finalControl.evidence.label)) throw new BrowserAutomationError("FINAL_SUBMIT_CONTROL_NOT_FOUND", `Toutiao preview exposed an unexpected confirmation control: ${finalControl.evidence.label}`);
    }
    this.finalSubmitUsed.add(attempt.jobId);
    attempt.markSubmissionSideEffect?.();
    const finalBeforeUrl = readiness.page.url();
    try {
      await finalControl.locator.click();
    } catch (error) {
      throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", `Toutiao final submit was triggered but the browser action did not return cleanly: ${error instanceof Error ? error.message : String(error)}`);
    }
    await waitForNextEditorProbe(readiness.page);
    await this.assertNoSecurityChallenge(readiness.page);
    await this.assertNoAccountRestriction(readiness.page);
    const result = await this.findPublishedResult(readiness.page, article);
    if (!result) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "Toutiao final submit was triggered but no reliable public article ID and URL were observed; retry is forbidden");
    return { success: true, status: "published", ...result, response: { adapter: this.platformKey, stage: "final_submitted", beforeUrl, finalBeforeUrl, afterUrl: readiness.page.url(), previewNavigation, previewControlLabel: readiness.control.evidence.label, finalControlLabel: finalControl.evidence.label, finalSubmitCount: 1, submissionIntentId: attempt.submissionIntentId, titleMatch: true, bodyMatch: true, imageUploaded: this.preparedCoverEvidence.get(this.accountKey(ctx))?.uploaded === true } };
  }

  async collectPublishResult(ctx: AccountContext, article: PublishArticleInput, _attempt: BrowserPublishAttemptContext): Promise<PublishResult> {
    const active = await this.activeBackendPage(ctx);
    if (!active) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "Toutiao submission result requires the existing application-owned browser session");
    await this.assertNoSecurityChallenge(active.page as unknown as Page);
    const result = await this.findPublishedResult(active.page as unknown as Page, article);
    if (!result) throw new BrowserAutomationError("SUBMISSION_UNCERTAIN", "Toutiao submission result has no reliable public article ID and URL; retry is forbidden");
    return { success: true, status: "published", ...result, response: { adapter: this.platformKey, stage: "result_collected", pageUrl: active.page.url(), titleMatch: true, bodyMatch: true, imageUploaded: this.preparedCoverEvidence.get(this.accountKey(ctx))?.uploaded === true } };
  }

  async verifyPublished(ctx: AccountContext, article: PublishArticleInput, result: Pick<PublishResult, "externalId" | "publishedUrl">): Promise<PublishStatusResult> {
    const externalId = result.externalId?.trim() ?? "";
    const publishedUrl = result.publishedUrl?.trim() ?? "";
    const parsed = publicResultFromUrl(publishedUrl);
    if (!externalId || !parsed || parsed.externalId !== externalId) return { status: "failed", externalId: externalId || undefined, publishedUrl: publishedUrl || undefined, response: { urlReachable: false, titleMatch: false, bodyMatch: false }, errorCode: "EXTERNAL_EVIDENCE_INCOMPLETE", errorMessage: "Toutiao External ID or public URL is incomplete or inconsistent" };
    const active = await this.activeBackendPage(ctx);
    if (!active) return { status: "failed", externalId, publishedUrl, response: { urlReachable: false, titleMatch: false, bodyMatch: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: "Toutiao public result verification requires the application-owned browser session" };
    const page = active.page as unknown as Page;
    try {
      await page.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForNextEditorProbe(page);
      await this.assertNoSecurityChallenge(page);
      const pageTitle = await (page as unknown as { title?: () => Promise<string> }).title?.() ?? "";
      const pageText = await this.readPageText(page);
      const current = publicResultFromUrl(page.url());
      const urlReachable = Boolean(current && current.externalId === externalId);
      const titleMatch = containsNormalized(`${pageTitle} ${pageText}`, article.title);
      const bodyMatch = containsNormalized(pageText, article.body);
      const published = urlReachable && titleMatch && bodyMatch;
      return { status: published ? "published" : "failed", externalId, publishedUrl: current?.publishedUrl ?? page.url(), response: { adapter: this.platformKey, verificationStatus: published ? "Verified" : "reconciliation_uncertain", urlReachable, titleMatch, bodyMatch, pageUrl: page.url() }, ...(published ? {} : { errorCode: "RECONCILIATION_UNCERTAIN" as const, errorMessage: "Toutiao public page did not prove the exact title, body and stable URL together" }) };
    } catch (error) {
      return { status: "failed", externalId, publishedUrl, response: { adapter: this.platformKey, urlReachable: false, titleMatch: false, bodyMatch: false }, errorCode: "RECONCILIATION_UNCERTAIN", errorMessage: error instanceof Error ? error.message : "Toutiao public result verification failed" };
    }
  }

  async reconcile(ctx: AccountContext, input: BrowserPublishReconciliationInput): Promise<BrowserPublishReconciliationResult> {
    const active = await this.activeBackendPage(ctx);
    if (!active) return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { adapter: this.platformKey, readOnly: true, evidence: "no_active_owned_browser_session" }, message: "当前没有可用于只读回查的应用自建 Browser Session" };
    const page = active.page as unknown as Page;
    try {
      await this.assertNoSecurityChallenge(page);
      const pageText = await this.readPageText(page);
      const current = publicResultFromUrl(page.url());
      const titleMatch = containsNormalized(pageText, input.title);
      const accountMatch = containsNormalized(pageText, input.accountName);
      if (current && titleMatch) return { status: "FOUND_PUBLISHED", externalId: current.externalId, publishedUrl: current.publishedUrl, titleMatch: true, accountMatch, timeWindowMatch: true, response: { adapter: this.platformKey, readOnly: true, pageUrl: page.url(), titleMatch: true, accountMatch, timeWindowMatch: true }, message: "当前公开文章页包含唯一测试标题" };
      return { status: "STILL_UNCERTAIN", titleMatch, accountMatch, timeWindowMatch: false, response: { adapter: this.platformKey, readOnly: true, pageUrl: page.url(), titleMatch, accountMatch, finalSubmitCount: input.finalSubmitCount ?? 0 }, message: "未在当前只读页面取得同时满足标题、账号和时间窗口的稳定文章证据" };
    } catch (error) {
      return { status: "STILL_UNCERTAIN", titleMatch: false, accountMatch: false, timeWindowMatch: false, response: { adapter: this.platformKey, readOnly: true, error: error instanceof Error ? error.message : String(error) }, message: "Toutiao 只读回查失败，结果保持未知" };
    }
  }
}
