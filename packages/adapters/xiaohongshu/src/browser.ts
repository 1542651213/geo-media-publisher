import type { AccountContext, AccountProfile, LoginSession, LoginStatus, PublishArticleInput, ValidationResult } from "@publisher/domain";
import { randomUUID } from "node:crypto";
import type { AutomationPrepareResult, BrowserSession } from "@publisher/adapters-core";
import { BrowserAutomationAdapter, BrowserAutomationError, type BrowserAutomationAdapterOptions, type BrowserPlatformDefinition, type BrowserSessionScopeEvidence } from "@publisher/adapters-browser";
import type { Locator, Page } from "playwright-core";
import { collectXhsAuthStateMetadata, collectXhsPreNavigationAuthStateMetadata, createXhsDiagnosticFingerprintKey, type XhsAuthStateMetadata } from "./auth-state-diagnostics";
import { XhsNavigationDiagnosticsTracker, type XhsNavigationClassification } from "./navigation-diagnostics";

const XIAOHONGSHU_CREATOR_HOME = "https://creator.xiaohongshu.com/";
const XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR = 'a[href*="/publish/publish"]';
const XIAOHONGSHU_VIDEO_POST_ENTRY_SELECTOR = 'a[href*="/publish/video"]';
const XIAOHONGSHU_FILE_SELECTOR = 'input[type="file"]';
const XIAOHONGSHU_PREVIEW_SELECTOR = 'img[class*="preview" i], img[src*="xhscdn" i], [class*="preview" i], [data-testid*="upload-result" i], [class*="uploaded" i]';
const XIAOHONGSHU_UPLOAD_BUSY_SELECTOR = '[aria-busy="true"], [class*="loading" i], [class*="uploading" i], progress';
const XIAOHONGSHU_TITLE_SELECTOR = 'input[placeholder*="标题"], input[aria-label*="标题"], input[name*="title" i], input[id*="title" i]';
const XIAOHONGSHU_TITLE_FALLBACK_SELECTOR = 'textarea[placeholder*="标题"], textarea[aria-label*="标题"], textarea[name*="title" i], textarea[id*="title" i]';
const XIAOHONGSHU_BODY_SELECTOR = '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-placeholder], textarea[aria-label*="正文"], textarea[name*="body" i], textarea[id*="body" i]';
const XIAOHONGSHU_REQUIRED_SELECTOR = 'input[required], textarea[required], select[required], [aria-required="true"]';
const XIAOHONGSHU_SETTINGS_SELECTOR = 'input[type="checkbox"], input[type="radio"], select, [role="checkbox"], [role="radio"], [data-setting]';
const XIAOHONGSHU_FINAL_SUBMIT_SELECTOR = 'button, [role="button"]';
const XIAOHONGSHU_IMAGE_POST_PATTERN = /图文|笔记|image\s*post|image|note/iu;
const XIAOHONGSHU_VIDEO_PATTERN = /视频|video/iu;
const XIAOHONGSHU_FINAL_SUBMIT_PATTERN = /发布(笔记|图文)?|提交|发表|publish|submit/iu;
const DEFAULT_LOGIN_STABILITY_WINDOW_MS = 4000;
const LOGIN_STABILITY_SAMPLE_INTERVAL_MS = 250;

const definition: BrowserPlatformDefinition = {
  platformKey: "xiaohongshu",
  displayName: "小红书",
  category: "图文",
  officialWebsite: "https://www.xiaohongshu.com/",
  developerPortal: "https://miniapp.xiaohongshu.com/",
  backendUrl: XIAOHONGSHU_CREATOR_HOME,
  officialSources: ["https://creator.xiaohongshu.com/", "https://miniapp.xiaohongshu.com/"],
  version: "1.0.0",
  researchStatus: "partial",
  blockingReason: "BrowserAutomation 只验证账号、图文编辑器和最终发布控件；本 gate-only 流程不会点击最终发布，也不声明真实发布通过。",
  capabilities: {
    article: true,
    imagePost: true,
    video: false,
    coverImage: false,
    tags: true,
    categories: false,
    scheduledPublish: false,
    draft: false,
    markdown: false,
    richText: true,
    maxTitleLength: 1000,
    maxImageCount: 18,
    maxTagCount: 10,
    supportsVideoCover: false,
    supportsVideoTags: false,
    videoPublishAsync: false
  }
};

export type XiaohongshuGateCode =
  | "LOGIN_REQUIRED"
  | "SECURITY_VERIFICATION_REQUIRED"
  | "ACCOUNT_IDENTITY_UNVERIFIED"
  | "IMAGE_POST_ENTRY_NOT_VERIFIED"
  | "IMAGE_UPLOAD_NOT_VERIFIED"
  | "CONTENT_TITLE_NOT_VERIFIED"
  | "CONTENT_BODY_NOT_VERIFIED"
  | "FINAL_SUBMIT_CONTROL_NOT_VERIFIED"
  | "REQUIRED_FIELDS_NOT_VERIFIED";

export interface XiaohongshuFinalSubmitControlEvidence {
  verified: boolean;
  visible: boolean;
  enabled: boolean;
  unique: boolean;
  label: string;
  selector: string;
  secondConfirmation: "present" | "absent" | "unknown";
}

export interface XiaohongshuAccountIdentityEvidence {
  externalAccountId: string | null;
  displayName: string | null;
  profileUrl: string | null;
}

export interface XiaohongshuLoginEvidence {
  available: boolean;
  url: string;
  creatorHost: boolean;
  creatorHomePath: boolean;
  explicitLoginUrl: boolean;
  verificationUrl: boolean;
  publishNoteVisible: boolean;
  noteManagementVisible: boolean;
  dataDashboardVisible: boolean;
  accountStatusVisible: boolean;
  profileAreaVisible: boolean;
  visibleLoginForm: boolean;
  visibleQrLogin: boolean;
  visibleSmsVerification: boolean;
  visibleCaptcha: boolean;
  visibleSlider: boolean;
  visibleSecurityModal: boolean;
  positiveSignals: string[];
  blockingSignals: string[];
}

export interface XiaohongshuPageEvidence {
  available: boolean;
  bodyPresent: boolean;
  bodyTextLength: number;
  login: XiaohongshuLoginEvidence;
  identity: XiaohongshuAccountIdentityEvidence & { externalAccountIdCandidates: string[] };
}

export type XiaohongshuLoginDecision = "logged_in" | "needs_user_action" | "login_required" | "unknown";

export interface XiaohongshuLoginEvaluation {
  phase: "CHECK_LOGIN" | "COMPLETE_LOGIN_CHECK";
  timestamp: string;
  platformKey: string;
  accountId: string;
  pageIsClosed: boolean;
  pageUrl: string;
  pageTitle: string;
  creatorDomain: boolean;
  creatorHomePath: boolean;
  publishNoteVisible: boolean;
  noteManagementVisible: boolean;
  dataDashboardVisible: boolean;
  accountStatusVisible: boolean;
  profileAreaVisible: boolean;
  visibleLoginForm: boolean;
  visibleQrLogin: boolean;
  visibleSmsVerification: boolean;
  visibleCaptcha: boolean;
  visibleSlider: boolean;
  visibleSecurityModal: boolean;
  positiveSignalCount: number;
  blockingSignalCount: number;
  loginClassification: XiaohongshuLoginDecision;
  stableObservationWindowMs: number;
  stableObservationSamples: number;
  stableObservationPassed: boolean;
}

export type XiaohongshuAuthStateDiagnosticPhase = "LIVE_LOGIN_BEFORE_CLOSE" | "AUTH_STATE_BEFORE_CLOSE";

export interface XiaohongshuAuthStateDiagnostic {
  phase: XiaohongshuAuthStateDiagnosticPhase;
  timestamp: string;
  platformKey: string;
  accountId: string;
  sessionKey: string;
  sessionIdHash: string;
  storageMode: BrowserSession["storageMode"];
  profilePath: string | null;
  sessionEvidence: BrowserSessionScopeEvidence;
  authState: XhsAuthStateMetadata | null;
  stableObservationWindowMs: number | null;
  stableObservationSamples: number | null;
  stableObservationPassed: boolean | null;
  credentialSnapshotInjected: boolean;
  error: { name: string; message: string } | null;
}

export interface XiaohongshuRestoreNavigationDiagnostic {
  platformKey: "xiaohongshu";
  accountId: string;
  sessionEvidence: BrowserSessionScopeEvidence;
  preNavigation: XhsAuthStateMetadata;
  afterNavigation: XhsAuthStateMetadata;
  navigation: XhsNavigationClassification;
  loginStatus: LoginStatus;
  sameContextPageOwnership: boolean;
  sameContextPage: XiaohongshuSameContextPageDiagnostic;
}

export interface XiaohongshuSameContextPageDiagnostic {
  platformKey: "xiaohongshu";
  accountId: string;
  contextDebugId: string;
  originalPageDebugId: string;
  originalPageClosed: boolean;
  newPageOwnedByContext: boolean;
  pageCountBefore: number;
  pageCountAfter: number;
  newPageUrl: string;
}

export interface XiaohongshuBrowserAdapterOptions extends BrowserAutomationAdapterOptions {
  onLoginEvaluation?: (evaluation: XiaohongshuLoginEvaluation) => void;
  onAuthStateDiagnostic?: (diagnostic: XiaohongshuAuthStateDiagnostic) => void;
  credentialFilePath?: string;
  loginStabilityWindowMs?: number;
}

export function classifyXiaohongshuLoginEvidence(evidence: XiaohongshuLoginEvidence): XiaohongshuLoginDecision {
  if (evidence.explicitLoginUrl || evidence.visibleLoginForm) return "login_required";
  if (evidence.verificationUrl) return "needs_user_action";
  if (evidence.blockingSignals.length > 0) return "needs_user_action";
  if (evidence.creatorHost && !evidence.explicitLoginUrl && new Set(evidence.positiveSignals).size >= 2) return "logged_in";
  return "unknown";
}

export class XiaohongshuGateError extends BrowserAutomationError {
  readonly gateCode: XiaohongshuGateCode;

  constructor(code: XiaohongshuGateCode, adapterCode: ConstructorParameters<typeof BrowserAutomationError>[0], message: string) {
    super(adapterCode, `${code}: ${message}`);
    this.name = "XiaohongshuGateError";
    this.gateCode = code;
  }
}

type XhsDocument = Page | { locator: (selector: string) => Locator; url: () => string };

function locatorCount(locator: Locator): Promise<number> {
  const candidate = locator as unknown as { count?: () => Promise<number> };
  return typeof candidate.count === "function" ? candidate.count() : Promise.resolve(1);
}

function locatorAt(locator: Locator, index: number): Locator {
  const candidate = locator as unknown as { nth?: (position: number) => Locator; first?: () => Locator };
  if (typeof candidate.nth === "function") return candidate.nth(index);
  if (index === 0 && typeof candidate.first === "function") return candidate.first();
  return locator;
}

async function isVisible(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isVisible?: () => Promise<boolean> };
  return typeof candidate.isVisible === "function" ? candidate.isVisible().catch(() => false) : true;
}

async function isEnabled(locator: Locator): Promise<boolean> {
  const candidate = locator as unknown as { isEnabled?: () => Promise<boolean> };
  return typeof candidate.isEnabled === "function" ? candidate.isEnabled().catch(() => false) : true;
}

async function attribute(locator: Locator, name: string): Promise<string> {
  const candidate = locator as unknown as { getAttribute?: (attributeName: string) => Promise<string | null> };
  if (typeof candidate.getAttribute !== "function") return "";
  return (await candidate.getAttribute(name).catch(() => null))?.trim() ?? "";
}

async function innerText(locator: Locator): Promise<string> {
  const candidate = locator as unknown as { innerText?: () => Promise<string>; textContent?: () => Promise<string | null> };
  if (typeof candidate.innerText === "function") return candidate.innerText().catch(() => "");
  if (typeof candidate.textContent === "function") return candidate.textContent().then((value) => value ?? "").catch(() => "");
  return "";
}

async function inputValue(locator: Locator): Promise<string> {
  const candidate = locator as unknown as { inputValue?: () => Promise<string> };
  return typeof candidate.inputValue === "function" ? candidate.inputValue().catch(() => "") : innerText(locator);
}

export function normalizeXiaohongshuEditorText(value: string): string {
  const stripped = Array.from(value.normalize("NFKC")).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code === 0x0a || code === 0x0d) || (code > 0x1f && code !== 0x7f && code !== 0xad && code !== 0x200b && code !== 0x200c && code !== 0x200d && code !== 0x2060 && code !== 0xfeff);
  }).join("");
  return stripped.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/[ ]+/gu, " ").trim();
}

function stableExternalAccountId(href: string): string | null {
  try {
    const url = new URL(href, XIAOHONGSHU_CREATOR_HOME);
    const match = url.pathname.match(/\/user\/profile\/([^/?#]+)/iu) ?? url.pathname.match(/\/user\/([^/?#]+)/iu);
    const value = match?.[1]?.trim() ?? "";
    return value && !/^(?:profile|home|index)$/iu.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function bodyText(page: XhsDocument): Promise<string> {
  return innerText(page.locator("body"));
}

function emptyPageEvidence(page: XhsDocument): XiaohongshuPageEvidence {
  const url = page.url();
  return {
    available: false,
    bodyPresent: true,
    bodyTextLength: 0,
    login: { available: false, url, creatorHost: false, creatorHomePath: false, explicitLoginUrl: /\/login(?:[/?#]|$)|\/signin(?:[/?#]|$)|passport|auth/iu.test(url), verificationUrl: /captcha|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(url), publishNoteVisible: false, noteManagementVisible: false, dataDashboardVisible: false, accountStatusVisible: false, profileAreaVisible: false, visibleLoginForm: false, visibleQrLogin: false, visibleSmsVerification: false, visibleCaptcha: false, visibleSlider: false, visibleSecurityModal: false, positiveSignals: [], blockingSignals: [] },
    identity: { externalAccountId: null, externalAccountIdCandidates: [], displayName: null, profileUrl: null }
  };
}

async function readXiaohongshuPageEvidence(page: Page): Promise<XiaohongshuPageEvidence> {
  const candidate = page as unknown as { evaluate?: <T>(pageFunction: () => T) => Promise<T> };
  if (typeof candidate.evaluate !== "function") return emptyPageEvidence(page);
  try {
    return await candidate.evaluate(() => {
      const compact = (value: string): string => value.normalize("NFKC").replace(/[\s]+/gu, " ").trim();
      const verificationPattern = /captcha|human|security|risk|验证码|人机|安全验证|风控|滑块|二维码|扫码/iu;
      const loginPattern = /登录|验证码|手机号|短信|密码/iu;
      const visible = (element: Element): boolean => {
        const node = element as HTMLElement;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
      };
      const textOf = (element: Element): string => compact((element as HTMLElement).innerText || element.textContent || "");
      const descriptorOf = (element: Element): string => compact([
        element.getAttribute("aria-label") || "",
        element.getAttribute("placeholder") || "",
        element.getAttribute("title") || "",
        element.getAttribute("name") || "",
        element.getAttribute("id") || "",
        element.getAttribute("class") || "",
        element.getAttribute("data-testid") || "",
        textOf(element)
      ].join(" "));
      const elements = Array.from(document.querySelectorAll("*"))
        .filter((element) => visible(element));
      const visibleTextContains = (pattern: RegExp): boolean => elements.some((element) => pattern.test(textOf(element)));
      const positiveSignals: string[] = [];
      if (visibleTextContains(/发布笔记/iu)) positiveSignals.push("发布笔记");
      if (visibleTextContains(/笔记管理/iu)) positiveSignals.push("笔记管理");
      if (visibleTextContains(/数据看板/iu)) positiveSignals.push("数据看板");
      if (visibleTextContains(/小红书创作服务平台/iu)) positiveSignals.push("创作服务平台");
      if (visibleTextContains(/账号状态正常/iu)) positiveSignals.push("账号状态正常");

      const externalAccountIdCandidates: string[] = [];
      const profileLinks: Array<{ id: string; url: string; name: string }> = [];
      const names: string[] = [];
      const addName = (value: string): void => {
        const name = compact(value).replace(/^(?:昵称|账号昵称)[:：]?/iu, "").trim();
        if (!name || /^(?:昵称|账号昵称|小红书账号|账号状态正常)$/iu.test(name) || name.length > 100) return;
        if (!names.includes(name)) names.push(name);
      };
      const accountIdFromText = (value: string): string | null => {
        const match = compact(value).match(/小红书账号(?:\s*(?:ID|id))?\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,63})/u);
        return match?.[1] ?? null;
      };
      const stableIdFromHref = (href: string): string | null => {
        try {
          const parsed = new URL(href, location.href);
          const match = parsed.pathname.match(/\/user\/profile\/([^/?#]+)/iu) ?? parsed.pathname.match(/\/user\/([^/?#]+)/iu);
          const value = match?.[1]?.trim() ?? "";
          return value && !/^(?:profile|home|index)$/iu.test(value) ? value : null;
        } catch {
          return null;
        }
      };
      for (const element of elements) {
        const descriptor = descriptorOf(element);
        let current: Element | null = element;
        for (let depth = 0; depth < 5 && current; depth += 1, current = current.parentElement) {
          const text = textOf(current);
          if (text.length <= 240) {
            const id = accountIdFromText(text);
            if (id && !externalAccountIdCandidates.includes(id)) externalAccountIdCandidates.push(id);
            const nickname = text.match(/(?:昵称|账号昵称)\s*[:：]?\s*([^|｜\n]{2,100})/iu)?.[1];
            if (nickname) addName(nickname);
          }
        }
        if (/nickname|账号昵称|昵称|个人主页/iu.test(descriptor)) {
          const text = textOf(element);
          const nickname = text.match(/(?:昵称|账号昵称)\s*[:：]?\s*([^|｜\n]{2,100})/iu)?.[1];
          if (nickname) addName(nickname);
          else if (text && !/nickname|账号昵称|昵称|个人主页/iu.test(text)) addName(text);
        }
        if (element.tagName.toLowerCase() === "a") {
          const href = element.getAttribute("href") || "";
          const id = stableIdFromHref(href);
          if (id) {
            const url = new URL(href, location.href).toString();
            profileLinks.push({ id, url, name: textOf(element) });
            if (!externalAccountIdCandidates.includes(id)) externalAccountIdCandidates.push(id);
            addName(textOf(element));
          }
        }
      }
      const distinctNames = [...new Set(names)];
      if (distinctNames.length > 0) positiveSignals.push("账号身份");

      const blockingSignals: string[] = [];
      let visibleLoginForm = false;
      const inputs = elements.filter((element) => /^(INPUT|TEXTAREA|SELECT)$/u.test(element.tagName));
      const visibleVerificationInput = inputs.some((element) => {
        const descriptor = descriptorOf(element);
        return /验证码|短信|手机号|密码/iu.test(descriptor);
      });
      const visibleForms = elements.filter((element) => element.tagName.toLowerCase() === "form");
      if (visibleForms.some((form) => loginPattern.test(descriptorOf(form)) && form.querySelectorAll("input,textarea,select").length > 0)) visibleLoginForm = true;
      const visibleSmsVerification = inputs.some((element) => /验证码|短信|手机号/iu.test(descriptorOf(element)));
      if (visibleVerificationInput) blockingSignals.push("visible_verification_input");
      const visibleSecurityModal = elements.some((element) => {
        const descriptor = descriptorOf(element);
        const role = element.getAttribute("role") || "";
        const modal = role === "dialog" || element.getAttribute("aria-modal") === "true" || /modal|dialog|overlay|popup/iu.test(element.getAttribute("class") || "") || /modal|dialog|overlay|popup/iu.test(element.getAttribute("id") || "");
        return modal && verificationPattern.test(descriptor);
      });
      if (visibleSecurityModal) blockingSignals.push("visible_security_modal");
      const visibleChallengeElements = elements.filter((element) => {
        const descriptor = descriptorOf(element);
        const tag = element.tagName.toLowerCase();
        const verificationContainer = /captcha|slider|security|risk|二维码|\bqr\b/iu.test(descriptor);
        const visualChallenge = tag === "iframe" || tag === "canvas" || tag === "img" || /滑块|验证码|安全验证|二维码|扫码|captcha|slider/iu.test(descriptor);
        return verificationContainer && visualChallenge && verificationPattern.test(descriptor);
      });
      const visibleCaptcha = visibleChallengeElements.some((element) => /captcha|验证码/iu.test(descriptorOf(element)));
      const visibleSlider = visibleChallengeElements.some((element) => /slider|滑块/iu.test(descriptorOf(element)));
      if (visibleChallengeElements.length > 0) blockingSignals.push("visible_captcha_or_slider");
      const visibleQrLogin = elements.some((element) => {
        const descriptor = descriptorOf(element);
        return /二维码|扫码|\bqr\b/iu.test(descriptor) && /登录|验证/iu.test(descriptor) && /IMG|CANVAS|IFRAME/u.test(element.tagName);
      });
      if (visibleQrLogin) blockingSignals.push("visible_qr_login");

      const url = location.href;
      const parsedUrl = new URL(url);
      const creatorHost = parsedUrl.hostname.toLowerCase() === "creator.xiaohongshu.com";
      const creatorHomePath = /^\/(?:new\/home)?$/iu.test(parsedUrl.pathname);
      const explicitLoginUrl = /\/(?:login|signin|auth|passport)(?:[/?#]|$)/iu.test(parsedUrl.pathname);
      const verificationUrl = /captcha|security[-_/]?check|sms[-_/]?verify|qr[-_/]?login|risk[-_/]?control/iu.test(url);
      const profile = profileLinks.find((candidate) => candidate.id === externalAccountIdCandidates[0]);
      return {
        available: true,
        bodyPresent: Boolean(document.body),
        bodyTextLength: document.body?.innerText.length ?? 0,
        login: { available: true, url, creatorHost, creatorHomePath, explicitLoginUrl, verificationUrl, publishNoteVisible: positiveSignals.includes("发布笔记"), noteManagementVisible: positiveSignals.includes("笔记管理"), dataDashboardVisible: positiveSignals.includes("数据看板"), accountStatusVisible: positiveSignals.includes("账号状态正常"), profileAreaVisible: distinctNames.length > 0 || externalAccountIdCandidates.length > 0 || profileLinks.length > 0, visibleLoginForm, visibleQrLogin, visibleSmsVerification, visibleCaptcha, visibleSlider, visibleSecurityModal, positiveSignals: [...new Set(positiveSignals)], blockingSignals: [...new Set(blockingSignals)] },
        identity: { externalAccountId: externalAccountIdCandidates.length === 1 ? externalAccountIdCandidates[0] : null, externalAccountIdCandidates: [...new Set(externalAccountIdCandidates)], displayName: distinctNames.length === 1 ? distinctNames[0] : (profile?.name ? compact(profile.name) : null), profileUrl: profile?.url ?? null }
      };
    });
  } catch {
    return emptyPageEvidence(page);
  }
}

async function waitForProbe(page: XhsDocument, milliseconds = 250): Promise<void> {
  const candidate = page as unknown as { waitForTimeout?: (timeout: number) => Promise<void> };
  if (typeof candidate.waitForTimeout === "function") await candidate.waitForTimeout(milliseconds);
}

async function readEditor(locator: Locator, field: "title" | "body"): Promise<string> {
  const value = field === "title" ? await inputValue(locator) : await innerText(locator);
  return normalizeXiaohongshuEditorText(value);
}

export function classifyXiaohongshuPublishSettings(settings: Array<{ label: string; required: boolean; value: string }>): "KNOWN" | "UNKNOWN" {
  return settings.every((setting) => setting.label.trim().length > 0 && typeof setting.required === "boolean") ? "KNOWN" : "UNKNOWN";
}

export class XiaohongshuBrowserAdapter extends BrowserAutomationAdapter {
  private readonly onLoginEvaluation?: (evaluation: XiaohongshuLoginEvaluation) => void;
  private readonly onAuthStateDiagnostic?: (diagnostic: XiaohongshuAuthStateDiagnostic) => void;
  private readonly credentialFilePath: string | null;
  private readonly loginStabilityWindowMs: number;
  /** Replaced at the start of each login/restore diagnostic run; never emitted or persisted. */
  private authStateFingerprintKey: Uint8Array | null = null;

  constructor(options: XiaohongshuBrowserAdapterOptions = {}) {
    super(definition, options);
    this.onLoginEvaluation = options.onLoginEvaluation;
    this.onAuthStateDiagnostic = options.onAuthStateDiagnostic;
    this.credentialFilePath = options.credentialFilePath ?? null;
    this.loginStabilityWindowMs = Math.max(0, options.loginStabilityWindowMs ?? DEFAULT_LOGIN_STABILITY_WINDOW_MS);
  }

  override async connectAccount(ctx: AccountContext): Promise<LoginSession> {
    this.authStateFingerprintKey = createXhsDiagnosticFingerprintKey();
    return super.connectAccount(ctx);
  }

  override async validateArticle(article: PublishArticleInput): Promise<ValidationResult> {
    const base = await super.validateArticle(article);
    const errors = [...base.errors];
    if ((article.images?.length ?? 0) < 1) errors.push("小红书图文至少需要一张图片");
    if (article.coverPath) errors.push("小红书图文 gate 不接受额外封面字段");
    return { ...base, valid: errors.length === 0, errors };
  }

  override async checkLogin(ctx: AccountContext): Promise<LoginStatus> {
    const active = await this.activeBackendPage(ctx);
    if (active) return this.loginStatusForPage(ctx, active.page, "CHECK_LOGIN");
    if (!this.sessionManager.hasStoredSession({ platformKey: this.platformKey, accountId: ctx.accountId })) return "needs_user_action";
    const status = await super.checkLogin(ctx);
    if (status !== "logged_in") return status;
    const checked = await this.activeBackendPage(ctx);
    return checked ? this.loginStatusForPage(ctx, checked.page, "CHECK_LOGIN") : status;
  }

  async getAccountProfile(ctx: AccountContext): Promise<AccountProfile> {
    const active = await this.activeBackendPage(ctx);
    let opened: { page: Page; session: BrowserSession };
    if (active) opened = active;
    else {
      if (!this.sessionManager.hasStoredSession({ platformKey: this.platformKey, accountId: ctx.accountId })) throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书账号没有已保存的浏览器 Session，请先完成登录");
      try {
        opened = await this.openBackendPage(ctx, XIAOHONGSHU_CREATOR_HOME);
      } catch (error) {
        if (error instanceof BrowserAutomationError && error.code === "LOGIN_EXPIRED") throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书浏览器 Session 已过期，请重新登录");
        throw error;
      }
    }
    const evidence = await readXiaohongshuPageEvidence(opened.page);
    this.assertProfilePageCanBeRead(evidence);
    const identity = await this.inspectAccountIdentity(opened.page, evidence);
    return {
      ...(identity.externalAccountId ? { accountId: identity.externalAccountId } : {}),
      ...(identity.displayName ? { accountName: identity.displayName } : {}),
      authorizationStatus: "Authorized"
    };
  }

  override async preparePublish(ctx: AccountContext, article: PublishArticleInput): Promise<AutomationPrepareResult> {
    const validation = await this.validateArticle(article);
    if (!validation.valid) throw new BrowserAutomationError("CONTENT_REJECTED", validation.errors.join("；"));

    const opened = await this.openBackendPage(ctx, XIAOHONGSHU_CREATOR_HOME);
    const page = opened.page;
    const evidence = await readXiaohongshuPageEvidence(page);
    this.assertProfilePageCanBeRead(evidence);
    const gates: string[] = ["account_identity"];
    const identity = await this.inspectAccountIdentity(page, evidence);

    const entry = await this.discoverImagePostEntry(page);
    await entry.click();
    gates.push("login", "image_post_entry");
    await waitForProbe(page);
    const imageEvidence = await this.uploadImages(page, article.images ?? []);
    gates.push("image_upload");

    const title = await this.discoverUniqueEditor(page, "title");
    gates.push("title_editor", "title_write");
    await title.fill(article.title);
    const titleReadback = await readEditor(title, "title");
    if (titleReadback !== normalizeXiaohongshuEditorText(article.title)) throw new XiaohongshuGateError("CONTENT_TITLE_NOT_VERIFIED", "CONTENT_REJECTED", "标题 strict readback 与请求内容不一致");
    gates.push("title_readback");

    const body = await this.discoverUniqueEditor(page, "body");
    gates.push("body_editor", "body_write");
    await body.fill(article.body);
    const bodyReadback = await readEditor(body, "body");
    if (bodyReadback !== normalizeXiaohongshuEditorText(article.body)) throw new XiaohongshuGateError("CONTENT_BODY_NOT_VERIFIED", "CONTENT_REJECTED", "正文 strict readback 与请求内容不一致");
    gates.push("body_readback");

    const requiredFields = await this.inspectRequiredFields(page);
    if (requiredFields.some((field) => field.empty)) throw new XiaohongshuGateError("REQUIRED_FIELDS_NOT_VERIFIED", "REQUIRED_FIELD_MISSING", `存在未填写必填字段：${requiredFields.filter((field) => field.empty).map((field) => field.label || "未命名字段").join("、")}`);
    gates.push("required_fields");

    const publishSettings = await this.inspectPublishSettings(page);
    gates.push("publish_settings");
    const finalSubmitControl = await this.inspectFinalSubmitControl(page);
    gates.push("final_submit_control_discovery");

    return {
      prepared: true,
      requiresUserAction: true,
      message: "小红书图文 gate-only 已完成真实页面证据校验；已停止在最终发布控件 discovery 之后，未点击发布。",
      sessionIdHash: opened.session.sessionIdHash,
      backendUrl: page.url(),
      editorOpenedAt: new Date().toISOString(),
      titleFilled: true,
      bodyFilled: true,
      response: {
        adapter: this.platformKey,
        automationType: this.automationType,
        stage: "xiaohongshu_gate_only",
        gateOrder: gates,
        accountIdentity: identity,
        login: "PASS",
        imagePostEntry: "verified",
        imageUploaded: true,
        imageUploadEvidence: imageEvidence,
        titleEditor: "verified",
        titleReadback: true,
        titleReadbackValue: titleReadback,
        bodyEditor: "verified",
        bodyReadback: true,
        bodyReadbackValue: bodyReadback,
        requiredFieldsStatus: "KNOWN",
        requiredFields,
        publishSettingsStatus: classifyXiaohongshuPublishSettings(publishSettings),
        publishSettings,
        finalSubmitControl,
        finalSubmitClickCount: 0,
        finalSubmit: "discovered_but_not_clicked",
        securityVerification: "NONE",
        publishPassed: "NOT_PASS",
        jobCreated: false,
        intentCreated: false,
        publishRecordCreated: false
      }
    };
  }

  protected override async inspectConnectionPage(ctx: AccountContext, page: Page): Promise<LoginStatus> {
    return this.loginStatusForPage(ctx, page, "COMPLETE_LOGIN_CHECK");
  }

  protected override deferConnectionPersistence(_ctx: AccountContext): boolean { return true; }

  async persistConnectionSession(ctx: AccountContext): Promise<void> {
    await this.saveConnectionSession(ctx);
    await this.emitAuthStateDiagnostic(ctx, "AUTH_STATE_BEFORE_CLOSE", null, null, null);
    this.markConnectionComplete({ platformKey: this.platformKey, accountId: ctx.accountId });
  }

  async releaseConnectionPage(ctx: AccountContext): Promise<void> {
    const identity = { platformKey: this.platformKey, accountId: ctx.accountId };
    const session = this.activeBrowserSession(ctx);
    if (!session) throw new BrowserAutomationError("USER_ACTION_REQUIRED", `ACTIVE_LOGIN_SESSION_NOT_FOUND: accountId=${ctx.accountId} 的可见登录 Session 已丢失，请重新开始连接`);
    await this.sessionManager.closeOperationPage(identity, session.page);
    const retained = this.activeBrowserSession(ctx) === session;
    this.markConnectionComplete(identity);
    await this.emitConnectionDiagnostic("LOGIN_PAGE_RELEASED", ctx, session, retained);
  }

  /** Diagnostic-only snapshot of the already-open account-scoped session. It never navigates or mutates the page. */
  async collectAuthStateMetadata(ctx: AccountContext): Promise<XhsAuthStateMetadata | null> {
    const session = this.activeBrowserSession(ctx);
    if (!session) return null;
    const page = await this.page(session);
    return collectXhsAuthStateMetadata({ context: session.context, page, profilePath: session.profilePath, credentialFilePath: this.credentialFilePath, fingerprintKey: this.diagnosticFingerprintKey(), browserChannel: session.browserChannel ?? null, headless: session.headless, storageMode: session.storageMode });
  }

  /** Opens the account-owned BrowserSession without navigating; diagnostic runner only. */
  async openDiagnosticSession(ctx: AccountContext): Promise<{ session: BrowserSession; page: Page }> {
    const session = this.diagnosticBrowserSession(ctx) ?? await this.getOrOpen(ctx);
    if (!session) throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书没有 account-scoped BrowserSession");
    return { session, page: await this.page(session) };
  }

  /** Rotates only the Page inside the existing account-owned Context for restart diagnosis. */
  async openSameContextDiagnosticPage(ctx: AccountContext): Promise<XiaohongshuSameContextPageDiagnostic> {
    const { session, page } = await this.openDiagnosticSession(ctx);
    const before = session.context.pages().length;
    const originalPageDebugId = session.pageDebugId ?? "unknown";
    await page.close();
    const newPage = await session.context.newPage();
    const after = session.context.pages().length;
    const newPageOwnedByContext = session.context.pages().includes(newPage);
    await this.navigate(newPage, XIAOHONGSHU_CREATOR_HOME);
    session.page = newPage;
    session.pageDebugId = randomUUID();
    const result: XiaohongshuSameContextPageDiagnostic = {
      platformKey: "xiaohongshu",
      accountId: ctx.accountId,
      contextDebugId: session.contextDebugId ?? "unknown",
      originalPageDebugId,
      originalPageClosed: true,
      newPageOwnedByContext,
      pageCountBefore: before,
      pageCountAfter: after,
      newPageUrl: newPage.url()
    };
    return result;
  }

  /** One navigation-only restore probe. It never opens the publish editor or creates a publishing row. */
  async runRestoreNavigationDiagnostic(ctx: AccountContext): Promise<XiaohongshuRestoreNavigationDiagnostic> {
    this.authStateFingerprintKey = createXhsDiagnosticFingerprintKey();
    const { session, page } = await this.openDiagnosticSession(ctx);
    const tracker = new XhsNavigationDiagnosticsTracker();
    let trackedPage = page;
    try {
      const fingerprintKey = this.diagnosticFingerprintKey();
      const preNavigation = await collectXhsPreNavigationAuthStateMetadata({ context: session.context, profilePath: session.profilePath, credentialFilePath: this.credentialFilePath, fingerprintKey, browserChannel: session.browserChannel ?? null, headless: session.headless, storageMode: session.storageMode });
      const pageCountBefore = session.context.pages().length;
      const originalPageDebugId = session.pageDebugId ?? "unknown";
      await page.close();
      const newPage = await session.context.newPage();
      const pageCountAfter = session.context.pages().length;
      const newPageOwnedByContext = session.context.pages().includes(newPage);
      session.page = newPage;
      session.pageDebugId = randomUUID();
      trackedPage = newPage;
      tracker.attach(newPage);
      await this.navigate(newPage, XIAOHONGSHU_CREATOR_HOME);
      const loginStatus = await this.loginStatusForPage(ctx, newPage, "CHECK_LOGIN");
      const afterNavigation = await collectXhsAuthStateMetadata({ context: session.context, page: newPage, profilePath: session.profilePath, credentialFilePath: this.credentialFilePath, fingerprintKey, browserChannel: session.browserChannel ?? null, headless: session.headless, storageMode: session.storageMode });
      const sessionEvidence = await this.getBrowserSessionEvidence(ctx);
      if (!sessionEvidence) throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "恢复诊断期间 account-scoped Session evidence 丢失");
      return { platformKey: "xiaohongshu", accountId: ctx.accountId, sessionEvidence, preNavigation, afterNavigation, navigation: tracker.classify(), loginStatus, sameContextPageOwnership: newPageOwnedByContext, sameContextPage: { platformKey: "xiaohongshu", accountId: ctx.accountId, contextDebugId: session.contextDebugId ?? "unknown", originalPageDebugId, originalPageClosed: true, newPageOwnedByContext, pageCountBefore, pageCountAfter, newPageUrl: newPage.url() } };
    } finally {
      tracker.detach(trackedPage);
    }
  }

  protected override keepConnectionSessionOpenAfterCompletion(_ctx: AccountContext): boolean { return true; }

  protected override keepConnectionPageForCompletion(_ctx: AccountContext): boolean { return true; }

  private async loginStatusForPage(ctx: AccountContext, page: Page, phase: XiaohongshuLoginEvaluation["phase"]): Promise<LoginStatus> {
    // Creator performs client-side redirects after the initial DOM navigation.
    // Give that redirect a bounded opportunity to settle before accepting a
    // logged-in result; otherwise a home-page probe can race a later /login.
    await waitForProbe(page);
    const pageUrl = page.url();
    if (this.isLoginPage(pageUrl)) {
      await this.emitLoginEvaluation(ctx, page, emptyPageEvidence(page), "login_required", phase);
      return "expired";
    }
    if (this.isVerificationUrl(pageUrl)) {
      await this.emitLoginEvaluation(ctx, page, emptyPageEvidence(page), "needs_user_action", phase);
      return "needs_user_action";
    }
    const evidence = await readXiaohongshuPageEvidence(page);
    let decision = evidence.available ? classifyXiaohongshuLoginEvidence(evidence.login) : "unknown";
    let stableObservationWindowMs = 0;
    let stableObservationSamples = 0;
    let stableObservationPassed = false;
    if (!evidence.available) {
      decision = "logged_in";
      stableObservationSamples = 1;
      stableObservationPassed = true;
    } else if (decision === "logged_in") {
      const stable = await this.observeStableLogin(page, evidence);
      decision = stable.decision;
      stableObservationWindowMs = stable.windowMs;
      stableObservationSamples = stable.samples;
      stableObservationPassed = stable.passed;
      if (stable.evidence !== evidence) {
        await this.emitLoginEvaluation(ctx, page, stable.evidence, decision, phase, stableObservationWindowMs, stableObservationSamples, stableObservationPassed);
        if (decision === "logged_in" && phase === "COMPLETE_LOGIN_CHECK" && this.isConnectionPending(ctx)) {
          await this.emitAuthStateDiagnostic(ctx, "LIVE_LOGIN_BEFORE_CLOSE", stableObservationWindowMs, stableObservationSamples, stableObservationPassed);
        }
        return this.loginStatusFromDecision(decision);
      }
    }
    await this.emitLoginEvaluation(ctx, page, evidence, decision, phase, stableObservationWindowMs, stableObservationSamples, stableObservationPassed);
    if (decision === "logged_in" && phase === "COMPLETE_LOGIN_CHECK" && this.isConnectionPending(ctx)) {
      await this.emitAuthStateDiagnostic(ctx, "LIVE_LOGIN_BEFORE_CLOSE", stableObservationWindowMs, stableObservationSamples, stableObservationPassed);
    }
    if (!evidence.available) return "logged_in";
    return this.loginStatusFromDecision(decision);
  }

  private loginStatusFromDecision(decision: XiaohongshuLoginDecision): LoginStatus {
    if (decision === "logged_in") return "logged_in";
    if (decision === "login_required") return "expired";
    if (decision === "needs_user_action") return "needs_user_action";
    return "needs_user_action";
  }

  private async observeStableLogin(page: Page, initialEvidence: XiaohongshuPageEvidence): Promise<{ decision: XiaohongshuLoginDecision; evidence: XiaohongshuPageEvidence; windowMs: number; samples: number; passed: boolean }> {
    const candidate = page as unknown as { waitForTimeout?: (timeout: number) => Promise<void> };
    if (this.loginStabilityWindowMs === 0 || typeof candidate.waitForTimeout !== "function") {
      return { decision: "logged_in", evidence: initialEvidence, windowMs: this.loginStabilityWindowMs, samples: 1, passed: true };
    }
    const startedAt = Date.now();
    let samples = 1;
    let latestEvidence = initialEvidence;
    while (Date.now() - startedAt < this.loginStabilityWindowMs) {
      await waitForProbe(page, Math.min(LOGIN_STABILITY_SAMPLE_INTERVAL_MS, this.loginStabilityWindowMs));
      samples += 1;
      const currentUrl = page.url();
      if (this.isLoginPage(currentUrl)) return { decision: "login_required", evidence: emptyPageEvidence(page), windowMs: Date.now() - startedAt, samples, passed: false };
      if (this.isVerificationUrl(currentUrl)) return { decision: "needs_user_action", evidence: emptyPageEvidence(page), windowMs: Date.now() - startedAt, samples, passed: false };
      latestEvidence = await readXiaohongshuPageEvidence(page);
      const decision = latestEvidence.available ? classifyXiaohongshuLoginEvidence(latestEvidence.login) : "unknown";
      if (decision !== "logged_in") return { decision, evidence: latestEvidence, windowMs: Date.now() - startedAt, samples, passed: false };
    }
    return { decision: "logged_in", evidence: latestEvidence, windowMs: Date.now() - startedAt, samples, passed: true };
  }

  private async emitLoginEvaluation(ctx: AccountContext, page: Page, evidence: XiaohongshuPageEvidence, decision: XiaohongshuLoginDecision, phase: XiaohongshuLoginEvaluation["phase"], stableObservationWindowMs = 0, stableObservationSamples = 0, stableObservationPassed = false): Promise<void> {
    if (!this.onLoginEvaluation) return;
    let pageUrl = "";
    let pageTitle = "";
    let pageIsClosed = false;
    try {
      pageUrl = page.url();
      const candidate = page as unknown as { title?: () => Promise<string>; isClosed?: () => boolean };
      pageTitle = typeof candidate.title === "function" ? await candidate.title().catch(() => "") : "";
      pageIsClosed = typeof candidate.isClosed === "function" && candidate.isClosed();
    } catch {
      pageIsClosed = true;
    }
    const login = evidence.login;
    const blockers = [login.visibleLoginForm, login.visibleQrLogin, login.visibleSmsVerification, login.visibleCaptcha, login.visibleSlider, login.visibleSecurityModal];
    this.onLoginEvaluation({ phase, timestamp: new Date().toISOString(), platformKey: this.platformKey, accountId: ctx.accountId, pageIsClosed, pageUrl, pageTitle, creatorDomain: login.creatorHost, creatorHomePath: login.creatorHomePath, publishNoteVisible: login.publishNoteVisible, noteManagementVisible: login.noteManagementVisible, dataDashboardVisible: login.dataDashboardVisible, accountStatusVisible: login.accountStatusVisible, profileAreaVisible: login.profileAreaVisible, visibleLoginForm: login.visibleLoginForm, visibleQrLogin: login.visibleQrLogin, visibleSmsVerification: login.visibleSmsVerification, visibleCaptcha: login.visibleCaptcha, visibleSlider: login.visibleSlider, visibleSecurityModal: login.visibleSecurityModal, positiveSignalCount: new Set(login.positiveSignals).size, blockingSignalCount: blockers.filter(Boolean).length, loginClassification: decision, stableObservationWindowMs, stableObservationSamples, stableObservationPassed });
  }

  private async emitAuthStateDiagnostic(ctx: AccountContext, phase: XiaohongshuAuthStateDiagnosticPhase, stableObservationWindowMs: number | null, stableObservationSamples: number | null, stableObservationPassed: boolean | null): Promise<void> {
    if (!this.onAuthStateDiagnostic) return;
    const session = this.activeBrowserSession(ctx);
    if (!session) return;
    let authState: XhsAuthStateMetadata | null = null;
    let error: { name: string; message: string } | null = null;
    try {
      authState = await collectXhsAuthStateMetadata({ context: session.context, page: session.page, profilePath: session.profilePath, credentialFilePath: this.credentialFilePath, fingerprintKey: this.diagnosticFingerprintKey(), browserChannel: session.browserChannel ?? null, headless: session.headless, storageMode: session.storageMode });
    } catch (caught) {
      error = { name: caught instanceof Error ? caught.name : "AuthStateDiagnosticError", message: "auth state metadata collection failed" };
    }
    const sessionEvidence = await this.getBrowserSessionEvidence(ctx).catch(() => null);
    if (!sessionEvidence) return;
    try {
      this.onAuthStateDiagnostic({ phase, timestamp: new Date().toISOString(), platformKey: this.platformKey, accountId: ctx.accountId, sessionKey: sessionEvidence.sessionKey, sessionIdHash: session.sessionIdHash, storageMode: session.storageMode, profilePath: session.profilePath, sessionEvidence, authState, stableObservationWindowMs, stableObservationSamples, stableObservationPassed, credentialSnapshotInjected: session.credentialSnapshotInjected ?? false, error });
    } catch {
      // Diagnostics are best-effort and must never alter persistence or close behavior.
    }
  }

  private diagnosticFingerprintKey(): Uint8Array {
    this.authStateFingerprintKey ??= createXhsDiagnosticFingerprintKey();
    return this.authStateFingerprintKey;
  }

  private assertProfilePageCanBeRead(evidence: XiaohongshuPageEvidence): void {
    if (!evidence.available) {
      if (this.isLoginPage(evidence.login.url)) throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书页面仍是登录页，请先完成登录");
      if (this.isVerificationUrl(evidence.login.url)) throw new XiaohongshuGateError("SECURITY_VERIFICATION_REQUIRED", "USER_ACTION_REQUIRED", "小红书页面仍是安全验证页；未尝试绕过");
      return;
    }
    const decision = classifyXiaohongshuLoginEvidence(evidence.login);
    if (decision === "login_required") throw new XiaohongshuGateError("LOGIN_REQUIRED", "USER_ACTION_REQUIRED", "小红书页面仍是登录页，请先完成登录");
    if (decision === "needs_user_action") throw new XiaohongshuGateError("SECURITY_VERIFICATION_REQUIRED", "USER_ACTION_REQUIRED", "页面存在可见且阻塞当前操作的登录/安全验证；未尝试绕过");
    if (decision !== "logged_in") throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "小红书 Creator 正向登录证据不足；未猜测账号身份");
  }

  private async inspectAccountIdentity(page: Page, pageEvidence?: XiaohongshuPageEvidence): Promise<XiaohongshuAccountIdentityEvidence> {
    if (pageEvidence?.available) {
      if (pageEvidence.identity.externalAccountIdCandidates.length > 1) throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "页面发现多个互相冲突的平台账号 ID");
      if (pageEvidence.identity.externalAccountId || pageEvidence.identity.displayName || pageEvidence.identity.profileUrl) {
        return {
          externalAccountId: pageEvidence.identity.externalAccountId,
          displayName: pageEvidence.identity.displayName,
          profileUrl: pageEvidence.identity.profileUrl
        };
      }
    }
    const links = page.locator("a[href]");
    const candidates: Array<{ href: string; id: string | null; name: string }> = [];
    for (let index = 0; index < await locatorCount(links); index += 1) {
      const link = locatorAt(links, index);
      const href = await attribute(link, "href");
      const id = stableExternalAccountId(href);
      if (!id) continue;
      candidates.push({ href: new URL(href, XIAOHONGSHU_CREATOR_HOME).toString(), id, name: normalizeXiaohongshuEditorText((await innerText(link)) || (await attribute(link, "aria-label")) || (await attribute(link, "title"))) });
    }
    const distinctIds = [...new Set(candidates.map((candidate) => candidate.id).filter((value): value is string => Boolean(value)))];
    if (distinctIds.length > 1) throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "页面发现多个互相冲突的平台账号 ID");
    const selected = candidates.find((candidate) => candidate.id === distinctIds[0]);
    if (selected) return { externalAccountId: selected.id, displayName: selected.name || null, profileUrl: selected.href };

    const nicknameCandidates: string[] = [];
    for (const selector of ['[data-testid*="nickname" i]', '[class*="nickname" i]', '[aria-label*="个人主页"], [aria-label*="账号"]']) {
      const locator = page.locator(selector);
      for (let index = 0; index < await locatorCount(locator); index += 1) {
        const candidate = locatorAt(locator, index);
        if (!(await isVisible(candidate)) || !(await isEnabled(candidate))) continue;
        const name = normalizeXiaohongshuEditorText((await innerText(candidate)) || (await attribute(candidate, "aria-label")));
        if (name) nicknameCandidates.push(name);
      }
    }
    const distinctNames = [...new Set(nicknameCandidates)];
    if (distinctNames.length === 1) return { externalAccountId: null, displayName: distinctNames[0], profileUrl: null };
    throw new XiaohongshuGateError("ACCOUNT_IDENTITY_UNVERIFIED", "USER_ACTION_REQUIRED", "未从真实页面可靠取得小红书账号身份；未猜测平台账号 ID");
  }

  private async discoverImagePostEntry(page: Page): Promise<Locator> {
    const imageEntry = page.locator(XIAOHONGSHU_IMAGE_POST_ENTRY_SELECTOR);
    const imageCount = await locatorCount(imageEntry);
    if (imageCount === 1 && await isVisible(imageEntry) && await isEnabled(imageEntry)) return imageEntry;
    const videoEntry = page.locator(XIAOHONGSHU_VIDEO_POST_ENTRY_SELECTOR);
    const videoCount = await locatorCount(videoEntry);
    if (videoCount > 0) throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", "页面只发现视频入口，未发现唯一可用的图文发布入口");
    const generic = page.locator('button, [role="button"], a');
    const genericMatches: Locator[] = [];
    for (let index = 0; index < await locatorCount(generic); index += 1) {
      const candidate = locatorAt(generic, index);
      if (!(await isVisible(candidate)) || !(await isEnabled(candidate))) continue;
      const label = normalizeXiaohongshuEditorText((await innerText(candidate)) || (await attribute(candidate, "aria-label")) || (await attribute(candidate, "title")));
      if (XIAOHONGSHU_IMAGE_POST_PATTERN.test(label) && !XIAOHONGSHU_VIDEO_PATTERN.test(label)) genericMatches.push(candidate);
    }
    if (genericMatches.length === 1) return genericMatches[0];
    throw new XiaohongshuGateError("IMAGE_POST_ENTRY_NOT_VERIFIED", "CONTENT_REJECTED", `图文入口未通过唯一、可见、启用校验；matches=${imageCount}`);
  }

  private async uploadImages(page: Page, images: string[]): Promise<Record<string, unknown>> {
    const input = page.locator(XIAOHONGSHU_FILE_SELECTOR);
    const inputCount = await locatorCount(input);
    if (inputCount !== 1 || !(await isVisible(input))) throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", `图片上传控件未通过唯一且可见校验；matches=${inputCount}`);
    try {
      await input.setInputFiles(images);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const pageContent = await bodyText(page);
        if (/上传失败|图片上传失败|upload failed/iu.test(pageContent)) throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", "页面显示图片上传失败");
        const busy = page.locator(XIAOHONGSHU_UPLOAD_BUSY_SELECTOR);
        const preview = page.locator(XIAOHONGSHU_PREVIEW_SELECTOR);
        const previewCount = await locatorCount(preview);
        if (previewCount >= images.length && previewCount > 0 && (await isVisible(locatorAt(preview, 0))) && await locatorCount(busy) === 0) {
          return { mechanism: "input[type=file]", requestedCount: images.length, previewCount, previewVisible: true, uploadBusyCount: 0, verified: true };
        }
        await waitForProbe(page);
      }
    } catch (error) {
      if (error instanceof XiaohongshuGateError) throw error;
      throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", `图片上传控件操作或页面验证失败：${error instanceof Error ? error.message : String(error)}`);
    }
    throw new XiaohongshuGateError("IMAGE_UPLOAD_NOT_VERIFIED", "UPLOAD_FAILED", "setInputFiles 后未取得真实页面预览且无上传进行中状态；未声明上传成功");
  }

  private async discoverUniqueEditor(page: Page, field: "title" | "body"): Promise<Locator> {
    const selectors = field === "title" ? [XIAOHONGSHU_TITLE_SELECTOR, XIAOHONGSHU_TITLE_FALLBACK_SELECTOR] : [XIAOHONGSHU_BODY_SELECTOR];
    for (const selector of selectors) {
      const candidates = page.locator(selector);
      const count = await locatorCount(candidates);
      if (count === 1 && await isVisible(candidates) && await isEnabled(candidates)) return candidates;
      if (count > 1) throw new XiaohongshuGateError(field === "title" ? "CONTENT_TITLE_NOT_VERIFIED" : "CONTENT_BODY_NOT_VERIFIED", "CONTENT_REJECTED", `${field} editor 未通过唯一校验；matches=${count}`);
    }
    throw new XiaohongshuGateError(field === "title" ? "CONTENT_TITLE_NOT_VERIFIED" : "CONTENT_BODY_NOT_VERIFIED", "CONTENT_REJECTED", `${field} editor 未通过唯一、可见、启用校验`);
  }

  private async inspectRequiredFields(page: Page): Promise<Array<{ label: string; empty: boolean; visible: boolean; enabled: boolean }>> {
    const required = page.locator(XIAOHONGSHU_REQUIRED_SELECTOR);
    const fields: Array<{ label: string; empty: boolean; visible: boolean; enabled: boolean }> = [];
    for (let index = 0; index < await locatorCount(required); index += 1) {
      const field = locatorAt(required, index);
      const value = await inputValue(field);
      const label = normalizeXiaohongshuEditorText((await attribute(field, "aria-label")) || (await attribute(field, "placeholder")) || (await innerText(field)));
      const checked = await attribute(field, "aria-checked");
      const visible = await isVisible(field);
      const enabled = await isEnabled(field);
      if (!visible || !enabled) continue;
      fields.push({ label, empty: !value.trim() && checked !== "true", visible, enabled });
    }
    return fields;
  }

  private async inspectPublishSettings(page: Page): Promise<Array<{ label: string; required: boolean; value: string }>> {
    const controls = page.locator(XIAOHONGSHU_SETTINGS_SELECTOR);
    const settings: Array<{ label: string; required: boolean; value: string }> = [];
    for (let index = 0; index < await locatorCount(controls); index += 1) {
      const control = locatorAt(controls, index);
      const label = normalizeXiaohongshuEditorText((await attribute(control, "aria-label")) || (await attribute(control, "title")) || (await innerText(control)));
      const value = (await attribute(control, "aria-checked")) || (await inputValue(control));
      settings.push({ label, required: (await attribute(control, "aria-required")) === "true", value });
    }
    return settings;
  }

  private async inspectFinalSubmitControl(page: Page): Promise<XiaohongshuFinalSubmitControlEvidence> {
    const controls = page.locator(XIAOHONGSHU_FINAL_SUBMIT_SELECTOR);
    const count = await locatorCount(controls);
    const matches: Array<{ locator: Locator; label: string; visible: boolean; enabled: boolean; secondConfirmation: "present" | "absent" | "unknown" }> = [];
    for (let index = 0; index < count; index += 1) {
      const control = locatorAt(controls, index);
      const label = normalizeXiaohongshuEditorText((await innerText(control)) || (await attribute(control, "aria-label")) || (await attribute(control, "title")));
      if (!XIAOHONGSHU_FINAL_SUBMIT_PATTERN.test(label) || XIAOHONGSHU_VIDEO_PATTERN.test(label)) continue;
      const visible = await isVisible(control);
      const enabled = await isEnabled(control);
      let secondConfirmation: "present" | "absent" | "unknown" = (await attribute(control, "data-confirm")) === "true" ? "present" : "absent";
      if (secondConfirmation === "absent") {
        const confirmations = page.locator('[data-testid*="confirm" i], [aria-label*="确认发布"], [class*="confirm" i]');
        const confirmationCount = await locatorCount(confirmations);
        for (let confirmationIndex = 0; confirmationIndex < confirmationCount; confirmationIndex += 1) {
          if (await isVisible(locatorAt(confirmations, confirmationIndex))) { secondConfirmation = "present"; break; }
        }
      }
      if (visible && enabled) matches.push({ locator: control, label, visible, enabled, secondConfirmation });
    }
    if (matches.length !== 1) throw new XiaohongshuGateError("FINAL_SUBMIT_CONTROL_NOT_VERIFIED", "FINAL_SUBMIT_CONTROL_NOT_FOUND", `最终发布控件未通过唯一、可见、启用 discovery；matches=${matches.length}`);
    return { verified: true, visible: matches[0].visible, enabled: matches[0].enabled, unique: true, label: matches[0].label, selector: XIAOHONGSHU_FINAL_SUBMIT_SELECTOR, secondConfirmation: matches[0].secondConfirmation };
  }
}

export { definition as xiaohongshuBrowserDefinition };
